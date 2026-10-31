-- M22 step 5 (docs/plans/2026-10-31-m22-kpi-reporting.md §3.1.6, §3.2, §3.9, §5; ADR-025; AT4): app.avt_rows and public.avt_report, actual against theoretical consumption between two
-- closed monthly counts of one location, in EUR. Actual = what the counts say disappeared (every movement of the window except receipts and transfers); theoretical =
-- the recipe for the batches made (T1: app.batch_requirements scaled by output / recipe output) plus the plate raw booked at fire. T1 and T2 are proved here.
-- Manzo (demo): O counted 10, +20 received, one stew batch (recipe 5,0 kg, chef confirmed 5,3), waste 0,2, C counted 24,2 -> actual 5,8, theoretical 5,0, 0,8 kg = 9,60 EUR.
-- Pepe (demo) adds the voided-line rule, so the loss total is 18,60. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(56);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo');

-- Locations: Cella is the counted one; Dispensa starts inactive (activated by a test). Tenant B has its own.
insert into public.location (id, tenant_id, name, is_active) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)', true),
  ('10000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'Dispensa (demo)', false),
  ('10000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Cella B (demo)', true);
insert into public.supplier (id, tenant_id, name, vat_number) values ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo Srl', 'IT12345678903');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id) values
  ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/e1000000-0000-4000-8000-0000000000e1.pdf', 'application/pdf', 2048, 'review', '5a000000-0000-4000-8000-00000000005a');
insert into public.ingredient (id, tenant_id, name, base_unit, is_stock) values
  ('1e000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Manzo (demo)', 'kg', true),
  ('1e000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Parmigiano (demo)', 'kg', true),
  ('1e000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Pepe (demo)', 'kg', true),
  ('1e000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'Lievito (demo)', 'kg', true),
  ('1e000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'Aceto (demo)', 'l', true),
  ('1e000000-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', 'Sale (demo)', 'kg', false);

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
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
-- A scenario: runs the setup statements and one query inside a block that is rolled back, and returns the query's text. The ledger is append-only, so a
-- savepoint-free rollback is the way to try "what if" rows.
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

-- Prices: one invoice line per price (price_history points at it). Lievito has none.
create sequence pg_temp.line_seq;
create function pg_temp.price(p_ing uuid, p_price numeric) returns void language plpgsql as $$
declare
  v_n int := nextval('pg_temp.line_seq');
  v_line uuid := ('a2000000-0000-4000-8000-' || lpad(v_n::text, 12, '0'))::uuid;
begin
  insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price, line_amount, field_confidence, extracted)
    values (v_line, '11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-0000000000e1', v_n, 'Riga demo', 1, p_price, p_price, '{}', '{}');
  insert into public.price_history (tenant_id, ingredient_id, supplier_id, invoice_line_id, unit_price, base_unit, effective_on, created_by)
    select '11111111-1111-4111-8111-111111111111', i.id, '5a000000-0000-4000-8000-00000000005a', v_line, p_price, i.base_unit, '2026-10-15', 'a1000000-0000-4000-8000-00000000000a'
      from public.ingredient i where i.id = p_ing;
end
$$;
select pg_temp.price('1e000000-0000-4000-8000-000000000001', 12.00);
select pg_temp.price('1e000000-0000-4000-8000-000000000002', 20.00);
select pg_temp.price('1e000000-0000-4000-8000-000000000003', 30.00);
select pg_temp.price('1e000000-0000-4000-8000-000000000005', 4.00);

-- A stock movement at a fixed instant (the ledger is written by the owner of the table in a fixture).
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
-- A count session with its lines and its count movements, closed at a fixed instant. p_lines: [[ingredient, expected, counted]...] as jsonb rows
-- {"i": uuid, "e": expected, "c": counted|null}; the adjustment (counted - expected) is posted as a count movement of the session.
create function pg_temp.count_session(p_id uuid, p_tenant uuid, p_loc uuid, p_type text, p_closed timestamptz, p_lines jsonb, p_user uuid) returns void language plpgsql as $$
declare
  e jsonb;
  n int := 0;
begin
  insert into public.count_session (id, tenant_id, location_id, type, started_at, started_by) values (p_id, p_tenant, p_loc, p_type, coalesce(p_closed, now()) - interval '1 hour', p_user);
  for e in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    insert into public.count_line (tenant_id, session_id, ingredient_id, position, expected_qty, counted_qty, entered_at, entered_by, created_by)
      values (p_tenant, p_id, (e ->> 'i')::uuid, n, case when e ->> 'c' is not null then (e ->> 'e')::numeric end, (e ->> 'c')::numeric,
              case when e ->> 'c' is not null then coalesce(p_closed, now()) - interval '30 minutes' end,
              case when e ->> 'c' is not null then p_user end, p_user);
    if e ->> 'c' is not null and (e ->> 'c')::numeric <> (e ->> 'e')::numeric and p_tenant = '11111111-1111-4111-8111-111111111111' then
      perform pg_temp.mv((e ->> 'i')::uuid, 'count', (e ->> 'c')::numeric - (e ->> 'e')::numeric, p_closed, 'count_session', p_id, null, p_loc);
    end if;
  end loop;
  if p_closed is not null then
    update public.count_session set status = 'closed', closed_at = p_closed, closed_by = p_user where id = p_id;
  end if;
end
$$;

-- The opening count O (monthly, closed 2026-11-01 10:00Z): Manzo 10, Parmigiano 2,0, Pepe 1,0, Lievito 1,0 (Aceto is not counted).
select pg_temp.count_session('c5000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '10000000-0000-4000-8000-0000000000a1', 'monthly', '2026-11-01 10:00+00',
  '[{"i": "1e000000-0000-4000-8000-000000000001", "e": 0, "c": 10}, {"i": "1e000000-0000-4000-8000-000000000002", "e": 0, "c": 2.0},
    {"i": "1e000000-0000-4000-8000-000000000003", "e": 0, "c": 1.0}, {"i": "1e000000-0000-4000-8000-000000000004", "e": 0, "c": 1.0}]',
  'a1000000-0000-4000-8000-00000000000a');
-- A daily count in the window (it counts Manzo at its ledger quantity, nothing to adjust).
select pg_temp.count_session('c5000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', '10000000-0000-4000-8000-0000000000a1', 'daily', '2026-11-16 08:00+00',
  '[{"i": "1e000000-0000-4000-8000-000000000001", "e": 24.5, "c": 24.5}]', 'a1000000-0000-4000-8000-00000000000a');

-- The window. Manzo: a receipt of 20 kg, one stew batch (the recipe needs 5,0 kg for the output made; the chef confirmed 5,3), waste of 0,2.
select pg_temp.receive('1e000000-0000-4000-8000-000000000001', 20, 12.00, '2026-11-10 08:00+00');
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'spezzatino (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch, shelf_life_hours, created_by) values
  ('ed000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e1', 1, '2026-10-01T00:00Z', 'Spezzatino (demo)', 6, 'kg', 30, 72,
   'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, qty, unit, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d1', 1, '1e000000-0000-4000-8000-000000000001', 5, 'kg', 'a1000000-0000-4000-8000-00000000000a');
create function pg_temp.mk_batch(p_id uuid, p_produced timestamptz, p_seq int, p_loc uuid, p_input_qty numeric, p_output numeric default 6) returns void language plpgsql as $$
declare
  v_mv uuid;
begin
  insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code, lot_seq, produced_at, produced_by, output_qty, output_unit,
                            portions_computed, portions_initial, shelf_life_hours, use_by, location_id, created_by)
    values (p_id, '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e1', 'ed000000-0000-4000-8000-0000000000d1', 1,
            to_char((p_produced at time zone 'Europe/Rome')::date, 'YYMMDD') || '-SPEZZA-' || p_seq, (p_produced at time zone 'Europe/Rome')::date, 'SPEZZA', p_seq,
            p_produced, 'a1000000-0000-4000-8000-00000000000a', p_output, 'kg', 30, 30, 72, p_produced + make_interval(hours => 72), p_loc, 'a1000000-0000-4000-8000-00000000000a');
  v_mv := pg_temp.mv('1e000000-0000-4000-8000-000000000001', 'consumption', -p_input_qty, p_produced, 'batch', p_id, null, p_loc, 12.00);
  insert into public.batch_input (tenant_id, batch_id, ingredient_id, location_id, qty, stock_movement_id, created_by)
    values ('11111111-1111-4111-8111-111111111111', p_id, '1e000000-0000-4000-8000-000000000001', p_loc, p_input_qty, v_mv, 'a1000000-0000-4000-8000-00000000000a');
