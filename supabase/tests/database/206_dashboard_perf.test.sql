-- Owner dashboard plan step 5 (docs/plans/2026-10-28-owner-dashboard.md §5, AT10, T2): a regression net for the cost of
-- dashboard_summary() on demo-shaped history. It is NOT a latency claim and promises no number.
-- Fixture, tenant A (owner), scaled up with generate_series then `analyze`d: 40 plates (3 priced ingredients each, so the menu
-- food cost is 30.00 %), 300 ingredients, 3 000 lots and 20 000 stock movements over 400 days, 2 000 batches with 10 000 batch
-- movements (all drained, so none is "expiring"), 2 000 payables, 5 000 alerts (acknowledged except the planted ones).
-- Planted in the current week: payables PA D-3 100.00 and PB D-1 50.50 overdue, PC D+2 40.00 due soon; a lot of an
-- ingredient with a minimum, expiring tomorrow; a batch due soon with 4 portions; a raw waste of 2 kg at 3.00 on the
-- Monday of the week; three open alerts of which one is a prep_due of today. Tenant B has a few rows of its own so that the
-- tenant filter has something to skip.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)'),
  ('10000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'Dispensa (demo)'),
  ('10000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Cella B (demo)');
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore Uno (demo)', 'IT12345678903'),
  ('5c000000-0000-4000-8000-00000000005c', '11111111-1111-4111-8111-111111111111', 'Fornitore Due (demo)', 'IT00000000000'),
  ('5b000000-0000-4000-8000-00000000005b', '22222222-2222-4222-8222-222222222222', 'Fornitore B (demo)', 'IT22222222220');

create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'Europe/Rome')::date $$;
create function pg_temp.id(prefix text, n int) returns uuid language sql immutable as $$
  select (prefix || '-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true) $$;
grant execute on function pg_temp.today(), pg_temp.id(text, int), pg_temp.act_as(uuid, uuid, text) to authenticated;

-- Invoices: 40 holding invoice lines (100 lines each: ingredient prices, lots), one per payable (2 000 + 3 planted), one for B.
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id)
select pg_temp.id('e1000000', n), '11111111-1111-4111-8111-111111111111',
       '11111111-1111-4111-8111-111111111111/2026/' || pg_temp.id('e1000000', n) || '.pdf', 'application/pdf', 2048, 'received',
       '5a000000-0000-4000-8000-00000000005a'
  from generate_series(1, 40) n;
insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price, line_amount, field_confidence, extracted)
select pg_temp.id('a2000000', n), '11111111-1111-4111-8111-111111111111', pg_temp.id('e1000000', (n - 1) / 100 + 1), (n - 1) % 100 + 1,
       'Riga demo', 1, 1, 1, '{}', '{}'
  from generate_series(1, 3999) n;

-- 300 ingredients, each priced at 1.00 per kg (one price_history row each, on its own invoice line 1..300).
insert into public.ingredient (id, tenant_id, name, base_unit, is_stock, is_active)
select pg_temp.id('11000000', n), '11111111-1111-4111-8111-111111111111', 'Ingrediente ' || lpad(n::text, 3, '0') || ' (fixture)', 'kg', true, true
  from generate_series(1, 300) n;
insert into public.price_history (tenant_id, ingredient_id, supplier_id, invoice_line_id, unit_price, base_unit, effective_on, created_by)
select '11111111-1111-4111-8111-111111111111', pg_temp.id('11000000', n), '5a000000-0000-4000-8000-00000000005a', pg_temp.id('a2000000', n), 1.00, 'kg',
       pg_temp.today() - 100, 'a1000000-0000-4000-8000-00000000000a'
  from generate_series(1, 300) n;

-- 40 plates of 3 lines of 1 kg (food cost 3.00), price 11.00 with VAT (10.00 without): food cost 30.00 %, GP 70 %, target 65.
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by)
select pg_temp.id('ec000000', n), '11111111-1111-4111-8111-111111111111', 'plate', 1, 'piatto ' || n, 'a1000000-0000-4000-8000-00000000000a'
  from generate_series(1, 40) n;
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by)
select pg_temp.id('ed000000', n), '11111111-1111-4111-8111-111111111111', pg_temp.id('ec000000', n), 1, '2026-01-01T00:00Z',
       'Piatto ' || lpad(n::text, 2, '0') || ' (fixture)', 'a1000000-0000-4000-8000-00000000000a'
  from generate_series(1, 40) n;
insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, qty, unit, yield_factor, created_by)
select '11111111-1111-4111-8111-111111111111', pg_temp.id('ed000000', n), p, pg_temp.id('11000000', (n - 1) * 3 + p), 1, 'kg', 1,
       'a1000000-0000-4000-8000-00000000000a'
  from generate_series(1, 40) n, generate_series(1, 3) p;
insert into public.recipe_price (recipe_id, tenant_id, sale_price, target_gp_pct, created_by)
select pg_temp.id('ed000000', n), '11111111-1111-4111-8111-111111111111', 11.00, 65, 'a1000000-0000-4000-8000-00000000000a'
  from generate_series(1, 40) n;

-- 3 000 lots (invoice lines 1 001..4 000 would exceed the series: lots reuse lines 301..3 300), received over 400 days.
-- Expiry: none for 60 %, else between 10 days ago and 90 days ahead. A lot that expired or expires by tomorrow is drained.
insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code, expiry, received_on,
    qty_received, base_unit, source_qty, source_unit, base_factor, created_by)
select pg_temp.id('1e000000', n), '11111111-1111-4111-8111-111111111111', pg_temp.id('11000000', (n % 280) + 21),
       '10000000-0000-4000-8000-0000000000a1', '5a000000-0000-4000-8000-00000000005a', pg_temp.id('a2000000', 300 + n), 'L-' || n,
       case when n % 5 < 3 then null else pg_temp.today() - 10 + (n % 101) end, pg_temp.today() - (n % 400), 10, 'kg', 10, 'kg', 1,
       'a1000000-0000-4000-8000-00000000000a'
  from generate_series(1, 3000) n;
insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type, ref_id, effective_on, created_by)
select '11111111-1111-4111-8111-111111111111', l.ingredient_id, l.id, l.location_id, 'receipt', 10, 1, 'invoice_line', l.invoice_line_id, l.received_on,
       'a1000000-0000-4000-8000-00000000000a'
  from public.raw_lot l where l.tenant_id = '11111111-1111-4111-8111-111111111111';
-- Consumption: every lot expiring by tomorrow is drained; 14 000 more movements of 0.0005 kg spread over 400 days (waste is
-- kept out of the current week and the week before).
insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, ref_type, ref_id, effective_on, created_by)
select '11111111-1111-4111-8111-111111111111', l.ingredient_id, l.id, l.location_id, 'consumption', -10, 'order', gen_random_uuid(), pg_temp.today(),
       'a1000000-0000-4000-8000-00000000000a'
  from public.raw_lot l where l.tenant_id = '11111111-1111-4111-8111-111111111111' and l.expiry is not null and l.expiry <= pg_temp.today() + 1;
insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, ref_type, ref_id, effective_on, created_by)
select '11111111-1111-4111-8111-111111111111', l.ingredient_id, l.id, l.location_id, 'consumption', -0.0005, 'order', gen_random_uuid(),
       pg_temp.today() - 1 - (n % 399), 'a1000000-0000-4000-8000-00000000000a'
  from generate_series(1, 14000) n join public.raw_lot l on l.id = pg_temp.id('1e000000', (n % 3000) + 1);
insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, reason_code, ref_type, ref_id, effective_on, created_by)
select '11111111-1111-4111-8111-111111111111', l.ingredient_id, l.id, l.location_id, 'waste', -0.0005, 1, 'spoilage', 'waste', gen_random_uuid(),
       pg_temp.today() - 30 - (n % 360), 'a1000000-0000-4000-8000-00000000000a'
  from generate_series(1, 2000) n join public.raw_lot l on l.id = pg_temp.id('1e000000', (n % 3000) + 1);

-- 2 000 batches of 100 portions, drained by four discards of 25 (10 000 movements with the productions).
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by)
  values ('c2000000-0000-4000-8000-0000000000c1', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'sugo', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch, shelf_life_hours, created_by)
  values ('c3000000-0000-4000-8000-0000000000c1', '11111111-1111-4111-8111-111111111111', 'c2000000-0000-4000-8000-0000000000c1', 1, '2026-10-01T00:00Z',
          'Sugo (fixture)', 6, 'kg', 30, 72, 'a1000000-0000-4000-8000-00000000000a');
insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code, lot_seq, produced_at, produced_by,
    output_qty, output_unit, portions_computed, portions_initial, shelf_life_hours, use_by, location_id, created_by)
