-- SP3 step 13 (docs/plans/2026-11-15-sp3-console.md §3.1.5, §3.3.2; AT3, AT12): the console mode switches. select_console() stores the session's console row (and drops
-- its venue selection) only for the active platform admin with a verified factor at aal2; platform_leave_console() deletes it; select_tenant(uuid) deletes it too, so a
-- session is in one mode at a time. platform.console_session is read only by the hook (step 14). Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(41);

insert into auth.users (id, email) values
  ('a8000000-0000-4000-8000-000000000001', 'platform-admin@example.test'),
  ('a8000000-0000-4000-8000-000000000002', 'support@example.test'),
  ('a8000000-0000-4000-8000-000000000003', 'old-admin@example.test'),
  ('a8000000-0000-4000-8000-000000000004', 'owner-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT00000000001');
insert into platform.staff (auth_id, role) values ('a8000000-0000-4000-8000-000000000001', 'platform_admin'), ('a8000000-0000-4000-8000-000000000002', 'platform_support');
insert into platform.staff (auth_id, role, is_active) values ('a8000000-0000-4000-8000-000000000003', 'platform_admin', false);
insert into public.app_user (tenant_id, auth_id, role, display_name) values
  ('11111111-1111-4111-8111-111111111111', 'a8000000-0000-4000-8000-000000000001', 'admin', 'DigiAlto'),
  ('22222222-2222-4222-8222-222222222222', 'a8000000-0000-4000-8000-000000000001', 'admin', 'DigiAlto'),
  ('11111111-1111-4111-8111-111111111111', 'a8000000-0000-4000-8000-000000000004', 'owner', 'Titolare A');

