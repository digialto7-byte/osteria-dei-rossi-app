-- M12 step 2: the chef-payload allow-list (M12 plan §3.1.8, M7 plan §8 (a)). app.chef_payload_allowed is a
-- pure predicate; app.raise_alert applies it LAST, so every older guard keeps its error code, and only for
-- a final audience that includes the chef. Owner-only payloads are not touched. Run as the table owner.
begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

insert into auth.users (id, email) values ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo');

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
create function pg_temp.raise(p_kind text, p_entity int, p_payload jsonb) returns text language sql as $$
  select pg_temp.err(format($f$ select app.raise_alert('11111111-1111-4111-8111-111111111111', %L, 'test_entity',
    ('e0000000-0000-4000-8000-' || lpad(%s::text, 12, '0'))::uuid, %L::jsonb) $f$, p_kind, p_entity, p_payload))
$$;

-- The predicate: the vector table that src/server/alerts/chef-payload.ts repeats ---------------------------
select is(app.chef_payload_allowed('{}'), true, '{} is allowed');
select is(app.chef_payload_allowed('{"ingredient_id":"1a000000-0000-4000-8000-00000000001a","on_hand_qty":-1,"unit":"kg"}'),
  true, 'ids, quantities and a unit are allowed');
select is(app.chef_payload_allowed('{"x_date":"2026-10-25","y_at":"2026-10-25T10:00:00Z","n_count":3,"reason_key":"over_production"}'),
  true, 'a date, an ISO instant, a count and a code are allowed');
select is(app.chef_payload_allowed('{"lot_key":{"lot_id":"1a000000-0000-4000-8000-00000000001a","left_qty":1}}'),
  true, 'a nested object with allowed keys at every depth is allowed');
select is(app.chef_payload_allowed('{"ids":[{"a_id":"1a000000-0000-4000-8000-00000000001a"}]}'), false,
  'a key without an allowed suffix is refused even when its array holds allowed keys');
select is(app.chef_payload_allowed('{"lot_id":"1a000000-0000-4000-8000-00000000001a","qty":1}'), false,
  'qty alone has no allowed suffix');
select is(app.chef_payload_allowed('{"supplier_name":"Quartiere EUR"}'), false, 'a name key is refused');
select is(app.chef_payload_allowed('{"eur":12}'), false, 'eur is refused');
select is(app.chef_payload_allowed('{"valueEur":12}'), false, 'valueEur is refused');
select is(app.chef_payload_allowed('{"note":"ok"}'), false, 'note is refused');
select is(app.chef_payload_allowed('{"ingredient_id":"Manzo"}'), false, 'a value that is not a token is refused');
select is(app.chef_payload_allowed(jsonb_build_object('reason_key', repeat('a', 41))), false, 'a 41-character code is refused');
select is(app.chef_payload_allowed(jsonb_build_object('reason_key', repeat('a', 40))), true, 'a 40-character code is allowed');
select is(app.chef_payload_allowed('{"a_key":["ok","12,50 €"]}'), false, 'a string in an array is checked too');
select is(app.chef_payload_allowed('{"a_key":{"deep_name":"x"}}'), false, 'a bad key at depth is refused');
select is(app.chef_payload_allowed('{"a_key":null,"b_count":true,"c_qty":1.5}'), true, 'null, booleans and numbers are allowed');
select is(app.chef_payload_allowed('{"unit":"Kg"}'), false, 'the unit must be lower case');

-- raise_alert ---------------------------------------------------------------------------------------------
select is(pg_temp.raise('test_alert_kitchen', 1, '{"note":"x"}'), 'P0001 alert_payload_not_allowed',
  'a chef-audience alert with a free-text key is refused');
select is((select count(*) from public.alert), 0::bigint, 'and nothing is stored');
select is(pg_temp.raise('test_alert', 2, '{"note":"x"}'), 'ok', 'the same payload on an owner-only kind is stored (unchanged)');
select is(pg_temp.raise('test_alert_kitchen', 3, '{"lines":[{"detail":["ok","12,50 €"]}]}'),
  'P0001 alert_payload_cost_value', 'the older money guard keeps its code (guard order kept)');
