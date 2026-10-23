-- M14 step 3 (AT5): the frozen batch cost (M14 plan §3.1.9; M8 plan §3.8; ADR-008). The cost of the actual inputs
-- is copied into batch_cost at production with the basis in force at produced_at; a later price change never
-- moves it; an unpriced input makes it incomplete (null, never 0). Same worlds as 122. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

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

-- AT5: the AT1 batch freezes 53,5167 -----------------------------------------------------------------------------------
select pg_temp.world('a');
select pg_temp.prod('at1', 'r_stew_a', 6.2, pg_temp.inp('a', 5.3, 0.31, 0.2067));
select is((select c.total_cost || ' ' || c.unit_cost_frozen || ' ' || c.incomplete || ' ' || c.missing_ingredient_ids::text
             from public.batch_cost c where c.batch_id = pg_temp.bid('at1')), '53.5167 1.7263 false {}',
  'AT5: total 5,3 x 10 + 0,31 x 1 + 0,2067 x 1 = 53,5167; per portion 53,5167 / 31 = 1,7263');
select is((select c.cost_at from public.batch_cost c where c.batch_id = pg_temp.bid('at1')), '2026-10-23T10:00Z'::timestamptz,
  'cost_at is the instant of production');
select is((select count(*)::int from public.stock_movement m where m.ref_id = pg_temp.bid('at1') and m.unit_cost is not null), 4,
  'every consumption row carries its unit cost (read once per ingredient at the production instant)');

-- A later price change does not move the frozen row; a new batch freezes the new basis ------------------------------------
create temporary table frozen as select to_jsonb(c) j from public.batch_cost c where c.batch_id = pg_temp.bid('at1');
select pg_temp.buy('beef_a', 20, '2026-10-24');
insert into public.ingredient_cost_basis (tenant_id, ingredient_id, basis, valid_from, created_by)
  values ('11111111-1111-4111-8111-111111111111', pg_temp.id('beef_a'), 'last_price', '2026-10-24T00:00Z',
          'a1000000-0000-4000-8000-00000000000a');
select is((select to_jsonb(c) from public.batch_cost c where c.batch_id = pg_temp.bid('at1')), (select j from frozen),
  'AT5: after a purchase at 20,00 and a last-price basis the frozen row is identical');
select pg_temp.prod('new', 'r_stew_a', 6.2, pg_temp.inp('a', 5.3, 0.31, 0.2067), p_at => '2026-10-25T10:00Z');
select is((select c.total_cost || ' ' || c.unit_cost_frozen from public.batch_cost c where c.batch_id = pg_temp.bid('new')),
  '106.5167 3.4360', 'AT5: a new batch freezes the new basis: 5,3 x 20 + 0,31 + 0,2067 = 106,5167');
select is(pg_temp.rows_of('new', 'beef_a'), 'L-D5 -0.7, null -4.6', 'the new batch took the last 0,7 kg of L-D5 and a 4,6 kg shortfall');
select is((select string_agg(distinct m.unit_cost::text, ',') from public.stock_movement m
            where m.ref_id = pg_temp.bid('new') and m.ingredient_id = pg_temp.id('beef_a')), '20.0000',
  'and the shortfall row is costed at the same basis as the lot row');
select is((select to_jsonb(c) from public.batch_cost c where c.batch_id = pg_temp.bid('at1')), (select j from frozen),
  'the first batch is still unchanged after the second');

-- An unpriced input: incomplete, never 0 ------------------------------------------------------------------------------------
select pg_temp.prod('brodo', 'r_brodo_a', 5, jsonb_build_array(
  jsonb_build_object('ingredientId', pg_temp.id('onion_a'), 'qty', 0.2, 'unit', 'kg'),
  jsonb_build_object('ingredientId', pg_temp.id('salt_a'), 'qty', 30, 'unit', 'g')));
select is((select c.total_cost is null || ' ' || (c.unit_cost_frozen is null) || ' ' || c.incomplete || ' '
                  || (c.missing_ingredient_ids = array[pg_temp.id('salt_a')])
             from public.batch_cost c where c.batch_id = pg_temp.bid('brodo')), 'true true true true',
  'a salt that was never bought: total and per-portion cost null, incomplete, the salt listed');
select is((select b.lot_code || ' ' || b.portions_initial from public.batch b where b.id = pg_temp.bid('brodo')), '261023-BRODOA-1 20',
  'the Brodo batch is still produced, 20 portions');

-- The cost date is the production instant: a purchase effective the next day is not used --------------------------------------
select pg_temp.world('b');
select pg_temp.buy('beef_b', 12, '2026-10-24');
select pg_temp.prod('early', 'r_stew_b', 0.6, pg_temp.inp('b', 0.5, 0.03, 0.02));
select is((select c.total_cost from public.batch_cost c where c.batch_id = pg_temp.bid('early')), 5.05::numeric,
  'a purchase with effective_on D+1 is not used for a batch at D: 0,5 x 10 + 0,03 + 0,02 = 5,05');
select is((select c.cost_at from public.batch_cost c where c.batch_id = pg_temp.bid('early')), '2026-10-23T10:00Z'::timestamptz,
  'and cost_at records the instant');

-- Shape and rows ------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from public.batch_cost), 4, 'one batch_cost row per batch (four batches)');
select is((select count(*)::int from public.batch b where not exists (select 1 from public.batch_cost c where c.batch_id = b.id)), 0,
  'and no batch lacks one');
select is_empty($$ select x from res, unnest(pg_temp.all_keys(r)) x where x ~* '(eur|cost|price|value|amount)' $$,
  'no production answer carries a cost key');
select is((select count(*)::int from public.batch_cost where total_cost = 0 or unit_cost_frozen = 0), 0, 'no frozen cost is 0');

select * from finish();
rollback;
