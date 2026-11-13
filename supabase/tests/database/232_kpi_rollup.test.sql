-- M22 step 2 (docs/plans/2026-10-31-m22-kpi-reporting.md §3.2, §3.4, §5; ADR-025; AT3): app.rollup_daily_kpi finalises a business date once its cut-off plus a
-- 10-minute grace has passed; it is idempotent, writes one row per date (also on both DST nights), isolates a failing tenant and is scheduled
-- every 15 minutes in SQL. Every instant is passed as p_at; the fixture is the one of 231. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(50);

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

-- More tenants for the DST nights and the coverage cases: a closed session with no lines is enough (one closed table per date).
create function pg_temp.mk_tenant(p_t uuid, p_name text, p_vat text, p_settings jsonb default '{}') returns void language plpgsql as $$
declare
  v_auth uuid := gen_random_uuid();
  v_user uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (v_auth, p_name || '@example.test');
  insert into public.tenant (id, name, vat_number, settings) values (p_t, p_name, p_vat, p_settings);
  insert into public.app_user (id, tenant_id, auth_id, role, display_name) values (v_user, p_t, v_auth, 'owner', 'Titolare Demo');
  insert into public.dining_table (tenant_id, name, position, created_by, updated_by) values (p_t, 'Tavolo 1 (demo)', 1, v_user, v_user);
end
$$;
create function pg_temp.mk_closed(p_t uuid, p_cbd date, p_closed timestamptz) returns void language sql as $$
  insert into public.table_session (tenant_id, dining_table_id, table_name, covers, opened_at, opened_by, business_date, closed_at, closed_by,
                                    closed_business_date, receipt_type, payment_type, total, created_by, updated_by)
  select p_t, dt.id, dt.name, 2, p_closed - interval '2 hours', u.id, p_cbd, p_closed, u.id, p_cbd, 'scontrino', 'card', 20.00, u.id, u.id
    from public.dining_table dt join public.app_user u on u.tenant_id = dt.tenant_id where dt.tenant_id = p_t
$$;
create function pg_temp.n_rows(p_t uuid) returns int language sql as $$ select count(*)::int from public.daily_kpi where tenant_id = p_t $$;
create function pg_temp.has_row(p_t uuid, p_d date) returns boolean language sql as $$ select exists (select 1 from public.daily_kpi where tenant_id = p_t and business_date = p_d) $$;

-- The finality rule (plan §3.4): cutoff_end(D) for five dates, then the grace -----------------------------------------------------------
select is(app.kpi_finalise_grace(), interval '10 minutes', 'the grace is 10 minutes');
select is(app.kpi_rollup_max_days(), 400, 'at most 400 dates per tenant and run');
select is((select array_agg(app.kpi_cutoff_end('11111111-1111-4111-8111-111111111111', d) order by d)
             from unnest(array['1998-11-04', '1998-10-24', '1998-10-25', '1999-03-27', '1999-03-28']::date[]) d),
          array['1998-10-25 00:00+00', '1998-10-26 01:00+00', '1998-11-05 01:00+00', '1999-03-28 01:00+00', '1999-03-29 00:00+00']::timestamptz[],
          'cutoff_end (by date): autumn 1998-10-24 is the first 02:00 (00:00Z), 10-25 is 01:00Z next day, 11-04 is 01:00Z next day, spring 1999-03-27 is the jump instant (01:00Z, 03:00 CEST), 03-28 is 00:00Z next day');
select is(app.kpi_last_final_date('11111111-1111-4111-8111-111111111111', '1998-11-05 01:09:59+00'), '1998-11-03'::date, 'grace - 1 s: D is not final');
select is(app.kpi_last_final_date('11111111-1111-4111-8111-111111111111', '1998-11-05 01:10:00+00'), '1998-11-04'::date, 'grace + 0 s: D is final');
select is(app.kpi_last_final_date('11111111-1111-4111-8111-111111111111', '1998-11-05 01:15:00+00'), '1998-11-04'::date,
          'the */15 run at 01:15Z (02:15 local) finalises D, before 03:00');
select ok(('1998-11-05 01:15+00'::timestamptz at time zone 'Europe/Rome')::time < time '03:00', 'and 02:15 is before 03:00 local');

