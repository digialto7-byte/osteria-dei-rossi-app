-- M6 step 4 (migration 20261022150200_raise_alert.sql): app.raise_alert (dedup per business date, audience,
-- cost guards, created_by) and public.alert_kind_list. Runs as the migration owner (no API role can execute
-- app.raise_alert); the caller's identity comes from the claims, as it will for M8's approve_invoice.
-- Acceptance tests: AT1 (same alert twice on one business date, next date a new row), AT2 (dedup across DST).
begin;
create extension if not exists pgtap with schema extensions;
select plan(66);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B');

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
-- Every raise_alert call of the test is kept here: label, returned id, inserted flag.
create temporary table calls (label text, alert_id uuid, inserted boolean);
create function pg_temp.raise(p_label text, p_kind text, p_entity_type text, p_at timestamptz,
    p_payload jsonb default '{}', p_tenant uuid default '11111111-1111-4111-8111-111111111111',
    p_audience public.app_role[] default null, p_business_date date default null,
    p_severity public.alert_severity default null) returns void language sql as $$
  insert into calls
    select p_label, r.alert_id, r.inserted
      from app.raise_alert(p_tenant, p_kind, p_entity_type, p_tenant, p_payload, p_severity, p_audience, p_at,
                           p_business_date) r
$$;
create function pg_temp.rows_of(p_entity_type text) returns int language sql as $$
  select count(*)::int from public.alert where entity_type = p_entity_type
$$;
create function pg_temp.dates_of(p_entity_type text) returns text language sql as $$
  select coalesce(string_agg(business_date::text, ' ' order by business_date), '-')
    from public.alert where entity_type = p_entity_type
$$;
create function pg_temp.call(p_label text) returns calls language sql as $$
  select c from calls c where label = p_label
$$;

-- The registry as the integration parity check sees it ---------------------------------------------------
select is((select string_agg(kind || ':' || cost_bearing, ' ' order by kind collate "C") from public.alert_kind_list()),
  'device_locked:false negative_stock:false payable_due_7d:true payable_due_today:true payable_overdue_3d:true payables_weekly_digest:true price_variance:true test_alert:false test_alert_kitchen:false',
  'alert_kind_list returns exactly the registered kinds (M6, M8, the four M9 payable kinds, the M11 device_locked kind and M12 negative_stock)');
select ok(has_function_privilege('service_role', 'public.alert_kind_list()', 'execute')
  and not has_function_privilege('authenticated', 'public.alert_kind_list()', 'execute')
  and not has_function_privilege('anon', 'public.alert_kind_list()', 'execute'),
  'alert_kind_list is for service_role only');

insert into app.alert_kind (kind, cost_bearing, default_severity, default_audience)
  values ('test_cost', true, 'warning', '{owner}');

-- AT1: one alert per kind and entity per business date ----------------------------------------------------
select pg_temp.raise('first', 'test_alert', 'day_case', '2026-11-02T09:00Z');
select pg_temp.raise('same_day', 'test_alert', 'day_case', '2026-11-02T15:00Z');
select pg_temp.raise('next_day', 'test_alert', 'day_case', '2026-11-03T09:00Z');
select is((pg_temp.call('first')).inserted, true, 'the first call inserts');
select is((pg_temp.call('same_day')).inserted, false, 'the second call on the same day inserts nothing');
select is((pg_temp.call('same_day')).alert_id, (pg_temp.call('first')).alert_id, 'and returns the first alert''s id');
select is((pg_temp.call('next_day')).inserted, true, 'the next day inserts a second row');
select isnt((pg_temp.call('next_day')).alert_id, (pg_temp.call('first')).alert_id, 'with its own id');
select is(pg_temp.dates_of('day_case'), '2026-11-02 2026-11-03', 'two rows, one per business date');

-- Another kind, and another tenant, are other alerts ----------------------------------------------------------
select pg_temp.raise('kitchen', 'test_alert_kitchen', 'day_case', '2026-11-02T09:00Z');
select is((pg_temp.call('kitchen')).inserted, true, 'another kind on the same day is a new alert');
select pg_temp.raise('tenant_b', 'test_alert', 'day_case', '2026-11-02T09:00Z', p_tenant => '22222222-2222-4222-8222-222222222222');
select is((pg_temp.call('tenant_b')).inserted, true, 'another tenant on the same day is a new alert');
select is((select tenant_id from public.alert where id = (pg_temp.call('tenant_b')).alert_id),
  '22222222-2222-4222-8222-222222222222'::uuid, 'stored under its own tenant');