select pg_temp.id('ba000000', n), '11111111-1111-4111-8111-111111111111', 'c2000000-0000-4000-8000-0000000000c1', 'c3000000-0000-4000-8000-0000000000c1', 1,
       to_char(pg_temp.today() - (n % 400), 'YYMMDD') || '-SUGO-' || n, pg_temp.today() - (n % 400), 'SUGO', n, now() - make_interval(days => 5 + n % 400), 'a1000000-0000-4000-8000-00000000000a', 6, 'kg',
       100, 100, 72, now() - make_interval(days => 2 + n % 400), '10000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-00000000000a'
  from generate_series(1, 2000) n;
insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
select '11111111-1111-4111-8111-111111111111', pg_temp.id('ba000000', n), 'produce', 100, 'batch', pg_temp.id('ba000000', n), pg_temp.today() - 5 - (n % 400),
       'a1000000-0000-4000-8000-00000000000a'
  from generate_series(1, 2000) n;
insert into public.batch_movement (tenant_id, batch_id, type, portions, reason_code, ref_type, ref_id, effective_on, created_by)
select '11111111-1111-4111-8111-111111111111', pg_temp.id('ba000000', n), 'waste', -25, 'expired', 'batch_discard', gen_random_uuid(),
       pg_temp.today() - 30 - (n % 360), 'a1000000-0000-4000-8000-00000000000a'
  from generate_series(1, 2000) n, generate_series(1, 4) k;

-- 2 000 payables: half paid in the past, half unpaid and due 10 to 400 days ahead (outside the 7-day window).
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id)
select pg_temp.id('e2000000', n), '11111111-1111-4111-8111-111111111111',
       '11111111-1111-4111-8111-111111111111/2026/' || pg_temp.id('e2000000', n) || '.pdf', 'application/pdf', 2048, 'received',
       case when n % 2 = 0 then '5a000000-0000-4000-8000-00000000005a'::uuid else '5c000000-0000-4000-8000-00000000005c'::uuid end
  from generate_series(1, 2003) n;
insert into public.payable (id, tenant_id, invoice_id, supplier_id, gross_amount, credited_amount, amount, due_date, due_date_source, status, paid_at, paid_on, created_by)
select pg_temp.id('90000000', n), '11111111-1111-4111-8111-111111111111', pg_temp.id('e2000000', n),
       case when n % 2 = 0 then '5a000000-0000-4000-8000-00000000005a'::uuid else '5c000000-0000-4000-8000-00000000005c'::uuid end,
       25, 0, 25, case when n % 2 = 0 then pg_temp.today() - 5 - (n % 300) else pg_temp.today() + 10 + (n % 390) end, 'invoice',
       case when n % 2 = 0 then 'paid' else 'open' end::public.payable_status, case when n % 2 = 0 then now() end,
       case when n % 2 = 0 then pg_temp.today() - 3 end, 'a1000000-0000-4000-8000-00000000000a'
  from generate_series(1, 2000) n;

-- 5 000 alerts, all acknowledged, over 400 days.
insert into public.alert (tenant_id, kind, entity_type, entity_id, business_date, severity, audience_roles, cost_bearing, payload, created_at,
    acknowledged_at, acknowledged_by)
select '11111111-1111-4111-8111-111111111111', case n % 3 when 0 then 'prep_due' when 1 then 'purchase_due' else 'price_variance' end,
       'ingredient', gen_random_uuid(), pg_temp.today() - 1 - (n % 400), 'warning', k.default_audience, k.cost_bearing, '{}'::jsonb,
       now() - make_interval(days => 1 + n % 400, mins => n % 1000), now(), 'a1000000-0000-4000-8000-00000000000a'
  from generate_series(1, 5000) n
  join app.alert_kind k on k.kind = case n % 3 when 0 then 'prep_due' when 1 then 'purchase_due' else 'price_variance' end;

