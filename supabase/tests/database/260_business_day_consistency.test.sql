-- A5b acceptance (docs/plans/2026-11-08-a5b-raw-stock-business-date.md §5 step 7, ADR-033): one night, every report agrees. Tenant A (cut-off 02:00), Manzo at 10 EUR/kg at Cella.
-- Sat 1998-11-07 12:00 monthly count O (20 = 20); receipts of 20 kg (invoice 11-06) and 5 kg (invoice 11-08); Sunday 21:00 a plate takes 1 kg; Monday 01:30 (still Sunday's business day) a raw
-- waste of 2 kg, a plate takes 0,5 kg and 3 portions of a batch frozen at 2,00 EUR are discarded; Monday 01:45 the monthly count C closes with -0,5; Monday 02:30 (Monday's business day) a raw
-- waste of 4 kg. Every row has the calendar effective_on the writers store (Monday for the night rows), created_at is the instant. stock_reconciliation, waste_costs, avt_report and
-- kpi_report_json must tell the same story for the same night, before and after the KPI rollup. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users (id, email) values ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test');
insert into public.tenant (id, name, vat_number) values ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo');
insert into public.location (id, tenant_id, name) values ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)');
insert into public.ingredient (id, tenant_id, name, base_unit, is_stock) values ('1a000000-0000-4000-8000-00000000001a', '11111111-1111-4111-8111-111111111111', 'Manzo (demo)', 'kg', true);
insert into public.supplier (id, tenant_id, name, vat_number) values ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo Srl', 'IT12345678903');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id) values
  ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/e1000000-0000-4000-8000-0000000000e1.pdf', 'application/pdf', 2048, 'review', '5a000000-0000-4000-8000-00000000005a');

create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role, 'aal', case when app_role = 'admin' then 'aal2' else 'aal1' end)::text, true)
$$;
create sequence pg_temp.line_seq;
-- A receipt of Manzo at 10 EUR/kg: effective_on is the INVOICE date (p_eff), created_at the moment it was approved (p_at).
create function pg_temp.receipt(p_qty numeric, p_eff date, p_at timestamptz) returns void language plpgsql as $$
declare
  v_n int := nextval('pg_temp.line_seq');
  v_line uuid := gen_random_uuid();
  v_lot uuid := gen_random_uuid();
begin
  insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price, line_amount, field_confidence, extracted)
    values (v_line, '11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-0000000000e1', v_n, 'Riga demo', 1, 10, 10, '{}', '{}');
  insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code, received_on, qty_received, base_unit, source_qty, source_unit, base_factor, created_by)
    values (v_lot, '11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-00000000001a', '10000000-0000-4000-8000-0000000000a1', '5a000000-0000-4000-8000-00000000005a', v_line,
            'L' || v_n, p_eff, p_qty, 'kg', p_qty, 'kg', 1, 'a1000000-0000-4000-8000-00000000000a');
  insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type, ref_id, effective_on, created_at, created_by)
    values ('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-00000000001a', v_lot, '10000000-0000-4000-8000-0000000000a1', 'receipt', p_qty, 10, 'invoice_line', v_line, p_eff, p_at,
            'a1000000-0000-4000-8000-00000000000a');
end
$$;
-- An outflow of Manzo (negative p_qty) at p_at, dated as the writers date it: effective_on is the CALENDAR date of p_at in Rome. A plate is ref_type order_line; a waste is a manual spoilage.
create function pg_temp.outflow(p_type text, p_qty numeric, p_at timestamptz, p_ref_type text) returns void language sql as $$
  insert into public.stock_movement (tenant_id, ingredient_id, location_id, type, qty, unit_cost, reason_code, ref_type, ref_id, effective_on, created_at, created_by)
  values ('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-00000000001a', '10000000-0000-4000-8000-0000000000a1', p_type::public.stock_movement_type, -p_qty, 10,
          case when p_type = 'waste' then 'spoilage' end, p_ref_type, gen_random_uuid(), (p_at at time zone 'Europe/Rome')::date, p_at, 'a1000000-0000-4000-8000-00000000000a')