select is(pg_temp.raise('test_alert_kitchen', 4, '{}'), 'ok', 'an empty payload on a chef kind is stored');
select is(pg_temp.raise('test_alert_kitchen', 5, '{"ingredient_id":"1a000000-0000-4000-8000-00000000001a","on_hand_qty":-1,"unit":"kg"}'),
  'ok', 'an allowed payload on a chef kind is stored');
select is(pg_temp.err($$ select app.raise_alert('11111111-1111-4111-8111-111111111111', 'test_alert', 'test_entity',
  'e0000000-0000-4000-8000-000000000006', '{"note":"x"}', null, '{owner,chef}') $$), 'P0001 alert_payload_not_allowed',
  'an owner-only kind asked to reach the chef is checked');

set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated","tenant_id":"11111111-1111-4111-8111-111111111111","app_role":"owner"}';
select is(pg_temp.err($$ select public.raise_test_alert(true) $$), 'ok', 'raise_test_alert(true) works as the owner');
reset request.jwt.claims;

-- Every refusal that existed before M12 still fires, with its own code, in its own order ---------------------
insert into app.alert_kind (kind, cost_bearing, default_severity, default_audience)
  values ('test_cost_chef', true, 'warning', '{owner}');
select is(pg_temp.raise('no_such_kind', 20, '{}'), 'P0001 unknown_alert_kind', 'unknown kind still refused');
select is(pg_temp.err($$ select app.raise_alert('99999999-9999-4999-8999-999999999999', 'test_alert', 'test_entity',
  'e0000000-0000-4000-8000-000000000021', '{}') $$), 'P0002 tenant_not_found', 'unknown tenant still refused');
select is(pg_temp.err($$ select app.raise_alert('11111111-1111-4111-8111-111111111111', 'test_alert', 'test_entity',
  'e0000000-0000-4000-8000-000000000022', '{}', null, '{waiter}') $$), 'P0001 alert_audience_invalid',
  'a waiter audience still refused');
select is(pg_temp.err($$ select app.raise_alert('11111111-1111-4111-8111-111111111111', 'test_cost_chef', 'test_entity',
  'e0000000-0000-4000-8000-000000000023', '{"note":"x"}', null, '{chef}') $$), 'P0001 alert_audience_cost',
  'a cost-bearing alert for the chef still refused (before the allow-list)');
select is(pg_temp.raise('test_alert_kitchen', 24, '{"price_eur":1}'), 'P0001 alert_payload_cost_key',
  'a money key still refused (before the allow-list)');
select is(pg_temp.raise('test_alert_kitchen', 25, '[]'), 'P0001 alert_payload_invalid',
  'a non-object payload still refused');
select is(pg_temp.raise('test_alert', 26, jsonb_build_object('pad', repeat('x', 9000))), 'P0001 alert_payload_invalid',
  'an oversize payload still refused');

-- try_raise_alert and the guard-code registry ---------------------------------------------------------------
select is(app.try_raise_alert('11111111-1111-4111-8111-111111111111', 'test_alert_kitchen', 'test_entity',
  'e0000000-0000-4000-8000-000000000007', '{"note":"x"}', null, null, now(), null, 'test_caller'), null::uuid,
  'try_raise_alert absorbs the new refusal and returns null');
select is((select code || ' ' || sqlstate || ' ' || caller from app.alert_refusal order by id desc limit 1),
  'alert_payload_not_allowed P0001 test_caller', 'one refusal row is recorded');
select ok('alert_payload_not_allowed' = any (app.alert_guard_codes()), 'the code is in the guard registry');
select ok(not has_function_privilege('authenticated', 'app.chef_payload_allowed(jsonb)', 'execute')
  and not has_function_privilege('anon', 'app.chef_payload_allowed(jsonb)', 'execute')
  and not has_function_privilege('service_role', 'app.chef_payload_allowed(jsonb)', 'execute'),
  'no API role executes app.chef_payload_allowed');
select is((select count(*)::int from pg_proc where proname = 'raise_alert' and pronamespace = 'app'::regnamespace), 1,
  'there is exactly one raise_alert (no overload)');

select * from finish();
rollback;
