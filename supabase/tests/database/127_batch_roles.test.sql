-- M14 step 7 (AT7, project V6): the role catalogue of the batch objects. The waiter has no access at all; the chef
-- produces and reads quantities but reads no batch_cost row and cannot call batch_costs (founder Q16 = project V6
-- replaces the base-plan wording of AT7), and cannot write any table; admin and owner are allowed all five
-- functions but still cannot write the tables directly; nobody without claims gets in. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

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
declare
  v_d date := app.venue_date(now(), 'Europe/Rome');
begin
  perform pg_temp.mk_ing('beef_' || p, 'Manzo muscolo ' || p || ' (demo)');
  perform pg_temp.mk_ing('onion_' || p, 'Cipolla ' || p || ' (demo)');
  perform pg_temp.mk_ing('carrot_' || p, 'Carota ' || p || ' (demo)');
  perform pg_temp.mk_ing('salt_' || p, 'Sale grosso ' || p || ' (demo)');
  perform pg_temp.mk_ing('water_' || p, 'Acqua ' || p || ' (demo)', 'l', false);
  perform pg_temp.mk_lot('d2_' || p, 'L-D2', 'beef_' || p, v_d + 2, 3);
  perform pg_temp.mk_lot('d5_' || p, 'L-D5', 'beef_' || p, v_d + 5, 3);
  perform pg_temp.mk_lot('cip_' || p, 'L-CIP', 'onion_' || p, v_d + 7, 2);
  perform pg_temp.mk_lot('car_' || p, 'L-CAR', 'carrot_' || p, v_d + 7, 2);
  perform pg_temp.mk_lot('old_' || p, 'L-OLD', 'carrot_' || p, v_d - 1, 1);
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
-- Claims for each role, and the objects the role may touch.
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
create function pg_temp.as_none() returns void language sql as $$ select set_config('request.jwt.claims', '', true) $$;
insert into auth.users (id, email) values ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111',
   'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111',
   'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo');
-- One public production; the answer is kept by key. The rows it writes are read by LATER statements.
create temporary table res (k text primary key, r jsonb);
create function pg_temp.prod(p_k text, p_recipe text, p_output numeric, p_inputs jsonb, p_portions int default null,
    p_shelf int default null, p_loc uuid default null)
  returns void language sql as $$
  insert into res select p_k, public.produce_batch(pg_temp.id(p_recipe), p_output, p_inputs, p_portions, p_shelf, p_loc)
$$;
create function pg_temp.prop(p_k text, p_recipe_key text, p_output numeric default null, p_shelf int default null)
  returns void language sql as $$
  insert into res select p_k, public.batch_proposal(pg_temp.id(p_recipe_key), p_output, p_shelf)
$$;
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

create temporary table outs (k text primary key, v text);
create temporary table stmts (n int primary key, sql text);
select pg_temp.world('a');
-- A batch to read, made by the migration owner through the core.
select app.produce_batch_core('11111111-1111-4111-8111-111111111111', 'c1000000-0000-4000-8000-00000000000c', pg_temp.id('r_stew_a'),
  0.6, pg_temp.inp('a', 0.5, 0.03, 0.02), null, null, null, now() - interval '1 hour');
insert into stmts values
  (1, format('select public.batch_proposal(%L)', pg_temp.id('k_stew_a'))),
  (2, format('select public.produce_batch(%L, 0.6, %L::jsonb)', pg_temp.id('r_stew_a'), pg_temp.inp('a', 0.5, 0.03, 0.02))),
  (3, 'select public.batch_list()'),
  (4, format('select public.batch_label(%L)', (select id from public.batch limit 1))),
  (5, format('select * from public.batch_costs(array[%L]::uuid[])', (select id from public.batch limit 1)));
-- The outcome of each function: 'ok' or its SQLSTATE.
create function pg_temp.outcomes() returns text language plpgsql as $$
declare
  v_out text := '';
  e text;
  s record;
begin
  for s in select x.sql from stmts x order by x.n loop
    e := pg_temp.err(s.sql);
    v_out := v_out || case when e = 'ok' then 'ok' else left(e, 5) end || ' ';
  end loop;
  return rtrim(v_out);
end
$$;
-- A direct write of each kind on each table; the outcome of every one.
create function pg_temp.direct_writes() returns text language plpgsql as $$
declare
  v_out text := '';
  e text;
  s text;
