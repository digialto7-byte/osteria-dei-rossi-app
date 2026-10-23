-- M12 step 1: movement types, the per-type shape checks, the waste reason codes and the reversal guard
-- (M12 plan §3.1.2, §3.2; ADR-011). Fake data only. Rows are inserted as the migration owner, as 031 does.
begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

insert into auth.users (id, email) values ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)'),
  ('10000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'Freezer (demo)');
insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('1a000000-0000-4000-8000-00000000001a', '11111111-1111-4111-8111-111111111111', 'Manzo muscolo (demo)', 'kg'),
  ('1b000000-0000-4000-8000-00000000001b', '11111111-1111-4111-8111-111111111111', 'Farina di mais (demo)', 'kg');
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo Srl', 'IT12345678903');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, original_filename)
  values ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
          '11111111-1111-4111-8111-111111111111/2026/e1000000-0000-4000-8000-0000000000e1.pdf',
          'application/pdf', 2048, 'fattura.pdf');
insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price,
                                 line_amount, field_confidence, extracted) values
  ('a2000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111',
   'e1000000-0000-4000-8000-0000000000e1', 1, 'Manzo fesa', 5, 10, 50, '{}', '{}'),
  ('a2000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111',
   'e1000000-0000-4000-8000-0000000000e1', 2, 'Manzo girello', 5, 10, 50, '{}', '{}');
insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code,
    expiry, received_on, qty_received, base_unit, source_qty, source_unit, base_factor, created_by) values
  ('10700000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111',
   '1a000000-0000-4000-8000-00000000001a', '10000000-0000-4000-8000-0000000000a1',
   '5a000000-0000-4000-8000-00000000005a', 'a2000000-0000-4000-8000-0000000000a1', 'L-001',
   '2026-11-10', '2026-10-20', 5, 'kg', 5, 'kg', 1, 'a1000000-0000-4000-8000-00000000000a'),
  ('10700000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111',
   '1a000000-0000-4000-8000-00000000001a', '10000000-0000-4000-8000-0000000000a1',
   '5a000000-0000-4000-8000-00000000005a', 'a2000000-0000-4000-8000-0000000000a2', 'L-002',
   '2026-11-12', '2026-10-20', 5, 'kg', 5, 'kg', 1, 'a1000000-0000-4000-8000-00000000000a');
insert into public.stock_movement (id, tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost,
    ref_type, ref_id, effective_on, created_by) values
  ('0e000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
   '1a000000-0000-4000-8000-00000000001a', '10700000-0000-4000-8000-0000000000a1',
   '10000000-0000-4000-8000-0000000000a1', 'receipt', 5, 10, 'invoice_line',
   'a2000000-0000-4000-8000-0000000000a1', '2026-10-20', 'a1000000-0000-4000-8000-00000000000a');

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

-- One movement of tenant A. The defaults make a valid waste of lot L-001 at Cella; each case changes one thing.
create function pg_temp.mv(
  p_type text, p_qty numeric, p_reason text default null, p_ref_type text default 'manual',
  p_ref_id uuid default gen_random_uuid(), p_cost numeric default null, p_rev uuid default null,
  p_lot uuid default '10700000-0000-4000-8000-0000000000a1',
  p_loc uuid default '10000000-0000-4000-8000-0000000000a1',
  p_ing uuid default '1a000000-0000-4000-8000-00000000001a',
  p_id uuid default gen_random_uuid()
) returns uuid language sql as $$
  insert into public.stock_movement (id, tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost,
      reason_code, ref_type, ref_id, reverses_id, effective_on, created_by)
    values (p_id, '11111111-1111-4111-8111-111111111111', p_ing, p_lot, p_loc, p_type::public.stock_movement_type,
      p_qty, p_cost, p_reason, p_ref_type, p_ref_id, p_rev, '2026-10-23', 'a1000000-0000-4000-8000-00000000000a')
  returning id
$$;

-- Enum and reason codes ---------------------------------------------------------------------------------
select is((select string_agg(e.enumlabel, ',' order by e.enumsortorder)
             from pg_enum e where e.enumtypid = 'public.stock_movement_type'::regtype),
  'receipt,consumption,waste,transfer,count', 'the movement types, in order');
select is(app.stock_reason_codes(),
  array['spoilage', 'expired', 'over_production', 'plating_error', 'staff_meal', 'comp', 'breakage', 'count_correction'],
  'the eight waste reason codes, in order');

-- Shapes ------------------------------------------------------------------------------------------------
select alike(pg_temp.err($$ select pg_temp.mv('consumption', 1) $$),
  '23514%stock_movement_outflow_sign_ck%', 'a consumption of +1 without reverses_id is refused');
