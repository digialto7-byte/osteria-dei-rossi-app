-- M16 step 4: the three rules reads rules_ingredients, rules_suppliers, rules_recipes (plan §3.2, §3.1.13): owner, admin and
-- chef read; the waiter and anonymous callers are refused before anything is read; no cost key at any depth for any role;
-- the chef has no supplier-item list and cannot choose the clock. Also the helper app.remaining_portions. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(51);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)'),
  ('10000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Cella B (demo)');
-- Suppliers: Macelleria (the AT3 window), Orto (no weekdays), Pescheria (no lead time), Vecchio (inactive); B has one.
insert into public.supplier (id, tenant_id, name, vat_number, lead_time_days, delivery_weekdays, order_cutoff_time, is_active) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Macelleria X (demo)', 'IT12345678903', 2, '{1,4}', '11:00', true),
  ('5a000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'Orto Y (demo)', 'IT33333333335', 1, '{}', null, true),
  ('5a000000-0000-4000-8000-0000000000a3', '11111111-1111-4111-8111-111111111111', 'Pescheria Z (demo)', 'IT10000000017', null, '{2}', '09:00', true),
  ('5a000000-0000-4000-8000-0000000000a4', '11111111-1111-4111-8111-111111111111', 'Vecchio Fornitore (demo)', 'IT22222222220', 1, '{3}', '10:00', false),
  ('5a000000-0000-4000-8000-0000000000b5', '22222222-2222-4222-8222-222222222222', 'Macelleria B (demo)', 'IT12345678903', 1, '{2}', '09:30', true);
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id) values
  ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/e1000000-0000-4000-8000-0000000000e1.pdf', 'application/pdf', 2048, 'review', '5a000000-0000-4000-8000-00000000005a'),
  ('e1000000-0000-4000-8000-0000000000e2', '22222222-2222-4222-8222-222222222222',
   '22222222-2222-4222-8222-222222222222/2026/e1000000-0000-4000-8000-0000000000e2.pdf', 'application/pdf', 2048, 'review', '5a000000-0000-4000-8000-0000000000b5');
-- Ingredients: beef (ok), onion (no preferred), carrot (supplier without weekdays), fish (supplier without lead time),
-- leek (inactive supplier), salt (no minimum), water (not stock), zucchini (inactive); B: beef.
insert into public.ingredient (id, tenant_id, name, base_unit, is_stock, is_active, min_level, target_level, is_critical) values
  ('1a000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Manzo muscolo (demo)', 'kg', true, true, 5, 12, true),
  ('1a000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Cipolla (demo)', 'kg', true, true, 2, null, false),
  ('1a000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Carota (demo)', 'kg', true, true, 1, 3, false),
  ('1a000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'Branzino (demo)', 'kg', true, true, 1, 3, false),
  ('1a000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'Porro (demo)', 'kg', true, true, 1, null, false),
  ('1a000000-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', 'Sale grosso (demo)', 'kg', true, true, null, null, false),
  ('1a000000-0000-4000-8000-000000000007', '11111111-1111-4111-8111-111111111111', 'Acqua (demo)', 'l', false, true, null, null, false),
  ('1a000000-0000-4000-8000-000000000008', '11111111-1111-4111-8111-111111111111', 'Zucchina (demo)', 'kg', true, false, 1, null, false),
  ('1b000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Manzo B (demo)', 'kg', true, true, 3, null, false);
insert into public.supplier_item (id, tenant_id, supplier_id, ingredient_id, supplier_code, pack_count, pack_qty, pack_unit, last_price, is_preferred, is_active) values
  ('51000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a', '1a000000-0000-4000-8000-000000000001', 'MZ5', 1, 5, 'kg', 12.34, true, true),
  ('51000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a', '1a000000-0000-4000-8000-000000000001', 'MZ6', 6, 1, 'kg', 55.55, false, true),
  ('51000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-0000000000a2', '1a000000-0000-4000-8000-000000000003', 'CA1', 1, 2, 'kg', 1.5, true, true),
  ('51000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-0000000000a3', '1a000000-0000-4000-8000-000000000004', 'BR1', 1, 500, 'g', 9.9, true, true),
  ('51000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-0000000000a4', '1a000000-0000-4000-8000-000000000005', 'PO1', 1, 1, 'kg', 2.2, true, true),
  ('51000000-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-0000000000a4', '1a000000-0000-4000-8000-000000000002', 'CI1', 1, 1, 'kg', 1.1, false, true),
  ('51000000-0000-4000-8000-000000000007', '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a', '1a000000-0000-4000-8000-000000000002', 'CI2', 1, 1, 'kg', 1.1, false, false),
  ('51000000-0000-4000-8000-000000000008', '22222222-2222-4222-8222-222222222222', '5a000000-0000-4000-8000-0000000000b5', '1b000000-0000-4000-8000-000000000001', 'MB5', 1, 5, 'kg', 7, true, true);

create temporary table reg (k text primary key, id uuid not null);
create function pg_temp.id(p_k text) returns uuid language sql as $$ select id from reg where k = p_k $$;
create sequence pg_temp.line_seq;
-- A lot with its receipt of tenant A (beef 9 kg, no expiry).
do $$
declare
  v_line uuid;
  v_lot uuid := gen_random_uuid();
begin
  v_line := ('a2000000-0000-4000-8000-' || lpad(nextval('pg_temp.line_seq')::text, 12, '0'))::uuid;
  insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price, line_amount, field_confidence, extracted)
    values (v_line, '11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-0000000000e1', 1, 'Riga demo', 1, 10, 10, '{}', '{}');
  insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code, expiry, received_on, qty_received,
      base_unit, source_qty, source_unit, base_factor, created_by)
    values (v_lot, '11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-0000000000a1',
      '5a000000-0000-4000-8000-00000000005a', v_line, 'L-BEEF', null, '2026-10-01', 9, 'kg', 9, 'kg', 1, 'a1000000-0000-4000-8000-00000000000a');
  insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type, ref_id, effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-000000000001', v_lot, '10000000-0000-4000-8000-0000000000a1', 'receipt', 9, 10,
      'invoice_line', v_line, '2026-10-01', 'a1000000-0000-4000-8000-00000000000a');
