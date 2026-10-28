-- Owner dashboard plan step 4 (§2.3 drift guard, AT5; T1): the `today` block of dashboard_summary() equals today_counts()
-- called directly by the same user in the same transaction (owner A, admin A, owner B: today_counts is SECURITY INVOKER and
-- filters by tenant itself, so running it inside a DEFINER function changes nothing), and the tile counts equal the
-- predicates of the screens they link to.
-- The fixture is the same in 203, 204 and 205 (a pgTAP file is self-contained, as in the rest of the suite):
--   plates      P1..P7 and the inactive P8 as in 200; ingredient prices set so the food costs are exact
--   payables    PA..PF as in 201 (overdue 2 / 150.50, due soon 2 / 245.00)
--   stock       I1..I5 and the lots L1..L4 as in 201, batches B1..B4 as in 201, I6 and B5 for the waste
--   alerts      as in 201 (7 open); waste of the ISO week: raw 6.00 + batch 6.00, one unpriced movement
--   fixed costs 3.000,00 this month, no sales
-- Tenant A has an owner, an admin, a chef and a waiter; tenant B has an owner, one overdue payable of 999.00, one lot, one
-- batch, one ingredient, one open alert and one incomplete plate.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('e0000000-0000-4000-8000-00000000000e', 'nobody@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Cuoco Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
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

insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('1a000000-0000-4000-8000-00000000001a', '11111111-1111-4111-8111-111111111111', 'Base (fixture)', 'kg'),
  ('1b000000-0000-4000-8000-00000000001b', '11111111-1111-4111-8111-111111111111', 'Senza prezzo (fixture)', 'kg'),
  ('1c000000-0000-4000-8000-00000000001c', '22222222-2222-4222-8222-222222222222', 'Senza prezzo B (fixture)', 'kg');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id)
  values ('9f000000-0000-4000-8000-0000000000f1', '11111111-1111-4111-8111-111111111111',
          '11111111-1111-4111-8111-111111111111/2026/9f000000-0000-4000-8000-0000000000f1.pdf',
          'application/pdf', 100, 'review', '5a000000-0000-4000-8000-00000000005a');
insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price, line_amount, field_confidence, extracted)
  values ('9f000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '9f000000-0000-4000-8000-0000000000f1', 1,
          'Acquisto demo', 1, 1, 1, '{}', '{}');
insert into public.price_history (tenant_id, ingredient_id, supplier_id, invoice_line_id, unit_price, base_unit, effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-00000000001a', '5a000000-0000-4000-8000-00000000005a',
          '9f000000-0000-4000-8000-000000000001', 1.00, 'kg', '2026-09-01', 'a1000000-0000-4000-8000-00000000000a');

create function pg_temp.pk(n int) returns uuid language sql immutable as $$
  select ('ec000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
-- A plate of tenant t with one line: qty kg of an ingredient, a sale price (VAT included) and a target (null = none).
create function pg_temp.mkplate(t uuid, n int, p_name text, p_ing uuid, p_qty numeric, p_sale numeric, p_target numeric)
  returns void language plpgsql as $$
declare
  v_owner uuid := (select u.id from public.app_user u where u.tenant_id = t and u.role = 'owner');
begin
  insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by)
    values (pg_temp.pk(n), t, 'plate', 1, lower(p_name), v_owner);
  insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by)
    values (pg_temp.pk(n + 1000), t, pg_temp.pk(n), 1, '2026-01-01T00:00Z', p_name, v_owner);
  insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, qty, unit, yield_factor, created_by)
    values (t, pg_temp.pk(n + 1000), 1, p_ing, p_qty, 'kg', 1, v_owner);
  if p_sale is not null then
    insert into public.recipe_price (recipe_id, tenant_id, sale_price, target_gp_pct, created_by)
      values (pg_temp.pk(n + 1000), t, p_sale, p_target, v_owner);
  end if;
end
$$;
create function pg_temp.base_ing() returns uuid language sql as $$ select '1a000000-0000-4000-8000-00000000001a'::uuid $$;
create function pg_temp.unpriced() returns uuid language sql as $$ select '1b000000-0000-4000-8000-00000000001b'::uuid $$;

