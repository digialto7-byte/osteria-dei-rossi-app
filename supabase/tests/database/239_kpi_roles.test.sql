-- M22 step 8 (docs/plans/2026-10-31-m22-kpi-reporting.md §3.7, §5; ADR-025; AT8): the role and tenancy matrix of everything M22 adds. Project V6 is in force: the chef has no M22 endpoint.
-- The waiter and the chef get 42501 on the six public functions; the admin gets five (not record_dashboard_open); the owner all six. No API role executes any app.* function of M22, all
-- are definers with an empty search_path, no reply carries the other tenant's uuids. Two tenants. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

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

-- A closed monthly pair of counts per tenant, so that avt_report has something to say (the AVT arithmetic is proved by 236).
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)'),
  ('10000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Cella B (demo)');
insert into public.ingredient (id, tenant_id, name, base_unit) values ('1e000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Manzo (demo)', 'kg');
insert into public.ingredient (id, tenant_id, name, base_unit) values ('2e000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Burro B (demo)', 'kg');
create function pg_temp.mk_count(p_id uuid, p_tenant uuid, p_loc uuid, p_ing uuid, p_user uuid, p_counted numeric, p_closed timestamptz) returns void language plpgsql as $$
begin
  insert into public.count_session (id, tenant_id, location_id, type, started_at, started_by) values (p_id, p_tenant, p_loc, 'monthly', p_closed - interval '1 hour', p_user);
  insert into public.count_line (tenant_id, session_id, ingredient_id, position, expected_qty, counted_qty, entered_at, entered_by, created_by)
    values (p_tenant, p_id, p_ing, 1, p_counted, p_counted, p_closed - interval '30 minutes', p_user, p_user);
  update public.count_session set status = 'closed', closed_at = p_closed, closed_by = p_user where id = p_id;
end
$$;
select pg_temp.mk_count('c5000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '10000000-0000-4000-8000-0000000000a1', '1e000000-0000-4000-8000-000000000001',
                        'a1000000-0000-4000-8000-00000000000a', 10, '2026-11-01 10:00+00');
select pg_temp.mk_count('c5000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', '10000000-0000-4000-8000-0000000000a1', '1e000000-0000-4000-8000-000000000001',
                        'a1000000-0000-4000-8000-00000000000a', 8, '2026-11-30 10:00+00');
select pg_temp.mk_count('c5000000-0000-4000-8000-000000000011', '22222222-2222-4222-8222-222222222222', '10000000-0000-4000-8000-0000000000b1', '2e000000-0000-4000-8000-000000000001',
                        'b1000000-0000-4000-8000-00000000000b', 3, '2026-11-01 10:00+00');
select pg_temp.mk_count('c5000000-0000-4000-8000-000000000012', '22222222-2222-4222-8222-222222222222', '10000000-0000-4000-8000-0000000000b1', '2e000000-0000-4000-8000-000000000001',
                        'b1000000-0000-4000-8000-00000000000b', 2, '2026-11-30 10:00+00');
-- Past dates for the public wrappers (the real now() is later than 2026-10-31).
select pg_temp.close_s('14000000-0000-4000-8000-000000000004', '2026-11-04 23:50+00', '2026-11-04', 14.00);

create function pg_temp.call_as(p_who text, p_sql text) returns text language plpgsql as $$
declare
  v text;
begin
  perform pg_temp.act_as(
    case p_who when 'owner' then 'a0000000-0000-4000-8000-00000000000a' when 'admin' then 'f0000000-0000-4000-8000-00000000000f'
               when 'chef' then 'c0000000-0000-4000-8000-00000000000c' when 'waiter' then 'd0000000-0000-4000-8000-00000000000d'
               when 'ownerb' then 'b0000000-0000-4000-8000-00000000000b' end::uuid,
    case p_who when 'ownerb' then '22222222-2222-4222-8222-222222222222' else '11111111-1111-4111-8111-111111111111' end::uuid,
    case p_who when 'ownerb' then 'owner' else p_who end);
  begin
    execute p_sql into v;
  exception when others then
    get stacked diagnostics v = returned_sqlstate;
    perform set_config('request.jwt.claims', '', true);
    return v;
  end;
  perform set_config('request.jwt.claims', '', true);
  return 'ok';
end
$$;

-- Role matrix (AT8, project V6 in force) -----------------------------------------------------------------------------------------------------------------
create temporary table fns (name text, call text);
insert into fns values
  ('kpi_report', $$select public.kpi_report('day', '2026-09-15', null, null)::text$$),
  ('kpi_items', $$select public.kpi_items('day', '2026-09-15', null, null)::text$$),
  ('avt_report', $$select public.avt_report(null)::text$$),
  ('unmapped_items', $$select public.unmapped_items('2026-09-15')::text$$),
  ('dashboard_summary', $$select public.dashboard_summary()::text$$),
  ('record_dashboard_open', $$select public.record_dashboard_open()::text$$);
