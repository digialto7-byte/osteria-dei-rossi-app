-- SP3 step 5 (docs/plans/2026-11-15-sp3-console.md §3.3.6, §3.9.2; AT8 script half): platform_record_script_run is the one way a state-changing script writes the platform audit.
-- Service role only. It writes origin script and an action that starts with `script.`; the audit's own checks refuse an unknown action and a detail that is not codes and ids.
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

insert into public.tenant (id, name, vat_number) values ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');

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
select lives_ok($$ select public.platform_record_script_run('script.mfa_reset', null, '{"appUserId": "a4000000-0000-4000-8000-000000000001", "sessionsRevoked": 2}') $$, 'script.mfa_reset with ids and a count, no tenant');
select lives_ok($$ select public.platform_record_script_run('script.set_mfa_enforcement', '11111111-1111-4111-8111-111111111111', '{"tenantId": "11111111-1111-4111-8111-111111111111", "mode": "required", "changed": true}') $$, 'script.set_mfa_enforcement with tenant, mode and changed');
select lives_ok($$ select public.platform_record_script_run('script.create_tenant', '11111111-1111-4111-8111-111111111111', null) $$, 'a null detail is written as an empty object');
reset role;
select is((select count(*)::int from platform.audit_event where origin = 'script'), 4, 'four script rows so far');

-- 3. What it refuses, and a refusal writes nothing ---------------------------------------------------------------------------------------------------------------------
set local role service_role;
select throws_ok($$ select public.platform_record_script_run('console.entered', null, '{}') $$, '22023', null, 'an action that does not start with script. is refused with 22023');
select throws_ok($$ select public.platform_record_script_run('platform_admin.bootstrapped', null, '{}') $$, '22023', null, 'even a registered one of another origin');
select throws_ok($$ select public.platform_record_script_run(null, null, '{}') $$, '22023', null, 'a null action');
select throws_ok($$ select public.platform_record_script_run('script.', null, '{}') $$, '23514', null, 'a bare prefix is an unknown action, refused by the audit check');
select throws_ok($$ select public.platform_record_script_run('script.unknown', null, '{}') $$, '23514', null, 'an unknown script action is refused by the audit check');
select throws_ok($$ select public.platform_record_script_run('script.create_tenant', null, '{"outcome": "someone@example.test"}') $$, '23514', null, 'a detail with an address is refused');
select throws_ok($$ select public.platform_record_script_run('script.create_tenant', null, '{"email": "ok"}') $$, '23514', null, 'and one with a key outside the list');
reset role;
select is((select count(*)::int from platform.audit_event where origin = 'script'), 4, 'the refusals wrote no row');

-- 4. Who may call it --------------------------------------------------------------------------------------------------------------------------------------------------
set local role authenticated;
select throws_ok($$ select public.platform_record_script_run('script.create_tenant', null, '{}') $$, '42501', null, 'authenticated gets 42501');
reset role;
set local role anon;
select throws_ok($$ select public.platform_record_script_run('script.create_tenant', null, '{}') $$, '42501', null, 'and so does anon');
reset role;
select is((select count(*)::int from platform.audit_event where origin = 'script'), 4, 'and neither wrote a row');
select ok(has_function_privilege('service_role', 'public.platform_record_script_run(text, uuid, jsonb)', 'execute'), 'the service role can execute it');
select ok(not has_function_privilege('anon', 'public.platform_record_script_run(text, uuid, jsonb)', 'execute') and not has_function_privilege('authenticated', 'public.platform_record_script_run(text, uuid, jsonb)', 'execute'),
  'anon and authenticated cannot');
select ok(not (select p.proacl::text ~ '[{,]=X/' from pg_proc p where p.oid = 'public.platform_record_script_run(text, uuid, jsonb)'::regprocedure), 'PUBLIC cannot');
select ok((select p.prosecdef and p.proconfig = array['search_path=""'] and p.proowner = 'postgres'::regrole from pg_proc p where p.oid = 'public.platform_record_script_run(text, uuid, jsonb)'::regprocedure),
  'it is a definer with an empty search_path, owned by postgres');
select is((select count(*)::int from pg_proc where proname = 'platform_record_script_run'), 1, 'there is exactly one such function');

select * from finish();
rollback;