$$;
-- A closed monthly count of Cella with one Manzo line, closed at p_closed.
create function pg_temp.count_session(p_id uuid, p_expected numeric, p_counted numeric, p_closed timestamptz) returns void language plpgsql as $$
begin
  insert into public.count_session (id, tenant_id, location_id, type, started_by, started_at)
    values (p_id, '11111111-1111-4111-8111-111111111111', '10000000-0000-4000-8000-0000000000a1', 'monthly', 'a1000000-0000-4000-8000-00000000000a', p_closed - interval '1 hour');
  insert into public.count_line (tenant_id, session_id, ingredient_id, position, expected_qty, counted_qty, entered_at, entered_by, created_by)
    values ('11111111-1111-4111-8111-111111111111', p_id, '1a000000-0000-4000-8000-00000000001a', 1, p_expected, p_counted, p_closed - interval '10 minutes',
            'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
  update public.count_session set status = 'closed', closed_at = p_closed, closed_by = 'a1000000-0000-4000-8000-00000000000a' where id = p_id;
end
$$;

-- The night --------------------------------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.receipt(20, '1998-11-06', '1998-11-06T10:00Z');
select pg_temp.count_session('c0de0000-0000-4000-8000-0000000000a0', 20, 20, '1998-11-07T11:00Z');
select pg_temp.receipt(5, '1998-11-08', '1998-11-08T09:00Z');
select pg_temp.outflow('consumption', 1, '1998-11-08T20:00Z', 'order_line');
select pg_temp.outflow('waste', 2, '1998-11-09T00:30Z', 'manual');
select pg_temp.outflow('consumption', 0.5, '1998-11-09T00:30Z', 'order_line');
-- A batch of 100 portions frozen at 2,00 EUR, 3 of them discarded at Monday 01:30.
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'spezzatino', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch, shelf_life_hours, created_by) values
  ('ed000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e1', 1, '1998-10-01', 'Spezzatino', 2, 'kg', 100, 48, 'a1000000-0000-4000-8000-00000000000a');
insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code, lot_seq, produced_at, produced_by, output_qty, output_unit,
    portions_computed, portions_initial, shelf_life_hours, use_by, state, location_id, created_by) values
  ('b0000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e1', 'ed000000-0000-4000-8000-0000000000d1', 1, '981108-LOT-1', '1998-11-08', 'LOT', 1,
   '1998-11-08T15:00Z', 'a1000000-0000-4000-8000-00000000000a', 2, 'kg', 100, 100, 48, '1998-11-10T15:00Z', 'fresh', '10000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-00000000000a');
insert into public.batch_cost (batch_id, tenant_id, total_cost, unit_cost_frozen, incomplete, missing_ingredient_ids, cost_at, created_by) values
  ('b0000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 200, 2.00, false, '{}', '1998-11-08T15:00Z', 'a1000000-0000-4000-8000-00000000000a');
insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_at, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'b0000000-0000-4000-8000-0000000000a1', 'produce', 100, 'batch', 'b0000000-0000-4000-8000-0000000000a1', '1998-11-08', '1998-11-08T15:00Z', 'a1000000-0000-4000-8000-00000000000a');
insert into public.batch_movement (tenant_id, batch_id, type, portions, reason_code, ref_type, ref_id, effective_on, created_at, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'b0000000-0000-4000-8000-0000000000a1', 'waste', -3, 'expired', 'batch_discard', gen_random_uuid(), '1998-11-09', '1998-11-09T00:30Z', 'a1000000-0000-4000-8000-00000000000a');
-- Monday 01:45: the monthly count C closes (system 21,5, counted 21) and its count row is posted at the same instant.
select pg_temp.count_session('c0de0000-0000-4000-8000-0000000000c0', 21.5, 21, '1998-11-09T00:45Z');
insert into public.stock_movement (tenant_id, ingredient_id, location_id, type, qty, ref_type, ref_id, effective_on, created_at, created_by) values
  ('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-00000000001a', '10000000-0000-4000-8000-0000000000a1', 'count', -0.5, 'count_session', 'c0de0000-0000-4000-8000-0000000000c0',
   '1998-11-09', '1998-11-09T00:45Z', 'a1000000-0000-4000-8000-00000000000a');
