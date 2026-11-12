-- P2-0b A3 (sell by weight, plan §3.3, §5 A3): weightG on add_order_line and update_order_line, the price per etto frozen at entry (L-1), the line
-- price from the one rounding function, the maximum weight from the tenant's setting, order_line_json, and the offline op payload keys.
-- Owner sets the menu and the setting, the waiter orders. Fake data only; lines found by id.
begin;
create extension if not exists pgtap with schema extensions;
select plan(79);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('e0000000-0000-4000-8000-00000000000e', 'waiter-b@example.test');
insert into public.tenant (id, name, vat_number, settings) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000', '{"sale_vat_pct": 10}'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115', '{"sale_vat_pct": 22}');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('e1000000-0000-4000-8000-00000000000e', '22222222-2222-4222-8222-222222222222', 'e0000000-0000-4000-8000-00000000000e', 'waiter', 'Cameriere B Demo');
-- A batch plate with no live batch: its items are sold out (used for the availability cases).
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'brasato (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e2', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'brasato con polenta (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch, shelf_life_hours, created_by) values
  ('ed000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e1', 1, now() - interval '5 days', 'Brasato (demo)', 2, 'kg', 10, 48, 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by) values
  ('ed000000-0000-4000-8000-0000000000d2', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e2', 1, now() - interval '5 days', 'Brasato con polenta (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe_line (tenant_id, recipe_id, position, sub_recipe_key, qty, unit, yield_factor, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d2', 1, 'ec000000-0000-4000-8000-0000000000e1', 1, 'porz', 1, 'a1000000-0000-4000-8000-00000000000a');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('13000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Tavolo 1 (demo)', 1, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('13000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Tavolo B (demo)', 1, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, created_by, updated_by) values
  ('14000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000001', 'Tavolo 1 (demo)', 4,
   'a1000000-0000-4000-8000-00000000000a', '1998-10-24', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('14000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', '13000000-0000-4000-8000-0000000000b1', 'Tavolo B (demo)', 2,
   'b1000000-0000-4000-8000-00000000000b', '1998-10-24', 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');

create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true) $$;
create function pg_temp.as_owner() returns void language sql as $$ select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner') $$;
create function pg_temp.as_waiter() returns void language sql as $$ select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter') $$;
create function pg_temp.as_owner_b() returns void language sql as $$ select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner') $$;
create function pg_temp.as_waiter_b() returns void language sql as $$ select pg_temp.act_as('e0000000-0000-4000-8000-00000000000e', '22222222-2222-4222-8222-222222222222', 'waiter') $$;
create function pg_temp.ts(p_ago numeric default 0) returns text language sql as $$
  select to_char((clock_timestamp() - make_interval(secs => p_ago)) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') $$;
create function pg_temp.line_id(n int) returns uuid language sql immutable as $$ select ('e3000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create temp table ids (k text primary key, id uuid);
create temp table res (k text primary key, j jsonb);
grant all on ids, res to public;
create function pg_temp.id(k text) returns uuid language sql as $$ select id from ids where ids.k = $1 $$;
-- A call that stores its reply under k and answers 'ok' or 'SQLSTATE message'.
create function pg_temp.call(p_k text, p_stmt text) returns text language plpgsql as $$
declare
  v jsonb;
  state text;
  msg text;
begin
  execute p_stmt into v;
  insert into res values (p_k, v) on conflict (k) do update set j = excluded.j;
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text;
  return state || ' ' || msg;
end
$$;
create function pg_temp.add(p_k text, p_session text, p_line int, p_item text, p_extra text default '') returns text language sql as $$
  select pg_temp.call(p_k, format($f$ select public.add_order_line(%L, %L::jsonb) $f$, p_session,
    '{"lineId":"' || pg_temp.line_id(p_line) || '","menuItemId":"' || pg_temp.id(p_item) || '","clientUpdatedAt":"' || pg_temp.ts() || '"' || p_extra || '}')) $$;
create function pg_temp.upd(p_k text, p_line int, p_fields text, p_ts text default null) returns text language sql as $$
  select pg_temp.call(p_k, format($f$ select public.update_order_line(%L, %L::jsonb) $f$, pg_temp.line_id(p_line),
    '{"clientUpdatedAt":"' || coalesce(p_ts, pg_temp.ts()) || '",' || p_fields || '}')) $$;
create function pg_temp.row_of(n int) returns text language sql as $$
  select coalesce(weight_g::text, '-') || '/' || coalesce(price_per_100g::text, '-') || '/' || coalesce(portion_weight_g::text, '-') || '/' || qty || '/' || unit_price || '/' || price_source
    from public.order_line where id = pg_temp.line_id(n) $$;
create function pg_temp.lines() returns int language sql as $$ select count(*)::int from public.order_line $$;

-- Menu (owner A): a weighted dish, a portion dish, a sold-out weighted dish (its batch plate has no live batch); owner B: a weighted dish.
select pg_temp.as_owner();
insert into ids select 'w1', (public.create_menu_item('{"name":"Bistecca a peso (demo)","category":"Secondi","course":"secondi","recipeKey":null,"price":5.5,"vatRate":10,"priceUnit":"etto","portionWeightG":400}'::jsonb) -> 'item' ->> 'id')::uuid;
insert into ids select 'p1', (public.create_menu_item('{"name":"Tagliatelle (demo)","category":"Primi","course":"primi","recipeKey":null,"price":14,"vatRate":10}'::jsonb) -> 'item' ->> 'id')::uuid;
insert into ids select 'w2', (public.create_menu_item('{"name":"Brasato a peso (demo)","category":"Secondi","course":"secondi","recipeKey":"ec000000-0000-4000-8000-0000000000e2","price":5.5,"vatRate":10,"priceUnit":"etto","portionWeightG":400}'::jsonb) -> 'item' ->> 'id')::uuid;
select pg_temp.as_owner_b();
insert into ids select 'wb', (public.create_menu_item('{"name":"Bistecca B a peso (demo)","category":"Secondi","course":"secondi","recipeKey":null,"price":4,"vatRate":22,"priceUnit":"etto","portionWeightG":300}'::jsonb) -> 'item' ->> 'id')::uuid;

-- Add: the weighted line ----------------------------------------------------------------------------------------------------------------
select pg_temp.as_waiter();
select is(pg_temp.add('a1', '14000000-0000-4000-8000-000000000001', 1, 'w1', ',"weightG":1200'), 'ok', 'add: 1200 g of the weighted dish');
select is((select (j ->> 'created') || '/' || (j -> 'line' ->> 'qty') || '/' || (j -> 'line' ->> 'weightG') || '/' || (j -> 'line' ->> 'pricePer100g') || '/' || (j -> 'line' ->> 'unitPrice') from res where k = 'a1'),
  'true/1/1200/5.5/66', 'the reply: qty 1, weightG 1200, pricePer100g 5.5, unitPrice 66');
select is(pg_temp.row_of(1), '1200/5.50/400/1.0/66.00/menu', 'the row: weight, per-etto price and reference weight frozen, the line price in unit_price');
select is(pg_temp.add('a2', '14000000-0000-4000-8000-000000000001', 2, 'w1'), 'P0001 weight_required', 'add: a weighted dish without weightG is refused');
select is(pg_temp.add('a3', '14000000-0000-4000-8000-000000000001', 3, 'p1', ',"weightG":1200'), 'P0001 weight_not_allowed', 'add: weightG on a portion dish is refused');
select is(pg_temp.add('a4', '14000000-0000-4000-8000-000000000001', 4, 'w1', ',"weightG":1200,"qty":2'), 'P0001 qty_invalid', 'add: a weight with qty 2 is refused');
select is(pg_temp.add('a4b', '14000000-0000-4000-8000-000000000001', 5, 'w1', ',"weightG":1200,"qty":1'), 'ok', 'add: a weight with qty 1 is accepted');
select is(pg_temp.add('a5', '14000000-0000-4000-8000-000000000001', 6, 'w1', ',"weightG":40'), 'P0001 weight_invalid', 'add: 40 g is below the minimum');
select is(pg_temp.add('a6', '14000000-0000-4000-8000-000000000001', 7, 'w1', ',"weightG":3010'), 'P0001 weight_invalid', 'add: 3 010 g is above the default maximum');
select is(pg_temp.add('a7', '14000000-0000-4000-8000-000000000001', 8, 'w1', ',"weightG":1205'), 'P0001 weight_invalid', 'add: 1 205 g is off the 10 g step');
select is(pg_temp.add('a8', '14000000-0000-4000-8000-000000000001', 9, 'w1', ',"weightG":1200.5'), 'P0001 weight_invalid', 'add: 1200.5 g is refused');
select is(pg_temp.add('a9', '14000000-0000-4000-8000-000000000001', 10, 'w1', ',"weightG":"1200"'), '22023 invalid_request', 'add: a string weight is invalid_request');
select is(pg_temp.add('a10', '14000000-0000-4000-8000-000000000001', 11, 'w1', ',"weightG":50'), 'ok', 'add: 50 g, the minimum, is accepted');
select is(pg_temp.add('a11', '14000000-0000-4000-8000-000000000001', 12, 'w1', ',"weightG":3000'), 'ok', 'add: 3 000 g, the default maximum, is accepted');
select is(pg_temp.add('a12', '14000000-0000-4000-8000-000000000001', 13, 'p1'), 'ok', 'add: a portion dish without a weight is unchanged');
select is(pg_temp.row_of(13), '-/-/-/1.0/14.00/menu', 'and its row carries no weight column');
-- Replay.
select is((select count(*)::int from public.order_line), 5, 'five lines so far');
select is(pg_temp.call('r1', format($f$ select public.add_order_line('14000000-0000-4000-8000-000000000001', %L::jsonb) $f$,
  '{"lineId":"' || pg_temp.line_id(1) || '","menuItemId":"' || pg_temp.id('w1') || '","clientUpdatedAt":"' || pg_temp.ts() || '","weightG":1200}')), 'ok', 'a replay with the same lineId');
select is((select (j ->> 'created') || '/' || (j -> 'line' ->> 'weightG') from res where k = 'r1'), 'false/1200', 'is answered created false with the stored line');
select is(pg_temp.lines(), 5, 'and nothing was written');
-- Sold out.
select is(pg_temp.add('so', '14000000-0000-4000-8000-000000000001', 20, 'w2', ',"weightG":1200'), 'P0001 item_unavailable', 'add: a sold-out weighted dish (no portions) is item_unavailable as today');

-- The maximum follows the setting (P-4) ----------------------------------------------------------------------------------------------------
select pg_temp.as_owner();
select is((select public.set_weight_settings('{"weightMaxG":4000}'::jsonb) ->> 'weightMaxG'), '4000', 'the owner raises the maximum to 4000');
select pg_temp.as_waiter();
select is(pg_temp.add('m1', '14000000-0000-4000-8000-000000000001', 21, 'w1', ',"weightG":4000'), 'ok', 'add: 4 000 g is accepted now');
select is(pg_temp.add('m2', '14000000-0000-4000-8000-000000000001', 22, 'w1', ',"weightG":4010'), 'P0001 weight_invalid', 'add: 4 010 g is still refused');
select pg_temp.as_owner();
select is((select public.set_weight_settings('{"weightMaxG":1000}'::jsonb) ->> 'weightMaxG'), '1000', 'the owner lowers the maximum to 1000');
select pg_temp.as_waiter();
select is(pg_temp.row_of(1), '1200/5.50/400/1.0/66.00/menu', 'the existing 1200 g draft keeps its weight');
select is(pg_temp.upd('n1', 1, '"note":"ben cotta"'), 'ok', 'and accepts a note edit above the lowered maximum');
select is((select j -> 'line' ->> 'weightG' from res where k = 'n1'), '1200', 'with its weight untouched');
select is(pg_temp.upd('n2', 1, '"weightG":1100'), 'P0001 weight_invalid', 'but a weight edit to 1 100 g is weight_invalid');
select is(pg_temp.upd('n3', 1, '"weightG":1000'), 'ok', 'and 1 000 g is accepted');
select pg_temp.as_waiter_b();
select is(pg_temp.add('b1', '14000000-0000-4000-8000-0000000000b1', 23, 'wb', ',"weightG":3000'), 'ok', 'tenant B still accepts 3 000 g');
select pg_temp.as_owner();
select is((select public.set_weight_settings('{"weightMaxG":null}'::jsonb) ->> 'weightMaxG'), '3000', 'back to the default 3000');
select pg_temp.as_waiter();

-- Push (P-7) and the freeze at add (L-1) ------------------------------------------------------------------------------------------------------
select pg_temp.as_owner();
select is((select public.push_menu_item((select id from ids where k = 'w1'), '{"pushed":true,"pushPrice":4.5}'::jsonb) ->> 'changed'), 'true', 'the owner pushes the weighted dish at 4,50 per etto');
select pg_temp.as_waiter();
select is(pg_temp.add('pu', '14000000-0000-4000-8000-000000000001', 24, 'w1', ',"weightG":1200'), 'ok', 'add during the push');
select is(pg_temp.row_of(24), '1200/4.50/400/1.0/54.00/push', 'pricePer100g 4.5, unitPrice 54, price_source push');
select pg_temp.as_owner();
select is((select public.push_menu_item((select id from ids where k = 'w1'), '{"pushed":false}'::jsonb) ->> 'changed'), 'true', 'the push ends');
select is((select public.update_menu_item((select id from ids where k = 'w1'), '{"price":6,"portionWeightG":500}'::jsonb) ->> 'changed'), 'true', 'the owner changes the price to 6,00 and the reference weight to 500 g');
select pg_temp.as_waiter();
select is(pg_temp.row_of(1), '1000/5.50/400/1.0/55.00/menu', 'the earlier line keeps 5,50 and 400 g (frozen at add, L-1)');
select is(pg_temp.add('fz', '14000000-0000-4000-8000-000000000001', 25, 'w1', ',"weightG":1000'), 'ok', 'a new line');
select is(pg_temp.row_of(25), '1000/6.00/500/1.0/60.00/menu', 'takes the new 6,00 and 500 g');

-- Update ------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.upd('u1', 1, '"weightG":1300'), 'ok', 'update: weightG 1300 on the draft');
select is((select (j ->> 'changed') || '/' || (j -> 'line' ->> 'weightG') || '/' || (j -> 'line' ->> 'unitPrice') from res where k = 'u1'), 'true/1300/71.5', 'changed, the line price follows the weight (71,50)');
select is(pg_temp.row_of(1), '1300/5.50/400/1.0/71.50/menu', 'the row: the new weight and price, the frozen per-etto price and reference weight');
select is(pg_temp.upd('u2', 1, '"weightG":1300', (select to_char(client_updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') from public.order_line where id = pg_temp.line_id(1))), 'ok',
  'update: the same weight by the same caller at the same stamp');
select is((select j ->> 'changed' from res where k = 'u2'), 'false', 'is a replay: changed false');
select is(pg_temp.upd('u3', 1, '"qty":2'), 'P0001 qty_invalid', 'update: qty on a weighted line is qty_invalid');
select is(pg_temp.upd('u4', 13, '"weightG":500'), 'P0001 weight_not_allowed', 'update: weightG on a portion line is weight_not_allowed');
select is(pg_temp.upd('u5', 1, '"weightG":1305'), 'P0001 weight_invalid', 'update: 1 305 g is off the step');
select is(pg_temp.upd('u6', 1, '"weightG":"1300"'), '22023 invalid_request', 'update: a string weight is invalid_request');
select is(pg_temp.upd('u7', 13, '"note":"senza sale"'), 'ok', 'update: a portion line still edits as before');
-- A weight increase re-checks availability; a decrease never does. The sold-out line is inserted directly (its dish has no portions).
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, weight_g, price_per_100g, portion_weight_g, created_by, updated_by)
  values (pg_temp.line_id(30), '11111111-1111-4111-8111-111111111111', '14000000-0000-4000-8000-000000000001', pg_temp.id('w2'), 'secondi', 1, 66.00, 10, 'menu', now() - interval '1 hour',
          1200, 5.50, 400, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d');
select is(pg_temp.upd('u8', 30, '"weightG":1300'), 'P0001 item_unavailable', 'update: a weight increase with 0 portions left is item_unavailable');
select is(pg_temp.upd('u9', 30, '"weightG":1100'), 'ok', 'update: a decrease never checks stock');
select is(pg_temp.row_of(30), '1100/5.50/400/1.0/60.50/menu', 'and the line price follows (60,50)');
-- Fired and removed lines.
update public.order_line set fired_at = now(), fired_by = 'd1000000-0000-4000-8000-00000000000d' where id = pg_temp.line_id(5);
select is(pg_temp.upd('u10', 5, '"weightG":900'), 'ok', 'update on a fired weighted line is not an error');
select is((select j -> 'conflict' ->> 'reason' from res where k = 'u10'), 'fired', 'it answers conflict fired');
select is(pg_temp.row_of(5), '1200/5.50/400/1.0/66.00/menu', 'and the weight did not change');
select is(pg_temp.call('rm', format($f$ select public.remove_order_line(%L, %L::jsonb) $f$, pg_temp.line_id(21), '{"clientUpdatedAt":"' || pg_temp.ts() || '"}')), 'ok', 'remove: a weighted draft is removed (voided entry_removed)');
select is((select state || '/' || void_reason || '/' || unit_price from public.order_line where id = pg_temp.line_id(21)), 'voided/entry_removed/220.00', 'nothing deleted, the price kept');
select is((select count(*)::int from public.batch_movement), 0, 'and it moved no stock');

-- order_line_json -----------------------------------------------------------------------------------------------------------------------
select is((select array_agg(kk.key order by kk.key collate "C") from res r, jsonb_object_keys(r.j -> 'line') as kk (key) where r.k = 'u7'),
  array['clientUpdatedAt', 'course', 'id', 'isShared', 'menuItemId', 'name', 'note', 'pricePer100g', 'qty', 'segue', 'state', 'unitPrice', 'updatedAt', 'updatedBy', 'weightG'],
  'the line JSON keys are the M18 set plus weightG and pricePer100g');
select is((select jsonb_typeof(j -> 'line' -> 'weightG') || '/' || jsonb_typeof(j -> 'line' -> 'pricePer100g') from res where k = 'u7'), 'null/null', 'both are null on a portion line');

-- apply_op (offline) -----------------------------------------------------------------------------------------------------------------------
create function pg_temp.op(p_kind text, p_payload jsonb, p_seq int default 1) returns jsonb language sql as $$
  select jsonb_build_object('opId', gen_random_uuid(), 'seq', p_seq, 'kind', p_kind, 'clientTs', pg_temp.ts(), 'userId', 'd1000000-0000-4000-8000-00000000000d', 'payload', p_payload) $$;
create function pg_temp.addp(p_line int, p_item text, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('sessionId', '14000000-0000-4000-8000-000000000001', 'lineId', pg_temp.line_id(p_line), 'menuItemId', pg_temp.id(p_item)) || p_extra $$;
select is(pg_temp.call('o1', format($f$ select public.apply_op(%L::jsonb) $f$, pg_temp.op('add_line', pg_temp.addp(40, 'w1', '{"weightG":1200}')))), 'ok', 'apply_op: an add_line with weightG');
select is((select j ->> 'status' from res where k = 'o1'), 'applied', 'is applied');
select is(pg_temp.row_of(40), '1200/6.00/500/1.0/72.00/menu', 'with the weighted line stored (price 6,00 per etto now in force)');
select is(pg_temp.call('o2', format($f$ select public.apply_op(%L::jsonb) $f$, pg_temp.op('add_line', pg_temp.addp(41, 'p1', '{"qty":2}')))), 'ok', 'apply_op: an M20-shape add_line without weightG, portion dish');
select is((select j ->> 'status' from res where k = 'o2'), 'applied', 'is applied as before');
select is(pg_temp.row_of(41), '-/-/-/2.0/14.00/menu', 'with no weight column');
select is(pg_temp.call('o3', format($f$ select public.apply_op(%L::jsonb) $f$, pg_temp.op('add_line', pg_temp.addp(42, 'w1')))), 'ok', 'apply_op: the same op for a weighted dish');
select is((select (j ->> 'status') || '/' || (j ->> 'stop') || '/' || (j -> 'result' ->> 'message') from res where k = 'o3'), 'rejected/true/weight_required', 'is stored rejected weight_required with stop true');
select pg_temp.as_owner();
select is((select public.set_weight_settings('{"weightMaxG":1000}'::jsonb) ->> 'weightMaxG'), '1000', 'the maximum is lowered after the op was queued');
select pg_temp.as_waiter();
select is(pg_temp.call('o4', format($f$ select public.apply_op(%L::jsonb) $f$, pg_temp.op('add_line', pg_temp.addp(43, 'w1', '{"weightG":2000}')))), 'ok', 'apply_op: an add_line above the lowered maximum');
select is((select (j ->> 'status') || '/' || (j -> 'result' ->> 'message') from res where k = 'o4'), 'rejected/weight_invalid', 'is stored rejected weight_invalid');
select is(pg_temp.call('o5', format($f$ select public.apply_op(%L::jsonb) $f$, pg_temp.op('edit_line', jsonb_build_object('lineId', pg_temp.line_id(40), 'weightG', 900)))), 'ok', 'apply_op: an edit_line with weightG');
select is((select j ->> 'status' from res where k = 'o5'), 'applied', 'is applied');
select is(pg_temp.row_of(40), '900/6.00/500/1.0/54.00/menu', 'the weight and the price follow');
select is((select count(*)::int from public.applied_op), 5, 'five ops are stored so far');
select is(pg_temp.call('o6', format($f$ select public.apply_op(%L::jsonb) $f$, pg_temp.op('add_line', pg_temp.addp(44, 'w1', '{"weight":1200}')))), '22023 invalid_request', 'apply_op: an unknown key (weight) is invalid_request');
select is((select count(*)::int from public.applied_op), 5, 'and nothing was stored');
select is(pg_temp.call('o7', format($f$ select public.apply_op(%L::jsonb) $f$, pg_temp.op('edit_line', jsonb_build_object('lineId', pg_temp.line_id(40), 'weight', 900)))), '22023 invalid_request', 'apply_op: an edit_line with the wrong key is invalid_request');

select * from finish();
rollback;