select is((select array_agg(f.name order by f.name collate "C") from fns f where pg_temp.call_as('waiter', f.call) = '42501'),
          (select array_agg(name order by name collate "C") from fns), 'the waiter gets 42501 on all six functions');
select is((select array_agg(f.name order by f.name collate "C") from fns f where pg_temp.call_as('chef', f.call) = '42501'),
          (select array_agg(name order by name collate "C") from fns), 'the chef gets 42501 on all six functions (project V6: no M22 endpoint for the chef)');
select is((select array_agg(f.name order by f.name collate "C") from fns f where pg_temp.call_as('none', f.call) = '42501'),
          (select array_agg(name order by name collate "C") from fns), 'no claims: 42501 on all six');
select is((select array_agg(f.name order by f.name collate "C") from fns f where pg_temp.call_as('owner', f.call) = 'ok'),
          (select array_agg(name order by name collate "C") from fns), 'the owner may call all six');
select is((select array_agg(f.name order by f.name collate "C") from fns f where pg_temp.call_as('admin', f.call) = 'ok'),
          (select array_agg(name order by name collate "C") from fns where name <> 'record_dashboard_open'), 'the admin may call five; record_dashboard_open is the owner''s alone');
select is(pg_temp.call_as('admin', $$select public.record_dashboard_open()$$), '42501', 'the admin gets 42501 on record_dashboard_open');
select is((select count(*)::int from public.dashboard_open where tenant_id = '11111111-1111-4111-8111-111111111111' and app_user_id <> 'a1000000-0000-4000-8000-00000000000a'), 0, 'and no row was written for anyone else');
select is((select count(*)::int from public.dashboard_open where tenant_id = '11111111-1111-4111-8111-111111111111'), 1, 'the owner''s call wrote exactly one row');

-- Privileges ------------------------------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from unnest(array['public.kpi_report(text, date, date, date)', 'public.kpi_items(text, date, date, date)', 'public.avt_report(uuid)', 'public.unmapped_items(date)',
              'public.dashboard_summary()', 'public.record_dashboard_open()']) f where has_function_privilege('anon', f, 'execute')), 0, 'anon cannot execute any of the six');
select is((select count(*)::int from unnest(array['public.kpi_report(text, date, date, date)', 'public.kpi_items(text, date, date, date)', 'public.avt_report(uuid)', 'public.unmapped_items(date)',
              'public.dashboard_summary()', 'public.record_dashboard_open()']) f where has_function_privilege('service_role', f, 'execute')), 0, 'nor service_role');
select is((select count(*)::int from unnest(array['public.kpi_report(text, date, date, date)', 'public.kpi_items(text, date, date, date)', 'public.avt_report(uuid)', 'public.unmapped_items(date)',
              'public.dashboard_summary()', 'public.record_dashboard_open()']) f where has_function_privilege('authenticated', f, 'execute')), 6, 'authenticated can execute all six');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'app' and (p.proname ~ '^kpi_' or p.proname in ('avt_rows', 'avt_available_counts', 'rollup_daily_kpi', 'dashboard_yesterday', 'dashboard_summary_at', 'record_dashboard_open_at',
                                                                             'unmapped_items_json', 'plates_sold'))), 
          (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'app' and (p.proname ~ '^kpi_' or p.proname in ('avt_rows', 'avt_available_counts', 'rollup_daily_kpi', 'dashboard_yesterday', 'dashboard_summary_at', 'record_dashboard_open_at',
                                                                             'unmapped_items_json', 'plates_sold')) and not exists (select 1 from unnest(array['anon', 'authenticated', 'service_role']) r where has_function_privilege(r, p.oid, 'execute'))),
          'no API role executes any app.kpi_*, app.avt_*, app.rollup_daily_kpi, app.*_json, app.*_at or app.plates_sold');
select ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname ~ '^kpi_') >= 13, 'the app.kpi_* functions exist (guard against an empty match)');
select is((select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text collate "C")
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'app' and (p.proname ~ '^kpi_' and p.proname not in ('kpi_finalise_grace', 'kpi_rollup_max_days')
                                         or p.proname in ('avt_rows', 'rollup_daily_kpi', 'dashboard_yesterday', 'dashboard_summary_at', 'record_dashboard_open_at', 'unmapped_items_json', 'plates_sold'))
              and not (p.prosecdef and p.proconfig = array['search_path=""'])), null, 'every one is a definer with an empty search_path');
select is((select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text collate "C")
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('kpi_report', 'kpi_items', 'avt_report', 'unmapped_items', 'record_dashboard_open', 'dashboard_summary')
              and not (p.prosecdef and p.proconfig = array['search_path=""'])), null, 'and so are the six public functions');