-- Planted rows --------------------------------------------------------------------------------------------------------------
create function pg_temp.monday() returns date language sql as $$ select pg_temp.today() - (extract(isodow from pg_temp.today())::int - 1) $$;
insert into public.payable (id, tenant_id, invoice_id, supplier_id, gross_amount, credited_amount, amount, due_date, due_date_source, status, created_by) values
  (pg_temp.id('90000000', 2001), '11111111-1111-4111-8111-111111111111', pg_temp.id('e2000000', 2001), '5a000000-0000-4000-8000-00000000005a', 100.00, 0, 100.00, pg_temp.today() - 3, 'invoice', 'open', 'a1000000-0000-4000-8000-00000000000a'),
  (pg_temp.id('90000000', 2002), '11111111-1111-4111-8111-111111111111', pg_temp.id('e2000000', 2002), '5c000000-0000-4000-8000-00000000005c', 50.50, 0, 50.50, pg_temp.today() - 1, 'invoice', 'scheduled', 'a1000000-0000-4000-8000-00000000000a'),
  (pg_temp.id('90000000', 2003), '11111111-1111-4111-8111-111111111111', pg_temp.id('e2000000', 2003), '5a000000-0000-4000-8000-00000000005a', 40.00, 0, 40.00, pg_temp.today() + 2, 'invoice', 'open', 'a1000000-0000-4000-8000-00000000000a');
-- The planted ingredient (min 5) holds one lot of 3 kg that expires tomorrow: below minimum and an expiring lot.
insert into public.ingredient (id, tenant_id, name, base_unit, is_stock, is_active, min_level, target_level) values
  ('11000000-0000-4000-8000-0000000009a1', '11111111-1111-4111-8111-111111111111', 'Pianta (fixture)', 'kg', true, true, 5, 8);
insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code, expiry, received_on, qty_received, base_unit, source_qty, source_unit, base_factor, created_by)
  values (pg_temp.id('1e000000', 9001), '11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-0000000009a1', '10000000-0000-4000-8000-0000000000a1',
          '5a000000-0000-4000-8000-00000000005a', pg_temp.id('a2000000', 3999), 'L-PIANTA', pg_temp.today() + 1, pg_temp.today() - 2, 3, 'kg', 3, 'kg', 1, 'a1000000-0000-4000-8000-00000000000a');
insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type, ref_id, effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-0000000009a1', pg_temp.id('1e000000', 9001), '10000000-0000-4000-8000-0000000000a1',
          'receipt', 3, 1, 'invoice_line', pg_temp.id('a2000000', 3999), pg_temp.today() - 2, 'a1000000-0000-4000-8000-00000000000a');
-- A raw waste in the current week: 2 kg at 3.00 = 6.00 (on the Monday, so it is inside whichever day it runs).
insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, reason_code, ref_type, ref_id, effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', pg_temp.id('11000000', 21), pg_temp.id('1e000000', 1), '10000000-0000-4000-8000-0000000000a1',
          'waste', -2, 3.00, 'spoilage', 'waste', gen_random_uuid(), pg_temp.monday(), 'a1000000-0000-4000-8000-00000000000a');
-- A batch due soon with 4 portions.
insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code, lot_seq, produced_at, produced_by, output_qty, output_unit,
    portions_computed, portions_initial, shelf_life_hours, use_by, location_id, created_by)
  values (pg_temp.id('ba000000', 9001), '11111111-1111-4111-8111-111111111111', 'c2000000-0000-4000-8000-0000000000c1', 'c3000000-0000-4000-8000-0000000000c1', 1,
          to_char(pg_temp.today(), 'YYMMDD') || '-SUGO-9001', pg_temp.today(), 'SUGO', 9001, now() - interval '60 hours', 'a1000000-0000-4000-8000-00000000000a', 6, 'kg', 4, 4, 72, now() + interval '12 hours',
          '10000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-00000000000a');
insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', pg_temp.id('ba000000', 9001), 'produce', 4, 'batch', pg_temp.id('ba000000', 9001), pg_temp.today(), 'a1000000-0000-4000-8000-00000000000a');
-- Three open alerts: a prep_due of today, a price_variance, a purchase_due.
insert into public.alert (tenant_id, kind, entity_type, entity_id, business_date, severity, audience_roles, cost_bearing, payload)
select '11111111-1111-4111-8111-111111111111', k.kind, 'ingredient', gen_random_uuid(), pg_temp.today(), 'warning', k.default_audience, k.cost_bearing, '{}'::jsonb
  from app.alert_kind k where k.kind in ('prep_due', 'price_variance', 'purchase_due');
-- Tenant B: a few unpaid payables, overdue, to be skipped by the tenant filter.
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id)
select pg_temp.id('e3000000', n), '22222222-2222-4222-8222-222222222222',
       '22222222-2222-4222-8222-222222222222/2026/' || pg_temp.id('e3000000', n) || '.pdf', 'application/pdf', 2048, 'received',
       '5b000000-0000-4000-8000-00000000005b'
  from generate_series(1, 5) n;
