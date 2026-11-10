-- Reservations A3 (docs/plans/1998-11-08-reservations.md §3.2, §3.3, §5 A3; ADR-032): the slots and the request core. Tenant A, Europe/Rome, cut-off 02:00, the default
-- services; Cena online 19:00-21:30, slot 15, lead 120, horizon 60, max 8, reservationsPerSlot 2; the Vault salt is created in the test (T-R5); p_now is always fixed.
-- Fake data only (Osteria Demo A, Cliente Demo, cliente.demo@example.com, +39 000 0000001, documentation IP addresses).
begin;
create extension if not exists pgtap with schema extensions;
select plan(104);

create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare
  state text;
  msg text;
  det text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text, det = pg_exception_detail;
  return state || ' ' || msg || coalesce(' ' || nullif(det, ''), '');
end
$$;

insert into auth.users (id, email) values ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'), ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('13000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Tavolo 1 (demo)', 1, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('13000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Tavolo 2 (demo)', 2, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');

create temp sequence n;
-- The settings of the fixture, and the Vault salt (T-R5: a secret can be created inside the test transaction).
select app.set_reservation_settings_at('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a',
  '{"services": [{"key": "cena", "online": true, "firstSeating": "19:00", "lastSeating": "21:30", "coversPerSlot": null, "reservationsPerSlot": 2, "coversPerService": null}]}', '1998-11-08 10:00+00');
delete from vault.secrets where name = 'reservation_hash_salt'; -- the local seed (B1) already holds a fake value
select vault.create_secret('test-salt-0123456789-abcdef', 'reservation_hash_salt');

-- A request as the route would build it: every field has a unique default so that the throttle never interferes, unless a test fixes the field.
create function pg_temp.rq(p_over jsonb default '{}', p_now timestamptz default '1998-11-08 10:00+00', p_tenant uuid default '11111111-1111-4111-8111-111111111111', p_ip text default null) returns text language plpgsql as $$
declare
  k bigint := nextval('n');
  v_body jsonb;
  v_out text;
  state text;
  msg text;
  det text;
begin
  v_body := jsonb_build_object('date', '1998-11-20', 'serviceKey', 'cena', 'time', '20:00', 'party', 2, 'name', 'Cliente Demo', 'phone', '+39 000 ' || lpad(k::text, 7, '0'),
                               'email', 'cliente' || k || '@example.com', 'locale', 'it', 'privacyNoticeVersion', 'v1') || p_over;
  execute format('select app.request_reservation_at(%L, %L::jsonb, %L, %L)::text', p_tenant, v_body, coalesce(p_ip, '203.0.113.' || (10 + k % 200)), p_now) into v_out;
  return v_out;
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text, det = pg_exception_detail;
  return state || ' ' || msg || coalesce(' ' || nullif(det, ''), '');
end
$$;
create function pg_temp.slot_err(p_reason text) returns text language sql as $$ select 'P0001 slot_unavailable {"reason": "' || p_reason || '"}' $$;

-- Helpers exist ------------------------------------------------------------------------------------------------------------------------------------------
select is(to_regprocedure('extensions.hmac(text,text,text)') is not null, true, 'T-R3: extensions.hmac exists after the migration (pgcrypto)');
select is(app.reservation_limits(), '{"ip": 5, "email": 3, "phone": 3, "pendingPerTenant": 100}'::jsonb, 'the limits are 5 per IP, 3 per e-mail, 3 per phone, 100 pending (Q-R7)');
select is(length(app.reservation_hash('ip', '1998-11-08', '203.0.113.1')), 64, 'a hash is 64 hex digits');
select is(app.reservation_hash('ip', '1998-11-08', '203.0.113.1'), app.reservation_hash('ip', '1998-11-08', '203.0.113.1'), 'and stable for the same kind, day and value');
select isnt(app.reservation_hash('ip', '1998-11-08', '203.0.113.1'), app.reservation_hash('ip', '1998-11-09', '203.0.113.1'), 'the next day gives another hash (unlinkable across days)');
select isnt(app.reservation_hash('ip', '1998-11-08', 'x'), app.reservation_hash('email', '1998-11-08', 'x'), 'and another kind too');

