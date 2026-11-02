-- M25c step 5 (docs/plans/2026-11-01-m25c-services.md §3.1.6, §3.1.7, §3.2, §3.8, §5 step 5; ADR-031): the per-service split (app.kpi_service_split, app.kpi_services_json,
-- public.kpi_services) and the day split (app.day_services_json, public.day_services) on the fixture day D = 2026-11-04 of the M22 plan §3.9 plus T5, a lunch table. The twins take
-- a fixed "now" (2026-11-05 09:00Z, 10:00 local); the wrappers are checked for roles and errors. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(98);

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

-- T5, the lunch table: opened 12:30 local (11:30Z), closed 14:10 (13:10Z), 2 covers, coperto 2 x 2,00 at 10 %, one Spezzatino at 14,00 (frozen cost 4,20): total 18,00.
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_at, opened_by, business_date, coperto_amount, coperto_vat_rate, created_by, updated_by) values
  ('14000000-0000-4000-8000-000000000009', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000005', 'Tavolo 5 (demo)', 2, '2026-11-04 11:30+00', 'd1000000-0000-4000-8000-00000000000d', '2026-11-04', 2.00, 10, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d');
select pg_temp.addl(12, '14000000-0000-4000-8000-000000000009', '11000000-0000-4000-8000-000000000001', 'secondi', 1, 14.00, 10, 'fired', '2026-11-04 11:40+00', 'ed000000-0000-4000-8000-0000000000d1', 4.20);
select pg_temp.close_s('14000000-0000-4000-8000-000000000009', '2026-11-04 13:10+00', '2026-11-04', 18.00);
-- A closed table on an absolute past date for the wrappers (they use the real clock), no lines.
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_at, opened_by, business_date, created_by, updated_by) values
  ('14000000-0000-4000-8000-000000000008', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000002', 'Tavolo 2 (demo)', 3, '2026-09-15 18:00+00',
   'd1000000-0000-4000-8000-00000000000d', '2026-09-15', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d');
select pg_temp.close_s('14000000-0000-4000-8000-000000000008', '2026-09-15 20:00+00', '2026-09-15', 28.00);
-- The register total of D, for the parity with the day close.
insert into public.day_close (tenant_id, business_date, register_total, created_at, created_by) values
  ('11111111-1111-4111-8111-111111111111', '2026-11-04', 150.00, '2026-11-05 00:30+00', 'a1000000-0000-4000-8000-00000000000a');

select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
create temporary table sp as select app.kpi_services_json('11111111-1111-4111-8111-111111111111', 'day', '2026-11-04', null, null, '2026-11-05 09:00+00') as j;
create temporary table rp as select app.kpi_report_json('11111111-1111-4111-8111-111111111111', 'owner', 'day', '2026-11-04', null, null, '2026-11-05 09:00+00') as j;
create function pg_temp.sv(p_k text, p_f text) returns numeric language sql as $$ select (s ->> p_f)::numeric from sp, jsonb_array_elements(j -> 'services') s where s ->> 'key' = p_k $$;
create function pg_temp.tot(p_f text) returns numeric language sql as $$ select (j -> 'total' ->> p_f)::numeric from sp $$;

-- The shape ------------------------------------------------------------------------------------------------------------------------------------
select is((select array_agg(k order by k collate "C") from sp, jsonb_object_keys(j) k), array['days', 'daysFinal', 'final', 'from', 'period', 'services', 'to', 'total'], 'the reply has exactly the eight keys of the plan');
select is((select j ->> 'period' || ',' || (j ->> 'from') || ',' || (j ->> 'to') || ',' || (j ->> 'final') || ',' || (j ->> 'daysFinal') || ',' || (j ->> 'days') from sp), 'day,2026-11-04,2026-11-04,true,1,1', 'period, dates and finality (D is final at 10:00 the next morning)');
select is(app.kpi_services_json('11111111-1111-4111-8111-111111111111', 'day', '2026-11-04', null, null, '2026-11-05 00:30+00') ->> 'final', 'false', 'and not final at 01:30 local');
select is((select array_agg(s ->> 'key' order by o) from sp, jsonb_array_elements(j -> 'services') with ordinality t(s, o)), array['pranzo', 'cena'], 'the services come in window order');
select is((select array_agg(k order by k collate "C") from sp, jsonb_array_elements(j -> 'services') s, jsonb_object_keys(s) k where s ->> 'key' = 'cena'),
          array['avgSpendPerCoverEur', 'avgTicketEur', 'costedRevenueNetEur', 'costedSharePct', 'covers', 'foodCostEur', 'foodCostPct', 'key', 'name', 'plates', 'position', 'revenueGrossEur', 'revenueNetEur', 'revenueSharePct', 'tables'],
          'a service has the twelve block keys plus key, name and position');
select is((select array_agg(k order by k collate "C") from sp, jsonb_object_keys(j -> 'total') k),
          array['avgSpendPerCoverEur', 'avgTicketEur', 'costedRevenueNetEur', 'costedSharePct', 'covers', 'foodCostEur', 'foodCostPct', 'plates', 'revenueGrossEur', 'revenueNetEur', 'revenueSharePct', 'tables'], 'and the total has the twelve');
select is((select s ->> 'name' || ',' || (s ->> 'position') from sp, jsonb_array_elements(j -> 'services') s where s ->> 'key' = 'cena'), 'Cena,2', 'name and position');

-- The values of plan 3.8 -------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.sv('pranzo', 'tables'), 1::numeric, 'pranzo: tables 1');
select is(pg_temp.sv('pranzo', 'covers'), 2::numeric, 'covers 2');
select is(pg_temp.sv('pranzo', 'revenueGrossEur'), 18.0000::numeric, 'gross 18,00');
select is(pg_temp.sv('pranzo', 'revenueNetEur'), 16.3637::numeric, 'net 16,3637 (12,7273 + 3,6364)');
select is(pg_temp.sv('pranzo', 'plates'), 1::numeric, 'plates 1');
select is(pg_temp.sv('pranzo', 'foodCostEur'), 4.20::numeric, 'food cost 4,20');
select is(pg_temp.sv('pranzo', 'costedRevenueNetEur'), 12.7273::numeric, 'costed net 12,7273');
select is(pg_temp.sv('pranzo', 'foodCostPct'), 33.00::numeric, 'food cost % 33,00');
select is(pg_temp.sv('pranzo', 'avgSpendPerCoverEur'), 8.1819::numeric, 'average spend 8,1819');
select is(pg_temp.sv('pranzo', 'avgTicketEur'), 16.3637::numeric, 'average ticket 16,3637');
select is(pg_temp.sv('pranzo', 'costedSharePct'), 100.00::numeric, 'costed share 100,00');
select is(pg_temp.sv('pranzo', 'revenueSharePct'), 12.08::numeric, 'revenue share 12,08');
select is(pg_temp.sv('cena', 'tables'), 2::numeric, 'cena: tables 2');
select is(pg_temp.sv('cena', 'covers'), 5::numeric, 'covers 5');
select is(pg_temp.sv('cena', 'revenueGrossEur'), 135.0000::numeric, 'gross 135,00');
select is(pg_temp.sv('cena', 'revenueNetEur'), 119.1281::numeric, 'net 119,1281');
select is(pg_temp.sv('cena', 'plates'), 9::numeric, 'plates 9');
select is(pg_temp.sv('cena', 'foodCostEur'), 21.35::numeric, 'food cost 21,35');
select is(pg_temp.sv('cena', 'costedRevenueNetEur'), 71.5909::numeric, 'costed net 71,5909');
select is(pg_temp.sv('cena', 'foodCostPct'), 29.82::numeric, 'food cost % 29,82 (M22)');
select is(pg_temp.sv('cena', 'revenueSharePct'), 87.92::numeric, 'revenue share 87,92');
select is(pg_temp.tot('tables'), 3::numeric, 'total: tables 3 (T4 is open and absent, T3 closes on D + 1)');
select is(pg_temp.tot('covers'), 7::numeric, 'covers 7');
select is(pg_temp.tot('revenueGrossEur'), 153.0000::numeric, 'gross 153,00');
select is(pg_temp.tot('revenueNetEur'), 135.4918::numeric, 'net 135,4918');
select is(pg_temp.tot('plates'), 10::numeric, 'plates 10');
select is(pg_temp.tot('foodCostEur'), 25.55::numeric, 'food cost 25,55');
select is(pg_temp.tot('costedRevenueNetEur'), 84.3182::numeric, 'costed net 84,3182');
select is(pg_temp.tot('foodCostPct'), 30.30::numeric, 'food cost % 30,30');
select is(pg_temp.tot('revenueSharePct'), 100.00::numeric, 'revenue share of the total 100,00');

