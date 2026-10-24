-- M16 step 7: app.purchase_rule (plan §3.1.7; PRD Macelleria example; AT3, AT7). Clock Monday 2026-11-02 15:00 Rome. The beef
-- fixture is the one of plan §3.8 (hand-computed weekday averages, noise that must be ignored, 9,0 on hand). Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

insert into auth.users (id, email) values ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)'),
  ('10000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Cella B (demo)');
-- Suppliers: mac (the AT3 window), noday (no weekdays), nolead (no lead time), inact (inactive), zero (lead 0, Mondays 11:00); B: mac.
insert into public.supplier (id, tenant_id, name, vat_number, lead_time_days, delivery_weekdays, order_cutoff_time, is_active) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Macelleria X (demo)', 'IT12345678903', 2, '{1,4}', '11:00', true),
  ('5a000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'Orto Y (demo)', 'IT33333333335', 1, '{}', null, true),
  ('5a000000-0000-4000-8000-0000000000a3', '11111111-1111-4111-8111-111111111111', 'Pescheria Z (demo)', 'IT10000000017', null, '{2}', '09:00', true),
  ('5a000000-0000-4000-8000-0000000000a4', '11111111-1111-4111-8111-111111111111', 'Vecchio Fornitore (demo)', 'IT22222222220', 1, '{3}', '10:00', false),
  ('5a000000-0000-4000-8000-0000000000a5', '11111111-1111-4111-8111-111111111111', 'Latteria W (demo)', 'IT44444444440', 0, '{1}', '11:00', true),
  ('5a000000-0000-4000-8000-0000000000b5', '22222222-2222-4222-8222-222222222222', 'Macelleria B (demo)', 'IT12345678903', 2, '{1,4}', '11:00', true);
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id) values
  ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/e1000000-0000-4000-8000-0000000000e1.pdf', 'application/pdf', 2048, 'review', '5a000000-0000-4000-8000-00000000005a'),
  ('e1000000-0000-4000-8000-0000000000e2', '22222222-2222-4222-8222-222222222222',
   '22222222-2222-4222-8222-222222222222/2026/e1000000-0000-4000-8000-0000000000e2.pdf', 'application/pdf', 2048, 'review', '5a000000-0000-4000-8000-0000000000b5');

create temporary table reg (k text primary key, id uuid not null);
insert into reg values ('cella', '10000000-0000-4000-8000-0000000000a1'), ('cellab', '10000000-0000-4000-8000-0000000000b1');
create function pg_temp.id(p_k text) returns uuid language sql as $$ select id from reg where k = p_k $$;
create sequence pg_temp.line_seq;
create sequence pg_temp.lot_seq;
create function pg_temp.new_line(p_tenant uuid) returns uuid language plpgsql as $$
declare
  v_n int := nextval('pg_temp.line_seq');
  v_line uuid := ('a2000000-0000-4000-8000-' || lpad(v_n::text, 12, '0'))::uuid;
begin
  insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price, line_amount, field_confidence, extracted)
    values (v_line, p_tenant, case when p_tenant = '11111111-1111-4111-8111-111111111111' then 'e1000000-0000-4000-8000-0000000000e1'::uuid
                                   else 'e1000000-0000-4000-8000-0000000000e2'::uuid end, v_n, 'Riga demo', 1, 10, 10, '{}', '{}');
  return v_line;
end
$$;
create function pg_temp.sup_of(p_tenant uuid) returns uuid language sql as $$
  select case when p_tenant = '11111111-1111-4111-8111-111111111111' then '5a000000-0000-4000-8000-00000000005a'::uuid else '5a000000-0000-4000-8000-0000000000b5'::uuid end $$;
create function pg_temp.mk_ing(p_k text, p_name text, p_min numeric, p_target numeric, p_stock boolean default true,
    p_tenant uuid default '11111111-1111-4111-8111-111111111111') returns void language plpgsql as $$
begin
  insert into reg values (p_k, gen_random_uuid());
  insert into public.ingredient (id, tenant_id, name, base_unit, is_stock, min_level, target_level)
    values (pg_temp.id(p_k), p_tenant, p_name, case when p_stock then 'kg' else 'l' end::public.base_unit, p_stock, p_min, p_target);
