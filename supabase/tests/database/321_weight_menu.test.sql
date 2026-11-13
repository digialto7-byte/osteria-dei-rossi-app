-- P2-0b A2 (sell by weight, plan §3.3, §5 A2): the price unit and the reference portion weight on the menu item (P-2, P-3), the tenant's
-- maximum-weight setting and its two procedures, the sale terms read, menu_list, and the plate margin and plate cost reads.
-- Owner/admin only for every write; waiter and chef get 42501 before parsing. Fake data only; items found by id.
begin;
create extension if not exists pgtap with schema extensions;
select plan(105);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test');
insert into public.tenant (id, name, vat_number, settings) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000', '{"sale_vat_pct": 10}'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115', '{"sale_vat_pct": 22}');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo');

-- Cost fixture (as pgTAP 158): two flour plates at a food cost of 3,00 (2 kg at 1,50), recipe price 12,00, target GP 70.
insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('1b000000-0000-4000-8000-00000000001b', '11111111-1111-4111-8111-111111111111', 'Farina di mais (demo)', 'kg');
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo Srl', 'IT12345678903');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id)
  values ('00000000-0000-4000-8000-0000000000f1', '11111111-1111-4111-8111-111111111111',
          '11111111-1111-4111-8111-111111111111/2026/00000000-0000-4000-8000-0000000000f1.pdf', 'application/pdf', 100, 'review',
          '5a000000-0000-4000-8000-00000000005a');
insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price, line_amount, field_confidence, extracted)
  values ('a2000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-0000000000f1', 1,
          'Acquisto demo', 1, 1.5, 1.5, '{}', '{}');
