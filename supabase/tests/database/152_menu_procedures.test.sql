-- M17 step 3: create_menu_item and update_menu_item (plan §3.1.1, §3.2; AT5 unmapped item accepted). Roles, validation,
-- the price history (append-only, one row per change), the audit and the uniqueness errors. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(98);

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
-- Recipe keys: P plate (A), K batch (A), Q plate deactivated (A), PB plate (B).
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, is_active, created_by) values
  ('ec000000-0000-4000-8000-0000000000e2', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'spezzatino con polenta (demo)', true,
   'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'spezzatino (demo)', true,
   'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e3', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'vecchio piatto (demo)', false,
   'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e4', '22222222-2222-4222-8222-222222222222', 'plate', 1, 'piatto b (demo)', true,
   'b1000000-0000-4000-8000-00000000000b');

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
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
create function pg_temp.owner() returns void language sql as $$
  select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner') $$;
create function pg_temp.mk(p_body text) returns text language sql as $$
  select pg_temp.err(format('select public.create_menu_item(%L::jsonb)', p_body)) $$;
create function pg_temp.up(p_item uuid, p_patch text) returns text language sql as $$
  select pg_temp.err(format('select public.update_menu_item(%L::uuid, %L::jsonb)', p_item, p_patch)) $$;
create temp table res (k text primary key, j jsonb);
create function pg_temp.create_as(p_k text, p_body text) returns void language sql as $$
  insert into res select p_k, public.create_menu_item(p_body::jsonb) $$;
create function pg_temp.update_as(p_k text, p_item uuid, p_patch text) returns void language sql as $$
  insert into res select p_k, public.update_menu_item(p_item, p_patch::jsonb) $$;
create function pg_temp.item_id(p_k text) returns uuid language sql as $$ select (j -> 'item' ->> 'id')::uuid from res where k = p_k $$;

select pg_temp.owner();

-- ----------------------------------------------------------------------------------------------------------------
-- Create: AT5, an item without a recipe is accepted and flagged unmapped.
select pg_temp.create_as('acqua', '{"name":"Acqua (demo)","category":"Bevande","course":"bevande","recipeKey":null,"price":2,"vatRate":10}');
select is((select j -> 'item' ->> 'name' from res where k = 'acqua'), 'Acqua (demo)', 'the created item is returned');
select is((select (j -> 'item' ->> 'unmapped')::boolean from res where k = 'acqua'), true, 'recipeKey null: unmapped true');
select is((select j -> 'item' -> 'recipeKey' from res where k = 'acqua'), 'null'::jsonb, 'recipeKey is null');
select is((select (j -> 'item' ->> 'price')::numeric || '/' || (j -> 'item' ->> 'vatRate') from res where k = 'acqua'), '2/10', 'price 2 at VAT 10');
select is((select (j -> 'item' ->> 'position') || '/' || (j -> 'item' ->> 'available') || '/' || (j -> 'item' ->> 'active') from res where k = 'acqua'),
  '0/true/true', 'defaults: position 0, available, active');
select is((select recipe_key from public.menu_item where id = pg_temp.item_id('acqua')), null, 'the row has a null recipe_key');
select is((select count(*)::int from public.menu_item_price where menu_item_id = pg_temp.item_id('acqua')), 1, 'one price row');
select is((select count(*)::int from public.audit_event where entity_type = 'menu_item' and action = 'menu_item.created'
            and entity_id = pg_temp.item_id('acqua') and created_by = 'a1000000-0000-4000-8000-00000000000a'), 1,
  'one menu_item.created audit row by the owner');
select is((select after ->> 'name' from public.audit_event where entity_id = pg_temp.item_id('acqua')), 'Acqua (demo)', 'the audit row holds the new values');
select is((select created_by from public.menu_item where id = pg_temp.item_id('acqua')), 'a1000000-0000-4000-8000-00000000000a'::uuid, 'created_by is the caller');

