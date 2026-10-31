-- M23 step 3 (docs/plans/2026-10-31-m23-push-forecast.md §3.1.2-3, §3.2, §3.8, §5; AT1, AT2 (data), AT3): app.push_list_json / public.push_list. The fixture of plan §3.8 at
-- N = Wed 2026-11-04 10:00 CET: batches B1-B5 (+ a negative one), lots L1-L5. Only quantity above zero, only the PRD 2.4 window, expired stock counted not listed, the order
-- by hours to use-by, DST hours, the cost at risk (unknown is never zero), the plates and batch recipes that use each row, broken recipes skipped and counted, the role-shaped
-- JSON (the chef has no euro and no price), two tenants. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(76);

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
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore A (demo)', 'IT12345678903'),
  ('5b000000-0000-4000-8000-00000000005b', '22222222-2222-4222-8222-222222222222', 'Fornitore B (demo)', 'IT00000000000');
insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('1a000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Manzo (demo)', 'kg'),
  ('1a000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'Parmigiano (demo)', 'kg'),
  ('1a000000-0000-4000-8000-0000000000a3', '11111111-1111-4111-8111-111111111111', 'Pomodoro (demo)', 'kg'),
  ('1a000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Manzo B (demo)', 'kg');
-- Batch recipes: Spezzatino (uses Manzo) and Ragù (uses Pomodoro). Plates: Spezzatino con polenta (1 portion of Spezzatino) and Tagliatelle al ragù (1 portion of Ragù + Parmigiano).
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'spezzatino', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e3', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'ragu (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e2', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'spezzatino con polenta', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e5', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'tagliatelle al ragu (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000eb', '22222222-2222-4222-8222-222222222222', 'batch', 1, 'stufato b (demo)', 'b1000000-0000-4000-8000-00000000000b');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch, shelf_life_hours, created_by) values
  ('ed000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e1', 1, '2026-10-01', 'Spezzatino', 2, 'kg', 10, 48, 'a1000000-0000-4000-8000-00000000000a'),
  ('ed000000-0000-4000-8000-0000000000d3', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e3', 1, '2026-10-01', 'Ragù (demo)', 2, 'kg', 10, 48, 'a1000000-0000-4000-8000-00000000000a'),
  ('ed000000-0000-4000-8000-0000000000db', '22222222-2222-4222-8222-222222222222', 'ec000000-0000-4000-8000-0000000000eb', 1, '2026-10-01', 'Stufato B (demo)', 2, 'kg', 10, 48, 'b1000000-0000-4000-8000-00000000000b');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by) values
  ('ed000000-0000-4000-8000-0000000000d2', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e2', 1, '2026-10-01', 'Spezzatino con polenta', 'a1000000-0000-4000-8000-00000000000a'),
  ('ed000000-0000-4000-8000-0000000000d6', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e5', 1, '2026-10-01', 'Tagliatelle al ragù (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, sub_recipe_key, qty, unit, yield_factor, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d1', 1, '1a000000-0000-4000-8000-0000000000a1', null, 2, 'kg', 1, 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d3', 1, '1a000000-0000-4000-8000-0000000000a3', null, 1, 'kg', 1, 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d2', 1, null, 'ec000000-0000-4000-8000-0000000000e1', 1, 'porz', 1, 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d6', 1, null, 'ec000000-0000-4000-8000-0000000000e3', 1, 'porz', 1, 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d6', 2, '1a000000-0000-4000-8000-0000000000a2', null, 0.02, 'kg', 1, 'a1000000-0000-4000-8000-00000000000a');
-- I1 stew plate (menu 14.00), I1x an INACTIVE item on the same plate, I2 tagliatelle (11.00).
insert into public.menu_item (id, tenant_id, name, category, course_default, recipe_key, is_active, created_by, updated_by) values
  ('11000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Spezzatino con polenta', 'Secondi', 'secondi', 'ec000000-0000-4000-8000-0000000000e2', true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-0000000000f1', '11111111-1111-4111-8111-111111111111', 'Spezzatino vecchio (demo)', 'Secondi', 'secondi', 'ec000000-0000-4000-8000-0000000000e2', false, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Tagliatelle al ragù (demo)', 'Primi', 'primi', 'ec000000-0000-4000-8000-0000000000e5', true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.menu_item_price (tenant_id, menu_item_id, price, vat_rate, valid_from, created_by) values
  ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000001', 14, 10, '2026-10-01T00:00Z', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-0000000000f1', 14, 10, '2026-10-01T00:00Z', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000002', 11, 10, '2026-10-01T00:00Z', 'a1000000-0000-4000-8000-00000000000a');

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
-- A batch of tenant A: produced 48 h before p_use_by, p_made portions, p_sold consumed; cost p_cost per portion (null = incomplete).
create function pg_temp.mkbatch(p_n int, p_key uuid, p_use_by timestamptz, p_made int, p_sold int, p_cost numeric) returns void language plpgsql as $$
declare
  v_id uuid := ('ba000000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid;
begin
  insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code, lot_seq, produced_at, produced_by, output_qty, output_unit,
      portions_computed, portions_initial, shelf_life_hours, use_by, state, location_id, created_by)
    values (v_id, '11111111-1111-4111-8111-111111111111', p_key,
      case when p_key = 'ec000000-0000-4000-8000-0000000000e1' then 'ed000000-0000-4000-8000-0000000000d1'::uuid else 'ed000000-0000-4000-8000-0000000000d3'::uuid end,
      1, '261101-LOT-' || p_n, '2026-11-01', 'LOT', p_n, p_use_by - interval '48 hours', 'a1000000-0000-4000-8000-00000000000a', 2, 'kg', p_made, p_made, 48, p_use_by, 'fresh',
      '10000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-00000000000a');
  insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', v_id, 'produce', p_made, 'batch', v_id, '2026-11-01', 'a1000000-0000-4000-8000-00000000000a');
  if p_sold > 0 then
    insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
      values ('11111111-1111-4111-8111-111111111111', v_id, 'consume', -p_sold, 'order_line', gen_random_uuid(), '2026-11-03', 'a1000000-0000-4000-8000-00000000000a');
  end if;
  if p_cost is null then
    insert into public.batch_cost (batch_id, tenant_id, total_cost, unit_cost_frozen, incomplete, missing_ingredient_ids, cost_at, created_by)
      values (v_id, '11111111-1111-4111-8111-111111111111', null, null, true, array['1a000000-0000-4000-8000-0000000000a3']::uuid[], p_use_by - interval '48 hours', 'a1000000-0000-4000-8000-00000000000a');
  else
    insert into public.batch_cost (batch_id, tenant_id, total_cost, unit_cost_frozen, incomplete, missing_ingredient_ids, cost_at, created_by)
      values (v_id, '11111111-1111-4111-8111-111111111111', round(p_cost * p_made, 4), p_cost, false, '{}', p_use_by - interval '48 hours', 'a1000000-0000-4000-8000-00000000000a');
  end if;
end
$$;
create sequence pg_temp.inv_seq;
-- A lot of tenant A with its receipt (cost p_cost per kg); p_expiry null = no expiry.
create function pg_temp.mklot(p_n int, p_ing int, p_expiry date, p_received date, p_qty numeric, p_cost numeric, p_code text) returns void language plpgsql as $$
declare
  v_n int := nextval('pg_temp.inv_seq');
  v_inv uuid := ('9a000000-0000-4000-8000-0000000000' || lpad(v_n::text, 2, '0'))::uuid;
  v_line uuid := ('9b000000-0000-4000-8000-0000000000' || lpad(v_n::text, 2, '0'))::uuid;
  v_lot uuid := ('1e000000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid;
  v_ing uuid := ('1a000000-0000-4000-8000-0000000000a' || p_ing)::uuid;
begin
  insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id)
    values (v_inv, '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111/2026/' || v_inv || '.pdf', 'application/pdf', 2048, 'received', '5a000000-0000-4000-8000-00000000005a');
  insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price, line_amount, field_confidence, extracted)
    values (v_line, '11111111-1111-4111-8111-111111111111', v_inv, 1, 'Riga demo', 1, 1, 1, '{}', '{}');
  insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code, expiry, received_on, qty_received, base_unit, source_qty, source_unit, base_factor, created_by)
    values (v_lot, '11111111-1111-4111-8111-111111111111', v_ing, '10000000-0000-4000-8000-0000000000a1', '5a000000-0000-4000-8000-00000000005a', v_line, p_code, p_expiry, p_received,
            p_qty, 'kg', p_qty, 'kg', 1, 'a1000000-0000-4000-8000-00000000000a');
  insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type, ref_id, effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', v_ing, v_lot, '10000000-0000-4000-8000-0000000000a1', 'receipt', p_qty, p_cost, 'invoice_line', v_line, p_received, 'a1000000-0000-4000-8000-00000000000a');
end
$$;
create function pg_temp.use_lot(p_n int, p_ing int, p_qty numeric) returns void language sql as $$
  insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, ref_type, ref_id, effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', ('1a000000-0000-4000-8000-0000000000a' || p_ing)::uuid, ('1e000000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid,
          '10000000-0000-4000-8000-0000000000a1', 'consumption', -p_qty, 'test', gen_random_uuid(), '2026-11-03', 'a1000000-0000-4000-8000-00000000000a')
$$;
-- The reply row with this id, and the ids in order.
create function pg_temp.row_of(j jsonb, p_id text) returns jsonb language sql as $$
  select jsonb_path_query_first(j -> 'rows', '$[*] ? (@.id == $id)', jsonb_build_object('id', p_id)) $$;
create function pg_temp.ids_of(j jsonb) returns text[] language sql as $$
  select coalesce(array_agg(e ->> 'id' order by n), '{}') from jsonb_array_elements(j -> 'rows') with ordinality t(e, n) $$;
create function pg_temp.keys_of(j jsonb) returns text[] language sql as $$
  with recursive w(v) as (
    select j
    union all
    select c.v from w, lateral (
      select e.value as v from jsonb_each(case when jsonb_typeof(w.v) = 'object' then w.v else '{}'::jsonb end) e
      union all
      select a.value from jsonb_array_elements(case when jsonb_typeof(w.v) = 'array' then w.v else '[]'::jsonb end) a) c)
  select coalesce(array_agg(distinct k order by k), '{}') from w, lateral jsonb_object_keys(case when jsonb_typeof(w.v) = 'object' then w.v else '{}'::jsonb end) k $$;
create function pg_temp.pl(p_now timestamptz, p_role text default 'owner') returns jsonb language sql as $$
  select app.push_list_json('11111111-1111-4111-8111-111111111111', p_role, p_now) $$;
create temp table r (nm text primary key, j jsonb);
grant all on r to public;

-- Batches (plan §3.8). Stew = e1, ragù = e3. use_by is the instant; made/sold give the portions left.
select pg_temp.mkbatch(1, 'ec000000-0000-4000-8000-0000000000e1', '2026-11-04T19:00Z', 31, 17, 2.7143);  -- B1: 14 left, 10 h, listed
select pg_temp.mkbatch(2, 'ec000000-0000-4000-8000-0000000000e3', '2026-11-04T13:00Z', 6, 0, null);      -- B2: 6 left, 4 h, cost unknown
select pg_temp.mkbatch(3, 'ec000000-0000-4000-8000-0000000000e1', '2026-11-04T17:00Z', 10, 10, 2.70);    -- B3: 0 left, absent
select pg_temp.mkbatch(4, 'ec000000-0000-4000-8000-0000000000e3', '2026-11-04T07:00Z', 3, 0, 1.50);      -- B4: use-by passed, expired
select pg_temp.mkbatch(5, 'ec000000-0000-4000-8000-0000000000e1', '2026-11-05T11:00Z', 30, 0, 2.70);     -- B5: 26 h, outside the window
select pg_temp.mkbatch(6, 'ec000000-0000-4000-8000-0000000000e1', '2026-11-04T20:00Z', 10, 11, 2.70);    -- B6: -1 portion, absent
-- Lots (Manzo = ingredient 1, Parmigiano = 2, Pomodoro = 3).
select pg_temp.mklot(1, 1, '2026-11-05', '2026-11-02', 3.2, 12.00, 'LM-1');   -- L1: 38 h, 38.40
select pg_temp.mklot(2, 2, '2026-11-04', '2026-11-02', 0.5, 20.00, 'LP-2');   -- L2: 14 h, 10.00
select pg_temp.mklot(3, 2, '2026-11-04', '2026-11-02', 3, 20.00, 'LP-3');     -- L3: fully consumed, absent
select pg_temp.use_lot(3, 2, 3);
select pg_temp.mklot(4, 1, '2026-11-03', '2026-11-01', 1, 12.00, 'LM-4');     -- L4: expired yesterday
select pg_temp.mklot(5, 1, null, '2026-11-01', 5, 12.00, 'LM-5');            -- L5: no expiry
-- Tenant B: a due-soon batch of its own.
insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code, lot_seq, produced_at, produced_by, output_qty, output_unit,
    portions_computed, portions_initial, shelf_life_hours, use_by, state, location_id, created_by) values
  ('ba000000-0000-4000-8000-0000000000bb', '22222222-2222-4222-8222-222222222222', 'ec000000-0000-4000-8000-0000000000eb', 'ed000000-0000-4000-8000-0000000000db', 1, '261101-STB-1', '2026-11-01', 'STB', 1,
   '2026-11-02T20:00Z', 'b1000000-0000-4000-8000-00000000000b', 2, 'kg', 10, 10, 48, '2026-11-04T20:00Z', 'fresh', '10000000-0000-4000-8000-0000000000b1', 'b1000000-0000-4000-8000-00000000000b');
insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by) values
  ('22222222-2222-4222-8222-222222222222', 'ba000000-0000-4000-8000-0000000000bb', 'produce', 10, 'batch', 'ba000000-0000-4000-8000-0000000000bb', '2026-11-01', 'b1000000-0000-4000-8000-00000000000b');

insert into r values ('own', pg_temp.pl('2026-11-04T09:00Z', 'owner'));

-- Window, AT1, AT3 ------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.ids_of((select j from r where nm = 'own')),
          array['ba000000-0000-4000-8000-000000000002', 'ba000000-0000-4000-8000-000000000001', '1e000000-0000-4000-8000-000000000002', '1e000000-0000-4000-8000-000000000001'],
          'AT3: B2 (4 h), B1 (10 h), L2 (14 h), L1 (38 h): by hours to use-by ascending');
select is((select j -> 'totals' ->> 'count' from r where nm = 'own'), '4', 'four rows');
select is(pg_temp.row_of((select j from r where nm = 'own'), 'ba000000-0000-4000-8000-000000000003'), null, 'AT1: B3 (0 portions) is absent');
select is(pg_temp.row_of((select j from r where nm = 'own'), 'ba000000-0000-4000-8000-000000000006'), null, 'AT1: a batch at -1 portion is absent');
select is(pg_temp.row_of((select j from r where nm = 'own'), '1e000000-0000-4000-8000-000000000003'), null, 'AT1: L3 (0 kg) is absent');
select is(pg_temp.row_of((select j from r where nm = 'own'), 'ba000000-0000-4000-8000-000000000004'), null, 'B4 (use-by passed) is absent');
select is(pg_temp.row_of((select j from r where nm = 'own'), 'ba000000-0000-4000-8000-000000000005'), null, 'B5 (26 h) is outside the 24 h window');
select is(pg_temp.row_of((select j from r where nm = 'own'), '1e000000-0000-4000-8000-000000000004'), null, 'L4 (expired yesterday) is absent');
select is(pg_temp.row_of((select j from r where nm = 'own'), '1e000000-0000-4000-8000-000000000005'), null, 'L5 (no expiry) is absent');
select is((select j -> 'expired' from r where nm = 'own'), '{"batches": 1, "lots": 1}'::jsonb, 'expired stock is counted, not listed: 1 batch (B4), 1 lot (L4)');

