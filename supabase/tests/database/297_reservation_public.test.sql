-- Reservations B1 (docs/plans/2026-11-08-reservations.md §3.1.9, §3.2, §5 B1; ADR-032): the route gate and the anon wrappers. app.reservation_gate_ok verifies an HMAC-SHA256 over
-- "resv-gate|v1|<function>|<slug>|<ts>" with the Vault key (or the _next key during a rotation), within +-60 s, before anything else; the three wrappers of this step
-- (reservation_page, reservation_slots, request_reservation) are granted to anon only, definer, empty search_path. The two cancel wrappers come with B2 (298). Fake data only
-- (Osteria Demo A, privacy@example.com, documentation IP addresses, fake Vault keys created in the test).
begin;
create extension if not exists pgtap with schema extensions;
select plan(67);

-- Runs a statement as anon; returns its text, or 'SQLSTATE message detail' on an error.
create function pg_temp.anon(stmt text) returns text language plpgsql as $$
declare
  v_out text;
  state text;
  msg text;
  det text;
begin
  set local role anon;
  execute stmt into v_out;
  reset role;
  return v_out;
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text, det = pg_exception_detail;
  reset role;
  return state || ' ' || msg || coalesce(' ' || nullif(det, ''), '');
end
$$;
create function pg_temp.mac(p_fn text, p_slug text, p_ts bigint, p_key text) returns text language sql as $$
  select encode(extensions.hmac('resv-gate|v1|' || p_fn || '|' || p_slug || '|' || p_ts::text, p_key, 'sha256'), 'hex')
$$;
create function pg_temp.epoch(p_at timestamptz) returns bigint language sql as $$ select extract(epoch from p_at)::bigint $$;
-- The gate check alone, at a fixed clock; the key defaults to the gate key of the fixture.
create function pg_temp.gate(p_ts_off integer, p_fn text default 'request_reservation', p_slug text default 'osteria-demo-a', p_key text default 'test-gate-key-0123456789-abcdefghij', p_mac_fn text default null)
  returns text language plpgsql as $$
declare
  v_now timestamptz := '2026-11-08 10:00:00+00';
  v_ts bigint := extract(epoch from v_now)::bigint + p_ts_off;
  v_out text;
  state text;
  msg text;
  det text;
begin
  v_out := app.reservation_gate_ok(p_fn, p_slug, v_ts, pg_temp.mac(coalesce(p_mac_fn, p_fn), p_slug, v_ts, p_key), v_now)::text;
  return v_out;
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text, det = pg_exception_detail;
  return state || ' ' || msg || coalesce(' ' || nullif(det, ''), '');
end
$$;
-- A public call as the route would make it: anon, the real clock, a MAC of the given key. p_extra is the rest of the argument list (without a leading comma).
create function pg_temp.pub(p_fn text, p_slug text, p_extra text, p_key text default 'test-gate-key-0123456789-abcdefghij', p_ts_off integer default 0) returns text language plpgsql as $$
declare
  v_ts bigint := extract(epoch from clock_timestamp())::bigint + p_ts_off;
begin
  return pg_temp.anon(format('select public.%I(%L, %s, %L%s)::text', p_fn, p_slug, v_ts, pg_temp.mac(p_fn, p_slug, v_ts, p_key), case when p_extra = '' then '' else ', ' || p_extra end));
end
$$;
create function pg_temp.body(p_over jsonb default '{}') returns text language sql as $$
  select (jsonb_build_object('date', to_char((now() at time zone 'Europe/Rome')::date + 10, 'YYYY-MM-DD'), 'serviceKey', 'cena', 'time', '20:00', 'party', 2, 'name', 'Cliente Demo',
                             'phone', '+39 000 0000001', 'email', 'cliente.demo@example.com', 'locale', 'it', 'privacyNoticeVersion', 'v1') || p_over)::text
$$;
create function pg_temp.req(p_slug text, p_over jsonb default '{}', p_ip text default '203.0.113.7') returns text language sql as $$
  select pg_temp.pub('request_reservation', p_slug, format('%L::jsonb, %L', pg_temp.body(p_over), p_ip))
$$;

insert into auth.users (id, email) values ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115'),
  ('33333333-3333-4333-8333-333333333333', 'Osteria Demo C', 'IT22222222220');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo');

-- The Vault of the fixture: the local seed may already hold fake values, so the test sets its own.
delete from vault.secrets where name in ('reservation_gate_key', 'reservation_gate_key_next', 'reservation_hash_salt');
select vault.create_secret('test-gate-key-0123456789-abcdefghij', 'reservation_gate_key');
select vault.create_secret('test-salt-0123456789-abcdef', 'reservation_hash_salt');

