-- Owner dashboard plan step 2 (docs/plans/2026-10-28-owner-dashboard.md decisions 6-9): the week, the payables, the stock at
-- risk, the alerts and the names helpers, and the three cap constants. D is the venue date, M the Monday of its ISO week.
-- Fixture, tenant A (two locations, two suppliers; rows are found by id, never by position):
--   payables PA D-5 120.00 open, PB D-1 30.50 scheduled (overdue 2 / 150.50); PC D 45.00 disputed, PD D+7 200.00 open
--   (due soon 2 / 245.00); PE D+8 99.00 and PF D-10 80.00 paid are out
--   ingredients I1 min 3 usable 2 (below), I2 min 5 usable 5 (not below: strict), I3 no min, I4 inactive and below,
--   I5 min 4 on hand 6 of which 3 in the lot L2 expired yesterday -> usable 3 (below)
--   lots L1 (I1) expiry D+1 2 kg due_soon, L2 (I5) D-1 3 kg expired, L3 D+2 out, L4 expiry D with a zero balance out
--   batches B1 use-by now+12h 4 portions due_soon, B2 now-1h 2 expired, B3 now+30h out, B4 now+2h 0 portions out
--   alerts: price_variance open x2 and acknowledged x1; today prep_due x2 (one acknowledged), prep_raw_short x1,
--   purchase_due x2; yesterday prep_due x1 open -> 7 open
-- Tenant B has one overdue payable, one lot, one batch, one ingredient and one open alert.
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
create function pg_temp.a() returns uuid language sql as $$ select '11111111-1111-4111-8111-111111111111'::uuid $$;
create function pg_temp.b() returns uuid language sql as $$ select '22222222-2222-4222-8222-222222222222'::uuid $$;
create function pg_temp.id(prefix text, n int) returns uuid language sql as $$
  select (prefix || '-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.ids(j jsonb, k text) returns uuid[] language sql as $$
  select coalesce(array_agg((e.v ->> k)::uuid order by e.n), '{}') from jsonb_array_elements(j) with ordinality e(v, n) $$;
create sequence pg_temp.line_seq;
create function pg_temp.new_invoice(p_tenant uuid, p_supplier uuid, p_number text) returns uuid language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id, number_raw)
  values (v_id, p_tenant, p_tenant || '/2026/' || v_id || '.pdf', 'application/pdf', 2048, 'received', p_supplier, p_number);
  return v_id;
end
$$;
-- An invoice line on a fresh invoice of the tenant, for a lot or a receipt.
create function pg_temp.new_line(p_tenant uuid, p_supplier uuid) returns uuid language plpgsql as $$
declare
  v_n int := nextval('pg_temp.line_seq');
  v_line uuid := pg_temp.id('a2000000', v_n);
begin
  insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price, line_amount, field_confidence, extracted)
  values (v_line, p_tenant, pg_temp.new_invoice(p_tenant, p_supplier, null), 1, 'Riga demo', 1, 1, 1, '{}', '{}');
  return v_line;
end
$$;

-- Payables ---------------------------------------------------------------------------------------------------------------
create function pg_temp.pay(n int, p_supplier uuid, due int, p_amount numeric, status text, p_number text default null) returns void language plpgsql as $$
declare
  v_invoice uuid := pg_temp.new_invoice(pg_temp.a(), p_supplier, p_number);
begin
  insert into public.payable (id, tenant_id, invoice_id, supplier_id, gross_amount, credited_amount, amount, due_date, due_date_source,
                              status, paid_at, paid_on, created_by)
  values (pg_temp.id('90000000', n), pg_temp.a(), v_invoice, p_supplier, p_amount, 0, p_amount, pg_temp.today() + due, 'invoice',
          status::public.payable_status, case when status = 'paid' then now() end, case when status = 'paid' then pg_temp.today() - 2 end,
          'a1000000-0000-4000-8000-00000000000a');