insert into public.price_history (tenant_id, ingredient_id, supplier_id, invoice_line_id, unit_price, base_unit, effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', '1b000000-0000-4000-8000-00000000001b', '5a000000-0000-4000-8000-00000000005a',
          'a2000000-0000-4000-8000-000000000001', 1.5, 'kg', '1998-09-01', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'piatto uno (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'piatto due (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'brasato (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e2', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'brasato con polenta (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by) values
  ('ed000000-0000-4000-8000-000000000101', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-000000000001', 1, '1998-01-01T00:00Z', 'Piatto uno (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ed000000-0000-4000-8000-000000000201', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-000000000002', 1, '1998-01-01T00:00Z', 'Piatto due (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ed000000-0000-4000-8000-0000000000d2', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e2', 1, now() - interval '5 days', 'Brasato con polenta (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch, shelf_life_hours, created_by) values
  ('ed000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e1', 1, now() - interval '5 days', 'Brasato (demo)', 2, 'kg', 10, 48, 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, qty, unit, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-000000000101', 1, '1b000000-0000-4000-8000-00000000001b', 2, 'kg', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-000000000201', 1, '1b000000-0000-4000-8000-00000000001b', 2, 'kg', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe_line (tenant_id, recipe_id, position, sub_recipe_key, qty, unit, yield_factor, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d2', 1, 'ec000000-0000-4000-8000-0000000000e1', 1, 'porz', 1, 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe_price (recipe_id, tenant_id, sale_price, target_gp_pct, created_by) values
  ('ed000000-0000-4000-8000-000000000101', '11111111-1111-4111-8111-111111111111', 12, 70, 'a1000000-0000-4000-8000-00000000000a'),
  ('ed000000-0000-4000-8000-000000000201', '11111111-1111-4111-8111-111111111111', 12, 70, 'a1000000-0000-4000-8000-00000000000a');
insert into public.location (id, tenant_id, name) values ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)');
-- One live batch of the brasato: 3,5 portions left.
insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code, lot_seq, produced_at, produced_by,
    output_qty, output_unit, portions_computed, portions_initial, shelf_life_hours, use_by, state, location_id, created_by)
  values ('b4000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e1',
    'ed000000-0000-4000-8000-0000000000d1', 1, '981023-LOT-1', '1998-10-23', 'LOT', 1, now() + interval '40 hours' - interval '48 hours',
    'a1000000-0000-4000-8000-00000000000a', 2, 'kg', 4, 4, 48, now() + interval '40 hours', 'fresh', '10000000-0000-4000-8000-0000000000a1',
    'a1000000-0000-4000-8000-00000000000a');
insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', 'b4000000-0000-4000-8000-000000000001', 'produce', 3.5, 'batch', 'b4000000-0000-4000-8000-000000000001',
    '1998-10-23', 'a1000000-0000-4000-8000-00000000000a');

create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role, 'aal', case when app_role = 'admin' then 'aal2' else 'aal1' end)::text, true)
$$;
create function pg_temp.as_owner() returns void language sql as $$ select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner') $$;
create function pg_temp.as_admin() returns void language sql as $$ select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin') $$;
create function pg_temp.as_waiter() returns void language sql as $$ select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter') $$;
create function pg_temp.as_chef() returns void language sql as $$ select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef') $$;
create function pg_temp.as_owner_b() returns void language sql as $$ select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner') $$;
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
create function pg_temp.keys(j jsonb) returns setof text language plpgsql as $$
declare
  k text;
  v jsonb;
begin
  if jsonb_typeof(j) = 'object' then
    for k, v in select * from jsonb_each(j) loop
      return next k;
      return query select * from pg_temp.keys(v);
    end loop;
  elsif jsonb_typeof(j) = 'array' then
    for v in select * from jsonb_array_elements(j) loop
      return query select * from pg_temp.keys(v);
    end loop;
  end if;
end
$$;
create function pg_temp.item_of(j jsonb, p_id uuid) returns jsonb language sql as $$
  select jsonb_path_query_first(j, '$.categories[*].items[*] ? (@.id == $id)', jsonb_build_object('id', p_id::text)) $$;
create temp table ids (k text primary key, id uuid);
create temp table seen (k text primary key, j jsonb);
grant all on ids, seen to public;

-- Create: an etto dish with its reference portion weight, found by id -------------------------------------------------------------
select pg_temp.as_owner();
insert into ids select 'w1', (public.create_menu_item(
  '{"name":"Bistecca a peso (demo)","category":"Secondi","course":"secondi","recipeKey":"ec000000-0000-4000-8000-000000000001","price":5.5,"vatRate":10,"priceUnit":"etto","portionWeightG":400}'::jsonb)
  -> 'item' ->> 'id')::uuid;
select is((select p.price_unit || '/' || count(*) over () from public.menu_item_price p where p.menu_item_id = (select id from ids where k = 'w1')), 'etto/1', 'create: one price row, unit etto');
select is((select p.portion_weight_g from public.menu_item_price p where p.menu_item_id = (select id from ids where k = 'w1')), 400, 'create: the reference portion weight is stored on the price row (versioned with the unit)');
insert into seen select 'w1', app.menu_items_json('11111111-1111-4111-8111-111111111111', array[(select id from ids where k = 'w1')]) -> 0;
select is((select j ->> 'priceUnit' from seen where k = 'w1'), 'etto', 'the manage JSON has priceUnit etto');
select is((select j ->> 'portionWeightG' from seen where k = 'w1'), '400', 'the manage JSON has portionWeightG 400');
select is((select j ->> 'price' from seen where k = 'w1'), '5.5', 'and the per-etto price');
select is((select (a.after ->> 'price_unit') || '/' || (a.after ->> 'portion_weight_g') from public.audit_event a where a.entity_id = (select id from ids where k = 'w1') and a.action = 'menu_item.created'),
  'etto/400', 'the create audit has price_unit and portion_weight_g');
select is(pg_temp.err($$ select public.create_menu_item('{"name":"X1 (demo)","category":"Secondi","course":"secondi","recipeKey":null,"price":5.5,"vatRate":10,"priceUnit":"etto"}'::jsonb) $$),
  'P0001 portion_weight_missing', 'create: etto without portionWeightG is refused');
select is(pg_temp.err($$ select public.create_menu_item('{"name":"X2 (demo)","category":"Secondi","course":"secondi","recipeKey":null,"price":5.5,"vatRate":10,"priceUnit":"etto","portionWeightG":null}'::jsonb) $$),
  'P0001 portion_weight_missing', 'create: etto with a null portionWeightG is refused');
select is(pg_temp.err($$ select public.create_menu_item('{"name":"X3 (demo)","category":"Secondi","course":"secondi","recipeKey":null,"price":5.5,"vatRate":10,"priceUnit":"kg","portionWeightG":400}'::jsonb) $$),
  'P0001 price_unit_invalid', 'create: priceUnit kg is refused');
select is(pg_temp.err($$ select public.create_menu_item('{"name":"X4 (demo)","category":"Secondi","course":"secondi","recipeKey":null,"price":5.5,"vatRate":10,"priceUnit":5}'::jsonb) $$),
  '22023 invalid_request', 'create: a non-string priceUnit is invalid_request');
select is(pg_temp.err($$ select public.create_menu_item('{"name":"X5 (demo)","category":"Secondi","course":"secondi","recipeKey":null,"price":5.5,"vatRate":10,"priceUnit":"etto","portionWeightG":9}'::jsonb) $$),
  'P0001 portion_weight_invalid', 'create: portionWeightG 9 is refused');
select is(pg_temp.err($$ select public.create_menu_item('{"name":"X6 (demo)","category":"Secondi","course":"secondi","recipeKey":null,"price":5.5,"vatRate":10,"priceUnit":"etto","portionWeightG":3001}'::jsonb) $$),
  'P0001 portion_weight_invalid', 'create: portionWeightG 3001 is refused');
select is(pg_temp.err($$ select public.create_menu_item('{"name":"X7 (demo)","category":"Secondi","course":"secondi","recipeKey":null,"price":5.5,"vatRate":10,"priceUnit":"etto","portionWeightG":400.5}'::jsonb) $$),
  'P0001 portion_weight_invalid', 'create: portionWeightG 400.5 is refused');
select is(pg_temp.err($$ select public.create_menu_item('{"name":"X8 (demo)","category":"Secondi","course":"secondi","recipeKey":null,"price":5.5,"vatRate":10,"portionWeightG":"400"}'::jsonb) $$),
  '22023 invalid_request', 'create: a string portionWeightG is invalid_request');
-- A portion dish, unmapped; a portion dish mapped to plate two; a brasato dish mapped to the batch plate.
insert into ids select 'p1', (public.create_menu_item(
  '{"name":"Tagliatelle (demo)","category":"Primi","course":"primi","recipeKey":null,"price":14,"vatRate":10}'::jsonb) -> 'item' ->> 'id')::uuid;
insert into ids select 'p2', (public.create_menu_item(
  '{"name":"Tagliolini (demo)","category":"Primi","course":"primi","recipeKey":"ec000000-0000-4000-8000-000000000002","price":14,"vatRate":10}'::jsonb) -> 'item' ->> 'id')::uuid;
insert into ids select 'w2', (public.create_menu_item(
  '{"name":"Brasato a peso (demo)","category":"Secondi","course":"secondi","recipeKey":"ec000000-0000-4000-8000-0000000000e2","price":5.5,"vatRate":10,"priceUnit":"etto","portionWeightG":400}'::jsonb) -> 'item' ->> 'id')::uuid;
select is((select (j ->> 'priceUnit') || '/' || coalesce(j ->> 'portionWeightG', 'null') from (select app.menu_items_json('11111111-1111-4111-8111-111111111111', array[(select id from ids where k = 'p1')]) -> 0 as j) x),
  'portion/null', 'a portion dish: priceUnit portion, portionWeightG null');

-- Update: P-2 (the weight is required with etto) and P-3 (a switch needs a price) -------------------------------------------------
select is(pg_temp.err(format($f$ select public.update_menu_item(%L, '{"priceUnit":"etto"}'::jsonb) $f$, (select id from ids where k = 'p1'))),
  'P0001 price_required', 'update: priceUnit etto without a price is refused (P-3)');
select is(pg_temp.err(format($f$ select public.update_menu_item(%L, '{"priceUnit":"etto","price":5.5}'::jsonb) $f$, (select id from ids where k = 'p1'))),
  'P0001 portion_weight_missing', 'update: etto on an item without a weight is refused (P-2)');
select is((select count(*)::int from public.menu_item_price where menu_item_id = (select id from ids where k = 'p1')), 1, 'and nothing was written');
select is(pg_temp.err(format($f$ select public.update_menu_item(%L, '{"priceUnit":"kg","price":5.5}'::jsonb) $f$, (select id from ids where k = 'p1'))),
  'P0001 price_unit_invalid', 'update: priceUnit kg is refused');
select is(pg_temp.err(format($f$ select public.update_menu_item(%L, '{"portionWeightG":9}'::jsonb) $f$, (select id from ids where k = 'p1'))),
  'P0001 portion_weight_invalid', 'update: portionWeightG 9 is refused');
select is(pg_temp.err(format($f$ select public.update_menu_item(%L, '{"portionWeightG":3001}'::jsonb) $f$, (select id from ids where k = 'p1'))),
  'P0001 portion_weight_invalid', 'update: portionWeightG 3001 is refused');
select is(pg_temp.err(format($f$ select public.update_menu_item(%L, '{"portionWeightG":400.5}'::jsonb) $f$, (select id from ids where k = 'p1'))),
  'P0001 portion_weight_invalid', 'update: portionWeightG 400.5 is refused');
insert into seen select 'u1', public.update_menu_item((select id from ids where k = 'p1'), '{"priceUnit":"etto","price":3.35,"portionWeightG":200}'::jsonb);
select is((select j ->> 'changed' from seen where k = 'u1'), 'true', 'update: etto with a price and a weight is applied');
select is((select (j -> 'item' ->> 'priceUnit') || '/' || (j -> 'item' ->> 'portionWeightG') || '/' || (j -> 'item' ->> 'price') from seen where k = 'u1'), 'etto/200/3.35', 'and the reply shows the new unit, weight and price');
select is((select count(*)::int from public.menu_item_price where menu_item_id = (select id from ids where k = 'p1')), 2, 'a second price row was written');
select is((select (a.before ->> 'price_unit') || '>' || (a.after ->> 'price_unit') || ' ' || (a.after ->> 'portion_weight_g')
             from public.audit_event a where a.entity_id = (select id from ids where k = 'p1') and a.action = 'menu_item.updated'),
  'portion>etto 200', 'the audit has price_unit before/after and the new portion_weight_g');
select is(pg_temp.err(format($f$ select public.update_menu_item(%L, '{"portionWeightG":null}'::jsonb) $f$, (select id from ids where k = 'p1'))),
  'P0001 portion_weight_missing', 'update: clearing the weight while the price is per etto is refused (P-2)');
select is((select (public.update_menu_item((select id from ids where k = 'p1'), '{"portionWeightG":250}'::jsonb)) ->> 'changed'), 'true', 'update: the weight alone changes');
select is((select count(*)::int from public.menu_item_price where menu_item_id = (select id from ids where k = 'p1')), 3, 'and writes a new terms row (the reference weight is versioned with the price row, review fix Q-W15)');
select is((select (public.update_menu_item((select id from ids where k = 'p1'), '{"priceUnit":"etto","portionWeightG":250}'::jsonb)) ->> 'changed'), 'false', 'an identical patch changes nothing');
select is((select count(*)::int from public.audit_event where entity_id = (select id from ids where k = 'p1') and action = 'menu_item.updated'), 2, 'and writes no audit row');
select is((select public.update_menu_item((select id from ids where k = 'p1'), '{"priceUnit":"portion","price":14}'::jsonb) -> 'item' ->> 'priceUnit'), 'portion', 'update: back to portion with a new price');
select is((select string_agg(p.price_unit || ':' || trim_scale(p.price)::text, ',' order by p.valid_from) from public.menu_item_price p where p.menu_item_id = (select id from ids where k = 'p1')),
  'portion:14,etto:3.35,etto:3.35,portion:14', 'the history keeps all four rows in order (the weight change wrote one)');
select is((select public.update_menu_item((select id from ids where k = 'p1'), '{"priceUnit":"etto","price":14,"portionWeightG":250}'::jsonb) -> 'item' ->> 'priceUnit'), 'etto',
  'a switch with the same number still writes a row (the unit differs)');
select is((select count(*)::int from public.menu_item_price where menu_item_id = (select id from ids where k = 'p1')), 5, 'so the history says what that number meant');
-- app.menu_item_sale_terms_at follows the history.
select is((select string_agg(t.price_unit, ',' order by x.n) from (values (1, (select min(p.valid_from) from public.menu_item_price p where p.menu_item_id = (select id from ids where k = 'p1'))), (2, clock_timestamp())) x (n, at),
            lateral app.menu_item_sale_terms_at('11111111-1111-4111-8111-111111111111', array[(select id from ids where k = 'p1')], x.at) t),
  'portion,etto', 'menu_item_sale_terms_at: the unit in force at an instant follows the history');
select is((select t.portion_weight_g from app.menu_item_sale_terms_at('11111111-1111-4111-8111-111111111111', array[(select id from ids where k = 'w1')], clock_timestamp()) t), 400,
  'and it carries the item''s reference portion weight');
select is((select count(*)::int from app.menu_item_sale_terms_at('11111111-1111-4111-8111-111111111111', array[(select id from ids where k = 'w1')], '1990-01-01')), 0,
  'and no row before the first price');

-- The weight setting ---------------------------------------------------------------------------------------------------------------
select is((select public.weight_settings()::text), '{"stepG": 10, "minWeightG": 50, "weightMaxG": 3000, "settingMaxG": 10000, "settingMinG": 500, "defaultWeightMaxG": 3000}',
  'weight_settings: the defaults and the limits (no sale_settings row yet)');
select is((select count(*)::int from public.sale_settings where tenant_id = '11111111-1111-4111-8111-111111111111'), 0, 'and reading it creates no row');
insert into seen select 's1', public.set_weight_settings('{"weightMaxG":4000}'::jsonb);
select is((select j::text from seen where k = 's1'), '{"changed": true, "weightMaxG": 4000}', 'set_weight_settings 4000: changed, effective maximum 4000');
select is((select coalesce(weight_max_g::text, 'null') || '/' || coalesce(coperto_amount::text, 'null') from public.sale_settings where tenant_id = '11111111-1111-4111-8111-111111111111'), '4000/null',
  'a row was inserted with a null coperto and 4000');
select is((select (a.before ->> 'weight_max_g' is null)::text || '/' || (a.after ->> 'weight_max_g') from public.audit_event a where a.action = 'sale_settings.changed'), 'true/4000',
  'one sale_settings.changed audit row: weight_max_g before null, after 4000');
select is((select public.set_weight_settings('{"weightMaxG":4000}'::jsonb) ->> 'changed'), 'false', 'the same value again: changed false');
select is((select count(*)::int from public.audit_event where action = 'sale_settings.changed'), 1, 'and no second audit row');
select is((select public.weight_settings() ->> 'weightMaxG'), '4000', 'weight_settings now says 4000');
select is((select count(*)::int from app.coperto_settings('11111111-1111-4111-8111-111111111111')), 0, 'the coperto stays unset (coperto_settings gives no row)');
select is(pg_temp.err($$ select public.set_weight_settings('{"weightMaxG":490}'::jsonb) $$), 'P0001 weight_max_invalid', 'set_weight_settings 490 is refused');
select is(pg_temp.err($$ select public.set_weight_settings('{"weightMaxG":10010}'::jsonb) $$), 'P0001 weight_max_invalid', 'set_weight_settings 10 010 is refused');
select is(pg_temp.err($$ select public.set_weight_settings('{"weightMaxG":1005}'::jsonb) $$), 'P0001 weight_max_invalid', 'set_weight_settings 1 005 is refused');
select is(pg_temp.err($$ select public.set_weight_settings('{"weightMaxG":1000.5}'::jsonb) $$), 'P0001 weight_max_invalid', 'set_weight_settings 1000.5 is refused');
select is(pg_temp.err($$ select public.set_weight_settings('{"weightMaxG":"4000"}'::jsonb) $$), '22023 invalid_request', 'a string value is invalid_request');
select is(pg_temp.err($$ select public.set_weight_settings('{}'::jsonb) $$), '22023 invalid_request', 'an empty body is invalid_request');
select is(pg_temp.err($$ select public.set_weight_settings('{"weightMaxG":4000,"x":1}'::jsonb) $$), '22023 invalid_request', 'an extra key is invalid_request');
select is(pg_temp.err($$ select public.set_weight_settings('{"max":4000}'::jsonb) $$), '22023 invalid_request', 'a missing weightMaxG key is invalid_request');
-- set_sale_settings keeps the weight, and the weight keeps the coperto path.
select is((select public.set_sale_settings('{"copertoAmount":2,"copertoVatRate":10}'::jsonb) ->> 'changed'), 'true', 'set_sale_settings sets a coperto on the row');
select is((select weight_max_g from public.sale_settings where tenant_id = '11111111-1111-4111-8111-111111111111'), 4000, 'and weight_max_g is still 4000');
select is((select amount from app.coperto_settings('11111111-1111-4111-8111-111111111111')), 2.00, 'and the coperto is read as before');
select is((select public.set_weight_settings('{"weightMaxG":null}'::jsonb)::text), '{"changed": true, "weightMaxG": 3000}', 'null sends the setting back to the default');
select is((select public.weight_settings() ->> 'weightMaxG'), '3000', 'weight_settings: 3000 again');
select is((select weight_max_g is null and coperto_amount = 2 from public.sale_settings where tenant_id = '11111111-1111-4111-8111-111111111111'), true, 'the row keeps its coperto and a null weight');
select is((select public.set_weight_settings('{"weightMaxG":4000}'::jsonb) ->> 'changed'), 'true', 'set 4000 again for the reads below');

-- Roles: owner and admin write; waiter and chef get 42501 before parsing (even with an invalid body) -----------------------------------
select pg_temp.as_admin();
select is((select public.weight_settings() ->> 'weightMaxG'), '4000', 'admin reads the weight settings');
select is((select public.set_weight_settings('{"weightMaxG":4000}'::jsonb) ->> 'changed'), 'false', 'admin may set it');
select pg_temp.as_waiter();
select is(left(pg_temp.err($$ select public.weight_settings() $$), 5), '42501', 'waiter: weight_settings 42501');
select is(left(pg_temp.err($$ select public.set_weight_settings('"not an object"'::jsonb) $$), 5), '42501', 'waiter: set_weight_settings 42501 before parsing');
select is(left(pg_temp.err($$ select public.create_menu_item('{"priceUnit":"kg"}'::jsonb) $$), 5), '42501', 'waiter: create_menu_item 42501');
select is(left(pg_temp.err(format($f$ select public.update_menu_item(%L, '{"priceUnit":"kg"}'::jsonb) $f$, (select id from ids where k = 'w1'))), 5), '42501', 'waiter: update_menu_item 42501');
select pg_temp.as_chef();
select is(left(pg_temp.err($$ select public.weight_settings() $$), 5), '42501', 'chef: weight_settings 42501');
select is(left(pg_temp.err($$ select public.set_weight_settings('{"weightMaxG":4000}'::jsonb) $$), 5), '42501', 'chef: set_weight_settings 42501');
select is(left(pg_temp.err($$ select public.create_menu_item('{"priceUnit":"kg"}'::jsonb) $$), 5), '42501', 'chef: create_menu_item 42501');
select is(left(pg_temp.err(format($f$ select public.update_menu_item(%L, '{"priceUnit":"kg"}'::jsonb) $f$, (select id from ids where k = 'w1'))), 5), '42501', 'chef: update_menu_item 42501');
select pg_temp.as_owner_b();
select is(pg_temp.err(format($f$ select public.update_menu_item(%L, '{"portionWeightG":300}'::jsonb) $f$, (select id from ids where k = 'w1'))), 'P0002 menu_item_not_found', 'owner B cannot touch A''s item');
select is((select public.weight_settings() ->> 'weightMaxG'), '3000', 'owner B reads its own default, not A''s 4000');
select is((select public.set_weight_settings('{"weightMaxG":5000}'::jsonb) ->> 'weightMaxG'), '5000', 'owner B sets its own');
select is((select weight_max_g from public.sale_settings where tenant_id = '11111111-1111-4111-8111-111111111111'), 4000, 'and A''s setting is untouched');
select is((select count(*)::int from unnest(array['INSERT', 'UPDATE', 'DELETE']) p, unnest(array['public.menu_item', 'public.menu_item_price', 'public.sale_settings']) t, unnest(array['anon', 'authenticated', 'service_role']) r
            where has_table_privilege(r, t, p)), 0, 'no API role has a write grant on menu_item, menu_item_price or sale_settings');
select is((select count(*)::int from unnest(array['public.weight_settings()', 'public.set_weight_settings(jsonb)']) f
            where has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute') and not has_function_privilege('service_role', f, 'execute')), 2,
  'the two new functions are executable by authenticated only');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('weight_settings', 'set_weight_settings')
            and p.prosecdef and p.proconfig = array['search_path=""']), 2, 'and both are security definer with an empty search_path');

