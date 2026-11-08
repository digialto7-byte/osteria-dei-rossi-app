-- Reservations A2 (docs/plans/2026-11-08-reservations.md §3.2, §5 A2, §5c): the settings, the bookable tables and the table groups. Defaults of a tenant with no row
-- (founder Q-R5: Pranzo 12:00-14:00 and Cena 19:30-22:00 online), each field's bounds on both sides, the strict body, the readiness reasons, the slug, the audit row,
-- the roles (42501 before the body is read), the definer rules. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(151);

-- Runs one statement that returns text, as the given role of tenant A (or B for 'ownerb'); returns the text, or 'SQLSTATE message detail' on an error.
create function pg_temp.call(p_role text, stmt text) returns text language plpgsql as $$
declare
  v_out text;
  state text;
  msg text;
  det text;
  v_auth uuid;
  v_tenant uuid := '11111111-1111-4111-8111-111111111111';
begin
  v_auth := case p_role when 'owner' then 'a0000000-0000-4000-8000-00000000000a' when 'admin' then 'f0000000-0000-4000-8000-00000000000f'
                        when 'waiter' then 'd0000000-0000-4000-8000-00000000000d' when 'chef' then 'c0000000-0000-4000-8000-00000000000c'
                        else 'b0000000-0000-4000-8000-00000000000b' end;
  if p_role = 'ownerb' then
    v_tenant := '22222222-2222-4222-8222-222222222222';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated', 'tenant_id', v_tenant,
                                                            'app_role', case p_role when 'ownerb' then 'owner' else p_role end)::text, true);
  set local role authenticated;
  execute stmt into v_out;
  reset role;
  return v_out;
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text, det = pg_exception_detail;
  reset role;
  return state || ' ' || msg || coalesce(' ' || nullif(det, ''), '');
end
$$;
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
-- Saves a settings body as the owner of A and returns the reply or the error.
create function pg_temp.sv(p_body text, p_role text default 'owner') returns text language sql as $$
  select pg_temp.call(p_role, format('select public.set_reservation_settings(%L::jsonb)::text', p_body))
$$;
create function pg_temp.bad(p_field text) returns text language sql as $$
  select 'P0001 reservation_settings_invalid {"reason": "' || p_field || '"}'
$$;
create function pg_temp.audit_rows() returns integer language sql as $$
  select count(*)::int from public.audit_event where entity_type = 'reservation_settings'
