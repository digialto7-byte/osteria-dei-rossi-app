-- M14 step 6: the read functions batch_list, batch_label and batch_costs (M14 plan §3.1.12, §3.1.13, §3.2; AT5, AT7;
-- ADR-013). Quantities for owner, admin and chef; EUR (batch_costs) for owner and admin only (founder Q16 = project
-- V6). Batches are made through the core at instants relative to now(), so the use-by states do not depend on
-- the day the suite runs. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)'),
  ('10000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Cella B (demo)');
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo Srl', 'IT12345678903');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id) values
  ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/e1000000-0000-4000-8000-0000000000e1.pdf',
   'application/pdf', 2048, 'review', '5a000000-0000-4000-8000-00000000005a');

create temporary table reg (k text primary key, id uuid not null);
insert into reg values ('cella', '10000000-0000-4000-8000-0000000000a1');
create function pg_temp.id(p_k text) returns uuid language sql as $$ select id from reg where k = p_k $$;
create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare
  state text;
  msg text;
  detail text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text, detail = pg_exception_detail;
  return state || ' ' || msg || coalesce(' / ' || nullif(detail, ''), '');
end
$$;

create sequence pg_temp.line_seq;
create function pg_temp.new_line() returns uuid language plpgsql as $$
declare
  v_n int := nextval('pg_temp.line_seq');
  v_line uuid := ('a2000000-0000-4000-8000-' || lpad(v_n::text, 12, '0'))::uuid;
begin
  insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price,
      line_amount, field_confidence, extracted)
    values (v_line, '11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-0000000000e1', v_n, 'Riga demo', 1,
      10, 10, '{}', '{}');
  return v_line;
end
$$;
create function pg_temp.mk_ing(p_k text, p_name text, p_unit text default 'kg', p_stock boolean default true) returns void language plpgsql as $$
begin
  insert into reg values (p_k, gen_random_uuid());
  insert into public.ingredient (id, tenant_id, name, base_unit, is_stock)
    values (pg_temp.id(p_k), '11111111-1111-4111-8111-111111111111', p_name, p_unit::public.base_unit, p_stock);
end
$$;
-- A lot at Cella with its receipt.
create function pg_temp.mk_lot(p_key text, p_code text, p_ing text, p_expiry date, p_qty numeric) returns void language plpgsql as $$
declare
  v_line uuid := pg_temp.new_line();
  v_lot uuid := gen_random_uuid();
begin
  insert into reg values (p_key, v_lot);
  insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code,
      expiry, received_on, qty_received, base_unit, source_qty, source_unit, base_factor, created_by)
    select v_lot, '11111111-1111-4111-8111-111111111111', i.id, pg_temp.id('cella'),
           '5a000000-0000-4000-8000-00000000005a', v_line, p_code, p_expiry, '2026-10-20', p_qty, i.base_unit, p_qty,
           i.base_unit::text, 1, 'a1000000-0000-4000-8000-00000000000a'
      from public.ingredient i where i.id = pg_temp.id(p_ing);
  insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost,
      ref_type, ref_id, effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', pg_temp.id(p_ing), v_lot, pg_temp.id('cella'), 'receipt', p_qty, 10,
      'invoice_line', v_line, '2026-10-20', 'a1000000-0000-4000-8000-00000000000a');
end
$$;
create function pg_temp.buy(p_ing text, p_price numeric, p_on date) returns void language sql as $$
  insert into public.price_history (tenant_id, ingredient_id, supplier_id, invoice_line_id, unit_price, base_unit,
      effective_on, created_by)
    select '11111111-1111-4111-8111-111111111111', i.id, '5a000000-0000-4000-8000-00000000005a', pg_temp.new_line(),
           p_price, i.base_unit, p_on, 'a1000000-0000-4000-8000-00000000000a'
      from public.ingredient i where i.id = pg_temp.id(p_ing)
$$;
-- A recipe key with its version 1 (a batch gets the output, portions and shelf life given).
create function pg_temp.mk_rec(p_k text, p_name text, p_type text, p_out numeric, p_unit text default 'kg',
    p_ppb int default null, p_shelf int default null) returns void language plpgsql as $$
