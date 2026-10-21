-- M0: tenancy and role baseline (plan §3.5.1, §3.11.1, ADR-003).
-- Every later table follows the same pattern: tenant_id not null, RLS on, policies written with
-- (select app.tenant_id()) and (select app.role()), no DELETE or TRUNCATE for any API role.

create schema if not exists app;
grant usage on schema app to authenticated, supabase_auth_admin;
revoke all on schema app from anon, public;

create type public.app_role as enum ('owner', 'chef', 'waiter', 'admin');

-- tenant: one row per venue business. tenant_id mirrors id so the "every table has tenant_id"
-- rule and the policy pattern hold here too.
create table public.tenant (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null generated always as (id) stored,
  name text not null check (length(name) between 1 and 200),
  vat_number text not null unique check (vat_number ~ '^IT[0-9]{11}$'),
  timezone text not null default 'Europe/Rome',
  currency text not null default 'EUR' check (currency = 'EUR'),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(),
  created_by uuid
);
create index tenant_tenant_id_idx on public.tenant (tenant_id);

-- app_user (the PRD's `user`; renamed because `user` is reserved). One tenant per login for now:
-- the access token carries a single tenant_id.
create table public.app_user (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id),
  auth_id uuid not null unique references auth.users (id),
  role public.app_role not null,
  display_name text not null check (length(display_name) between 1 and 100),
  is_active boolean not null default true,
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.app_user (id),
  constraint app_user_deactivation_consistent check (is_active = (deactivated_at is null))
);
create index app_user_tenant_id_idx on public.app_user (tenant_id);

alter table public.tenant
  add constraint tenant_created_by_fkey foreign key (created_by) references public.app_user (id);

-- Membership helpers used by every policy. The token's tenant claim (added by the hook below) only
-- counts while the caller still has an ACTIVE app_user in that tenant, and the role is read from
-- that row, so deactivation and role changes apply at once instead of when the token expires.
-- SECURITY DEFINER because the lookup must not go through app_user's own policies (recursion).
create function app.tenant_id() returns uuid
  language sql stable security definer
  set search_path = ''
as $$
  select u.tenant_id
    from public.app_user u
   where u.auth_id = auth.uid()
     and u.is_active
     and u.tenant_id = nullif(auth.jwt() ->> 'tenant_id', '')::uuid
$$;

create function app.role() returns public.app_role
  language sql stable security definer
  set search_path = ''
as $$
  select u.role
    from public.app_user u
   where u.auth_id = auth.uid()
     and u.is_active
     and u.tenant_id = nullif(auth.jwt() ->> 'tenant_id', '')::uuid
$$;

revoke all on function app.tenant_id(), app.role() from public, anon;
grant execute on function app.tenant_id(), app.role() to authenticated;

alter table public.tenant enable row level security;
alter table public.app_user enable row level security;

-- Privileges: nothing for anon; no DELETE or TRUNCATE for any API role, the secret key included
-- (plan §3.6 rule 5). Tenants are created by public.create_tenant_with_owner; editing tenant
-- settings (M8) and managing users (M11) add their own grants and policies with tests.
revoke all on public.tenant, public.app_user from anon, authenticated;
revoke delete, truncate on public.tenant, public.app_user from service_role;
grant select on public.tenant to authenticated;
grant select, insert (tenant_id, auth_id, role, display_name) on public.app_user to authenticated;

create policy tenant_select on public.tenant
  for select to authenticated
  using (id = (select app.tenant_id()));

create policy app_user_select on public.app_user
  for select to authenticated
  using (
    tenant_id = (select app.tenant_id())
    and ((select app.role()) in ('owner', 'admin') or auth_id = (select auth.uid()))
  );

-- Only an admin (DigiAlto) can create another admin.
create policy app_user_insert on public.app_user
  for insert to authenticated
  with check (
    tenant_id = (select app.tenant_id())
    and (select app.role()) in ('owner', 'admin')
    and (role <> 'admin' or (select app.role()) = 'admin')
  );

-- Custom Access Token Hook (https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook).
-- Runs as supabase_auth_admin on every token issue/refresh. Adds tenant_id and app_role for an
-- active app_user and strips them otherwise. Lives in `app`, which the Data API does not expose,
-- so it can never be called through /rpc.
create function app.custom_access_token_hook(event jsonb) returns jsonb
  language plpgsql stable
  set search_path = ''
as $$
declare
  claims jsonb := coalesce(event -> 'claims', '{}'::jsonb) - 'tenant_id' - 'app_role';
  member record;
begin
  select u.tenant_id, u.role
    into member
    from public.app_user u
   where u.auth_id = (event ->> 'user_id')::uuid
     and u.is_active;

  if found then
    claims := claims
      || jsonb_build_object('tenant_id', member.tenant_id, 'app_role', member.role);
  end if;

  return jsonb_set(event, '{claims}', claims);
end
$$;

revoke all on function app.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function app.custom_access_token_hook(jsonb) to supabase_auth_admin;

grant usage on schema public to supabase_auth_admin;
grant select (auth_id, tenant_id, role, is_active) on public.app_user to supabase_auth_admin;
create policy app_user_read_by_auth_hook on public.app_user
  for select to supabase_auth_admin
  using (true);

-- Tenant onboarding: the tenant and its owner in one transaction. Called only by
-- scripts/create-tenant.ts with the secret key (service_role), after it created the auth user.
create function public.create_tenant_with_owner(
  tenant_name text,
  tenant_vat_number text,
  owner_auth_id uuid,
  owner_display_name text
) returns uuid
  language plpgsql
  set search_path = ''
as $$
declare
  new_tenant_id uuid;
begin
  insert into public.tenant (name, vat_number)
    values (tenant_name, tenant_vat_number)
    returning id into new_tenant_id;
  insert into public.app_user (tenant_id, auth_id, role, display_name)
    values (new_tenant_id, owner_auth_id, 'owner', owner_display_name);
  return new_tenant_id;
end
$$;

revoke all on function public.create_tenant_with_owner(text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_tenant_with_owner(text, text, uuid, text) to service_role;