$$;

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
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
  ('13000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'Tavolo 4 (demo)', 4, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('23000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Tavolo B (demo)', 1, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
update public.dining_table set is_active = false where id = '13000000-0000-4000-8000-000000000004';

-- The validator ----------------------------------------------------------------------------------------------------------------------------------------
select is(app.reservation_services_ok(app.reservation_default_services()), true, 'the default services are valid');
select is(app.reservation_services_ok('{}'), true, 'an empty map is valid');
select is(app.reservation_services_ok('[]'), false, 'an array is not');
select is(app.reservation_services_ok(null), false, 'null is not');
select is(app.reservation_services_ok('{"Cena":{"online":true,"firstSeating":"19:00","lastSeating":"21:00","coversPerSlot":null,"reservationsPerSlot":null,"coversPerService":null}}'), false, 'a key that is not a service key is refused');
select is(app.reservation_services_ok('{"cena":{"online":true,"firstSeating":"19:00","lastSeating":"21:00","coversPerSlot":null,"reservationsPerSlot":null}}'), false, 'a missing key is refused');
select is(app.reservation_services_ok('{"cena":{"online":true,"firstSeating":"19:00","lastSeating":"21:00","coversPerSlot":null,"reservationsPerSlot":null,"coversPerService":null,"x":1}}'), false, 'an extra key is refused');
select is(app.reservation_services_ok('{"cena":{"online":true,"firstSeating":"21:00","lastSeating":"19:00","coversPerSlot":null,"reservationsPerSlot":null,"coversPerService":null}}'), false, 'first after last is refused');
select is(app.reservation_services_ok('{"cena":{"online":true,"firstSeating":"19:00","lastSeating":"19:00","coversPerSlot":null,"reservationsPerSlot":null,"coversPerService":null}}'), true, 'first equal to last is valid');
select is(app.reservation_services_ok('{"cena":{"online":false,"firstSeating":null,"lastSeating":null,"coversPerSlot":null,"reservationsPerSlot":null,"coversPerService":null}}'), true, 'both times null is valid');
select is(app.reservation_services_ok('{"cena":{"online":true,"firstSeating":"19:00","lastSeating":null,"coversPerSlot":null,"reservationsPerSlot":null,"coversPerService":null}}'), false, 'one time null is refused');
select is(app.reservation_services_ok('{"cena":{"online":true,"firstSeating":"24:00","lastSeating":"24:00","coversPerSlot":null,"reservationsPerSlot":null,"coversPerService":null}}'), false, '24:00 is refused');
select is(app.reservation_services_ok('{"cena":{"online":true,"firstSeating":"19:00","lastSeating":"21:00","coversPerSlot":0,"reservationsPerSlot":null,"coversPerService":null}}'), false, 'a limit of 0 is refused');
select is(app.reservation_services_ok('{"cena":{"online":true,"firstSeating":"19:00","lastSeating":"21:00","coversPerSlot":1,"reservationsPerSlot":999,"coversPerService":null}}'), true, 'limits 1 and 999 are valid');
select is(app.reservation_services_ok('{"cena":{"online":true,"firstSeating":"19:00","lastSeating":"21:00","coversPerSlot":1,"reservationsPerSlot":1000,"coversPerService":null}}'), false, 'a limit of 1000 is refused');
select is(app.reservation_services_ok('{"cena":{"online":true,"firstSeating":"19:00","lastSeating":"21:00","coversPerSlot":1.5,"reservationsPerSlot":null,"coversPerService":null}}'), false, 'a fractional limit is refused');
select is(app.reservation_services_ok('{"cena":{"online":"yes","firstSeating":"19:00","lastSeating":"21:00","coversPerSlot":null,"reservationsPerSlot":null,"coversPerService":null}}'), false, 'online must be a boolean');
select is(left(pg_temp.err($$ insert into public.reservation_settings (tenant_id, services) values ('22222222-2222-4222-8222-222222222222', '{"x":1}') $$), 5), '23514', 'the table check refuses an invalid services map');

-- Defaults of a tenant with no row ----------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from public.reservation_settings where tenant_id = '11111111-1111-4111-8111-111111111111'), 0, 'tenant A has no settings row');
create temp table s0 as select pg_temp.call('owner', 'select public.reservation_settings()::text')::jsonb as j;
select is((select j -> 'enabled' from s0), 'false'::jsonb, 'enabled is false');
select is((select j -> 'ready' from s0), 'false'::jsonb, 'ready is false');
select is((select j -> 'notReady' from s0), '["slug", "privacy_name", "privacy_email"]'::jsonb, 'the reasons are slug, privacy_name, privacy_email: the booking times are seeded, so no seating (Q-R5)');
select is((select array[j ->> 'slotMinutes', j ->> 'stayMinutes', j ->> 'leadMinutes', j ->> 'horizonDays', j ->> 'maxPartyOnline', j ->> 'cancelUntilMinutes', j ->> 'retentionDays'] from s0),
          array['15', '120', '120', '60', '8', '0', '30'], 'the numeric defaults');
select is((select j -> 'closedWeekdays' from s0), '[]'::jsonb, 'no closed weekday');
select is((select j -> 'closedDates' from s0), '[]'::jsonb, 'no closed date');
select is((select j -> 'publicSlug' from s0), 'null'::jsonb, 'no slug');
select is((select j -> 'venuePhone' from s0), 'null'::jsonb, 'no venue phone is invented');
select is((select j -> 'privacy' from s0), '{"controllerName": null, "controllerVat": "IT00000000000", "contactEmail": null}'::jsonb, 'the privacy block carries the tenant VAT number and nothing invented');
select is((select jsonb_array_length(j -> 'services') from s0), 2, 'two services from the M25c version');
select is((select j -> 'services' -> 0 from s0),
          '{"key": "pranzo", "name": "Pranzo", "startsAt": "11:00", "endsAt": "16:00", "online": true, "firstSeating": "12:00", "lastSeating": "14:00", "coversPerSlot": null, "reservationsPerSlot": null, "coversPerService": null}'::jsonb,
          'Pranzo: online 12:00 to 14:00, no limits');
select is((select j -> 'services' -> 1 from s0),
          '{"key": "cena", "name": "Cena", "startsAt": "16:00", "endsAt": "02:00", "online": true, "firstSeating": "19:30", "lastSeating": "22:00", "coversPerSlot": null, "reservationsPerSlot": null, "coversPerService": null}'::jsonb,
          'Cena: online 19:30 to 22:00, no limits');
