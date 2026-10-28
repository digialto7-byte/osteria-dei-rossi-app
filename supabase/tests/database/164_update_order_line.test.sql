-- M18 step 5: update_order_line (plan §3.1.2, §3.1.3, §3.2; ADR-017; AT3 move, AT5 last write wins). Edit and move,
-- the conflict reply (stale, fired, voided, session_closed) as a normal result {conflict: {reason, line}}, the equal-instant
-- replay, the availability check on a quantity increase, validation, tenancy and roles. Each write sets only its own
-- fields. Fake data only; rows are found by id.
begin;
create extension if not exists pgtap with schema extensions;
select plan(61);

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

create function pg_temp.do_upd(p_line text, p_t int, p_extra text default '{}') returns jsonb language sql as $$
  select public.update_order_line(p_line::uuid, jsonb_build_object('clientUpdatedAt', pg_temp.t(p_t)) || p_extra::jsonb) $$;
create function pg_temp.res(stmt text) returns jsonb language plpgsql as $$
declare
  j jsonb;
begin
  execute stmt into j;
  return j;
end
$$;
create temp table r (nm text primary key, j jsonb, ts timestamptz);

-- Stock: one live stew batch of 5 portions. Waiter A adds the lines at t0.
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000b1', 'ec000000-0000-4000-8000-0000000000e1', now() + interval '2 days', '10000000-0000-4000-8000-0000000000a1', 5, 1);
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select pg_temp.addl('e1000000-0000-4000-8000-000000000101', '11000000-0000-4000-8000-000000000003');
select pg_temp.addl('e1000000-0000-4000-8000-000000000102', '11000000-0000-4000-8000-000000000001');
select pg_temp.addl('e1000000-0000-4000-8000-000000000103', '11000000-0000-4000-8000-000000000003');
select pg_temp.addl('e1000000-0000-4000-8000-000000000104', '11000000-0000-4000-8000-000000000003');
select pg_temp.addl('e1000000-0000-4000-8000-000000000105', '11000000-0000-4000-8000-000000000003');
select pg_temp.addl('e1000000-0000-4000-8000-000000000107', '11000000-0000-4000-8000-000000000001');
select pg_temp.addl('e1000000-0000-4000-8000-000000000108', '11000000-0000-4000-8000-000000000001', '{"qty":2}');
select pg_temp.addl('e1000000-0000-4000-8000-000000000109', '11000000-0000-4000-8000-000000000003');
update public.order_line set fired_at = now(), fired_by = 'd1000000-0000-4000-8000-00000000000d' where id = 'e1000000-0000-4000-8000-000000000104';
update public.order_line set voided_at = now(), voided_by = 'd1000000-0000-4000-8000-00000000000d', void_reason = 'entry_removed' where id = 'e1000000-0000-4000-8000-000000000105';
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by) values
  ('e1000000-0000-4000-8000-000000000106', '11111111-1111-4111-8111-111111111111', '14000000-0000-4000-8000-000000000003', '11000000-0000-4000-8000-000000000003', 'antipasti', 1, 5, 10, 'menu', '2026-10-24 12:00+00', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d');

-- AT3: move antipasti -> secondi at t2.
insert into r (nm, ts) select 'before_move', (pg_temp.line('e1000000-0000-4000-8000-000000000101')).updated_at;
insert into r (nm, j) values ('move', pg_temp.do_upd('e1000000-0000-4000-8000-000000000101', 2, '{"course":"secondi"}'));
select is((select j ->> 'changed' from r where nm = 'move'), 'true', 'AT3: the move reports changed true');
select is((select (pg_temp.line('e1000000-0000-4000-8000-000000000101')).course::text), 'secondi', 'AT3: the course is persisted');
select is((select j -> 'line' ->> 'course' from r where nm = 'move'), 'secondi', 'and the reply carries the new line');
select is((select array_agg(k order by k) from r, jsonb_object_keys(j) k where r.nm = 'move'), array['changed', 'line'], 'the reply is {changed, line}');
select cmp_ok((select (pg_temp.line('e1000000-0000-4000-8000-000000000101')).updated_at), '>', (select ts from r where nm = 'before_move'), 'updated_at advanced');
select is((select (pg_temp.line('e1000000-0000-4000-8000-000000000101')).updated_by::text), 'd1000000-0000-4000-8000-00000000000d', 'updated_by is the caller');
select is((select (pg_temp.line('e1000000-0000-4000-8000-000000000101')).client_updated_at), (select base + interval '2 minutes' from tb), 'client_updated_at is the body instant');
select is((select (pg_temp.line('e1000000-0000-4000-8000-000000000101')).unit_price), 5::numeric, 'the move did not re-price the line');

-- AT5: A edits L102 at t2 (note); B edits it at t1 (qty 2) and loses.
select pg_temp.do_upd('e1000000-0000-4000-8000-000000000102', 2, '{"note":"ben cotto"}');
select pg_temp.act_as('e0000000-0000-4000-8000-00000000000e', '11111111-1111-4111-8111-111111111111', 'waiter');
select is((pg_temp.res(pg_temp.upd('e1000000-0000-4000-8000-000000000102', 1, '{"qty":2}')) ? 'conflict'), true, 'AT5: the earlier edit by B is a conflict');
insert into r (nm, j) values ('stale', pg_temp.res(pg_temp.upd('e1000000-0000-4000-8000-000000000102', 1, '{"qty":2}')) -> 'conflict');
select is((select j ->> 'reason' from r where nm = 'stale'), 'stale', 'AT5: the reason is stale');
select is((select j -> 'line' ->> 'note' || '/' || (j -> 'line' ->> 'qty') || '/' || (j -> 'line' -> 'updatedBy' ->> 'displayName') from r where nm = 'stale'), 'ben cotto/1/Cameriere Demo', 'AT5: the conflict carries the current line (note, qty, and who changed it)');
select is((select array_agg(k order by k) from r, jsonb_object_keys(j) k where r.nm = 'stale'), array['line', 'reason'], 'the conflict is {reason, line}');
select is((select (pg_temp.line('e1000000-0000-4000-8000-000000000102')).qty), 1::numeric, 'AT5: nothing changed (qty still 1)');
-- Reverse order: B at t1 first, then A at t2 -> both apply, each its own fields.
select pg_temp.do_upd('e1000000-0000-4000-8000-000000000103', 1, '{"qty":2}');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select pg_temp.do_upd('e1000000-0000-4000-8000-000000000103', 2, '{"note":"ben cotto"}');
select is((select trim_scale((pg_temp.line('e1000000-0000-4000-8000-000000000103')).qty)::text || '/' || (pg_temp.line('e1000000-0000-4000-8000-000000000103')).note), '2/ben cotto', 'reverse order: B''s qty and A''s note are both there');
select is((select (pg_temp.line('e1000000-0000-4000-8000-000000000103')).updated_by::text), 'd1000000-0000-4000-8000-00000000000d', 'and the last writer is A');

-- Replay: A's t2 edit again changes nothing and writes nothing.
insert into r (nm, ts) select 'before_replay', (pg_temp.line('e1000000-0000-4000-8000-000000000102')).updated_at;
insert into r (nm, j) values ('replay', pg_temp.do_upd('e1000000-0000-4000-8000-000000000102', 2, '{"note":"ben cotto"}'));
select is((select j ->> 'changed' from r where nm = 'replay'), 'false', 'replay: changed false');
select is((select (pg_temp.line('e1000000-0000-4000-8000-000000000102')).updated_at), (select ts from r where nm = 'before_replay'), 'replay: nothing written (updated_at unchanged)');
select is((pg_temp.res(pg_temp.upd('e1000000-0000-4000-8000-000000000102', 2, '{"note":"al sangue"}')) ? 'conflict'), true, 'the same instant with a different patch is a conflict');
select is((pg_temp.res(pg_temp.upd('e1000000-0000-4000-8000-000000000102', 2, '{"note":"al sangue"}')) -> 'conflict' ->> 'reason'), 'stale', 'with the reason stale');
select pg_temp.act_as('e0000000-0000-4000-8000-00000000000e', '11111111-1111-4111-8111-111111111111', 'waiter');
select is((pg_temp.res(pg_temp.upd('e1000000-0000-4000-8000-000000000102', 2, '{"note":"ben cotto"}')) -> 'conflict' ->> 'reason'), 'stale', 'the same fields at the same instant by another waiter are stale (not a replay)');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
-- A newer instant with identical values: changed false, but the instant advances (an older edit then loses).
insert into r (nm, j) values ('same', pg_temp.do_upd('e1000000-0000-4000-8000-000000000102', 4, '{"note":"ben cotto","qty":1}'));
select is((select j ->> 'changed' from r where nm = 'same'), 'false', 'identical values at a newer instant: changed false');
select is((pg_temp.res(pg_temp.upd('e1000000-0000-4000-8000-000000000102', 3, '{"qty":3}')) -> 'conflict' ->> 'reason'), 'stale', 'and the instant advanced: an edit at t3 is now stale');

-- Irreversible states win over any instant.
select is((pg_temp.res(pg_temp.upd('e1000000-0000-4000-8000-000000000104', 50, '{"qty":3}')) -> 'conflict' ->> 'reason'), 'fired', 'a fired line: conflict fired');
select is((pg_temp.res(pg_temp.upd('e1000000-0000-4000-8000-000000000104', 0, '{"qty":3}')) -> 'conflict' ->> 'reason'), 'fired', 'fired wins even over a stale instant');
select is((pg_temp.res(pg_temp.upd('e1000000-0000-4000-8000-000000000104', 50, '{"qty":3}')) -> 'conflict' -> 'line' ->> 'state'), 'fired', 'the fired conflict carries the line (state fired)');
select is((pg_temp.res(pg_temp.upd('e1000000-0000-4000-8000-000000000105', 50, '{"qty":3}')) -> 'conflict' ->> 'reason'), 'voided', 'a voided line: conflict voided');
select is((pg_temp.res(pg_temp.upd('e1000000-0000-4000-8000-000000000105', 50, '{"qty":3}')) -> 'conflict' -> 'line' ->> 'state'), 'voided', 'the voided conflict carries the line (state voided)');
select is((pg_temp.res(pg_temp.upd('e1000000-0000-4000-8000-000000000106', 50, '{"qty":3}')) -> 'conflict' ->> 'reason'), 'session_closed', 'a line of a closed session: conflict session_closed');
select is((pg_temp.res(pg_temp.upd('e1000000-0000-4000-8000-000000000106', 50, '{"qty":3}')) ? 'conflict'), true, 'raised as conflict');

-- Availability on a quantity increase: the stew goes out.
select pg_temp.adj('ba000000-0000-4000-8000-0000000000b1', -5);
select is(pg_temp.err(pg_temp.upd('e1000000-0000-4000-8000-000000000107', 10, '{"qty":2}')), 'P0001 item_unavailable', 'stew at 0 portions: qty 1 -> 2 is item_unavailable');
select is((pg_temp.err_detail(pg_temp.upd('e1000000-0000-4000-8000-000000000107', 10, '{"qty":2}'))::jsonb), jsonb_build_object('menuItemId', '11000000-0000-4000-8000-000000000001', 'reason', 'no_portions', 'portionsLeft', 0), 'with the detail of add_order_line');
select is((pg_temp.line('e1000000-0000-4000-8000-000000000107')).qty, 1::numeric, 'and the quantity is unchanged');
select is(pg_temp.err(pg_temp.upd('e1000000-0000-4000-8000-000000000108', 10, '{"qty":1}')), 'ok', 'a decrease 2 -> 1 is accepted at 0 portions');
select is(pg_temp.err(pg_temp.upd('e1000000-0000-4000-8000-000000000107', 11, '{"course":"primi","note":"da dividere"}')), 'ok', 'a move and a note are accepted at 0 portions');
select is(pg_temp.err(pg_temp.upd('e1000000-0000-4000-8000-000000000107', 12, '{"qty":1}')), 'ok', 'the same quantity is not an increase');

-- Fields: segue, shared, clearing a note, half portions.
insert into r (nm, j) values ('flags', pg_temp.do_upd('e1000000-0000-4000-8000-000000000109', 2, '{"segue":true,"isShared":true,"qty":0.5,"note":"senza sale"}'));
select is((select l.segue::text || '/' || l.is_shared::text || '/' || l.qty::text || '/' || l.note from pg_temp.line('e1000000-0000-4000-8000-000000000109') l), 'true/true/0.5/senza sale', 'segue, shared, half portion and note are edited');
select is((select j ->> 'changed' from r where nm = 'flags'), 'true', 'changed true');
select pg_temp.do_upd('e1000000-0000-4000-8000-000000000109', 3, '{"note":"  "}');
select is((select (pg_temp.line('e1000000-0000-4000-8000-000000000109')).note), null, 'a blank note clears the note');

-- Shape errors.
select is(pg_temp.err('select public.update_order_line(''e1000000-0000-4000-8000-000000000109'', ''{}''::jsonb)'), '22023 invalid_request', 'an empty patch is invalid_request');
select is(pg_temp.err('select public.update_order_line(''e1000000-0000-4000-8000-000000000109'', jsonb_build_object(''qty'', 2))'), '22023 invalid_request', 'a patch without clientUpdatedAt is invalid_request');
select is(pg_temp.err('select public.update_order_line(''e1000000-0000-4000-8000-000000000109'', jsonb_build_object(''clientUpdatedAt'', pg_temp.t(20)))'), '22023 invalid_request', 'a patch with only clientUpdatedAt is invalid_request');
select is(pg_temp.err(pg_temp.upd('e1000000-0000-4000-8000-000000000109', 20, '{"price":1}')), '22023 invalid_request', 'an unknown key (price) is invalid_request');
select is(pg_temp.err(pg_temp.upd('e1000000-0000-4000-8000-000000000109', 20, '{"menuItemId":"11000000-0000-4000-8000-000000000001"}')), '22023 invalid_request', 'the dish cannot be changed (menuItemId is an unknown key)');
select is(pg_temp.err(pg_temp.upd('e1000000-0000-4000-8000-000000000109', 20, '{"qty":0.3}')), 'P0001 qty_invalid', 'qty 0.3 is qty_invalid');
select is(pg_temp.err(pg_temp.upd('e1000000-0000-4000-8000-000000000109', 20, jsonb_build_object('note', repeat('x', 141))::text)), 'P0001 note_invalid', 'a 141-character note is note_invalid');
select is(pg_temp.err(pg_temp.upd('e1000000-0000-4000-8000-000000000109', 20, '{"course":"dessert"}')), 'P0001 course_invalid', 'an unknown course is course_invalid');
select is(pg_temp.err(pg_temp.upd('e1000000-0000-4000-8000-000000000109', 20, '{"segue":"yes"}')), '22023 invalid_request', 'a text flag is invalid_request');
select is(pg_temp.err(pg_temp.upd('e1000000-0000-4000-8000-000000000109', 200, '{"qty":2}')), 'P0001 client_time_invalid', 'an instant 200 minutes ahead is client_time_invalid');
select is((pg_temp.line('e1000000-0000-4000-8000-000000000109')).qty, 0.5::numeric, 'the refused edits changed nothing');

-- Tenancy and roles.
select is(pg_temp.err(pg_temp.upd('e1000000-0000-4000-8000-0000000000b1', 20, '{"qty":2}')), 'P0002 line_not_found', 'tenant B''s line is line_not_found');
select is(pg_temp.err(pg_temp.upd('99999999-9999-4999-8999-999999999999', 20, '{"qty":2}')), 'P0002 line_not_found', 'an unknown line is line_not_found');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.err(pg_temp.upd('e1000000-0000-4000-8000-000000000109', 21, '{"qty":3}')), 'ok', 'the owner may edit any line');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is(pg_temp.err(pg_temp.upd('e1000000-0000-4000-8000-000000000109', 22, '{"qty":4}')), 'ok', 'the admin may edit any line');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.err(pg_temp.upd('e1000000-0000-4000-8000-000000000109', 23, '{"qty":5}')), '42501 permission denied: opening tables needs owner, admin or waiter', 'the chef is refused');
select is((pg_temp.line('e1000000-0000-4000-8000-000000000109')).qty, 4::numeric, 'the chef changed nothing');
select set_config('request.jwt.claims', '', true);
select is(left(pg_temp.err(pg_temp.upd('e1000000-0000-4000-8000-000000000109', 24, '{"qty":5}')), 5), '42501', 'no claims: 42501');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(pg_temp.err(pg_temp.upd('e1000000-0000-4000-8000-000000000109', 24, '{"qty":5}')), 'P0002 line_not_found', 'owner B cannot edit A''s line');

