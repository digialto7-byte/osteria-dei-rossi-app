-- SP3 step 10 (docs/plans/2026-11-15-sp3-console.md §3.3.1; AT1, AT3, AT11): the Postgres role platform_staff and app.require_console(). The role can log in to nothing,
-- reaches no table, column or sequence, and executes no function yet (steps 11 and 12 grant it the console reads). require_console is the first statement of every console
-- function: the token's role must be platform_staff and its user the active platform admin, with a verified factor, at aal2. Section 4 pins tenant sign-in: the hook's
-- claims for every non-console session, exactly as main gives them before SP3 touches the hook (PR 3 must keep these values). Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

insert into auth.users (id, email) values
  ('a7000000-0000-4000-8000-000000000001', 'platform-admin@example.test'),
  ('a7000000-0000-4000-8000-000000000002', 'support@example.test'),
  ('a7000000-0000-4000-8000-000000000003', 'old-admin@example.test'),
  ('a7000000-0000-4000-8000-000000000004', 'owner-a@example.test'),
  ('a7000000-0000-4000-8000-000000000005', 'chef-a@example.test'),
  ('97000000-0000-4000-8000-000000000001', null);
insert into public.tenant (id, name, vat_number) values ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into platform.staff (auth_id, role) values ('a7000000-0000-4000-8000-000000000001', 'platform_admin'), ('a7000000-0000-4000-8000-000000000002', 'platform_support');
insert into platform.staff (auth_id, role, is_active) values ('a7000000-0000-4000-8000-000000000003', 'platform_admin', false);
insert into public.app_user (tenant_id, auth_id, role, display_name) values
  ('11111111-1111-4111-8111-111111111111', 'a7000000-0000-4000-8000-000000000001', 'admin', 'DigiAlto'),
  ('11111111-1111-4111-8111-111111111111', 'a7000000-0000-4000-8000-000000000004', 'owner', 'Titolare A'),
  ('11111111-1111-4111-8111-111111111111', 'a7000000-0000-4000-8000-000000000005', 'chef', 'Cuoco A');
insert into public.app_user (tenant_id, auth_id, role, display_name, login_method) values
  ('11111111-1111-4111-8111-111111111111', '97000000-0000-4000-8000-000000000001', 'waiter', 'Cameriere PIN', 'pin');

-- A token for p_auth with the given role claim and assurance level; no tenant claim.
create function pg_temp.token(p_auth uuid, p_role text, p_aal text) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_auth, 'role', p_role, 'aal', p_aal)::text, true)
$$;
-- The outcome of a statement: 'ok' or '<sqlstate> <message>'.
create function pg_temp.out(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;
-- Verified (or not) factors for an account, replacing its old ones.
create function pg_temp.factor(p_auth uuid, p_status text) returns void language plpgsql as $$
begin
  delete from auth.mfa_factors where user_id = p_auth;
  insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
    values (gen_random_uuid(), p_auth, 'Principale', 'totp', p_status::auth.factor_status, now(), now(), 'fake-secret-value');
end $$;
grant execute on function pg_temp.out(text), pg_temp.token(uuid, text, text) to public;

-- 1. The role ---------------------------------------------------------------------------------------------------------------------------------------------------------------
select is((select rolcanlogin from pg_roles where rolname = 'platform_staff'), false,
  'the role platform_staff exists, is NOLOGIN and is granted to authenticator (1 of 3: NOLOGIN)');
select ok(pg_has_role('authenticator', 'platform_staff', 'member'), 'authenticator is a member of platform_staff, so PostgREST can switch to it');
select is((select rolinherit or rolsuper or rolcreaterole or rolcreatedb or rolreplication or rolbypassrls from pg_roles where rolname = 'platform_staff'), false,
  'it is NOINHERIT and holds no attribute (superuser, create role, create db, replication, bypass RLS)');
select is((select count(*)::int from pg_auth_members m where m.member = 'platform_staff'::regrole), 0, 'it is a member of no other role');

-- 2. AT1: no privilege on any table, column or sequence; no function yet -------------------------------------------------------------------------------------------------
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname in ('public', 'app', 'platform', 'storage') and c.relkind in ('r', 'p', 'v', 'm', 'f')
              and has_table_privilege('platform_staff', c.oid, 'select,insert,update,delete,truncate,references,trigger')), 0,
  'platform_staff has no privilege on any table or view in public, app, platform or storage');