end
$$;

-- Recipes: stew (batch, rule 5/30/180), brodo (batch, version values only), plate, sub; B: a batch.
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by, rule_min_portions, rule_target_portions, rule_prep_time_min) values
  ('b2000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'batch', 3, 'spezzatino (demo)', 'a1000000-0000-4000-8000-00000000000a', 5, 30, 180),
  ('b2000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'tagliata (demo)', 'a1000000-0000-4000-8000-00000000000a', null, null, null),
  ('b2000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'sub', 1, 'soffritto (demo)', 'a1000000-0000-4000-8000-00000000000a', null, null, null),
  ('b2000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'brodo (demo)', 'a1000000-0000-4000-8000-00000000000a', null, null, null),
  ('b2000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'batch', 1, 'spezzatino b (demo)', 'b1000000-0000-4000-8000-00000000000b', null, null, null);
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch,
    shelf_life_hours, prep_time_min, min_portions, target_portions, created_by) values
  ('c2000000-0000-4000-8000-000000000013', '11111111-1111-4111-8111-111111111111', 'b2000000-0000-4000-8000-000000000001', 3, '2026-10-10T00:00Z',
   'Spezzatino (demo)', 6, 'kg', 30, 72, 60, 3, 10, 'a1000000-0000-4000-8000-00000000000a'),
  ('c2000000-0000-4000-8000-000000000021', '11111111-1111-4111-8111-111111111111', 'b2000000-0000-4000-8000-000000000002', 1, '2026-10-01T00:00Z',
   'Tagliata (demo)', null, null, null, null, null, null, null, 'a1000000-0000-4000-8000-00000000000a'),
  ('c2000000-0000-4000-8000-000000000031', '11111111-1111-4111-8111-111111111111', 'b2000000-0000-4000-8000-000000000003', 1, '2026-10-01T00:00Z',
   'Soffritto (demo)', 1, 'kg', null, null, null, null, null, 'a1000000-0000-4000-8000-00000000000a'),
  ('c2000000-0000-4000-8000-000000000041', '11111111-1111-4111-8111-111111111111', 'b2000000-0000-4000-8000-000000000004', 1, '2026-10-01T00:00Z',
   'Brodo (demo)', 5, 'l', 20, 48, null, 2, 8, 'a1000000-0000-4000-8000-00000000000a'),
  ('c2000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'b2000000-0000-4000-8000-0000000000b1', 1, '2026-10-01T00:00Z',
   'Spezzatino B (demo)', 6, 'kg', 30, 72, null, null, null, 'b1000000-0000-4000-8000-00000000000b');
-- Stew batches: 4 portions left and in date; 10 portions but past use-by; and the brodo with 6 portions in date.
create function pg_temp.mkb(p_key uuid, p_recipe uuid, p_seq int, p_portions int, p_use_by timestamptz, p_shelf int default 72) returns void language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code, lot_seq, produced_at,
      produced_by, output_qty, output_unit, portions_computed, portions_initial, shelf_life_hours, use_by, location_id, created_by)
    values (v_id, '11111111-1111-4111-8111-111111111111', p_key, p_recipe, (select r.version from public.recipe r where r.id = p_recipe), '261023-SPEZZA-' || p_seq, '2026-10-23', 'SPEZZA', p_seq,
      p_use_by - make_interval(hours => p_shelf), 'c1000000-0000-4000-8000-00000000000c', 6, 'kg', p_portions, p_portions, p_shelf, p_use_by,
      '10000000-0000-4000-8000-0000000000a1', 'c1000000-0000-4000-8000-00000000000c');
  insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', v_id, 'produce', p_portions, 'batch', v_id, '2026-10-23', 'c1000000-0000-4000-8000-00000000000c');
end
$$;
select pg_temp.mkb('b2000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000013', 1, 4, now() + interval '2 days');
select pg_temp.mkb('b2000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000013', 2, 10, now() - interval '1 hour');
select pg_temp.mkb('b2000000-0000-4000-8000-000000000004', 'c2000000-0000-4000-8000-000000000041', 3, 6, now() + interval '30 hours', 48);

create temporary table outs (k text primary key, v text);
create function pg_temp.q(stmt text) returns text language plpgsql as $$
declare
  r text;
  state text;
  msg text;
begin
  execute 'select (' || stmt || ')::text' into r;
  return r;
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text;
  return state || ' ' || msg;
end
$$;
create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true) $$;
create function pg_temp.all_keys(p_json jsonb) returns text[] language sql as $$
  with recursive walk (node) as (
    select p_json
    union all
    select c.value from walk w cross join lateral (
      select o.value from jsonb_each(case when jsonb_typeof(w.node) = 'object' then w.node else '{}'::jsonb end) o
      union all
      select a.value from jsonb_array_elements(case when jsonb_typeof(w.node) = 'array' then w.node else '[]'::jsonb end) a) c)
  select coalesce(array_agg(distinct k.key), '{}') from walk w
    cross join lateral jsonb_object_keys(case when jsonb_typeof(w.node) = 'object' then w.node else '{}'::jsonb end) k (key) $$;
grant all on outs to authenticated;
grant execute on function pg_temp.q(text), pg_temp.act_as(uuid, uuid, text) to authenticated;

-- Access shape.
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
            and p.proname in ('rules_ingredients', 'rules_suppliers', 'rules_recipes')
            and has_function_privilege('authenticated', p.oid, 'execute') and p.prosecdef and p.provolatile = 's'
            and p.proconfig @> array['search_path=""']), 3, 'the three reads are stable security definer with an empty search_path, executable by authenticated');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
            and p.proname in ('rules_ingredients', 'rules_suppliers', 'rules_recipes')
            and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))), 0,
  'anon and service_role cannot execute them');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'remaining_portions'
            and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
                 or has_function_privilege('service_role', p.oid, 'execute'))), 0, 'app.remaining_portions is closed to every API role');

