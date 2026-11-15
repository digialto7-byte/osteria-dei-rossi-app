-- SP3 step 2 (docs/plans/2026-11-15-sp3-console.md §3.1.2, §3.1.3, §3.1.8; AT2 last clause, AT7): platform.staff, the append-only platform.audit_event and the named
-- catalogue of the platform schema. Each later SP3 table adds itself to the named list below. Fake data only (no address appears in an audit row).
begin;
create extension if not exists pgtap with schema extensions;
select plan(67);

insert into auth.users (id, email) values
  ('a1000000-0000-4000-8000-000000000001', 'admin-one@example.test'),
  ('a1000000-0000-4000-8000-000000000002', 'admin-two@example.test'),
  ('a1000000-0000-4000-8000-000000000003', 'support-one@example.test');
insert into public.tenant (id, name, vat_number) values ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into platform.audit_event (origin, action, tenant_id, detail)
  values ('script', 'script.create_tenant', '11111111-1111-4111-8111-111111111111', '{"tenantId": "11111111-1111-4111-8111-111111111111"}');

-- 1. AT7: the audit is append-only for every role, the migration owner included -----------------------------------------------------------------------------------
select throws_ok($$ update platform.audit_event set action = 'console.left' $$, 'P0001', 'platform_audit_append_only',
  'an UPDATE of a platform.audit_event row raises platform_audit_append_only for the migration owner');
select throws_ok($$ delete from platform.audit_event $$, 'P0001', 'platform_audit_append_only', 'a DELETE raises it as well');
select throws_ok($$ truncate platform.audit_event $$, 'P0001', 'platform_audit_append_only', 'and a TRUNCATE');
select is((select count(*)::int from platform.audit_event), 1, 'the row is still there after the three refusals');
select is((select action from platform.audit_event), 'script.create_tenant', 'and unchanged');

-- 2. The detail check: flat, whitelisted keys, ids, integers, booleans, null and codes; never an address -------------------------------------------------------
select lives_ok($$ insert into platform.audit_event (origin, action, detail) values ('console', 'console.entered', '{}') $$, 'an empty detail is accepted');
select lives_ok($$ insert into platform.audit_event (origin, action, detail) values ('script', 'script.mfa_reset',
    '{"tenantId": "11111111-1111-4111-8111-111111111111", "appUserId": "a1000000-0000-4000-8000-000000000001", "sessionsRevoked": 3, "changed": true, "outcome": "ok", "slot": null}') $$,
  'ids, integers, booleans, codes and null are accepted');
select lives_ok($$ insert into platform.audit_event (origin, action, detail) values ('console', 'platform_admin.factor_enrolled', '{"authId": "a1000000-0000-4000-8000-000000000001", "factorId": "f1000000-0000-4000-8000-000000000001", "slot": "principale"}') $$, 'the factorId key (step 9) is accepted like the other ids');
select throws_ok($$ insert into platform.audit_event (origin, action, detail) values ('script', 'script.mfa_reset', '{"outcome": "someone@example.test"}') $$, '23514', null,
  'a value with an @ is refused');
select throws_ok($$ insert into platform.audit_event (origin, action, detail) values ('script', 'script.mfa_reset', '{"outcome": "x@y"}') $$, '23514', null, 'even a short one');
select throws_ok($$ insert into platform.audit_event (origin, action, detail) values ('script', 'script.mfa_reset', '{"email": "ok"}') $$, '23514', null, 'a key outside the list is refused');
select throws_ok($$ insert into platform.audit_event (origin, action, detail) values ('script', 'script.mfa_reset', '{"outcome": {"a": "b"}}') $$, '23514', null, 'a nested object is refused');
select throws_ok($$ insert into platform.audit_event (origin, action, detail) values ('script', 'script.mfa_reset', '{"outcome": ["a"]}') $$, '23514', null, 'an array value is refused');
select throws_ok($$ insert into platform.audit_event (origin, action, detail) values ('script', 'script.mfa_reset', '["a"]') $$, '23514', null, 'a detail that is not an object is refused');
select throws_ok($$ insert into platform.audit_event (origin, action, detail) values ('script', 'script.mfa_reset', '{"outcome": "Has Spaces"}') $$, '23514', null, 'a string that is not a code is refused');
select throws_ok($$ insert into platform.audit_event (origin, action, detail) values ('script', 'script.mfa_reset', '{"outcome": ""}') $$, '23514', null, 'an empty string is refused');
select throws_ok($$ insert into platform.audit_event (origin, action, detail) values ('script', 'script.mfa_reset', format('{"outcome": "%s"}', repeat('a', 65))::jsonb) $$, '23514', null, 'a code over 64 characters is refused');
select throws_ok($$ insert into platform.audit_event (origin, action, detail) values ('script', 'script.mfa_reset', '{"sessionsRevoked": 1.5}') $$, '23514', null, 'a non-integer number is refused');
select throws_ok($$ insert into platform.audit_event (origin, action, detail) values ('script', 'script.mfa_reset', null) $$, '23502', null, 'a null detail is refused (not null)');