-- A plate key: mapped.
select pg_temp.create_as('spez', '{"name":"Spezzatino con polenta (demo)","category":"Secondi","course":"secondi","recipeKey":"ec000000-0000-4000-8000-0000000000e2","price":14,"vatRate":10,"position":5,"available":false}');
select is((select (j -> 'item' ->> 'unmapped')::boolean from res where k = 'spez'), false, 'a plate key: unmapped false');
select is((select j -> 'item' ->> 'recipeKey' from res where k = 'spez'), 'ec000000-0000-4000-8000-0000000000e2', 'the recipe key is returned');
select is((select (j -> 'item' ->> 'position') || '/' || (j -> 'item' ->> 'available') from res where k = 'spez'), '5/false', 'position and available are kept');

-- Errors.
select is(pg_temp.mk('{"name":"Brodo (demo)","category":"Primi","course":"primi","recipeKey":"ec000000-0000-4000-8000-0000000000e1","price":5,"vatRate":10}'),
  'P0001 recipe_not_plate', 'a batch key: recipe_not_plate');
select is(pg_temp.mk('{"name":"Brodo (demo)","category":"Primi","course":"primi","recipeKey":"ec000000-0000-4000-8000-0000000000e4","price":5,"vatRate":10}'),
  'P0002 recipe_not_found', 'tenant B''s plate key: recipe_not_found');
select is(pg_temp.mk('{"name":"Brodo (demo)","category":"Primi","course":"primi","recipeKey":"ec000000-0000-4000-8000-0000000000ff","price":5,"vatRate":10}'),
  'P0002 recipe_not_found', 'an unknown key: recipe_not_found');
select is(pg_temp.mk('{"name":"Brodo (demo)","category":"Primi","course":"primi","recipeKey":"ec000000-0000-4000-8000-0000000000e3","price":5,"vatRate":10}'),
  'P0001 recipe_inactive', 'a deactivated plate key: recipe_inactive');
select is(pg_temp.mk('{"name":"Altro (demo)","category":"Secondi","course":"secondi","recipeKey":"ec000000-0000-4000-8000-0000000000e2","price":5,"vatRate":10}'),
  'P0001 recipe_already_on_menu', 'a second active item on the same key: recipe_already_on_menu');
select is(pg_temp.mk('{"name":"  ACQUA   (demo) ","category":"Bevande","course":"bevande","recipeKey":null,"price":2,"vatRate":10}'),
  'P0001 menu_item_name_taken', 'the same name (case and spaces): menu_item_name_taken');
select is(pg_temp.mk('{"name":"Cola (demo)","category":"Bevande","course":"bevande","recipeKey":null,"price":14.005,"vatRate":10}'), 'P0001 price_invalid', 'price 14,005: price_invalid');
select is(pg_temp.mk('{"name":"Cola (demo)","category":"Bevande","course":"bevande","recipeKey":null,"price":-1,"vatRate":10}'), 'P0001 price_invalid', 'price -1: price_invalid');
select is(pg_temp.mk('{"name":"Cola (demo)","category":"Bevande","course":"bevande","recipeKey":null,"price":10000.01,"vatRate":10}'), 'P0001 price_invalid', 'price 10 000,01: price_invalid');
select is(pg_temp.mk('{"name":"Cola (demo)","category":"Bevande","course":"bevande","recipeKey":null,"price":"2","vatRate":10}'), '22023 invalid_request', 'a string price: invalid_request');
select is(pg_temp.mk('{"name":"Cola (demo)","category":"Bevande","course":"bevande","recipeKey":null,"price":2,"vatRate":12}'), 'P0001 vat_rate_invalid', 'VAT 12: vat_rate_invalid');
select is(pg_temp.mk('{"name":"Cola (demo)","category":"Bevande","course":"bevande","recipeKey":null,"price":2}'), '22023 invalid_request', 'a missing vatRate: invalid_request (no implicit VAT)');
select is(pg_temp.mk('{"name":"Cola (demo)","category":"Bevande","course":"bevande","price":2,"vatRate":10}'), '22023 invalid_request', 'a missing recipeKey: invalid_request');
select is(pg_temp.mk('{"name":"Cola (demo)","category":"Bevande","course":"bevande","recipeKey":null,"price":2,"vatRate":10,"pushUntil":"2026-11-01T10:00:00Z"}'),
  '22023 invalid_request', 'a pushUntil key: invalid_request (M23 writes it)');
