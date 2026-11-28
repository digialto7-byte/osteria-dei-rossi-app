-- SP3 step 14 (docs/plans/2026-11-15-sp3-console.md §3.2; AT1, AT12 database half): the hook's console mode. A session with a console row of its own user, who is the
-- active platform admin, gets role = platform_staff and no tenant, app_role or login claim; every other session gets exactly SP2's claims (pgTAP 003, 085, 340, 431 and
-- 441 §4 unchanged; tests/config/sp3-hook-branches.test.ts proves the PIN block is M11's text and the e-mail blocks SP2's). GoTrue calls the hook as supabase_auth_admin;
-- the test role cannot SET ROLE to it on hosted Supabase, so the hook is called directly and that role's access is asserted below. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

insert into auth.users (id, email) values
  ('a9000000-0000-4000-8000-000000000001', 'platform-admin@example.test'),
  ('a9000000-0000-4000-8000-000000000002', 'support@example.test'),
  ('a9000000-0000-4000-8000-000000000003', 'old-admin@example.test'),
  ('a9000000-0000-4000-8000-000000000004', 'owner-a@example.test'),
  ('99000000-0000-4000-8000-000000000001', null);
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT00000000001');
insert into platform.staff (auth_id, role) values ('a9000000-0000-4000-8000-000000000001', 'platform_admin'), ('a9000000-0000-4000-8000-000000000002', 'platform_support');
insert into platform.staff (auth_id, role, is_active) values ('a9000000-0000-4000-8000-000000000003', 'platform_admin', false);
insert into public.app_user (tenant_id, auth_id, role, display_name) values
  ('11111111-1111-4111-8111-111111111111', 'a9000000-0000-4000-8000-000000000001', 'admin', 'DigiAlto'),
  ('22222222-2222-4222-8222-222222222222', 'a9000000-0000-4000-8000-000000000001', 'admin', 'DigiAlto'),
  ('11111111-1111-4111-8111-111111111111', 'a9000000-0000-4000-8000-000000000004', 'owner', 'Titolare A');
insert into public.app_user (tenant_id, auth_id, role, display_name, login_method) values
  ('11111111-1111-4111-8111-111111111111', '99000000-0000-4000-8000-000000000001', 'waiter', 'Cameriere PIN', 'pin');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
  values (gen_random_uuid(), 'a9000000-0000-4000-8000-000000000001', 'Principale', 'totp', 'verified', now(), now(), 'fake-secret-value');

-- The hook's claims for a user and session, with the given incoming role (GoTrue sends authenticated).
create function pg_temp.claims(p_user uuid, p_session text, p_role text default 'authenticated') returns jsonb language sql as $$
  select app.custom_access_token_hook(jsonb_build_object('user_id', p_user, 'authentication_method', 'password',
    'claims', jsonb_build_object('sub', p_user, 'role', p_role, 'aal', 'aal2', 'session_id', p_session))) -> 'claims'
$$;
-- Use the claims as the request's token.
create function pg_temp.use(p_claims jsonb) returns void language sql as $$
  select set_config('request.jwt.claims', p_claims::text, true)
