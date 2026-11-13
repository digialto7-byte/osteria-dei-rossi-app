-- FD31 (founder decision of 2026-11-13; docs/plans/2026-11-12-p2-1-totp.md T-2 note, ADR-036 amendment): the admin role always needs a second factor,
-- in every tenant mode (off, enrolled, required). Two functions are replaced, with the same signatures, owners, grants, security definer and empty
-- search_path (create or replace keeps owner and grants):
--   app.mfa_needs_aal2         T-2 now: an admin always; an owner only when the mode is not off and a verified factor exists. An admin without an
--                              aal2 token therefore gets null from app.tenant_id(), app.role() and app.app_user_id() and is refused by RLS.
--                              app.mfa_gate_of, public.mfa_gate and public.mfa_status derive from it, so an admin without a verified factor now
--                              answers 'enrol' in every mode (the forced enrolment page), with a factor and aal1 'challenge', at aal2 'ok'.
--   public.mfa_unenrol_check   an admin can never remove their last verified factor, in any mode (was: only under 'required'). The owner is unchanged.
-- Not touched: owner, chef, waiter, PIN sessions and devices; the access-token hook; public.set_mfa_enforcement (its admins_not_enrolled check for
-- 'required' stays as it is: it still protects the switch to required).

create or replace function app.mfa_needs_aal2(p_role public.app_role, p_tenant uuid, p_auth uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select p_role = 'admin'
      or (p_role = 'owner'
          and coalesce((select t.mfa_enforcement from public.tenant t where t.id = p_tenant), 'enrolled') <> 'off'
          and app.mfa_has_verified_factor(p_auth))
$$;

create or replace function public.mfa_unenrol_check(p_factor uuid) returns void
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  m record;
  v_status auth.factor_status;
begin
  select * into m from app.membership_ungated();
  if not found or m.role not in ('owner', 'admin') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  select f.status into v_status from auth.mfa_factors f where f.id = p_factor and f.user_id = m.auth_id and f.factor_type = 'totp';
  if not found then
    raise exception 'mfa_factor_not_found' using errcode = 'P0001';
  end if;
  if v_status = 'verified' then
    perform app.require_aal2();
    if m.role = 'admin'
       and (select count(*) from auth.mfa_factors f where f.user_id = m.auth_id and f.status = 'verified' and f.factor_type = 'totp') <= 1 then
      raise exception 'mfa_last_factor' using errcode = 'P0001';
    end if;
  end if;
end
$$;
