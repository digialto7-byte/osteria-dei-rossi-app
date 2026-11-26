-- SP2 S3 (docs/plans/2026-11-26-sp02-memberships.md §3.1 and §3.2; pgTAP 370 on #131): one login, one membership per tenant. The key
-- (tenant_id, auth_id) replaces the unique auth_id; a PIN login keeps exactly one membership; an owner cannot attach a login that is a member
-- elsewhere; app.session_tenant holds each session's choice; the hook's e-mail branch takes a selection of an active membership, else exactly one
-- active membership, else no tenant claim. AT2 (hook half) and AT5 (database half). Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(41);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'fresh@example.test'),
  ('90000000-0000-4000-8000-000000000001', null);
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115'),
  ('33333333-3333-4333-8333-333333333333', 'Osteria Demo C', 'IT22222222220');
insert into public.app_user (tenant_id, auth_id, role, display_name) values
  ('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare A'),
  ('22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B'),
  ('11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Cuoco A');
insert into public.app_user (tenant_id, auth_id, role, display_name, login_method) values
  ('11111111-1111-4111-8111-111111111111', '90000000-0000-4000-8000-000000000001', 'waiter', 'Cameriere PIN', 'pin');

-- The claims the hook gives a login, for a session id (null: none in the input).
create function pg_temp.claims(p_user uuid, p_session text) returns jsonb language sql as $$
  select app.custom_access_token_hook(jsonb_build_object(
    'user_id', p_user, 'authentication_method', 'password',
    'claims', jsonb_strip_nulls(jsonb_build_object('sub', p_user, 'role', 'authenticated', 'session_id', p_session,
                                                    'tenant_id', '33333333-3333-4333-8333-333333333333', 'app_role', 'admin'))
  )) -> 'claims'
$$;

-- 1. The key ------------------------------------------------------------------------------------------------------------------------------------------
select lives_ok($$ insert into public.app_user (tenant_id, auth_id, role, display_name)
    values ('22222222-2222-4222-8222-222222222222', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare A in B') $$,
  'one login with owner rows in A and B: the second insert succeeds');
select throws_ok($$ insert into public.app_user (tenant_id, auth_id, role, display_name)
    values ('22222222-2222-4222-8222-222222222222', 'a0000000-0000-4000-8000-00000000000a', 'chef', 'Doppione') $$,
  '23505', null, 'but one login has at most one row per tenant');
select hasnt_index('public', 'app_user', 'app_user_auth_id_key', 'the unique on auth_id alone is gone');
select is((select string_agg(a.attname, ',' order by k.ord) from pg_constraint c
             cross join unnest(c.conkey) with ordinality k(n, ord) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n
            where c.conname = 'app_user_tenant_auth_key' and c.contype = 'u'), 'tenant_id,auth_id', 'the key is unique (tenant_id, auth_id), in that order');
select has_index('public', 'app_user', 'app_user_auth_id_idx', array['auth_id'], 'and auth_id keeps a plain index for the per-login lookups');

-- 2. The hook, e-mail branch ----------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.claims('b0000000-0000-4000-8000-00000000000b', null) ->> 'tenant_id', '22222222-2222-4222-8222-222222222222',
  'one active membership and no session id: that tenant (today''s behaviour)');
select is(pg_temp.claims('b0000000-0000-4000-8000-00000000000b', gen_random_uuid()::text) ->> 'app_role', 'owner',
  'one active membership and a session with no selection: that tenant and role');
select ok(not (pg_temp.claims('a0000000-0000-4000-8000-00000000000a', null) ?| array['tenant_id', 'app_role']),
  'two active memberships and no session id: no tenant claim and no role (the incoming ones are stripped)');
select ok(not (pg_temp.claims('a0000000-0000-4000-8000-00000000000a', 'not-a-uuid') ?| array['tenant_id', 'app_role']),
  'two memberships and a malformed session id: no tenant claim');
select is(pg_temp.claims('b0000000-0000-4000-8000-00000000000b', 'not-a-uuid') ->> 'tenant_id', '22222222-2222-4222-8222-222222222222',
  'one membership and a malformed session id: still that tenant');

insert into app.session_tenant (session_id, auth_id, tenant_id) values
  ('5e550000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000a', '22222222-2222-4222-8222-222222222222');
