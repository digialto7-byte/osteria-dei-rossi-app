-- M5 step 2: raw_lot, stock_movement and v_stock_on_hand (M5 plan §3.3, §3.5). Checks and keys,
-- RLS (the chef reads lots but never a movement, because a movement carries unit_cost), and the
-- derived on-hand view (security_invoker, no cost column).
begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

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
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare A'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'chef', 'Cuoco A'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111',
   'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere A'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111',
   'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin DigiAlto');

-- Master data: A has "Cella" and "Manzo"; B has its own location and ingredient.
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella'),
  ('10000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Cella B');
insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('1a000000-0000-4000-8000-00000000001a', '11111111-1111-4111-8111-111111111111', 'Manzo', 'kg'),
  ('1b000000-0000-4000-8000-00000000001b', '22222222-2222-4222-8222-222222222222', 'Pollo B', 'kg');
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111',
   'Fornitore Demo Srl', 'IT12345678903');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, original_filename)
  values ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
          '11111111-1111-4111-8111-111111111111/2026/e1000000-0000-4000-8000-0000000000e1.pdf',
          'application/pdf', 2048, 'fattura.pdf');
insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty,
                                 unit_price, line_amount, field_confidence, extracted) values
  ('a2000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111',
   'e1000000-0000-4000-8000-0000000000e1', 1, 'Manzo fesa', 2, 12.75, 25.5, '{}', '{}'),
  ('a2000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111',
   'e1000000-0000-4000-8000-0000000000e1', 2, 'Manzo girello', 3.5, 11, 38.5, '{}', '{}'),
  ('a2000000-0000-4000-8000-0000000000a3', '11111111-1111-4111-8111-111111111111',
   'e1000000-0000-4000-8000-0000000000e1', 3, 'Manzo macinato', 1, 9, 9, '{}', '{}');

-- Two lots of the same ingredient in the same location: 2 kg and 3,5 kg, each with its receipt.
insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id,
                            lot_code, expiry, received_on, qty_received, base_unit, source_qty,
                            source_unit, base_factor, created_by) values
  ('10700000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111',
   '1a000000-0000-4000-8000-00000000001a', '10000000-0000-4000-8000-0000000000a1',
   '5a000000-0000-4000-8000-00000000005a', 'a2000000-0000-4000-8000-0000000000a1',
   'L-001', '2026-10-10', '2026-09-29', 2, 'kg', 2, 'kg', 1, 'a1000000-0000-4000-8000-00000000000a'),
  ('10700000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111',
   '1a000000-0000-4000-8000-00000000001a', '10000000-0000-4000-8000-0000000000a1',
   '5a000000-0000-4000-8000-00000000005a', 'a2000000-0000-4000-8000-0000000000a2',
   null, null, '2026-09-29', 3.5, 'kg', 3500, 'g', 0.001, 'a1000000-0000-4000-8000-00000000000a');
insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty,
                                   unit_cost, ref_type, ref_id, effective_on, created_by) values
  ('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-00000000001a',
   '10700000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'receipt', 2,
   12.75, 'invoice_line', 'a2000000-0000-4000-8000-0000000000a1', '2026-09-29',
   'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-00000000001a',
   '10700000-0000-4000-8000-0000000000a2', '10000000-0000-4000-8000-0000000000a1', 'receipt', 3.5,
   11, 'invoice_line', 'a2000000-0000-4000-8000-0000000000a2', '2026-09-29',
   'a1000000-0000-4000-8000-00000000000a');

-- Helper: a receipt insert for line 3 with one thing changed.
create function pg_temp.receipt(qty numeric, lot uuid, ref_type text, ref_id uuid) returns void
  language sql as $$
  insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty,
                                     unit_cost, ref_type, ref_id, effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-00000000001a', lot,
          '10000000-0000-4000-8000-0000000000a1', 'receipt', qty, 9, ref_type, ref_id,
          '2026-09-29', 'a1000000-0000-4000-8000-00000000000a')
$$;
create function pg_temp.lot3(qty_received numeric, line uuid, created_by uuid) returns void
  language sql as $$
  insert into public.raw_lot (tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id,
                              received_on, qty_received, base_unit, source_qty, source_unit,
                              base_factor, created_by)
  values ('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-00000000001a',
          '10000000-0000-4000-8000-0000000000a1', '5a000000-0000-4000-8000-00000000005a', line,
          '2026-09-29', qty_received, 'kg', 1, 'kg', 1, created_by)