begin
  insert into reg values ('k_' || p_k, gen_random_uuid()), ('r_' || p_k, gen_random_uuid());
  insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by)
    values (pg_temp.id('k_' || p_k), '11111111-1111-4111-8111-111111111111', p_type::public.recipe_type, 1,
            lower(p_name), 'a1000000-0000-4000-8000-00000000000a');
  insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit,
      portions_per_batch, shelf_life_hours, created_by)
    values (pg_temp.id('r_' || p_k), '11111111-1111-4111-8111-111111111111', pg_temp.id('k_' || p_k), 1,
            '2026-10-01T00:00Z', p_name, p_out, p_unit::public.base_unit, p_ppb, p_shelf,
            'a1000000-0000-4000-8000-00000000000a');
end
$$;
create function pg_temp.ln(p_rec text, p_pos int, p_target text, p_qty numeric, p_unit text default 'kg') returns void language plpgsql as $$
begin
  insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, sub_recipe_key, qty, unit, created_by)
    values ('11111111-1111-4111-8111-111111111111', pg_temp.id('r_' || p_rec), p_pos,
      (select id from reg where k = p_target and k !~ '^k_'), (select id from reg where k = p_target and k ~ '^k_'),
      p_qty, p_unit::public.recipe_unit, 'a1000000-0000-4000-8000-00000000000a');
end
$$;
-- A world: ingredients beef/onion/carrot/salt (kg), water (l, not stock); beef lots L-D2 3 kg and L-D5 3 kg, onion
-- L-CIP 2 kg, carrot L-CAR 2 kg, salt L-SAL 1 kg; three purchases each of beef (10), onion (1) and carrot (1);
-- recipes: soffritto (sub), stew (batch 6 kg, 30 portions, 72 h), brodo (batch 5 l, 20 portions, 48 h) and a second
-- stew (3 kg, 15 portions, 72 h) whose name shares the lot code SPEZZA.
create function pg_temp.world(p text) returns void language plpgsql as $$
begin
  perform pg_temp.mk_ing('beef_' || p, 'Manzo muscolo ' || p || ' (demo)');
  perform pg_temp.mk_ing('onion_' || p, 'Cipolla ' || p || ' (demo)');
  perform pg_temp.mk_ing('carrot_' || p, 'Carota ' || p || ' (demo)');
  perform pg_temp.mk_ing('salt_' || p, 'Sale grosso ' || p || ' (demo)');
  perform pg_temp.mk_ing('water_' || p, 'Acqua ' || p || ' (demo)', 'l', false);
  perform pg_temp.mk_lot('d2_' || p, 'L-D2', 'beef_' || p, '2026-10-25', 3);
  perform pg_temp.mk_lot('d5_' || p, 'L-D5', 'beef_' || p, '2026-10-28', 3);
  perform pg_temp.mk_lot('cip_' || p, 'L-CIP', 'onion_' || p, '2026-10-30', 2);
  perform pg_temp.mk_lot('car_' || p, 'L-CAR', 'carrot_' || p, '2026-10-30', 2);
  perform pg_temp.mk_lot('sal_' || p, 'L-SAL', 'salt_' || p, null, 1);
  perform pg_temp.buy('beef_' || p, 10, d) from unnest(array['2026-09-01', '2026-09-02', '2026-09-03']::date[]) d;
  perform pg_temp.buy('onion_' || p, 1, d) from unnest(array['2026-09-01', '2026-09-02', '2026-09-03']::date[]) d;
  perform pg_temp.buy('carrot_' || p, 1, d) from unnest(array['2026-09-01', '2026-09-02', '2026-09-03']::date[]) d;
  perform pg_temp.mk_rec('sof_' || p, 'Soffritto ' || p || ' (demo)', 'sub', 1);
  perform pg_temp.ln('sof_' || p, 1, 'onion_' || p, 0.6); perform pg_temp.ln('sof_' || p, 2, 'carrot_' || p, 0.4);
  perform pg_temp.mk_rec('stew_' || p, 'Spezzatino ' || p || ' (demo)', 'batch', 6, 'kg', 30, 72);
  perform pg_temp.ln('stew_' || p, 1, 'beef_' || p, 5); perform pg_temp.ln('stew_' || p, 2, 'k_sof_' || p, 0.5);
  perform pg_temp.ln('stew_' || p, 3, 'water_' || p, 1, 'l');
  perform pg_temp.mk_rec('brodo_' || p, 'Brodo ' || p || ' (demo)', 'batch', 5, 'l', 20, 48);
  perform pg_temp.ln('brodo_' || p, 1, 'onion_' || p, 0.2); perform pg_temp.ln('brodo_' || p, 2, 'salt_' || p, 30, 'g');
  perform pg_temp.mk_rec('manzo_' || p, 'Spezzatino di manzo ' || p || ' (demo)', 'batch', 3, 'kg', 15, 72);
  perform pg_temp.ln('manzo_' || p, 1, 'beef_' || p, 2.5);
