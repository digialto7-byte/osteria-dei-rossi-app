-- SP3 step 3 (docs/plans/2026-11-15-sp3-console.md §3.1.4; AT2): platform staff and venue members never mix, guarded on both sides for every role (the migration owner
-- included).
--  * platform.staff, before insert or update of auth_id, role, is_active: a platform_support row is refused when the auth user has any app_user row; a platform_admin
--    row is refused when the auth user has any app_user row whose role is not admin, active or not.
--  * public.app_user, before insert or update of auth_id, role: when the auth user has a platform.staff row, the app_user row is refused unless that staff row is an
--    active platform_admin and the new role is admin. This is the one new trigger in public (pgTAP 365 counts it: 128 to 129).
-- The functions are definers with an empty search_path and closed to every API role. A row with a null auth_id passes through untouched, so pgTAP 390's
-- cross-tenant inserts still meet the row level security check (42501) first.
-- Race (lead's review): each guard reads the other table with a plain `exists`, and under READ COMMITTED an uncommitted row of the other session is invisible, so a staff
-- row and a member row for one auth user could both commit. Both guards therefore lock a row of OUR OWN table, platform.auth_lock (one row per auth user, made on first
-- need), before they check: the second writer waits for the first to commit and then sees its row. An update that changes auth_id locks the old and the new auth user in one
-- ordered statement (by id), so two such updates cannot deadlock. Not an advisory lock (pgTAP 049 counts every advisory lock a session holds) and not a lock on auth.users (a
-- grant in a schema Supabase owns can tighten without a change here; lead, 2026-11-15). The lock row references auth.users with on delete cascade, so it goes when its auth user
-- goes; no auth purge deletes users, so the cascade is the purge. Closed to every API role; the guards are definers owned by the migration owner.

create table platform.auth_lock (
  auth_id uuid primary key references auth.users (id) on delete cascade
);
alter table platform.auth_lock enable row level security;
revoke all on platform.auth_lock from public, anon, authenticated, service_role;

create function platform.staff_member_guard() returns trigger
  language plpgsql security definer
  set search_path = ''
as $$
begin
  -- A row without an auth user is refused later by the row level security check or the NOT NULL constraint, with their own codes: nothing to lock or guard here.
  if new.auth_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    insert into platform.auth_lock (auth_id) select x from unnest(array[old.auth_id, new.auth_id]) x order by x on conflict do nothing;
    perform 1 from platform.auth_lock l where l.auth_id in (new.auth_id, old.auth_id) order by l.auth_id for update;
  else
    insert into platform.auth_lock (auth_id) values (new.auth_id) on conflict do nothing;
    perform 1 from platform.auth_lock l where l.auth_id = new.auth_id for update;
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
  -- A row without an auth user is refused later by the row level security check or the NOT NULL constraint, with their own codes: nothing to lock or guard here.
  if new.auth_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    insert into platform.auth_lock (auth_id) select x from unnest(array[old.auth_id, new.auth_id]) x order by x on conflict do nothing;
    perform 1 from platform.auth_lock l where l.auth_id in (new.auth_id, old.auth_id) order by l.auth_id for update;
  else
    insert into platform.auth_lock (auth_id) values (new.auth_id) on conflict do nothing;
    perform 1 from platform.auth_lock l where l.auth_id = new.auth_id for update;
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
