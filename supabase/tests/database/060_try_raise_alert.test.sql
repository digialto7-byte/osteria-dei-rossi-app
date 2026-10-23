-- M8 step 6: app.try_raise_alert, app.alert_refusal, app.record_alert_refusal, app.alert_guard_codes
-- (M8 plan §3.1.9, M7 plan §8). A refused alert is recorded and returns null; anything else
-- propagates. Run as the table owner: these functions are closed to every API role.
begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

insert into auth.users (id, email) values ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo');
-- A cost-bearing test kind (money allowed in the payload, owner only) next to the M6 test kinds.
insert into app.alert_kind (kind, cost_bearing, default_severity, default_audience)
  values ('test_cost_alert', true, 'warning', '{owner}');

create temporary table marker (n int);
create function pg_temp.refusals() returns int language sql as $$ select count(*)::int from app.alert_refusal $$;
create function pg_temp.alerts() returns int language sql as $$ select count(*)::int from public.alert $$;
create function pg_temp.entity(n int) returns uuid language sql immutable as $$
  select ('e0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.try(p_kind text, p_entity int, p_payload jsonb default '{}',
    p_audience public.app_role[] default null, p_caller text default 'test_caller') returns uuid language sql as $$
  select app.try_raise_alert('11111111-1111-4111-8111-111111111111', p_kind, 'test_entity', pg_temp.entity(p_entity),
    p_payload, null, p_audience, now(), null, p_caller) $$;
-- The newest refusal as 'code sqlstate caller kind entity'.
create function pg_temp.last_refusal() returns text language sql as $$
  select code || ' ' || sqlstate || ' ' || caller || ' ' || kind || ' ' || coalesce(entity_type, '-') || ' '
      || coalesce(entity_id::text, '-')
    from app.alert_refusal order by id desc limit 1 $$;

-- 1. A valid alert goes through.
select isnt(pg_temp.try('test_cost_alert', 1, '{"price_eur": 11.1, "note": "11,10 EUR"}'), null,
  'a valid owner alert returns its id (money is allowed in a cost-bearing payload)');
select is(pg_temp.alerts(), 1, 'and exists once');
select is((select a.cost_bearing::text || ' ' || a.audience_roles::text from public.alert a), 'true {owner}',
  'cost-bearing, audience owner');
select is(pg_temp.refusals(), 0, 'nothing refused');
select is(pg_temp.try('test_cost_alert', 1, '{"price_eur": 11.1}'), (select id from public.alert),
  'the same alert again returns the existing id (dedup)');
select is(pg_temp.alerts(), 1, 'and adds none');

-- 2. Guard refusals: null, no alert, one refusal row. The warning goes to the log.
insert into marker values (1);
select is(pg_temp.try('test_cost_alert', 2, '{}', '{chef}'), null, 'audience chef on a cost-bearing kind: null');
select is(pg_temp.alerts(), 1, 'no alert was inserted');
select is(pg_temp.last_refusal(), 'alert_audience_cost P0001 test_caller test_cost_alert test_entity ' || pg_temp.entity(2),
  'one refusal: code, sqlstate, caller, kind and entity');
select is(pg_temp.try('test_cost_alert', 3, jsonb_build_object('pad', repeat('x', 9000))), null, 'a 9 KB payload: null');
select is(split_part(pg_temp.last_refusal(), ' ', 1), 'alert_payload_invalid', 'refused as alert_payload_invalid');
select is(pg_temp.try('no_such_kind', 4), null, 'an unknown kind: null');
select is(pg_temp.last_refusal(), 'unknown_alert_kind P0001 test_caller no_such_kind test_entity ' || pg_temp.entity(4),
  'refused as unknown_alert_kind, the kind recorded');
select is(pg_temp.try('test_cost_alert', 5, '{}', '{waiter}'), null, 'a waiter audience: null');
select is(split_part(pg_temp.last_refusal(), ' ', 1), 'alert_audience_invalid', 'refused as alert_audience_invalid');
select is(pg_temp.try('test_alert', 6, '{"x_eur": 1}'), null, 'a money key on a non-cost kind: null');
select is(split_part(pg_temp.last_refusal(), ' ', 1), 'alert_payload_cost_key', 'refused as alert_payload_cost_key');
select is(pg_temp.try('test_alert', 7, '{"note": "10 EUR"}'), null, 'a money value on a non-cost kind: null');
select is(split_part(pg_temp.last_refusal(), ' ', 1), 'alert_payload_cost_value', 'refused as alert_payload_cost_value');
select is(pg_temp.refusals(), 6, 'six refusals in all');
select is(pg_temp.alerts(), 1, 'and still one alert');
select is(pg_temp.try('test_alert', 8, '{}', null, 'approve_invoice') is not null, true, 'a valid alert after the refusals works');
select throws_ok($$ select pg_temp.try('test_cost_alert', 12, '{}', '{chef}', 'Bad Caller') $$, '23514', null,
  'the caller is a code, not free text (table check); a refused refusal is an error, not a silent drop');
