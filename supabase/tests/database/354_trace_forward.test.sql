-- P2-2 S3 (docs/plans/2026-11-14-p2-2-trace-sell-through.md section 3.3.1 and step S3): the forward trace of a supplier lot.
-- Part A is a dated fixture (1998; Rome is UTC+1 in November, so 12:40 Rome is 11:40Z): the rows are written as fire_course, void_line, produce_batch, split_batch, discard_batch and
-- the staff meal write them (same shapes, same ref types), with explicit instants, because the procedures stamp the transaction time and the 02:00 cut-off and the DST nights need
-- fixed instants. Part B runs the real procedures (produce_batch, split_batch, fire_course, void_line) at the transaction time and reads the trace back, so the shapes this
-- function relies on are proven against what the procedures really write. Plan deviation: the plan names the procedures for the whole recall fixture; they cannot place rows at 1998 instants, so Part A
-- writes the same rows directly and Part B proves the shapes with the procedures themselves.
-- Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(64);

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
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)'),
  ('10000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'Dispensa (demo)'),
  ('10000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Cella B (demo)');
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo 1', 'IT12345678903'),
  ('5b000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Fornitore B Demo', 'IT12345678903');
insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('1a000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Farina Demo', 'kg'),
  ('1a000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'Pomodoro Demo', 'kg'),
  ('1a000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Farina B Demo', 'kg');
insert into public.supplier_item (id, tenant_id, supplier_id, ingredient_id, supplier_code, pack_count, pack_qty, pack_unit) values
  ('51000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-0000000000a1', '1a000000-0000-4000-8000-0000000000a1', 'SC-FARINA', 1, 25, 'kg');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id, number_raw, invoice_date) values
  ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/1998/e1000000-0000-4000-8000-0000000000e1.pdf', 'application/pdf', 2048, 'review', '5a000000-0000-4000-8000-0000000000a1', 'FT-DEMO-1', '1998-11-02'),
  ('e2000000-0000-4000-8000-0000000000e2', '22222222-2222-4222-8222-222222222222',
   '22222222-2222-4222-8222-222222222222/1998/e2000000-0000-4000-8000-0000000000e2.pdf', 'application/pdf', 2048, 'review', '5b000000-0000-4000-8000-0000000000b1', 'FT-B-1', '1998-11-02');
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e3', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'ragu (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000eb', '22222222-2222-4222-8222-222222222222', 'batch', 1, 'ragu b (demo)', 'b1000000-0000-4000-8000-00000000000b');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch, shelf_life_hours, created_by) values
  ('ed000000-0000-4000-8000-0000000000d3', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e3', 1, '1998-10-01', 'Ragù Demo', 2, 'kg', 10, 48, 'a1000000-0000-4000-8000-00000000000a'),
  ('ed000000-0000-4000-8000-0000000000db', '22222222-2222-4222-8222-222222222222', 'ec000000-0000-4000-8000-0000000000eb', 1, '1998-10-01', 'Ragù B Demo', 2, 'kg', 10, 48, 'b1000000-0000-4000-8000-00000000000b');
insert into public.menu_item (id, tenant_id, name, category, course_default, created_by, updated_by) values
  ('11000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Lasagne Demo', 'Primi', 'primi', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Tagliatelle Demo', 'Primi', 'primi', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('13000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Tavolo 1 (demo)', 1, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_at, opened_by, business_date, created_by, updated_by) values
  ('14000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000001', 'Tavolo 1 (demo)', 4, '1998-11-12T10:00Z',
   'a1000000-0000-4000-8000-00000000000a', '1998-11-12', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');

create temporary table reg (k text primary key, id uuid not null);
insert into reg values ('cella', '10000000-0000-4000-8000-0000000000a1'), ('disp', '10000000-0000-4000-8000-0000000000a2'), ('farina', '1a000000-0000-4000-8000-0000000000a1'),
  ('pomodoro', '1a000000-0000-4000-8000-0000000000a2'), ('lasagne', '11000000-0000-4000-8000-000000000001'), ('tagliatelle', '11000000-0000-4000-8000-000000000002'),
  ('sess', '14000000-0000-4000-8000-000000000001');
create function pg_temp.id(p_k text) returns uuid language sql as $$ select id from reg where k = p_k $$;
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
end $$;
create function pg_temp.act_as(p_who text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub',
    case p_who when 'owner' then 'a0000000-0000-4000-8000-00000000000a' when 'admin' then 'f0000000-0000-4000-8000-00000000000f'
               when 'chef' then 'c0000000-0000-4000-8000-00000000000c' when 'ownerb' then 'b0000000-0000-4000-8000-00000000000b'
               else 'd0000000-0000-4000-8000-00000000000d' end, 'role', 'authenticated',
    'tenant_id', case when p_who = 'ownerb' then '22222222-2222-4222-8222-222222222222' else '11111111-1111-4111-8111-111111111111' end,
    'app_role', case when p_who = 'ownerb' then 'owner' else p_who end, 'aal', case when p_who = 'admin' then 'aal2' else 'aal1' end)::text, true) $$;
-- A statement run as the authenticated role: 'ok' or "SQLSTATE message".
create function pg_temp.out(stmt text) returns text language plpgsql as $$
declare
  state text;
  msg text;
begin
  set local role authenticated;
  execute stmt;
  reset role;
  return 'ok';
exception when others then
  reset role;
  get stacked diagnostics state = returned_sqlstate, msg = message_text;
  return state || ' ' || msg;
end $$;
create function pg_temp.all_keys(j jsonb) returns setof text language plpgsql as $$
declare
  k text;
  v jsonb;
begin
  if jsonb_typeof(j) = 'object' then
    for k, v in select * from jsonb_each(j) loop
      return next k;
      return query select * from pg_temp.all_keys(v);
    end loop;
  elsif jsonb_typeof(j) = 'array' then
    for v in select * from jsonb_array_elements(j) loop
      return query select * from pg_temp.all_keys(v);
    end loop;
  end if;
end $$;

-- Writers of Part A ----------------------------------------------------------------------------------------------------------------------------
create sequence pg_temp.seq;
-- A received lot of tenant A (Farina unless told otherwise) with its invoice line (supplier item and code only for the first) and receipt.
create function pg_temp.mklot(p_k text, p_ing text, p_code text, p_on date, p_qty numeric, p_loc text default 'cella', p_item uuid default null, p_supcode text default null, p_expiry date default '1999-01-01') returns void language plpgsql as $$
declare
  v_n int := nextval('pg_temp.seq');
  v_line uuid := gen_random_uuid();
  v_lot uuid := gen_random_uuid();
begin
  insert into reg values (p_k, v_lot);
  insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, supplier_code, supplier_item_id, qty, unit_price, line_amount, field_confidence, extracted)
    values (v_line, '11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-0000000000e1', v_n, 'Farina 00 sacco', p_supcode, p_item, p_qty, 2, p_qty * 2, '{}', '{}');
  insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code, expiry, received_on, qty_received, base_unit, source_qty, source_unit, base_factor, created_by)
    values (v_lot, '11111111-1111-4111-8111-111111111111', pg_temp.id(p_ing), pg_temp.id(p_loc), '5a000000-0000-4000-8000-0000000000a1', v_line, p_code, p_expiry, p_on, p_qty, 'kg', p_qty, 'kg', 1,
            'a1000000-0000-4000-8000-00000000000a');
  insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type, ref_id, effective_on, created_at, created_by)
    values ('11111111-1111-4111-8111-111111111111', pg_temp.id(p_ing), v_lot, pg_temp.id(p_loc), 'receipt', p_qty, 2, 'invoice_line', v_line, p_on, p_on + time '09:00', 'a1000000-0000-4000-8000-00000000000a');
end $$;
-- A batch of tenant A. A root: produce movement. A child (p_parent set): the split pair (parent -p, child +p, ref_id = child) at p_created; the child keeps the parent's production time.
create function pg_temp.mkbatch(p_k text, p_produced timestamptz, p_portions int, p_parent text default null, p_created timestamptz default null) returns void language plpgsql as $$
declare
  v_n int := nextval('pg_temp.seq');
  v_id uuid := gen_random_uuid();
  v_at timestamptz := coalesce(p_created, p_produced);
begin
  insert into reg values (p_k, v_id);
  insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code, lot_seq, produced_at, produced_by, output_qty, output_unit,
      portions_computed, portions_initial, shelf_life_hours, use_by, state, location_id, split_from_batch_id, created_at, created_by)
    values (v_id, '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e3', 'ed000000-0000-4000-8000-0000000000d3', 1, '981101-RAG-' || v_n, '1998-11-01', 'RAG', v_n, p_produced,
            'a1000000-0000-4000-8000-00000000000a', 2, 'kg', p_portions, p_portions, 48, p_produced + interval '48 hours', 'fresh', pg_temp.id('cella'), case when p_parent is null then null else pg_temp.id(p_parent) end,
            v_at, 'a1000000-0000-4000-8000-00000000000a');
  if p_parent is null then
    insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_at, created_by)
      values ('11111111-1111-4111-8111-111111111111', v_id, 'produce', p_portions, 'batch', v_id, p_produced::date, v_at, 'a1000000-0000-4000-8000-00000000000a');
  else
    insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_at, created_by) values
      ('11111111-1111-4111-8111-111111111111', pg_temp.id(p_parent), 'split', -p_portions, 'batch_split', v_id, v_at::date, v_at, 'a1000000-0000-4000-8000-00000000000a'),
      ('11111111-1111-4111-8111-111111111111', v_id, 'split', p_portions, 'batch_split', v_id, v_at::date, v_at, 'a1000000-0000-4000-8000-00000000000a');
  end if;
