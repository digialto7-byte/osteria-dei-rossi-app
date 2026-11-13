-- M22 step 4 (docs/plans/2026-10-31-m22-kpi-reporting.md §3.2, §3.3, §5; ADR-025; AT1 per-item rows, AT2 in SQL): app.kpi_items_json and public.kpi_items. Plates, mix, net revenue,
-- food cost and food margin per item for owner and admin; fixed cost per plate, gross margin per plate and contribution for the owner only (Q107). The items totals are the
-- report's figures. Fixture day D = 1998-11-04 of plan §3.9, through the twin with a fixed "now". Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(68);

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

-- Fixed costs for November 1998 (rent 100, labour 150, utilities 50 = 300 a month; invented). 60 mapped plates sit in the 30 days before D.
insert into public.fixed_cost_period (tenant_id, month, rent, labour, utilities, created_by)
  values ('11111111-1111-4111-8111-111111111111', '1998-11-01', 100.00, 150.00, 50.00, 'a1000000-0000-4000-8000-00000000000a');

-- More days: 1998-11-10 (a Tagliatelle with an incomplete cost and a costed Spezzatino) and 1998-01-15 (a costed Tagliatelle in a month with a fixed cost but no earlier sale).
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_at, opened_by, business_date, created_by, updated_by) values
  ('14000000-0000-4000-8000-000000000007', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000001', 'Tavolo 1 (demo)', 2, '1998-11-10 18:30+00', 'd1000000-0000-4000-8000-00000000000d', '1998-11-10', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'),
  ('14000000-0000-4000-8000-000000000009', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000003', 'Tavolo 3 (demo)', 2, '1998-01-15 18:30+00', 'd1000000-0000-4000-8000-00000000000d', '1998-01-15', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d');
select pg_temp.addl(12, '14000000-0000-4000-8000-000000000007', '11000000-0000-4000-8000-000000000002', 'primi', 2, 12.50, 10, 'fired', '1998-11-10 18:35+00', 'ed000000-0000-4000-8000-0000000000d2', null, true);
select pg_temp.addl(13, '14000000-0000-4000-8000-000000000007', '11000000-0000-4000-8000-000000000001', 'secondi', 1, 14.00, 10, 'fired', '1998-11-10 18:36+00', 'ed000000-0000-4000-8000-0000000000d1', 4.20);
select pg_temp.close_s('14000000-0000-4000-8000-000000000007', '1998-11-10 20:10+00', '1998-11-10', 39.00);
select pg_temp.addl(14, '14000000-0000-4000-8000-000000000009', '11000000-0000-4000-8000-000000000002', 'primi', 1, 12.50, 10, 'fired', '1998-01-15 18:35+00', 'ed000000-0000-4000-8000-0000000000d2', 3.10);
select pg_temp.close_s('14000000-0000-4000-8000-000000000009', '1998-01-15 20:10+00', '1998-01-15', 12.50);
insert into public.fixed_cost_period (tenant_id, month, rent, labour, utilities, created_by)
  values ('11111111-1111-4111-8111-111111111111', '1998-01-01', 100.00, 150.00, 50.00, 'a1000000-0000-4000-8000-00000000000a');
