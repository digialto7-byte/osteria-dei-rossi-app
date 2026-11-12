-- P2-0b A5 (sell by weight, plan §3.3, §5 A5): the reads carry the weight. The bill line gains weightG and pricePer100g (null on portion lines) and the bill token
-- follows the weight; the kitchen ticket line gains weightG and no money key; kpi_sales_lines gains weight_g; kpi_items_json rows gain weightG and avgWeightG (null
-- for items without weighted lines), totals unchanged. Lines are inserted directly (A3 proves the entry). Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test');
insert into public.tenant (id, name, vat_number) values ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by)
  select ('13000000-0000-4000-8000-00000000000' || n)::uuid, '11111111-1111-4111-8111-111111111111', 'Tavolo ' || n || ' (demo)', n,
         'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'
    from generate_series(1, 5) n;
-- s1: the bill (open, mixed lines); s2: the 0,01 / etto token case; s3: portion lines only; s4: kitchen (open, fired); s5: closed, the KPI session.
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, created_by, updated_by)
  select ('14000000-0000-4000-8000-00000000000' || n)::uuid, '11111111-1111-4111-8111-111111111111', ('13000000-0000-4000-8000-00000000000' || n)::uuid,
         'Tavolo ' || n || ' (demo)', 2, 'a1000000-0000-4000-8000-00000000000a', '1998-11-04', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'
    from generate_series(1, 5) n;
insert into public.menu_item (id, tenant_id, name, category, course_default, created_by, updated_by) values
  ('11000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Bistecca a peso (demo)', 'Secondi', 'secondi', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Tagliatelle (demo)', 'Primi', 'primi', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');

create function pg_temp.sid(n int) returns uuid language sql as $$ select ('14000000-0000-4000-8000-00000000000' || n)::uuid $$;
create function pg_temp.lid(n int) returns uuid language sql as $$ select ('15000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
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
-- A line of session s: weighted (weight in g at p_etto per 100 g) when p_weight is given, otherwise a portion line of p_qty at p_price. fired_at null = a draft.
create function pg_temp.mkline(p_n int, p_s int, p_item int, p_weight int, p_etto numeric, p_qty numeric, p_price numeric, p_fired timestamptz) returns void language plpgsql as $$
begin
  if p_weight is null then
    insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_at, created_by, updated_by,
        fired_at, fired_by)
      values (pg_temp.lid(p_n), '11111111-1111-4111-8111-111111111111', pg_temp.sid(p_s), ('11000000-0000-4000-8000-00000000000' || p_item)::uuid, 'primi', p_qty, p_price, 10, 'menu',
              '1998-11-04 12:00+00', timestamptz '1998-11-04 12:00+00' + p_n * interval '1 second', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d',
              p_fired, case when p_fired is not null then 'd1000000-0000-4000-8000-00000000000d'::uuid end);
  else
    insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_at, created_by, updated_by,
        fired_at, fired_by, weight_g, price_per_100g, portion_weight_g)
      values (pg_temp.lid(p_n), '11111111-1111-4111-8111-111111111111', pg_temp.sid(p_s), ('11000000-0000-4000-8000-00000000000' || p_item)::uuid, 'secondi', 1,
              app.weight_line_price(p_etto, p_weight), 10, 'menu', '1998-11-04 12:00+00', timestamptz '1998-11-04 12:00+00' + p_n * interval '1 second',
              'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d',
              p_fired, case when p_fired is not null then 'd1000000-0000-4000-8000-00000000000d'::uuid end, p_weight, p_etto, 400);
  end if;
end
$$;
-- Every key, at any depth, of a JSON value.
create function pg_temp.all_keys(j jsonb) returns text[] language sql as $$
  select coalesce(array_agg(distinct k), '{}') from jsonb_path_query(j, 'strict $.**') v,
    lateral jsonb_object_keys(case when jsonb_typeof(v) = 'object' then v else '{}'::jsonb end) k $$;
