-- M17 step 4: the waiter's service menu and the owner's manage list (plan §3.1.7, §3.2; AT4 waiter reads no cost or
-- margin, AT5 unmapped is flagged). Fixed key sets, recursive key scans, the price in force (two rows), the push contract
-- of M23, two tenants with different defaults. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(48);

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
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111',
   'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111',
   'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo');
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e2', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'spezzatino con polenta (demo)',
   'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by) values
  ('ed000000-0000-4000-8000-0000000000d2', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e2', 1,
   now() - interval '2 days', 'Spezzatino con polenta (demo)', 'a1000000-0000-4000-8000-00000000000a');

create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
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
create function pg_temp.all_keys(j jsonb) returns setof text language plpgsql as $$
declare
  k text;
  v jsonb;
begin
  if jsonb_typeof(j) = 'object' then
    for k, v in select * from jsonb_each(j) loop
      return next k;
      return query select * from pg_temp.all_keys(v);
    end loop;
  elsif jsonb_typeof(j) = 'array' then
    for v in select * from jsonb_array_elements(j) loop
      return query select * from pg_temp.all_keys(v);
    end loop;
  end if;
end
$$;
create function pg_temp.item_of(j jsonb, p_id uuid) returns jsonb language sql as $$
  select jsonb_path_query_first(j, '$.**.items[*] ? (@.id == $id)', jsonb_build_object('id', p_id::text)) $$;
create function pg_temp.mk(p_body text) returns uuid language sql as $$
  select (public.create_menu_item(p_body::jsonb) -> 'item' ->> 'id')::uuid $$;
create temp table ids (k text primary key, id uuid);

-- Tenant A as the owner: Secondi (positions 1, 2), Bevande (5), an inactive Primi item.
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
insert into ids values
  ('spez', pg_temp.mk('{"name":"Spezzatino con polenta (demo)","category":"Secondi","course":"secondi","recipeKey":"ec000000-0000-4000-8000-0000000000e2","price":14,"vatRate":10,"position":2}')),
  ('arro', pg_temp.mk('{"name":"Arrosto (demo)","category":"Secondi","course":"secondi","recipeKey":null,"price":16.5,"vatRate":10,"position":1}')),
  ('acqua', pg_temp.mk('{"name":"Acqua (demo)","category":"Bevande","course":"bevande","recipeKey":null,"price":2,"vatRate":10,"position":5}')),
  ('zuppa', pg_temp.mk('{"name":"Zuppa (demo)","category":"Primi","course":"primi","recipeKey":null,"price":7,"vatRate":10,"position":0}')),
  ('birra', pg_temp.mk('{"name":"Birra (demo)","category":"Bevande","course":"bevande","recipeKey":null,"price":4,"vatRate":22,"position":6,"available":false}'));
select public.update_menu_item((select id from ids where k = 'zuppa'), '{"active":false}');
-- Two price rows for the stew: the service menu shows the newest.
select public.update_menu_item((select id from ids where k = 'spez'), '{"price":15}');

-- Tenant B has one item.
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select pg_temp.mk('{"name":"Solo B (demo)","category":"Altro","course":"dolci","recipeKey":null,"price":3,"vatRate":22}');

-- ----------------------------------------------------------------------------------------------------------------
-- Waiter: no direct reads, a fixed-shape menu.
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
set local role authenticated;
select is((select count(*)::int from public.menu_item), 0, 'waiter A reads no menu_item row directly');
select is((select count(*)::int from public.menu_item_price), 0, 'and no menu_item_price row');
reset role;
create temp table w (j jsonb);
insert into w select public.menu_list();
select is((select array_agg(k order by k) from jsonb_object_keys((select j from w)) k), array['categories'], 'the top-level key set is exactly {categories}');
select is((select array_agg(c ->> 'name' order by ord) from w, jsonb_array_elements(j -> 'categories') with ordinality x(c, ord)),
  array['Secondi', 'Bevande'], 'categories are ordered by their lowest position (Secondi 1, Bevande 5); the inactive Primi is absent');
select is((select array_agg(i ->> 'name' order by ord) from w, jsonb_array_elements(j -> 'categories' -> 0 -> 'items') with ordinality x(i, ord)),
  array['Arrosto (demo)', 'Spezzatino con polenta (demo)'], 'items are ordered by position');
select is((select array_agg(i ->> 'name' order by ord) from w, jsonb_array_elements(j -> 'categories' -> 1 -> 'items') with ordinality x(i, ord)),
  array['Acqua (demo)', 'Birra (demo)'], 'items of a second category are ordered by position');
