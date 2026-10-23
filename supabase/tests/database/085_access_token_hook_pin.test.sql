-- M11 step 6 (migration 20261025100500_access_token_hook_pin.sql): the access token hook for PIN accounts.
-- Email users (owner, admin, every existing fixture) get exactly the M0 claims. A PIN account gets tenant claims
-- only through our flow: a password sign-in with a fresh pending attempt, or a refresh of an open staff session.
-- Acceptance tests 1 and 7 (database half). The hook is called directly (as in 003); the grants are asserted.
begin;
create extension if not exists pgtap with schema extensions;
select plan(48);

insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Cuoco Email');
-- PIN users 1 (waiter), 2 (waiter, inactive), 3 (chef).
insert into auth.users (id, email) values
  ('90000000-0000-4000-8000-000000000001', 'staff-1@staff.invalid'),
  ('90000000-0000-4000-8000-000000000002', 'staff-2@staff.invalid'),
  ('90000000-0000-4000-8000-000000000003', 'staff-3@staff.invalid');
insert into public.app_user (id, tenant_id, auth_id, role, display_name, login_method, is_active, deactivated_at) values
  ('91000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '90000000-0000-4000-8000-000000000001', 'waiter', 'Cameriere Demo', 'pin', true, null),
  ('91000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', '90000000-0000-4000-8000-000000000002', 'waiter', 'Cameriere Demo Due', 'pin', true, null),
  ('91000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', '90000000-0000-4000-8000-000000000003', 'chef', 'Cuoco Demo', 'pin', true, null);
insert into public.venue_device (id, tenant_id, label, token_hash, created_by) values
  ('d0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Telefono sala (demo)', repeat('1', 64), 'a1000000-0000-4000-8000-00000000000a'),
  ('d0000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Tablet cucina (demo)', repeat('2', 64), 'a1000000-0000-4000-8000-00000000000a'),
  ('d0000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Altro (demo)', repeat('3', 64), 'a1000000-0000-4000-8000-00000000000a');

create function pg_temp.ev(p_auth uuid, p_method text, p_session uuid default gen_random_uuid(), p_extra jsonb default '{}')
  returns jsonb language sql as $$
  select jsonb_build_object('user_id', p_auth, 'authentication_method', p_method,
    'claims', jsonb_build_object('sub', p_auth, 'role', 'authenticated', 'session_id', p_session) || p_extra) $$;
create function pg_temp.claims(p_event jsonb) returns jsonb language sql as $$
  select app.custom_access_token_hook(p_event) -> 'claims' $$;
create function pg_temp.keys(p_claims jsonb) returns text language sql as $$
  select string_agg(k, ',' order by k) from jsonb_object_keys(p_claims) k $$;
create function pg_temp.w1(p_method text, p_session uuid default gen_random_uuid(), p_extra jsonb default '{}')
  returns jsonb language sql as $$
  select pg_temp.claims(pg_temp.ev('90000000-0000-4000-8000-000000000001', p_method, p_session, p_extra)) $$;

-- Email users: the M0 claims, whatever the method -------------------------------------------------------------------------
select is(pg_temp.keys(pg_temp.claims(pg_temp.ev('a0000000-0000-4000-8000-00000000000a', 'password'))),
  'app_role,role,session_id,sub,tenant_id', 'owner, password: exactly the M0 claims');
select is(pg_temp.keys(pg_temp.claims(pg_temp.ev('a0000000-0000-4000-8000-00000000000a', 'otp'))),
  'app_role,role,session_id,sub,tenant_id', 'owner, otp: exactly the M0 claims');
select is(pg_temp.keys(pg_temp.claims(pg_temp.ev('c0000000-0000-4000-8000-00000000000c', 'token_refresh'))),
  'app_role,role,session_id,sub,tenant_id', 'email chef, token_refresh: exactly the M0 claims');
select is(pg_temp.claims(pg_temp.ev('c0000000-0000-4000-8000-00000000000c', 'password')) ->> 'app_role', 'chef', 'with the right role');
select is(pg_temp.keys(pg_temp.claims(pg_temp.ev('c0000000-0000-4000-8000-00000000000c', 'password', gen_random_uuid(),
    '{"login": "pin", "session_state": "ok", "tenant_id": "99999999-9999-4999-8999-999999999999"}'))),
  'app_role,role,session_id,sub,tenant_id', 'forged login and session_state claims are removed for an email user');
select is(pg_temp.claims(pg_temp.ev('c0000000-0000-4000-8000-00000000000c', 'password', gen_random_uuid(),
    '{"tenant_id": "99999999-9999-4999-8999-999999999999"}')) ->> 'tenant_id', '11111111-1111-4111-8111-111111111111',
  'and a forged tenant_id is replaced by the real one');

-- PIN password sign-in: only with a pending attempt under 30 s -----------------------------------------------------------------
select is(pg_temp.keys(pg_temp.w1('password')), 'role,session_id,session_state,sub', 'no attempt: no tenant claims, session_state added');
select is(pg_temp.w1('password') ->> 'session_state', 'ended', 'and session_state is ended');
insert into public.auth_attempt (id, tenant_id, device_id, app_user_id, started_at)
  values ('a7000000-0000-4000-8000-0000000000a7', '11111111-1111-4111-8111-111111111111',
          'd0000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', clock_timestamp() - interval '31 seconds');
select ok(not (pg_temp.w1('password') ? 'tenant_id'), 'a pending attempt older than 30 s: no tenant claims');
update public.auth_attempt set outcome = 'failure', finished_at = now() where id = 'a7000000-0000-4000-8000-0000000000a7';
insert into public.auth_attempt (id, tenant_id, device_id, app_user_id, started_at)
  values ('a8000000-0000-4000-8000-0000000000a8', '11111111-1111-4111-8111-111111111111',
          'd0000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', clock_timestamp() - interval '5 seconds');
select is(pg_temp.keys(pg_temp.w1('password')), 'app_role,login,role,session_id,sub,tenant_id',
  'a pending attempt under 30 s: tenant_id, app_role and login');
select is(pg_temp.w1('password') ->> 'tenant_id', '11111111-1111-4111-8111-111111111111', 'the tenant');
select is(pg_temp.w1('password') ->> 'app_role', 'waiter', 'the role comes from the user row');
select is(pg_temp.w1('password') ->> 'login', 'pin', 'and login is pin');
select ok(not (pg_temp.claims(pg_temp.ev('90000000-0000-4000-8000-000000000003', 'password')) ? 'tenant_id'),
  'another PIN user without an attempt gets nothing (the attempt belongs to user 1)');
update public.venue_device set locked_at = now() where id = 'd0000000-0000-4000-8000-000000000001';
select ok(not (pg_temp.w1('password') ? 'tenant_id'), 'a pending attempt on a locked device: no tenant claims');
update public.venue_device set locked_at = null where id = 'd0000000-0000-4000-8000-000000000001';
update public.venue_device set revoked_at = now(), revoked_by = 'a1000000-0000-4000-8000-00000000000a' where id = 'd0000000-0000-4000-8000-000000000001';
select ok(not (pg_temp.w1('password') ? 'tenant_id'), 'and on a revoked device');
select is(pg_temp.w1('password') ->> 'session_state', 'ended', 'with session_state ended');
update public.auth_attempt set outcome = 'failure', finished_at = now() where id = 'a8000000-0000-4000-8000-0000000000a8';

-- Refresh of an open staff session (AT7) -----------------------------------------------------------------------------------------
insert into public.staff_session (id, tenant_id, app_user_id, device_id, auth_session_id, ends_at) values
  ('57000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '91000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-000000000002', '5e000000-0000-4000-8000-000000000001', clock_timestamp() + interval '1 hour');
select is(pg_temp.keys(pg_temp.w1('token_refresh', '5e000000-0000-4000-8000-000000000001')), 'app_role,login,role,session_id,sub,tenant_id',
  'a refresh with a matching open session carries the claims');
select is(pg_temp.w1('token_refresh', '5e000000-0000-4000-8000-000000000001') ->> 'login', 'pin', 'login pin');
select is(pg_temp.w1('token_refresh', '5e000000-0000-4000-8000-000000000002') ->> 'session_state', 'ended',
  'an unknown session id: session_state ended');
select ok(not (pg_temp.claims(pg_temp.ev('90000000-0000-4000-8000-000000000003', 'token_refresh', '5e000000-0000-4000-8000-000000000001')) ? 'tenant_id'),
  'another user''s session id: stripped');
select ok(not (pg_temp.w1('otp', '5e000000-0000-4000-8000-000000000001') ? 'tenant_id'), 'method otp for a PIN user: stripped');
select ok(not (pg_temp.w1('magiclink', '5e000000-0000-4000-8000-000000000001') ? 'tenant_id'), 'method magiclink: stripped');
select ok(not (pg_temp.w1('password', '5e000000-0000-4000-8000-000000000001') ? 'tenant_id'),
  'a password sign-in cannot ride on an existing session (no fresh attempt)');
select ok(not (pg_temp.w1('token_refresh', '5e000000-0000-4000-8000-000000000001', '{"login": "pin", "tenant_id": "11111111-1111-4111-8111-111111111111", "app_role": "owner"}') ->> 'app_role' = 'owner'),
  'a forged app_role in the incoming claims never survives');
select ok(not (pg_temp.w1('otp', gen_random_uuid(), '{"login": "pin", "tenant_id": "11111111-1111-4111-8111-111111111111", "app_role": "waiter"}') ?| array['tenant_id', 'app_role', 'login']),
  'forged tenant, role and login claims are stripped when the gate refuses');

-- app.staff_session_open with a fake clock --------------------------------------------------------------------------------------------
insert into public.staff_session (id, tenant_id, app_user_id, device_id, auth_session_id, started_at, ends_at) values
  ('57000000-0000-4000-8000-000000000009', '11111111-1111-4111-8111-111111111111', '91000000-0000-4000-8000-000000000003',
   'd0000000-0000-4000-8000-000000000003', '5e000000-0000-4000-8000-000000000009', '2026-10-24T22:00:00Z', '2026-10-25T00:00:00Z');
select is(app.staff_session_open('5e000000-0000-4000-8000-000000000009', '91000000-0000-4000-8000-000000000003', '2026-10-24T23:59:59Z'), true,
  'one second before ends_at: open');
select is(app.staff_session_open('5e000000-0000-4000-8000-000000000009', '91000000-0000-4000-8000-000000000003', '2026-10-25T00:00:00Z'), false,
  'at ends_at: closed');
select is(app.staff_session_open('5e000000-0000-4000-8000-000000000009', '91000000-0000-4000-8000-000000000001', '2026-10-24T23:00:00Z'), false,
  'another user''s id: closed');
-- A session already past its end (fixture, real clock).
insert into public.staff_session (id, tenant_id, app_user_id, device_id, auth_session_id, started_at, ends_at) values
  ('57000000-0000-4000-8000-000000000008', '11111111-1111-4111-8111-111111111111', '91000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-000000000002', '5e000000-0000-4000-8000-000000000008', now() - interval '2 hours', now() - interval '1 hour');
select is(pg_temp.w1('token_refresh', '5e000000-0000-4000-8000-000000000008') ->> 'session_state', 'ended', 'a refresh past ends_at: session_state ended');
-- Ended, device locked, device revoked, user inactive.
update public.staff_session set ended_at = now(), end_reason = 'logout' where id = '57000000-0000-4000-8000-000000000001';
select is(pg_temp.w1('token_refresh', '5e000000-0000-4000-8000-000000000001') ->> 'session_state', 'ended', 'an ended session: session_state ended');
insert into public.staff_session (id, tenant_id, app_user_id, device_id, auth_session_id, ends_at) values
  ('57000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', '91000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-000000000002', '5e000000-0000-4000-8000-000000000004', now() + interval '1 hour');
select is(pg_temp.keys(pg_temp.w1('token_refresh', '5e000000-0000-4000-8000-000000000004')), 'app_role,login,role,session_id,sub,tenant_id', 'a fresh open session works');
update public.venue_device set locked_at = now() where id = 'd0000000-0000-4000-8000-000000000002';
select is(pg_temp.w1('token_refresh', '5e000000-0000-4000-8000-000000000004') ->> 'session_state', 'ended', 'device locked: ended');
update public.venue_device set locked_at = null where id = 'd0000000-0000-4000-8000-000000000002';
update public.venue_device set revoked_at = now(), revoked_by = 'a1000000-0000-4000-8000-00000000000a' where id = 'd0000000-0000-4000-8000-000000000002';
select is(pg_temp.w1('token_refresh', '5e000000-0000-4000-8000-000000000004') ->> 'session_state', 'ended', 'device revoked: ended');
insert into public.staff_session (id, tenant_id, app_user_id, device_id, auth_session_id, ends_at) values
  ('57000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', '91000000-0000-4000-8000-000000000002',
   'd0000000-0000-4000-8000-000000000003', '5e000000-0000-4000-8000-000000000005', now() + interval '1 hour');
select is(pg_temp.claims(pg_temp.ev('90000000-0000-4000-8000-000000000002', 'token_refresh', '5e000000-0000-4000-8000-000000000005')) ->> 'login', 'pin',
  'user 2 is active: its refresh works');
update public.app_user set is_active = false, deactivated_at = now() where id = '91000000-0000-4000-8000-000000000002';
select is(pg_temp.claims(pg_temp.ev('90000000-0000-4000-8000-000000000002', 'token_refresh', '5e000000-0000-4000-8000-000000000005')) ->> 'session_state', 'ended',
  'user inactive: ended');

-- Grants ------------------------------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r(role)
           where has_function_privilege(r.role, 'app.custom_access_token_hook(jsonb)', 'execute')), 0, 'no API role can call the hook');