select is(pg_temp.mk('{"name":"Cola (demo)","category":"Bevande","course":"bevande","recipeKey":null,"price":2,"vatRate":10,"active":false}'),
  '22023 invalid_request', 'an active key on create: invalid_request');
select is(pg_temp.mk('{"name":"","category":"Bevande","course":"bevande","recipeKey":null,"price":2,"vatRate":10}'), 'P0001 name_invalid', 'an empty name: name_invalid');
select is(pg_temp.mk(format('{"name":"%s","category":"Bevande","course":"bevande","recipeKey":null,"price":2,"vatRate":10}', repeat('x', 81))),
  'P0001 name_invalid', 'an 81-character name: name_invalid');
select is(pg_temp.mk('{"name":7,"category":"Bevande","course":"bevande","recipeKey":null,"price":2,"vatRate":10}'), '22023 invalid_request', 'a numeric name: invalid_request');
select is(pg_temp.mk('{"name":"Cola (demo)","category":"  ","course":"bevande","recipeKey":null,"price":2,"vatRate":10}'), 'P0001 category_invalid', 'a blank category: category_invalid');
select is(pg_temp.mk('{"name":"Cola (demo)","category":"Bevande","course":"bevande","recipeKey":null,"price":2,"vatRate":10,"position":10000}'), 'P0001 position_invalid', 'position 10000: position_invalid');
select is(pg_temp.mk('{"name":"Cola (demo)","category":"Bevande","course":"bevande","recipeKey":null,"price":2,"vatRate":10,"position":1.5}'), 'P0001 position_invalid', 'position 1,5: position_invalid');
select is(pg_temp.mk('{"name":"Cola (demo)","category":"Bevande","course":"dessert","recipeKey":null,"price":2,"vatRate":10}'), '22023 invalid_request', 'an unknown course: invalid_request');
select is(pg_temp.mk('{"name":"Cola (demo)","category":"Bevande","course":"bevande","recipeKey":null,"price":2,"vatRate":10,"available":"yes"}'), '22023 invalid_request', 'a non-boolean available: invalid_request');
select is(pg_temp.mk('{"name":"Cola (demo)","category":"Bevande","course":"bevande","recipeKey":"not-a-uuid","price":2,"vatRate":10}'), '22023 invalid_request', 'a malformed recipe key: invalid_request');
select is(pg_temp.err($$select public.create_menu_item('[]'::jsonb)$$), '22023 invalid_request', 'a non-object body: invalid_request');
select is(pg_temp.err($$select public.create_menu_item(null)$$), '22023 invalid_request', 'a null body: invalid_request');
select is((select count(*)::int from public.menu_item), 2, 'no refused call wrote an item');
select is((select count(*)::int from public.menu_item_price), 2, 'and no price row');
select is((select count(*)::int from public.audit_event where entity_type = 'menu_item'), 2, 'and no audit row');

-- ----------------------------------------------------------------------------------------------------------------
-- Update: the price history.
select pg_temp.update_as('p15', pg_temp.item_id('spez'), '{"price":15}');
select is((select (j ->> 'changed')::boolean from res where k = 'p15'), true, 'a price change: changed true');
select is((select (j -> 'item' ->> 'price')::numeric from res where k = 'p15'), 15::numeric, 'the item shows the new price');
select is((select count(*)::int from public.menu_item_price where menu_item_id = pg_temp.item_id('spez')), 2, 'a second price row');
select is((select price from public.menu_item_price where menu_item_id = pg_temp.item_id('spez') order by valid_from limit 1), 14.00::numeric,
  'the first row is unchanged (14,00)');