end
$$;
select pg_temp.pay(1, '5a000000-0000-4000-8000-00000000005a', -5, 120.00, 'open', 'F-1');
select pg_temp.pay(2, '5c000000-0000-4000-8000-00000000005c', -1, 30.50, 'scheduled', 'F-2');
select pg_temp.pay(3, '5a000000-0000-4000-8000-00000000005a', 0, 45.00, 'disputed');
select pg_temp.pay(4, '5c000000-0000-4000-8000-00000000005c', 7, 200.00, 'open');
select pg_temp.pay(5, '5a000000-0000-4000-8000-00000000005a', 8, 99.00, 'open');
select pg_temp.pay(6, '5c000000-0000-4000-8000-00000000005c', -10, 80.00, 'paid');
-- Tenant B: one overdue payable of 999.00.
insert into public.payable (id, tenant_id, invoice_id, supplier_id, gross_amount, credited_amount, amount, due_date, due_date_source, status, created_by)
  values (pg_temp.id('90000000', 90), pg_temp.b(), pg_temp.new_invoice(pg_temp.b(), '5b000000-0000-4000-8000-00000000005b', 'FB-1'),
          '5b000000-0000-4000-8000-00000000005b', 999.00, 0, 999.00, pg_temp.today() - 3, 'invoice', 'open', 'b1000000-0000-4000-8000-00000000000b');

-- Ingredients, lots, ledger ----------------------------------------------------------------------------------------------
insert into public.ingredient (id, tenant_id, name, base_unit, is_stock, is_active, min_level, target_level) values
  ('11000000-0000-4000-8000-000000000001', pg_temp.a(), 'Burro (fixture)', 'kg', true, true, 3, 6),
  ('11000000-0000-4000-8000-000000000002', pg_temp.a(), 'Olio (fixture)', 'kg', true, true, 5, 8),
  ('11000000-0000-4000-8000-000000000003', pg_temp.a(), 'Pepe (fixture)', 'kg', true, true, null, null),
  ('11000000-0000-4000-8000-000000000004', pg_temp.a(), 'Zucchero (fixture)', 'kg', true, false, 5, 8),
  ('11000000-0000-4000-8000-000000000005', pg_temp.a(), 'Farina (fixture)', 'kg', true, true, 4, 8),
  ('11000000-0000-4000-8000-0000000000b1', pg_temp.b(), 'Sale B (fixture)', 'kg', true, true, 9, 10);
-- A lot with its receipt of p_qty (expiry null = no expiry).
create function pg_temp.lot(n int, p_ing int, p_expiry int, p_qty numeric, p_code text, p_tenant uuid default null) returns void language plpgsql as $$
declare
  v_tenant uuid := coalesce(p_tenant, pg_temp.a());
  v_supplier uuid := case when v_tenant = pg_temp.a() then '5a000000-0000-4000-8000-00000000005a'::uuid else '5b000000-0000-4000-8000-00000000005b'::uuid end;
  v_location uuid := case when v_tenant = pg_temp.a() then '10000000-0000-4000-8000-0000000000a1'::uuid else '10000000-0000-4000-8000-0000000000b1'::uuid end;
  v_ing uuid := case when v_tenant = pg_temp.a() then pg_temp.id('11000000', p_ing) else '11000000-0000-4000-8000-0000000000b1'::uuid end;
  v_owner uuid := (select u.id from public.app_user u where u.tenant_id = v_tenant and u.role = 'owner');
  v_line uuid := pg_temp.new_line(v_tenant, v_supplier);
begin
  insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code, expiry, received_on,
      qty_received, base_unit, source_qty, source_unit, base_factor, created_by)
  values (pg_temp.id('1e000000', n), v_tenant, v_ing, v_location, v_supplier, v_line, p_code,
          case when p_expiry is null then null else pg_temp.today() + p_expiry end, pg_temp.today() - 20, p_qty, 'kg', p_qty, 'kg', 1, v_owner);
  insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type, ref_id, effective_on, created_by)
  values (v_tenant, v_ing, pg_temp.id('1e000000', n), v_location, 'receipt', p_qty, 1, 'invoice_line', v_line, pg_temp.today() - 20, v_owner);