-- AT2 data: the B1 row ----------------------------------------------------------------------------------------------------------------------------
select is((pg_temp.row_of((select j from r where nm = 'own'), 'ba000000-0000-4000-8000-000000000001') - 'plates' - 'batchRecipes' - 'hoursToUseBy' - 'costAtRiskEur'),
          '{"id": "ba000000-0000-4000-8000-000000000001", "kind": "batch", "name": "Spezzatino", "unit": "porz", "lotCode": "261101-LOT-1", "madeOn": "2026-11-02", "quantity": 14,
            "useByAt": "2026-11-04T19:00:00Z", "expiryDate": null}'::jsonb, 'AT2: the B1 row: name, lot, made on Monday, use-by instant, 14 portions');
select is((pg_temp.row_of((select j from r where nm = 'own'), 'ba000000-0000-4000-8000-000000000001') ->> 'hoursToUseBy')::numeric, 10.0, 'B1: 10.0 hours');
select is((pg_temp.row_of((select j from r where nm = 'own'), 'ba000000-0000-4000-8000-000000000001') ->> 'costAtRiskEur')::numeric, 38.0002, 'B1: cost at risk 14 x 2.7143 = 38.0002');
select is((pg_temp.row_of((select j from r where nm = 'own'), 'ba000000-0000-4000-8000-000000000001') -> 'plates'),
          '[{"name": "Spezzatino con polenta", "pushed": false, "pushUntil": null, "pushPrice": null, "menuItemId": "11000000-0000-4000-8000-000000000001"}]'::jsonb,
          'B1: the plate that uses it (the inactive item on the same plate is not listed), not pushed');