-- Collect every answer once.
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
insert into outs select 'oi', pg_temp.q($$public.rules_ingredients('2026-11-02T14:00:00Z')$$);
insert into outs select 'os', pg_temp.q('public.rules_suppliers()');
insert into outs select 'or', pg_temp.q('public.rules_recipes()');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
insert into outs select 'ai', pg_temp.q($$public.rules_ingredients('2026-11-02T14:00:00Z')$$);
insert into outs select 'as', pg_temp.q('public.rules_suppliers()');
insert into outs select 'ar', pg_temp.q('public.rules_recipes()');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
insert into outs select 'ci', pg_temp.q($$public.rules_ingredients('2026-11-02T14:00:00Z')$$);
insert into outs select 'ci0', pg_temp.q('public.rules_ingredients()');
insert into outs select 'cs', pg_temp.q('public.rules_suppliers()');
insert into outs select 'cr', pg_temp.q('public.rules_recipes()');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
insert into outs select 'wi', pg_temp.q('public.rules_ingredients()');
insert into outs select 'ws', pg_temp.q('public.rules_suppliers()');
insert into outs select 'wr', pg_temp.q('public.rules_recipes()');
select set_config('request.jwt.claims', '', true);
insert into outs select 'ni', pg_temp.q('public.rules_ingredients()');
insert into outs select 'ns', pg_temp.q('public.rules_suppliers()');
insert into outs select 'nr', pg_temp.q('public.rules_recipes()');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
insert into outs select 'bi', pg_temp.q($$public.rules_ingredients('2026-11-02T14:00:00Z')$$);
insert into outs select 'bs', pg_temp.q('public.rules_suppliers()');
insert into outs select 'br', pg_temp.q('public.rules_recipes()');
reset role;