insert into public.payable (id, tenant_id, invoice_id, supplier_id, gross_amount, credited_amount, amount, due_date, due_date_source, status, created_by)
select pg_temp.id('90000000', 8000 + n), '22222222-2222-4222-8222-222222222222', pg_temp.id('e3000000', n),
       '5b000000-0000-4000-8000-00000000005b', 10, 0, 10, pg_temp.today() - n, 'invoice', 'open', 'b1000000-0000-4000-8000-00000000000b'
  from generate_series(1, 5) n;

analyze;

-- The answer, within a time limit ---------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
set local statement_timeout = '5s';
create temp table s as select public.dashboard_summary() as j;
reset statement_timeout;
reset role;

select is((select j -> 'foodCost' from s), '{"overallPct": 30.00, "platesCounted": 40, "platesIncomplete": 0}'::jsonb, 'dashboard_summary answers within 5 s on the scaled fixture: food cost 30.00 % over 40 plates');
select is((select j -> 'payables' -> 'overdue' from s), '{"count": 2, "amountEur": 150.50}'::jsonb, 'the two planted overdue payables, 150.50');
select is((select j -> 'payables' -> 'dueSoon' from s), '{"count": 1, "amountEur": 40.00}'::jsonb, 'and the planted due-soon one');
select is((select (j -> 'stockAtRisk' -> 'belowMin' ->> 'count')::int from s), 1, 'one ingredient below its minimum');
select is((select (j -> 'stockAtRisk' -> 'expiringLots' ->> 'count')::int from s), 1, 'one expiring lot (the drained ones do not count)');
select is((select (j -> 'stockAtRisk' -> 'expiringBatches' ->> 'count')::int from s), 1, 'one expiring batch');
select is((select j -> 'waste' ->> 'valueEur' from s), '6.0000', 'the week''s waste is the planted 6.00');
select is((select j -> 'alertsOpen' from s), '{"count": 3, "more": false}'::jsonb, 'three open alerts');

-- The plan check (T2): the helpers' queries, as the migration owner with the tenant as a literal -------------------------------
create function pg_temp.plan_of(p_sql text) returns text language plpgsql as $$
declare
  v_plan json;
begin
  execute 'explain (format json) ' || p_sql into v_plan;
  return v_plan::text;
end
$$;
select matches(pg_temp.plan_of($q$select rl.id from public.raw_lot rl
    where rl.tenant_id = '11111111-1111-4111-8111-111111111111' and rl.expiry is not null and rl.expiry <= current_date + 1$q$),
  'raw_lot_expiry_idx', 'the expiring-lots read uses raw_lot_expiry_idx');
select matches(pg_temp.plan_of($q$select p.id from public.payable p
    where p.tenant_id = '11111111-1111-4111-8111-111111111111' and p.status <> 'paid' and p.due_date <= current_date + 7$q$),
  'payable_unpaid_due_idx', 'the payables read uses payable_unpaid_due_idx');
select matches(pg_temp.plan_of($q$select m.id from public.stock_movement m
    where m.tenant_id = '11111111-1111-4111-8111-111111111111' and m.type::text = 'waste' and m.effective_on between current_date - 3 and current_date + 3$q$),
  'stock_movement_effective_idx', 'the week''s raw waste uses stock_movement_effective_idx');
select doesnt_match(pg_temp.plan_of($q$select m.id from public.stock_movement m
    where m.tenant_id = '11111111-1111-4111-8111-111111111111' and m.type::text = 'waste' and m.effective_on between current_date - 3 and current_date + 3$q$),
  '"Node Type": "Seq Scan",[^{}]*"Relation Name": "stock_movement"', 'and does not seq-scan stock_movement');
select doesnt_match(pg_temp.plan_of($q$select m.id from public.batch_movement m
    where m.tenant_id = '11111111-1111-4111-8111-111111111111' and m.type::text = 'waste' and m.effective_on between current_date - 3 and current_date + 3$q$),
  '"Node Type": "Seq Scan",[^{}]*"Relation Name": "batch_movement"', 'nor batch_movement for the batch side of the waste');
select matches(pg_temp.plan_of($q$select m.id from public.stock_movement m where m.qty = -2$q$),
  '"Node Type": "Seq Scan",[^{}]*"Relation Name": "stock_movement"', 'control: the seq-scan pattern does match a scan that is one');

select * from finish();
rollback;