select pg_temp.mkplate(pg_temp.a(), 1, 'Tagliatelle (fixture)', pg_temp.base_ing(), 4, 11.00, 70);
select pg_temp.mkplate(pg_temp.a(), 2, 'Spezzatino (fixture)', pg_temp.base_ing(), 5, 22.00, 70);
select pg_temp.mkplate(pg_temp.a(), 3, 'Bruschetta (fixture)', pg_temp.base_ing(), 2, 5.50, 65);
select pg_temp.mkplate(pg_temp.a(), 4, 'Zuppa (fixture)', pg_temp.base_ing(), 2.4, 8.80, 80);
select pg_temp.mkplate(pg_temp.a(), 5, 'Tiramisù (fixture)', pg_temp.base_ing(), 1.2, 6.60, null);
select pg_temp.mkplate(pg_temp.a(), 6, 'Gnocchi (fixture)', pg_temp.base_ing(), 1.8, 9.90, 75);
select pg_temp.mkplate(pg_temp.a(), 7, 'Ossobuco (fixture)', pg_temp.unpriced(), 1, 15.40, 70);
select pg_temp.mkplate(pg_temp.a(), 8, 'Vecchio piatto (fixture)', pg_temp.base_ing(), 1, 10.00, null);
update public.recipe_key set is_active = false where id = pg_temp.pk(8);
select pg_temp.mkplate('22222222-2222-4222-8222-222222222222', 21, 'Piatto B (fixture)', '1c000000-0000-4000-8000-00000000001c', 1, 10.00, 70);

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
select pg_temp.alert(8, 'purchase_due', 0, 5, jsonb_build_object('ingredient_id', pg_temp.id('11000000', 5), 'supplier_id', '5c000000-0000-4000-8000-00000000005c'));
select pg_temp.alert(9, 'prep_due', -1, 1500, jsonb_build_object('recipe_key', 'c2000000-0000-4000-8000-0000000000c1'));
select pg_temp.alert(10, 'price_variance', 0, 5, jsonb_build_object('ingredient_id', '11000000-0000-4000-8000-0000000000b1'), false, pg_temp.b());


-- Waste of the ISO week (M = its Monday): raw 1.5 kg at 4.00 on M (breakage) = 6.00; raw 10 kg at 1.00 on M-1 is out;
-- a batch discard of 3 portions at a frozen 2.00 on M+6 (expired) = 6.00; one unpriced raw waste on M+1 (spoilage).
create function pg_temp.monday() returns date language sql as $$ select pg_temp.today() - (extract(isodow from pg_temp.today())::int - 1) $$;
insert into public.ingredient (id, tenant_id, name, base_unit, is_stock, is_active) values
  ('11000000-0000-4000-8000-000000000006', pg_temp.a(), 'Spreco (fixture)', 'kg', true, true);
select pg_temp.lot(30, 6, null, 20, 'L-30');
create function pg_temp.raw_waste(p_qty numeric, p_cost numeric, p_reason text, p_day date) returns void language sql as $$
  insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, reason_code, ref_type, ref_id, effective_on, created_by)
  values (pg_temp.a(), pg_temp.id('11000000', 6), pg_temp.id('1e000000', 30), '10000000-0000-4000-8000-0000000000a1', 'waste', -p_qty, p_cost, p_reason,
          'waste', gen_random_uuid(), p_day, 'a1000000-0000-4000-8000-00000000000a') $$;
select pg_temp.raw_waste(1.5, 4.00, 'breakage', pg_temp.monday());
select pg_temp.raw_waste(10, 1.00, 'spoilage', pg_temp.monday() - 1);
select pg_temp.raw_waste(1, null, 'spoilage', pg_temp.monday() + 1);
select pg_temp.batch(5, 1, 200, 10);   -- B5: far from its use-by, with a frozen cost and a discard
insert into public.batch_cost (batch_id, tenant_id, total_cost, unit_cost_frozen, incomplete, missing_ingredient_ids, cost_at, created_by)
  values (pg_temp.id('ba000000', 5), pg_temp.a(), 20, 2, false, '{}', now(), 'a1000000-0000-4000-8000-00000000000a');
insert into public.batch_movement (tenant_id, batch_id, type, portions, reason_code, ref_type, ref_id, effective_on, created_by)
  values (pg_temp.a(), pg_temp.id('ba000000', 5), 'waste', -3, 'expired', 'batch_discard', gen_random_uuid(), pg_temp.monday() + 6,
          'a1000000-0000-4000-8000-00000000000a');

-- Fixed costs of this month: 1500 + 1200 + 300 = 3000.00 (no sales yet).
insert into public.fixed_cost_period (tenant_id, month, rent, labour, utilities, created_by)
  values (pg_temp.a(), date_trunc('month', pg_temp.today())::date, 1500, 1200, 300, 'a1000000-0000-4000-8000-00000000000a');

create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true) $$;
create function pg_temp.as_owner_a() returns void language sql as $$
  select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', pg_temp.a(), 'owner') $$;
create function pg_temp.as_admin_a() returns void language sql as $$
  select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', pg_temp.a(), 'admin') $$;
create function pg_temp.as_chef_a() returns void language sql as $$
  select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', pg_temp.a(), 'chef') $$;
create function pg_temp.as_waiter_a() returns void language sql as $$
  select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', pg_temp.a(), 'waiter') $$;
create function pg_temp.as_owner_b() returns void language sql as $$
  select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', pg_temp.b(), 'owner') $$;
