-- Comanda per uscita, step 1 (docs/plans/2026-11-18-comanda-uscite.md section 5 step 1; platform plan 6.5 rule 5): G, the tenant #1 golden outputs.
-- A tenant-#1-shaped FAKE fixture, inserted as table owner with fixed ids and fixed instants (nothing here reads the clock; every
-- instant is in 1998, the fakes' year, and the business date is fixed, so the hashes never depend on today). Same technique as 389: the md5
-- of the jsonb text of each output, taken on main BEFORE any uscita change, over an explicit list of today's columns (so a new column
-- such as order_line.uscita cannot move a pin by existing). It passes on main by design, and must stay green and UNCHANGED through step 25:
-- the only claim it makes is that comanda-per-uscita changes nothing for a closed session and nothing about the ledgers of a fixture that
-- has no uscita. The fixture is inserted after the migrations ran, so M5's one-time migration of open sessions never touches it.
--   Closed sessions: S1 (scontrino, card): lines in four courses (antipasti, primi, secondi, bevande), one stew line fired by "Invia a
--   seguire" (segue true), one stew line voided after fire (returned: reversal + waste), one raw-ingredient line voided after fire
--   (returned: stock reversal + waste), one draft voided entry_removed; done and closed kitchen events. S2 (fattura, cash): two fired lines.
--   Open session S3: drafts with segue false and true, a fired antipasto, a fired segue secondo, a fired drink, a closed ticket.
-- Pinned: the closed-session order_line rows; app.session_bill_json of a closed and of the open session; app.app_vs_register_json;
--   app.kpi_sales_lines and app.kpi_items_json('owner') for the day; app.forecast_portion_lines; the tenant's stock_movement,
--   batch_movement, order_line_cost and kitchen_event rows; public.trace_order_line of one closed line as owner; ledger_checks_body empty.
-- The proof that the pins can fail is the mutation block at the end: one closed line's qty changes (as table owner) and its md5 differs.
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-g@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-g@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-g@example.test');
insert into public.tenant (id, name, vat_number, settings) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo G', 'IT00000000000', '{"sale_vat_pct": 10}');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo');

create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role, 'aal', 'aal1')::text, true)
$$;

-- Master data: one location, one supplier, one raw ingredient (a lot received on an invoice line), a stew batch recipe and two plates.
insert into public.location (id, tenant_id, name) values ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)');
insert into public.supplier (id, tenant_id, name, vat_number) values ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo Srl', 'IT12345678903');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id) values
  ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/1998/e1000000-0000-4000-8000-0000000000e1.pdf', 'application/pdf', 2048, 'review', '5a000000-0000-4000-8000-00000000005a');
insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price, line_amount, field_confidence, extracted) values
  ('a2000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-0000000000e1', 1, 'Farina demo', 10, 1.20, 12.00, '{}', '{}');
insert into public.ingredient (id, tenant_id, name, base_unit, is_stock) values
  ('1e000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Farina (demo)', 'kg', true);
insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code, expiry, received_on, qty_received, base_unit,
                            source_qty, source_unit, base_factor, created_at, created_by) values
  ('3c000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '1e000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-0000000000a1',
   '5a000000-0000-4000-8000-00000000005a', 'a2000000-0000-4000-8000-000000000001', 'FARINA1', '1999-01-01', '1998-11-03', 10, 'kg', 10, 'kg', 1,
   '1998-11-03 08:00+00', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'spezzatino (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e2', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'spezzatino con polenta (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e3', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'tagliatelle al ragù (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch, shelf_life_hours, created_by) values
  ('ed000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e1', 1, '1998-10-01T00:00Z',
   'Spezzatino (demo)', 6, 'kg', 30, 72, 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by) values
  ('ed000000-0000-4000-8000-0000000000d2', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e2', 1, '1998-10-01T00:00Z',
   'Spezzatino con polenta (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ed000000-0000-4000-8000-0000000000d3', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e3', 1, '1998-10-01T00:00Z',
   'Tagliatelle al ragù (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, sub_recipe_key, qty, unit, yield_factor, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d2', 1, null, 'ec000000-0000-4000-8000-0000000000e1', 1, 'porz', 1, 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d3', 1, '1e000000-0000-4000-8000-000000000001', null, 0.1, 'kg', 1, 'a1000000-0000-4000-8000-00000000000a');
insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code, lot_seq, produced_at, produced_by, output_qty,
                          output_unit, portions_computed, portions_initial, shelf_life_hours, use_by, state, location_id, created_by) values
  ('ba000000-0000-4000-8000-0000000000b1', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e1', 'ed000000-0000-4000-8000-0000000000d1', 1,
   '981103-SPEZZA-1', '1998-11-03', 'SPEZZA', 1, '1998-11-03T08:00Z', 'c1000000-0000-4000-8000-00000000000c', 6, 'kg', 30, 30, 72, '1998-11-06T08:00Z', 'open',
   '10000000-0000-4000-8000-0000000000a1', 'c1000000-0000-4000-8000-00000000000c');
insert into public.batch_cost (batch_id, tenant_id, total_cost, unit_cost_frozen, incomplete, cost_at, created_at, created_by) values
  ('ba000000-0000-4000-8000-0000000000b1', '11111111-1111-4111-8111-111111111111', 75.00, 2.50, false, '1998-11-03T08:00Z', '1998-11-03T08:00Z', 'c1000000-0000-4000-8000-00000000000c');

-- Menu (seven items as 389; the stew and the tagliatelle are mapped to their plates) and the coperto.
insert into public.menu_item (id, tenant_id, name, category, course_default, position, recipe_key, created_by, updated_by) values
  ('31000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Spezzatino con polenta (demo)', 'Secondi', 'secondi', 2, 'ec000000-0000-4000-8000-0000000000e2', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('31000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Tagliatelle al ragù (demo)', 'Primi', 'primi', 1, 'ec000000-0000-4000-8000-0000000000e3', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('31000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Acqua (demo)', 'Bevande', 'bevande', 5, null, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('31000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'Vino rosso (demo)', 'Bevande', 'bevande', 6, null, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('31000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'Pane (demo)', 'Contorni', 'antipasti', 3, null, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('31000000-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', 'Dolce del giorno (demo)', 'Dolci', 'dolci', 4, null, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.menu_item_price (tenant_id, menu_item_id, price, vat_rate, valid_from, created_by) values
  ('11111111-1111-4111-8111-111111111111', '31000000-0000-4000-8000-000000000001', 14.00, 10, '1998-01-01 00:00+00', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '31000000-0000-4000-8000-000000000002', 12.50, 10, '1998-01-01 00:00+00', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '31000000-0000-4000-8000-000000000003', 2.00, 22, '1998-01-01 00:00+00', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '31000000-0000-4000-8000-000000000004', 40.25, 22, '1998-01-01 00:00+00', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '31000000-0000-4000-8000-000000000005', 1.50, 4, '1998-01-01 00:00+00', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '31000000-0000-4000-8000-000000000006', 6.00, 5, '1998-01-01 00:00+00', 'a1000000-0000-4000-8000-00000000000a');
insert into public.sale_settings (tenant_id, coperto_amount, coperto_vat_rate, created_by, updated_by, created_at, updated_at)
  values ('11111111-1111-4111-8111-111111111111', 2.50, 10, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a', '1998-01-01 00:00+00', '1998-01-01 00:00+00');

-- Three tables: 1 and 2 closed on 1998-11-04, 3 open.
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by)
  select ('33000000-0000-4000-8000-00000000000' || n)::uuid, '11111111-1111-4111-8111-111111111111', 'Tavolo ' || n || ' (demo)', n,
         'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a' from generate_series(1, 3) n;
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_at, opened_by, business_date, coperto_amount, coperto_vat_rate, created_by, updated_by)
  select ('34000000-0000-4000-8000-00000000000' || n)::uuid, '11111111-1111-4111-8111-111111111111', ('33000000-0000-4000-8000-00000000000' || n)::uuid,
         'Tavolo ' || n || ' (demo)', case n when 1 then 3 else 2 end, '1998-11-04 18:30+00', 'd1000000-0000-4000-8000-00000000000d', '1998-11-04',
         2.50, 10, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'
    from generate_series(1, 3) n;

-- Order lines: fixed ids and instants. p_state: fired | voided (fired, then voided with p_reason) | draft | draft_voided (never fired).
create function pg_temp.addl(p_n int, p_session int, p_item int, p_course public.course, p_qty numeric, p_price numeric, p_vat numeric, p_segue boolean,
                             p_state text, p_reason text default null) returns void language sql as $$
  insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, segue, unit_price, vat_rate, price_source, is_shared,
                                 client_updated_at, created_at, updated_at, created_by, updated_by, fired_at, fired_by, voided_at, voided_by, void_reason)
  values (('35000000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid, '11111111-1111-4111-8111-111111111111',
          ('34000000-0000-4000-8000-00000000000' || p_session)::uuid, ('31000000-0000-4000-8000-00000000000' || p_item)::uuid, p_course, p_qty, p_segue, p_price, p_vat, 'menu', false,
          '1998-11-04 18:45+00', '1998-11-04 18:45+00'::timestamptz + p_n * interval '1 minute', '1998-11-04 18:45+00'::timestamptz + p_n * interval '1 minute',
          'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d',
          case when p_state in ('fired', 'voided') then '1998-11-04 19:00+00'::timestamptz + p_n * interval '1 minute' end,
          case when p_state in ('fired', 'voided') then 'd1000000-0000-4000-8000-00000000000d'::uuid end,
          case when p_state in ('voided', 'draft_voided') then '1998-11-04 19:00+00'::timestamptz + p_n * interval '1 minute' + interval '30 seconds' end,
          case when p_state in ('voided', 'draft_voided') then 'd1000000-0000-4000-8000-00000000000d'::uuid end,
          case when p_state in ('voided', 'draft_voided') then p_reason end)
$$;
-- S1 (closed): antipasto, two tagliatelle, a stew sent "a seguire", a stew returned, a tagliatelle returned, a draft removed, a wine.
select pg_temp.addl(1, 1, 5, 'antipasti', 2, 1.50, 4, false, 'fired');
select pg_temp.addl(2, 1, 2, 'primi', 2, 12.50, 10, false, 'fired');
select pg_temp.addl(3, 1, 1, 'secondi', 1, 14.00, 10, true, 'fired');
select pg_temp.addl(4, 1, 1, 'secondi', 1, 14.00, 10, false, 'voided', 'returned');
select pg_temp.addl(5, 1, 6, 'dolci', 1, 6.00, 5, false, 'draft_voided', 'entry_removed');
select pg_temp.addl(6, 1, 4, 'bevande', 1, 40.25, 22, false, 'fired');
select pg_temp.addl(7, 1, 2, 'primi', 1, 12.50, 10, false, 'voided', 'returned');
-- S2 (closed): two stews and a dessert.
select pg_temp.addl(8, 2, 1, 'secondi', 2, 14.00, 10, false, 'fired');
select pg_temp.addl(9, 2, 6, 'dolci', 1, 6.00, 5, false, 'fired');
-- S3 (open): two drafts (segue false and true), a fired antipasto, a fired segue secondo, a fired drink.
select pg_temp.addl(10, 3, 1, 'secondi', 1, 14.00, 10, false, 'draft');
select pg_temp.addl(11, 3, 6, 'dolci', 1, 6.00, 5, true, 'draft');
select pg_temp.addl(12, 3, 5, 'antipasti', 1, 1.50, 4, false, 'fired');
select pg_temp.addl(13, 3, 1, 'secondi', 1, 14.00, 10, true, 'fired');
select pg_temp.addl(14, 3, 3, 'bevande', 1, 2.00, 22, false, 'fired');
-- Closing, as the procedure's final UPDATE does.
update public.table_session set closed_at = '1998-11-04 21:00+00', closed_by = 'd1000000-0000-4000-8000-00000000000d', closed_business_date = '1998-11-04',
       receipt_type = 'scontrino', receipt_number = '0012-0034', payment_type = 'card', total = 89.75 where id = '34000000-0000-4000-8000-000000000001';
update public.table_session set closed_at = '1998-11-04 21:05+00', closed_by = 'd1000000-0000-4000-8000-00000000000d', closed_business_date = '1998-11-04',
       receipt_type = 'fattura', payment_type = 'cash', total = 39.00 where id = '34000000-0000-4000-8000-000000000002';
insert into public.day_close (tenant_id, business_date, register_total, created_at, created_by)
  values ('11111111-1111-4111-8111-111111111111', '1998-11-04', 128.75, '1998-11-04 22:00+00', 'a1000000-0000-4000-8000-00000000000a');

-- Frozen costs: every fired line has one row (the unmapped items have none of a recipe: incomplete, no amounts).
create function pg_temp.cost(p_n int, p_recipe uuid, p_total numeric, p_unit numeric) returns void language sql as $$
  insert into public.order_line_cost (order_line_id, tenant_id, recipe_id, total_cost, unit_cost_at_sale, incomplete, cost_at, created_at, created_by)
  values (('35000000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid, '11111111-1111-4111-8111-111111111111', p_recipe, p_total, p_unit,
          p_recipe is null, '1998-11-04 19:00+00'::timestamptz + p_n * interval '1 minute', '1998-11-04 19:00+00'::timestamptz + p_n * interval '1 minute',
          'd1000000-0000-4000-8000-00000000000d')
$$;
select pg_temp.cost(1, null, null, null);
select pg_temp.cost(2, 'ed000000-0000-4000-8000-0000000000d3', 0.24, 0.12);
select pg_temp.cost(3, 'ed000000-0000-4000-8000-0000000000d2', 2.50, 2.50);
select pg_temp.cost(4, 'ed000000-0000-4000-8000-0000000000d2', 2.50, 2.50);
select pg_temp.cost(6, null, null, null);
select pg_temp.cost(7, 'ed000000-0000-4000-8000-0000000000d3', 0.12, 0.12);
select pg_temp.cost(8, 'ed000000-0000-4000-8000-0000000000d2', 5.00, 2.50);
select pg_temp.cost(9, null, null, null);
select pg_temp.cost(12, null, null, null);
select pg_temp.cost(13, 'ed000000-0000-4000-8000-0000000000d2', 2.50, 2.50);
select pg_temp.cost(14, null, null, null);

-- Stock ledger: the receipt of the lot, the raw consumption of the tagliatelle, and the returned tagliatelle (consumption, mirrored reversal, waste).
insert into public.stock_movement (id, tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, reason_code, ref_type, ref_id, reverses_id, effective_on, created_at, created_by) values
  ('5b000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '1e000000-0000-4000-8000-000000000001', '3c000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-0000000000a1', 'receipt', 10, 1.20, null, 'invoice_line', 'a2000000-0000-4000-8000-000000000001', null, '1998-11-03', '1998-11-03 08:00+00', 'a1000000-0000-4000-8000-00000000000a'),
  ('5b000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', '1e000000-0000-4000-8000-000000000001', '3c000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-0000000000a1', 'consumption', -0.2, 1.20, null, 'order_line', '35000000-0000-4000-8000-000000000002', null, '1998-11-04', '1998-11-04 19:02+00', 'd1000000-0000-4000-8000-00000000000d'),
  ('5b000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', '1e000000-0000-4000-8000-000000000001', '3c000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-0000000000a1', 'consumption', -0.1, 1.20, null, 'order_line', '35000000-0000-4000-8000-000000000007', null, '1998-11-04', '1998-11-04 19:07+00', 'd1000000-0000-4000-8000-00000000000d');
insert into public.stock_movement (id, tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, reason_code, ref_type, ref_id, reverses_id, effective_on, created_at, created_by) values
  ('5b000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', '1e000000-0000-4000-8000-000000000001', '3c000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-0000000000a1', 'consumption', 0.1, 1.20, null, 'order_void', '35000000-0000-4000-8000-000000000007', '5b000000-0000-4000-8000-000000000003', '1998-11-04', '1998-11-04 19:07+00', 'd1000000-0000-4000-8000-00000000000d'),
  ('5b000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', '1e000000-0000-4000-8000-000000000001', '3c000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-0000000000a1', 'waste', -0.1, 1.20, 'plating_error', 'order_void', '35000000-0000-4000-8000-000000000007', null, '1998-11-04', '1998-11-04 19:07+00', 'd1000000-0000-4000-8000-00000000000d');
-- Batch ledger: the production, the stew portions served (L3, L4, L8, L13) and the returned stew (reversal + waste).
insert into public.batch_movement (id, tenant_id, batch_id, type, portions, reason_code, ref_type, ref_id, reverses_id, effective_on, created_at, created_by) values
  ('bb000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'ba000000-0000-4000-8000-0000000000b1', 'produce', 30, null, 'batch', 'ba000000-0000-4000-8000-0000000000b1', null, '1998-11-03', '1998-11-03 08:00+00', 'c1000000-0000-4000-8000-00000000000c'),
  ('bb000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'ba000000-0000-4000-8000-0000000000b1', 'consume', -1, null, 'order_line', '35000000-0000-4000-8000-000000000003', null, '1998-11-04', '1998-11-04 19:03+00', 'd1000000-0000-4000-8000-00000000000d'),
  ('bb000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'ba000000-0000-4000-8000-0000000000b1', 'consume', -1, null, 'order_line', '35000000-0000-4000-8000-000000000004', null, '1998-11-04', '1998-11-04 19:04+00', 'd1000000-0000-4000-8000-00000000000d'),
  ('bb000000-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', 'ba000000-0000-4000-8000-0000000000b1', 'consume', -2, null, 'order_line', '35000000-0000-4000-8000-000000000008', null, '1998-11-04', '1998-11-04 19:08+00', 'd1000000-0000-4000-8000-00000000000d'),
  ('bb000000-0000-4000-8000-000000000007', '11111111-1111-4111-8111-111111111111', 'ba000000-0000-4000-8000-0000000000b1', 'consume', -1, null, 'order_line', '35000000-0000-4000-8000-000000000013', null, '1998-11-04', '1998-11-04 19:13+00', 'd1000000-0000-4000-8000-00000000000d');
insert into public.batch_movement (id, tenant_id, batch_id, type, portions, reason_code, ref_type, ref_id, reverses_id, effective_on, created_at, created_by) values
  ('bb000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'ba000000-0000-4000-8000-0000000000b1', 'consume', 1, null, 'order_void', '35000000-0000-4000-8000-000000000004', 'bb000000-0000-4000-8000-000000000003', '1998-11-04', '1998-11-04 19:04+00', 'd1000000-0000-4000-8000-00000000000d'),
  ('bb000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'ba000000-0000-4000-8000-0000000000b1', 'waste', -1, 'plating_error', 'order_void', '35000000-0000-4000-8000-000000000004', null, '1998-11-04', '1998-11-04 19:04+00', 'd1000000-0000-4000-8000-00000000000d');
-- Kitchen events: done, undone and done again for the "seguire" stew of S1; a done antipasto; S1's ticket closed by the auto-close; S3's antipasti ticket closed by a tap.
insert into public.kitchen_event (id, tenant_id, subject, action, cause, order_line_id, table_session_id, fired_at, course, segue, created_at, created_by) values
  ('4e000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'line', 'done', 'tap', '35000000-0000-4000-8000-000000000001', null, null, null, null, '1998-11-04 19:20+00', 'c1000000-0000-4000-8000-00000000000c'),
  ('4e000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'line', 'done', 'tap', '35000000-0000-4000-8000-000000000003', null, null, null, null, '1998-11-04 19:25+00', 'c1000000-0000-4000-8000-00000000000c'),
  ('4e000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'line', 'undone', 'tap', '35000000-0000-4000-8000-000000000003', null, null, null, null, '1998-11-04 19:26+00', 'c1000000-0000-4000-8000-00000000000c'),
  ('4e000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'line', 'done', 'tap', '35000000-0000-4000-8000-000000000003', null, null, null, null, '1998-11-04 19:27+00', 'c1000000-0000-4000-8000-00000000000c'),
  ('4e000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'ticket', 'closed', 'auto', null, '34000000-0000-4000-8000-000000000001', '1998-11-04 19:01+00', 'antipasti', false, '1998-11-04 21:00+00', 'c1000000-0000-4000-8000-00000000000c'),
  ('4e000000-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', 'ticket', 'closed', 'tap', null, '34000000-0000-4000-8000-000000000003', '1998-11-04 19:12+00', 'antipasti', false, '1998-11-04 19:30+00', 'c1000000-0000-4000-8000-00000000000c');

-- Sanity on the fixture, so a failing pin below has a readable cause.
select is((select count(*)::int from public.order_line where tenant_id = '11111111-1111-4111-8111-111111111111'), 14, 'fixture: fourteen order lines');
select is((select string_agg(state || ':' || count, ',' order by state) from (select state, count(*) from public.order_line group by state) s), 'draft:2,fired:9,voided:3',
  'fixture: two drafts, nine fired, three voided (two returned after fire, one draft removed)');
select is((select count(*)::int from public.table_session where closed_at is not null), 2, 'fixture: two closed sessions and one open');
select is((select count(*)::int from public.order_line_cost), 11, 'fixture: eleven frozen costs, one per fired line and per returned line');
select is((select count(*)::int from public.order_line l where l.fired_at is not null and not exists (select 1 from public.order_line_cost c where c.order_line_id = l.id)), 0,
  'fixture: every fired line has its frozen cost');

create temp table g (k text primary key, j jsonb not null);
-- The closed-session order_line rows over an explicit list of today's columns (none of a future one).
insert into g select 'closed_lines', jsonb_agg(to_jsonb(x) order by x.id)
  from (select l.id, l.tenant_id, l.table_session_id, l.menu_item_id, l.course, l.qty, l.segue, l.note, l.is_shared, l.unit_price, l.vat_rate, l.price_source,
               l.client_updated_at, l.created_at, l.created_by, l.updated_at, l.updated_by, l.fired_at, l.fired_by, l.voided_at, l.voided_by, l.void_reason, l.state,
               l.weight_g, l.price_per_100g, l.portion_weight_g
          from public.order_line l join public.table_session s on s.tenant_id = l.tenant_id and s.id = l.table_session_id
         where l.tenant_id = '11111111-1111-4111-8111-111111111111' and s.closed_at is not null) x;
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
insert into g select 'bill_open', app.session_bill_json('11111111-1111-4111-8111-111111111111', '34000000-0000-4000-8000-000000000003', null);
insert into g select 'bill_closed', app.session_bill_json('11111111-1111-4111-8111-111111111111', '34000000-0000-4000-8000-000000000001', null);
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
insert into g select 'day_report', app.app_vs_register_json('11111111-1111-4111-8111-111111111111', '1998-11-04') - 'asOf';
insert into g select 'kpi_sales_lines', jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text) from app.kpi_sales_lines('11111111-1111-4111-8111-111111111111', '1998-11-04', '1998-11-04') r;
insert into g select 'kpi_items', app.kpi_items_json('11111111-1111-4111-8111-111111111111', 'owner', 'day', '1998-11-04', null, null, '1998-11-05 08:00+00');
insert into g select 'forecast_lines', jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text) from app.forecast_portion_lines('11111111-1111-4111-8111-111111111111', array['1998-11-04']::date[]) r;
-- The ledgers and the frozen costs of the fixture tenant, every column of today's tables, in a fixed order.
insert into g select 'stock_movement', jsonb_agg(to_jsonb(x) order by x.id)
  from (select id, tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, reason_code, ref_type, ref_id, reverses_id, effective_on, created_at, created_by
          from public.stock_movement where tenant_id = '11111111-1111-4111-8111-111111111111') x;
insert into g select 'batch_movement', jsonb_agg(to_jsonb(x) order by x.id)
  from (select id, tenant_id, batch_id, type, portions, reason_code, ref_type, ref_id, reverses_id, effective_on, created_at, created_by
          from public.batch_movement where tenant_id = '11111111-1111-4111-8111-111111111111') x;
insert into g select 'order_line_cost', jsonb_agg(to_jsonb(x) order by x.order_line_id)
  from (select order_line_id, tenant_id, recipe_id, total_cost, unit_cost_at_sale, incomplete, missing_ingredient_ids, missing_batch_ids, unbooked_batch_keys, cost_at, created_at, created_by
          from public.order_line_cost where tenant_id = '11111111-1111-4111-8111-111111111111') x;
insert into g select 'kitchen_event', jsonb_agg(to_jsonb(x) order by x.id)
  from (select id, tenant_id, subject, action, cause, order_line_id, table_session_id, fired_at, course, segue, created_at, created_by
          from public.kitchen_event where tenant_id = '11111111-1111-4111-8111-111111111111') x;
insert into g select 'trace_line', public.trace_order_line('35000000-0000-4000-8000-000000000003');

-- The pins (md5 of the jsonb text), taken on main before any uscita change.
select is((select md5(j::text) from g where k = 'closed_lines'), 'a0b1f5b4b2190d03352e2a96ff4e2651', 'G: the closed-session order_line rows (explicit column list)');
select is((select md5(j::text) from g where k = 'bill_closed'), '5ca3c58de44aa240c3b35d2604061438', 'G: session_bill_json of the closed session S1');
select is((select md5(j::text) from g where k = 'bill_open'), 'fcd251e014d3cb34982054fddddc3db8', 'G: session_bill_json of the open session S3');
select is((select md5(j::text) from g where k = 'day_report'), '251abfa18855826d7e0cbe7983c94569', 'G: app_vs_register_json without asOf');
select is((select md5(j::text) from g where k = 'kpi_sales_lines'), 'df2b25134c65236e3c13400e9c1efe8f', 'G: kpi_sales_lines of the day');
select is((select md5(j::text) from g where k = 'kpi_items'), '32f443ae009d7a5354b8b5d114fc1f27', 'G: kpi_items_json(owner) of the day');
select is((select md5(j::text) from g where k = 'forecast_lines'), '87e217556fd315c7f1f237b4e0d08076', 'G: forecast_portion_lines of the day');
select is((select md5(j::text) from g where k = 'stock_movement'), '860e54832fd31fd2c538e8c8750d362c', 'G: the fixture tenant''s stock_movement rows');
select is((select md5(j::text) from g where k = 'batch_movement'), 'c53afdb4992c727a8f6c88ef27bf6152', 'G: the fixture tenant''s batch_movement rows');
select is((select md5(j::text) from g where k = 'order_line_cost'), 'f86471946a8e896ec27805084aaca862', 'G: the fixture tenant''s order_line_cost rows');
select is((select md5(j::text) from g where k = 'kitchen_event'), '32f6106a82694cdae1a32596dfec2bf8', 'G: the fixture tenant''s kitchen_event rows');
select is((select md5(j::text) from g where k = 'trace_line'), 'ab6e7d8e2414037726f6581c53fbfb8d', 'G: trace_order_line of a closed line as owner');
select is((select count(*)::int from app.ledger_checks_body('11111111-1111-4111-8111-111111111111', '1998-11-05 08:00+00')), 0, 'G: ledger_checks_body is empty');

-- Readable anchors next to the hashes.
select is((select (j ->> 'total')::numeric from g where k = 'bill_closed'), 89.75, 'the closed bill of S1 totals 89,75');
select is((select jsonb_array_length(j) from g where k = 'closed_lines'), 9, 'nine lines belong to the two closed sessions');

-- Mutation: one closed line's qty changes (as table owner) and its md5 must leave the pin. This is what proves the pin can fail.
reset role;
alter table public.order_line disable trigger user;
update public.order_line set qty = 3 where id = '35000000-0000-4000-8000-000000000008';
select isnt((select md5(jsonb_agg(to_jsonb(x) order by x.id)::text)
               from (select l.id, l.tenant_id, l.table_session_id, l.menu_item_id, l.course, l.qty, l.segue, l.note, l.is_shared, l.unit_price, l.vat_rate, l.price_source,
                            l.client_updated_at, l.created_at, l.created_by, l.updated_at, l.updated_by, l.fired_at, l.fired_by, l.voided_at, l.voided_by, l.void_reason, l.state,
                            l.weight_g, l.price_per_100g, l.portion_weight_g
                       from public.order_line l join public.table_session s on s.tenant_id = l.tenant_id and s.id = l.table_session_id
                      where l.tenant_id = '11111111-1111-4111-8111-111111111111' and s.closed_at is not null) x),
            (select md5(j::text) from g where k = 'closed_lines'), 'mutation: one closed line''s qty changed, the closed-lines hash differs from its pin');

select * from finish();
rollback;