select ok(has_function_privilege('supabase_auth_admin', 'app.custom_access_token_hook(jsonb)', 'execute'), 'supabase_auth_admin can');
select ok(has_function_privilege('supabase_auth_admin', 'app.staff_session_open(uuid,uuid,timestamptz)', 'execute')
      and has_function_privilege('supabase_auth_admin', 'app.pin_sign_in_allowed(uuid,timestamptz)', 'execute'),
  'and the two helpers the hook calls');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r(role),
                unnest(array['app.staff_session_open(uuid,uuid,timestamptz)', 'app.pin_sign_in_allowed(uuid,timestamptz)']) f(name)
           where has_function_privilege(r.role, f.name, 'execute')), 0, 'no API role can execute the helpers');

-- Fail-safe: a bug in the PIN branch never blocks an owner login --------------------------------------------------------------------------------
create or replace function app.staff_session_open(p_auth_session uuid, p_user uuid, p_at timestamptz) returns boolean
  language plpgsql as $$ begin return (1 / 0) > 0; end $$;
create or replace function app.pin_sign_in_allowed(p_user uuid, p_at timestamptz) returns boolean
  language plpgsql as $$ begin return (1 / 0) > 0; end $$;
select lives_ok($$ select pg_temp.w1('token_refresh', '5e000000-0000-4000-8000-000000000004') $$, 'a PIN refresh with a failing check does not raise');
select ok(not (pg_temp.w1('token_refresh', '5e000000-0000-4000-8000-000000000004') ? 'tenant_id'), 'and carries no tenant claims');
select is(pg_temp.w1('token_refresh', '5e000000-0000-4000-8000-000000000004') ->> 'session_state', 'ended', 'and says ended');
select lives_ok($$ select pg_temp.w1('password') $$, 'a PIN password sign-in with a failing check does not raise');
select ok(not (pg_temp.w1('password') ? 'tenant_id'), 'and carries no tenant claims');
select is(pg_temp.claims(pg_temp.ev('a0000000-0000-4000-8000-00000000000a', 'password')) ->> 'app_role', 'owner', 'an owner event is unaffected');
select is(pg_temp.claims(pg_temp.ev('c0000000-0000-4000-8000-00000000000c', 'token_refresh')) ->> 'tenant_id', '11111111-1111-4111-8111-111111111111', 'so is an email chef');
select is(pg_temp.claims(pg_temp.ev('d0000000-0000-4000-8000-0000000000dd', 'password')) -> 'tenant_id', null, 'and an unknown user gets no claims');

select * from finish();
rollback;
