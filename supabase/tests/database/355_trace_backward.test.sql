-- P2-2 S4 (docs/plans/2026-11-14-p2-2-trace-sell-through.md sections 3.3.2 and 3.3.3, step S4): the backward traces. trace_batch (a batch back to its root's raw lots, suppliers and invoices; its
-- own portions and plates), trace_line_search (the fired lines of a business day, optionally of one dish) and trace_order_line (a served plate back to its batches, direct raw lots and
-- suppliers). The fixture is the recall fixture of 354 (dated 1998; Rome is UTC+1 in November) plus a batch made partly from unlotted stock, a draft line, a day of 201 fired lines and a
-- seated reservation with a guest on the traced table: no reply may carry the guest. Departures from the plan text: tagliatelle has two lines (one voided) so the dish filter shows both
-- states, and the "lots" of trace_order_line also name each lot's ingredient (a lot list without it is ambiguous). Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(68);

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

-- Extra fixture ----------------------------------------------------------------------------------------------------------------------------------
-- B4: made partly from lot X (1 kg) and partly from unlotted stock (0.5 kg).
select pg_temp.mkbatch('b4', '1998-11-15T09:00Z', 10);
select pg_temp.mkinput('b4', 'x', 'farina', 1, '1998-11-15T09:00Z');
select pg_temp.mkinput('b4', null, 'farina', 0.5, '1998-11-15T09:00Z');
-- A draft line (never fired) on Lasagne.
insert into reg values ('draft', gen_random_uuid());
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by)
  values (pg_temp.id('draft'), '11111111-1111-4111-8111-111111111111', pg_temp.id('sess'), pg_temp.id('lasagne'), 'primi', 1, 12, 10, 'menu', '1998-11-12T09:00Z',
          'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d');
-- A day of 201 fired Tagliatelle lines (1996-05-05) for the cap of the line search.
select pg_temp.mkline('many' || g, 'tagliatelle', timestamptz '1996-05-05T09:00Z' + g * interval '1 minute') from generate_series(1, 201) g;
-- A seated reservation with a guest on the table of the traced lines (D = 1998-11-12): the guest must never appear in a trace.
insert into public.reservation (tenant_id, id, status, business_date, service_key, starts_at, ends_at, party, source, table_session_id)
  values ('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-000000000001', 'seated', '1998-11-12', 'pranzo', '1998-11-12T11:00Z', '1998-11-12T13:00Z', 4, 'staff', pg_temp.id('sess'));
insert into public.reservation_contact (tenant_id, reservation_id, name, phone, email, locale)
  values ('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-000000000001', 'Ospite Segreto Demo', '+39000111222', 'ospite.segreto@example.com', 'it');
insert into public.reservation_table (tenant_id, reservation_id, dining_table_id, assigned_at, assigned_by)
  values ('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000001', '1998-11-10T10:00Z', 'a1000000-0000-4000-8000-00000000000a');
-- Tenant B: a batch and a fired line of its own.
insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code, lot_seq, produced_at, produced_by, output_qty, output_unit, portions_computed, portions_initial,
    shelf_life_hours, use_by, state, location_id, created_by)
  values ('ba000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'ec000000-0000-4000-8000-0000000000eb', 'ed000000-0000-4000-8000-0000000000db', 1, '981101-RAG-1', '1998-11-01', 'RAG', 1,
          '1998-11-10T09:00Z', 'b1000000-0000-4000-8000-00000000000b', 2, 'kg', 10, 10, 48, '1998-11-12T09:00Z', 'fresh', '10000000-0000-4000-8000-0000000000b1', 'b1000000-0000-4000-8000-00000000000b');
insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_at, created_by)
  values ('22222222-2222-4222-8222-222222222222', 'ba000000-0000-4000-8000-0000000000b1', 'produce', 10, 'batch', 'ba000000-0000-4000-8000-0000000000b1', '1998-11-10', '1998-11-10T09:00Z', 'b1000000-0000-4000-8000-00000000000b');
