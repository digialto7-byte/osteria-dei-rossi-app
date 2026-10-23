-- M14 step 1: the batch tables (M14 plan §3.2; ADR-013). batch, batch_input, batch_movement, batch_cost and the
-- view v_batch_portions: shapes, guards, append-only, RLS and grants. Rows are inserted as the migration owner, as
-- 090 does. Q16 = project V6 (founder 2026-10-23): the chef reads no batch_cost row. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(54);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111',
   'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111',
   'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)'),
  ('10000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'Dispensa (demo)');
insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('1a000000-0000-4000-8000-00000000001a', '11111111-1111-4111-8111-111111111111', 'Manzo muscolo (demo)', 'kg'),
  ('1b000000-0000-4000-8000-00000000001b', '11111111-1111-4111-8111-111111111111', 'Cipolla (demo)', 'kg');
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo Srl', 'IT12345678903');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, original_filename)
  values ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
          '11111111-1111-4111-8111-111111111111/2026/e1000000-0000-4000-8000-0000000000e1.pdf',
          'application/pdf', 2048, 'fattura.pdf');
insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price,
                                 line_amount, field_confidence, extracted) values
  ('a2000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111',
   'e1000000-0000-4000-8000-0000000000e1', 1, 'Manzo fesa', 6, 10, 60, '{}', '{}'),
  ('a2000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111',
   'e1000000-0000-4000-8000-0000000000e1', 2, 'Manzo girello', 6, 10, 60, '{}', '{}');
insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code,
    expiry, received_on, qty_received, base_unit, source_qty, source_unit, base_factor, created_by) values
  ('10700000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111',
   '1a000000-0000-4000-8000-00000000001a', '10000000-0000-4000-8000-0000000000a1',
   '5a000000-0000-4000-8000-00000000005a', 'a2000000-0000-4000-8000-0000000000a1', 'L-D2',
   '2026-10-25', '2026-10-20', 6, 'kg', 6, 'kg', 1, 'a1000000-0000-4000-8000-00000000000a'),
  ('10700000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111',
   '1a000000-0000-4000-8000-00000000001a', '10000000-0000-4000-8000-0000000000a1',
   '5a000000-0000-4000-8000-00000000005a', 'a2000000-0000-4000-8000-0000000000a2', 'L-D5',
   '2026-10-28', '2026-10-20', 6, 'kg', 6, 'kg', 1, 'a1000000-0000-4000-8000-00000000000a');
insert into public.stock_movement (id, tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost,
    ref_type, ref_id, effective_on, created_by) values
  ('0e000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
   '1a000000-0000-4000-8000-00000000001a', '10700000-0000-4000-8000-0000000000a1',
   '10000000-0000-4000-8000-0000000000a1', 'receipt', 6, 10, 'invoice_line',
   'a2000000-0000-4000-8000-0000000000a1', '2026-10-20', 'a1000000-0000-4000-8000-00000000000a');

