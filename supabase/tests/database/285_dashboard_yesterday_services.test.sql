-- M25c step 6 (docs/plans/2026-11-01-m25c-services.md §3.1.9, §3.2, §5 step 6; ADR-031): app.dashboard_yesterday gains byService (key, name, covers, tables, revenueNetEur per
-- service, from the same split as the day close and the report). The fixture of pgTAP 284 (day D = 1998-11-04 and T5, a lunch table); "now" is fixed. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

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

-- T5, the lunch table: opened 12:30 local (11:30Z), closed 14:10 (13:10Z), 2 covers, coperto 2 x 2,00 at 10 %, one Spezzatino at 14,00 (frozen cost 4,20): total 18,00.
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_at, opened_by, business_date, coperto_amount, coperto_vat_rate, created_by, updated_by) values
  ('14000000-0000-4000-8000-000000000009', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000005', 'Tavolo 5 (demo)', 2, '1998-11-04 11:30+00', 'd1000000-0000-4000-8000-00000000000d', '1998-11-04', 2.00, 10, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d');
select pg_temp.addl(12, '14000000-0000-4000-8000-000000000009', '11000000-0000-4000-8000-000000000001', 'secondi', 1, 14.00, 10, 'fired', '1998-11-04 11:40+00', 'ed000000-0000-4000-8000-0000000000d1', 4.20);
select pg_temp.close_s('14000000-0000-4000-8000-000000000009', '1998-11-04 13:10+00', '1998-11-04', 18.00);
-- A closed table on an absolute past date for the wrappers (they use the real clock), no lines.
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_at, opened_by, business_date, created_by, updated_by) values
  ('14000000-0000-4000-8000-000000000008', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000002', 'Tavolo 2 (demo)', 3, '1998-09-15 18:00+00',
   'd1000000-0000-4000-8000-00000000000d', '1998-09-15', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d');
select pg_temp.close_s('14000000-0000-4000-8000-000000000008', '1998-09-15 20:00+00', '1998-09-15', 28.00);
-- The register total of D, for the parity with the day close.
insert into public.day_close (tenant_id, business_date, register_total, created_at, created_by) values
  ('11111111-1111-4111-8111-111111111111', '1998-11-04', 150.00, '1998-11-05 00:30+00', 'a1000000-0000-4000-8000-00000000000a');

select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');

create function pg_temp.old_yesterday(p_tenant uuid, p_now timestamptz) returns jsonb
  language plpgsql
  stable
as $$
declare
  v_d date := app.business_date(p_tenant, p_now) - 1;
  v_cur jsonb := app.kpi_range_agg(p_tenant, v_d, v_d);
  v_prev jsonb := app.kpi_range_agg(p_tenant, v_d - 7, v_d - 7);
  v_delta jsonb;
begin
  select jsonb_object_agg(x.k, case when x.c is null or x.p is null then null
                                    else jsonb_build_object('abs', round(x.c - x.p, 4),
                                                            'pct', case when x.p = 0 then null else round((x.c - x.p) / x.p * 100, 1) end) end)
    into v_delta
    from (select k.key as k, (v_cur ->> k.key)::numeric as c, (v_prev ->> k.key)::numeric as p
            from (values ('covers'), ('revenueNetEur'), ('avgSpendPerCoverEur'), ('avgTicketEur'), ('foodCostPct')) k (key)) x;
  return jsonb_build_object(
    'businessDate', v_d, 'final', v_cur -> 'final', 'covers', v_cur -> 'covers', 'tables', v_cur -> 'tables',
    'revenueNetEur', v_cur -> 'revenueNetEur', 'avgSpendPerCoverEur', v_cur -> 'avgSpendPerCoverEur', 'avgTicketEur', v_cur -> 'avgTicketEur',
    'foodCostPct', v_cur -> 'foodCostPct', 'costedSharePct', v_cur -> 'costedSharePct', 'costedRevenueNetEur', v_cur -> 'costedRevenueNetEur',
    'compare', jsonb_build_object('businessDate', v_d - 7, 'covers', v_prev -> 'covers', 'revenueNetEur', v_prev -> 'revenueNetEur',
                                  'avgSpendPerCoverEur', v_prev -> 'avgSpendPerCoverEur', 'avgTicketEur', v_prev -> 'avgTicketEur', 'foodCostPct', v_prev -> 'foodCostPct'),
    'delta', v_delta);
end
$$;

create temporary table dash as
  select 'owner'::text as k, app.dashboard_summary_at('11111111-1111-4111-8111-111111111111', 'owner', '1998-11-05 08:00+00') as j;
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
insert into dash select 'admin', app.dashboard_summary_at('11111111-1111-4111-8111-111111111111', 'admin', '1998-11-05 08:00+00');
create function pg_temp.y(p_k text default 'owner') returns jsonb language sql as $$ select j -> 'yesterday' from dash where k = p_k $$;

select is((select array_agg(k order by k collate "C") from jsonb_object_keys(pg_temp.y()) k),
          array['avgSpendPerCoverEur', 'avgTicketEur', 'businessDate', 'byService', 'compare', 'costedRevenueNetEur', 'costedSharePct', 'covers', 'delta', 'final', 'foodCostPct', 'revenueNetEur', 'tables'],
          'yesterday has the M22 keys plus byService');
select is(pg_temp.y() -> 'byService',
          '[{"key":"pranzo","name":"Pranzo","covers":2,"tables":1,"revenueNetEur":16.3637},{"key":"cena","name":"Cena","covers":5,"tables":2,"revenueNetEur":119.1281}]'::jsonb,
          'byService lists pranzo and cena with covers, tables and net revenue');
select is((select array_agg(k order by k collate "C") from jsonb_array_elements(pg_temp.y() -> 'byService') e, jsonb_object_keys(e) k where e ->> 'key' = 'cena'),
          array['covers', 'key', 'name', 'revenueNetEur', 'tables'], 'and each entry has exactly those five keys');
select is((select sum((e ->> 'covers')::numeric) from jsonb_array_elements(pg_temp.y() -> 'byService') e), (pg_temp.y() ->> 'covers')::numeric, 'the covers of the services add up to yesterday''s covers');
select is((select sum((e ->> 'revenueNetEur')::numeric) from jsonb_array_elements(pg_temp.y() -> 'byService') e), (pg_temp.y() ->> 'revenueNetEur')::numeric, 'and the net revenues to yesterday''s net revenue');
select is((select sum((e ->> 'tables')::numeric) from jsonb_array_elements(pg_temp.y() -> 'byService') e), (pg_temp.y() ->> 'tables')::numeric, 'and the tables');
select is(pg_temp.y('admin'), pg_temp.y('owner'), 'the admin''s yesterday block equals the owner''s');
select is(pg_temp.y() - 'byService', pg_temp.old_yesterday('11111111-1111-4111-8111-111111111111', '1998-11-05 08:00+00'), 'without byService the block equals the M22 function''s result, key for key');
select is(pg_temp.y() -> 'byService', app.dashboard_yesterday('11111111-1111-4111-8111-111111111111', '1998-11-05 08:00+00') -> 'byService', 'the dashboard summary carries the same list as the function');
select is((select e from jsonb_array_elements(app.kpi_service_split('11111111-1111-4111-8111-111111111111', '1998-11-04', '1998-11-04') -> 'services') e where e ->> 'key' = 'pranzo') ->> 'revenueNetEur',
          pg_temp.y() -> 'byService' -> 0 ->> 'revenueNetEur', 'and its figures are the split''s');

-- A day with no sales still lists the services, with zeros (the tile hides them when the day''s covers are 0).
select is(app.dashboard_yesterday('11111111-1111-4111-8111-111111111111', '1998-11-20 08:00+00') -> 'byService',
          '[{"key":"pranzo","name":"Pranzo","covers":0,"tables":0,"revenueNetEur":0},{"key":"cena","name":"Cena","covers":0,"tables":0,"revenueNetEur":0}]'::jsonb, 'a day without sales: both services at zero');

-- Three services: in window order; a renamed one with its current name; a tenant that saved nothing uses the default -------------------------------
insert into public.service_schedule (tenant_id, periods, created_at, created_by)
  values ('11111111-1111-4111-8111-111111111111', '[{"key":"cena","name":"Cena serale","startsAt":"19:30"},{"key":"pranzo","name":"Pranzo","startsAt":"11:00"},{"key":"s_0123456789","name":"Aperitivo","startsAt":"18:00"}]',
          '1998-11-01T00:00Z', 'a1000000-0000-4000-8000-00000000000a');
select is((select array_agg(e ->> 'key' || ':' || (e ->> 'name') || ':' || (e ->> 'covers') order by o) from jsonb_array_elements(app.dashboard_yesterday('11111111-1111-4111-8111-111111111111', '1998-11-05 08:00+00') -> 'byService') with ordinality t(e, o)),
          array['pranzo:Pranzo:2', 's_0123456789:Aperitivo:0', 'cena:Cena serale:5'], 'three services come in window order with their names (the version in force at the end of the day)');
select is(app.dashboard_yesterday('22222222-2222-4222-8222-222222222222', '1998-11-05 08:00+00') -> 'byService' -> 1 ->> 'covers', '2', 'tenant B has its own figures (its one table of 2 covers is cena)');
select is((select sum((e ->> 'covers')::int) from jsonb_array_elements(app.dashboard_yesterday('22222222-2222-4222-8222-222222222222', '1998-11-05 08:00+00') -> 'byService') e), 2::bigint, 'and none of A''s');

-- Roles: the dashboard gate is unchanged -------------------------------------------------------------------------------------------------------------
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(left(pg_temp.err($$ select public.dashboard_summary() $$), 5), '42501', 'the chef still gets 42501 from dashboard_summary');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(left(pg_temp.err($$ select public.dashboard_summary() $$), 5), '42501', 'and the waiter');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'dashboard_yesterday' and p.prosecdef and p.proconfig @> array['search_path=""']
            and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('service_role', p.oid, 'execute')), 1,
          'app.dashboard_yesterday is still a definer closed to every API role');

select * from finish();
rollback;