-- A: enabled and ready. B: a slug, ready, but switched off. C: switched on in the table but not ready (no privacy name).
select app.set_reservation_settings_at('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a',
  '{"publicSlug": "osteria-demo-a", "privacyControllerName": "Osteria Demo S.r.l. (demo)", "privacyContactEmail": "privacy@example.com", "venuePhone": "+39 000 0000000", "enabled": true}', now());
insert into public.reservation_settings (tenant_id, public_slug, privacy_controller_name, privacy_contact_email, enabled)
  values ('22222222-2222-4222-8222-222222222222', 'osteria-demo-b', 'Osteria Demo B S.r.l. (demo)', 'privacy-b@example.com', false);
insert into public.reservation_settings (tenant_id, public_slug, privacy_contact_email, enabled)
  values ('33333333-3333-4333-8333-333333333333', 'osteria-demo-c', 'privacy-c@example.com', true);

-- T-R3: HMAC-SHA256 against RFC 4231 ----------------------------------------------------------------------------------------------------------------------------------
select is(encode(extensions.hmac(convert_to('Hi There', 'UTF8'), decode(repeat('0b', 20), 'hex'), 'sha256'), 'hex'), 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
          'T-R3: RFC 4231 test case 1 (key 20 x 0x0b, "Hi There")');
select is(encode(extensions.hmac('what do ya want for nothing?', 'Jefe', 'sha256'), 'hex'), '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
          'T-R3: RFC 4231 test case 2 (key "Jefe"), the text form the gate uses');
select is(pg_temp.mac('request_reservation', 'osteria-demo-a', 1794132000, 'test-gate-key-0123456789-abcdefghij'), 'f993b1292eb6ff5bc03794cec16bcf5ba259fad27a9d9d5316cb60fa904b7178',
          'the gate MAC of a fixed key, function, slug and ts (the vector the TypeScript side pins too)');

-- The gate ----------------------------------------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.gate(0), 'true', 'a MAC of the right key at ts = now is accepted');
select is(pg_temp.gate(60), 'true', 'at now + 60 s it is accepted');
select is(pg_temp.gate(-60), 'true', 'at now - 60 s it is accepted');
select is(pg_temp.gate(61), 'P0001 gate_invalid', 'at now + 61 s it is gate_invalid');
select is(pg_temp.gate(-61), 'P0001 gate_invalid', 'at now - 61 s it is gate_invalid');
select is(pg_temp.gate(0, p_mac_fn => 'reservation_page'), 'P0001 gate_invalid', 'a MAC made for another function is refused');
select is(pg_temp.gate(0, p_key => 'some-other-key-0123456789-abcdefghijk'), 'P0001 gate_invalid', 'a MAC of another key is refused');
create function pg_temp.gate_slug_swap() returns text language plpgsql as $$
declare
  v_now timestamptz := '2026-11-08 10:00:00+00';
  v_ts bigint := extract(epoch from v_now)::bigint;
  state text;
  msg text;
begin
  perform app.reservation_gate_ok('request_reservation', 'osteria-demo-b', v_ts, pg_temp.mac('request_reservation', 'osteria-demo-a', v_ts, 'test-gate-key-0123456789-abcdefghij'), v_now);
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text;
  return state || ' ' || msg;
end
$$;
select is(pg_temp.gate_slug_swap(), 'P0001 gate_invalid', 'a MAC made for another slug is refused');
create function pg_temp.gate_raw(p_ts bigint, p_mac text) returns text language plpgsql as $$
declare
  state text;
  msg text;
begin
  perform app.reservation_gate_ok('request_reservation', 'osteria-demo-a', p_ts, p_mac, '2026-11-08 10:00:00+00');
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text;
  return state || ' ' || msg;
end
$$;
select is(pg_temp.gate_raw(extract(epoch from timestamptz '2026-11-08 10:00:00+00')::bigint, null), 'P0001 gate_invalid', 'a null MAC is gate_invalid');
select is(pg_temp.gate_raw(null, 'abc'), 'P0001 gate_invalid', 'a null ts is gate_invalid');
select is(pg_temp.gate_raw(extract(epoch from timestamptz '2026-11-08 10:00:00+00')::bigint, 'zz'), 'P0001 gate_invalid', 'a garbage MAC is gate_invalid');

-- Rotation: the _next key is also accepted; with neither key the function is unconfigured ---------------------------------------------------------------------------
select vault.create_secret('next-gate-key-0123456789-abcdefghijk', 'reservation_gate_key_next');
select is(pg_temp.gate(0, p_key => 'next-gate-key-0123456789-abcdefghijk'), 'true', 'during a rotation the _next key is accepted');
select is(pg_temp.gate(0), 'true', 'and the current key still is');
select is(pg_temp.gate(0, p_key => 'third-gate-key-0123456789-abcdefghijk'), 'P0001 gate_invalid', 'a third key is not');
delete from vault.secrets where name = 'reservation_gate_key_next';
select is(pg_temp.gate(0, p_key => 'next-gate-key-0123456789-abcdefghijk'), 'P0001 gate_invalid', 'once the _next key is removed it is refused');
delete from vault.secrets where name = 'reservation_gate_key';
select is(pg_temp.gate(0), 'P0001 reservations_unconfigured', 'no Vault gate key: reservations_unconfigured');
select vault.create_secret('test-gate-key-0123456789-abcdefghij', 'reservation_gate_key');