select alike(pg_temp.err($$ select pg_temp.mv('waste', 1, 'spoilage') $$),
  '23514%stock_movement_outflow_sign_ck%', 'a waste of +1 without reverses_id is refused');
select alike(pg_temp.err($$ select pg_temp.mv('waste', -1) $$),
  '23514%stock_movement_reason_ck%', 'a waste without a reason is refused');
select alike(pg_temp.err($$ select pg_temp.mv('waste', -1, 'foo') $$),
  '23514%stock_movement_reason_ck%', 'a waste with reason foo is refused');
select alike(pg_temp.err($$ select pg_temp.mv('consumption', -1, 'spoilage') $$),
  '23514%stock_movement_reason_ck%', 'a consumption with a reason is refused');
select is(pg_temp.err($$ select pg_temp.mv('waste', -0.0001, c) from unnest(app.stock_reason_codes()) c $$), 'ok',
  'each of the eight reason codes is accepted on a waste');
select alike(pg_temp.err($$ select pg_temp.mv('consumption', -1, p_ref_id => null) $$),
  '23514%stock_movement_ref_ck%', 'a consumption without ref_id is refused');
select alike(pg_temp.err($$ select pg_temp.mv('waste', -1, 'spoilage', p_ref_id => null) $$),
  '23514%stock_movement_ref_ck%', 'a waste without ref_id is refused');
select alike(pg_temp.err($$ select pg_temp.mv('consumption', -1, p_ref_type => 'Bad-Type') $$),
  '23514%stock_movement_ref_ck%', 'ref_type Bad-Type is refused');
select alike(pg_temp.err($$ select pg_temp.mv('consumption', -1, p_ref_type => null) $$),
  '23514%stock_movement_ref_ck%', 'a non-receipt without ref_type is refused');
select alike(pg_temp.err($$ select pg_temp.mv('transfer', -1, p_ref_type => 'transfer', p_cost => 1) $$),
  '23514%stock_movement_transfer_ck%', 'a transfer with a unit_cost is refused');
select alike(pg_temp.err($$ select pg_temp.mv('transfer', -1, p_ref_type => 'manual') $$),
  '23514%stock_movement_transfer_ck%', 'a transfer with ref_type manual is refused');
select alike(pg_temp.err($$ select pg_temp.mv('count', 1, p_ref_type => 'manual') $$),
  '23514%stock_movement_count_ck%', 'a count with ref_type manual is refused');
select is(pg_temp.err($$ select pg_temp.mv('consumption', -1, p_cost => 10) $$), 'ok', 'a valid consumption is accepted');
select is(pg_temp.err($$ select pg_temp.mv('transfer', -1, p_ref_type => 'transfer', p_ref_id => '0f000000-0000-4000-8000-000000000001'),
  pg_temp.mv('transfer', 1, p_ref_type => 'transfer', p_ref_id => '0f000000-0000-4000-8000-000000000001',
             p_loc => '10000000-0000-4000-8000-0000000000a2') $$), 'ok', 'a valid pair of transfer legs is accepted');
select is(pg_temp.err($$ select pg_temp.mv('count', 2, p_ref_type => 'count_session') $$), 'ok',
  'a valid count row is accepted');
select is(pg_temp.err($$ select pg_temp.mv('waste', -1, 'spoilage', p_lot => null) $$), 'ok',
  'a waste on the unlotted bucket (no lot) is accepted');

-- Reversal guard ----------------------------------------------------------------------------------------
select pg_temp.mv('waste', -1.5, 'spoilage', p_ref_id => '0f000000-0000-4000-8000-0000000000a1', p_cost => 10,
  p_id => '0e000000-0000-4000-8000-0000000000a1');
select is(pg_temp.err($$ select pg_temp.mv('waste', 1.5, 'spoilage', 'reversal', gen_random_uuid(), 10,
  '0e000000-0000-4000-8000-0000000000a1', p_id => '0e000000-0000-4000-8000-0000000000b1') $$), 'ok',
  'a valid mirror of a waste is accepted');
select is(pg_temp.err($$ select pg_temp.mv('waste', -1.5, 'spoilage', 'reversal', gen_random_uuid(), 10,
  '0e000000-0000-4000-8000-0000000000b1') $$), 'P0001 reversal_mismatch',
  'a mirror of a reversal is refused (a reversal is never reversed)');
select pg_temp.mv('waste', -1.5, 'spoilage', p_ref_id => '0f000000-0000-4000-8000-0000000000a2', p_cost => 10,
  p_id => '0e000000-0000-4000-8000-0000000000a2');
select is(pg_temp.err($$ select pg_temp.mv('waste', 1, 'spoilage', 'reversal', gen_random_uuid(), 10,
  '0e000000-0000-4000-8000-0000000000a2') $$), 'P0001 reversal_mismatch', 'a reversal with another qty is refused');