-- Slots ------------------------------------------------------------------------------------------------------------------------------------------------------
create temp table sl as select app.reservation_slots_json('11111111-1111-4111-8111-111111111111', '1998-11-20', 2, '1998-11-08 10:00+00') as j;
select is((select j ->> 'date' from sl), '1998-11-20', 'slots: the date');
select is((select j -> 'closed' from sl), 'false'::jsonb, 'slots: not closed');
select is((select jsonb_agg(s ->> 'key' order by o) from sl, jsonb_array_elements(j -> 'services') with ordinality t(s, o)), '["pranzo", "cena"]'::jsonb, 'slots: the online services, in M25c order');
select is((select jsonb_array_length(s -> 'slots') from sl, jsonb_array_elements(j -> 'services') s where s ->> 'key' = 'cena'), 11, 'Cena has 11 slots, 19:00 to 21:30');
select is((select (s -> 'slots' -> 0)::text || (s -> 'slots' -> 10)::text from sl, jsonb_array_elements(j -> 'services') s where s ->> 'key' = 'cena'), '{"time": "19:00", "available": true}{"time": "21:30", "available": true}', 'the first and last Cena slots');
select is((select jsonb_array_length(s -> 'slots') from sl, jsonb_array_elements(j -> 'services') s where s ->> 'key' = 'pranzo'), 9, 'Pranzo has 9 slots from the Q-R5 defaults, 12:00 to 14:00');
select is((select array_agg(distinct k order by k) from sl, jsonb_array_elements(j -> 'services') s, jsonb_array_elements(s -> 'slots') x, jsonb_object_keys(x) k), array['available', 'time'], 'a slot carries no count: only time and available');
select is((select (s -> 'slots' -> 0 ->> 'available')::boolean from sl, jsonb_array_elements(j -> 'services') s where s ->> 'key' = 'cena'), true, 'a free slot is available');

-- A valid request ---------------------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.rq('{"name": "Cliente Demo", "phone": "+39 000 0000001", "email": "Cliente.Demo@Example.com"}'), '{"status": "received"}', 'a valid request answers exactly {status: received}');
select is((select status::text || ',' || business_date || ',' || service_key || ',' || party || ',' || source from public.reservation), 'pending,1998-11-20,cena,2,online', 'one pending online reservation, on its business date, in Cena');
select is((select ends_at - starts_at from public.reservation), interval '120 minutes', 'ends_at is the start plus the 120-minute stay');
select is((select starts_at from public.reservation), '1998-11-20 19:00+00'::timestamptz, '20:00 in Europe/Rome on 1998-11-20 (CET) is 19:00Z');
select is((select privacy_notice_version || ',' || (privacy_ack_at = '1998-11-08 10:00+00')::text from public.reservation), 'v1,true', 'the privacy notice version and the acknowledgement instant (p_now) are stored');
select is((select phone || ',' || email || ',' || name || ',' || locale from public.reservation_contact), '390000000001,cliente.demo@example.com,Cliente Demo,it', 'one contact: phone digits only, e-mail lower-case');
select is((select kind || ',' || (created_by is null)::text from public.reservation_event), 'requested,true', 'one requested event, by the customer (no user)');
select is((select data from public.reservation_event), '{"party": 2, "serviceKey": "cena", "businessDate": "1998-11-20"}'::jsonb, 'the event carries codes, the party and the date, never personal data');
select is((select kind || ',' || status from public.reservation_email), 'received,queued', 'one received e-mail, queued');
select is((select count(*)::int from public.reservation_email e join public.reservation r on r.id = e.reservation_id and r.tenant_id = e.tenant_id), 1, 'tied to the reservation');

-- Each reason -------------------------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.rq('{"time": "21:45"}'), pg_temp.slot_err('seating'), '21:45 is after the last seating');
select is(pg_temp.rq('{"time": "18:45"}'), pg_temp.slot_err('seating'), '18:45 is before the first seating');
select is(pg_temp.rq('{"time": "21:30", "party": 1}') like 'P0001%', false, '21:30 is the last seating: accepted');
select is(pg_temp.rq('{"time": "19:10"}'), pg_temp.slot_err('grid'), '19:10 is off the 15-minute grid');
select is(pg_temp.rq('{"time": "19:15"}'), '{"status": "received"}', '19:15 is on the grid');
select is(pg_temp.rq('{"time": "20:00"}', '1998-11-20 17:01+00'), pg_temp.slot_err('lead'), 'lead: p_now = start minus 119 minutes is inside the lead time');
select is(pg_temp.rq('{"time": "20:00"}', '1998-11-20 17:00+00'), '{"status": "received"}', 'lead: start minus 120 minutes is ok');
select is(pg_temp.rq('{"date": "1998-11-20", "time": "21:15"}', '1998-09-21 10:00+00'), '{"status": "received"}', 'horizon: day 60 is ok');
select is(pg_temp.rq('{"date": "1998-11-21", "time": "19:30"}', '1998-09-21 10:00+00'), pg_temp.slot_err('horizon'), 'horizon: day 61 is refused');
select is(pg_temp.rq('{"party": 8, "time": "19:45"}'), '{"status": "received"}', 'party 8 (the maximum) is ok');
select is(pg_temp.rq('{"party": 9, "time": "19:45"}'), pg_temp.slot_err('party'), 'party 9 is refused');
select is(pg_temp.rq('{"serviceKey": "pranzo", "time": "20:00"}'), pg_temp.slot_err('service'), 'pranzo at 20:00 is the wrong service');
select is(pg_temp.rq('{"serviceKey": "s_unknown000", "time": "20:00"}'), pg_temp.slot_err('service'), 'an unknown service key is refused the same way');
select is(pg_temp.rq('{"date": "1998-11-22", "time": "20:00"}'), '{"status": "received"}', 'a Sunday is open by default');