select is((select vat_rate from public.menu_item_price where menu_item_id = pg_temp.item_id('spez') order by valid_from desc limit 1), 10.00::numeric,
  'the new row keeps the VAT rate');
select is((select count(*)::int from public.audit_event where entity_id = pg_temp.item_id('spez') and action = 'menu_item.updated'
            and before = '{"price": 14}'::jsonb and after = '{"price": 15}'::jsonb), 1, 'one audit row, before {price: 14} after {price: 15}');
select pg_temp.update_as('p15b', pg_temp.item_id('spez'), '{"price":15}');
select is((select (j ->> 'changed')::boolean from res where k = 'p15b'), false, 'the same price again: changed false');
select is((select count(*)::int from public.menu_item_price where menu_item_id = pg_temp.item_id('spez')), 2, 'no new price row');
select is((select count(*)::int from public.audit_event where entity_id = pg_temp.item_id('spez') and action = 'menu_item.updated'), 1, 'no new audit row');
select pg_temp.update_as('v22', pg_temp.item_id('spez'), '{"vatRate":22}');
select is((select count(*)::int from public.menu_item_price where menu_item_id = pg_temp.item_id('spez')), 3, 'a VAT change adds a price row');
select is((select price || '/' || vat_rate from public.menu_item_price where menu_item_id = pg_temp.item_id('spez') order by valid_from desc limit 1), '15.00/22.00',
  'with the price in force and the new rate');
select is((select count(*)::int from (select valid_from, lag(valid_from) over (order by valid_from) p from public.menu_item_price
            where menu_item_id = pg_temp.item_id('spez')) x where p is not null and valid_from <= p), 0, 'valid_from strictly increases');
select pg_temp.update_as('both', pg_temp.item_id('spez'), '{"price":16,"vatRate":10}');
select is((select count(*)::int from public.menu_item_price where menu_item_id = pg_temp.item_id('spez')), 4, 'price and VAT together add one row');
select is((select count(*)::int from public.audit_event where entity_id = pg_temp.item_id('spez') and action = 'menu_item.updated'
            and before = '{"price": 15, "vat_rate": 22}'::jsonb and after = '{"price": 16, "vat_rate": 10}'::jsonb), 1,
  'one audit row for the combined change');
select is((select price from app.menu_item_price_at('11111111-1111-4111-8111-111111111111', array[pg_temp.item_id('spez')], clock_timestamp())), 16.00::numeric,
  'the price in force is the newest row');

-- Update: row fields.
select pg_temp.update_as('ren', pg_temp.item_id('spez'), '{"name":"Spezzatino (demo)","course":"primi","category":"Piatti","position":3}');
select is((select name || '/' || course_default || '/' || category || '/' || position from public.menu_item where id = pg_temp.item_id('spez')),
  'Spezzatino (demo)/primi/Piatti/3', 'a rename, course, category and position change updates the row');
select is((select count(*)::int from public.menu_item_price where menu_item_id = pg_temp.item_id('spez')), 4, 'without a price row');
select is((select count(*)::int from public.audit_event where entity_id = pg_temp.item_id('spez') and action = 'menu_item.updated'), 4, 'one more audit row (4 in total)');
select is((select before ->> 'name' || '>' || (after ->> 'name') from public.audit_event where entity_id = pg_temp.item_id('spez')
            and action = 'menu_item.updated' and after ? 'category'), 'Spezzatino con polenta (demo)>Spezzatino (demo)', 'the audit row carries before and after of the changed fields');