end $$;
-- A production input: the consumption movement (ref batch) and its batch_input row. p_lot null = the unlotted shortfall slice.
create function pg_temp.mkinput(p_batch text, p_lot text, p_ing text, p_qty numeric, p_at timestamptz) returns void language plpgsql as $$
declare
  v_mv uuid := gen_random_uuid();
begin
  insert into public.stock_movement (id, tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type, ref_id, effective_on, created_at, created_by)
    values (v_mv, '11111111-1111-4111-8111-111111111111', pg_temp.id(p_ing), case when p_lot is null then null else pg_temp.id(p_lot) end, pg_temp.id('cella'), 'consumption', -p_qty, 2, 'batch', pg_temp.id(p_batch),
            p_at::date, p_at, 'a1000000-0000-4000-8000-00000000000a');
  insert into public.batch_input (tenant_id, batch_id, ingredient_id, location_id, raw_lot_id, qty, stock_movement_id, created_at, created_by)
    values ('11111111-1111-4111-8111-111111111111', pg_temp.id(p_batch), pg_temp.id(p_ing), pg_temp.id('cella'), case when p_lot is null then null else pg_temp.id(p_lot) end, p_qty, v_mv, p_at,
            'a1000000-0000-4000-8000-00000000000a');
end $$;
-- A fired order line (the line row only; the movements are written by consume / direct).
create function pg_temp.mkline(p_k text, p_item text, p_fired timestamptz, p_weight int default null) returns void language plpgsql as $$
begin
  insert into reg values (p_k, gen_random_uuid());
  insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_at, created_by, updated_by, fired_at, fired_by,
      weight_g, price_per_100g, portion_weight_g)
    values (pg_temp.id(p_k), '11111111-1111-4111-8111-111111111111', pg_temp.id('sess'), pg_temp.id(p_item), 'primi', 1, case when p_weight is null then 12 else round(4.8 * p_weight / 100, 2) end, 10, 'menu', p_fired - interval '1 hour', p_fired - interval '1 hour',
            'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d', p_fired, 'd1000000-0000-4000-8000-00000000000d',
            p_weight, case when p_weight is null then null else 4.8 end, case when p_weight is null then null else 250 end);