-- A closed table on an absolute past date for the wrapper (which uses the real now()), with one costed line.
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_at, opened_by, business_date, created_by, updated_by) values
  ('14000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000005', 'Tavolo 5 (demo)', 2, '1998-09-15 18:00+00', 'd1000000-0000-4000-8000-00000000000d', '1998-09-15', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d');
select pg_temp.addl(15, '14000000-0000-4000-8000-00000000000a', '11000000-0000-4000-8000-000000000001', 'secondi', 2, 14.00, 10, 'fired', '1998-09-15 18:05+00', 'ed000000-0000-4000-8000-0000000000d1', 8.40);
select pg_temp.close_s('14000000-0000-4000-8000-00000000000a', '1998-09-15 20:00+00', '1998-09-15', 28.00);

select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
create temporary table it as select app.kpi_items_json('11111111-1111-4111-8111-111111111111', 'owner', 'day', '1998-11-04', null, null, '1998-11-05 08:00+00') as j;
create function pg_temp.row_of(p_name text) returns jsonb language sql as $$ select e from it, jsonb_array_elements(j -> 'rows') e where e ->> 'name' like p_name || '%' $$;
create function pg_temp.rv(p_name text, p_key text) returns numeric language sql as $$ select (pg_temp.row_of(p_name) ->> p_key)::numeric $$;

select is((select array_agg(k order by k collate "C") from it, jsonb_object_keys(j) k), array['final', 'from', 'period', 'role', 'rows', 'to', 'totals'], 'the reply has exactly the keys of plan §3.2');
select is((select j ->> 'role' from it), 'owner', 'the role is owner');
select is((select array[j ->> 'period', j ->> 'from', j ->> 'to'] from it), array['day', '1998-11-04', '1998-11-04'], 'the period and its dates');
select is((select array_agg(e ->> 'name' order by o) from it, jsonb_array_elements(j -> 'rows') with ordinality t(e, o)),
          array['Tagliatelle al ragù (demo)', 'Spezzatino con polenta (demo)', 'Acqua (demo)', 'Vino rosso (demo)'], 'rows are ordered by plates descending: Tagliatelle, Spezzatino, Acqua, Vino');

-- AT1 (per-item rows) ---------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.rv('Tagliatelle', 'plates'), 3.5::numeric, 'Tagliatelle plates 3,5 (the line voided after firing is out)');
select is(pg_temp.rv('Tagliatelle', 'mixPct'), 38.89::numeric, 'mixPct 38,89');
select is(pg_temp.rv('Tagliatelle', 'revenueNetEur'), 39.7728::numeric, 'revenueNetEur 39,7728');
select is(pg_temp.rv('Tagliatelle', 'foodCostEur'), 10.85::numeric, 'foodCostEur 10,85');
select is(pg_temp.rv('Tagliatelle', 'foodCostPct'), 27.28::numeric, 'foodCostPct 27,28');
select is(pg_temp.rv('Tagliatelle', 'foodMarginPerPlateEur'), 8.2637::numeric, 'foodMarginPerPlateEur 8,2637');
select is(pg_temp.row_of('Tagliatelle') ->> 'status', 'costed', 'status costed');
select is(pg_temp.rv('Tagliatelle', 'costedPlates'), 3.5::numeric, 'costedPlates 3,5');
select is(pg_temp.rv('Spezzatino', 'plates'), 2.5::numeric, 'Spezzatino plates 2,5 (2 + a half)');
select is(pg_temp.rv('Spezzatino', 'mixPct'), 27.78::numeric, 'mixPct 27,78');
select is(pg_temp.rv('Spezzatino', 'revenueNetEur'), 31.8181::numeric, 'revenueNetEur 31,8181');
select is(pg_temp.rv('Spezzatino', 'foodCostEur'), 10.50::numeric, 'foodCostEur 10,50');
select is(pg_temp.rv('Spezzatino', 'foodMarginPerPlateEur'), 8.5272::numeric, 'foodMarginPerPlateEur 8,5272');
select is(pg_temp.rv('Spezzatino', 'fixedCostPerPlateEur'), 5.0000::numeric, 'owner: fixedCostPerPlateEur 5,0000 (300,00 / 60 plates)');
select is(pg_temp.rv('Spezzatino', 'grossMarginPerPlateEur'), 3.5272::numeric, 'grossMarginPerPlateEur 3,5272');
select is(pg_temp.rv('Spezzatino', 'contributionEur'), 8.8181::numeric, 'contributionEur 8,8181 (from the unrounded margin: 3,52724 x 2,5)');
select is(pg_temp.row_of('Spezzatino') -> 'fixedCostReason', 'null'::jsonb, 'with no reason');
select is(pg_temp.rv('Tagliatelle', 'contributionEur'), 11.4228::numeric, 'Tagliatelle contributionEur 11,4228');
select is(array[pg_temp.row_of('Vino') ->> 'status', pg_temp.row_of('Acqua') ->> 'status'], array['unmapped', 'unmapped'], 'Vino and Acqua are unmapped');
select is(pg_temp.row_of('Vino') -> 'foodCostEur', 'null'::jsonb, 'Vino: foodCostEur null, never 0');
select is(pg_temp.row_of('Vino') -> 'foodMarginPerPlateEur', 'null'::jsonb, 'foodMarginPerPlateEur null');
select is(pg_temp.row_of('Vino') -> 'foodCostPct', 'null'::jsonb, 'foodCostPct null');
select is(array[pg_temp.rv('Vino', 'mixPct'), pg_temp.rv('Acqua', 'mixPct')], array[11.11, 22.22]::numeric[], 'mix 11,11 and 22,22');
select is(array[pg_temp.rv('Vino', 'plates'), pg_temp.rv('Vino', 'revenueNetEur'), pg_temp.rv('Vino', 'costedPlates')], array[1, 32.9918, 0]::numeric[], 'Vino sold 1 plate for 32,9918 net, none costed');
select is(array[pg_temp.row_of('Vino') -> 'fixedCostPerPlateEur', pg_temp.row_of('Vino') -> 'contributionEur'], array['null', 'null']::jsonb[], 'an unmapped item has no owner figures either');
select is((select j -> 'totals' from it), '{"plates": 9, "revenueNetEur": 110.0372, "costedRevenueNetEur": 71.5909, "foodCostEur": 21.35, "foodCostPct": 29.82}'::jsonb, 'totals');