end
$$;
create function pg_temp.mk_lot(p_ing text, p_expiry date, p_qty numeric, p_tenant uuid default '11111111-1111-4111-8111-111111111111') returns void language plpgsql as $$
declare
  v_line uuid := pg_temp.new_line(p_tenant);
  v_lot uuid := gen_random_uuid();
  v_loc uuid := case when p_tenant = '11111111-1111-4111-8111-111111111111' then pg_temp.id('cella') else pg_temp.id('cellab') end;
  v_by uuid := case when p_tenant = '11111111-1111-4111-8111-111111111111' then 'a1000000-0000-4000-8000-00000000000a'::uuid else 'b1000000-0000-4000-8000-00000000000b'::uuid end;
  v_unit public.base_unit := (select base_unit from public.ingredient where id = pg_temp.id(p_ing));
begin
  insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code, expiry, received_on, qty_received,
      base_unit, source_qty, source_unit, base_factor, created_by)
    values (v_lot, p_tenant, pg_temp.id(p_ing), v_loc, pg_temp.sup_of(p_tenant), v_line, 'L-' || nextval('pg_temp.lot_seq'), p_expiry, '2026-10-01', p_qty,
      v_unit, p_qty, v_unit::text, 1, v_by);
  insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type, ref_id, effective_on, created_by)
    values (p_tenant, pg_temp.id(p_ing), v_lot, v_loc, 'receipt', p_qty, 10, 'invoice_line', v_line, '2026-10-01', v_by);
end
$$;
create function pg_temp.outflow(p_ing text, p_type text, p_qty numeric, p_on date) returns uuid language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.stock_movement (id, tenant_id, ingredient_id, location_id, type, qty, reason_code, ref_type, ref_id, effective_on, created_by)
    values (v_id, '11111111-1111-4111-8111-111111111111', pg_temp.id(p_ing), pg_temp.id('cella'), p_type::public.stock_movement_type, -p_qty,
      case when p_type = 'waste' then 'spoilage' end, 'manual', gen_random_uuid(), p_on, 'a1000000-0000-4000-8000-00000000000a');
  return v_id;
end
$$;
create function pg_temp.reverse_(p_id uuid, p_on date) returns void language plpgsql as $$
begin
  insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, reason_code, unit_cost, ref_type, ref_id, reverses_id, effective_on, created_by)
    select m.tenant_id, m.ingredient_id, m.raw_lot_id, m.location_id, m.type, -m.qty, m.reason_code, m.unit_cost, 'reversal', m.id, m.id, p_on, m.created_by
      from public.stock_movement m where m.id = p_id;
end
$$;
-- An ingredient with a preferred item of the given supplier ('mac' etc.) and pack.
create function pg_temp.mk_buy(p_k text, p_min numeric, p_target numeric, p_onhand numeric, p_sup uuid, p_count numeric, p_qty numeric,
    p_unit text default 'kg', p_pref boolean default true, p_active boolean default true, p_stock boolean default true) returns void language plpgsql as $$
begin
  perform pg_temp.mk_ing(p_k, initcap(p_k) || ' (demo)', p_min, p_target, p_stock);
  if p_onhand > 0 then perform pg_temp.mk_lot(p_k, null, p_onhand); end if;
  if p_sup is not null then
    insert into public.supplier_item (tenant_id, supplier_id, ingredient_id, supplier_code, pack_count, pack_qty, pack_unit, is_preferred, is_active)
      values ('11111111-1111-4111-8111-111111111111', p_sup, pg_temp.id(p_k), upper(p_k), p_count, p_qty, p_unit::public.measure_unit, p_pref, p_active);
  end if;
end
$$;
create function pg_temp.pl(p_k text) returns jsonb language sql as $$
  select a.payload from public.alert a where a.kind = 'purchase_due' and a.entity_id = pg_temp.id(p_k) $$;
create function pg_temp.has(p_k text) returns boolean language sql as $$
  select exists (select 1 from public.alert a where a.kind = 'purchase_due' and a.entity_id = pg_temp.id(p_k)) $$;

-- The beef fixture of plan §3.8 and its supplier item (1 x 5 kg, preferred).
select pg_temp.mk_ing('beef', 'Manzo muscolo (demo)', 5, 12);
select pg_temp.mk_lot('beef', null, 42.5);
insert into public.supplier_item (id, tenant_id, supplier_id, ingredient_id, supplier_code, pack_count, pack_qty, pack_unit, is_preferred, is_active)
  values ('51000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a', pg_temp.id('beef'), 'MZ5', 1, 5, 'kg', true, true);
select pg_temp.outflow('beef', 'consumption', q, d::date) from (values
  (2.0, '2026-10-19'), (2.0, '2026-10-26'), (2.5, '2026-10-20'), (3.5, '2026-10-27'), (1.0, '2026-10-21'), (3.0, '2026-10-28'),
  (1.0, '2026-10-22'), (1.0, '2026-10-29'), (2.0, '2026-10-23'), (4.0, '2026-10-30'), (6.0, '2026-10-31')) v (q, d);