-- menu_list ----------------------------------------------------------------------------------------------------------------------
select pg_temp.as_waiter();
insert into seen select 'ml', public.menu_list();
select is((select (pg_temp.item_of(j, (select id from ids where k = 'w2')) ->> 'priceUnit') || '/' || (pg_temp.item_of(j, (select id from ids where k = 'w2')) ->> 'price') || '/' ||
                   (pg_temp.item_of(j, (select id from ids where k = 'w2')) ->> 'portionWeightG') from seen where k = 'ml'), 'etto/5.5/400', 'menu_list: a weighted item has priceUnit, the per-etto price and portionWeightG');
select is((select pg_temp.item_of(j, (select id from ids where k = 'w2')) ->> 'portionsLeft' from seen where k = 'ml'), '3.5', 'the brasato has 3,5 portions left');
select is((select pg_temp.item_of(j, (select id from ids where k = 'w2')) ->> 'weightLeftG' from seen where k = 'ml'), '1400', 'and weightLeftG 1400 (floor of 3,5 x 400)');
select is((select pg_temp.item_of(j, (select id from ids where k = 'w1')) ->> 'weightLeftG' is null from seen where k = 'ml'), true, 'a weighted item whose plate uses no batch: weightLeftG null');
select is((select jsonb_typeof(pg_temp.item_of(j, (select id from ids where k = 'w1')) -> 'weightLeftG') from seen where k = 'ml'), 'null', 'and the key is present as null');
select is((select (pg_temp.item_of(j, (select id from ids where k = 'p2')) ->> 'priceUnit') || '/' || jsonb_typeof(pg_temp.item_of(j, (select id from ids where k = 'p2')) -> 'portionWeightG') || '/' ||
                   jsonb_typeof(pg_temp.item_of(j, (select id from ids where k = 'p2')) -> 'weightLeftG') from seen where k = 'ml'), 'portion/null/null', 'a portion item: priceUnit portion, portionWeightG and weightLeftG null');
