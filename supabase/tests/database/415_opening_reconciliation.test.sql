-- Opening stock, step 11 (docs/plans/2026-11-18-opening-stock.md §3.8, §5 step 11): the reconciliation folds opening rows into openingQty by their effective_on (the "Data del
-- carico"), never into receiptsQty or otherQty, and the mirror rows of a correction (dated with the original's date) fold the same way. A period with no opening row is read
-- exactly as before (pgTAP 114, 259 and G's reconciliation pin in 407). The rows are written here as the table owner with fixed instants, so the posting day (created_at) differs
-- from the carico date. Fake data only; dates in 1998 (no date near the real clock).
begin;
create extension if not exists pgtap with schema extensions;
set local timezone = 'UTC';
select plan(10);

insert into auth.users (id, email) values ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test');
insert into public.tenant (id, name, vat_number) values ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Dispensa (demo)'),
  ('10000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'Frigo 1 (demo)');
insert into public.ingredient (id, tenant_id, name, base_unit, is_stock) values
  ('1a000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Farina 00 (demo)', 'kg', true);
insert into public.supplier (id, tenant_id, name, vat_number) values ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore X (demo)', 'IT12345678903');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id) values
  ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/e1000000-0000-4000-8000-0000000000e1.pdf', 'application/pdf', 2048, 'review', '5a000000-0000-4000-8000-00000000005a');
insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price, line_amount, field_confidence, extracted) values
  ('a2000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-0000000000e1', 1, 'Farina', 10, 1, 10, '{}', '{}');
insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code, received_on, qty_received, base_unit, source_qty, source_unit, base_factor, created_by) values
  ('10700000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-0000000000a1',
   '5a000000-0000-4000-8000-00000000005a', 'a2000000-0000-4000-8000-0000000000a1', 'L-001', '1998-12-03', 10, 'kg', 10, 'kg', 1, 'a1000000-0000-4000-8000-00000000000a');
-- A carico of 25 kg at Dispensa dated 1 Dec, posted on 5 Dec; a receipt of 10 kg dated 3 Dec (posted on 4 Dec).
insert into public.stock_movement (id, tenant_id, ingredient_id, location_id, type, qty, unit_cost, ref_type, ref_id, effective_on, created_at, created_by) values
  ('0a000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-0000000000a1',
   'opening', 25, 0.8, 'opening', '0e000000-0000-4000-8000-000000000001', '1998-12-01', '1998-12-05 12:00+00', 'a1000000-0000-4000-8000-00000000000a');
insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type, ref_id, effective_on, created_at, created_by) values
  ('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-000000000001', '10700000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
   'receipt', 10, 1, 'invoice_line', 'a2000000-0000-4000-8000-0000000000a1', '1998-12-03', '1998-12-04 09:00+00', 'a1000000-0000-4000-8000-00000000000a');

create function pg_temp.act_as() returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
    'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'owner', 'aal', 'aal1')::text, true)
$$;
-- Farina's row of the reconciliation, as "opening|receipts|other|closing|balanced", or '-' when it has no row.
create function pg_temp.rec(p_from date, p_to date, p_loc text default '10000000-0000-4000-8000-0000000000a1') returns text language sql as $$
  select coalesce((select (e ->> 'openingQty')::numeric::text || '|' || (e ->> 'receiptsQty')::numeric::text || '|' || (e ->> 'otherQty')::numeric::text || '|'
                          || (e ->> 'closingQty')::numeric::text || '|' || (e ->> 'balanced')
                     from jsonb_array_elements(public.stock_reconciliation(p_from, p_to, p_loc::uuid) -> 'items') e
                    where e ->> 'ingredientId' = '1a000000-0000-4000-8000-000000000001'), '-')
$$;
grant execute on function pg_temp.rec(date, date, text) to authenticated;
set local role authenticated;
select pg_temp.act_as();