end $$;
-- fire_course on a batch: a consume row of p_portions.
create function pg_temp.consume(p_line text, p_batch text, p_at timestamptz, p_portions numeric default 1) returns void language sql as $$
  insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_at, created_by)
    values ('11111111-1111-4111-8111-111111111111', pg_temp.id(p_batch), 'consume', -p_portions, 'order_line', pg_temp.id(p_line), p_at::date, p_at, 'd1000000-0000-4000-8000-00000000000d') $$;
-- void_line on a batch consume: the reversal (+) and the waste row (order_void, plating_error).
create function pg_temp.void_consume(p_line text, p_at timestamptz) returns void language plpgsql as $$
declare
  m record;
begin
  for m in select id, batch_id, portions from public.batch_movement where ref_id = pg_temp.id(p_line) and type = 'consume' and reverses_id is null loop
    insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, reverses_id, effective_on, created_at, created_by)
      values ('11111111-1111-4111-8111-111111111111', m.batch_id, 'consume', -m.portions, 'order_void', pg_temp.id(p_line), m.id, p_at::date, p_at, 'd1000000-0000-4000-8000-00000000000d');
    insert into public.batch_movement (tenant_id, batch_id, type, portions, reason_code, ref_type, ref_id, effective_on, created_at, created_by)
      values ('11111111-1111-4111-8111-111111111111', m.batch_id, 'waste', m.portions, 'plating_error', 'order_void', pg_temp.id(p_line), p_at::date, p_at, 'd1000000-0000-4000-8000-00000000000d');
  end loop;
  update public.order_line set voided_at = p_at, voided_by = 'd1000000-0000-4000-8000-00000000000d', void_reason = 'order_error' where id = pg_temp.id(p_line);
end $$;
-- A plate with a raw ingredient straight from a lot: the consumption row (ref order_line).
create function pg_temp.direct(p_line text, p_lot text, p_ing text, p_qty numeric, p_at timestamptz) returns void language sql as $$
  insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type, ref_id, effective_on, created_at, created_by)
    values ('11111111-1111-4111-8111-111111111111', pg_temp.id(p_ing), pg_temp.id(p_lot), pg_temp.id('cella'), 'consumption', -p_qty, 2, 'order_line', pg_temp.id(p_line), p_at::date, p_at,
            'd1000000-0000-4000-8000-00000000000d') $$;
create function pg_temp.void_direct(p_line text, p_at timestamptz) returns void language plpgsql as $$
declare
  m record;
begin
  for m in select * from public.stock_movement where ref_id = pg_temp.id(p_line) and type = 'consumption' and reverses_id is null loop
    insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type, ref_id, reverses_id, effective_on, created_at, created_by)
      values (m.tenant_id, m.ingredient_id, m.raw_lot_id, m.location_id, 'consumption', -m.qty, m.unit_cost, 'order_void', m.ref_id, m.id, p_at::date, p_at, 'd1000000-0000-4000-8000-00000000000d');
    insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, reason_code, ref_type, ref_id, effective_on, created_at, created_by)
      values (m.tenant_id, m.ingredient_id, m.raw_lot_id, m.location_id, 'waste', m.qty, m.unit_cost, 'plating_error', 'order_void', m.ref_id, p_at::date, p_at, 'd1000000-0000-4000-8000-00000000000d');
  end loop;
  update public.order_line set voided_at = p_at, voided_by = 'd1000000-0000-4000-8000-00000000000d', void_reason = 'order_error' where id = pg_temp.id(p_line);
end $$;
create function pg_temp.bmove(p_batch text, p_type text, p_portions numeric, p_reason text, p_ref text, p_at timestamptz) returns void language sql as $$
  insert into public.batch_movement (tenant_id, batch_id, type, portions, reason_code, ref_type, ref_id, effective_on, created_at, created_by)
    values ('11111111-1111-4111-8111-111111111111', pg_temp.id(p_batch), p_type::public.batch_movement_type, p_portions, p_reason, p_ref, gen_random_uuid(), p_at::date, p_at, 'c1000000-0000-4000-8000-00000000000c') $$;
create function pg_temp.smove(p_lot text, p_ing text, p_type text, p_qty numeric, p_reason text, p_ref text, p_at timestamptz, p_loc text default 'cella') returns void language sql as $$
  insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, reason_code, ref_type, ref_id, effective_on, created_at, created_by)
    values ('11111111-1111-4111-8111-111111111111', pg_temp.id(p_ing), pg_temp.id(p_lot), pg_temp.id(p_loc), p_type::public.stock_movement_type, p_qty, case when p_type = 'transfer' then null else 2 end, p_reason, p_ref,
            gen_random_uuid(), p_at::date, p_at, 'c1000000-0000-4000-8000-00000000000c') $$;