-- Monday 02:30: a raw waste of 4 kg, Monday's business day.
select pg_temp.outflow('waste', 4, '1998-11-09T01:30Z', 'manual');
-- A closed table on 11-08, so that the KPI rollup has a day to freeze.
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('13000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Tavolo 1 (demo)', 1, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_at, opened_by, business_date, coperto_amount, coperto_vat_rate, created_by, updated_by) values
  ('14000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000001', 'Tavolo 1 (demo)', 2, '1998-11-08 19:10+00',
   'a1000000-0000-4000-8000-00000000000a', '1998-11-08', null, null, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
update public.table_session set closed_at = '1998-11-08 21:10+00', closed_by = 'a1000000-0000-4000-8000-00000000000a', closed_business_date = '1998-11-08', receipt_type = 'scontrino',
       receipt_number = '0001-0001', payment_type = 'card', total = 50.00 where id = '14000000-0000-4000-8000-000000000001';

create temporary table before_reads as select count(*)::int as n from public.stock_movement;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
create function pg_temp.item(p_from date, p_to date) returns jsonb language sql as $$
  select e from jsonb_array_elements(public.stock_reconciliation(p_from, p_to) -> 'items') e where e ->> 'ingredientId' = '1a000000-0000-4000-8000-00000000001a' $$;
create function pg_temp.wc(p_from date, p_to date, p_key text) returns numeric language sql as $$ select (public.waste_costs(p_from, p_to) ->> p_key)::numeric $$;
create function pg_temp.kpi(p_day date, p_now timestamptz) returns jsonb language sql as $$
  select app.kpi_report_json('11111111-1111-4111-8111-111111111111', 'owner', 'day', p_day, null, null, p_now) -> 'current' $$;

-- C1: stock_reconciliation, Sunday ---------------------------------------------------------------------------------------------------------------------------------------
select is((select trim_scale((i ->> 'openingQty')::numeric) || '/' || trim_scale((i ->> 'receiptsQty')::numeric) || '/' || trim_scale((i ->> 'consumptionQty')::numeric) || '/'
                  || trim_scale((i ->> 'wasteQty')::numeric) || '/' || trim_scale((i ->> 'countAdjustmentsQty')::numeric) || '/' || trim_scale((i ->> 'closingQty')::numeric)
             from (select pg_temp.item('1998-11-08', '1998-11-08') i) x),
          '20/5/1.5/2/-0.5/21', 'C1 Sunday 11-08: opening 20, receipts 5, consumption 1,5 (21:00 and 01:30), waste 2, adjustments -0,5, closing 21');
select is(pg_temp.item('1998-11-08', '1998-11-08') ->> 'balanced', 'true', 'C1: balanced');
select is(pg_temp.item('1998-11-08', '1998-11-08') ->> 'countSessionId', 'c0de0000-0000-4000-8000-0000000000c0', 'C1: the count closed Monday 01:45 is Sunday''s count');
select is(pg_temp.item('1998-11-08', '1998-11-08') ->> 'matchesCount', 'true', 'C1: and Sunday''s closing (21) matches it');

-- C2: Monday ----------------------------------------------------------------------------------------------------------------------------------------------------------------------
select is((select trim_scale((i ->> 'openingQty')::numeric) || '/' || trim_scale((i ->> 'wasteQty')::numeric) || '/' || trim_scale((i ->> 'closingQty')::numeric)
             from (select pg_temp.item('1998-11-09', '1998-11-09') i) x), '21/4/17', 'C2 Monday 11-09: opening 21, waste 4 (02:30), closing 17');
select is(pg_temp.item('1998-11-09', '1998-11-09') ->> 'balanced', 'true', 'C2: balanced');

-- C3: waste_costs ----------------------------------------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.wc('1998-11-08', '1998-11-08', 'rawValueEur') || '/' || pg_temp.wc('1998-11-08', '1998-11-08', 'batchValueEur') || '/' || pg_temp.wc('1998-11-08', '1998-11-08', 'valueEur'),
          '20.0000/6.0000/26.0000', 'C3 Sunday: raw 20 (2 kg at 10) + batch 6 (3 portions at 2,00) = 26');
