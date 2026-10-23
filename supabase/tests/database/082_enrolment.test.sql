-- M11 step 3 (migration 20261025100200_enrolment.sql): enrolment code creation and redemption, and the device
-- staff list. Acceptance test 4 (database half): a reused or expired code is refused (410 in the API), and the
-- redemption is rate limited per hashed IP. The redeem and staff-list procedures are service_role only (D1-A).
begin;
create extension if not exists pgtap with schema extensions;
select plan(43);

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
create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('c2000000-0000-4000-8000-0000000000c2', 'staff-c2@staff.invalid'),
  ('d2000000-0000-4000-8000-0000000000d2', 'staff-d2@staff.invalid'),
  ('d3000000-0000-4000-8000-0000000000d3', 'staff-d3@staff.invalid'),
  ('b2000000-0000-4000-8000-0000000000b2', 'staff-b2@staff.invalid'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT00000000001');
insert into public.app_user (id, tenant_id, auth_id, role, display_name, login_method, is_active, deactivated_at) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo', 'email', true, null),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo', 'email', true, null),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Cuoco Email', 'email', true, null),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Email', 'email', true, null),
  ('c3000000-0000-4000-8000-0000000000c3', '11111111-1111-4111-8111-111111111111', 'c2000000-0000-4000-8000-0000000000c2', 'chef', 'Cuoco Demo', 'pin', true, null),
  ('d4000000-0000-4000-8000-0000000000d4', '11111111-1111-4111-8111-111111111111', 'd2000000-0000-4000-8000-0000000000d2', 'waiter', 'Cameriere Demo', 'pin', true, null),
  ('d5000000-0000-4000-8000-0000000000d5', '11111111-1111-4111-8111-111111111111', 'd3000000-0000-4000-8000-0000000000d3', 'waiter', 'Cameriere Demo Due', 'pin', false, now()),
  ('b3000000-0000-4000-8000-0000000000b3', '22222222-2222-4222-8222-222222222222', 'b2000000-0000-4000-8000-0000000000b2', 'waiter', 'Cameriere Demo B', 'pin', true, null),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare Demo B', 'email', true, null);

-- create_enrolment_code ----------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
create temporary table made (name text primary key, res jsonb);
grant all on made to authenticated;
insert into made select 'owner', public.create_enrolment_code(repeat('1', 64), '  Telefono sala (demo)  ');
select is(made.res ->> 'label', 'Telefono sala (demo)', 'the owner creates a code; the label is trimmed') from made where name = 'owner';
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select lives_ok($$ select public.create_enrolment_code(repeat('2', 64), 'Tablet cucina (demo)') $$, 'an admin can create a code');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(left(pg_temp.err($$ select public.create_enrolment_code(repeat('3', 64), 'x') $$), 5), '42501', 'a chef is refused');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(left(pg_temp.err($$ select public.create_enrolment_code(repeat('3', 64), 'x') $$), 5), '42501', 'a waiter is refused');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.err($$ select public.create_enrolment_code(repeat('3', 64), '') $$), 'P0001 label_invalid', 'an empty label is refused');
select is(pg_temp.err($$ select public.create_enrolment_code(repeat('3', 64), '   ') $$), 'P0001 label_invalid', 'a blank label is refused');
select is(pg_temp.err(format($$ select public.create_enrolment_code(repeat('3', 64), %L) $$, repeat('x', 61))),
  'P0001 label_invalid', 'a 61-character label is refused');
select is(left(pg_temp.err($$ select public.create_enrolment_code('XYZ', 'x') $$), 5), '22023', 'a bad hash is refused');
select is(left(pg_temp.err($$ select public.create_enrolment_code(repeat('A', 64), 'x') $$), 5), '22023', 'upper-case hex is refused');
select is(left(pg_temp.err($$ select public.create_enrolment_code(repeat('1', 64), 'x') $$), 5), '23505', 'a hash collision is a unique violation');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is((select count(id)::int from public.device_enrolment), 0, 'owner B sees none of A''s codes');
select lives_ok($$ select public.create_enrolment_code(repeat('4', 64), 'Telefono B (demo)') $$, 'owner B creates a code in B');
reset role;

select is((select tenant_id::text from public.device_enrolment where code_hash = repeat('4', 64)),
  '22222222-2222-4222-8222-222222222222', 'the tenant comes from the session');