-- Grants and definer rules --------------------------------------------------------------------------------------------------------------------------------------------------
create temp table pubfn as
  select p.oid, p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('reservation_page', 'reservation_slots', 'request_reservation');
select is((select count(*)::int from pubfn), 3, 'the three public wrappers of B1 exist');
select is((select count(*)::int from pubfn where has_function_privilege('anon', oid, 'execute')), 3, 'all three are executable by anon');
select is((select count(*)::int from pubfn where has_function_privilege('authenticated', oid, 'execute')), 0, 'none by authenticated');
select is((select count(*)::int from pubfn where has_function_privilege('service_role', oid, 'execute')), 0, 'none by service_role');
select is((select count(*)::int from pg_proc p join pubfn f on f.oid = p.oid where not p.prosecdef), 0, 'each is a security definer');
select is((select count(*)::int from pg_proc p join pubfn f on f.oid = p.oid where p.proconfig @> array['search_path='] or p.proconfig @> array['search_path=""']), 3, 'each has an empty search_path');
select is((select count(*)::int from pg_proc p join pubfn f on f.oid = p.oid where p.proacl::text ~ '[{,]=X/'), 0, 'and PUBLIC has no execute on any');
select is((select pronargdefaults::int from pg_proc where proname = 'request_reservation' and pronamespace = 'public'::regnamespace), 0, 'request_reservation takes p_ip without a default: it is always passed');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'reservation_gate_ok'
            and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))), 0,
          'app.reservation_gate_ok is executable by no API role');