end
$$;
select pg_temp.mk_batch('b7000000-0000-4000-8000-000000000001', '2026-11-15 09:00+00', 1, '10000000-0000-4000-8000-0000000000a1', 5.3);
select pg_temp.mv('1e000000-0000-4000-8000-000000000001', 'waste', -0.2, '2026-11-20 12:00+00', 'waste_op', 'a4000000-0000-4000-8000-000000000001', 'spoilage', '10000000-0000-4000-8000-0000000000a1', 12.00);
-- Parmigiano: a plate raw booked at fire (0,4), recipe consumption.
select pg_temp.mv('1e000000-0000-4000-8000-000000000002', 'consumption', -0.4, '2026-11-12 19:00+00', 'order_line', '15000000-0000-4000-8000-000000000001', null, '10000000-0000-4000-8000-0000000000a1', 20.00);
-- Pepe: a line fired (consumption 0,3) and voided (the reversal and the raw moved to waste): not theoretical, but gone.
select pg_temp.mv('1e000000-0000-4000-8000-000000000003', 'consumption', -0.3, '2026-11-13 12:00+00', 'order_line', '15000000-0000-4000-8000-000000000002', null, '10000000-0000-4000-8000-0000000000a1', 30.00);
select pg_temp.mv('1e000000-0000-4000-8000-000000000003', 'consumption', 0.3, '2026-11-13 12:05+00', 'order_void', '15000000-0000-4000-8000-000000000002', null, '10000000-0000-4000-8000-0000000000a1', 30.00,
                  (select id from public.stock_movement where ref_id = '15000000-0000-4000-8000-000000000002' and reverses_id is null));