-- The total is the report's current block, and the services add up to it --------------------------------------------------------------------
select is((select jsonb_object_agg(k, j -> 'total' -> k) from sp, unnest(array['covers', 'tables', 'revenueGrossEur', 'revenueNetEur', 'avgSpendPerCoverEur', 'avgTicketEur', 'plates', 'foodCostEur', 'foodCostPct', 'costedRevenueNetEur', 'costedSharePct']) k),
          (select jsonb_object_agg(k, j -> 'current' -> k) from rp, unnest(array['covers', 'tables', 'revenueGrossEur', 'revenueNetEur', 'avgSpendPerCoverEur', 'avgTicketEur', 'plates', 'foodCostEur', 'foodCostPct', 'costedRevenueNetEur', 'costedSharePct']) k),
          'the total equals kpi_report_json''s current block for the shared keys');
select is((select bool_and((select sum((s ->> k)::numeric) from sp, jsonb_array_elements(j -> 'services') s) = (select (j -> 'total' ->> k)::numeric from sp))
             from unnest(array['covers', 'tables', 'revenueGrossEur', 'revenueNetEur', 'plates', 'foodCostEur', 'costedRevenueNetEur']) k), true, 'the services add up to the total for every additive key');
select is((select sum((s ->> 'revenueSharePct')::numeric) from sp, jsonb_array_elements(j -> 'services') s), 100.00::numeric, 'and the shares add up to 100');