-- Per-slot limit: reservationsPerSlot 2 --------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.rq('{"time": "21:00"}'), '{"status": "received"}', 'slot limit: the first request in 21:00');
select is(pg_temp.rq('{"time": "21:00"}'), '{"status": "received"}', 'the second is ok (n - 1)');
select is(pg_temp.rq('{"time": "21:00"}'), pg_temp.slot_err('slot_limit'), 'the third is refused (n)');
select is((select (x ->> 'available')::boolean from (select jsonb_array_elements(s -> 'slots') x from jsonb_array_elements(app.reservation_slots_json('11111111-1111-4111-8111-111111111111', '1998-11-20', 2, '1998-11-08 10:00+00') -> 'services') s where s ->> 'key' = 'cena') y where x ->> 'time' = '21:00'),
          false, 'and the slot list shows 21:00 as unavailable');
select is(pg_temp.rq('{"time": "21:15"}', '1998-11-08 10:00+00') like 'P0001%', false, 'another slot of the same service is still free');
update public.reservation set status = 'declined' where id = (select id from public.reservation where starts_at = '1998-11-20 20:00+00' order by created_at limit 1);
select is(pg_temp.rq('{"time": "21:00"}'), '{"status": "received"}', 'a declined booking frees its place in the slot');

-- Per-service limit: coversPerService 10 on 1998-11-24 ---------------------------------------------------------------------------------------------------------
select app.set_reservation_settings_at('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a',
  '{"services": [{"key": "cena", "online": true, "firstSeating": "19:00", "lastSeating": "21:30", "coversPerSlot": null, "reservationsPerSlot": 2, "coversPerService": 10}]}', '1998-11-08 10:00+00');
select is(pg_temp.rq('{"date": "1998-11-24", "party": 8, "time": "19:00"}'), '{"status": "received"}', 'service limit 10: 8 covers booked');
select is(pg_temp.rq('{"date": "1998-11-24", "party": 3, "time": "19:30"}'), pg_temp.slot_err('service_limit'), '8 booked + 3 is over the limit');
select is(pg_temp.rq('{"date": "1998-11-24", "party": 2, "time": "19:30"}'), '{"status": "received"}', '8 booked + 2 is exactly the limit: ok');
select app.set_reservation_settings_at('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a',
  '{"services": [{"key": "cena", "online": true, "firstSeating": "19:00", "lastSeating": "21:30", "coversPerSlot": 4, "reservationsPerSlot": null, "coversPerService": null}]}', '1998-11-08 10:00+00');
select is(pg_temp.rq('{"date": "1998-11-25", "party": 3, "time": "19:00"}'), '{"status": "received"}', 'covers per slot 4: 3 covers booked');
select is(pg_temp.rq('{"date": "1998-11-25", "party": 2, "time": "19:00"}'), pg_temp.slot_err('slot_limit'), '3 + 2 covers in one slot is over 4');
select is(pg_temp.rq('{"date": "1998-11-25", "party": 1, "time": "19:00"}'), '{"status": "received"}', '3 + 1 covers is exactly 4: ok');
select app.set_reservation_settings_at('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a',
  '{"services": [{"key": "cena", "online": true, "firstSeating": "19:00", "lastSeating": "21:30", "coversPerSlot": null, "reservationsPerSlot": 2, "coversPerService": null}]}', '1998-11-08 10:00+00');