select pg_temp.mv('1e000000-0000-4000-8000-000000000003', 'waste', -0.3, '2026-11-13 12:05+00', 'order_void', '15000000-0000-4000-8000-000000000002', 'spoilage', '10000000-0000-4000-8000-0000000000a1', 30.00);
-- Lievito (no price): 0,5 used outside any recipe. Aceto: a receipt of 2 l, counted only in C.
select pg_temp.mv('1e000000-0000-4000-8000-000000000004', 'consumption', -0.5, '2026-11-18 10:00+00', 'manual_use', 'a4000000-0000-4000-8000-000000000002', null, '10000000-0000-4000-8000-0000000000a1');
select pg_temp.receive('1e000000-0000-4000-8000-000000000005', 2, 4.00, '2026-11-11 08:00+00');

-- The closing count C (monthly, 2026-11-30 10:00Z). The ledger shows Manzo 24,5 before it; counted 24,2 posts -0,3.
select pg_temp.count_session('c5000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', '10000000-0000-4000-8000-0000000000a1', 'monthly', '2026-11-30 10:00+00',
  '[{"i": "1e000000-0000-4000-8000-000000000001", "e": 24.5, "c": 24.2}, {"i": "1e000000-0000-4000-8000-000000000002", "e": 1.6, "c": 1.6},
    {"i": "1e000000-0000-4000-8000-000000000003", "e": 0.7, "c": 0.7}, {"i": "1e000000-0000-4000-8000-000000000004", "e": 0.5, "c": 0.5},
    {"i": "1e000000-0000-4000-8000-000000000005", "e": 2.0, "c": 2.0}]',
  'a1000000-0000-4000-8000-00000000000a');
-- An open monthly count (after C), a closed monthly count of tenant B.
select pg_temp.count_session('c5000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', '10000000-0000-4000-8000-0000000000a1', 'monthly', null,
  '[{"i": "1e000000-0000-4000-8000-000000000001", "e": 24.2, "c": null}]', 'a1000000-0000-4000-8000-00000000000a');

