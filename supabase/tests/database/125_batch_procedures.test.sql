-- M14 step 5: the public procedures batch_proposal and produce_batch (M14 plan §3.1.5, §3.1.10, §3.2; AT1, AT2,
-- AT7 grants; ADR-013). Called under claims, as the API does. Lot expiries are relative to today in Rome, so the
-- expiry states do not depend on the day the suite runs. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

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
create function pg_temp.try(p_k text, stmt text) returns void language sql as $$ insert into outs values (p_k, pg_temp.err(stmt)) $$;
grant all on reg, res, outs to authenticated, anon;
grant execute on function pg_temp.id(text), pg_temp.err(text), pg_temp.inp(text, numeric, numeric, numeric, text, uuid),
  pg_temp.prod(text, text, numeric, jsonb, int, int, uuid), pg_temp.prop(text, text, numeric, int), pg_temp.try(text, text),
  pg_temp.as_chef(), pg_temp.as_owner(), pg_temp.as_admin(), pg_temp.as_waiter(), pg_temp.as_ownerb(), pg_temp.as_none(),
  pg_temp.act_as(uuid, uuid, text) to authenticated, anon;

select pg_temp.world('a');
select pg_temp.world('b');
-- Tenant B: one batch recipe (isolation).
insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('1b000000-0000-4000-8000-00000000001b', '22222222-2222-4222-8222-222222222222', 'Burro B (demo)', 'kg');
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'batch', 1, 'fondo b (demo)',
   'b1000000-0000-4000-8000-00000000000b');

-- AT2: the proposal --------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_chef();
select pg_temp.prop('p62', 'k_stew_a', 6.2);
select pg_temp.prop('pdef', 'k_stew_a');
select pg_temp.prop('p48', 'k_stew_a', 6.2, 48);
reset role;
select is((select string_agg(i ->> 'name' || '=' || trim_scale((i ->> 'proposedQty')::numeric) || '/' || (i ->> 'isStock'), '; ' order by n)
             from res, jsonb_array_elements(r -> 'inputs') with ordinality x (i, n) where res.k = 'p62'),
  'Acqua a (demo)=1.0333/false; Carota a (demo)=0.2067/true; Cipolla a (demo)=0.31/true; Manzo muscolo a (demo)=5.1667/true',
  'AT2: the proposal for 6,2 kg is beef 5,1667, onion 0,31, carrot 0,2067 and water 1,0333 (not in stock), sorted by name');
select is((select (r ->> 'portionsComputed') || ' ' || trim_scale((r -> 'recipe' ->> 'portionSize')::numeric) || ' ' || (r ->> 'outputQty')
             from res where k = 'p62'), '31 0.2 6.2', 'AT2: 31 portions of 0,2 kg');
select is((select trim_scale((r ->> 'outputQty')::numeric) || ' ' || (r ->> 'portionsComputed') || ' ' || (r ->> 'shelfLifeHours') from res where k = 'pdef'),
  '6 30 72', 'a missing output defaults to the recipe''s: 6 kg, 30 portions, 72 h');
select is((select r -> 'recipe' ->> 'name' || ' v' || (r -> 'recipe' ->> 'version') || ' ' || (r -> 'recipe' ->> 'outputUnit')
                  || ' ' || (r -> 'recipe' ->> 'portionsPerBatch') from res where k = 'p62'),
  'Spezzatino a (demo) v1 kg 30', 'the recipe block names the version in force');
select is((select string_agg(l ->> 'lotCode' || ':' || (l ->> 'expiryState') || ':' || trim_scale((l ->> 'onHandQty')::numeric), '; ' order by n)
             from res, jsonb_array_elements((select e -> 'lots' from res, jsonb_array_elements(r -> 'inputs') e
                                              where res.k = 'p62' and e ->> 'name' like 'Manzo%')) with ordinality x (l, n)
            where res.k = 'p62'), 'L-D2:ok:3; L-D5:ok:3', 'the beef lots are in FEFO order with their expiry state');
select is((select string_agg(l ->> 'lotCode' || ':' || (l ->> 'expiryState') || ':' || (l ->> 'fefoRank'), '; ' order by n)
             from res, jsonb_array_elements((select e -> 'lots' from res, jsonb_array_elements(r -> 'inputs') e
                                              where res.k = 'p62' and e ->> 'name' like 'Carota%')) with ordinality x (l, n)
            where res.k = 'p62'), 'L-OLD:expired:1; L-CAR:ok:2', 'an expired lot is listed first (pure FEFO) and marked expired');
select is((select e -> 'onHand' from res, jsonb_array_elements(r -> 'inputs') e where res.k = 'p62' and e ->> 'name' like 'Manzo%'),
  jsonb_build_array(jsonb_build_object('locationId', pg_temp.id('cella'), 'onHandQty', 6)), 'and the on-hand per location is 6 kg at Cella');