-- Closed days ------------------------------------------------------------------------------------------------------------------------------------------------
select app.set_reservation_settings_at('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', '{"closedWeekdays": [5]}', '1998-11-08 10:00+00');
select is(pg_temp.rq('{"date": "1998-11-20", "time": "19:00"}'), pg_temp.slot_err('closed'), 'a request on a closed weekday (Friday) is refused');
select is((app.reservation_slots_json('11111111-1111-4111-8111-111111111111', '1998-11-20', 2, '1998-11-08 10:00+00') -> 'closed'), 'true'::jsonb, 'slots: closed on a closed weekday');
select is(jsonb_array_length(app.reservation_slots_json('11111111-1111-4111-8111-111111111111', '1998-11-20', 2, '1998-11-08 10:00+00') -> 'services'), 0, 'with no service listed');
select is((app.reservation_slots_json('11111111-1111-4111-8111-111111111111', '1998-11-21', 2, '1998-11-08 10:00+00') -> 'closed'), 'false'::jsonb, 'Saturday is open');
select app.set_reservation_settings_at('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', '{"closedWeekdays": [], "closedDates": ["1998-11-21"]}', '1998-11-08 10:00+00');
select is(pg_temp.rq('{"date": "1998-11-21", "time": "19:00"}'), pg_temp.slot_err('closed'), 'a closed date is refused');
select is((app.reservation_slots_json('11111111-1111-4111-8111-111111111111', '1998-11-21', 2, '1998-11-08 10:00+00') -> 'closed'), 'true'::jsonb, 'and shown closed');
select is((app.reservation_slots_json('11111111-1111-4111-8111-111111111111', '1998-11-20', 2, '1998-11-08 10:00+00') -> 'closed'), 'false'::jsonb, 'the day before is open');
select app.set_reservation_settings_at('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', '{"closedDates": []}', '1998-11-08 10:00+00');

-- Table fit --------------------------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.rq('{"date": "1998-11-26", "party": 6, "time": "19:00"}'), '{"status": "received"}', 'with no seats configured anywhere, party 6 is accepted');
select app.set_table_booking_at('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', '{"tables": [{"tableId": "13000000-0000-4000-8000-000000000001", "bookable": true, "seats": 4}]}');
select is(pg_temp.rq('{"date": "1998-11-26", "party": 6, "time": "19:15"}'), pg_temp.slot_err('no_fit'), 'a bookable table with 4 seats and party 6: no fit');
select is(pg_temp.rq('{"date": "1998-11-26", "party": 4, "time": "19:15"}'), '{"status": "received"}', 'party 4 fits');
select app.create_table_group_at('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', '{"name": "T1+T2", "seats": 6, "tableIds": ["13000000-0000-4000-8000-000000000001", "13000000-0000-4000-8000-000000000002"]}');
select is(pg_temp.rq('{"date": "1998-11-26", "party": 6, "time": "19:30"}'), '{"status": "received"}', 'an active group of 6 seats makes party 6 fit');

-- Time zones and the spring gap --------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.rq('{"date": "1999-03-26", "time": "20:00"}', '1999-03-01 10:00+00'), '{"status": "received"}', 'CET: a request for 1999-03-26 20:00');
select is((select starts_at from public.reservation where business_date = '1999-03-26'), '1999-03-26 19:00+00'::timestamptz, '20:00 CET is 19:00Z');
select is(pg_temp.rq('{"date": "1999-03-29", "time": "20:00"}', '1999-03-01 10:00+00'), '{"status": "received"}', 'CEST: a request for 1999-03-29 20:00');
select is((select starts_at from public.reservation where business_date = '1999-03-29'), '1999-03-29 18:00+00'::timestamptz, '20:00 CEST is 18:00Z');
select app.set_reservation_settings_at('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a',
  '{"services": [{"key": "pranzo", "online": true, "firstSeating": "02:30", "lastSeating": "03:30", "coversPerSlot": null, "reservationsPerSlot": null, "coversPerService": null}]}', '1999-03-01 10:00+00');
select is(pg_temp.rq('{"date": "1999-03-28", "serviceKey": "pranzo", "time": "02:30"}', '1999-03-01 10:00+00'), pg_temp.slot_err('dst_gap'), '02:30 on 1999-03-28 does not exist (the clocks jump 02:00 to 03:00)');
select is(pg_temp.rq('{"date": "1999-03-28", "serviceKey": "pranzo", "time": "03:30"}', '1999-03-01 10:00+00'), '{"status": "received"}', 'while 03:30 exists');
select is(pg_temp.rq('{"date": "1999-03-27", "serviceKey": "pranzo", "time": "02:30"}', '1999-03-01 10:00+00'), '{"status": "received"}', 'and 02:30 the day before exists');