insert into public.menu_item (id, tenant_id, name, category, course_default, created_by, updated_by)
  values ('11000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Piatto B Demo', 'Primi', 'primi', 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by)
  values ('13000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Tavolo B (demo)', 1, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_at, opened_by, business_date, created_by, updated_by)
  values ('14000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', '13000000-0000-4000-8000-0000000000b1', 'Tavolo B (demo)', 2, '1998-11-12T10:00Z', 'b1000000-0000-4000-8000-00000000000b',
          '1998-11-12', 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_at, created_by, updated_by, fired_at, fired_by)
  values ('a3000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', '14000000-0000-4000-8000-0000000000b1', '11000000-0000-4000-8000-0000000000b1', 'primi', 1, 9, 10, 'menu',
          '1998-11-12T11:00Z', '1998-11-12T11:00Z', 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b', '1998-11-12T11:30Z', 'b1000000-0000-4000-8000-00000000000b');
insert into reg values ('batchb', 'ba000000-0000-4000-8000-0000000000b1'), ('lineb', 'a3000000-0000-4000-8000-0000000000b1');

create function pg_temp.tb(p_k text, p_role text default 'owner') returns jsonb language sql as $$
  select app.trace_batch_json('11111111-1111-4111-8111-111111111111', p_role, pg_temp.id(p_k)) $$;
create function pg_temp.tl(p_k text, p_role text default 'owner') returns jsonb language sql as $$
  select app.trace_line_json('11111111-1111-4111-8111-111111111111', p_role, pg_temp.id(p_k)) $$;
create function pg_temp.ls(p_date date, p_item text default null) returns jsonb language sql as $$
  select app.trace_line_search_json('11111111-1111-4111-8111-111111111111', 'owner', p_date, case when p_item is null then null else pg_temp.id(p_item) end, '1998-11-14T11:00Z') $$;
create function pg_temp.lotx(p_with_invoice boolean default true) returns jsonb language sql as $$
  select jsonb_build_object('lotId', pg_temp.id('x'), 'lotCode', 'L-DEMO-0001', 'expiry', '1999-01-01', 'receivedOn', '1998-11-02',
           'supplier', jsonb_build_object('id', '5a000000-0000-4000-8000-0000000000a1', 'name', 'Fornitore Demo 1'))
         || case when p_with_invoice then jsonb_build_object('invoice', jsonb_build_object('id', 'e1000000-0000-4000-8000-0000000000e1', 'number', 'FT-DEMO-1', 'date', '1998-11-02')) else '{}'::jsonb end $$;

select pg_temp.act_as('owner');

-- 1. trace_batch: a split child -----------------------------------------------------------------------------------------------------------------
select is(pg_temp.tb('c1') -> 'batch',
  jsonb_build_object('batchId', pg_temp.id('c1'), 'lotCode', (select lot_code from public.batch where id = pg_temp.id('c1')), 'recipeName', 'Ragù Demo', 'recipeVersion', 1,
    'producedAt', '1998-11-10T09:00:00Z', 'useBy', '1998-11-12T09:00:00Z', 'portionsInitial', 4, 'state', 'fresh',
    'splitFrom', jsonb_build_object('batchId', pg_temp.id('b1'), 'lotCode', (select lot_code from public.batch where id = pg_temp.id('b1'))),
    'root', jsonb_build_object('batchId', pg_temp.id('b1'), 'lotCode', (select lot_code from public.batch where id = pg_temp.id('b1')))),
  'trace_batch(C1): the batch block names its parent and its root (B1)');
select is(pg_temp.tb('c1') -> 'inputs',
  jsonb_build_array(jsonb_build_object('ingredient', jsonb_build_object('id', pg_temp.id('farina'), 'name', 'Farina Demo'), 'qty', 3, 'unit', 'kg', 'inherited', true, 'lot', pg_temp.lotx())),
  'the inputs of C1 are B1''s, inherited, with lot, supplier and (owner) invoice');
select is(pg_temp.tb('c1') -> 'portions', jsonb_build_object('sold', 2, 'wasted', 0, 'staffMeal', 0, 'counted', 0, 'splitOut', 4, 'remaining', 2), 'C1 portions: sold 2, split +4 (its own initial), remaining 2');
select is(pg_temp.tb('b1') -> 'portions', jsonb_build_object('sold', 2, 'wasted', 2, 'staffMeal', 1, 'counted', 0, 'splitOut', -4, 'remaining', 1), 'portions.splitOut on B1 is -(C1''s portions)');
select is(pg_temp.tb('b1') -> 'inputs' -> 0 -> 'inherited', 'false'::jsonb, 'B1''s own input is not inherited');
select is(pg_temp.tb('b1') -> 'batch' -> 'splitFrom', 'null'::jsonb, 'B1 has no parent');
select is(pg_temp.tb('b1') -> 'batch' -> 'root' ->> 'batchId', pg_temp.id('b1')::text, 'and is its own root');
select is(pg_temp.tb('b1') -> 'plates',
  jsonb_build_array(jsonb_build_object('businessDate', '1998-11-12', 'menuItemId', pg_temp.id('lasagne'), 'name', 'Lasagne Demo', 'lines', 2, 'portions', 2, 'firstAt', '1998-11-12T11:40:00Z', 'lastAt', '1998-11-12T12:10:00Z', 'via', 'batch')),
  'B1''s plates: its own two lines on D (the voided one is out, the child''s lines are not B1''s)');
select is(pg_temp.tb('c1') -> 'plates',
  jsonb_build_array(
    jsonb_build_object('businessDate', '1998-11-12', 'menuItemId', pg_temp.id('lasagne'), 'name', 'Lasagne Demo', 'lines', 1, 'portions', 1, 'firstAt', '1998-11-13T00:30:00Z', 'lastAt', '1998-11-13T00:30:00Z', 'via', 'batch'),
    jsonb_build_object('businessDate', '1998-11-13', 'menuItemId', pg_temp.id('lasagne'), 'name', 'Lasagne Demo', 'lines', 1, 'portions', 1, 'firstAt', '1998-11-13T18:00:00Z', 'lastAt', '1998-11-13T18:00:00Z', 'via', 'batch')),
  'C1''s plates: the 01:30 line sits on D, the 19:00 line on D+1');
select is(pg_temp.tb('c1') -> 'platesTruncated', 'false'::jsonb, 'platesTruncated false');

-- 2. trace_batch: unlotted stock ----------------------------------------------------------------------------------------------------------------
select is(pg_temp.tb('b4') -> 'inputs',
  jsonb_build_array(
    jsonb_build_object('ingredient', jsonb_build_object('id', pg_temp.id('farina'), 'name', 'Farina Demo'), 'qty', 1, 'unit', 'kg', 'inherited', false, 'lot', pg_temp.lotx()),
    jsonb_build_object('ingredient', jsonb_build_object('id', pg_temp.id('farina'), 'name', 'Farina Demo'), 'qty', 0.5, 'unit', 'kg', 'inherited', false, 'lot', null)),
  'a batch made partly from unlotted stock: the lotted input first, then one input with lot null');
select is(pg_temp.tb('b3') -> 'inputs' -> 0 -> 'lot', 'null'::jsonb, 'B3: a single unlotted input');

-- 3. trace_batch: the plates cap ----------------------------------------------------------------------------------------------------------------
select pg_temp.mklot('q', 'pomodoro', 'P-CAP', '1996-01-01', 500);
select pg_temp.mkbatch('bq', '1996-01-02T09:00Z', 10);
select pg_temp.mkinput('bq', 'q', 'pomodoro', 1, '1996-01-02T09:00Z');
select pg_temp.mkline('cap' || g, 'lasagne', timestamptz '1996-02-01T12:00Z' + g * interval '1 day'), pg_temp.consume('cap' || g, 'bq', timestamptz '1996-02-01T12:00Z' + g * interval '1 day') from generate_series(1, 401) g;
select is(jsonb_array_length(pg_temp.tb('bq') -> 'plates'), 400, '401 plate groups: 400 in the reply');
select is(pg_temp.tb('bq') -> 'platesTruncated', 'true'::jsonb, 'and platesTruncated is true');

-- 4. trace_line_search ---------------------------------------------------------------------------------------------------------------------------
select is((select array_agg(l ->> 'lineId' order by o) from jsonb_array_elements(pg_temp.ls('1998-11-12') -> 'lines') with ordinality t (l, o)),
          array[pg_temp.id('t1')::text, pg_temp.id('t2')::text, pg_temp.id('l1')::text, pg_temp.id('l2')::text, pg_temp.id('l5')::text, pg_temp.id('l3')::text],
          'business day D: the six lines fired from 02:00 on D-1... to 02:00 on D+1 (the 01:30 line of D+1 included, the 19:00 line not), in fire order');
select is(pg_temp.ls('1998-11-12') ->> 'businessDate', '1998-11-12', 'the reply names the business date');
select is(pg_temp.ls('1998-11-12') -> 'truncated', 'false'::jsonb, 'truncated false');
select is((select l from jsonb_array_elements(pg_temp.ls('1998-11-12') -> 'lines') l where l ->> 'lineId' = pg_temp.id('l1')::text),
          jsonb_build_object('lineId', pg_temp.id('l1'), 'menuItemName', 'Lasagne Demo', 'tableName', 'Tavolo 1 (demo)', 'firedAt', '1998-11-12T11:40:00Z', 'portions', 1, 'weightG', null, 'state', 'fired'),
          'a line row: id, dish, table name from the session snapshot, fire time, portions, weight, state');
select is((select l ->> 'state' from jsonb_array_elements(pg_temp.ls('1998-11-12') -> 'lines') l where l ->> 'lineId' = pg_temp.id('l5')::text), 'voided', 'a line voided after the send reads voided');
select is((select array_agg(l ->> 'lineId' order by o) from jsonb_array_elements(pg_temp.ls('1998-11-12', 'tagliatelle') -> 'lines') with ordinality t (l, o)), array[pg_temp.id('t1')::text, pg_temp.id('t2')::text],
          'with a dish: its lines only');
select is((select count(*)::int from jsonb_array_elements(pg_temp.ls('1998-11-12') -> 'lines') l where l ->> 'lineId' = pg_temp.id('draft')::text), 0, 'a draft line is not a served plate');
select is((select array_agg(l ->> 'lineId') from jsonb_array_elements(pg_temp.ls('1998-11-13') -> 'lines') l), array[pg_temp.id('l4')::text], 'D+1 holds the 19:00 line only');
select is(pg_temp.ls('1998-11-14') -> 'lines' -> 0, jsonb_build_object('lineId', pg_temp.id('w1'), 'menuItemName', 'Lasagne Demo', 'tableName', 'Tavolo 1 (demo)', 'firedAt', '1998-11-14T12:00:00Z', 'portions', 1.4, 'weightG', 350, 'state', 'fired'),
          'today is allowed; a weighed line shows 350 g and 1.4 portions');
select is(pg_temp.err($$select pg_temp.ls('1998-11-15')$$), 'P0001 date_in_future', 'tomorrow: P0001 date_in_future');
select is(pg_temp.err($$select pg_temp.ls(null)$$), '22023 query_invalid', 'no date: 22023');
select is(jsonb_array_length(pg_temp.ls('1996-05-05') -> 'lines'), 200, '201 lines: the reply holds 200');
select is(pg_temp.ls('1996-05-05') -> 'truncated', 'true'::jsonb, 'and truncated is true');
select is(jsonb_array_length(pg_temp.ls('1998-11-12', 'tagliatelle') -> 'lines'), 2, 'the dish filter keeps its own count');
select is(jsonb_array_length(app.trace_line_search_json('11111111-1111-4111-8111-111111111111', 'owner', '1998-11-12', gen_random_uuid(), '1998-11-14T11:00Z') -> 'lines'), 0, 'an unknown dish id: no lines');

-- 5. trace_order_line ----------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.tl('l1'),
  jsonb_build_object(
    'line', jsonb_build_object('lineId', pg_temp.id('l1'), 'menuItemName', 'Lasagne Demo', 'tableName', 'Tavolo 1 (demo)', 'businessDate', '1998-11-12', 'firedAt', '1998-11-12T11:40:00Z', 'state', 'fired', 'portions', 1, 'weightG', null),
    'batches', jsonb_build_array(jsonb_build_object('batchId', pg_temp.id('b1'), 'lotCode', (select lot_code from public.batch where id = pg_temp.id('b1')), 'recipeName', 'Ragù Demo',
                                                    'producedAt', '1998-11-10T09:00:00Z', 'portions', 1, 'reversed', false)),
    'rawDirect', '[]'::jsonb,
    'lots', jsonb_build_array(pg_temp.lotx() || jsonb_build_object('ingredient', jsonb_build_object('id', pg_temp.id('farina'), 'name', 'Farina Demo')))),
  'trace_order_line(L1): the line, its batch, no direct raw rows, and lot X with its supplier and (owner) invoice');
