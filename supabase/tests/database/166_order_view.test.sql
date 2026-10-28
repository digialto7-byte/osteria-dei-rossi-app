-- M18 step 6: order_view (plan §3.1.9, §3.2; ADR-017): a session and its lines for the waiter's screen. Lines ordered
-- by course (enum order), creation and id; a line removed before the fire is left out, a fired-then-voided one stays;
-- the status comes from M17's derivation; fixed key sets with a recursive no-cost scan; the waiter reads no order_line
-- directly. Rows are found by id. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

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

create function pg_temp.all_keys(j jsonb) returns setof text language plpgsql as $$
declare
  k text;
  v jsonb;
begin
  if jsonb_typeof(j) = 'object' then
    for k, v in select * from jsonb_each(j) loop
      return next k;
      return query select * from pg_temp.all_keys(v);
    end loop;
  elsif jsonb_typeof(j) = 'array' then
    for v in select * from jsonb_array_elements(j) loop
      return query select * from pg_temp.all_keys(v);
    end loop;
  end if;
end
$$;
create function pg_temp.view_of(p_session text) returns jsonb language sql as $$ select public.order_view(p_session::uuid) $$;
-- The ids of the lines in the order the view lists them, as short names.
create function pg_temp.order_of(j jsonb) returns text language sql as $$
  select string_agg(right(e ->> 'id', 3), ',' order by ord) from jsonb_array_elements(j -> 'lines') with ordinality x(e, ord) $$;
create temp table r (nm text primary key, j jsonb);