-- AT2 (SQL): the item rows add up to the totals, and the totals are the report's figures --------------------------------------------------------------
select is((select round(sum((e ->> 'foodCostEur')::numeric) / sum((e ->> 'costedRevenueNetEur')::numeric) * 100, 2) from it, jsonb_array_elements(j -> 'rows') e), 29.82::numeric,
          'AT2: round(sum foodCostEur / sum costedRevenueNetEur x 100, 2) over the rows = 29,82');
select is((select sum((e ->> 'foodCostEur')::numeric) from it, jsonb_array_elements(j -> 'rows') e), (select (j -> 'totals' ->> 'foodCostEur')::numeric from it), 'the rows'' food cost adds up to the total');
select is((select sum((e ->> 'costedRevenueNetEur')::numeric) from it, jsonb_array_elements(j -> 'rows') e), (select (j -> 'totals' ->> 'costedRevenueNetEur')::numeric from it), 'and the costed revenue');
select is((select (j -> 'totals' ->> 'foodCostPct')::numeric from it),
          (app.kpi_report_json('11111111-1111-4111-8111-111111111111', 'owner', 'day', '1998-11-04', null, null, '1998-11-05 08:00+00') -> 'current' ->> 'foodCostPct')::numeric,
          'AT2: the items total food cost % equals kpi_report.current.foodCostPct');
create function pg_temp.same_totals(p_period text, p_date date, p_from date, p_to date, p_now timestamptz) returns boolean language plpgsql as $$
declare
  i jsonb := app.kpi_items_json('11111111-1111-4111-8111-111111111111', 'owner', p_period, p_date, p_from, p_to, p_now);
  r jsonb := app.kpi_report_json('11111111-1111-4111-8111-111111111111', 'owner', p_period, p_date, p_from, p_to, p_now) -> 'current';
begin
  return (i -> 'totals' ->> 'foodCostPct')::numeric is not distinct from (r ->> 'foodCostPct')::numeric
     and (i -> 'totals' ->> 'foodCostEur')::numeric = (r ->> 'foodCostEur')::numeric
     and (i -> 'totals' ->> 'costedRevenueNetEur')::numeric = (r ->> 'costedRevenueNetEur')::numeric
     and (i -> 'totals' ->> 'plates')::numeric = (r ->> 'plates')::numeric
     and (i -> 'totals' ->> 'revenueNetEur')::numeric + (r ->> 'copertoNetEur')::numeric = (r ->> 'revenueNetEur')::numeric
     and (select round(sum((e ->> 'foodCostEur')::numeric) / nullif(sum((e ->> 'costedRevenueNetEur')::numeric), 0) * 100, 2) from jsonb_array_elements(i -> 'rows') e)
         is not distinct from (r ->> 'foodCostPct')::numeric;
end
$$;
select is(pg_temp.same_totals('week', '1998-11-04', null, null, '1998-11-05 08:00+00'), true, 'AT2: the same equalities hold for the week');
select is(pg_temp.same_totals('custom', null, '1998-10-05', '1998-11-04', '1998-11-05 08:00+00'), true, 'and for a 31-day custom range (the 56 plates of 11-01 included)');
select is(pg_temp.same_totals('custom', null, '1998-11-04', '1998-11-10', '1998-11-12 08:00+00'), true, 'and for a range with an incomplete cost');