create function pg_temp.item(p_k text, p_name text) returns jsonb language sql as $$
  select i from outs o, jsonb_array_elements(o.v::jsonb -> 'items') i where o.k = p_k and i ->> 'name' = p_name $$;

-- rules_ingredients --------------------------------------------------------------------------------------------------
select is((select v::jsonb ->> 'today' from outs where k = 'oi'), '2026-11-02', 'the owner''s p_at sets today (Rome calendar date)');
select is((select string_agg(i ->> 'name', ' | ') from outs o, jsonb_array_elements(o.v::jsonb -> 'items') with ordinality t (i, n) where o.k = 'oi'),
  'Branzino (demo) | Carota (demo) | Cipolla (demo) | Manzo muscolo (demo) | Porro (demo) | Sale grosso (demo)',
  'only active stock ingredients, ordered by name (water and the inactive zucchini are not listed)');
select is(pg_temp.item('oi', 'Manzo muscolo (demo)') - 'preferred' - 'nextWindow',
  '{"ingredientId":"1a000000-0000-4000-8000-000000000001","name":"Manzo muscolo (demo)","baseUnit":"kg","isCritical":true,"minLevel":5,"targetLevel":12,"onHandQty":9,"status":"ok","reasons":[]}'::jsonb,
  'beef: levels, critical flag, on hand 9, status ok, no reasons');
select is(pg_temp.item('oi', 'Manzo muscolo (demo)') -> 'preferred',
  '{"supplierItemId":"51000000-0000-4000-8000-000000000001","supplierId":"5a000000-0000-4000-8000-00000000005a","supplierName":"Macelleria X (demo)","packQty":5,"packLabel":"5 kg"}'::jsonb,
  'beef: the preferred item with its pack size in base units');
select is(pg_temp.item('oi', 'Manzo muscolo (demo)') -> 'nextWindow', '{"deliveryDate":"2026-11-05","orderByAt":"2026-11-03T10:00:00Z"}'::jsonb,
  'AT3: beef''s next window is Thursday 5 Nov, order by Tuesday 3 Nov 10:00Z');
select is(pg_temp.item('oi', 'Cipolla (demo)') ->> 'status', 'incomplete', 'onion has a minimum and no preferred item: incomplete');
select is(pg_temp.item('oi', 'Cipolla (demo)') -> 'reasons', '["no_preferred_item"]'::jsonb, 'with the reason no_preferred_item');
select is(pg_temp.item('oi', 'Cipolla (demo)') -> 'preferred', 'null'::jsonb, 'and preferred null');
select is(pg_temp.item('oi', 'Carota (demo)') -> 'reasons', '["supplier_no_weekdays"]'::jsonb, 'carrot: the supplier has no delivery weekdays');
select is(pg_temp.item('oi', 'Carota (demo)') -> 'nextWindow', 'null'::jsonb, 'and so no window');
select is(pg_temp.item('oi', 'Branzino (demo)') -> 'reasons', '["supplier_no_lead_time"]'::jsonb, 'fish: the supplier has no lead time');
select is(pg_temp.item('oi', 'Branzino (demo)') -> 'preferred' ->> 'packLabel', '500 g', 'a pack in grams keeps its own unit in the label');
select is(pg_temp.item('oi', 'Branzino (demo)') -> 'preferred' ->> 'packQty', '0.5', 'and its pack size is 0.5 in base units (kg)');
select is(pg_temp.item('oi', 'Porro (demo)') -> 'reasons', '["supplier_inactive"]'::jsonb, 'leek: the supplier is inactive');
select is(pg_temp.item('oi', 'Sale grosso (demo)') ->> 'status', 'off', 'salt has no minimum: off');
select is(pg_temp.item('oi', 'Sale grosso (demo)') -> 'reasons', '[]'::jsonb, 'with no reasons');
select is(pg_temp.item('oi', 'Cipolla (demo)') ->> 'onHandQty', '0', 'an ingredient without movements has 0 on hand');
select is(pg_temp.item('ci', 'Manzo muscolo (demo)') -> 'preferred' ->> 'packLabel', '5 kg', 'the chef sees the preferred item (read only)');