begin
  foreach s in array array[
    $q$ insert into public.batch (tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code, lot_seq,
        produced_at, produced_by, output_qty, output_unit, portions_computed, portions_initial, shelf_life_hours, use_by,
        location_id, created_by)
        select tenant_id, recipe_key, recipe_id, recipe_version, 'X-1', lot_date, lot_recipe_code, 9, produced_at, produced_by,
        output_qty, output_unit, portions_computed, portions_initial, 72, produced_at + interval '72 hours', location_id, created_by from public.batch limit 1 $q$,
    $q$ update public.batch set state = 'open' $q$, $q$ delete from public.batch $q$, $q$ truncate public.batch cascade $q$,
    $q$ insert into public.batch_input (tenant_id, batch_id, ingredient_id, location_id, qty, stock_movement_id)
        select tenant_id, batch_id, ingredient_id, location_id, qty, stock_movement_id from public.batch_input limit 1 $q$,
    $q$ update public.batch_input set qty = 1 $q$, $q$ delete from public.batch_input $q$,
    $q$ insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on)
        select tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on from public.batch_movement limit 1 $q$,
    $q$ update public.batch_movement set portions = 1 $q$, $q$ delete from public.batch_movement $q$,
    $q$ insert into public.batch_cost (batch_id, tenant_id, incomplete, missing_ingredient_ids, cost_at)
        values (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', true, '{}', now()) $q$,
    $q$ update public.batch_cost set total_cost = 1 $q$, $q$ delete from public.batch_cost $q$]
  loop
    e := pg_temp.err(s);
    v_out := v_out || left(e, 5) || ' ';
  end loop;
  return rtrim(v_out);
end
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
create function pg_temp.reads() returns text language sql as $$
  select pg_temp.seen('batch') || '/' || pg_temp.seen('batch_input') || '/' || pg_temp.seen('batch_movement') || '/'
      || pg_temp.seen('batch_cost') || '/' || pg_temp.seen('v_batch_portions') $$;
grant all on reg, res, outs, stmts to authenticated, anon;
grant execute on function pg_temp.id(text), pg_temp.err(text), pg_temp.outcomes(),
  pg_temp.direct_writes(), pg_temp.seen(text), pg_temp.reads(), pg_temp.as_chef(), pg_temp.as_owner(), pg_temp.as_admin(),
  pg_temp.as_waiter(), pg_temp.as_none(), pg_temp.act_as(uuid, uuid, text) to authenticated, anon;

set local role authenticated;
select pg_temp.as_waiter();
insert into outs values ('waiter', pg_temp.outcomes()), ('waiter_reads', pg_temp.reads()), ('waiter_writes', pg_temp.direct_writes());
select pg_temp.as_chef();
insert into outs values ('chef', pg_temp.outcomes()), ('chef_reads', pg_temp.reads()), ('chef_writes', pg_temp.direct_writes());
select pg_temp.as_admin();
insert into outs values ('admin', pg_temp.outcomes()), ('admin_reads', pg_temp.reads()), ('admin_writes', pg_temp.direct_writes());
select pg_temp.as_owner();
insert into outs values ('owner', pg_temp.outcomes()), ('owner_reads', pg_temp.reads()), ('owner_writes', pg_temp.direct_writes());
select pg_temp.as_none();
insert into outs values ('none', pg_temp.outcomes()), ('none_reads', pg_temp.reads()), ('none_writes', pg_temp.direct_writes());
reset role;

select is((select v from outs where k = 'waiter'), '42501 42501 42501 42501 42501', 'AT7: the waiter is refused by all five functions');
select is((select v from outs where k = 'waiter_reads'), '0/0/0/0/0', 'AT7: and reads no row of the four tables or the view');
select is((select v from outs where k = 'waiter_writes'), '42501 42501 42501 42501 42501 42501 42501 42501 42501 42501 42501 42501 42501',
  'and no direct write of any kind is allowed');
select is((select v from outs where k = 'chef'), 'ok ok ok ok 42501',
  'AT7 (project V6): the chef proposes, produces, lists and reads labels, but batch_costs is refused');