-- Partial and incomplete ---------------------------------------------------------------------------------------------------------------------------
create temporary table itp as select app.kpi_items_json('11111111-1111-4111-8111-111111111111', 'owner', 'custom', null, '1998-11-04', '1998-11-10', '1998-11-12 08:00+00') as j;
select is((select e ->> 'status' from itp, jsonb_array_elements(j -> 'rows') e where e ->> 'name' like 'Tagliatelle%'), 'partial', 'a Tagliatelle line with an incomplete cost: status partial');
select is((select (e ->> 'costedPlates')::numeric < (e ->> 'plates')::numeric from itp, jsonb_array_elements(j -> 'rows') e where e ->> 'name' like 'Tagliatelle%'), true, 'costedPlates < plates');
select is((select array[(e ->> 'plates')::numeric, (e ->> 'costedPlates')::numeric] from itp, jsonb_array_elements(j -> 'rows') e where e ->> 'name' like 'Tagliatelle%'), array[6.5, 4.5]::numeric[], '6,5 plates, 4,5 costed');
create temporary table iti as select app.kpi_items_json('11111111-1111-4111-8111-111111111111', 'owner', 'day', '1998-11-10', null, null, '1998-11-12 08:00+00') as j;
select is((select e ->> 'status' from iti, jsonb_array_elements(j -> 'rows') e where e ->> 'name' like 'Tagliatelle%'), 'incomplete', 'a mapped item whose only line has an incomplete cost: status incomplete');
select is((select e -> 'foodCostEur' from iti, jsonb_array_elements(j -> 'rows') e where e ->> 'name' like 'Tagliatelle%'), 'null'::jsonb, 'with no food cost');
select is((select e -> 'contributionEur' from iti, jsonb_array_elements(j -> 'rows') e where e ->> 'name' like 'Tagliatelle%'), 'null'::jsonb, 'and no contribution');

-- Owner vs admin ---------------------------------------------------------------------------------------------------------------------------------------
create temporary table ita as select app.kpi_items_json('11111111-1111-4111-8111-111111111111', 'admin', 'day', '1998-11-04', null, null, '1998-11-05 08:00+00') as j;
select is((select j ->> 'role' from ita), 'admin', 'the admin reply says role admin');
select is((select array_agg(k order by k collate "C") from ita, jsonb_array_elements(j -> 'rows') e, jsonb_object_keys(e) k where e ->> 'name' like 'Spezzatino%'),
          (select array_agg(k order by k collate "C") from unnest(array['menuItemId', 'name', 'course', 'plates', 'mixPct', 'revenueNetEur', 'costedPlates', 'costedRevenueNetEur', 'foodCostEur',
                                                                       'foodCostPct', 'foodMarginPerPlateEur', 'status', 'weightG', 'avgWeightG']) k),
          'an admin row has exactly the keys of itemBase + weightG and avgWeightG (extended on purpose by P2-0b A5)');
select is((select (e ? 'fixedCostPerPlateEur') from ita, jsonb_array_elements(j -> 'rows') e where e ->> 'name' like 'Spezzatino%'), false, 'admin: no fixedCostPerPlateEur');
select is((select (e ? 'grossMarginPerPlateEur') from ita, jsonb_array_elements(j -> 'rows') e where e ->> 'name' like 'Spezzatino%'), false, 'admin: no grossMarginPerPlateEur');
select is((select (e ? 'contributionEur') from ita, jsonb_array_elements(j -> 'rows') e where e ->> 'name' like 'Spezzatino%'), false, 'admin: no contributionEur');
select is((select (e ? 'fixedCostReason') from ita, jsonb_array_elements(j -> 'rows') e where e ->> 'name' like 'Spezzatino%'), false, 'admin: no fixedCostReason');
select is((select j::text ~* '"[a-z]*(fixed|rent|labour|utilit|gross|contribution)[a-z]*":' from ita), false, 'a recursive walk of the admin reply finds no fixed-cost, rent, labour, utility, gross or contribution key');
select is((select j -> 'rows' from ita), (select jsonb_agg(e - 'fixedCostPerPlateEur' - 'grossMarginPerPlateEur' - 'contributionEur' - 'fixedCostReason' order by o) from it, jsonb_array_elements(j -> 'rows') with ordinality t(e, o)),
          'otherwise the admin rows are the owner rows');

-- Fixed cost reasons -------------------------------------------------------------------------------------------------------------------------------
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_at, opened_by, business_date, created_by, updated_by) values
  ('14000000-0000-4000-8000-00000000000b', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000006', 'Tavolo 6 (demo)', 2, '1997-11-20 18:30+00', 'd1000000-0000-4000-8000-00000000000d', '1997-11-20', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d');
