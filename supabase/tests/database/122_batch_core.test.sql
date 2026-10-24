-- M14 step 3: app.produce_batch_core, the production core (M14 plan §3.1, §3.2; AT1, AT2, AT4, AT6; ADR-013).
-- Called as the migration owner with an explicit tenant, user and instant, as 093 calls the engine. Each case uses
-- its own "world" (ingredients, lots, prices and recipes suffixed with a letter) so that balances and lot
-- sequences never leak between cases. Fake data only (tenants "Osteria Demo A/B", ingredients and recipes
-- suffixed "(demo)", invented lots and prices). Default instant 2026-10-23T10:00Z = 12:00 in Rome.
begin;
create extension if not exists pgtap with schema extensions;
select plan(77);

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

-- AT1: the stew, 6,2 kg, with the confirmed inputs (not the proposal) -------------------------------------------------
select pg_temp.world('a');
select pg_temp.prod('at1', 'r_stew_a', 6.2, pg_temp.inp('a', 5.3, 0.31, 0.2067));
select is(pg_temp.rows_of('at1', 'beef_a'), 'L-D2 -3, L-D5 -2.3',
  'AT1: the beef rows are L-D2 -3 and L-D5 -2.3 (5,3 kg confirmed, not the proposed 5,1667)');
select is(pg_temp.rows_of('at1', 'onion_a') || ' | ' || pg_temp.rows_of('at1', 'carrot_a'), 'L-CIP -0.31 | L-CAR -0.2067',
  'AT1: one onion row and one carrot row, FEFO lots');
select is((select count(*)::int from public.stock_movement where ref_type = 'batch' and ref_id = pg_temp.bid('at1')), 4,
  'AT1: four consumption rows, all with ref_type batch and the batch id as ref_id');
select is((select b.portions_computed || '/' || b.portions_initial || '/' || b.state || '/' || b.recipe_version
             from public.batch b where b.id = pg_temp.bid('at1')), '31/31/fresh/1',
  'AT1: one batch: 31 portions computed and confirmed, fresh, recipe version 1');
select is((select b.recipe_id from public.batch b where b.id = pg_temp.bid('at1')), pg_temp.id('r_stew_a'),
  'AT1: the batch pins the recipe version row');
select is((select string_agg(i.name || ':' || x.n, ', ' order by i.name collate "C")
             from (select bi.ingredient_id, count(*) n from public.batch_input bi where bi.batch_id = pg_temp.bid('at1')
                    group by bi.ingredient_id) x join public.ingredient i on i.id = x.ingredient_id),
  'Carota a (demo):1, Cipolla a (demo):1, Manzo muscolo a (demo):2',
  'AT1: one batch_input per movement (beef 2, onion 1, carrot 1)');
select is((select count(*)::int from public.batch_input bi join public.stock_movement m on m.id = bi.stock_movement_id
            where bi.batch_id = pg_temp.bid('at1') and bi.qty = -m.qty and bi.raw_lot_id is not distinct from m.raw_lot_id
              and bi.location_id = m.location_id and bi.ingredient_id = m.ingredient_id), 4,
  'AT1: each batch_input mirrors its movement''s lot, location and quantity');
select is((select portions_remaining from public.v_batch_portions where batch_id = pg_temp.bid('at1')), 31::numeric,
  'AT1: v_batch_portions = 31');
select is((select m.type::text || ' ' || m.portions || ' ' || m.effective_on || ' ' || m.ref_type
             from public.batch_movement m where m.batch_id = pg_temp.bid('at1')),
  'produce 31.0000 2026-10-23 batch', 'AT1: one produce movement of +31 on the Rome date of the instant');
select is((select (r -> 'recipe' ->> 'name') || ' ' || (r ->> 'lotCode') || ' ' || (r ->> 'portions') || ' ' || (r ->> 'portionsComputed')
             || ' ' || (r ->> 'shelfLifeHours') || ' ' || (r ->> 'outputQty') from res where k = 'at1'),
  'Spezzatino a (demo) 261023-SPEZZA-1 31 31 72 6.2', 'AT1: the answer carries the recipe, lot code, portions and shelf life');
