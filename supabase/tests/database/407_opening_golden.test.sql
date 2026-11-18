-- Opening stock, step 1 (docs/plans/2026-11-18-opening-stock.md §5 step 1, AT7): G, the golden test, written on main BEFORE any opening-stock change. It pins, as md5 of a
-- stable text projection (ids, now()-stamped columns and uuids are left out), what the opening-stock work must never move for a tenant that has no opening rows:
--   * app.kpi_purchases over the fixture month (receipts by invoice date);
--   * public.avt_report of the closing monthly count (rows and totals);
--   * public.payable_list (the payables the three approved invoices created);
--   * public.stock_reconciliation for the month at both locations;
--   * public.ingredient_costs() and public.recipe_costs() for the invoiced ingredients and the recipes;
--   * the frozen costs: order_line_cost (a fired sale) and batch_cost (a produced batch).
-- It passes on main by design. The values were taken from a database built from main's migrations (acaa08c3); a pin that changes later is a change of behaviour, never a typo to fix
-- in passing. Step 10 of the plan adds one assertion (the AVT unit cost of an invoice-less ingredient); nothing else changes until step 25.
-- Fixture (fake): "Osteria Demo A", two locations, three approved invoices (receipts, price history, payables), a fired sale, one batch, waste, two closed monthly counts at
-- Dispensa. The mutation block at the end proves the purchases pin can fail: one more received kilo changes its md5.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test');
insert into public.tenant (id, name, vat_number) values ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Dispensa (demo)'),
  ('10000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'Frigo 1 (demo)');
insert into public.supplier (id, tenant_id, name, vat_number, payment_terms_days) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore X (demo)', 'IT12345678903', 30);
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id) values
  ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/e1000000-0000-4000-8000-0000000000e1.pdf', 'application/pdf', 2048, 'review', '5a000000-0000-4000-8000-00000000005a');
insert into public.ingredient (id, tenant_id, name, base_unit, is_stock) values
  ('1e000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Manzo (demo)', 'kg', true),
  ('1e000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Parmigiano (demo)', 'kg', true),
  ('1e000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Pepe (demo)', 'kg', true),
  ('1e000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'Lievito (demo)', 'kg', true),
  ('1e000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'Aceto (demo)', 'l', true),
  ('1e000000-0000-4000-8000-000000000011', '11111111-1111-4111-8111-111111111111', 'Farina 00 (demo)', 'kg', true),
  ('1e000000-0000-4000-8000-000000000012', '11111111-1111-4111-8111-111111111111', 'Mozzarella (demo)', 'kg', true),
  ('1e000000-0000-4000-8000-000000000013', '11111111-1111-4111-8111-111111111111', 'Basilico (demo)', 'kg', true);  -- no invoice, no price: stays unpriced
insert into public.supplier_item (id, tenant_id, supplier_id, ingredient_id, supplier_code, pack_count, pack_qty, pack_unit, invoice_unit) values
  ('51000000-0000-4000-8000-000000000011', '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a', '1e000000-0000-4000-8000-000000000011', 'FAR-00', 1, 1, 'kg', 'kg'),
  ('51000000-0000-4000-8000-000000000012', '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a', '1e000000-0000-4000-8000-000000000012', 'MOZ-1', 1, 1, 'kg', 'kg');

create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role, 'aal', case when app_role = 'admin' then 'aal2' else 'aal1' end)::text, true)
$$;
-- A scenario: runs the setup statements and one query inside a block that is rolled back, and returns the query's text (the ledger is append-only, so this is how "what if" rows are tried).
create function pg_temp.scn(p_setup text[], p_query text) returns text language plpgsql as $$
declare
  v text;
  s text;
begin
  begin
    foreach s in array p_setup loop
      execute s;
    end loop;
    execute p_query into v;
    raise exception 'scenario_rollback' using errcode = 'RB001';
  exception when sqlstate 'RB001' then
    null;
  end;
  return v;
end
$$;

-- Prices outside invoices (price_history rows, as in 236): Manzo, Parmigiano, Pepe, Aceto. Lievito and Basilico have none.
create sequence pg_temp.line_seq;
create function pg_temp.price(p_ing uuid, p_price numeric) returns void language plpgsql as $$
declare
  v_n int := nextval('pg_temp.line_seq');
  v_line uuid := ('a2000000-0000-4000-8000-' || lpad(v_n::text, 12, '0'))::uuid;