-- Normal night (tenant A) ---------------------------------------------------------------------------------------------------------------
select app.rollup_daily_kpi('1998-11-05 01:09:59+00');
select is(pg_temp.has_row('11111111-1111-4111-8111-111111111111', '1998-11-04'), false, 'at 01:09:59Z there is no row for D');
select is(pg_temp.has_row('11111111-1111-4111-8111-111111111111', '1998-11-01'), true, 'but the earlier dates are final');
select is(app.rollup_daily_kpi('1998-11-05 01:10:00+00'), 2, 'at 01:10:00Z D is written (A) and so is tenant B''s D (the first date of B)');
select is(pg_temp.has_row('11111111-1111-4111-8111-111111111111', '1998-11-04'), true, 'D has a row at 01:10:00Z');
select is((select to_jsonb(k) - 'finalised_at' - 'job_run_id' from public.daily_kpi k where tenant_id = '11111111-1111-4111-8111-111111111111' and business_date = '1998-11-04'),
          (select to_jsonb(k) - 'finalised_at' - 'job_run_id' from app.kpi_day_row('11111111-1111-4111-8111-111111111111', '1998-11-04') k),
          'the stored row equals kpi_day_row column by column');
select is((select finalised_at is not null and job_run_id = (select max(id) from app.job_run where job = 'kpi-rollup')
             from public.daily_kpi where tenant_id = '11111111-1111-4111-8111-111111111111' and business_date = '1998-11-04'), true, 'finalised_at is set and job_run_id names the run');
select is((select covers = 5 and revenue_gross = 135 and plates = 9 from public.daily_kpi where tenant_id = '11111111-1111-4111-8111-111111111111' and business_date = '1998-11-04'),
          true, 'D holds the hand-computed day');
create temporary table before_md5 as select md5(string_agg(to_jsonb(k)::text, '|' order by tenant_id, business_date)) as m, count(*) as n from public.daily_kpi k;
select is(app.rollup_daily_kpi('1998-11-05 01:30:00+00'), 0, 're-run at 01:30Z: nothing inserted');
select is((select md5(string_agg(to_jsonb(k)::text, '|' order by tenant_id, business_date)) from public.daily_kpi k), (select m from before_md5), 'and the md5 of every stored row is unchanged');
select is(app.rollup_daily_kpi('1998-11-05 01:30:00+00'), 0, 'a third call is a no-op too');

-- Days without sales get a zero row; a tenant without a closed table gets none -------------------------------------------------------------
select is((select (tables, covers, revenue_gross, plates, cardinality(covers_by_hour), covers_by_hour = array_fill(0, array[24]))::text
             from public.daily_kpi where tenant_id = '11111111-1111-4111-8111-111111111111' and business_date = '1998-10-30'),
          '(0,0,0,0,24,t)', 'a day with no sales between two days with sales: a zero row (1998-10-30)');
select is((select min(business_date) from public.daily_kpi where tenant_id = '11111111-1111-4111-8111-111111111111'), '1998-10-28'::date, 'rows start at the first closed table');
select pg_temp.mk_tenant('99999999-9999-4999-8999-999999999999', 'osteria-g-demo', 'IT99999999999');
select app.rollup_daily_kpi('1998-11-06 12:00:00+00');
select is(pg_temp.n_rows('99999999-9999-4999-8999-999999999999'), 0, 'a tenant that never closed a table gets no row');

-- A gap inside the stored rows is filled ------------------------------------------------------------------------------------------------
alter table public.daily_kpi disable trigger daily_kpi_append_only;
delete from public.daily_kpi where tenant_id = '11111111-1111-4111-8111-111111111111' and business_date = '1998-10-31';
alter table public.daily_kpi enable trigger daily_kpi_append_only;
select is(pg_temp.has_row('11111111-1111-4111-8111-111111111111', '1998-10-31'), false, 'a row deleted by the test');
select is(app.rollup_daily_kpi('1998-11-06 12:15:00+00'), 1, 'the next run refills the gap');
select is(pg_temp.has_row('11111111-1111-4111-8111-111111111111', '1998-10-31'), true, 'the gap is filled');