-- AT2: dedup across the daylight-saving changes ------------------------------------------------------------
select pg_temp.raise('dst_a1', 'test_alert', 'dst_a', '2026-10-25T00:30Z'); -- 02:30 CEST
select pg_temp.raise('dst_a2', 'test_alert', 'dst_a', '2026-10-25T01:30Z'); -- 02:30 CET, an hour later
select is(pg_temp.rows_of('dst_a'), 1, 'the repeated 02:30 is one alert');
select is(pg_temp.dates_of('dst_a'), '2026-10-25', 'dated 2026-10-25');
select is((pg_temp.call('dst_a2')).inserted, false, 'the second one is a repeat');

select pg_temp.raise('dst_b1', 'test_alert', 'dst_b', '2026-10-24T22:00Z');
select pg_temp.raise('dst_b2', 'test_alert', 'dst_b', '2026-10-25T22:59Z');
select is(pg_temp.rows_of('dst_b'), 1, 'the 25-hour day is one alert from first to last minute');

select pg_temp.raise('dst_c1', 'test_alert', 'dst_c', '2027-03-27T23:00Z');
select pg_temp.raise('dst_c2', 'test_alert', 'dst_c', '2027-03-28T21:59Z');
select is(pg_temp.rows_of('dst_c'), 1, 'the 23-hour day is one alert from first to last minute');
select pg_temp.raise('dst_c3', 'test_alert', 'dst_c', '2027-03-28T22:00Z');
select is(pg_temp.dates_of('dst_c'), '2027-03-28 2027-03-29', 'and the next minute of local time is a new row');

-- An explicit business date wins over the clock ------------------------------------------------------------
select pg_temp.raise('override', 'test_alert', 'override_case', '2030-01-01T00:00Z', p_business_date => '2026-11-02');
select is(pg_temp.dates_of('override_case'), '2026-11-02', 'p_business_date overrides the clock');

-- Audience ---------------------------------------------------------------------------------------------------
select pg_temp.raise('aud_chef', 'test_alert', 'aud_a', '2026-11-02T09:00Z', p_audience => '{chef}');
select is((select audience_roles from public.alert where id = (pg_temp.call('aud_chef')).alert_id),
  '{owner,chef}'::public.app_role[], '{chef} is stored as owner, chef (the owner always receives it)');
select pg_temp.raise('aud_dup', 'test_alert', 'aud_b', '2026-11-02T09:00Z', p_audience => '{chef,owner,chef,owner}');
select is((select audience_roles from public.alert where id = (pg_temp.call('aud_dup')).alert_id),
  '{owner,chef}'::public.app_role[], 'duplicates are removed and the order is fixed');
select is((select audience_roles from public.alert where id = (pg_temp.call('first')).alert_id),
  '{owner}'::public.app_role[], 'no audience means the kind''s default (test_alert)');
select is((select audience_roles from public.alert where id = (pg_temp.call('kitchen')).alert_id),
  '{owner,chef}'::public.app_role[], 'and test_alert_kitchen''s default includes the chef');
select is(pg_temp.err($$ select app.raise_alert('11111111-1111-4111-8111-111111111111', 'test_alert', 'aud_c',
    null, '{}', null, '{waiter}') $$), 'P0001 alert_audience_invalid', 'the waiter is refused');
select is(pg_temp.err($$ select app.raise_alert('11111111-1111-4111-8111-111111111111', 'test_alert', 'aud_c',
    null, '{}', null, '{admin}') $$), 'P0001 alert_audience_invalid', 'the admin is refused too (the owner is the recipient)');
select is(pg_temp.err($$ select app.raise_alert('11111111-1111-4111-8111-111111111111', 'test_alert', 'aud_c',
    null, '{}', null, '{owner,admin}') $$), 'P0001 alert_audience_invalid', 'the admin among others');
select is(pg_temp.err($$ select app.raise_alert('11111111-1111-4111-8111-111111111111', 'test_alert', 'aud_c',
    null, '{}', null, '{chef,waiter}') $$), 'P0001 alert_audience_invalid', 'also among others');
select is(pg_temp.err($$ select app.raise_alert('11111111-1111-4111-8111-111111111111', 'test_alert', 'aud_c',
    null, '{}', null, array[null]::public.app_role[]) $$), 'P0001 alert_audience_invalid', 'and a null role');

-- Severity ---------------------------------------------------------------------------------------------------
select is((select severity from public.alert where id = (pg_temp.call('first')).alert_id), 'info'::public.alert_severity,
  'the severity defaults to the kind''s');
