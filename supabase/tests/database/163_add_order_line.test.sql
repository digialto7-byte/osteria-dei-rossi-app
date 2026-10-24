-- M18 step 4: add_order_line (plan §3.1.2-6, §3.2; ADR-017; AT1, AT3, AT4 push price). Availability refusal, half
-- portions and the shared flag, defaults with two candidates, the price in force and the push price frozen at entry,
-- idempotent replays by the client line id, session and item checks, note and time validation, roles.
-- Fake data only. Rows are found by id.
begin;
create extension if not exists pgtap with schema extensions;
select plan(66);

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
-- 'ok' or "SQLSTATE message", and the detail apart.
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
-- A live batch with its produce movement; adj changes its balance.
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
-- The body for item n on line id l (extra keys override).
create function pg_temp.body(p_item text, p_line text, p_extra text default '{}') returns text language sql as $$
  select (jsonb_build_object('lineId', p_line, 'menuItemId', p_item,
            'clientUpdatedAt', to_char((clock_timestamp() - interval '1 minute') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')) || p_extra::jsonb)::text
$$;
create function pg_temp.add(p_session text, p_body text) returns text language sql as $$
  select 'select public.add_order_line(' || quote_literal(p_session) || '::uuid, ' || quote_literal(p_body) || '::jsonb)'
$$;
create function pg_temp.line(p_id text) returns public.order_line language sql as $$
  select l from public.order_line l where l.id = p_id::uuid $$;

select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');

-- AT1: no batch of either kind -> refused, nothing written.
select is(pg_temp.err(pg_temp.add('14000000-0000-4000-8000-000000000001', pg_temp.body('11000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001'))), 'P0001 item_unavailable', 'AT1: the stew with no portions is refused');
select is((pg_temp.err_detail(pg_temp.add('14000000-0000-4000-8000-000000000001', pg_temp.body('11000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001')))::jsonb),
  jsonb_build_object('menuItemId', '11000000-0000-4000-8000-000000000001', 'reason', 'no_portions', 'portionsLeft', 0), 'AT1: the detail names the item, the reason and the 0 portions');
select is((select count(*)::int from public.order_line where id = 'e1000000-0000-4000-8000-000000000001'), 0, 'AT1: nothing is written');
select is((pg_temp.err_detail(pg_temp.add('14000000-0000-4000-8000-000000000001', pg_temp.body('11000000-0000-4000-8000-000000000006', 'e1000000-0000-4000-8000-000000000002')))::jsonb ->> 'reason'), 'manual', 'a manually unavailable item is refused with reason manual');
select is((pg_temp.err_detail(pg_temp.add('14000000-0000-4000-8000-000000000001', pg_temp.body('11000000-0000-4000-8000-000000000007', 'e1000000-0000-4000-8000-000000000003')))::jsonb ->> 'reason'), 'inactive', 'an inactive item is refused with reason inactive');

-- Stock: stew has two live batches (1.5 + 1.5 in two locations) and an expired one; ragù one live batch of 5.
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000b1', 'ec000000-0000-4000-8000-0000000000e1', now() + interval '2 days', '10000000-0000-4000-8000-0000000000a1', 2, 1);
select pg_temp.adj('ba000000-0000-4000-8000-0000000000b1', -0.5);
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000b2', 'ec000000-0000-4000-8000-0000000000e1', now() + interval '1 day', '10000000-0000-4000-8000-0000000000a2', 3, 2);
select pg_temp.adj('ba000000-0000-4000-8000-0000000000b2', -1.5);
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000b3', 'ec000000-0000-4000-8000-0000000000e1', now() - interval '1 hour', '10000000-0000-4000-8000-0000000000a1', 9, 3);
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000c1', 'ec000000-0000-4000-8000-0000000000e3', now() + interval '1 day', '10000000-0000-4000-8000-0000000000a1', 5, 4);

-- Defaults with two candidates.
create temp table r (nm text primary key, j jsonb);
insert into r values ('stew', public.add_order_line('14000000-0000-4000-8000-000000000001', pg_temp.body('11000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000011')::jsonb));
insert into r values ('tag', public.add_order_line('14000000-0000-4000-8000-000000000001', pg_temp.body('11000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000012')::jsonb));
select is((select (pg_temp.line('e1000000-0000-4000-8000-000000000011')).course::text), 'secondi', 'no course: the stew (secondi) gets secondi');
select is((select (pg_temp.line('e1000000-0000-4000-8000-000000000012')).course::text), 'primi', 'no course: the tagliatelle (primi) gets primi');
insert into r values ('stew_primi', public.add_order_line('14000000-0000-4000-8000-000000000001', pg_temp.body('11000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000013', '{"course":"primi"}')::jsonb));
select is((select (pg_temp.line('e1000000-0000-4000-8000-000000000013')).course::text), 'primi', 'an explicit course on the stew wins over its default');
select is((select (pg_temp.line('e1000000-0000-4000-8000-000000000011')).qty), 1::numeric, 'no qty: 1');
select is((select (pg_temp.line('e1000000-0000-4000-8000-000000000011')).segue::text || '/' || (pg_temp.line('e1000000-0000-4000-8000-000000000011')).is_shared::text || '/' || coalesce((pg_temp.line('e1000000-0000-4000-8000-000000000011')).note, 'null')),
  'false/false/null', 'segue, shared and note default to false, false, null');

-- The returned shape.
select is((select array_agg(k order by k) from r, jsonb_object_keys(j) k where r.nm = 'stew'), array['created', 'item', 'line'], 'the reply has {created, line, item}');
select is((select array_agg(k order by k) from r, jsonb_object_keys(j -> 'item') k where r.nm = 'stew'), array['available', 'id', 'lowStock', 'portionsLeft'], 'item has {id, available, portionsLeft, lowStock}');
select is((select (j -> 'item' ->> 'portionsLeft') || '/' || (j -> 'item' ->> 'lowStock') || '/' || (j ->> 'created') from r where nm = 'stew'), '3/true/true', 'item: 3 portions (1.5 + 1.5, the expired batch left out), low stock, created');
select is((select array_agg(k order by k collate "C") from r, jsonb_object_keys(j -> 'line') k where r.nm = 'stew'),
  array['clientUpdatedAt', 'course', 'id', 'isShared', 'menuItemId', 'name', 'note', 'qty', 'segue', 'state', 'unitPrice', 'updatedAt', 'updatedBy'], 'line has the thirteen documented keys');

-- Price in force: rows 12 (VAT 22) 3 h ago, 14 (VAT 10) 2 h ago, 16 (VAT 4) in an hour -> 14 / 10.
select is((select l.unit_price::text || '/' || l.vat_rate::text || '/' || l.price_source from pg_temp.line('e1000000-0000-4000-8000-000000000011') l), '14.00/10.00/menu', 'the price in force is the 2-hours-ago row (14, VAT 10), not the older or the future one');

-- Push vs menu: a pushed item (push 7, item 9) and one whose push ended a minute ago (menu 6).
insert into r values ('push', public.add_order_line('14000000-0000-4000-8000-000000000001', pg_temp.body('11000000-0000-4000-8000-000000000004', 'e1000000-0000-4000-8000-000000000014')::jsonb));
insert into r values ('pushexp', public.add_order_line('14000000-0000-4000-8000-000000000001', pg_temp.body('11000000-0000-4000-8000-000000000005', 'e1000000-0000-4000-8000-000000000015')::jsonb));
select is((select l.unit_price::text || '/' || l.vat_rate::text || '/' || l.price_source from pg_temp.line('e1000000-0000-4000-8000-000000000014') l), '7.00/10.00/push', 'a pushed item: the push price, the item''s VAT, source push');
select is((select l.unit_price::text || '/' || l.vat_rate::text || '/' || l.price_source from pg_temp.line('e1000000-0000-4000-8000-000000000015') l), '6.00/10.00/menu', 'a push that ended a minute ago: the menu price');
-- Frozen: a newer price row and the end of the push leave the lines as they were.
insert into public.menu_item_price (tenant_id, menu_item_id, price, vat_rate, valid_from, created_by)
  values ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000001', 20, 10, clock_timestamp(), 'a1000000-0000-4000-8000-00000000000a');
update public.menu_item set push_until = null, push_price = null where id = '11000000-0000-4000-8000-000000000004';
select is((select l.unit_price::text from pg_temp.line('e1000000-0000-4000-8000-000000000011') l) || '/' || (select l.unit_price::text from pg_temp.line('e1000000-0000-4000-8000-000000000014') l), '14.00/7.00', 'a later price row and the end of the push leave the stored prices');
insert into r values ('stew2', public.add_order_line('14000000-0000-4000-8000-000000000001', pg_temp.body('11000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000016')::jsonb));
select is((select l.unit_price::text from pg_temp.line('e1000000-0000-4000-8000-000000000016') l), '20.00', 'a new line takes the new price');

-- AT3: half portion, shared, bad quantities.
insert into r values ('half', public.add_order_line('14000000-0000-4000-8000-000000000001', pg_temp.body('11000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000021', '{"qty":0.5,"isShared":true,"segue":true,"note":"  senza cipolla  "}')::jsonb));
select is((select l.qty::text || '/' || l.is_shared::text || '/' || l.segue::text || '/' || l.note from pg_temp.line('e1000000-0000-4000-8000-000000000021') l), '0.5/true/true/senza cipolla', 'AT3: qty 0.5, shared, segue stored; the note is trimmed');
select is(pg_temp.err(pg_temp.add('14000000-0000-4000-8000-000000000001', pg_temp.body('11000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000022', '{"qty":0.3}'))), 'P0001 qty_invalid', 'AT3: qty 0.3 is qty_invalid');
select is(pg_temp.err(pg_temp.add('14000000-0000-4000-8000-000000000001', pg_temp.body('11000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000022', '{"qty":0}'))), 'P0001 qty_invalid', 'qty 0 is qty_invalid');
select is(pg_temp.err(pg_temp.add('14000000-0000-4000-8000-000000000001', pg_temp.body('11000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000022', '{"qty":99.5}'))), 'P0001 qty_invalid', 'qty 99.5 is qty_invalid');
select is(pg_temp.err(pg_temp.add('14000000-0000-4000-8000-000000000001', pg_temp.body('11000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000022', '{"qty":"2"}'))), '22023 invalid_request', 'a text qty is invalid_request');
select is(pg_temp.err(pg_temp.add('14000000-0000-4000-8000-000000000001', pg_temp.body('11000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000023', '{"qty":99}'))), 'ok', 'qty 99 is accepted');

-- Notes.
select is(pg_temp.err(pg_temp.add('14000000-0000-4000-8000-000000000001', pg_temp.body('11000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000024', '{"note":""}'))), 'ok', 'an empty note is accepted');
select is((select l.note from pg_temp.line('e1000000-0000-4000-8000-000000000024') l), null, 'and stored as null');
select is(pg_temp.err(pg_temp.add('14000000-0000-4000-8000-000000000001', pg_temp.body('11000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000025', '{"note":null}'))), 'ok', 'a null note is accepted');
select is(pg_temp.err(pg_temp.add('14000000-0000-4000-8000-000000000001', pg_temp.body('11000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000026', jsonb_build_object('note', repeat('x', 141))::text))), 'P0001 note_invalid', 'a 141-character note is note_invalid');
select is(pg_temp.err(pg_temp.add('14000000-0000-4000-8000-000000000001', pg_temp.body('11000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000026', jsonb_build_object('note', repeat('x', 140))::text))), 'ok', 'a 140-character note is accepted');
select is(pg_temp.err(pg_temp.add('14000000-0000-4000-8000-000000000001', pg_temp.body('11000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000027', jsonb_build_object('note', 'a' || chr(9) || 'b')::text))), 'P0001 note_invalid', 'a control character is note_invalid');
select is(pg_temp.err(pg_temp.add('14000000-0000-4000-8000-000000000001', pg_temp.body('11000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000027', '{"note":5}'))), '22023 invalid_request', 'a numeric note is invalid_request');

-- Shape and time.
select is(pg_temp.err(pg_temp.add('14000000-0000-4000-8000-000000000001', pg_temp.body('11000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000028', '{"price":1}'))), '22023 invalid_request', 'an unknown key is invalid_request');
select is(pg_temp.err(pg_temp.add('14000000-0000-4000-8000-000000000001', (pg_temp.body('11000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000028')::jsonb - 'clientUpdatedAt')::text)), '22023 invalid_request', 'a missing clientUpdatedAt is invalid_request');
select is(pg_temp.err(pg_temp.add('14000000-0000-4000-8000-000000000001', pg_temp.body('11000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000028', '{"course":"dessert"}'))), 'P0001 course_invalid', 'an unknown course word is course_invalid');
select is(pg_temp.err(pg_temp.add('14000000-0000-4000-8000-000000000001', pg_temp.body('11000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000028', '{"course":3}'))), '22023 invalid_request', 'a numeric course is invalid_request');
select is(pg_temp.err(pg_temp.add('14000000-0000-4000-8000-000000000001', pg_temp.body('11000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000028', jsonb_build_object('clientUpdatedAt', to_char((clock_timestamp() + interval '5 minutes') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))::text))), 'P0001 client_time_invalid', 'a client time 5 minutes ahead is client_time_invalid');
select is(pg_temp.err(pg_temp.add('14000000-0000-4000-8000-000000000001', pg_temp.body('11000000-0000-4000-8000-000000000003', 'not-a-uuid'))), '22023 invalid_request', 'a malformed lineId is invalid_request');
select is((select count(*)::int from public.order_line where id in ('e1000000-0000-4000-8000-000000000028', 'e1000000-0000-4000-8000-000000000022', 'e1000000-0000-4000-8000-000000000026') and note is distinct from repeat('x', 140)), 0, 'no line was written by the refused calls');

-- Authorship and time.
select is((select l.created_by::text || '/' || l.updated_by::text from pg_temp.line('e1000000-0000-4000-8000-000000000011') l), 'd1000000-0000-4000-8000-00000000000d/d1000000-0000-4000-8000-00000000000d', 'created_by and updated_by are the caller');
select cmp_ok((select l.client_updated_at from pg_temp.line('e1000000-0000-4000-8000-000000000011') l), '<', clock_timestamp() - interval '30 seconds', 'client_updated_at is the body value (a minute ago), not the server time');
select is((select l.tenant_id::text from pg_temp.line('e1000000-0000-4000-8000-000000000011') l), '11111111-1111-4111-8111-111111111111', 'the tenant comes from the caller');

-- Idempotency.
insert into r values ('rep1', public.add_order_line('14000000-0000-4000-8000-000000000001', pg_temp.body('11000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000031')::jsonb));
insert into r values ('rep2', public.add_order_line('14000000-0000-4000-8000-000000000001', pg_temp.body('11000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000031')::jsonb));
select is((select (j ->> 'created') from r where nm = 'rep1') || '/' || (select (j ->> 'created') from r where nm = 'rep2'), 'true/false', 'the same body twice: created, then not created');
select is((select count(*)::int from public.order_line where id = 'e1000000-0000-4000-8000-000000000031'), 1, 'one row');
select is((select j -> 'line' from r where nm = 'rep2'), (select j -> 'line' from r where nm = 'rep1'), 'the replay returns the stored line');
select is(pg_temp.err(pg_temp.add('14000000-0000-4000-8000-000000000002', pg_temp.body('11000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000031'))), 'P0001 line_id_conflict', 'the same lineId on another session is line_id_conflict');
select is(pg_temp.err(pg_temp.add('14000000-0000-4000-8000-000000000001', pg_temp.body('11000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000031'))), 'P0001 line_id_conflict', 'the same lineId for another item is line_id_conflict');
select is(pg_temp.err(pg_temp.add('14000000-0000-4000-8000-000000000001', pg_temp.body('11000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-0000000000b1'))), 'P0001 line_id_conflict', 'a line id of tenant B is line_id_conflict');
select is(pg_temp.err_detail(pg_temp.add('14000000-0000-4000-8000-000000000001', pg_temp.body('11000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-0000000000b1'))), '', 'and tells nothing about the other tenant (no detail)');
select is((select count(*)::int from public.order_line where id = 'e1000000-0000-4000-8000-0000000000b1' and tenant_id = '22222222-2222-4222-8222-222222222222'), 1, 'tenant B''s line is untouched');
-- A replay after the item ran out is not re-checked.
select pg_temp.adj('ba000000-0000-4000-8000-0000000000b1', -1.5);
select pg_temp.adj('ba000000-0000-4000-8000-0000000000b2', -1.5);
select is(pg_temp.err(pg_temp.add('14000000-0000-4000-8000-000000000001', pg_temp.body('11000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000099'))), 'P0001 item_unavailable', 'fixture check: the stew is now out');
select is((public.add_order_line('14000000-0000-4000-8000-000000000001', pg_temp.body('11000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000011')::jsonb) ->> 'created'), 'false', 'a replay of an earlier stew line after the stew ran out is still created false');

-- Session and item checks.
select is(pg_temp.err(pg_temp.add('14000000-0000-4000-8000-000000000003', pg_temp.body('11000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000041'))), 'P0001 session_closed', 'a closed session is session_closed');
select is(pg_temp.err(pg_temp.add('14000000-0000-4000-8000-0000000000b1', pg_temp.body('11000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000042'))), 'P0002 session_not_found', 'tenant B''s session is session_not_found');
select is(pg_temp.err(pg_temp.add('14000000-0000-4000-8000-000000000001', pg_temp.body('11000000-0000-4000-8000-0000000000b1', 'e1000000-0000-4000-8000-000000000043'))), 'P0002 menu_item_not_found', 'tenant B''s item is menu_item_not_found');
select is(pg_temp.err(pg_temp.add('14000000-0000-4000-8000-000000000001', pg_temp.body('99999999-9999-4999-8999-999999999999', 'e1000000-0000-4000-8000-000000000044'))), 'P0002 menu_item_not_found', 'an unknown item is menu_item_not_found');
select is((select count(*)::int from public.order_line where id in ('e1000000-0000-4000-8000-000000000041', 'e1000000-0000-4000-8000-000000000042', 'e1000000-0000-4000-8000-000000000043', 'e1000000-0000-4000-8000-000000000044')), 0, 'nothing written by these refusals');

-- Roles.
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.err(pg_temp.add('14000000-0000-4000-8000-000000000001', pg_temp.body('11000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000051'))), 'ok', 'the owner may add');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is(pg_temp.err(pg_temp.add('14000000-0000-4000-8000-000000000001', pg_temp.body('11000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000052'))), 'ok', 'the admin may add');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.err(pg_temp.add('14000000-0000-4000-8000-000000000001', pg_temp.body('11000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000053'))), '42501 permission denied: opening tables needs owner, admin or waiter', 'the chef is refused (42501)');
select is((select count(*)::int from public.order_line where id = 'e1000000-0000-4000-8000-000000000053'), 0, 'and nothing is written');
select set_config('request.jwt.claims', '', true);
select is(left(pg_temp.err(pg_temp.add('14000000-0000-4000-8000-000000000001', pg_temp.body('11000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000054'))), 5), '42501', 'no claims: 42501');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(pg_temp.err(pg_temp.add('14000000-0000-4000-8000-000000000001', pg_temp.body('11000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000055'))), 'P0002 session_not_found', 'owner B cannot add to A''s session');
select is((select count(*)::int from public.order_line where tenant_id = '11111111-1111-4111-8111-111111111111' and id::text like 'e1000000-0000-4000-8000-00000000005%'), 2, 'only the owner''s and the admin''s lines exist');

-- Privileges.
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r where has_function_privilege(r, 'public.add_order_line(uuid, jsonb)', 'execute')), 1, 'only authenticated executes add_order_line');
select is((select count(*)::int from pg_proc p where p.proname = 'add_order_line' and p.prosecdef and p.provolatile = 'v' and p.proconfig = array['search_path=""']), 1, 'add_order_line is a volatile definer with an empty search_path');

select * from finish();
rollback;