select is((select pg_temp.item_of(j, (select id from ids where k = 'p1')) ->> 'priceUnit' from seen where k = 'ml'), 'etto', 'an item switched to etto reads etto (p1 is etto at 14 per etto, 250 g)');
select is((select j ->> 'weightMaxG' from seen where k = 'ml'), '4000', 'the top level carries weightMaxG (4000 here)');
select pg_temp.as_owner();
select is((select public.push_menu_item((select id from ids where k = 'w2'), '{"pushed":true,"pushPrice":4.5}'::jsonb) ->> 'changed'), 'true', 'the owner pushes the weighted brasato at 4,50 per etto');
select pg_temp.as_waiter();
select is((select (pg_temp.item_of(m, (select id from ids where k = 'w2')) ->> 'pushPrice') || '/' || (pg_temp.item_of(m, (select id from ids where k = 'w2')) ->> 'price') from (select public.menu_list() as m) x), '4.5/5.5',
  'a pushed weighted item shows its push price per etto beside the menu price');
select is((select count(*)::int from seen s, pg_temp.keys(s.j) as kk (key) where s.k = 'ml' and kk.key ~* 'cost|margin|food|gp|vat|recipe'), 0, 'the waiter''s menu has no cost-like key');
select pg_temp.as_chef();
select is(left(pg_temp.err($$ select public.menu_list() $$), 5), '42501', 'the chef still cannot read the menu');