select is((select array_agg(k order by k) from w, jsonb_object_keys(j -> 'categories' -> 0) k), array['items', 'name'], 'a category has exactly {name, items}');
select is((select array_agg(k order by k collate "C") from w, jsonb_object_keys(pg_temp.item_of(j, (select id from ids where k = 'spez'))) k),
  array['available', 'category', 'course', 'id', 'name', 'price', 'pushPrice', 'pushed'], 'an item has exactly the eight service keys');
select is((select count(*)::int from w, pg_temp.all_keys(j) k where k ~* 'cost|margin|gp|food|eur$|recipe|vat'), 0,
  'a recursive key scan finds no cost, margin, GP, food, eur, recipe or VAT key');
select is((select (pg_temp.item_of(j, (select id from ids where k = 'spez')) ->> 'price')::numeric from w), 15::numeric, 'the price is the newest of two rows (15, not 14)');
select is((select pg_temp.item_of(j, (select id from ids where k = 'arro')) ->> 'price' from w), '16.5', 'the price keeps its decimals');
select is((select pg_temp.item_of(j, (select id from ids where k = 'birra')) ->> 'available' from w), 'false', 'a manually unavailable item is listed with available false');
select is((select pg_temp.item_of(j, (select id from ids where k = 'zuppa')) from w), null, 'the inactive item is absent');
select is((select pg_temp.item_of(j, (select id from ids where k = 'acqua')) ->> 'course' from w), 'bevande', 'the course word is returned');
select is((select (pg_temp.item_of(j, (select id from ids where k = 'acqua')) ->> 'pushed') || '/' || (pg_temp.item_of(j, (select id from ids where k = 'acqua')) -> 'pushPrice')::text from w),
  'false/null', 'not pushed: pushed false, pushPrice null');
select is((select count(*)::int from w, jsonb_array_elements(j -> 'categories') c, jsonb_array_elements(c -> 'items') i
            where i ->> 'name' like '%B (demo)'), 0, 'tenant B''s item is absent');

-- Push contract (M23): pushed while push_until is in the future.
update public.menu_item set push_until = now() + interval '2 hours', push_price = 12 where id = (select id from ids where k = 'spez');
update public.menu_item set push_until = now() - interval '1 minute', push_price = 9 where id = (select id from ids where k = 'arro');
update public.menu_item set push_until = now() + interval '2 hours' where id = (select id from ids where k = 'acqua');
delete from w;
insert into w select public.menu_list();
select is((select (pg_temp.item_of(j, (select id from ids where k = 'spez')) ->> 'pushed') || '/' || (pg_temp.item_of(j, (select id from ids where k = 'spez')) ->> 'pushPrice') from w),
  'true/12', 'push_until in two hours: pushed true, pushPrice 12');
select is((select (pg_temp.item_of(j, (select id from ids where k = 'arro')) ->> 'pushed') || '/' || (pg_temp.item_of(j, (select id from ids where k = 'arro')) -> 'pushPrice')::text from w),
  'false/null', 'push_until a minute ago: pushed false, pushPrice null (no longer pinned)');
select is((select (pg_temp.item_of(j, (select id from ids where k = 'acqua')) ->> 'pushed') || '/' || (pg_temp.item_of(j, (select id from ids where k = 'acqua')) -> 'pushPrice')::text from w),
  'true/null', 'pushed without a push price: pushPrice null');
select is((select (pg_temp.item_of(j, (select id from ids where k = 'spez')) ->> 'price')::numeric from w), 15::numeric, 'the normal price is unchanged by a push');

-- Roles on the service menu.
select is(pg_temp.err('select public.menu_list()'), 'ok', 'waiter can read the menu');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.err('select public.menu_list()'), '42501 permission denied: the service menu and tables need owner, admin or waiter', 'chef: 42501 on menu_list');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is(pg_temp.err('select public.menu_list()'), 'ok', 'admin can read the menu');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is((select jsonb_array_length(public.menu_list() -> 'categories')), 1, 'owner B sees one category (its own)');
select is((select public.menu_list() -> 'categories' -> 0 -> 'items' -> 0 ->> 'name'), 'Solo B (demo)', 'and only its own item');