select is((select updated_by from public.menu_item where id = pg_temp.item_id('spez')), 'a1000000-0000-4000-8000-00000000000a'::uuid, 'updated_by is the caller');
select pg_temp.update_as('av', pg_temp.item_id('spez'), '{"available":true}');
select is((select is_available from public.menu_item where id = pg_temp.item_id('spez')), true, 'available can be switched on');
select pg_temp.update_as('un', pg_temp.item_id('spez'), '{"recipeKey":null}');
select is((select (j -> 'item' ->> 'unmapped')::boolean from res where k = 'un'), true, 'recipeKey null unmaps the item');
select is(pg_temp.up(pg_temp.item_id('spez'), '{"recipeKey":"ec000000-0000-4000-8000-0000000000e1"}'), 'P0001 recipe_not_plate', 'mapping to a batch: recipe_not_plate');
select is(pg_temp.up(pg_temp.item_id('spez'), '{"recipeKey":"ec000000-0000-4000-8000-0000000000e3"}'), 'P0001 recipe_inactive', 'mapping to a deactivated plate: recipe_inactive');
select is(pg_temp.up(pg_temp.item_id('spez'), '{"recipeKey":"ec000000-0000-4000-8000-0000000000e4"}'), 'P0002 recipe_not_found', 'mapping to tenant B''s plate: recipe_not_found');
select pg_temp.update_as('re', pg_temp.item_id('spez'), '{"recipeKey":"ec000000-0000-4000-8000-0000000000e2"}');
select is((select (j -> 'item' ->> 'unmapped')::boolean from res where k = 're'), false, 'mapping to the plate again');
-- A recipe deactivated later keeps the mapping and does not block other changes.
update public.recipe_key set is_active = false where id = 'ec000000-0000-4000-8000-0000000000e2';
select pg_temp.update_as('keep', pg_temp.item_id('spez'), '{"recipeKey":"ec000000-0000-4000-8000-0000000000e2","position":4}');
select is((select (j ->> 'changed')::boolean from res where k = 'keep'), true, 'an unchanged mapping to a deactivated recipe is not re-validated');
update public.recipe_key set is_active = true where id = 'ec000000-0000-4000-8000-0000000000e2';

-- Deactivate and reactivate.
select pg_temp.update_as('off', pg_temp.item_id('acqua'), '{"active":false}');
select is((select is_active from public.menu_item where id = pg_temp.item_id('acqua')), false, 'active false deactivates (the row stays)');
select is(pg_temp.mk('{"name":"Acqua (demo)","category":"Bevande","course":"bevande","recipeKey":null,"price":2.5,"vatRate":10}'), 'ok',
  'a new item with the name of an inactive one is accepted');
select is(pg_temp.up(pg_temp.item_id('acqua'), '{"active":true}'), 'P0001 menu_item_name_taken', 'reactivating the first: menu_item_name_taken');
select pg_temp.update_as('off2', pg_temp.item_id('spez'), '{"active":false}');
select pg_temp.create_as('spez2', '{"name":"Spezzatino bis (demo)","category":"Secondi","course":"secondi","recipeKey":"ec000000-0000-4000-8000-0000000000e2","price":14,"vatRate":10}');
select is(pg_temp.up(pg_temp.item_id('spez'), '{"active":true}'), 'P0001 recipe_already_on_menu', 'reactivating while another active item maps the recipe: recipe_already_on_menu');
select is(pg_temp.up(pg_temp.item_id('spez'), '{"name":"Altro nome (demo)"}'), 'ok', 'an inactive item can be renamed');

-- Update errors.
select is(pg_temp.up(pg_temp.item_id('spez2'), '{}'), '22023 invalid_request', 'an empty patch: invalid_request');
select is(pg_temp.up(pg_temp.item_id('spez2'), '{"pushUntil":"2026-11-01T10:00:00Z"}'), '22023 invalid_request', 'a push key: invalid_request');
select is(pg_temp.up(pg_temp.item_id('spez2'), '{"pushPrice":5}'), '22023 invalid_request', 'pushPrice: invalid_request');
select is(pg_temp.up(pg_temp.item_id('spez2'), '{"price":14.005}'), 'P0001 price_invalid', 'price 14,005: price_invalid');
select is(pg_temp.up(pg_temp.item_id('spez2'), '{"vatRate":12}'), 'P0001 vat_rate_invalid', 'VAT 12: vat_rate_invalid');
select is(pg_temp.up(pg_temp.item_id('spez2'), '{"active":"no"}'), '22023 invalid_request', 'a non-boolean active: invalid_request');
select is(pg_temp.up('99999999-9999-4999-8999-999999999999', '{"price":1}'), 'P0002 menu_item_not_found', 'an unknown item: menu_item_not_found');
select is(pg_temp.err($$select public.update_menu_item(null, '{"price":1}'::jsonb)$$), 'P0002 menu_item_not_found', 'a null item id: menu_item_not_found');