begin
  insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price, line_amount, field_confidence, extracted)
    values (v_line, '11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-0000000000e1', v_n, 'Riga demo', 1, p_price, p_price, '{}', '{}');
  insert into public.price_history (tenant_id, ingredient_id, supplier_id, invoice_line_id, unit_price, base_unit, effective_on, created_by)
    select '11111111-1111-4111-8111-111111111111', i.id, '5a000000-0000-4000-8000-00000000005a', v_line, p_price, i.base_unit, '1998-10-15', 'a1000000-0000-4000-8000-00000000000a'
      from public.ingredient i where i.id = p_ing;
end
$$;
select pg_temp.price('1e000000-0000-4000-8000-000000000001', 12.00);
select pg_temp.price('1e000000-0000-4000-8000-000000000002', 20.00);
select pg_temp.price('1e000000-0000-4000-8000-000000000003', 30.00);
select pg_temp.price('1e000000-0000-4000-8000-000000000005', 4.00);

-- A stock movement at a fixed instant, written by the table owner (a fixture).
create function pg_temp.mv(p_ing uuid, p_type text, p_qty numeric, p_at timestamptz, p_ref_type text, p_ref uuid, p_reason text default null,
                           p_loc uuid default '10000000-0000-4000-8000-0000000000a1', p_cost numeric default null, p_reverses uuid default null) returns uuid language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.stock_movement (id, tenant_id, ingredient_id, location_id, type, qty, unit_cost, reason_code, ref_type, ref_id, reverses_id, effective_on, created_at, created_by)
    values (v_id, '11111111-1111-4111-8111-111111111111', p_ing, p_loc, p_type::public.stock_movement_type, p_qty, p_cost, p_reason, p_ref_type, p_ref, p_reverses,
            (p_at at time zone 'Europe/Rome')::date, p_at, 'a1000000-0000-4000-8000-00000000000a');
  return v_id;
end
$$;
-- A receipt (lot + invoice line + movement) at a fixed instant.
create function pg_temp.receive(p_ing uuid, p_qty numeric, p_price numeric, p_at timestamptz) returns void language plpgsql as $$
declare
  v_n int := nextval('pg_temp.line_seq');
  v_line uuid := ('a2000000-0000-4000-8000-' || lpad(v_n::text, 12, '0'))::uuid;
  v_lot uuid := ('a3000000-0000-4000-8000-' || lpad(v_n::text, 12, '0'))::uuid;
begin
  insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price, line_amount, field_confidence, extracted)
    values (v_line, '11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-0000000000e1', v_n, 'Riga demo', p_qty, p_price, p_qty * p_price, '{}', '{}');
  insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code, received_on, qty_received, base_unit, source_qty, source_unit, base_factor, created_by)
    select v_lot, '11111111-1111-4111-8111-111111111111', i.id, '10000000-0000-4000-8000-0000000000a1', '5a000000-0000-4000-8000-00000000005a', v_line, 'LOT-' || v_n,
           (p_at at time zone 'Europe/Rome')::date, p_qty, i.base_unit, p_qty, i.base_unit::text, 1, 'a1000000-0000-4000-8000-00000000000a'
      from public.ingredient i where i.id = p_ing;
  insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type, ref_id, effective_on, created_at, created_by)
    values ('11111111-1111-4111-8111-111111111111', p_ing, v_lot, '10000000-0000-4000-8000-0000000000a1', 'receipt', p_qty, p_price, 'invoice_line', v_line,
            (p_at at time zone 'Europe/Rome')::date, p_at, 'a1000000-0000-4000-8000-00000000000a');
end
$$;
-- A count session with its lines and count movements, closed at a fixed instant (as in 236). p_lines: [{"i": ingredient, "e": expected, "c": counted|null}].
create function pg_temp.count_session(p_id uuid, p_loc uuid, p_type text, p_closed timestamptz, p_lines jsonb) returns void language plpgsql as $$
declare
  e jsonb;
  n int := 0;
  p_user uuid := 'a1000000-0000-4000-8000-00000000000a';
