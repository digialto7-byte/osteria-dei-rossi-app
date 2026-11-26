-- SP2 S3 (docs/plans/2026-11-26-sp02-memberships.md §3.1 and §3.2; ADR-038): one login, one membership per tenant, and each session chooses its
-- tenant. The key change and the hook change are in this ONE migration (platform plan §2.4 point 3): with several active rows per login, the M11
-- e-mail branch (`select … into` without strict) would take one row in no defined order.
--
-- Tenant #1 at deploy: every login has at most one active row when this runs (the old unique held until the statement below), so rule E3 gives
-- every e-mail user today's claims with no selection row. The PIN branch is M11's text, word for word (tests/config/sp2-hook-pin-branch.test.ts).

-- 1. The key ---------------------------------------------------------------------------------------------------------------------------------------
alter table public.app_user drop constraint app_user_auth_id_key;
alter table public.app_user add constraint app_user_tenant_auth_key unique (tenant_id, auth_id);
-- The hook's and my_memberships' per-login lookups lose the index the old unique gave; the gate helpers are served by the composite key.
create index app_user_auth_id_idx on public.app_user (auth_id);

-- 2. A PIN login keeps exactly one membership (ADR-010 decision 2) ---------------------------------------------------------------------------------
-- Refuses a PIN row whose login has another row, and any row for a login that already has a PIN row.
create function app.app_user_pin_single_membership() returns trigger
  language plpgsql security definer
  set search_path = ''
as $$
begin
  if exists (select 1 from public.app_user u
              where u.auth_id = new.auth_id and u.id <> new.id
                and (new.login_method = 'pin' or u.login_method = 'pin')) then
    raise exception 'pin_single_membership' using errcode = 'P0001';
  end if;
  return new;
end
$$;
revoke all on function app.app_user_pin_single_membership() from public, anon, authenticated, service_role;

create trigger app_user_pin_single_membership before insert or update of auth_id, login_method on public.app_user
  for each row execute function app.app_user_pin_single_membership();

-- 3. An owner cannot attach a login that is a member elsewhere (Q-S2) -------------------------------------------------------------------------------
-- Without the old unique, the direct insert policy would let an owner of B add the owner of A to B, and A's owner would lose their default tenant.
-- A second tenant's membership is created only by service-role paths (create_tenant_with_owner, scripts/create-tenant.ts --existing-owner-id).
-- Executable by authenticated because the insert policy calls it as the caller; it answers only "has this login a row in another tenant".
create function app.auth_member_elsewhere(p_auth uuid, p_tenant uuid) returns boolean
  language sql stable security definer
  set search_path = ''
as $$
  select exists (select 1 from public.app_user u where u.auth_id = p_auth and u.tenant_id <> p_tenant)
$$;
revoke all on function app.auth_member_elsewhere(uuid, uuid) from public, anon, service_role;
grant execute on function app.auth_member_elsewhere(uuid, uuid) to authenticated;

drop policy app_user_insert on public.app_user;
create policy app_user_insert on public.app_user
  for insert to authenticated
  with check (
    tenant_id = (select app.tenant_id())
    and (select app.role()) in ('owner', 'admin')
    and (role <> 'admin' or (select app.role()) = 'admin')
    and not app.auth_member_elsewhere(auth_id, tenant_id)
  );

-- 4. Each session's choice ----------------------------------------------------------------------------------------------------------------------
-- Session state, not a ledger: written only by public.select_tenant (S4) and purged by app.purge_auth_data (S5). The composite key means a
-- selection always names a real membership; the hook still checks that it is active. No API role has any privilege; only the hook reads it.
create table app.session_tenant (
  session_id uuid primary key,
  auth_id uuid not null,
  tenant_id uuid not null references public.tenant (id),
  selected_at timestamptz not null default now(),
  foreign key (tenant_id, auth_id) references public.app_user (tenant_id, auth_id)
);
alter table app.session_tenant enable row level security;
revoke all on app.session_tenant from public, anon, authenticated, service_role;
grant select on app.session_tenant to supabase_auth_admin;
create policy session_tenant_read_by_auth_hook on app.session_tenant
  for select to supabase_auth_admin using (true);

-- 5. The hook --------------------------------------------------------------------------------------------------------------------------------------
-- Same signature, owner and grants as M0's and M11's hook (create or replace keeps them). The strip and the PIN branch are M11's text.
create or replace function app.custom_access_token_hook(event jsonb) returns jsonb
  language plpgsql stable
  set search_path = ''
as $$
declare
  -- Incoming tenant, role, login and session_state claims are never trusted.
  claims jsonb := coalesce(event -> 'claims', '{}'::jsonb)
                  - 'tenant_id' - 'app_role' - 'login' - 'session_state';
  member record;
  pin_user record;
  selected uuid;
  active_count integer;
begin
  select u.id, u.tenant_id, u.role
    into pin_user
    from public.app_user u
   where u.auth_id = (event ->> 'user_id')::uuid
     and u.login_method = 'pin';

  if found then
    begin
      if (event ->> 'authentication_method' = 'password'
          and app.pin_sign_in_allowed(pin_user.id, clock_timestamp()))
         or (event ->> 'authentication_method' = 'token_refresh'
             and app.staff_session_open(nullif(event -> 'claims' ->> 'session_id', '')::uuid, pin_user.id,
                                        clock_timestamp())) then
        claims := claims || jsonb_build_object('tenant_id', pin_user.tenant_id, 'app_role', pin_user.role,
                                               'login', 'pin');
      else
        claims := claims || jsonb_build_object('session_state', 'ended');
      end if;
    exception when others then
      claims := (coalesce(event -> 'claims', '{}'::jsonb)
                 - 'tenant_id' - 'app_role' - 'login' - 'session_state')
                || jsonb_build_object('session_state', 'ended');
    end;
    return jsonb_set(event, '{claims}', claims);
  end if;

  -- Email accounts (SP2). E1: this session's selection, if any; any error (a malformed session id, an unreadable table) counts as none.
  begin
    select s.tenant_id
      into selected
      from app.session_tenant s
     where s.session_id = (event -> 'claims' ->> 'session_id')::uuid
       and s.auth_id = (event ->> 'user_id')::uuid;
  exception when others then
    selected := null;
  end;

  -- E2: a selection of an active membership wins.
  if selected is not null then
    select u.tenant_id, u.role
      into member
      from public.app_user u
     where u.auth_id = (event ->> 'user_id')::uuid
       and u.tenant_id = selected
       and u.is_active;
    if found then
      return jsonb_set(event, '{claims}', claims || jsonb_build_object('tenant_id', member.tenant_id, 'app_role', member.role));
    end if;
  end if;

  -- E3: otherwise exactly one active membership gives that tenant (today's behaviour). E4: none, or several: no tenant claim.
  select count(*), min(u.tenant_id::text)::uuid
    into active_count, selected
    from public.app_user u
   where u.auth_id = (event ->> 'user_id')::uuid
     and u.is_active;
  if active_count = 1 then
    select u.tenant_id, u.role
      into member
      from public.app_user u
     where u.auth_id = (event ->> 'user_id')::uuid
       and u.tenant_id = selected
       and u.is_active;
    claims := claims || jsonb_build_object('tenant_id', member.tenant_id, 'app_role', member.role);
  end if;

  return jsonb_set(event, '{claims}', claims);
end
$$;