create function pg_temp.pk_of(n int) returns uuid language sql immutable as $$ select pg_temp.pk(n) $$;
grant execute on function pg_temp.act_as(uuid, uuid, text), pg_temp.as_owner_a(), pg_temp.as_admin_a(), pg_temp.as_chef_a(),
  pg_temp.as_waiter_a(), pg_temp.as_owner_b(), pg_temp.today(), pg_temp.monday(), pg_temp.a(), pg_temp.b(), pg_temp.id(text, int),
  pg_temp.ids(jsonb, text), pg_temp.pk(int) to authenticated;


create temp table s (k text primary key, j jsonb);
grant all on s to authenticated;
create function pg_temp.grab(p_key text) returns void language plpgsql as $$
begin
  insert into s select p_key, public.dashboard_summary();
  insert into s select p_key || '_today', public.today_counts();
  insert into s select p_key || '_list', public.payable_list('unpaid');
  insert into s select p_key || '_batches', public.batch_list();
end
$$;
grant execute on function pg_temp.grab(text) to authenticated;
set local role authenticated;
select pg_temp.as_owner_a();
select pg_temp.grab('oa');
select pg_temp.as_admin_a();
select pg_temp.grab('aa');
select pg_temp.as_owner_b();
select pg_temp.grab('ob');
reset role;
create function pg_temp.g(p_key text) returns jsonb language sql as $$ select j from s where s.k = p_key $$;

select is(pg_temp.g('oa') -> 'today', pg_temp.g('oa_today'), 'owner A: dashboard today equals today_counts()');
select is(pg_temp.g('aa') -> 'today', pg_temp.g('aa_today'), 'admin A: dashboard today equals today_counts()');
select is(pg_temp.g('ob') -> 'today', pg_temp.g('ob_today'), 'owner B: dashboard today equals today_counts()');
select isnt(pg_temp.g('oa') -> 'today', pg_temp.g('ob') -> 'today', 'and A''s counts differ from B''s (the filter is by tenant)');
select is(pg_temp.g('oa') -> 'today' ->> 'payablesOverdue', '2', 'A has 2 overdue payables in today');
select is(pg_temp.g('ob') -> 'today' ->> 'payablesOverdue', '1', 'B has 1');
select is((pg_temp.g('oa') -> 'payables' -> 'overdue' ->> 'count')::int,
  (select count(*)::int from jsonb_array_elements(pg_temp.g('oa_list') -> 'items') i where (i ->> 'overdue')::boolean),
  'owner A: payables.overdue.count equals the overdue rows of payable_list(unpaid)');
select is((pg_temp.g('aa') -> 'payables' -> 'overdue' ->> 'count')::int,
  (select count(*)::int from jsonb_array_elements(pg_temp.g('aa_list') -> 'items') i where (i ->> 'overdue')::boolean),
  'admin A: the same');
select is((pg_temp.g('ob') -> 'payables' -> 'overdue' ->> 'count')::int,
  (select count(*)::int from jsonb_array_elements(pg_temp.g('ob_list') -> 'items') i where (i ->> 'overdue')::boolean),
  'owner B: the same');
select is((pg_temp.g('oa') -> 'payables' -> 'overdue' ->> 'count')::int, (pg_temp.g('oa_today') ->> 'payablesOverdue')::int, 'overdue count equals today.payablesOverdue');
select is((pg_temp.g('oa') -> 'stockAtRisk' -> 'expiringBatches' ->> 'count')::int, (pg_temp.g('oa_today') ->> 'batchesUseBy')::int, 'owner A: expiringBatches.count equals batchesUseBy');
select is((pg_temp.g('aa') -> 'stockAtRisk' -> 'expiringBatches' ->> 'count')::int, (pg_temp.g('aa_today') ->> 'batchesUseBy')::int, 'admin A: the same');
select is((pg_temp.g('ob') -> 'stockAtRisk' -> 'expiringBatches' ->> 'count')::int, (pg_temp.g('ob_today') ->> 'batchesUseBy')::int, 'owner B: the same');
select is((pg_temp.g('oa') -> 'stockAtRisk' -> 'expiringBatches' ->> 'count')::int,
  (select count(*)::int from jsonb_array_elements(pg_temp.g('oa_batches') -> 'items') i
    where i ->> 'useByState' in ('expired', 'due_soon') and (i ->> 'portionsRemaining')::numeric > 0),
  'and equals the use-by rows with portions of batch_list');
select is((pg_temp.g('oa') -> 'payables' ->> 'dueSoonDays')::int, 7, 'the due-soon window is the payment reminder window, 7 days');
select is((select count(*)::int from pg_proc p where p.oid = 'app.payable_reminder_rule(uuid, timestamptz)'::regprocedure
            and pg_get_functiondef(p.oid) ~ '\+ 7'), 1, 'payable_reminder_rule still carries its own inline 7 (the twin the due-soon window follows)');

select * from finish();
rollback;