-- T3 closes on D + 1: counted there, under cena -------------------------------------------------------------------------------------------------
select is((select s ->> 'tables' || ',' || (s ->> 'covers') || ',' || (s ->> 'revenueGrossEur') from jsonb_array_elements(app.kpi_services_json('11111111-1111-4111-8111-111111111111', 'day', '2026-11-05', null, null, '2026-11-05 09:00+00') -> 'services') s where s ->> 'key' = 'cena'),
          '1,2,12.5000', 'T3 is counted on 2026-11-05 under cena (gross 12,50)');
select is((select s ->> 'tables' from jsonb_array_elements(app.kpi_services_json('11111111-1111-4111-8111-111111111111', 'day', '2026-11-05', null, null, '2026-11-05 09:00+00') -> 'services') s where s ->> 'key' = 'pranzo'), '0', 'and pranzo has no table that day');

-- After the rollup: the same figures as the stored row ---------------------------------------------------------------------------------------------
select app.rollup_daily_kpi('2026-11-05 08:00:00+00');
select is((select count(*)::int from public.daily_kpi where tenant_id = '11111111-1111-4111-8111-111111111111' and business_date = '2026-11-04'), 1, 'D is stored');
select is((select jsonb_build_object('covers', k.covers, 'tables', k.tables, 'revenueGrossEur', k.revenue_gross, 'revenueNetEur', k.items_net + k.coperto_net, 'plates', k.plates,
                                      'foodCostEur', k.food_cost, 'costedRevenueNetEur', k.costed_net)
             from public.daily_kpi k where k.tenant_id = '11111111-1111-4111-8111-111111111111' and k.business_date = '2026-11-04'),
          (select jsonb_object_agg(k, j -> 'total' -> k) from sp, unnest(array['covers', 'tables', 'revenueGrossEur', 'revenueNetEur', 'plates', 'foodCostEur', 'costedRevenueNetEur']) k),
          'the split''s total equals the stored daily_kpi row');
select is(app.kpi_services_json('11111111-1111-4111-8111-111111111111', 'day', '2026-11-04', null, null, '2026-11-05 09:00+00'), (select j from sp), 'and the reply is the same after the rollup');

-- An override moves a table between services, never the total ----------------------------------------------------------------------------------------
insert into public.service_override (tenant_id, table_session_id, service_key, created_at, created_by)
  values ('11111111-1111-4111-8111-111111111111', '14000000-0000-4000-8000-000000000002', 'pranzo', '2026-11-05 00:30+00', 'a1000000-0000-4000-8000-00000000000a');