select pg_temp.outflow('beef', 'waste', 0.5, '2026-10-21');
select pg_temp.outflow('beef', 'consumption', 4.0, '2026-10-18');
select pg_temp.reverse_(pg_temp.outflow('beef', 'consumption', 1.0, '2026-10-28'), '2026-10-30');
-- 3,1 kg more are on hand for now, so that on hand is 12,1 until the outflow of 3,1 kg below; today's -1,0 is part of the noise.
select pg_temp.mk_lot('beef', null, 3.1);
select pg_temp.outflow('beef', 'consumption', 1.0, '2026-11-02');
select is((select sum(qty) from public.stock_movement where ingredient_id = pg_temp.id('beef')), 12.1::numeric, 'fixture: beef 12,1 on hand (9,0 plus 3,1)');

-- Edge ingredients (no history: forecast 0). Suppliers: mac, noday, nolead, inact.
select pg_temp.mk_buy('e1', 5, null, 3, '5a000000-0000-4000-8000-00000000005a', 1, 5);
select pg_temp.mk_buy('e2', 5, 12, 5, '5a000000-0000-4000-8000-00000000005a', 1, 5);
select pg_temp.mk_buy('e3', 5, 12, 2, '5a000000-0000-4000-8000-00000000005a', 6, 1);
select pg_temp.mk_buy('e4', 5, 12, 2, '5a000000-0000-4000-8000-00000000005a', 1, 5000, 'g');
select pg_temp.mk_buy('n1', 5, 12, 2, null, 1, 5);
select pg_temp.mk_buy('n2', 5, 12, 2, '5a000000-0000-4000-8000-0000000000a2', 1, 5);
select pg_temp.mk_buy('n3', 5, 12, 2, '5a000000-0000-4000-8000-0000000000a3', 1, 5);
select pg_temp.mk_buy('n4', 5, 12, 2, '5a000000-0000-4000-8000-0000000000a4', 1, 5);
select pg_temp.mk_buy('n5', null, null, 2, '5a000000-0000-4000-8000-00000000005a', 1, 5);
select pg_temp.mk_buy('n6', 5, 12, 2, '5a000000-0000-4000-8000-00000000005a', 1, 5, 'l', true, true, false);
select pg_temp.mk_buy('n7', 5, 12, 2, '5a000000-0000-4000-8000-00000000005a', 1, 5, 'kg', true, false);
select pg_temp.mk_buy('n8', 5, 12, 2, '5a000000-0000-4000-8000-00000000005a', 1, 5, 'kg', false, true);
select pg_temp.mk_buy('e5', 5, 12, 20, '5a000000-0000-4000-8000-00000000005a', 1, 5);
update public.ingredient set is_active = false where id = pg_temp.id('n5');
update public.ingredient set min_level = null, target_level = null where id = pg_temp.id('n5');
select pg_temp.mk_ing('n9', 'N9 (demo)', 5, 12);
-- Tenant B: the same situation as e1, in its own tenant.
select pg_temp.mk_ing('bb', 'Manzo B (demo)', 5, 12, true, '22222222-2222-4222-8222-222222222222');
select pg_temp.mk_lot('bb', null, 2, '22222222-2222-4222-8222-222222222222');
insert into public.supplier_item (tenant_id, supplier_id, ingredient_id, supplier_code, pack_count, pack_qty, pack_unit, is_preferred, is_active)
  values ('22222222-2222-4222-8222-222222222222', '5a000000-0000-4000-8000-0000000000b5', pg_temp.id('bb'), 'MB5', 1, 5, 'kg', true, true);

-- Run 1: beef at 12,1 -> projected 5,1 is not below 5. The edge cases decide the count.
create temporary table res (k text primary key, v integer);
insert into res select 'r1', app.purchase_rule('11111111-1111-4111-8111-111111111111', '2026-11-02T14:00:00Z');
select is((select v from res where k = 'r1'), 3, 'run 1 raises three alerts: the three edge ingredients that are short (e1, e3, e4)');
select is(pg_temp.has('beef'), false, 'beef at 12,1: projected 5,1 is not below the minimum 5: none');
select is(pg_temp.has('e2'), false, 'projected exactly 5 (on hand 5, minimum 5): none (strict <)');
select is(pg_temp.has('e5'), false, 'on hand 20: none');
select is((select count(*)::int from public.alert), 3, 'and nothing else was raised');