-- 3. Action and origin ------------------------------------------------------------------------------------------------------------------------------------------------
select throws_ok($$ insert into platform.audit_event (origin, action) values ('script', 'script.unknown') $$, '23514', null, 'an unknown action is refused');
select throws_ok($$ insert into platform.audit_event (origin, action) values ('migration', 'console.entered') $$, '23514', null, 'the origin migration is refused');
select lives_ok($$ insert into platform.audit_event (origin, action) values ('console', 'console.left') $$, 'a known action and origin are accepted');
select is((select count(*)::int from platform.audit_event where tenant_id = '11111111-1111-4111-8111-111111111111'), 1, 'a row can carry a tenant id');
select lives_ok($$ insert into platform.audit_event (origin, action, tenant_id) values ('console', 'console.left', gen_random_uuid()) $$,
  'and a tenant id with no tenant behind it: there is no foreign key, so an erased tenant''s rows survive');
select is((select array_length(platform.audit_actions(), 1)), 10, 'platform.audit_actions() has ten codes');
select is((select count(distinct a)::int from unnest(platform.audit_actions()) a), 10, 'all different');
select is(platform.notice_kinds(), array['subprocessor']::text[], 'platform.notice_kinds() is the one kind');

-- 4. The writer ---------------------------------------------------------------------------------------------------------------------------------------------------------
select lives_ok($$ select platform.audit_write('script', 'script.set_mfa_enforcement', '11111111-1111-4111-8111-111111111111', '{"mode": "required"}') $$, 'platform.audit_write writes a row');
select is((select count(*)::int from platform.audit_event where action = 'script.set_mfa_enforcement' and detail = '{"mode": "required"}'), 1, 'exactly one, with the detail as given');
select throws_ok($$ select platform.audit_write('script', 'script.set_mfa_enforcement', null, '{"mode": "a@b"}') $$, '23514', null, 'the writer is held to the same detail check');
select throws_ok($$ select platform.audit_write('script', 'script.set_mfa_enforcement', null, null) $$, '23502', null, 'a null detail is refused by the writer as it is by a direct insert (no silent default)');

-- 5. platform.staff -----------------------------------------------------------------------------------------------------------------------------------------------------
select lives_ok($$ insert into platform.staff (auth_id, role) values ('a1000000-0000-4000-8000-000000000001', 'platform_admin') $$, 'an active platform_admin is accepted');
select is((select display_name from platform.staff), 'DigiAlto', 'its display name defaults to DigiAlto');
select is((select is_active from platform.staff), true, 'and it is active by default');
select throws_ok($$ insert into platform.staff (auth_id, role) values ('a1000000-0000-4000-8000-000000000002', 'platform_admin') $$, '23505', null, 'a second active platform_admin is refused (AT2, last clause)');
select lives_ok($$ insert into platform.staff (auth_id, role, is_active) values ('a1000000-0000-4000-8000-000000000002', 'platform_admin', false) $$, 'an inactive one is accepted');
select lives_ok($$ insert into platform.staff (auth_id, role) values ('a1000000-0000-4000-8000-000000000003', 'platform_support') $$, 'a platform_support row is accepted next to the admin');
select throws_ok($$ insert into platform.staff (auth_id, role) values (gen_random_uuid(), 'platform_support') $$, '23503', null, 'a staff row needs an auth user');
select throws_ok($$ insert into platform.staff (auth_id, role) values ('a1000000-0000-4000-8000-000000000001', 'platform_support') $$, '23505', null, 'one row per auth user');
select throws_ok($$ update platform.staff set role = 'owner' $$, '23514', null, 'a role outside the two is refused');
select throws_ok($$ update platform.staff set display_name = '' where role = 'platform_admin' and is_active $$, '23514', null, 'an empty display name is refused');
select throws_ok($$ update platform.staff set display_name = repeat('x', 61) where role = 'platform_admin' and is_active $$, '23514', null, 'and one over 60 characters');
select throws_ok($$ update platform.staff set is_active = true where auth_id = 'a1000000-0000-4000-8000-000000000002' $$, '23505', null, 'reactivating a second platform_admin is refused');
select lives_ok($$ update platform.staff set is_active = false where role = 'platform_admin' and is_active $$, 'deactivating the first frees the slot');
select lives_ok($$ update platform.staff set is_active = true where auth_id = 'a1000000-0000-4000-8000-000000000002' $$, 'and the other one can take it');

