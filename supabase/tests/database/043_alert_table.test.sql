-- M6 step 3 (migration 20261022150100_alert.sql): the alert table, the kind registry, the business-date
-- and payload-key helpers, the guard trigger and RLS. Fixture inserts run as the migration owner (this
-- session); the roles are switched with set local role.
-- Acceptance tests: AT2 (DST business dates), AT6 (who can read which alert).
begin;
create extension if not exists pgtap with schema extensions;
select plan(77);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('a0000000-0000-4000-8000-0000000000ad', 'admin-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number, timezone) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000', 'Europe/Rome'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115', 'Asia/Tokyo');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('a1000000-0000-4000-8000-0000000000ad', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-0000000000ad', 'admin', 'Supporto Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111',
   'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B');

create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
-- SQLSTATE and the constraint name when there is one, else the message.
create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare
  state text;
  msg text;
  cname text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text, cname = constraint_name;
  return state || ' ' || coalesce(nullif(cname, ''), msg);
end
$$;
-- An alert in tenant A with the usual defaults; the arguments are what a test varies.
create function pg_temp.ins(
  p_kind text default 'test_alert',
  p_entity uuid default '11111111-1111-4111-8111-111111111111',
  p_audience public.app_role[] default '{owner,admin}',
  p_cost boolean default false,
  p_payload jsonb default '{}',
  p_ack_at timestamptz default null,
  p_ack_by uuid default null,
  p_date date default '2026-11-02',
  p_created timestamptz default now()
) returns text language sql as $$
  select pg_temp.err(format(
    'insert into public.alert (tenant_id, kind, entity_type, entity_id, business_date, severity,
       audience_roles, cost_bearing, payload, created_at, acknowledged_at, acknowledged_by)
     values (%L, %L, ''tenant'', %L, %L, ''info'', %L, %L, %L, %L, %L, %L)',
    '11111111-1111-4111-8111-111111111111', p_kind, p_entity, p_date, p_audience, p_cost, p_payload,
    p_created, p_ack_at, p_ack_by))
$$;

-- A cost-bearing kind, for the RLS and constraint cases (M6 registers only the two test kinds).
insert into app.alert_kind (kind, cost_bearing, default_severity, default_audience)
  values ('test_cost', true, 'warning', '{owner,admin}');

-- The kind registry -----------------------------------------------------------------------------------
select is((select string_agg(kind || ':' || cost_bearing || ':' || default_severity || ':' || default_audience::text,
                             ' ' order by kind) from app.alert_kind where kind like 'test\_alert%'),
  'test_alert:false:info:{owner,admin} test_alert_kitchen:false:info:{owner,admin,chef}',
  'M6 registers the two test kinds');
select is(left(pg_temp.err($$ insert into app.alert_kind values ('Bad Kind', false, 'info', '{owner,admin}') $$), 5),
  '23514', 'a kind name is lower-case words');
select is(left(pg_temp.err($$ insert into app.alert_kind values ('with_waiter', false, 'info', '{owner,admin,waiter}') $$), 5),
  '23514', 'a default audience cannot include the waiter');
select is(pg_temp.err($$ insert into app.alert_kind values ('cost_chef', true, 'info', '{owner,admin,chef}') $$),
  '23514 alert_kind_cost_audience_ck', 'a cost-bearing kind cannot default to the chef');
select ok(not has_table_privilege('authenticated', 'app.alert_kind', 'select, insert, update, delete')
  and not has_table_privilege('service_role', 'app.alert_kind', 'select, insert, update, delete')
  and not has_table_privilege('anon', 'app.alert_kind', 'select, insert, update, delete'),
  'no API role has a privilege on the registry');

-- alert_business_date: DST vectors (AT2) --------------------------------------------------------------
select is(app.alert_business_date('11111111-1111-4111-8111-111111111111', v.at::timestamptz), v.expected::date,
  'Europe/Rome: ' || v.at || ' is ' || v.expected)
  from (values
    ('2026-10-24T21:59:59Z', '2026-10-24'),
    ('2026-10-24T22:00:00Z', '2026-10-25'), -- 00:00 CEST
    ('2026-10-25T00:30:00Z', '2026-10-25'), -- 02:30 CEST
    ('2026-10-25T01:30:00Z', '2026-10-25'), -- 02:30 CET, after the change
    ('2026-10-25T22:59:59Z', '2026-10-25'),
    ('2026-10-25T23:00:00Z', '2026-10-26'),
    ('2027-03-27T22:59:59Z', '2027-03-27'),
    ('2027-03-27T23:00:00Z', '2027-03-28'), -- 00:00 CET
    ('2027-03-28T00:59:00Z', '2027-03-28'), -- 01:59 CET
    ('2027-03-28T01:00:00Z', '2027-03-28'), -- 03:00 CEST
    ('2027-03-28T21:59:59Z', '2027-03-28'),
    ('2027-03-28T22:00:00Z', '2027-03-29')) v(at, expected);
