-- SP3 step 4 (docs/plans/2026-11-15-sp3-console.md §3.3.6; AT11 as amended by Q-P5): the platform admin bootstrap, called only by the platform-ops workflow's script with the
-- secret key. It refuses an auth user that does not exist (P0002 auth_user_not_found), one with any non-admin membership (P0001 platform_admin_has_member_role) and a second
-- active platform admin (P0001 platform_admin_exists) or an auth user that already has a staff row of any kind (P0001 platform_staff_exists); a refusal writes nothing. It does not check for a second factor: a fresh account has no way to enrol one before it is
-- staff (Q-P5), so the staff row comes first and the factor is enrolled in the app. The row alone grants nothing; the factor check lives in app.require_console and
-- public.select_console (steps 10 and 13). It reports hasVerifiedFactor so the script can say what comes next.

create function public.platform_bootstrap_admin(p_auth uuid) returns jsonb
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_factor boolean;
begin
  if p_auth is null or not exists (select 1 from auth.users u where u.id = p_auth) then
    raise exception 'auth_user_not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.app_user m where m.auth_id = p_auth and m.role <> 'admin') then
    raise exception 'platform_admin_has_member_role' using errcode = 'P0001';
  end if;
  if exists (select 1 from platform.staff s where s.role = 'platform_admin' and s.is_active) then
    raise exception 'platform_admin_exists' using errcode = 'P0001';
  end if;
  if exists (select 1 from platform.staff s where s.auth_id = p_auth) then
    raise exception 'platform_staff_exists' using errcode = 'P0001';
  end if;
  insert into platform.staff (auth_id, role) values (p_auth, 'platform_admin');
  perform platform.audit_write('script', 'platform_admin.bootstrapped', null, jsonb_build_object('authId', p_auth));
  v_factor := app.mfa_has_verified_factor(p_auth);
  return jsonb_build_object('authId', p_auth, 'hasVerifiedFactor', v_factor);
end
$$;
revoke all on function public.platform_bootstrap_admin(uuid) from public, anon, authenticated;
grant execute on function public.platform_bootstrap_admin(uuid) to service_role;