-- The recall fixture --------------------------------------------------------------------------------------------------------------------------
-- Lot X (Farina, coded, with its purchase line) and lot Z (Farina, no code).
select pg_temp.mklot('x', 'farina', 'L-DEMO-0001', '1998-11-02', 10, 'cella', '51000000-0000-4000-8000-0000000000a1', 'SC-FARINA');
select pg_temp.mklot('z', 'farina', null, '1998-11-05', 4);
-- B1 and B2 are made from lot X (3 kg and 2 kg); C1 is split from B1.
select pg_temp.mkbatch('b1', '1998-11-10T09:00Z', 10);
select pg_temp.mkinput('b1', 'x', 'farina', 3, '1998-11-10T09:00Z');
select pg_temp.mkbatch('b2', '1998-11-11T09:00Z', 10);
select pg_temp.mkinput('b2', 'x', 'farina', 2, '1998-11-11T09:00Z');
select pg_temp.mkbatch('c1', '1998-11-10T09:00Z', 4, 'b1', '1998-11-11T15:00Z');
-- Business day D = 1998-11-12. Lasagne: L1 12:40 and L2 13:10 Rome from B1; L5 fired 14:00 from B1 and voided; L3 at 01:30 Rome on D+1 from C1 (still business day D, cut-off 02:00); L4 at 19:00 Rome on D+1 from C1.
select pg_temp.mkline('l1', 'lasagne', '1998-11-12T11:40Z'); select pg_temp.consume('l1', 'b1', '1998-11-12T11:40Z');
select pg_temp.mkline('l2', 'lasagne', '1998-11-12T12:10Z'); select pg_temp.consume('l2', 'b1', '1998-11-12T12:10Z');
select pg_temp.mkline('l5', 'lasagne', '1998-11-12T13:00Z'); select pg_temp.consume('l5', 'b1', '1998-11-12T13:00Z'); select pg_temp.void_consume('l5', '1998-11-12T13:30Z');
select pg_temp.mkline('l3', 'lasagne', '1998-11-13T00:30Z'); select pg_temp.consume('l3', 'c1', '1998-11-13T00:30Z');
select pg_temp.mkline('l4', 'lasagne', '1998-11-13T18:00Z'); select pg_temp.consume('l4', 'c1', '1998-11-13T18:00Z');
-- A 350 g Lasagne with a 250 g reference portion from B2 on D+2: 1.4 portions.
select pg_temp.mkline('w1', 'lasagne', '1998-11-14T12:00Z', 350); select pg_temp.consume('w1', 'b2', '1998-11-14T12:00Z', 1.4);
-- Tagliatelle with Farina straight from lot X on D (12:00 Rome), and a second one fired then voided (stock not restored: a waste row).
select pg_temp.mkline('t1', 'tagliatelle', '1998-11-12T11:00Z'); select pg_temp.direct('t1', 'x', 'farina', 0.2, '1998-11-12T11:00Z');
select pg_temp.mkline('t2', 'tagliatelle', '1998-11-12T11:30Z'); select pg_temp.direct('t2', 'x', 'farina', 0.5, '1998-11-12T11:30Z'); select pg_temp.void_direct('t2', '1998-11-12T11:45Z');
-- Other batch and stock movements: B1 discard 1 (D+1) and a staff meal 1; B2 count -1; lot X waste 0.3, count -0.1, and a transfer pair (nets to zero).
select pg_temp.bmove('b1', 'waste', -1, 'spoilage', 'batch_discard', '1998-11-13T10:00Z');
select pg_temp.bmove('b1', 'waste', -1, 'staff_meal', 'staff_meal', '1998-11-13T10:30Z');
select pg_temp.bmove('b2', 'count', -1, null, 'batch_adjust', '1998-11-13T11:00Z');
select pg_temp.smove('x', 'farina', 'waste', -0.3, 'spoilage', 'stock_waste', '1998-11-13T08:00Z');
select pg_temp.smove('x', 'farina', 'count', -0.1, null, 'count_session', '1998-11-13T08:30Z');
select pg_temp.smove('x', 'farina', 'transfer', -1, null, 'transfer', '1998-11-13T09:00Z', 'cella');
select pg_temp.smove('x', 'farina', 'transfer', 1, null, 'transfer', '1998-11-13T09:00Z', 'disp');
-- A later Farina batch made on a negative balance: an unlotted input (D-P3).
select pg_temp.mkbatch('b3', '1998-11-20T09:00Z', 10);
select pg_temp.mkinput('b3', null, 'farina', 1, '1998-11-20T09:00Z');
-- Tenant B: a lot of its own.
insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price, line_amount, field_confidence, extracted) values
  ('1e000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'e2000000-0000-4000-8000-0000000000e2', 1, 'Riga B demo', 5, 2, 10, '{}', '{}');
insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code, received_on, qty_received, base_unit, source_qty, source_unit, base_factor, created_by) values
  ('10700000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', '1a000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1',
   '5b000000-0000-4000-8000-0000000000b1', '1e000000-0000-4000-8000-0000000000b1', 'L-DEMO-0001', '1998-11-02', 5, 'kg', 5, 'kg', 1, 'b1000000-0000-4000-8000-00000000000b');
insert into reg values ('lotb', '10700000-0000-4000-8000-0000000000b1');

create function pg_temp.fwd(p_k text, p_role text default 'owner') returns jsonb language sql as $$
  select app.trace_lot_json('11111111-1111-4111-8111-111111111111', p_role, pg_temp.id(p_k)) $$;
create function pg_temp.bj(p_k text, p_batch text) returns jsonb language sql as $$
  select b from jsonb_array_elements(pg_temp.fwd(p_k) -> 'batches') b where b ->> 'batchId' = pg_temp.id(p_batch)::text $$;

select pg_temp.act_as('owner');