-- Recipes: a batch (v1), a plate and a sub-recipe, each with one version.
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', 'batch', 1,
   'spezzatino (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e2', '11111111-1111-4111-8111-111111111111', 'plate', 1,
   'spezzatino con polenta (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e3', '11111111-1111-4111-8111-111111111111', 'sub', 1,
   'soffritto (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit,
                           portions_per_batch, shelf_life_hours, created_by) values
  ('ed000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111',
   'ec000000-0000-4000-8000-0000000000e1', 1, '2026-10-01T00:00Z', 'Spezzatino (demo)', 6, 'kg', 30, 72,
   'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by) values
  ('ed000000-0000-4000-8000-0000000000d2', '11111111-1111-4111-8111-111111111111',
   'ec000000-0000-4000-8000-0000000000e2', 1, '2026-10-01T00:00Z', 'Spezzatino con polenta (demo)',
   'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, created_by) values
  ('ed000000-0000-4000-8000-0000000000d3', '11111111-1111-4111-8111-111111111111',
   'ec000000-0000-4000-8000-0000000000e3', 1, '2026-10-01T00:00Z', 'Soffritto (demo)', 1, 'kg',
   'a1000000-0000-4000-8000-00000000000a');

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
-- The row count of a relation as the current role sees it; a permission error counts as 0.
create function pg_temp.seen(rel text) returns bigint language plpgsql as $$
declare
  n bigint;
begin
  execute format('select count(*) from public.%I', rel) into n;
  return n;
exception when insufficient_privilege then
  return 0;
end
$$;
grant execute on function pg_temp.act_as(uuid, uuid, text), pg_temp.err(text), pg_temp.seen(text) to authenticated;

-- One batch of tenant A. The defaults make a valid stew batch of 2026-10-23 (08:00Z, 72 h); each case changes one thing.
create function pg_temp.mkbatch(
  p_id uuid default gen_random_uuid(), p_lot_code text default '261023-SPEZZA-1', p_seq int default 1,
  p_recipe_id uuid default 'ed000000-0000-4000-8000-0000000000d1',
  p_key uuid default 'ec000000-0000-4000-8000-0000000000e1', p_initial int default 31,
  p_use_by timestamptz default '2026-10-26T08:00Z'
) returns uuid language sql as $$
  insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code,
      lot_seq, produced_at, produced_by, output_qty, output_unit, portions_computed, portions_initial,
      shelf_life_hours, use_by, location_id, created_by)
    values (p_id, '11111111-1111-4111-8111-111111111111', p_key, p_recipe_id, 1, p_lot_code, '2026-10-23', 'SPEZZA',
      p_seq, '2026-10-23T08:00Z', 'c1000000-0000-4000-8000-00000000000c', 6.2, 'kg', 31, p_initial, 72, p_use_by,
      '10000000-0000-4000-8000-0000000000a1', 'c1000000-0000-4000-8000-00000000000c')
  returning id
$$;
-- A batch_movement of tenant A (ref_id null = the batch itself).
create function pg_temp.mkmove(
  p_batch uuid, p_type text default 'produce', p_portions numeric default 31, p_ref_type text default 'batch',
  p_ref_id uuid default null, p_reason text default null
) returns uuid language sql as $$
  insert into public.batch_movement (tenant_id, batch_id, type, portions, reason_code, ref_type, ref_id, effective_on,
      created_by)
    values ('11111111-1111-4111-8111-111111111111', p_batch, p_type::public.batch_movement_type, p_portions, p_reason,
      p_ref_type, coalesce(p_ref_id, p_batch), '2026-10-23', 'c1000000-0000-4000-8000-00000000000c')
  returning id
$$;
-- A consumption movement of a batch (the raw side of a batch_input), written as the migration owner.
create function pg_temp.mkcons(
  p_ref uuid, p_qty numeric default -3, p_lot uuid default '10700000-0000-4000-8000-0000000000a1',
  p_ing uuid default '1a000000-0000-4000-8000-00000000001a',
  p_loc uuid default '10000000-0000-4000-8000-0000000000a1'
) returns uuid language sql as $$
  insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type,
      ref_id, effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', p_ing, p_lot, p_loc, 'consumption', p_qty, 10, 'batch', p_ref,
      '2026-10-23', 'c1000000-0000-4000-8000-00000000000c')
  returning id
$$;
-- A batch_input of tenant A mirroring (or not) the movement m.
create function pg_temp.mkinput(
  p_batch uuid, p_move uuid, p_qty numeric default 3, p_lot uuid default '10700000-0000-4000-8000-0000000000a1',
  p_ing uuid default '1a000000-0000-4000-8000-00000000001a',
  p_loc uuid default '10000000-0000-4000-8000-0000000000a1'
) returns uuid language sql as $$
  insert into public.batch_input (tenant_id, batch_id, ingredient_id, location_id, raw_lot_id, qty, stock_movement_id,
      created_by)
    values ('11111111-1111-4111-8111-111111111111', p_batch, p_ing, p_loc, p_lot, p_qty, p_move,
      'c1000000-0000-4000-8000-00000000000c')
  returning id
$$;
create function pg_temp.mkcost(
  p_batch uuid, p_total numeric, p_unit numeric, p_incomplete boolean, p_missing uuid[] default '{}'
) returns uuid language sql as $$
  insert into public.batch_cost (batch_id, tenant_id, total_cost, unit_cost_frozen, incomplete, missing_ingredient_ids,
      cost_at, created_by)
    values (p_batch, '11111111-1111-4111-8111-111111111111', p_total, p_unit, p_incomplete, p_missing,
      '2026-10-23T08:00Z', 'c1000000-0000-4000-8000-00000000000c')
  returning batch_id
$$;

-- Enums -------------------------------------------------------------------------------------------------
select is((select string_agg(e.enumlabel, ',' order by e.enumsortorder)
             from pg_enum e where e.enumtypid = 'public.batch_state'::regtype),
  'fresh,open,finished,discarded', 'the batch states, in order');