select is((select string_agg(proname::text, ',' order by proname::text collate "C") from pg_proc
            where pronamespace = 'public'::regnamespace and proname ~* '(cost|margin|price)'),
          'batch_costs,cost_settings,count_variance_costs,enter_fixed_costs,fixed_cost_status,ingredient_costs,plate_costs,plate_margins_pct,raw_waste_costs,recipe_cost_at,recipe_costs,set_ingredient_cost_basis,update_cost_settings,waste_costs',
          'the cost-named public functions are those of 207 (the 059 list): M22 adds none (kpi_report, kpi_items, avt_report, unmapped_items, record_dashboard_open match no cost, margin or price)');

-- Tenancy: no reply carries the other tenant's uuids -------------------------------------------------------------------------------------------------
create temporary table ids (tenant text, id text);
insert into ids select 'a', x from unnest(array[
  '11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', 'c1000000-0000-4000-8000-00000000000c', 'd1000000-0000-4000-8000-00000000000d', 'f1000000-0000-4000-8000-00000000000f',
  '11000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000003', '11000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-0000000000a1', '1e000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000002']) x;
insert into ids select 'b', x from unnest(array[
  '22222222-2222-4222-8222-222222222222', 'b1000000-0000-4000-8000-00000000000b', '21000000-0000-4000-8000-000000000001', '24000000-0000-4000-8000-000000000001',
  '25000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-0000000000b1', '2e000000-0000-4000-8000-000000000001',
  'c5000000-0000-4000-8000-000000000011', 'c5000000-0000-4000-8000-000000000012']) x;
create function pg_temp.replies(p_who text) returns text language plpgsql as $$
declare
  v_t uuid := case p_who when 'b' then '22222222-2222-4222-8222-222222222222' else '11111111-1111-4111-8111-111111111111' end;
  v_out text := '';
begin
  perform pg_temp.act_as(case p_who when 'b' then 'b0000000-0000-4000-8000-00000000000b' else 'a0000000-0000-4000-8000-00000000000a' end::uuid, v_t, 'owner');
  v_out := v_out || app.kpi_report_json(v_t, 'owner', 'week', '2026-11-04', null, null, '2026-11-05 08:00+00')::text;
  v_out := v_out || app.kpi_items_json(v_t, 'owner', 'week', '2026-11-04', null, null, '2026-11-05 08:00+00')::text;
  v_out := v_out || app.unmapped_items_json(v_t, '2026-11-04', '2026-11-05 08:00+00')::text;
  v_out := v_out || app.dashboard_summary_at(v_t, 'owner', '2026-11-05 08:00+00')::text;
  v_out := v_out || public.avt_report(null)::text;
  v_out := v_out || app.record_dashboard_open_at(v_t, case p_who when 'b' then 'b1000000-0000-4000-8000-00000000000b' else 'a1000000-0000-4000-8000-00000000000a' end::uuid, '2026-11-05 08:00+00')::text;
  perform set_config('request.jwt.claims', '', true);
  return v_out;
end
$$;
create temporary table rep_a as select pg_temp.replies('a') as t;
create temporary table rep_b as select pg_temp.replies('b') as t;
select ok((select count(*) from rep_a, regexp_matches(t, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'g') m) > 5, 'owner A''s replies carry uuids (the scan is not vacuous)');
select ok((select count(*) from rep_b, regexp_matches(t, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'g') m) > 2, 'owner B''s replies carry uuids too');
select is((select count(*)::int from rep_a, regexp_matches(t, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'g') m where m[1] in (select id from ids where tenant = 'b')), 0,
          'a recursive scan of owner A''s replies finds none of tenant B''s uuids');
select is((select count(*)::int from rep_b, regexp_matches(t, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'g') m where m[1] in (select id from ids where tenant = 'a')), 0,
          'and owner B''s replies none of tenant A''s');
select is((select t ~ '(Spezzatino|Tagliatelle|Vino|Acqua \(demo\)|Manzo)' from rep_b), false, 'owner B''s replies name none of A''s items or ingredients');
select is((select t ~ '(Acqua B|Burro B)' from rep_a), false, 'and owner A''s name none of B''s');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is((select (app.kpi_report_json('22222222-2222-4222-8222-222222222222', 'owner', 'day', '2026-11-04', null, null, '2026-11-05 08:00+00') -> 'current' ->> 'revenueGrossEur')::numeric), 999::numeric, 'B''s own report holds its 999,00');
select set_config('request.jwt.claims', '', true);

-- Row level security of the two tables (also proved by 231) ----------------------------------------------------------------------------------------
select is((select array_agg(relname::text order by relname::text collate "C") from pg_class where relname in ('daily_kpi', 'dashboard_open') and relnamespace = 'public'::regnamespace and relrowsecurity), array['daily_kpi', 'dashboard_open'], 'RLS is on for both tables');
select is((select array_agg(policyname::text order by policyname::text collate "C") from pg_policies where schemaname = 'public' and tablename in ('daily_kpi', 'dashboard_open')), array['daily_kpi_select', 'dashboard_open_select'],
          'each has one select policy and no write policy');

select * from finish();