-- Logs carry codes only (plan §3.1.13): no raised DETAIL of these paths holds a free-text note or a display name, and the
-- four conflict reasons are results, not errors (they raise nothing, so there is no DETAIL at all).
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is((select count(*)::int from unnest(array[
    pg_temp.upd('e1000000-0000-4000-8000-000000000102', 1, '{"qty":2}'),
    pg_temp.upd('e1000000-0000-4000-8000-000000000104', 50, '{"qty":3}'),
    pg_temp.upd('e1000000-0000-4000-8000-000000000105', 50, '{"qty":3}'),
    pg_temp.upd('e1000000-0000-4000-8000-000000000106', 50, '{"qty":3}')]) s where pg_temp.err(s) <> 'ok'), 0,
  'stale, fired, voided and session_closed raise nothing');
select is((select count(*)::int from unnest(array[
    pg_temp.upd('e1000000-0000-4000-8000-000000000107', 10, '{"qty":2}'),
    pg_temp.upd('e1000000-0000-4000-8000-000000000107', 10, '{"qty":0}'),
    pg_temp.upd('e1000000-0000-4000-8000-000000000107', 10, '{"note":"' || repeat('x', 400) || '"}'),
    pg_temp.upd('e1000000-0000-4000-8000-000000000107', 10, '{"course":"nope"}'),
    pg_temp.upd('e1000000-0000-4000-8000-0000000000ff', 10, '{"qty":2}'),
    pg_temp.upd('e1000000-0000-4000-8000-000000000107', 10, '{"qty":2,"bogus":1}')]) s
    where coalesce(pg_temp.err_detail(s), '') ~* '(note|displayname|da dividere|cameriere)'), 0,
  'no raised DETAIL of update_order_line contains a note or a display name');

select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r where has_function_privilege(r, 'public.update_order_line(uuid, jsonb)', 'execute')), 1, 'only authenticated executes update_order_line');
select is((select count(*)::int from pg_proc p where p.proname = 'update_order_line' and p.prosecdef and p.provolatile = 'v' and p.proconfig = array['search_path=""']), 1, 'update_order_line is a volatile definer with an empty search_path');

select * from finish();
rollback;
