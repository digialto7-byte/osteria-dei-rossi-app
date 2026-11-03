-- M22 step 10 (docs/plans/2026-10-31-m22-kpi-reporting.md §3.10, §5; ADR-025): a regression net, not a latency claim. Under a 5 s statement limit and a venue-sized history
-- (400 business days x 60 closed sessions x 8 lines, mapped and unmapped, with a fixed cost in force), the first rollup backfill of 400 dates, the KPI report over a custom range of
-- 366 days, the items report over 366 days (the owner's, with the fixed cost per plate) and the dashboard answer, and the closed-day read can use table_session_closed_day_idx
-- without a sequential scan of order_line. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test');
insert into public.tenant (id, name, vat_number) values ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo');
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'piatto uno (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e2', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'piatto due (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by) values
  ('ed000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e1', 1, '1997-01-01T00:00Z', 'Piatto uno (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ed000000-0000-4000-8000-0000000000d2', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e2', 1, '1997-01-01T00:00Z', 'Piatto due (demo)', 'a1000000-0000-4000-8000-00000000000a');
-- Eight menu items: six with a recipe (cost frozen), two without.
insert into public.menu_item (id, tenant_id, name, category, course_default, created_by, updated_by)
  select ('11000000-0000-4000-8000-00000000000' || n)::uuid, '11111111-1111-4111-8111-111111111111', 'Voce ' || n || ' (demo)', 'Primi', 'primi',
         'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a' from generate_series(1, 8) n;
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by)
  select ('13000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, '11111111-1111-4111-8111-111111111111', 'Tavolo ' || n || ' (demo)', n,
         'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a' from generate_series(1, 60) n;
insert into public.fixed_cost_period (tenant_id, month, rent, labour, utilities, created_by)
  select '11111111-1111-4111-8111-111111111111', m::date, 1000.00, 2000.00, 500.00, 'a1000000-0000-4000-8000-00000000000a' from generate_series('1997-09-01'::date, '1998-10-01'::date, interval '1 month') m;

-- 400 business days from 1997-09-01 (the last is 1998-10-05) x 60 closed sessions, each with 8 lines of 10,00 (VAT 10 %).
create temporary table closed_ids as
  select g as n, gen_random_uuid() as id, date '1997-09-01' + ((g - 1) / 60) as bdate from generate_series(1, 24000) g;
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_at, opened_by, business_date, coperto_amount, coperto_vat_rate, closed_at, closed_by,
                                  closed_business_date, receipt_type, receipt_number, payment_type, total, created_by, updated_by)
  select c.id, '11111111-1111-4111-8111-111111111111', ('13000000-0000-4000-8000-0000000000' || lpad((1 + c.n % 60)::text, 2, '0'))::uuid, 'Tavolo ' || (1 + c.n % 60) || ' (demo)', 2 + c.n % 3,
         ((c.bdate + time '19:00') at time zone 'Europe/Rome') + make_interval(mins => c.n % 60),
         'd1000000-0000-4000-8000-00000000000d', c.bdate, 2.00, 10, ((c.bdate + time '21:30') at time zone 'Europe/Rome') + make_interval(mins => c.n % 60), 'd1000000-0000-4000-8000-00000000000d',
         c.bdate, 'scontrino', 'N' || c.n, (array['cash', 'card', 'other'])[1 + c.n % 3], 80.00 + (2 + c.n % 3) * 2.00, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'
    from closed_ids c;
-- Statistics before each bulk insert that checks rows against the table just filled: on a database whose planner has never seen these tables, the
-- per-row checks of the next insert would scan them sequentially (minutes in CI, 1998-11-01 run 41317818465).
analyze public.table_session;
create temporary table line_ids as select gen_random_uuid() as id, c.id as sid, l as k, c.bdate from closed_ids c, generate_series(1, 8) l;
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by, fired_at, fired_by)
  select l.id, '11111111-1111-4111-8111-111111111111', l.sid, ('11000000-0000-4000-8000-00000000000' || l.k)::uuid, 'primi', 1, 10.00, 10, 'menu', now() - interval '1 day',
         'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d', now() - interval '1 day', 'd1000000-0000-4000-8000-00000000000d'
    from line_ids l;
analyze public.order_line;
insert into public.order_line_cost (order_line_id, tenant_id, recipe_id, total_cost, unit_cost_at_sale, incomplete, cost_at, created_by)
  select l.id, '11111111-1111-4111-8111-111111111111', case when l.k <= 6 then (case when l.k % 2 = 0 then 'ed000000-0000-4000-8000-0000000000d1' else 'ed000000-0000-4000-8000-0000000000d2' end)::uuid end,
         case when l.k <= 6 then 3.00 end, case when l.k <= 6 then 3.00 end, l.k > 6, now() - interval '1 day', 'd1000000-0000-4000-8000-00000000000d'
    from line_ids l;