end
$$;

-- The stew's inputs: beef, onion, carrot in kg (a lot override for the beef and a location for each when given).
create function pg_temp.inp(p text, beef numeric, onion numeric, carrot numeric, lot text default null, loc uuid default null)
  returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_strip_nulls(jsonb_build_object('ingredientId', pg_temp.id('beef_' || p), 'qty', beef, 'unit', 'kg',
                                         'lotId', case when lot is null then null else pg_temp.id(lot) end, 'locationId', loc)),
    jsonb_strip_nulls(jsonb_build_object('ingredientId', pg_temp.id('onion_' || p), 'qty', onion, 'unit', 'kg', 'locationId', loc)),
    jsonb_strip_nulls(jsonb_build_object('ingredientId', pg_temp.id('carrot_' || p), 'qty', carrot, 'unit', 'kg', 'locationId', loc)))
$$;
-- One production; the answer is kept by key. The rows it writes are read by LATER statements.
create temporary table res (k text primary key, r jsonb);
create function pg_temp.prod(p_k text, p_recipe text, p_output numeric, p_inputs jsonb, p_at timestamptz,
    p_portions int default null, p_user uuid default 'c1000000-0000-4000-8000-00000000000c')
  returns void language sql as $$
  insert into res select p_k, app.produce_batch_core('11111111-1111-4111-8111-111111111111', p_user, pg_temp.id(p_recipe),
    p_output, p_inputs, p_portions, null, null, p_at)
$$;
create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
create function pg_temp.as_chef() returns void language sql as $$
  select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef') $$;
create function pg_temp.as_owner() returns void language sql as $$
  select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner') $$;
create function pg_temp.as_admin() returns void language sql as $$
  select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin') $$;
create function pg_temp.as_waiter() returns void language sql as $$
  select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter') $$;
create function pg_temp.as_ownerb() returns void language sql as $$
  select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner') $$;
insert into auth.users (id, email) values ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111',
   'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111',
   'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo');
create temporary table outs (k text primary key, v text);
create temporary table calls (k text primary key, j jsonb);
create function pg_temp.try(p_k text, stmt text) returns void language sql as $$ insert into outs values (p_k, pg_temp.err(stmt)) $$;
create function pg_temp.call(p_k text, p_json jsonb) returns void language sql as $$ insert into calls values (p_k, p_json) $$;
create function pg_temp.bid(p_k text) returns uuid language sql as $$ select (r ->> 'batchId')::uuid from res where k = p_k $$;
-- 'lotcode qty, lotcode qty' of a batch's consumption of one ingredient, sorted by lot code ('null' = the shortfall).
create function pg_temp.rows_of(p_k text, p_ing text) returns text language sql as $$
  select coalesce(string_agg(coalesce(l.lot_code, 'null') || ' ' || trim_scale(m.qty)::text, ', '
                             order by coalesce(l.lot_code, 'null') collate "C"), '-')
    from public.stock_movement m left join public.raw_lot l on l.id = m.raw_lot_id
   where m.ref_type = 'batch' and m.ref_id = pg_temp.bid(p_k) and m.ingredient_id = pg_temp.id(p_ing) $$;
create function pg_temp.counts() returns text language sql as $$
  select (select count(*) from public.stock_movement) || '/' || (select count(*) from public.batch) || '/'
      || (select count(*) from public.batch_input) || '/' || (select count(*) from public.batch_movement) || '/'
      || (select count(*) from public.batch_cost) || '/' || (select count(*) from public.alert) $$;
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

grant all on reg, res, outs, calls to authenticated, anon;
grant execute on function pg_temp.id(text), pg_temp.err(text), pg_temp.try(text, text), pg_temp.call(text, jsonb),
  pg_temp.as_chef(), pg_temp.as_owner(), pg_temp.as_admin(), pg_temp.as_waiter(), pg_temp.as_ownerb(),
  pg_temp.act_as(uuid, uuid, text) to authenticated, anon;

select pg_temp.world('a');
-- Four batches: b1 the AT1 stew (1 h ago), b4 a second stew recipe (2 h ago), b2 a small stew by the owner with
-- 2 portions (60 h ago: 12 h left), b3 a brodo with an unpriced salt (80 h ago: its 48 h are over).
select pg_temp.prod('b1', 'r_stew_a', 6.2, pg_temp.inp('a', 5.3, 0.31, 0.2067), now() - interval '1 hour');
select pg_temp.prod('b4', 'r_manzo_a', 0.3, jsonb_build_array(jsonb_build_object('ingredientId', pg_temp.id('beef_a'), 'qty', 0.25, 'unit', 'kg')),
  now() - interval '2 hours');