$$;

-- Movement checks (as the migration owner).
select throws_ok($$ select pg_temp.receipt(0, '10700000-0000-4000-8000-0000000000a1', 'invoice_line',
  'a2000000-0000-4000-8000-0000000000a3') $$, '23514', null, 'a receipt of 0 is refused');
select throws_ok($$ select pg_temp.receipt(-1, '10700000-0000-4000-8000-0000000000a1', 'invoice_line',
  'a2000000-0000-4000-8000-0000000000a3') $$, '23514', null, 'a receipt of -1 is refused');
select throws_ok($$ select pg_temp.receipt(1, null, 'invoice_line',
  'a2000000-0000-4000-8000-0000000000a3') $$, '23514', 'new row for relation "stock_movement" violates check constraint "stock_movement_receipt_ck"',
  'a receipt without a lot is refused');
select throws_ok($$ select pg_temp.receipt(1, '10700000-0000-4000-8000-0000000000a1', 'x',
  'a2000000-0000-4000-8000-0000000000a3') $$, '23514', 'new row for relation "stock_movement" violates check constraint "stock_movement_receipt_ck"',
  'a receipt with ref_type x is refused');
select throws_ok($$ select pg_temp.receipt(1, '10700000-0000-4000-8000-0000000000a1', 'invoice_line',
  'a2000000-0000-4000-8000-0000000000a1') $$, '23505', null,
  'a second receipt for the same invoice line is refused');
select throws_ok($$ insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id,
  location_id, type, qty, unit_cost, ref_type, ref_id, effective_on)
  values ('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-00000000001a',
  '10700000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'receipt', 1, 9,
  'invoice_line', 'a2000000-0000-4000-8000-0000000000a3', '2026-09-29') $$, '23502', null,
  'created_by is required on a movement');
select throws_ok($$ insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id,
  location_id, type, qty, unit_cost, ref_type, ref_id, effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', '1b000000-0000-4000-8000-00000000001b',
  '10700000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'receipt', 1, 9,
  'invoice_line', 'a2000000-0000-4000-8000-0000000000a3', '2026-09-29',
  'a1000000-0000-4000-8000-00000000000a') $$, '23503', null,
  'tenant B''s ingredient on a tenant A movement is refused');
select throws_ok($$ insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id,
  location_id, type, qty, unit_cost, ref_type, ref_id, effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-00000000001a',
  '10700000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000b1', 'receipt', 1, 9,
  'invoice_line', 'a2000000-0000-4000-8000-0000000000a3', '2026-09-29',
  'a1000000-0000-4000-8000-00000000000a') $$, '23503', null,
  'tenant B''s location on a tenant A movement is refused');

-- Lot checks.
select throws_ok($$ select pg_temp.lot3(1, 'a2000000-0000-4000-8000-0000000000a1',
  'a1000000-0000-4000-8000-00000000000a') $$, '23505', null,
  'a second lot for the same invoice line is refused');
select throws_ok($$ select pg_temp.lot3(0, 'a2000000-0000-4000-8000-0000000000a3',
  'a1000000-0000-4000-8000-00000000000a') $$, '23514', null, 'a lot of 0 is refused');
select throws_ok($$ select pg_temp.lot3(1.5, 'a2000000-0000-4000-8000-0000000000a3',
  'a1000000-0000-4000-8000-00000000000a') $$, '23514', null,
  'qty_received must equal round(source_qty x base_factor, 4)');
select throws_ok($$ select pg_temp.lot3(1, 'a2000000-0000-4000-8000-0000000000a3', null) $$,
  '23502', null, 'created_by is required on a lot');
select throws_ok($$ insert into public.raw_lot (tenant_id, ingredient_id, location_id, supplier_id,
  invoice_line_id, received_on, qty_received, base_unit, source_qty, source_unit, base_factor,
  created_by)
  values ('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-00000000001a',
  '10000000-0000-4000-8000-0000000000b1', '5a000000-0000-4000-8000-00000000005a',
  'a2000000-0000-4000-8000-0000000000a3', '2026-09-29', 1, 'kg', 1, 'kg', 1,
  'a1000000-0000-4000-8000-00000000000a') $$, '23503', null,
  'tenant B''s location on a tenant A lot is refused');
