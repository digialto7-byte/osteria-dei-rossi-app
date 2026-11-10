-- Reservations A5b (docs/plans/1998-11-08-reservations.md §5c, founder Q-R16): bookings typed by staff. Owner, admin and waiter create a booking that is already accepted, with
-- source 'staff' and no privacy acknowledgement; staff are not bound by the lead time, the horizon, the online maximum, the limits, the grid or the throttle; the date must be today
-- or later and the time must belong to the named service; tables are optional and checked like an accept. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(56);

create function pg_temp.go(stmt text) returns text language plpgsql as $$
declare
  v_out text;
  state text;
  msg text;
  det text;
begin
  execute stmt into v_out;
  return v_out;
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text, det = pg_exception_detail;
  return state || ' ' || msg || coalesce(' ' || nullif(det, ''), '');
end
$$;
-- The twin as the waiter of A, with a fixed now (1998-11-10 10:00Z unless given).
create function pg_temp.mk(p_body jsonb, p_now text default '1998-11-10 10:00+00', p_role text default 'waiter') returns text language sql as $$
  select pg_temp.go(format('select app.create_staff_reservation_at(%L, %L, %L, %L::jsonb, %L::timestamptz)::text', '11111111-1111-4111-8111-111111111111', 'd1000000-0000-4000-8000-00000000000d', p_role,
         jsonb_build_object('date', '1998-11-20', 'time', '20:00', 'serviceKey', 'cena', 'party', 4, 'name', 'Cliente Demo', 'phone', '+39 000 0000001') || p_body, p_now))
$$;
create function pg_temp.call(p_role text, stmt text) returns text language plpgsql as $$
declare
  v_out text;
  state text;
  v_auth uuid;
begin
  v_auth := case p_role when 'owner' then 'a0000000-0000-4000-8000-00000000000a' when 'admin' then 'f0000000-0000-4000-8000-00000000000f'
                        when 'waiter' then 'd0000000-0000-4000-8000-00000000000d' else 'c0000000-0000-4000-8000-00000000000c' end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated', 'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', p_role)::text, true);
  set local role authenticated;
  execute stmt into v_out;
  reset role;
  return v_out;
exception when others then
  get stacked diagnostics state = returned_sqlstate;
  reset role;
  return state;
