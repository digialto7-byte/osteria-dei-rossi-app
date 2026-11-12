-- P2-0b A6 (sell by weight, plan §5 A6, AT-W3, AT-W4): the money adds up end to end in SQL with weighted lines. Tavolo 1 (demo), 4 covers, coperto 2,00. Lines through the real
-- entry points: bistecca 1 230 g at 4,25 = 52,28 (4,25 x 12,3 = 52,275, half up); funghi 250 g at 3,35 = 8,38 (8,375 up); tagliatelle x 1 at 14,00; tagliatelle x 0,5 = 7,00;
-- tagliata 1 210 g at 4,25 = 51,43 (51,425: half-up gives 51,43, half-even would give 51,42; added by the P2-0b review fix, because the two ties above
-- (52,275 and 8,375) round to an even cent either way and cannot tell the rules apart).
-- Preview, both splits, fire, close with the preview's token, app vs register, the KPI day and the items totals. Rounding happens once: no figure is off by a cent.
-- Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test');
insert into public.tenant (id, name, vat_number, settings) values ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000', '{"sale_vat_pct": 10}');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('13000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Tavolo 1 (demo)', 1, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, coperto_amount, coperto_vat_rate, created_by, updated_by) values
  ('14000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000001', 'Tavolo 1 (demo)', 4,
   'd1000000-0000-4000-8000-00000000000d', app.business_date('11111111-1111-4111-8111-111111111111', now()), 2.00, 10,
   'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d');