end
$$;
select pg_temp.lot(1, 1, 1, 2, 'L-01');      -- L1: I1, D+1, due_soon, 2 kg (I1 usable 2)
select pg_temp.lot(2, 5, -1, 3, 'L-02');     -- L2: I5, D-1, expired, 3 kg
select pg_temp.lot(5, 5, null, 3, 'L-05');   -- I5 also has 3 kg with no expiry: on hand 6, usable 3
select pg_temp.lot(3, 3, 2, 4, 'L-03');      -- L3: D+2, out (I3)
select pg_temp.lot(4, 3, 0, 2, 'L-04');      -- L4: expiry D, emptied below
insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, ref_type, ref_id, effective_on, created_by)
  values (pg_temp.a(), pg_temp.id('11000000', 3), pg_temp.id('1e000000', 4), '10000000-0000-4000-8000-0000000000a1', 'consumption', -2,
          'test', gen_random_uuid(), pg_temp.today() - 1, 'a1000000-0000-4000-8000-00000000000a');
select pg_temp.lot(6, 2, null, 5, 'L-06');   -- I2: 5 kg, min 5: not below
select pg_temp.lot(7, 4, null, 1, 'L-07');   -- I4: inactive, 1 kg, min 5
select pg_temp.lot(8, 0, 1, 1, 'L-B1', pg_temp.b());   -- tenant B: a lot due tomorrow, I below its min of 9

-- Batches ----------------------------------------------------------------------------------------------------------------
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('c2000000-0000-4000-8000-0000000000c1', pg_temp.a(), 'batch', 1, 'sugo', 'a1000000-0000-4000-8000-00000000000a'),
  ('c2000000-0000-4000-8000-0000000000c2', pg_temp.a(), 'batch', 1, 'ragu', 'a1000000-0000-4000-8000-00000000000a'),
  ('c2000000-0000-4000-8000-0000000000cb', pg_temp.b(), 'batch', 1, 'brodo', 'b1000000-0000-4000-8000-00000000000b');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch, shelf_life_hours, created_by) values
  ('c3000000-0000-4000-8000-0000000000c1', pg_temp.a(), 'c2000000-0000-4000-8000-0000000000c1', 1, '2026-10-01T00:00Z', 'Sugo (fixture)', 6, 'kg', 30, 72, 'a1000000-0000-4000-8000-00000000000a'),
  ('c3000000-0000-4000-8000-0000000000c2', pg_temp.a(), 'c2000000-0000-4000-8000-0000000000c2', 1, '2026-10-01T00:00Z', 'Ragù (fixture)', 6, 'kg', 30, 72, 'a1000000-0000-4000-8000-00000000000a'),
  ('c3000000-0000-4000-8000-0000000000cb', pg_temp.b(), 'c2000000-0000-4000-8000-0000000000cb', 1, '2026-10-01T00:00Z', 'Brodo B (fixture)', 6, 'l', 30, 72, 'b1000000-0000-4000-8000-00000000000b');
-- A batch whose use-by is p_hours from now, with p_portions left.
create function pg_temp.batch(n int, p_recipe int, p_hours numeric, p_portions int, p_tenant uuid default null) returns void language plpgsql as $$
declare
  v_tenant uuid := coalesce(p_tenant, pg_temp.a());
  v_id uuid := pg_temp.id('ba000000', n);
  v_user uuid := (select u.id from public.app_user u where u.tenant_id = v_tenant and u.role = 'owner');
  v_key uuid := case when v_tenant = pg_temp.a() then ('c2000000-0000-4000-8000-0000000000c' || p_recipe)::uuid else 'c2000000-0000-4000-8000-0000000000cb'::uuid end;
  v_rec uuid := case when v_tenant = pg_temp.a() then ('c3000000-0000-4000-8000-0000000000c' || p_recipe)::uuid else 'c3000000-0000-4000-8000-0000000000cb'::uuid end;
  v_loc uuid := case when v_tenant = pg_temp.a() then '10000000-0000-4000-8000-0000000000a1'::uuid else '10000000-0000-4000-8000-0000000000b1'::uuid end;
  v_use_by timestamptz := now() + make_interval(secs => p_hours * 3600);