select is(app.alert_business_date('22222222-2222-4222-8222-222222222222', '2026-10-24T14:59:59Z'), '2026-10-24'::date,
  'the tenant''s own time zone counts (Asia/Tokyo, before midnight)');
select is(app.alert_business_date('22222222-2222-4222-8222-222222222222', '2026-10-24T15:00:00Z'), '2026-10-25'::date,
  'and after midnight');
select is(pg_temp.err($$ select app.alert_business_date('99999999-9999-4999-8999-999999999999', now()) $$),
  'P0002 tenant_not_found', 'an unknown tenant is refused');

-- payload_money_keys ------------------------------------------------------------------------------------
select is(app.payload_money_keys('{"price_eur":1}'), '{price_eur}'::text[], 'a _eur key is a money key');
select is(app.payload_money_keys('{"lines":[{"unit_cost":1}]}'), '{unit_cost}'::text[], 'nested keys are found');
select is(app.payload_money_keys('{"needed_qty":5,"unit":"kg"}'), '{}'::text[], 'quantities are not money');
select is(app.payload_money_keys('{"Margin":1,"importo":2,"PREZZO_X":3,"total_amount":4,"cost":5}'),
  '{Margin,PREZZO_X,cost,importo,total_amount}'::text[], 'the match is case-insensitive and sorted');
