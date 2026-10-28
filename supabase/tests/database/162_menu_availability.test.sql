-- M18 step 3: menu_list with availability and the pinned list (plan §3.1.5, §3.1.7, §3.1.9; AT1, AT2, AT4 and the
-- waiter's no-cost rule). Stock and manual availability are combined; the pinned items are the active ones pushed now,
-- also listed in their category; the key sets are fixed and a recursive scan finds no cost key. Two live stew
-- batches (two locations) and an expired one, items found by id. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

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
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)'),
  ('10000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'Dispensa (demo)');
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'spezzatino (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e2', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'spezzatino con polenta (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch, shelf_life_hours, created_by) values
  ('ed000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e1', 1, now() - interval '5 days', 'Spezzatino (demo)', 2, 'kg', 10, 48, 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by) values
  ('ed000000-0000-4000-8000-0000000000d2', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e2', 1, now() - interval '5 days', 'Spezzatino con polenta (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe_line (tenant_id, recipe_id, position, sub_recipe_key, qty, unit, yield_factor, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d2', 1, 'ec000000-0000-4000-8000-0000000000e1', 1, 'porz', 1, 'a1000000-0000-4000-8000-00000000000a');

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
-- An item of a category list, found by id.
create function pg_temp.item_of(j jsonb, p_id uuid) returns jsonb language sql as $$
  select jsonb_path_query_first(j, '$.categories[*].items[*] ? (@.id == $id)', jsonb_build_object('id', p_id::text)) $$;
create function pg_temp.pinned_of(j jsonb, p_id uuid) returns jsonb language sql as $$
  select jsonb_path_query_first(j, '$.pinned[*] ? (@.id == $id)', jsonb_build_object('id', p_id::text)) $$;
create function pg_temp.mk(p_body text) returns uuid language sql as $$
  select (public.create_menu_item(p_body::jsonb) -> 'item' ->> 'id')::uuid $$;
create function pg_temp.mkbatch(p_id uuid, p_use_by timestamptz, p_loc uuid, p_portions int, p_seq int) returns void language plpgsql as $$
begin
  insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code,
      lot_seq, produced_at, produced_by, output_qty, output_unit, portions_computed, portions_initial,
      shelf_life_hours, use_by, state, location_id, created_by)
    values (p_id, '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e1',
      'ed000000-0000-4000-8000-0000000000d1', 1, '261023-LOT-' || p_seq, '2026-10-23', 'LOT', p_seq, p_use_by - interval '48 hours',
      'a1000000-0000-4000-8000-00000000000a', 2, 'kg', p_portions, p_portions, 48, p_use_by, 'fresh', p_loc,
      'a1000000-0000-4000-8000-00000000000a');
  insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', p_id, 'produce', p_portions, 'batch', p_id, '2026-10-23',
      'a1000000-0000-4000-8000-00000000000a');
end
$$;
create temp table ids (k text primary key, id uuid);

-- Tenant A items: the stew (mapped), water (unmapped), and three push candidates (all unmapped).
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
insert into ids values
  ('spez', pg_temp.mk('{"name":"Spezzatino con polenta (demo)","category":"Secondi","course":"secondi","recipeKey":"ec000000-0000-4000-8000-0000000000e2","price":14,"vatRate":10,"position":2}')),
  ('acqua', pg_temp.mk('{"name":"Acqua (demo)","category":"Bevande","course":"bevande","recipeKey":null,"price":2,"vatRate":10,"position":5}')),
  ('p1', pg_temp.mk('{"name":"Zuppa del giorno (demo)","category":"Primi","course":"primi","recipeKey":null,"price":9,"vatRate":10,"position":5}')),
  ('p2', pg_temp.mk('{"name":"Bruschetta (demo)","category":"Antipasti","course":"antipasti","recipeKey":null,"price":5,"vatRate":10,"position":0}')),
  ('p3', pg_temp.mk('{"name":"Tiramisù (demo)","category":"Dolci","course":"dolci","recipeKey":null,"price":6,"vatRate":10,"position":1}'));
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select pg_temp.mk('{"name":"Solo B (demo)","category":"Altro","course":"dolci","recipeKey":null,"price":3,"vatRate":22}');

-- AT1: no stew batch at all -> the stew is unavailable with 0 portions.
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
create temp table w (j jsonb);
insert into w select public.menu_list();
select is((select pg_temp.item_of(j, (select id from ids where k = 'spez')) ->> 'available' from w), 'false', 'AT1: the stew with no batch is not available');
select is((select pg_temp.item_of(j, (select id from ids where k = 'spez')) ->> 'unavailableReason' from w), 'no_portions', 'AT1: the reason is no_portions');
select is((select pg_temp.item_of(j, (select id from ids where k = 'spez')) ->> 'portionsLeft' from w), '0', 'AT1: portionsLeft is 0');
select is((select pg_temp.item_of(j, (select id from ids where k = 'spez')) ->> 'lowStock' from w), 'false', 'AT1: 0 portions is not low stock (it is out)');

-- AT2: two live batches in two locations (1.5 + 1.5 = 3) and an expired one with 5 that must not count.
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000b1', now() + interval '2 days', '10000000-0000-4000-8000-0000000000a1', 2, 1);
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000b2', now() + interval '1 day', '10000000-0000-4000-8000-0000000000a2', 1, 2);
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000b3', now() - interval '1 hour', '10000000-0000-4000-8000-0000000000a1', 5, 3);
insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', 'ba000000-0000-4000-8000-0000000000b1', 'count', -0.5, 'batch_adjust', gen_random_uuid(), '2026-10-23', 'a1000000-0000-4000-8000-00000000000a'),
         ('11111111-1111-4111-8111-111111111111', 'ba000000-0000-4000-8000-0000000000b2', 'count', 0.5, 'batch_adjust', gen_random_uuid(), '2026-10-23', 'a1000000-0000-4000-8000-00000000000a');
delete from w;
insert into w select public.menu_list();
select is((select pg_temp.item_of(j, (select id from ids where k = 'spez')) ->> 'portionsLeft' from w), '3', 'AT2: 1.5 + 1.5 live portions (the expired batch is left out) = 3');
select is((select pg_temp.item_of(j, (select id from ids where k = 'spez')) ->> 'lowStock' from w), 'true', 'AT2: 3 portions is low stock');
select is((select pg_temp.item_of(j, (select id from ids where k = 'spez')) ->> 'available' from w), 'true', 'and the stew is available again');
select is((select pg_temp.item_of(j, (select id from ids where k = 'spez')) -> 'unavailableReason' from w), 'null'::jsonb, 'with no reason');
insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', 'ba000000-0000-4000-8000-0000000000b1', 'count', 1, 'batch_adjust', gen_random_uuid(), '2026-10-23', 'a1000000-0000-4000-8000-00000000000a');
delete from w;
insert into w select public.menu_list();
select is((select pg_temp.item_of(j, (select id from ids where k = 'spez')) ->> 'portionsLeft' from w), '4', 'AT2: 4 portions');
select is((select pg_temp.item_of(j, (select id from ids where k = 'spez')) ->> 'lowStock' from w), 'false', 'AT2: 4 portions is not low stock');
select is((select pg_temp.item_of(j, (select id from ids where k = 'acqua')) ->> 'available' || '/' || (pg_temp.item_of(j, (select id from ids where k = 'acqua')) -> 'portionsLeft')::text from w),
  'true/null', 'AT2: the unmapped water has portionsLeft null and is available');
select is((select pg_temp.item_of(j, (select id from ids where k = 'acqua')) ->> 'lowStock' from w), 'false', 'and is never low stock');

-- Manual "esaurito" combines with stock.
update public.menu_item set is_available = false where id = (select id from ids where k = 'acqua');
delete from w;
insert into w select public.menu_list();
select is((select pg_temp.item_of(j, (select id from ids where k = 'acqua')) ->> 'available' || '/' || (pg_temp.item_of(j, (select id from ids where k = 'acqua')) ->> 'unavailableReason') from w),
  'false/manual', 'a manually unavailable unmapped item: available false, reason manual');
update public.menu_item set is_available = true where id = (select id from ids where k = 'acqua');

-- AT4: P1 pushed 2 h (12 €, position 5), P2 pushed (position 0), P3 push ended a minute ago.
update public.menu_item set push_until = now() + interval '2 hours', push_price = 12 where id = (select id from ids where k = 'p1');
update public.menu_item set push_until = now() + interval '3 hours', push_price = 4.5 where id = (select id from ids where k = 'p2');
update public.menu_item set push_until = now() - interval '1 minute', push_price = 5 where id = (select id from ids where k = 'p3');
delete from w;
insert into w select public.menu_list();
select is((select array_agg((select k from ids where ids.id = (e ->> 'id')::uuid) order by ord)
             from w, jsonb_array_elements(j -> 'pinned') with ordinality x(e, ord)), array['p2', 'p1'],
  'AT4: pinned lists P2 (position 0) before P1 (position 5); the expired P3 is absent');
select is((select pg_temp.pinned_of(j, (select id from ids where k = 'p1')) ->> 'pushed' || '/' || (pg_temp.pinned_of(j, (select id from ids where k = 'p1')) ->> 'pushPrice') from w),
  'true/12', 'AT4: P1 in pinned is pushed with pushPrice 12');
select is((select pg_temp.pinned_of(j, (select id from ids where k = 'p2')) ->> 'pushPrice' from w), '4.5', 'AT4: P2 keeps its decimals');
select is((select pg_temp.pinned_of(j, (select id from ids where k = 'p3')) from w), null, 'AT4: P3 (push ended) is not pinned');
select is((select pg_temp.item_of(j, (select id from ids where k = 'p3')) ->> 'pushed' from w), 'false', 'AT4: P3 shows pushed false in its category');
select is((select pg_temp.item_of(j, (select id from ids where k = 'p1')) ->> 'pushed' from w), 'true', 'AT4: P1 also stays in its category');
select is((select (pg_temp.item_of(j, (select id from ids where k = 'p1')) = pg_temp.pinned_of(j, (select id from ids where k = 'p1')))::text from w), 'true',
  'a pinned item is the same object as in its category');
-- A pushed item at 0 portions stays pinned, greyed.
update public.menu_item set push_until = now() + interval '1 hour', push_price = 11 where id = (select id from ids where k = 'spez');
insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', 'ba000000-0000-4000-8000-0000000000b1', 'count', -2.5, 'batch_adjust', gen_random_uuid(), '2026-10-23', 'a1000000-0000-4000-8000-00000000000a'),
         ('11111111-1111-4111-8111-111111111111', 'ba000000-0000-4000-8000-0000000000b2', 'count', -1.5, 'batch_adjust', gen_random_uuid(), '2026-10-23', 'a1000000-0000-4000-8000-00000000000a');
delete from w;
insert into w select public.menu_list();
select is((select pg_temp.pinned_of(j, (select id from ids where k = 'spez')) ->> 'available' || '/' || (pg_temp.pinned_of(j, (select id from ids where k = 'spez')) ->> 'unavailableReason') from w),
  'false/no_portions', 'a pushed item with no portions stays pinned with available false');
select is((select jsonb_array_length(j -> 'pinned') from w), 3, 'three items are pinned now (P2, P1 and the stew)');
update public.menu_item set push_until = null, push_price = null where id = (select id from ids where k = 'spez');

-- Key sets and the no-cost scan.
select is((select array_agg(k order by k) from jsonb_object_keys((select j from w)) k), array['categories', 'pinned'], 'the top-level keys are {categories, pinned}');
select is((select array_agg(k order by k collate "C") from w, jsonb_object_keys(pg_temp.item_of(j, (select id from ids where k = 'spez'))) k),
  array['available', 'category', 'course', 'id', 'lowStock', 'name', 'portionsLeft', 'price', 'pushPrice', 'pushed', 'unavailableReason'],
  'an item has exactly the eleven service keys');
select is((select array_agg(k order by k collate "C") from w, jsonb_object_keys(pg_temp.pinned_of(j, (select id from ids where k = 'p1'))) k),
  array['available', 'category', 'course', 'id', 'lowStock', 'name', 'portionsLeft', 'price', 'pushPrice', 'pushed', 'unavailableReason'],
  'a pinned item has the same eleven keys');
select is((select count(*)::int from w, pg_temp.all_keys(j) k where k ~* 'cost|margin|gp|food|eur$|recipe|vat'), 0,
  'a recursive key scan finds no cost, margin, GP, food, eur, recipe or VAT key');

-- Roles and tenants.
select is(pg_temp.err('select public.menu_list()'), 'ok', 'waiter can read');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.err('select public.menu_list()'), '42501 permission denied: the service menu and tables need owner, admin or waiter', 'chef: 42501');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is(pg_temp.err('select public.menu_list()'), 'ok', 'admin can read');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is((select jsonb_array_length(public.menu_list() -> 'pinned')), 0, 'tenant B has nothing pinned (A''s pushes do not leak)');
select is((select public.menu_list() -> 'categories' -> 0 -> 'items' -> 0 ->> 'available'), 'true', 'tenant B''s unmapped item is available while A''s stew is out (two tenants differ)');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'menu_list'), 1, 'one menu_list exists (replaced, not overloaded)');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r where has_function_privilege(r, 'public.menu_list()', 'execute')), 1,
  'only authenticated executes menu_list');
select is((select count(*)::int from pg_proc p where p.proname = 'menu_list' and p.prosecdef and p.proconfig = array['search_path=""']), 1, 'menu_list is a definer with an empty search_path');

select * from finish();
rollback;
