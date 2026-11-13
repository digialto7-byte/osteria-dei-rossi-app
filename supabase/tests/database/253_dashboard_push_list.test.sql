-- M23 step 6 (docs/plans/2026-10-31-m23-push-forecast.md §3.1.8, §3.2, §5; T3): app.dashboard_summary_at gains pushList {count, expired, items} (the first app.dashboard_list_cap() rows
-- of push_list_json with the owner/admin keys) and comingSoon = []. Everything else is the M22 body verbatim: pg_temp.dashboard_summary_m22 below is a copy of that body (20261112100600),
-- and the reply minus pushList and comingSoon must equal its reply. Fixture: the plan §3.8 push-list fixture of 250 (N = Wed 1998-11-04 10:00 CET). Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

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


-- The M22 body, copied verbatim (T3: it is the merged version of 20261112100600 on this branch's base).
create function pg_temp.dashboard_summary_m22(p_tenant uuid, p_role text, p_now timestamptz) returns jsonb
  language plpgsql stable
  security definer
  set search_path = ''
as $$
declare
  v_role text := coalesce(p_role, '');
  v_tenant uuid := p_tenant;
  v_now timestamptz := p_now;
  v_today date;
  v_week record;
  v_waste jsonb;
  v_alerts jsonb;
  v_out jsonb;
begin
  if v_role not in ('owner', 'admin') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if v_tenant is null then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  v_today := app.alert_business_date(v_tenant, v_now);
  select * into v_week from app.dashboard_week(v_tenant, v_now);

  -- waste_costs, reduced to what the tile shows (its lines stay on the waste screen).
  v_waste := public.waste_costs(v_week.week_from, v_week.week_to);
  v_waste := jsonb_build_object(
    'from', v_waste -> 'from', 'to', v_waste -> 'to', 'valueEur', v_waste -> 'valueEur',
    'rawValueEur', v_waste -> 'rawValueEur', 'batchValueEur', v_waste -> 'batchValueEur',
    'unvaluedCount', v_waste -> 'unvaluedCount',
    'reasons', coalesce((select jsonb_agg(jsonb_build_object('reasonCode', r.value -> 'reasonCode', 'valueEur', r.value -> 'valueEur')
                                          order by r.ord)
                           from jsonb_array_elements(v_waste -> 'reasons') with ordinality r (value, ord)), '[]'::jsonb));

  v_out := jsonb_build_object('role', v_role, 'asOf', app.iso_utc(v_now), 'today', public.today_counts())
        || app.dashboard_plates(v_tenant)
        || jsonb_build_object(
             'payables', app.dashboard_payables(v_tenant, v_today),
             'stockAtRisk', app.dashboard_stock_at_risk(v_tenant, v_now),
             'waste', v_waste,
             'yesterday', app.dashboard_yesterday(v_tenant, v_now),
             'comingSoon', jsonb_build_array('pushList'));

  if v_role = 'owner' then
    v_alerts := app.dashboard_alerts(v_tenant, v_now);
    v_out := v_out || v_alerts || jsonb_build_object(
      'names', app.dashboard_alert_names(v_tenant,
                 (v_alerts -> 'priceVariance' -> 'items') || (v_alerts -> 'todayLists' -> 'prep') || (v_alerts -> 'todayLists' -> 'purchase')),
      'fixedCosts', public.fixed_cost_status());
  end if;
  return v_out;
end
$$;



create function pg_temp.dash(p_role text, p_now text default '1998-11-04T09:00Z') returns jsonb language sql as $$
  select app.dashboard_summary_at('11111111-1111-4111-8111-111111111111', p_role, p_now::timestamptz) $$;
create function pg_temp.old(p_role text, p_now text default '1998-11-04T09:00Z') returns jsonb language sql as $$
  select pg_temp.dashboard_summary_m22('11111111-1111-4111-8111-111111111111', p_role, p_now::timestamptz) $$;

select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
insert into r values ('own', pg_temp.dash('owner'));
insert into r values ('oldown', pg_temp.old('owner'));
insert into r values ('rows', pg_temp.pl('1998-11-04T09:00Z', 'owner'));

-- pushList --------------------------------------------------------------------------------------------------------------------------------------------
select is((select j -> 'pushList' ->> 'count' from r where nm = 'own'), '4', 'pushList.count is 4 (B2, B1, L2, L1)');
select is((select j -> 'pushList' -> 'expired' from r where nm = 'own'), '{"batches": 1, "lots": 1}'::jsonb, 'expired {batches 1, lots 1}');
select is((select j -> 'pushList' -> 'items' from r where nm = 'own'), (select j -> 'rows' from r where nm = 'rows'), 'items equal the 4 rows of push_list_json(A, owner, N)');
select is((select array_agg(k order by k) from jsonb_object_keys((select j -> 'pushList' from r where nm = 'own')) k), array['count', 'expired', 'items'], 'pushList has exactly count, expired and items');
select is((select j -> 'pushList' -> 'items' -> 0 ? 'costAtRiskEur' from r where nm = 'own'), true, 'items carry the cost at risk (owner and admin see euro on the dashboard)');
insert into r values ('adm', pg_temp.dash('admin'));
select is((select j -> 'pushList' from r where nm = 'adm'), (select j -> 'pushList' from r where nm = 'own'), 'the owner''s and the admin''s pushList are equal');
select is((select j -> 'comingSoon' from r where nm = 'own'), '[]'::jsonb, 'comingSoon is [] for the owner');
select is((select j -> 'comingSoon' from r where nm = 'adm'), '[]'::jsonb, 'and for the admin');
select is((select array_agg(k order by k) from jsonb_object_keys((select j from r where nm = 'own')) k),
          (select array_agg(k order by k) from jsonb_object_keys((select j from r where nm = 'oldown') || '{"pushList": 1}'::jsonb) k), 'the owner key set is the M22 one plus pushList');
select is((select array_agg(k order by k) from jsonb_object_keys((select j from r where nm = 'adm')) k),
          (select array_agg(k order by k) from jsonb_object_keys(pg_temp.old('admin') || '{"pushList": 1}'::jsonb) k), 'and the admin key set too');

-- The rest of the document is unchanged (T3) ----------------------------------------------------------------------------------------------------
select is((select j - 'pushList' - 'comingSoon' from r where nm = 'own'), (select j - 'comingSoon' from r where nm = 'oldown'), 'the owner reply minus pushList and comingSoon equals the M22 reply minus comingSoon');
select is((select j - 'pushList' - 'comingSoon' from r where nm = 'adm'), pg_temp.old('admin') - 'comingSoon', 'the admin reply too');
select is((select j - 'pushList' - 'comingSoon' from r where nm = 'own') = (select j - 'pushList' - 'comingSoon' from r where nm = 'own'), true, 'sanity: the comparison is not trivially null');

-- The cap ---------------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.mkbatch(11, 'ec000000-0000-4000-8000-0000000000e1', '1998-11-05T01:00Z', 5, 0, 2.00);
select pg_temp.mkbatch(12, 'ec000000-0000-4000-8000-0000000000e1', '1998-11-05T02:00Z', 5, 0, 2.00);
select pg_temp.mkbatch(13, 'ec000000-0000-4000-8000-0000000000e1', '1998-11-05T03:00Z', 5, 0, 2.00);
insert into r values ('cap', pg_temp.dash('owner'));
insert into r values ('caprows', pg_temp.pl('1998-11-04T09:00Z', 'owner'));
select is((select j -> 'pushList' ->> 'count' from r where nm = 'cap'), '7', 'with three more batches the count is 7');
select is((select jsonb_array_length(j -> 'pushList' -> 'items') from r where nm = 'cap'), app.dashboard_list_cap(), 'and items holds app.dashboard_list_cap() rows');
select is(app.dashboard_list_cap(), 5, 'the cap is 5');
select is((select j -> 'pushList' -> 'items' from r where nm = 'cap'), (select jsonb_agg(e order by n) from jsonb_array_elements((select j -> 'rows' from r where nm = 'caprows')) with ordinality t(e, n) where n <= 5), 'they are the first five rows, in order');

-- Roles and the public function -----------------------------------------------------------------------------------------------------------------
select is((public.dashboard_summary() -> 'pushList' ->> 'count') is not null, true, 'public.dashboard_summary() with real claims answers with pushList');
select is(public.dashboard_summary() -> 'comingSoon', '[]'::jsonb, 'and comingSoon []');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is(public.dashboard_summary() ? 'pushList', true, 'the admin too');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.err($$select public.dashboard_summary()$$), '42501 insufficient_privilege', 'the chef: 42501');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(pg_temp.err($$select public.dashboard_summary()$$), '42501 insufficient_privilege', 'the waiter: 42501');
select set_config('request.jwt.claims', '', true);
select is((select bool_or(has_function_privilege(r, f, 'execute')) from unnest(array['anon', 'authenticated', 'service_role']) r, unnest(array['app.dashboard_summary_at(uuid, text, timestamptz)', 'app.dashboard_push_list(uuid, timestamptz)']) f), false, 'no API role executes the twin or the helper');
select is((select bool_and(prosecdef and proconfig = array['search_path=""']) from pg_proc where oid in ('app.dashboard_summary_at(uuid, text, timestamptz)'::regprocedure, 'app.dashboard_push_list(uuid, timestamptz)'::regprocedure)), true, 'both are definers with an empty search_path');
select is(position('Stufato' in (select j::text from r where nm = 'own')), 0, 'no tenant B row in the dashboard');

select * from finish();
rollback;