select is((select array_agg(k.key order by k.key collate "C") from res, jsonb_object_keys(r) k (key) where res.k = 'at1'),
  array['batchId', 'inputs', 'locationId', 'lotCode', 'negatives', 'outputQty', 'outputUnit', 'portions', 'portionsComputed',
        'producedAt', 'recipe', 'shelfLifeHours', 'useBy'], 'the answer has exactly the planned keys');
select is_empty($$ select x from res, unnest(pg_temp.all_keys(r)) x where res.k = 'at1' and x ~* '(eur|cost|price|value|amount)' $$,
  'and no key at any depth names a cost');
select is((select r -> 'negatives' from res where k = 'at1'), '[]'::jsonb, 'AT1: nothing is negative');
select is((select count(*)::int from jsonb_array_elements((select r -> 'inputs' from res where k = 'at1')) i
            where jsonb_array_length(i -> 'movements') >= 1), 3, 'the answer lists the three inputs with their movements');
select is((select count(*)::int from public.alert), 0, 'no alert was raised');

-- Override lot: start from L-D5, then FEFO ------------------------------------------------------------------------------
select pg_temp.world('c');
select pg_temp.prod('ovr', 'r_stew_c', 6.2, pg_temp.inp('c', 5.3, 0.31, 0.2067, 'd5_c'));
select is(pg_temp.rows_of('ovr', 'beef_c'), 'L-D2 -2.3, L-D5 -3', 'override: L-D5 first (3 kg), then L-D2 (2,3 kg)');

-- A quantity of 0 means "not used": no movement, no input, no lock ---------------------------------------------------
select pg_temp.world('d');
select pg_temp.prod('zero', 'r_stew_d', 6.2, pg_temp.inp('d', 5.3, 0.31, 0));
select is(pg_temp.rows_of('zero', 'carrot_d'), '-', 'qty 0: no carrot movement');
select is((select count(*)::int from public.batch_input where batch_id = pg_temp.bid('zero')), 3, 'qty 0: no carrot batch_input (beef 2 + onion 1)');
select is((select count(*)::int from pg_locks l where l.locktype = 'advisory' and l.pid = pg_backend_pid()
             and l.classid::int = hashtext('ingredient_stock')
             and l.objid::int = hashtext('11111111-1111-4111-8111-111111111111' || pg_temp.id('carrot_d')::text)), 0,
  'qty 0: the carrot''s stock lock was not taken');
select is((select count(*)::int from pg_locks l where l.locktype = 'advisory' and l.pid = pg_backend_pid()
             and l.classid::int = hashtext('ingredient_stock')
             and l.objid::int in (hashtext('11111111-1111-4111-8111-111111111111' || pg_temp.id('beef_d')::text),
                                  hashtext('11111111-1111-4111-8111-111111111111' || pg_temp.id('onion_d')::text))), 2,
  'qty 0: the beef and onion stock locks were taken');

-- Validation: nothing is written -------------------------------------------------------------------------------------
select pg_temp.world('e');
select pg_temp.mk_rec('inact_e', 'Spezzatino inattivo e (demo)', 'batch', 6, 'kg', 30, 72);
select pg_temp.ln('inact_e', 1, 'beef_e', 5);
update public.recipe_key set is_active = false where id = pg_temp.id('k_inact_e');
create temporary table before_counts as select pg_temp.counts() c;
select is(pg_temp.err($$ select pg_temp.prod('x', 'r_stew_e', 6.2, jsonb_build_array(
    jsonb_build_object('ingredientId', pg_temp.id('beef_e'), 'qty', 5, 'unit', 'kg'),
    jsonb_build_object('ingredientId', pg_temp.id('onion_e'), 'qty', 1, 'unit', 'kg'))) $$),
  'P0001 input_missing / [{"ingredientId": "' || pg_temp.id('carrot_e') || '"}]',
  'input_missing: the carrot is absent (named in the detail)');
