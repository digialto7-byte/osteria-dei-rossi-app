-- SP3 step 4 (docs/plans/2026-11-15-sp3-console.md §3.3.6; AT11 as amended by Q-P5): platform_bootstrap_admin creates the one platform admin staff row and its audit row.
-- It does NOT check for a verified factor (that check moved to require_console and select_console, steps 10 and 13); it reports hasVerifiedFactor. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into auth.users (id, email) select ('a3000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'person-' || n || '@example.test' from generate_series(1, 8) n;
-- 01 no factor and no membership, 02 verified factor, 03 only admin rows (two venues are not possible yet: one auth user, one row), 04 chef, 05 spare, 06 unverified factor.
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at) values
  ('f3000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000002', 'Principale', 'totp', 'verified', now(), now()),
  ('f3000000-0000-4000-8000-000000000006', 'a3000000-0000-4000-8000-000000000006', 'Principale', 'totp', 'unverified', now(), now());
insert into public.app_user (tenant_id, auth_id, role, display_name) values
  ('11111111-1111-4111-8111-111111111111', 'a3000000-0000-4000-8000-000000000003', 'admin', 'Admin Demo'),
  ('11111111-1111-4111-8111-111111111111', 'a3000000-0000-4000-8000-000000000004', 'chef', 'Cuoco Demo');

set local role service_role;

-- 1. The first test: no factor, no membership -----------------------------------------------------------------------------------------------------------------------
select is(public.platform_bootstrap_admin('a3000000-0000-4000-8000-000000000001'), '{"authId": "a3000000-0000-4000-8000-000000000001", "hasVerifiedFactor": false}'::jsonb,
  'an auth user with no factor and no membership is bootstrapped, and the reply says hasVerifiedFactor false');
reset role;
select is((select count(*)::int from platform.staff where role = 'platform_admin' and is_active and auth_id = 'a3000000-0000-4000-8000-000000000001'), 1, 'one active staff row');
select is((select display_name from platform.staff where auth_id = 'a3000000-0000-4000-8000-000000000001'), 'DigiAlto', 'with the display name DigiAlto');
select is((select count(*)::int from platform.audit_event where action = 'platform_admin.bootstrapped'), 1, 'and one platform_admin.bootstrapped row');
select is((select origin || ' ' || detail::text from platform.audit_event where action = 'platform_admin.bootstrapped'), 'script {"authId": "a3000000-0000-4000-8000-000000000001"}', 'with origin script and the auth id only');
select is((select actor_auth_id from platform.audit_event where action = 'platform_admin.bootstrapped'), null, 'and no actor (a service-role call has no auth user)');
select is((select tenant_id from platform.audit_event where action = 'platform_admin.bootstrapped'), null, 'and no tenant');

-- 2. A second platform admin is refused, and a refusal writes nothing ------------------------------------------------------------------------------------------------
set local role service_role;
select throws_ok($$ select public.platform_bootstrap_admin('a3000000-0000-4000-8000-000000000002') $$, 'P0001', 'platform_admin_exists', 'a second active platform admin is refused');
select throws_ok($$ select public.platform_bootstrap_admin('a3000000-0000-4000-8000-000000000001') $$, 'P0001', 'platform_admin_exists', 'and so is the same one again');
reset role;
select is((select count(*)::int from platform.staff), 1, 'the refusals wrote no staff row');
select is((select count(*)::int from platform.audit_event where action = 'platform_admin.bootstrapped'), 1, 'and no audit row');

-- 3. With the first admin set aside (the index allows one active admin), the other refusals and acceptances ---------------------------------------------------------
update platform.staff set is_active = false;
set local role service_role;
select is(public.platform_bootstrap_admin('a3000000-0000-4000-8000-000000000002'), '{"authId": "a3000000-0000-4000-8000-000000000002", "hasVerifiedFactor": true}'::jsonb,
  'an auth user with a verified factor is bootstrapped and the reply says hasVerifiedFactor true');
reset role;
update platform.staff set is_active = false;
set local role service_role;
select is(public.platform_bootstrap_admin('a3000000-0000-4000-8000-000000000003'), '{"authId": "a3000000-0000-4000-8000-000000000003", "hasVerifiedFactor": false}'::jsonb,
  'one whose only row is an admin row is accepted');