select pg_temp.raise('sev', 'test_alert', 'sev_case', '2026-11-02T09:00Z', p_severity => 'critical');
select is((select severity from public.alert where id = (pg_temp.call('sev')).alert_id), 'critical'::public.alert_severity,
  'and can be given');

-- Cost guards -----------------------------------------------------------------------------------------------
select is(pg_temp.err($$ select app.raise_alert('11111111-1111-4111-8111-111111111111', 'test_cost', 'cost_a',
    null, '{}', null, '{chef}') $$), 'P0001 alert_audience_cost', 'a cost-bearing kind refuses the chef');
select is(pg_temp.err($$ select app.raise_alert('11111111-1111-4111-8111-111111111111', 'test_alert', 'cost_b',
    null, '{"x":{"unit_cost":1}}') $$), 'P0001 alert_payload_cost_key', 'a non-cost kind refuses a money key at depth');
select is(pg_temp.err($$ select app.raise_alert('11111111-1111-4111-8111-111111111111', 'test_alert', 'cost_b',
    null, '{"needed_qty":5,"unit":"kg"}') $$), 'ok', 'but accepts quantities');
-- Widened guard (20261022150600): more money words, and money in values
select is(pg_temp.err(format($$ select app.raise_alert('11111111-1111-4111-8111-111111111111', 'test_alert', 'cost_w',
    null, %L) $$, json_build_object(w, 1)::text)), 'P0001 alert_payload_cost_key', 'a non-cost kind refuses the key ' || w)
  from unnest(array['total', 'totale', 'valore', 'imponibile', 'iva', 'vat']) w;
select is(pg_temp.err($$ select app.raise_alert('11111111-1111-4111-8111-111111111111', 'test_alert', 'cost_v',
    null, '{"note":"12,50 €"}') $$), 'P0001 alert_payload_cost_value', 'a non-cost kind refuses a value with the euro sign');
select is(pg_temp.err($$ select app.raise_alert('11111111-1111-4111-8111-111111111111', 'test_alert_kitchen', 'cost_v',
    null, '{"lines":[{"detail":["ok","12,50 €"]}]}') $$), 'P0001 alert_payload_cost_value',
  'also nested, in an array, for a kitchen kind');
select is(pg_temp.err($$ select app.raise_alert('11111111-1111-4111-8111-111111111111', 'test_alert', 'cost_v',
    null, '{"a":{"b":"10 eur"}}') $$), 'P0001 alert_payload_cost_value', 'and EUR in any case');
select is(pg_temp.err($$ select app.raise_alert('11111111-1111-4111-8111-111111111111', 'test_alert', 'cost_v',
    null, '{"needed_qty":5,"unit":"kg","note":"Pesce fresco","supplier":"Euroricambi"}') $$), 'ok',
  'plain quantities and text are accepted');
select is(pg_temp.err($$ select app.raise_alert('11111111-1111-4111-8111-111111111111', 'test_alert', 'cost_v',
    null, '"12 €"') $$), 'P0001 alert_payload_invalid', 'a payload that is not an object is invalid, not a cost value');
select is(pg_temp.err($$ select app.raise_alert('11111111-1111-4111-8111-111111111111', 'test_cost', 'cost_v',
    null, '{"amount_eur":12.5,"note":"12,50 €"}', null, '{owner}') $$), 'ok',
  'a cost-bearing kind still accepts amount_eur and a euro sign in a value, for the owner');
select pg_temp.raise('cost_ok', 'test_cost', 'cost_c', '2026-11-02T09:00Z', '{"amount_eur":12.5}', p_audience => '{owner}');
select is((select cost_bearing from public.alert where id = (pg_temp.call('cost_ok')).alert_id), true,
  'a cost-bearing kind takes a money payload for the owner, and the row says so');
select is((select audience_roles from public.alert where id = (pg_temp.call('cost_ok')).alert_id),
  '{owner}'::public.app_role[], 'for the owner only');
select is((select cost_bearing from public.alert where id = (pg_temp.call('first')).alert_id), false,
  'a non-cost kind''s alert says it is not cost-bearing');

-- Payload shape ------------------------------------------------------------------------------------------------
select is(pg_temp.err($$ select app.raise_alert('11111111-1111-4111-8111-111111111111', 'test_alert', 'pl_a',
    null, '[]') $$), 'P0001 alert_payload_invalid', 'an array payload is refused');