select is(pg_temp.err($$ select pg_temp.prod('x', 'r_stew_e', 6.2, pg_temp.inp('e', 5, 1, 1) || pg_temp.inp('e', 1, 1, 1)) $$) ~ '^P0001 input_duplicate / \[\{"ingredientId": "', true,
  'input_duplicate: an ingredient twice, named in the detail');
select is(pg_temp.err($$ select pg_temp.prod('x', 'r_stew_e', 6.2, pg_temp.inp('e', 5, 1, 1) ||
    jsonb_build_array(jsonb_build_object('ingredientId', pg_temp.id('salt_e'), 'qty', 1, 'unit', 'kg'))) $$),
  'P0001 input_not_in_recipe / [{"ingredientId": "' || pg_temp.id('salt_e') || '"}]',
  'input_not_in_recipe: salt is not in the stew');
select is(pg_temp.err($$ select pg_temp.prod('x', 'r_stew_e', 6.2, pg_temp.inp('e', 0, 0, 0)) $$), 'P0001 inputs_empty',
  'inputs_empty: every quantity is 0');
select is(pg_temp.err($$ select pg_temp.prod('x', 'r_stew_e', 6.2, pg_temp.inp('e', 5, 1, 1) ||
    jsonb_build_array(jsonb_build_object('ingredientId', pg_temp.id('water_e'), 'qty', 1, 'unit', 'l'))) $$),
  'P0001 ingredient_not_stock / [{"ingredientId": "' || pg_temp.id('water_e') || '"}]',
  'water (not stock) as an input: ingredient_not_stock');
select is(pg_temp.err($$ select pg_temp.prod('x', 'r_stew_e', 6.2, jsonb_build_array(
    jsonb_build_object('ingredientId', pg_temp.id('beef_e'), 'qty', 5, 'unit', 'ml'),
    jsonb_build_object('ingredientId', pg_temp.id('onion_e'), 'qty', 1, 'unit', 'kg'),
    jsonb_build_object('ingredientId', pg_temp.id('carrot_e'), 'qty', 1, 'unit', 'kg'))) $$),
  'P0001 unit_mismatch / [{"ingredientId": "' || pg_temp.id('beef_e') || '"}]', 'ml on beef: unit_mismatch');
select is(pg_temp.err($$ select pg_temp.prod('x', 'r_stew_e', 6.2, pg_temp.inp('e', -1, 1, 1)) $$) ~ '^P0001 qty_invalid / ', true,
  'a negative quantity: qty_invalid');
select is(pg_temp.err($$ select pg_temp.prod('x', 'r_sof_e', 6.2, pg_temp.inp('e', 5, 1, 1)) $$), 'P0001 recipe_not_batch',
  'a sub recipe id: recipe_not_batch');
select is(pg_temp.err($$ select pg_temp.prod('x', 'r_inact_e', 6.2, pg_temp.inp('e', 5, 1, 1)) $$), 'P0001 recipe_inactive',
  'an inactive recipe: recipe_inactive');
select is(pg_temp.err($$ select pg_temp.prod('x', 'r_stew_e', 0, pg_temp.inp('e', 5, 1, 1)) $$), 'P0001 output_invalid', 'output 0: output_invalid');
select is(pg_temp.err($$ select pg_temp.prod('x', 'r_stew_e', 100001, pg_temp.inp('e', 5, 1, 1)) $$), 'P0001 output_invalid', 'output 100001: output_invalid');
select is(pg_temp.err($$ select pg_temp.prod('x', 'r_stew_e', 1.23456, pg_temp.inp('e', 5, 1, 1)) $$), 'P0001 output_invalid', 'output 1.23456: output_invalid');
select is(pg_temp.err($$ select pg_temp.prod('x', 'r_stew_e', 6.2, pg_temp.inp('e', 5, 1, 1), p_portions => 0) $$), 'P0001 portions_invalid', 'portions 0: portions_invalid');
select is(pg_temp.err($$ select pg_temp.prod('x', 'r_stew_e', 6.2, pg_temp.inp('e', 5, 1, 1), p_portions => 10001) $$), 'P0001 portions_invalid', 'portions 10001: portions_invalid');
select is(pg_temp.err($$ select pg_temp.prod('x', 'r_stew_e', 6.2, pg_temp.inp('e', 5, 1, 1), p_shelf => 0) $$), 'P0001 shelf_life_invalid', 'shelf life 0: shelf_life_invalid');
select is(pg_temp.err($$ select pg_temp.prod('x', 'r_stew_e', 6.2, pg_temp.inp('e', 5, 1, 1), p_shelf => 8761) $$), 'P0001 shelf_life_invalid', 'shelf life 8761: shelf_life_invalid');
select is(pg_temp.err($$ select pg_temp.prod('x', 'r_stew_e', 6.2, (select jsonb_agg(jsonb_build_object('ingredientId', gen_random_uuid(), 'qty', 1, 'unit', 'kg'))
    from generate_series(1, 101))) $$), 'P0001 inputs_invalid', '101 inputs: inputs_invalid');