-- supplierItems: owner and admin only.
select is((select jsonb_array_length(v::jsonb -> 'supplierItems') from outs where k = 'oi'), 4,
  'the owner gets the active items of active suppliers of listed ingredients (4; not the inactive item, the inactive supplier''s items or tenant B''s)');
select is((select v::jsonb -> 'supplierItems' -> 0 from outs where k = 'oi'),
  '{"supplierItemId":"51000000-0000-4000-8000-000000000004","ingredientId":"1a000000-0000-4000-8000-000000000004","supplierId":"5a000000-0000-4000-8000-0000000000a3","supplierName":"Pescheria Z (demo)","packQty":0.5,"packLabel":"500 g"}'::jsonb,
  'each with the pack size in base units and a label, ordered by ingredient name');
select is((select v::jsonb = (select v::jsonb from outs where k = 'ai') from outs where k = 'oi'), true, 'the admin gets the same answer as the owner');
select is((select v::jsonb ? 'supplierItems' from outs where k = 'ci'), false, 'the chef gets no supplierItems');
select is((select v::jsonb ->> 'today' from outs where k = 'ci'), app.alert_business_date('11111111-1111-4111-8111-111111111111', now())::text,
  'the chef''s p_at is ignored: today is the real today');
select is((select v::jsonb ->> 'today' from outs where k = 'ci0'), app.alert_business_date('11111111-1111-4111-8111-111111111111', now())::text, 'no p_at: today');

-- No cost key anywhere, for any role.
select is((select count(*)::int from outs o, unnest(pg_temp.all_keys(o.v::jsonb)) kk (key)
            where o.k in ('oi', 'os', 'or', 'ai', 'as', 'ar', 'ci', 'cs', 'cr') and kk.key ~* 'eur|cost|price|last_price|margin|amount|total'), 0,
  'no key at any depth matches the money pattern, for owner, admin and chef');
select is((select count(*)::int from outs o where o.k in ('oi', 'ai', 'ci') and (o.v like '%12.34%' or o.v like '%55.55%')), 0, 'and no last_price value leaks');

-- rules_suppliers ----------------------------------------------------------------------------------------------------------
select is((select string_agg(i ->> 'name', ' | ') from outs o, jsonb_array_elements(o.v::jsonb -> 'items') i where o.k = 'os'),
  'Macelleria X (demo) | Orto Y (demo) | Pescheria Z (demo)', 'active suppliers, ordered by name (the inactive one and tenant B''s are not listed)');
select is((select i - 'nextWindow' from outs o, jsonb_array_elements(o.v::jsonb -> 'items') i where o.k = 'os' and i ->> 'name' = 'Macelleria X (demo)'),
  '{"supplierId":"5a000000-0000-4000-8000-00000000005a","name":"Macelleria X (demo)","leadTimeDays":2,"deliveryWeekdays":[1,4],"orderCutoffTime":"11:00"}'::jsonb,
  'Macelleria: lead time 2, weekdays {1,4}, cut-off "11:00"');
select is((select (i -> 'nextWindow') = jsonb_build_object('deliveryDate', w.delivery_date, 'orderByAt', app.iso_utc(w.order_by_at))
             from outs o, jsonb_array_elements(o.v::jsonb -> 'items') i,
                  lateral app.next_delivery_window(now(), 'Europe/Rome', '{1,4}', '11:00', 2::smallint) w
            where o.k = 'os' and i ->> 'name' = 'Macelleria X (demo)'), true, 'its next window is the helper''s answer at the real now');
select is((select i -> 'nextWindow' from outs o, jsonb_array_elements(o.v::jsonb -> 'items') i where o.k = 'os' and i ->> 'name' = 'Orto Y (demo)'), 'null'::jsonb,
  'a supplier without weekdays has no window');
