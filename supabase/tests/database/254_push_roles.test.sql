-- M23 step 7 (docs/plans/2026-10-31-m23-push-forecast.md §3.6, §5; T4; AT6 in SQL): the role and tenancy matrix of the four public functions (owner, admin, chef, waiter, no claims),
-- the waiter menu with a pushed item (the push marker and the push price, no cost or risk key, still the eleven keys of 153), privileges and definer settings of every
-- function M23 adds, replies scanned for the other tenant's ids, and the cost-named public function list still at 13 (059). Fixture: the push-list fixture of 250. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

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
  ('ed000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e1', 1, '1998-10-01', 'Spezzatino', 2, 'kg', 10, 48, 'a1000000-0000-4000-8000-00000000000a'),
  ('ed000000-0000-4000-8000-0000000000d3', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e3', 1, '1998-10-01', 'Ragù (demo)', 2, 'kg', 10, 48, 'a1000000-0000-4000-8000-00000000000a'),
  ('ed000000-0000-4000-8000-0000000000db', '22222222-2222-4222-8222-222222222222', 'ec000000-0000-4000-8000-0000000000eb', 1, '1998-10-01', 'Stufato B (demo)', 2, 'kg', 10, 48, 'b1000000-0000-4000-8000-00000000000b');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by) values
  ('ed000000-0000-4000-8000-0000000000d2', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e2', 1, '1998-10-01', 'Spezzatino con polenta', 'a1000000-0000-4000-8000-00000000000a'),
  ('ed000000-0000-4000-8000-0000000000d6', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e5', 1, '1998-10-01', 'Tagliatelle al ragù (demo)', 'a1000000-0000-4000-8000-00000000000a');
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
  ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000001', 14, 10, '1998-10-01T00:00Z', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-0000000000f1', 14, 10, '1998-10-01T00:00Z', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000002', 11, 10, '1998-10-01T00:00Z', 'a1000000-0000-4000-8000-00000000000a');

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
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role, 'aal', case when app_role = 'admin' then 'aal2' else 'aal1' end)::text, true)
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
      1, '981101-LOT-' || p_n, '1998-11-01', 'LOT', p_n, p_use_by - interval '48 hours', 'a1000000-0000-4000-8000-00000000000a', 2, 'kg', p_made, p_made, 48, p_use_by, 'fresh',
      '10000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-00000000000a');
  insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', v_id, 'produce', p_made, 'batch', v_id, '1998-11-01', 'a1000000-0000-4000-8000-00000000000a');
  if p_sold > 0 then
    insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
      values ('11111111-1111-4111-8111-111111111111', v_id, 'consume', -p_sold, 'order_line', gen_random_uuid(), '1998-11-03', 'a1000000-0000-4000-8000-00000000000a');
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
          '10000000-0000-4000-8000-0000000000a1', 'consumption', -p_qty, 'test', gen_random_uuid(), '1998-11-03', 'a1000000-0000-4000-8000-00000000000a')
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
select pg_temp.mkbatch(1, 'ec000000-0000-4000-8000-0000000000e1', '1998-11-04T19:00Z', 31, 17, 2.7143);  -- B1: 14 left, 10 h, listed
select pg_temp.mkbatch(2, 'ec000000-0000-4000-8000-0000000000e3', '1998-11-04T13:00Z', 6, 0, null);      -- B2: 6 left, 4 h, cost unknown
select pg_temp.mkbatch(3, 'ec000000-0000-4000-8000-0000000000e1', '1998-11-04T17:00Z', 10, 10, 2.70);    -- B3: 0 left, absent
select pg_temp.mkbatch(4, 'ec000000-0000-4000-8000-0000000000e3', '1998-11-04T07:00Z', 3, 0, 1.50);      -- B4: use-by passed, expired
select pg_temp.mkbatch(5, 'ec000000-0000-4000-8000-0000000000e1', '1998-11-05T11:00Z', 30, 0, 2.70);     -- B5: 26 h, outside the window
select pg_temp.mkbatch(6, 'ec000000-0000-4000-8000-0000000000e1', '1998-11-04T20:00Z', 10, 11, 2.70);    -- B6: -1 portion, absent
-- Lots (Manzo = ingredient 1, Parmigiano = 2, Pomodoro = 3).
select pg_temp.mklot(1, 1, '1998-11-05', '1998-11-02', 3.2, 12.00, 'LM-1');   -- L1: 38 h, 38.40
select pg_temp.mklot(2, 2, '1998-11-04', '1998-11-02', 0.5, 20.00, 'LP-2');   -- L2: 14 h, 10.00
select pg_temp.mklot(3, 2, '1998-11-04', '1998-11-02', 3, 20.00, 'LP-3');     -- L3: fully consumed, absent
select pg_temp.use_lot(3, 2, 3);
select pg_temp.mklot(4, 1, '1998-11-03', '1998-11-01', 1, 12.00, 'LM-4');     -- L4: expired yesterday
select pg_temp.mklot(5, 1, null, '1998-11-01', 5, 12.00, 'LM-5');            -- L5: no expiry
-- Tenant B: a due-soon batch of its own.
insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code, lot_seq, produced_at, produced_by, output_qty, output_unit,
    portions_computed, portions_initial, shelf_life_hours, use_by, state, location_id, created_by) values
  ('ba000000-0000-4000-8000-0000000000bb', '22222222-2222-4222-8222-222222222222', 'ec000000-0000-4000-8000-0000000000eb', 'ed000000-0000-4000-8000-0000000000db', 1, '981101-STB-1', '1998-11-01', 'STB', 1,
   '1998-11-02T20:00Z', 'b1000000-0000-4000-8000-00000000000b', 2, 'kg', 10, 10, 48, '1998-11-04T20:00Z', 'fresh', '10000000-0000-4000-8000-0000000000b1', 'b1000000-0000-4000-8000-00000000000b');
insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by) values
  ('22222222-2222-4222-8222-222222222222', 'ba000000-0000-4000-8000-0000000000bb', 'produce', 10, 'batch', 'ba000000-0000-4000-8000-0000000000bb', '1998-11-01', 'b1000000-0000-4000-8000-00000000000b');


-- A discard in each tenant (week 1998-11-02..08), so the discards report has rows to scan.
insert into public.batch_movement (tenant_id, batch_id, type, portions, reason_code, ref_type, ref_id, effective_on, created_at, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'ba000000-0000-4000-8000-000000000002', 'waste', -2, 'expired', 'batch_discard', gen_random_uuid(), '1998-11-04', '1998-11-04T10:00Z', 'a1000000-0000-4000-8000-00000000000a'),
  ('22222222-2222-4222-8222-222222222222', 'ba000000-0000-4000-8000-0000000000bb', 'waste', -3, 'expired', 'batch_discard', gen_random_uuid(), '1998-11-04', '1998-11-04T10:00Z', 'b1000000-0000-4000-8000-00000000000b');

-- The matrix (plan §3.6) ----------------------------------------------------------------------------------------------------------------------------
create temporary table cells (fn text, who text, res text);
do $$
declare
  who text;
  fn text;
  stmt text;
  res text;
  claims jsonb;