-- 1. The lot block (owner) ---------------------------------------------------------------------------------------------------------------------
select is(pg_temp.fwd('x') -> 'lot',
  jsonb_build_object('lotId', pg_temp.id('x'), 'ingredient', jsonb_build_object('id', pg_temp.id('farina'), 'name', 'Farina Demo'),
    'supplier', jsonb_build_object('id', '5a000000-0000-4000-8000-0000000000a1', 'name', 'Fornitore Demo 1'), 'lotCode', 'L-DEMO-0001', 'expiry', '1999-01-01', 'receivedOn', '1998-11-02',
    'qtyReceived', 10, 'unit', 'kg', 'location', jsonb_build_object('id', pg_temp.id('cella'), 'name', 'Cella (demo)'),
    'invoice', jsonb_build_object('id', 'e1000000-0000-4000-8000-0000000000e1', 'number', 'FT-DEMO-1', 'date', '1998-11-02'),
    'purchase', jsonb_build_object('supplierItemId', '51000000-0000-4000-8000-0000000000a1', 'supplierCode', 'SC-FARINA', 'description', 'Farina 00 sacco')),
  'the owner''s lot block: ids, code, expiry, receipt, quantity, location, the invoice and the purchase line as approved');
select is(pg_temp.fwd('z') -> 'lot' -> 'lotCode', 'null'::jsonb, 'a lot without a code has lotCode null');
select is(pg_temp.fwd('z') -> 'lot' -> 'purchase', jsonb_build_object('supplierItemId', null, 'supplierCode', null, 'description', 'Farina 00 sacco'), 'a purchase line without a supplier item or code: nulls and the description');

-- 2. Raw figures -------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.fwd('x') -> 'raw', jsonb_build_object('received', 10, 'intoBatches', 5, 'intoPlates', 0.2, 'wasted', 0.8, 'counted', -0.1, 'onHand', 3.9, 'unit', 'kg'),
  'raw: received 10, into batches 5 (the sum of batch_input), into plates 0.2 (the reversed 0.5 is not counted), wasted 0.3 + 0.5 (the void), counted -0.1, on hand 3.9; the transfer pair moves nothing');
select is((pg_temp.fwd('x') -> 'raw' ->> 'intoBatches')::numeric, (select sum(qty) from public.batch_input where raw_lot_id = pg_temp.id('x')), 'intoBatches equals the sum of the lot''s batch_input rows');
select is((pg_temp.fwd('x') -> 'raw' ->> 'onHand')::numeric, (select sum(qty) from public.stock_movement where raw_lot_id = pg_temp.id('x')), 'onHand equals the ledger fold of the lot');
select is(pg_temp.fwd('z') -> 'raw', jsonb_build_object('received', 4, 'intoBatches', 0, 'intoPlates', 0, 'wasted', 0, 'counted', 0, 'onHand', 4, 'unit', 'kg'), 'an untouched lot: received = on hand, the rest zero');

-- 3. Batches: B1, B2 and the split child C1 -----------------------------------------------------------------------------------------------------
select is((select array_agg(b ->> 'batchId' order by b ->> 'lotCode') from jsonb_array_elements(pg_temp.fwd('x') -> 'batches') b),
          (select array_agg(id::text order by lot_code) from public.batch where id in (pg_temp.id('b1'), pg_temp.id('b2'), pg_temp.id('c1'))), 'batches are B1, B2 and C1 (the family of lot X), not B3');
select is((select array_agg(b ->> 'batchId' order by ord) from jsonb_array_elements(pg_temp.fwd('x') -> 'batches') with ordinality t (b, ord)),
          array[pg_temp.id('b1')::text, pg_temp.id('c1')::text, pg_temp.id('b2')::text], 'ordered by production time, then depth: B1, its child C1, B2');
select is(pg_temp.bj('x', 'c1') -> 'splitFrom', jsonb_build_object('batchId', pg_temp.id('b1'), 'lotCode', (select lot_code from public.batch where id = pg_temp.id('b1'))), 'C1 says it is split from B1');
select is(pg_temp.bj('x', 'c1') -> 'qtyFromLot', 'null'::jsonb, 'C1 has qtyFromLot null (a split child has no batch_input)');
select is(pg_temp.bj('x', 'b1') -> 'splitFrom', 'null'::jsonb, 'B1 is no split child');
select is((pg_temp.bj('x', 'b1') ->> 'qtyFromLot')::numeric, 3::numeric, 'B1 took 3 kg from the lot');
select is((pg_temp.bj('x', 'b2') ->> 'qtyFromLot')::numeric, 2::numeric, 'B2 took 2 kg from the lot');
select is(pg_temp.bj('x', 'b1') ->> 'recipeName', 'Ragù Demo', 'the recipe name');
select is(pg_temp.bj('x', 'b1') ->> 'producedAt', '1998-11-10T09:00:00Z', 'producedAt is ISO UTC');
select is(pg_temp.bj('x', 'b1') ->> 'useBy', '1998-11-12T09:00:00Z', 'useBy is ISO UTC');
select is((pg_temp.bj('x', 'b1') ->> 'portionsInitial')::int, 10, 'portionsInitial');
select is(pg_temp.bj('x', 'b1') ->> 'state', 'fresh', 'the batch state');
select is(pg_temp.bj('x', 'b1') ->> 'lotCode', (select lot_code from public.batch where id = pg_temp.id('b1')), 'the batch lot code');
select is(pg_temp.bj('x', 'b1') -> 'portions', jsonb_build_object('sold', 2, 'wasted', 2, 'staffMeal', 1, 'counted', 0, 'remaining', 1),
  'B1 portions: sold 2 (the voided line nets out), wasted 2 (the void and the discard), staff meal 1, remaining 1 (10 - 2 - 1 - 4 split - 1 - 1)');