analyze public.table_session;
analyze public.order_line;
analyze public.order_line_cost;
analyze public.menu_item;

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
select set_config('request.jwt.claims', json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
  'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'owner')::text, true);

set local statement_timeout = '5s';
select is(pg_temp.err($$select app.rollup_daily_kpi('1998-10-06 12:00:00+00')$$), 'ok', 'the first rollup backfill of 400 dates answers within 5 s');
reset statement_timeout;
select is((select count(*)::int from public.daily_kpi), 400, 'and wrote 400 rows (one per business date)');
-- plates_sold reads the stored rows and, for a date with closed sessions and no row yet, the lines (a closed table of 1998-10-06, whose row is not written yet).
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_at, opened_by, business_date, closed_at, closed_by, closed_business_date,
                                  receipt_type, payment_type, total, created_by, updated_by)
  values ('14000000-0000-4000-8000-0000000000f1', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000001', 'Tavolo 1 (demo)', 2, '1998-10-06 10:00+00',
          'd1000000-0000-4000-8000-00000000000d', '1998-10-06', '1998-10-06 11:00+00', 'd1000000-0000-4000-8000-00000000000d', '1998-10-06', 'scontrino', 'card', 20.00,
          'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d');
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by, fired_at, fired_by)
  values ('15000000-0000-4000-8000-0000000000f1', '11111111-1111-4111-8111-111111111111', '14000000-0000-4000-8000-0000000000f1', '11000000-0000-4000-8000-000000000001', 'primi', 2, 10.00, 10, 'menu',
          now() - interval '1 day', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d', now() - interval '1 day', 'd1000000-0000-4000-8000-00000000000d');
insert into public.order_line_cost (order_line_id, tenant_id, recipe_id, total_cost, unit_cost_at_sale, incomplete, cost_at, created_by)
  values ('15000000-0000-4000-8000-0000000000f1', '11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d1', 6.00, 3.00, false, now() - interval '1 day', 'd1000000-0000-4000-8000-00000000000d');
set local statement_timeout = '5s';
select is(pg_temp.err($$select app.kpi_report_json('11111111-1111-4111-8111-111111111111', 'owner', 'custom', null, '1997-10-05', '1998-10-05', '1998-10-06 12:00:00+00')$$), 'ok',
          'kpi_report over a custom range of 366 days answers within 5 s');
select is(pg_temp.err($$select app.kpi_items_json('11111111-1111-4111-8111-111111111111', 'owner', 'custom', null, '1997-10-05', '1998-10-05', '1998-10-06 12:00:00+00')$$), 'ok',
          'kpi_items over 366 days (the owner''s, with the fixed cost per plate of every date) answers within 5 s');
select is(pg_temp.err($$select app.dashboard_summary_at('11111111-1111-4111-8111-111111111111', 'owner', '1998-10-06 12:00:00+00')$$), 'ok', 'dashboard_summary answers within 5 s');
reset statement_timeout;

-- The live date (1998-10-06) holds two mapped plates, the stored dates the rest.
select is(app.plates_sold('11111111-1111-4111-8111-111111111111', '1998-09-20', '1998-10-06'),
          (select coalesce(sum(x.qty), 0) from app.kpi_sales_lines('11111111-1111-4111-8111-111111111111', '1998-09-20', '1998-10-06') x where x.mapped),
          'plates_sold over a window of stored dates agrees with the sum of the mapped lines');
select is(app.plates_sold('11111111-1111-4111-8111-111111111111', '1997-01-01', '1998-12-31'),
          (select coalesce(sum(x.qty), 0) from app.kpi_sales_lines('11111111-1111-4111-8111-111111111111', '1997-01-01', '1998-12-31') x where x.mapped),
          'and so does a window over the whole history');

-- The closed-day read: the same select as app.kpi_sales_lines (a definer function is not inlined, so the query itself is explained).
create temporary table plan as
  select explain_json from (select (xpath('/*', 'x'::xml))) x, lateral (select ''::text as explain_json) y limit 0;
create function pg_temp.explain_text(p_sql text) returns text language plpgsql as $$
declare
  r text;
  v text := '';
begin
  for r in execute 'explain (format text) ' || p_sql loop
    v := v || r || E'\n';
  end loop;
  return v;
end
$$;
create temporary table plan_text as select pg_temp.explain_text($q$
  select s.closed_business_date, s.id, l.menu_item_id, m.name, l.course::text, l.qty::numeric,
         round(l.qty * l.unit_price, 2), round(round(l.qty * l.unit_price, 2) / (1 + l.vat_rate / 100), 4),
         c.recipe_id is not null, c.recipe_id is not null and c.total_cost is not null
    from public.table_session s
    join public.order_line l on l.tenant_id = s.tenant_id and l.table_session_id = s.id
    join public.menu_item m on m.tenant_id = l.tenant_id and m.id = l.menu_item_id
    left join public.order_line_cost c on c.tenant_id = l.tenant_id and c.order_line_id = l.id
   where s.tenant_id = '11111111-1111-4111-8111-111111111111' and s.closed_at is not null
     and s.closed_business_date between '1998-09-14' and '1998-09-14' and l.voided_at is null $q$) as t;
select matches((select t from plan_text), 'table_session_closed_day_idx', 'the closed-day read of one business day uses table_session_closed_day_idx');
select doesnt_match((select t from plan_text), 'Seq Scan on order_line[ \n]', 'and does not scan order_line sequentially (the session index is used)');

select * from finish();
rollback;