-- 6. The named catalogue of the platform schema (§3.1.8) -------------------------------------------------------------------------------------------------------
select is((select array_agg(c.relname::text order by c.relname) from pg_class c where c.relnamespace = 'platform'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')),
  array['audit_event', 'mfa_failure', 'organisation', 'staff'], 'the platform tables are exactly organisation, staff, audit_event and (step 9) mfa_failure');
select is((select count(*)::int from pg_class c where c.relnamespace = 'platform'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity), 0, 'every one has row level security on');
select is((select count(*)::int from pg_class c, unnest(array['anon', 'authenticated', 'service_role']) r
            where c.relnamespace = 'platform'::regnamespace and c.relkind in ('r', 'p', 'S')
              and has_table_privilege(r, c.oid, 'select,insert,update,delete,truncate,references,trigger')), 0,
  'no table in platform has a privilege for anon, authenticated or service_role');
select is((select count(*)::int from pg_class c, unnest(array['anon', 'authenticated', 'service_role']) r
            where c.relnamespace = 'platform'::regnamespace and c.relkind = 'S' and has_sequence_privilege(r, c.oid, 'usage,select,update')), 0, 'nor on a sequence (the audit id)');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r where has_schema_privilege(r, 'platform', 'usage')), 0, 'no API role has usage on the platform schema');
select is((select count(*)::int from pg_proc p, unnest(array['anon', 'authenticated', 'service_role']) r
            where p.pronamespace = 'platform'::regnamespace and has_function_privilege(r, p.oid, 'execute')), 0, 'no API role can execute any function in the platform schema');
select is((select count(*)::int from pg_policy where polrelid in ('platform.staff'::regclass, 'platform.audit_event'::regclass)), 0, 'neither table has a policy yet (the hook policy joins at step 14)');

-- 6b. Every function of step 2 is pinned: existence, definer where intended, an empty search_path, closed to the API roles ------------------------------------------------
select is((select count(*)::int from pg_proc p where p.pronamespace = 'platform'::regnamespace
            and p.proname in ('audit_actions', 'notice_kinds', 'audit_detail_keys', 'audit_detail_ok', 'audit_event_append_only', 'audit_write')), 6, 'the six step-2 functions exist once each');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'platform'::regnamespace
            and p.proname in ('audit_actions', 'notice_kinds', 'audit_detail_keys', 'audit_detail_ok', 'audit_event_append_only', 'audit_write')
            and p.proconfig = array['search_path=""']), 6, 'each has search_path = ""');
select is((select string_agg(p.proname::text, ',' order by p.proname) from pg_proc p where p.pronamespace = 'platform'::regnamespace and p.prosecdef
            and p.proname in ('audit_actions', 'notice_kinds', 'audit_detail_keys', 'audit_detail_ok', 'audit_event_append_only', 'audit_write')),
          'audit_event_append_only,audit_write', 'exactly the trigger function and the writer are security definers (the four pure helpers are immutable and not)');
select is((select string_agg(p.proname::text, ',' order by p.proname) from pg_proc p where p.pronamespace = 'platform'::regnamespace and p.provolatile = 'i'),
          'audit_actions,audit_detail_keys,audit_detail_ok,notice_kinds', 'the four helpers are immutable (a CHECK may call them)');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'platform'::regnamespace and p.proacl::text ~ '[{,]=X/'), 0, 'no platform function is executable by PUBLIC');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'platform'::regnamespace and p.proowner <> 'postgres'::regrole), 0, 'all are owned by postgres');
select is((select count(*)::int from pg_class c where c.relnamespace = 'platform'::regnamespace and c.relkind = 'S'
            and c.relacl::text ~ '[{,]=[a-zA-Z]'), 0, 'the audit id sequence is not granted to PUBLIC');
select is((select count(*)::int from pg_class c where c.oid = 'platform.audit_event_id_seq'::regclass and c.relacl is not null and c.relacl::text ~ 'anon|authenticated|service_role'), 0,
  'nor to an API role, by an explicit revoke');
select is((select string_agg(t.tgname::text, ',' order by t.tgname) from pg_trigger t where t.tgrelid = 'platform.audit_event'::regclass and not t.tgisinternal),
          'platform_audit_event_no_truncate,platform_audit_event_no_update_delete', 'the audit triggers carry the platform_ prefix (no name shared with public.audit_event)');

-- 7. As the API roles --------------------------------------------------------------------------------------------------------------------------------------------------
set local role service_role;
select throws_ok($$ select * from platform.audit_event $$, '42501', null, 'service_role cannot read the audit');
select throws_ok($$ insert into platform.audit_event (origin, action) values ('script', 'script.create_tenant') $$, '42501', null, 'nor write it');
select throws_ok($$ select * from platform.staff $$, '42501', null, 'nor read the staff');
select throws_ok($$ select platform.audit_write('script', 'script.create_tenant', null, '{}') $$, '42501', null, 'nor call the writer');
reset role;
set local role authenticated;
select throws_ok($$ select * from platform.audit_event $$, '42501', null, 'authenticated cannot read the audit');
select throws_ok($$ update platform.staff set is_active = false $$, '42501', null, 'nor change a staff row');
reset role;

select * from finish();
rollback;