begin
  foreach fn in array array['push_menu_item', 'push_list', 'forecast', 'discards_vs_push'] loop
    foreach who in array array['owner', 'admin', 'chef', 'waiter', 'none'] loop
      claims := case who
        when 'owner' then jsonb_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated', 'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'owner')
        when 'admin' then jsonb_build_object('sub', 'f0000000-0000-4000-8000-00000000000f', 'role', 'authenticated', 'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'admin', 'aal', 'aal2')
        when 'chef' then jsonb_build_object('sub', 'c0000000-0000-4000-8000-00000000000c', 'role', 'authenticated', 'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'chef')
        when 'waiter' then jsonb_build_object('sub', 'd0000000-0000-4000-8000-00000000000d', 'role', 'authenticated', 'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'waiter')
        else null end;
      perform set_config('request.jwt.claims', coalesce(claims::text, ''), true);
      stmt := case fn
        when 'push_menu_item' then 'select public.push_menu_item(''11000000-0000-4000-8000-000000000001'', ''{"pushed":true,"pushPrice":12}'')'
        when 'push_list' then 'select public.push_list()'
        when 'forecast' then 'select public.forecast(null)'
        else 'select public.discards_vs_push(null)' end;
      begin
        execute stmt;
        res := 'ok';
      exception when others then
        get stacked diagnostics res = returned_sqlstate;
      end;
      insert into cells values (fn, who, res);
    end loop;
  end loop;
  perform set_config('request.jwt.claims', '', true);
end
$$;
select is((select array_agg(who || ':' || res order by who collate "C") from cells where fn = 'push_menu_item'), array['admin:ok', 'chef:42501', 'none:42501', 'owner:ok', 'waiter:42501'], 'push_menu_item: owner and admin only');
select is((select array_agg(who || ':' || res order by who collate "C") from cells where fn = 'push_list'), array['admin:ok', 'chef:ok', 'none:42501', 'owner:ok', 'waiter:42501'], 'push_list: owner, admin and chef');
select is((select array_agg(who || ':' || res order by who collate "C") from cells where fn = 'forecast'), array['admin:ok', 'chef:ok', 'none:42501', 'owner:ok', 'waiter:42501'], 'forecast: owner, admin and chef');
select is((select array_agg(who || ':' || res order by who collate "C") from cells where fn = 'discards_vs_push'), array['admin:ok', 'chef:42501', 'none:42501', 'owner:ok', 'waiter:42501'], 'discards_vs_push: owner and admin only (T4: require_day_closer)');
select is((select count(*)::int from public.menu_push where created_by in ('c1000000-0000-4000-8000-00000000000c', 'd1000000-0000-4000-8000-00000000000d')), 0, 'a refused push wrote no row');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(pg_temp.err($$select public.push_menu_item('11000000-0000-4000-8000-000000000001', '{"pushed":false}')$$), '42501 permission denied: the menu and table settings need owner or admin', 'a waiter cannot stop a push either');
select set_config('request.jwt.claims', '', true);

-- menu_push SELECT by role (RLS) ----------------------------------------------------------------------------------------------------------------------
create temporary table seen (who text, n int);
grant all on seen to authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
set local role authenticated;
insert into seen select 'owner', count(*)::int from public.menu_push;
reset role;
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
set local role authenticated;
insert into seen select 'chef', count(*)::int from public.menu_push;
reset role;
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
set local role authenticated;
insert into seen select 'waiter', count(*)::int from public.menu_push;
reset role;
select set_config('request.jwt.claims', '', true);
select is((select n from seen where who = 'owner'), 1, 'owner A reads the one start row the matrix wrote (the admin''s identical push changed nothing)');
select is((select max(n) from seen where who in ('chef', 'waiter')), 0, 'chef and waiter read none');

-- AT6: the waiter menu ----------------------------------------------------------------------------------------------------------------------------------
create function pg_temp.all_keys(j jsonb) returns setof text language sql as $$
  select unnest(pg_temp.keys_of(j)) $$;
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
insert into r values ('menu', public.menu_list());
select set_config('request.jwt.claims', '', true);
select is((select j -> 'pinned' -> 0 ->> 'id' from r where nm = 'menu'), '11000000-0000-4000-8000-000000000001', 'AT6: the pushed item is first in the waiter''s pinned list');
select is((select (j -> 'pinned' -> 0 ->> 'pushed') || '/' || (j -> 'pinned' -> 0 ->> 'pushPrice') from r where nm = 'menu'), 'true/12', 'AT6: with the push marker and the push price');
select is((select array_agg(k order by k collate "C") from r, jsonb_object_keys(j -> 'pinned' -> 0) k where nm = 'menu'),
          array['available', 'category', 'course', 'id', 'lowStock', 'name', 'portionWeightG', 'portionsLeft', 'price', 'priceUnit', 'pushPrice', 'pushed', 'unavailableReason', 'weightLeftG'], 'AT6: the item has exactly the fourteen keys of 153 (P2-0b A2 extended the eleven on purpose)');
select is((select count(*)::int from r, pg_temp.all_keys(j) k where nm = 'menu' and k ~* 'cost|risk|margin|eur'), 0, 'AT6: a recursive key scan of the whole waiter menu finds no cost, risk, margin or eur key');

-- Privileges and definer settings --------------------------------------------------------------------------------------------------------------------
select is((select array_agg(f order by f) from unnest(array['push_menu_item(uuid, jsonb)', 'push_list()', 'forecast(date)', 'discards_vs_push(date)']) f
            where not has_function_privilege('anon', 'public.' || f, 'execute') and has_function_privilege('authenticated', 'public.' || f, 'execute') and not has_function_privilege('service_role', 'public.' || f, 'execute')),
          array['discards_vs_push(date)', 'forecast(date)', 'push_list()', 'push_menu_item(uuid, jsonb)'], 'the four public functions: authenticated only (not anon, not service_role)');
select is((select count(*)::int from pg_proc where oid in ('public.push_menu_item(uuid, jsonb)'::regprocedure, 'public.push_list()'::regprocedure, 'public.forecast(date)'::regprocedure, 'public.discards_vs_push(date)'::regprocedure)
             and prosecdef and proconfig = array['search_path=""']), 4, 'each is a definer with an empty search_path');
create temporary table m23_app (sig text);
insert into m23_app values
  ('app.menu_push_periods(uuid, timestamptz, timestamptz)'), ('app.push_default_until(uuid, timestamptz)'), ('app.push_menu_item_at(uuid, uuid, uuid, jsonb, timestamptz)'),
  ('app.require_push_reader()'), ('app.push_list_window(uuid, timestamptz)'), ('app.push_list_expired(uuid, timestamptz)'), ('app.push_item_plates(uuid, uuid[], uuid[])'),
  ('app.push_lot_batch_recipes(uuid, uuid[], timestamptz)'), ('app.push_list_json(uuid, text, timestamptz)'), ('app.forecast_weeks()'), ('app.forecast_days_ahead()'),
  ('app.forecast_portion_lines(uuid, date[])'), ('app.forecast_json(uuid, text, date, timestamptz)'), ('app.discards_vs_push_json(uuid, date, timestamptz)'), ('app.dashboard_push_list(uuid, timestamptz)');
select is((select count(*)::int from m23_app), 15, 'fifteen app.* functions are listed');
select is((select count(*)::int from m23_app a, unnest(array['anon', 'authenticated', 'service_role']) r where has_function_privilege(r, a.sig, 'execute')), 0, 'no API role executes any app.* function of M23');
select is((select bool_and(p.proconfig = array['search_path=""']) from m23_app a join pg_proc p on p.oid = a.sig::regprocedure), true, 'every one has an empty search_path');
select is((select array_agg(a.sig order by a.sig) from m23_app a join pg_proc p on p.oid = a.sig::regprocedure where not p.prosecdef),
          array['app.forecast_days_ahead()', 'app.forecast_weeks()', 'app.require_push_reader()'], 'all but the role gate and the two constants are definers');

-- Tenancy: no reply names the other tenant's ids ---------------------------------------------------------------------------------------------------------
create temporary table replies (t text, j jsonb);
insert into replies values
  ('A', pg_temp.pl('1998-11-04T09:00Z', 'owner')),
  ('A', app.forecast_json('11111111-1111-4111-8111-111111111111', 'owner', '1998-11-05', '1998-11-05T09:00Z')),
  ('A', app.discards_vs_push_json('11111111-1111-4111-8111-111111111111', '1998-11-04', '1998-11-09T09:00Z')),
  ('A', app.dashboard_push_list('11111111-1111-4111-8111-111111111111', '1998-11-04T09:00Z')),
  ('B', app.push_list_json('22222222-2222-4222-8222-222222222222', 'owner', '1998-11-04T09:00Z')),
  ('B', app.forecast_json('22222222-2222-4222-8222-222222222222', 'owner', '1998-11-05', '1998-11-05T09:00Z')),
  ('B', app.discards_vs_push_json('22222222-2222-4222-8222-222222222222', '1998-11-04', '1998-11-09T09:00Z')),
  ('B', app.dashboard_push_list('22222222-2222-4222-8222-222222222222', '1998-11-04T09:00Z'));
select is((select count(*)::int from replies where t = 'A' and j::text <> '{}'), 4, 'four replies for A');
select is((select count(*)::int from replies a, unnest(array['ba000000-0000-4000-8000-0000000000bb', 'ec000000-0000-4000-8000-0000000000eb', '22222222-2222-4222-8222-222222222222', '10000000-0000-4000-8000-0000000000b1']) id
            where a.t = 'A' and position(id in a.j::text) > 0), 0, 'owner A''s replies contain none of tenant B''s ids');
select is((select count(*)::int from replies a, unnest(array['ba000000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-000000000002', 'ec000000-0000-4000-8000-0000000000e1', 'ec000000-0000-4000-8000-0000000000e3',
                                                          '11000000-0000-4000-8000-000000000001', '1e000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111']) id
            where a.t = 'B' and position(id in a.j::text) > 0), 0, 'and owner B''s contain none of tenant A''s');
select is((select count(*)::int from replies where t = 'A' and position('ba000000-0000-4000-8000-000000000001' in j::text) > 0), 2, 'A''s own batch is in A''s push list and dashboard list');
select is((select count(*)::int from replies where t = 'B' and position('ba000000-0000-4000-8000-0000000000bb' in j::text) > 0), 2, 'and B''s in B''s');

-- 059: the cost-named public function list is still 13 -------------------------------------------------------------------------------------------------
select is((select array_agg(proname::text order by proname::text collate "C") from pg_proc where pronamespace = 'public'::regnamespace and proname ~* '(cost|margin|price)'),
          array['batch_costs', 'cost_settings', 'count_variance_costs', 'enter_fixed_costs', 'fixed_cost_status', 'ingredient_costs', 'plate_costs', 'plate_margins_pct', 'raw_waste_costs',
                'recipe_cost_at', 'recipe_costs', 'set_ingredient_cost_basis', 'update_cost_settings', 'waste_costs'],
          'the cost, margin or price named public functions are still the 13 of 059 plus plate_margins_pct (no M23 function name matches)');

select * from finish();
rollback;