create temporary table sp2 as select app.kpi_services_json('11111111-1111-4111-8111-111111111111', 'day', '2026-11-04', null, null, '2026-11-05 09:00+00') as j;
select is((select s ->> 'tables' || ',' || (s ->> 'covers') || ',' || (s ->> 'revenueGrossEur') || ',' || (s ->> 'revenueNetEur') from sp2, jsonb_array_elements(j -> 'services') s where s ->> 'key' = 'pranzo'),
          '2,4,53.0000,48.1819', 'T2 moved to pranzo: pranzo has 2 tables, 4 covers, 53,00 gross, 48,1819 net');
select is((select s ->> 'tables' || ',' || (s ->> 'covers') || ',' || (s ->> 'revenueGrossEur') || ',' || (s ->> 'revenueNetEur') from sp2, jsonb_array_elements(j -> 'services') s where s ->> 'key' = 'cena'),
          '1,3,100.0000,87.3099', 'and cena 1, 3, 100,00, 87,3099');
select is((select j -> 'total' from sp2), (select j -> 'total' from sp) - 'revenueSharePct' || (select jsonb_build_object('revenueSharePct', j -> 'total' -> 'revenueSharePct') from sp), 'the total is unchanged');
insert into public.service_override (tenant_id, table_session_id, service_key, created_at, created_by)
  values ('11111111-1111-4111-8111-111111111111', '14000000-0000-4000-8000-000000000002', null, '2026-11-05 00:40+00', 'a1000000-0000-4000-8000-00000000000a');
select is(app.kpi_services_json('11111111-1111-4111-8111-111111111111', 'day', '2026-11-04', null, null, '2026-11-05 09:00+00'), (select j from sp), 'back to automatic: the first figures again');

-- Roles and errors through the wrappers (the real clock: a date in the past) -----------------------------------------------------------------------
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(left(pg_temp.err($$ select public.kpi_services('day', '2026-09-15', null, null) $$), 5), '42501', 'the chef: 42501');
select is(left(pg_temp.err($$ select public.kpi_services('year', null, null, null) $$), 5), '42501', 'before the arguments are read');
select is(left(pg_temp.err($$ select public.day_services('2026-09-15') $$), 5), '42501', 'the chef cannot read the day split');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(left(pg_temp.err($$ select public.kpi_services('day', '2026-09-15', null, null) $$), 5), '42501', 'the waiter: 42501');
select is(left(pg_temp.err($$ select public.day_services(null) $$), 5), '42501', 'and the day split');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
create temporary table wo as select public.kpi_services('day', '2026-09-15', null, null) as j;
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is(public.kpi_services('day', '2026-09-15', null, null), (select j from wo), 'the admin''s reply equals the owner''s');
select is((select (j -> 'total' ->> 'revenueGrossEur')::numeric from wo), 28.00::numeric, 'the old table is counted (28,00)');
select is(left(pg_temp.err($$ select public.kpi_services('day', '2999-01-01', null, null) $$), 5), 'P0001', 'a future date is refused ...');
select is(pg_temp.err($$ select public.kpi_services('day', '2999-01-01', null, null) $$), 'P0001 date_in_future', '... with date_in_future');
select is(pg_temp.err($$ select public.kpi_services('custom', null, '2026-09-20', '2026-09-10') $$), 'P0001 range_invalid', 'range_invalid');
select is(pg_temp.err($$ select public.kpi_services('custom', null, '2024-01-01', '2026-09-10') $$), 'P0001 range_too_long', 'range_too_long');
select is(left(pg_temp.err($$ select public.kpi_services('year', null, null, null) $$), 5), '22023', 'an unknown period: 22023');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is((select (public.kpi_services('day', '2026-09-15', null, null) -> 'total' ->> 'tables')::int), 0, 'owner B sees none of A''s tables');

-- The day split ------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
create temporary table ds as select app.day_services_json('11111111-1111-4111-8111-111111111111', '2026-11-04', '2026-11-05 01:00+00') as j;
select is((select array_agg(k order by k collate "C") from ds, jsonb_object_keys(j) k), array['businessDate', 'final', 'services', 'sessions', 'total'], 'the day reply has five keys');
select is((select j ->> 'businessDate' || ',' || (j ->> 'final') from ds), '2026-11-04,false', 'D is not final at 02:00 local');
select is((select (j -> 'total' ->> 'totalEur')::numeric from ds), (app.app_vs_register_json('11111111-1111-4111-8111-111111111111', '2026-11-04') -> 'app' ->> 'total')::numeric, 'the day total equals the day close''s app total');
select is((select (j -> 'total' ->> 'totalEur')::numeric from ds), 153.00::numeric, '153,00');
select is((select array_agg(s ->> 'key' || ':' || (s ->> 'totalEur') || ':' || (s ->> 'tables') || ':' || (s ->> 'covers') || ':' || (s ->> 'openTables') order by o) from ds, jsonb_array_elements(j -> 'services') with ordinality t(s, o)),
          array['pranzo:18.00:1:2:0', 'cena:135.00:2:5:1'], 'pranzo 18,00 and cena 135,00; cena has one open table');