begin
  insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code, lot_seq,
      produced_at, produced_by, output_qty, output_unit, portions_computed, portions_initial, shelf_life_hours, use_by, location_id, created_by)
  values (v_id, v_tenant, v_key, v_rec, 1, '261101-LOT-' || n, '2026-11-01', 'LOT', n, v_use_by - interval '72 hours', v_user, 6, 'kg',
          30, 30, 72, v_use_by, v_loc, v_user);
  if p_portions > 0 then
    insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
    values (v_tenant, v_id, 'produce', p_portions, 'batch', v_id, '2026-11-01', v_user);
  end if;
end
$$;
select pg_temp.batch(1, 1, 12, 4);    -- B1 due_soon
select pg_temp.batch(2, 2, -1, 2);    -- B2 expired
select pg_temp.batch(3, 1, 30, 6);    -- B3 ok
select pg_temp.batch(4, 2, 2, 0);     -- B4 no portions
select pg_temp.batch(9, 1, 5, 7, pg_temp.b());   -- tenant B: due soon

-- Alerts -----------------------------------------------------------------------------------------------------------------
-- p_minutes_ago orders them: the smaller, the newer.
create function pg_temp.alert(n int, p_kind text, p_day int, p_minutes_ago int, p_payload jsonb, p_acked boolean default false, p_tenant uuid default null)
  returns void language plpgsql as $$
declare
  v_tenant uuid := coalesce(p_tenant, pg_temp.a());
  v_owner uuid := (select u.id from public.app_user u where u.tenant_id = v_tenant and u.role = 'owner');
begin
  insert into public.alert (id, tenant_id, kind, entity_type, entity_id, business_date, severity, audience_roles, cost_bearing, payload,
      created_at, acknowledged_at, acknowledged_by)
  select pg_temp.id('a3000000', n), v_tenant, k.kind,
         case when p_kind like 'prep%' then 'recipe_key' when p_kind = 'price_variance' then 'price_history' else 'ingredient' end,
         pg_temp.id('a4000000', n), pg_temp.today() + p_day, 'warning', k.default_audience, k.cost_bearing, p_payload,
         now() - make_interval(mins => p_minutes_ago),
         case when p_acked then now() end, case when p_acked then v_owner end
    from app.alert_kind k where k.kind = p_kind;
end
$$;
select pg_temp.alert(1, 'price_variance', 0, 50, jsonb_build_object('ingredient_id', pg_temp.id('11000000', 1)));
select pg_temp.alert(2, 'price_variance', 0, 40, jsonb_build_object('ingredient_id', pg_temp.id('11000000', 5)));
select pg_temp.alert(3, 'price_variance', 0, 60, jsonb_build_object('ingredient_id', pg_temp.id('11000000', 2)), true);
select pg_temp.alert(4, 'prep_due', 0, 30, jsonb_build_object('recipe_key', 'c2000000-0000-4000-8000-0000000000c1'));
select pg_temp.alert(5, 'prep_due', 0, 20, jsonb_build_object('recipe_key', 'c2000000-0000-4000-8000-0000000000c2'), true);
select pg_temp.alert(6, 'prep_raw_short', 0, 10, jsonb_build_object('recipe_key', 'c2000000-0000-4000-8000-0000000000c1'));
select pg_temp.alert(7, 'purchase_due', 0, 15, jsonb_build_object('ingredient_id', pg_temp.id('11000000', 1), 'supplier_id', '5a000000-0000-4000-8000-00000000005a'));
select pg_temp.alert(8, 'purchase_due', 0, 5, jsonb_build_object('ingredient_id', pg_temp.id('11000000', 5), 'supplier_id', '5c000000-0000-4000-8000-00000000005c',
  'planted_id', '11000000-0000-4000-8000-0000000000b1'));
select pg_temp.alert(9, 'prep_due', -1, 1500, jsonb_build_object('recipe_key', 'c2000000-0000-4000-8000-0000000000c1'));
select pg_temp.alert(10, 'price_variance', 0, 5, jsonb_build_object('ingredient_id', '11000000-0000-4000-8000-0000000000b1'), false, pg_temp.b());