insert into public.tenant (id, name, vat_number) values ('33333333-3333-4333-8333-333333333333', 'Osteria Demo C', 'IT22222222220');
insert into public.reservation_settings (tenant_id) values ('33333333-3333-4333-8333-333333333333');
select is(app.reservation_settings_row('33333333-3333-4333-8333-333333333333'), app.reservation_settings_defaults(), 'the row-less defaults equal the column defaults of a bare row');

-- The strict body --------------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.sv('{"nope": 1}'), '22023 invalid_request', 'an unknown key is 22023');
select is(pg_temp.sv('{}'), '22023 invalid_request', 'an empty body is 22023');
select is(pg_temp.sv('[]'), '22023 invalid_request', 'an array is 22023');
select is(pg_temp.sv('{"slotMinutes": 30, "nope": 1}'), '22023 invalid_request', 'one unknown key among good ones is 22023');
select is(pg_temp.audit_rows(), 0, 'nothing was saved or audited so far');

-- Each field, both sides of its bounds ------------------------------------------------------------------------------------------------------------------
select is(pg_temp.sv('{"slotMinutes": 20}'), pg_temp.bad('slot_minutes'), 'slotMinutes 20 is refused');
select is(pg_temp.sv('{"slotMinutes": "15"}'), pg_temp.bad('slot_minutes'), 'a string slotMinutes is refused');
select is((pg_temp.sv('{"slotMinutes": 30}')::jsonb) ->> 'slotMinutes', '30', 'slotMinutes 30 is saved');
select is(pg_temp.sv('{"stayMinutes": 29}'), pg_temp.bad('stay_minutes'), 'stayMinutes 29 is refused');
select is((pg_temp.sv('{"stayMinutes": 30}')::jsonb) ->> 'stayMinutes', '30', 'stayMinutes 30 is saved');
select is((pg_temp.sv('{"stayMinutes": 360}')::jsonb) ->> 'stayMinutes', '360', 'stayMinutes 360 is saved');
select is(pg_temp.sv('{"stayMinutes": 361}'), pg_temp.bad('stay_minutes'), 'stayMinutes 361 is refused');
select is(pg_temp.sv('{"leadMinutes": -1}'), pg_temp.bad('lead_minutes'), 'leadMinutes -1 is refused');
select is((pg_temp.sv('{"leadMinutes": 0}')::jsonb) ->> 'leadMinutes', '0', 'leadMinutes 0 is saved');
select is((pg_temp.sv('{"leadMinutes": 2880}')::jsonb) ->> 'leadMinutes', '2880', 'leadMinutes 2880 is saved');
select is(pg_temp.sv('{"leadMinutes": 2881}'), pg_temp.bad('lead_minutes'), 'leadMinutes 2881 is refused');
select is(pg_temp.sv('{"horizonDays": 0}'), pg_temp.bad('horizon_days'), 'horizonDays 0 is refused');
select is((pg_temp.sv('{"horizonDays": 1}')::jsonb) ->> 'horizonDays', '1', 'horizonDays 1 is saved');
select is((pg_temp.sv('{"horizonDays": 365}')::jsonb) ->> 'horizonDays', '365', 'horizonDays 365 is saved');
select is(pg_temp.sv('{"horizonDays": 366}'), pg_temp.bad('horizon_days'), 'horizonDays 366 is refused');
select is(pg_temp.sv('{"maxPartyOnline": 0}'), pg_temp.bad('max_party_online'), 'maxPartyOnline 0 is refused');
select is((pg_temp.sv('{"maxPartyOnline": 1}')::jsonb) ->> 'maxPartyOnline', '1', 'maxPartyOnline 1 is saved');
select is((pg_temp.sv('{"maxPartyOnline": 40}')::jsonb) ->> 'maxPartyOnline', '40', 'maxPartyOnline 40 is saved');
select is(pg_temp.sv('{"maxPartyOnline": 41}'), pg_temp.bad('max_party_online'), 'maxPartyOnline 41 is refused');
select is(pg_temp.sv('{"cancelUntilMinutes": -1}'), pg_temp.bad('cancel_until_minutes'), 'cancelUntilMinutes -1 is refused');
select is((pg_temp.sv('{"cancelUntilMinutes": 2880}')::jsonb) ->> 'cancelUntilMinutes', '2880', 'cancelUntilMinutes 2880 is saved');
select is(pg_temp.sv('{"cancelUntilMinutes": 2881}'), pg_temp.bad('cancel_until_minutes'), 'cancelUntilMinutes 2881 is refused');
select is(pg_temp.sv('{"retentionDays": 0}'), pg_temp.bad('retention_days'), 'retentionDays 0 is refused');
select is((pg_temp.sv('{"retentionDays": 1}')::jsonb) ->> 'retentionDays', '1', 'retentionDays 1 is saved');
select is((pg_temp.sv('{"retentionDays": 365}')::jsonb) ->> 'retentionDays', '365', 'retentionDays 365 is saved');
select is(pg_temp.sv('{"retentionDays": 366}'), pg_temp.bad('retention_days'), 'retentionDays 366 is refused');
select is(pg_temp.sv('{"closedWeekdays": [8]}'), pg_temp.bad('closed_weekdays'), 'weekday 8 is refused');
select is(pg_temp.sv('{"closedWeekdays": [0]}'), pg_temp.bad('closed_weekdays'), 'weekday 0 is refused');
select is((pg_temp.sv('{"closedWeekdays": [7, 1, 7]}')::jsonb) -> 'closedWeekdays', '[1, 7]'::jsonb, 'weekdays 1 and 7 are saved, sorted, without duplicates');
select is(pg_temp.sv('{"closedDates": ["2026-02-30"]}'), pg_temp.bad('closed_dates'), 'a date that does not exist is refused');
select is(pg_temp.sv('{"closedDates": ["26-12-25"]}'), pg_temp.bad('closed_dates'), 'a malformed date is refused');
select is((pg_temp.sv('{"closedDates": ["2026-12-26", "2026-12-25"]}')::jsonb) -> 'closedDates', '["2026-12-25", "2026-12-26"]'::jsonb, 'closed dates are saved sorted');
select is(pg_temp.sv('{"venuePhone": "abc"}'), pg_temp.bad('venue_phone'), 'a venue phone with letters is refused');
select is((pg_temp.sv('{"venuePhone": "+39 000 0000001"}')::jsonb) ->> 'venuePhone', '+39 000 0000001', 'a fake venue phone is saved');
select is(pg_temp.sv('{"publicSlug": "ab"}'), pg_temp.bad('public_slug'), 'a two-character slug is refused');
select is(pg_temp.sv('{"publicSlug": "Osteria-Demo"}'), pg_temp.bad('public_slug'), 'an upper-case slug is refused');
select is(pg_temp.sv('{"publicSlug": "osteria-"}'), pg_temp.bad('public_slug'), 'a slug ending with a hyphen is refused');
select is(pg_temp.sv('{"privacyControllerName": "X"}'), pg_temp.bad('privacy_controller_name'), 'a one-character controller name is refused');
select is(pg_temp.sv('{"privacyContactEmail": "nope"}'), pg_temp.bad('privacy_contact_email'), 'an e-mail without @ is refused');
select is(pg_temp.sv('{"enabled": "yes"}'), pg_temp.bad('enabled'), 'enabled must be a boolean');
select is(pg_temp.sv('{"services": [{"key": "cena", "online": true, "firstSeating": "21:00", "lastSeating": "19:00", "coversPerSlot": null, "reservationsPerSlot": null, "coversPerService": null}]}'),
          pg_temp.bad('services'), 'firstSeating after lastSeating is refused');
