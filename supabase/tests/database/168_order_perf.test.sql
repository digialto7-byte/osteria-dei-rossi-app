-- M18 step 8: the performance net (plan §3.9, T1). A regression net, not a latency claim: on a big tenant (50 menu
-- items, 2 000 historical batches, 10 live ones, 200 lines on 20 sessions) the waiter's reads and writes answer under a
-- 5 s statement limit, and the availability query reads the live batches through batch_live_idx and the movements
-- through batch_movement_batch_idx. Fake data only.
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

-- A big tenant: 5 batch recipes, 25 plates, 50 menu items (25 mapped, 25 unmapped), 2 000 historical batches
-- (finished, discarded, expired) plus 10 live ones, 20 sessions with 200 lines.
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by)
  select ('ec000000-0000-4000-8000-0000000010' || lpad(n::text, 2, '0'))::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'batch'::public.recipe_type, 1, 'perf batch ' || n, 'a1000000-0000-4000-8000-00000000000a'::uuid
    from generate_series(1, 5) n
  union all
  select ('ec000000-0000-4000-8000-0000000020' || lpad(n::text, 2, '0'))::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'plate'::public.recipe_type, 1, 'perf plate ' || n, 'a1000000-0000-4000-8000-00000000000a'::uuid
    from generate_series(1, 25) n;
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch, shelf_life_hours, created_by)
  select ('ed000000-0000-4000-8000-0000000010' || lpad(n::text, 2, '0'))::uuid, '11111111-1111-4111-8111-111111111111',
         ('ec000000-0000-4000-8000-0000000010' || lpad(n::text, 2, '0'))::uuid, 1, now() - interval '30 days', 'Perf batch ' || n, 2, 'kg', 10, 48, 'a1000000-0000-4000-8000-00000000000a'
    from generate_series(1, 5) n;
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by)
  select ('ed000000-0000-4000-8000-0000000020' || lpad(n::text, 2, '0'))::uuid, '11111111-1111-4111-8111-111111111111',
         ('ec000000-0000-4000-8000-0000000020' || lpad(n::text, 2, '0'))::uuid, 1, now() - interval '30 days', 'Perf plate ' || n, 'a1000000-0000-4000-8000-00000000000a'
    from generate_series(1, 25) n;
insert into public.recipe_line (tenant_id, recipe_id, position, sub_recipe_key, qty, unit, yield_factor, created_by)
  select '11111111-1111-4111-8111-111111111111', ('ed000000-0000-4000-8000-0000000020' || lpad(n::text, 2, '0'))::uuid, 1,
         ('ec000000-0000-4000-8000-0000000010' || lpad((1 + n % 5)::text, 2, '0'))::uuid, 1, 'porz', 1, 'a1000000-0000-4000-8000-00000000000a'
    from generate_series(1, 25) n;
insert into public.menu_item (id, tenant_id, name, category, course_default, recipe_key, position, created_by, updated_by)
  select ('11000000-0000-4000-8000-0000000030' || lpad(n::text, 2, '0'))::uuid, '11111111-1111-4111-8111-111111111111', 'Perf piatto ' || n, 'Categoria ' || (n % 5),
         (array['antipasti', 'primi', 'secondi', 'dolci', 'bevande'])[1 + n % 5]::public.course,
         case when n <= 25 then ('ec000000-0000-4000-8000-0000000020' || lpad(n::text, 2, '0'))::uuid end, n,
         'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'
    from generate_series(1, 50) n;
insert into public.menu_item_price (tenant_id, menu_item_id, price, vat_rate, valid_from, created_by)
  select '11111111-1111-4111-8111-111111111111', ('11000000-0000-4000-8000-0000000030' || lpad(n::text, 2, '0'))::uuid, 5 + n, 10, now() - interval '1 day', 'a1000000-0000-4000-8000-00000000000a'
    from generate_series(1, 50) n;

