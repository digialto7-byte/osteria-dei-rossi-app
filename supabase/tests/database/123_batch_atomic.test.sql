-- M14 step 4 (AT3): one transaction. A test-only trigger raises fault_injected on the first insert into batch,
-- batch_input, batch_cost or batch_movement, that is AFTER the consumption movements (and, for batch, right after
-- them). The production must leave nothing: no stock movement with ref_type batch, no batch row of any table, the
-- lot buckets as before and no negative_stock alert, although the inputs include a shortfall that would have raised
-- one. A mid-way engine error (lot_empty on the second ingredient) leaves no row of the first. The core is called
-- as the migration owner; the public procedure is one call of it (125 repeats a fault case under chef claims).
-- Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

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
  insert into reg values (p_k, case split_part(p_k, '_', 1)
    when 'beef' then '1a000000-0000-4000-8000-0000000000a1' when 'onion' then '1b000000-0000-4000-8000-0000000000a1'
    when 'carrot' then '1c000000-0000-4000-8000-0000000000a1' when 'salt' then '1d000000-0000-4000-8000-0000000000a1'
    else '1e000000-0000-4000-8000-0000000000a1' end::uuid);
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
create function pg_temp.prod(p_k text, p_recipe text, p_output numeric, p_inputs jsonb, p_portions int default null,
    p_shelf int default null, p_loc uuid default null, p_at timestamptz default '2026-10-23T10:00Z')
  returns void language sql as $$
  insert into res select p_k, app.produce_batch_core('11111111-1111-4111-8111-111111111111',
    'c1000000-0000-4000-8000-00000000000c', pg_temp.id(p_recipe), p_output, p_inputs, p_portions, p_shelf, p_loc, p_at)
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

select pg_temp.world('a');
-- An onion lot that is empty at Cella: received 1 kg, all of it written off.
select pg_temp.mk_lot('empty_a', 'L-EMPTY', 'onion_a', null, 1);
insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, reason_code, ref_type, ref_id,
    effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', pg_temp.id('onion_a'), pg_temp.id('empty_a'), pg_temp.id('cella'), 'waste', -1,
    'spoilage', 'manual', gen_random_uuid(), '2026-10-22', 'a1000000-0000-4000-8000-00000000000a');

create function public.fault_injected() returns trigger language plpgsql as $$
begin
  raise exception 'fault_injected' using errcode = 'P0001';
end
$$;
-- The lot buckets of the world as 'ingredient/lot=qty' sorted.
create function pg_temp.buckets() returns text language sql as $$
  select coalesce(string_agg(i.name || '/' || coalesce(l.lot_code, 'null') || '=' || trim_scale(x.q)::text, ' ' order by i.name collate "C",
                             coalesce(l.lot_code, 'null') collate "C"), '-')
    from (select m.ingredient_id, m.raw_lot_id, sum(m.qty) q from public.stock_movement m
           group by m.ingredient_id, m.raw_lot_id having sum(m.qty) <> 0) x
    join public.ingredient i on i.id = x.ingredient_id
    left join public.raw_lot l on l.id = x.raw_lot_id $$;
create function pg_temp.balances() returns text language sql as $$ select pg_temp.counts() || ' ' || pg_temp.buckets() $$;
-- A production with a shortfall (beef 7 with 6 on hand) under a fault trigger on one table.
create function pg_temp.fault(p_table text) returns text language plpgsql as $$
declare
  v_before text := pg_temp.balances();
  v_err text;
  v_after text;
begin
  execute format('create trigger fault before insert on public.%I for each row execute function public.fault_injected()', p_table);
  v_err := pg_temp.err($q$ select pg_temp.prod('f', 'r_stew_a', 6.2, pg_temp.inp('a', 7, 0.31, 0.2067)) $q$);
  execute format('drop trigger fault on public.%I', p_table);
  v_after := pg_temp.balances();
  return v_err || ' | ' || case when v_before = v_after then 'unchanged' else 'CHANGED ' || v_before || ' -> ' || v_after end;
end
$$;

select is(pg_temp.fault('batch'), 'P0001 fault_injected | unchanged',
  'AT3: a fault at the batch insert (right after the consumption movements) leaves no row and no alert');
select is(pg_temp.fault('batch_input'), 'P0001 fault_injected | unchanged', 'AT3: a fault at the batch_input insert leaves nothing');
select is(pg_temp.fault('batch_cost'), 'P0001 fault_injected | unchanged', 'AT3: a fault at the batch_cost insert leaves nothing');
select is(pg_temp.fault('batch_movement'), 'P0001 fault_injected | unchanged', 'AT3: a fault at the produce movement leaves nothing');
select is((select count(*)::int from public.stock_movement where ref_type = 'batch'), 0, 'no batch consumption row exists after the faults');
select is((select count(*)::int from public.alert where kind = 'negative_stock'), 0,
  'and no negative_stock alert, although the inputs had a shortfall');
select is(pg_temp.buckets() ~ 'Manzo muscolo a \(demo\)/L-D2=3 Manzo muscolo a \(demo\)/L-D5=3', true, 'the beef lots are still 3 kg and 3 kg');

-- A mid-way engine error: the beef (first by id) is consumed, then the onion's override lot is empty.
create function pg_temp.midway() returns text language plpgsql as $$
declare
  v_before text := pg_temp.balances();
  v_err text;
begin
  v_err := pg_temp.err($q$ select pg_temp.prod('m', 'r_stew_a', 6.2, jsonb_build_array(
    jsonb_build_object('ingredientId', pg_temp.id('beef_a'), 'qty', 5.3, 'unit', 'kg'),
    jsonb_build_object('ingredientId', pg_temp.id('onion_a'), 'qty', 0.31, 'unit', 'kg', 'lotId', pg_temp.id('empty_a')),
    jsonb_build_object('ingredientId', pg_temp.id('carrot_a'), 'qty', 0.2067, 'unit', 'kg'))) $q$);
  return v_err || ' | ' || case when v_before = pg_temp.balances() then 'unchanged' else 'CHANGED' end;
end
$$;
select is(pg_temp.midway(), 'P0001 lot_empty / [{"ingredientId": "' || pg_temp.id('onion_a') || '"}] | unchanged',
  'AT3: lot_empty on the second ingredient names it and leaves no beef row');
select ok(pg_temp.id('beef_a') < pg_temp.id('onion_a') and pg_temp.id('onion_a') < pg_temp.id('carrot_a'),
  'the fixture ids put the beef first, the onion second (consumption is in ingredient-id order)');

-- Control: without a trigger the same shortfall production succeeds, so the faults above were the cause.
select pg_temp.prod('ok', 'r_stew_a', 6.2, pg_temp.inp('a', 7, 0.31, 0.2067));
select is((select count(*)::int from public.batch), 1, 'control: the same production without a fault commits one batch');
select is((select count(*)::int from public.alert where kind = 'negative_stock'), 1, 'control: and raises its one negative_stock alert');
select is(pg_temp.err($$ select pg_temp.prod('dup', 'r_stew_a', 6.2, pg_temp.inp('a', 0.1, 0.1, 0.1), p_portions => 0) $$), 'P0001 portions_invalid',
  'control: a validation error still raises its own code');
select is((select count(*)::int from public.batch_movement where type = 'produce'), 1, 'control: one produce movement');

select * from finish();
rollback;