select is(pg_temp.sv('{"services": [{"key": "s_unknown000", "online": true, "firstSeating": "19:00", "lastSeating": "21:00", "coversPerSlot": null, "reservationsPerSlot": null, "coversPerService": null}]}'),
          pg_temp.bad('services'), 'a service key that is not in the version in force is refused');
select is(pg_temp.sv('{"services": [{"key": "cena", "online": true, "firstSeating": "19:00", "lastSeating": "21:00", "coversPerSlot": 0, "reservationsPerSlot": null, "coversPerService": null}]}'),
          pg_temp.bad('services'), 'a limit of 0 is refused');
select is(pg_temp.sv('{"services": [{"key": "cena", "online": true}]}'), pg_temp.bad('services'), 'a service entry with missing keys is refused');

-- Readiness, the slug and the audit row -----------------------------------------------------------------------------------------------------------------
-- (the saves above changed real fields: reset the numbers to keep the later assertions simple)
select is(pg_temp.sv('{"enabled": true}'), 'P0001 reservations_not_ready {"reasons": ["slug", "privacy_name", "privacy_email"]}', 'enabled: true while not ready is refused with the reasons');
insert into public.reservation_settings (tenant_id, public_slug) values ('22222222-2222-4222-8222-222222222222', 'osteria-demo-b');
select is(pg_temp.sv('{"publicSlug": "osteria-demo-b"}'), 'P0001 slug_taken', 'a slug used by tenant B is refused');
select is(pg_temp.sv('{"publicSlug": "osteria-demo-b", "enabled": true}'), 'P0001 reservations_not_ready {"reasons": ["privacy_name", "privacy_email"]}', 'readiness is judged on the saved state plus the patch (the slug reason is gone)');
create temp table audit0 as select pg_temp.audit_rows() as n;
select is((pg_temp.sv('{"publicSlug": "osteria-demo-a", "privacyControllerName": "Osteria Demo S.r.l. (demo)", "privacyContactEmail": "privacy@example.com"}')::jsonb) -> 'notReady', '[]'::jsonb, 'with a slug, a name and a contact the page is ready');
select is(pg_temp.audit_rows() - (select n from audit0), 1, 'one audit row for that save');
select is((select after from public.audit_event where entity_type = 'reservation_settings' order by created_at desc limit 1),
          '{"fields": ["privacy_contact_email", "privacy_controller_name", "public_slug"]}'::jsonb, 'it names the fields only, not the values');