select is((select count(*)::int from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
            where n.nspname in ('public', 'app', 'platform', 'storage') and c.relkind in ('r', 'p', 'v', 'm', 'f') and a.attnum > 0 and not a.attisdropped
              and has_column_privilege('platform_staff', c.oid, a.attnum, 'select,insert,update,references')), 0, 'nor on any column');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname in ('public', 'app', 'platform', 'storage') and case when c.relkind = 'S' then has_sequence_privilege('platform_staff', c.oid, 'usage,select,update') else false end), 0,
  'nor on any sequence');
select is((select string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname, p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('public', 'app', 'platform') and has_function_privilege('platform_staff', p.oid, 'execute')
              and not (n.nspname = 'public' and p.proname in ('platform_tenants', 'platform_tenant', 'platform_audit', 'platform_open_tenant', 'platform_notices', 'platform_notice_mark', 'platform_me',
                                                        'platform_leave_console' /* re-pinned on purpose by SP3 (step 13; was not listed) */))), null,
  'it executes no function in public, app or platform besides the console reads granted by steps 11 and 12 and the way out of step 13 (443 pins that list exactly)');
select ok(not has_function_privilege('platform_staff', 'public.platform_bootstrap_admin(uuid)', 'execute'), 'in particular not platform_bootstrap_admin (AT11)');
select is((select string_agg(s, ',' order by s) from unnest(array['public', 'app', 'platform', 'storage', 'auth']) s where has_schema_privilege('platform_staff', s, 'usage')),
  'public', 'its only schema usage is public (to call the console functions); none on app, platform, storage or auth');
-- pgTAP lives in schema extensions; inside this rolled-back test only, the role may reach it to report.
grant usage on schema extensions to platform_staff;
set local role platform_staff;
select is(pg_temp.out($$select 1 from public.tenant$$), '42501 permission denied for table tenant', 'as platform_staff, select on public.tenant is 42501');
select is(pg_temp.out($$select 1 from public.invoice$$), '42501 permission denied for table invoice', 'and on public.invoice');
select is(left(pg_temp.out($$select 1 from storage.objects$$), 5), '42501', 'and on storage.objects');
select is(left(pg_temp.out($$select 1 from platform.staff$$), 5), '42501', 'and on platform.staff');
select is(left(pg_temp.out($$select app.require_console()$$), 5), '42501', 'and it cannot call app.require_console itself');
reset role;

-- 3. app.require_console (AT3) ---------------------------------------------------------------------------------------------------------------------------------------------
select is((select p.prosecdef and p.proconfig = array['search_path=""'] and p.proowner = 'postgres'::regrole from pg_proc p where p.oid = 'app.require_console()'::regprocedure), true,
  'app.require_console() is a security definer with search_path = "", owned by postgres');
select is((select string_agg(r, ',' order by r) from unnest(array['public', 'anon', 'authenticated', 'service_role', 'platform_staff']) r
            where (r = 'public' and (select coalesce(p.proacl::text ~ '[{,]=X/', true) from pg_proc p where p.oid = 'app.require_console()'::regprocedure))
               or (r <> 'public' and has_function_privilege(r, 'app.require_console()', 'execute'))), null,
  'it is closed to every API role (has_function_privilege) and to PUBLIC');
