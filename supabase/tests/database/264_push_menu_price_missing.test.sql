-- M24 step 1 (docs/plans/2026-10-31-m24-exports.md §3.1.12, §3.2, §3.8, §5; Q177; M23 follow-up asked by the lead): a start with a temporary price on an item that has no menu
-- price in force raises P0001 menu_price_missing (its own code), through the twin and through public.push_menu_item. Everything else keeps its merged behaviour: a push
-- without a price still works (Q177 default), the price in force follows the instant, a price above the menu price is still push_price_above_menu, the price format check
-- still comes first, inactive and foreign items, the definer rules of the twin, and the untouched public function. Two tenants. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo');
-- P1 has a price of 14.00 since 2026-10-01. P2 has one price, 9.00, valid from 2026-11-10: none is in force on 2026-11-04. P3 is inactive (10.00). P4 has a price that starts
-- 30 days after the real clock, so the public function (which reads clock_timestamp()) finds no price in force whenever this test runs. PB belongs to tenant B.
insert into public.menu_item (id, tenant_id, name, category, course_default, recipe_key, is_active, created_by, updated_by) values
  ('11000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Spezzatino con polenta (demo)', 'Secondi', 'secondi', null, true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Piatto nuovo (demo)', 'Secondi', 'secondi', null, true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Vino spento (demo)', 'Bevande', 'bevande', null, false, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'Piatto futuro (demo)', 'Secondi', 'secondi', null, true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('21000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Solo B (demo)', 'Altro', 'dolci', null, true, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.menu_item_price (tenant_id, menu_item_id, price, vat_rate, valid_from, created_by) values
  ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000001', 14, 10, '2026-10-01T00:00Z', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000002', 9, 10, '2026-11-10T00:00Z', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000003', 10, 22, '2026-10-01T00:00Z', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000004', 8, 10, now() + interval '30 days', 'a1000000-0000-4000-8000-00000000000a'),
  ('22222222-2222-4222-8222-222222222222', '21000000-0000-4000-8000-0000000000b1', 3, 22, '2026-10-01T00:00Z', 'b1000000-0000-4000-8000-00000000000b');

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
create function pg_temp.push(p_item text, p_body text, p_now timestamptz) returns jsonb language sql as $$
  select app.push_menu_item_at('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', p_item::uuid, p_body::jsonb, p_now)
$$;
create function pg_temp.push_sql(p_item text, p_body text, p_now text) returns text language sql as $$
  select format('select pg_temp.push(%L, %L, %L)', p_item, p_body, p_now)
$$;
create temp table r (nm text primary key, j jsonb);
grant all on r to public;

-- The fix: no price in force + a temporary price -> menu_price_missing -----------------------------------------------------------------------------
select is(pg_temp.err(pg_temp.push_sql('11000000-0000-4000-8000-000000000002', '{"pushed":true,"pushPrice":5}', '2026-11-04T09:00Z')), 'P0001 menu_price_missing',
          'P2 (price only from 10 November) with a price of 5 on 4 November: P0001 menu_price_missing');
select is(pg_temp.err(pg_temp.push_sql('11000000-0000-4000-8000-000000000002', '{"pushed":true,"pushPrice":5}', '2026-11-09T22:59Z')), 'P0001 menu_price_missing',
          'and still one minute before the price starts (the price in force follows the instant)');
select is((select count(*)::int from public.menu_push where menu_item_id = '11000000-0000-4000-8000-000000000002'), 0, 'the refused starts wrote no menu_push row');
select is((select push_until is null and push_price is null from public.menu_item where id = '11000000-0000-4000-8000-000000000002'), true, 'and left push_until and push_price null');

-- Through the public function with owner claims ----------------------------------------------------------------------------------------------------------
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.err($$select public.push_menu_item('11000000-0000-4000-8000-000000000004', '{"pushed":true,"pushPrice":5}')$$), 'P0001 menu_price_missing',
          'public.push_menu_item as owner: the same code for an item whose price starts in the future');
select is(pg_temp.err($$select public.push_menu_item('11000000-0000-4000-8000-000000000001', '{"pushed":true,"pushPrice":14.01}')$$), 'P0001 push_price_above_menu',
          'public.push_menu_item as owner: P1 at 14.01 is still push_price_above_menu');
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.menu_push where menu_item_id in ('11000000-0000-4000-8000-000000000004', '11000000-0000-4000-8000-000000000001')), 0, 'neither wrote a row');

-- Unchanged: a push without a price still works (Q177 default) ---------------------------------------------------------------------------------------------
insert into r values ('n1', pg_temp.push('11000000-0000-4000-8000-000000000002', '{"pushed":true}', '2026-11-04T09:00Z'));
select is((select j ->> 'changed' from r where nm = 'n1'), 'true', 'P2 {"pushed":true} is accepted: changed true');
select is((select push_until from public.menu_item where id = '11000000-0000-4000-8000-000000000002'), '2026-11-05T01:00Z'::timestamptz, 'push_until is the next 02:00 (01:00Z)');
select is((select push_price from public.menu_item where id = '11000000-0000-4000-8000-000000000002'), null, 'push_price is null');
select is((select count(*)::int from public.menu_push where menu_item_id = '11000000-0000-4000-8000-000000000002' and action = 'start'), 1, 'and one start row is logged');
insert into r values ('x1', pg_temp.push('11000000-0000-4000-8000-000000000002', '{"pushed":false}', '2026-11-04T09:01Z'));
select is((select j ->> 'changed' from r where nm = 'x1'), 'true', 'a stop of it is a change');
insert into r values ('n2', pg_temp.push('11000000-0000-4000-8000-000000000002', '{"pushed":true,"pushPrice":null}', '2026-11-04T09:02Z'));
select is((select j ->> 'changed' from r where nm = 'n2'), 'true', 'an explicit null price is the same as none: accepted, changed true');
select is((select push_until || '/' || coalesce(push_price::text, 'null') from public.menu_item where id = '11000000-0000-4000-8000-000000000002'), '2026-11-05 01:00:00+00/null', 'with the same columns');
insert into r values ('x2', pg_temp.push('11000000-0000-4000-8000-000000000002', '{"pushed":false}', '2026-11-04T09:03Z'));