select is((select created_by::text from public.device_enrolment where code_hash = repeat('1', 64)),
  'a1000000-0000-4000-8000-00000000000a', 'created_by is the caller');
select ok((select expires_at - created_at between interval '14 minutes 59 seconds' and interval '15 minutes 1 second'
             from public.device_enrolment where code_hash = repeat('1', 64)) is not false
      and (select expires_at > clock_timestamp() + interval '14 minutes'
             and expires_at <= clock_timestamp() + interval '15 minutes'
             from public.device_enrolment where code_hash = repeat('1', 64)),
  'the code expires in 15 minutes');
select is((select after::text from public.audit_event where action = 'device_enrolment.created' and tenant_id = '11111111-1111-4111-8111-111111111111' order by created_at limit 1),
  '{"label": "Telefono sala (demo)"}', 'audit device_enrolment.created holds the label only');
select is((select count(*)::int from public.audit_event where action = 'device_enrolment.created'), 3, 'three creations audited');

-- redeem_enrolment_code_at ---------------------------------------------------------------------------------------
-- Fixed codes with known expiry: C1 valid, C2 used twice, C3 expired.
insert into public.device_enrolment (id, tenant_id, label, code_hash, expires_at, created_by) values
  ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', 'Telefono sala (demo)',
   repeat('a', 64), '2026-10-24T19:15:00Z', 'a1000000-0000-4000-8000-00000000000a'),
  ('e3000000-0000-4000-8000-0000000000e3', '11111111-1111-4111-8111-111111111111', 'Tablet cucina (demo)',
   repeat('b', 64), '2026-10-24T19:15:00Z', 'f1000000-0000-4000-8000-00000000000f');
create temporary table r (name text primary key, res jsonb);
insert into r select 'ok', app.redeem_enrolment_code_at(repeat('a', 64), repeat('7', 64), repeat('9', 64), '2026-10-24T19:10:00Z');
select is((select res ->> 'status' from r where name = 'ok'), 'ok', 'a valid code is redeemed');
select is((select res ->> 'label' from r where name = 'ok'), 'Telefono sala (demo)', 'and returns the label');
select is((select count(*)::int from public.venue_device where token_hash = repeat('7', 64)
            and tenant_id = '11111111-1111-4111-8111-111111111111' and label = 'Telefono sala (demo)'
            and created_by = 'a1000000-0000-4000-8000-00000000000a'), 1,
  'one venue_device in tenant A, created by the code''s creator');
select is((select used_at is not null and device_id = (select id from public.venue_device where token_hash = repeat('7', 64))
             from public.device_enrolment where code_hash = repeat('a', 64)), true, 'the code is marked used by that device');
select is((select enrolment_id = 'e1000000-0000-4000-8000-0000000000e1' from public.venue_device where token_hash = repeat('7', 64)),
  true, 'and the device points at its code');
select is((select created_by::text || ' ' || after::text from public.audit_event where action = 'venue_device.enrolled'),
  'a1000000-0000-4000-8000-00000000000a {"label": "Telefono sala (demo)"}', 'audit venue_device.enrolled by the code creator');
select is(app.redeem_enrolment_code_at(repeat('a', 64), repeat('6', 64), repeat('9', 64), '2026-10-24T19:11:00Z') ->> 'status',
  'code_used', 'the same code again: code_used');
select is(app.redeem_enrolment_code_at(repeat('b', 64), repeat('5', 64), repeat('9', 64), '2026-10-24T19:15:01Z') ->> 'status',
  'code_expired', 'one second past expiry: code_expired');
select is(app.redeem_enrolment_code_at(repeat('b', 64), repeat('5', 64), repeat('9', 64), '2026-10-24T19:15:00Z') ->> 'status',
  'code_expired', 'exactly at expiry: code_expired');
select is(app.redeem_enrolment_code_at(repeat('e', 64), repeat('5', 64), repeat('9', 64), '2026-10-24T19:12:00Z') ->> 'status',
  'code_invalid', 'an unknown code: code_invalid');
select is((select count(*)::int from public.venue_device), 1, 'only the first redemption created a device');

