-- SP3 step 3 (docs/plans/2026-11-15-sp3-console.md §3.1.4; AT2): platform staff and venue members never mix, guarded on both sides for every role (the migration owner
-- included).
--  * platform.staff, before insert or update of auth_id, role, is_active: a platform_support row is refused when the auth user has any app_user row; a platform_admin
--    row is refused when the auth user has any app_user row whose role is not admin, active or not.
--  * public.app_user, before insert or update of auth_id, role: when the auth user has a platform.staff row, the app_user row is refused unless that staff row is an
--    active platform_admin and the new role is admin. This is the one new trigger in public (pgTAP 365 counts it: 128 to 129).
-- The functions are definers with an empty search_path and closed to every API role.
-- Race (lead's review): each guard reads the other table with a plain `exists`, and under READ COMMITTED an uncommitted row of the other session is invisible, so a staff
-- row and a member row for one auth user could both commit. Both guards therefore lock the auth user's row, `select ... from auth.users ... for no key update`, before they
-- check: the second writer waits for the first to commit and then sees its row. An update that changes auth_id locks the old and the new auth user in one ordered select
-- (by id), so two such updates cannot deadlock. FOR NO KEY UPDATE rather than an advisory lock because pgTAP 049 counts every advisory lock a session holds (an advisory lock
-- here would turn it red, and 049 is not an SP3 pin); rather than FOR UPDATE because it does not conflict with the FOR KEY SHARE the foreign keys to auth.users take, so no
-- unrelated insert waits. It does conflict with itself, which is all the guards need. Needs UPDATE on auth.users for the function owner (the migration owner holds it;
-- hosted Supabase not yet verified, see the build notes).

create function platform.staff_member_guard() returns trigger
  language plpgsql security definer
  set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    perform 1 from auth.users u where u.id in (new.auth_id, old.auth_id) order by u.id for no key update;
  else
    perform 1 from auth.users u where u.id = new.auth_id for no key update;
  end if;
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
  if tg_op = 'UPDATE' then
    perform 1 from auth.users u where u.id in (new.auth_id, old.auth_id) order by u.id for no key update;
  else
    perform 1 from auth.users u where u.id = new.auth_id for no key update;
  end if;
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