begin
  insert into public.count_session (id, tenant_id, location_id, type, started_at, started_by) values (p_id, '11111111-1111-4111-8111-111111111111', p_loc, p_type, p_closed - interval '1 hour', p_user);
  for e in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    insert into public.count_line (tenant_id, session_id, ingredient_id, position, expected_qty, counted_qty, entered_at, entered_by, created_by)
      values ('11111111-1111-4111-8111-111111111111', p_id, (e ->> 'i')::uuid, n, (e ->> 'e')::numeric, (e ->> 'c')::numeric, p_closed - interval '30 minutes', p_user, p_user);
    if (e ->> 'c')::numeric <> (e ->> 'e')::numeric then
      perform pg_temp.mv((e ->> 'i')::uuid, 'count', (e ->> 'c')::numeric - (e ->> 'e')::numeric, p_closed, 'count_session', p_id, null, p_loc);
    end if;
  end loop;
  update public.count_session set status = 'closed', closed_at = p_closed, closed_by = p_user where id = p_id;
end
$$;

-- Three invoices, approved with the real procedure (as in 035): receipts, lots, price history and payables.
--   FT 1 1998-11-03 Dispensa: Farina 50 kg for 50,00 (1,00 a kg), Mozzarella 10 kg for 80,00 (8,00 a kg); due 1998-12-03.
--   FT 2 1998-11-10 Dispensa: Farina 30 kg for 36,00 (1,20 a kg);                                            due 1998-12-10.
--   FT 3 1998-11-17 Frigo 1:  Mozzarella 10 kg for 85,00 (8,50 a kg);                                        due 1998-12-17.
create function pg_temp.mk_inv(n int, p_date date, p_due date, p_total numeric) returns void language sql as $$
  insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_vat, supplier_name, number_raw, invoice_date, due_date, net_total, vat_total, gross_total, supplier_id)
  values (('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, '11111111-1111-4111-8111-111111111111',
          '11111111-1111-4111-8111-111111111111/2026/' || ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0')) || '.pdf', 'application/pdf', 100, 'review',
          'IT12345678903', 'Fornitore X (demo)', 'FT ' || n, p_date, p_due, p_total, round(p_total * 0.1, 2), p_total + round(p_total * 0.1, 2), '5a000000-0000-4000-8000-00000000005a')
$$;
create function pg_temp.mk_line(n int, inv int, pos int, p_qty numeric, p_amount numeric, p_ing uuid, p_item uuid) returns void language sql as $$
  insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, line_amount, vat_rate, unit, ingredient_id, supplier_item_id, mapping_source, is_stock, field_confidence, extracted)
  values (('a9000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, '11111111-1111-4111-8111-111111111111', ('00000000-0000-4000-8000-' || lpad(inv::text, 12, '0'))::uuid,
          pos, 'Prodotto', p_qty, p_amount, 10, 'kg', p_ing, p_item, 'manual', true, '{}', '{}')
$$;
select pg_temp.mk_inv(1, '1998-11-03', '1998-12-03', 130);
select pg_temp.mk_line(11, 1, 1, 50, 50, '1e000000-0000-4000-8000-000000000011', '51000000-0000-4000-8000-000000000011');
select pg_temp.mk_line(12, 1, 2, 10, 80, '1e000000-0000-4000-8000-000000000012', '51000000-0000-4000-8000-000000000012');
select pg_temp.mk_inv(2, '1998-11-10', '1998-12-10', 36);
select pg_temp.mk_line(21, 2, 1, 30, 36, '1e000000-0000-4000-8000-000000000011', '51000000-0000-4000-8000-000000000011');
select pg_temp.mk_inv(3, '1998-11-17', '1998-12-17', 85);
select pg_temp.mk_line(31, 3, 1, 10, 85, '1e000000-0000-4000-8000-000000000012', '51000000-0000-4000-8000-000000000012');
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select public.approve_invoice('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-0000000000a1');
select public.approve_invoice('00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-0000000000a1');
select public.approve_invoice('00000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-0000000000a2');
reset role;

-- Dispensa's counts and the window between them (as in 236): O closed 1998-11-01, C closed 1998-11-30; Manzo, Parmigiano, Pepe, Lievito, Aceto.
select pg_temp.count_session('c5000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-0000000000a1', 'monthly', '1998-11-01 10:00+00',
  '[{"i": "1e000000-0000-4000-8000-000000000001", "e": 0, "c": 10}, {"i": "1e000000-0000-4000-8000-000000000002", "e": 0, "c": 2.0},
    {"i": "1e000000-0000-4000-8000-000000000003", "e": 0, "c": 1.0}, {"i": "1e000000-0000-4000-8000-000000000004", "e": 0, "c": 1.0}]');
select pg_temp.receive('1e000000-0000-4000-8000-000000000001', 20, 12.00, '1998-11-10 08:00+00');
select pg_temp.receive('1e000000-0000-4000-8000-000000000005', 2, 4.00, '1998-11-11 08:00+00');
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'spezzatino (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch, shelf_life_hours, created_by) values
  ('ed000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e1', 1, '1998-10-01T00:00Z', 'Spezzatino (demo)', 6, 'kg', 30, 72,
   'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, qty, unit, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d1', 1, '1e000000-0000-4000-8000-000000000001', 5, 'kg', 'a1000000-0000-4000-8000-00000000000a');
-- A stew batch at Dispensa on 1998-11-15 (5,3 kg of Manzo), waste of 0,2 kg, a plate raw booked at fire, a voided line, an unpriced use (as in 236).
do $$
declare
  v_mv uuid;
begin
  insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code, lot_seq, produced_at, produced_by, output_qty, output_unit,
                            portions_computed, portions_initial, shelf_life_hours, use_by, location_id, created_by)
    values ('b7000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e1', 'ed000000-0000-4000-8000-0000000000d1', 1,
            '981115-SPEZZA-1', '1998-11-15', 'SPEZZA', 1, '1998-11-15 09:00+00', 'a1000000-0000-4000-8000-00000000000a', 6, 'kg', 30, 30, 72, '1998-11-18 09:00+00',
            '10000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-00000000000a');
  v_mv := pg_temp.mv('1e000000-0000-4000-8000-000000000001', 'consumption', -5.3, '1998-11-15 09:00+00', 'batch', 'b7000000-0000-4000-8000-000000000001', null, '10000000-0000-4000-8000-0000000000a1', 12.00);
  insert into public.batch_input (tenant_id, batch_id, ingredient_id, location_id, qty, stock_movement_id, created_by)
    values ('11111111-1111-4111-8111-111111111111', 'b7000000-0000-4000-8000-000000000001', '1e000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-0000000000a1', 5.3, v_mv, 'a1000000-0000-4000-8000-00000000000a');
