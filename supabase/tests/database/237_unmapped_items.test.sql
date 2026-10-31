-- M22 step 6 (docs/plans/2026-10-31-m22-kpi-reporting.md §3.2, §5; ADR-025; AT5): app.unmapped_items_json and public.unmapped_items. The items sold in an ISO week with no recipe at the
-- time of the sale (the frozen order_line_cost.recipe_id is null), by plates, with the gross revenue and the last business date. The business date of a close comes from
-- app.business_date, so the week edge at the autumn change (2026-10-25/26) is proved too. Two tenants. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

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

-- More tables: an unmapped sale on 2026-11-09 (next week), a table with a Vino voided after firing and a Tagliatelle on 2026-11-03, and three tables around the autumn change.
-- Their business date is computed by app.business_date from the instant of the close, as close_table does.
create function pg_temp.sess(p_id uuid, p_table int, p_opened timestamptz, p_closed timestamptz, p_total numeric) returns void language plpgsql as $$
begin
  insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_at, opened_by, business_date, created_by, updated_by)
    values (p_id, '11111111-1111-4111-8111-111111111111', ('13000000-0000-4000-8000-00000000000' || p_table)::uuid, 'Tavolo ' || p_table || ' (demo)', 2, p_opened,
            'd1000000-0000-4000-8000-00000000000d', app.business_date('11111111-1111-4111-8111-111111111111', p_opened), 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d');
end
$$;
select pg_temp.sess('14000000-0000-4000-8000-000000000011', 1, '2026-11-09 18:00+00', '2026-11-09 20:00+00', 9.00);
select pg_temp.addl(21, '14000000-0000-4000-8000-000000000011', '11000000-0000-4000-8000-000000000003', 'bevande', 3, 3.00, 10, 'fired', '2026-11-09 18:05+00', null, null);
select pg_temp.close_s('14000000-0000-4000-8000-000000000011', '2026-11-09 20:00+00', app.business_date('11111111-1111-4111-8111-111111111111', '2026-11-09 20:00+00'), 9.00);
select pg_temp.sess('14000000-0000-4000-8000-000000000012', 2, '2026-11-03 18:00+00', '2026-11-03 20:00+00', 12.50);
select pg_temp.addl(22, '14000000-0000-4000-8000-000000000012', '11000000-0000-4000-8000-000000000004', 'bevande', 1, 40.25, 22, 'voided', '2026-11-03 18:05+00', null, null);
select pg_temp.addl(23, '14000000-0000-4000-8000-000000000012', '11000000-0000-4000-8000-000000000002', 'primi', 1, 12.50, 10, 'fired', '2026-11-03 18:06+00', 'ed000000-0000-4000-8000-0000000000d2', 3.10);
select pg_temp.close_s('14000000-0000-4000-8000-000000000012', '2026-11-03 20:00+00', app.business_date('11111111-1111-4111-8111-111111111111', '2026-11-03 20:00+00'), 12.50);
-- Autumn change: Sunday 10-25 23:30 local (22:30Z), Monday 10-26 00:30 local (23:30Z on 10-25) and Monday 10-26 02:30 local (01:30Z), one Acqua each.
select pg_temp.sess('14000000-0000-4000-8000-000000000013', 3, '2026-10-25 20:00+00', '2026-10-25 22:30+00', 3.00);
select pg_temp.addl(24, '14000000-0000-4000-8000-000000000013', '11000000-0000-4000-8000-000000000003', 'bevande', 1, 3.00, 10, 'fired', '2026-10-25 20:05+00', null, null);
select pg_temp.close_s('14000000-0000-4000-8000-000000000013', '2026-10-25 22:30+00', app.business_date('11111111-1111-4111-8111-111111111111', '2026-10-25 22:30+00'), 3.00);
select pg_temp.sess('14000000-0000-4000-8000-000000000014', 3, '2026-10-25 22:40+00', '2026-10-25 23:30+00', 3.00);
select pg_temp.addl(25, '14000000-0000-4000-8000-000000000014', '11000000-0000-4000-8000-000000000003', 'bevande', 1, 3.00, 10, 'fired', '2026-10-25 22:45+00', null, null);
select pg_temp.close_s('14000000-0000-4000-8000-000000000014', '2026-10-25 23:30+00', app.business_date('11111111-1111-4111-8111-111111111111', '2026-10-25 23:30+00'), 3.00);
select pg_temp.sess('14000000-0000-4000-8000-000000000015', 3, '2026-10-26 00:30+00', '2026-10-26 01:30+00', 3.00);
select pg_temp.addl(26, '14000000-0000-4000-8000-000000000015', '11000000-0000-4000-8000-000000000003', 'bevande', 1, 3.00, 10, 'fired', '2026-10-26 00:35+00', null, null);
select pg_temp.close_s('14000000-0000-4000-8000-000000000015', '2026-10-26 01:30+00', app.business_date('11111111-1111-4111-8111-111111111111', '2026-10-26 01:30+00'), 3.00);
-- A closed table on an absolute past date for the wrapper (which uses the real now()).
select pg_temp.sess('14000000-0000-4000-8000-000000000016', 5, '2026-09-15 18:00+00', '2026-09-15 20:00+00', 6.00);
select pg_temp.addl(27, '14000000-0000-4000-8000-000000000016', '11000000-0000-4000-8000-000000000003', 'bevande', 2, 3.00, 10, 'fired', '2026-09-15 18:05+00', null, null);
select pg_temp.close_s('14000000-0000-4000-8000-000000000016', '2026-09-15 20:00+00', '2026-09-15', 6.00);

select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
create function pg_temp.um(p_week date, p_now timestamptz default '2026-11-05 08:00+00') returns jsonb language sql as $$
  select app.unmapped_items_json('11111111-1111-4111-8111-111111111111', p_week, p_now)
$$;

select is((select array_agg(k order by k collate "C") from jsonb_object_keys(pg_temp.um('2026-11-04')) k), array['rows', 'totals', 'weekFrom', 'weekTo'], 'the reply has exactly the keys of plan §3.2');
select is(array[pg_temp.um('2026-11-04') ->> 'weekFrom', pg_temp.um('2026-11-04') ->> 'weekTo'], array['2026-11-02', '2026-11-08'], 'AT5: the week of D is 2026-11-02..08');
select is((select array_agg(e ->> 'name' order by o) from jsonb_array_elements(pg_temp.um('2026-11-04') -> 'rows') with ordinality t(e, o)), array['Acqua (demo)', 'Vino rosso (demo)'],
          'rows: Acqua, then Vino (plates descending)');
select is((select array_agg(k order by k collate "C") from jsonb_array_elements(pg_temp.um('2026-11-04') -> 'rows') e, jsonb_object_keys(e) k where e ->> 'name' like 'Acqua%'),
          array['lastSoldOn', 'menuItemId', 'name', 'plates', 'revenueGrossEur'], 'a row has exactly the keys of plan §3.2');
select is((select array[(e ->> 'plates')::numeric, (e ->> 'revenueGrossEur')::numeric] from jsonb_array_elements(pg_temp.um('2026-11-04') -> 'rows') e where e ->> 'name' like 'Acqua%'),
          array[2, 6.00]::numeric[], 'Acqua: 2 plates, 6,00');
select is((select array[(e ->> 'plates')::numeric, (e ->> 'revenueGrossEur')::numeric] from jsonb_array_elements(pg_temp.um('2026-11-04') -> 'rows') e where e ->> 'name' like 'Vino%'),
          array[1, 40.25]::numeric[], 'Vino: 1 plate, 40,25 (the Vino voided after firing on 11-03 is not sold)');
select is((select e ->> 'lastSoldOn' from jsonb_array_elements(pg_temp.um('2026-11-04') -> 'rows') e where e ->> 'name' like 'Acqua%'), '2026-11-04', 'lastSoldOn is the last business date');
select is(pg_temp.um('2026-11-04') -> 'totals', '{"plates": 3, "revenueGrossEur": 46.25}'::jsonb, 'totals: 3 plates, 46,25');
select is((select count(*)::int from jsonb_array_elements(pg_temp.um('2026-11-04') -> 'rows') e where e ->> 'name' like 'Tagliatelle%' or e ->> 'name' like 'Spezzatino%'), 0, 'mapped items are absent');
select is((select (e ->> 'plates')::numeric from jsonb_array_elements(pg_temp.um('2026-11-04') -> 'rows') e where e ->> 'name' like 'Acqua%'), 2::numeric,
          'the unmapped sale of 2026-11-09 (next week) is absent');
select is((select (e ->> 'plates')::numeric from jsonb_array_elements(pg_temp.um('2026-11-09', '2026-11-10 08:00+00') -> 'rows') e where e ->> 'name' like 'Acqua%'), 3::numeric, 'and it is in its own week (11-09..15)');
-- Mapped today, unmapped when fired.
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e3', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'acqua (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by) values
  ('ed000000-0000-4000-8000-0000000000d3', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e3', 1, '2026-10-01T00:00Z', 'Acqua (demo)', 'a1000000-0000-4000-8000-00000000000a');
update public.menu_item set recipe_key = 'ec000000-0000-4000-8000-0000000000e3' where id = '11000000-0000-4000-8000-000000000003';
select is((select (e ->> 'plates')::numeric from jsonb_array_elements(pg_temp.um('2026-11-04') -> 'rows') e where e ->> 'name' like 'Acqua%'), 2::numeric,
          'an item mapped today but fired unmapped is listed (the frozen cost row decides)');
-- Dates
select is(array[pg_temp.um(null) ->> 'weekFrom', pg_temp.um(null) ->> 'weekTo'], array['2026-11-02', '2026-11-08'], 'null is the week of p_now''s business date (2026-11-05)');
select is(array[pg_temp.um(null, '2026-11-09 00:30+00') ->> 'weekFrom', pg_temp.um(null, '2026-11-09 01:30+00') ->> 'weekFrom'], array['2026-11-02', '2026-11-09'],
          'at 01:30 local on Monday 11-09 the business date is still Sunday 11-08 (week of 11-02); after the 02:00 cut-off it is Monday 11-09');
select is(pg_temp.err($$select pg_temp.um('2026-11-06')$$), 'P0001 date_in_future', 'a date after today''s business date: date_in_future');
select is(pg_temp.err($$select pg_temp.um('2026-11-09')$$), 'P0001 date_in_future', 'a date of next week: date_in_future');
select is(pg_temp.err($$select pg_temp.um('2026-11-05')$$), 'ok', 'today itself is accepted (the week is shown provisionally)');
select is((select count(*)::int from jsonb_array_elements(pg_temp.um('2026-10-14') -> 'rows')), 0, 'a week with no unmapped sale: no row');
select is(pg_temp.um('2026-10-14') -> 'totals', '{"plates": 0, "revenueGrossEur": 0}'::jsonb, 'and zero totals');
-- Week edge at the autumn change
select is((select (e ->> 'plates')::numeric from jsonb_array_elements(pg_temp.um('2026-10-25') -> 'rows') e where e ->> 'name' like 'Acqua%'), 2::numeric,
          'Sunday 23:30 and Monday 00:30 local both have business date 10-25: both are in the week 10-19..25');
select is(array[pg_temp.um('2026-10-25') ->> 'weekFrom', pg_temp.um('2026-10-25') ->> 'weekTo'], array['2026-10-19', '2026-10-25'], 'the week of Sunday 10-25 is 10-19..25');
select is((select (e ->> 'plates')::numeric from jsonb_array_elements(pg_temp.um('2026-10-26') -> 'rows') e where e ->> 'name' like 'Acqua%'), 1::numeric,
          'Monday 02:30 local has business date 10-26: it is in the week 10-26..11-01');
select is((select business_date from app.kpi_session_rows('11111111-1111-4111-8111-111111111111', '2026-10-19', '2026-10-27') where session_id = '14000000-0000-4000-8000-000000000015'), '2026-10-26'::date,
          'the fixture''s business dates come from app.business_date');

-- Wrapper, roles, tenancy ----------------------------------------------------------------------------------------------------------------------
select is((public.unmapped_items('2026-09-15') -> 'totals' ->> 'plates')::numeric, 2::numeric, 'public.unmapped_items as owner answers for a past date');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is((public.unmapped_items('2026-09-15') -> 'totals' ->> 'plates')::numeric, 2::numeric, 'as admin too');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.err($$select public.unmapped_items(null)$$), '42501 permission denied: the day close needs owner or admin', 'the chef: 42501');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(pg_temp.err($$select public.unmapped_items(null)$$), '42501 permission denied: the day close needs owner or admin', 'the waiter: 42501');
select is((select has_function_privilege('authenticated', 'public.unmapped_items(date)', 'execute')), true, 'authenticated can execute unmapped_items');
select is((select bool_or(has_function_privilege(r, 'public.unmapped_items(date)', 'execute')) from unnest(array['anon', 'service_role']) r), false, 'anon and service_role cannot');
select is((select has_function_privilege('authenticated', 'app.unmapped_items_json(uuid, date, timestamptz)', 'execute')), false, 'nobody executes the twin');
select is((select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = 'app.unmapped_items_json(uuid, date, timestamptz)'::regprocedure), true, 'the twin is a definer with an empty search_path');
select is(app.unmapped_items_json('22222222-2222-4222-8222-222222222222', '2026-11-04', '2026-11-05 08:00+00') -> 'rows', '[{"menuItemId": "21000000-0000-4000-8000-000000000001", "name": "Acqua B (demo)", "plates": 1, "revenueGrossEur": 999.00, "lastSoldOn": "2026-11-04"}]'::jsonb,
          'tenant B sees its own unmapped item only');
select is(app.unmapped_items_json('22222222-2222-4222-8222-222222222222', '2026-11-04', '2026-11-05 08:00+00')::text ~ 'Vino|Acqua \(demo\)', false, 'and none of A''s');

select * from finish();