create function pg_temp.act_as(p_auth uuid, p_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated', 'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', p_role)::text, true) $$;

-- The M21 token formula (20261110100100), reproduced to prove it is unchanged for sessions without weighted lines.
create function pg_temp.m21_token(p_s uuid) returns text language sql as $$
  select md5(coalesce((select string_agg(l.id::text || ':' || l.state || ':' || trim_scale(l.qty)::text || ':' || l.unit_price::text, ',' order by l.id)
                         from public.order_line l where l.table_session_id = s.id and l.voided_at is null), '') || '|' || s.covers::text || '|' || coalesce(s.coperto_amount::text, '-'))
    from public.table_session s where s.id = p_s $$;

-- s1: 1 200 g at 5,50 (66,00) and 2 x 14,00 portions. s2: 1 200 g at 0,01 (0,12). s3: portions only. s4: fired weighted 1 200 g + a fired portion line. s5: the KPI session.
select pg_temp.mkline(1, 1, 1, 1200, 5.5, null, null, null);
select pg_temp.mkline(2, 1, 2, null, null, 2, 14, null);
select pg_temp.mkline(3, 2, 1, 1200, 0.01, null, null, null);
select pg_temp.mkline(4, 3, 2, null, null, 1.5, 12.5, null);
select pg_temp.mkline(5, 3, 2, null, null, 1, 14, null);
select pg_temp.mkline(6, 4, 1, 1200, 5.5, null, null, '1998-11-04 19:00+00');
select pg_temp.mkline(7, 4, 2, null, null, 2, 14, '1998-11-04 19:00+00');
select pg_temp.mkline(8, 5, 1, 1230, 4.25, null, null, '1998-11-04 19:30+00');
select pg_temp.mkline(9, 5, 1, 1220, 4.25, null, null, '1998-11-04 19:30+00');
select pg_temp.mkline(10, 5, 2, null, null, 1, 14, '1998-11-04 19:30+00');
update public.table_session set closed_at = '1998-11-04 22:10+00', closed_by = 'd1000000-0000-4000-8000-00000000000d', closed_business_date = '1998-11-04', receipt_type = 'scontrino',
       receipt_number = '0001-0005', payment_type = 'card', total = 118.13 where id = pg_temp.sid(5);

-- Bill ---------------------------------------------------------------------------------------------------------------------------------
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', 'waiter');
create temporary table b1 as select public.session_bill(pg_temp.sid(1), null) as j;
select is((select e - 'id' from b1, jsonb_array_elements(j -> 'lines') e where e ->> 'id' = pg_temp.lid(1)::text),
  '{"name": "Bistecca a peso (demo)", "course": "secondi", "qty": 1, "weightG": 1200, "pricePer100g": 5.50, "unitPrice": 66.00, "amount": 66.00, "state": "draft", "isShared": false}'::jsonb,
  'a weighted bill line: qty 1, weightG, pricePer100g, unitPrice and amount = the line price');
select is((select e - 'id' from b1, jsonb_array_elements(j -> 'lines') e where e ->> 'id' = pg_temp.lid(2)::text),
  '{"name": "Tagliatelle (demo)", "course": "primi", "qty": 2, "weightG": null, "pricePer100g": null, "unitPrice": 14.00, "amount": 28.00, "state": "draft", "isShared": false}'::jsonb,
  'a portion line: the M21 shape + weightG null and pricePer100g null');
select is((select (j ->> 'subtotal')::numeric from b1), 94.00, 'the subtotal adds the line price once (66,00 + 28,00)');
select is(pg_temp.all_keys((select j from b1)) && array['cost', 'margin', 'vat', 'recipe', 'food'], false, 'no cost-like key in the waiter bill');

-- The token ------------------------------------------------------------------------------------------------------------------------------
create temporary table tk as select (public.session_bill(pg_temp.sid(2), null) ->> 'billToken') as t;
update public.order_line set weight_g = 1210, unit_price = app.weight_line_price(0.01, 1210) where id = pg_temp.lid(3);
select isnt((select public.session_bill(pg_temp.sid(2), null) ->> 'billToken'), (select t from tk),
  'a weight change on a draft changes the token even when the line price (0,01 / etto: 0,12 either way) does not');
select is((select (public.session_bill(pg_temp.sid(2), null) -> 'lines' -> 0 ->> 'amount')::numeric), 0.12, 'the amount stayed 0,12');
-- The token of a session without weighted lines is the M21 one (computed here with the M21 formula).
select is((select public.session_bill(pg_temp.sid(3), null) ->> 'billToken'),
  pg_temp.m21_token(pg_temp.sid(3)),
  'a session without weighted lines has the same token as before this migration');
select isnt((select public.session_bill(pg_temp.sid(1), null) ->> 'billToken'),
  pg_temp.m21_token(pg_temp.sid(1)),
  'a session with a weighted line has a token that includes the weight');

-- Kitchen ----------------------------------------------------------------------------------------------------------------------------------
create temporary table kt as select app.kitchen_ticket_rows('11111111-1111-4111-8111-111111111111', '1998-11-04 20:00+00') as j;
select is((select count(*)::int from kt, jsonb_array_elements(j -> 'tickets') t where t ->> 'sessionId' = pg_temp.sid(4)::text), 2, 'the fired comande of s4 are on the board (one per course)');
select is((select (e ->> 'weightG')::int from kt, jsonb_array_elements(j -> 'tickets') t, jsonb_array_elements(t -> 'lines') e where e ->> 'id' = pg_temp.lid(6)::text), 1200,
  'the weighted kitchen line has weightG 1200');
select is((select (e -> 'weightG')::text from kt, jsonb_array_elements(j -> 'tickets') t, jsonb_array_elements(t -> 'lines') e where e ->> 'id' = pg_temp.lid(7)::text), 'null',
  'a portion kitchen line has weightG null');
select is((select array_agg(k order by k collate "C") from (select distinct jsonb_object_keys(e) k from kt, jsonb_array_elements(j -> 'tickets') t, jsonb_array_elements(t -> 'lines') e) x),
  array['done', 'id', 'isShared', 'name', 'note', 'qty', 'voidReason', 'voided', 'weightG'], 'the kitchen line keys: the M19b set + weightG');
select is(pg_temp.all_keys((select j from kt)) && array['unitPrice', 'amount', 'pricePer100g', 'price', 'cost', 'total'], false, 'no money key anywhere on the kitchen board');
select is((select count(*)::int from kt, jsonb_path_query(j, 'strict $.**') v where jsonb_typeof(v) = 'string' and v #>> '{}' ~ '[€]'), 0, 'and no euro sign in the board');

-- KPI lines and items -------------------------------------------------------------------------------------------------------------------------
select is((select array_agg(coalesce(weight_g::text, '-') || '/' || trim_scale(qty) || '/' || gross || '/' || net order by gross)
             from app.kpi_sales_lines('11111111-1111-4111-8111-111111111111', '1998-11-04', '1998-11-04')),
  array['-/1/14.00/12.7273', '1220/1/51.85/47.1364', '1230/1/52.28/47.5273'], 'kpi_sales_lines: weight_g on weighted lines, null on portion ones; qty, gross and net as before');
select is(has_function_privilege('authenticated', 'app.kpi_sales_lines(uuid, date, date)', 'execute'), false, 'kpi_sales_lines stays closed to API roles');
create temporary table ki as select app.kpi_items_json('11111111-1111-4111-8111-111111111111', 'owner', 'day', '1998-11-04', null, null, '1998-11-05 08:00+00') as j;
select is((select r - 'revenueNetEur' - 'costedPlates' - 'costedRevenueNetEur' - 'foodCostEur' - 'foodCostPct' - 'foodMarginPerPlateEur' - 'fixedCostPerPlateEur' - 'grossMarginPerPlateEur'
                    - 'contributionEur' - 'fixedCostReason' - 'status' - 'menuItemId' - 'course'
             from ki, jsonb_array_elements(j -> 'rows') r where r ->> 'name' = 'Bistecca a peso (demo)'),
  '{"name": "Bistecca a peso (demo)", "plates": 2, "mixPct": 66.67, "weightG": 2450, "avgWeightG": 1225}'::jsonb, 'the weighted item: plates 2 (one per line), weightG 2450, avgWeightG 1225');
select is((select (r -> 'weightG')::text || '/' || (r -> 'avgWeightG')::text from ki, jsonb_array_elements(j -> 'rows') r where r ->> 'name' = 'Tagliatelle (demo)'), 'null/null',
  'a portion item: weightG and avgWeightG null');
select is((select count(*)::int from ki, jsonb_array_elements(j -> 'rows') r, jsonb_object_keys(r) k where k ~* '(unit|price|prezz)'), 0, 'no unit-price key in any items row');
select is((select j -> 'totals' ? 'weightG' from ki), false, 'the totals carry no weightG');
select is((select (j -> 'totals' ->> 'plates')::numeric from ki), 3::numeric, 'the totals count 3 plates');

-- Untouched on purpose ------------------------------------------------------------------------------------------------------------------------
select is((select md5(pg_get_functiondef('app.rollup_daily_kpi(timestamptz)'::regprocedure))), '472c875de3ded8c9866edaad1c2c0cba', 'app.rollup_daily_kpi is untouched (md5)');
select is((select md5(pg_get_functiondef('app.kpi_day_row(uuid,date)'::regprocedure))), '2ba5208a9b7647108d94dd4bbab19145', 'app.kpi_day_row is untouched (md5)');
select is((select md5(pg_get_functiondef('app.plates_sold(uuid,date,date)'::regprocedure))), '4f62ee6ef0587aea89bf0c629cbeb971', 'app.plates_sold is untouched (md5)');

select * from finish();
rollback;