-- Isolation: a failing tenant is skipped, the others are written ----------------------------------------------------------------------------
create function public.m22_fail_b() returns trigger language plpgsql as $$ begin raise exception 'forced' using errcode = 'P0001'; end $$;
create trigger m22_fail_b before insert on public.daily_kpi for each row when (new.tenant_id = '22222222-2222-4222-8222-222222222222') execute function public.m22_fail_b();
select pg_temp.mk_closed('11111111-1111-4111-8111-111111111111', '1998-11-06', '1998-11-06 20:00+00');
select pg_temp.mk_closed('22222222-2222-4222-8222-222222222222', '1998-11-06', '1998-11-06 20:00+00');
select is(app.rollup_daily_kpi('1998-11-07 12:00:00+00'), 1, 'with B failing, A''s new date (1998-11-06) is written');
select is((select (ok, error_code, items)::text from app.job_run where job = 'kpi-rollup' order by id desc limit 1), '(f,rollup_failed,1)', 'the job_run row: ok false, rollup_failed, items 1');
select is(pg_temp.has_row('22222222-2222-4222-8222-222222222222', '1998-11-06'), false, 'tenant B got none of its pending dates (its block was rolled back)');
select is(pg_temp.n_rows('22222222-2222-4222-8222-222222222222'), 2, 'B keeps only its earlier rows (11-04 and 11-05)');
select is(pg_temp.has_row('11111111-1111-4111-8111-111111111111', '1998-11-06'), true, 'while A''s new date is there');
drop trigger m22_fail_b on public.daily_kpi;
select is(app.rollup_daily_kpi('1998-11-07 12:15:00+00'), 1, 'without the fault, B''s date (11-06) is written');
select is((select (ok, error_code, items)::text from app.job_run where job = 'kpi-rollup' order by id desc limit 1), '(t,,1)', 'the job_run row: ok true, no error, items 1');

