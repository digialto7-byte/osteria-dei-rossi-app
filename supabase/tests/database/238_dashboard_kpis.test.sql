-- M22 step 7 (docs/plans/2026-10-31-m22-kpi-reporting.md §3.2, §5; ADR-025; AT2 on the dashboard, AT9): public.dashboard_summary() gains the yesterday block (built with app.kpi_range_agg, so it
-- equals kpi_report('day', D)) and comingSoon = ["pushList"]; the body moves into the twin app.dashboard_summary_at(tenant, role, now). public.record_dashboard_open() counts
-- the owner's opens per ISO week (count only). Fixture day D = 1998-11-04 of plan §3.9, twin "now" 1998-11-05 09:00 local. Two tenants. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(49);

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
  ('ed000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e1', 1, '1998-10-01T00:00Z', 'Spezzatino con polenta (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ed000000-0000-4000-8000-0000000000d2', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e2', 1, '1998-10-01T00:00Z', 'Tagliatelle al ragù (demo)', 'a1000000-0000-4000-8000-00000000000a');
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

-- Sessions (Europe/Rome, CET in November; cut-off 02:00). T1 and T2 close on business date D = 1998-11-04 (T2 after midnight), T3 closes after the
-- cut-off (business date D + 1), T4 stays open. P7 closes on D - 7, P3 on D - 3 (the plates of the fixed cost window). SB is tenant B on D.
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_at, opened_by, business_date, coperto_amount, coperto_vat_rate, created_by, updated_by) values
  ('14000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000001', 'Tavolo 1 (demo)', 3, '1998-11-04 19:10+00', 'd1000000-0000-4000-8000-00000000000d', '1998-11-04', 2.00, 10, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'),
  ('14000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000002', 'Tavolo 2 (demo)', 2, '1998-11-04 20:30+00', 'd1000000-0000-4000-8000-00000000000d', '1998-11-04', 2.00, 10, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'),
  ('14000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000003', 'Tavolo 3 (demo)', 2, '1998-11-04 22:50+00', 'd1000000-0000-4000-8000-00000000000d', '1998-11-04', null, null, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'),
  ('14000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000004', 'Tavolo 4 (demo)', 4, '1998-11-04 21:00+00', 'd1000000-0000-4000-8000-00000000000d', '1998-11-04', null, null, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'),
  ('14000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000005', 'Tavolo 5 (demo)', 2, '1998-10-28 18:30+00', 'd1000000-0000-4000-8000-00000000000d', '1998-10-28', null, null, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'),
  ('14000000-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000006', 'Tavolo 6 (demo)', 2, '1998-11-01 18:30+00', 'd1000000-0000-4000-8000-00000000000d', '1998-11-01', null, null, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'),
  ('24000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', '23000000-0000-4000-8000-000000000001', 'Tavolo B (demo)', 2, '1998-11-04 19:30+00', 'b1000000-0000-4000-8000-00000000000b', '1998-11-04', null, null, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');

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
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role, 'aal', case when app_role = 'admin' then 'aal2' else 'aal1' end)::text, true)
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
          '1998-11-04 20:00+00', p_at, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d',
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
select pg_temp.addl(1, '14000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'secondi', 2, 14.00, 10, 'fired', '1998-11-04 19:15+00', 'ed000000-0000-4000-8000-0000000000d1', 8.40);
select pg_temp.addl(2, '14000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'secondi', 0.5, 14.00, 10, 'fired', '1998-11-04 19:16+00', 'ed000000-0000-4000-8000-0000000000d1', 2.10);
select pg_temp.addl(3, '14000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000002', 'primi', 1.5, 12.50, 10, 'fired', '1998-11-04 19:17+00', 'ed000000-0000-4000-8000-0000000000d2', 4.65);
select pg_temp.addl(4, '14000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000004', 'bevande', 1, 40.25, 22, 'fired', '1998-11-04 19:18+00', null, null);
select pg_temp.addl(5, '14000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000002', 'primi', 1, 12.50, 10, 'voided', '1998-11-04 19:19+00', 'ed000000-0000-4000-8000-0000000000d2', 3.10);
-- T2: 2 Tagliatelle and 2 Acqua. T3 (closes on D + 1) and T4 (open): one plate each.
select pg_temp.addl(6, '14000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000002', 'primi', 2, 12.50, 10, 'fired', '1998-11-04 20:35+00', 'ed000000-0000-4000-8000-0000000000d2', 6.20);
select pg_temp.addl(7, '14000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000003', 'bevande', 2, 3.00, 10, 'fired', '1998-11-04 20:36+00', null, null);
select pg_temp.addl(8, '14000000-0000-4000-8000-000000000003', '11000000-0000-4000-8000-000000000002', 'primi', 1, 12.50, 10, 'fired', '1998-11-04 22:55+00', 'ed000000-0000-4000-8000-0000000000d2', 3.10);
select pg_temp.addl(9, '14000000-0000-4000-8000-000000000004', '11000000-0000-4000-8000-000000000001', 'secondi', 1, 14.00, 10, 'fired', '1998-11-04 21:05+00', 'ed000000-0000-4000-8000-0000000000d1', 4.20);
-- P7 (D - 7): 4 Tagliatelle. P3 (D - 3): 56 Spezzatino.
select pg_temp.addl(10, '14000000-0000-4000-8000-000000000005', '11000000-0000-4000-8000-000000000002', 'primi', 4, 12.50, 10, 'fired', '1998-10-28 18:35+00', 'ed000000-0000-4000-8000-0000000000d2', 12.40);
select pg_temp.addl(11, '14000000-0000-4000-8000-000000000006', '11000000-0000-4000-8000-000000000001', 'secondi', 56, 14.00, 10, 'fired', '1998-11-01 18:35+00', 'ed000000-0000-4000-8000-0000000000d1', 235.20);
-- Tenant B: one closed session of 999,00 on D.
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_at, created_by, updated_by, fired_at, fired_by)
  values ('25000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', '24000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', 'bevande', 1, 999.00, 10, 'menu',
          '1998-11-04 20:00+00', '1998-11-04 19:35+00', 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b', '1998-11-04 19:35+00', 'b1000000-0000-4000-8000-00000000000b');
insert into public.order_line_cost (order_line_id, tenant_id, recipe_id, total_cost, unit_cost_at_sale, incomplete, cost_at, created_by)
  values ('25000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', null, null, null, true, '1998-11-04 19:35+00', 'b1000000-0000-4000-8000-00000000000b');

-- Closing: the frozen total and the business date of the close (Q128). The closing UPDATE is the only write the guard allows.
create function pg_temp.close_s(p_session uuid, p_closed timestamptz, p_cbd date, p_total numeric, p_user uuid default 'd1000000-0000-4000-8000-00000000000d') returns void language sql as $$
  update public.table_session set closed_at = p_closed, closed_by = p_user, closed_business_date = p_cbd, receipt_type = 'scontrino',
         receipt_number = '0001-' || right(p_session::text, 4), payment_type = 'card', total = p_total where id = p_session
$$;
select pg_temp.close_s('14000000-0000-4000-8000-000000000001', '1998-11-04 22:10+00', '1998-11-04', 100.00);
select pg_temp.close_s('14000000-0000-4000-8000-000000000002', '1998-11-04 23:40+00', '1998-11-04', 35.00);
select pg_temp.close_s('14000000-0000-4000-8000-000000000003', '1998-11-05 01:20+00', '1998-11-05', 12.50);
select pg_temp.close_s('14000000-0000-4000-8000-000000000005', '1998-10-28 20:10+00', '1998-10-28', 50.00);
select pg_temp.close_s('14000000-0000-4000-8000-000000000006', '1998-11-01 20:10+00', '1998-11-01', 784.00);
select pg_temp.close_s('24000000-0000-4000-8000-000000000001', '1998-11-04 21:00+00', '1998-11-04', 999.00, 'b1000000-0000-4000-8000-00000000000b');

-- Fixed costs for November 2026 (rent 100, labour 150, utilities 50 = 300 a month; invented). 60 mapped plates sit in the 30 days before D.
insert into public.fixed_cost_period (tenant_id, month, rent, labour, utilities, created_by)
  values ('11111111-1111-4111-8111-111111111111', '1998-11-01', 100.00, 150.00, 50.00, 'a1000000-0000-4000-8000-00000000000a');

select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
create temporary table dash as select 'owner'::text as k, app.dashboard_summary_at('11111111-1111-4111-8111-111111111111', 'owner', '1998-11-05 08:00+00') as j;
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
insert into dash select 'admin', app.dashboard_summary_at('11111111-1111-4111-8111-111111111111', 'admin', '1998-11-05 08:00+00');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
create function pg_temp.y(p_k text default 'owner') returns jsonb language sql as $$ select j -> 'yesterday' from dash where k = p_k $$;

-- The yesterday block -------------------------------------------------------------------------------------------------------------------------------
select is((select array_agg(k order by k collate "C") from jsonb_object_keys(pg_temp.y()) k),
          (select array_agg(k order by k collate "C") from unnest(array['businessDate', 'final', 'covers', 'tables', 'revenueNetEur', 'avgSpendPerCoverEur', 'avgTicketEur', 'foodCostPct',
                                                                       'costedSharePct', 'costedRevenueNetEur', 'compare', 'delta', 'byService']) k),
          'yesterday has the keys of plan §3.2 (plus costedRevenueNetEur, which the "sui piatti con costo noto" hint needs, and M25c''s byService, step 6)');
select is(pg_temp.y() ->> 'businessDate', '1998-11-04', 'yesterday is the business date before p_now''s (1998-11-05 at 09:00 local)');
select is(pg_temp.y() ->> 'final', 'false', 'before the rollup it is provisional');
select is(array[(pg_temp.y() ->> 'covers')::numeric, (pg_temp.y() ->> 'tables')::numeric, (pg_temp.y() ->> 'revenueNetEur')::numeric, (pg_temp.y() ->> 'avgSpendPerCoverEur')::numeric,
                (pg_temp.y() ->> 'avgTicketEur')::numeric, (pg_temp.y() ->> 'foodCostPct')::numeric, (pg_temp.y() ->> 'costedSharePct')::numeric, (pg_temp.y() ->> 'costedRevenueNetEur')::numeric],
          array[5, 2, 119.1281, 23.8256, 59.5641, 29.82, 65.06, 71.5909]::numeric[], 'covers 5, tables 2, net 119,1281, spend 23,8256, ticket 59,5641, food cost 29,82 %, share 65,06 %, costed 71,5909');
select is((select array_agg(k order by k collate "C") from jsonb_object_keys(pg_temp.y() -> 'compare') k),
          (select array_agg(k order by k collate "C") from unnest(array['businessDate', 'covers', 'revenueNetEur', 'avgSpendPerCoverEur', 'avgTicketEur', 'foodCostPct']) k), 'compare has its keys');
select is(array[pg_temp.y() -> 'compare' ->> 'businessDate', pg_temp.y() -> 'compare' ->> 'covers', pg_temp.y() -> 'compare' ->> 'revenueNetEur', pg_temp.y() -> 'compare' ->> 'foodCostPct'],
          array['1998-10-28', '2', '45.4545', '27.28'], 'compare is D - 7: 2 covers, 45,4545, 27,28 %');
select is((select array_agg(k order by k collate "C") from jsonb_object_keys(pg_temp.y() -> 'delta') k),
          (select array_agg(k order by k collate "C") from unnest(array['covers', 'revenueNetEur', 'avgSpendPerCoverEur', 'avgTicketEur', 'foodCostPct']) k), 'delta has its keys');
select is(pg_temp.y() -> 'delta' -> 'covers', '{"abs": 3, "pct": 150.0}'::jsonb, 'delta covers {3, 150,0}');
select is(pg_temp.y() -> 'delta' -> 'revenueNetEur', '{"abs": 73.6736, "pct": 162.1}'::jsonb, 'delta revenueNetEur {73,6736, 162,1}');
select is(pg_temp.y('admin'), pg_temp.y('owner'), 'the owner''s and the admin''s yesterday blocks are equal');

-- AT2 on the dashboard --------------------------------------------------------------------------------------------------------------------------
select is((pg_temp.y() ->> 'foodCostPct')::numeric, (app.kpi_items_json('11111111-1111-4111-8111-111111111111', 'owner', 'day', '1998-11-04', null, null, '1998-11-05 08:00+00') -> 'totals' ->> 'foodCostPct')::numeric,
          'AT2: yesterday.foodCostPct = the items report''s total food cost %');
select is((pg_temp.y() ->> 'foodCostPct')::numeric, 29.82::numeric, 'and both are 29,82');
create temporary table rpt as select app.kpi_report_json('11111111-1111-4111-8111-111111111111', 'owner', 'day', '1998-11-04', null, null, '1998-11-05 08:00+00') as j;
select is(array[pg_temp.y() ->> 'covers', pg_temp.y() ->> 'revenueNetEur', pg_temp.y() ->> 'avgSpendPerCoverEur', pg_temp.y() ->> 'avgTicketEur'],
          (select array[j -> 'current' ->> 'covers', j -> 'current' ->> 'revenueNetEur', j -> 'current' ->> 'avgSpendPerCoverEur', j -> 'current' ->> 'avgTicketEur'] from rpt),
          'covers, net revenue, average spend and average ticket equal kpi_report.current');
select is(pg_temp.y() -> 'delta', (select jsonb_build_object('covers', j -> 'delta' -> 'covers', 'revenueNetEur', j -> 'delta' -> 'revenueNetEur', 'avgSpendPerCoverEur', j -> 'delta' -> 'avgSpendPerCoverEur',
                                                              'avgTicketEur', j -> 'delta' -> 'avgTicketEur', 'foodCostPct', j -> 'delta' -> 'foodCostPct') from rpt), 'and the deltas equal the report''s');

-- Final after the rollup, same values ------------------------------------------------------------------------------------------------------------
select app.rollup_daily_kpi('1998-11-05 08:00:00+00');
create temporary table dash2 as select app.dashboard_summary_at('11111111-1111-4111-8111-111111111111', 'owner', '1998-11-05 08:00+00') as j;
select is((select j -> 'yesterday' ->> 'final' from dash2), 'true', 'after the rollup yesterday is final');
select is((select (j -> 'yesterday') - 'final'::text from dash2), pg_temp.y() - 'final'::text, 'with identical values');

-- comingSoon and the rest of the document -----------------------------------------------------------------------------------------------------
select is((select j -> 'comingSoon' from dash where k = 'owner'), '[]'::jsonb, 'comingSoon is empty (covers, revenue and averageSpend are real since M22, pushList since M23; updated on purpose, M23 step 6)');
select is((select j -> 'comingSoon' from dash where k = 'admin'), '[]'::jsonb, 'for the admin too');
select is((select (j ? 'fixedCosts') from dash where k = 'owner'), true, 'the owner still has fixedCosts');
select is((select (j ? 'fixedCosts') or (j ? 'alertsOpen') from dash where k = 'admin'), false, 'the admin still has none of the owner-only keys');
select is((select count(*)::int from dash where jsonb_typeof(j -> 'yesterday') = 'object'), 2, 'both roles get yesterday');

-- The public function --------------------------------------------------------------------------------------------------------------------------
create function pg_temp.biz_today() returns date language sql as $$ select app.business_date('11111111-1111-4111-8111-111111111111', now()) $$;
select is((public.dashboard_summary() -> 'yesterday' ->> 'businessDate')::date, pg_temp.biz_today() - 1, 'public.dashboard_summary() with real claims: yesterday is today''s business date - 1');
select is((public.dashboard_summary() -> 'yesterday' -> 'compare' ->> 'businessDate')::date, pg_temp.biz_today() - 8, 'and the comparison day is 7 earlier');
select is((select position('insufficient_privilege' in pg_get_functiondef('public.dashboard_summary()'::regprocedure))
                < position('app.dashboard_summary_at' in pg_get_functiondef('public.dashboard_summary()'::regprocedure))), true, 'the role check still comes before the first helper call');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.err($$select public.dashboard_summary()$$), '42501 insufficient_privilege', 'the chef: 42501');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(pg_temp.err($$select public.dashboard_summary()$$), '42501 insufficient_privilege', 'the waiter: 42501');
select is((select bool_or(has_function_privilege(r, 'app.dashboard_summary_at(uuid, text, timestamptz)', 'execute')) from unnest(array['anon', 'authenticated', 'service_role']) r), false, 'no API role executes the twin');
select is((select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = 'app.dashboard_summary_at(uuid, text, timestamptz)'::regprocedure), true, 'the twin is a definer with an empty search_path');

-- AT9: the weekly count of opens (SQL) -----------------------------------------------------------------------------------------------------------
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(app.record_dashboard_open_at('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', '1998-11-04 09:00+00'), '{"isoWeek": "1998-11-02", "opens": 1}'::jsonb, 'the first open of the week of D');
select is(app.record_dashboard_open_at('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', '1998-11-05 18:00+00'), '{"isoWeek": "1998-11-02", "opens": 2}'::jsonb, 'the second: opens 2');
select is((select array[count(*)::int, max(opens)] from public.dashboard_open where tenant_id = '11111111-1111-4111-8111-111111111111' and iso_week = '1998-11-02'), array[1, 2], 'one row with opens 2');
select is(app.record_dashboard_open_at('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', '1998-10-25 22:59+00') ->> 'isoWeek', '1998-10-19', 'Sunday 23:59 local (22:59Z): the week of 10-19');
select is(app.record_dashboard_open_at('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', '1998-10-25 23:01+00') ->> 'isoWeek', '1998-10-26', 'Monday 00:01 local (23:01Z): the week of 10-26');
select is((select array_agg(iso_week order by iso_week) from public.dashboard_open where tenant_id = '11111111-1111-4111-8111-111111111111'), array['1998-10-19', '1998-10-26', '1998-11-02']::date[], 'three rows, one per ISO week');

-- The public function: owner only
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is(pg_temp.err($$select public.record_dashboard_open()$$), '42501 permission denied: only the owner''s opens are counted', 'the admin: 42501');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.err($$select public.record_dashboard_open()$$), '42501 permission denied: only the owner''s opens are counted', 'the chef: 42501');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(pg_temp.err($$select public.record_dashboard_open()$$), '42501 permission denied: only the owner''s opens are counted', 'the waiter: 42501');
select set_config('request.jwt.claims', '', true);
select is(pg_temp.err($$select public.record_dashboard_open()$$), '42501 permission denied: only the owner''s opens are counted', 'no claims: 42501');
select is((select count(*)::int from public.dashboard_open where tenant_id = '11111111-1111-4111-8111-111111111111'), 3, 'and none of them wrote a row');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
create temporary table cw as select date_trunc('week', now() at time zone 'Europe/Rome')::date as wk,
  coalesce((select opens from public.dashboard_open where tenant_id = '11111111-1111-4111-8111-111111111111' and iso_week = date_trunc('week', now() at time zone 'Europe/Rome')::date), 0) as before_opens;
select is((public.record_dashboard_open() ->> 'isoWeek')::date, (select wk from cw), 'the owner with real claims: a row of the current week');
select is((public.record_dashboard_open() ->> 'opens')::int, (select before_opens + 2 from cw), 'and the second call adds one more');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is((public.record_dashboard_open() ->> 'opens')::int, 1, 'tenant B''s owner counts its own row');
select is((select array[count(*)::int] from public.dashboard_open where tenant_id = '22222222-2222-4222-8222-222222222222' and app_user_id = 'b1000000-0000-4000-8000-00000000000b'), array[1], 'in tenant B');
select is((select count(*)::int from public.dashboard_open where tenant_id = '11111111-1111-4111-8111-111111111111'), (select 3 + (case when wk in ('1998-10-19', '1998-10-26', '1998-11-02') then 0 else 1 end) from cw), 'tenant A keeps its own rows, untouched by B');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
create temporary table before_open as select md5(string_agg(to_jsonb(d)::text, '|' order by d.iso_week)) as m from public.dashboard_open d;
select public.dashboard_summary();
select is((select md5(string_agg(to_jsonb(d)::text, '|' order by d.iso_week)) from public.dashboard_open d), (select m from before_open), 'a dashboard_summary() call leaves dashboard_open unchanged');
select is((select has_function_privilege('authenticated', 'public.record_dashboard_open()', 'execute')), true, 'authenticated can execute record_dashboard_open');
select is((select bool_or(has_function_privilege(r, 'public.record_dashboard_open()', 'execute')) from unnest(array['anon', 'service_role']) r), false, 'anon and service_role cannot');
select is((select bool_or(has_function_privilege(r, 'app.record_dashboard_open_at(uuid, uuid, timestamptz)', 'execute')) from unnest(array['anon', 'authenticated', 'service_role']) r), false, 'no API role executes the twin');
select is((select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = 'public.record_dashboard_open()'::regprocedure), true, 'record_dashboard_open is a definer with an empty search_path');

select * from finish();