select pg_temp.addl(16, '14000000-0000-4000-8000-00000000000b', '11000000-0000-4000-8000-000000000002', 'primi', 1, 12.50, 10, 'fired', '1997-11-20 18:35+00', 'ed000000-0000-4000-8000-0000000000d2', 3.10);
select pg_temp.close_s('14000000-0000-4000-8000-00000000000b', '1997-11-20 20:00+00', '1997-11-20', 12.50);
create temporary table itn as select app.kpi_items_json('11111111-1111-4111-8111-111111111111', 'owner', 'day', '1997-11-20', null, null, '1998-11-05 08:00+00') as j;
select is((select array[e -> 'fixedCostReason'] from (select e from (select app.kpi_items_json('11111111-1111-4111-8111-111111111111', 'owner', 'day', '1998-10-28', null, null, '1998-11-05 08:00+00') j) x,
            jsonb_array_elements(j -> 'rows') e) y), array['"no_sales"']::jsonb[], 'a period in force (January) and no plate sold in the 30 days before 10-28: no_sales');
select is((select array[e -> 'fixedCostPerPlateEur', e -> 'grossMarginPerPlateEur', e -> 'contributionEur', e -> 'fixedCostReason'] from itn, jsonb_array_elements(j -> 'rows') e),
          array['null', 'null', 'null', '"no_fixed_costs"']::jsonb[], 'no fixed cost period in force on 1997-11-20: the three owner figures are null, the reason is no_fixed_costs');
create temporary table its as select app.kpi_items_json('11111111-1111-4111-8111-111111111111', 'owner', 'day', '1998-01-15', null, null, '1998-11-05 08:00+00') as j;
select is((select array[e -> 'fixedCostPerPlateEur', e -> 'fixedCostReason'] from its, jsonb_array_elements(j -> 'rows') e), array['null', '"no_sales"']::jsonb[],
          'a fixed cost in force and no plate sold in the 30 days before: no_sales');

-- Finality flag ---------------------------------------------------------------------------------------------------------------------------------------
select is((select j ->> 'final' from it), 'false', 'before the rollup D is not final');
select app.rollup_daily_kpi('1998-11-05 08:00:00+00');
select is((app.kpi_items_json('11111111-1111-4111-8111-111111111111', 'owner', 'day', '1998-11-04', null, null, '1998-11-05 08:00+00') ->> 'final'), 'true', 'after it D is final');
select is(app.kpi_items_json('11111111-1111-4111-8111-111111111111', 'owner', 'day', '1998-11-04', null, null, '1998-11-05 08:00+00') -> 'rows', (select j -> 'rows' from it), 'with the same rows');

-- Wrapper, roles, tenancy -----------------------------------------------------------------------------------------------------------------------
select is((public.kpi_items('day', '1998-09-15', null, null) ->> 'role'), 'owner', 'public.kpi_items as owner A answers for a past date');
select is((public.kpi_items('day', '1998-09-15', null, null) -> 'rows' -> 0 ->> 'plates')::numeric, 2::numeric, 'with its plates');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is((public.kpi_items('day', '1998-09-15', null, null) ->> 'role'), 'admin', 'as admin: role admin');
select is(((public.kpi_items('day', '1998-09-15', null, null) -> 'rows' -> 0) ? 'contributionEur'), false, 'and no contribution');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.err($$select public.kpi_items('day', null, null, null)$$), '42501 permission denied: the day close needs owner or admin', 'the chef: 42501');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(pg_temp.err($$select public.kpi_items('day', null, null, null)$$), '42501 permission denied: the day close needs owner or admin', 'the waiter: 42501');
select is((select bool_or(has_function_privilege(r, 'public.kpi_items(text, date, date, date)', 'execute')) from unnest(array['anon', 'service_role']) r), false, 'anon and service_role cannot execute kpi_items');
select is((select has_function_privilege('authenticated', 'public.kpi_items(text, date, date, date)', 'execute')), true, 'authenticated can');
select is((select has_function_privilege('authenticated', 'app.kpi_items_json(uuid, text, text, date, date, date, timestamptz)', 'execute')), false, 'but not the twin');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
create temporary table itb as select app.kpi_items_json('22222222-2222-4222-8222-222222222222', 'owner', 'day', '1998-11-04', null, null, '1998-11-05 08:00+00') as j;
select is((select array_agg(e ->> 'name') from itb, jsonb_array_elements(j -> 'rows') e), array['Acqua B (demo)'], 'owner B sees only its own item');
select is((select j::text ~ '(Spezzatino|Tagliatelle|Vino)' from itb), false, 'and none of A''s names');

select * from finish();
