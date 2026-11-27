-- SP3 step 5 (docs/plans/2026-11-15-sp3-console.md §3.3.6, §3.9.2; AT8 script half): platform_record_script_run is the one way a state-changing script writes the platform audit.
-- Service role only. It writes origin script and an action that starts with `script.`; the audit's own checks refuse an unknown action and a detail that is not codes and ids.
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

insert into public.tenant (id, name, vat_number) values ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into auth.users (id, email) values ('a4000000-0000-4000-8000-000000000001', 'admin-a@example.test');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('b4000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'a4000000-0000-4000-8000-000000000001', 'admin', 'Admin Demo');

-- 1. The first test -----------------------------------------------------------------------------------------------------------------------------------------------------
set local role service_role;
select is((select public.platform_record_script_run('script.create_tenant', '11111111-1111-4111-8111-111111111111', '{}'::jsonb)) > 0, true,
  'platform_record_script_run(script.create_tenant, <tenant>, {}) as the service role returns the new row id');
reset role;
select is((select count(*)::int from platform.audit_event where action = 'script.create_tenant' and origin = 'script' and tenant_id = '11111111-1111-4111-8111-111111111111'), 1,
  'and wrote one row with origin script, the action and the tenant');
select is((select actor_auth_id from platform.audit_event where action = 'script.create_tenant'), null, 'with no actor (a service-role call has no auth user)');
select is((select detail from platform.audit_event where action = 'script.create_tenant'), '{}'::jsonb, 'and the detail as given');
select is((select id from platform.audit_event where action = 'script.create_tenant'), (select max(id) from platform.audit_event), 'the returned id is the row''s id (checked against the newest row)');

-- 2. The other script actions, a platform-wide row and the detail keys of §3.9.2 ------------------------------------------------------------------------------------
set local role service_role;
select lives_ok($$ select public.platform_record_script_run('script.mfa_reset', null, '{"appUserId": "b4000000-0000-4000-8000-000000000001"}') $$, 'script.mfa_reset with the app_user id and no tenant (the script never passes one)');
select lives_ok($$ select public.platform_record_script_run('script.set_mfa_enforcement', '11111111-1111-4111-8111-111111111111', '{"tenantId": "11111111-1111-4111-8111-111111111111", "mode": "required", "changed": true}') $$, 'script.set_mfa_enforcement with tenant, mode and changed');
reset role;
select is((select count(*)::int from platform.audit_event where origin = 'script'), 3, 'three script rows so far');
select is((select tenant_id from platform.audit_event where action = 'script.mfa_reset'), '11111111-1111-4111-8111-111111111111'::uuid,
  'the script.mfa_reset row carries the tenant resolved from the app_user inside the same write');

-- 3. What it refuses, and a refusal writes nothing ---------------------------------------------------------------------------------------------------------------------
set local role service_role;
select throws_ok($$ select public.platform_record_script_run('console.entered', null, '{}') $$, '22023', null, 'an action that does not start with script. is refused with 22023');
select throws_ok($$ select public.platform_record_script_run('platform_admin.bootstrapped', null, '{}') $$, '22023', null, 'even a registered one of another origin');
select throws_ok($$ select public.platform_record_script_run(null, null, '{}') $$, '22023', null, 'a null action');
select throws_ok($$ select public.platform_record_script_run('script.', null, '{}') $$, '23514', null, 'a bare prefix is an unknown action, refused by the audit check');
select throws_ok($$ select public.platform_record_script_run('script.unknown', null, '{}') $$, '23514', null, 'an unknown script action is refused by the audit check');
select throws_ok($$ select public.platform_record_script_run('script.create_tenant', null, '{"outcome": "someone@example.test"}') $$, '23514', null, 'a detail with an address is refused');
select throws_ok($$ select public.platform_record_script_run('script.create_tenant', null, '{"email": "ok"}') $$, '23514', null, 'and one with a key outside the list');
select throws_ok($$ select public.platform_record_script_run('script.mfa_reset', null, '{"appUserId": "b4000000-0000-4000-8000-0000000000ff"}') $$, 'P0002', 'app_user_not_found',
  'a script.mfa_reset for an app_user that does not exist is refused with app_user_not_found');
select throws_ok($$ select public.platform_record_script_run('script.mfa_reset', null, '{"appUserId": "not-a-uuid"}') $$, 'P0002', 'app_user_not_found', 'and so is an id that is not a uuid');
select throws_ok($$ select public.platform_record_script_run('script.mfa_reset', null, '{"outcome": "ok"}') $$, '22023', 'app_user_required', 'a script.mfa_reset with no appUserId is refused with app_user_required');
select throws_ok($$ select public.platform_record_script_run('script.mfa_reset', '22222222-2222-4222-8222-222222222222', '{"appUserId": "b4000000-0000-4000-8000-000000000001"}') $$, '22023', 'tenant_mismatch',
  'a tenant that disagrees with the app_user''s own is refused with tenant_mismatch: the script cannot choose the tenant');
select throws_ok($$ select public.platform_record_script_run('script.create_tenant', null, null) $$, '23502', null, 'a null detail is refused, as a direct insert refuses it (no silent default)');
reset role;
select is((select count(*)::int from platform.audit_event where origin = 'script'), 3, 'the refusals wrote no row');

-- 4. Who may call it --------------------------------------------------------------------------------------------------------------------------------------------------
set local role authenticated;
select throws_ok($$ select public.platform_record_script_run('script.create_tenant', null, '{}') $$, '42501', null, 'authenticated gets 42501');
reset role;
set local role anon;
select throws_ok($$ select public.platform_record_script_run('script.create_tenant', null, '{}') $$, '42501', null, 'and so does anon');
reset role;
select is((select count(*)::int from platform.audit_event where origin = 'script'), 3, 'and neither wrote a row');
select ok(has_function_privilege('service_role', 'public.platform_record_script_run(text, uuid, jsonb)', 'execute'), 'the service role can execute it');
select ok(not has_function_privilege('anon', 'public.platform_record_script_run(text, uuid, jsonb)', 'execute') and not has_function_privilege('authenticated', 'public.platform_record_script_run(text, uuid, jsonb)', 'execute'),
  'anon and authenticated cannot');
select ok(not (select p.proacl::text ~ '[{,]=X/' from pg_proc p where p.oid = 'public.platform_record_script_run(text, uuid, jsonb)'::regprocedure), 'PUBLIC cannot');
select ok((select p.prosecdef and p.proconfig = array['search_path=""'] and p.proowner = 'postgres'::regrole from pg_proc p where p.oid = 'public.platform_record_script_run(text, uuid, jsonb)'::regprocedure),
  'it is a definer with an empty search_path, owned by postgres');
select is((select count(*)::int from pg_proc where proname = 'platform_record_script_run'), 1, 'there is exactly one such function');

set local role service_role;
select lives_ok($$ select public.platform_record_script_run('script.mfa_reset', '11111111-1111-4111-8111-111111111111', '{"appUserId": "b4000000-0000-4000-8000-000000000001"}') $$, 'a tenant that agrees with the app_user''s is accepted');
reset role;
select is((select count(*)::int from platform.audit_event where action = 'script.mfa_reset' and tenant_id = '11111111-1111-4111-8111-111111111111'), 2, 'and the row carries it');

set local role service_role;
-- scripts/add-owner.ts (SP3 PR 1, lead 2026-11-27): the exact detail it sends is accepted.
select lives_ok($$ select public.platform_record_script_run('script.add_owner', '11111111-1111-4111-8111-111111111111',
  '{"tenantId": "11111111-1111-4111-8111-111111111111", "appUserId": "b7000000-0000-4000-8000-000000000001", "authId": "a7000000-0000-4000-8000-000000000001", "outcome": "reused"}') $$,
  'a script.add_owner row with the script''s detail (tenantId, appUserId, authId, outcome) is written');
reset role;
select is((select tenant_id from platform.audit_event where action = 'script.add_owner'), '11111111-1111-4111-8111-111111111111'::uuid, 'with the tenant it names');

select * from finish();
rollback;