-- The IP limit: 10 failures per hash in 15 minutes ----------------------------------------------------------------------
delete from app.enrol_failure;
select is((select count(*)::int from generate_series(1, 10) g,
                lateral app.redeem_enrolment_code_at(repeat('e', 64), repeat('5', 64), repeat('8', 64),
                  '2026-10-24T20:00:00Z'::timestamptz + g * interval '1 second') s
           where s ->> 'status' = 'code_invalid'), 10, 'ten failures from one IP are answered normally');
select is(app.redeem_enrolment_code_at(repeat('b', 64), repeat('4', 64), repeat('8', 64), '2026-10-24T19:00:00Z' ::timestamptz + interval '1 hour 1 minute' ) ->> 'status',
  'rate_limited', 'the 11th is rate_limited');
select is((select used_at is null from public.device_enrolment where code_hash = repeat('b', 64)), true,
  'and a code presented while limited is not consumed');
select is((select count(*)::int from app.enrol_failure where ip_hash = repeat('8', 64)), 10,
  'a limited call records no further failure');
select is(app.redeem_enrolment_code_at(repeat('b', 64), repeat('4', 64), repeat('7', 64), '2026-10-24T20:01:30Z') ->> 'status',
  'code_expired', 'a different IP hash is not limited (this code has expired by then)');
insert into public.device_enrolment (tenant_id, label, code_hash, expires_at, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'Tablet cucina (demo)', repeat('d', 64), '2026-10-24T21:00:00Z',
   'a1000000-0000-4000-8000-00000000000a');
select is(app.redeem_enrolment_code_at(repeat('d', 64), repeat('3', 64), repeat('8', 64), '2026-10-24T20:15:11Z') ->> 'status',
  'ok', '15 minutes after the failures the IP is accepted again');

-- device_staff_list --------------------------------------------------------------------------------------------------------
create temporary table l (name text primary key, res jsonb);
insert into l select 'ok', public.device_staff_list(repeat('7', 64));
select is((select res ->> 'status' from l where name = 'ok'), 'ok', 'a known device lists its staff');
select is((select string_agg(e ->> 'displayName' || ':' || (e ->> 'role'), ',' order by e ->> 'displayName')
             from l, jsonb_array_elements(res -> 'staff') e where name = 'ok'),
  'Cameriere Demo:waiter,Cuoco Demo:chef',
  'only active pin chefs and waiters of the device''s tenant (no owner, no email staff, no inactive, no tenant B)');
select is((select (res -> 'staff' -> 0) ?& array['id', 'displayName', 'role'] and jsonb_object_keys_count = 3
             from l, lateral (select count(*) jsonb_object_keys_count from jsonb_object_keys(res -> 'staff' -> 0)) k where name = 'ok'),
  true, 'each entry has id, displayName and role only');
select is(public.device_staff_list(repeat('0', 64)) ->> 'status', 'unknown', 'an unknown token hash: unknown');
update public.venue_device set revoked_at = now(), revoked_by = 'a1000000-0000-4000-8000-00000000000a' where token_hash = repeat('7', 64);
select is(public.device_staff_list(repeat('7', 64)) ->> 'status', 'revoked', 'a revoked device: revoked');

-- Execute grants -------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from unnest(array['anon', 'authenticated']) r(role),
                unnest(array['public.redeem_enrolment_code(text,text,text)', 'public.device_staff_list(text)']) f(name)
           where has_function_privilege(r.role, f.name, 'execute')), 0, 'anon and authenticated cannot execute redeem or staff list');
select ok(has_function_privilege('service_role', 'public.redeem_enrolment_code(text,text,text)', 'execute')
      and has_function_privilege('service_role', 'public.device_staff_list(text)', 'execute'),
  'service_role can');
select ok(has_function_privilege('authenticated', 'public.create_enrolment_code(text,text)', 'execute')
      and not has_function_privilege('anon', 'public.create_enrolment_code(text,text)', 'execute')
      and not has_function_privilege('service_role', 'public.create_enrolment_code(text,text)', 'execute'),
  'create_enrolment_code is for authenticated only');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r(role),
                unnest(array['app.require_staff_manager()', 'app.redeem_enrolment_code_at(text,text,text,timestamptz)']) f(name)
           where has_function_privilege(r.role, f.name, 'execute')), 0, 'no API role executes the app.* helpers');
select * from finish();
rollback;
