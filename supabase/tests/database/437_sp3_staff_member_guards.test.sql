-- SP3 step 3 (docs/plans/2026-11-15-sp3-console.md §3.1.4; AT2): platform staff and venue members never mix. A platform_admin may only hold `admin` memberships; a
-- platform_support account holds none. Both directions are guarded, for every role, the migration owner included. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into auth.users (id, email) select ('a2000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'person-' || n || '@example.test' from generate_series(1, 12) n;
-- 01 platform admin, 02 platform support, 03 owner elsewhere, 04 chef elsewhere, 05 other admin, 06 and up spare.
insert into platform.staff (auth_id, role) values ('a2000000-0000-4000-8000-000000000001', 'platform_admin');
insert into platform.staff (auth_id, role) values ('a2000000-0000-4000-8000-000000000002', 'platform_support');

-- 1. The first test: an owner row for the platform admin's auth user is refused ------------------------------------------------------------------------------------
select throws_ok($$ insert into public.app_user (tenant_id, auth_id, role, display_name) values ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000001', 'owner', 'Titolare') $$,
  'P0001', 'platform_staff_member_role', 'an owner row for the platform admin''s auth user is refused with platform_staff_member_role');
select throws_ok($$ insert into public.app_user (tenant_id, auth_id, role, display_name) values ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000001', 'chef', 'Cuoco') $$,
  'P0001', 'platform_staff_member_role', 'a chef row is refused');
select throws_ok($$ insert into public.app_user (tenant_id, auth_id, role, display_name, login_method) values ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000001', 'waiter', 'Cameriere', 'pin') $$,
  'P0001', 'platform_staff_member_role', 'a waiter row is refused');
select is((select count(*)::int from public.app_user where auth_id = 'a2000000-0000-4000-8000-000000000001'), 0, 'and no row was written');

-- 2. An admin row is accepted for the active platform admin ---------------------------------------------------------------------------------------------------------
select lives_ok($$ insert into public.app_user (id, tenant_id, auth_id, role, display_name) values ('b2000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000001', 'admin', 'DigiAlto') $$,
  'an admin row for the active platform admin is accepted');
select throws_ok($$ update public.app_user set role = 'owner' where id = 'b2000000-0000-4000-8000-000000000001' $$, 'P0001', 'platform_staff_member_role',
  'changing that row to owner is refused (the guard fires on a role update)');
select throws_ok($$ update public.app_user set role = 'chef' where id = 'b2000000-0000-4000-8000-000000000001' $$, 'P0001', 'platform_staff_member_role', 'and to chef');
select lives_ok($$ update public.app_user set display_name = 'DigiAlto 2' where id = 'b2000000-0000-4000-8000-000000000001' $$, 'other columns still update');
select lives_ok($$ update public.app_user set is_active = false, deactivated_at = now() where id = 'b2000000-0000-4000-8000-000000000001' $$, 'and so does deactivation');

-- 3. A platform_support account has no membership at all ---------------------------------------------------------------------------------------------------------------
select throws_ok($$ insert into public.app_user (tenant_id, auth_id, role, display_name) values ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000002', 'admin', 'Supporto') $$,
  'P0001', 'platform_staff_member_role', 'an app_user row for a platform_support user is refused, even an admin one');
select throws_ok($$ insert into public.app_user (tenant_id, auth_id, role, display_name) values ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000002', 'owner', 'Supporto') $$,
  'P0001', 'platform_staff_member_role', 'and an owner one');

-- 4. The other direction: the staff row is refused when the person already is a member ------------------------------------------------------------------------
insert into public.app_user (tenant_id, auth_id, role, display_name, is_active, deactivated_at) values
  ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000003', 'owner', 'Titolare Demo', false, now()),
  ('22222222-2222-4222-8222-222222222222', 'a2000000-0000-4000-8000-000000000004', 'chef', 'Cuoco Demo', true, null),
  ('22222222-2222-4222-8222-222222222222', 'a2000000-0000-4000-8000-000000000005', 'admin', 'Admin Demo', true, null);
select lives_ok($$ update platform.staff set is_active = false where role = 'platform_admin' $$, 'the first platform admin steps aside (one active at a time)');
select throws_ok($$ insert into platform.staff (auth_id, role) values ('a2000000-0000-4000-8000-000000000003', 'platform_admin') $$, 'P0001', 'platform_admin_member_role',
  'a platform_admin staff row for an auth user with an inactive owner row is refused');
select throws_ok($$ insert into platform.staff (auth_id, role) values ('a2000000-0000-4000-8000-000000000004', 'platform_admin') $$, 'P0001', 'platform_admin_member_role',
  'and one with an active chef row');
select lives_ok($$ insert into platform.staff (auth_id, role) values ('a2000000-0000-4000-8000-000000000005', 'platform_admin') $$, 'a platform_admin staff row for an auth user whose rows are all admin is accepted');
select throws_ok($$ insert into platform.staff (auth_id, role) values ('a2000000-0000-4000-8000-000000000003', 'platform_support') $$, 'P0001', 'platform_support_has_member_row',
  'a platform_support row for an auth user with an owner row is refused');
select throws_ok($$ insert into platform.staff (auth_id, role) values ('a2000000-0000-4000-8000-000000000005', 'platform_support') $$, 'P0001', 'platform_support_has_member_row',
  'and for one whose only row is an admin row');
select lives_ok($$ insert into platform.staff (auth_id, role) values ('a2000000-0000-4000-8000-000000000006', 'platform_support') $$, 'a platform_support row for a person with no member row is accepted');

-- 5. Changing a staff row re-checks ---------------------------------------------------------------------------------------------------------------------------------
select throws_ok($$ update platform.staff set role = 'platform_support' where auth_id = 'a2000000-0000-4000-8000-000000000005' $$, 'P0001', 'platform_support_has_member_row',
  'changing the admin with admin rows to platform_support re-checks and refuses');
select is((select count(*)::int from platform.staff where auth_id = 'a2000000-0000-4000-8000-000000000004'), 0, 'the refused inserts left no staff row for the chef or the owner');
-- Reactivation of the first admin: its auth user still holds an admin row only, so it passes the member check; the unique index is what refuses it.
select throws_ok($$ update platform.staff set is_active = true where auth_id = 'a2000000-0000-4000-8000-000000000001' $$, '23505', null, 'reactivating the first admin is refused by the one-active-admin index, not by the guard');
insert into public.app_user (tenant_id, auth_id, role, display_name) values ('22222222-2222-4222-8222-222222222222', 'a2000000-0000-4000-8000-000000000007', 'chef', 'Cuoco Due');
select lives_ok($$ insert into platform.staff (auth_id, role, is_active) values ('a2000000-0000-4000-8000-000000000008', 'platform_support', false) $$, 'an inactive support row for a person with no row is accepted');
select throws_ok($$ update platform.staff set auth_id = 'a2000000-0000-4000-8000-000000000007' where auth_id = 'a2000000-0000-4000-8000-000000000008' $$, 'P0001', 'platform_support_has_member_row',
  'moving a staff row to an auth user who is a member re-checks and refuses');

-- 5b. The "active" part of the app_user guard: an admin row is accepted only for an ACTIVE platform_admin ------------------------------------------------------------------
insert into platform.staff (auth_id, role, is_active) values ('a2000000-0000-4000-8000-000000000010', 'platform_admin', false);
select throws_ok($$ insert into public.app_user (tenant_id, auth_id, role, display_name) values ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000010', 'admin', 'DigiAlto inattivo') $$,
  'P0001', 'platform_staff_member_role', 'an admin app_user row for an auth user whose platform_admin staff row is inactive is refused');

-- 6. Neither guard touches a person who is not staff ----------------------------------------------------------------------------------------------------------------------
select lives_ok($$ insert into public.app_user (tenant_id, auth_id, role, display_name) values ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000009', 'owner', 'Titolare Due') $$,
  'an ordinary auth user gets any membership as before');
select lives_ok($$ update public.app_user set role = 'chef' where auth_id = 'a2000000-0000-4000-8000-000000000009' $$, 'and changes its role');

-- 7. The guards are triggers that fire for every role, the owner included, and are closed to the API roles -----------------------------------------------------
select is((select t.tgenabled::text from pg_trigger t where t.tgrelid = 'public.app_user'::regclass and t.tgname = 'app_user_platform_staff_guard'), 'O', 'the trigger on public.app_user is enabled for every role');
select is((select t.tgenabled::text from pg_trigger t where t.tgrelid = 'platform.staff'::regclass and t.tgname = 'staff_member_guard'), 'O', 'and so is the one on platform.staff');
select ok(not has_function_privilege('anon', 'app.app_user_platform_staff_guard()', 'execute') and not has_function_privilege('authenticated', 'app.app_user_platform_staff_guard()', 'execute')
  and not has_function_privilege('service_role', 'app.app_user_platform_staff_guard()', 'execute')
  and not has_function_privilege('anon', 'platform.staff_member_guard()', 'execute') and not has_function_privilege('authenticated', 'platform.staff_member_guard()', 'execute')
  and not has_function_privilege('service_role', 'platform.staff_member_guard()', 'execute'), 'both guard functions are executable by no API role');
select ok((select bool_and(p.prosecdef and 'search_path=""' = any (p.proconfig)) from pg_proc p where p.proname in ('app_user_platform_staff_guard', 'staff_member_guard')), 'both are definers with an empty search_path');
select is((select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and c.relnamespace in ('public'::regnamespace, 'app'::regnamespace)), 129,
  'the public/app trigger count is 129 (365 moves 128 to 129 for this guard, on purpose)');

-- 8. The guards serialise on a platform-owned lock row, not on anything of Supabase's (lead 2026-11-15) ------------------------------------------------------------------
select is((select count(*)::int from pg_proc p where p.proname in ('staff_member_guard', 'app_user_platform_staff_guard') and pg_get_functiondef(p.oid) ~* 'auth\.users'), 0,
  'neither guard function references auth.users: a grant in a schema Supabase owns can tighten without a change here');
select is((select count(*)::int from pg_proc p where p.proname in ('staff_member_guard', 'app_user_platform_staff_guard') and pg_get_functiondef(p.oid) ~* 'platform\.auth_lock'
              and pg_get_functiondef(p.oid) ~* 'for update'), 2, 'both lock a platform.auth_lock row (for update)');
select ok((select c.relrowsecurity from pg_class c where c.oid = 'platform.auth_lock'::regclass)
          and not exists (select 1 from unnest(array['anon', 'authenticated', 'service_role']) r where has_table_privilege(r, 'platform.auth_lock', 'select,insert,update,delete,truncate,references,trigger'))
          and not exists (select 1 from pg_class c, aclexplode(c.relacl) a where c.oid = 'platform.auth_lock'::regclass and a.grantee = 0),
  'platform.auth_lock has row level security on and no privilege for anon, authenticated, service_role or PUBLIC');
select is((select k.confdeltype::text from pg_constraint k where k.conrelid = 'platform.auth_lock'::regclass and k.contype = 'f'), 'c',
  'its foreign key to auth.users cascades: a lock row goes when its auth user goes (no auth purge deletes users, so the cascade is the purge)');

select is((select count(*)::int from pg_proc p where p.proname in ('staff_member_guard', 'app_user_platform_staff_guard')
              and pg_get_functiondef(p.oid) ~* 'insert into platform\.auth_lock \(auth_id\) select x from unnest\(array\[old\.auth_id, new\.auth_id\]\) x order by x on conflict do nothing'), 2,
  'on an auth_id change both guards insert the two lock rows in sorted order too (the unique-index waits then follow one order, so two such updates cannot deadlock)');

select * from finish();
rollback;