select is(pg_temp.bj('x', 'c1') -> 'portions', jsonb_build_object('sold', 2, 'wasted', 0, 'staffMeal', 0, 'counted', 0, 'remaining', 2), 'C1 portions: sold 2, remaining 2');
select is(pg_temp.bj('x', 'b2') -> 'portions', jsonb_build_object('sold', 1.4, 'wasted', 0, 'staffMeal', 0, 'counted', -1, 'remaining', 7.6), 'B2 portions: sold 1.4 (weight line), counted -1, remaining 7.6');
select is((select count(*)::int from jsonb_array_elements(pg_temp.fwd('x') -> 'batches') b
            join lateral (select coalesce(-sum(m.portions) filter (where m.type = 'split' and m.portions < 0), 0) as split_out from public.batch_movement m where m.batch_id = (b ->> 'batchId')::uuid) s on true
           where (b ->> 'portionsInitial')::numeric <> (b -> 'portions' ->> 'sold')::numeric + (b -> 'portions' ->> 'wasted')::numeric + (b -> 'portions' ->> 'staffMeal')::numeric
                 - (b -> 'portions' ->> 'counted')::numeric + s.split_out + (b -> 'portions' ->> 'remaining')::numeric), 0,
  'for every batch: portionsInitial = sold + wasted + staffMeal - counted + split out + remaining');
select is(pg_temp.fwd('x') -> 'batchesTruncated', 'false'::jsonb, 'batchesTruncated false');

-- 4. Plates -----------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.fwd('x') -> 'plates',
  jsonb_build_array(
    jsonb_build_object('businessDate', '1998-11-12', 'menuItemId', pg_temp.id('lasagne'), 'name', 'Lasagne Demo', 'lines', 3, 'portions', 3, 'firstAt', '1998-11-12T11:40:00Z', 'lastAt', '1998-11-13T00:30:00Z', 'via', 'batch'),
    jsonb_build_object('businessDate', '1998-11-12', 'menuItemId', pg_temp.id('tagliatelle'), 'name', 'Tagliatelle Demo', 'lines', 1, 'portions', 1, 'firstAt', '1998-11-12T11:00:00Z', 'lastAt', '1998-11-12T11:00:00Z', 'via', 'direct'),
    jsonb_build_object('businessDate', '1998-11-13', 'menuItemId', pg_temp.id('lasagne'), 'name', 'Lasagne Demo', 'lines', 1, 'portions', 1, 'firstAt', '1998-11-13T18:00:00Z', 'lastAt', '1998-11-13T18:00:00Z', 'via', 'batch'),
    jsonb_build_object('businessDate', '1998-11-14', 'menuItemId', pg_temp.id('lasagne'), 'name', 'Lasagne Demo', 'lines', 1, 'portions', 1.4, 'firstAt', '1998-11-14T12:00:00Z', 'lastAt', '1998-11-14T12:00:00Z', 'via', 'batch')),
  'plates by business day, dish and route: the voided lines are out, the 01:30 plate of D+1 sits on D, the direct raw plate is via direct, the 350 g line counts 1.4 portions');
select is(pg_temp.fwd('x') -> 'platesTruncated', 'false'::jsonb, 'platesTruncated false');
select is(pg_temp.fwd('x') -> 'voided', jsonb_build_object('lines', 2, 'portions', 2), 'voided: the batch line L5 and the direct line T2, counted once each');
select is(pg_temp.fwd('z') -> 'plates', '[]'::jsonb, 'an untouched lot has no plates');
select is(pg_temp.fwd('z') -> 'voided', jsonb_build_object('lines', 0, 'portions', 0), 'and nothing voided');

-- 5. Gaps ---------------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.fwd('x') -> 'gaps', jsonb_build_object('lotCodeMissing', false, 'unlottedSameIngredientBatches', 1), 'gaps for X: it has a code; B3 (made later from the same ingredient with an unlotted input) is flagged');
select is(pg_temp.fwd('z') -> 'gaps', jsonb_build_object('lotCodeMissing', true, 'unlottedSameIngredientBatches', 1), 'gaps for Z: no lot code; B3 was made after its receipt');

-- 6. The business-day cut-off across the DST nights (a Pomodoro lot, its own batch) --------------------------------------------------------------
select pg_temp.mklot('p', 'pomodoro', 'P-DST', '1998-03-01', 5);
select pg_temp.mkbatch('bd', '1998-03-20T09:00Z', 10);
select pg_temp.mkinput('bd', 'p', 'pomodoro', 1, '1998-03-20T09:00Z');
-- 1998-03-29 01:30 Rome is CET (the clocks jump at 02:00): 00:30Z. 1998-10-25 01:30 Rome is still CEST (the clocks go back at 03:00): 1998-10-24T23:30Z.
select pg_temp.mkline('s1', 'lasagne', '1998-03-29T00:30Z'); select pg_temp.consume('s1', 'bd', '1998-03-29T00:30Z');
select pg_temp.mkline('s2', 'lasagne', '1998-10-24T23:30Z'); select pg_temp.consume('s2', 'bd', '1998-10-24T23:30Z');
select is((select array_agg(p ->> 'businessDate' order by p ->> 'businessDate') from jsonb_array_elements(pg_temp.fwd('p') -> 'plates') p), array['1998-03-28', '1998-10-24'],
  'DST: 01:30 on the spring change night groups on 1998-03-28, and 01:30 on the autumn change night on 1998-10-24');