reset role;
update platform.staff set is_active = false;
set local role service_role;
select throws_ok($$ select public.platform_bootstrap_admin('a3000000-0000-4000-8000-000000000004') $$, 'P0001', 'platform_admin_has_member_role', 'one with a chef row is refused');
select throws_ok($$ select public.platform_bootstrap_admin(gen_random_uuid()) $$, 'P0002', 'auth_user_not_found', 'an unknown auth id is refused');
select throws_ok($$ select public.platform_bootstrap_admin(null) $$, 'P0002', 'auth_user_not_found', 'and so is null');
select is(public.platform_bootstrap_admin('a3000000-0000-4000-8000-000000000006'), '{"authId": "a3000000-0000-4000-8000-000000000006", "hasVerifiedFactor": false}'::jsonb,
  'an unverified factor does not count: hasVerifiedFactor false');
reset role;
select is((select count(*)::int from platform.staff), 4, 'four staff rows after four acceptances, none after the refusals');
select is((select count(*)::int from platform.audit_event where action = 'platform_admin.bootstrapped'), 4, 'four audit rows, one per acceptance');
select is((select count(*)::int from platform.staff where auth_id = 'a3000000-0000-4000-8000-000000000004'), 0, 'the chef got no staff row');
select is((select count(*)::int from platform.audit_event where detail->>'authId' in ('a3000000-0000-4000-8000-000000000004')), 0, 'and no audit row');

-- 3b. An auth user that already has a staff row of any other kind is refused with a named code, not a raw key violation ----------------------------------------------------
insert into platform.staff (auth_id, role) values ('a3000000-0000-4000-8000-000000000007', 'platform_support');
insert into platform.staff (auth_id, role, is_active) values ('a3000000-0000-4000-8000-000000000008', 'platform_admin', false);
update platform.staff set is_active = false where role = 'platform_admin' and is_active;
select is((select count(*)::int from platform.staff where is_active and role = 'platform_admin'), 0, 'self-check: no active platform admin, so only the staff-row check can refuse the next two');
select is((select count(*)::int from platform.staff), 6, 'self-check: six staff rows before the refusals');
select is((select count(*)::int from platform.audit_event where action = 'platform_admin.bootstrapped'), 4, 'self-check: four audit rows before the refusals');
set local role service_role;
select throws_ok($$ select public.platform_bootstrap_admin('a3000000-0000-4000-8000-000000000007') $$, 'P0001', 'platform_staff_exists', 'an auth user with a platform_support staff row is refused with platform_staff_exists');
select throws_ok($$ select public.platform_bootstrap_admin('a3000000-0000-4000-8000-000000000008') $$, 'P0001', 'platform_staff_exists', 'and one with an inactive platform_admin row');
reset role;
select is((select count(*)::int from platform.staff) || ',' || (select count(*)::int from platform.audit_event where action = 'platform_admin.bootstrapped'), '6,4', 'the refusals wrote no staff row and no audit row');

-- 4. A refused bootstrap changes nothing, even though the chef row exists ----------------------------------------------------------------------------------------------
select is((select count(*)::int from public.app_user where auth_id = 'a3000000-0000-4000-8000-000000000004'), 1, 'the chef''s membership is untouched');

-- 5. Who may call it -------------------------------------------------------------------------------------------------------------------------------------------------
select ok(has_function_privilege('service_role', 'public.platform_bootstrap_admin(uuid)', 'execute'), 'the service role can execute it');
select ok(not has_function_privilege('anon', 'public.platform_bootstrap_admin(uuid)', 'execute'), 'anon cannot');
select ok(not has_function_privilege('authenticated', 'public.platform_bootstrap_admin(uuid)', 'execute'), 'authenticated cannot');
select ok(not (select p.proacl::text ~ '[{,]=X/' from pg_proc p where p.oid = 'public.platform_bootstrap_admin(uuid)'::regprocedure), 'PUBLIC cannot');
select ok((select p.prosecdef and p.proconfig = array['search_path=""'] and p.proowner = 'postgres'::regrole from pg_proc p where p.oid = 'public.platform_bootstrap_admin(uuid)'::regprocedure),
  'it is a definer with an empty search_path, owned by postgres');
set local role authenticated;
select throws_ok($$ select public.platform_bootstrap_admin('a3000000-0000-4000-8000-000000000005') $$, '42501', null, 'authenticated gets 42501');
reset role;
set local role anon;
select throws_ok($$ select public.platform_bootstrap_admin('a3000000-0000-4000-8000-000000000005') $$, '42501', null, 'and so does anon');
reset role;
select is((select count(*)::int from platform.staff), 6, 'and neither wrote anything');
select is((select count(*)::int from pg_proc where proname = 'platform_bootstrap_admin'), 1, 'there is exactly one such function');

select * from finish();
rollback;