-- Constants and privileges -----------------------------------------------------------------------------------------------
select is(app.payable_due_soon_days(), 7, 'payable_due_soon_days is 7 (the reminder window)');
select is(app.dashboard_list_cap(), 5, 'dashboard_list_cap is 5');
select is(app.dashboard_alert_cap(), 50, 'dashboard_alert_cap is 50');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r, pg_proc p
            where p.pronamespace = 'app'::regnamespace and p.proname ~ '^dashboard_' and has_function_privilege(r, p.oid, 'execute')), 0,
  'no API role can execute any app.dashboard_* function');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r
            where has_function_privilege(r, 'app.payable_due_soon_days()', 'execute')), 0, 'nor the due-soon constant');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname in
            ('dashboard_week', 'dashboard_payables', 'dashboard_stock_at_risk', 'dashboard_alerts', 'dashboard_alert_names')
            and p.prosecdef and p.proconfig = array['search_path=""']), 5, 'the five helpers are SECURITY DEFINER with an empty search_path');

-- The ISO week, Europe/Rome, across both clock changes -------------------------------------------------------------------
select is((select w.week_from || '..' || w.week_to from app.dashboard_week(pg_temp.a(), '2026-10-25 22:30+00') w), '2026-10-19..2026-10-25',
  'Sunday 23:30 in Rome (CET) is still the week of Monday 19 October');
select is((select w.week_from || '..' || w.week_to from app.dashboard_week(pg_temp.a(), '2026-10-25 23:30+00') w), '2026-10-26..2026-11-01',
  '00:30 on Monday is the next week');
select is((select w.week_from || '..' || w.week_to from app.dashboard_week(pg_temp.a(), '2026-03-29 00:30+00') w), '2026-03-23..2026-03-29',
  '01:30 on the Sunday of the spring change is the week of 23 March');
select is((select w.week_from || '..' || w.week_to from app.dashboard_week(pg_temp.a(), '2026-10-25 12:00+00') w), '2026-10-19..2026-10-25',
  'the Sunday of the autumn change');
select is((select w.week_from || '..' || w.week_to from app.dashboard_week(pg_temp.a(), '2026-03-30 21:30+00') w), '2026-03-30..2026-04-05',
  'Monday 30 March 23:30 CEST is in the week of 30 March');
select is((select extract(isodow from w.week_from)::int || '/' || extract(isodow from w.week_to)::int || '/' || (w.week_to - w.week_from)
             from app.dashboard_week(pg_temp.a(), now()) w), '1/7/6', 'a week runs Monday to Sunday');
select is((select count(*)::int from app.dashboard_week(pg_temp.a(), now()) w where pg_temp.today() between w.week_from and w.week_to), 1,
  'and contains the venue date');
select throws_ok($$select * from app.dashboard_week('99999999-9999-4999-8999-999999999999', now())$$, 'P0002', 'tenant_not_found', 'an unknown tenant is refused');

-- Payables ---------------------------------------------------------------------------------------------------------------
create temp table pay_a as select app.dashboard_payables(pg_temp.a(), pg_temp.today()) as j;
select is((select j -> 'dueSoonDays' from pay_a), '7'::jsonb, 'dueSoonDays is 7');
select is((select j -> 'overdue' from pay_a), '{"count": 2, "amountEur": 150.50}'::jsonb, 'overdue: PA and PB, 150.50 (scheduled counts as unpaid)');
select is((select j -> 'dueSoon' from pay_a), '{"count": 2, "amountEur": 245.00}'::jsonb, 'due soon: PC (today, disputed) and PD (D+7), 245.00');
select is(pg_temp.ids((select j -> 'items' from pay_a), 'id'), array[pg_temp.id('90000000', 1), pg_temp.id('90000000', 2), pg_temp.id('90000000', 3), pg_temp.id('90000000', 4)],
  'items: overdue first, then by due date; PE (D+8) and PF (paid) are absent');
select is((select array_agg((e ->> 'daysToDue')::int order by n) from pay_a, jsonb_array_elements(j -> 'items') with ordinality x(e, n)), array[-5, -1, 0, 7], 'daysToDue -5, -1, 0, 7');
select is((select array_agg((e ->> 'overdue')::boolean order by n) from pay_a, jsonb_array_elements(j -> 'items') with ordinality x(e, n)), array[true, true, false, false], 'the overdue flags');
select is((select e - 'id' - 'dueDate' from pay_a, jsonb_array_elements(j -> 'items') e where (e ->> 'id')::uuid = pg_temp.id('90000000', 1)),
  '{"overdue": true, "daysToDue": -5, "amountEur": 120.00, "supplierName": "Fornitore Uno (demo)", "invoiceNumber": "F-1"}'::jsonb, 'an item: supplier, invoice number, amount');