select is((select array_agg(s ->> 'startsAt' || '-' || (s ->> 'endsAt') order by o) from ds, jsonb_array_elements(j -> 'services') with ordinality t(s, o)), array['11:00-16:00', '16:00-02:00'], 'the windows');
select is((select j -> 'total' ->> 'openTables' from ds), '1', 'the total counts the open table');
select is((select (j -> 'total' ->> 'revenueNetEur')::numeric from ds), 135.4918::numeric, 'and the net revenue');
select is((select array_agg(s ->> 'sessionId' order by o) from ds, jsonb_array_elements(j -> 'sessions') with ordinality t(s, o)),
          array['14000000-0000-4000-8000-000000000009', '14000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000002', '14000000-0000-4000-8000-000000000004'], 'the sessions: T5, T1, T2 by opening time, then the open T4');
select is((select s ->> 'closedAt' is null and s ->> 'totalEur' is null and (s ->> 'canChange')::boolean and s ->> 'serviceKey' = 'cena' and s ->> 'source' = 'auto'
             from ds, jsonb_array_elements(j -> 'sessions') s where s ->> 'sessionId' = '14000000-0000-4000-8000-000000000004'), true, 'T4 is open: no closedAt, no total, canChange, cena, auto');
select is((select s ->> 'serviceKey' || ',' || (s ->> 'source') || ',' || (s ->> 'totalEur') || ',' || (s ->> 'tableName') from ds, jsonb_array_elements(j -> 'sessions') s where s ->> 'sessionId' = '14000000-0000-4000-8000-000000000001'), 'cena,auto,100.00,Tavolo 1 (demo)', 'T1');
select is((select s -> 'choices' from ds, jsonb_array_elements(j -> 'sessions') s where s ->> 'sessionId' = '14000000-0000-4000-8000-000000000001'), '["pranzo", "cena"]'::jsonb, 'choices are the keys of the version at T1''s opening (the default)');
select is((select (s ->> 'canChange')::boolean from ds, jsonb_array_elements(j -> 'sessions') s where s ->> 'sessionId' = '14000000-0000-4000-8000-000000000001'), true, 'T1 can be moved at 02:00 local (01:00Z)');
select is((select (s ->> 'canChange')::boolean from jsonb_array_elements(app.day_services_json('11111111-1111-4111-8111-111111111111', '2026-11-04', '2026-11-05 01:10+00') -> 'sessions') s where s ->> 'sessionId' = '14000000-0000-4000-8000-000000000001'), false, 'and not at 01:10Z');
select is(app.day_services_json('11111111-1111-4111-8111-111111111111', '2026-11-04', '2026-11-05 01:10+00') ->> 'final', 'true', 'the day is final at 01:10Z');
select is((select (s ->> 'canChange')::boolean from jsonb_array_elements(app.day_services_json('11111111-1111-4111-8111-111111111111', '2026-11-04', '2026-11-05 01:10+00') -> 'sessions') s where s ->> 'sessionId' = '14000000-0000-4000-8000-000000000004'), true, 'an open table can still be moved');
select is((select array_agg(distinct m[1] order by m[1]) from ds, regexp_matches(j::text, '"([A-Za-z]*[Nn]ame[A-Za-z]*)":', 'g') m), array['name', 'tableName'], 'no key of the reply names a person: only name and tableName');
select is((select j::text ~ 'Titolare|Cameriere|Admin Demo|Chef Demo' from ds), false, 'and no staff display name appears');
select is((select (s ->> 'canChange')::boolean from ds, jsonb_array_elements(j -> 'sessions') s where s ->> 'sessionId' = '14000000-0000-4000-8000-000000000002'), true, 'T2 (moved and back) can be moved');
select is(pg_temp.err($$ select app.day_services_json('11111111-1111-4111-8111-111111111111', '2026-09-03', '2026-11-05 09:00+00') $$), 'P0001 business_date_invalid', '63 days back: business_date_invalid');
select is(app.day_services_json('11111111-1111-4111-8111-111111111111', '2026-09-04', '2026-11-05 09:00+00') ->> 'businessDate', '2026-09-04', '62 days back is accepted');
select is(pg_temp.err($$ select app.day_services_json('11111111-1111-4111-8111-111111111111', '2026-11-06', '2026-11-05 09:00+00') $$), 'P0001 business_date_invalid', 'tomorrow: business_date_invalid');
select is(app.day_services_json('11111111-1111-4111-8111-111111111111', null, '2026-11-05 09:00+00') ->> 'businessDate', '2026-11-05', 'null is today''s business date');
select is((select count(*)::int from jsonb_array_elements(app.day_services_json('22222222-2222-4222-8222-222222222222', '2026-11-04', '2026-11-05 01:00+00') -> 'sessions')), 1, 'tenant B''s day holds only its own table');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(left(pg_temp.err($$ select public.day_services('2026-11-04') $$), 5), '42501', 'the chef: 42501 on the public day split');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is(public.day_services('2026-09-15') ->> 'businessDate', '2026-09-15', 'the admin reads a past day through the wrapper');