select is(pg_temp.wc('1998-11-09', '1998-11-09', 'rawValueEur'), 40::numeric, 'C3 Monday: raw 40 (the 02:30 waste of 4 kg)');

-- C4: avt_report(C) ---------------------------------------------------------------------------------------------------------------------------------------------------------------
create function pg_temp.avt() returns jsonb language sql as $$
  select e from jsonb_array_elements(public.avt_report('c0de0000-0000-4000-8000-0000000000c0') -> 'rows') e where e ->> 'ingredientId' = '1a000000-0000-4000-8000-00000000001a' $$;
select is((pg_temp.avt() ->> 'wasteQty')::numeric, (pg_temp.item('1998-11-08', '1998-11-08') ->> 'wasteQty')::numeric, 'C4: AVT''s waste of Manzo equals the reconciliation''s waste of the same night (2)');
select is((pg_temp.avt() ->> 'actualQty')::numeric, 4::numeric, 'C4: AVT''s actual is 4 (1 + 0,5 consumed, 2 wasted, 0,5 count loss); the 02:30 waste is out');
select is((pg_temp.avt() ->> 'actualQty')::numeric,
          (select (i ->> 'consumptionQty')::numeric + (i ->> 'wasteQty')::numeric - (i ->> 'countAdjustmentsQty')::numeric from (select pg_temp.item('1998-11-07', '1998-11-08') i) x),
          'C4: and it equals consumption + waste - adjustments of stock_reconciliation(11-07, 11-08)');

-- C5: kpi_report_json, now 1998-11-12 09:00Z --------------------------------------------------------------------------------------------------------------------------------------
select is((pg_temp.kpi('1998-11-08', '1998-11-12T09:00Z') -> 'waste' ->> 'valueEur')::numeric, pg_temp.wc('1998-11-08', '1998-11-08', 'valueEur'), 'C5 day 11-08: the KPI waste (26) is the waste report''s');
select is((pg_temp.kpi('1998-11-08', '1998-11-12T09:00Z') ->> 'purchasesEur')::numeric, 50::numeric, 'C5 day 11-08: purchases 50 (5 kg at 10, by invoice date)');
select is((pg_temp.kpi('1998-11-09', '1998-11-12T09:00Z') -> 'waste' ->> 'valueEur')::numeric, 40::numeric, 'C5 day 11-09: waste 40');
select is((pg_temp.kpi('1998-11-09', '1998-11-12T09:00Z') ->> 'purchasesEur')::numeric, 0::numeric, 'C5 day 11-09: purchases 0');

-- C6: after the rollup the day is final and the live figures are unchanged -------------------------------------------------------------------------------------------------
select is(pg_temp.kpi('1998-11-08', '1998-11-12T09:00Z') ->> 'final', 'false', 'C6: before the rollup day 11-08 is not final');
select is(app.rollup_daily_kpi('1998-11-12T09:00Z') > 0, true, 'C6: the rollup freezes the days');
select is(pg_temp.kpi('1998-11-08', '1998-11-12T09:00Z') ->> 'final' || '/' || (pg_temp.kpi('1998-11-08', '1998-11-12T09:00Z') -> 'waste' ->> 'valueEur') || '/' || (pg_temp.kpi('1998-11-08', '1998-11-12T09:00Z') ->> 'purchasesEur'),
          'true/26.0000/50.0000', 'C6: day 11-08 is final and waste 26 and purchases 50 are unchanged');

-- C7: nothing was written -------------------------------------------------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from public.stock_movement where created_at in ('1998-11-09T00:30Z', '1998-11-09T01:30Z') and effective_on = '1998-11-09'), 3, 'C7: the three night rows (01:30 waste and plate, 02:30 waste) still hold the calendar effective_on 1998-11-09');
select is((select count(*)::int from public.stock_movement), (select n from before_reads), 'C7: the ledger holds the same number of rows after every read');

select * from finish();
rollback;