end
$$;
select pg_temp.mv('1e000000-0000-4000-8000-000000000001', 'waste', -0.2, '1998-11-20 12:00+00', 'waste_op', 'a4000000-0000-4000-8000-000000000001', 'spoilage', '10000000-0000-4000-8000-0000000000a1', 12.00);
select pg_temp.mv('1e000000-0000-4000-8000-000000000002', 'consumption', -0.4, '1998-11-12 19:00+00', 'order_line', '15000000-0000-4000-8000-000000000001', null, '10000000-0000-4000-8000-0000000000a1', 20.00);
select pg_temp.mv('1e000000-0000-4000-8000-000000000004', 'consumption', -0.5, '1998-11-18 10:00+00', 'manual_use', 'a4000000-0000-4000-8000-000000000002', null, '10000000-0000-4000-8000-0000000000a1');
select pg_temp.count_session('c5000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-0000000000a1', 'monthly', '1998-11-30 10:00+00',
  '[{"i": "1e000000-0000-4000-8000-000000000001", "e": 24.5, "c": 24.2}, {"i": "1e000000-0000-4000-8000-000000000002", "e": 1.6, "c": 1.6},
    {"i": "1e000000-0000-4000-8000-000000000003", "e": 1.0, "c": 1.0}, {"i": "1e000000-0000-4000-8000-000000000004", "e": 0.5, "c": 0.5},
    {"i": "1e000000-0000-4000-8000-000000000005", "e": 2.0, "c": 2.0}]');