select is(pg_temp.rec('1998-12-01', '1998-12-05'), '25.0000|10.0000|0|35.0000|true',
  'a 25 kg carico at Dispensa dated 1 Dec and posted on 5 Dec is in openingQty of the 1-5 Dec report, otherQty is 0 and balanced is true (the receipt stays in receiptsQty)');
select is(pg_temp.rec('1998-11-20', '1998-11-30'), '-', 'the 20-30 Nov report does not include it (dated after the period)');
select is(pg_temp.rec('1998-12-02', '1998-12-05'), '25.0000|10.0000|0|35.0000|true', 'the 2-5 Dec report includes it in openingQty (dated before the period)');
select is(pg_temp.rec('1998-12-01', '1998-12-01'), '25.0000|0|0|25.0000|true', 'the report of 1 Dec alone: openingQty 25, and receiptsQty never includes the carico');
select is(pg_temp.rec('1998-12-01', '1998-12-05', '10000000-0000-4000-8000-0000000000a2'), '-', 'Frigo 1''s report does not include Dispensa''s carico');
reset role;

-- A correction: the mirror (dated with the original's date, posted on 6 Dec) and a rebooking at 24 kg (dated 1 Dec, posted on 6 Dec).
insert into public.stock_movement (tenant_id, ingredient_id, location_id, type, qty, unit_cost, ref_type, ref_id, reverses_id, effective_on, created_at, created_by) values
  ('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-0000000000a1',
   'opening', -25, 0.8, 'reversal', '0f000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000001', '1998-12-01', '1998-12-06 10:00+00', 'a1000000-0000-4000-8000-00000000000a');
insert into public.stock_movement (tenant_id, ingredient_id, location_id, type, qty, unit_cost, ref_type, ref_id, effective_on, created_at, created_by) values
  ('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-0000000000a1',
   'opening', 24, 0.8, 'opening', '0e000000-0000-4000-8000-000000000002', '1998-12-01', '1998-12-06 10:05+00', 'a1000000-0000-4000-8000-00000000000a');
set local role authenticated;
select pg_temp.act_as();
select is(pg_temp.rec('1998-12-01', '1998-12-05'), '24.0000|10.0000|0|34.0000|true', 'after a reversal and a rebooking at 24 kg, the 1-5 Dec report''s openingQty nets to 24');
select is(pg_temp.rec('1998-12-06', '1998-12-06'), '34.0000|0|0|34.0000|true', 'and the day of the correction shows no movement of its own (otherQty 0)');
reset role;

-- The shape and the comment.
select is((select count(*)::int || '|' || bool_and(p.prosecdef)::text || '|' || bool_and(p.proconfig = array['search_path=""'])::text
                  || '|' || bool_and(has_function_privilege('authenticated', p.oid, 'execute'))::text
                  || '|' || bool_or(has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))::text
             from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'stock_reconciliation'), '1|true|true|true|false',
  'stock_reconciliation: one definition, a definer with an empty search_path, executable by authenticated only (grants restated)');
select ok(col_description('public.stock_movement'::regclass, (select attnum from pg_attribute where attrelid = 'public.stock_movement'::regclass and attname = 'effective_on')::int)
          like 'Receipt and opening:%', 'the column comment of stock_movement.effective_on names opening rows');
set local role authenticated;
select pg_temp.act_as();
select is((select string_agg(k, ',' order by k) from jsonb_object_keys((select e from jsonb_array_elements(
             public.stock_reconciliation('1998-12-01', '1998-12-05', '10000000-0000-4000-8000-0000000000a1') -> 'items') e limit 1)) k),
  'afterCountQty,balanced,baseUnit,closingQty,consumptionQty,countAdjustmentsQty,countSessionId,countedAt,countedQty,ingredientId,matchesCount,name,openingQty,otherQty,receiptsQty,transfersInQty,transfersOutQty,wasteQty',
  'the item keys are unchanged (the TS schema, the CSV export and the screen need no change)');
reset role;

select * from finish();
rollback;