select is(pg_temp.tl('l5') -> 'line' ->> 'state', 'voided', 'the voided line reads voided');
select is(pg_temp.tl('l5') -> 'batches' -> 0 -> 'reversed', 'true'::jsonb, 'and its batch row is reversed');
select is(pg_temp.tl('l3') -> 'batches' -> 0 ->> 'batchId', pg_temp.id('c1')::text, 'L3 was served from the split child C1');
select is(pg_temp.tl('l3') -> 'lots' -> 0 ->> 'lotId', pg_temp.id('x')::text, 'and reaches lot X through the root''s inputs');
select is(pg_temp.tl('l3') -> 'line' ->> 'businessDate', '1998-11-12', 'L3, fired 01:30 Rome on D+1, is business day D');
select is(pg_temp.tl('t1') -> 'rawDirect',
  jsonb_build_array(jsonb_build_object('ingredient', jsonb_build_object('id', pg_temp.id('farina'), 'name', 'Farina Demo'), 'qty', 0.2, 'unit', 'kg', 'lot', pg_temp.lotx())),
  'the Tagliatelle line: a direct raw row with lot X');
select is(pg_temp.tl('t1') -> 'batches', '[]'::jsonb, 'and no batch');
select is(pg_temp.tl('t1') -> 'lots' -> 0 ->> 'lotId', pg_temp.id('x')::text, 'lots: lot X from the direct row');
select is(pg_temp.tl('w1') -> 'line', jsonb_build_object('lineId', pg_temp.id('w1'), 'menuItemName', 'Lasagne Demo', 'tableName', 'Tavolo 1 (demo)', 'businessDate', '1998-11-14', 'firedAt', '1998-11-14T12:00:00Z',
          'state', 'fired', 'portions', 1.4, 'weightG', 350), 'the weighed line: 350 g, 1.4 portions');