select is((select e -> 'units' from res, jsonb_array_elements(r -> 'inputs') e where res.k = 'p62' and e ->> 'name' like 'Manzo%'),
  '["kg", "g"]'::jsonb, 'the units for a kg ingredient are kg and g');
select is((select (r ->> 'suggestedLocationId') || ' ' || jsonb_array_length(r -> 'locations') from res where k = 'p62'),
  pg_temp.id('cella')::text || ' 1', 'with one active location it is suggested for the batch');
select is((select count(*)::int from res, jsonb_array_elements(r -> 'inputs') e
            where res.k = 'p62' and e ->> 'suggestedLocationId' = pg_temp.id('cella')::text), 3,
  'and for the three stock inputs');
select ok((select abs(extract(epoch from (r ->> 'useByPreview')::timestamptz - (now() + interval '72 hours'))) < 1 from res where k = 'p62'),
  'useByPreview is now plus 72 hours');
select ok((select abs(extract(epoch from (r ->> 'useByPreview')::timestamptz - (now() + interval '48 hours'))) < 1 from res where k = 'p48'),
  'and now plus 48 hours with a shelf life of 48');
select is((select r ->> 'today' from res where k = 'p62'), app.venue_date(now(), 'Europe/Rome')::text, 'today is the Rome date');
select is_empty($$ select x from res, unnest(pg_temp.all_keys(r)) x where res.k = 'p62' and x ~* '(eur|cost|price|value|amount)' $$,
  'no proposal key at any depth names a cost');

-- Errors of the proposal; tenancy; the waiter -------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_chef();
select pg_temp.try('sub', $$ select pg_temp.prop('x', 'k_sof_a') $$);
select pg_temp.try('out0', $$ select pg_temp.prop('x', 'k_stew_a', 0) $$);
select pg_temp.try('shelf0', $$ select pg_temp.prop('x', 'k_stew_a', 6, 0) $$);
select pg_temp.as_ownerb();
select pg_temp.try('tenant', $$ select public.batch_proposal(pg_temp.id('k_stew_a')) $$);
select pg_temp.as_waiter();
select pg_temp.try('waiter_prop', $$ select public.batch_proposal(pg_temp.id('k_stew_a')) $$);
select pg_temp.as_none();
select pg_temp.try('none_prop', $$ select public.batch_proposal(pg_temp.id('k_stew_a')) $$);
reset role;
select is((select v from outs where k = 'sub'), 'P0001 recipe_not_batch', 'a sub-recipe key: recipe_not_batch');
select is((select v from outs where k = 'out0'), 'P0001 output_invalid', 'output 0: output_invalid');
select is((select v from outs where k = 'shelf0'), 'P0001 shelf_life_invalid', 'shelf life 0: shelf_life_invalid');
select is((select v from outs where k = 'tenant'), 'P0002 recipe_not_found', 'tenant B asking for tenant A''s key: recipe_not_found');
select alike((select v from outs where k = 'waiter_prop'), '42501%', 'the waiter cannot call batch_proposal');
select alike((select v from outs where k = 'none_prop'), '42501%', 'nor can a caller without claims');

-- AT1 through the public procedure, as the chef ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_chef();
select pg_temp.prod('at1', 'r_stew_a', 6.2, pg_temp.inp('a', 5.3, 0.31, 0.2067));
reset role;
select is(pg_temp.rows_of('at1', 'beef_a'), 'L-D2 -3, L-D5 -2.3', 'AT1: the chef''s production consumes the confirmed 5,3 kg of beef');
select is(pg_temp.rows_of('at1', 'carrot_a'), 'L-OLD -0.2067', 'and FEFO takes the carrot from the expired lot first (pure FEFO)');
select is((select b.portions_initial || ' ' || b.state || ' ' || (b.produced_by = 'c1000000-0000-4000-8000-00000000000c')
                  || ' ' || (b.created_by = 'c1000000-0000-4000-8000-00000000000c') || ' ' || (b.produced_at = now())
             from public.batch b where b.id = pg_temp.bid('at1')), '31 fresh true true true',
  'AT1: produced_by and created_by are the chef; produced_at is the transaction time');
select is((select array_agg(k.key order by k.key collate "C") from res, jsonb_object_keys(r) k (key) where res.k = 'at1'),
  array['batchId', 'inputs', 'locationId', 'lotCode', 'negatives', 'outputQty', 'outputUnit', 'portions', 'portionsComputed',
        'producedAt', 'recipe', 'shelfLifeHours', 'useBy'], 'the answer has the planned keys');
select is_empty($$ select x from res, unnest(pg_temp.all_keys(r)) x where res.k = 'at1' and x ~* '(eur|cost|price|value|amount)' $$,
  'and no key names a cost');
select is((select count(*)::int from public.batch_cost where batch_id = pg_temp.bid('at1')), 1, 'the frozen cost row exists (the chef cannot read it)');