-- The throttle ---------------------------------------------------------------------------------------------------------------------------------------------------
select is((select string_agg((pg_temp.rq(jsonb_build_object('date', '1998-12-0' || g, 'time', '19:00'), '1998-11-08 10:00+00', '11111111-1111-4111-8111-111111111111', '203.0.113.200') like 'P0001%')::text, ',' order by g)
             from generate_series(1, 5) g), 'false,false,false,false,false', 'five requests from one IP are ok');
select is(pg_temp.rq('{"date": "1998-12-06", "time": "19:00"}', '1998-11-08 10:00+00', '11111111-1111-4111-8111-111111111111', '203.0.113.200'), 'P0001 rate_limited', 'the sixth is rate_limited (no detail)');
select is(pg_temp.rq('{"date": "1998-12-06", "time": "19:00"}', '1998-11-08 10:00+00', '11111111-1111-4111-8111-111111111111', '203.0.113.201'), '{"status": "received"}', 'another IP is not');
select is(pg_temp.rq('{"date": "1998-12-06", "time": "19:15"}', '1998-11-09 10:00+00', '11111111-1111-4111-8111-111111111111', '203.0.113.200'), '{"status": "received"}', 'the next local day resets the counter');
select is((select max(hits) from app.reservation_throttle where kind = 'ip' and day = '1998-11-08'), 5, 'the IP counter stopped at 5 (the refused sixth rolled back)');
select is((select string_agg((pg_temp.rq(jsonb_build_object('date', '1998-12-07', 'time', case g when 1 then '19:00' when 2 then '19:15' else '19:30' end, 'email', case g when 1 then 'Dup@Example.com' when 2 then 'dup@example.com' else ' DUP@example.com ' end)) like 'P0001%')::text, ',' order by g) from generate_series(1, 3) g),
          'false,false,false', 'e-mail: three requests (case and spaces ignored) are ok');
select is(pg_temp.rq('{"date": "1998-12-07", "time": "19:45", "email": "dup@example.com"}'), 'P0001 rate_limited', 'the fourth for the same e-mail is rate_limited');
select is((select string_agg((pg_temp.rq(jsonb_build_object('date', '1998-12-08', 'time', case g when 1 then '19:00' when 2 then '19:15' else '19:30' end, 'phone', case g when 1 then '+39 000 0000555' when 2 then '390000000555' else '+39-000-0000555' end)) like 'P0001%')::text, ',' order by g) from generate_series(1, 3) g),
          'false,false,false', 'phone: +39 000 0000555 and 390000000555 are the same number: three ok');
select is(pg_temp.rq('{"date": "1998-12-08", "time": "19:45", "phone": "390000000555"}'), 'P0001 rate_limited', 'the fourth for the same phone is rate_limited');
select is((select count(*)::int from app.reservation_throttle where tenant_id = '11111111-1111-4111-8111-111111111111' and key_hash !~ '^[0-9a-f]{64}$'), 0, 'every throttle key is a hash');
select is((select count(*)::int from (select r::text t from public.reservation r union all select c::text from public.reservation_contact c union all select e::text from public.reservation_event e
                                      union all select m::text from public.reservation_email m union all select h::text from app.reservation_throttle h) x where t like '%203.0.113.%'), 0, 'no table holds a raw IP');
select is((select count(*)::int from information_schema.columns where table_schema in ('public', 'app') and (table_name like 'reservation%') and column_name ~* '(^|_)ip($|_)'), 0, 'and no column is named after an IP');

