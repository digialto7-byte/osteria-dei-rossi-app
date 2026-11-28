-- SP3 step 14 (docs/plans/2026-11-15-sp3-console.md §3.2; AT1, AT12): the hook's console mode. Same signature, owner, grants, stable and search_path = '' (create or
-- replace keeps them). Order: the strip and the PIN branch (M11's text, unchanged), then the console block (new, its own exception block), then SP2's e-mail
-- branches E1 to E4 (20261207100100_memberships.sql, unchanged). A session without a console row gets exactly the claims it got before (pgTAP 003, 085, 340,
-- 431 and 441 §4 unchanged; tests/config/sp3-hook-branches.test.ts compares the source text). An incoming role = platform_staff outside console mode is set back
-- to authenticated (GoTrue sends authenticated, so this only guards a stale value).
-- GoTrue runs the hook as supabase_auth_admin: it may now read platform.staff and platform.console_session (select only, one policy each) and use the schema.

grant usage on schema platform to supabase_auth_admin;
grant select on platform.staff to supabase_auth_admin;
create policy staff_read_by_auth_hook on platform.staff
  for select to supabase_auth_admin using (true);

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

  -- SP3 step 14: console mode. A console row of this session for this user, who is the active platform admin, gives role = platform_staff and no tenant claim.
  -- Only select_console writes such a row, after a verified factor at aal2. Any error (a malformed session id, an unreadable table) falls through.
  begin
    if exists (select 1
                 from platform.console_session c
                 join platform.staff s on s.auth_id = c.auth_id
                where c.session_id = (event -> 'claims' ->> 'session_id')::uuid
                  and c.auth_id = (event ->> 'user_id')::uuid
                  and s.role = 'platform_admin'
                  and s.is_active) then
      return jsonb_set(event, '{claims}', jsonb_set(claims, '{role}', to_jsonb('platform_staff'::text)));
    end if;
  exception when others then
    null;
  end;
  -- A stale incoming platform_staff role is never trusted outside console mode.
  if claims ->> 'role' = 'platform_staff' then
    claims := jsonb_set(claims, '{role}', to_jsonb('authenticated'::text));
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
