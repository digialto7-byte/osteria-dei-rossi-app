-- SP3 step 3 (docs/plans/2026-11-15-sp3-console.md §3.1.4; AT2): platform staff and venue members never mix, guarded on both sides for every role (the migration owner
-- included).
--  * platform.staff, before insert or update of auth_id, role, is_active: a platform_support row is refused when the auth user has any app_user row; a platform_admin
--    row is refused when the auth user has any app_user row whose role is not admin, active or not.
--  * public.app_user, before insert or update of auth_id, role: when the auth user has a platform.staff row, the app_user row is refused unless that staff row is an
--    active platform_admin and the new role is admin. This is the one new trigger in public (pgTAP 365 counts it: 128 to 129).
-- The functions are definers with an empty search_path and closed to every API role.

create function platform.staff_member_guard() returns trigger
  language plpgsql security definer
  set search_path = ''
as $$
begin
  if new.role = 'platform_support' and exists (select 1 from public.app_user u where u.auth_id = new.auth_id) then
    raise exception 'platform_support_has_member_row' using errcode = 'P0001';
  end if;
  if new.role = 'platform_admin' and exists (select 1 from public.app_user u where u.auth_id = new.auth_id and u.role <> 'admin') then
    raise exception 'platform_admin_member_role' using errcode = 'P0001';
  end if;
  return new;
end
$$;
revoke all on function platform.staff_member_guard() from public, anon, authenticated, service_role;

create trigger staff_member_guard before insert or update of auth_id, role, is_active on platform.staff
  for each row execute function platform.staff_member_guard();

create function app.app_user_platform_staff_guard() returns trigger
  language plpgsql security definer
  set search_path = ''
as $$
begin
  if exists (select 1 from platform.staff s where s.auth_id = new.auth_id)
     and not exists (select 1 from platform.staff s
                      where s.auth_id = new.auth_id and s.role = 'platform_admin' and s.is_active and new.role = 'admin') then
    raise exception 'platform_staff_member_role' using errcode = 'P0001';
  end if;
  return new;
end
$$;
revoke all on function app.app_user_platform_staff_guard() from public, anon, authenticated, service_role;

create trigger app_user_platform_staff_guard before insert or update of auth_id, role on public.app_user
  for each row execute function app.app_user_platform_staff_guard();
