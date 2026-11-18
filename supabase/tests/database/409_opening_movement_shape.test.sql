-- Opening stock, steps 3 and 4 (docs/plans/2026-11-18-opening-stock.md §3.1, §5 steps 3-4): the movement type `opening` and the shape CHECK stock_movement_opening_ck. Nothing writes an
-- opening row yet; this file writes them as the table owner to prove the CHECK, the mirror guard and the append-only triggers. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);


insert into auth.users (id, email) values ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test');
insert into public.tenant (id, name, vat_number) values ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo');
insert into public.location (id, tenant_id, name) values ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Dispensa (demo)');
insert into public.ingredient (id, tenant_id, name, base_unit, is_stock) values
  ('1a000000-0000-4000-8000-00000000001a', '11111111-1111-4111-8111-111111111111', 'Farina 00 (demo)', 'kg', true);
insert into public.supplier (id, tenant_id, name, vat_number) values ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore X (demo)', 'IT12345678903');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, original_filename) values
  ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/e1000000-0000-4000-8000-0000000000e1.pdf', 'application/pdf', 2048, 'fattura.pdf');
insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price, line_amount, field_confidence, extracted) values
  ('a2000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-0000000000e1', 1, 'Farina', 5, 1, 5, '{}', '{}');
insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code, received_on, qty_received, base_unit, source_qty, source_unit, base_factor, created_by) values
  ('10700000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-00000000001a', '10000000-0000-4000-8000-0000000000a1',
   '5a000000-0000-4000-8000-00000000005a', 'a2000000-0000-4000-8000-0000000000a1', 'L-001', '2026-10-20', 5, 'kg', 5, 'kg', 1, 'a1000000-0000-4000-8000-00000000000a');

-- One insert as the table owner (a fixture): 'ok', or "SQLSTATE constraint-or-message". Every argument that the shape depends on is a parameter, so a case reads as one line.
create function pg_temp.put(p_id uuid, p_type text, p_qty numeric, p_cost numeric, p_ref_type text, p_lot uuid default null, p_reason text default null, p_reverses uuid default null)
  returns text language plpgsql as $$
declare
  state text;
  msg text;
  cons text;
begin
  insert into public.stock_movement (id, tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, reason_code, ref_type, ref_id, reverses_id, effective_on, created_by)
    values (p_id, '11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-00000000001a', p_lot, '10000000-0000-4000-8000-0000000000a1', p_type::public.stock_movement_type,
            p_qty, p_cost, p_reason, p_ref_type, gen_random_uuid(), p_reverses, '2026-12-01', 'a1000000-0000-4000-8000-00000000000a');
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text, cons = constraint_name;
  return state || ' ' || coalesce(nullif(cons, ''), msg);
end
$$;
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
create function pg_temp.n_opening() returns int language sql as $$ select count(*)::int from public.stock_movement where type::text = 'opening' $$;

-- Step 3: the enum -------------------------------------------------------------------------------------------------------------------------------------------------
select is((select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = 'public.stock_movement_type'::regtype),
  'receipt,consumption,waste,transfer,count,opening', 'the enum labels in order are receipt,consumption,waste,transfer,count,opening');