select is((select action || ' ' || entity_id::text from public.audit_event where entity_type = 'reservation_settings' order by created_at desc limit 1),
          'reservation_settings.changed 11111111-1111-4111-8111-111111111111', 'action and entity id');
select is((pg_temp.sv('{"enabled": true}')::jsonb) ->> 'enabled', 'true', 'enabling a ready page works');
create temp table audit1 as select pg_temp.audit_rows() as n;
select is((pg_temp.sv('{"enabled": true, "publicSlug": "osteria-demo-a", "slotMinutes": 30}')::jsonb) ->> 'changed', 'false', 'an identical save reports changed: false');
select is(pg_temp.audit_rows(), (select n from audit1), 'and writes no audit row');
select is((pg_temp.sv('{"retentionDays": 7}')::jsonb) ->> 'changed', 'true', 'a real save reports changed: true');
select is(pg_temp.audit_rows(), (select n + 1 from audit1), 'with one audit row');
select is(pg_temp.sv('{"publicSlug": null}'), 'P0001 reservations_not_ready {"reasons": ["slug"]}', 'clearing the slug of an enabled page is refused');
select is((pg_temp.sv('{"enabled": false, "publicSlug": null}')::jsonb) ->> 'enabled', 'false', 'switching off and clearing the slug together works');
select is((select count(*)::int from public.reservation_settings where tenant_id = '11111111-1111-4111-8111-111111111111'), 1, 'one settings row for tenant A');
select is(pg_temp.sv('{"publicSlug": "osteria-demo-a"}', 'admin') is not null, true, 'the admin can save too');
select is((pg_temp.sv('{"services": [{"key": "cena", "online": false, "firstSeating": null, "lastSeating": null, "coversPerSlot": 20, "reservationsPerSlot": 5, "coversPerService": 60}, {"key": "pranzo", "online": false, "firstSeating": null, "lastSeating": null, "coversPerSlot": null, "reservationsPerSlot": null, "coversPerService": null}]}')::jsonb) -> 'notReady',
          '["seating"]'::jsonb, 'with no service online the reason is seating');
select is((pg_temp.call('owner', 'select public.reservation_settings()::text')::jsonb) -> 'services' -> 1 -> 'coversPerSlot', '20'::jsonb, 'the limits are saved and read back');
select is((pg_temp.sv('{"services": [{"key": "pranzo", "online": true, "firstSeating": "12:30", "lastSeating": "13:30", "coversPerSlot": null, "reservationsPerSlot": null, "coversPerService": null}]}')::jsonb) -> 'services' -> 0 ->> 'firstSeating', '12:30', 'a service not in the body keeps its saved value, one in the body is replaced');
select is((pg_temp.call('owner', 'select public.reservation_settings()::text')::jsonb) -> 'services' -> 1 ->> 'reservationsPerSlot', '5', 'cena kept its limits');

-- Bookable tables ----------------------------------------------------------------------------------------------------------------------------------------
select is((pg_temp.call('owner', $$ select public.set_table_booking('{"tables":[{"tableId":"13000000-0000-4000-8000-000000000001","bookable":true,"seats":4},{"tableId":"13000000-0000-4000-8000-000000000002","bookable":true,"seats":2}]}'::jsonb)::text $$)::jsonb) ->> 'changed', 'true', 'two tables are set bookable');
select is((select jsonb_agg(jsonb_build_array(dining_table_id, bookable, seats) order by dining_table_id) from public.dining_table_booking where tenant_id = '11111111-1111-4111-8111-111111111111'),
          '[["13000000-0000-4000-8000-000000000001", true, 4], ["13000000-0000-4000-8000-000000000002", true, 2]]'::jsonb, 'the rows are stored');