-- ----------------------------------------------------------------------------------------------------------------
-- Manage list.
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
create temp table m (j jsonb);
insert into m select public.menu_items_manage();
select is((select (j -> 'defaults' ->> 'vatRate')::numeric from m), 10::numeric, 'tenant A: defaults.vatRate 10');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is((select (public.menu_items_manage() -> 'defaults' ->> 'vatRate')::numeric), 22::numeric, 'tenant B: defaults.vatRate 22 (two tenants differ)');
select is((select jsonb_array_length(public.menu_items_manage() -> 'items')), 1, 'owner B lists none of A''s items');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is((select j -> 'vatRates' from m), '[0,4,5,10,22]'::jsonb, 'vatRates lists the allowed rates');
select is((select j -> 'courses' from m), '["antipasti","primi","secondi","dolci","bevande"]'::jsonb, 'courses lists the five in service order');
select is((select j -> 'categories' from m), '["Bevande","Primi","Secondi"]'::jsonb, 'categories lists every category name, sorted (the inactive item''s too)');
select is((select array_agg(i ->> 'name' order by ord) from m, jsonb_array_elements(j -> 'items') with ordinality x(i, ord)),
  array['Arrosto (demo)', 'Spezzatino con polenta (demo)', 'Acqua (demo)', 'Birra (demo)', 'Zuppa (demo)'],
  'items: active first, then position, name, id (the inactive item is listed last)');
select is((select array_agg(k order by k collate "C") from m, jsonb_object_keys(pg_temp.item_of(j, (select id from ids where k = 'spez'))) k),
  array['active', 'available', 'category', 'course', 'id', 'name', 'position', 'price', 'priceValidFrom', 'pushPrice', 'pushUntil',
        'recipeActive', 'recipeKey', 'recipeName', 'unmapped', 'vatRate'],
  'a manage item has the sixteen documented keys');
select is((select count(*)::int from m, pg_temp.all_keys(j) k where k ~* 'cost|margin|gp|food'), 0, 'the manage list has no cost, margin, GP or food key');
select is((select (pg_temp.item_of(j, (select id from ids where k = 'acqua')) ->> 'unmapped')::boolean from m), true, 'AT5: the item without a recipe is unmapped');
select is((select (pg_temp.item_of(j, (select id from ids where k = 'spez')) ->> 'unmapped')::boolean from m), false, 'the mapped item is not unmapped');
select is((select pg_temp.item_of(j, (select id from ids where k = 'spez')) ->> 'recipeName' from m), 'Spezzatino con polenta (demo)', 'recipeName is the current version''s name');
select is((select (pg_temp.item_of(j, (select id from ids where k = 'zuppa')) ->> 'active')::boolean from m), false, 'the inactive item shows active false');
select is((select (pg_temp.item_of(j, (select id from ids where k = 'spez')) ->> 'price')::numeric from m), 15::numeric, 'manage price is the newest row');
select is((select (pg_temp.item_of(j, (select id from ids where k = 'birra')) ->> 'vatRate')::numeric from m), 22::numeric, 'manage vatRate is the row''s');
-- A second recipe version renames the plate: the manage list shows the newer name.
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by) values
  ('ed000000-0000-4000-8000-0000000000d3', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e2', 2,
   now() - interval '1 day', 'Spezzatino con polenta bis (demo)', 'a1000000-0000-4000-8000-00000000000a');
update public.recipe_key set current_version = 2, name_norm = 'spezzatino con polenta bis (demo)' where id = 'ec000000-0000-4000-8000-0000000000e2';
select is((select pg_temp.item_of(public.menu_items_manage(), (select id from ids where k = 'spez')) ->> 'recipeName'), 'Spezzatino con polenta bis (demo)',
  'after a second version the recipeName is the newer one (two candidates)');
update public.recipe_key set is_active = false where id = 'ec000000-0000-4000-8000-0000000000e2';
select is((select (pg_temp.item_of(public.menu_items_manage(), (select id from ids where k = 'spez')) ->> 'recipeActive')::boolean), false,
  'recipeActive is false once the recipe is deactivated');
select is((select pg_temp.item_of(public.menu_items_manage(), (select id from ids where k = 'acqua')) -> 'recipeActive'), 'null'::jsonb, 'an unmapped item has recipeActive null');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(pg_temp.err('select public.menu_items_manage()'), '42501 permission denied: the menu and table settings need owner or admin', 'waiter: 42501 on menu_items_manage');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.err('select public.menu_items_manage()'), '42501 permission denied: the menu and table settings need owner or admin', 'chef: 42501 on menu_items_manage');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is(pg_temp.err('select public.menu_items_manage()'), 'ok', 'admin can read the manage list');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r, unnest(array['public.menu_list()', 'public.menu_items_manage()']) f
            where has_function_privilege(r, f, 'execute')), 2, 'only authenticated executes the two reads');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('menu_list', 'menu_items_manage')
              and p.prosecdef and p.proconfig = array['search_path=""']), 2, 'both are security definer with an empty search_path');

select * from finish();
rollback;