select pg_temp.prod('b2', 'r_stew_a', 0.6, pg_temp.inp('a', 0.5, 0.03, 0.02), now() - interval '60 hours', 2,
  'a1000000-0000-4000-8000-00000000000a');
select pg_temp.prod('b3', 'r_brodo_a', 5, jsonb_build_array(
  jsonb_build_object('ingredientId', pg_temp.id('onion_a'), 'qty', 0.2, 'unit', 'kg'),
  jsonb_build_object('ingredientId', pg_temp.id('salt_a'), 'qty', 30, 'unit', 'g')), now() - interval '80 hours');
-- Tenant B: one batch recipe and one batch (isolation).
insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('1b000000-0000-4000-8000-00000000001b', '22222222-2222-4222-8222-222222222222', 'Burro B (demo)', 'kg');
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'batch', 1, 'fondo b (demo)',
   'b1000000-0000-4000-8000-00000000000b');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch,
    shelf_life_hours, created_by) values
  ('ed000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'ec000000-0000-4000-8000-0000000000b1', 1,
   '2026-10-01T00:00Z', 'Fondo B (demo)', 2, 'kg', 10, 24, 'b1000000-0000-4000-8000-00000000000b');
insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code, lot_seq,
    produced_at, produced_by, output_qty, output_unit, portions_computed, portions_initial, shelf_life_hours, use_by, location_id,
    created_by) values
  ('ba000000-0000-4000-8000-0000000000bb', '22222222-2222-4222-8222-222222222222', 'ec000000-0000-4000-8000-0000000000b1',
   'ed000000-0000-4000-8000-0000000000b1', 1, '261001-FONDOB-1', '2026-10-01', 'FONDOB', 1, '2026-10-01T08:00Z',
   'b1000000-0000-4000-8000-00000000000b', 2, 'kg', 10, 10, 24, '2026-10-02T08:00Z', '10000000-0000-4000-8000-0000000000b1',
   'b1000000-0000-4000-8000-00000000000b');

-- batch_list ----------------------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_chef();
select pg_temp.call('all', public.batch_list());
select pg_temp.call('page1', public.batch_list(null, null, null, 2));
select pg_temp.call('stew', public.batch_list((select id from reg where k = 'k_stew_a')));
select pg_temp.try('limit0', $$ select public.batch_list(null, null, null, 0) $$);
select pg_temp.try('limit101', $$ select public.batch_list(null, null, null, 101) $$);
select pg_temp.try('half_cursor', $$ select public.batch_list(null, now(), null, 10) $$);
reset role;
select is((select string_agg(i ->> 'batchId', ',' order by n) from calls, jsonb_array_elements(j -> 'items') with ordinality x (i, n) where k = 'all'),
  pg_temp.bid('b1') || ',' || pg_temp.bid('b4') || ',' || pg_temp.bid('b2') || ',' || pg_temp.bid('b3'),
  'the list is newest first');
select is((select jsonb_array_length(j -> 'items') || ' ' || coalesce(j ->> 'nextCursor', 'null') from calls where k = 'all'), '4 null',
  'four batches of the tenant, no next page (tenant B''s batch is not listed)');
select is((select string_agg((i ->> 'useByState'), ',' order by n) from calls, jsonb_array_elements(j -> 'items') with ordinality x (i, n) where k = 'all'),
  'ok,ok,due_soon,expired', 'useByState: ok, ok, due_soon (12 h left), expired');
select is((select (i ->> 'portionsInitial') || '/' || (i ->> 'portionsComputed') || '/' || trim_scale((i ->> 'portionsRemaining')::numeric)
             from calls, jsonb_array_elements(j -> 'items') i where k = 'all' and i ->> 'batchId' = pg_temp.bid('b2')::text),
  '2/3/2', 'portions: confirmed 2, computed 3, remaining 2 (from the ledger)');
select is((select (i ->> 'portionsInitial') || '/' || trim_scale((i ->> 'portionsRemaining')::numeric)
             from calls, jsonb_array_elements(j -> 'items') i where k = 'all' and i ->> 'batchId' = pg_temp.bid('b1')::text),
  '31/31', 'and 31 of 31 for the first batch');
