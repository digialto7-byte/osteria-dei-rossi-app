-- M19 step 1: order_line_cost, the union batch_movement_shape_ck, the batch reversal guard and the two indexes (M19 plan
-- §3.2 step 1; ADR-019). Rows are inserted as the migration owner. Fake data only; found by id, never by position.
-- Two of everything: two tenants, two batches, two lines, two users per role that matters.
begin;
create extension if not exists pgtap with schema extensions;
select plan(71);

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
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111',
   'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111',
   'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)'),
  ('10000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'Dispensa (demo)'),
  ('10000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Cella B (demo)');
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', 'batch', 1,
   'spezzatino (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e2', '11111111-1111-4111-8111-111111111111', 'plate', 1,
   'spezzatino con polenta (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e4', '22222222-2222-4222-8222-222222222222', 'plate', 1,
   'piatto b (demo)', 'b1000000-0000-4000-8000-00000000000b');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit,
                           portions_per_batch, shelf_life_hours, created_by) values
  ('ed000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111',
   'ec000000-0000-4000-8000-0000000000e1', 1, '2026-10-01T00:00Z', 'Spezzatino (demo)', 6, 'kg', 30, 72,
   'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by) values
  ('ed000000-0000-4000-8000-0000000000d2', '11111111-1111-4111-8111-111111111111',
   'ec000000-0000-4000-8000-0000000000e2', 1, '2026-10-01T00:00Z', 'Spezzatino con polenta (demo)',
   'a1000000-0000-4000-8000-00000000000a');
insert into public.menu_item (id, tenant_id, name, category, course_default, recipe_key, created_by, updated_by) values
  ('11000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Spezzatino con polenta (demo)',
   'Secondi', 'secondi', 'ec000000-0000-4000-8000-0000000000e2',
   'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Solo B (demo)', 'Altro', 'dolci',
   null, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('13000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Tavolo 1 (demo)', 1,
   'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('13000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Tavolo B (demo)', 1,
   'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date,
    created_by, updated_by) values
  ('14000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   '13000000-0000-4000-8000-000000000001', 'Tavolo 1 (demo)', 4, 'a1000000-0000-4000-8000-00000000000a',
   '2026-10-24', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('14000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222',
   '13000000-0000-4000-8000-0000000000b1', 'Tavolo B (demo)', 2, 'b1000000-0000-4000-8000-00000000000b',
   '2026-10-24', 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate,
    price_source, client_updated_at, created_by, updated_by) values
  ('15000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   '14000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'secondi', 1, 14, 10, 'menu',
   '2026-10-24 12:00+00', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'),
  ('15000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
   '14000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'secondi', 1, 14, 10, 'menu',
   '2026-10-24 12:00+00', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'),
  ('15000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222',
   '14000000-0000-4000-8000-0000000000b1', '11000000-0000-4000-8000-0000000000b1', 'dolci', 1, 5, 10, 'menu',
   '2026-10-24 12:00+00', 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code,
    lot_seq, produced_at, produced_by, output_qty, output_unit, portions_computed, portions_initial, shelf_life_hours,
    use_by, location_id, created_by) values
  ('ba000000-0000-4000-8000-0000000000b1', '11111111-1111-4111-8111-111111111111',
   'ec000000-0000-4000-8000-0000000000e1', 'ed000000-0000-4000-8000-0000000000d1', 1, '261023-SPEZZA-1',
   '2026-10-23', 'SPEZZA', 1, '2026-10-23T08:00Z', 'c1000000-0000-4000-8000-00000000000c', 6.2, 'kg', 31, 31, 72,
   '2026-10-26T08:00Z', '10000000-0000-4000-8000-0000000000a1', 'c1000000-0000-4000-8000-00000000000c'),
  ('ba000000-0000-4000-8000-0000000000b2', '11111111-1111-4111-8111-111111111111',
   'ec000000-0000-4000-8000-0000000000e1', 'ed000000-0000-4000-8000-0000000000d1', 1, '261023-SPEZZA-2',
   '2026-10-23', 'SPEZZA', 2, '2026-10-23T08:00Z', 'c1000000-0000-4000-8000-00000000000c', 6.2, 'kg', 31, 31, 72,
   '2026-10-26T08:00Z', '10000000-0000-4000-8000-0000000000a2', 'c1000000-0000-4000-8000-00000000000c');

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

-- A batch_movement of tenant A (ref_id null = the batch itself).
create function pg_temp.mkmove(
  p_type text, p_portions numeric, p_ref_type text, p_ref_id uuid default null, p_reason text default null,
  p_batch uuid default 'ba000000-0000-4000-8000-0000000000b1', p_reverses uuid default null
) returns uuid language sql as $$
  insert into public.batch_movement (tenant_id, batch_id, type, portions, reason_code, ref_type, ref_id, reverses_id,
      effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', p_batch, p_type::public.batch_movement_type, p_portions, p_reason,
      p_ref_type, coalesce(p_ref_id, p_batch), p_reverses, '2026-10-23', 'c1000000-0000-4000-8000-00000000000c')
  returning id
$$;
-- One order_line_cost row of tenant A (or the given tenant) with overridable columns.
create function pg_temp.mkcost(
  p_line uuid default '15000000-0000-4000-8000-000000000001', p_recipe text default '''ed000000-0000-4000-8000-0000000000d2''',
  p_total text default '2.98', p_unit text default '2.98', p_incomplete text default 'false',
  p_missing_ing text default '''{}''', p_tenant text default '''11111111-1111-4111-8111-111111111111'''
) returns text language plpgsql as $$
begin
  return pg_temp.err(format($f$
    insert into public.order_line_cost (order_line_id, tenant_id, recipe_id, total_cost, unit_cost_at_sale, incomplete,
        missing_ingredient_ids, cost_at, created_by)
    values (%L, %s, %s, %s, %s, %s, %s::uuid[], '2026-10-24T12:00Z', 'd1000000-0000-4000-8000-00000000000d')$f$,
    p_line, p_tenant, p_recipe, p_total, p_unit, p_incomplete, p_missing_ing));
end
$$;

-- order_line_cost: shapes ---------------------------------------------------------------------------------------
select is(pg_temp.mkcost(), 'ok', 'a complete cost row (recipe, total 2,98, unit 2,98) is accepted');
select alike(pg_temp.mkcost('15000000-0000-4000-8000-000000000002', p_unit => 'null'),
  '23514%order_line_cost_complete_ck%', 'a total without a unit cost is refused');
select alike(pg_temp.mkcost('15000000-0000-4000-8000-000000000002', p_total => 'null', p_unit => 'null'),
  '23514%order_line_cost_complete_ck%', 'incomplete false with a null total is refused');
select alike(pg_temp.mkcost('15000000-0000-4000-8000-000000000002', p_recipe => 'null'),
  '23514%order_line_cost_complete_ck%', 'a null recipe with incomplete false is refused');
select alike(pg_temp.mkcost('15000000-0000-4000-8000-000000000002',
    p_missing_ing => '''{1a000000-0000-4000-8000-00000000001a}'''),
  '23514%order_line_cost_complete_ck%', 'missing ingredients with incomplete false are refused');
select alike(pg_temp.mkcost('15000000-0000-4000-8000-000000000002', p_total => '-0.01'),
  '23514%', 'a negative total is refused');
select alike(pg_temp.mkcost('15000000-0000-4000-8000-000000000002', p_unit => '-0.01'),
  '23514%', 'a negative unit cost is refused');
select alike(pg_temp.mkcost('15000000-0000-4000-8000-000000000002', p_total => 'null', p_unit => 'null',
    p_incomplete => 'true'),
  '23514%order_line_cost_complete_ck%', 'incomplete true with a recipe and no missing list is refused');
select is(pg_temp.mkcost('15000000-0000-4000-8000-000000000002', p_total => 'null', p_unit => 'null',
    p_incomplete => 'true', p_missing_ing => '''{1a000000-0000-4000-8000-00000000001a}'''), 'ok',
  'an incomplete row with a missing ingredient and null totals is accepted');
select alike(pg_temp.mkcost('15000000-0000-4000-8000-0000000000b1'),
  '23503%order_line_cost_line_fkey%', 'a line of tenant B under tenant A is refused (composite key)');
select alike(pg_temp.mkcost('15000000-0000-4000-8000-0000000000b1', p_recipe => 'null', p_total => 'null',
    p_unit => 'null', p_incomplete => 'true', p_tenant => '''22222222-2222-4222-8222-222222222222'''),
  '23503%order_line_cost_created_by_fkey%', 'a tenant B row created by a tenant A user is refused');
select alike(pg_temp.err($$ insert into public.order_line_cost (order_line_id, tenant_id, recipe_id, total_cost,
      unit_cost_at_sale, incomplete, cost_at, created_by)
    values ('15000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222',
      'ed000000-0000-4000-8000-0000000000d2', 1, 1, false, now(), 'b1000000-0000-4000-8000-00000000000b') $$),
  '23503%order_line_cost_recipe_fkey%', 'a recipe of tenant A under tenant B is refused');
select alike(pg_temp.mkcost('15000000-0000-4000-8000-000000000001'), '23505%',
  'a second cost row for the same line is refused (primary key)');

-- order_line_cost: append-only ----------------------------------------------------------------------------------
select is(pg_temp.err($$ update public.order_line_cost set total_cost = 1
  where order_line_id = '15000000-0000-4000-8000-000000000001' $$), 'P0001 append_only', 'UPDATE is refused');
select is(pg_temp.err($$ delete from public.order_line_cost
  where order_line_id = '15000000-0000-4000-8000-000000000001' $$), 'P0001 append_only', 'DELETE is refused');
select is(pg_temp.err($$ truncate public.order_line_cost $$), 'P0001 append_only', 'TRUNCATE is refused');

-- order_line_cost: RLS ------------------------------------------------------------------------------------------
insert into public.order_line_cost (order_line_id, tenant_id, recipe_id, total_cost, unit_cost_at_sale, incomplete,
    cost_at, created_by)
  values ('15000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', null, null, null, true,
    '2026-10-24T12:00Z', 'b1000000-0000-4000-8000-00000000000b');
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.seen('order_line_cost'), 2::bigint, 'owner A reads A''s two rows and not B''s');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is(pg_temp.seen('order_line_cost'), 2::bigint, 'admin A reads A''s two rows');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.seen('order_line_cost'), 0::bigint, 'chef A reads 0 rows (Q16 = V6)');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(pg_temp.seen('order_line_cost'), 0::bigint, 'waiter A reads 0 rows');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(pg_temp.seen('order_line_cost'), 1::bigint, 'owner B reads only B''s row');
select is((select order_line_id from public.order_line_cost), '15000000-0000-4000-8000-0000000000b1'::uuid,
  'and it is B''s own line');
reset role;

-- order_line_cost: privileges -----------------------------------------------------------------------------------
select ok(has_table_privilege('service_role', 'public.order_line_cost', 'select'), 'service_role may select');
select ok(not has_table_privilege('service_role', 'public.order_line_cost', 'insert'), 'service_role may not insert');
select ok(not has_table_privilege('service_role', 'public.order_line_cost', 'update'), 'service_role may not update');
select ok(not has_table_privilege('service_role', 'public.order_line_cost', 'delete'), 'service_role may not delete');
select ok(has_table_privilege('authenticated', 'public.order_line_cost', 'select'), 'authenticated may select (RLS filters)');
select ok(not has_table_privilege('authenticated', 'public.order_line_cost', 'insert')
  and not has_table_privilege('authenticated', 'public.order_line_cost', 'update')
  and not has_table_privilege('authenticated', 'public.order_line_cost', 'delete'),
  'authenticated may not write');
select ok(not has_table_privilege('anon', 'public.order_line_cost', 'select')
  and not has_table_privilege('anon', 'public.order_line_cost', 'insert'), 'anon has no privilege');
select ok((select relrowsecurity from pg_class where oid = 'public.order_line_cost'::regclass), 'RLS is on');

-- batch_movement shapes: every M15 case of 130, as before ----------------------------------------------------------
select is(pg_temp.err($$ select pg_temp.mkmove('produce', 31, 'batch') $$), 'ok', 'M14 produce rows are still valid');
select is(pg_temp.err($$ select pg_temp.mkmove('count', -1, 'batch_adjust', gen_random_uuid()) $$), 'ok',
  'a count of -1 with ref batch_adjust is accepted');
select is(pg_temp.err($$ select pg_temp.mkmove('count', 2, 'batch_adjust', gen_random_uuid()) $$), 'ok',
  'a count of +2 with ref batch_adjust is accepted');
select alike(pg_temp.err($$ select pg_temp.mkmove('count', -1, 'batch_adjust', gen_random_uuid(), 'spoilage') $$),
  '23514%batch_movement_shape_ck%', 'a count with a reason is refused');
select alike(pg_temp.err($$ select pg_temp.mkmove('count', -1, 'batch_discard', gen_random_uuid()) $$),
  '23514%batch_movement_shape_ck%', 'a count with another ref_type is refused');
select is(pg_temp.err($$ select pg_temp.mkmove('waste', -3, 'batch_discard', gen_random_uuid(), 'spoilage') $$), 'ok',
  'a waste of -3 spoilage with ref batch_discard is accepted');
select is(pg_temp.err($$ select pg_temp.mkmove('waste', -2, 'staff_meal', gen_random_uuid(), 'staff_meal') $$), 'ok',
  'a waste with ref staff_meal and reason staff_meal is accepted');
select alike(pg_temp.err($$ select pg_temp.mkmove('waste', 3, 'batch_discard', gen_random_uuid(), 'spoilage') $$),
  '23514%batch_movement_shape_ck%', 'a waste of +3 is refused');
select alike(pg_temp.err($$ select pg_temp.mkmove('waste', -3, 'batch_discard', gen_random_uuid(), 'count_correction') $$),
  '23514%batch_movement_shape_ck%', 'a waste with count_correction is refused');
select alike(pg_temp.err($$ select pg_temp.mkmove('waste', -3, 'batch_discard', gen_random_uuid(), 'foo') $$),
  '23514%batch_movement_shape_ck%', 'a waste with an unknown reason is refused');
select alike(pg_temp.err($$ select pg_temp.mkmove('waste', -3, 'batch_discard') $$),
  '23514%batch_movement_shape_ck%', 'a waste without a reason is refused');
select alike(pg_temp.err($$ select pg_temp.mkmove('waste', -2, 'staff_meal', gen_random_uuid(), 'spoilage') $$),
  '23514%batch_movement_shape_ck%', 'a waste with ref staff_meal and reason spoilage is refused');
select alike(pg_temp.err($$ select pg_temp.mkmove('waste', -2, 'batch', gen_random_uuid(), 'spoilage') $$),
  '23514%batch_movement_shape_ck%', 'a waste with another ref_type is refused');
select is(pg_temp.err($$ select pg_temp.mkmove('split', -4, 'batch_split', gen_random_uuid()) $$), 'ok',
  'a split of -4 with ref_id other than the batch is accepted');
select is(pg_temp.err($$ select pg_temp.mkmove('split', 4, 'batch_split', 'ba000000-0000-4000-8000-0000000000b2',
    p_batch => 'ba000000-0000-4000-8000-0000000000b2') $$), 'ok',
  'a split of +4 whose ref_id is its own batch is accepted');
select alike(pg_temp.err($$ select pg_temp.mkmove('split', -4, 'batch_split') $$),
  '23514%batch_movement_shape_ck%', 'a split of -4 whose ref_id is its own batch is refused');
select alike(pg_temp.err($$ select pg_temp.mkmove('split', 4, 'batch_split', gen_random_uuid()) $$),
  '23514%batch_movement_shape_ck%', 'a split of +4 whose ref_id is another batch is refused');
select alike(pg_temp.err($$ select pg_temp.mkmove('split', -4, 'batch_split', gen_random_uuid(), 'spoilage') $$),
  '23514%batch_movement_shape_ck%', 'a split with a reason is refused');
select alike(pg_temp.err($$ select pg_temp.mkmove('count', 1, 'batch_adjust', gen_random_uuid(),
    p_reverses => (select id from public.batch_movement where type = 'produce')) $$),
  '23514%batch_movement_shape_ck%', 'a count with reverses_id is refused');
select alike(pg_temp.err($$ select pg_temp.mkmove('produce', -1, 'batch', p_batch => 'ba000000-0000-4000-8000-0000000000b2') $$),
  '23514%batch_movement_shape_ck%', 'a produce of -1 is still refused');
select alike(pg_temp.err($$ select pg_temp.mkmove('produce', 31, 'batch') $$),
  '23505%batch_movement_produce_uq%', 'a second produce for the same batch is still refused');

-- batch_movement shapes: the M19 additions ----------------------------------------------------------------------
select is(pg_temp.err($$ select pg_temp.mkmove('consume', -1, 'order_line', '15000000-0000-4000-8000-000000000001') $$),
  'ok', 'consume of -1 with ref order_line is accepted (M19)');
select alike(pg_temp.err($$ select pg_temp.mkmove('consume', 1, 'order_line', '15000000-0000-4000-8000-000000000001') $$),
  '23514%batch_movement_shape_ck%', 'consume of +1 without a reversal is refused');
select alike(pg_temp.err($$ select pg_temp.mkmove('consume', -1, 'order_line', '15000000-0000-4000-8000-000000000001',
    'spoilage') $$), '23514%batch_movement_shape_ck%', 'consume with a reason is refused');
select alike(pg_temp.err($$ select pg_temp.mkmove('consume', -1, 'batch') $$),
  '23514%batch_movement_shape_ck%', 'consume with ref batch is refused');
select is(pg_temp.err($$ select pg_temp.mkmove('consume', 1, 'order_void', '15000000-0000-4000-8000-000000000001',
    p_reverses => (select id from public.batch_movement where type = 'consume' and portions = -1)) $$),
  'ok', 'a reversal of +1 of that consume, ref order_void, is accepted');
select alike(pg_temp.err($$ select pg_temp.mkmove('consume', 1, 'order_void', '15000000-0000-4000-8000-000000000001',
    p_reverses => (select id from public.batch_movement where type = 'consume' and portions = -1)) $$),
  '23505%batch_movement_reverses_uq%', 'a second reversal of the same consume is refused');
select alike(pg_temp.err($$ select pg_temp.mkmove('consume', 1, 'order_line', '15000000-0000-4000-8000-000000000001',
    p_reverses => (select id from public.batch_movement where type = 'consume' and portions = -1)) $$),
  '23514%batch_movement_shape_ck%', 'a reversal with ref order_line is refused');
select alike(pg_temp.err($$ select pg_temp.mkmove('consume', -1, 'order_void', '15000000-0000-4000-8000-000000000001',
    p_reverses => (select id from public.batch_movement where type = 'consume' and portions = -1)) $$),
  '23514%batch_movement_shape_ck%', 'a reversal of -1 is refused');
select is(pg_temp.err($$ select pg_temp.mkmove('waste', -1, 'order_void', '15000000-0000-4000-8000-000000000001',
    'plating_error') $$), 'ok', 'a void waste of -1, plating_error, ref order_void is accepted');
select alike(pg_temp.err($$ select pg_temp.mkmove('waste', -1, 'order_void', '15000000-0000-4000-8000-000000000001',
    'count_correction') $$), '23514%batch_movement_shape_ck%', 'a void waste with count_correction is refused');
select alike(pg_temp.err($$ select pg_temp.mkmove('waste', -1, 'order_void', '15000000-0000-4000-8000-000000000001') $$),
  '23514%batch_movement_shape_ck%', 'a void waste without a reason is refused');
select alike(pg_temp.err($$ select pg_temp.mkmove('count', -1, 'order_void', '15000000-0000-4000-8000-000000000001') $$),
  '23514%batch_movement_shape_ck%', 'a count with ref order_void is refused');

-- the reversal guard
select alike(pg_temp.err($$ select pg_temp.mkmove('consume', 31, 'order_void', '15000000-0000-4000-8000-000000000001',
    p_reverses => (select id from public.batch_movement where type = 'produce' and batch_id = 'ba000000-0000-4000-8000-0000000000b1')) $$),
  'P0001 batch_reversal_mismatch', 'a reversal of a produce is refused by the guard');
select is(pg_temp.err($$ select pg_temp.mkmove('consume', -1, 'order_line', '15000000-0000-4000-8000-000000000002',
    p_batch => 'ba000000-0000-4000-8000-0000000000b2') $$), 'ok', 'a consume on the second batch (setup)');
select is(pg_temp.err($$ select pg_temp.mkmove('consume', -2, 'order_line', '15000000-0000-4000-8000-000000000002') $$),
  'ok', 'a consume of -2 on the first batch (setup)');
select alike(pg_temp.err($$ select pg_temp.mkmove('consume', 1, 'order_void', '15000000-0000-4000-8000-000000000002',
    p_reverses => (select id from public.batch_movement where type = 'consume' and portions = -1
                     and batch_id = 'ba000000-0000-4000-8000-0000000000b2')) $$),
  'P0001 batch_reversal_mismatch', 'a reversal on another batch than the original is refused');
select alike(pg_temp.err($$ select pg_temp.mkmove('consume', 1, 'order_void', '15000000-0000-4000-8000-000000000002',
    p_reverses => (select id from public.batch_movement where type = 'consume' and portions = -2)) $$),
  'P0001 batch_reversal_mismatch', 'a reversal of +1 for a consume of -2 is refused');

-- indexes ---------------------------------------------------------------------------------------------------------
select is((select indexdef from pg_indexes where schemaname = 'public' and indexname = 'batch_movement_ref_idx'),
  'CREATE INDEX batch_movement_ref_idx ON public.batch_movement USING btree (tenant_id, ref_type, ref_id)',
  'batch_movement_ref_idx is on (tenant_id, ref_type, ref_id)');
select is((select indexdef from pg_indexes where schemaname = 'public' and indexname = 'order_line_fired_idx'),
  'CREATE INDEX order_line_fired_idx ON public.order_line USING btree (tenant_id, fired_at) WHERE (fired_at IS NOT NULL)',
  'order_line_fired_idx is partial on fired_at is not null');
select ok(exists (select 1 from pg_trigger where tgrelid = 'public.batch_movement'::regclass
    and tgname = 'batch_movement_reversal_guard' and tgenabled <> 'D'), 'the reversal guard trigger is installed');

select * from finish();
rollback;