select is((select i -> 'orderCutoffTime' from outs o, jsonb_array_elements(o.v::jsonb -> 'items') i where o.k = 'os' and i ->> 'name' = 'Orto Y (demo)'), 'null'::jsonb, 'and a null cut-off is null');
select is((select v = (select v from outs where k = 'os') from outs where k = 'cs'), true, 'the chef reads the same suppliers');
select is((select v = (select v from outs where k = 'os') from outs where k = 'as'), true, 'and the admin too');

-- rules_recipes --------------------------------------------------------------------------------------------------------------
select is((select string_agg(i ->> 'name', ' | ' order by i ->> 'name') from outs o, jsonb_array_elements(o.v::jsonb -> 'items') i where o.k = 'or'),
  'Brodo (demo) | Spezzatino (demo)', 'the batch keys only (not the plate or the sub)');
select is((select i - 'recipeKey' from outs o, jsonb_array_elements(o.v::jsonb -> 'items') i where o.k = 'or' and i ->> 'name' = 'Spezzatino (demo)'),
  '{"name":"Spezzatino (demo)","version":3,"portionsPerBatch":30,"minPortions":5,"targetPortions":30,"prepTimeMin":180,"sources":{"min":"rule","target":"rule","prep":"rule"},"remainingPortions":4}'::jsonb,
  'stew: the rule values with source rule, 4 portions remaining (the expired batch of 10 does not count)');
select is((select i - 'recipeKey' from outs o, jsonb_array_elements(o.v::jsonb -> 'items') i where o.k = 'or' and i ->> 'name' = 'Brodo (demo)'),
  '{"name":"Brodo (demo)","version":1,"portionsPerBatch":20,"minPortions":2,"targetPortions":8,"prepTimeMin":null,"sources":{"min":"version","target":"version","prep":null},"remainingPortions":6}'::jsonb,
  'broth: the version''s values with source version, a null prep time and 6 portions');
select is((select v = (select v from outs where k = 'or') from outs where k = 'cr'), true, 'the chef reads the same recipes');
select is((select i ->> 'recipeKey' from outs o, jsonb_array_elements(o.v::jsonb -> 'items') i where o.k = 'or' and i ->> 'name' = 'Brodo (demo)'),
  'b2000000-0000-4000-8000-000000000004', 'each item carries its recipe key');

-- app.remaining_portions ------------------------------------------------------------------------------------------------------
select is((select string_agg(r.recipe_key || ':' || trim_scale(r.remaining), ',' order by r.recipe_key)
             from app.remaining_portions('11111111-1111-4111-8111-111111111111', now()) r),
  'b2000000-0000-4000-8000-000000000001:4,b2000000-0000-4000-8000-000000000004:6', 'remaining_portions: in-date batches only, per recipe key');
select is((select count(*)::int from app.remaining_portions('11111111-1111-4111-8111-111111111111', now() + interval '3 days')), 0,
  'at a later instant every batch is past its use-by: none');
select is((select count(*)::int from app.remaining_portions('22222222-2222-4222-8222-222222222222', now())), 0, 'and tenant B has none of them');

-- Roles and tenants ------------------------------------------------------------------------------------------------------------
select is((select string_agg(v, ';' order by k) from outs where k in ('wi', 'ws', 'wr')),
  '42501 permission denied: rules need owner, admin or chef;42501 permission denied: rules need owner, admin or chef;42501 permission denied: rules need owner, admin or chef',
  'the waiter gets 42501 from all three');
select is((select count(*)::int from outs where k in ('ni', 'ns', 'nr') and v like '42501 %'), 3, 'no claims: 42501 from all three');
select is((select jsonb_array_length(v::jsonb -> 'items') from outs where k = 'bi'), 1, 'owner B sees only B''s ingredient');
select is((select v::jsonb -> 'items' -> 0 ->> 'name' from outs where k = 'bi'), 'Manzo B (demo)', 'which is B''s own');
select is((select v::jsonb -> 'items' -> 0 ->> 'name' from outs where k = 'bs'), 'Macelleria B (demo)', 'owner B sees only B''s supplier');
select is((select v::jsonb -> 'items' -> 0 ->> 'name' from outs where k = 'br'), 'Spezzatino B (demo)', 'and only B''s recipe');
select is((select jsonb_array_length(v::jsonb -> 'supplierItems') from outs where k = 'bi'), 1, 'and only B''s supplier item');

select * from finish();
rollback;