select matches((select v from outs where k = 'chef_reads'), '^[1-9][0-9]*/[1-9][0-9]*/[1-9][0-9]*/0/[1-9][0-9]*$',
  'the chef reads batches, inputs, movements and portions, and 0 batch_cost rows');
select is((select v from outs where k = 'chef_writes'), '42501 42501 42501 42501 42501 42501 42501 42501 42501 42501 42501 42501 42501',
  'the chef cannot insert, update, delete or truncate any batch table');
select is((select v from outs where k = 'admin'), 'ok ok ok ok ok', 'the admin is allowed all five functions');
select matches((select v from outs where k = 'admin_reads'), '^[1-9][0-9]*/[1-9][0-9]*/[1-9][0-9]*/[1-9][0-9]*/[1-9][0-9]*$',
  'and reads batch_cost rows');
select is((select v from outs where k = 'admin_writes'), '42501 42501 42501 42501 42501 42501 42501 42501 42501 42501 42501 42501 42501',
  'but cannot write the tables directly');
select is((select v from outs where k = 'owner'), 'ok ok ok ok ok', 'the owner is allowed all five functions');
select matches((select v from outs where k = 'owner_reads'), '^[1-9][0-9]*/[1-9][0-9]*/[1-9][0-9]*/[1-9][0-9]*/[1-9][0-9]*$',
  'and reads batch_cost rows');
select is((select v from outs where k = 'owner_writes'), '42501 42501 42501 42501 42501 42501 42501 42501 42501 42501 42501 42501 42501',
  'but cannot write the tables directly either');
select is((select v from outs where k = 'none'), '42501 42501 42501 42501 42501', 'without claims all five functions are refused');
select is((select v from outs where k = 'none_reads'), '0/0/0/0/0', 'and nothing is readable');
select is((select v from outs where k = 'none_writes'), '42501 42501 42501 42501 42501 42501 42501 42501 42501 42501 42501 42501 42501',
  'and nothing is writable');

-- Grants: the five functions are executable by authenticated only --------------------------------------------------------------
select is_empty($$ select f.proname, r.rolname
    from pg_proc f cross join (values ('anon'), ('service_role')) r (rolname)
   where f.pronamespace = 'public'::regnamespace
     and f.proname in ('batch_proposal', 'produce_batch', 'batch_list', 'batch_label', 'batch_costs')
     and has_function_privilege(r.rolname, f.oid, 'execute') $$, 'anon and service_role have no EXECUTE on the five functions');
select is((select count(*)::int from pg_proc f where f.pronamespace = 'public'::regnamespace
            and f.proname in ('batch_proposal', 'produce_batch', 'batch_list', 'batch_label', 'batch_costs')
            and has_function_privilege('authenticated', f.oid, 'execute')), 5, 'authenticated has it on all five');
select is_empty($$ select f.proname from pg_proc f
   where f.pronamespace = 'app'::regnamespace
     and f.proname ~ '^(require_batch|lock_batch_lot|next_lot_seq|produce_batch_core|batch_requirements|batch_guard|batch_input_guard|lot_recipe_code|batch_use_by|use_by_state|batch_portions|initials)'
     and (has_function_privilege('anon', f.oid, 'execute') or has_function_privilege('authenticated', f.oid, 'execute')
          or has_function_privilege('service_role', f.oid, 'execute')) $$,
  'no API role can execute any app.* batch function');
select is_empty($$ select c.relname from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relname in ('batch', 'batch_input', 'batch_movement', 'batch_cost', 'v_batch_portions')
     and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'insert')
          or has_table_privilege('authenticated', c.oid, 'update') or has_table_privilege('authenticated', c.oid, 'delete')) $$,
  'anon reads nothing and authenticated writes nothing');
select is((select pg_get_expr(p.polqual, p.polrelid) ~ 'owner.*admin' and pg_get_expr(p.polqual, p.polrelid) !~ 'chef'
             from pg_policy p where p.polname = 'batch_cost_select'), true,
  'the batch_cost policy lists the owner and admin roles, not the chef');
select is((select count(*)::int from pg_policy p where p.polrelid in ('public.batch'::regclass, 'public.batch_input'::regclass,
            'public.batch_movement'::regclass, 'public.batch_cost'::regclass) and p.polcmd <> 'r'), 0,
  'the four tables have select policies only');

select * from finish();
rollback;