-- Admin and owner both produce ------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_admin();
select pg_temp.prod('admin', 'r_stew_b', 0.6, pg_temp.inp('b', 0.5, 0.03, 0.02));
select pg_temp.as_owner();
select pg_temp.prod('owner', 'r_stew_b', 0.6, pg_temp.inp('b', 0.5, 0.03, 0.02));
reset role;
select is((select string_agg((b.produced_by = 'f1000000-0000-4000-8000-00000000000f')::text || '/'
                    || (b.produced_by = 'a1000000-0000-4000-8000-00000000000a')::text, '; ' order by b.lot_seq)
             from public.batch b where b.id in (pg_temp.bid('admin'), pg_temp.bid('owner'))),
  'true/false; false/true', 'admin and owner can produce; each batch names its author');

-- The waiter and the unauthenticated: nothing happens ----------------------------------------------------------------------
create temporary table before_counts as select pg_temp.counts() c;
set local role authenticated;
select pg_temp.as_waiter();
select pg_temp.try('waiter_prod', $$ select pg_temp.prod('w', 'r_stew_b', 0.6, pg_temp.inp('b', 0.5, 0.03, 0.02)) $$);
select pg_temp.as_none();
select pg_temp.try('none_prod', $$ select pg_temp.prod('w', 'r_stew_b', 0.6, pg_temp.inp('b', 0.5, 0.03, 0.02)) $$);
select pg_temp.as_ownerb();
select pg_temp.try('tenant_prod', $$ select pg_temp.prod('w', 'r_stew_b', 0.6, pg_temp.inp('b', 0.5, 0.03, 0.02)) $$);
reset role;
select alike((select v from outs where k = 'waiter_prod'), '42501%', 'AT7: the waiter cannot execute produce_batch');
select alike((select v from outs where k = 'none_prod'), '42501%', 'nor can a caller without claims');
select is((select v from outs where k = 'tenant_prod'), 'P0002 recipe_not_found', 'tenant B with tenant A''s recipe id: recipe_not_found');
select is(pg_temp.counts(), (select c from before_counts), 'and none of the three refused calls wrote anything');

-- Grants -------------------------------------------------------------------------------------------------------------------
select ok(has_function_privilege('authenticated', 'public.batch_proposal(uuid, numeric, integer)', 'execute')
      and has_function_privilege('authenticated', 'public.produce_batch(uuid, numeric, jsonb, integer, integer, uuid)', 'execute'),
  'authenticated can execute both');
select is_empty($$ select f.proname, r.rolname
    from pg_proc f cross join (values ('anon'), ('service_role')) r (rolname)
   where f.pronamespace = 'public'::regnamespace and f.proname in ('batch_proposal', 'produce_batch')
     and has_function_privilege(r.rolname, f.oid, 'execute') $$, 'anon and service_role cannot execute either');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('batch_proposal', 'produce_batch')
            and p.prosecdef and p.proconfig = array['search_path=""']), 2, 'both are security definer with an empty search_path');

-- AT3 through the public procedure: a fault after the consumption movements, under the chef's claims --------------------------
create function public.fault_injected() returns trigger language plpgsql as $$
begin
  raise exception 'fault_injected' using errcode = 'P0001';
end
$$;
create trigger fault before insert on public.batch_cost for each row execute function public.fault_injected();
create temporary table before_counts2 as select pg_temp.counts() c;
set local role authenticated;
select pg_temp.as_chef();
select pg_temp.try('fault', $$ select pg_temp.prod('f', 'r_stew_b', 0.6, pg_temp.inp('b', 0.5, 0.03, 0.02)) $$);
reset role;
drop trigger fault on public.batch_cost;
select is((select v from outs where k = 'fault'), 'P0001 fault_injected', 'AT3: the chef''s production fails with the injected fault');
select is(pg_temp.counts(), (select c from before_counts2), 'and leaves no movement, batch, input, cost or alert');

-- Two active locations ------------------------------------------------------------------------------------------------------
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'Dispensa (demo)');
set local role authenticated;
select pg_temp.as_chef();
select pg_temp.prop('two', 'k_stew_a', 6.2);
reset role;
select is((select coalesce(r ->> 'suggestedLocationId', 'null') || ' ' || jsonb_array_length(r -> 'locations') from res where k = 'two'),
  'null 2', 'with Dispensa active the batch location is not suggested');
select is((select string_agg(e ->> 'name' || '>' || coalesce(e ->> 'suggestedLocationId', 'null'), '; ' order by n)
             from res, jsonb_array_elements(r -> 'inputs') with ordinality x (e, n) where res.k = 'two'),
  'Acqua a (demo)>null; Carota a (demo)>' || pg_temp.id('cella') || '; Cipolla a (demo)>' || pg_temp.id('cella')
    || '; Manzo muscolo a (demo)>' || pg_temp.id('cella'),
  'each stock input suggests where its first-expiring stock is (Cella); the water has none');
select is((select jsonb_array_length(e -> 'onHand') from res, jsonb_array_elements(r -> 'inputs') e
            where res.k = 'two' and e ->> 'name' like 'Manzo%'), 1, 'and the on-hand lists only the location with stock');

select * from finish();
rollback;