select is((pg_temp.row_of((select j from r where nm = 'own'), 'ba000000-0000-4000-8000-000000000001') -> 'batchRecipes'), '[]'::jsonb, 'a batch has no batchRecipes');
select is((pg_temp.row_of((select j from r where nm = 'own'), 'ba000000-0000-4000-8000-000000000002') ->> 'hoursToUseBy')::numeric, 4.0, 'B2: 4.0 hours');
select is((pg_temp.row_of((select j from r where nm = 'own'), 'ba000000-0000-4000-8000-000000000002') -> 'costAtRiskEur'), 'null'::jsonb, 'B2: an incomplete batch cost is null, not zero');
select is((pg_temp.row_of((select j from r where nm = 'own'), 'ba000000-0000-4000-8000-000000000002') #>> '{plates,0,name}'), 'Tagliatelle al ragù (demo)', 'B2: the tagliatelle use it');

-- Lots ------------------------------------------------------------------------------------------------------------------------------------------------
select is((pg_temp.row_of((select j from r where nm = 'own'), '1e000000-0000-4000-8000-000000000001') - 'plates' - 'batchRecipes'),
          '{"id": "1e000000-0000-4000-8000-000000000001", "kind": "lot", "name": "Manzo (demo)", "unit": "kg", "lotCode": "LM-1", "madeOn": "2026-11-02", "quantity": 3.2,
            "useByAt": "2026-11-05T23:00:00Z", "expiryDate": "2026-11-05", "hoursToUseBy": 38.0, "costAtRiskEur": 38.4000}'::jsonb,
          'L1: lot row: received Monday, expires Thursday (use-by = midnight that ends it), 38.0 h, 3.2 kg, 38.40');
select is((pg_temp.row_of((select j from r where nm = 'own'), '1e000000-0000-4000-8000-000000000001') -> 'batchRecipes'),
          '[{"name": "Spezzatino", "recipeKey": "ec000000-0000-4000-8000-0000000000e1"}]'::jsonb, 'L1: reaches plates only through the stew: batchRecipes = Spezzatino');
select is((pg_temp.row_of((select j from r where nm = 'own'), '1e000000-0000-4000-8000-000000000001') -> 'plates'), '[]'::jsonb, 'L1: no plate uses Manzo directly');
select is((pg_temp.row_of((select j from r where nm = 'own'), '1e000000-0000-4000-8000-000000000002') #>> '{plates,0,name}'), 'Tagliatelle al ragù (demo)', 'L2: the tagliatelle use the Parmigiano directly');
select is((pg_temp.row_of((select j from r where nm = 'own'), '1e000000-0000-4000-8000-000000000002') ->> 'hoursToUseBy')::numeric, 14.0, 'L2: 14.0 hours (use-by 2026-11-04T23:00Z)');
select is((pg_temp.row_of((select j from r where nm = 'own'), '1e000000-0000-4000-8000-000000000002') ->> 'costAtRiskEur')::numeric, 10.0000, 'L2: 0.5 kg x 20.00 = 10.00');

-- Totals, cost -----------------------------------------------------------------------------------------------------------------------------------
select is((select (j -> 'totals' ->> 'costAtRiskEur')::numeric from r where nm = 'own'), 86.4002, 'totals: 38.0002 + 10.0000 + 38.4000 = 86.4002 (the unknown one is not zero-added)');
select is((select j -> 'totals' ->> 'unvaluedCount' from r where nm = 'own'), '1', 'totals: one row has no known cost');
select is((select j ->> 'businessDate' from r where nm = 'own'), '2026-11-04', 'businessDate');
select is((select j ->> 'asOf' from r where nm = 'own'), '2026-11-04T09:00:00Z', 'asOf');
select is((select j ->> 'unresolvedRecipes' from r where nm = 'own'), '0', 'no unresolved recipe in the baseline');
select is((select j ->> 'role' from r where nm = 'own'), 'owner', 'role');

-- Roles: admin equals owner, chef has no euro and no price --------------------------------------------------------------------------------------------
insert into r values ('adm', pg_temp.pl('2026-11-04T09:00Z', 'admin'));
insert into r values ('chf', pg_temp.pl('2026-11-04T09:00Z', 'chef'));
select is((select (a.j - 'role') = (o.j - 'role') from r a, r o where a.nm = 'adm' and o.nm = 'own'), true, 'the admin reply equals the owner''s apart from role');
select is((select j -> 'rows' -> 0 ? 'costAtRiskEur' from r where nm = 'chf'), false, 'chef: no costAtRiskEur on a row');
select is((select j -> 'totals' ? 'costAtRiskEur' from r where nm = 'chf'), false, 'chef: no costAtRiskEur in the totals');
select is((select j -> 'totals' ? 'unvaluedCount' from r where nm = 'chf'), false, 'chef: no unvaluedCount in the totals');
select is((select j -> 'rows' -> 1 -> 'plates' -> 0 ? 'pushPrice' from r where nm = 'chf'), false, 'chef: no pushPrice on a plate');
select is((select array_agg(k) from unnest(pg_temp.keys_of((select j from r where nm = 'chf'))) k where k ~* '(cost|price|eur)'), null, 'chef: a recursive key walk finds no cost, price or eur key');
select is((select j -> 'rows' -> 1 -> 'plates' -> 0 ? 'pushPrice' from r where nm = 'own'), true, 'owner: a plate carries pushPrice');
select is((select pg_temp.ids_of(j) from r where nm = 'chf'), (select pg_temp.ids_of(j) from r where nm = 'own'), 'the chef sees the same rows in the same order');

-- Pushed flag ------------------------------------------------------------------------------------------------------------------------------------
select app.push_menu_item_at('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', '11000000-0000-4000-8000-000000000001', '{"pushed":true,"pushPrice":12}', '2026-11-04T09:00Z');
insert into r values ('pushed', pg_temp.pl('2026-11-04T09:01Z', 'owner'));
insert into r values ('pushedchef', pg_temp.pl('2026-11-04T09:01Z', 'chef'));
select is((pg_temp.row_of((select j from r where nm = 'pushed'), 'ba000000-0000-4000-8000-000000000001') #>> '{plates,0,pushed}'), 'true', 'after a push of the stew plate, B1''s plate is pushed');
select is((pg_temp.row_of((select j from r where nm = 'pushed'), 'ba000000-0000-4000-8000-000000000001') #>> '{plates,0,pushPrice}')::numeric, 12::numeric, 'with its push price (owner)');
select is((pg_temp.row_of((select j from r where nm = 'pushed'), 'ba000000-0000-4000-8000-000000000001') #>> '{plates,0,pushUntil}'), '2026-11-05T01:00:00Z', 'and its end');
select is((pg_temp.row_of((select j from r where nm = 'pushedchef'), 'ba000000-0000-4000-8000-000000000001') -> 'plates' -> 0 ? 'pushPrice'), false, 'the chef sees pushed but not the price');
select is((pg_temp.row_of((select j from r where nm = 'pushedchef'), 'ba000000-0000-4000-8000-000000000001') #>> '{plates,0,pushed}'), 'true', 'the chef sees the push marker');

-- Lot boundary: 00:30 CET, business date still 2026-11-04 ---------------------------------------------------------------------------------------------
insert into r values ('late', pg_temp.pl('2026-11-04T23:30Z', 'owner'));
select is((select j ->> 'businessDate' from r where nm = 'late'), '2026-11-04', 'at 00:30 CET the business date is still 11-04');
select is(pg_temp.row_of((select j from r where nm = 'late'), '1e000000-0000-4000-8000-000000000002'), null, 'L2 (expired 11-04, past its midnight) is absent');
select is((select j -> 'expired' ->> 'lots' from r where nm = 'late'), '2', 'and counted as expired (with L4)');
select is((pg_temp.row_of((select j from r where nm = 'late'), '1e000000-0000-4000-8000-000000000001') ->> 'hoursToUseBy')::numeric, 23.5, 'L1 has 23.5 h left');

-- Ties, a transferred lot --------------------------------------------------------------------------------------------------------------------------
select pg_temp.mkbatch(7, 'ec000000-0000-4000-8000-0000000000e1', '2026-11-05T05:00Z', 5, 0, 2.00);
select pg_temp.mkbatch(8, 'ec000000-0000-4000-8000-0000000000e3', '2026-11-05T05:00Z', 5, 0, 2.00);
select pg_temp.mkbatch(9, 'ec000000-0000-4000-8000-0000000000e1', '2026-11-05T05:00Z', 5, 0, 2.00);
select is((select array_agg(e ->> 'id' order by n) from jsonb_array_elements(pg_temp.pl('2026-11-04T09:00Z') -> 'rows') with ordinality t(e, n) where e ->> 'hoursToUseBy' = '20.0'),
          array['ba000000-0000-4000-8000-000000000008', 'ba000000-0000-4000-8000-000000000007', 'ba000000-0000-4000-8000-000000000009'],
          'AT3: a tie on hours goes by name (collate C: Ragù before Spezzatino), then id');
select pg_temp.mklot(6, 2, '2026-11-05', '2026-11-02', 2, 20.00, 'LP-6');
insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, ref_type, ref_id, effective_on, created_by) values
  ('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-0000000000a2', '1e000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-0000000000a1', 'transfer', -1.5, 'transfer', '77000000-0000-4000-8000-000000000001', '2026-11-03', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-0000000000a2', '1e000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-0000000000a2', 'transfer', 1.5, 'transfer', '77000000-0000-4000-8000-000000000001', '2026-11-03', 'a1000000-0000-4000-8000-00000000000a');
select is((select count(*)::int from jsonb_array_elements(pg_temp.pl('2026-11-04T09:00Z') -> 'rows') e where e ->> 'id' = '1e000000-0000-4000-8000-000000000006'), 1, 'a lot moved between two locations is one row');
select is((pg_temp.row_of(pg_temp.pl('2026-11-04T09:00Z'), '1e000000-0000-4000-8000-000000000006') ->> 'quantity')::numeric, 2::numeric, 'with the summed quantity (2 kg)');

-- DST: hours are elapsed time, lot midnights are local ------------------------------------------------------------------------------------------------
select pg_temp.mkbatch(10, 'ec000000-0000-4000-8000-0000000000e1', '2026-10-25T02:00Z', 5, 0, 2.00);   -- 03:00 CET on the autumn night, seen at 22:00 CEST
select pg_temp.mklot(7, 1, '2026-10-24', '2026-10-20', 1, 12.00, 'LM-7');
select pg_temp.mklot(8, 1, '2026-10-25', '2026-10-20', 1, 12.00, 'LM-8');
select pg_temp.mklot(9, 1, '2027-03-28', '2027-03-20', 1, 12.00, 'LM-9');
insert into r values ('aut', pg_temp.pl('2026-10-24T20:00Z', 'owner'));
insert into r values ('spr', pg_temp.pl('2027-03-27T20:00Z', 'owner'));
select is((pg_temp.row_of((select j from r where nm = 'aut'), 'ba000000-0000-4000-8000-000000000010') ->> 'hoursToUseBy')::numeric, 6.0, 'DST: use-by 03:00 CET seen at 22:00 CEST is 6.0 elapsed hours');
select is((pg_temp.row_of((select j from r where nm = 'aut'), '1e000000-0000-4000-8000-000000000007') ->> 'useByAt'), '2026-10-24T22:00:00Z', 'DST: a lot expiring 2026-10-24 ends at the CEST midnight (22:00Z)');
select is((pg_temp.row_of((select j from r where nm = 'aut'), '1e000000-0000-4000-8000-000000000008') ->> 'useByAt'), '2026-10-25T23:00:00Z', 'DST: a lot expiring 2026-10-25 ends at the CET midnight (23:00Z)');
select is((pg_temp.row_of((select j from r where nm = 'aut'), '1e000000-0000-4000-8000-000000000008') ->> 'hoursToUseBy')::numeric, 27.0, 'DST: and is 27.0 elapsed hours away');
select is((pg_temp.row_of((select j from r where nm = 'spr'), '1e000000-0000-4000-8000-000000000009') ->> 'useByAt'), '2027-03-28T22:00:00Z', 'DST: a lot expiring 2027-03-28 ends at the CEST midnight (22:00Z)');
select is((pg_temp.row_of((select j from r where nm = 'spr'), '1e000000-0000-4000-8000-000000000009') ->> 'hoursToUseBy')::numeric, 26.0, 'DST: spring, 26.0 elapsed hours from 21:00 CET');

-- Broken recipes: skipped and counted, the list still answers -----------------------------------------------------------------------------------------
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e9', '11111111-1111-4111-8111-111111111111', 'sub', 1, 'salsa senza versione (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e7', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'tagliatelle rotte (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e8', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'brasato rotto (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by) values
  ('ed000000-0000-4000-8000-0000000000d7', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e7', 1, '2026-10-01', 'Tagliatelle rotte (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch, shelf_life_hours, created_by) values
  ('ed000000-0000-4000-8000-0000000000d8', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e8', 1, '2026-10-01', 'Brasato rotto (demo)', 2, 'kg', 10, 48, 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, sub_recipe_key, qty, unit, yield_factor, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d7', 1, null, 'ec000000-0000-4000-8000-0000000000e3', 1, 'porz', 1, 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d7', 2, '1a000000-0000-4000-8000-0000000000a2', null, 0.02, 'kg', 1, 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d7', 3, null, 'ec000000-0000-4000-8000-0000000000e9', 1, 'kg', 1, 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d8', 1, '1a000000-0000-4000-8000-0000000000a1', null, 1, 'kg', 1, 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d8', 2, null, 'ec000000-0000-4000-8000-0000000000e9', 1, 'kg', 1, 'a1000000-0000-4000-8000-00000000000a');
insert into public.menu_item (id, tenant_id, name, category, course_default, recipe_key, is_active, created_by, updated_by) values
  ('11000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Tagliatelle rotte (demo)', 'Primi', 'primi', 'ec000000-0000-4000-8000-0000000000e7', true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.menu_item_price (tenant_id, menu_item_id, price, vat_rate, valid_from, created_by) values
  ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000003', 11, 10, '2026-10-01T00:00Z', 'a1000000-0000-4000-8000-00000000000a');
select is(left(pg_temp.err($$select * from app.plate_raw_needs('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d7')$$), 5), 'P0001', 'T1/T2: a plate whose sub-recipe has no version in force raises P0001');
select is(left(pg_temp.err($$select * from app.batch_requirements('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d8', '2026-11-04T09:00Z')$$), 5), 'P0001', 'T1: a batch recipe whose sub-recipe has no version in force raises P0001');
insert into r values ('broken', pg_temp.pl('2026-11-04T09:00Z', 'owner'));
select is((pg_temp.row_of((select j from r where nm = 'broken'), 'ba000000-0000-4000-8000-000000000002') -> 'plates' -> 0 ->> 'name'), 'Tagliatelle al ragù (demo)', 'the broken plate is skipped from B2''s plates');
select is((select jsonb_array_length(pg_temp.row_of(j, 'ba000000-0000-4000-8000-000000000002') -> 'plates') from r where nm = 'broken'), 1, 'and only the sound plate is left there');
select is((select jsonb_array_length(pg_temp.row_of(j, '1e000000-0000-4000-8000-000000000002') -> 'plates') from r where nm = 'broken'), 1, 'and from L2''s plates');
select is((select jsonb_array_length(pg_temp.row_of(j, '1e000000-0000-4000-8000-000000000001') -> 'batchRecipes') from r where nm = 'broken'), 1, 'the broken batch recipe is skipped from L1''s batchRecipes');
select is((select j ->> 'unresolvedRecipes' from r where nm = 'broken'), '2', 'unresolvedRecipes is 2 and the list still answers');

-- Index, tenancy, public function ----------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from pg_indexes where schemaname = 'public' and indexname = 'batch_use_by_idx' and indexdef like '%(tenant_id, use_by)%'), 1, 'batch_use_by_idx exists on (tenant_id, use_by)');
select is(position('ba000000-0000-4000-8000-0000000000bb' in (select j::text from r where nm = 'own')), 0, 'no tenant B id in A''s reply');
select is((select j -> 'totals' ->> 'count' from (select app.push_list_json('22222222-2222-4222-8222-222222222222', 'owner', '2026-11-04T09:00Z') j) x), '1', 'tenant B has its own single row');
select is(position('ba000000-0000-4000-8000-000000000001' in (select app.push_list_json('22222222-2222-4222-8222-222222222222', 'owner', '2026-11-04T09:00Z')::text)), 0, 'and none of A''s ids');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is((public.push_list() ->> 'role'), 'owner', 'public.push_list() answers the owner');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is((public.push_list() ->> 'role'), 'admin', 'and the admin');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is((public.push_list() ->> 'role'), 'chef', 'and the chef');
select is((public.push_list() -> 'totals' ? 'costAtRiskEur'), false, 'with a chef-shaped body (the role is the session''s, not a parameter)');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(left(pg_temp.err($$select public.push_list()$$), 6), '42501 ', 'the waiter is refused');
select set_config('request.jwt.claims', '', true);
select is(left(pg_temp.err($$select public.push_list()$$), 6), '42501 ', 'and so is a caller without claims');
select is((select array_agg(r order by r) from unnest(array['anon', 'authenticated', 'service_role']) r where has_function_privilege(r, 'public.push_list()', 'execute')), array['authenticated'], 'only authenticated executes push_list');
select is((select bool_or(has_function_privilege(r, f, 'execute')) from unnest(array['anon', 'authenticated', 'service_role']) r,
            unnest(array['app.push_list_json(uuid, text, timestamptz)', 'app.push_list_window(uuid, timestamptz)', 'app.push_list_expired(uuid, timestamptz)',
                         'app.push_item_plates(uuid, uuid[], uuid[])', 'app.push_lot_batch_recipes(uuid, uuid[], timestamptz)', 'app.require_push_reader()']) f), false, 'no API role executes the app.* functions');
select is((select bool_and(prosecdef and proconfig = array['search_path=""']) from pg_proc
            where oid in ('public.push_list()'::regprocedure, 'app.push_list_json(uuid, text, timestamptz)'::regprocedure, 'app.push_list_window(uuid, timestamptz)'::regprocedure,
                          'app.push_list_expired(uuid, timestamptz)'::regprocedure, 'app.push_item_plates(uuid, uuid[], uuid[])'::regprocedure,
                          'app.push_lot_batch_recipes(uuid, uuid[], timestamptz)'::regprocedure)), true, 'they are definers with an empty search_path');

select * from finish();
rollback;