create function pg_temp.act_as(auth_id uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', auth_id, 'role', 'authenticated', 'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', app_role)::text, true) $$;
create function pg_temp.as_owner() returns void language sql as $$ select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', 'owner') $$;
create function pg_temp.as_waiter() returns void language sql as $$ select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', 'waiter') $$;
create function pg_temp.ts() returns text language sql as $$ select to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') $$;
create function pg_temp.lid(n int) returns uuid language sql immutable as $$ select ('e3000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create temp table ids (k text primary key, id uuid);
grant all on ids to public;
create function pg_temp.id(k text) returns uuid language sql as $$ select id from ids where ids.k = $1 $$;
create function pg_temp.sess() returns uuid language sql as $$ select '14000000-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.add(p_line int, p_item text, p_extra jsonb) returns jsonb language sql as $$
  select public.add_order_line(pg_temp.sess(), jsonb_build_object('lineId', pg_temp.lid(p_line), 'menuItemId', pg_temp.id(p_item), 'clientUpdatedAt', pg_temp.ts()) || p_extra) $$;
-- The parts of a split, as the list of cents (integers), in order.
create function pg_temp.cents(p_split jsonb) returns bigint[] language sql as $$
  select array_agg(round((e ->> 'amount')::numeric * 100)::bigint order by o) from jsonb_array_elements(p_split -> 'parts') with ordinality t(e, o) $$;

select pg_temp.as_owner();
insert into ids select 'bist', (public.create_menu_item('{"name":"Bistecca a peso (demo)","category":"Secondi","course":"secondi","recipeKey":null,"price":4.25,"vatRate":10,"priceUnit":"etto","portionWeightG":400}'::jsonb) -> 'item' ->> 'id')::uuid;
insert into ids select 'fung', (public.create_menu_item('{"name":"Funghi fritti a peso (demo)","category":"Antipasti","course":"antipasti","recipeKey":null,"price":3.35,"vatRate":10,"priceUnit":"etto","portionWeightG":200}'::jsonb) -> 'item' ->> 'id')::uuid;
insert into ids select 'tagl', (public.create_menu_item('{"name":"Tagliata a peso (demo)","category":"Secondi","course":"secondi","recipeKey":null,"price":4.25,"vatRate":10,"priceUnit":"etto","portionWeightG":400}'::jsonb) -> 'item' ->> 'id')::uuid;
insert into ids select 'tag', (public.create_menu_item('{"name":"Tagliatelle (demo)","category":"Primi","course":"primi","recipeKey":null,"price":14,"vatRate":10}'::jsonb) -> 'item' ->> 'id')::uuid;

select pg_temp.as_waiter();
select is((pg_temp.add(1, 'bist', '{"weightG":1230}') -> 'line' ->> 'unitPrice')::numeric, 52.28, 'bistecca 1 230 g at 4,25 / etto = 52,28 (52,275 rounds up)');
select is((pg_temp.add(2, 'fung', '{"weightG":250}') -> 'line' ->> 'unitPrice')::numeric, 8.38, 'funghi 250 g at 3,35 / etto = 8,38 (8,375 rounds up)');
select is((pg_temp.add(3, 'tag', '{"qty":1}') -> 'line' ->> 'unitPrice')::numeric, 14.00, 'tagliatelle x 1 at 14,00');
select is((pg_temp.add(4, 'tag', '{"qty":0.5}') -> 'line' ->> 'qty')::numeric, 0.5, 'tagliatelle x 0,5');
select is((pg_temp.add(5, 'tagl', '{"weightG":1210}') -> 'line' ->> 'unitPrice')::numeric, 51.43, 'tagliata 1 210 g at 4,25 / etto = 51,43 (51,425 rounds up; half-even would give 51,42)');

-- Preview -----------------------------------------------------------------------------------------------------------------------------------
create temporary table b0 as select public.session_bill(pg_temp.sess(), null) as j;
select is((select (j ->> 'subtotal')::numeric from b0), 133.09, 'the preview subtotal is 133,09 (52,28 + 8,38 + 14,00 + 7,00 + 51,43)');
select is((select (j ->> 'total')::numeric from b0), 141.09, 'the preview total is 141,09 (with 4 x 2,00 coperto)');
select is((select jsonb_object_agg(e ->> 'name' || '/' || (e ->> 'qty'), (e ->> 'amount')::numeric) from b0, jsonb_array_elements(j -> 'lines') e),
  '{"Bistecca a peso (demo)/1": 52.28, "Funghi fritti a peso (demo)/1": 8.38, "Tagliatelle (demo)/1": 14.00, "Tagliatelle (demo)/0.5": 7.00, "Tagliata a peso (demo)/1": 51.43}'::jsonb, 'each line amount is the stored line price times qty');

-- Splits ------------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.cents(public.session_bill(pg_temp.sess(), '{"mode":"covers","parts":4}') -> 'split'), array[3528, 3527, 3527, 3527]::bigint[], 'split by covers (4): 35,28 + 35,27 + 35,27 + 35,27');
select is((select sum(c) from unnest(pg_temp.cents(public.session_bill(pg_temp.sess(), '{"mode":"covers","parts":4}') -> 'split')) c), 14109::numeric, 'and the parts add up to 141,09');
create temporary table bi as select public.session_bill(pg_temp.sess(), jsonb_build_object('mode', 'items', 'groups', jsonb_build_array(
  jsonb_build_object('lineIds', jsonb_build_array(pg_temp.lid(1)), 'covers', 2),
  jsonb_build_object('lineIds', jsonb_build_array(pg_temp.lid(3), pg_temp.lid(4), pg_temp.lid(5)), 'covers', 2)), 'sharedLineIds', jsonb_build_array(pg_temp.lid(2)))) as j;
select is((select sum(c) from unnest(pg_temp.cents((select j -> 'split' from bi))) c), 14109::numeric, 'split by items (two groups of 2 covers, the funghi shared): the parts add up to 141,09 exactly');
select is((select (j -> 'split' ->> 'mode') from bi), 'items', 'it is the items split');

-- Fire and close -----------------------------------------------------------------------------------------------------------------------------
select is(jsonb_array_length(public.fire_course(pg_temp.sess(), jsonb_build_object('lineIds', jsonb_build_array(pg_temp.lid(1), pg_temp.lid(2), pg_temp.lid(3), pg_temp.lid(4), pg_temp.lid(5)))) -> 'fired'), 5, 'all five lines are fired');
select is((select count(*)::int from public.order_line where table_session_id = pg_temp.sess() and fired_at is not null), 5, 'five lines are fired in the table');
create temporary table cl as select public.close_table(pg_temp.sess(), jsonb_build_object('receiptType', 'scontrino', 'receiptNumber', '0012-0034', 'paymentType', 'card',
  'billToken', public.session_bill(pg_temp.sess(), null) ->> 'billToken')) as j;
select is((select total from public.table_session where id = pg_temp.sess()), 141.09, 'close_table freezes table_session.total at 141,09');
select is((select (j -> 'bill' ->> 'total')::numeric from cl), 141.09, 'and its bill says 141,09');

-- Day close and KPIs --------------------------------------------------------------------------------------------------------------------------
select pg_temp.as_owner();
create temporary table dc as select public.enter_day_close(jsonb_build_object('registerTotal', '141.09')) as j;
select is((select (j -> 'report' -> 'app' ->> 'total')::numeric from dc), 141.09, 'app_vs_register: the app total is 141,09');
select is((select (j -> 'report' -> 'difference' ->> 'amount')::numeric from dc), 0::numeric, 'a register total of 141,09 gives a difference of 0');
select ok((select app.rollup_daily_kpi(now() + interval '3 days')) >= 1, 'the rollup writes the day (and the empty days after it)');
create temporary table kd as select * from public.daily_kpi where tenant_id = '11111111-1111-4111-8111-111111111111'
  and business_date = (select closed_business_date from public.table_session where id = pg_temp.sess());
select is((select revenue_gross from kd), 141.09, 'daily_kpi revenue_gross is 141,09');
select is((select plates from kd), 4.5, 'daily_kpi plates is 4,5 (a weighted line is one plate: 1 + 1 + 1 + 0,5 + 1)');
select is((select items_net from kd),
  (select sum(round(round(l.qty * l.unit_price, 2) / (1 + l.vat_rate / 100), 4)) from public.order_line l where l.table_session_id = pg_temp.sess()), 'items_net is the sum of each line''s net');
select is((select items_net from kd), 120.9909, 'which is 47,5273 + 7,6182 + 12,7273 + 6,3636 + 46,7545');
create temporary table ki as select app.kpi_items_json('11111111-1111-4111-8111-111111111111', 'owner', 'day', (select business_date from kd), null, null, now() + interval '3 days') as j;
select is((select (j -> 'totals' ->> 'plates')::numeric from ki), (select plates from kd), 'kpi_items_json totals.plates equals the stored day');
select is((select (j -> 'totals' ->> 'revenueNetEur')::numeric from ki), (select items_net from kd), 'and totals.revenueNetEur equals the stored items_net');

-- Rounding happens once ------------------------------------------------------------------------------------------------------------------------
select is((select sum(round(l.qty * l.unit_price, 2)) from public.order_line l where l.table_session_id = pg_temp.sess()) + 4 * 2.00, 141.09,
  'the sum of the stored unit_price x qty (rounded per line) + coperto is the closed total, to the cent');

select * from finish();
rollback;