select is((pg_temp.call('owner', $$ select public.set_table_booking('{"tables":[{"tableId":"13000000-0000-4000-8000-000000000001","bookable":true,"seats":4}]}'::jsonb)::text $$)::jsonb) ->> 'changed', 'false', 'an identical save is changed: false');
select is((pg_temp.call('owner', $$ select public.set_table_booking('{"tables":[{"tableId":"13000000-0000-4000-8000-000000000003","bookable":true,"seats":null}]}'::jsonb)::text $$)::jsonb) ->> 'changed', 'true', 'a bookable table may have no seats');
select is(pg_temp.call('owner', $$ select public.set_table_booking('{"tables":[{"tableId":"23000000-0000-4000-8000-000000000001","bookable":true,"seats":4}]}'::jsonb)::text $$), 'P0002 table_not_found', 'tenant B''s table is table_not_found');
select is(pg_temp.call('owner', $$ select public.set_table_booking('{"tables":[{"tableId":"13000000-0000-4000-8000-000000000004","bookable":true,"seats":4}]}'::jsonb)::text $$), 'P0002 table_not_found', 'an inactive table is table_not_found');
select is(pg_temp.call('owner', $$ select public.set_table_booking('{"tables":[{"tableId":"13000000-0000-4000-8000-000000000001","bookable":true,"seats":0}]}'::jsonb)::text $$), 'P0001 table_booking_invalid {"reason": "seats"}', 'seats 0 is refused');
select is(pg_temp.call('owner', $$ select public.set_table_booking('{"tables":[{"tableId":"13000000-0000-4000-8000-000000000001","bookable":true,"seats":41}]}'::jsonb)::text $$), 'P0001 table_booking_invalid {"reason": "seats"}', 'seats 41 is refused');
select is((pg_temp.call('owner', $$ select public.set_table_booking('{"tables":[{"tableId":"13000000-0000-4000-8000-000000000001","bookable":false,"seats":40}]}'::jsonb)::text $$)::jsonb) ->> 'changed', 'true', 'seats 40 is saved');
select is(pg_temp.call('owner', $$ select public.set_table_booking('{"tables":[{"tableId":"13000000-0000-4000-8000-000000000001","bookable":true}]}'::jsonb)::text $$), '22023 invalid_request', 'a table entry with a missing key is 22023');
select is(pg_temp.call('owner', $$ select public.set_table_booking('{"tables":[{"tableId":"not-a-uuid","bookable":true,"seats":4}]}'::jsonb)::text $$), '22023 invalid_request', 'a malformed table id is 22023');
select is(pg_temp.call('owner', $$ select public.set_table_booking('{"tables":[{"tableId":"13000000-0000-4000-8000-000000000001","bookable":true,"seats":4},{"tableId":"13000000-0000-4000-8000-000000000001","bookable":true,"seats":4}]}'::jsonb)::text $$), 'P0001 table_booking_invalid {"reason": "duplicate"}', 'the same table twice is refused');
select is(pg_temp.call('owner', $$ select public.set_table_booking('{"tables":[]}'::jsonb)::text $$), '22023 invalid_request', 'an empty list is 22023');
select is(pg_temp.call('owner', $$ select public.set_table_booking(jsonb_build_object('tables', (select jsonb_agg(jsonb_build_object('tableId', gen_random_uuid(), 'bookable', true, 'seats', 2)) from generate_series(1, 201))))::text $$), '22023 invalid_request', '201 entries are 22023');
select is(pg_temp.call('owner', $$ select public.set_table_booking('{"tables":[{"tableId":"13000000-0000-4000-8000-000000000001","bookable":true,"seats":4}],"x":1}'::jsonb)::text $$), '22023 invalid_request', 'an unknown key is 22023');
select is((pg_temp.call('owner', 'select public.table_booking()::text')::jsonb) -> 'tables',
          '[{"tableId": "13000000-0000-4000-8000-000000000001", "name": "Tavolo 1 (demo)", "position": 1, "bookable": false, "seats": 40},
            {"tableId": "13000000-0000-4000-8000-000000000002", "name": "Tavolo 2 (demo)", "position": 2, "bookable": true, "seats": 2},
            {"tableId": "13000000-0000-4000-8000-000000000003", "name": "Tavolo 3 (demo)", "position": 3, "bookable": true, "seats": null}]'::jsonb,
          'table_booking lists the active tables with their flag and seats (Tavolo 1 was last saved with seats 40 and not bookable)');