insert into public.ingredient (id, tenant_id, name, base_unit) values ('2e000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Burro B (demo)', 'kg');
select pg_temp.count_session('c5000000-0000-4000-8000-000000000005', '22222222-2222-4222-8222-222222222222', '10000000-0000-4000-8000-0000000000b1', 'monthly', '2026-11-30 11:00+00',
  '[{"i": "2e000000-0000-4000-8000-000000000001", "e": 1, "c": 1}]', 'b1000000-0000-4000-8000-00000000000b');

select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
create temporary table av as select public.avt_report('c5000000-0000-4000-8000-000000000002') as j;
create function pg_temp.arow(p_name text) returns jsonb language sql as $$ select e from av, jsonb_array_elements(j -> 'rows') e where e ->> 'name' like p_name || '%' $$;
create function pg_temp.av_(p_name text, p_key text) returns numeric language sql as $$ select (pg_temp.arow(p_name) ->> p_key)::numeric $$;
-- The Manzo actual in a scenario (the setup statements are rolled back).
create function pg_temp.manzo_in(p_setup text[], p_key text) returns text language sql as $$
  select pg_temp.scn(p_setup, format($q$ select (e ->> %L) from jsonb_array_elements(public.avt_report('c5000000-0000-4000-8000-000000000002') -> 'rows') e where e ->> 'name' like 'Manzo%%' $q$, p_key))
$$;

-- AT4: the Manzo row --------------------------------------------------------------------------------------------------------------------------------
select is((select array_agg(k order by k collate "C") from av, jsonb_object_keys(j) k), array['availableCounts', 'count', 'locationsActive', 'openingCount', 'rows', 'totals'], 'the reply has exactly the keys of plan §3.2');
select is(pg_temp.av_('Manzo', 'actualQty'), 5.8::numeric, 'AT4: Manzo actualQty 5,8 (10 + 20 - 24,2)');
select is(pg_temp.av_('Manzo', 'theoreticalQty'), 5.0::numeric, 'theoreticalQty 5,0 (the recipe for the output made, not the 5,3 the chef confirmed)');
select is(pg_temp.av_('Manzo', 'wasteQty'), 0.2::numeric, 'wasteQty 0,2');
select is(pg_temp.av_('Manzo', 'varianceQty'), 0.8::numeric, 'varianceQty 0,8');
select is(pg_temp.av_('Manzo', 'unitCostEur'), 12.00::numeric, 'unitCostEur 12,00');
select is(pg_temp.av_('Manzo', 'varianceEur'), 9.6000::numeric, 'varianceEur 9,6000');
select is((select (e ->> 'actualQty')::numeric from av, jsonb_array_elements(j -> 'rows') e where e ->> 'name' like 'Manzo%'),
          (select 10 + 20 - 24.2), 'actual = counted(O) + receipts - counted(C)');
select is(array[pg_temp.av_('Parmigiano', 'actualQty'), pg_temp.av_('Parmigiano', 'theoreticalQty'), pg_temp.av_('Parmigiano', 'varianceQty'), pg_temp.av_('Parmigiano', 'varianceEur')],
          array[0.4, 0.4, 0, 0]::numeric[], 'Parmigiano: the plate raw booked at fire is recipe consumption: variance 0');
select is(array[pg_temp.av_('Pepe', 'actualQty'), pg_temp.av_('Pepe', 'theoreticalQty'), pg_temp.av_('Pepe', 'wasteQty'), pg_temp.av_('Pepe', 'varianceQty'), pg_temp.av_('Pepe', 'varianceEur')],
          array[0.3, 0, 0.3, 0.3, 9.00]::numeric[], 'the raw of a line voided after fire is not theoretical (it became waste, which disappeared): variance 0,3 = 9,00');
