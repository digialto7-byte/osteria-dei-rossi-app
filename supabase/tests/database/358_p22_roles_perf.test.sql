-- P2-2 S7 (docs/plans/2026-11-14-p2-2-trace-sell-through.md section 3.9 and step S7): the role matrix of the eight new public functions, their grants, the read-only scan, the money-key scans of
-- every reply, and a performance net (a regression net, not a latency claim) in the 241 convention: a venue-sized history (one lot feeding 300 batches and 20 000 fired lines, 3 000 other lots,
-- 60 days of pushes, 2 000 bookings) answered under a 5 s statement limit, and the plans of the queries the lot search and the forward trace rest on (a definer function is not inlined, so the
-- query itself is explained, with sequential scans switched off so the test proves the index is usable). Fake data only; dates in 1998.
begin;
create extension if not exists pgtap with schema extensions;
select plan(45);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name, login_method) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo', 'email'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo', 'email'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo', 'email'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo', 'pin'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo', 'email');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)'),
  ('10000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Cella B (demo)');
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo 1', 'IT12345678903');
insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('1a000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Farina Demo', 'kg');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id, number_raw, invoice_date) values
  ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/1998/e1000000-0000-4000-8000-0000000000e1.pdf', 'application/pdf', 2048, 'review', '5a000000-0000-4000-8000-0000000000a1', 'FT-PERF-1', '1998-08-01');
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e3', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'ragu (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch, shelf_life_hours, created_by) values
  ('ed000000-0000-4000-8000-0000000000d3', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e3', 1, '1998-01-01', 'Ragù Demo', 2, 'kg', 100, 48, 'a1000000-0000-4000-8000-00000000000a');
insert into public.menu_item (id, tenant_id, name, category, course_default, created_by, updated_by)
  select ('11000000-0000-4000-8000-00000000000' || n)::uuid, '11111111-1111-4111-8111-111111111111', 'Voce ' || n || ' (demo)', 'Primi', 'primi',
         'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a' from generate_series(1, 8) n;
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('13000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Tavolo 1 (demo)', 1, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_at, opened_by, business_date, created_by, updated_by) values
  ('14000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000001', 'Tavolo 1 (demo)', 4, '1998-08-01T10:00Z',
   'a1000000-0000-4000-8000-00000000000a', '1998-08-01', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');

-- The history: 3 000 filler lots (ids 1e/107 ... 000001..003000), the big lot X (id ...9001) with 300 batches and 20 000 fired lines, the small lot S (id ...9002) with one batch and one line.
insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price, line_amount, field_confidence, extracted)
  select ('1e000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, '11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-0000000000e1', g, 'Riga demo', 5, 2, 10, '{}', '{}'
    from generate_series(1, 3002) g;
insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code, expiry, received_on, qty_received, base_unit, source_qty, source_unit, base_factor, created_by)
  select ('10700000-0000-4000-8000-' || lpad(case when g <= 3000 then g else 9000 + g - 3000 end::text, 12, '0'))::uuid, '11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-0000000000a1',
         '10000000-0000-4000-8000-0000000000a1', '5a000000-0000-4000-8000-0000000000a1', ('1e000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
         case when g <= 3000 then 'FILL-' || lpad(g::text, 5, '0') when g = 3001 then 'BIG-0001' else 'SMALL-0001' end, null,
         case when g <= 3000 then date '1998-09-01' + (g % 60) else date '1998-08-01' end, 1000, 'kg', 1000, 'kg', 1, 'a1000000-0000-4000-8000-00000000000a'
    from generate_series(1, 3002) g;
-- 300 batches of the big lot (one per 4 hours from 1998-09-01 06:00Z; 100 portions, 48 h shelf life), each with its production input and produce movement.
insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code, lot_seq, produced_at, produced_by, output_qty, output_unit, portions_computed, portions_initial,
    shelf_life_hours, use_by, state, location_id, created_at, created_by)
  select ('ba000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e3', 'ed000000-0000-4000-8000-0000000000d3', 1,
         '980801-RAG-' || g, '1998-08-01', 'RAG', g, timestamptz '1998-09-01T06:00Z' + g * interval '4 hours', 'a1000000-0000-4000-8000-00000000000a', 2, 'kg', 100, 100, 48,
         timestamptz '1998-09-01T06:00Z' + g * interval '4 hours' + interval '48 hours', 'fresh', '10000000-0000-4000-8000-0000000000a1', timestamptz '1998-09-01T06:00Z' + g * interval '4 hours',
         'a1000000-0000-4000-8000-00000000000a'
    from generate_series(1, 301) g;
insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_at, created_by)
  select '11111111-1111-4111-8111-111111111111', ('ba000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'produce', 100, 'batch', ('ba000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
         date '1998-09-01', timestamptz '1998-09-01T06:00Z' + g * interval '4 hours', 'a1000000-0000-4000-8000-00000000000a'
    from generate_series(1, 301) g;
insert into public.stock_movement (id, tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type, ref_id, effective_on, created_at, created_by)
  select ('5e000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, '11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-0000000000a1',
         case when g <= 300 then '10700000-0000-4000-8000-000000009001' else '10700000-0000-4000-8000-000000009002' end::uuid, '10000000-0000-4000-8000-0000000000a1', 'consumption', -1, 2, 'batch',
         ('ba000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, date '1998-09-01', timestamptz '1998-09-01T06:00Z' + g * interval '4 hours', 'a1000000-0000-4000-8000-00000000000a'
    from generate_series(1, 301) g;
insert into public.batch_input (tenant_id, batch_id, ingredient_id, location_id, raw_lot_id, qty, stock_movement_id, created_at, created_by)
  select '11111111-1111-4111-8111-111111111111', ('ba000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, '1a000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
         case when g <= 300 then '10700000-0000-4000-8000-000000009001' else '10700000-0000-4000-8000-000000009002' end::uuid, 1, ('5e000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
         timestamptz '1998-09-01T06:00Z' + g * interval '4 hours', 'a1000000-0000-4000-8000-00000000000a'
    from generate_series(1, 301) g;
-- 20 000 fired lines over 60 days (g % 60), one consume row each from batch (g % 300) + 1; the small lot's batch (301) has one line (id ...90001).
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_at, created_by, updated_by, fired_at, fired_by)
  select ('a3000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, '11111111-1111-4111-8111-111111111111', '14000000-0000-4000-8000-000000000001', ('11000000-0000-4000-8000-00000000000' || (1 + g % 8))::uuid,
         'primi', 1, 12, 10, 'menu', timestamptz '1998-09-01T10:00Z' + (g % 60) * interval '1 day' + (g / 60) * interval '1 second', timestamptz '1998-09-01T10:00Z' + (g % 60) * interval '1 day',
         'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d', timestamptz '1998-09-01T10:00Z' + (g % 60) * interval '1 day' + (g / 60) * interval '1 second',
         'd1000000-0000-4000-8000-00000000000d'
    from generate_series(1, 20001) g;
insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_at, created_by)
  select '11111111-1111-4111-8111-111111111111', case when g = 20001 then 'ba000000-0000-4000-8000-000000000301'::uuid else ('ba000000-0000-4000-8000-' || lpad((1 + g % 300)::text, 12, '0'))::uuid end,
         'consume', -1, 'order_line', ('a3000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, date '1998-09-01',
         timestamptz '1998-09-01T10:00Z' + (g % 60) * interval '1 day' + (g / 60) * interval '1 second', 'd1000000-0000-4000-8000-00000000000d'
    from generate_series(1, 20001) g;
-- 60 days of pushes (three dishes a day, 12 hours each, with the Ragù key) and 2 000 bookings over 1998-11-14 to 1998-11-20.
insert into public.menu_push (tenant_id, menu_item_id, action, push_until, push_price, batch_keys, created_at, created_by)
  select '11111111-1111-4111-8111-111111111111', ('11000000-0000-4000-8000-00000000000' || i)::uuid, 'start', timestamptz '1998-09-01T10:00Z' + d * interval '1 day' + interval '12 hours', 9,
         array['ec000000-0000-4000-8000-0000000000e3']::uuid[], timestamptz '1998-09-01T10:00Z' + d * interval '1 day', 'a1000000-0000-4000-8000-00000000000a'
    from generate_series(0, 59) d, generate_series(1, 3) i;
insert into public.reservation (tenant_id, id, status, business_date, service_key, starts_at, ends_at, party, source)
  select '11111111-1111-4111-8111-111111111111', ('e1000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, (array['accepted', 'arrived', 'pending', 'declined', 'seated'])[1 + g % 5]::public.reservation_status,
         date '1998-11-14' + (g % 7), case when g % 2 = 0 then 'pranzo' else 'cena' end, timestamptz '1998-11-14T12:00Z' + (g % 7) * interval '1 day', timestamptz '1998-11-14T14:00Z' + (g % 7) * interval '1 day',
         1 + g % 8, 'staff'
    from generate_series(1, 2000) g;
-- Tenant B: a booking and a lot of its own.
insert into public.reservation (tenant_id, id, status, business_date, service_key, starts_at, ends_at, party, source)
  values ('22222222-2222-4222-8222-222222222222', 'e2000000-0000-4000-8000-000000000001', 'accepted', '1998-11-14', 'cena', '1998-11-14T19:00Z', '1998-11-14T21:00Z', 3, 'staff');
analyze public.raw_lot; analyze public.batch; analyze public.batch_input; analyze public.batch_movement; analyze public.order_line; analyze public.menu_push; analyze public.reservation;

create function pg_temp.act_as(p_who text) returns void language sql as $$
  select set_config('request.jwt.claims', (jsonb_build_object('sub',
    case p_who when 'owner' then 'a0000000-0000-4000-8000-00000000000a' when 'admin' then 'f0000000-0000-4000-8000-00000000000f' when 'admin1' then 'f0000000-0000-4000-8000-00000000000f'
               when 'chef' then 'c0000000-0000-4000-8000-00000000000c' when 'ownerb' then 'b0000000-0000-4000-8000-00000000000b' else 'd0000000-0000-4000-8000-00000000000d' end,
    'role', 'authenticated', 'tenant_id', case when p_who = 'ownerb' then '22222222-2222-4222-8222-222222222222' else '11111111-1111-4111-8111-111111111111' end,
    'app_role', case when p_who = 'ownerb' then 'owner' when p_who in ('pin', 'waiter') then 'waiter' when p_who = 'admin1' then 'admin' else p_who end,
    'aal', case when p_who = 'admin' then 'aal2' else 'aal1' end) || case when p_who = 'pin' then jsonb_build_object('login', 'pin') else '{}'::jsonb end)::text, true) $$;
-- ok, or the SQLSTATE, of a statement run as the authenticated role.
create function pg_temp.state_of(stmt text) returns text language plpgsql as $$
declare state text;
begin
  set local role authenticated;
  execute stmt;
  reset role;
  return 'ok';
exception when others then
  reset role;
  get stacked diagnostics state = returned_sqlstate;
  return state;
end $$;
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
end $$;
-- The eight public functions called with fixture arguments as the current principal: a comma list of ok or SQLSTATE.
create function pg_temp.matrix() returns text language sql as $$
  select string_agg(pg_temp.state_of(c), ',' order by n) from (values
    (1, $q$select public.trace_lot_search('small', null, null, null, null)$q$),
    (2, $q$select public.lot_capture('1998-08-01', '1998-09-30')$q$),
    (3, $q$select public.trace_lot('10700000-0000-4000-8000-000000009002')$q$),
    (4, $q$select public.trace_batch('ba000000-0000-4000-8000-000000000301')$q$),
    (5, $q$select public.trace_order_line('a3000000-0000-4000-8000-000000020001')$q$),
    (6, $q$select public.trace_line_search((current_date - 1), null)$q$),
    (7, $q$select public.push_sell_through(null)$q$),
    (8, $q$select public.reservations_covers(null)$q$)) v (n, c) $$;
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
end $$;

-- 1. The matrix (section 3.9): the eight functions x seven principals -------------------------------------------------------------------------------------
select pg_temp.act_as('owner');
select is(pg_temp.matrix(), 'ok,ok,ok,ok,ok,ok,ok,ok', 'owner: all eight functions answer');
select pg_temp.act_as('admin');
select is(pg_temp.matrix(), 'ok,ok,ok,ok,ok,ok,ok,ok', 'admin at aal2: all eight answer');
select pg_temp.act_as('chef');
select is(pg_temp.matrix(), 'ok,ok,ok,ok,ok,ok,ok,ok', 'chef: all eight answer');
select pg_temp.act_as('waiter');
select is(pg_temp.matrix(), '42501,42501,42501,42501,42501,42501,42501,ok', 'waiter: 42501 on the seven trace and sell-through reads, the covers answer');
select pg_temp.act_as('pin');
select is(pg_temp.matrix(), '42501,42501,42501,42501,42501,42501,42501,ok', 'PIN waiter: the same');
select pg_temp.act_as('admin1');
select is(pg_temp.matrix(), '42501,42501,42501,42501,42501,42501,42501,42501', 'admin at aal1 (the P2-1 gate): 42501 on all eight');
select pg_temp.act_as('ownerb');
select is(pg_temp.matrix(), 'ok,ok,P0002,P0002,P0002,ok,ok,ok', 'owner B: not_found (P0002) on A''s ids, the searches and counts answer on B''s own data');
select is(jsonb_array_length(public.trace_lot_search('small', null, null, null, null) -> 'lots'), 0, 'owner B''s lot search never finds A''s lot');
select is(public.lot_capture('1998-08-01', '1998-09-30') -> 'lots', '0'::jsonb, 'owner B''s capture counts none of A''s lots');
select is(jsonb_array_length(public.trace_line_search((current_date - 1), null) -> 'lines'), 0, 'owner B''s line search holds none of A''s lines');
select is((select sum((s ->> 'covers')::int)::int from jsonb_array_elements(app.reservations_covers_json('22222222-2222-4222-8222-222222222222', '1998-11-14', '1998-11-14T09:00Z') -> 'services') s), 3,
          'owner B''s covers are its own 3');
select set_config('request.jwt.claims', '', true);
select is(pg_temp.matrix(), '42501,42501,42501,42501,42501,42501,42501,42501', 'a signed-out session: 42501 on all eight');

-- 2. Grants and settings of every new function ---------------------------------------------------------------------------------------------------------
create temp table newfn as
  select p.oid, n.nspname, p.proname, p.prosecdef, p.prosrc, p.provolatile, p.proconfig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where (n.nspname = 'public' and p.proname in ('trace_lot_search', 'lot_capture', 'trace_lot', 'trace_batch', 'trace_order_line', 'trace_line_search', 'push_sell_through', 'reservations_covers'))
      or (n.nspname = 'app' and p.proname in ('require_trace_reader', 'lot_code_norm', 'trace_constants', 'batch_family', 'batch_root', 'trace_lot_search_json', 'lot_capture_json', 'trace_lot_json',
          'trace_batch_json', 'trace_line_search_json', 'trace_line_json', 'push_sell_through_json', 'require_covers_reader', 'reservations_covers_json'));
select is((select count(*)::int from newfn), 22, 'the plan''s 22 new functions exist, once each (8 public, 14 app)');
select is((select count(*)::int from newfn where nspname = 'public' and prosecdef and proconfig = array['search_path=""']), 8, 'the eight public functions are definers with an empty search_path');
select is((select count(*)::int from newfn where nspname = 'public' and has_function_privilege('authenticated', oid, 'EXECUTE') and not has_function_privilege('anon', oid, 'EXECUTE')
             and not has_function_privilege('service_role', oid, 'EXECUTE')), 8, 'each is executable by authenticated only (not anon, not service_role)');
select is((select count(*)::int from pg_proc p join newfn n on n.oid = p.oid where p.proacl::text ~ '[{,]=X/'), 0, 'none is executable by PUBLIC');
select is((select count(*)::int from newfn where nspname = 'app' and (has_function_privilege('anon', oid, 'EXECUTE') or has_function_privilege('authenticated', oid, 'EXECUTE')
             or has_function_privilege('service_role', oid, 'EXECUTE'))), 0, 'the 14 app functions are executable by no API role');
select is((select count(*)::int from newfn where proconfig is distinct from array['search_path=""']), 0, 'every new function has an empty search_path');
select is((select count(*)::int from newfn where proname not in ('lot_code_norm', 'trace_constants') and not prosecdef and proname not in ('require_trace_reader', 'require_covers_reader')), 0,
          'every new function but the pure helpers and the two gates is a definer');
select is((select count(*)::int from newfn where provolatile = 'v'), 0, 'none is volatile (every one is stable or immutable)');
select is((select string_agg(proname, ', ' order by proname) from newfn where prosrc ~* '\y(insert|update|delete|truncate)\y'), null, 'read-only: no new function''s body contains insert, update, delete or truncate');
select is((select count(*)::int from newfn where nspname = 'public' and prosrc !~ 'require_(trace|push|covers)_reader\(\)'), 0, 'every public function calls its gate (require_trace_reader, require_push_reader or require_covers_reader) first');

-- 3. Money keys: the chef's replies carry none, the owner's trace replies carry none -------------------------------------------------------------------
select pg_temp.act_as('owner');
select is((select string_agg(k, ',') from (select unnest(app.payload_money_keys(app.trace_lot_search_json('11111111-1111-4111-8111-111111111111', 'chef', 'small', null, null, null, null, '1998-11-14T09:00Z')))) x (k)), null, 'chef lot search: no money key');
select is(app.payload_money_keys(app.lot_capture_json('11111111-1111-4111-8111-111111111111', '1998-08-01', '1998-09-30', '1998-11-14T09:00Z')), '{}'::text[], 'chef lot capture: no money key');
select is(app.payload_money_keys(app.trace_lot_json('11111111-1111-4111-8111-111111111111', 'chef', '10700000-0000-4000-8000-000000009002')), '{}'::text[], 'chef trace_lot: no money key');
select is(app.payload_money_keys(app.trace_batch_json('11111111-1111-4111-8111-111111111111', 'chef', 'ba000000-0000-4000-8000-000000000301')), '{}'::text[], 'chef trace_batch: no money key');
select is(app.payload_money_keys(app.trace_line_json('11111111-1111-4111-8111-111111111111', 'chef', 'a3000000-0000-4000-8000-000000020001')), '{}'::text[], 'chef trace_order_line: no money key');
select is(app.payload_money_keys(app.trace_line_search_json('11111111-1111-4111-8111-111111111111', 'chef', '1998-09-20', null, '1998-11-14T09:00Z')), '{}'::text[], 'chef trace_line_search: no money key');
select is(app.payload_money_keys(app.push_sell_through_json('11111111-1111-4111-8111-111111111111', 'chef', '1998-10-10', '1998-11-14T09:00Z')), '{}'::text[], 'chef push_sell_through: no money key');
select is(app.payload_money_keys(app.reservations_covers_json('11111111-1111-4111-8111-111111111111', '1998-11-14', '1998-11-14T09:00Z')), '{}'::text[], 'chef reservations_covers: no money key');
select is(app.payload_money_keys(app.trace_lot_json('11111111-1111-4111-8111-111111111111', 'owner', '10700000-0000-4000-8000-000000009002'))
          || app.payload_money_keys(app.trace_batch_json('11111111-1111-4111-8111-111111111111', 'owner', 'ba000000-0000-4000-8000-000000000301'))
          || app.payload_money_keys(app.trace_line_json('11111111-1111-4111-8111-111111111111', 'owner', 'a3000000-0000-4000-8000-000000020001')), '{}'::text[], 'owner trace replies: no money key either');
select is(app.payload_money_keys(app.push_sell_through_json('11111111-1111-4111-8111-111111111111', 'owner', '1998-10-10', '1998-11-14T09:00Z')), '{pushPrice}'::text[], 'the owner''s sell-through carries the one money key, pushPrice');

-- 4. Performance (a regression net): every function under a 5 s statement limit on the venue-sized history -----------------------------------------------
set local statement_timeout = '5s';
select is(pg_temp.err($$select public.trace_lot_search('big', null, null, null, null)$$), 'ok', 'lot search by code (3 000 lots) answers under the limit');
select is(pg_temp.err($$select public.trace_lot_search('fill-0', null, null, null, null)$$), 'ok', 'a prefix matching 1 000 lots answers (50 returned)');
select is(pg_temp.err($$select public.lot_capture('1998-08-01', '1998-10-30')$$), 'ok', 'the capture rate over 3 000 lots answers');
select is(pg_temp.err($$select public.trace_lot('10700000-0000-4000-8000-000000009001')$$), 'ok', 'the forward trace of a lot feeding 300 batches and 20 000 lines answers');
select is(pg_temp.err($$select public.trace_batch('ba000000-0000-4000-8000-000000000150')$$), 'ok', 'the backward trace of a batch with 67 lines answers');
select is(pg_temp.err($$select public.trace_order_line('a3000000-0000-4000-8000-000000010000')$$), 'ok', 'the backward trace of a plate answers');
select is(pg_temp.err($$select app.trace_line_search_json('11111111-1111-4111-8111-111111111111', 'owner', '1998-09-15', null, '1998-11-14T09:00Z')$$), 'ok', 'the line search of a day with 333 lines answers');
select is(pg_temp.err($$select app.push_sell_through_json('11111111-1111-4111-8111-111111111111', 'owner', '1998-10-10', '1998-11-14T09:00Z')$$), 'ok', 'the sell-through of a day with three pushes over 300 batches answers');
select is(pg_temp.err($$select app.push_sell_through_json('11111111-1111-4111-8111-111111111111', 'owner', '1998-09-02', '1998-11-14T09:00Z')$$), 'ok', 'and of a day at the start of the history');
select is(pg_temp.err($$select app.reservations_covers_json('11111111-1111-4111-8111-111111111111', '1998-11-17', '1998-11-14T09:00Z')$$), 'ok', 'the covers over 2 000 bookings answer');
reset statement_timeout;
select is(jsonb_array_length(app.trace_lot_json('11111111-1111-4111-8111-111111111111', 'owner', '10700000-0000-4000-8000-000000009001') -> 'batches'), 200, 'the big lot''s batches are capped at 200 (truncated)');

-- 5. Plans of the queries behind the lot search and the forward trace ------------------------------------------------------------------------------
create function pg_temp.plan_of(p_sql text) returns text language plpgsql as $$
declare v json;
begin
  set local enable_seqscan = off;
  execute 'explain (format json) ' || p_sql into v;
  return v::text;
end $$;
select ok(pg_temp.plan_of($q$ select l.id from public.raw_lot l where l.tenant_id = '11111111-1111-4111-8111-111111111111' and l.lot_code is not null
    and app.lot_code_norm(l.lot_code) like 'BIG%' order by l.received_on desc, l.id limit 51 $q$) like '%raw_lot_lot_code_norm_idx%', 'the lot search by code reads through raw_lot_lot_code_norm_idx');
select ok(pg_temp.plan_of($q$ select bi.batch_id from public.batch_input bi where bi.tenant_id = '11111111-1111-4111-8111-111111111111'
    and bi.raw_lot_id = '10700000-0000-4000-8000-000000009001' $q$) like '%batch_input_lot_idx%', 'the forward trace finds the batches of a lot through batch_input_lot_idx');

select * from finish();
rollback;
