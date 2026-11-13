-- P2-0b A6 (sell by weight, plan §3.6, §5 A6, AT-W8): no cost reaches a waiter. As the waiter of tenant A, every reply that carries a weighted line (menu_list, order_view, the
-- add and update replies, the bill plain and split both ways, apply_op) is scanned at any depth for a key matching cost|margin|food|gp|vat|recipe; the chef cannot call the
-- waiter reads; the waiter reads no row of order_line_cost, menu_item_price or sale_settings. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test');
insert into public.tenant (id, name, vat_number, settings) values ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000', '{"sale_vat_pct": 10}');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('13000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Tavolo 1 (demo)', 1, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, coperto_amount, coperto_vat_rate, created_by, updated_by) values
  ('14000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000001', 'Tavolo 1 (demo)', 4,
   'd1000000-0000-4000-8000-00000000000d', app.business_date('11111111-1111-4111-8111-111111111111', now()), 2.00, 10,
   'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d');

create function pg_temp.act_as(auth_id uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', auth_id, 'role', 'authenticated', 'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', app_role, 'aal', case when app_role = 'admin' then 'aal2' else 'aal1' end)::text, true) $$;
create function pg_temp.as_owner() returns void language sql as $$ select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', 'owner') $$;
create function pg_temp.as_waiter() returns void language sql as $$ select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', 'waiter') $$;
create function pg_temp.as_chef() returns void language sql as $$ select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', 'chef') $$;
create function pg_temp.ts() returns text language sql as $$ select to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') $$;
create function pg_temp.lid(n int) returns uuid language sql immutable as $$ select ('e3000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create temp table ids (k text primary key, id uuid);
grant all on ids to public;
create function pg_temp.id(k text) returns uuid language sql as $$ select id from ids where ids.k = $1 $$;
create function pg_temp.sess() returns uuid language sql as $$ select '14000000-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare
  state text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate;
  return state;
end
$$;
-- The keys, at any depth, of a JSON value that match the cost-like regex of the plan (§3.6).
create function pg_temp.bad_keys(j jsonb) returns text[] language sql as $$
  select coalesce(array_agg(distinct k), '{}') from jsonb_path_query(j, 'strict $.**') v,
    lateral jsonb_object_keys(case when jsonb_typeof(v) = 'object' then v else '{}'::jsonb end) k
   where k ~* 'cost|margin|food|gp|vat|recipe' $$;
create function pg_temp.keys_n(j jsonb) returns int language sql as $$
  select count(*)::int from jsonb_path_query(j, 'strict $.**') v, lateral jsonb_object_keys(case when jsonb_typeof(v) = 'object' then v else '{}'::jsonb end) k $$;
create function pg_temp.op(p_kind text, p_payload jsonb) returns jsonb language sql as $$
  select jsonb_build_object('opId', gen_random_uuid(), 'seq', 1, 'kind', p_kind, 'clientTs', pg_temp.ts(), 'userId', 'd1000000-0000-4000-8000-00000000000d', 'payload', p_payload) $$;

-- Owner: a weighted dish mapped to a plate with a cost (so a cost exists to leak), a portion dish, a push price on the weighted dish, the weight setting.
select pg_temp.as_owner();
insert into public.ingredient (id, tenant_id, name, base_unit, is_stock) values ('a3000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Salsa (demo)', 'kg', false);
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e2', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'piatto bistecca (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by) values
  ('ed000000-0000-4000-8000-0000000000d2', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e2', 1, now() - interval '5 days', 'Piatto bistecca (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, qty, unit, yield_factor, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d2', 1, 'a3000000-0000-4000-8000-000000000001', 20, 'g', 1, 'a1000000-0000-4000-8000-00000000000a');
insert into ids select 'bist', (public.create_menu_item('{"name":"Bistecca a peso (demo)","category":"Secondi","course":"secondi","recipeKey":"ec000000-0000-4000-8000-0000000000e2","price":4.25,"vatRate":10,"priceUnit":"etto","portionWeightG":400}'::jsonb) -> 'item' ->> 'id')::uuid;
insert into ids select 'tag', (public.create_menu_item('{"name":"Tagliatelle (demo)","category":"Primi","course":"primi","recipeKey":null,"price":14,"vatRate":10}'::jsonb) -> 'item' ->> 'id')::uuid;
select is((public.set_weight_settings('{"weightMaxG":4000}'::jsonb) ->> 'weightMaxG'), '4000', 'the owner sets the maximum weight (a sale_settings row exists now)');

select pg_temp.as_waiter();
create temporary table rp (k text primary key, j jsonb);
grant all on rp to public;
insert into rp select 'add', public.add_order_line(pg_temp.sess(), jsonb_build_object('lineId', pg_temp.lid(1), 'menuItemId', pg_temp.id('bist'), 'clientUpdatedAt', pg_temp.ts(), 'weightG', 1230));
insert into rp select 'upd', public.update_order_line(pg_temp.lid(1), jsonb_build_object('clientUpdatedAt', pg_temp.ts(), 'weightG', 1240));
insert into rp select 'add2', public.add_order_line(pg_temp.sess(), jsonb_build_object('lineId', pg_temp.lid(2), 'menuItemId', pg_temp.id('tag'), 'clientUpdatedAt', pg_temp.ts(), 'qty', 1));
insert into rp select 'menu', public.menu_list();
insert into rp select 'view', public.order_view(pg_temp.sess());
insert into rp select 'bill', public.session_bill(pg_temp.sess(), null);
insert into rp select 'billc', public.session_bill(pg_temp.sess(), '{"mode":"covers","parts":2}');
insert into rp select 'billi', public.session_bill(pg_temp.sess(), jsonb_build_object('mode', 'items', 'groups', jsonb_build_array(
  jsonb_build_object('lineIds', jsonb_build_array(pg_temp.lid(1)), 'covers', 2), jsonb_build_object('lineIds', jsonb_build_array(pg_temp.lid(2)), 'covers', 2)), 'sharedLineIds', jsonb_build_array()));
insert into rp select 'op', public.apply_op(pg_temp.op('add_line', jsonb_build_object('sessionId', pg_temp.sess(), 'lineId', pg_temp.lid(3), 'menuItemId', pg_temp.id('bist'), 'weightG', 500)));

select is((select j -> 'line' ->> 'weightG' from rp where k = 'add'), '1230', 'the add reply carries the weight');
select is((select j -> 'line' ->> 'unitPrice' from rp where k = 'upd'), '52.7', 'the update reply carries the new line price (1 240 g at 4,25 = 52,70)');
select is((select j ->> 'status' from rp where k = 'op'), 'applied', 'the apply_op reply for a weighted add_line is applied');
select is((select (j ->> 'weightMaxG') from rp where k = 'menu'), '4000', 'the menu reply carries weightMaxG');
select is((select pg_temp.bad_keys(j) from rp where k = 'add'), '{}'::text[], 'add_order_line reply: no cost-like key');
select is((select pg_temp.bad_keys(j) from rp where k = 'upd'), '{}'::text[], 'update_order_line reply: no cost-like key');
select is((select pg_temp.bad_keys(j) from rp where k = 'menu'), '{}'::text[], 'menu_list: no cost-like key');
select is((select pg_temp.bad_keys(j) from rp where k = 'view'), '{}'::text[], 'order_view: no cost-like key');
select is((select pg_temp.bad_keys(j) from rp where k = 'bill'), '{}'::text[], 'session_bill: no cost-like key');
select is((select pg_temp.bad_keys(j) from rp where k = 'billc'), '{}'::text[], 'session_bill split by covers: no cost-like key');
select is((select pg_temp.bad_keys(j) from rp where k = 'billi'), '{}'::text[], 'session_bill split by items: no cost-like key');
select is((select pg_temp.bad_keys(j) from rp where k = 'op'), '{}'::text[], 'apply_op reply: no cost-like key');
select ok((select min(pg_temp.keys_n(j)) from rp) > 0, 'the scan walked real keys (every reply has some)');

-- The chef ----------------------------------------------------------------------------------------------------------------------------------
select pg_temp.as_chef();
select is(pg_temp.err('select public.menu_list()'), '42501', 'the chef cannot call menu_list');
select is(pg_temp.err('select public.order_view(pg_temp.sess())'), '42501', 'the chef cannot call order_view');

-- Tables the waiter must not read -----------------------------------------------------------------------------------------------------------
select pg_temp.as_waiter();
select public.fire_course(pg_temp.sess(), jsonb_build_object('lineIds', jsonb_build_array(pg_temp.lid(1))));
select pg_temp.as_owner();
set local role authenticated;
select ok((select count(*) from public.order_line_cost) > 0 and (select count(*) from public.menu_item_price) > 0 and (select count(*) from public.sale_settings) > 0,
  'the owner reads rows of order_line_cost, menu_item_price and sale_settings (so the zero below means something)');
reset role;
select pg_temp.as_waiter();
set local role authenticated;
select is((select count(*)::int from public.order_line_cost), 0, 'the waiter reads no order_line_cost row');
select is((select count(*)::int from public.menu_item_price), 0, 'the waiter reads no menu_item_price row');
select is((select count(*)::int from public.sale_settings), 0, 'the waiter reads no sale_settings row');
reset role;

select * from finish();
rollback;