-- ----------------------------------------------------------------------------------------------------------------
-- Roles and tenants.
create temp table before_counts as
  select (select count(*) from public.menu_item) i, (select count(*) from public.menu_item_price) p, (select count(*) from public.audit_event) a;
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is(pg_temp.mk('{"name":"Admin piatto (demo)","category":"Bevande","course":"bevande","recipeKey":null,"price":3,"vatRate":10}'), 'ok', 'admin can create');
select is(pg_temp.up(pg_temp.item_id('spez2'), '{"price":15}'), 'ok', 'admin can update');
select is((select created_by from public.audit_event where after ->> 'name' = 'Admin piatto (demo)'), 'f1000000-0000-4000-8000-00000000000f'::uuid, 'the audit row names the admin');
insert into before_counts select (select count(*) from public.menu_item), (select count(*) from public.menu_item_price), (select count(*) from public.audit_event);
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.mk('{"name":"Chef piatto (demo)","category":"Bevande","course":"bevande","recipeKey":null,"price":3,"vatRate":10}'), '42501 permission denied: the menu and table settings need owner or admin', 'chef cannot create');
select is(pg_temp.up(pg_temp.item_id('spez2'), '{"price":20}'), '42501 permission denied: the menu and table settings need owner or admin', 'chef cannot update');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(pg_temp.mk('{"name":"Cameriere piatto (demo)","category":"Bevande","course":"bevande","recipeKey":null,"price":3,"vatRate":10}'), '42501 permission denied: the menu and table settings need owner or admin', 'waiter cannot create');
select is(pg_temp.up(pg_temp.item_id('spez2'), '{"price":20}'), '42501 permission denied: the menu and table settings need owner or admin', 'waiter cannot update');
select is(pg_temp.mk('{}'), '42501 permission denied: the menu and table settings need owner or admin', 'the role is checked before the body');
select is((select (select count(*) from public.menu_item) = i and (select count(*) from public.menu_item_price) = p
                  and (select count(*) from public.audit_event) = a from (select * from before_counts order by i desc limit 1) b), true,
  'nothing was written by chef or waiter');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(pg_temp.up(pg_temp.item_id('spez2'), '{"price":20}'), 'P0002 menu_item_not_found', 'tenant B''s owner cannot update A''s item');
select is(pg_temp.mk('{"name":"Acqua (demo)","category":"Bevande","course":"bevande","recipeKey":null,"price":2,"vatRate":10}'), 'ok', 'tenant B may use the same name');
select is((select tenant_id from public.menu_item where name = 'Acqua (demo)' and tenant_id = '22222222-2222-4222-8222-222222222222'),
  '22222222-2222-4222-8222-222222222222'::uuid, 'and the item belongs to tenant B');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.mk('{"name":"Piatto B (demo)","category":"Bevande","course":"bevande","recipeKey":"ec000000-0000-4000-8000-0000000000e4","price":2,"vatRate":10}'), 'P0002 recipe_not_found', 'A cannot map B''s recipe');

-- Privileges and definition.
select is((select count(*)::int from unnest(array['anon', 'authenticated']) r, unnest(array['public.create_menu_item(jsonb)', 'public.update_menu_item(uuid, jsonb)']) f
            where has_function_privilege(r, f, 'execute')), 2, 'only authenticated executes the two procedures (anon does not)');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('create_menu_item', 'update_menu_item')
              and p.prosecdef and p.proconfig = array['search_path=""']), 2, 'both are security definer with an empty search_path');
select is(has_function_privilege('service_role', 'public.create_menu_item(jsonb)', 'execute'), false, 'service_role does not execute them');

select * from finish();
rollback;