-- Fields, strict keys, no personal data in errors -----------------------------------------------------------------------------------------------------------------
select is(pg_temp.rq('{"extra": 1}'), '22023 invalid_request', 'an extra key is 22023');
select is(pg_temp.err($$ select app.request_reservation_at('11111111-1111-4111-8111-111111111111', '{"date":"1998-11-20"}', null, '1998-11-08 10:00+00') $$), '22023 invalid_request', 'a missing key is 22023');
select is(pg_temp.rq('{"email": null}'), 'P0001 request_invalid {"reason": "email"}', 'an online request without an e-mail is refused (reason email)');
select is(pg_temp.rq('{"email": "no-at-sign"}'), 'P0001 request_invalid {"reason": "email"}', 'an invalid e-mail is refused');
select is(pg_temp.rq('{"phone": "12"}'), 'P0001 request_invalid {"reason": "phone"}', 'a too-short phone is refused');
select is(pg_temp.rq('{"phone": "abc"}'), 'P0001 request_invalid {"reason": "phone"}', 'a phone with letters is refused');
select is(pg_temp.rq('{"name": ""}'), 'P0001 request_invalid {"reason": "name"}', 'an empty name is refused');
select is(pg_temp.rq(jsonb_build_object('name', repeat('x', 81))), 'P0001 request_invalid {"reason": "name"}', 'an 81-character name is refused');
select is(pg_temp.rq('{"party": 0}'), 'P0001 request_invalid {"reason": "party"}', 'party 0 is refused');
select is(pg_temp.rq('{"party": 100}'), 'P0001 request_invalid {"reason": "party"}', 'party 100 is refused');
select is(pg_temp.rq('{"locale": "fr"}'), 'P0001 request_invalid {"reason": "locale"}', 'a locale other than it and en is refused');
select is(pg_temp.rq('{"date": "1998-02-30"}'), 'P0001 request_invalid {"reason": "date"}', 'a date that does not exist is refused');
select is(pg_temp.rq('{"time": "7pm"}'), 'P0001 request_invalid {"reason": "time"}', 'a malformed time is refused');
select is(pg_temp.rq('{"privacyNoticeVersion": ""}'), 'P0001 request_invalid {"reason": "privacy"}', 'an empty notice version is refused');
select is(pg_temp.rq('{"name": "Zed Persona", "email": "zed.persona@example.com", "phone": "+39 000 0009999", "time": "21:45"}') !~* 'zed|persona|example|9999', true, 'the error of a refused request carries no name, e-mail or phone');
select is(pg_temp.rq('{"name": "Zed Persona", "email": "bad zed persona", "phone": "+39 000 0009999"}') !~* 'zed|persona|9999', true, 'nor the error of a field check');

-- A missing salt and the pending cap -------------------------------------------------------------------------------------------------------------------------------
delete from vault.secrets where name = 'reservation_hash_salt';
select is(pg_temp.rq('{"date": "1998-12-10", "time": "19:00"}'), 'P0001 reservations_unconfigured', 'a missing Vault salt is reservations_unconfigured');
select is((select count(*)::int from public.reservation where business_date = '1998-12-10'), 0, 'and nothing was written');
select vault.create_secret('test-salt-0123456789-abcdef', 'reservation_hash_salt');
insert into public.reservation (tenant_id, business_date, service_key, starts_at, ends_at, party, privacy_notice_version, privacy_ack_at)
  select '22222222-2222-4222-8222-222222222222', date '1998-12-20', 'cena', '1998-12-20 19:00+00', '1998-12-20 21:00+00', 2, 'v1', now() from generate_series(1, 100);
select is(pg_temp.rq('{"date": "1998-12-10", "time": "19:30"}', '1998-11-08 10:00+00', '22222222-2222-4222-8222-222222222222'), 'P0001 rate_limited', 'with 100 pending requests the tenant is capped (rate_limited)');
select is(pg_temp.rq('{"date": "1998-12-10", "time": "19:30"}', '1998-11-08 10:00+00', '11111111-1111-4111-8111-111111111111') like 'P0001%', false, 'tenant A is not affected by B''s pending requests');
update public.reservation set status = 'declined' where id = (select id from public.reservation where tenant_id = '22222222-2222-4222-8222-222222222222' limit 1);
select is(pg_temp.rq('{"date": "1998-12-10", "time": "19:30"}', '1998-11-08 10:00+00', '22222222-2222-4222-8222-222222222222'), '{"status": "received"}', 'with 99 pending requests the next one is ok');

-- Function rules --------------------------------------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname in ('reservation_limits', 'reservation_hash', 'reservation_slot_reason', 'reservation_slots_json', 'request_reservation_at')), 5, 'the five functions exist');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname in ('reservation_limits', 'reservation_hash', 'reservation_slot_reason', 'reservation_slots_json', 'request_reservation_at')
            and p.prosecdef and p.proconfig @> array['search_path=""']), 5, 'each is a definer with an empty search_path');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname in ('reservation_limits', 'reservation_hash', 'reservation_slot_reason', 'reservation_slots_json', 'request_reservation_at')
            and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))), 0, 'and no API role can execute it');

select * from finish();
rollback;
