-- M13 step 7: the ledger_drift alert kind (M13 plan §3.1.10, §3.2; ADR-012). Not cost-bearing, severity critical,
-- audience owner only, ids and counts in the payload. The owner reads it; the chef, admin, waiter and another
-- tenant's owner do not (M6 RLS).
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('a0000000-0000-4000-8000-0000000000ad', 'admin-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
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
grant execute on function pg_temp.act_as(uuid, uuid, text), pg_temp.err(text) to authenticated, anon;

select is((select k.cost_bearing::text || ' ' || k.default_severity::text || ' ' || k.default_audience::text
             from app.alert_kind k where k.kind = 'ledger_drift'),
  'false critical {owner}', 'the kind exists: not cost-bearing, critical, owner only');

select is((select alert_id is not null and inserted from app.raise_alert('11111111-1111-4111-8111-111111111111',
  'ledger_drift', 'tenant', '11111111-1111-4111-8111-111111111111',
  '{"checks":[{"check_key":"lot_negative","rows_count":1,"sample_ids":["10700000-0000-4000-8000-0000000000a1"]}],"checked_at":"2026-10-24T02:45:00Z"}',
  null, null, '2026-10-24T02:45:00Z')), true, 'a payload of codes, counts and ids is raised');
select is((select audience_roles::text || ' ' || cost_bearing::text || ' ' || severity::text from public.alert
            where kind = 'ledger_drift'), '{owner} false critical', 'audience owner, not cost-bearing, severity critical');
select is((select business_date::text from public.alert where kind = 'ledger_drift'), '2026-10-24',
  'the business date is the Rome date of the instant');
select is(pg_temp.err($$ select app.raise_alert('11111111-1111-4111-8111-111111111111', 'ledger_drift', 'tenant',
  '11111111-1111-4111-8111-111111111111', '{"checks":[],"checked_at":"x","amount_eur":1}') $$),
  'P0001 alert_payload_cost_key', 'a payload with a money key is refused');

select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
set local role authenticated;
select is((select count(*)::int from public.alert where kind = 'ledger_drift'), 1, 'owner A reads it');
reset role;
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
set local role authenticated;
select is((select count(*)::int from public.alert where kind = 'ledger_drift'), 0, 'chef A reads none');
reset role;
select pg_temp.act_as('a0000000-0000-4000-8000-0000000000ad', '11111111-1111-4111-8111-111111111111', 'admin');
set local role authenticated;
select is((select count(*)::int from public.alert where kind = 'ledger_drift'), 0, 'admin A reads none (M6; Q33 would change this)');
reset role;
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
set local role authenticated;
select is((select count(*)::int from public.alert where kind = 'ledger_drift'), 0, 'waiter A reads none');
reset role;
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
set local role authenticated;
select is((select count(*)::int from public.alert where kind = 'ledger_drift'), 0, 'owner B reads none');
reset role;

-- A second raise the same Rome day is the same alert (dedup per tenant, kind, entity and business date).
select is((select inserted from app.raise_alert('11111111-1111-4111-8111-111111111111', 'ledger_drift', 'tenant',
  '11111111-1111-4111-8111-111111111111', '{"checks":[],"checked_at":"2026-10-24T20:00:00Z"}', null, null,
  '2026-10-24T20:00:00Z')), false, 'a second raise on the same Rome day is not a new alert');

select * from finish();
rollback;