select is((select string_agg(e.enumlabel, ',' order by e.enumsortorder)
             from pg_enum e where e.enumtypid = 'public.batch_movement_type'::regtype),
  'produce,consume,count,waste,split', 'the batch movement types, in order');

-- A valid batch with its four child rows ------------------------------------------------------------------
select is(pg_temp.err($$ select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000b1') $$), 'ok',
  'a valid batch is accepted');
select is(pg_temp.err($$ select pg_temp.mkmove('ba000000-0000-4000-8000-0000000000b1') $$), 'ok',
  'a valid produce movement is accepted');
select pg_temp.mkcons('ba000000-0000-4000-8000-0000000000b1', -3);
select is(pg_temp.err($$ select pg_temp.mkinput('ba000000-0000-4000-8000-0000000000b1',
    (select id from public.stock_movement where ref_id = 'ba000000-0000-4000-8000-0000000000b1')) $$), 'ok',
  'a batch_input that mirrors its movement is accepted');
select is(pg_temp.err($$ select pg_temp.mkcost('ba000000-0000-4000-8000-0000000000b1', 53.5167, 1.7263, false) $$), 'ok',
  'a complete batch_cost is accepted');

-- Shapes ------------------------------------------------------------------------------------------------
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000b2', '261023-SPEZZA-2', 2);
select alike(pg_temp.err($$ select pg_temp.mkmove('ba000000-0000-4000-8000-0000000000b2', 'consume', -1) $$),
  '23514%batch_movement_m14_ck%', 'M14 allows no consume movement');
select alike(pg_temp.err($$ select pg_temp.mkmove('ba000000-0000-4000-8000-0000000000b2', 'produce', 0) $$),
  '23514%', 'a produce of 0 portions is refused');
select alike(pg_temp.err($$ select pg_temp.mkmove('ba000000-0000-4000-8000-0000000000b2', 'produce', -1) $$),
  '23514%batch_movement_m14_ck%', 'a produce of -1 portions is refused');
select alike(pg_temp.err($$ select pg_temp.mkmove('ba000000-0000-4000-8000-0000000000b1') $$),
  '23505%batch_movement_produce_uq%', 'a second produce movement for the same batch is refused');
select alike(pg_temp.err($$ select pg_temp.mkmove('ba000000-0000-4000-8000-0000000000b2', p_ref_id => gen_random_uuid()) $$),
  '23514%batch_movement_m14_ck%', 'a produce whose ref_id is not the batch is refused');
select alike(pg_temp.err($$ select pg_temp.mkmove('ba000000-0000-4000-8000-0000000000b2', p_reason => 'spoilage') $$),
  '23514%batch_movement_m14_ck%', 'a produce with a reason is refused');
select alike(pg_temp.err($$ select pg_temp.mkbatch(p_lot_code => '261023-SPEZZA-9') $$),
  '23514%batch_lot_code_ck%', 'a lot code that does not match date, code and sequence is refused');
select alike(pg_temp.err($$ select pg_temp.mkbatch() $$),
  '23505%batch_lot_code_uq%', 'two batches with the same lot code are refused');
select alike(pg_temp.err($$ select pg_temp.mkbatch(p_lot_code => '261023-SPEZZA-3', p_seq => 3,
    p_use_by => '2026-10-26T09:00Z') $$),
  '23514%batch_use_by_ck%', 'a use_by that is not produced_at plus 72 elapsed hours is refused');
select alike(pg_temp.err($$ select pg_temp.mkbatch(p_lot_code => '261023-SPEZZA-3', p_seq => 3, p_initial => 0) $$),
  '23514%', 'portions_initial 0 is refused');
select pg_temp.mkcost('ba000000-0000-4000-8000-0000000000b2', null, null, true, array['1b000000-0000-4000-8000-00000000001b']::uuid[]);
select is((select incomplete from public.batch_cost where batch_id = 'ba000000-0000-4000-8000-0000000000b2'), true,
  'an incomplete batch_cost (no total, a missing ingredient) is accepted');
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000b3', '261023-SPEZZA-3', 3);
select alike(pg_temp.err($$ select pg_temp.mkcost('ba000000-0000-4000-8000-0000000000b3', 10, 1, true,
    array['1b000000-0000-4000-8000-00000000001b']::uuid[]) $$),
  '23514%batch_cost_complete_ck%', 'an incomplete batch_cost that carries a total is refused');
select alike(pg_temp.err($$ select pg_temp.mkcost('ba000000-0000-4000-8000-0000000000b3', null, null, false) $$),
  '23514%batch_cost_complete_ck%', 'a complete batch_cost without a total is refused');
select alike(pg_temp.err($$ select pg_temp.mkcost('ba000000-0000-4000-8000-0000000000b3', null, null, true) $$),
  '23514%batch_cost_complete_ck%', 'an incomplete batch_cost without any missing ingredient is refused');

-- batch_guard -------------------------------------------------------------------------------------------
select is(pg_temp.err($$ select pg_temp.mkbatch(p_lot_code => '261023-SPEZZA-4', p_seq => 4,
    p_recipe_id => 'ed000000-0000-4000-8000-0000000000d2') $$),
  'P0001 batch_recipe_mismatch', 'a recipe_id that is a version of another key is refused');
select is(pg_temp.err($$ select pg_temp.mkbatch(p_lot_code => '261023-SPEZZA-4', p_seq => 4,
    p_recipe_id => 'ed000000-0000-4000-8000-0000000000d3', p_key => 'ec000000-0000-4000-8000-0000000000e3') $$),
  'P0001 batch_recipe_mismatch', 'a recipe key of type sub is refused');
select is(pg_temp.err($$ select pg_temp.mkbatch(p_lot_code => '261023-SPEZZA-4', p_seq => 4,
    p_recipe_id => 'ed000000-0000-4000-8000-0000000000d2', p_key => 'ec000000-0000-4000-8000-0000000000e2') $$),
  'P0001 batch_recipe_mismatch', 'a recipe key of type plate is refused');
select is(pg_temp.err($$ update public.batch set state = 'open' where id = 'ba000000-0000-4000-8000-0000000000b3' $$),
  'ok', 'the state can change (M15 procedures)');
select is(pg_temp.err($$ update public.batch set portions_initial = 30 where id = 'ba000000-0000-4000-8000-0000000000b3' $$),
  'P0001 batch_immutable', 'any other column is immutable');
select is(pg_temp.err($$ delete from public.batch where id = 'ba000000-0000-4000-8000-0000000000b3' $$),
  'P0001 append_only', 'DELETE of a batch is refused');
select is(pg_temp.err($$ truncate public.batch cascade $$), 'P0001 append_only', 'TRUNCATE of batch is refused');

-- batch_input_guard -------------------------------------------------------------------------------------
select pg_temp.mkcons('ba000000-0000-4000-8000-0000000000b3', -2, '10700000-0000-4000-8000-0000000000a2');
create temporary table mv (k text primary key, id uuid not null);
insert into mv select 'b3', id from public.stock_movement where ref_id = 'ba000000-0000-4000-8000-0000000000b3';
select is(pg_temp.err($$ select pg_temp.mkinput('ba000000-0000-4000-8000-0000000000b3', (select id from mv where k = 'b3'),
    2, '10700000-0000-4000-8000-0000000000a1') $$),
  'P0001 batch_input_mismatch', 'a batch_input on another lot than its movement is refused');
select is(pg_temp.err($$ select pg_temp.mkinput('ba000000-0000-4000-8000-0000000000b3', (select id from mv where k = 'b3'),
    2, '10700000-0000-4000-8000-0000000000a2', '1b000000-0000-4000-8000-00000000001b') $$),
  'P0001 batch_input_mismatch', 'a batch_input for another ingredient than its movement is refused');
select is(pg_temp.err($$ select pg_temp.mkinput('ba000000-0000-4000-8000-0000000000b3', (select id from mv where k = 'b3'),
    2, '10700000-0000-4000-8000-0000000000a2', p_loc => '10000000-0000-4000-8000-0000000000a2') $$),
  'P0001 batch_input_mismatch', 'a batch_input at another location than its movement is refused');
select is(pg_temp.err($$ select pg_temp.mkinput('ba000000-0000-4000-8000-0000000000b2', (select id from mv where k = 'b3'),
    2, '10700000-0000-4000-8000-0000000000a2') $$),
  'P0001 batch_input_mismatch', 'a batch_input whose movement belongs to another batch is refused');
select is(pg_temp.err($$ select pg_temp.mkinput('ba000000-0000-4000-8000-0000000000b3', (select id from mv where k = 'b3'),
    2.5, '10700000-0000-4000-8000-0000000000a2') $$),
  'P0001 batch_input_mismatch', 'a batch_input whose qty is not the movement''s negated qty is refused');
select is(pg_temp.err($$ select pg_temp.mkinput('ba000000-0000-4000-8000-0000000000b3',
    '0e000000-0000-4000-8000-0000000000e1', 6) $$),
  'P0001 batch_input_mismatch', 'a batch_input on a receipt is refused');
select is(pg_temp.err($$ select pg_temp.mkinput('ba000000-0000-4000-8000-0000000000b3', (select id from mv where k = 'b3'),
    2, '10700000-0000-4000-8000-0000000000a2') $$),
  'ok', 'the mirror row is accepted');

-- Append-only on the three child tables -------------------------------------------------------------------
select is(pg_temp.err(format($$ %s $$, s.stmt)), 'P0001 append_only', s.what)
  from (values
    ('update public.batch_input set qty = 1', 'UPDATE of batch_input is refused'),
    ('delete from public.batch_input', 'DELETE of batch_input is refused'),
    ('truncate public.batch_input cascade', 'TRUNCATE of batch_input is refused'),
    ('update public.batch_movement set portions = 1', 'UPDATE of batch_movement is refused'),
    ('delete from public.batch_movement', 'DELETE of batch_movement is refused'),
    ('truncate public.batch_movement cascade', 'TRUNCATE of batch_movement is refused'),
    ('update public.batch_cost set total_cost = 1', 'UPDATE of batch_cost is refused'),
    ('delete from public.batch_cost', 'DELETE of batch_cost is refused'),
    ('truncate public.batch_cost cascade', 'TRUNCATE of batch_cost is refused')) s (stmt, what);

-- RLS: who reads what -----------------------------------------------------------------------------------
-- The view folds the ledger: 31 portions remain for batch 1.
select is((select portions_remaining from public.v_batch_portions where batch_id = 'ba000000-0000-4000-8000-0000000000b1'),
  31::numeric, 'v_batch_portions folds the produce movement (31)');

set local role authenticated;
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.seen('batch') || '/' || pg_temp.seen('batch_input') || '/' || pg_temp.seen('batch_movement') || '/'
  || (select portions_remaining from public.v_batch_portions where batch_id = 'ba000000-0000-4000-8000-0000000000b1'),
  '3/2/1/31.0000', 'chef A reads the batches, inputs, movements and portions');