-- Batches: n 1..10 live (2 per key, 50 portions), the rest history.
insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code, lot_seq,
                          produced_at, produced_by, output_qty, output_unit, portions_computed, portions_initial, shelf_life_hours,
                          use_by, state, location_id, created_by)
  select ('ba000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, '11111111-1111-4111-8111-111111111111',
         ('ec000000-0000-4000-8000-0000000010' || lpad(k::text, 2, '0'))::uuid, ('ed000000-0000-4000-8000-0000000010' || lpad(k::text, 2, '0'))::uuid,
         1, '261023-LOT-' || n, '2026-10-23', 'LOT', n, u - interval '48 hours', 'a1000000-0000-4000-8000-00000000000a', 2, 'kg',
         case when n <= 10 then 50 else 5 end, case when n <= 10 then 50 else 5 end, 48, u,
         (case when n <= 10 then 'fresh' when n % 3 = 0 then 'finished' when n % 3 = 1 then 'discarded' else 'fresh' end)::public.batch_state,
         '10000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-00000000000a'
    from (select n, 1 + n % 5 as k,
                 case when n <= 10 then now() + interval '2 days' when n % 3 = 2 then now() - interval '1 day' else now() + interval '2 days' end as u
            from generate_series(1, 2010) n) g;
insert into public.batch_movement (tenant_id, batch_id, type, portions, reason_code, ref_type, ref_id, effective_on, created_by)
  select '11111111-1111-4111-8111-111111111111', ('ba000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'produce', case when n <= 10 then 50 else 5 end,
         null, 'batch', ('ba000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, '2026-10-23', 'a1000000-0000-4000-8000-00000000000a'
    from generate_series(1, 2010) n;
insert into public.batch_movement (tenant_id, batch_id, type, portions, reason_code, ref_type, ref_id, effective_on, created_by)
  select '11111111-1111-4111-8111-111111111111', ('ba000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
         case when n % 3 = 0 then 'count' else 'waste' end::public.batch_movement_type, -5,
         case when n % 3 = 0 then null else 'spoilage' end, case when n % 3 = 0 then 'batch_adjust' else 'batch_discard' end,
         gen_random_uuid(), '2026-10-23', 'a1000000-0000-4000-8000-00000000000a'
    from generate_series(11, 2010) n where n % 3 in (0, 1);

-- 20 sessions (one per table) with 10 lines each.
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by)
  select ('13000000-0000-4000-8000-0000000040' || lpad(n::text, 2, '0'))::uuid, '11111111-1111-4111-8111-111111111111', 'Perf tavolo ' || n, 100 + n,
         'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'
    from generate_series(1, 20) n;
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, created_by, updated_by)
  select ('14000000-0000-4000-8000-0000000040' || lpad(n::text, 2, '0'))::uuid, '11111111-1111-4111-8111-111111111111',
         ('13000000-0000-4000-8000-0000000040' || lpad(n::text, 2, '0'))::uuid, 'Perf tavolo ' || n, 2, 'a1000000-0000-4000-8000-00000000000a', '2026-10-24',
         'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'
    from generate_series(1, 20) n;
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by)
  select ('e1000000-0000-4000-8000-' || lpad((1000 + n)::text, 12, '0'))::uuid, '11111111-1111-4111-8111-111111111111',
         ('14000000-0000-4000-8000-0000000040' || lpad((1 + (n - 1) / 10)::text, 2, '0'))::uuid,
         ('11000000-0000-4000-8000-0000000030' || lpad((26 + n % 25)::text, 2, '0'))::uuid, 'primi', 1, 8, 10, 'menu', now() - interval '1 hour',
         'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'
    from generate_series(1, 200) n;
analyze public.batch;
analyze public.batch_movement;
analyze public.order_line;
analyze public.menu_item;
analyze public.recipe_line;

select is((select count(*)::int from public.batch), 2010, 'fixture: 2 010 batches (10 live, the rest history)');
select is((select count(*)::int from public.batch where state in ('fresh', 'open') and use_by > now()), 10, 'fixture: 10 live batches');
select is((select count(*)::int from public.order_line), 201, 'fixture: 200 lines of the big tenant plus the fixture line of tenant B');
select is((select count(*)::int from public.menu_item where tenant_id = '11111111-1111-4111-8111-111111111111' and id::text like '11000000-0000-4000-8000-0000000030%'), 50, 'fixture: 50 menu items');

-- The plan of the helper that reads the live batches (the availability function calls it with the plate's batch keys).
create function pg_temp.availability_plan(p_key uuid) returns text language plpgsql as $$
declare
  v_src text;
  v_json text;
begin
  select p.prosrc into v_src from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'live_batch_remaining';
  v_src := replace(replace(replace(v_src, 'p_tenant', quote_literal('11111111-1111-4111-8111-111111111111') || '::uuid'),
                           'p_keys', 'array[' || quote_literal(p_key) || '::uuid]'),
                   'p_at', quote_literal(now()) || '::timestamptz');
  execute 'explain (format json) ' || v_src into v_json;
  return v_json;
end
$$;

select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
set local statement_timeout = '5s';
create temp table r (nm text primary key, j jsonb);
select lives_ok($$ insert into r select 'menu', public.menu_list() $$, 'menu_list answers within 5 s on the big tenant');
select is((select jsonb_array_length(jsonb_path_query_array(j, '$.categories[*].items[*] ? (@.name like_regex "^Perf piatto")')) from r where nm = 'menu'), 50, 'and lists the 50 big-tenant items (with the 6 active ones of the shared fixture, 56 in all)');
select is((select (jsonb_path_query_first(j, '$.categories[*].items[*] ? (@.name == "Perf piatto 1")') ->> 'portionsLeft') from r where nm = 'menu'), '100', 'a mapped item sums the two live batches of its key (2 x 50 portions); history does not count');
select is((select (jsonb_path_query_first(j, '$.categories[*].items[*] ? (@.name == "Perf piatto 30")') -> 'portionsLeft') from r where nm = 'menu'), 'null'::jsonb, 'an unmapped item has no limit');
select lives_ok($$ insert into r select 'add', public.add_order_line('14000000-0000-4000-8000-000000004001', jsonb_build_object(
    'lineId', 'e1000000-0000-4000-8000-000000009001', 'menuItemId', '11000000-0000-4000-8000-000000003003',
    'clientUpdatedAt', pg_temp.t(0))) $$, 'add_order_line answers within 5 s on the big tenant');
select is((select j ->> 'created' from r where nm = 'add'), 'true', 'and creates the line');
select lives_ok($$ insert into r select 'view', public.order_view('14000000-0000-4000-8000-000000004002') $$, 'order_view answers within 5 s');
select is((select jsonb_array_length(j -> 'lines') from r where nm = 'view'), 10, 'and lists the 10 lines of the session');
select lives_ok($$ insert into r select 'upd', public.update_order_line('e1000000-0000-4000-8000-000000009001', jsonb_build_object('clientUpdatedAt', pg_temp.t(1), 'qty', 2)) $$, 'update_order_line answers within 5 s');
reset statement_timeout;

-- T1: the availability query reads the live batches through batch_live_idx and the movements through batch_movement_batch_idx.
select ok(pg_temp.availability_plan('ec000000-0000-4000-8000-000000001002') like '%batch\_live\_idx%', 'T1: the plan of the live-batch read uses batch_live_idx');
select ok(pg_temp.availability_plan('ec000000-0000-4000-8000-000000001002') like '%batch\_movement\_batch\_idx%', 'T1: and batch_movement_batch_idx (the batch-id qual is pushed below the view''s grouping)');

select * from finish();
rollback;