select is((select e -> 'invoiceNumber' from pay_a, jsonb_array_elements(j -> 'items') e where (e ->> 'id')::uuid = pg_temp.id('90000000', 3)), 'null'::jsonb, 'a missing invoice number is null');
select is((select count(*)::int from pay_a, jsonb_array_elements(j -> 'items') e where (e ->> 'id')::uuid = any (array[pg_temp.id('90000000', 90)])), 0, 'none of tenant B''s payables');
select is((select j -> 'overdue' from (select app.dashboard_payables(pg_temp.b(), pg_temp.today()) j) x), '{"count": 1, "amountEur": 999.00}'::jsonb, 'tenant B: 1 overdue, 999.00');
select is((select count(*)::int from pay_a x where x.j::text like '%' || '90000000-0000-4000-8000-000000000090' || '%'), 0, 'and A''s payload has no id of B');
-- Six qualifying rows: the list is capped, the counts are not.
select pg_temp.pay(7, '5a000000-0000-4000-8000-00000000005a', 3, 10.00, 'open');
select pg_temp.pay(8, '5c000000-0000-4000-8000-00000000005c', 4, 20.00, 'open');
select is(jsonb_array_length(app.dashboard_payables(pg_temp.a(), pg_temp.today()) -> 'items'), 5, 'six qualifying rows: items has 5');
select is(app.dashboard_payables(pg_temp.a(), pg_temp.today()) -> 'dueSoon', '{"count": 4, "amountEur": 275.00}'::jsonb, 'and the counts and amount cover all six');

-- Stock at risk ----------------------------------------------------------------------------------------------------------
create temp table stock_a as select app.dashboard_stock_at_risk(pg_temp.a(), now()) as j;
select is((select array_agg(k order by k collate "C") from stock_a, jsonb_object_keys(j) k), array['belowMin', 'expiringBatches', 'expiringLots'], 'three groups');
select is(pg_temp.ids((select j -> 'belowMin' -> 'items' from stock_a), 'ingredientId'), array[pg_temp.id('11000000', 1), pg_temp.id('11000000', 5)],
  'below minimum: I1 and I5 by name (Burro, Farina); I2 (equal), I3 (no min) and I4 (inactive) are out');
select is((select (j -> 'belowMin' ->> 'count')::int from stock_a), 2, 'belowMin count 2');
select is((select e - 'ingredientId' from stock_a, jsonb_array_elements(j -> 'belowMin' -> 'items') e where (e ->> 'ingredientId')::uuid = pg_temp.id('11000000', 5)),
  '{"name": "Farina (fixture)", "unit": "kg", "minQty": 4, "onHandQty": 3}'::jsonb, 'I5 counts usable stock: 3, not the 6 on the shelf');
select is(pg_temp.ids((select j -> 'expiringLots' -> 'items' from stock_a), 'rawLotId'), array[pg_temp.id('1e000000', 2), pg_temp.id('1e000000', 1)],
  'expiring lots by expiry: L2 (expired) then L1 (due soon); L3 (D+2) and L4 (empty) are out');
select is((select array_agg(e ->> 'state' order by n) from stock_a, jsonb_array_elements(j -> 'expiringLots' -> 'items') with ordinality x(e, n)), array['expired', 'due_soon'], 'with their states');
select is((select e - 'rawLotId' - 'ingredientId' - 'expiry' from stock_a, jsonb_array_elements(j -> 'expiringLots' -> 'items') e where (e ->> 'rawLotId')::uuid = pg_temp.id('1e000000', 1)),
  '{"qty": 2, "unit": "kg", "state": "due_soon", "lotCode": "L-01", "ingredientName": "Burro (fixture)"}'::jsonb, 'a lot row: code, ingredient name, quantity and unit');