-- Lists: a service without data, and a removed key with history --------------------------------------------------------------------------------------
insert into public.service_schedule (tenant_id, periods, created_at, created_by)
  values ('11111111-1111-4111-8111-111111111111', '[{"key":"pranzo","name":"Pranzo","startsAt":"11:00"},{"key":"s_0123456789","name":"Aperitivo","startsAt":"18:00"},{"key":"cena","name":"Cena","startsAt":"19:30"}]',
          '2026-11-01T00:00Z', 'a1000000-0000-4000-8000-00000000000a');
create temporary table sp3 as select app.kpi_services_json('11111111-1111-4111-8111-111111111111', 'day', '2026-11-04', null, null, '2026-11-05 09:00+00') as j;
select is((select array_agg(s ->> 'key' order by o) from sp3, jsonb_array_elements(j -> 'services') with ordinality t(s, o)), array['pranzo', 's_0123456789', 'cena'], 'with three services in force the reply lists three');
select is((select s ->> 'tables' || ',' || (s ->> 'covers') || ',' || (s ->> 'revenueNetEur') || ',' || coalesce(s ->> 'avgSpendPerCoverEur', 'null') || ',' || coalesce(s ->> 'avgTicketEur', 'null') || ',' || coalesce(s ->> 'foodCostPct', 'null') || ',' || coalesce(s ->> 'costedSharePct', 'null') || ',' || (s ->> 'revenueSharePct')
             from sp3, jsonb_array_elements(j -> 'services') s where s ->> 'key' = 's_0123456789'), '0,0,0.0000,null,null,null,null,0.00', 'a service without data has zeros and null ratios');
select is((select j -> 'total' from sp3), (select j -> 'total' from sp), 'and the total is unchanged (T1, T2 and T5 keep their services)');
insert into public.service_override (tenant_id, table_session_id, service_key, created_at, created_by)
  values ('11111111-1111-4111-8111-111111111111', '14000000-0000-4000-8000-000000000001', 's_0123456789', '2026-11-05 00:50+00', 'a1000000-0000-4000-8000-00000000000a');
insert into public.service_schedule (tenant_id, periods, created_at, created_by)
  values ('11111111-1111-4111-8111-111111111111', '[{"key":"pranzo","name":"Pranzo","startsAt":"11:00"},{"key":"cena","name":"Cena","startsAt":"16:00"}]', '2026-11-05T07:00Z', 'a1000000-0000-4000-8000-00000000000a');
create temporary table spw as select app.kpi_services_json('11111111-1111-4111-8111-111111111111', 'week', '2026-11-04', null, null, '2026-11-05 09:00+00') as j;
select is((select array_agg(s ->> 'key' order by o) from spw, jsonb_array_elements(j -> 'services') with ordinality t(s, o)), array['pranzo', 'cena', 's_0123456789'], 'a week lists the current services, then a removed key that has data');
select is((select s ->> 'name' || ',' || coalesce(s ->> 'position', 'null') || ',' || (s ->> 'covers') from spw, jsonb_array_elements(j -> 'services') s where s ->> 'key' = 's_0123456789'), 'Aperitivo,null,3', 'the removed key keeps its last name, position null, and the data of T1 (3 covers)');
select is((select j ->> 'from' || ',' || (j ->> 'to') from spw), '2026-11-02,2026-11-08', 'the week is Monday to Sunday');