select is(pg_temp.err($$ select pg_temp.prod('x', 'r_stew_e', 6.2, '["beef"]'::jsonb) $$), 'P0001 inputs_invalid', 'a non-object element: inputs_invalid');
select is(pg_temp.err($$ select pg_temp.prod('x', 'r_stew_e', 6.2, '{"a": 1}'::jsonb) $$), 'P0001 inputs_invalid', 'a non-array: inputs_invalid');
select is(pg_temp.err($$ select pg_temp.prod('x', 'r_stew_e', 6.2, '[]'::jsonb) $$), 'P0001 inputs_invalid', 'an empty array: inputs_invalid');
select is(pg_temp.err($$ select pg_temp.prod('x', 'r_stew_e', 6.2, jsonb_build_array(jsonb_build_object('ingredientId', pg_temp.id('beef_e'),
    'qty', 5, 'unit', 'kg', 'colour', 'red'))) $$), 'P0001 inputs_invalid', 'an unknown key in an input: inputs_invalid');
select is(pg_temp.err($$ select pg_temp.prod('x', 'r_stew_e', 6.2, jsonb_build_array(jsonb_build_object('ingredientId', 'nope',
    'qty', 5, 'unit', 'kg'))) $$), 'P0001 inputs_invalid', 'a malformed ingredient id: inputs_invalid');
select is(pg_temp.err($$ select pg_temp.prod('x', 'r_stew_e', 6.2, jsonb_build_array(jsonb_build_object('ingredientId', pg_temp.id('beef_e'),
    'qty', '5', 'unit', 'kg'))) $$), 'P0001 inputs_invalid', 'a quantity that is a string: inputs_invalid');
select is(pg_temp.err($$ select pg_temp.prod('x', 'r_stew_e', 6.2, pg_temp.inp('e', 5, 1, 1), p_loc => gen_random_uuid()) $$),
  'P0001 location_not_found', 'an unknown batch location: location_not_found');
select is(pg_temp.err($$ select app.produce_batch_core('22222222-2222-4222-8222-222222222222', 'b1000000-0000-4000-8000-00000000000b',
    pg_temp.id('r_stew_e'), 6.2, pg_temp.inp('e', 5, 1, 1), null, null, null, now()) $$), 'P0002 recipe_not_found',
  'tenant B with tenant A''s recipe: recipe_not_found');
select is(pg_temp.counts(), (select c from before_counts), 'none of the refused calls wrote a row or an alert');
-- A newer version of the stew makes version 1 stale.
insert into reg values ('r_stew_e2', gen_random_uuid());
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch,
    shelf_life_hours, created_by)
  values (pg_temp.id('r_stew_e2'), '11111111-1111-4111-8111-111111111111', pg_temp.id('k_stew_e'), 2, '2026-10-22T00:00Z',
    'Spezzatino e (demo)', 6, 'kg', 30, 72, 'a1000000-0000-4000-8000-00000000000a');
update public.recipe_key set current_version = 2 where id = pg_temp.id('k_stew_e');
select is(pg_temp.err($$ select pg_temp.prod('x', 'r_stew_e', 6.2, pg_temp.inp('e', 5, 1, 1)) $$), 'P0001 recipe_version_stale',
  'version 1 after version 2 exists: recipe_version_stale');