-- Autumn night: 1998-10-25 02:00 happens twice ----------------------------------------------------------------------------------------------
select pg_temp.mk_tenant('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'osteria-c-demo', 'IT33333333330');
select pg_temp.mk_closed('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '1998-10-24', '1998-10-24 20:00+00');
select app.rollup_daily_kpi('1998-10-25 00:09:59+00');
select is(pg_temp.n_rows('cccccccc-cccc-4ccc-8ccc-cccccccccccc'), 0, 'autumn: at 00:09:59Z (02:09 CEST) 1998-10-24 is not final');
select app.rollup_daily_kpi('1998-10-25 00:10:00+00');
select is(pg_temp.has_row('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '1998-10-24'), true, 'at 00:10Z (02:10 CEST, the first 02:xx) 1998-10-24 exists');
select app.rollup_daily_kpi('1998-10-25 00:30:00+00');
select app.rollup_daily_kpi('1998-10-25 01:00:00+00');
select app.rollup_daily_kpi('1998-10-25 01:15:00+00');
select app.rollup_daily_kpi('1998-10-25 01:45:00+00');
select is(pg_temp.n_rows('cccccccc-cccc-4ccc-8ccc-cccccccccccc'), 1, 'the runs at 00:30Z, 01:00Z, 01:15Z and 01:45Z (the second 02:xx, CET) insert nothing');
select is(pg_temp.has_row('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '1998-10-25'), false, '1998-10-25 waits');
select app.rollup_daily_kpi('1998-10-26 01:09:59+00');
select is(pg_temp.has_row('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '1998-10-25'), false, '1998-10-25 is not final at 01:09:59Z on 10-26');
select app.rollup_daily_kpi('1998-10-26 01:10:00+00');
select is((select array_agg(business_date order by business_date) from public.daily_kpi where tenant_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'), array['1998-10-24', '1998-10-25']::date[],
          'then exactly one row each for 1998-10-24 and 1998-10-25');

-- Spring night: 1999-03-28 02:00 does not exist ----------------------------------------------------------------------------------------------
select pg_temp.mk_tenant('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'osteria-e-demo', 'IT55555555550');
select pg_temp.mk_closed('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '1999-03-27', '1999-03-27 20:00+00');
select app.rollup_daily_kpi('1999-03-28 01:09:00+00');
select is(pg_temp.n_rows('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'), 0, 'spring: at 01:09Z (03:09 CEST) 1999-03-27 is not final yet');
select app.rollup_daily_kpi('1999-03-28 01:10:00+00');
select is(pg_temp.has_row('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '1999-03-27'), true, 'at 01:10Z it is');
select is(('1999-03-28 01:10+00'::timestamptz at time zone 'Europe/Rome')::time, time '03:10', 'which is 03:10 local (Q145: the cut-off itself falls at 03:00 that night)');
select app.rollup_daily_kpi('1999-03-29 00:09:00+00');
select is(pg_temp.n_rows('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'), 1, '1999-03-28 is not final at 00:09Z on 03-29');
select app.rollup_daily_kpi('1999-03-29 00:10:00+00');
select is((select array_agg(business_date order by business_date) from public.daily_kpi where tenant_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'), array['1999-03-27', '1999-03-28']::date[],
          'it is final from 00:10Z: one row each for 1999-03-27 and 1999-03-28');

-- Another cut-off: "00:30" -----------------------------------------------------------------------------------------------------------------
select pg_temp.mk_tenant('ffffffff-ffff-4fff-8fff-ffffffffffff', 'osteria-f-demo', 'IT66666666660', '{"business_day_cutoff": "00:30"}');
select pg_temp.mk_closed('ffffffff-ffff-4fff-8fff-ffffffffffff', '1998-11-04', '1998-11-04 20:00+00');
select app.rollup_daily_kpi('1998-11-04 23:39:59+00');
select is(pg_temp.n_rows('ffffffff-ffff-4fff-8fff-ffffffffffff'), 0, 'cut-off 00:30: 1998-11-04 is not final at 23:39:59Z');
select app.rollup_daily_kpi('1998-11-04 23:40:00+00');
select is(pg_temp.has_row('ffffffff-ffff-4fff-8fff-ffffffffffff', '1998-11-04'), true, 'it is final from 23:40:00Z (cut-off 23:30Z + 10 minutes)');

-- At most 400 dates per tenant and run -------------------------------------------------------------------------------------------------------
select pg_temp.mk_tenant('88888888-8888-4888-8888-888888888888', 'osteria-h-demo', 'IT77777777770');
select pg_temp.mk_closed('88888888-8888-4888-8888-888888888888', '1997-01-01', '1997-01-01 20:00+00');
select app.rollup_daily_kpi('1998-04-01 12:00:00+00');
select is(pg_temp.n_rows('88888888-8888-4888-8888-888888888888'), 400, '455 dates pending: 400 are written in the first run');
select app.rollup_daily_kpi('1998-04-01 12:15:00+00');
select is(pg_temp.n_rows('88888888-8888-4888-8888-888888888888'), 455, 'and the rest in the next');
select is((select max(business_date) from public.daily_kpi where tenant_id = '88888888-8888-4888-8888-888888888888'), '1998-03-31'::date, 'up to the last final date (1998-03-31)');

-- Schedule and privileges -----------------------------------------------------------------------------------------------------------------
select is((select (schedule, command, active)::text from cron.job where jobname = 'kpi-rollup'), '("*/15 * * * *","select app.rollup_daily_kpi()",t)', 'cron.job has kpi-rollup every 15 minutes, active, SQL only');
select is((select bool_or(has_function_privilege(r, f, 'execute')) from unnest(array['anon', 'authenticated', 'service_role']) r,
            unnest(array['app.rollup_daily_kpi(timestamptz)', 'app.kpi_cutoff_end(uuid, date)', 'app.kpi_last_final_date(uuid, timestamptz)',
                         'app.kpi_finalise_grace()', 'app.kpi_rollup_max_days()']) f), false, 'no API role can execute the rollup or its helpers');
select is((select bool_and(prosecdef and proconfig = array['search_path=""']) from pg_proc
            where oid in ('app.rollup_daily_kpi(timestamptz)'::regprocedure, 'app.kpi_cutoff_end(uuid, date)'::regprocedure, 'app.kpi_last_final_date(uuid, timestamptz)'::regprocedure)),
          true, 'the rollup and its date helpers are definers with an empty search_path');
select is((select count(*)::int from public.daily_kpi where business_date is null or tenant_id is null), 0, 'no row without a tenant or date');

select * from finish();