select is(pg_temp.ids((select j -> 'expiringBatches' -> 'items' from stock_a), 'batchId'), array[pg_temp.id('ba000000', 2), pg_temp.id('ba000000', 1)],
  'expiring batches by use-by: B2 (expired) then B1; B3 (ok) and B4 (no portions) are out');
select is((select array_agg(e ->> 'state' order by n) from stock_a, jsonb_array_elements(j -> 'expiringBatches' -> 'items') with ordinality x(e, n)), array['expired', 'due_soon'], 'with their states');
select is((select e - 'batchId' - 'useBy' from stock_a, jsonb_array_elements(j -> 'expiringBatches' -> 'items') e where (e ->> 'batchId')::uuid = pg_temp.id('ba000000', 1)),
  '{"state": "due_soon", "lotCode": "261101-LOT-1", "portions": 4, "recipeName": "Sugo (fixture)"}'::jsonb, 'a batch row');
select is((select (j -> 'expiringBatches' ->> 'count')::int from stock_a), 2, 'two batches');
select is(pg_temp.ids((select app.dashboard_stock_at_risk(pg_temp.b(), now()) -> 'expiringBatches' -> 'items'), 'batchId'), array[pg_temp.id('ba000000', 9)], 'tenant B sees its own batch only');
select is((select count(*)::int from jsonb_array_elements(app.dashboard_stock_at_risk(pg_temp.b(), now()) -> 'belowMin' -> 'items') e where e ->> 'name' like '%(fixture)' and e ->> 'name' not like 'Sale B%'), 0,
  'and none of A''s ingredients');
-- Cap of 5 with 6 rows.
select pg_temp.lot(20 + n, 3, 1, 1, 'L-X' || n) from generate_series(1, 4) n;
select is(jsonb_array_length(app.dashboard_stock_at_risk(pg_temp.a(), now()) -> 'expiringLots' -> 'items'), 5, 'six expiring lots: items has 5');
select is((app.dashboard_stock_at_risk(pg_temp.a(), now()) -> 'expiringLots' ->> 'count')::int, 6, 'and the count says 6');

-- Alerts -----------------------------------------------------------------------------------------------------------------
create temp table alerts_a as select app.dashboard_alerts(pg_temp.a(), now()) as j;
select is((select j -> 'alertsOpen' from alerts_a), '{"count": 7, "more": false}'::jsonb, 'open alerts: 7 (acknowledged ones and tenant B''s excluded)');
select is((select (j -> 'priceVariance' ->> 'count')::int from alerts_a), 2, 'price variance: 2 open');
select is(pg_temp.ids((select j -> 'priceVariance' -> 'items' from alerts_a), 'id'), array[pg_temp.id('a3000000', 2), pg_temp.id('a3000000', 1)],
  'newest first; the acknowledged one is absent');
select is((select e - 'id' - 'createdAt' - 'entityId' - 'businessDate' - 'payload' from alerts_a, jsonb_array_elements(j -> 'priceVariance' -> 'items') e where (e ->> 'id')::uuid = pg_temp.id('a3000000', 1)),
  '{"kind": "price_variance", "severity": "warning", "costBearing": true, "entityType": "price_history", "acknowledgedAt": null}'::jsonb, 'an alert row has the raw fields');
select is((select array_agg(k order by k collate "C") from alerts_a, jsonb_array_elements(j -> 'priceVariance' -> 'items') e, jsonb_object_keys(e) k where (e ->> 'id')::uuid = pg_temp.id('a3000000', 1)),
  array['acknowledgedAt', 'businessDate', 'costBearing', 'createdAt', 'entityId', 'entityType', 'id', 'kind', 'payload', 'severity'], 'exactly the ten alert fields');
select is((select j -> 'todayLists' ->> 'businessDate' from alerts_a), pg_temp.today()::text, 'today''s business date');
select is(pg_temp.ids((select j -> 'todayLists' -> 'prep' from alerts_a), 'id'), array[pg_temp.id('a3000000', 6), pg_temp.id('a3000000', 5), pg_temp.id('a3000000', 4)],
  'prep list: today''s 3 (the acknowledged one included), newest first; yesterday''s is absent');