-- Groups ---------------------------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.call('owner', $$ select public.create_table_group('{"name":"T1+T2","seats":6,"tableIds":["13000000-0000-4000-8000-000000000001"]}'::jsonb)::text $$), 'P0001 group_invalid {"reason": "tables"}', 'one table is not a group');
select is(pg_temp.call('owner', $$ select public.create_table_group('{"name":"T1+T2","seats":6,"tableIds":["13000000-0000-4000-8000-000000000001","13000000-0000-4000-8000-000000000001"]}'::jsonb)::text $$), 'P0001 group_invalid {"reason": "tables"}', 'the same table twice is not a group');
select is(pg_temp.call('owner', $$ select public.create_table_group('{"name":"T1+T2","seats":6,"tableIds":["13000000-0000-4000-8000-000000000001","23000000-0000-4000-8000-000000000001"]}'::jsonb)::text $$), 'P0001 group_invalid {"reason": "tables"}', 'a table of tenant B is refused');
select is(pg_temp.call('owner', $$ select public.create_table_group('{"name":"T1+T2","seats":6,"tableIds":["13000000-0000-4000-8000-000000000001","13000000-0000-4000-8000-000000000004"]}'::jsonb)::text $$), 'P0001 group_invalid {"reason": "tables"}', 'an inactive table is refused');
select is(pg_temp.call('owner', $$ select public.create_table_group('{"name":"","seats":6,"tableIds":["13000000-0000-4000-8000-000000000001","13000000-0000-4000-8000-000000000002"]}'::jsonb)::text $$), 'P0001 group_invalid {"reason": "name"}', 'an empty name is refused');
select is(pg_temp.call('owner', $$ select public.create_table_group('{"name":"T1+T2","seats":1,"tableIds":["13000000-0000-4000-8000-000000000001","13000000-0000-4000-8000-000000000002"]}'::jsonb)::text $$), 'P0001 group_invalid {"reason": "seats"}', 'seats 1 is refused (a group has at least 2)');
select is(pg_temp.call('owner', $$ select public.create_table_group('{"name":"T1+T2","seats":100,"tableIds":["13000000-0000-4000-8000-000000000001","13000000-0000-4000-8000-000000000002"]}'::jsonb)::text $$), 'P0001 group_invalid {"reason": "seats"}', 'seats 100 is refused');
create temp table g1 as select pg_temp.call('owner', $$ select public.create_table_group('{"name":" T1+T2 ","seats":6,"tableIds":["13000000-0000-4000-8000-000000000001","13000000-0000-4000-8000-000000000002"]}'::jsonb)::text $$)::jsonb as j;
select is((select j -> 'group' ->> 'name' from g1), 'T1+T2', 'a group is created with its trimmed name');
select is((select j -> 'group' -> 'tableIds' from g1), '["13000000-0000-4000-8000-000000000001", "13000000-0000-4000-8000-000000000002"]'::jsonb, 'and its two members, in table order');
select is((select count(*)::int from public.table_group_member where tenant_id = '11111111-1111-4111-8111-111111111111'), 2, 'the members are stored');
select is(pg_temp.call('owner', $$ select public.create_table_group('{"name":"t1+t2","seats":6,"tableIds":["13000000-0000-4000-8000-000000000001","13000000-0000-4000-8000-000000000003"]}'::jsonb)::text $$), 'P0001 group_invalid {"reason": "name_taken"}', 'a duplicate active name (any case) is refused');
select is(pg_temp.err($$ update public.table_group_member set dining_table_id = '13000000-0000-4000-8000-000000000003' where tenant_id = '11111111-1111-4111-8111-111111111111' $$), 'P0001 append_only', 'members are immutable');
select is((select jsonb_array_length(j -> 'groups') from (select pg_temp.call('owner', 'select public.table_booking()::text')::jsonb as j) x), 1, 'table_booking lists the active group');
select is((pg_temp.call('owner', format('select public.deactivate_table_group(%L)::text', (select j -> 'group' ->> 'id' from g1)))::jsonb) ->> 'changed', 'true', 'a group is deactivated');
select is((pg_temp.call('owner', format('select public.deactivate_table_group(%L)::text', (select j -> 'group' ->> 'id' from g1)))::jsonb) ->> 'changed', 'false', 'a second deactivation changes nothing');
select is((select jsonb_array_length(j -> 'groups') from (select pg_temp.call('owner', 'select public.table_booking()::text')::jsonb as j) x), 0, 'the group is no longer listed');
select is(pg_temp.call('owner', $$ select (public.create_table_group('{"name":"T1+T2","seats":6,"tableIds":["13000000-0000-4000-8000-000000000001","13000000-0000-4000-8000-000000000002"]}'::jsonb) -> 'group' ->> 'name') $$), 'T1+T2', 'the same name can be created again after deactivating');
select is(pg_temp.call('owner', $$ select public.deactivate_table_group('99999999-9999-4999-8999-999999999999')::text $$), 'P0002 group_not_found', 'an unknown group is group_not_found');
select is(pg_temp.call('ownerb', format('select public.deactivate_table_group(%L)::text', (select j -> 'group' ->> 'id' from g1))), 'P0002 group_not_found', 'tenant B cannot deactivate A''s group');
select is(pg_temp.call('owner', $$ select public.create_table_group('{"name":"Sala","seats":20,"tableIds":["13000000-0000-4000-8000-000000000001","13000000-0000-4000-8000-000000000002","13000000-0000-4000-8000-000000000003"],"x":1}'::jsonb)::text $$), '22023 invalid_request', 'an unknown key in a group body is 22023');