$$;
create function pg_temp.out(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;
-- The public tables and views the current role can read a row of (AT12: none for a console token).
create function pg_temp.readable_public() returns text language plpgsql as $$
declare
  r record;
  n integer;
  v text;
begin
  for r in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f') order by c.relname loop
    begin
      execute format('select count(*) from (select 1 from public.%I limit 1) x', r.relname) into n;
      if n > 0 then v := concat_ws(',', v, r.relname); end if;
    exception when insufficient_privilege then
      null;
    end;
  end loop;
  return v;
end $$;
grant execute on function pg_temp.out(text), pg_temp.readable_public(), pg_temp.use(jsonb) to public;

-- 1. The console branch: the first test of step 14 -------------------------------------------------------------------------------------------------------------------------
insert into platform.console_session (session_id, auth_id) values ('c9000000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000001');
select ok(pg_temp.claims('a9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000001') ->> 'role' = 'platform_staff'
          and not (pg_temp.claims('a9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000001') ?| array['tenant_id', 'app_role', 'login', 'session_state']),
  'with a console row for its session_id, the hook gives role = platform_staff and no tenant_id, app_role or login');
select is(pg_temp.claims('a9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000001')::text,
  '{"aal": "aal2", "sub": "a9000000-0000-4000-8000-000000000001", "role": "platform_staff", "session_id": "c9000000-0000-4000-8000-000000000001"}',
  'exactly the incoming claims with role platform_staff: no new claim key');
select is(pg_temp.claims('a9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000002')::text,
  '{"aal": "aal2", "sub": "a9000000-0000-4000-8000-000000000001", "role": "authenticated", "session_id": "c9000000-0000-4000-8000-000000000002"}',
  'another session of the same admin (no console row): SP2''s claims, two memberships and no selection');

-- 2. Every row of the §3.2 table -------------------------------------------------------------------------------------------------------------------------------------------
insert into platform.console_session (session_id, auth_id) values
  ('c9000000-0000-4000-8000-000000000003', 'a9000000-0000-4000-8000-000000000003'),
  ('c9000000-0000-4000-8000-000000000004', 'a9000000-0000-4000-8000-000000000002');
select is(pg_temp.claims('a9000000-0000-4000-8000-000000000003', 'c9000000-0000-4000-8000-000000000003')::text,
  '{"aal": "aal2", "sub": "a9000000-0000-4000-8000-000000000003", "role": "authenticated", "session_id": "c9000000-0000-4000-8000-000000000003"}',
  'a console row whose platform_admin row is inactive: the e-mail branches (no membership: no tenant)');
select is(pg_temp.claims('a9000000-0000-4000-8000-000000000002', 'c9000000-0000-4000-8000-000000000004')::text,
  '{"aal": "aal2", "sub": "a9000000-0000-4000-8000-000000000002", "role": "authenticated", "session_id": "c9000000-0000-4000-8000-000000000004"}',
  'a console row of a platform_support row: the e-mail branches (no membership: no tenant)');
select is(pg_temp.claims('a9000000-0000-4000-8000-000000000004', 'c9000000-0000-4000-8000-000000000001')::text,
  '{"aal": "aal2", "sub": "a9000000-0000-4000-8000-000000000004", "role": "authenticated", "app_role": "owner", "tenant_id": "11111111-1111-4111-8111-111111111111", "session_id": "c9000000-0000-4000-8000-000000000001"}',
  'the console row of another auth user (a forged session_id) is ignored: the owner''s own claims');
select is(pg_temp.claims('99000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000001')::text,
  '{"aal": "aal2", "sub": "99000000-0000-4000-8000-000000000001", "role": "authenticated", "session_id": "c9000000-0000-4000-8000-000000000001", "session_state": "ended"}',
  'a PIN login on that session_id: the PIN branch exactly (ended, signed in by password)');
select is(pg_temp.claims('a9000000-0000-4000-8000-000000000001', 'not-a-uuid')::text,
  '{"aal": "aal2", "sub": "a9000000-0000-4000-8000-000000000001", "role": "authenticated", "session_id": "not-a-uuid"}',
  'a malformed session_id: the console block falls through to the e-mail branches');

-- An unreadable console_session or staff table counts as no console row (the block has its own exception handler). Made to fail by moving the table away.
alter table platform.console_session rename to console_session_moved;
select is(pg_temp.claims('a9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000001') ->> 'role', 'authenticated',
  'an unreadable console_session: the e-mail branches');
select is(pg_temp.claims('a9000000-0000-4000-8000-000000000004', 'c9000000-0000-4000-8000-000000000001') ->> 'tenant_id', '11111111-1111-4111-8111-111111111111',
  'and a venue login still gets its tenant');
alter table platform.console_session_moved rename to console_session;
alter table platform.staff rename to staff_moved;
select is(pg_temp.claims('a9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000001') ->> 'role', 'authenticated',
  'an unreadable staff table: the e-mail branches');
alter table platform.staff_moved rename to staff;
select is(pg_temp.claims('a9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000001') ->> 'role', 'platform_staff', 'with both back, console mode again');

-- A stale incoming role = platform_staff without a console row is set back to authenticated, then the e-mail branches run.
select is(pg_temp.claims('a9000000-0000-4000-8000-000000000004', 'c9000000-0000-4000-8000-000000000009', 'platform_staff')::text,
  '{"aal": "aal2", "sub": "a9000000-0000-4000-8000-000000000004", "role": "authenticated", "app_role": "owner", "tenant_id": "11111111-1111-4111-8111-111111111111", "session_id": "c9000000-0000-4000-8000-000000000009"}',
  'incoming role platform_staff, no console row (an owner): authenticated and its venue');
select is(pg_temp.claims('a9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000009', 'platform_staff') ->> 'role', 'authenticated',
  'incoming role platform_staff for the admin without a console row: authenticated');
select is(pg_temp.claims('a9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000001', 'platform_staff') ->> 'role', 'platform_staff',
  'incoming role platform_staff with its console row: platform_staff');

-- 3. AT12: select_console -> hook -> platform_staff -> leave -> select_tenant ----------------------------------------------------------------------------------------------
delete from platform.console_session;
select pg_temp.use('{"sub": "a9000000-0000-4000-8000-000000000001", "role": "authenticated", "aal": "aal2", "session_id": "c9000000-0000-4000-8000-000000000005"}');
select is(public.select_console(), '{"changed": true}'::jsonb, 'AT12: the admin enters the console in session 5');
select is(pg_temp.claims('a9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000005') ->> 'role', 'platform_staff', 'the refreshed token is platform_staff');
select pg_temp.use(pg_temp.claims('a9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000005'));
grant usage on schema extensions to platform_staff;
set local role platform_staff;
select is(pg_temp.readable_public(), null, 'as that token, no public table or view yields a row (each is 42501 or empty)');
select is(pg_temp.out($$select public.platform_tenants()$$), 'ok', 'the console reads answer');
select is(left(pg_temp.out($$select public.select_tenant('11111111-1111-4111-8111-111111111111')$$), 5), '42501', 'select_tenant is not callable from console mode');
select is(public.platform_leave_console(), '{"changed": true}'::jsonb, 'platform_leave_console leaves');
reset role;
select is(pg_temp.claims('a9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000005')::text,
  '{"aal": "aal2", "sub": "a9000000-0000-4000-8000-000000000001", "role": "authenticated", "session_id": "c9000000-0000-4000-8000-000000000005"}',
  'the next token is authenticated with no tenant claim (two memberships)');
select pg_temp.use(pg_temp.claims('a9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000005'));
set local role authenticated;
select is(left(pg_temp.out($$select public.platform_tenants()$$), 5), '42501', 'with it, a console read is 42501');
select is(public.select_console(), '{"changed": true}'::jsonb, 'it enters the console again');
select is(public.select_tenant('22222222-2222-4222-8222-222222222222') ->> 'tenantId', '22222222-2222-4222-8222-222222222222', 'and then selects venue B');
reset role;
select is(pg_temp.claims('a9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000005')::text,
  '{"aal": "aal2", "sub": "a9000000-0000-4000-8000-000000000001", "role": "authenticated", "app_role": "admin", "tenant_id": "22222222-2222-4222-8222-222222222222", "session_id": "c9000000-0000-4000-8000-000000000005"}',
  'the next token carries B''s claims: one mode at a time');

-- 4. The hook's reach and shape --------------------------------------------------------------------------------------------------------------------------------------------
select ok(has_schema_privilege('supabase_auth_admin', 'platform', 'usage'), 'supabase_auth_admin has usage on schema platform (the hook runs as it)');
select ok(has_table_privilege('supabase_auth_admin', 'platform.staff', 'select'), 'and may read platform.staff');
select is((select string_agg(c.relname, ',' order by c.relname) from pg_class c where c.relnamespace = 'platform'::regnamespace and c.relkind in ('r', 'p', 'S')
             and has_table_privilege('supabase_auth_admin', c.oid, 'select,insert,update,delete,truncate,references,trigger')), 'console_session,staff',
  'it has a privilege on console_session and staff only, nothing else in platform');
select ok(not has_table_privilege('supabase_auth_admin', 'platform.staff', 'insert,update,delete,truncate,references,trigger'), 'and on staff only select');
select is((select string_agg(polname::text || ':' || polcmd::text || ':' || array_to_string(polroles::regrole[]::text[], ','), ' ') from pg_policy where polrelid = 'platform.staff'::regclass),
  'staff_read_by_auth_hook:r:supabase_auth_admin', 'platform.staff has one policy: read by the hook');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role', 'platform_staff']) r where has_schema_privilege(r, 'platform', 'usage')), 0,
  'still no API role has usage on schema platform');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role', 'platform_staff']) r where has_table_privilege(r, 'platform.staff', 'select')), 0,
  'nor select on platform.staff');
select is((select p.prosecdef::text || ',' || p.provolatile::text || ',' || array_to_string(p.proconfig, ';') || ',' || p.proowner::regrole::text
             || ',' || pg_get_function_result(p.oid)
           from pg_proc p where p.oid = 'app.custom_access_token_hook(jsonb)'::regprocedure), 'false,s,search_path="",postgres,jsonb',
  'the hook keeps its shape: not a definer, stable, search_path = "", owned by postgres, returns jsonb');
select ok(has_function_privilege('supabase_auth_admin', 'app.custom_access_token_hook(jsonb)', 'execute'), 'supabase_auth_admin still executes it');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role', 'platform_staff']) r
            where has_function_privilege(r, 'app.custom_access_token_hook(jsonb)', 'execute')), 0, 'no API role executes it');
select is((select count(*)::int from pg_proc where proname = 'custom_access_token_hook'), 1, 'one hook, one signature');

select * from finish();
rollback;