select is(pg_temp.tl('draft'),
  jsonb_build_object('line', jsonb_build_object('lineId', pg_temp.id('draft'), 'menuItemName', 'Lasagne Demo', 'tableName', 'Tavolo 1 (demo)', 'businessDate', '1998-11-12', 'firedAt', null, 'state', 'draft', 'portions', 1, 'weightG', null),
                     'batches', '[]'::jsonb, 'rawDirect', '[]'::jsonb, 'lots', '[]'::jsonb),
  'a draft line answers with empty lists');
select is(jsonb_array_length(pg_temp.tl('l1') -> 'lots'), 1, 'distinct lots: one');

-- 6. Privacy: the guest on the traced table never appears ------------------------------------------------------------------------------------------
select is((select count(*)::int from public.reservation_table rt where rt.dining_table_id = '13000000-0000-4000-8000-000000000001'), 1, 'setup: the seated reservation is on the traced table');
select is((select count(*)::int from (
             select k from pg_temp.all_keys(pg_temp.tl('l1')) k union all select k from pg_temp.all_keys(pg_temp.tb('b1')) k union all select k from pg_temp.all_keys(pg_temp.tb('c1')) k
              union all select k from pg_temp.all_keys(pg_temp.ls('1998-11-12')) k union all select k from pg_temp.all_keys(pg_temp.tl('t1')) k) x
            where x.k ~* 'phone|email|guest|contact'), 0, 'no key of any reply matches phone, email, guest or contact');