-- Roles: the waiter and the chef get 42501 before the body is read -----------------------------------------------------------------------------------------
select is((select string_agg(r || ':' || left(pg_temp.call(r, 'select public.reservation_settings()::text'), 5), ',' order by r) from unnest(array['waiter', 'chef']) r), 'chef:42501,waiter:42501', 'reservation_settings: waiter and chef refused');
select is((select string_agg(r || ':' || left(pg_temp.call(r, $$ select public.set_reservation_settings('"garbage"'::jsonb)::text $$), 5), ',' order by r) from unnest(array['waiter', 'chef']) r), 'chef:42501,waiter:42501', 'set_reservation_settings: refused before parsing');
select is((select string_agg(r || ':' || left(pg_temp.call(r, 'select public.table_booking()::text'), 5), ',' order by r) from unnest(array['waiter', 'chef']) r), 'chef:42501,waiter:42501', 'table_booking: refused');
select is((select string_agg(r || ':' || left(pg_temp.call(r, $$ select public.set_table_booking('"garbage"'::jsonb)::text $$), 5), ',' order by r) from unnest(array['waiter', 'chef']) r), 'chef:42501,waiter:42501', 'set_table_booking: refused before parsing');
select is((select string_agg(r || ':' || left(pg_temp.call(r, $$ select public.create_table_group('"garbage"'::jsonb)::text $$), 5), ',' order by r) from unnest(array['waiter', 'chef']) r), 'chef:42501,waiter:42501', 'create_table_group: refused before parsing');
select is((select string_agg(r || ':' || left(pg_temp.call(r, $$ select public.deactivate_table_group(null)::text $$), 5), ',' order by r) from unnest(array['waiter', 'chef']) r), 'chef:42501,waiter:42501', 'deactivate_table_group: refused before the id is read');
select is(left(pg_temp.call('admin', 'select public.table_booking()::text'), 1), '{', 'the admin reads the tables');
select is((pg_temp.call('ownerb', 'select public.reservation_settings()::text')::jsonb) ->> 'publicSlug', 'osteria-demo-b', 'tenant B reads its own settings, not A''s');

-- Function rules -------------------------------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('reservation_settings', 'set_reservation_settings', 'table_booking', 'set_table_booking', 'create_table_group', 'deactivate_table_group')), 6, 'the six public functions exist');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('reservation_settings', 'set_reservation_settings', 'table_booking', 'set_table_booking', 'create_table_group', 'deactivate_table_group')
            and p.prosecdef and p.proconfig @> array['search_path=""']), 6, 'each is a definer with an empty search_path');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('reservation_settings', 'set_reservation_settings', 'table_booking', 'set_table_booking', 'create_table_group', 'deactivate_table_group')
            and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('service_role', p.oid, 'execute')), 6, 'executable by authenticated only');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname ~ '^(reservation_settings_|reservation_not_ready|reservation_int|reservation_date|set_reservation_settings_at|set_table_booking_at|create_table_group_at|deactivate_table_group_at|table_booking_json)'), 12, 'the app helpers exist');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname ~ '^(reservation_settings_|reservation_not_ready|reservation_int|reservation_date|set_reservation_settings_at|set_table_booking_at|create_table_group_at|deactivate_table_group_at|table_booking_json)'
            and p.prosecdef and p.proconfig @> array['search_path=""'] and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('service_role', p.oid, 'execute')), 12, 'each is a definer with an empty search_path, closed to every API role');
select is((select count(*)::int from public.audit_event where entity_type = 'reservation_settings' and (after::text ~* 'osteria|example|\+39')), 0, 'no audit row carries a value, only field names');

select * from finish();
rollback;