-- Plate margins and plate cost reads ---------------------------------------------------------------------------------------------------
select pg_temp.as_owner();
select is((select c.sale_price_eur::text || ' ' || c.sale_price_ex_vat_eur::text || ' ' || c.gp_pct::text from public.plate_costs() c where c.recipe_key = 'ec000000-0000-4000-8000-000000000001'),
  '22.00 20.0000 85.0000', 'plate_costs: an etto plate (5,50 x 400 g) has the reference portion''s price 22,00 and its GP from that');
select is((select c.price_unit || ' ' || c.price_per_100g::text || ' ' || c.portion_weight_g::text from public.plate_costs() c where c.recipe_key = 'ec000000-0000-4000-8000-000000000001'),
  'etto 5.50 400', 'and carries priceUnit, pricePer100g and portionWeightG');
select is((select c.sale_price_eur::text || ' ' || c.gp_pct::text || ' ' || coalesce(c.price_unit, 'x') || ' ' || coalesce(c.price_per_100g::text, 'null') || ' ' || coalesce(c.portion_weight_g::text, 'null')
             from public.plate_costs() c where c.recipe_key = 'ec000000-0000-4000-8000-000000000002'),
  '14.00 76.4286 portion null null', 'a portion plate: byte-identical figures, the unit portion and null per-etto keys');