select is(pg_temp.err($$ select app.raise_alert('11111111-1111-4111-8111-111111111111', 'test_alert', 'pl_a',
    null, '"text"') $$), 'P0001 alert_payload_invalid', 'a scalar payload is refused');
select is(pg_temp.err($$ select app.raise_alert('11111111-1111-4111-8111-111111111111', 'test_alert', 'pl_a',
    null, null) $$), 'P0001 alert_payload_invalid', 'a null payload is refused');
select is(pg_temp.err(format($f$ select app.raise_alert('11111111-1111-4111-8111-111111111111', 'test_alert', 'pl_a',
    null, %L) $f$, jsonb_build_object('note', repeat('x', 9000)))), 'P0001 alert_payload_invalid',
  'a 9 KB payload is refused');
select is(pg_temp.err(format($f$ select app.raise_alert('11111111-1111-4111-8111-111111111111', 'test_alert', 'pl_b',
    null, %L) $f$, jsonb_build_object('note', repeat('x', 8000)))), 'ok', 'an 8 KB payload is accepted');
select is(pg_temp.rows_of('pl_a'), 0, 'nothing was stored for the refused ones');

-- Errors ------------------------------------------------------------------------------------------------------
select is(pg_temp.err($$ select app.raise_alert('11111111-1111-4111-8111-111111111111', 'no_such_kind', 'err_a',
    null) $$), 'P0001 unknown_alert_kind', 'an unknown kind is refused');
select is(pg_temp.err($$ select app.raise_alert('99999999-9999-4999-8999-999999999999', 'test_alert', 'err_a',
    null) $$), 'P0002 tenant_not_found', 'an unknown tenant is refused');
select is(pg_temp.rows_of('err_a'), 0, 'nothing was stored');

-- created_by --------------------------------------------------------------------------------------------------
select is((select created_by from public.alert where id = (pg_temp.call('first')).alert_id), null,
  'created_by is null when no one is signed in (a scheduled job)');

-- A definer wrapper owned by the migration owner, the way M8's approve_invoice will call it.
create function public.test_raise_wrapper(p_tenant uuid, p_entity_type text) returns uuid
  language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  select r.alert_id into v_id from app.raise_alert(p_tenant, 'test_alert', p_entity_type, p_tenant) r;
  return v_id;
end
$$;
grant execute on function public.test_raise_wrapper(uuid, text) to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a',
  'role', 'authenticated', 'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'owner')::text, true);
create temporary table wrapped (label text, alert_id uuid);
grant insert on wrapped to authenticated;
insert into wrapped values ('own', public.test_raise_wrapper('11111111-1111-4111-8111-111111111111', 'by_owner'));
insert into wrapped values ('other', public.test_raise_wrapper('22222222-2222-4222-8222-222222222222', 'by_owner'));
reset role;
select is((select created_by from public.alert where id = (select alert_id from wrapped where label = 'own')),
  'a1000000-0000-4000-8000-00000000000a'::uuid, 'created_by is the signed-in user when the tenant is theirs');
select is((select created_by from public.alert where id = (select alert_id from wrapped where label = 'other')), null,
  'and null when the alert is for another tenant (a bug in a caller cannot name a foreign user)');

-- Privileges --------------------------------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'app.raise_alert(uuid, text, text, uuid, jsonb, public.alert_severity, public.app_role[], timestamptz, date)', 'execute'),
  'authenticated cannot execute app.raise_alert');
select ok(not has_function_privilege('service_role', 'app.raise_alert(uuid, text, text, uuid, jsonb, public.alert_severity, public.app_role[], timestamptz, date)', 'execute'),
  'service_role cannot execute app.raise_alert');
select ok(not has_function_privilege('anon', 'app.raise_alert(uuid, text, text, uuid, jsonb, public.alert_severity, public.app_role[], timestamptz, date)', 'execute'),
  'anon cannot execute app.raise_alert');
set local role authenticated;
select throws_ok($$ select app.raise_alert('11111111-1111-4111-8111-111111111111', 'test_alert', 'priv', null) $$,
  '42501', null, 'and calling it as authenticated is refused');
reset role;
set local role service_role;
select throws_ok($$ select app.raise_alert('11111111-1111-4111-8111-111111111111', 'test_alert', 'priv', null) $$,
  '42501', null, 'and as service_role');
select lives_ok($$ select * from public.alert_kind_list() $$, 'alert_kind_list runs for service_role');
reset role;
set local role authenticated;
select throws_ok($$ select * from public.alert_kind_list() $$, '42501', null, 'alert_kind_list is refused to authenticated');
reset role;

select * from finish();
rollback;