select is((select string_agg((i ->> 'byInitials') || ':' || (i ->> 'byMe'), ',' order by n) from calls, jsonb_array_elements(j -> 'items') with ordinality x (i, n) where k = 'all'),
  'CD:true,CD:true,TD:false,CD:true', 'initials of the producer, and byMe for the chef''s own batches (the owner''s is TD)');
select is((select string_agg(i ->> 'recipeName' || ' v' || (i ->> 'version') || ' ' || (i ->> 'lotCode') || ' ' || (i ->> 'locationName'), ';' order by n)
             from calls, jsonb_array_elements(j -> 'items') with ordinality x (i, n) where k = 'all' and n = 1),
  'Spezzatino a (demo) v1 ' || (select lot_code from public.batch where id = pg_temp.bid('b1')) || ' Cella (demo)', 'the item names the pinned recipe, the lot code and the place');
select is((select jsonb_array_length(j -> 'items') from calls where k = 'stew'), 2, 'p_recipe_key filters (two stew batches)');
select is((select jsonb_array_length(j -> 'items') || ' ' || (j -> 'nextCursor' ->> 'id') from calls where k = 'page1'), '2 ' || pg_temp.bid('b4'),
  'p_limit 2: two items and a cursor on the second');
set local role authenticated;
select pg_temp.as_chef();
select pg_temp.call('page2', public.batch_list(null, ((select j from calls where k = 'page1') -> 'nextCursor' ->> 'producedAt')::timestamptz,
  ((select j from calls where k = 'page1') -> 'nextCursor' ->> 'id')::uuid, 2));
reset role;
select is((select string_agg(i ->> 'batchId', ',' order by n) from calls, jsonb_array_elements(j -> 'items') with ordinality x (i, n) where k = 'page2'),
  pg_temp.bid('b2') || ',' || pg_temp.bid('b3'), 'the next page continues without a gap or a repeat');
select is((select v from outs where k = 'limit0'), 'P0001 invalid_request', 'p_limit 0: invalid_request');
select is((select v from outs where k = 'limit101'), 'P0001 invalid_request', 'p_limit 101: invalid_request');
select is((select v from outs where k = 'half_cursor'), 'P0001 invalid_request', 'half a cursor: invalid_request');
select is_empty($$ select x from calls, unnest(pg_temp.all_keys(j)) x where k in ('all', 'page1', 'page2') and x ~* '(eur|cost|price|value|amount)' $$,
  'no list key at any depth names a cost');

-- batch_label ----------------------------------------------------------------------------------------------------------------
-- Version 2 of the stew renames the recipe; the batch keeps the name of its pinned version.
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch,
    shelf_life_hours, created_by)
  values (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', pg_temp.id('k_stew_a'), 2, now() - interval '30 minutes',
    'Spezzatino rinnovato (demo)', 6, 'kg', 30, 72, 'a1000000-0000-4000-8000-00000000000a');
update public.recipe_key set current_version = 2 where id = pg_temp.id('k_stew_a');
set local role authenticated;
select pg_temp.as_chef();
select pg_temp.call('label', public.batch_label(pg_temp.bid('b1')));
select pg_temp.try('label_none', $$ select public.batch_label(gen_random_uuid()) $$);
select pg_temp.as_ownerb();
select pg_temp.try('label_b', format('select public.batch_label(%L)', pg_temp.bid('b1')));
select pg_temp.as_waiter();
select pg_temp.try('label_waiter', format('select public.batch_label(%L)', pg_temp.bid('b1')));
select pg_temp.try('list_waiter', $$ select public.batch_list() $$);
reset role;
select is((select array_agg(x order by x collate "C") from calls, jsonb_object_keys(j) x where calls.k = 'label'),
  array['batchId', 'lotCode', 'operatorInitials', 'portions', 'portionsRemaining', 'producedAt', 'recipeName', 'shelfLifeHours',
        'splitFrom', 'useBy', 'version'],
  'the label has exactly the planned keys (M15 adds portionsRemaining and splitFrom)');
select is((select (j ->> 'recipeName') || ' v' || (j ->> 'version') || ' ' || (j ->> 'portions') || ' ' || (j ->> 'operatorInitials')
                  || ' ' || (j ->> 'shelfLifeHours') from calls where k = 'label'), 'Spezzatino a (demo) v1 31 CD 72',
  'the label shows the pinned version''s name, the portions at production and the operator initials');