select is(array[pg_temp.av_('Lievito', 'actualQty'), pg_temp.av_('Lievito', 'theoreticalQty'), pg_temp.av_('Lievito', 'varianceQty')], array[0.5, 0, 0.5]::numeric[], 'Lievito: 0,5 used outside the recipes');
select is(pg_temp.arow('Lievito') -> 'unitCostEur', 'null'::jsonb, 'an unpriced ingredient: unitCostEur null');
select is(pg_temp.arow('Lievito') -> 'varianceEur', 'null'::jsonb, 'and varianceEur null, never 0');
select is((select array_agg(e ->> 'name' order by o) from av, jsonb_array_elements(j -> 'rows') with ordinality t(e, o)),
          array['Manzo (demo)', 'Pepe (demo)', 'Parmigiano (demo)', 'Lievito (demo)'], 'rows by abs(varianceEur) descending, unpriced last; Aceto (counted only in C) and Sale (not in stock) are absent');
select is((select array_agg(k order by k collate "C") from av, jsonb_array_elements(j -> 'rows') e, jsonb_object_keys(e) k where e ->> 'name' like 'Manzo%'),
          array['actualQty', 'baseUnit', 'ingredientId', 'name', 'theoreticalQty', 'unitCostEur', 'varianceEur', 'varianceQty', 'wasteQty'], 'a row has exactly the keys of plan §3.2');
select is((select j -> 'totals' from av), '{"varianceEur": 18.6, "lossEur": 18.6, "gainEur": 0, "unvaluedCount": 1, "notCountedCount": 1}'::jsonb,
          'totals: loss 9,60 (Manzo) + 9,00 (Pepe), gain 0, one unvalued ingredient, one counted only once (Aceto)');
select is((select j -> 'count' ->> 'id' from av), 'c5000000-0000-4000-8000-000000000002', 'count.id is C');
select is((select j -> 'count' ->> 'locationName' from av), 'Cella (demo)', 'count.locationName');
select is((select (j -> 'count' ->> 'closedAt')::timestamptz from av), '2026-11-30 10:00+00'::timestamptz, 'count.closedAt');
select is((select array[j -> 'openingCount' ->> 'id', (j -> 'openingCount' ->> 'closedAt')::timestamptz::text] from av), array['c5000000-0000-4000-8000-000000000001', '2026-11-01 10:00:00+00'], 'openingCount is O');

-- Window rules (scenarios, rolled back) --------------------------------------------------------------------------------------------------------------------
select is(pg_temp.manzo_in(array[$$select pg_temp.mv('1e000000-0000-4000-8000-000000000001', 'consumption', -0.1, '2026-11-01 10:00:00.000001+00', 'manual_use', gen_random_uuid())$$], 'actualQty')::numeric,
          5.9::numeric, 'a consumption 1 microsecond after O.closed_at is counted');
select is(pg_temp.manzo_in(array[$$select pg_temp.mv('1e000000-0000-4000-8000-000000000001', 'consumption', -0.1, '2026-11-01 10:00:00+00', 'manual_use', gen_random_uuid())$$], 'actualQty')::numeric,
          5.8::numeric, 'a consumption at O.closed_at itself is before the window; so are O''s own count rows (created_at = O.closed_at, +10 for Manzo)');
select is(pg_temp.manzo_in(array[$$select pg_temp.mv('1e000000-0000-4000-8000-000000000001', 'count', -50, '2026-11-02 10:00+00', 'count_session', 'c5000000-0000-4000-8000-000000000001')$$], 'actualQty')::numeric,
          5.8::numeric, 'a count row that belongs to O is out whatever its created_at (chosen by reference)');
select is(pg_temp.manzo_in(array[$$select pg_temp.mv('1e000000-0000-4000-8000-000000000001', 'count', -1, '2026-11-30 09:00+00', 'count_session', 'c5000000-0000-4000-8000-000000000003')$$], 'actualQty')::numeric,
          6.8::numeric, 'a count row of another session in the window is a real disappearance and is counted');
select is(pg_temp.manzo_in(array[$$select pg_temp.mv('1e000000-0000-4000-8000-000000000001', 'transfer', -3, '2026-11-17 09:00+00', 'transfer', gen_random_uuid(), null, '10000000-0000-4000-8000-0000000000a1')$$], 'actualQty')::numeric,
          5.8::numeric, 'a transfer out is not consumption');