-- 7. Caps: 401 plate groups and 201 batches (a Pomodoro lot of its own) -------------------------------------------------------------------------
select pg_temp.mklot('q', 'pomodoro', 'P-CAP', '1996-01-01', 500);
select pg_temp.mkbatch('bq', '1996-01-02T09:00Z', 10);
select pg_temp.mkinput('bq', 'q', 'pomodoro', 1, '1996-01-02T09:00Z');
select pg_temp.mkline('cap' || g, 'lasagne', timestamptz '1996-02-01T12:00Z' + g * interval '1 day'), pg_temp.consume('cap' || g, 'bq', timestamptz '1996-02-01T12:00Z' + g * interval '1 day') from generate_series(1, 401) g;
select is(jsonb_array_length(pg_temp.fwd('q') -> 'plates'), 400, '401 plate groups: the reply holds 400');
select is(pg_temp.fwd('q') -> 'platesTruncated', 'true'::jsonb, 'and platesTruncated is true');
select pg_temp.mklot('r', 'pomodoro', 'P-BAT', '1996-01-01', 500);
select pg_temp.mkbatch('br' || g, timestamptz '1996-03-01T09:00Z' + g * interval '1 hour', 10), pg_temp.mkinput('br' || g, 'r', 'pomodoro', 1, timestamptz '1996-03-01T09:00Z' + g * interval '1 hour') from generate_series(1, 201) g;
select is(jsonb_array_length(pg_temp.fwd('r') -> 'batches'), 200, '201 batches: the reply holds 200');
select is(pg_temp.fwd('r') -> 'batchesTruncated', 'true'::jsonb, 'and batchesTruncated is true');

-- 8. Roles, keys and tenancy through the public function ------------------------------------------------------------------------------------------
select is(pg_temp.out(format('select public.trace_lot(%L)', pg_temp.id('x'))), 'ok', 'owner: public.trace_lot answers');
select is((select count(*)::int from pg_temp.all_keys(pg_temp.fwd('x', 'chef')) k where k in ('invoice', 'purchase')), 0, 'the chef reply has no invoice and no purchase key, at any depth');
select is((select count(*)::int from pg_temp.all_keys(pg_temp.fwd('x', 'owner')) k where k in ('invoice', 'purchase')), 2, 'the owner reply has both');
select is((select count(*)::int from pg_temp.all_keys(pg_temp.fwd('x', 'admin')) k where k in ('invoice', 'purchase')), 2, 'the admin reply has both');
select pg_temp.act_as('chef');
select is(pg_temp.out(format('select public.trace_lot(%L)', pg_temp.id('x'))), 'ok', 'chef: public.trace_lot answers');
select is((select count(*)::int from pg_temp.all_keys(public.trace_lot(pg_temp.id('x'))) k where k in ('invoice', 'purchase')), 0, 'the session role decides: the chef gets neither key from the public function');
select pg_temp.act_as('waiter');
select matches(pg_temp.out(format('select public.trace_lot(%L)', pg_temp.id('x'))), '^42501 ', 'waiter: 42501');
select pg_temp.act_as('owner');
select is(pg_temp.out(format('select public.trace_lot(%L)', pg_temp.id('lotb'))), 'P0002 not_found', 'tenant B''s lot id: P0002 not_found');
select is(pg_temp.out(format('select public.trace_lot(%L)', gen_random_uuid())), 'P0002 not_found', 'an unknown id: the same P0002 not_found');
select is(pg_temp.out('select public.trace_lot(null)'), 'P0002 not_found', 'a null id: P0002 not_found');
select pg_temp.act_as('ownerb');
select is(pg_temp.out(format('select public.trace_lot(%L)', pg_temp.id('x'))), 'P0002 not_found', 'tenant A''s lot id as owner B: P0002 not_found');
select is(public.trace_lot(pg_temp.id('lotb')) -> 'lot' ->> 'lotCode', 'L-DEMO-0001', 'owner B reads its own lot');
select pg_temp.act_as('owner');
select is(app.payload_money_keys(pg_temp.fwd('x')), '{}'::text[], 'the owner reply has no money key');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'trace_lot' and p.prosecdef and p.proconfig = array['search_path=""']
            and has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE') and not has_function_privilege('service_role', p.oid, 'EXECUTE')), 1,
  'public.trace_lot is a definer with an empty search_path, executable by authenticated only');

-- 9. The purchase line is the line as approved: a later change of the supplier item does not alter it -------------------------------------------------
update public.supplier_item set pack_qty = 5, supplier_code = 'SC-CAMBIATO' where id = '51000000-0000-4000-8000-0000000000a1';
select is(pg_temp.fwd('x') -> 'lot' -> 'purchase', jsonb_build_object('supplierItemId', '51000000-0000-4000-8000-0000000000a1', 'supplierCode', 'SC-FARINA', 'description', 'Farina 00 sacco'),
  'purchase is read from the invoice line: changing the supplier item''s pack and code afterwards changes nothing');