-- Edges.
select is(pg_temp.pl('e1') - 'ingredient_id' - 'supplier_item_id',
  '{"supplier_id":"5a000000-0000-4000-8000-00000000005a","order_qty":5,"packs_count":1,"pack_qty":5,"unit":"kg","order_by_at":"2026-11-03T10:00:00Z","delivery_date":"2026-11-05","horizon_days":3,"on_hand_qty":3,"forecast_qty":0,"projected_qty":3,"min_qty":5,"target_qty":5}'::jsonb,
  'target null -> up to the minimum: on hand 3, min 5 -> 1 pack = 5 kg');
select is(pg_temp.pl('e3') ->> 'order_qty', '12', 'pack 6 x 1 kg: a need of 10 rounds up to 2 packs = 12 kg');
select is((pg_temp.pl('e3') ->> 'packs_count')::int || ' ' || (pg_temp.pl('e3') ->> 'pack_qty'), '2 6', 'with packs_count 2 and pack_qty 6 (base units)');
select is(pg_temp.pl('e4') ->> 'order_qty', '10', 'a pack of 5000 g counts as 5 kg: need 10 -> 2 packs = 10 kg');
select is(pg_temp.pl('e4') ->> 'pack_qty', '5', 'pack_qty is in the ingredient''s base unit (5, not 5000)');

-- The beef alert: today's -1,0 and the 3,1 kg bring it to 9,0.
select pg_temp.outflow('beef', 'consumption', 3.1, '2026-11-02');
select is((select sum(qty) from public.stock_movement where ingredient_id = pg_temp.id('beef')), 9.0::numeric, 'fixture: beef 9,0 on hand after every movement');
insert into res select 'r2', app.purchase_rule('11111111-1111-4111-8111-111111111111', '2026-11-02T14:00:00Z');
select is((select v from res where k = 'r2'), 1, 'run 2 raises one new alert (beef)');
select is(pg_temp.pl('beef'),
  ('{"ingredient_id":"' || pg_temp.id('beef') || '","supplier_id":"5a000000-0000-4000-8000-00000000005a","supplier_item_id":"51000000-0000-4000-8000-000000000001","order_qty":10,"packs_count":2,"pack_qty":5,"unit":"kg","order_by_at":"2026-11-03T10:00:00Z","delivery_date":"2026-11-05","horizon_days":3,"on_hand_qty":9,"forecast_qty":7,"projected_qty":2,"min_qty":5,"target_qty":12}')::jsonb,
  'AT3: order 10 kg (2 packs of 5) by Tue 3 Nov 10:00Z for Thu 5 Nov, horizon 3, on hand 9, forecast 7, projected 2');
select is((select forecast_qty from (select (pg_temp.pl('beef') ->> 'forecast_qty')::numeric as forecast_qty) x),
  (select app.forecast_qty(jsonb_object_agg(w.isodow::text, w.avg_qty), '2026-11-02', 3) from app.weekday_consumption('11111111-1111-4111-8111-111111111111', '2026-11-02') w where w.ingredient_id = pg_temp.id('beef')),
  'AT7 in use: the payload forecast equals the Mon + Tue + Wed averages computed by the helper');
select is((select forecast_qty from (select (pg_temp.pl('beef') ->> 'forecast_qty')::numeric as forecast_qty) x), 2.0 + 3.0 + 2.0, 'which is the hand-computed 2,0 + 3,0 + 2,0');
select is((select audience_roles::text || ' ' || severity::text || ' ' || business_date::text || ' ' || entity_type || ' ' || cost_bearing::text
             from public.alert where entity_id = pg_temp.id('beef')), '{owner} warning 2026-11-02 ingredient false', 'owner only, warning, the Rome date, entity ingredient, not cost-bearing');
insert into res select 'r3', app.purchase_rule('11111111-1111-4111-8111-111111111111', '2026-11-02T15:00:00Z');
insert into res select 'r4', app.purchase_rule('11111111-1111-4111-8111-111111111111', '2026-11-02T22:30:00Z');
select is((select v from res where k = 'r3') + (select v from res where k = 'r4'), 0, 'AT4 part: later runs the same Rome day raise nothing');
select is((select count(*)::int from public.alert where kind = 'purchase_due'), 4, 'four alerts in all (e1, e3, e4, beef)');

