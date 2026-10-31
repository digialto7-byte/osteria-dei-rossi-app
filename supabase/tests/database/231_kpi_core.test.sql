-- M22 step 1 (docs/plans/2026-10-31-m22-kpi-reporting.md §3.1, §3.2, §3.9, §5; ADR-025): public.daily_kpi (append-only, RLS owner/admin, no write grant),
-- public.dashboard_open (a weekly counter), the one line-level source app.kpi_sales_lines, app.kpi_session_rows, app.kpi_day_row, the real
-- app.plates_sold (the M8 stub replaced), app.tenant_has_operational_data skipping dashboard_open, and job_run_job_check widened with 'kpi-rollup'.
-- The fixture day is D = 2026-11-04 of plan §3.9. Two tenants, two dates, fired and voided lines, mapped, unmapped and incomplete items. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(74);

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

-- Plates: Spezzatino and Tagliatelle have a recipe (frozen cost 4,20 and 3,10 per plate); Acqua and Vino do not.
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'spezzatino con polenta (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e2', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'tagliatelle al ragu (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by) values
  ('ed000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e1', 1, '2026-10-01T00:00Z', 'Spezzatino con polenta (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ed000000-0000-4000-8000-0000000000d2', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e2', 1, '2026-10-01T00:00Z', 'Tagliatelle al ragù (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.menu_item (id, tenant_id, name, category, course_default, recipe_key, created_by, updated_by) values
  ('11000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Spezzatino con polenta (demo)', 'Secondi', 'secondi', 'ec000000-0000-4000-8000-0000000000e1', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Tagliatelle al ragù (demo)', 'Primi', 'primi', 'ec000000-0000-4000-8000-0000000000e2', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Acqua (demo)', 'Bevande', 'bevande', null, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'Vino rosso (demo)', 'Bevande', 'bevande', null, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('21000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Acqua B (demo)', 'Bevande', 'bevande', null, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by)
  select ('13000000-0000-4000-8000-00000000000' || n)::uuid, '11111111-1111-4111-8111-111111111111', 'Tavolo ' || n || ' (demo)', n,
         'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a' from generate_series(1, 6) n;
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('23000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Tavolo B (demo)', 1, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');

-- Sessions (Europe/Rome, CET in November; cut-off 02:00). T1 and T2 close on business date D = 2026-11-04 (T2 after midnight), T3 closes after the
-- cut-off (business date D + 1), T4 stays open. P7 closes on D - 7, P3 on D - 3 (the plates of the fixed cost window). SB is tenant B on D.
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_at, opened_by, business_date, coperto_amount, coperto_vat_rate, created_by, updated_by) values
  ('14000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000001', 'Tavolo 1 (demo)', 3, '2026-11-04 19:10+00', 'd1000000-0000-4000-8000-00000000000d', '2026-11-04', 2.00, 10, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'),
  ('14000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000002', 'Tavolo 2 (demo)', 2, '2026-11-04 20:30+00', 'd1000000-0000-4000-8000-00000000000d', '2026-11-04', 2.00, 10, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'),
  ('14000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000003', 'Tavolo 3 (demo)', 2, '2026-11-04 22:50+00', 'd1000000-0000-4000-8000-00000000000d', '2026-11-04', null, null, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'),
  ('14000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000004', 'Tavolo 4 (demo)', 4, '2026-11-04 21:00+00', 'd1000000-0000-4000-8000-00000000000d', '2026-11-04', null, null, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'),
  ('14000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000005', 'Tavolo 5 (demo)', 2, '2026-10-28 18:30+00', 'd1000000-0000-4000-8000-00000000000d', '2026-10-28', null, null, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'),
  ('14000000-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000006', 'Tavolo 6 (demo)', 2, '2026-11-01 18:30+00', 'd1000000-0000-4000-8000-00000000000d', '2026-11-01', null, null, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'),
  ('24000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', '23000000-0000-4000-8000-000000000001', 'Tavolo B (demo)', 2, '2026-11-04 19:30+00', 'b1000000-0000-4000-8000-00000000000b', '2026-11-04', null, null, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');

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
-- One tenant-A order line (the owner fixture writes states no procedure can write directly): fired, or voided after firing. The frozen cost
-- row is added with p_cost: a total (the line's), 'none' for an unmapped item, 'incomplete' for a mapped plate with a missing ingredient.
create function pg_temp.addl(p_n int, p_session uuid, p_item uuid, p_course public.course, p_qty numeric, p_price numeric, p_vat numeric,
                             p_state text, p_at timestamptz, p_recipe uuid, p_total numeric, p_incomplete boolean default false) returns void language plpgsql as $$
declare
  v_id uuid := ('15000000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid;
begin
  insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source,
                                 client_updated_at, created_at, created_by, updated_by, fired_at, fired_by, voided_at, voided_by, void_reason)
  values (v_id, '11111111-1111-4111-8111-111111111111', p_session, p_item, p_course, p_qty, p_price, p_vat, 'menu',
          '2026-11-04 20:00+00', p_at, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d',
          p_at, 'd1000000-0000-4000-8000-00000000000d',
          case when p_state = 'voided' then p_at + interval '1 minute' end,
          case when p_state = 'voided' then 'd1000000-0000-4000-8000-00000000000d'::uuid end,
          case when p_state = 'voided' then 'wrong_dish' end);
  insert into public.order_line_cost (order_line_id, tenant_id, recipe_id, total_cost, unit_cost_at_sale, incomplete, missing_ingredient_ids, cost_at, created_by)
  values (v_id, '11111111-1111-4111-8111-111111111111', p_recipe, case when not p_incomplete then p_total end,
          case when not p_incomplete then round(p_total / p_qty, 4) end, p_incomplete or p_recipe is null,
          case when p_incomplete and p_recipe is not null then array['16000000-0000-4000-8000-000000000001']::uuid[] else '{}'::uuid[] end,
          p_at, 'd1000000-0000-4000-8000-00000000000d');
end
$$;
-- T1: 2 + 1/2 Spezzatino (10 %), 1,5 Tagliatelle, 1 Vino (22 %), and a Tagliatelle voided after firing (its cost row stays).
select pg_temp.addl(1, '14000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'secondi', 2, 14.00, 10, 'fired', '2026-11-04 19:15+00', 'ed000000-0000-4000-8000-0000000000d1', 8.40);
select pg_temp.addl(2, '14000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'secondi', 0.5, 14.00, 10, 'fired', '2026-11-04 19:16+00', 'ed000000-0000-4000-8000-0000000000d1', 2.10);
select pg_temp.addl(3, '14000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000002', 'primi', 1.5, 12.50, 10, 'fired', '2026-11-04 19:17+00', 'ed000000-0000-4000-8000-0000000000d2', 4.65);
select pg_temp.addl(4, '14000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000004', 'bevande', 1, 40.25, 22, 'fired', '2026-11-04 19:18+00', null, null);
select pg_temp.addl(5, '14000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000002', 'primi', 1, 12.50, 10, 'voided', '2026-11-04 19:19+00', 'ed000000-0000-4000-8000-0000000000d2', 3.10);
-- T2: 2 Tagliatelle and 2 Acqua. T3 (closes on D + 1) and T4 (open): one plate each.
select pg_temp.addl(6, '14000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000002', 'primi', 2, 12.50, 10, 'fired', '2026-11-04 20:35+00', 'ed000000-0000-4000-8000-0000000000d2', 6.20);
select pg_temp.addl(7, '14000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000003', 'bevande', 2, 3.00, 10, 'fired', '2026-11-04 20:36+00', null, null);
select pg_temp.addl(8, '14000000-0000-4000-8000-000000000003', '11000000-0000-4000-8000-000000000002', 'primi', 1, 12.50, 10, 'fired', '2026-11-04 22:55+00', 'ed000000-0000-4000-8000-0000000000d2', 3.10);
select pg_temp.addl(9, '14000000-0000-4000-8000-000000000004', '11000000-0000-4000-8000-000000000001', 'secondi', 1, 14.00, 10, 'fired', '2026-11-04 21:05+00', 'ed000000-0000-4000-8000-0000000000d1', 4.20);
-- P7 (D - 7): 4 Tagliatelle. P3 (D - 3): 56 Spezzatino.
select pg_temp.addl(10, '14000000-0000-4000-8000-000000000005', '11000000-0000-4000-8000-000000000002', 'primi', 4, 12.50, 10, 'fired', '2026-10-28 18:35+00', 'ed000000-0000-4000-8000-0000000000d2', 12.40);
select pg_temp.addl(11, '14000000-0000-4000-8000-000000000006', '11000000-0000-4000-8000-000000000001', 'secondi', 56, 14.00, 10, 'fired', '2026-11-01 18:35+00', 'ed000000-0000-4000-8000-0000000000d1', 235.20);
-- Tenant B: one closed session of 999,00 on D.
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_at, created_by, updated_by, fired_at, fired_by)
  values ('25000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', '24000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', 'bevande', 1, 999.00, 10, 'menu',
          '2026-11-04 20:00+00', '2026-11-04 19:35+00', 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b', '2026-11-04 19:35+00', 'b1000000-0000-4000-8000-00000000000b');
insert into public.order_line_cost (order_line_id, tenant_id, recipe_id, total_cost, unit_cost_at_sale, incomplete, cost_at, created_by)
  values ('25000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', null, null, null, true, '2026-11-04 19:35+00', 'b1000000-0000-4000-8000-00000000000b');

-- Closing: the frozen total and the business date of the close (Q128). The closing UPDATE is the only write the guard allows.
create function pg_temp.close_s(p_session uuid, p_closed timestamptz, p_cbd date, p_total numeric, p_user uuid default 'd1000000-0000-4000-8000-00000000000d') returns void language sql as $$
  update public.table_session set closed_at = p_closed, closed_by = p_user, closed_business_date = p_cbd, receipt_type = 'scontrino',
         receipt_number = '0001-' || right(p_session::text, 4), payment_type = 'card', total = p_total where id = p_session
$$;
select pg_temp.close_s('14000000-0000-4000-8000-000000000001', '2026-11-04 22:10+00', '2026-11-04', 100.00);
select pg_temp.close_s('14000000-0000-4000-8000-000000000002', '2026-11-04 23:40+00', '2026-11-04', 35.00);
select pg_temp.close_s('14000000-0000-4000-8000-000000000003', '2026-11-05 01:20+00', '2026-11-05', 12.50);
select pg_temp.close_s('14000000-0000-4000-8000-000000000005', '2026-10-28 20:10+00', '2026-10-28', 50.00);
select pg_temp.close_s('14000000-0000-4000-8000-000000000006', '2026-11-01 20:10+00', '2026-11-01', 784.00);
select pg_temp.close_s('24000000-0000-4000-8000-000000000001', '2026-11-04 21:00+00', '2026-11-04', 999.00, 'b1000000-0000-4000-8000-00000000000b');

-- Fixed costs for November 2026 (rent 100, labour 150, utilities 50 = 300 a month; invented). 60 mapped plates sit in the 30 days before D.
insert into public.fixed_cost_period (tenant_id, month, rent, labour, utilities, created_by)
  values ('11111111-1111-4111-8111-111111111111', '2026-11-01', 100.00, 150.00, 50.00, 'a1000000-0000-4000-8000-00000000000a');

-- A second day (2026-11-10, closes on that business date): a Tagliatelle with an incomplete frozen cost and a costed Spezzatino.
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_at, opened_by, business_date, created_by, updated_by) values
  ('14000000-0000-4000-8000-000000000007', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000001', 'Tavolo 1 (demo)', 2, '2026-11-10 18:30+00', 'd1000000-0000-4000-8000-00000000000d', '2026-11-10', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d');
select pg_temp.addl(12, '14000000-0000-4000-8000-000000000007', '11000000-0000-4000-8000-000000000002', 'primi', 2, 12.50, 10, 'fired', '2026-11-10 18:35+00', 'ed000000-0000-4000-8000-0000000000d2', null, true);
select pg_temp.addl(13, '14000000-0000-4000-8000-000000000007', '11000000-0000-4000-8000-000000000001', 'secondi', 1, 14.00, 10, 'fired', '2026-11-10 18:36+00', 'ed000000-0000-4000-8000-0000000000d1', 4.20);
select pg_temp.close_s('14000000-0000-4000-8000-000000000007', '2026-11-10 20:10+00', '2026-11-10', 39.00);

create temporary table kd as select * from app.kpi_day_row('11111111-1111-4111-8111-111111111111', '2026-11-04');
create temporary table kd2 as select * from app.kpi_day_row('11111111-1111-4111-8111-111111111111', '2026-11-10');

-- kpi_day_row: the hand-computed day (plan §3.9) --------------------------------------------------------------------------------------
select is((select covers from kd), 5, 'covers 5 (T1 3 + T2 2)');
select is((select tables from kd), 2, 'tables 2');
select is((select revenue_gross from kd), 135.00::numeric, 'revenue_gross 135,00 (the frozen totals)');
select is((select items_net from kd), 110.0372::numeric, 'items_net 110,0372 (six lines, each rounded to 4 decimals before the sum)');
select is((select coperto_net from kd), 9.0909::numeric, 'coperto_net 9,0909 (5,4545 + 3,6364)');
select is((select plates from kd), 9::numeric, 'plates 9 (2,5 + 3,5 + 1 + 2)');
select is((select costed_net from kd), 71.5909::numeric, 'costed_net 71,5909');
select is((select food_cost from kd), 21.35::numeric, 'food_cost 21,35 (10,50 + 10,85)');
select is((select uncosted_net from kd), 38.4463::numeric, 'uncosted_net 38,4463 (Vino + Acqua)');
select is((select unmapped_plates from kd), 3::numeric, 'unmapped_plates 3');
select is((select incomplete_plates from kd), 0::numeric, 'incomplete_plates 0');
select is((select covers_by_hour from kd),
          (select array_agg(case when h = 20 then 3 when h = 21 then 2 else 0 end order by h) from generate_series(0, 23) h),
          'covers_by_hour: 3 covers at local hour 20 (element 21), 2 at hour 21 (element 22), nothing else');
select is((select (tenant_id, business_date)::text from kd), '(11111111-1111-4111-8111-111111111111,2026-11-04)', 'the row carries the tenant and the date');
select is((select finalised_at is null and job_run_id is null from kd), true, 'a live row is not finalised and is not stored');
select is((select count(*)::int from public.daily_kpi), 0, 'kpi_day_row inserts nothing');

-- Exclusions: the voided line, the session closed on D + 1, the open one, tenant B ------------------------------------------------------
select is((select count(*)::int from app.kpi_sales_lines('11111111-1111-4111-8111-111111111111', '2026-11-04', '2026-11-04')), 6,
          'six lines on D: the Tagliatelle voided after firing, T3 (closed D + 1), T4 (open) and tenant B are in none');
select is((select count(*)::int from app.kpi_sales_lines('11111111-1111-4111-8111-111111111111', '2026-11-04', '2026-11-04') where session_id = '14000000-0000-4000-8000-000000000001'),
          4, 'T1 has four sold lines');
select is((select count(*)::int from app.kpi_sales_lines('11111111-1111-4111-8111-111111111111', '2026-11-05', '2026-11-05')), 1, 'T3 is on D + 1');
select is((select count(*)::int from public.order_line_cost where order_line_id = '15000000-0000-4000-8000-000000000005'), 1, 'the voided line keeps its cost row (it is waste, not food cost)');
select is((select count(*)::int from app.kpi_sales_lines('22222222-2222-4222-8222-222222222222', '2026-11-04', '2026-11-04')), 1, 'tenant B sees its own line');
select is((select (app.kpi_day_row('22222222-2222-4222-8222-222222222222', '2026-11-04')).revenue_gross), 999.00::numeric, 'tenant B: 999,00 and nothing of A');

-- Lines ---------------------------------------------------------------------------------------------------------------------------------
select is((select net from app.kpi_sales_lines('11111111-1111-4111-8111-111111111111', '2026-11-04', '2026-11-04') where item_name like 'Vino%'), 32.9918::numeric,
          'Vino: gross 40,25 at 22 % gives a net of 32,9918');
select is((select gross from app.kpi_sales_lines('11111111-1111-4111-8111-111111111111', '2026-11-04', '2026-11-04') where qty = 0.5), 7.00::numeric, 'a half portion of 14,00 has gross 7,00');
select is((select array[mapped::text, costed::text] from app.kpi_sales_lines('11111111-1111-4111-8111-111111111111', '2026-11-04', '2026-11-04') where item_name like 'Acqua%'),
          array['false', 'false'], 'Acqua is not mapped and not costed');
select is((select food_cost from app.kpi_sales_lines('11111111-1111-4111-8111-111111111111', '2026-11-04', '2026-11-04') where item_name like 'Acqua%'), null::numeric, 'and its food cost is null, never 0');
select is((select array[mapped::text, costed::text] from app.kpi_sales_lines('11111111-1111-4111-8111-111111111111', '2026-11-10', '2026-11-10') where qty = 2),
          array['true', 'false'], 'a mapped line with an incomplete cost is not costed');
select is((select food_cost from app.kpi_sales_lines('11111111-1111-4111-8111-111111111111', '2026-11-10', '2026-11-10') where qty = 2), null::numeric, 'and has no food cost');
select is((select incomplete_plates from kd2), 2::numeric, 'incomplete_plates 2 on the second day');
select is((select array[plates, costed_net, food_cost, uncosted_net, unmapped_plates] from kd2), array[3, 12.7273, 4.20, 22.7273, 0]::numeric[], 'the second day: the incomplete line is in uncosted_net only');
select is((select array_agg(session_id order by session_id) from app.kpi_session_rows('11111111-1111-4111-8111-111111111111', '2026-11-04', '2026-11-04')),
          array['14000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000002']::uuid[], 'kpi_session_rows: the two sessions closed on D');
select is((select array[covers, opened_local_hour]::text from app.kpi_session_rows('11111111-1111-4111-8111-111111111111', '2026-11-04', '2026-11-04') where session_id = '14000000-0000-4000-8000-000000000002'),
          '{2,21}', 'T2 has 2 covers and opened in local hour 21');

-- plates_sold and the fixed cost --------------------------------------------------------------------------------------------------------
select is(app.plates_sold('11111111-1111-4111-8111-111111111111', '2026-10-05', '2026-11-03'), 60::numeric, 'plates_sold(D - 30, D - 1) = 60 (unmapped drinks do not count)');
select is(app.plates_sold('11111111-1111-4111-8111-111111111111', '2026-11-04', '2026-11-04'), 6::numeric, 'plates_sold on D: 2,5 + 3,5 (Vino and Acqua are not plates)');
select is(app.plates_sold('22222222-2222-4222-8222-222222222222', '2026-01-01', '2026-12-31'), 0::numeric, 'tenant B has no mapped plate');
select is((select per_plate from app.fixed_cost_at('11111111-1111-4111-8111-111111111111', '2026-11-04')), 5.00::numeric, 'fixed_cost_at(D): 300,00 / 60 = 5,00');
select is((select reason from app.fixed_cost_at('11111111-1111-4111-8111-111111111111', '2026-11-04')), null::text, 'with no reason');
insert into public.fixed_cost_period (tenant_id, month, rent, labour, utilities, created_by)
  values ('11111111-1111-4111-8111-111111111111', '2026-01-01', 100.00, 150.00, 50.00, 'a1000000-0000-4000-8000-00000000000a');
select is((select reason from app.fixed_cost_at('11111111-1111-4111-8111-111111111111', '2026-01-15')), 'no_sales', 'no sales in the window: reason no_sales (M8 behaviour kept)');
select is((select reason from app.fixed_cost_at('11111111-1111-4111-8111-111111111111', '2025-06-15')), 'no_fixed_costs', 'no month in force: no_fixed_costs');

-- Tables --------------------------------------------------------------------------------------------------------------------------------
create function pg_temp.ins_kpi(p_tenant uuid, p_date date, p_covers int default 5) returns void language sql as $$
  insert into public.daily_kpi (tenant_id, business_date, tables, covers, revenue_gross, items_net, coperto_net, plates, costed_net, food_cost, uncosted_net,
                                unmapped_plates, incomplete_plates, covers_by_hour)
  values (p_tenant, p_date, 2, p_covers, 135, 110.0372, 9.0909, 9, 71.5909, 21.35, 38.4463, 3, 0, array_fill(0, array[24]))
$$;
select is(pg_temp.err($$select pg_temp.ins_kpi('11111111-1111-4111-8111-111111111111', '2026-11-04')$$), 'ok', 'a row is inserted by the owner of the table (the rollup is a definer)');
select is(pg_temp.err($$select pg_temp.ins_kpi('11111111-1111-4111-8111-111111111111', '2026-11-04')$$), '23505 duplicate key value violates unique constraint "daily_kpi_pkey"', 'one row per (tenant, date): 23505');
select is(left(pg_temp.err($$select pg_temp.ins_kpi('11111111-1111-4111-8111-111111111111', '2026-11-03', -1)$$), 5), '23514', 'negative covers: 23514');
select is(left(pg_temp.err($$insert into public.daily_kpi (tenant_id, business_date, tables, covers, revenue_gross, items_net, coperto_net, plates, costed_net, food_cost, uncosted_net,
  unmapped_plates, incomplete_plates, covers_by_hour) values ('11111111-1111-4111-8111-111111111111', '2026-11-03', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, array_fill(0, array[23]))$$), 5),
  '23514', 'covers_by_hour with 23 elements: 23514');
select is(pg_temp.err($$select pg_temp.ins_kpi('22222222-2222-4222-8222-222222222222', '2026-11-04')$$), 'ok', 'tenant B has its own row for the same date');
select is(pg_temp.err($$update public.daily_kpi set covers = 6 where tenant_id = '11111111-1111-4111-8111-111111111111'$$), 'P0001 append_only', 'UPDATE of daily_kpi: append_only');
select is(pg_temp.err($$delete from public.daily_kpi where tenant_id = '11111111-1111-4111-8111-111111111111'$$), 'P0001 append_only', 'DELETE of daily_kpi: append_only');
select is(pg_temp.err($$truncate public.daily_kpi$$), 'P0001 append_only', 'TRUNCATE of daily_kpi: append_only');
select is(pg_temp.err($$insert into public.dashboard_open (tenant_id, app_user_id, iso_week, opens) values ('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', '2026-11-03', 1)$$)
          ~ '^23514', true, 'dashboard_open.iso_week on a Tuesday: 23514');
select is(pg_temp.err($$insert into public.dashboard_open (tenant_id, app_user_id, iso_week, opens) values ('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', '2026-11-02', 0)$$)
          ~ '^23514', true, 'dashboard_open.opens = 0: 23514');
select is(pg_temp.err($$insert into public.dashboard_open (tenant_id, app_user_id, iso_week, opens) values ('11111111-1111-4111-8111-111111111111', 'b1000000-0000-4000-8000-00000000000b', '2026-11-02', 1)$$)
          ~ '^23503', true, 'a user of another tenant: the composite foreign key refuses (23503)');
select is(pg_temp.err($$insert into public.dashboard_open (tenant_id, app_user_id, iso_week, opens) values ('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', '2026-11-02', 1)$$),
          'ok', 'a Monday with one open is accepted');
select is(pg_temp.err($$update public.dashboard_open set opens = opens + 1$$), 'ok', 'dashboard_open is a counter, not a ledger: it can be updated');

-- RLS: owner A and admin A read A's row; chef, waiter and owner B do not -------------------------------------------------------------------
create temporary table seen (who text, n_kpi int, n_open int);
grant all on seen to authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
set local role authenticated;
insert into seen select 'owner_a', (select count(*)::int from public.daily_kpi), (select count(*)::int from public.dashboard_open);
reset role;
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
set local role authenticated;
insert into seen select 'admin_a', (select count(*)::int from public.daily_kpi), (select count(*)::int from public.dashboard_open);
reset role;
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
set local role authenticated;
insert into seen select 'chef_a', (select count(*)::int from public.daily_kpi), (select count(*)::int from public.dashboard_open);
reset role;
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
set local role authenticated;
insert into seen select 'waiter_a', (select count(*)::int from public.daily_kpi), (select count(*)::int from public.dashboard_open);
reset role;
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
set local role authenticated;
insert into seen select 'owner_b', (select count(*)::int from public.daily_kpi), (select count(*)::int from public.dashboard_open);
reset role;
select is((select n_kpi from seen where who = 'owner_a'), 1, 'owner A reads A''s daily_kpi row only');
select is((select n_kpi from seen where who = 'admin_a'), 1, 'admin A reads it too');
select is((select n_kpi from seen where who = 'chef_a'), 0, 'chef A reads 0 rows');
select is((select n_kpi from seen where who = 'waiter_a'), 0, 'waiter A reads 0 rows');
select is((select n_kpi from seen where who = 'owner_b'), 1, 'owner B reads B''s own row, not A''s');
select is((select n_open from seen where who = 'owner_a'), 1, 'owner A reads A''s dashboard_open row');
select is((select n_open from seen where who = 'admin_a'), 1, 'admin A reads it too');
select is((select max(n_open) from seen where who in ('chef_a', 'waiter_a', 'owner_b')), 0, 'chef, waiter and owner B read no dashboard_open row');
select set_config('request.jwt.claims', '', true);

-- Privileges ----------------------------------------------------------------------------------------------------------------------------
select is((select bool_or(has_table_privilege('authenticated', t, p)) from unnest(array['public.daily_kpi', 'public.dashboard_open']) t, unnest(array['insert', 'update', 'delete', 'truncate']) p),
          false, 'authenticated has no write privilege on either table');
select is((select bool_or(has_table_privilege('anon', t, 'select')) from unnest(array['public.daily_kpi', 'public.dashboard_open']) t), false, 'anon reads neither');
select is((select bool_and(has_table_privilege('service_role', t, 'select')) from unnest(array['public.daily_kpi', 'public.dashboard_open']) t), true, 'service_role may select');
select is((select bool_or(has_table_privilege('service_role', t, p)) from unnest(array['public.daily_kpi', 'public.dashboard_open']) t, unnest(array['insert', 'update', 'delete']) p), false,
          'and may not write');
select is((select bool_and(relrowsecurity) from pg_class where oid in ('public.daily_kpi'::regclass, 'public.dashboard_open'::regclass)), true, 'RLS is on for both');
select is((select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'dashboard_open' and data_type in ('timestamp with time zone', 'timestamp without time zone', 'time with time zone', 'time without time zone')), 0,
          'dashboard_open has no timestamp or time column: a count per ISO week, no times (founder decision)');
select is((select bool_or(has_function_privilege(r, f, 'execute')) from unnest(array['anon', 'authenticated', 'service_role']) r,
            unnest(array['app.kpi_sales_lines(uuid, date, date)', 'app.kpi_session_rows(uuid, date, date)', 'app.kpi_day_row(uuid, date)']) f), false,
          'no API role can execute the new app.* functions');
select is((select bool_and(prosecdef and proconfig = array['search_path=""']) from pg_proc
            where oid in ('app.kpi_sales_lines(uuid, date, date)'::regprocedure, 'app.kpi_session_rows(uuid, date, date)'::regprocedure, 'app.kpi_day_row(uuid, date)'::regprocedure,
                          'app.plates_sold(uuid, date, date)'::regprocedure)), true, 'they are definers with an empty search_path');

-- Demo rule -----------------------------------------------------------------------------------------------------------------------------
insert into public.tenant (id, name, vat_number) values ('33333333-3333-4333-8333-333333333333', 'Osteria Demo C', 'IT22222222226');
insert into auth.users (id, email) values ('e0000000-0000-4000-8000-00000000000e', 'owner-c@example.test');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('e1000000-0000-4000-8000-00000000000e', '33333333-3333-4333-8333-333333333333', 'e0000000-0000-4000-8000-00000000000e', 'owner', 'Titolare C Demo');
select is(app.tenant_has_operational_data('33333333-3333-4333-8333-333333333333'), false, 'a new tenant has no operational data');
insert into public.dashboard_open (tenant_id, app_user_id, iso_week, opens) values ('33333333-3333-4333-8333-333333333333', 'e1000000-0000-4000-8000-00000000000e', '2026-11-02', 3);
select is(app.tenant_has_operational_data('33333333-3333-4333-8333-333333333333'), false, 'a tenant with only a dashboard_open row still has none (a demo can start)');
select pg_temp.ins_kpi('33333333-3333-4333-8333-333333333333', '2026-11-04');
select is(app.tenant_has_operational_data('33333333-3333-4333-8333-333333333333'), true, 'a daily_kpi row is operational data');
select is((select array_agg(n order by n collate "C") from unnest(app.demo_purge_tables()) n where n in ('daily_kpi', 'dashboard_open')), array['daily_kpi', 'dashboard_open'], 'both tables are in the purge list');
select ok((select max(o) from unnest(app.demo_purge_tables()) with ordinality t(n, o) where n in ('daily_kpi', 'dashboard_open'))
          < (select o from unnest(app.demo_purge_tables()) with ordinality t(n, o) where n = 'app_user'), 'both come before app_user');
select is((select app.job_run_begin('kpi-rollup') > 0), true, 'job_run_begin(''kpi-rollup'') is accepted');
select is(left(pg_temp.err($$select app.job_run_begin('kpi-rollup-x')$$), 5), '23514', 'an unknown job name is still refused');

select * from finish();