select is((select count(*)::int from (select (pg_temp.tl('l1'))::text t union all select (pg_temp.tl('t1'))::text union all select (pg_temp.tb('b1'))::text union all select (pg_temp.ls('1998-11-12'))::text) x
            where x.t like '%Segreto%' or x.t like '%+39000111222%' or x.t like '%ospite.segreto%'), 0, 'and no value equals or contains the guest''s name, phone or e-mail');
select is(app.payload_money_keys(pg_temp.tl('l1')) || app.payload_money_keys(pg_temp.tb('b1')) || app.payload_money_keys(pg_temp.ls('1998-11-12')), '{}'::text[], 'no money key in any reply');

-- 7. Roles and tenancy through the public functions ------------------------------------------------------------------------------------------------
select is(pg_temp.out(format('select public.trace_batch(%L)', pg_temp.id('b1'))), 'ok', 'owner: public.trace_batch');
select is(pg_temp.out(format('select public.trace_order_line(%L)', pg_temp.id('l1'))), 'ok', 'owner: public.trace_order_line');
select is(pg_temp.out(format('select public.trace_line_search(%L, null)', '1998-11-12'::date)), 'ok', 'owner: public.trace_line_search');
select is((select count(*)::int from pg_temp.all_keys(pg_temp.tb('c1', 'owner')) k where k = 'invoice'), 1, 'the owner''s batch reply has the invoice key');
select is((select count(*)::int from pg_temp.all_keys(pg_temp.tb('c1', 'chef')) k where k in ('invoice', 'purchase')), 0, 'the chef''s batch reply has no invoice key');
select is((select count(*)::int from pg_temp.all_keys(pg_temp.tl('l1', 'chef')) k where k in ('invoice', 'purchase')), 0, 'the chef''s plate reply has no invoice key');
select is((select count(*)::int from pg_temp.all_keys(pg_temp.tl('l1', 'admin')) k where k = 'invoice'), 1, 'the admin''s plate reply has the invoice key');
select pg_temp.act_as('chef');
select is(pg_temp.out(format('select public.trace_batch(%L)', pg_temp.id('b1'))), 'ok', 'chef: public.trace_batch');
select is(pg_temp.out(format('select public.trace_order_line(%L)', pg_temp.id('l1'))), 'ok', 'chef: public.trace_order_line');
select is(pg_temp.out(format('select public.trace_line_search(%L, null)', '1998-11-12'::date)), 'ok', 'chef: public.trace_line_search');
select is((select count(*)::int from pg_temp.all_keys(public.trace_batch(pg_temp.id('c1'))) k where k = 'invoice'), 0, 'the chef gets no invoice key from the public function either');
select pg_temp.act_as('admin');
select is(pg_temp.out(format('select public.trace_batch(%L)', pg_temp.id('b1'))), 'ok', 'admin at aal2: public.trace_batch');
select pg_temp.act_as('waiter');
select matches(pg_temp.out(format('select public.trace_batch(%L)', pg_temp.id('b1'))), '^42501 ', 'waiter: trace_batch 42501');
select matches(pg_temp.out(format('select public.trace_order_line(%L)', pg_temp.id('l1'))), '^42501 ', 'waiter: trace_order_line 42501');
select matches(pg_temp.out(format('select public.trace_line_search(%L, null)', '1998-11-12'::date)), '^42501 ', 'waiter: trace_line_search 42501');
select pg_temp.act_as('owner');
select is(pg_temp.out(format('select public.trace_batch(%L)', pg_temp.id('batchb'))), 'P0002 not_found', 'tenant B''s batch id: P0002 not_found');
select is(pg_temp.out(format('select public.trace_batch(%L)', gen_random_uuid())), 'P0002 not_found', 'an unknown batch id: the same P0002 not_found');
select is(pg_temp.out(format('select public.trace_order_line(%L)', pg_temp.id('lineb'))), 'P0002 not_found', 'tenant B''s line id: P0002 not_found');
select is(pg_temp.out(format('select public.trace_order_line(%L)', gen_random_uuid())), 'P0002 not_found', 'an unknown line id: the same P0002 not_found');
select pg_temp.act_as('ownerb');
select is(pg_temp.out(format('select public.trace_batch(%L)', pg_temp.id('b1'))), 'P0002 not_found', 'tenant A''s batch as owner B: P0002 not_found');
select is(public.trace_batch(pg_temp.id('batchb')) -> 'batch' ->> 'lotCode', '981101-RAG-1', 'owner B reads its own batch');
select is(jsonb_array_length(public.trace_line_search('1998-11-12', null) -> 'lines'), 1, 'owner B''s line search holds only its own line');
select pg_temp.act_as('owner');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('trace_batch', 'trace_order_line', 'trace_line_search') and p.prosecdef
            and p.proconfig = array['search_path=""'] and has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE')
            and not has_function_privilege('service_role', p.oid, 'EXECUTE')), 3, 'the three public functions are definers with an empty search_path, executable by authenticated only');

select * from finish();
rollback;