select is((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where proname = 'reservation_gate_ok' and pronamespace = 'app'::regnamespace), true, 'and is a definer with an empty search_path');
select is((select count(*)::int from pg_class c where c.relnamespace in ('public'::regnamespace, 'app'::regnamespace) and c.relkind = 'r'
            and c.relname in ('reservation', 'reservation_contact', 'reservation_email', 'reservation_event', 'reservation_settings', 'reservation_table', 'reservation_throttle', 'table_group', 'table_group_member', 'dining_table_booking')
            and has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate,references,trigger')), 0, 'anon still has no privilege on any reservation table');
select is(pg_temp.anon('select app.request_reservation_at(''11111111-1111-4111-8111-111111111111'', ''{}'', null, now())::text'), '42501 permission denied for schema app', 'anon cannot reach the app schema');

-- The gate is checked before anything else ------------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.pub('request_reservation', 'osteria-demo-a', '''{}''::jsonb, null', p_key => 'wrong-gate-key-0123456789-abcdefghijk'), 'P0001 gate_invalid', 'a wrong key: gate_invalid, though the body is malformed');
select is(pg_temp.pub('request_reservation', 'no-such-slug', '''[]''::jsonb, null', p_key => 'wrong-gate-key-0123456789-abcdefghijk'), 'P0001 gate_invalid', 'an unknown slug with a wrong key is gate_invalid, not not_found');
select is(pg_temp.pub('request_reservation', 'osteria-demo-a', '''{}''::jsonb, null', p_ts_off => 120), 'P0001 gate_invalid', 'a stale ts: gate_invalid');
select is(pg_temp.pub('reservation_page', 'osteria-demo-a', '', p_key => 'wrong-gate-key-0123456789-abcdefghijk'), 'P0001 gate_invalid', 'the page needs the gate');
select is(pg_temp.pub('reservation_slots', 'osteria-demo-a', '''2026-12-01'', 2', p_key => 'wrong-gate-key-0123456789-abcdefghijk'), 'P0001 gate_invalid', 'the slots need the gate');
select is(pg_temp.anon('select public.request_reservation(''osteria-demo-a'', 1, ''00'', ''{}''::jsonb, ''203.0.113.9'')::text'), 'P0001 gate_invalid', 'a made-up gate called directly (as through PostgREST): gate_invalid');
select is((select count(*)::int from public.reservation), 0, 'and nothing was written');

-- Not found: one answer for unknown, disabled and not-ready ----------------------------------------------------------------------------------------------------------------------
select is(pg_temp.pub('reservation_page', 'no-such-slug', ''), 'P0002 not_found', 'page: an unknown slug is P0002 not_found');
select is(pg_temp.pub('reservation_page', 'osteria-demo-b', ''), 'P0002 not_found', 'page: a disabled tenant gives the same');
select is(pg_temp.pub('reservation_page', 'osteria-demo-c', ''), 'P0002 not_found', 'page: a not-ready tenant gives the same');
select is(pg_temp.pub('reservation_slots', 'osteria-demo-b', '''2026-12-01'', 2'), 'P0002 not_found', 'slots: a disabled tenant is not_found');
select is(pg_temp.req('osteria-demo-c'), 'P0002 not_found', 'request: a not-ready tenant is not_found');
select is(pg_temp.req('no-such-slug'), 'P0002 not_found', 'request: an unknown slug is not_found');

-- The page ------------------------------------------------------------------------------------------------------------------------------------------------------------------------
create temp table pg as select pg_temp.pub('reservation_page', 'osteria-demo-a', '')::jsonb as j;
select is((select j ->> 'venueName' from pg), 'Osteria Demo A', 'page: the venue name');
select is((select array_agg(k order by k collate "C") from pg, jsonb_object_keys(j) k),
          array['closedDates', 'closedWeekdays', 'maxDate', 'maxPartyOnline', 'minDate', 'privacy', 'services', 'venueName', 'venuePhone'], 'page: exactly the keys of the plan (the form token and the notice version come from the route)');
select is((select j -> 'services' from pg), '[{"key": "pranzo", "name": "Pranzo"}, {"key": "cena", "name": "Cena"}]'::jsonb, 'page: the online services, key and name only');
select is((select j -> 'privacy' from pg), '{"controllerName": "Osteria Demo S.r.l. (demo)", "controllerVat": "IT00000000000", "contactEmail": "privacy@example.com"}'::jsonb, 'page: the privacy block');
select is((select (j ->> 'maxPartyOnline')::int from pg), 8, 'page: max party online');
select is((select j ->> 'venuePhone' from pg), '+39 000 0000000', 'page: the venue phone');
select is((select j ->> 'minDate' from pg), to_char(((now() + interval '120 minutes') at time zone 'Europe/Rome')::date, 'YYYY-MM-DD'), 'page: minDate is the local date of now + the lead time');
select is((select j ->> 'maxDate' from pg), to_char(app.business_date('11111111-1111-4111-8111-111111111111', now()) + 60, 'YYYY-MM-DD'), 'page: maxDate is the horizon');
select is((select count(*)::int from pg where j::text ~* '11111111|tenant|"id"'), 0, 'page: no id of the tenant is revealed');

-- Slots ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
create temp table sl as select pg_temp.pub('reservation_slots', 'osteria-demo-a', format('%L::date, 2', to_char((now() at time zone 'Europe/Rome')::date + 10, 'YYYY-MM-DD')))::jsonb as j;
select is((select jsonb_agg(s ->> 'key' order by o) from sl, jsonb_array_elements(j -> 'services') with ordinality t(s, o)), '["pranzo", "cena"]'::jsonb, 'slots: the online services');
select is((select (j ->> 'closed')::boolean from sl), false, 'slots: not closed');
select is(pg_temp.pub('reservation_slots', 'osteria-demo-a', '''2026-12-01''::date, 0'), 'P0001 request_invalid {"reason": "party"}', 'slots: party 0 is request_invalid');
select is(pg_temp.pub('reservation_slots', 'osteria-demo-a', 'null::date, 2'), 'P0001 request_invalid {"reason": "date"}', 'slots: a null date is request_invalid');

-- A request through the wrapper ---------------------------------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.req('osteria-demo-a'), '{"status": "received"}', 'a valid request with a valid gate answers {status: received}');
select is((select count(*)::int from public.reservation where tenant_id = '11111111-1111-4111-8111-111111111111' and status = 'pending'), 1, 'one pending reservation of A');
select is((select count(*)::int from public.reservation_contact where email = 'cliente.demo@example.com'), 1, 'its contact');
select is((select count(*)::int from public.reservation_email where kind = 'received' and status = 'queued'), 1, 'and one queued received e-mail');
select is((select count(*)::int from app.reservation_throttle where tenant_id = '11111111-1111-4111-8111-111111111111'), 3, 'the throttle holds the IP, e-mail and phone hashes');
select is((select count(*)::int from app.reservation_throttle where key_hash ~ '203|cliente|0000'), 0, 'and none of them is a raw value');
select is(pg_temp.req('osteria-demo-a', '{"time": "22:15"}', '203.0.113.8'), 'P0001 slot_unavailable {"reason": "seating"}', 'a slot rule is the same as in A3: 22:15 is outside the booking times');
select is(pg_temp.req('osteria-demo-a', '{"party": 9}', '203.0.113.9'), 'P0001 slot_unavailable {"reason": "party"}', 'party 9 is over the online maximum');
select is(pg_temp.req('osteria-demo-b'), 'P0002 not_found', 'a disabled tenant cannot be requested');
select is((select count(*)::int from public.reservation), 1, 'only the one valid request wrote a row');

select * from finish();
rollback;
