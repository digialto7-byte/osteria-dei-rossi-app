-- SP2 S4 (docs/plans/2026-11-26-sp02-memberships.md §3.3; pgTAP 371 on #131): public.select_tenant stores the session's choice after a
-- membership check, and public.my_memberships lists the caller's own active venues. AT3. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-ab@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('90000000-0000-4000-8000-000000000001', null);
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115'),
  ('33333333-3333-4333-8333-333333333333', 'Osteria Demo C', 'IT22222222220');
insert into public.app_user (tenant_id, auth_id, role, display_name, is_active, deactivated_at) values
  ('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare', true, null),
  ('22222222-2222-4222-8222-222222222222', 'a0000000-0000-4000-8000-00000000000a', 'admin', 'Titolare in B', true, null),
  ('33333333-3333-4333-8333-333333333333', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Ex titolare in C', false, now()),
  ('22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B', true, null);
insert into public.app_user (tenant_id, auth_id, role, display_name, login_method) values
  ('11111111-1111-4111-8111-111111111111', '90000000-0000-4000-8000-000000000001', 'waiter', 'Cameriere PIN', 'pin');

-- Acts as a login in a session, with no tenant claim (what the hook gives a login with two memberships and no selection).
create function pg_temp.act(p_user uuid, p_session text, p_login text default null) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_strip_nulls(jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'session_id', p_session, 'login', p_login))::text, true);
$$;
create function pg_temp.hook(p_user uuid, p_session text) returns jsonb language sql as $$
  select app.custom_access_token_hook(jsonb_build_object('user_id', p_user, 'authentication_method', 'password',
    'claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'session_id', p_session))) -> 'claims'
$$;
grant execute on function pg_temp.act(uuid, text, text) to authenticated;

-- 1. A member selects ---------------------------------------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act('a0000000-0000-4000-8000-00000000000a', '5e550000-0000-4000-8000-00000000000a');
select is(public.select_tenant('11111111-1111-4111-8111-111111111111'),
  '{"tenantId": "11111111-1111-4111-8111-111111111111", "changed": true}'::jsonb, 'select_tenant(A) by a member answers the tenant, changed');
reset role;
select is((select tenant_id from app.session_tenant where session_id = '5e550000-0000-4000-8000-00000000000a'), '11111111-1111-4111-8111-111111111111'::uuid,
  'and writes the session row');
select is(pg_temp.hook('a0000000-0000-4000-8000-00000000000a', '5e550000-0000-4000-8000-00000000000a') ->> 'tenant_id', '11111111-1111-4111-8111-111111111111',
  'the hook then gives A');
set local role authenticated;
select pg_temp.act('a0000000-0000-4000-8000-00000000000a', '5e550000-0000-4000-8000-00000000000a');
select is(public.select_tenant('11111111-1111-4111-8111-111111111111') ->> 'changed', 'false', 're-selecting the same tenant answers changed false');
select throws_ok($$ select public.select_tenant('22222222-2222-4222-8222-222222222222') $$, 'P0001', 'tenant_switch_too_soon',
  'a switch to another tenant within the interval is refused');
reset role;
update app.session_tenant set selected_at = now() - app.tenant_switch_min_interval() - interval '1 second'
 where session_id = '5e550000-0000-4000-8000-00000000000a';
set local role authenticated;
select pg_temp.act('a0000000-0000-4000-8000-00000000000a', '5e550000-0000-4000-8000-00000000000a');
select is(public.select_tenant('22222222-2222-4222-8222-222222222222'),
  '{"tenantId": "22222222-2222-4222-8222-222222222222", "changed": true}'::jsonb, 'after the interval the switch to B is accepted');
reset role;
select is(pg_temp.hook('a0000000-0000-4000-8000-00000000000a', '5e550000-0000-4000-8000-00000000000a') ->> 'app_role', 'admin',
  'and the hook gives B with the B row''s role');
select is(app.tenant_switch_min_interval(), interval '3 seconds', 'the interval is three seconds');

-- 2. AT3: no active membership → 42501 and nothing written ----------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act('b0000000-0000-4000-8000-00000000000b', '5e550000-0000-4000-8000-00000000000b');
select throws_ok($$ select public.select_tenant('11111111-1111-4111-8111-111111111111') $$, '42501', 'not_a_member',
  'a tenant where the caller has no membership is refused');
select throws_ok($$ select public.select_tenant(gen_random_uuid()) $$, '42501', 'not_a_member', 'an unknown tenant gets the same answer');
select pg_temp.act('a0000000-0000-4000-8000-00000000000a', '5e550000-0000-4000-8000-0000000000a2');
select throws_ok($$ select public.select_tenant('33333333-3333-4333-8333-333333333333') $$, '42501', 'not_a_member',
  'an inactive membership is refused');
reset role;
select is((select count(*)::int from app.session_tenant where session_id in ('5e550000-0000-4000-8000-00000000000b', '5e550000-0000-4000-8000-0000000000a2')), 0,
  'none of the refusals wrote a row');

-- 3. Sessions that may not select ------------------------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act('90000000-0000-4000-8000-000000000001', '5e550000-0000-4000-8000-000000000091', 'pin');
select throws_ok($$ select public.select_tenant('11111111-1111-4111-8111-111111111111') $$, '42501', 'not_a_member', 'a PIN session cannot select');
select pg_temp.act('90000000-0000-4000-8000-000000000001', '5e550000-0000-4000-8000-000000000092');
select throws_ok($$ select public.select_tenant('11111111-1111-4111-8111-111111111111') $$, '42501', 'not_a_member',
  'nor a PIN login whose token lost its login claim');
select pg_temp.act('a0000000-0000-4000-8000-00000000000a', null);
select throws_ok($$ select public.select_tenant('11111111-1111-4111-8111-111111111111') $$, 'P0001', 'session_missing', 'a token without session_id is refused');
select pg_temp.act('a0000000-0000-4000-8000-00000000000a', 'not-a-uuid');
select throws_ok($$ select public.select_tenant('11111111-1111-4111-8111-111111111111') $$, 'P0001', 'session_missing', 'and so is a malformed one');
reset role;

-- 4. my_memberships ----------------------------------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act('a0000000-0000-4000-8000-00000000000a', '5e550000-0000-4000-8000-00000000000a');
select is(public.my_memberships(), '[{"tenantId": "11111111-1111-4111-8111-111111111111", "name": "Osteria Demo A", "role": "owner"},
  {"tenantId": "22222222-2222-4222-8222-222222222222", "name": "Osteria Demo B", "role": "admin"}]'::jsonb,
  'my_memberships lists only the caller''s active memberships, by tenant name, with exactly tenantId, name and role');
select pg_temp.act('d0000000-0000-4000-8000-00000000000d', '5e550000-0000-4000-8000-0000000000dd');
select is(public.my_memberships(), '[]'::jsonb, 'a login with no membership gets an empty list');
reset role;

-- 5. Privileges and shape -----------------------------------------------------------------------------------------------------------------------
select ok(has_function_privilege('authenticated', 'public.select_tenant(uuid)', 'execute'), 'select_tenant is executable by authenticated');
select ok(not has_function_privilege('anon', 'public.select_tenant(uuid)', 'execute') and not has_function_privilege('service_role', 'public.select_tenant(uuid)', 'execute'),
  'and by neither anon nor service_role');
select ok(has_function_privilege('authenticated', 'public.my_memberships()', 'execute'), 'my_memberships is executable by authenticated');
select ok(not has_function_privilege('anon', 'public.my_memberships()', 'execute') and not has_function_privilege('service_role', 'public.my_memberships()', 'execute'),
  'and by neither anon nor service_role');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('select_tenant', 'my_memberships')
             and p.prosecdef and p.proconfig @> array['search_path=""']), 2, 'both are definers with search_path = ''''');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('select_tenant', 'my_memberships')
             and p.proacl::text ~ '[{,]=X/'), 0, 'neither is executable by PUBLIC');
select ok(not has_function_privilege('anon', 'app.tenant_switch_min_interval()', 'execute'), 'the interval function is not executable by anon');

select * from finish();
rollback;