select is((select c.sale_price_eur::text || ' ' || coalesce(c.price_unit, 'x') from public.plate_costs() c where c.recipe_key = 'ec000000-0000-4000-8000-0000000000e2'),
  '22.00 etto', 'the brasato plate (item w2) reads its reference portion price too');
select is((select count(*)::int from public.plate_margins_pct() m where m.recipe_key = 'ec000000-0000-4000-8000-000000000001' and m.gp_pct = 85.0000), 1,
  'plate_margins_pct reads the same GP for the etto plate (its columns are unchanged)');
select is((select b -> 'money' ->> 'pricePer100g' from (select public.plate_breakdown('ec000000-0000-4000-8000-000000000001') as b) x), '5.5', 'plate_breakdown (owner): money.pricePer100g');
select is((select (b -> 'money' ->> 'priceUnit') || '/' || (b -> 'money' ->> 'portionWeightG') || '/' || (b -> 'money' ->> 'salePriceEur')
             from (select public.plate_breakdown('ec000000-0000-4000-8000-000000000001') as b) x), 'etto/400/22.00', 'plate_breakdown (owner): priceUnit, portionWeightG and salePriceEur in the money block');
select is((select b -> 'money' ->> 'priceUnit' from (select public.plate_breakdown('ec000000-0000-4000-8000-000000000002') as b) x), 'portion', 'plate_breakdown: a portion plate says portion');
select pg_temp.as_chef();
select is((select count(*)::int from (select public.plate_breakdown('ec000000-0000-4000-8000-000000000001') as b) x, pg_temp.keys(x.b) as kk (key)
            where kk.key ~* 'price|eur$|^money$|portionWeight|pricePer'), 0, 'plate_breakdown (chef): no price, unit, weight or money key');