select is((select (j ->> 'lotCode') = (select lot_code from public.batch where id = pg_temp.bid('b1')) and
                  (j ->> 'useBy')::timestamptz = (select use_by from public.batch where id = pg_temp.bid('b1')) from calls where k = 'label'),
  true, 'and the stored lot code and use-by');
select is((select v from outs where k = 'label_none'), 'P0002 batch_not_found', 'an unknown batch: batch_not_found');
select is((select v from outs where k = 'label_b'), 'P0002 batch_not_found', 'tenant A''s batch for owner B: batch_not_found');
select alike((select v from outs where k = 'label_waiter'), '42501%', 'the waiter cannot read a label');
select alike((select v from outs where k = 'list_waiter'), '42501%', 'nor the list');
select is_empty($$ select x from calls, unnest(pg_temp.all_keys(j)) x where k = 'label' and x ~* '(eur|cost|price|value|amount)' $$,
  'no label key names a cost');

-- batch_costs ---------------------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_owner();
select pg_temp.call('costs_owner', (select jsonb_agg(to_jsonb(c)) from public.batch_costs(array[pg_temp.bid('b1'), pg_temp.bid('b3')]) c));
select pg_temp.as_admin();
select pg_temp.call('costs_admin', (select jsonb_agg(to_jsonb(c)) from public.batch_costs(array[pg_temp.bid('b1')]) c));
select pg_temp.as_chef();
select pg_temp.try('costs_chef', format('select * from public.batch_costs(array[%L]::uuid[])', pg_temp.bid('b1')));
select pg_temp.as_waiter();
select pg_temp.try('costs_waiter', format('select * from public.batch_costs(array[%L]::uuid[])', pg_temp.bid('b1')));
select pg_temp.as_owner();
select pg_temp.try('costs_101', $$ select * from public.batch_costs((select array_agg(gen_random_uuid()) from generate_series(1, 101))) $$);
select pg_temp.as_ownerb();
select pg_temp.call('costs_b', (select coalesce(jsonb_agg(to_jsonb(c)), '[]') from public.batch_costs(array[pg_temp.bid('b1')]) c));
reset role;
select is((select c ->> 'total_cost_eur' || ' ' || (c ->> 'unit_cost_eur') || ' ' || (c ->> 'incomplete')
             from calls, jsonb_array_elements(j) c where k = 'costs_owner' and c ->> 'batch_id' = pg_temp.bid('b1')::text),
  '53.5167 1.7263 false', 'AT5: the owner reads 53,5167 and 1,7263 for the stew');
select is((select (c ->> 'total_cost_eur') is null || ' ' || ((c ->> 'unit_cost_eur') is null) || ' ' || (c ->> 'incomplete')
                  || ' ' || (c -> 'missing_ingredient_ids')::text
             from calls, jsonb_array_elements(j) c where k = 'costs_owner' and c ->> 'batch_id' = pg_temp.bid('b3')::text),
  'true true true ["' || pg_temp.id('salt_a') || '"]', 'the brodo with an unpriced salt: nulls, incomplete, the salt listed');
select is((select jsonb_array_length(j) from calls where k = 'costs_admin'), 1, 'the admin reads the cost too');
select alike((select v from outs where k = 'costs_chef'), '42501%', 'the chef cannot call batch_costs (Q16 = project V6)');
select alike((select v from outs where k = 'costs_waiter'), '42501%', 'nor the waiter');
select is((select v from outs where k = 'costs_101'), 'P0001 too_many_ids', '101 ids: too_many_ids');
select is((select j from calls where k = 'costs_b'), '[]'::jsonb, 'tenant B gets no row for tenant A''s batch');

-- Grants -----------------------------------------------------------------------------------------------------------------------
select ok(has_function_privilege('authenticated', 'public.batch_list(uuid, timestamptz, uuid, integer)', 'execute')
      and has_function_privilege('authenticated', 'public.batch_label(uuid)', 'execute')
      and has_function_privilege('authenticated', 'public.batch_costs(uuid[])', 'execute'), 'authenticated can execute the three reads');
select is_empty($$ select f.proname, r.rolname
    from pg_proc f cross join (values ('anon'), ('service_role')) r (rolname)
   where f.pronamespace = 'public'::regnamespace and f.proname in ('batch_list', 'batch_label', 'batch_costs')
     and has_function_privilege(r.rolname, f.oid, 'execute') $$, 'anon and service_role cannot execute them');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
            and p.proname in ('batch_list', 'batch_label', 'batch_costs') and p.prosecdef and p.proconfig = array['search_path=""']), 3,
  'all three are security definer with an empty search_path');

select * from finish();
rollback;
