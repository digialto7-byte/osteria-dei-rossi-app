-- M22 step 3 (docs/plans/2026-10-31-m22-kpi-reporting.md §3.2, §3.3, §3.7, §5; ADR-025; AT1, AT6): app.kpi_period, app.kpi_range_agg, app.kpi_purchases, app.kpi_register_range,
-- app.kpi_report_json and public.kpi_report. Every KPI row of PRD 4.2 except the per-item rows and AVT, on the fixture day D = 1998-11-04 of plan §3.9, through the
-- twin with a fixed "now" (1998-11-05 09:00 local). Two tenants, two dates, mapped/unmapped/incomplete items. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(80);

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

-- Plates: Spezzatino and Tagliatelle have a recipe (frozen cost 4,20 and 3,10 per plate); Acqua and Vino do not.
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'spezzatino con polenta (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e2', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'tagliatelle al ragu (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by) values
  ('ed000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e1', 1, '1998-10-01T00:00Z', 'Spezzatino con polenta (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ed000000-0000-4000-8000-0000000000d2', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e2', 1, '1998-10-01T00:00Z', 'Tagliatelle al ragù (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.menu_item (id, tenant_id, name, category, course_default, recipe_key, created_by, updated_by) values
  ('11000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Spezzatino con polenta (demo)', 'Secondi', 'secondi', 'ec000000-0000-4000-8000-0000000000e1', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Tagliatelle al ragù (demo)', 'Primi', 'primi', 'ec000000-0000-4000-8000-0000000000e2', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Acqua (demo)', 'Bevande', 'bevande', null, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'Vino rosso (demo)', 'Bevande', 'bevande', null, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('21000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Acqua B (demo)', 'Bevande', 'bevande', null, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by)
  select ('13000000-0000-4000-8000-00000000000' || n)::uuid, '11111111-1111-4111-8111-111111111111', 'Tavolo ' || n || ' (demo)', n,
         'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a' from generate_series(1, 6) n;
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('23000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Tavolo B (demo)', 1, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');

-- Sessions (Europe/Rome, CET in November; cut-off 02:00). T1 and T2 close on business date D = 1998-11-04 (T2 after midnight), T3 closes after the
-- cut-off (business date D + 1), T4 stays open. P7 closes on D - 7, P3 on D - 3 (the plates of the fixed cost window). SB is tenant B on D.
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_at, opened_by, business_date, coperto_amount, coperto_vat_rate, created_by, updated_by) values
  ('14000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000001', 'Tavolo 1 (demo)', 3, '1998-11-04 19:10+00', 'd1000000-0000-4000-8000-00000000000d', '1998-11-04', 2.00, 10, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'),
  ('14000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000002', 'Tavolo 2 (demo)', 2, '1998-11-04 20:30+00', 'd1000000-0000-4000-8000-00000000000d', '1998-11-04', 2.00, 10, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'),
  ('14000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000003', 'Tavolo 3 (demo)', 2, '1998-11-04 22:50+00', 'd1000000-0000-4000-8000-00000000000d', '1998-11-04', null, null, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'),
  ('14000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000004', 'Tavolo 4 (demo)', 4, '1998-11-04 21:00+00', 'd1000000-0000-4000-8000-00000000000d', '1998-11-04', null, null, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'),
  ('14000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000005', 'Tavolo 5 (demo)', 2, '1998-10-28 18:30+00', 'd1000000-0000-4000-8000-00000000000d', '1998-10-28', null, null, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'),
  ('14000000-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000006', 'Tavolo 6 (demo)', 2, '1998-11-01 18:30+00', 'd1000000-0000-4000-8000-00000000000d', '1998-11-01', null, null, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'),
  ('24000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', '23000000-0000-4000-8000-000000000001', 'Tavolo B (demo)', 2, '1998-11-04 19:30+00', 'b1000000-0000-4000-8000-00000000000b', '1998-11-04', null, null, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');

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
-- One tenant-A order line (the owner fixture writes states no procedure can write directly): fired, or voided after firing. The frozen cost
-- row is added with p_cost: a total (the line's), 'none' for an unmapped item, 'incomplete' for a mapped plate with a missing ingredient.
create function pg_temp.addl(p_n int, p_session uuid, p_item uuid, p_course public.course, p_qty numeric, p_price numeric, p_vat numeric,
                             p_state text, p_at timestamptz, p_recipe uuid, p_total numeric, p_incomplete boolean default false) returns void language plpgsql as $$
declare
  v_id uuid := ('15000000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid;
begin
  insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source,
                                 client_updated_at, created_at, created_by, updated_by, fired_at, fired_by, voided_at, voided_by, void_reason)
  values (v_id, '11111111-1111-4111-8111-111111111111', p_session, p_item, p_course, p_qty, p_price, p_vat, 'menu',
          '1998-11-04 20:00+00', p_at, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d',
          p_at, 'd1000000-0000-4000-8000-00000000000d',
          case when p_state = 'voided' then p_at + interval '1 minute' end,
          case when p_state = 'voided' then 'd1000000-0000-4000-8000-00000000000d'::uuid end,
          case when p_state = 'voided' then 'wrong_dish' end);
  insert into public.order_line_cost (order_line_id, tenant_id, recipe_id, total_cost, unit_cost_at_sale, incomplete, missing_ingredient_ids, cost_at, created_by)
  values (v_id, '11111111-1111-4111-8111-111111111111', p_recipe, case when not p_incomplete then p_total end,
          case when not p_incomplete then round(p_total / p_qty, 4) end, p_incomplete or p_recipe is null,
          case when p_incomplete and p_recipe is not null then array['16000000-0000-4000-8000-000000000001']::uuid[] else '{}'::uuid[] end,
          p_at, 'd1000000-0000-4000-8000-00000000000d');
end
$$;
-- T1: 2 + 1/2 Spezzatino (10 %), 1,5 Tagliatelle, 1 Vino (22 %), and a Tagliatelle voided after firing (its cost row stays).
select pg_temp.addl(1, '14000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'secondi', 2, 14.00, 10, 'fired', '1998-11-04 19:15+00', 'ed000000-0000-4000-8000-0000000000d1', 8.40);
select pg_temp.addl(2, '14000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'secondi', 0.5, 14.00, 10, 'fired', '1998-11-04 19:16+00', 'ed000000-0000-4000-8000-0000000000d1', 2.10);
select pg_temp.addl(3, '14000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000002', 'primi', 1.5, 12.50, 10, 'fired', '1998-11-04 19:17+00', 'ed000000-0000-4000-8000-0000000000d2', 4.65);
select pg_temp.addl(4, '14000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000004', 'bevande', 1, 40.25, 22, 'fired', '1998-11-04 19:18+00', null, null);
select pg_temp.addl(5, '14000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000002', 'primi', 1, 12.50, 10, 'voided', '1998-11-04 19:19+00', 'ed000000-0000-4000-8000-0000000000d2', 3.10);
-- T2: 2 Tagliatelle and 2 Acqua. T3 (closes on D + 1) and T4 (open): one plate each.
select pg_temp.addl(6, '14000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000002', 'primi', 2, 12.50, 10, 'fired', '1998-11-04 20:35+00', 'ed000000-0000-4000-8000-0000000000d2', 6.20);
select pg_temp.addl(7, '14000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000003', 'bevande', 2, 3.00, 10, 'fired', '1998-11-04 20:36+00', null, null);
select pg_temp.addl(8, '14000000-0000-4000-8000-000000000003', '11000000-0000-4000-8000-000000000002', 'primi', 1, 12.50, 10, 'fired', '1998-11-04 22:55+00', 'ed000000-0000-4000-8000-0000000000d2', 3.10);
select pg_temp.addl(9, '14000000-0000-4000-8000-000000000004', '11000000-0000-4000-8000-000000000001', 'secondi', 1, 14.00, 10, 'fired', '1998-11-04 21:05+00', 'ed000000-0000-4000-8000-0000000000d1', 4.20);
-- P7 (D - 7): 4 Tagliatelle. P3 (D - 3): 56 Spezzatino.
select pg_temp.addl(10, '14000000-0000-4000-8000-000000000005', '11000000-0000-4000-8000-000000000002', 'primi', 4, 12.50, 10, 'fired', '1998-10-28 18:35+00', 'ed000000-0000-4000-8000-0000000000d2', 12.40);
select pg_temp.addl(11, '14000000-0000-4000-8000-000000000006', '11000000-0000-4000-8000-000000000001', 'secondi', 56, 14.00, 10, 'fired', '1998-11-01 18:35+00', 'ed000000-0000-4000-8000-0000000000d1', 235.20);
-- Tenant B: one closed session of 999,00 on D.
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_at, created_by, updated_by, fired_at, fired_by)
  values ('25000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', '24000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', 'bevande', 1, 999.00, 10, 'menu',
          '1998-11-04 20:00+00', '1998-11-04 19:35+00', 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b', '1998-11-04 19:35+00', 'b1000000-0000-4000-8000-00000000000b');
insert into public.order_line_cost (order_line_id, tenant_id, recipe_id, total_cost, unit_cost_at_sale, incomplete, cost_at, created_by)
  values ('25000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', null, null, null, true, '1998-11-04 19:35+00', 'b1000000-0000-4000-8000-00000000000b');

-- Closing: the frozen total and the business date of the close (Q128). The closing UPDATE is the only write the guard allows.
create function pg_temp.close_s(p_session uuid, p_closed timestamptz, p_cbd date, p_total numeric, p_user uuid default 'd1000000-0000-4000-8000-00000000000d') returns void language sql as $$
  update public.table_session set closed_at = p_closed, closed_by = p_user, closed_business_date = p_cbd, receipt_type = 'scontrino',
         receipt_number = '0001-' || right(p_session::text, 4), payment_type = 'card', total = p_total where id = p_session
$$;
select pg_temp.close_s('14000000-0000-4000-8000-000000000001', '1998-11-04 22:10+00', '1998-11-04', 100.00);
select pg_temp.close_s('14000000-0000-4000-8000-000000000002', '1998-11-04 23:40+00', '1998-11-04', 35.00);
select pg_temp.close_s('14000000-0000-4000-8000-000000000003', '1998-11-05 01:20+00', '1998-11-05', 12.50);
select pg_temp.close_s('14000000-0000-4000-8000-000000000005', '1998-10-28 20:10+00', '1998-10-28', 50.00);
select pg_temp.close_s('14000000-0000-4000-8000-000000000006', '1998-11-01 20:10+00', '1998-11-01', 784.00);
select pg_temp.close_s('24000000-0000-4000-8000-000000000001', '1998-11-04 21:00+00', '1998-11-04', 999.00, 'b1000000-0000-4000-8000-00000000000b');

-- Fixed costs for November 1998 (rent 100, labour 150, utilities 50 = 300 a month; invented). 60 mapped plates sit in the 30 days before D.
insert into public.fixed_cost_period (tenant_id, month, rent, labour, utilities, created_by)
  values ('11111111-1111-4111-8111-111111111111', '1998-11-01', 100.00, 150.00, 50.00, 'a1000000-0000-4000-8000-00000000000a');

-- Stock: one location, a supplier and an invoice; receipts of 20 kg Manzo at 12,00 and 5 l olio at 8,00 on D, 3 kg Manzo at 12,00 on D - 1;
-- one kg of Manzo wasted on D (reason spoilage, at 12,00).
insert into public.location (id, tenant_id, name) values ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)');
insert into public.supplier (id, tenant_id, name, vat_number) values ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo Srl', 'IT12345678903');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id) values
  ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/e1000000-0000-4000-8000-0000000000e1.pdf', 'application/pdf', 2048, 'review', '5a000000-0000-4000-8000-00000000005a');
insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('1e000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Manzo (demo)', 'kg'),
  ('1e000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Olio (demo)', 'l');
-- A received lot: its invoice line (qty and unit price as on the paper), the lot and the receipt movement.
create function pg_temp.receive(p_n int, p_ing uuid, p_qty numeric, p_price numeric, p_on date) returns void language plpgsql as $$
declare
  v_line uuid := ('a2000000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid;
  v_lot uuid := ('a3000000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid;
begin
  insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price, line_amount, field_confidence, extracted)
    values (v_line, '11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-0000000000e1', p_n, 'Riga demo', p_qty, p_price, p_qty * p_price, '{}', '{}');
  insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code, received_on, qty_received, base_unit, source_qty, source_unit,
                              base_factor, created_by)
    select v_lot, '11111111-1111-4111-8111-111111111111', i.id, '10000000-0000-4000-8000-0000000000a1', '5a000000-0000-4000-8000-00000000005a', v_line,
           'LOT-' || p_n, p_on, p_qty, i.base_unit, p_qty, i.base_unit::text, 1, 'a1000000-0000-4000-8000-00000000000a'
      from public.ingredient i where i.id = p_ing;
  insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type, ref_id, effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', p_ing, v_lot, '10000000-0000-4000-8000-0000000000a1', 'receipt', p_qty, p_price, 'invoice_line', v_line, p_on,
            'a1000000-0000-4000-8000-00000000000a');
end
$$;
select pg_temp.receive(1, '1e000000-0000-4000-8000-000000000001', 20, 12.00, '1998-11-04');
select pg_temp.receive(2, '1e000000-0000-4000-8000-000000000002', 5, 8.00, '1998-11-04');
select pg_temp.receive(3, '1e000000-0000-4000-8000-000000000001', 3, 12.00, '1998-11-03');
insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, reason_code, ref_type, ref_id, effective_on, created_at, created_by)
  values ('11111111-1111-4111-8111-111111111111', '1e000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-0000000000a1',
          'waste', -1, 12.00, 'spoilage', 'waste_op', '5a000000-0000-4000-8000-0000000000a1', '1998-11-04', '1998-11-04T12:00+01', 'a1000000-0000-4000-8000-00000000000a');  -- A5: raw waste is read by created_at
-- The register total of D: two entries, the latest (130,00) is in force.
insert into public.day_close (tenant_id, business_date, register_total, created_at, created_by) values
  ('11111111-1111-4111-8111-111111111111', '1998-11-04', 120.00, '1998-11-05 00:30+00', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '1998-11-04', 130.00, '1998-11-05 07:00+00', 'a1000000-0000-4000-8000-00000000000a');

-- A closed table on an absolute past date (1998-09-15), for the wrapper (which uses the real now(), where any date from 1998-10-31 on is the past); it has no lines, so
-- it changes none of the figures of D and D - 7.
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_at, opened_by, business_date, created_by, updated_by) values
  ('14000000-0000-4000-8000-000000000008', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000002', 'Tavolo 2 (demo)', 3, '1998-09-15 18:00+00',
   'd1000000-0000-4000-8000-00000000000d', '1998-09-15', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d');
select pg_temp.close_s('14000000-0000-4000-8000-000000000008', '1998-09-15 20:00+00', '1998-09-15', 28.00);

-- The report of D as the owner, at 1998-11-05 09:00 local (08:00Z), before any rollup ------------------------------------------------------------
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
create temporary table rep as select app.kpi_report_json('11111111-1111-4111-8111-111111111111', 'owner', 'day', '1998-11-04', null, null, '1998-11-05 08:00+00') as j;
create function pg_temp.c(k text) returns numeric language sql as $$ select (j -> 'current' ->> k)::numeric from rep $$;
create function pg_temp.pv(k text) returns numeric language sql as $$ select (j -> 'previous' ->> k)::numeric from rep $$;

select is((select j ->> 'period' from rep), 'day', 'the reply carries the period');
select is((select array_agg(k order by k collate "C") from rep, jsonb_object_keys(j) k), array['current', 'delta', 'period', 'previous'], 'and exactly the four top-level keys');
select is((select array_agg(k order by k collate "C") from rep, jsonb_object_keys(j -> 'current') k),
          (select array_agg(k order by k collate "C") from unnest(array['appVsRegister', 'avgSpendPerCoverEur', 'avgTicketEur', 'costedRevenueNetEur', 'costedSharePct', 'coversByHour',
                'coversByWeekday', 'copertoNetEur', 'covers', 'days', 'daysFinal', 'final', 'foodCostEur', 'foodCostPct', 'from', 'plates', 'purchasesEur', 'purchasesUnvaluedCount',
                'revenueGrossEur', 'revenueNetEur', 'tables', 'to', 'uncostedRevenueNetEur', 'waste']) k),
          'a block has exactly the keys of plan §3.2');
select is((select array_agg(k order by k collate "C") from rep, jsonb_object_keys(j -> 'delta') k),
          array['appTotalEur', 'avgSpendPerCoverEur', 'avgTicketEur', 'covers', 'foodCostEur', 'foodCostPct', 'plates', 'purchasesEur', 'revenueGrossEur', 'revenueNetEur', 'tables', 'wasteEur'],
          'delta has one entry per DELTA_KEYS');

-- AT1: every KPI row except the per-item rows and AVT (plan §3.9) -----------------------------------------------------------------------------
select is(pg_temp.c('covers'), 5::numeric, 'AT1 covers 5');
select is(pg_temp.c('tables'), 2::numeric, 'tables 2');
select is(pg_temp.c('revenueGrossEur'), 135.0000::numeric, 'revenueGrossEur 135,0000');
select is(pg_temp.c('revenueNetEur'), 119.1281::numeric, 'revenueNetEur 119,1281 (110,0372 + 9,0909)');
select is(pg_temp.c('copertoNetEur'), 9.0909::numeric, 'copertoNetEur 9,0909');
select is(pg_temp.c('avgSpendPerCoverEur'), 23.8256::numeric, 'avgSpendPerCoverEur 23,8256');
select is(pg_temp.c('avgTicketEur'), 59.5641::numeric, 'avgTicketEur 59,5641');
select is(pg_temp.c('plates'), 9::numeric, 'plates 9');
select is(pg_temp.c('foodCostEur'), 21.3500::numeric, 'foodCostEur 21,3500');
select is(pg_temp.c('foodCostPct'), 29.82::numeric, 'foodCostPct 29,82 (21,35 / 71,5909: only the dishes whose cost is known)');
select is(pg_temp.c('costedRevenueNetEur'), 71.5909::numeric, 'costedRevenueNetEur 71,5909');
select is(pg_temp.c('uncostedRevenueNetEur'), 38.4463::numeric, 'uncostedRevenueNetEur 38,4463');
select is(pg_temp.c('costedSharePct'), 65.06::numeric, 'costedSharePct 65,06');
select is((select j -> 'current' -> 'coversByHour' from rep), (select jsonb_agg(case when h = 20 then 3 when h = 21 then 2 else 0 end order by h) from generate_series(0, 23) h),
          'coversByHour: hour 20 -> 3, hour 21 -> 2');
select is((select j -> 'current' -> 'coversByWeekday' from rep), '[0,0,5,0,0,0,0]'::jsonb, 'coversByWeekday (Mon-Sun): 5 on the Wednesday');
select is(pg_temp.c('purchasesEur'), 280.0000::numeric, 'purchasesEur 280,0000 (20 x 12,00 + 5 x 8,00; the receipt of D - 1 is out)');
select is(pg_temp.c('purchasesUnvaluedCount'), 0::numeric, 'no unvalued receipt');
select is((select (j -> 'current' -> 'waste' ->> 'valueEur')::numeric from rep), 12.00::numeric, 'waste 12,00');
select is((select j -> 'current' -> 'waste' -> 'reasons' from rep), '[{"reasonCode": "spoilage", "valueEur": 12.0000}]'::jsonb, 'by reason: spoilage 12,00 (the label "avariato" is the UI''s)');
select is((select j -> 'current' -> 'appVsRegister' from rep),
          '{"appTotalEur": 135.00, "registerTotalEur": 130.00, "difference": {"amount": 5.00, "pct": 3.8}, "datesWithoutRegister": []}'::jsonb,
          'app vs register: 135,00 vs 130,00 (the later entry), difference +5,00 (+3,8 %)');
select is((select array[j -> 'current' ->> 'from', j -> 'current' ->> 'to', j -> 'current' ->> 'final', j -> 'current' ->> 'daysFinal', j -> 'current' ->> 'days'] from rep),
          array['1998-11-04', '1998-11-04', 'false', '0', '1'], 'before the rollup D is not final: final false, daysFinal 0, days 1');

-- AT6: the same-weekday comparison and the deltas -------------------------------------------------------------------------------------------------
select is((select array[j -> 'previous' ->> 'from', j -> 'previous' ->> 'to'] from rep), array['1998-10-28', '1998-10-28'], 'previous is D - 7');
select is(pg_temp.pv('covers'), 2::numeric, 'previous covers 2');
select is(pg_temp.pv('revenueNetEur'), 45.4545::numeric, 'previous revenueNetEur 45,4545');
select is((select j -> 'previous' -> 'appVsRegister' from rep),
          '{"appTotalEur": 50.00, "registerTotalEur": null, "difference": null, "datesWithoutRegister": ["1998-10-28"]}'::jsonb, 'previous: no register entry -> datesWithoutRegister');
select is((select j -> 'delta' -> 'covers' from rep), '{"abs": 3, "pct": 150.0}'::jsonb, 'delta covers {3, 150,0}');
select is((select j -> 'delta' -> 'revenueNetEur' from rep), '{"abs": 73.6736, "pct": 162.1}'::jsonb, 'delta revenueNetEur {73,6736, 162,1}');
select is((select j -> 'delta' -> 'purchasesEur' from rep), '{"abs": 280.0000, "pct": null}'::jsonb, 'a previous value of 0: pct null');
select is((select j -> 'delta' -> 'foodCostPct' from rep), '{"abs": 2.54, "pct": 9.3}'::jsonb, 'foodCostPct 29,82 against 27,28 (12,40 / 45,4545 on D - 7): +2,54 points, +9,3 %');
select is((select j -> 'delta' -> 'wasteEur' from rep), '{"abs": 12.0000, "pct": null}'::jsonb, 'wasteEur: 12,00 against 0');
select is((select j -> 'delta' -> 'appTotalEur' from rep), '{"abs": 85.00, "pct": 170.0}'::jsonb, 'appTotalEur: 135,00 against 50,00');

-- Finality: the same figures before and after the rollup ---------------------------------------------------------------------------------------------
select app.rollup_daily_kpi('1998-11-05 08:00:00+00');
create temporary table rep2 as select app.kpi_report_json('11111111-1111-4111-8111-111111111111', 'owner', 'day', '1998-11-04', null, null, '1998-11-05 08:00+00') as j;
select is((select j -> 'current' ->> 'final' from rep2), 'true', 'after the rollup D is final');
select is((select array[j -> 'current' ->> 'daysFinal', j -> 'current' ->> 'days'] from rep2), array['1', '1'], 'daysFinal 1 of 1');
select is((select j #- '{current,final}' #- '{current,daysFinal}' #- '{previous,final}' #- '{previous,daysFinal}' from rep2),
          (select j #- '{current,final}' #- '{current,daysFinal}' #- '{previous,final}' #- '{previous,daysFinal}' from rep), 'the same JSON minus final and daysFinal');
create temporary table repw as select app.kpi_report_json('11111111-1111-4111-8111-111111111111', 'owner', 'week', '1998-11-04', null, null, '1998-11-05 08:00+00') as j;
select is((select array[j -> 'current' ->> 'from', j -> 'current' ->> 'to', j -> 'previous' ->> 'from', j -> 'previous' ->> 'to'] from repw),
          array['1998-11-02', '1998-11-08', '1998-10-26', '1998-11-01'], 'week of D: 1998-11-02..08 against 1998-10-26..11-01');
select is((select (j -> 'current' ->> 'daysFinal')::int < (j -> 'current' ->> 'days')::int from repw), true, 'a week that contains today is not entirely final');
select is((select (j -> 'current' ->> 'covers')::int from repw), 7, 'the week holds the 5 covers of D and the 2 of T3 (business date 11-05); the 56 plates of 11-01 are in the previous week');
select is((select (j -> 'previous' ->> 'plates')::numeric from repw), 60::numeric, 'and the previous week (10-26..11-01) holds the 60 plates');

-- Periods (app.kpi_period) --------------------------------------------------------------------------------------------------------------------------
create function pg_temp.per(p_period text, p_date date, p_from date, p_to date, p_now timestamptz default '1998-11-05 08:00+00') returns text language sql as $$
  select (from_d, to_d, cmp_from, cmp_to)::text from app.kpi_period('11111111-1111-4111-8111-111111111111', p_period, p_date, p_from, p_to, p_now)
$$;
select is(pg_temp.per('day', '1998-11-04', null, null), '(1998-11-04,1998-11-04,1998-10-28,1998-10-28)', 'day: D against D - 7');
select is(pg_temp.per('month', '1999-03-15', null, null, '1999-04-01 12:00+00'), '(1999-03-01,1999-03-31,1999-02-01,1999-02-28)', 'month of 1999-03-15 against February');
select is(pg_temp.per('custom', null, '1998-11-01', '1998-11-07', '1998-11-10 08:00+00'), '(1998-11-01,1998-11-07,1998-10-25,1998-10-31)', 'custom 7 days against the 7 days before');
select is(pg_temp.per('day', null, null, null), '(1998-11-04,1998-11-04,1998-10-28,1998-10-28)', 'no date: yesterday''s business date of p_now');
select is(pg_temp.per('week', '1998-11-08', null, null, '1998-11-10 08:00+00'), '(1998-11-02,1998-11-08,1998-10-26,1998-11-01)', 'week: a Sunday belongs to its own ISO week');
select is(pg_temp.per('custom', null, '1997-11-05', '1998-11-04'), '(1997-11-05,1998-11-04,1996-11-05,1997-11-04)', 'custom 365 days');
select is(pg_temp.err($$select pg_temp.per('custom', null, '1997-11-04', '1998-11-04')$$), 'ok', '366 days are accepted (boundary)');
select is(pg_temp.err($$select pg_temp.per('custom', null, '1997-11-03', '1998-11-04')$$), 'P0001 range_too_long', '367 days: range_too_long');
select is(pg_temp.err($$select pg_temp.per('custom', null, '1998-11-04', '1998-11-03')$$), 'P0001 range_invalid', 'from after to: range_invalid');
select is(pg_temp.err($$select pg_temp.per('custom', null, '1998-11-04', null)$$), 'P0001 range_invalid', 'custom without to: range_invalid');
select is(pg_temp.err($$select pg_temp.per('day', '1998-11-06', null, null)$$), 'P0001 date_in_future', 'the day after today''s business date: date_in_future');
select is(pg_temp.err($$select pg_temp.per('day', '1998-11-05', null, null)$$), 'ok', 'today''s business date is accepted (live)');
select is(pg_temp.err($$select pg_temp.per('custom', null, '1998-11-01', '1998-11-06')$$), 'P0001 date_in_future', 'a custom range that ends after today: date_in_future');
select is(pg_temp.err($$select pg_temp.per('week', '1998-11-09', null, null)$$), 'P0001 date_in_future', 'a week anchored in the future: date_in_future');
select is(pg_temp.err($$select pg_temp.per('year', null, null, null)$$), '22023 invalid_request', 'an unknown period: 22023');
select is(pg_temp.per('day', null, null, null, '1998-11-05 00:30+00'), '(1998-11-03,1998-11-03,1998-10-27,1998-10-27)',
          'at 01:30 local on 11-05 the business date is still 11-04 (the cut-off is 02:00 local = 01:00Z), so yesterday is 11-03');

-- Purchases: two paths ---------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.c('purchasesEur'), (select sum(il.qty * il.unit_price) from public.invoice_line il join public.stock_movement m on m.tenant_id = il.tenant_id and m.ref_id = il.id
                                        where m.type = 'receipt' and m.effective_on = '1998-11-04'), 'purchasesEur equals the sum of qty x unit price of the invoice lines received on D');
select is(left(pg_temp.err($$insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type, ref_id, effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', '1e000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-0000000000a1', 'receipt', 1, null,
          'invoice_line', 'a2000000-0000-4000-8000-000000000003', '1998-11-04', 'a1000000-0000-4000-8000-00000000000a')$$), 5), '23514',
          'a receipt without a unit cost cannot exist (stock_movement_receipt_ck), so purchasesUnvaluedCount stays 0');
select is((select unvalued from app.kpi_purchases('11111111-1111-4111-8111-111111111111', '1998-11-01', '1998-11-30')), 0, 'kpi_purchases: unvalued 0');
select is((select value from app.kpi_purchases('11111111-1111-4111-8111-111111111111', '1998-11-03', '1998-11-04')), 316.0000::numeric, 'kpi_purchases over D - 1..D: 36 + 280');
select is((select value from app.kpi_purchases('22222222-2222-4222-8222-222222222222', '1998-11-01', '1998-11-30')), 0::numeric, 'tenant B has no purchase');

-- Waste ---------------------------------------------------------------------------------------------------------------------------------------------
select is((select (j -> 'current' -> 'waste' ->> 'valueEur')::numeric from rep), (public.waste_costs('1998-11-04', '1998-11-04') ->> 'valueEur')::numeric, 'the waste block equals public.waste_costs(D, D)');
select is((select j -> 'previous' -> 'waste' from rep), '{"valueEur": 0, "unvaluedCount": 0, "reasons": []}'::jsonb, 'no waste on D - 7');

-- Register range --------------------------------------------------------------------------------------------------------------------------------
select is(app.kpi_register_range('11111111-1111-4111-8111-111111111111', '1998-10-28', '1998-11-04'),
          '{"appTotalEur": 969.00, "registerTotalEur": 130.00, "difference": {"amount": 5.00, "pct": 3.8}, "datesWithoutRegister": ["1998-10-28", "1998-11-01"]}'::jsonb,
          'over 10-28..11-04: app 969,00, register 130,00; the difference is like for like (only the dates with a register entry); 10-28 and 11-01 have none');
select is(app.kpi_register_range('11111111-1111-4111-8111-111111111111', '1998-11-04', '1998-11-04') -> 'datesWithoutRegister', '[]'::jsonb, 'D has an entry');
insert into public.day_close (tenant_id, business_date, register_total, created_at, created_by)
  values ('11111111-1111-4111-8111-111111111111', '1998-10-28', 0.00, '1998-10-29 07:00+00', 'a1000000-0000-4000-8000-00000000000a');
select is(app.kpi_register_range('11111111-1111-4111-8111-111111111111', '1998-10-28', '1998-10-28') -> 'difference', '{"amount": 50.00, "pct": null}'::jsonb,
          'a register total of 0: the percentage is null');

-- The wrapper -------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is((public.kpi_report('day', '1998-09-15', null, null) -> 'current' ->> 'covers')::int, 3, 'public.kpi_report as owner A with real claims answers (fixture shifted to a past date)');
select is((public.kpi_report('day', '1998-09-15', null, null) -> 'current' ->> 'revenueGrossEur')::numeric, 28.0000::numeric, 'with its totals');
select is(public.kpi_report('day', '1998-09-15', null, null) -> 'current' -> 'foodCostPct', 'null'::jsonb, 'and a null food cost % (no costed line: unknown is never zero)');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is((public.kpi_report('day', '1998-09-15', null, null) -> 'current' ->> 'covers')::int, 3, 'the admin reads it too');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.err($$select public.kpi_report('day', null, null, null)$$), '42501 permission denied: the day close needs owner or admin', 'the chef: 42501');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(pg_temp.err($$select public.kpi_report('day', null, null, null)$$), '42501 permission denied: the day close needs owner or admin', 'the waiter: 42501');
select set_config('request.jwt.claims', '', true);
select is(pg_temp.err($$select public.kpi_report('day', null, null, null)$$), '42501 permission denied: the day close needs owner or admin', 'no claims: 42501');
select is((select has_function_privilege('authenticated', 'public.kpi_report(text, date, date, date)', 'execute')), true, 'authenticated can execute kpi_report');
select is((select bool_or(has_function_privilege(r, 'public.kpi_report(text, date, date, date)', 'execute')) from unnest(array['anon', 'service_role']) r), false, 'anon and service_role cannot');
select is((select bool_or(has_function_privilege(r, f, 'execute')) from unnest(array['anon', 'authenticated', 'service_role']) r,
            unnest(array['app.kpi_period(uuid, text, date, date, date, timestamptz)', 'app.kpi_range_agg(uuid, date, date)', 'app.kpi_purchases(uuid, date, date)',
                         'app.kpi_register_range(uuid, date, date)', 'app.kpi_report_json(uuid, text, text, date, date, date, timestamptz)']) f), false,
          'no API role executes the app.* report functions');

-- Tenancy ----------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
create temporary table repb as select app.kpi_report_json('22222222-2222-4222-8222-222222222222', 'owner', 'day', '1998-11-04', null, null, '1998-11-05 08:00+00') as j;
select is((select array[(j -> 'current' ->> 'covers')::numeric, (j -> 'current' ->> 'revenueGrossEur')::numeric, (j -> 'current' ->> 'plates')::numeric, (j -> 'current' ->> 'purchasesEur')::numeric] from repb),
          array[2, 999, 1, 0]::numeric[], 'owner B''s report on D: 999,00 and none of A''s figures');
select is((select (j -> 'current' -> 'waste' ->> 'valueEur')::numeric from repb), 0::numeric, 'B has no waste (A''s 12,00 stays out)');

select * from finish();