select is(pg_temp.manzo_in(array[$$select pg_temp.mk_batch('b7000000-0000-4000-8000-000000000002', '2026-10-31 09:00+00', 2, '10000000-0000-4000-8000-0000000000a1', 5.0)$$], 'theoreticalQty')::numeric,
          5.0::numeric, 'a batch produced before O.closed_at is not theoretical');
select is(pg_temp.manzo_in(array[$$select pg_temp.mk_batch('b7000000-0000-4000-8000-000000000003', '2026-11-16 09:00+00', 3, '10000000-0000-4000-8000-0000000000a2', 5.0)$$], 'theoreticalQty')::numeric,
          5.0::numeric, 'a batch whose inputs are at another location is not theoretical for Cella');
select is(pg_temp.manzo_in(array[$$select pg_temp.mk_batch('b7000000-0000-4000-8000-000000000003', '2026-11-16 09:00+00', 3, '10000000-0000-4000-8000-0000000000a2', 5.0)$$], 'actualQty')::numeric,
          5.8::numeric, 'nor is its consumption at the other location actual consumption for Cella');
select is(pg_temp.manzo_in(array[$$select pg_temp.mk_batch('b7000000-0000-4000-8000-000000000004', '2026-11-25 09:00+00', 4, '10000000-0000-4000-8000-0000000000a1', 5.0)$$], 'theoreticalQty')::numeric,
          10.0::numeric, 'a second batch in the window doubles the theoretical consumption');
select is(pg_temp.manzo_in(array[$$select pg_temp.mk_batch('b7000000-0000-4000-8000-000000000005', '2026-11-26 09:00+00', 5, '10000000-0000-4000-8000-0000000000a1', 2.5, 3)$$], 'theoreticalQty')::numeric,
          7.5::numeric, 'the recipe quantity scales with the output made: 3 kg of a 6 kg recipe adds 2,5 kg (T1)');

select is(pg_temp.scn(array[$$insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, qty, unit, created_by) values
          ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d1', 2, '1e000000-0000-4000-8000-000000000002', 1, 'kg', 'a1000000-0000-4000-8000-00000000000a')$$],
          $q$ select (e ->> 'theoreticalQty') from jsonb_array_elements(public.avt_report('c5000000-0000-4000-8000-000000000002') -> 'rows') e where e ->> 'name' like 'Parmigiano%' $q$)::numeric,
          1.4::numeric, 'a batch at the location counts every recipe ingredient, also one with no batch_input row (entered as 0): Parmigiano 0,4 plate + 1,0 of the batch (plan §3.1.6)');

-- Valuation and the other counts --------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from jsonb_array_elements((select j -> 'availableCounts' from av)) e), 2, 'availableCounts: the two closed monthly counts of tenant A (not the daily, the open or tenant B''s)');
select is((select array_agg(e ->> 'id' order by o) from av, jsonb_array_elements(j -> 'availableCounts') with ordinality t(e, o)),
          array['c5000000-0000-4000-8000-000000000002', 'c5000000-0000-4000-8000-000000000001'], 'newest first');
select is((select j -> 'availableCounts' -> 0 ->> 'locationName' from av), 'Cella (demo)', 'each carries its location name');
select is((select (j ->> 'locationsActive')::int from av), 1, 'locationsActive 1');
update public.location set is_active = true where id = '10000000-0000-4000-8000-0000000000a2';
select is((public.avt_report('c5000000-0000-4000-8000-000000000002') ->> 'locationsActive')::int, 2, 'locationsActive 2 once a second location is active');

