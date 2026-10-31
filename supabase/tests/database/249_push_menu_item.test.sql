-- M23 step 2 (docs/plans/2026-10-31-m23-push-forecast.md §3.1.1, §3.2, §5; ADR-026; AT4 in SQL): public.push_menu_item / app.push_menu_item_at. Start with and without a
-- temporary price (Q156: above 0, two decimals, not above the menu price in force), the end of the current business day (Q157), stop, idempotence, the log row and its
-- batch-key snapshot, the waiter menu and add_order_line reading the columns, the guards, the untouched price history, the roles. Two tenants. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(72);

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
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)');
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'spezzatino (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e3', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'ragu (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e2', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'spezzatino con polenta (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e5', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'tagliatelle al ragu (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch, shelf_life_hours, created_by) values
  ('ed000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e1', 1, now() - interval '60 days', 'Spezzatino (demo)', 2, 'kg', 10, 48, 'a1000000-0000-4000-8000-00000000000a'),
  ('ed000000-0000-4000-8000-0000000000d3', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e3', 1, now() - interval '60 days', 'Ragù (demo)', 2, 'kg', 10, 48, 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by) values
  ('ed000000-0000-4000-8000-0000000000d2', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e2', 1, now() - interval '60 days', 'Spezzatino con polenta (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ed000000-0000-4000-8000-0000000000d6', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e5', 1, now() - interval '60 days', 'Tagliatelle al ragù (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe_line (tenant_id, recipe_id, position, sub_recipe_key, qty, unit, yield_factor, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d2', 1, 'ec000000-0000-4000-8000-0000000000e1', 1, 'porz', 1, 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d6', 1, 'ec000000-0000-4000-8000-0000000000e3', 1, 'porz', 1, 'a1000000-0000-4000-8000-00000000000a');
-- I1 stew plate (menu 14.00), I2 tagliatelle (11.00), I3 a drink without a recipe (5.00), I4 inactive, IB of tenant B. Prices valid from 2026-10-01.
insert into public.menu_item (id, tenant_id, name, category, course_default, recipe_key, is_active, created_by, updated_by) values
  ('11000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Spezzatino con polenta (demo)', 'Secondi', 'secondi', 'ec000000-0000-4000-8000-0000000000e2', true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Tagliatelle al ragù (demo)', 'Primi', 'primi', 'ec000000-0000-4000-8000-0000000000e5', true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Acqua (demo)', 'Bevande', 'bevande', null, true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'Vino spento (demo)', 'Bevande', 'bevande', null, false, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('21000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Solo B (demo)', 'Altro', 'dolci', null, true, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.menu_item_price (tenant_id, menu_item_id, price, vat_rate, valid_from, created_by) values
  ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000001', 14, 10, '2026-10-01T00:00Z', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000002', 11, 10, '2026-10-01T00:00Z', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000003', 5, 10, '2026-10-01T00:00Z', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000004', 15, 22, '2026-10-01T00:00Z', 'a1000000-0000-4000-8000-00000000000a'),
  ('22222222-2222-4222-8222-222222222222', '21000000-0000-4000-8000-0000000000b1', 3, 22, '2026-10-01T00:00Z', 'b1000000-0000-4000-8000-00000000000b');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('13000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Tavolo 1 (demo)', 1, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, created_by, updated_by) values
  ('14000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000001', 'Tavolo 1 (demo)', 4, 'a1000000-0000-4000-8000-00000000000a', '2026-10-24', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
-- Live batches for both plates (so add_order_line is not refused for stock).
insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code, lot_seq, produced_at, produced_by, output_qty, output_unit,
    portions_computed, portions_initial, shelf_life_hours, use_by, state, location_id, created_by) values
  ('ba000000-0000-4000-8000-0000000000b1', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e1', 'ed000000-0000-4000-8000-0000000000d1', 1, '261023-LOT-1', '2026-10-23', 'LOT', 1,
   now() - interval '1 hour', 'a1000000-0000-4000-8000-00000000000a', 2, 'kg', 10, 10, 48, now() + interval '47 hours', 'fresh', '10000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-00000000000a'),
  ('ba000000-0000-4000-8000-0000000000c1', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e3', 'ed000000-0000-4000-8000-0000000000d3', 1, '261023-LOT-2', '2026-10-23', 'LOT', 2,
   now() - interval '1 hour', 'a1000000-0000-4000-8000-00000000000a', 2, 'kg', 10, 10, 48, now() + interval '47 hours', 'fresh', '10000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-00000000000a');
insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'ba000000-0000-4000-8000-0000000000b1', 'produce', 10, 'batch', 'ba000000-0000-4000-8000-0000000000b1', '2026-10-23', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', 'ba000000-0000-4000-8000-0000000000c1', 'produce', 10, 'batch', 'ba000000-0000-4000-8000-0000000000c1', '2026-10-23', 'a1000000-0000-4000-8000-00000000000a');

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
-- The twin as owner A at a fixed instant, and its statement text for pg_temp.err.
create function pg_temp.push(p_item text, p_body text, p_now timestamptz) returns jsonb language sql as $$
  select app.push_menu_item_at('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', p_item::uuid, p_body::jsonb, p_now)
$$;
create function pg_temp.push_sql(p_item text, p_body text, p_now text) returns text language sql as $$
  select format('select pg_temp.push(%L, %L, %L)', p_item, p_body, p_now)
$$;
create temp table r (nm text primary key, j jsonb);
grant all on r to public;
create temp table before_state as
  select (select count(*)::int from public.menu_item_price) as n, (select md5(string_agg(x::text, ',' order by x::text)) from public.menu_item_price x) as h;

-- Start with a temporary price, at N = Wed 2026-11-04 10:00 CET -------------------------------------------------------------------------
insert into r values ('s1', pg_temp.push('11000000-0000-4000-8000-000000000001', '{"pushed":true,"pushPrice":12}', '2026-11-04T09:00Z'));
select is((select j ->> 'changed' from r where nm = 's1'), 'true', 'a first start changes the state');
select is((select j -> 'item' ->> 'pushPrice' from r where nm = 's1'), '12', 'the reply is the owner item shape: pushPrice 12');
select is((select j -> 'item' ->> 'pushUntil' from r where nm = 's1')::timestamptz, '2026-11-05T01:00Z'::timestamptz, 'and pushUntil is the next 02:00 (01:00Z)');
select is((select push_until from public.menu_item where id = '11000000-0000-4000-8000-000000000001'), '2026-11-05T01:00Z'::timestamptz, 'menu_item.push_until is set');
select is((select push_price from public.menu_item where id = '11000000-0000-4000-8000-000000000001'), 12.00::numeric, 'menu_item.push_price is set');
select is((select count(*)::int from public.menu_push where menu_item_id = '11000000-0000-4000-8000-000000000001' and action = 'start'), 1, 'one start row is logged');
select is((select m.push_until || '/' || m.push_price || '/' || m.created_at || '/' || m.created_by from public.menu_push m where m.menu_item_id = '11000000-0000-4000-8000-000000000001'),
          '2026-11-05 01:00:00+00/12.00/2026-11-04 09:00:00+00/a1000000-0000-4000-8000-00000000000a', 'the row carries the same values, created_at = N and the pusher');
select is((select batch_keys from public.menu_push where menu_item_id = '11000000-0000-4000-8000-000000000001'), array['ec000000-0000-4000-8000-0000000000e1']::uuid[], 'and the batch keys of the plate (the stew)');

-- Idempotence and re-push -----------------------------------------------------------------------------------------------------------------
insert into r values ('s2', pg_temp.push('11000000-0000-4000-8000-000000000001', '{"pushed":true,"pushPrice":12}', '2026-11-04T09:01Z'));
select is((select j ->> 'changed' from r where nm = 's2'), 'false', 'the same start again changes nothing');
select is((select count(*)::int from public.menu_push where menu_item_id = '11000000-0000-4000-8000-000000000001'), 1, 'and writes no row');
insert into r values ('s3', pg_temp.push('11000000-0000-4000-8000-000000000001', '{"pushed":true,"pushPrice":13}', '2026-11-04T09:02Z'));
select is((select j ->> 'changed' from r where nm = 's3'), 'true', 'a new price is a change');
select is((select count(*)::int from public.menu_push where menu_item_id = '11000000-0000-4000-8000-000000000001' and action = 'start'), 2, 'it writes a second start row');
select is((select push_price from public.menu_item where id = '11000000-0000-4000-8000-000000000001'), 13.00::numeric, 'and the columns follow');

-- Q156: the temporary price ---------------------------------------------------------------------------------------------------------------
select is(pg_temp.err(pg_temp.push_sql('11000000-0000-4000-8000-000000000001', '{"pushed":true,"pushPrice":14.00}', '2026-11-04T09:03Z')), 'ok', 'a price equal to the menu price (14.00) is accepted');
select is(pg_temp.err(pg_temp.push_sql('11000000-0000-4000-8000-000000000001', '{"pushed":true,"pushPrice":14.01}', '2026-11-04T09:04Z')), 'P0001 push_price_above_menu', '14.01 is above the menu price: push_price_above_menu');
select is(pg_temp.err(pg_temp.push_sql('11000000-0000-4000-8000-000000000001', '{"pushed":true,"pushPrice":0}', '2026-11-04T09:04Z')), 'P0001 push_price_invalid', '0: push_price_invalid');
select is(pg_temp.err(pg_temp.push_sql('11000000-0000-4000-8000-000000000001', '{"pushed":true,"pushPrice":-1}', '2026-11-04T09:04Z')), 'P0001 push_price_invalid', '-1: push_price_invalid');
select is(pg_temp.err(pg_temp.push_sql('11000000-0000-4000-8000-000000000001', '{"pushed":true,"pushPrice":12.345}', '2026-11-04T09:04Z')), 'P0001 push_price_invalid', '12.345 (three decimals): push_price_invalid');
select is(pg_temp.err(pg_temp.push_sql('11000000-0000-4000-8000-000000000001', '{"pushed":true,"pushPrice":10000.01}', '2026-11-04T09:04Z')), 'P0001 push_price_invalid', 'above 10000: push_price_invalid');
select is(pg_temp.err(pg_temp.push_sql('11000000-0000-4000-8000-000000000001', '{"pushed":true,"pushPrice":"12"}', '2026-11-04T09:04Z')), '22023 invalid_request', 'a string price: 22023');
select is((select push_price from public.menu_item where id = '11000000-0000-4000-8000-000000000001'), 14.00::numeric, 'the refused starts left the columns at the last good push');
select is((select count(*)::int from public.menu_push where menu_item_id = '11000000-0000-4000-8000-000000000001'), 3, 'and wrote no row');
insert into r values ('s4', pg_temp.push('11000000-0000-4000-8000-000000000001', '{"pushed":true}', '2026-11-04T09:05Z'));
select is((select push_price from public.menu_item where id = '11000000-0000-4000-8000-000000000001'), null, 'no price: push_price null (pinned without a price)');
select is((select push_until is not null from public.menu_item where id = '11000000-0000-4000-8000-000000000001'), true, 'and still pushed');
select is((select j -> 'item' -> 'pushPrice' from r where nm = 's4'), 'null'::jsonb, 'the reply says pushPrice null');
insert into r values ('s5', pg_temp.push('11000000-0000-4000-8000-000000000001', '{"pushed":true,"pushPrice":null}', '2026-11-04T09:06Z'));
select is((select j ->> 'changed' from r where nm = 's5'), 'false', 'an explicit null price on a push without a price is the same state');

-- Stop ------------------------------------------------------------------------------------------------------------------------------------
insert into r values ('x1', pg_temp.push('11000000-0000-4000-8000-000000000001', '{"pushed":false}', '2026-11-04T09:10Z'));
select is((select j ->> 'changed' from r where nm = 'x1'), 'true', 'a stop of a pushed item is a change');
select is((select (push_until is null and push_price is null) from public.menu_item where id = '11000000-0000-4000-8000-000000000001'), true, 'it clears both columns');
select is((select count(*)::int from public.menu_push where menu_item_id = '11000000-0000-4000-8000-000000000001' and action = 'stop'), 1, 'and writes one stop row');
insert into r values ('x2', pg_temp.push('11000000-0000-4000-8000-000000000001', '{"pushed":false}', '2026-11-04T09:11Z'));
select is((select j ->> 'changed' from r where nm = 'x2'), 'false', 'a stop of an item that is not pushed changes nothing');
select is((select count(*)::int from public.menu_push where menu_item_id = '11000000-0000-4000-8000-000000000001' and action = 'stop'), 1, 'and writes no second stop row');
select is((select count(*)::int from public.menu_push where menu_item_id = '11000000-0000-4000-8000-000000000001'), 5, 'the item''s log: four starts (12, 13, 14, none) and one stop');

-- Guards ----------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.err(pg_temp.push_sql('11000000-0000-4000-8000-000000000004', '{"pushed":true}', '2026-11-04T09:00Z')), 'P0001 menu_item_inactive', 'an inactive item cannot be pushed');
select is(pg_temp.err(pg_temp.push_sql('21000000-0000-4000-8000-0000000000b1', '{"pushed":true}', '2026-11-04T09:00Z')), 'P0002 menu_item_not_found', 'another tenant''s item: P0002');
select is(pg_temp.err(pg_temp.push_sql('99000000-0000-4000-8000-000000000099', '{"pushed":true}', '2026-11-04T09:00Z')), 'P0002 menu_item_not_found', 'an unknown id: P0002');
select is(pg_temp.err(pg_temp.push_sql('11000000-0000-4000-8000-000000000001', '{"pushed":true,"until":"2026-11-06T00:00Z"}', '2026-11-04T09:00Z')), '22023 invalid_request', 'an unknown key: 22023');
select is(pg_temp.err(pg_temp.push_sql('11000000-0000-4000-8000-000000000001', '{"pushed":false,"pushPrice":1}', '2026-11-04T09:00Z')), '22023 invalid_request', 'a stop with a price: 22023');
select is(pg_temp.err(pg_temp.push_sql('11000000-0000-4000-8000-000000000001', '{"pushPrice":1}', '2026-11-04T09:00Z')), '22023 invalid_request', 'a body without pushed: 22023');
select is(pg_temp.err(pg_temp.push_sql('11000000-0000-4000-8000-000000000001', '{"pushed":"yes"}', '2026-11-04T09:00Z')), '22023 invalid_request', 'pushed that is not a boolean: 22023');
select is(pg_temp.err(pg_temp.push_sql('11000000-0000-4000-8000-000000000001', '{}', '2026-11-04T09:00Z')), '22023 invalid_request', 'an empty body: 22023');
select is(pg_temp.err(pg_temp.push_sql('11000000-0000-4000-8000-000000000001', '[]', '2026-11-04T09:00Z')), '22023 invalid_request', 'an array body: 22023');
select is((select count(*)::int from public.menu_push where tenant_id = '22222222-2222-4222-8222-222222222222'), 0, 'nothing was written for tenant B');

-- An unmapped item (a drink) --------------------------------------------------------------------------------------------------------------
insert into r values ('d1', pg_temp.push('11000000-0000-4000-8000-000000000003', '{"pushed":true,"pushPrice":4}', '2026-11-04T09:20Z'));
select is((select batch_keys from public.menu_push where menu_item_id = '11000000-0000-4000-8000-000000000003'), '{}'::uuid[], 'a drink is pushed with an empty batch-key snapshot');
select is((select push_until from public.menu_item where id = '11000000-0000-4000-8000-000000000003'), '2026-11-05T01:00Z'::timestamptz, 'and the same end of the business day');
insert into r values ('d0', pg_temp.push('11000000-0000-4000-8000-000000000003', '{"pushed":false}', '2026-11-04T09:30Z'));
-- The cut-off boundary: at 01:30 CET (still the previous business day) the push ends at 02:00 of that same morning.
insert into r values ('d2', pg_temp.push('11000000-0000-4000-8000-000000000002', '{"pushed":true}', '2026-11-05T00:30Z'));
select is((select push_until from public.menu_item where id = '11000000-0000-4000-8000-000000000002'), '2026-11-05T01:00Z'::timestamptz, 'a push at 01:30 CET ends at 02:00 CET of that morning');
insert into r values ('d3', pg_temp.push('11000000-0000-4000-8000-000000000002', '{"pushed":false}', '2026-11-05T00:40Z'));
-- The log batch-key snapshot of the tagliatelle is the ragù.
select is((select batch_keys from public.menu_push where menu_item_id = '11000000-0000-4000-8000-000000000002' and action = 'start'), array['ec000000-0000-4000-8000-0000000000e3']::uuid[], 'the tagliatelle snapshot is the ragù key');

-- Consistency: while pushed, the newest start row equals the columns ------------------------------------------------------------------------
select is((select count(*)::int from public.menu_item i
            where i.tenant_id = '11111111-1111-4111-8111-111111111111' and i.push_until is not null
              and not exists (select 1 from (select m.* from public.menu_push m where m.menu_item_id = i.id order by m.created_at desc, m.id desc limit 1) l
                               where l.action = 'start' and l.push_until = i.push_until and l.push_price is not distinct from i.push_price)), 0,
          'every pushed item has a newest start row equal to its columns');

-- AT4: the waiter menu and add_order_line read the columns -----------------------------------------------------------------------------------
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
insert into r values ('real', public.push_menu_item('11000000-0000-4000-8000-000000000001', '{"pushed":true,"pushPrice":12}'));
select is((select j ->> 'changed' from r where nm = 'real'), 'true', 'the owner pushes through the public function at the real clock');
select is((select push_until > now() from public.menu_item where id = '11000000-0000-4000-8000-000000000001'), true, 'and the push lasts beyond now');
select is((select m.created_by from public.menu_push m where m.menu_item_id = '11000000-0000-4000-8000-000000000001' order by m.created_at desc, m.id desc limit 1),
          'a1000000-0000-4000-8000-00000000000a'::uuid, 'the row records the owner');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
insert into r values ('menu', public.menu_list());
select is((select j -> 'pinned' -> 0 ->> 'id' from r where nm = 'menu'), '11000000-0000-4000-8000-000000000001', 'AT4: the waiter menu pins the item first');
select is((select (j -> 'pinned' -> 0 ->> 'pushed') || '/' || (j -> 'pinned' -> 0 ->> 'pushPrice') from r where nm = 'menu'), 'true/12', 'AT4: pushed, with the push price 12');
select is((select jsonb_array_length(j -> 'pinned') from r where nm = 'menu'), 1, 'and it is the only pinned item (the earlier fixture pushes were stopped)');
insert into r values ('line', public.add_order_line('14000000-0000-4000-8000-000000000001',
  jsonb_build_object('lineId', 'e1000000-0000-4000-8000-000000000011', 'menuItemId', '11000000-0000-4000-8000-000000000001',
                     'clientUpdatedAt', to_char((clock_timestamp() - interval '1 minute') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))));
select is((select unit_price || '/' || price_source from public.order_line where id = 'e1000000-0000-4000-8000-000000000011'), '12.00/push', 'AT4: add_order_line freezes 12.00 with price_source push');

-- After push_until: pushed through the twin at a fixed past instant ----------------------------------------------------------------------------
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select pg_temp.push('11000000-0000-4000-8000-000000000002', '{"pushed":true,"pushPrice":9}', '2026-10-20T09:00Z');
select is((select push_until from public.menu_item where id = '11000000-0000-4000-8000-000000000002'), '2026-10-21T00:00Z'::timestamptz, 'the push of 2026-10-20 (CEST) ended at 02:00 CEST of 2026-10-21 (00:00Z), long before now');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
insert into r values ('menu2', public.menu_list());
select is((select count(*)::int from r, jsonb_array_elements(j -> 'pinned') p where nm = 'menu2' and p ->> 'id' = '11000000-0000-4000-8000-000000000002'), 0, 'AT4: after push_until the item is no longer pinned');
select is((select (e ->> 'pushed') || '/' || coalesce(e ->> 'pushPrice', 'null') from r, jsonb_path_query(j, '$.categories[*].items[*] ? (@.id == "11000000-0000-4000-8000-000000000002")') e where nm = 'menu2'),
          'false/null', 'pushed false and pushPrice null in the categories');
insert into r values ('line2', public.add_order_line('14000000-0000-4000-8000-000000000001',
  jsonb_build_object('lineId', 'e1000000-0000-4000-8000-000000000012', 'menuItemId', '11000000-0000-4000-8000-000000000002',
                     'clientUpdatedAt', to_char((clock_timestamp() - interval '1 minute') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))));
select is((select unit_price || '/' || price_source from public.order_line where id = 'e1000000-0000-4000-8000-000000000012'), '11.00/menu', 'AT4: after push_until add_order_line charges the menu price 11.00 (menu)');
select set_config('request.jwt.claims', '', true);

-- Roles ----------------------------------------------------------------------------------------------------------------------------------------
create temp table cnt as select count(*)::int as n from public.menu_push;
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(left(pg_temp.err($$select public.push_menu_item('11000000-0000-4000-8000-000000000003', '{"pushed":true}')$$), 6), '42501 ', 'chef: 42501');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(left(pg_temp.err($$select public.push_menu_item('11000000-0000-4000-8000-000000000003', '{"pushed":true}')$$), 6), '42501 ', 'waiter: 42501');
select set_config('request.jwt.claims', '', true);
select is(left(pg_temp.err($$select public.push_menu_item('11000000-0000-4000-8000-000000000003', '{"pushed":true}')$$), 6), '42501 ', 'no claims: 42501');
select is((select count(*)::int from public.menu_push), (select n from cnt), 'no row was written by a refused role');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is(pg_temp.err($$select public.push_menu_item('11000000-0000-4000-8000-000000000003', '{"pushed":true}')$$), 'ok', 'admin may push');
select is((select count(*)::int from public.menu_push) - (select n from cnt), 1, 'and the admin''s start is logged');
select is(pg_temp.err($$select public.push_menu_item('11000000-0000-4000-8000-000000000003', '{"pushed":false}')$$), 'ok', 'and stop');
select is((select count(*)::int from public.menu_push) - (select n from cnt), 2, 'the admin''s stop is logged too');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(pg_temp.err($$select public.push_menu_item('11000000-0000-4000-8000-000000000001', '{"pushed":true}')$$), 'P0002 menu_item_not_found', 'owner B pushing A''s item: P0002');
select set_config('request.jwt.claims', '', true);

-- The price history is untouched; privileges and definer settings -----------------------------------------------------------------------------
select is((select count(*)::int from public.menu_item_price), (select n from before_state), 'menu_item_price has the same row count after every case');
select is((select md5(string_agg(x::text, ',' order by x::text)) from public.menu_item_price x), (select h from before_state), 'and the same content (the temporary price never enters the history)');
select is((select array_agg(r order by r) from unnest(array['anon', 'authenticated', 'service_role']) r where has_function_privilege(r, 'public.push_menu_item(uuid, jsonb)', 'execute')), array['authenticated'], 'only authenticated executes push_menu_item');
select is((select bool_or(has_function_privilege(r, 'app.push_menu_item_at(uuid, uuid, uuid, jsonb, timestamptz)', 'execute')) from unnest(array['anon', 'authenticated', 'service_role']) r), false, 'no API role executes the twin');
select is((select count(*)::int from pg_proc p where p.oid in ('public.push_menu_item(uuid, jsonb)'::regprocedure, 'app.push_menu_item_at(uuid, uuid, uuid, jsonb, timestamptz)'::regprocedure)
             and p.prosecdef and p.provolatile = 'v' and p.proconfig = array['search_path=""']), 2, 'both are volatile definers with an empty search_path');

select * from finish();
rollback;