-- 10. Part B: the real procedures. produce_batch, split_batch, fire_course and void_line run at the transaction time, and the trace reads back what they wrote.
-- Lot Y (Pomodoro, 5 kg) feeds the batch "Sugo Demo"; lot W (Basilico, 2 kg) goes straight onto the plate "Piatto Demo" (1 portion Sugo + 0.1 kg Basilico). Three lines are fired, one is voided.
insert into public.ingredient (id, tenant_id, name, base_unit) values ('1a000000-0000-4000-8000-0000000000a3', '11111111-1111-4111-8111-111111111111', 'Basilico Demo', 'kg');
insert into reg values ('basilico', '1a000000-0000-4000-8000-0000000000a3');
select pg_temp.mklot('y', 'pomodoro', 'L-REAL-Y', '1998-11-02', 5, 'cella', null, null, current_date + 30);
select pg_temp.mklot('w', 'basilico', 'L-REAL-W', '1998-11-02', 2, 'cella', null, null, current_date + 30);
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000f1', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'sugo demo', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000f2', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'piatto demo', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch, shelf_life_hours, created_by) values
  ('ed000000-0000-4000-8000-0000000000f1', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000f1', 1, '1998-10-01', 'Sugo Demo', 2, 'kg', 10, 48, 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by) values
  ('ed000000-0000-4000-8000-0000000000f2', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000f2', 1, '1998-10-01', 'Piatto Demo', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, sub_recipe_key, qty, unit, yield_factor, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000f1', 1, '1a000000-0000-4000-8000-0000000000a2', null, 1, 'kg', 1, 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000f2', 1, null, 'ec000000-0000-4000-8000-0000000000f1', 1, 'porz', 1, 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000f2', 2, '1a000000-0000-4000-8000-0000000000a3', null, 0.1, 'kg', 1, 'a1000000-0000-4000-8000-00000000000a');
insert into public.menu_item (id, tenant_id, name, category, course_default, recipe_key, created_by, updated_by) values
  ('11000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Piatto Demo', 'Primi', 'primi', 'ec000000-0000-4000-8000-0000000000f2', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('13000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Tavolo 2 (demo)', 2, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, created_by, updated_by) values
  ('14000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000002', 'Tavolo 2 (demo)', 2, 'a1000000-0000-4000-8000-00000000000a',
   app.business_date('11111111-1111-4111-8111-111111111111', now()), 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by)
  select ('a3000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, '11111111-1111-4111-8111-111111111111', '14000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000003', 'primi', 1, 12, 10,
         'menu', now() - interval '1 minute', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'
    from generate_series(1, 3) g;
grant execute on function pg_temp.id(text) to authenticated;
grant select on reg to authenticated;
select pg_temp.act_as('chef');
set local role authenticated;
create temporary table real_res (k text primary key, j jsonb);
grant all on real_res to authenticated;
insert into real_res select 'produce', public.produce_batch('ed000000-0000-4000-8000-0000000000f1', 2, jsonb_build_array(jsonb_build_object('ingredientId', pg_temp.id('pomodoro'), 'qty', 1, 'unit', 'kg', 'lotId', pg_temp.id('y'), 'locationId', '10000000-0000-4000-8000-0000000000a1')), 10, 48, '10000000-0000-4000-8000-0000000000a1');
reset role;
select is((select count(*)::int from public.batch_input where raw_lot_id = pg_temp.id('y')), 1, 'Part B: produce_batch wrote one batch_input row for lot Y');
select pg_temp.act_as('chef');
set local role authenticated;
insert into real_res select 'split', public.split_batch(((select j from real_res where k = 'produce') ->> 'batchId')::uuid, 4, 24, '10000000-0000-4000-8000-0000000000a1');
reset role;
select pg_temp.act_as('waiter');
set local role authenticated;
select public.fire_course('14000000-0000-4000-8000-000000000002', jsonb_build_object('lineIds', jsonb_build_array('a3000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000003')));
select public.void_line('a3000000-0000-4000-8000-000000000003', jsonb_build_object('reason', 'order_error', 'clientUpdatedAt', to_char((clock_timestamp() - interval '1 minute') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
reset role;
select pg_temp.act_as('owner');
select is(jsonb_array_length(pg_temp.fwd('y') -> 'batches'), 2, 'Part B: lot Y has the real batch and its real split child');
select is((select count(*)::int from jsonb_array_elements(pg_temp.fwd('y') -> 'batches') b where b -> 'splitFrom' <> 'null'::jsonb and b -> 'qtyFromLot' = 'null'::jsonb), 1, 'Part B: the child has splitFrom and qtyFromLot null');
select is((select sum((p ->> 'lines')::int)::int from jsonb_array_elements(pg_temp.fwd('y') -> 'plates') p where p ->> 'via' = 'batch'), 2, 'Part B: two lines served from the batches (three fired, one voided)');
select is(pg_temp.fwd('y') -> 'voided' -> 'lines', '1'::jsonb, 'Part B: one voided line');
select is((select sum((b -> 'portions' ->> 'wasted')::numeric) from jsonb_array_elements(pg_temp.fwd('y') -> 'batches') b), 1::numeric, 'Part B: the void''s waste row is a waste of the batch family');
select is((select sum((b -> 'portions' ->> 'sold')::numeric) from jsonb_array_elements(pg_temp.fwd('y') -> 'batches') b), 2::numeric, 'Part B: sold portions are the two served plates (the voided consume is netted out)');
select is((pg_temp.fwd('y') -> 'raw' ->> 'intoBatches')::numeric, 1::numeric, 'Part B: raw.intoBatches is the 1 kg the production took');
select is((select count(*)::int from jsonb_array_elements(pg_temp.fwd('y') -> 'batches') b
            join lateral (select coalesce(-sum(m.portions) filter (where m.type = 'split' and m.portions < 0), 0) as split_out from public.batch_movement m where m.batch_id = (b ->> 'batchId')::uuid) s on true
           where (b ->> 'portionsInitial')::numeric <> (b -> 'portions' ->> 'sold')::numeric + (b -> 'portions' ->> 'wasted')::numeric + (b -> 'portions' ->> 'staffMeal')::numeric
                 - (b -> 'portions' ->> 'counted')::numeric + s.split_out + (b -> 'portions' ->> 'remaining')::numeric), 0, 'Part B: portionsInitial = sold + wasted + staffMeal - counted + split out + remaining for the real batches');
select is((select sum((p ->> 'lines')::int)::int from jsonb_array_elements(pg_temp.fwd('w') -> 'plates') p where p ->> 'via' = 'direct'), 2, 'Part B: lot W (straight onto the plate) reaches two served lines');
select is(pg_temp.fwd('w') -> 'voided' -> 'lines', '1'::jsonb, 'Part B: and one voided line');
select is(pg_temp.fwd('w') -> 'raw', jsonb_build_object('received', 2, 'intoBatches', 0, 'intoPlates', 0.2, 'wasted', 0.1, 'counted', 0, 'onHand', 1.7, 'unit', 'kg'),
  'Part B: lot W raw figures from the real rows: 0.2 on two plates, 0.1 wasted by the void, 1.7 on hand');

select * from finish();
rollback;