select throws_ok($$ insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id,
  location_id, type, qty, unit_cost, ref_type, ref_id, effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-00000000001a',
  '10700000-0000-4000-8000-0000000000ff', '10000000-0000-4000-8000-0000000000a1', 'receipt', 1, 9,
  'invoice_line', 'a2000000-0000-4000-8000-0000000000a3', '2026-09-29',
  'a1000000-0000-4000-8000-00000000000a') $$, '23503', null, 'an unknown lot is refused');
select throws_ok($$ insert into public.raw_lot (tenant_id, ingredient_id, location_id, supplier_id,
  invoice_line_id, lot_code, received_on, qty_received, base_unit, source_qty, source_unit,
  base_factor, created_by)
  values ('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-00000000001a',
  '10000000-0000-4000-8000-0000000000a1', '5a000000-0000-4000-8000-00000000005a',
  'a2000000-0000-4000-8000-0000000000a3', repeat('x', 65), '2026-09-29', 1, 'kg', 1, 'kg', 1,
  'a1000000-0000-4000-8000-00000000000a') $$, '23514', null, 'a 65-character lot code is refused');

create function pg_temp.act_as(auth_id uuid, app_role text, tenant uuid) returns void
  language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated',
    'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
grant execute on function pg_temp.act_as(uuid, text, uuid) to authenticated;

set local role authenticated;

-- Owner A reads everything of A; the view shows the two lots.
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', 'owner',
  '11111111-1111-4111-8111-111111111111');
select is((select count(*)::int from public.raw_lot), 2, 'owner A reads A''s lots');
select is((select count(*)::int from public.stock_movement), 2, 'owner A reads A''s movements');
select is((select count(*)::int from public.v_stock_on_hand), 2,
  'the view has one row per lot of one ingredient in one location');
select is((select sum(qty_on_hand) from public.v_stock_on_hand), 5.5000::numeric,
  'the lots of 2 kg and 3,5 kg sum to 5,5 kg');
select throws_ok($$ insert into public.raw_lot (ingredient_id) values (null) $$, '42501', null,
  'authenticated cannot insert a lot');
select throws_ok($$ insert into public.stock_movement (qty) values (1) $$, '42501', null,
  'authenticated cannot insert a movement');

select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', 'admin',
  '11111111-1111-4111-8111-111111111111');
select is((select count(*)::int from public.raw_lot), 2, 'admin A reads A''s lots');
select is((select count(*)::int from public.stock_movement), 2, 'admin A reads A''s movements');

-- Founder decision 2026-10-22: the chef never sees a EUR cost. Lots carry no cost; movements do.
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', 'chef',
  '11111111-1111-4111-8111-111111111111');
select is((select count(*)::int from public.raw_lot), 2, 'chef A reads A''s lots');
select is((select count(*)::int from public.stock_movement), 0,
  'chef A reads no movements (unit_cost is a cost)');
select is((select count(*)::int from public.v_stock_on_hand), 0,
  'chef A reads no rows of the on-hand view (security_invoker applies the movement policy)');

select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', 'waiter',
  '11111111-1111-4111-8111-111111111111');
select is((select count(*)::int from public.raw_lot), 0, 'waiter A reads no lots');
select is((select count(*)::int from public.stock_movement), 0, 'waiter A reads no movements');
select is((select count(*)::int from public.v_stock_on_hand), 0, 'waiter A reads no on-hand rows');

select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', 'owner',
  '22222222-2222-4222-8222-222222222222');
select is((select count(*)::int from public.raw_lot), 0, 'owner B reads none of A''s lots');
select is((select count(*)::int from public.stock_movement), 0, 'owner B reads none of A''s movements');
select is((select count(*)::int from public.v_stock_on_hand), 0, 'owner B reads none of A''s on-hand rows');

reset role;

select ok((select c.reloptions @> array['security_invoker=true'] from pg_class c
            where c.oid = 'public.v_stock_on_hand'::regclass),
  'v_stock_on_hand is a security_invoker view');
select is_empty(
  $$ select attname::text from pg_attribute
      where attrelid = 'public.v_stock_on_hand'::regclass and attnum > 0
        and attname ~* '(cost|price|margin|amount)' $$,
  'the view has no cost-like column');
select is_empty(
  $$ select attname::text from pg_attribute
      where attrelid = 'public.raw_lot'::regclass and attnum > 0
        and attname ~* '(cost|price|margin|amount)' $$,
  'raw_lot has no cost-like column');

select * from finish();
rollback;