select is(pg_temp.seen('batch_cost'), 0::bigint, 'chef A reads 0 batch_cost rows (Q16 = project V6)');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is(pg_temp.seen('batch_cost'), 2::bigint, 'admin A reads batch_cost');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.seen('batch_cost') || '/' || pg_temp.seen('batch'), '2/3', 'owner A reads batch_cost and batch');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(pg_temp.seen('batch') + pg_temp.seen('batch_input') + pg_temp.seen('batch_movement')
  + pg_temp.seen('batch_cost') + pg_temp.seen('v_batch_portions'), 0::bigint, 'waiter A reads 0 rows of all five');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(pg_temp.seen('batch') + pg_temp.seen('batch_input') + pg_temp.seen('batch_movement')
  + pg_temp.seen('batch_cost') + pg_temp.seen('v_batch_portions'), 0::bigint, 'owner B reads none of A''s rows');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.err($$ insert into public.batch_cost (batch_id, tenant_id, incomplete, missing_ingredient_ids, cost_at,
    created_by) values (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', true, '{}', now(),
    'c1000000-0000-4000-8000-00000000000c') $$) ~ '^42501', true, 'the chef cannot insert into batch_cost');
reset role;

-- Grants ------------------------------------------------------------------------------------------------
select is_empty(
  $$ select t || ':' || p from unnest(array['batch', 'batch_input', 'batch_movement', 'batch_cost']) t,
       unnest(array['insert', 'update', 'delete', 'truncate']) p
      where has_table_privilege('authenticated', 'public.' || t, p)
         or has_table_privilege('anon', 'public.' || t, p)
         or has_table_privilege('service_role', 'public.' || t, p) $$,
  'no API role can insert, update, delete or truncate the four tables');
select is_empty(
  $$ select t from unnest(array['batch', 'batch_input', 'batch_movement', 'batch_cost', 'v_batch_portions']) t
      where not has_table_privilege('authenticated', 'public.' || t, 'select')
         or has_table_privilege('anon', 'public.' || t, 'select') $$,
  'authenticated selects the four tables and the view; anon selects none');
select is_empty(
  $$ select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace
      and c.relname in ('batch', 'batch_input', 'batch_movement', 'batch_cost')
      and not (c.relrowsecurity
        and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id')) $$,
  'the four tables have RLS and a tenant_id');

select * from finish();
rollback;