select is((select (j -> 'todayLists' ->> 'prepCount')::int from alerts_a), 3, 'prepCount 3');
select isnt((select e ->> 'acknowledgedAt' from alerts_a, jsonb_array_elements(j -> 'todayLists' -> 'prep') e where (e ->> 'id')::uuid = pg_temp.id('a3000000', 5)), null, 'the acknowledged one carries acknowledgedAt');
select is(pg_temp.ids((select j -> 'todayLists' -> 'purchase' from alerts_a), 'id'), array[pg_temp.id('a3000000', 8), pg_temp.id('a3000000', 7)], 'purchase list: 2');
select is((select (j -> 'todayLists' ->> 'purchaseCount')::int from alerts_a), 2, 'purchaseCount 2');
select is(app.dashboard_alerts(pg_temp.b(), now()) -> 'alertsOpen', '{"count": 1, "more": false}'::jsonb, 'tenant B: its own one alert');
select is(jsonb_array_length(app.dashboard_alerts(pg_temp.b(), now()) -> 'todayLists' -> 'prep'), 0, 'and no prep list');
-- Caps: 51 open alerts count 50 with more; the lists keep their caps.
insert into public.alert (tenant_id, kind, entity_type, entity_id, business_date, severity, audience_roles, cost_bearing, payload)
  select pg_temp.a(), 'prep_due', 'recipe_key', gen_random_uuid(), pg_temp.today(), 'warning', '{owner,chef}', false, '{}'::jsonb from generate_series(1, 44);
select is(app.dashboard_alerts(pg_temp.a(), now()) -> 'alertsOpen', '{"count": 50, "more": true}'::jsonb, '51 open: counted up to 50, and more is true');
select is(jsonb_array_length(app.dashboard_alerts(pg_temp.a(), now()) -> 'todayLists' -> 'prep'), 10, 'the prep list is capped at 10');
select is((app.dashboard_alerts(pg_temp.a(), now()) -> 'todayLists' ->> 'prepCount')::int, 47, 'with the true count');

-- Names ------------------------------------------------------------------------------------------------------------------
create temp table names_a as select app.dashboard_alert_names(pg_temp.a(), (select j -> 'todayLists' -> 'purchase' from alerts_a)) as j;
select is((select array_agg(k order by k collate "C") from names_a, jsonb_object_keys(j) k), array['batch', 'ingredient', 'location', 'raw_lot', 'recipe', 'supplier'], 'six tables');
select is((select j -> 'ingredient' ->> pg_temp.id('11000000', 1)::text from names_a), 'Burro (fixture)', 'the ingredient of a purchase_due row is named');
select is((select j -> 'supplier' ->> '5a000000-0000-4000-8000-00000000005a' from names_a), 'Fornitore Uno (demo)', 'and its supplier');
select is((select j -> 'supplier' ->> '5c000000-0000-4000-8000-00000000005c' from names_a), 'Fornitore Due (demo)', 'the second supplier too');
select is((select j -> 'ingredient' ->> '11000000-0000-4000-8000-0000000000b1' from names_a), null, 'a tenant-B ingredient id planted in an A payload resolves to nothing');
select is((select j -> 'recipe' from (select app.dashboard_alert_names(pg_temp.a(), (select j -> 'todayLists' -> 'prep' from alerts_a)) j) x),
  jsonb_build_object('c2000000-0000-4000-8000-0000000000c1', 'Sugo (fixture)', 'c2000000-0000-4000-8000-0000000000c2', 'Ragù (fixture)'), 'recipes are named by their key (current version)');
select is(app.dashboard_alert_names(pg_temp.a(), '[]'::jsonb), '{"batch": {}, "recipe": {}, "location": {}, "raw_lot": {}, "supplier": {}, "ingredient": {}}'::jsonb, 'no rows: six empty maps');
select is((select j -> 'ingredient' from (select app.dashboard_alert_names(pg_temp.a(), jsonb_build_array(jsonb_build_object('payload', jsonb_build_object('x', 'not-a-uuid', 'n', 5, 'o', '{}'::jsonb)))) j) x), '{}'::jsonb,
  'non-uuid and non-string payload values are ignored');

select * from finish();
rollback;