select is(app.payload_money_keys('{"a":{"b":{"c":[{"d":{"line_price":1}}]}}}'), '{line_price}'::text[], 'at any depth');
select is(app.payload_money_keys('{"note":"price cost amount"}'), '{}'::text[], 'values are not looked at, only keys');
select is(app.payload_money_keys('{"x":1,"x_eur":1,"y":{"x_eur":2}}'), '{x_eur}'::text[], 'a key is listed once');
select is(app.payload_money_keys('[]'), '{}'::text[], 'an empty array has none');
select is(app.payload_money_keys('[{"price":1}]'), '{price}'::text[], 'a top-level array is walked too');
select ok(not has_function_privilege('authenticated', 'app.alert_business_date(uuid, timestamptz)', 'execute')
  and not has_function_privilege('service_role', 'app.alert_business_date(uuid, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'app.alert_business_date(uuid, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'app.payload_money_keys(jsonb)', 'execute')
  and not has_function_privilege('service_role', 'app.payload_money_keys(jsonb)', 'execute')
  and not has_function_privilege('anon', 'app.payload_money_keys(jsonb)', 'execute'),
  'no API role executes the helpers');

-- Constraints -----------------------------------------------------------------------------------------
select is(pg_temp.ins(), 'ok', 'a plain alert is accepted');
select is(left(pg_temp.ins(p_kind => 'no_such_kind'), 5), '23503', 'an unknown kind is refused');
select is(pg_temp.ins(p_audience => '{owner}', p_entity => gen_random_uuid()), '23514 alert_audience_ck',
  'an audience without admin is refused');
select is(pg_temp.ins(p_audience => '{admin}', p_entity => gen_random_uuid()), '23514 alert_audience_ck',
  'an audience without owner is refused');
select is(pg_temp.ins(p_audience => '{owner,admin,waiter}', p_entity => gen_random_uuid()), '23514 alert_audience_ck',
  'the waiter is refused');
select is(pg_temp.ins(p_kind => 'test_cost', p_audience => '{owner,admin,chef}', p_cost => true, p_entity => gen_random_uuid()),
  '23514 alert_cost_audience_ck', 'a cost-bearing alert cannot reach the chef');
select is(pg_temp.ins(p_audience => '{owner,admin,chef}', p_entity => gen_random_uuid()), 'ok',
  'a non-cost alert can');
select is(pg_temp.ins(p_payload => '[]', p_entity => gen_random_uuid()), '23514 alert_payload_ck',
  'a payload array is refused');
select is(pg_temp.ins(p_payload => jsonb_build_object('note', repeat('x', 9000)), p_entity => gen_random_uuid()),
  '23514 alert_payload_ck', 'a 9 KB payload is refused');
select is(pg_temp.ins(p_payload => jsonb_build_object('note', repeat('x', 8000)), p_entity => gen_random_uuid()),
  'ok', 'an 8 KB payload is fine');
select is(pg_temp.ins(p_ack_at => now(), p_entity => gen_random_uuid()), '23514 alert_ack_ck',
  'an acknowledgement time without a user is refused');
select is(pg_temp.ins(p_ack_by => 'a1000000-0000-4000-8000-00000000000a', p_entity => gen_random_uuid()), '23514 alert_ack_ck',
  'and a user without a time');
select is(left(pg_temp.ins(p_ack_at => now(), p_ack_by => 'b1000000-0000-4000-8000-00000000000b', p_entity => gen_random_uuid()), 5),
  '23503', 'a user of tenant B cannot acknowledge tenant A''s alert');
select is(pg_temp.ins(p_ack_at => now(), p_ack_by => 'a1000000-0000-4000-8000-00000000000a', p_entity => gen_random_uuid()),
  'ok', 'a user of the same tenant can');
select is(left(pg_temp.err($$ insert into public.alert (tenant_id, kind, entity_type, business_date, severity,
    audience_roles, cost_bearing, payload) values ('11111111-1111-4111-8111-111111111111', 'test_alert', 'Bad Type',
    '2026-11-02', 'info', '{owner,admin}', false, '{}') $$), 5),
  '23514', 'an entity type is lower-case words');
select is(pg_temp.ins(), '23505 alert_dedup_uq', 'the same key on the same day is refused');
select is(pg_temp.ins(p_date => '2026-11-03'), 'ok', 'the next day is a new row');
select is(pg_temp.ins(p_entity => null, p_date => '2026-11-04'), 'ok', 'a null entity is allowed once');
select is(pg_temp.ins(p_entity => null, p_date => '2026-11-04'), '23505 alert_dedup_uq',
  'and twice is a duplicate (nulls not distinct)');
select is(pg_temp.ins(p_kind => 'test_alert_kitchen'), 'ok', 'another kind on the same day is a new row');

-- Guard (append-only except for a set-once acknowledgement) ----------------------------------------------
select is(pg_temp.ins(p_entity => '77777777-7777-4777-8777-777777777777', p_created => now() - interval '2 days'),
  'ok', 'an alert can be inserted with a past created_at (the test clock)');
select is(pg_temp.err($$ update public.alert set created_at = now() where entity_id = '77777777-7777-4777-8777-777777777777' $$),
  'P0001 alert_immutable', 'created_at cannot move');
select is(pg_temp.err($$ update public.alert set payload = '{"a":1}' where entity_id = '77777777-7777-4777-8777-777777777777' $$),
  'P0001 alert_immutable', 'the payload cannot change');
select is(pg_temp.err($$ update public.alert set kind = 'test_alert_kitchen' where entity_id = '77777777-7777-4777-8777-777777777777' $$),
  'P0001 alert_immutable', 'the kind cannot change');
select is(pg_temp.err($$ update public.alert set business_date = '2026-01-01' where entity_id = '77777777-7777-4777-8777-777777777777' $$),
  'P0001 alert_immutable', 'the business date cannot change');
select is(pg_temp.err($$ update public.alert set audience_roles = '{owner,admin,chef}' where entity_id = '77777777-7777-4777-8777-777777777777' $$),
  'P0001 alert_immutable', 'the audience cannot change');
select is(pg_temp.err($$ update public.alert set cost_bearing = true where entity_id = '77777777-7777-4777-8777-777777777777' $$),
  'P0001 alert_immutable', 'the cost flag cannot change');
select is(pg_temp.err($$ update public.alert set acknowledged_at = '2026-11-02T10:00Z',
    acknowledged_by = 'a1000000-0000-4000-8000-00000000000a' where entity_id = '77777777-7777-4777-8777-777777777777' $$),
  'ok', 'the acknowledgement can be set from null');
select is(pg_temp.err($$ update public.alert set acknowledged_at = '2026-11-02T11:00Z',
    acknowledged_by = 'a1000000-0000-4000-8000-00000000000a' where entity_id = '77777777-7777-4777-8777-777777777777' $$),
  'P0001 alert_immutable', 'an existing acknowledgement cannot change');
select is(pg_temp.err($$ update public.alert set acknowledged_at = null, acknowledged_by = null
    where entity_id = '77777777-7777-4777-8777-777777777777' $$),
  'P0001 alert_immutable', 'or be cleared');
select is(pg_temp.err($$ update public.alert set acknowledged_by = 'a1000000-0000-4000-8000-0000000000ad'
    where entity_id = '77777777-7777-4777-8777-777777777777' $$),
  'P0001 alert_immutable', 'or be given to someone else');
select is((select acknowledged_at from public.alert where entity_id = '77777777-7777-4777-8777-777777777777'),
  '2026-11-02T10:00Z'::timestamptz, 'the first acknowledgement stands');
select is(pg_temp.err($$ update public.alert set payload = payload where entity_id = '77777777-7777-4777-8777-777777777777' $$),
  'ok', 'an update that changes nothing is harmless');
select is(pg_temp.err($$ delete from public.alert $$), 'P0001 append_only', 'DELETE raises for the migration owner');
select is(pg_temp.err($$ truncate public.alert cascade $$), 'P0001 append_only', 'TRUNCATE raises for the migration owner');

-- RLS (AT6) -------------------------------------------------------------------------------------------
-- Fixture: one alert of each audience, in tenant A, distinct entities and days. Existing rows above
-- are on other entities; the counts below are by entity.
insert into public.alert (id, tenant_id, kind, entity_type, entity_id, business_date, severity, audience_roles,
    cost_bearing, payload) values
  ('a1e00000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'test_alert', 'rls_case',
   'e0000000-0000-4000-8000-000000000001', '2026-11-05', 'info', '{owner,admin}', false, '{}'),
  ('a1e00000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'test_alert_kitchen', 'rls_case',
   'e0000000-0000-4000-8000-000000000002', '2026-11-05', 'info', '{owner,admin,chef}', false, '{}'),
  ('a1e00000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'test_cost', 'rls_case',
   'e0000000-0000-4000-8000-000000000003', '2026-11-05', 'warning', '{owner,admin}', true, '{"amount_eur":12}');

set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is((select coalesce(string_agg(right(id::text, 1), '' order by id), '-') from public.alert where entity_type = 'rls_case'), '123', 'the owner reads all three');
select pg_temp.act_as('a0000000-0000-4000-8000-0000000000ad', '11111111-1111-4111-8111-111111111111', 'admin');
select is((select coalesce(string_agg(right(id::text, 1), '' order by id), '-') from public.alert where entity_type = 'rls_case'), '123', 'the admin reads all three');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is((select coalesce(string_agg(right(id::text, 1), '' order by id), '-') from public.alert where entity_type = 'rls_case'), '2', 'the chef reads only the chef-audience, non-cost alert');
select is((select count(*)::int from public.alert where cost_bearing), 0, 'and never a cost-bearing one');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is((select count(*)::int from public.alert), 0, 'the waiter reads none');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is((select count(*)::int from public.alert), 0, 'owner B reads none of tenant A''s');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select throws_ok($$ insert into public.alert (tenant_id, kind, entity_type, business_date, severity, audience_roles,
    cost_bearing, payload) values ('11111111-1111-4111-8111-111111111111', 'test_alert', 'x_case', '2026-11-06',
    'info', '{owner,admin}', false, '{}') $$, '42501', null, 'authenticated cannot insert');
select throws_ok($$ update public.alert set acknowledged_at = now() $$, '42501', null, 'authenticated cannot update');
select throws_ok($$ delete from public.alert $$, '42501', null, 'authenticated cannot delete');
reset role;
set local role anon;
select throws_ok($$ select count(*) from public.alert $$, '42501', null, 'anon cannot read');
reset role;
select ok(not has_table_privilege('service_role', 'public.alert', 'select, insert, update, delete, truncate'),
  'service_role has no privilege on alert');
select ok(has_table_privilege('authenticated', 'public.alert', 'select')
  and not has_table_privilege('authenticated', 'public.alert', 'insert, update, delete, truncate'),
  'authenticated can only select');

select * from finish();
rollback;