-- Portions: the chef may change them; an output too small for a whole portion needs a number -----------------------------
select pg_temp.world('f');
select pg_temp.prod('p30', 'r_stew_f', 6.2, pg_temp.inp('f', 5.3, 0.31, 0.2067), p_portions => 30);
select is((select b.portions_computed || '/' || b.portions_initial from public.batch b where b.id = pg_temp.bid('p30')), '31/30',
  'portions 30 are kept beside the computed 31');
select is((select portions_remaining from public.v_batch_portions where batch_id = pg_temp.bid('p30')), 30::numeric,
  'and the produce movement is +30');
select is(pg_temp.err($$ select pg_temp.prod('x', 'r_stew_f', 0.1, pg_temp.inp('f', 0.1, 0.01, 0.01)) $$), 'P0001 portions_invalid',
  'output 0,1 without portions: 0 computed, portions_invalid');
select pg_temp.prod('p1', 'r_stew_f', 0.1, pg_temp.inp('f', 0.1, 0.01, 0.01), p_portions => 1);
select is((select b.portions_computed || '/' || b.portions_initial from public.batch b where b.id = pg_temp.bid('p1')), '0/1',
  'output 0,1 with portions 1: computed 0, confirmed 1');
select is(pg_temp.err($$ select pg_temp.prod('x', 'r_stew_f', 100000, pg_temp.inp('f', 1, 1, 1)) $$), 'P0001 output_invalid',
  'an output far beyond the recipe''s portions (over 10 000 computed): output_invalid');

-- Shelf life ---------------------------------------------------------------------------------------------------------
select pg_temp.world('s');
select pg_temp.prod('sl', 'r_stew_s', 0.6, pg_temp.inp('s', 0.5, 0.03, 0.02), p_shelf => 48);
select is((select b.shelf_life_hours || ' ' || (b.use_by - b.produced_at) from public.batch b where b.id = pg_temp.bid('sl')),
  '48 2 days', 'shelf life 48 overrides the recipe''s 72: use_by = produced_at + 48 h');
select pg_temp.prod('sl0', 'r_stew_s', 0.6, pg_temp.inp('s', 0.5, 0.03, 0.02), p_at => '2026-10-24T10:00Z');
select is((select b.shelf_life_hours || ' ' || (b.use_by - b.produced_at) from public.batch b where b.id = pg_temp.bid('sl0')),
  '72 3 days', 'no override: the recipe''s 72 hours');

-- AT4: lot codes ----------------------------------------------------------------------------------------------------
select pg_temp.world('b');
select pg_temp.prod('l1', 'r_stew_b', 0.6, pg_temp.inp('b', 0.5, 0.03, 0.02), p_at => '2026-11-02T10:00Z');
select pg_temp.prod('l2', 'r_stew_b', 0.6, pg_temp.inp('b', 0.5, 0.03, 0.02), p_at => '2026-11-02T11:00Z');
select pg_temp.prod('l3', 'r_manzo_b', 0.3, jsonb_build_array(jsonb_build_object('ingredientId', pg_temp.id('beef_b'), 'qty', 0.25, 'unit', 'kg')),
  p_at => '2026-11-02T12:00Z');
select pg_temp.prod('l4', 'r_stew_b', 0.6, pg_temp.inp('b', 0.5, 0.03, 0.02), p_at => '2026-11-03T10:00Z');
select is((select string_agg(r ->> 'lotCode', ' ' order by k) from res where k in ('l1', 'l2', 'l3', 'l4')),
  '261102-SPEZZA-1 261102-SPEZZA-2 261102-SPEZZA-3 261103-SPEZZA-1',
  'AT4: the same recipe twice on one day gets -1 and -2; a recipe sharing the printed code gets -3; the next day restarts');
select is((select b.lot_date || ' ' || b.lot_recipe_code || ' ' || b.lot_seq from public.batch b where b.id = pg_temp.bid('l3')),
  '2026-11-02 SPEZZA 3', 'and the parts are stored on the batch');

