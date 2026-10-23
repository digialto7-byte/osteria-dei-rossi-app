-- M11 step 8 (migration 20261025100700_staff_session.sql): staff_session_active() and end_my_staff_session().
-- Acceptance test 7 (database half): a PIN session stops working at the cut-off, and on revocation, device
-- lock, PIN reset or deactivation; email sessions are not affected.
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare
  state text;
  msg text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text;
  return state || ' ' || msg;
end
$$;
-- Claims of a PIN user n with auth session S (login pin), or of an email user (no login claim).
create function pg_temp.as_pin(n int, p_session uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', ('90000000-0000-4000-8000-' || lpad(n::text, 12, '0')), 'role', 'authenticated',
    'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'waiter', 'login', 'pin',
    'session_id', p_session)::text, true) $$;
create function pg_temp.as_email(auth_id uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', '11111111-1111-4111-8111-111111111111',
    'app_role', app_role, 'session_id', gen_random_uuid())::text, true) $$;

insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Cuoco Email');
-- PIN waiters 1..5.
insert into auth.users (id, email)
  select ('90000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'staff-' || n || '@staff.invalid' from generate_series(1, 5) n;
insert into public.app_user (id, tenant_id, auth_id, role, display_name, login_method)
  select ('91000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, '11111111-1111-4111-8111-111111111111',
         ('90000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'waiter', 'Cameriere Demo ' || n, 'pin'
    from generate_series(1, 5) n;
insert into public.venue_device (id, tenant_id, label, token_hash, created_by)
  select ('d0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, '11111111-1111-4111-8111-111111111111',
         'Dispositivo ' || n || ' (demo)', repeat(to_hex(n), 64), 'a1000000-0000-4000-8000-00000000000a'
    from generate_series(1, 4) n;
-- Session n belongs to user n on device 1 (users 1..3), device 2 (user 4), device 4 (user 5).
insert into public.staff_session (id, tenant_id, app_user_id, device_id, auth_session_id, started_at, ends_at)
  select ('57000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, '11111111-1111-4111-8111-111111111111',
         ('91000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
         ('d0000000-0000-4000-8000-' || lpad((case when n <= 3 then 1 when n = 4 then 2 else 4 end)::text, 12, '0'))::uuid,
         ('5e000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, now() - interval '1 hour', now() + interval '1 day'
    from generate_series(1, 5) n;
-- A session that ended its day already.
insert into public.staff_session (id, tenant_id, app_user_id, device_id, auth_session_id, started_at, ends_at) values
  ('57000000-0000-4000-8000-0000000000f1', '11111111-1111-4111-8111-111111111111', '91000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-0000000000f1', now() - interval '3 hours', now() - interval '1 second');

-- Fake clock ---------------------------------------------------------------------------------------------------------------------
insert into public.staff_session (id, tenant_id, app_user_id, device_id, auth_session_id, started_at, ends_at) values
  ('57000000-0000-4000-8000-0000000000f2', '11111111-1111-4111-8111-111111111111', '91000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-0000000000f2', '2026-10-24T22:00:00Z', '2026-10-25T00:00:00Z');
select is(app.staff_session_open('5e000000-0000-4000-8000-0000000000f2', '91000000-0000-4000-8000-000000000001', '2026-10-24T23:59:59Z'), true, 'one second before the cut-off: open');
select is(app.staff_session_open('5e000000-0000-4000-8000-0000000000f2', '91000000-0000-4000-8000-000000000001', '2026-10-25T00:00:00Z'), false, 'at the cut-off: closed');

-- staff_session_active ---------------------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_pin(1, '5e000000-0000-4000-8000-000000000001');
select is(public.staff_session_active(), true, 'an open session ending tomorrow: active');
select pg_temp.as_pin(1, '5e000000-0000-4000-8000-0000000000f1');
select is(public.staff_session_active(), false, 'a session that ended its day: not active');
select pg_temp.as_pin(1, gen_random_uuid());
select is(public.staff_session_active(), false, 'an unknown session id: not active');
select pg_temp.as_pin(2, '5e000000-0000-4000-8000-000000000001');
select is(public.staff_session_active(), false, 'another user''s session id: not active');
select set_config('request.jwt.claims', json_build_object('sub', '90000000-0000-4000-8000-000000000001', 'role', 'authenticated',
  'tenant_id', '11111111-1111-4111-8111-111111111111', 'login', 'pin')::text, true);
select is(public.staff_session_active(), false, 'a pin token without session_id: not active');
select pg_temp.as_email('c0000000-0000-4000-8000-00000000000c', 'chef');
select is(public.staff_session_active(), true, 'email claims (no login claim): active');
select pg_temp.as_email('a0000000-0000-4000-8000-00000000000a', 'owner');
select is(public.staff_session_active(), true, 'the owner: active');

-- Revocation ends the session at once -----------------------------------------------------------------------------------------------------
select pg_temp.as_pin(4, '5e000000-0000-4000-8000-000000000004');
select is(public.staff_session_active(), true, 'user 4 is active before the revocation');
select pg_temp.as_email('a0000000-0000-4000-8000-00000000000a', 'owner');
select lives_ok($$ select public.revoke_device('d0000000-0000-4000-8000-000000000002') $$, 'the owner revokes the device');
select pg_temp.as_pin(4, '5e000000-0000-4000-8000-000000000004');
select is(public.staff_session_active(), false, 'after revoke_device: not active');
reset role;
select is((select end_reason::text from public.staff_session where id = '57000000-0000-4000-8000-000000000004'), 'device_revoked', 'ended with device_revoked');

-- The device lock of step 5 (20 failures) ends it too -------------------------------------------------------------------------------------------
insert into public.auth_attempt (tenant_id, device_id, app_user_id, outcome, started_at, finished_at)
  select '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-000000000004', null, 'failure',
         clock_timestamp() - interval '10 minutes' + g * interval '1 second', clock_timestamp() from generate_series(1, 19) g;
select is(public.pin_login_finish((public.pin_login_begin(repeat('4', 64), '91000000-0000-4000-8000-000000000003') ->> 'attemptId')::uuid, 'failure', null) ->> 'status',
  'device_locked', 'the 20th failure locks device 4');
set local role authenticated;
select pg_temp.as_pin(5, '5e000000-0000-4000-8000-000000000005');
select is(public.staff_session_active(), false, 'after the device lock: not active');
reset role;

-- A PIN reset ends the user's sessions ------------------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_pin(2, '5e000000-0000-4000-8000-000000000002');
select is(public.staff_session_active(), true, 'user 2 active before the reset');
select pg_temp.as_email('a0000000-0000-4000-8000-00000000000a', 'owner');
select lives_ok($$ select public.record_pin_change('91000000-0000-4000-8000-000000000002') $$, 'the owner resets user 2''s PIN');
select pg_temp.as_pin(2, '5e000000-0000-4000-8000-000000000002');
select is(public.staff_session_active(), false, 'after the reset: not active');

-- Deactivation ----------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.as_pin(3, '5e000000-0000-4000-8000-000000000003');
select is(public.staff_session_active(), true, 'user 3 active before deactivation');
select pg_temp.as_email('a0000000-0000-4000-8000-00000000000a', 'owner');
select lives_ok($$ select public.update_staff('91000000-0000-4000-8000-000000000003', null, null, false) $$, 'the owner deactivates user 3');
select pg_temp.as_pin(3, '5e000000-0000-4000-8000-000000000003');
select is(public.staff_session_active(), false, 'after deactivation: not active');

-- end_my_staff_session -------------------------------------------------------------------------------------------------------------------------------------
reset role;
insert into public.staff_session (id, tenant_id, app_user_id, device_id, auth_session_id, ends_at) values
  ('57000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', '91000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-0000000000a1', now() + interval '1 day');
set local role authenticated;
select pg_temp.as_pin(1, '5e000000-0000-4000-8000-0000000000a1');
select is(public.staff_session_active(), true, 'a fresh session is active');
select lives_ok('select public.end_my_staff_session()', 'end_my_staff_session runs');
select is(public.staff_session_active(), false, 'and the session is over');
select pg_temp.as_email('c0000000-0000-4000-8000-00000000000c', 'chef');
select lives_ok('select public.end_my_staff_session()', 'for an email session it is a no-op');
reset role;
select is((select end_reason::text from public.staff_session where id = '57000000-0000-4000-8000-0000000000a1'), 'logout', 'the PIN session ended with logout');
select is((select count(*)::int from public.staff_session where end_reason = 'logout'), 1, 'and nothing else was touched');

select is((select count(*)::int from unnest(array['anon', 'service_role']) r(role),
                unnest(array['public.staff_session_active()', 'public.end_my_staff_session()']) f(name)
           where has_function_privilege(r.role, f.name, 'execute')), 0, 'anon and service_role cannot execute');
select ok(has_function_privilege('authenticated', 'public.staff_session_active()', 'execute')
      and has_function_privilege('authenticated', 'public.end_my_staff_session()', 'execute'), 'authenticated can');

select * from finish();
rollback;