-- A token: subject, role claim, assurance level and session id (null: no session_id claim).
create function pg_temp.token(p_auth uuid, p_role text, p_aal text, p_session text) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_strip_nulls(jsonb_build_object('sub', p_auth, 'role', p_role, 'aal', p_aal, 'session_id', p_session))::text, true)
$$;
-- The outcome of a statement: 'ok' or '<sqlstate> <message>'.
create function pg_temp.out(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;
create function pg_temp.factor(p_auth uuid, p_status text) returns void language plpgsql as $$
begin
  delete from auth.mfa_factors where user_id = p_auth;
  insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
    values (gen_random_uuid(), p_auth, 'Principale', 'totp', p_status::auth.factor_status, now(), now(), 'fake-secret-value');
end $$;
create function pg_temp.rows(p_action text) returns integer language sql as $$
  select count(*)::int from platform.audit_event where action = p_action
$$;
grant execute on function pg_temp.out(text), pg_temp.token(uuid, text, text, text) to public;

-- 1. select_console: the first test of step 13 -----------------------------------------------------------------------------------------------------------------------------
select pg_temp.factor('a8000000-0000-4000-8000-000000000001', 'verified');
insert into app.session_tenant (session_id, auth_id, tenant_id) values ('c8000000-0000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111');
select pg_temp.token('a8000000-0000-4000-8000-000000000001', 'authenticated', 'aal2', 'c8000000-0000-4000-8000-000000000001');
select is(public.select_console(), '{"changed": true}'::jsonb, 'select_console() by the platform admin with a verified factor at aal2 answers changed: true');
select is((select auth_id::text from platform.console_session where session_id = 'c8000000-0000-4000-8000-000000000001'), 'a8000000-0000-4000-8000-000000000001',
  'it writes the session''s console row for the caller');
select is((select count(*)::int from app.session_tenant where session_id = 'c8000000-0000-4000-8000-000000000001'), 0, 'and deletes the session''s venue selection');
select is((select count(*)::int from platform.audit_event where action = 'console.entered' and actor_auth_id = 'a8000000-0000-4000-8000-000000000001'
             and origin = 'console' and tenant_id is null and detail = '{}'::jsonb), 1, 'one console.entered row: the caller, origin console, no tenant, no detail');
select is(public.select_console(), '{"changed": false}'::jsonb, 'a second call answers changed: false');
select is(pg_temp.rows('console.entered'), 1, 'and writes no second audit row');
select is((select count(*)::int from platform.console_session), 1, 'still one console row');

-- 2. Refusals, each writing nothing (AT3) --------------------------------------------------------------------------------------------------------------------------------
select pg_temp.token('a8000000-0000-4000-8000-000000000001', 'authenticated', 'aal1', 'c8000000-0000-4000-8000-000000000002');
select is(pg_temp.out($$select public.select_console()$$), 'P0001 mfa_required', 'the platform admin at aal1: mfa_required (AT3)');
select pg_temp.factor('a8000000-0000-4000-8000-000000000001', 'unverified');
select pg_temp.token('a8000000-0000-4000-8000-000000000001', 'authenticated', 'aal2', 'c8000000-0000-4000-8000-000000000002');
select is(pg_temp.out($$select public.select_console()$$), 'P0001 mfa_factor_required', 'without a verified factor: mfa_factor_required (the check moved from step 4)');
select pg_temp.factor('a8000000-0000-4000-8000-000000000001', 'verified');
select pg_temp.token('a8000000-0000-4000-8000-000000000004', 'authenticated', 'aal2', 'c8000000-0000-4000-8000-000000000002');
select is(pg_temp.out($$select public.select_console()$$), '42501 not_platform_staff', 'an owner: 42501 not_platform_staff');
select pg_temp.factor('a8000000-0000-4000-8000-000000000002', 'verified');
select pg_temp.token('a8000000-0000-4000-8000-000000000002', 'authenticated', 'aal2', 'c8000000-0000-4000-8000-000000000002');
select is(pg_temp.out($$select public.select_console()$$), '42501 not_platform_staff', 'a platform_support row: 42501 (only the platform admin has a console in SP3)');
select pg_temp.factor('a8000000-0000-4000-8000-000000000003', 'verified');
select pg_temp.token('a8000000-0000-4000-8000-000000000003', 'authenticated', 'aal2', 'c8000000-0000-4000-8000-000000000002');
select is(pg_temp.out($$select public.select_console()$$), '42501 not_platform_staff', 'an inactive platform_admin row: 42501');
select pg_temp.token('a8000000-0000-4000-8000-000000000001', 'authenticated', 'aal2', null);
select is(pg_temp.out($$select public.select_console()$$), 'P0001 session_missing', 'a token without session_id: session_missing');
select pg_temp.token('a8000000-0000-4000-8000-000000000001', 'authenticated', 'aal2', 'not-a-uuid');
select is(pg_temp.out($$select public.select_console()$$), 'P0001 session_missing', 'a malformed session_id: session_missing');
select set_config('request.jwt.claims', '', true);
select is(pg_temp.out($$select public.select_console()$$), '42501 not_platform_staff', 'no claims at all: 42501');
select is((select count(*)::int from platform.console_session), 1, 'none of the refusals wrote a console row');
select is(pg_temp.rows('console.entered'), 1, 'nor an audit row');

-- 3. platform_leave_console -------------------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.token('a8000000-0000-4000-8000-000000000001', 'authenticated', 'aal2', 'c8000000-0000-4000-8000-000000000001');
select is(pg_temp.out($$select public.platform_leave_console()$$), '42501 console_required', 'leaving needs a console token: an authenticated one is 42501 console_required');
select pg_temp.token('a8000000-0000-4000-8000-000000000004', 'platform_staff', 'aal2', 'c8000000-0000-4000-8000-000000000001');
select is(pg_temp.out($$select public.platform_leave_console()$$), 'ok', 'a console token of another account runs');
select is((select count(*)::int from platform.console_session), 1, 'but never deletes a row that is not its own');
select pg_temp.token('a8000000-0000-4000-8000-000000000001', 'platform_staff', 'aal2', null);
select is(pg_temp.out($$select public.platform_leave_console()$$), 'P0001 session_missing', 'a console token without session_id: session_missing');
select pg_temp.token('a8000000-0000-4000-8000-000000000001', 'platform_staff', 'aal2', 'c8000000-0000-4000-8000-000000000001');
select is(public.platform_leave_console(), '{"changed": true}'::jsonb, 'the console session leaves: changed: true');
select is((select count(*)::int from platform.console_session), 0, 'its console row is deleted');
select is((select count(*)::int from platform.audit_event where action = 'console.left' and actor_auth_id = 'a8000000-0000-4000-8000-000000000001'
             and origin = 'console' and tenant_id is null), 1, 'one console.left row');
select is(public.platform_leave_console(), '{"changed": false}'::jsonb, 'leaving again: changed: false');
select is(pg_temp.rows('console.left'), 1, 'and no second console.left row');

-- 4. select_tenant deletes the console row (one mode per session) ------------------------------------------------------------------------------------------------------
select pg_temp.token('a8000000-0000-4000-8000-000000000001', 'authenticated', 'aal2', 'c8000000-0000-4000-8000-000000000003');
select is(public.select_console(), '{"changed": true}'::jsonb, 'a second session enters the console');
insert into platform.console_session (session_id, auth_id) values ('c8000000-0000-4000-8000-000000000004', 'a8000000-0000-4000-8000-000000000001');
select is(public.select_tenant('11111111-1111-4111-8111-111111111111'), '{"tenantId": "11111111-1111-4111-8111-111111111111", "changed": true}'::jsonb,
  'select_tenant(A) in that session still answers as SP2''s');
select is((select array_agg(session_id::text) from platform.console_session), array['c8000000-0000-4000-8000-000000000004'],
  'it deleted that session''s console row, and only that one');
select is((select tenant_id::text from app.session_tenant where session_id = 'c8000000-0000-4000-8000-000000000003'), '11111111-1111-4111-8111-111111111111',
  'and stored the venue selection');
select pg_temp.token('a8000000-0000-4000-8000-000000000001', 'authenticated', 'aal2', 'c8000000-0000-4000-8000-000000000004');
select is(pg_temp.out($$select public.select_tenant('33333333-3333-4333-8333-333333333333')$$), '42501 not_a_member', 'a refused select_tenant');
select is((select count(*)::int from platform.console_session where session_id = 'c8000000-0000-4000-8000-000000000004'), 1, 'keeps the console row (the whole call is rolled back)');

-- 5. Table, functions and grants ---------------------------------------------------------------------------------------------------------------------------------------------
select is((select relrowsecurity from pg_class where oid = 'platform.console_session'::regclass), true, 'platform.console_session has row level security on');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role', 'platform_staff']) r
            where has_table_privilege(r, 'platform.console_session', 'select,insert,update,delete,truncate,references,trigger')), 0, 'no API role has a privilege on it');
