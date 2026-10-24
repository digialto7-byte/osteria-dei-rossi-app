-- M16 step 5: the five alert kinds of the rules (plan §3.2, §3.3): registry flags and audiences, one sample payload per kind
-- accepted by app.raise_alert for its default audience and by app.chef_payload_allowed, the guard still refusing an extra
-- free-text key, and the chef reading the kitchen kinds but not the purchase kind. Fake ids only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo');

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
  select set_config('request.jwt.claims', json_build_object('sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true) $$;
grant execute on function pg_temp.err(text), pg_temp.act_as(uuid, uuid, text) to authenticated;

select is((select string_agg(k.kind || ' ' || k.cost_bearing::text || ' ' || k.default_severity::text || ' ' || k.default_audience::text, '; ' order by k.kind)
             from app.alert_kind k where k.kind in ('prep_due', 'prep_raw_short', 'purchase_due', 'raw_lot_expiring', 'batch_expiring')),
  'batch_expiring false warning {owner,chef}; prep_due false warning {owner,chef}; prep_raw_short false warning {owner,chef}; purchase_due false warning {owner}; raw_lot_expiring false warning {owner,chef}',
  'the five rows: none cost-bearing, severity warning, purchase owner only, the others owner and chef');
select is((select count(*)::int from app.alert_kind), 15, 'fifteen kinds in the registry (ten before)');

create temp table samples (kind text primary key, entity_type text not null, entity_id uuid not null, payload jsonb not null);
insert into samples values
  ('prep_due', 'recipe_key', 'b2000000-0000-4000-8000-000000000001', '{"recipe_key":"b2000000-0000-4000-8000-000000000001","recipe_id":"c2000000-0000-4000-8000-000000000011","remaining_portions_qty":4,"min_portions_count":5,"target_portions_count":30,"batches_count":1,"prep_hours":3,"ingredient_id":"1a000000-0000-4000-8000-000000000001","needed_qty":5.0,"on_hand_qty":12.3,"unit":"kg"}'),
  ('prep_raw_short', 'recipe_key', 'b2000000-0000-4000-8000-000000000002', '{"recipe_key":"b2000000-0000-4000-8000-000000000002","recipe_id":"c2000000-0000-4000-8000-000000000012","remaining_portions_qty":4,"min_portions_count":5,"ingredient_id":"1a000000-0000-4000-8000-000000000001","needed_qty":5.0,"on_hand_qty":3.0,"unit":"kg","short_count":1,"supplier_id":"5a000000-0000-4000-8000-00000000005a","order_by_at":"2026-11-03T10:00:00Z","delivery_date":"2026-11-05"}'),
  ('purchase_due', 'ingredient', '1a000000-0000-4000-8000-000000000001', '{"ingredient_id":"1a000000-0000-4000-8000-000000000001","supplier_id":"5a000000-0000-4000-8000-00000000005a","supplier_item_id":"51000000-0000-4000-8000-000000000001","order_qty":10,"packs_count":2,"pack_qty":5,"unit":"kg","order_by_at":"2026-11-03T10:00:00Z","delivery_date":"2026-11-05","horizon_days":3,"on_hand_qty":9,"forecast_qty":7,"projected_qty":2,"min_qty":5,"target_qty":12}'),
  ('raw_lot_expiring', 'raw_lot', '10700000-0000-4000-8000-0000000000a1', '{"raw_lot_id":"10700000-0000-4000-8000-0000000000a1","ingredient_id":"1a000000-0000-4000-8000-000000000002","remaining_qty":1,"unit":"kg","expiry_date":"2026-11-03","state_key":"due_soon"}'),
  ('batch_expiring', 'batch', 'ba000000-0000-4000-8000-0000000000a1', '{"batch_id":"ba000000-0000-4000-8000-0000000000a1","recipe_key":"b2000000-0000-4000-8000-000000000001","remaining_portions_qty":6,"use_by_at":"2026-11-03T06:00:00Z","state_key":"due_soon"}');

select is((select count(*)::int from samples s where app.chef_payload_allowed(s.payload)), 5, 'every sample passes app.chef_payload_allowed');
select is((select count(*)::int from samples s where app.payload_money_keys(s.payload) = '{}'), 5, 'and has no money-like key');
select is((select string_agg(s.kind || ':' || (select r.inserted::text from app.raise_alert('11111111-1111-4111-8111-111111111111', s.kind, s.entity_type,
  s.entity_id, s.payload, null, null, '2026-11-02T14:00:00Z') r), ',' order by s.kind) from samples s),
  'batch_expiring:true,prep_due:true,prep_raw_short:true,purchase_due:true,raw_lot_expiring:true',
  'raise_alert accepts every sample for the kind''s default audience');
select is((select string_agg(kind || ' ' || audience_roles::text || ' ' || severity::text || ' ' || business_date::text, '; ' order by kind) from public.alert),
  'batch_expiring {owner,chef} warning 2026-11-02; prep_due {owner,chef} warning 2026-11-02; prep_raw_short {owner,chef} warning 2026-11-02; purchase_due {owner} warning 2026-11-02; raw_lot_expiring {owner,chef} warning 2026-11-02',
  'the rows carry the registry audience, severity warning and the Rome date');
select is((select count(*)::int from public.alert where cost_bearing), 0, 'none is cost-bearing');
select is((select r.inserted from app.raise_alert('11111111-1111-4111-8111-111111111111', 'prep_due', 'recipe_key',
  'b2000000-0000-4000-8000-000000000001', (select payload from samples where kind = 'prep_due'), null, null, '2026-11-02T15:00:00Z') r), false,
  'the same item on the same day is not raised twice (dedup)');
select is((select r.inserted from app.raise_alert('11111111-1111-4111-8111-111111111111', 'prep_due', 'recipe_key',
  'b2000000-0000-4000-8000-000000000001', (select payload from samples where kind = 'prep_due'), null, null, '2026-11-03T15:00:00Z') r), true,
  'and on the next day it is');
select is((select r.alert_id is not null from app.raise_alert('11111111-1111-4111-8111-111111111111', 'raw_lot_expiring', 'raw_lot',
  '10700000-0000-4000-8000-0000000000a1', (select payload from samples where kind = 'raw_lot_expiring') || '{"state_key":"expired"}', 'critical', null, '2026-11-04T08:00:00Z') r), true,
  'an expired lot can be raised with severity critical');
select is((select severity::text from public.alert where kind = 'raw_lot_expiring' and business_date = '2026-11-04'), 'critical', 'and is stored critical');

-- The allow-list still refuses free text.
select is(pg_temp.err($$ select app.raise_alert('11111111-1111-4111-8111-111111111111', 'prep_due', 'recipe_key', 'b2000000-0000-4000-8000-0000000000ff',
  '{"recipe_key":"b2000000-0000-4000-8000-000000000001","recipe_name":"Spezzatino"}', null, null, '2026-11-02T14:00:00Z') $$),
  'P0001 alert_payload_not_allowed', 'a prep_due sample with a recipe_name key is refused');
select is(pg_temp.err($$ select app.raise_alert('11111111-1111-4111-8111-111111111111', 'prep_due', 'recipe_key', 'b2000000-0000-4000-8000-0000000000fe',
  '{"recipe_key":"b2000000-0000-4000-8000-000000000001","note":"x"}', null, null, '2026-11-02T14:00:00Z') $$),
  'P0001 alert_payload_not_allowed', 'and so is any other key without a typed suffix');
select is(pg_temp.err($$ select app.raise_alert('11111111-1111-4111-8111-111111111111', 'purchase_due', 'ingredient', 'b2000000-0000-4000-8000-0000000000fd',
  '{"ingredient_id":"1a000000-0000-4000-8000-000000000001","order_qty":10,"unit":"kg"}', null, '{chef}', '2026-11-09T14:00:00Z') $$),
  'ok', 'a purchase_due sample with a chef audience passes the guards (its content is chef-safe; the registry decides who gets it)');

-- RLS: who reads what.
create temp table seen (who text, kinds text);
grant all on seen to authenticated;
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
insert into seen select 'owner', (select string_agg(distinct kind, ',' order by kind) from public.alert where business_date = '2026-11-02');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
insert into seen select 'chef', (select string_agg(distinct kind, ',' order by kind) from public.alert where business_date = '2026-11-02');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
insert into seen select 'admin', (select count(*)::text from public.alert);
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
insert into seen select 'waiter', (select count(*)::text from public.alert);
reset role;
select is((select kinds from seen where who = 'owner'), 'batch_expiring,prep_due,prep_raw_short,purchase_due,raw_lot_expiring', 'the owner reads all five');
select is((select kinds from seen where who = 'chef'), 'batch_expiring,prep_due,prep_raw_short,raw_lot_expiring', 'the chef reads the four kitchen kinds, not purchase_due (audience)');
select is((select kinds from seen where who = 'admin'), '0', 'the admin reads no alert (M6 decision)');
select is((select kinds from seen where who = 'waiter'), '0', 'nor does the waiter');
select is((select count(*)::int from public.alert a where 'chef' = any (a.audience_roles) and not app.chef_payload_allowed(a.payload)), 0,
  'every alert a chef can read has an allow-listed payload');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'raise_alert'), 1, 'raise_alert still has one definition');
select is((select count(*)::int from app.alert_kind where kind in ('prep_due', 'prep_raw_short', 'purchase_due', 'raw_lot_expiring', 'batch_expiring') and 'chef' = any (default_audience) and cost_bearing), 0,
  'no cost-bearing kind has the chef in its audience');

select * from finish();
rollback;