end
$$;

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'), ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'), ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'), ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'), ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('13000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Tavolo 1 (demo)', 1, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('13000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Tavolo 2 (demo)', 2, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('13000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Tavolo 3 (demo)', 3, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('23000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Tavolo B (demo)', 1, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.table_group (tenant_id, id, name, seats, created_by) values ('11111111-1111-4111-8111-111111111111', 'e5000000-0000-4000-8000-000000000001', 'T1+T3', 6, 'a1000000-0000-4000-8000-00000000000a');
insert into public.table_group_member (tenant_id, table_group_id, dining_table_id) values
  ('11111111-1111-4111-8111-111111111111', 'e5000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000001'),
  ('11111111-1111-4111-8111-111111111111', 'e5000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000003');
delete from vault.secrets where name = 'reservation_hash_salt'; -- the local seed (B1) already holds a fake value
select vault.create_secret('test-salt-0123456789-abcdef', 'reservation_hash_salt');

-- A booking by the waiter -----------------------------------------------------------------------------------------------------------------------------------------
create temp table c1 as select pg_temp.mk('{"name": "  Cliente Demo  ", "phone": "+39 000 0000001", "email": "Cliente.Demo@Example.com", "locale": "en"}')::jsonb as j;
select is((select j ->> 'status' from c1), 'accepted', 'a staff booking is created accepted');
select is((select j ->> 'source' from c1), 'staff', 'with source staff');
select is((select status::text || ',' || source || ',' || (privacy_notice_version is null)::text || ',' || (privacy_ack_at is null)::text from public.reservation where id = (select (j ->> 'id')::uuid from c1)), 'accepted,staff,true,true', 'stored the same way, with no privacy acknowledgement');
select is((select starts_at::text || ',' || ends_at::text || ',' || business_date || ',' || service_key || ',' || party from public.reservation where id = (select (j ->> 'id')::uuid from c1)),
          '1998-11-20 19:00:00+00,1998-11-20 21:00:00+00,1998-11-20,cena,4', 'the slot: 20:00 Rome is 19:00Z, the stay is 120 minutes');
select is((select name || ',' || phone || ',' || email || ',' || locale from public.reservation_contact where reservation_id = (select (j ->> 'id')::uuid from c1)), 'Cliente Demo,390000000001,cliente.demo@example.com,en', 'the contact: trimmed name, phone digits, lower-case e-mail, the locale');
select is((select kind || ',' || (created_by = 'd1000000-0000-4000-8000-00000000000d')::text from public.reservation_event where reservation_id = (select (j ->> 'id')::uuid from c1) order by seq limit 1), 'created_by_staff,true', 'a created_by_staff event by the waiter');
select is((select data from public.reservation_event where reservation_id = (select (j ->> 'id')::uuid from c1) and kind = 'created_by_staff'), '{"party": 4, "serviceKey": "cena", "businessDate": "1998-11-20"}'::jsonb, 'with codes only');
select is((select kind || ',' || status from public.reservation_email where reservation_id = (select (j ->> 'id')::uuid from c1)), 'accepted,queued', 'with an e-mail address, an accepted e-mail is queued');
select is((select j ->> 'changed' from c1), 'true', 'the reply says changed');
select is((select (j ? 'emailStatus') from c1), false, 'the waiter''s reply has no emailStatus');
select is((select (j ? 'suggestion') from c1), false, 'and no suggestion');

-- No e-mail address -----------------------------------------------------------------------------------------------------------------------------------------------
create temp table c2 as select pg_temp.mk('{"phone": "+39 000 0000002"}')::jsonb as j;
select is((select j ->> 'status' from c2), 'accepted', 'a booking without an e-mail address is accepted');
select is((select count(*)::int from public.reservation_email where reservation_id = (select (j ->> 'id')::uuid from c2)), 0, 'and queues no e-mail');
select is((select (email is null)::text || ',' || locale from public.reservation_contact where reservation_id = (select (j ->> 'id')::uuid from c2)), 'true,it', 'the contact has no e-mail and the default locale it');
select is(pg_temp.mk('{"email": null}')::jsonb ->> 'status', 'accepted', 'an explicit null e-mail is the same');
select is(pg_temp.mk('{"email": "no-at-sign"}'), 'P0001 request_invalid {"reason": "email"}', 'a given e-mail is checked');

-- The limits staff are not bound by -------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.mk('{"party": 12, "time": "13:05", "serviceKey": "pranzo", "date": "1998-11-20"}', '1998-11-20 11:30+00')::jsonb ->> 'status', 'accepted', 'party 12 at 13:05, 25 minutes of lead time, off the grid: ok');
select is(pg_temp.mk('{"time": "19:40"}')::jsonb ->> 'status', 'accepted', 'off the 15-minute grid: ok');
select is(pg_temp.mk('{"date": "2000-11-20", "time": "20:00"}')::jsonb ->> 'status', 'accepted', 'beyond the horizon: ok');
select is(pg_temp.mk('{"party": 99}')::jsonb ->> 'status', 'accepted', 'party 99: ok');
select is(pg_temp.mk('{"party": 100}'), 'P0001 request_invalid {"reason": "party"}', 'party 100 is refused');
select is(pg_temp.mk('{"party": 0}'), 'P0001 request_invalid {"reason": "party"}', 'party 0 is refused');
select app.set_reservation_settings_at('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a',
  '{"services": [{"key": "cena", "online": true, "firstSeating": "19:30", "lastSeating": "22:00", "coversPerSlot": null, "reservationsPerSlot": 1, "coversPerService": 5}], "closedDates": ["1998-12-01"]}', '1998-11-10 10:00+00');
select is(pg_temp.mk('{"date": "1998-11-23", "time": "20:30", "party": 6}')::jsonb ->> 'status', 'accepted', 'a per-service limit of 5 covers does not stop a party of 6');
select is(pg_temp.mk('{"date": "1998-11-23", "time": "20:30", "party": 2}')::jsonb ->> 'status', 'accepted', 'nor a second booking in a slot limited to one');
select is(pg_temp.mk('{"date": "1998-12-01", "time": "20:30"}')::jsonb ->> 'status', 'accepted', 'nor a closed date');
select is(pg_temp.go(format('select app.request_reservation_at(%L, %L::jsonb, %L, %L)::text', '11111111-1111-4111-8111-111111111111',
          '{"date": "1998-11-23", "serviceKey": "cena", "time": "20:30", "party": 2, "name": "Cliente Due Demo", "phone": "+39 000 0000009", "email": "cliente.due@example.com", "locale": "it", "privacyNoticeVersion": "v1"}', '203.0.113.5', '1998-11-10 10:00+00')),
          'P0001 slot_unavailable {"reason": "slot_limit"}', 'but the staff bookings count against the online limits');
select is((select count(*)::int from app.reservation_throttle), 0, 'staff bookings touch no throttle counter');
-- An online request without an e-mail is still refused.
select is(pg_temp.go(format('select app.request_reservation_at(%L, %L::jsonb, %L, %L)::text', '11111111-1111-4111-8111-111111111111',
          '{"date": "1998-11-24", "serviceKey": "cena", "time": "20:30", "party": 2, "name": "Cliente Due Demo", "phone": "+39 000 0000009", "email": null, "locale": "it", "privacyNoticeVersion": "v1"}', '203.0.113.6', '1998-11-10 10:00+00')),
          'P0001 request_invalid {"reason": "email"}', 'an online request without an e-mail is still refused (reason email)');

-- Date and service ------------------------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.mk('{"date": "1998-11-09"}'), 'P0001 date_past', 'yesterday is date_past');
select is(pg_temp.mk('{"date": "1998-11-10", "time": "20:00"}')::jsonb ->> 'status', 'accepted', 'today is ok');
select is(pg_temp.mk('{"time": "16:00", "serviceKey": "pranzo"}'), 'P0001 service', '16:00 does not belong to pranzo: service');
select is(pg_temp.mk('{"time": "20:00", "serviceKey": "s_unknown000"}'), 'P0001 service', 'an unknown service key is service');
select is(pg_temp.mk('{"date": "1999-03-28", "time": "02:30", "serviceKey": "pranzo"}'), 'P0001 slot_unavailable {"reason": "dst_gap"}', 'a time that does not exist (the spring gap) is refused');
select is(pg_temp.mk('{"date": "1998-02-30"}'), 'P0001 request_invalid {"reason": "date"}', 'a date that does not exist is refused');
select is(pg_temp.mk('{"time": "7pm"}'), 'P0001 request_invalid {"reason": "time"}', 'a malformed time is refused');
select is(pg_temp.mk('{"name": ""}'), 'P0001 request_invalid {"reason": "name"}', 'an empty name is refused');
select is(pg_temp.mk('{"phone": "12"}'), 'P0001 request_invalid {"reason": "phone"}', 'a short phone is refused');
select is(pg_temp.mk('{"locale": "fr"}'), 'P0001 request_invalid {"reason": "locale"}', 'a locale other than it and en is refused');

-- Tables ------------------------------------------------------------------------------------------------------------------------------------------------------------
select is((pg_temp.mk('{"date": "1998-12-05", "tableIds": ["13000000-0000-4000-8000-000000000002"]}')::jsonb) -> 'tables' -> 0 ->> 'name', 'Tavolo 2 (demo)', 'a booking with a table');
select is((select kind from public.reservation_event where reservation_id in (select id from public.reservation where business_date = '1998-12-05') order by seq desc limit 1), 'tables_assigned', 'and a tables_assigned event');
select is(pg_temp.mk('{"date": "1998-12-05", "time": "20:30", "tableIds": ["13000000-0000-4000-8000-000000000002"]}'), 'P0001 table_taken', 'the same table at an overlapping time is table_taken');
select is((select count(*)::int from public.reservation where business_date = '1998-12-05'), 1, 'and nothing was written for it');
select is(pg_temp.mk('{"date": "1998-12-05", "time": "21:00", "tableIds": ["23000000-0000-4000-8000-000000000001"]}'), 'P0002 table_not_found', 'tenant B''s table is table_not_found');
select is((pg_temp.mk('{"date": "1998-12-06", "groupId": "e5000000-0000-4000-8000-000000000001"}')::jsonb) ->> 'groupName', 'T1+T3', 'a group books both its tables');

-- Strict body -------------------------------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.mk('{"note": "allergia"}'), '22023 invalid_request', 'a note is not accepted (22023)');
select is(pg_temp.mk('{"extra": 1}'), '22023 invalid_request', 'an unknown key is 22023');
select is(pg_temp.go(format('select app.create_staff_reservation_at(%L, %L, %L, %L::jsonb, %L::timestamptz)::text', '11111111-1111-4111-8111-111111111111', 'd1000000-0000-4000-8000-00000000000d', 'waiter',
          '{"date": "1998-11-20", "time": "20:00", "serviceKey": "cena", "party": 4, "name": "Cliente Demo"}', '1998-11-10 10:00+00')), '22023 invalid_request', 'a body without the phone is 22023');

-- Roles (the public wrapper) ----------------------------------------------------------------------------------------------------------------------------------------
create temp table real_day as select to_char((now() at time zone 'Europe/Rome')::date + 5, 'YYYY-MM-DD') as d;
select is(pg_temp.call('waiter', format($$ select public.create_staff_reservation(%L::jsonb)::text $$, jsonb_build_object('date', (select d from real_day), 'time', '13:05', 'serviceKey', 'pranzo', 'party', 12, 'name', 'Cliente Demo', 'phone', '+39 000 0000003'))) like '{%', true, 'the waiter creates a booking');
select is(pg_temp.call('owner', format($$ select public.create_staff_reservation(%L::jsonb)::text $$, jsonb_build_object('date', (select d from real_day), 'time', '13:15', 'serviceKey', 'pranzo', 'party', 2, 'name', 'Cliente Demo', 'phone', '+39 000 0000004'))) like '{%', true, 'the owner too');
select is(pg_temp.call('admin', format($$ select public.create_staff_reservation(%L::jsonb)::text $$, jsonb_build_object('date', (select d from real_day), 'time', '13:30', 'serviceKey', 'pranzo', 'party', 2, 'name', 'Cliente Demo', 'phone', '+39 000 0000005'))) like '{%', true, 'and the admin');
select is(pg_temp.call('chef', format($$ select public.create_staff_reservation(%L::jsonb)::text $$, jsonb_build_object('date', (select d from real_day), 'time', '13:45', 'serviceKey', 'pranzo', 'party', 2, 'name', 'Cliente Demo', 'phone', '+39 000 0000006'))), '42501', 'the chef gets 42501');
select is(pg_temp.call('chef', $$ select public.create_staff_reservation('"garbage"'::jsonb)::text $$), '42501', 'before the body is read');

-- Immutable source, definer rules ---------------------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from public.reservation where source = 'staff' and privacy_ack_at is null), (select count(*)::int from public.reservation where source = 'staff'), 'no staff booking carries a privacy acknowledgement');
select throws_ok($$ update public.reservation set source = 'online' where source = 'staff' $$, 'P0001', 'reservation_immutable', 'source cannot be updated');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'create_staff_reservation' and p.prosecdef and p.proconfig @> array['search_path=""']
            and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('service_role', p.oid, 'execute')), 1, 'the public function is a definer with an empty search_path, for authenticated only');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'create_staff_reservation_at' and p.prosecdef and p.proconfig @> array['search_path=""']
            and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('service_role', p.oid, 'execute')), 1, 'the twin is closed to every API role');

select * from finish();
rollback;
