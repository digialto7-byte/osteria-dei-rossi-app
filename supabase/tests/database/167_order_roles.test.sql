-- M18 step 7: the role and tenancy matrix of the five waiter-facing functions (plan §3.1.10, §3.11.2 of the project plan;
-- project V6: the chef never sees prices). For menu_list, order_view, add_order_line, update_order_line and
-- remove_order_line: owner, admin and waiter A allowed; chef A and a caller without claims get 42501 and nothing is
-- written; tenant B (owner and waiter) gets P0002 on A's ids and A's rows stay unchanged. Privileges of the public
-- functions and of every app.* function M18 adds. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test'),
  ('e0000000-0000-4000-8000-00000000000e', 'waiter-a2@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo'),
  ('e1000000-0000-4000-8000-00000000000e', '11111111-1111-4111-8111-111111111111', 'e0000000-0000-4000-8000-00000000000e', 'waiter', 'Cameriere Due Demo');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)'),
  ('10000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'Dispensa (demo)');
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'spezzatino (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e3', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'ragu (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e2', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'spezzatino con polenta (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e5', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'tagliatelle al ragu (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch, shelf_life_hours, created_by) values
  ('ed000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e1', 1, now() - interval '5 days', 'Spezzatino (demo)', 2, 'kg', 10, 48, 'a1000000-0000-4000-8000-00000000000a'),
  ('ed000000-0000-4000-8000-0000000000d3', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e3', 1, now() - interval '5 days', 'Ragù (demo)', 2, 'kg', 10, 48, 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by) values
  ('ed000000-0000-4000-8000-0000000000d2', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e2', 1, now() - interval '5 days', 'Spezzatino con polenta (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ed000000-0000-4000-8000-0000000000d6', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e5', 1, now() - interval '5 days', 'Tagliatelle al ragù (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe_line (tenant_id, recipe_id, position, sub_recipe_key, qty, unit, yield_factor, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d2', 1, 'ec000000-0000-4000-8000-0000000000e1', 1, 'porz', 1, 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d6', 1, 'ec000000-0000-4000-8000-0000000000e3', 1, 'porz', 1, 'a1000000-0000-4000-8000-00000000000a');

-- Menu items (direct fixtures so the price history is controlled): the stew has three price rows.
insert into public.menu_item (id, tenant_id, name, category, course_default, recipe_key, is_available, is_active, push_until, push_price, created_by, updated_by) values
  ('11000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Spezzatino con polenta (demo)', 'Secondi', 'secondi', 'ec000000-0000-4000-8000-0000000000e2', true, true, null, null, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Tagliatelle al ragù (demo)', 'Primi', 'primi', 'ec000000-0000-4000-8000-0000000000e5', true, true, null, null, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Bruschetta (demo)', 'Antipasti', 'antipasti', null, true, true, null, null, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'Zuppa del giorno (demo)', 'Primi', 'primi', null, true, true, now() + interval '1 hour', 7, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'Tiramisù (demo)', 'Dolci', 'dolci', null, true, true, now() - interval '1 minute', 4, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', 'Acqua (demo)', 'Bevande', 'bevande', null, false, true, null, null, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000007', '11111111-1111-4111-8111-111111111111', 'Vino della casa (demo)', 'Bevande', 'bevande', null, true, false, null, null, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Solo B (demo)', 'Altro', 'dolci', null, true, true, null, null, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.menu_item_price (tenant_id, menu_item_id, price, vat_rate, valid_from, created_by) values
  ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000001', 12, 22, now() - interval '3 hours', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000001', 14, 10, now() - interval '2 hours', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000001', 16, 4, now() + interval '1 hour', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000002', 11, 10, now() - interval '1 day', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000003', 5, 10, now() - interval '1 day', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000004', 9, 10, now() - interval '1 day', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000005', 6, 10, now() - interval '1 day', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000006', 2, 22, now() - interval '1 day', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000007', 15, 22, now() - interval '1 day', 'a1000000-0000-4000-8000-00000000000a'),
  ('22222222-2222-4222-8222-222222222222', '11000000-0000-4000-8000-0000000000b1', 3, 22, now() - interval '1 day', 'b1000000-0000-4000-8000-00000000000b');

-- Tables and sessions: S1 and S2 open (tables 1, 2), S3 closed (table 3), B1 of tenant B.
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('13000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Tavolo 1 (demo)', 1, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('13000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Tavolo 2 (demo)', 2, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('13000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Tavolo 3 (demo)', 3, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('13000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Tavolo B (demo)', 1, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, closed_at, closed_by, created_by, updated_by) values
  ('14000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000001', 'Tavolo 1 (demo)', 4, 'a1000000-0000-4000-8000-00000000000a', '2026-10-24', null, null, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('14000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000002', 'Tavolo 2 (demo)', 2, 'a1000000-0000-4000-8000-00000000000a', '2026-10-24', null, null, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('14000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000003', 'Tavolo 3 (demo)', 2, 'a1000000-0000-4000-8000-00000000000a', '2026-10-24', now(), 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('14000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', '13000000-0000-4000-8000-0000000000b1', 'Tavolo B (demo)', 2, 'b1000000-0000-4000-8000-00000000000b', '2026-10-24', null, null, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
-- A line of tenant B (for the id collision case).
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by) values
  ('e1000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', '14000000-0000-4000-8000-0000000000b1',
   '11000000-0000-4000-8000-0000000000b1', 'dolci', 1, 3, 22, 'menu', '2026-10-24 12:00+00', 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');

create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
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
create function pg_temp.err_detail(stmt text) returns text language plpgsql as $$
declare
  d text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics d = pg_exception_detail;
  return d;
end
$$;
create function pg_temp.mkbatch(p_id uuid, p_key uuid, p_use_by timestamptz, p_loc uuid, p_portions int, p_seq int) returns void language plpgsql as $$
begin
  insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code,
      lot_seq, produced_at, produced_by, output_qty, output_unit, portions_computed, portions_initial,
      shelf_life_hours, use_by, state, location_id, created_by)
    values (p_id, '11111111-1111-4111-8111-111111111111', p_key,
      case when p_key = 'ec000000-0000-4000-8000-0000000000e1' then 'ed000000-0000-4000-8000-0000000000d1'::uuid else 'ed000000-0000-4000-8000-0000000000d3'::uuid end,
      1, '261023-LOT-' || p_seq, '2026-10-23', 'LOT', p_seq, p_use_by - interval '48 hours', 'a1000000-0000-4000-8000-00000000000a',
      2, 'kg', p_portions, p_portions, 48, p_use_by, 'fresh', p_loc, 'a1000000-0000-4000-8000-00000000000a');
  insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', p_id, 'produce', p_portions, 'batch', p_id, '2026-10-23', 'a1000000-0000-4000-8000-00000000000a');
end
$$;
create function pg_temp.adj(p_batch uuid, p_portions numeric) returns void language sql as $$
  insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', p_batch, 'count', p_portions, 'batch_adjust', gen_random_uuid(), '2026-10-23', 'a1000000-0000-4000-8000-00000000000a')
$$;
-- Client instants: t(n) is n minutes after a fixed base an hour ago.
create temp table tb as select date_trunc('minute', clock_timestamp()) - interval '1 hour' as base;
create function pg_temp.t(n int) returns text language sql as $$
  select to_char((base + n * interval '1 minute') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') from tb $$;
create function pg_temp.line(p_id text) returns public.order_line language sql as $$
  select l from public.order_line l where l.id = p_id::uuid $$;
-- Adds a line to session 1 at t(0) as the current caller; returns nothing.
create function pg_temp.addl(p_line text, p_item text, p_extra text default '{}') returns void language plpgsql as $$
begin
  perform public.add_order_line('14000000-0000-4000-8000-000000000001',
    (jsonb_build_object('lineId', p_line, 'menuItemId', p_item, 'clientUpdatedAt', pg_temp.t(0)) || p_extra::jsonb));
end
$$;
create function pg_temp.upd(p_line text, p_t int, p_extra text default '{}') returns text language sql as $$
  select 'select public.update_order_line(' || quote_literal(p_line) || '::uuid, ' ||
         quote_literal((jsonb_build_object('clientUpdatedAt', pg_temp.t(p_t)) || p_extra::jsonb)::text) || '::jsonb)' $$;
create function pg_temp.rm(p_line text, p_t int) returns text language sql as $$
  select 'select public.remove_order_line(' || quote_literal(p_line) || '::uuid, ' ||
         quote_literal(jsonb_build_object('clientUpdatedAt', pg_temp.t(p_t))::text) || '::jsonb)' $$;

-- A waiter of tenant B (the shared fixture has only B's owner).
insert into auth.users (id, email) values ('bb000000-0000-4000-8000-0000000000bb', 'waiter-b@example.test');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('bb100000-0000-4000-8000-0000000000bb', '22222222-2222-4222-8222-222222222222', 'bb000000-0000-4000-8000-0000000000bb', 'waiter', 'Cameriere B Demo');

select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000b1', 'ec000000-0000-4000-8000-0000000000e1', now() + interval '2 days', '10000000-0000-4000-8000-0000000000a1', 50, 1);
-- One line to edit, and one line per actor to remove (all drafts of tenant A, inserted as the owner of the tables).
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by)
  select ('e1000000-0000-4000-8000-0000000004' || lpad(n::text, 2, '0'))::uuid, '11111111-1111-4111-8111-111111111111',
         '14000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000003', 'antipasti', 1, 5, 10, 'menu', pg_temp.t(0)::timestamptz,
         'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'
    from generate_series(0, 7) n;

create temp table actors (idx int primary key, label text, auth uuid, tenant uuid, app_role text);
insert into actors values
  (1, 'owner',   'a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner'),
  (2, 'admin',   'f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin'),
  (3, 'waiter',  'd0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter'),
  (4, 'chef',    'c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef'),
  (5, 'none',    null, null, null),
  (6, 'ownerB',  'b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner'),
  (7, 'waiterB', 'bb000000-0000-4000-8000-0000000000bb', '22222222-2222-4222-8222-222222222222', 'waiter');
create temp table outcomes (fn text, idx int, label text, outcome text, primary key (fn, idx));

do $run$
declare
  a record;
  v_res text;
  v_stmt text;
begin
  for a in select * from actors order by idx loop
    if a.auth is null then
      perform set_config('request.jwt.claims', '', true);
    else
      perform pg_temp.act_as(a.auth, a.tenant, a.app_role);
    end if;
    foreach v_stmt in array array['menu_list', 'order_view', 'add_order_line', 'update_order_line', 'remove_order_line'] loop
      v_res := pg_temp.err(case v_stmt
        when 'menu_list' then 'select public.menu_list()'
        when 'order_view' then 'select public.order_view(''14000000-0000-4000-8000-000000000001'')'
        when 'add_order_line' then format('select public.add_order_line(''14000000-0000-4000-8000-000000000001'', %L::jsonb)',
          jsonb_build_object('lineId', 'e1000000-0000-4000-8000-0000000005' || lpad(a.idx::text, 2, '0'),
                             'menuItemId', '11000000-0000-4000-8000-000000000003', 'clientUpdatedAt', pg_temp.t(0))::text)
        when 'update_order_line' then format('select public.update_order_line(''e1000000-0000-4000-8000-000000000400'', %L::jsonb)',
          jsonb_build_object('clientUpdatedAt', pg_temp.t(a.idx), 'qty', a.idx)::text)
        else format('select public.remove_order_line(%L::uuid, %L::jsonb)',
          'e1000000-0000-4000-8000-0000000004' || lpad(a.idx::text, 2, '0'),
          jsonb_build_object('clientUpdatedAt', pg_temp.t(1))::text) end);
      insert into outcomes values (v_stmt, a.idx, a.label, case when v_res = 'ok' then 'ok' else left(v_res, 5) end);
    end loop;
  end loop;
end
$run$;

create function pg_temp.row_of(p_fn text) returns text language sql as $$
  select string_agg(label || ':' || outcome, ',' order by idx) from outcomes where fn = p_fn $$;
select is(pg_temp.row_of('menu_list'), 'owner:ok,admin:ok,waiter:ok,chef:42501,none:42501,ownerB:ok,waiterB:ok', 'menu_list: owner, admin, waiter and tenant B read; chef and no claims are refused');
select is(pg_temp.row_of('order_view'), 'owner:ok,admin:ok,waiter:ok,chef:42501,none:42501,ownerB:P0002,waiterB:P0002', 'order_view: staff of A read; chef 42501; tenant B P0002');
select is(pg_temp.row_of('add_order_line'), 'owner:ok,admin:ok,waiter:ok,chef:42501,none:42501,ownerB:P0002,waiterB:P0002', 'add_order_line: owner, admin, waiter add; chef 42501; tenant B P0002');
select is(pg_temp.row_of('update_order_line'), 'owner:ok,admin:ok,waiter:ok,chef:42501,none:42501,ownerB:P0002,waiterB:P0002', 'update_order_line: owner, admin, waiter edit; chef 42501; tenant B P0002');
select is(pg_temp.row_of('remove_order_line'), 'owner:ok,admin:ok,waiter:ok,chef:42501,none:42501,ownerB:P0002,waiterB:P0002', 'remove_order_line: owner, admin, waiter remove; chef 42501; tenant B P0002');

-- Nothing was written by the refused callers, and A's rows are as the last allowed caller left them.
select is((select string_agg(left(id::text, 36), ',' order by id) from public.order_line where id::text like 'e1000000-0000-4000-8000-0000000005%'),
  'e1000000-0000-4000-8000-000000000501,e1000000-0000-4000-8000-000000000502,e1000000-0000-4000-8000-000000000503',
  'only the owner, admin and waiter wrote a line (ids 501-503)');
select is((select qty from public.order_line where id = 'e1000000-0000-4000-8000-000000000400'), 3::numeric, 'the edited line holds the waiter''s (the last allowed) quantity; the later refusals changed nothing');
select is((select string_agg(right(id::text, 2) || ':' || state, ',' order by id) from public.order_line where id::text like 'e1000000-0000-4000-8000-0000000004%' and right(id::text, 2) <> '00'),
  '01:voided,02:voided,03:voided,04:draft,05:draft,06:draft,07:draft', 'the lines of the refused actors (4 to 7) are still drafts');
select is((select count(*)::int from public.order_line where tenant_id = '22222222-2222-4222-8222-222222222222'), 1, 'tenant B''s only line is untouched');
select is((select count(*)::int from public.order_line where tenant_id = '11111111-1111-4111-8111-111111111111' and id::text like 'e1000000-0000-4000-8000-0000000004%'), 8, 'tenant A''s fixture lines are all still there');
-- Tenant B's menu shows only its own item.
select pg_temp.act_as('bb000000-0000-4000-8000-0000000000bb', '22222222-2222-4222-8222-222222222222', 'waiter');
select is((select jsonb_path_query_array(public.menu_list(), '$.categories[*].items[*].name')), '["Solo B (demo)"]'::jsonb, 'tenant B''s waiter sees only tenant B''s dish');

-- Privileges.
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r,
                  unnest(array['public.menu_list()', 'public.order_view(uuid)', 'public.add_order_line(uuid, jsonb)',
                               'public.update_order_line(uuid, jsonb)', 'public.remove_order_line(uuid, jsonb)']) f
            where has_function_privilege(r, f, 'execute') and r <> 'authenticated'), 0, 'anon and service_role execute none of the five public functions');
select is((select count(*)::int from unnest(array['public.menu_list()', 'public.order_view(uuid)', 'public.add_order_line(uuid, jsonb)',
                               'public.update_order_line(uuid, jsonb)', 'public.remove_order_line(uuid, jsonb)']) f
            where has_function_privilege('authenticated', f, 'execute')), 5, 'authenticated executes all five');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r,
                  unnest(array['app.low_stock_hint_portions()', 'app.client_clock_tolerance()', 'app.plate_batch_needs(uuid, uuid[])',
                               'app.menu_item_availability(uuid, uuid[], timestamptz)', 'app.lock_live_batches(uuid, uuid[])',
                               'app.order_line_json(public.order_line)', 'app.parse_client_time(jsonb)', 'app.order_uuid(jsonb)',
                               'app.order_qty(jsonb)', 'app.order_note(jsonb)', 'app.order_course(jsonb)',
                               'app.order_add_replay(uuid, uuid, uuid, uuid)', 'app.order_conflict(text, public.order_line)',
                               'app.order_line_guard()', 'app.live_batch_remaining(uuid, uuid[], timestamptz)']) f
            where has_function_privilege(r, f, 'execute')), 0, 'no API role executes any of the 15 app.* functions of M18');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('menu_list', 'order_view', 'add_order_line', 'update_order_line', 'remove_order_line')
              and p.prosecdef and p.proconfig = array['search_path=""']), 5, 'all five public functions are definers with an empty search_path');

select * from finish();
rollback;