-- Incomplete settings and non-candidates raise nothing.
select is((select count(*)::int from public.alert a where a.entity_id in (pg_temp.id('n1'), pg_temp.id('n2'), pg_temp.id('n3'), pg_temp.id('n4'),
  pg_temp.id('n5'), pg_temp.id('n6'), pg_temp.id('n7'), pg_temp.id('n8'), pg_temp.id('n9'))), 0,
  'no alert for: no preferred item, supplier without weekdays, null lead time, inactive supplier, no minimum, not a stock ingredient, inactive item, a flagged-but-inactive preferred item');

-- A supplier delivering the same day: Monday 09:00 Rome, lead 0, order by 11:00 today.
select pg_temp.mk_buy('z1', 5, 12, 2, '5a000000-0000-4000-8000-0000000000a5', 1, 5);
insert into res select 'z', app.purchase_rule('11111111-1111-4111-8111-111111111111', '2026-11-09T08:00:00Z');
select is(pg_temp.pl('z1') - 'ingredient_id' - 'supplier_item_id' - 'supplier_id',
  '{"order_qty":10,"packs_count":2,"pack_qty":5,"unit":"kg","order_by_at":"2026-11-09T10:00:00Z","delivery_date":"2026-11-09","horizon_days":0,"on_hand_qty":2,"forecast_qty":0,"projected_qty":2,"min_qty":5,"target_qty":12}'::jsonb,
  'lead 0 on the delivery day: horizon 0, no forecast, order by 11:00 Rome today (10:00Z)');
insert into res select 'z2', app.purchase_rule('11111111-1111-4111-8111-111111111111', '2026-11-09T10:30:00Z');
select is((select count(*)::int from public.alert a where a.entity_id = pg_temp.id('z1')), 1, 'after the deadline the same day the first alert stands (no second alert for the next Monday)');

-- Tenant B.
insert into res select 'b', app.purchase_rule('22222222-2222-4222-8222-222222222222', '2026-11-02T14:00:00Z');
select is((select v from res where k = 'b'), 1, 'tenant B''s run raises B''s own alert');
select is((select a.tenant_id::text from public.alert a where a.entity_id = pg_temp.id('bb')), '22222222-2222-4222-8222-222222222222', 'for tenant B');
select is((select count(*)::int from public.alert a where a.tenant_id = '11111111-1111-4111-8111-111111111111' and a.entity_id = pg_temp.id('bb')), 0, 'and none for tenant A on B''s ingredient');
select is((select (a.payload ->> 'supplier_id') from public.alert a where a.entity_id = pg_temp.id('bb')), '5a000000-0000-4000-8000-0000000000b5', 'using B''s own supplier');
select is((select count(*)::int from public.alert a where a.tenant_id = '22222222-2222-4222-8222-222222222222'), 1, 'and A''s data raised nothing for B');

-- Under another session zone the same instant gives the same business date.
select pg_temp.mk_buy('tz', 5, 12, 2, '5a000000-0000-4000-8000-00000000005a', 1, 5);
set local timezone = 'America/New_York';
insert into res select 'tz', app.purchase_rule('11111111-1111-4111-8111-111111111111', '2026-11-16T01:30:00Z');
set local timezone = 'Europe/Rome';
select is((select a.business_date::text from public.alert a where a.entity_id = pg_temp.id('tz')), '2026-11-16', '2026-11-16T01:30Z is Monday 02:30 in Rome whatever the session zone');

-- Payloads: chef-safe, no money, nothing but ids, dates, instants and codes.
select is((select count(*)::int from public.alert a where a.kind = 'purchase_due' and not app.chef_payload_allowed(a.payload)), 0, 'every payload passes the chef allow-list');
select is((select count(*)::int from public.alert a where app.payload_money_keys(a.payload) <> '{}'), 0, 'and has no money-like key');
select is((select count(*)::int from public.alert a, jsonb_each(a.payload) e where a.kind = 'purchase_due' and jsonb_typeof(e.value) = 'string'
             and e.key not in ('ingredient_id', 'supplier_id', 'supplier_item_id', 'order_by_at', 'delivery_date', 'unit')), 0, 'strings only under id, date, instant and unit keys');
select is_empty(
  $$ select p.proname || ':' || r from pg_proc p, unnest(array['anon', 'authenticated', 'service_role']) r
      where p.pronamespace = 'app'::regnamespace and p.proname = 'purchase_rule' and has_function_privilege(r, p.oid, 'execute') $$,
  'no API role can execute app.purchase_rule');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'purchase_rule' and p.prosecdef
            and p.proconfig @> array['search_path=""']), 1, 'it is security definer with an empty search_path');

select * from finish();
rollback;