select is(pg_temp.claims('a0000000-0000-4000-8000-00000000000a', '5e550000-0000-4000-8000-00000000000a') ->> 'tenant_id',
  '22222222-2222-4222-8222-222222222222', 'two memberships and a selection of B: tenant B');
select is(pg_temp.claims('a0000000-0000-4000-8000-00000000000a', '5e550000-0000-4000-8000-00000000000a') ->> 'app_role', 'owner',
  'with the role of the B row');
select is(pg_temp.claims('a0000000-0000-4000-8000-00000000000a', '5e550000-0000-4000-8000-00000000000a') ->> 'role', 'authenticated',
  'the Postgres role claim is left untouched');
update app.session_tenant set tenant_id = '11111111-1111-4111-8111-111111111111' where session_id = '5e550000-0000-4000-8000-00000000000a';
select is(pg_temp.claims('a0000000-0000-4000-8000-00000000000a', '5e550000-0000-4000-8000-00000000000a') ->> 'tenant_id',
  '11111111-1111-4111-8111-111111111111', 'after switching the selection to A: tenant A');
select ok(not (pg_temp.claims('a0000000-0000-4000-8000-00000000000a', gen_random_uuid()::text) ?| array['tenant_id', 'app_role']),
  'another session of the same login, with no selection: no tenant claim (the choice is per session)');

-- A selection row of another login (a forged session id) is ignored.
insert into app.session_tenant (session_id, auth_id, tenant_id) values
  ('5e550000-0000-4000-8000-00000000000b', 'b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222');
select ok(not (pg_temp.claims('a0000000-0000-4000-8000-00000000000a', '5e550000-0000-4000-8000-00000000000b') ?| array['tenant_id', 'app_role']),
  'a session id whose selection belongs to another login gives no tenant claim');

-- A selection whose membership was deactivated is dropped (Q-S4, Rule B: no claim left → the API answers 409).
update public.app_user set is_active = false, deactivated_at = now()
 where tenant_id = '11111111-1111-4111-8111-111111111111' and auth_id = 'a0000000-0000-4000-8000-00000000000a';
select is(pg_temp.claims('a0000000-0000-4000-8000-00000000000a', '5e550000-0000-4000-8000-00000000000a') ->> 'tenant_id',
  '22222222-2222-4222-8222-222222222222', 'the selected membership deactivated, one other active: that one (the single-membership rule)');
insert into public.app_user (tenant_id, auth_id, role, display_name) values
  ('33333333-3333-4333-8333-333333333333', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare A in C');
select ok(not (pg_temp.claims('a0000000-0000-4000-8000-00000000000a', '5e550000-0000-4000-8000-00000000000a') ?| array['tenant_id', 'app_role']),
  'the selected membership deactivated, two others active: no tenant claim');
update public.app_user set is_active = true, deactivated_at = null
 where tenant_id = '11111111-1111-4111-8111-111111111111' and auth_id = 'a0000000-0000-4000-8000-00000000000a';

-- A selection table the hook cannot read counts as no selection (the read sits in its own exception block). The test role cannot SET ROLE to
-- supabase_auth_admin, so the read is made to fail by moving the table away for the two calls (rolled back with the test).
alter table app.session_tenant rename to session_tenant_moved;
select ok(not (pg_temp.claims('a0000000-0000-4000-8000-00000000000a', '5e550000-0000-4000-8000-00000000000a') ?| array['tenant_id', 'app_role']),
  'an unreadable selection table: two memberships get no tenant claim');
select is(pg_temp.claims('b0000000-0000-4000-8000-00000000000b', '5e550000-0000-4000-8000-00000000000b') ->> 'tenant_id',
  '22222222-2222-4222-8222-222222222222', 'and one membership still gets its tenant');
alter table app.session_tenant_moved rename to session_tenant;

-- 3. PIN logins keep exactly one membership (ADR-010; AT5) ---------------------------------------------------------------------------------------------
select throws_ok($$ insert into public.app_user (tenant_id, auth_id, role, display_name, login_method)
    values ('22222222-2222-4222-8222-222222222222', '90000000-0000-4000-8000-000000000001', 'waiter', 'Cameriere PIN in B', 'pin') $$,
  'P0001', 'pin_single_membership', 'a PIN login cannot get a second PIN row');
select throws_ok($$ insert into public.app_user (tenant_id, auth_id, role, display_name)
    values ('22222222-2222-4222-8222-222222222222', '90000000-0000-4000-8000-000000000001', 'waiter', 'Cameriere PIN via e-mail') $$,
  'P0001', 'pin_single_membership', 'nor a second row of any kind');
select throws_ok($$ update public.app_user set login_method = 'pin'
    where tenant_id = '11111111-1111-4111-8111-111111111111' and auth_id = 'a0000000-0000-4000-8000-00000000000a' $$,
  'P0001', 'pin_single_membership', 'an e-mail login with rows elsewhere cannot become a PIN login');
select is(pg_temp.claims('90000000-0000-4000-8000-000000000001', null) ->> 'session_state', 'ended',
  'the PIN branch is untouched: a PIN password sign-in outside the allowed window ends the session, as in M11');

-- 4. An owner cannot attach a login that is a member elsewhere (Q-S2) ---------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', 'b0000000-0000-4000-8000-00000000000b', 'role', 'authenticated',
  'tenant_id', '22222222-2222-4222-8222-222222222222', 'app_role', 'owner')::text, true);