-- A fired sale (real fire_course) and a produced batch (real production at a fixed instant): the frozen costs.
--   Plate "Pizza (demo)": Farina 0,2 kg + Mozzarella 0,1 kg. Batch recipe "Impasto (demo)": Farina 2 kg, output 3 kg, 6 portions.
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e2', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'pizza (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e3', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'impasto (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by) values
  ('ed000000-0000-4000-8000-0000000000d2', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e2', 1, '1998-10-01T00:00Z', 'Pizza (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch, shelf_life_hours, created_by) values
  ('ed000000-0000-4000-8000-0000000000d3', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e3', 1, '1998-10-01T00:00Z', 'Impasto (demo)', 3, 'kg', 6, 48,
   'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, qty, unit, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d2', 1, '1e000000-0000-4000-8000-000000000011', 200, 'g', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d2', 2, '1e000000-0000-4000-8000-000000000012', 100, 'g', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d3', 1, '1e000000-0000-4000-8000-000000000011', 2, 'kg', 'a1000000-0000-4000-8000-00000000000a');
-- A plate with an unpriced ingredient: its cost is incomplete (null, never 0).
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e4', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'insalata (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by) values
  ('ed000000-0000-4000-8000-0000000000d4', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e4', 1, '1998-10-01T00:00Z', 'Insalata (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, qty, unit, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d4', 1, '1e000000-0000-4000-8000-000000000013', 50, 'g', 'a1000000-0000-4000-8000-00000000000a');
insert into public.menu_item (id, tenant_id, name, category, course_default, recipe_key, created_by, updated_by) values
  ('11000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Pizza (demo)', 'Secondi', 'secondi', 'ec000000-0000-4000-8000-0000000000e2',
   'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('13000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Tavolo 1 (demo)', 1, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, created_by, updated_by) values
  ('14000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000001', 'Tavolo 1 (demo)', 2,
   'a1000000-0000-4000-8000-00000000000a', '1998-11-24', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by) values
  ('15000000-0000-4000-8000-0000000000f1', '11111111-1111-4111-8111-111111111111', '14000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-0000000000a1', 'secondi', 2, 9, 10,
   'menu', '1998-11-24 12:00+00', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d');
set local role authenticated;
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select public.fire_course('14000000-0000-4000-8000-000000000001', '{"lineIds": ["15000000-0000-4000-8000-0000000000f1"]}'::jsonb);
reset role;
select app.produce_batch_core('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', 'ed000000-0000-4000-8000-0000000000d3', 3,
  '[{"ingredientId": "1e000000-0000-4000-8000-000000000011", "qty": 2, "unit": "kg", "locationId": "10000000-0000-4000-8000-0000000000a1"}]'::jsonb, 6, 48,
  '10000000-0000-4000-8000-0000000000a1', '1998-11-20T10:00Z');

-- 0. The fixture is what the pins below describe ---------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from public.stock_movement m join public.raw_lot l on l.id = m.raw_lot_id where m.type = 'receipt' and l.invoice_line_id::text like 'a9000000-%'), 4,
  'fixture: the three approved invoices made four receipts (50 + 10 kg, 30 kg, 10 kg)');
select is((select count(*)::int from public.payable), 3, 'fixture: and three payables');
select is((select count(*)::int from public.order_line_cost) || '/' || (select count(*)::int from public.batch_cost), '1/1', 'fixture: one frozen sale cost and one frozen batch cost');

-- 1. The pins (md5 of a text projection with no id, now() or random value in it) -------------------------------------------------------------------------------
create function pg_temp.pin_purchases() returns text language sql as $$
  select md5((select p.value::text || '/' || p.unvalued from app.kpi_purchases('11111111-1111-4111-8111-111111111111', '1998-11-01', '1998-11-30') p)) $$;
select is(pg_temp.pin_purchases(), 'b860c963d55fda016a182452af655d40', 'purchases of the fixture month (app.kpi_purchases) equal their value on main');

set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
create temporary table g_json (k text primary key, j jsonb);
grant select, insert on g_json to authenticated;
insert into g_json values
  ('avt', public.avt_report('c5000000-0000-4000-8000-000000000002')),
  ('payables', public.payable_list('unpaid')),
  ('rec_disp', public.stock_reconciliation('1998-11-01', '1998-11-30', '10000000-0000-4000-8000-0000000000a1')),
  ('rec_frigo', public.stock_reconciliation('1998-11-01', '1998-11-30', '10000000-0000-4000-8000-0000000000a2'));
create temporary table g_costs as select 'ingredient_costs'::text k, string_agg(c.name || '|' || c.basis || '|' || coalesce(c.unit_cost_eur::text, '-') || '|' || coalesce(c.avg_eur::text, '-') || '|' || coalesce(c.last_eur::text, '-')
    || '|' || coalesce(c.max_eur::text, '-') || '|' || c.purchases_used || '|' || coalesce(c.last_purchase_on::text, '-'), E'\n' order by c.name collate "C") v
  from public.ingredient_costs() c;
insert into g_costs
  select 'recipe_costs', string_agg(r.name || '|' || r.type || '|' || coalesce(r.total_cost_eur::text, '-') || '|' || coalesce(r.unit_cost_eur::text, '-') || '|' || r.cost_unit || '|' || r.incomplete
    || '|' || r.reasons::text || '|' || cardinality(r.missing_ingredient_ids), E'\n' order by r.name collate "C")
  from public.recipe_costs() r;
reset role;

select is(md5((select j::text from g_json where k = 'avt')), 'f0ab7074437d882cd8af172a70cd3aae', 'the AVT report of the closing count (rows and totals) equals its value on main');
-- The payable list is read without its ids and without the two columns that depend on today (daysToDue, overdue); the totals are pinned with it.
select is(md5((select string_agg((e - 'id' - 'daysToDue' - 'overdue' - 'invoiceId')::text, E'\n' order by e ->> 'dueDate') || '#' || (j -> 'totals')::text
                 from g_json, jsonb_array_elements(j -> 'items') e where k = 'payables' group by j)), '8261b8e740e43f864051deaec64aa586', 'the payables of the three invoices (payable_list) equal their value on main');
select is(md5((select j::text from g_json where k = 'rec_disp') || '#' || (select j::text from g_json where k = 'rec_frigo')), '9ec91f2ae0fa011d9e0f1c44a1fb5166',
  'the reconciliation of the month at both locations equals its value on main');
select is(md5((select v from g_costs where k = 'ingredient_costs')), '1d9ac9b47543906e9635a6ce47ae345c', 'public.ingredient_costs() (invoiced, price-only and unpriced ingredients) equals its value on main');
select is(md5((select v from g_costs where k = 'recipe_costs')), 'd8ed93e1e70af35e1ac9b380080d5f1e', 'public.recipe_costs() (plates, batches, an incomplete plate) equals its value on main');
select is(md5((select string_agg(c.total_cost::text || '|' || c.unit_cost_at_sale || '|' || c.incomplete || '|' || cardinality(c.missing_ingredient_ids), E'\n') from public.order_line_cost c)
           || '#' || (select string_agg(c.total_cost::text || '|' || c.unit_cost_frozen || '|' || c.incomplete || '|' || c.cost_at, E'\n') from public.batch_cost c)),
          'a38b0e93e755d4b23011cec7b5f85a50', 'the frozen costs (order_line_cost of the fired sale, batch_cost of the batch) equal their value on main');

-- 2. Mutation: one more received kilo (a receipt of 1 kg at 8,00) moves the purchases pin, so the pin can fail -------------------------------------------------------------
select isnt(pg_temp.scn(array[$s$ select pg_temp.receive('1e000000-0000-4000-8000-000000000012', 1, 8.00, '1998-11-20 08:00+00') $s$], 'select pg_temp.pin_purchases()'),
            'b860c963d55fda016a182452af655d40', 'mutation: one more received kilo changes the md5 of the purchases');
select is(pg_temp.scn(array[$s$ select pg_temp.receive('1e000000-0000-4000-8000-000000000012', 1, 8.00, '1998-11-20 08:00+00') $s$], 'select pg_temp.pin_purchases()'),
          pg_temp.scn(array[$s$ select pg_temp.receive('1e000000-0000-4000-8000-000000000012', 1, 8.00, '1998-11-21 08:00+00') $s$], 'select pg_temp.pin_purchases()'),
          'control: the same extra kilo on another day of the month gives the same md5 (the pin reads value and count, not the day)');

select * from finish();
rollback;