-- T2: the work of the outer transaction survives a refusal (only the nested block is rolled back).
select is((select count(*)::int from marker), 1, 'T2: the row inserted before the refused calls is still there');
select is((select string_agg(code, ',' order by id) from app.alert_refusal),
  'alert_audience_cost,alert_payload_invalid,unknown_alert_kind,alert_audience_invalid,alert_payload_cost_key,alert_payload_cost_value',
  'T2: and the refusal rows were written by the handler in the outer transaction');

-- 3. Not swallowed.
select throws_ok($$ select app.try_raise_alert('99999999-9999-4999-8999-999999999999', 'test_alert', 'test_entity',
    'e0000000-0000-4000-8000-000000000099', '{}', null, null, now(), null, 'test_caller') $$,
  'P0002', 'tenant_not_found', 'T3: an unknown tenant is P0002, not a refusal');
select is(pg_temp.refusals(), 6, 'and records nothing');
create or replace function app.raise_alert(p_tenant uuid, p_kind text, p_entity_type text, p_entity_id uuid,
    p_payload jsonb default '{}', p_severity public.alert_severity default null,
    p_audience public.app_role[] default null, p_at timestamptz default now(), p_business_date date default null)
  returns table (alert_id uuid, inserted boolean)
  language plpgsql security definer set search_path = ''
as $$
begin
  if p_kind = 'boom' then
    raise exception 'boom' using errcode = 'P0001';
  elsif p_kind = 'div' then
    return query select (1 / (select 0))::text::uuid, true;
  end if;
  return query select null::uuid, false;
end
$$;
select throws_ok($$ select pg_temp.try('boom', 9) $$, 'P0001', 'boom', 'a P0001 that is not a guard code is re-raised');
select throws_ok($$ select pg_temp.try('div', 10) $$, '22012', null, 'and so is any other error (division by zero)');
select is(pg_temp.refusals(), 6, 'neither is recorded as a refusal');

-- 4. The table and the functions.
select is((select array_agg(a.attname::text order by a.attnum) from pg_attribute a
            where a.attrelid = 'app.alert_refusal'::regclass and a.attnum > 0 and not a.attisdropped),
  array['id', 'tenant_id', 'kind', 'entity_type', 'entity_id', 'caller', 'code', 'sqlstate', 'at'],
  'app.alert_refusal has no payload and no message column');
select ok((select c.relrowsecurity from pg_class c where c.oid = 'app.alert_refusal'::regclass)
      and not exists (select 1 from pg_policies p where p.schemaname = 'app' and p.tablename = 'alert_refusal'),
  'it has RLS on and no policy');
select is_empty(
  $$ select r.rolname from (values ('anon'), ('authenticated'), ('service_role')) r (rolname)
      where has_table_privilege(r.rolname, 'app.alert_refusal', 'select, insert, update, delete, truncate')
         or has_any_column_privilege(r.rolname, 'app.alert_refusal', 'select, insert, update') $$,
  'no API role has any privilege on it');
select is(app.alert_guard_codes(),
  array['unknown_alert_kind', 'alert_audience_invalid', 'alert_audience_cost', 'alert_payload_cost_key',
        'alert_payload_invalid', 'alert_payload_cost_value'],
  'the six guard codes of raise_alert');
select is_empty(
  $$ select f.fn || ' ' || r.rolname from (values
       ('app.try_raise_alert(uuid, text, text, uuid, jsonb, public.alert_severity, public.app_role[], timestamptz, date, text)'),
       ('app.record_alert_refusal(uuid, text, text, uuid, text, text, text)'),
       ('app.alert_guard_codes()')) f (fn)
      cross join (values ('anon'), ('authenticated'), ('service_role')) r (rolname)
      where has_function_privilege(r.rolname, f.fn, 'execute') $$,
  'no API role can execute try_raise_alert, record_alert_refusal or alert_guard_codes');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""'] and p.provolatile = 'v'
             from pg_proc p where p.proname = 'try_raise_alert' and p.pronamespace = 'app'::regnamespace),
  'try_raise_alert is volatile, security definer, with an empty search_path');
select ok((select p.prosrc ~ 'raise warning' from pg_proc p
            where p.proname = 'record_alert_refusal' and p.pronamespace = 'app'::regnamespace),
  'a refusal also raises a warning (the database log)');

select * from finish();
rollback;