select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000b1', 'ec000000-0000-4000-8000-0000000000e1', now() + interval '2 days', '10000000-0000-4000-8000-0000000000a1', 5, 1);
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000c1', 'ec000000-0000-4000-8000-0000000000e3', now() + interval '1 day', '10000000-0000-4000-8000-0000000000a1', 5, 2);
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
-- Created in this order: 301 secondi, 302 antipasti, 303 primi, 304 antipasti, 305 (removed), 306 (fired then voided), 307 (fired).
select pg_temp.addl('e1000000-0000-4000-8000-000000000301', '11000000-0000-4000-8000-000000000001', '{"qty":2,"note":"senza sale","isShared":true,"segue":true}');
select pg_temp.addl('e1000000-0000-4000-8000-000000000302', '11000000-0000-4000-8000-000000000003');
select pg_temp.addl('e1000000-0000-4000-8000-000000000303', '11000000-0000-4000-8000-000000000002');
select pg_temp.addl('e1000000-0000-4000-8000-000000000304', '11000000-0000-4000-8000-000000000003');
select pg_temp.addl('e1000000-0000-4000-8000-000000000305', '11000000-0000-4000-8000-000000000003');
select pg_temp.addl('e1000000-0000-4000-8000-000000000306', '11000000-0000-4000-8000-000000000003', '{"course":"dolci"}');
select pg_temp.addl('e1000000-0000-4000-8000-000000000307', '11000000-0000-4000-8000-000000000003', '{"course":"bevande"}');
select public.remove_order_line('e1000000-0000-4000-8000-000000000305', jsonb_build_object('clientUpdatedAt', pg_temp.t(2)));
update public.order_line set fired_at = now(), fired_by = 'd1000000-0000-4000-8000-00000000000d' where id in ('e1000000-0000-4000-8000-000000000306', 'e1000000-0000-4000-8000-000000000307');
update public.order_line set voided_at = now(), voided_by = 'd1000000-0000-4000-8000-00000000000d', void_reason = 'kitchen_error' where id = 'e1000000-0000-4000-8000-000000000306';
-- A line on the closed session 3 and a line of tenant B (the fixture's) must not show in session 1.
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by) values
  ('e1000000-0000-4000-8000-000000000308', '11111111-1111-4111-8111-111111111111', '14000000-0000-4000-8000-000000000003', '11000000-0000-4000-8000-000000000003', 'antipasti', 1, 5, 10, 'menu', '2026-10-24 12:00+00', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d');

insert into r values ('s1', pg_temp.view_of('14000000-0000-4000-8000-000000000001'));
select is((select pg_temp.order_of(j) from r where nm = 's1'), '302,304,303,301,306,307', 'lines are ordered by course (enum order), then creation: antipasti 302, 304; primi 303; secondi 301; dolci 306; bevande 307');
select is((select count(*)::int from r, jsonb_array_elements(j -> 'lines') e where nm = 's1' and e ->> 'id' = 'e1000000-0000-4000-8000-000000000305'), 0, 'the line removed before fire is absent');
select is((select e ->> 'state' from r, jsonb_array_elements(j -> 'lines') e where nm = 's1' and e ->> 'id' = 'e1000000-0000-4000-8000-000000000306'), 'voided', 'a line fired and then voided is present with state voided');
select is((select e ->> 'state' from r, jsonb_array_elements(j -> 'lines') e where nm = 's1' and e ->> 'id' = 'e1000000-0000-4000-8000-000000000307'), 'fired', 'a fired line shows state fired');
select is((select e ->> 'state' from r, jsonb_array_elements(j -> 'lines') e where nm = 's1' and e ->> 'id' = 'e1000000-0000-4000-8000-000000000301'), 'draft', 'a draft shows state draft');
select is((select (e ->> 'unitPrice') || '/' || (e ->> 'qty') || '/' || (e ->> 'note') || '/' || (e ->> 'isShared') || '/' || (e ->> 'segue') || '/' || (e ->> 'course') || '/' || (e ->> 'name')
             from r, jsonb_array_elements(j -> 'lines') e where nm = 's1' and e ->> 'id' = 'e1000000-0000-4000-8000-000000000301'),
  '14/2/senza sale/true/true/secondi/Spezzatino con polenta (demo)', 'a line shows its unit price, quantity, note, flags, course and dish name');
select is((select count(*)::int from r, jsonb_array_elements(j -> 'lines') e where nm = 's1' and e ->> 'id' in ('e1000000-0000-4000-8000-000000000308', 'e1000000-0000-4000-8000-0000000000b1')), 0, 'lines of another session or tenant do not show');

-- Key sets.
select is((select array_agg(k order by k) from r, jsonb_object_keys(j) k where nm = 's1'), array['lines', 'session'], 'the top-level keys are {session, lines}');
select is((select array_agg(k order by k collate "C") from r, jsonb_object_keys(j -> 'session') k where nm = 's1'),
  array['billRequested', 'closed', 'covers', 'id', 'status', 'tableId', 'tableName'], 'the session has exactly seven keys');
select is((select array_agg(k order by k collate "C") from r, jsonb_object_keys(j -> 'lines' -> 0) k where nm = 's1'),
  array['clientUpdatedAt', 'course', 'id', 'isShared', 'menuItemId', 'name', 'note', 'qty', 'segue', 'state', 'unitPrice', 'updatedAt', 'updatedBy'], 'a line has exactly the thirteen documented keys');
select is((select count(*)::int from r, pg_temp.all_keys(j) k where nm = 's1' and k ~* 'cost|margin|gp|food|eur$|recipe|vat'), 0, 'a recursive key scan finds no cost, margin, GP, food, eur, recipe or VAT key');
select is((select j -> 'session' ->> 'tableName' || '/' || (j -> 'session' ->> 'covers') || '/' || (j -> 'session' ->> 'tableId') from r where nm = 's1'), 'Tavolo 1 (demo)/4/13000000-0000-4000-8000-000000000001', 'the session shows the table name, covers and table id');

-- Status (M17's derivation) and the bill flag.
select is((select j -> 'session' ->> 'status' || '/' || (j -> 'session' ->> 'billRequested') || '/' || (j -> 'session' ->> 'closed') from r where nm = 's1'), 'courses_sent/false/false', 'a session with sent lines (306, 307 are fired): status courses_sent, no bill, not closed (M19 replaced the M17 stub that kept it open)');
select public.update_table_session('14000000-0000-4000-8000-000000000001', '{"billRequested":true}');
select is((select pg_temp.view_of('14000000-0000-4000-8000-000000000001') -> 'session' ->> 'status' || '/' || (pg_temp.view_of('14000000-0000-4000-8000-000000000001') -> 'session' ->> 'billRequested')), 'bill_requested/true', 'after the bill is requested: status bill_requested, billRequested true');
select is((select pg_temp.view_of('14000000-0000-4000-8000-000000000003') -> 'session' ->> 'status' || '/' || (pg_temp.view_of('14000000-0000-4000-8000-000000000003') -> 'session' ->> 'closed')), 'closed/true', 'a closed session: status closed, closed true');
select is((select pg_temp.order_of(pg_temp.view_of('14000000-0000-4000-8000-000000000003'))), '308', 'and its lines are still listed');
select is((select pg_temp.view_of('14000000-0000-4000-8000-000000000002') -> 'lines'), '[]'::jsonb, 'a session without lines has an empty list');

-- The waiter reads no line directly.
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
set local role authenticated;
select is((select count(*)::int from public.order_line), 0, 'a waiter reading order_line directly gets 0 rows');
reset role;

-- Roles and tenants.
select is(pg_temp.err('select public.order_view(''14000000-0000-4000-8000-000000000001'')'), 'ok', 'the waiter may read');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.err('select public.order_view(''14000000-0000-4000-8000-000000000001'')'), 'ok', 'the owner may read');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is(pg_temp.err('select public.order_view(''14000000-0000-4000-8000-000000000001'')'), 'ok', 'the admin may read');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.err('select public.order_view(''14000000-0000-4000-8000-000000000001'')'), '42501 permission denied: opening tables needs owner, admin or waiter', 'the chef is refused');
select set_config('request.jwt.claims', '', true);
select is(left(pg_temp.err('select public.order_view(''14000000-0000-4000-8000-000000000001'')'), 5), '42501', 'no claims: 42501');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(pg_temp.err('select public.order_view(''14000000-0000-4000-8000-000000000001'')'), 'P0002 session_not_found', 'tenant B asking for A''s session: session_not_found');
select is(pg_temp.err('select public.order_view(''99999999-9999-4999-8999-999999999999'')'), 'P0002 session_not_found', 'an unknown session: session_not_found');
select is((pg_temp.view_of('14000000-0000-4000-8000-0000000000b1') -> 'lines' -> 0 ->> 'id'), 'e1000000-0000-4000-8000-0000000000b1', 'tenant B sees its own line on its own session');

select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r where has_function_privilege(r, 'public.order_view(uuid)', 'execute')), 1, 'only authenticated executes order_view');
select is((select count(*)::int from pg_proc p where p.proname = 'order_view' and p.prosecdef and p.proconfig = array['search_path=""']), 1, 'order_view is a definer with an empty search_path');

select * from finish();
rollback;