select is(pg_temp.err($$ select pg_temp.mv('waste', 1.5, 'spoilage', 'reversal', gen_random_uuid(), 10,
  '0e000000-0000-4000-8000-0000000000a2', p_lot => '10700000-0000-4000-8000-0000000000a2') $$),
  'P0001 reversal_mismatch', 'a reversal on another lot is refused');
select is(pg_temp.err($$ select pg_temp.mv('waste', 1.5, 'spoilage', 'reversal', gen_random_uuid(), 10,
  '0e000000-0000-4000-8000-0000000000a2', p_lot => null) $$), 'P0001 reversal_mismatch',
  'a reversal on the unlotted bucket of a lot row is refused');
select is(pg_temp.err($$ select pg_temp.mv('waste', 1.5, 'spoilage', 'reversal', gen_random_uuid(), 10,
  '0e000000-0000-4000-8000-0000000000a2', p_loc => '10000000-0000-4000-8000-0000000000a2') $$),
  'P0001 reversal_mismatch', 'a reversal at another location is refused');
select is(pg_temp.err($$ select pg_temp.mv('waste', 1.5, 'expired', 'reversal', gen_random_uuid(), 10,
  '0e000000-0000-4000-8000-0000000000a2') $$), 'P0001 reversal_mismatch', 'a reversal with another reason is refused');
select is(pg_temp.err($$ select pg_temp.mv('waste', 1.5, 'spoilage', 'reversal', gen_random_uuid(), 11,
  '0e000000-0000-4000-8000-0000000000a2') $$), 'P0001 reversal_mismatch', 'a reversal with another unit_cost is refused');
select is(pg_temp.err($$ select pg_temp.mv('waste', 1.5, 'spoilage', 'reversal', gen_random_uuid(), null,
  '0e000000-0000-4000-8000-0000000000a2') $$), 'P0001 reversal_mismatch',
  'a reversal with a null unit_cost against a costed original is refused');
select is(pg_temp.err($$ select pg_temp.mv('waste', 1.5, 'spoilage', 'reversal', gen_random_uuid(), 10,
  '0e000000-0000-4000-8000-0000000000a2', p_ing => '1b000000-0000-4000-8000-00000000001b') $$),
  'P0001 reversal_mismatch', 'a reversal for another ingredient is refused');
select is(pg_temp.err($$ select pg_temp.mv('waste', 1.5, 'spoilage', 'reversal', gen_random_uuid(), 10,
  '0e000000-0000-4000-8000-00000000dead') $$), 'P0001 reversal_mismatch', 'a reversal of a row that does not exist is refused');
select alike(pg_temp.err($$ select pg_temp.mv('receipt', -5, p_ref_type => 'invoice_line', p_cost => 10,
  p_rev => '0e000000-0000-4000-8000-0000000000e1') $$), '23514%', 'a reversal of a receipt hits the M5 check');
select pg_temp.mv('waste', 1.5, 'spoilage', 'reversal', gen_random_uuid(), 10, '0e000000-0000-4000-8000-0000000000a2');
select alike(pg_temp.err($$ select pg_temp.mv('waste', 1.5, 'spoilage', 'reversal', gen_random_uuid(), 10,
  '0e000000-0000-4000-8000-0000000000a2') $$), '23505%stock_movement_reverses_uq%',
  'a second reversal of the same row is refused by the unique index');

-- Append-only still holds for the new types -------------------------------------------------------------
select is(pg_temp.err($$ update public.stock_movement set qty = -2 where id = '0e000000-0000-4000-8000-0000000000a1' $$),
  'P0001 append_only', 'UPDATE of a waste row is refused');
select is(pg_temp.err($$ delete from public.stock_movement where id = '0e000000-0000-4000-8000-0000000000a1' $$),
  'P0001 append_only', 'DELETE of a waste row is refused');
select is(pg_temp.err($$ truncate public.stock_movement $$), 'P0001 append_only', 'TRUNCATE is refused');

-- Objects -----------------------------------------------------------------------------------------------
select has_index('public', 'stock_movement', 'stock_movement_ref_idx', 'the operation index exists');
select is((select tgenabled::text from pg_trigger where tgname = 'stock_movement_reversal_guard'
             and tgrelid = 'public.stock_movement'::regclass), 'O', 'the reversal guard trigger is enabled');
select ok(not has_function_privilege('authenticated', 'app.stock_movement_reversal_guard()', 'execute')
  and not has_function_privilege('anon', 'app.stock_movement_reversal_guard()', 'execute'),
  'no API role executes the guard function');

select * from finish();
rollback;