select throws_ok($$ insert into public.app_user (tenant_id, auth_id, role, display_name)
    values ('22222222-2222-4222-8222-222222222222', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Cuoco di A') $$,
  '42501', null, 'the owner of B cannot insert a row for a login that is a member of A');
select lives_ok($$ insert into public.app_user (tenant_id, auth_id, role, display_name)
    values ('22222222-2222-4222-8222-222222222222', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Nuovo cameriere') $$,
  'but may insert a row for a login with no membership');
reset role;
select ok(has_function_privilege('authenticated', 'app.auth_member_elsewhere(uuid, uuid)', 'execute'),
  'the guard is executable by authenticated (the insert policy calls it as the caller)');

-- 5. app.session_tenant: RLS, grants, the composite key --------------------------------------------------------------------------------------------
select is((select relrowsecurity from pg_class where oid = 'app.session_tenant'::regclass), true, 'RLS is on');
select ok(not has_table_privilege('anon', 'app.session_tenant', 'select,insert,update,delete,truncate,references,trigger'), 'anon has no privilege');
select ok(not has_table_privilege('authenticated', 'app.session_tenant', 'select,insert,update,delete,truncate,references,trigger'),
  'authenticated has no privilege');
select ok(not has_table_privilege('service_role', 'app.session_tenant', 'select,insert,update,delete,truncate,references,trigger'),
  'service_role has no privilege');
select ok(has_table_privilege('supabase_auth_admin', 'app.session_tenant', 'select'), 'the hook''s role may read it');
select ok(not has_table_privilege('supabase_auth_admin', 'app.session_tenant', 'insert,update,delete,truncate'), 'and only read it');
select is((select string_agg(polname || ':' || polcmd::text || ':' || array_to_string(polroles::regrole[], ','), ',') from pg_policy
            where polrelid = 'app.session_tenant'::regclass), 'session_tenant_read_by_auth_hook:r:supabase_auth_admin', 'one policy: read by the hook');
select throws_ok($$ insert into app.session_tenant (session_id, auth_id, tenant_id) values
    (gen_random_uuid(), 'b0000000-0000-4000-8000-00000000000b', '11111111-1111-4111-8111-111111111111') $$,
  '23503', null, 'a selection must name a real membership (the composite foreign key)');
select col_not_null('app', 'session_tenant', 'tenant_id', 'tenant_id is never null');
select col_not_null('app', 'session_tenant', 'auth_id', 'auth_id is never null');

-- 6. The definers ---------------------------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace
             and p.proname in ('auth_member_elsewhere', 'app_user_pin_single_membership')
             and p.prosecdef and p.proconfig @> array['search_path=""']), 2, 'both new helpers are definers with search_path = ''''');
select ok(not has_function_privilege('anon', 'app.app_user_pin_single_membership()', 'execute')
          and not has_function_privilege('authenticated', 'app.app_user_pin_single_membership()', 'execute'),
  'the PIN trigger function is executable by no API role');
select ok(not has_function_privilege('anon', 'app.auth_member_elsewhere(uuid, uuid)', 'execute'), 'nor is the guard by anon');
select is((select provolatile::text from pg_proc where oid = 'app.custom_access_token_hook(jsonb)'::regprocedure), 's', 'the hook stays stable');

select * from finish();
rollback;