-- AT6: Rome calendar day and elapsed hours across the clock changes --------------------------------------------------------
select pg_temp.world('g');
select pg_temp.prod('dst1', 'r_stew_g', 0.6, pg_temp.inp('g', 0.5, 0.03, 0.02), p_at => '2027-03-27T23:30Z');
select is((select b.lot_code || ' ' || b.lot_date || ' ' || to_char(b.use_by at time zone 'UTC', 'YYYY-MM-DD HH24:MI')
                  || ' ' || to_char(b.use_by at time zone 'Europe/Rome', 'DD/MM/YYYY HH24:MI')
             from public.batch b where b.id = pg_temp.bid('dst1')),
  '270328-SPEZZA-1 2027-03-28 2027-03-30 23:30 31/03/2027 01:30',
  'AT6: 00:30 on 28 March in Rome is lot day 28; 72 elapsed hours later is 01:30 on 31 March');
select pg_temp.prod('dst2', 'r_stew_g', 0.6, pg_temp.inp('g', 0.5, 0.03, 0.02), p_at => '2027-03-26T19:00Z');
select is((select to_char(b.use_by at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' ' || to_char(b.use_by at time zone 'Europe/Rome', 'DD/MM/YYYY HH24:MI')
             from public.batch b where b.id = pg_temp.bid('dst2')),
  '2027-03-29 19:00 29/03/2027 21:00', 'AT6: Friday 20:00 plus 72 h is Monday 21:00 after the clocks go forward');
select pg_temp.prod('dst3', 'r_stew_g', 0.6, pg_temp.inp('g', 0.5, 0.03, 0.02), p_at => '2026-10-24T22:30Z');
select is((select b.lot_code from public.batch b where b.id = pg_temp.bid('dst3')), '261025-SPEZZA-1',
  'AT6: 00:30 on 25 October in Rome is lot day 25');
set local timezone = 'America/New_York';
select pg_temp.prod('dst4', 'r_stew_g', 0.6, pg_temp.inp('g', 0.5, 0.03, 0.02), p_at => '2027-03-26T19:00Z');
select is((select b.use_by from public.batch b where b.id = pg_temp.bid('dst4')), '2027-03-29T19:00Z'::timestamptz,
  'T1: the use_by is the same instant under another session time zone');
select is((select b.lot_code from public.batch b where b.id = pg_temp.bid('dst4')), '270326-SPEZZA-2',
  'and the lot day is still the tenant''s (Rome) day, here the second batch of 26 March');
reset timezone;

-- Shortfall: recorded, not refused ------------------------------------------------------------------------------------
select pg_temp.world('h');
select pg_temp.prod('short', 'r_stew_h', 6.2, pg_temp.inp('h', 7, 0.31, 0.2067));
select is(pg_temp.rows_of('short', 'beef_h'), 'L-D2 -3, L-D5 -3, null -1', 'shortfall: beef 7 with 6 on hand takes both lots, then one unlotted row');
select is((select count(*)::int from public.batch_input where batch_id = pg_temp.bid('short') and raw_lot_id is null
             and qty = 1), 1, 'its batch_input row has no lot');
select is((select count(*)::int || ' ' || min(a.audience_roles::text) from public.alert a
            where a.kind = 'negative_stock' and a.entity_id = pg_temp.id('beef_h')), '1 {owner,chef}',
  'one negative_stock alert for the beef, to owner and chef');
select is((select r -> 'negatives' from res where k = 'short'),
  jsonb_build_array(jsonb_build_object('ingredientId', pg_temp.id('beef_h'), 'locationId', pg_temp.id('cella'), 'onHandQty', -1)),
  'the answer lists the negative location');

-- Structure ----------------------------------------------------------------------------------------------------------
select ok(position('app.lock_ingredient_stock(' in p.prosrc) > 0
    and position('app.lock_ingredient_stock(' in p.prosrc) < position('app.post_stock_outflow(' in p.prosrc)
    and length(p.prosrc) - length(replace(p.prosrc, 'app.lock_ingredient_stock(', '')) = length('app.lock_ingredient_stock('),
  'produce_batch_core takes the stock locks once, before the first outflow')
  from pg_proc p where p.proname = 'produce_batch_core' and p.pronamespace = 'app'::regnamespace;
select ok(position('app.lock_batch_lot(' in p.prosrc) > 0
    and position('app.post_stock_outflow(' in substr(p.prosrc, position('app.lock_batch_lot(' in p.prosrc))) = 0,
  'and the lot lock after the last outflow')
  from pg_proc p where p.proname = 'produce_batch_core' and p.pronamespace = 'app'::regnamespace;
select is_empty($$ select f.proname, r.rolname
    from pg_proc f cross join (values ('anon'), ('authenticated'), ('service_role')) r (rolname)
   where f.pronamespace = 'app'::regnamespace
     and f.proname in ('require_batch_writer', 'require_batch_reader', 'lock_batch_lot', 'next_lot_seq', 'produce_batch_core')
     and has_function_privilege(r.rolname, f.oid, 'execute') $$, 'no API role can execute the core or its helpers');
select is((select count(*)::int from pg_proc where pronamespace = 'app'::regnamespace
            and proname in ('require_batch_writer', 'require_batch_reader', 'lock_batch_lot', 'next_lot_seq', 'produce_batch_core')), 5,
  'the five functions exist, once each');
select is((select p.provolatile::text from pg_proc p where p.proname = 'next_lot_seq' and p.pronamespace = 'app'::regnamespace), 'v',
  'next_lot_seq is volatile (a stable function would read the caller''s snapshot, not the previous holder''s commit)');

-- Containment: with the alert kind missing the batch still commits -----------------------------------------------------------
select pg_temp.world('k');
alter table public.alert drop constraint alert_kind_fkey;
delete from app.alert_kind where kind = 'negative_stock';
select pg_temp.prod('kind', 'r_stew_k', 6.2, pg_temp.inp('k', 7, 0.31, 0.2067));
select is(pg_temp.rows_of('kind', 'beef_k'), 'L-D2 -3, L-D5 -3, null -1', 'containment: the batch commits with its shortfall row');
select is((select count(*)::int from public.alert where kind = 'negative_stock' and entity_id = pg_temp.id('beef_k')), 0, 'no alert exists');
select is((select r.code || ' ' || r.caller from app.alert_refusal r where r.kind = 'negative_stock' and r.entity_id = pg_temp.id('beef_k')
             order by r.id desc limit 1), 'unknown_alert_kind produce_batch', 'one refusal names the caller produce_batch');

-- Locations ----------------------------------------------------------------------------------------------------------
select pg_temp.world('m');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'Dispensa (demo)');
select is(pg_temp.err($$ select pg_temp.prod('x', 'r_stew_m', 0.6, pg_temp.inp('m', 0.5, 0.03, 0.02)) $$), 'P0001 location_required',
  'two active locations and none given: location_required');
select pg_temp.prod('loc', 'r_stew_m', 0.6, pg_temp.inp('m', 0.5, 0.03, 0.02, loc => pg_temp.id('cella')), p_loc => pg_temp.id('cella'));
select is((select r ->> 'locationId' from res where k = 'loc'), pg_temp.id('cella')::text, 'a batch location can be given');
select is((select count(*)::int from public.batch_input bi where bi.batch_id = pg_temp.bid('loc') and bi.location_id = pg_temp.id('cella')), 3,
  'and the inputs take the location they name');
select is(pg_temp.err($$ select pg_temp.prod('x', 'r_stew_m', 0.6, pg_temp.inp('m', 0.5, 0.03, 0.02), p_loc => pg_temp.id('cella')) $$),
  'P0001 location_required / [{"ingredientId": "' || (select min(i.id::text) from public.ingredient i
     where i.id in (pg_temp.id('beef_m'), pg_temp.id('onion_m'), pg_temp.id('carrot_m'))) || '"}]',
  'two active locations and an input without one: location_required, naming the first such input');

select * from finish();
rollback;