-- Default and errors ----------------------------------------------------------------------------------------------------------------------------------
select is(public.avt_report(null) -> 'count' ->> 'id', 'c5000000-0000-4000-8000-000000000002', 'avt_report(null) is the latest closed monthly count');
select is(pg_temp.err($$select public.avt_report('c5000000-0000-4000-8000-000000000003')$$), 'P0001 avt_count_not_monthly', 'a daily count: avt_count_not_monthly');
select is(pg_temp.err($$select public.avt_report('c5000000-0000-4000-8000-000000000004')$$), 'P0001 avt_count_not_closed', 'an open monthly count: avt_count_not_closed');
select is(pg_temp.err($$select public.avt_report('c5000000-0000-4000-8000-000000000001')$$), 'P0001 avt_no_opening_count', 'the first monthly count: avt_no_opening_count');
select is(pg_temp.err($$select public.avt_report('c5000000-0000-4000-8000-000000000005')$$), 'P0002 count_not_found', 'tenant B''s count: count_not_found');
select is(pg_temp.err($$select public.avt_report('ffffffff-ffff-4fff-8fff-ffffffffffff')$$), 'P0002 count_not_found', 'an unknown id: count_not_found');
update public.count_session set status = 'cancelled', cancelled_at = '2026-12-01 09:00+00', cancelled_by = 'a1000000-0000-4000-8000-00000000000a' where id = 'c5000000-0000-4000-8000-000000000004';
select is(pg_temp.err($$select public.avt_report('c5000000-0000-4000-8000-000000000004')$$), 'P0001 avt_count_not_closed', 'a cancelled count is not closed either');
-- 14 closed monthly counts: availableCounts keeps the 12 newest.
select pg_temp.count_session(('c6000000-0000-4000-8000-0000000000' || lpad(g::text, 2, '0'))::uuid, '11111111-1111-4111-8111-111111111111', '10000000-0000-4000-8000-0000000000a1', 'monthly',
  '2026-12-01 10:00+00'::timestamptz + make_interval(days => g), '[{"i": "1e000000-0000-4000-8000-000000000001", "e": 24.2, "c": 24.2}]', 'a1000000-0000-4000-8000-00000000000a')
  from generate_series(1, 12) g;
select is(jsonb_array_length(public.avt_report(null) -> 'availableCounts'), 12, 'availableCounts holds at most 12 (14 counts exist)');
select is(public.avt_report(null) -> 'availableCounts' -> 0 ->> 'id', 'c6000000-0000-4000-8000-000000000012', 'the newest first');
select is(public.avt_report('c6000000-0000-4000-8000-000000000001') -> 'openingCount' ->> 'id', 'c5000000-0000-4000-8000-000000000002', 'the opening count of a later one is the previous closed monthly count (C)');

-- Roles, privileges, tenancy ------------------------------------------------------------------------------------------------------------------------
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is(public.avt_report('c5000000-0000-4000-8000-000000000002') -> 'totals' ->> 'lossEur', '18.6000', 'the admin reads it too');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.err($$select public.avt_report(null)$$), '42501 permission denied: the day close needs owner or admin', 'the chef: 42501');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(pg_temp.err($$select public.avt_report(null)$$), '42501 permission denied: the day close needs owner or admin', 'the waiter: 42501');
select set_config('request.jwt.claims', '', true);
select is(pg_temp.err($$select public.avt_report(null)$$), '42501 permission denied: the day close needs owner or admin', 'no claims: 42501 (the role is checked before the lookup)');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(pg_temp.err($$select public.avt_report('c5000000-0000-4000-8000-000000000002')$$), 'P0002 count_not_found', 'owner B asking for A''s count: count_not_found');
select is(pg_temp.err($$select public.avt_report(null)$$), 'P0001 avt_no_opening_count', 'owner B''s latest count is its first: avt_no_opening_count');
select is((select has_function_privilege('authenticated', 'public.avt_report(uuid)', 'execute')), true, 'authenticated can execute avt_report');
select is((select bool_or(has_function_privilege(r, 'public.avt_report(uuid)', 'execute')) from unnest(array['anon', 'service_role']) r), false, 'anon and service_role cannot');
select is((select bool_or(has_function_privilege(r, 'app.avt_rows(uuid, uuid, uuid)', 'execute')) from unnest(array['anon', 'authenticated', 'service_role']) r), false, 'no API role executes app.avt_rows');
select is((select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = 'app.avt_rows(uuid, uuid, uuid)'::regprocedure), true, 'avt_rows is a definer with an empty search_path');

select * from finish();