-- Step 4: the shape CHECK stock_movement_opening_ck ------------------------------------------------------------------------------------------------------------------
-- Accepted: a carico row (qty 2 at 0,80, ref_type opening, no lot, no reason), and the same at cost 0 (spec 3.4, "merce senza costo").
select is(pg_temp.put('0a000000-0000-4000-8000-0000000000a1', 'opening', 2, 0.8, 'opening'), 'ok', 'an opening row with qty 2, unit_cost 0.8, ref_type opening, no lot is accepted');
select is(pg_temp.put('0a000000-0000-4000-8000-0000000000a2', 'opening', 2, null, 'opening'), '23514 stock_movement_opening_ck', 'the same row with unit_cost null is refused with stock_movement_opening_ck');
select is(pg_temp.put('0a000000-0000-4000-8000-0000000000a3', 'opening', 2, 0, 'opening'), 'ok', 'unit_cost 0 is accepted (a typed 0,00 EUR is a statement, null is not)');
-- Refused (23514, by the opening check itself).
select is(pg_temp.put('0a000000-0000-4000-8000-0000000000a4', 'opening', -1, 0.8, 'opening'), '23514 stock_movement_opening_ck', 'qty -1 without reverses_id is refused');
-- qty 0 breaks two CHECKs (the ledger's stock_movement_qty_check and the opening one), and which one Postgres reports first is not a contract. So: the row is refused by one of them,
-- and, with stock_movement_qty_check dropped inside a block that is rolled back, the opening check refuses it on its own.
select ok(pg_temp.put('0a000000-0000-4000-8000-0000000000a5', 'opening', 0, 0.8, 'opening') in ('23514 stock_movement_opening_ck', '23514 stock_movement_qty_check'),
  'qty 0 is refused (23514, by the opening check or by the ledger''s own stock_movement_qty_check)');
create function pg_temp.put_without_qty_check() returns text language plpgsql as $$
declare
  v text;
begin
  begin
    alter table public.stock_movement drop constraint stock_movement_qty_check;
    v := pg_temp.put('0a000000-0000-4000-8000-0000000000a5', 'opening', 0, 0.8, 'opening');
    raise exception 'scenario_rollback' using errcode = 'RB001';
  exception when sqlstate 'RB001' then
    null;
  end;
  return v;
end
$$;
select is(pg_temp.put_without_qty_check(), '23514 stock_movement_opening_ck', 'and without stock_movement_qty_check, the opening check alone refuses qty 0');
select ok(exists (select 1 from pg_constraint where conname = 'stock_movement_qty_check' and conrelid = 'public.stock_movement'::regclass), 'stock_movement_qty_check is back (the block was rolled back)');
select is(pg_temp.put('0a000000-0000-4000-8000-0000000000a6', 'opening', 2, 0.8, 'opening', '10700000-0000-4000-8000-0000000000a1'), '23514 stock_movement_opening_ck', 'a row with a lot set is refused (carico stock is unlotted)');
select is(pg_temp.put('0a000000-0000-4000-8000-0000000000a7', 'opening', 2, 0.8, 'opening', null, 'spoilage'), '23514 stock_movement_opening_ck', 'a row with a reason code is refused');
select is(pg_temp.put('0a000000-0000-4000-8000-0000000000a8', 'opening', 2, 0.8, 'manual'), '23514 stock_movement_opening_ck', 'ref_type manual is refused');
select is(pg_temp.put('0a000000-0000-4000-8000-0000000000a9', 'opening', 2, -0.01, 'opening'), '23514 stock_movement_opening_ck', 'unit_cost -0.01 is refused');
select is(pg_temp.put('0a000000-0000-4000-8000-0000000000b1', 'opening', 2, 0.8, 'reversal'), '23514 stock_movement_opening_ck', 'ref_type reversal without reverses_id is refused');
select is(pg_temp.put('0a000000-0000-4000-8000-0000000000b2', 'consumption', -1, 0.8, 'opening'), '23514 stock_movement_opening_ck', 'a consumption borrowing ref_type opening is refused');
select is(pg_temp.put('0a000000-0000-4000-8000-0000000000b3', 'waste', -1, 0.8, 'opening', null, 'spoilage'), '23514 stock_movement_opening_ck', 'a waste borrowing ref_type opening is refused');
select is(pg_temp.n_opening(), 2, 'only the two accepted opening rows exist so far');

-- Mirror rows (reversals). The mirror guard is a BEFORE INSERT trigger, so it answers before the CHECK does.
select is(pg_temp.put('0a000000-0000-4000-8000-0000000000c1', 'opening', -2, 0.9, 'reversal', null, null, '0a000000-0000-4000-8000-0000000000a1'), 'P0001 reversal_mismatch', 'a mirror at unit_cost 0.9 is refused by the guard (reversal_mismatch)');
select is(pg_temp.put('0a000000-0000-4000-8000-0000000000c2', 'opening', 2, 0.8, 'reversal', null, null, '0a000000-0000-4000-8000-0000000000a1'), 'P0001 reversal_mismatch', 'a mirror with qty +2 is refused by the guard (reversal_mismatch), which runs before the CHECK');
-- With the guard switched off inside this rolled-back test, the CHECK refuses the same row on its own: reverses_id set needs qty < 0.
alter table public.stock_movement disable trigger stock_movement_reversal_guard;
select is(pg_temp.put('0a000000-0000-4000-8000-0000000000c3', 'opening', 2, 0.8, 'reversal', null, null, '0a000000-0000-4000-8000-0000000000a1'), '23514 stock_movement_opening_ck', 'with the guard off, the CHECK refuses a mirror with qty +2 on its own (23514)');
select is(pg_temp.put('0a000000-0000-4000-8000-0000000000c4', 'opening', -2, 0.8, 'opening', null, null, '0a000000-0000-4000-8000-0000000000a1'), '23514 stock_movement_opening_ck', 'with the guard off, the CHECK refuses a mirror whose ref_type is opening (a mirror is ref_type reversal)');
alter table public.stock_movement enable trigger stock_movement_reversal_guard;
select is((select tgenabled::text from pg_trigger where tgname = 'stock_movement_reversal_guard' and tgrelid = 'public.stock_movement'::regclass), 'O', 'the guard is switched on again');
select is(pg_temp.put('0a000000-0000-4000-8000-0000000000c5', 'opening', -2, 0.8, 'reversal', null, null, '0a000000-0000-4000-8000-0000000000a1'), 'ok', 'an exact mirror (-2, 0.8, ref_type reversal, reverses_id) is accepted');
select is(pg_temp.put('0a000000-0000-4000-8000-0000000000c6', 'opening', -2, 0.8, 'reversal', null, null, '0a000000-0000-4000-8000-0000000000a1'), '23505 stock_movement_reverses_uq', 'a second mirror of the same row is refused by stock_movement_reverses_uq');
select is(pg_temp.put('0a000000-0000-4000-8000-0000000000c7', 'opening', -2, 0.8, 'reversal', null, null, '0a000000-0000-4000-8000-0000000000c5'), 'P0001 reversal_mismatch', 'a mirror of a mirror is refused by the guard');
select is((select sum(qty) from public.stock_movement where type::text = 'opening' and ingredient_id = '1a000000-0000-4000-8000-00000000001a'), 2::numeric, 'balance: the accepted rows (2, 2 at cost 0, -2) sum to 2');

-- Append-only: UPDATE and DELETE of an opening row are refused, like every ledger row.
select is(pg_temp.err($$ update public.stock_movement set qty = 3 where id = '0a000000-0000-4000-8000-0000000000a1' $$), 'P0001 append_only', 'UPDATE of an opening row is refused (append_only)');
select is(pg_temp.err($$ delete from public.stock_movement where id = '0a000000-0000-4000-8000-0000000000a1' $$), 'P0001 append_only', 'DELETE of an opening row is refused (append_only)');
select is(pg_temp.n_opening(), 3, 'and the three rows that were accepted (two cariche and one mirror) are still there');

select * from finish();
rollback;
