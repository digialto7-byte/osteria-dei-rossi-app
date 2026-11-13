-- P2-1 A1 (docs/plans/2026-11-12-p2-1-totp.md section 3.2, T-1 to T-3): the second-factor gate in Postgres.
--
--   public.tenant.mfa_enforcement   off | enrolled | required, default 'enrolled'. authenticated can SELECT it (the gate helpers read it) and
--                                   service_role can UPDATE it through the table-wide grant; secret-key holders are trusted. The supported way
--                                   to change it is scripts/set-mfa-enforcement.ts (public.set_mfa_enforcement, a later step), which writes the
--                                   audit row. 'off' is the kill switch.
--   app.jwt_aal()                   the token's assurance level, a missing claim counts as aal1.
--   app.mfa_has_verified_factor     a verified TOTP factor in auth.mfa_factors (read by the definer owner, as in the Supabase RLS example).
--   app.mfa_needs_aal2              T-2: owner or admin, mode not off, and (a verified factor, or an admin under 'required').
--   app.membership_ungated()        the M0 lookup without the gate; ONLY for the exempt MFA procedures (T-4), pinned by the coverage scan.
--   app.tenant_id(), app.role(), app.app_user_id()   replaced on purpose: the M0 body plus the gate. Every RLS policy and every definer
--                                   procedure that resolves the tenant or the role inherits it: a gated owner or admin gets null.
--   app.require_aal2()              raises P0001 mfa_required when the caller is gated and the token is not aal2.
-- The access-token hook is not touched. Staff (chef, waiter, PIN sessions) are never gated: T-2 names owner and admin only.

alter table public.tenant
  add column mfa_enforcement text not null default 'enrolled'
    constraint tenant_mfa_enforcement_check check (mfa_enforcement in ('off', 'enrolled', 'required'));

create function app.jwt_aal() returns text
  language sql
  stable
  set search_path = ''
as $$ select coalesce(nullif(auth.jwt() ->> 'aal', ''), 'aal1') $$;

create function app.mfa_has_verified_factor(p_auth uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (select 1 from auth.mfa_factors f
                  where f.user_id = p_auth and f.status = 'verified' and f.factor_type = 'totp')
$$;

create function app.mfa_needs_aal2(p_role public.app_role, p_tenant uuid, p_auth uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select p_role in ('owner', 'admin')
     and coalesce((select t.mfa_enforcement from public.tenant t where t.id = p_tenant), 'enrolled') <> 'off'
     and (app.mfa_has_verified_factor(p_auth)
          or (p_role = 'admin'
              and (select t.mfa_enforcement from public.tenant t where t.id = p_tenant) = 'required'))
$$;

-- The M0 lookup without the gate: the active app_user whose tenant is the token's tenant claim.
create function app.membership_ungated()
  returns table (app_user_id uuid, tenant_id uuid, role public.app_role, auth_id uuid)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select u.id, u.tenant_id, u.role, u.auth_id
    from public.app_user u
   where u.auth_id = auth.uid()
     and u.is_active
     and u.tenant_id = nullif(auth.jwt() ->> 'tenant_id', '')::uuid
$$;

-- The three helpers: same signature, owner and grants as before (create or replace), plus the gate.
create or replace function app.tenant_id() returns uuid
  language sql stable security definer
  set search_path = ''
as $$
  select u.tenant_id
    from public.app_user u
   where u.auth_id = auth.uid()
     and u.is_active
     and u.tenant_id = nullif(auth.jwt() ->> 'tenant_id', '')::uuid
     and (not app.mfa_needs_aal2(u.role, u.tenant_id, u.auth_id) or app.jwt_aal() = 'aal2')
$$;

create or replace function app.role() returns public.app_role
  language sql stable security definer
  set search_path = ''
as $$
  select u.role
    from public.app_user u
   where u.auth_id = auth.uid()
     and u.is_active
     and u.tenant_id = nullif(auth.jwt() ->> 'tenant_id', '')::uuid
     and (not app.mfa_needs_aal2(u.role, u.tenant_id, u.auth_id) or app.jwt_aal() = 'aal2')
$$;

create or replace function app.app_user_id() returns uuid
  language sql stable security definer
  set search_path = ''
as $$
  select u.id
    from public.app_user u
   where u.auth_id = auth.uid()
     and u.is_active
     and u.tenant_id = nullif(auth.jwt() ->> 'tenant_id', '')::uuid
     and (not app.mfa_needs_aal2(u.role, u.tenant_id, u.auth_id) or app.jwt_aal() = 'aal2')
$$;

create function app.require_aal2() returns void
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  if app.jwt_aal() <> 'aal2'
     and exists (select 1 from app.membership_ungated() m where app.mfa_needs_aal2(m.role, m.tenant_id, m.auth_id)) then
    raise exception 'mfa_required' using errcode = 'P0001';
  end if;
end
$$;

-- The new helpers are for other definer functions only: no role, the API roles included, may call them.
revoke all on function app.jwt_aal(), app.mfa_has_verified_factor(uuid), app.mfa_needs_aal2(public.app_role, uuid, uuid),
  app.membership_ungated(), app.require_aal2() from public, anon, authenticated, service_role;