select pg_temp.token('a7000000-0000-4000-8000-000000000004', 'authenticated', 'aal2');
select is(pg_temp.out($$select app.require_console()$$), '42501 console_required', 'an authenticated token (an owner) is 42501 console_required');
select pg_temp.token('a7000000-0000-4000-8000-000000000001', 'authenticated', 'aal2');
select pg_temp.factor('a7000000-0000-4000-8000-000000000001', 'verified');
select is(pg_temp.out($$select app.require_console()$$), '42501 console_required', 'even the platform admin with a factor at aal2, while its token is authenticated (not console mode)');
select pg_temp.factor('a7000000-0000-4000-8000-000000000001', 'unverified');
select pg_temp.token('a7000000-0000-4000-8000-000000000001', 'platform_staff', 'aal1');
select is(pg_temp.out($$select app.require_console()$$), 'P0001 mfa_factor_required', 'a platform_staff token of the admin without a verified factor is mfa_factor_required (the check moved from step 4)');
select pg_temp.factor('a7000000-0000-4000-8000-000000000001', 'verified');
select is(pg_temp.out($$select app.require_console()$$), 'P0001 mfa_required', 'with a verified factor at aal1: mfa_required');
select pg_temp.token('a7000000-0000-4000-8000-000000000001', 'platform_staff', 'aal2');
select is(pg_temp.out($$select app.require_console()$$), 'ok', 'with a verified factor at aal2: it passes');
select pg_temp.factor('a7000000-0000-4000-8000-000000000003', 'verified');
select pg_temp.token('a7000000-0000-4000-8000-000000000003', 'platform_staff', 'aal2');
select is(pg_temp.out($$select app.require_console()$$), '42501 console_required', 'an inactive platform_admin row is 42501');
select pg_temp.factor('a7000000-0000-4000-8000-000000000002', 'verified');
select pg_temp.token('a7000000-0000-4000-8000-000000000002', 'platform_staff', 'aal2');
select is(pg_temp.out($$select app.require_console()$$), '42501 console_required', 'a platform_support row is 42501 (only the platform admin has a console in SP3)');
select pg_temp.token('a7000000-0000-4000-8000-000000000004', 'platform_staff', 'aal2');
select is(pg_temp.out($$select app.require_console()$$), '42501 console_required', 'a platform_staff role claim on a non-staff account is 42501');
select set_config('request.jwt.claims', '', true);
select is(pg_temp.out($$select app.require_console()$$), '42501 console_required', 'no claims at all: 42501');

-- 4. Tenant sign-in is unchanged (lead, 2026-11-27): the hook's claims for every non-console session, byte for byte --------------------------------------------------------
create function pg_temp.claims(p_user uuid, p_method text) returns jsonb language sql as $$
  select app.custom_access_token_hook(jsonb_build_object(
    'user_id', p_user, 'authentication_method', p_method,
    'claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1', 'session_id', 'c7000000-0000-4000-8000-000000000001')))
$$;
select is(pg_temp.claims('a7000000-0000-4000-8000-000000000004', 'password')::text,
  '{"claims": {"aal": "aal1", "sub": "a7000000-0000-4000-8000-000000000004", "role": "authenticated", "app_role": "owner", "tenant_id": "11111111-1111-4111-8111-111111111111", "session_id": "c7000000-0000-4000-8000-000000000001"}, "user_id": "a7000000-0000-4000-8000-000000000004", "authentication_method": "password"}',
  'an owner''s e-mail sign-in: exactly these claims');
select is(pg_temp.claims('a7000000-0000-4000-8000-000000000005', 'password')::text,
  '{"claims": {"aal": "aal1", "sub": "a7000000-0000-4000-8000-000000000005", "role": "authenticated", "app_role": "chef", "tenant_id": "11111111-1111-4111-8111-111111111111", "session_id": "c7000000-0000-4000-8000-000000000001"}, "user_id": "a7000000-0000-4000-8000-000000000005", "authentication_method": "password"}',
  'a chef''s: exactly these claims');
select is(pg_temp.claims('a7000000-0000-4000-8000-000000000001', 'password')::text,
  '{"claims": {"aal": "aal1", "sub": "a7000000-0000-4000-8000-000000000001", "role": "authenticated", "app_role": "admin", "tenant_id": "11111111-1111-4111-8111-111111111111", "session_id": "c7000000-0000-4000-8000-000000000001"}, "user_id": "a7000000-0000-4000-8000-000000000001", "authentication_method": "password"}',
  'the platform admin''s own admin row, with no console session: the venue''s claims, as for any admin');
select is(pg_temp.claims('97000000-0000-4000-8000-000000000001', 'password')::text,
  '{"claims": {"aal": "aal1", "sub": "97000000-0000-4000-8000-000000000001", "role": "authenticated", "session_id": "c7000000-0000-4000-8000-000000000001", "session_state": "ended"}, "user_id": "97000000-0000-4000-8000-000000000001", "authentication_method": "password"}',
  'a PIN login signing in by password (not by its PIN): no tenant claim and session_state ended, exactly');

select * from finish();
rollback;
