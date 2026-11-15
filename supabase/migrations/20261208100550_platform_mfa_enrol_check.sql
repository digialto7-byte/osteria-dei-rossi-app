-- SP3 step 9 follow-up (review, 2026-11-15): the account routes need a check that is staff-only and always answers the platform issuer. public.mfa_enrol_check passes any owner or
-- admin that carries a tenant claim and answers the tenant's name as issuer, so POST /api/auth/mfa/account/factors would have let a venue owner or admin through, and given a platform
-- admin with a tenant claim the venue's issuer. public.platform_mfa_enrol_check(text) answers for an ACTIVE platform.staff row only (anyone else, claims or not: 42501), always
-- {"issuer": "Costì", "friendlyName": <slot name>}, with the same invalid-slot, aal2, limit and slot-taken rules as mfa_enrol_check. Execute to authenticated only.

create function public.platform_mfa_enrol_check(p_slot text) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_auth uuid := auth.uid();
  v_name text;
begin
  if v_auth is null or not exists (select 1 from platform.staff s where s.auth_id = v_auth and s.is_active) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  v_name := case p_slot when 'principale' then 'Principale' when 'riserva' then 'Riserva' end;
  if v_name is null then
    raise exception 'invalid_slot' using errcode = '22023';
  end if;
  -- Adding a factor to an account that already has one is a protected act (Supabase asks for aal2 as well).
  if app.mfa_has_verified_factor(v_auth) and app.jwt_aal() <> 'aal2' then
    raise exception 'mfa_required' using errcode = 'P0001';
  end if;
  if (select count(*) from auth.mfa_factors f where f.user_id = v_auth and f.status = 'verified' and f.factor_type = 'totp') >= app.mfa_max_factors() then
    raise exception 'mfa_factor_limit' using errcode = 'P0001';
  end if;
  if exists (select 1 from auth.mfa_factors f where f.user_id = v_auth and f.status = 'verified' and f.factor_type = 'totp' and f.friendly_name = v_name) then
    raise exception 'mfa_slot_taken' using errcode = 'P0001';
  end if;
  return jsonb_build_object('issuer', 'Costì', 'friendlyName', v_name);
end
$$;
revoke all on function public.platform_mfa_enrol_check(text) from public, anon, authenticated, service_role;
grant execute on function public.platform_mfa_enrol_check(text) to authenticated;