select ok(has_table_privilege('supabase_auth_admin', 'platform.console_session', 'select')
          and not has_table_privilege('supabase_auth_admin', 'platform.console_session', 'insert,update,delete,truncate'), 'supabase_auth_admin may only select it (the hook)');
select is((select string_agg(polname::text || ':' || polcmd::text || ':' || array_to_string(polroles::regrole[]::text[], ','), ' ') from pg_policy where polrelid = 'platform.console_session'::regclass),
  'console_session_read_by_auth_hook:r:supabase_auth_admin', 'its one policy is the hook''s select policy');
select is((select confrelid::regclass::text from pg_constraint where conrelid = 'platform.console_session'::regclass and contype = 'f'), 'platform.staff',
  'its one foreign key is to platform.staff (none to auth.sessions)');
select is((select count(*)::int from pg_proc p where p.oid in ('public.select_console()'::regprocedure, 'public.platform_leave_console()'::regprocedure)
             and p.prosecdef and p.proconfig = array['search_path=""'] and p.proowner = 'postgres'::regrole and coalesce(p.proacl::text !~ '[{,]=X/', false)), 2,
  'select_console and platform_leave_console are definers with search_path = "", owned by postgres, not executable by PUBLIC');
select is((select string_agg(r, ',' order by r) from unnest(array['anon', 'authenticated', 'service_role', 'platform_staff']) r
            where has_function_privilege(r, 'public.select_console()', 'execute')), 'authenticated', 'select_console() is executable by authenticated only');
select is((select string_agg(r, ',' order by r) from unnest(array['anon', 'authenticated', 'service_role', 'platform_staff']) r
            where has_function_privilege(r, 'public.platform_leave_console()', 'execute')), 'platform_staff', 'platform_leave_console() by platform_staff only');
select is((select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('public', 'app', 'platform') and has_function_privilege('platform_staff', p.oid, 'execute')),
  'platform_audit,platform_leave_console,platform_me,platform_notice_mark,platform_notices,platform_open_tenant,platform_tenant,platform_tenants',
  'platform_staff now executes exactly eight functions');

select * from finish();
rollback;