-- Definer rules and grants ------------------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname in ('kpi_service_block', 'kpi_service_split', 'kpi_services_json', 'day_services_json')
            and p.prosecdef and p.proconfig @> array['search_path=""']
            and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('service_role', p.oid, 'execute')), 4, 'the four app functions are definers closed to every API role');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('kpi_services', 'day_services')
            and p.prosecdef and p.proconfig @> array['search_path=""']
            and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('service_role', p.oid, 'execute')), 2, 'the two public ones execute for authenticated only');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname ~* 'cost|margin|price' and p.proname in ('kpi_services', 'day_services', 'service_periods', 'set_service_periods', 'set_session_service')), 0, 'no new public name matches cost, margin or price');

-- Performance net (a regression net, not a claim): 3 000 closed sessions over 60 days, one line each ---------------------------------------------------------------
insert into public.tenant (id, name, vat_number) values ('77777777-7777-4777-8777-777777777777', 'Osteria Demo P', 'IT77777777777');
insert into auth.users (id, email) values ('e0000000-0000-4000-8000-00000000000e', 'owner-p@example.test');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('e1000000-0000-4000-8000-00000000000e', '77777777-7777-4777-8777-777777777777', 'e0000000-0000-4000-8000-00000000000e', 'owner', 'Titolare P Demo');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('73000000-0000-4000-8000-000000000001', '77777777-7777-4777-8777-777777777777', 'Tavolo P (demo)', 1, 'e1000000-0000-4000-8000-00000000000e', 'e1000000-0000-4000-8000-00000000000e');
insert into public.menu_item (id, tenant_id, name, category, course_default, created_by, updated_by) values
  ('71000000-0000-4000-8000-000000000001', '77777777-7777-4777-8777-777777777777', 'Acqua P (demo)', 'Bevande', 'bevande', 'e1000000-0000-4000-8000-00000000000e', 'e1000000-0000-4000-8000-00000000000e');
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_at, opened_by, business_date, closed_at, closed_by, closed_business_date,
                                  receipt_type, payment_type, total, created_by, updated_by)
  select md5('p' || n)::uuid, '77777777-7777-4777-8777-777777777777', '73000000-0000-4000-8000-000000000001', 'Tavolo P (demo)', 2,
         timestamptz '2026-10-16 08:00+00' + ((n - 1) / 50) * interval '1 day' + (n % 50) * interval '17 minutes', 'e1000000-0000-4000-8000-00000000000e',
         date '2026-10-16' + (n - 1) / 50, timestamptz '2026-10-16 09:00+00' + ((n - 1) / 50) * interval '1 day' + (n % 50) * interval '17 minutes', 'e1000000-0000-4000-8000-00000000000e',
         date '2026-10-16' + (n - 1) / 50, 'scontrino', 'card', 3.00, 'e1000000-0000-4000-8000-00000000000e', 'e1000000-0000-4000-8000-00000000000e'
    from generate_series(1, 3000) n;
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_at, created_by, updated_by, fired_at, fired_by)
  select md5('l' || n)::uuid, '77777777-7777-4777-8777-777777777777', md5('p' || n)::uuid, '71000000-0000-4000-8000-000000000001', 'bevande', 1, 3.00, 10, 'menu',
         '2026-10-16 08:00+00', '2026-10-16 08:00+00', 'e1000000-0000-4000-8000-00000000000e', 'e1000000-0000-4000-8000-00000000000e', '2026-10-16 08:00+00', 'e1000000-0000-4000-8000-00000000000e'
    from generate_series(1, 3000) n;
analyze public.table_session;
analyze public.order_line;
analyze public.order_line_cost;
analyze public.service_override;
analyze public.service_schedule;
set local statement_timeout = '5s';
select is((select (app.kpi_services_json('77777777-7777-4777-8777-777777777777', 'custom', null, '2026-10-16', '2026-12-14', '2027-01-15 09:00+00') -> 'total' ->> 'tables')::int), 3000, 'a 60-day range of 3 000 sessions answers under the 5 s statement timeout, and counts them all');
reset statement_timeout;

select * from finish();
rollback;