-- The price in force follows the instant ---------------------------------------------------------------------------------------------------------------
select is(pg_temp.err(pg_temp.push_sql('11000000-0000-4000-8000-000000000002', '{"pushed":true,"pushPrice":5}', '2026-11-11T09:00Z')), 'ok', 'P2 at 11 November (9.00 in force) with a price of 5: accepted');
select is((select push_price from public.menu_item where id = '11000000-0000-4000-8000-000000000002'), 5.00::numeric, 'and push_price is 5');
select is(pg_temp.err(pg_temp.push_sql('11000000-0000-4000-8000-000000000002', '{"pushed":true,"pushPrice":9.01}', '2026-11-11T09:01Z')), 'P0001 push_price_above_menu', 'P2 at 11 November with 9.01: push_price_above_menu (the old rule)');
select is(pg_temp.err(pg_temp.push_sql('11000000-0000-4000-8000-000000000002', '{"pushed":true,"pushPrice":9}', '2026-11-11T09:02Z')), 'ok', 'and 9.00 (equal to the price) is accepted');

-- An item with a price in force keeps the old rule ------------------------------------------------------------------------------------------------------
select is(pg_temp.err(pg_temp.push_sql('11000000-0000-4000-8000-000000000001', '{"pushed":true,"pushPrice":14.01}', '2026-11-04T09:00Z')), 'P0001 push_price_above_menu', 'P1 at 14.01: push_price_above_menu');
select is(pg_temp.err(pg_temp.push_sql('11000000-0000-4000-8000-000000000001', '{"pushed":true,"pushPrice":14.00}', '2026-11-04T09:00Z')), 'ok', 'P1 at 14.00: accepted');

-- The price format check still comes first --------------------------------------------------------------------------------------------------------------
select is(pg_temp.err(pg_temp.push_sql('11000000-0000-4000-8000-000000000004', '{"pushed":true,"pushPrice":0}', '2026-11-04T09:00Z')), 'P0001 push_price_invalid', 'no price in force and a price of 0: push_price_invalid');
select is(pg_temp.err(pg_temp.push_sql('11000000-0000-4000-8000-000000000004', '{"pushed":true,"pushPrice":12.345}', '2026-11-04T09:00Z')), 'P0001 push_price_invalid', 'and 12.345: push_price_invalid');
select is(pg_temp.err(pg_temp.push_sql('11000000-0000-4000-8000-000000000004', '{"pushed":true,"pushPrice":"5"}', '2026-11-04T09:00Z')), '22023 invalid_request', 'and a string price: 22023');

-- Guards before the price check -------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.err(pg_temp.push_sql('11000000-0000-4000-8000-000000000003', '{"pushed":true,"pushPrice":5}', '2026-11-04T09:00Z')), 'P0001 menu_item_inactive', 'an inactive item: menu_item_inactive');
select is(pg_temp.err(pg_temp.push_sql('21000000-0000-4000-8000-0000000000b1', '{"pushed":true,"pushPrice":1}', '2026-11-04T09:00Z')), 'P0002 menu_item_not_found', 'tenant B''s item through tenant A: P0002 menu_item_not_found');

-- The twin keeps its definer rules ----------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'push_menu_item_at'), 1, 'exactly one app.push_menu_item_at');
select is((select prosecdef from pg_proc where oid = 'app.push_menu_item_at(uuid, uuid, uuid, jsonb, timestamptz)'::regprocedure), true, 'it is a security definer');
select is((select proconfig from pg_proc where oid = 'app.push_menu_item_at(uuid, uuid, uuid, jsonb, timestamptz)'::regprocedure), array['search_path=""'], 'with an empty search_path');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r where has_function_privilege(r, 'app.push_menu_item_at(uuid, uuid, uuid, jsonb, timestamptz)', 'execute')), 0, 'no API role can execute it');
-- md5(prosrc) of public.push_menu_item as merged on 28a3848: the public function is not touched by M24.
select is((select md5(prosrc) from pg_proc where oid = 'public.push_menu_item(uuid, jsonb)'::regprocedure), '6f79d75bf4b44d72e2a7f502aa29b215', 'public.push_menu_item is byte for byte the merged one');
select is((select count(*)::int from unnest(array['anon', 'service_role']) r where has_function_privilege(r, 'public.push_menu_item(uuid, jsonb)', 'execute')), 0, 'and is still not executable by anon or service_role');
select is(has_function_privilege('authenticated', 'public.push_menu_item(uuid, jsonb)', 'execute'), true, 'but is by authenticated');
select is((select count(*)::int from public.menu_item_price where menu_item_id in ('11000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000002')), 2, 'the price history was not touched by any of the pushes');

select * from finish();
rollback;