-- plate_costs was dropped and created again (its output columns grew): same arguments, owner, security attributes, search_path and grants.
select is((select pg_get_function_identity_arguments(p.oid) from pg_proc p where p.oid = 'public.plate_costs(date)'::regprocedure), 'p_date date', 'plate_costs: the same arguments (the default stays null)');
select is((select p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=""'] and p.proowner = (select q.proowner from pg_proc q where q.proname = 'plate_margins_pct' and q.pronamespace = 'public'::regnamespace)
             from pg_proc p where p.oid = 'public.plate_costs(date)'::regprocedure), true, 'plate_costs: security definer, stable, empty search_path, the owner of its siblings');
select is((select string_agg(r, ',' order by r collate "C") from unnest(array['anon', 'authenticated', 'service_role']) r where has_function_privilege(r, 'public.plate_costs(date)', 'execute')), 'authenticated',
  'plate_costs: executable by authenticated only');
select is((select count(*)::int from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.plate_costs(date)'::regprocedure and a.grantee = 0), 0, 'plate_costs: no grant to PUBLIC');
select is((select count(*)::int from pg_depend d where d.refclassid = 'pg_proc'::regclass and d.refobjid = 'public.plate_costs(date)'::regprocedure and d.deptype = 'n'), 0,
  'nothing depends on plate_costs (so the drop needed no CASCADE)');

select * from finish();
rollback;
