-- Opening stock, step 7 (docs/plans/2026-11-18-opening-stock.md §3.5, §5 step 7; AT1-AT4, AT9): public.post_opening_stock books one location's draft in one transaction, and the
-- screen reads public.opening_history and public.opening_stock_summary. The confirm books exactly the draft the screen showed (opening_draft_changed otherwise), is idempotent on
-- request_id, freezes each line's unit cost on its `opening` movement, dates the movements with the chosen date, deletes the booked draft rows and writes one audit row with counts
-- and the total only. Refused after the location's first closed MONTHLY count and during an open count; the date must not be after today's business date, nor after the
-- location's first receipt, nor more than 366 days back. This file reads the real clock (the business date), so every date in it is computed from today (no fixed date literal).
-- B-against-A cases are in 408 (X). Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
set local timezone = 'UTC';
select plan(49);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('a0000000-0000-4000-8000-0000000000fa', 'admin-a@example.test'),
  ('a0000000-0000-4000-8000-0000000000ca', 'chef-a@example.test'),
  ('a0000000-0000-4000-8000-0000000000da', 'waiter-a@example.test');
insert into public.tenant (id, name, vat_number) values ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('a1000000-0000-4000-8000-0000000000fa', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-0000000000fa', 'admin', 'Admin Demo'),
  ('a1000000-0000-4000-8000-0000000000ca', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-0000000000ca', 'chef', 'Chef Demo'),
  ('a1000000-0000-4000-8000-0000000000da', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-0000000000da', 'waiter', 'Cameriere Demo');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Dispensa (demo)'),
  ('10000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'Frigo 1 (demo)'),
  ('10000000-0000-4000-8000-0000000000a3', '11111111-1111-4111-8111-111111111111', 'Cantina (demo)'),
  ('10000000-0000-4000-8000-0000000000a4', '11111111-1111-4111-8111-111111111111', 'Banco (demo)'),
  ('10000000-0000-4000-8000-0000000000a5', '11111111-1111-4111-8111-111111111111', 'Cella (demo)');
insert into public.ingredient (id, tenant_id, name, base_unit, is_stock) values
  ('1a000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Farina 00 (demo)', 'kg', true),
  ('1a000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Mozzarella (demo)', 'kg', true),
  ('1a000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Pomodoro pelato (demo)', 'kg', true),
  ('1a000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'Basilico (demo)', 'kg', true);
-- Today's business date, and the receipt date D (ten days ago) of Cantina's first invoice.
create temp table ctx as select app.business_date('11111111-1111-4111-8111-111111111111', now()) as today;
alter table ctx add column d date;
update ctx set d = today - 10;
grant select on ctx to authenticated;
insert into public.supplier (id, tenant_id, name, vat_number) values ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore X (demo)', 'IT12345678903');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id) values
  ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/e1000000-0000-4000-8000-0000000000e1.pdf', 'application/pdf', 2048, 'review', '5a000000-0000-4000-8000-00000000005a');
insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price, line_amount, field_confidence, extracted) values
  ('a2000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-0000000000e1', 1, 'Farina', 5, 1, 5, '{}', '{}');
insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code, received_on, qty_received, base_unit, source_qty, source_unit, base_factor, created_by)
  select '10700000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-0000000000a3',
         '5a000000-0000-4000-8000-00000000005a', 'a2000000-0000-4000-8000-0000000000a1', 'L-001', d, 5, 'kg', 5, 'kg', 1, 'a1000000-0000-4000-8000-00000000000a' from ctx;
insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type, ref_id, effective_on, created_by)
  select '11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-000000000001', '10700000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a3',
         'receipt', 5, 1, 'invoice_line', 'a2000000-0000-4000-8000-0000000000a1', d, 'a1000000-0000-4000-8000-00000000000a' from ctx;

create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare
  state text;
  msg text;
  det text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text, det = pg_exception_detail;
  return state || ' ' || msg || coalesce(' ' || nullif(det, ''), '');
end
$$;
create function pg_temp.act_as(p_who text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', case p_who when 'owner' then 'a0000000-0000-4000-8000-00000000000a' when 'admin' then 'a0000000-0000-4000-8000-0000000000fa'
                      when 'chef' then 'a0000000-0000-4000-8000-0000000000ca' else 'a0000000-0000-4000-8000-0000000000da' end,
    'role', 'authenticated', 'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', p_who,
    'aal', case when p_who = 'admin' then 'aal2' else 'aal1' end)::text, true)
$$;
-- Put draft lines: [loc, id, ingredient, qty, cost] as text arrays.
create function pg_temp.draft(p_loc text, p_id text, p_ing text, p_qty numeric, p_cost numeric) returns jsonb language sql as $$
  select public.opening_draft_put(jsonb_build_array(jsonb_build_object('id', p_id, 'locationId', p_loc, 'ingredientId', p_ing, 'qty', p_qty, 'unitCostEur', p_cost)))
$$;
-- The confirm lines of a location's draft, as the screen would send them.
create function pg_temp.lines_of(p_loc text) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'ingredientId', d.ingredient_id, 'qty', d.qty, 'unitCostEur', d.unit_cost) order by d.created_at, d.id), '[]'::jsonb)
    from public.opening_draft_line d where d.location_id = p_loc::uuid
$$;
create function pg_temp.post(p_loc text, p_date date, p_req text, p_lines jsonb) returns text language sql as $$
  select pg_temp.err(format('select public.post_opening_stock(%L, %L, %L, %L::jsonb)', p_loc, p_date, p_req, p_lines))
$$;
create function pg_temp.n() returns text language sql security definer set search_path = '' as $$
  select (select count(*) from public.stock_opening) || '/' || (select count(*) from public.stock_movement where type::text = 'opening') || '/' || (select count(*) from public.opening_draft_line)
      || '/' || (select count(*) from public.audit_event where action = 'stock.opening_posted')
$$;
create temp table res (label text primary key, r jsonb);
grant all on res to authenticated;
grant execute on function pg_temp.err(text), pg_temp.act_as(text), pg_temp.draft(text, text, text, numeric, numeric), pg_temp.lines_of(text),
  pg_temp.post(text, date, text, jsonb), pg_temp.n() to authenticated;

-- 0. The functions -------------------------------------------------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('post_opening_stock', 'opening_history', 'opening_stock_summary')
              and p.prosecdef and p.proconfig = array['search_path=""']
              and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('service_role', p.oid, 'execute')), 3,
  'post_opening_stock, opening_history and opening_stock_summary are definers with an empty search_path, executable by authenticated only');

-- The drafts: Dispensa 3 lines, Frigo 1 one line, Cantina one line, Banco one line, Cella one line.
set local role authenticated;
select pg_temp.act_as('owner');
select pg_temp.draft('10000000-0000-4000-8000-0000000000a1', '0d000000-0000-4000-8000-000000000011', '1a000000-0000-4000-8000-000000000001', 25, 0.8);
select pg_temp.draft('10000000-0000-4000-8000-0000000000a1', '0d000000-0000-4000-8000-000000000012', '1a000000-0000-4000-8000-000000000002', 4, 6.5);
select pg_temp.draft('10000000-0000-4000-8000-0000000000a1', '0d000000-0000-4000-8000-000000000013', '1a000000-0000-4000-8000-000000000003', 10, 1.2);
select pg_temp.draft('10000000-0000-4000-8000-0000000000a2', '0d000000-0000-4000-8000-000000000021', '1a000000-0000-4000-8000-000000000002', 2, 6.5);
select pg_temp.draft('10000000-0000-4000-8000-0000000000a3', '0d000000-0000-4000-8000-000000000031', '1a000000-0000-4000-8000-000000000001', 1, 0.8);
select pg_temp.draft('10000000-0000-4000-8000-0000000000a4', '0d000000-0000-4000-8000-000000000041', '1a000000-0000-4000-8000-000000000001', 1, 0.8);
select pg_temp.draft('10000000-0000-4000-8000-0000000000a5', '0d000000-0000-4000-8000-000000000051', '1a000000-0000-4000-8000-000000000004', 0.5, 12);
select is(pg_temp.n(), '0/0/7/0', 'seven draft lines, nothing booked');

-- 1. The draft match, and the shape -------------------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.post('10000000-0000-4000-8000-0000000000a1', (select today - 1 from ctx), 'e0000000-0000-4000-8000-000000000001',
            jsonb_set(pg_temp.lines_of('10000000-0000-4000-8000-0000000000a1'), '{0,qty}', '24')), 'P0001 opening_draft_changed', 'one qty differs from the draft: opening_draft_changed');
select is(pg_temp.post('10000000-0000-4000-8000-0000000000a1', (select today - 1 from ctx), 'e0000000-0000-4000-8000-000000000001',
            pg_temp.lines_of('10000000-0000-4000-8000-0000000000a1') || '[{"id": "0d000000-0000-4000-8000-000000000019", "ingredientId": "1a000000-0000-4000-8000-000000000004", "qty": 1, "unitCostEur": 1}]'),
  'P0001 opening_draft_changed', 'one extra line: opening_draft_changed');
select is(pg_temp.post('10000000-0000-4000-8000-0000000000a1', (select today - 1 from ctx), 'e0000000-0000-4000-8000-000000000001',
            pg_temp.lines_of('10000000-0000-4000-8000-0000000000a1') - 2), 'P0001 opening_draft_changed', 'one missing line: opening_draft_changed');
select is(pg_temp.post('10000000-0000-4000-8000-0000000000a1', (select today - 1 from ctx), 'e0000000-0000-4000-8000-000000000001',
            jsonb_set(pg_temp.lines_of('10000000-0000-4000-8000-0000000000a1'), '{1,ingredientId}', '"1a000000-0000-4000-8000-000000000001"')),
  'P0001 opening_line_duplicate 1a000000-0000-4000-8000-000000000001', 'a repeated ingredient: opening_line_duplicate');
select is(pg_temp.post('10000000-0000-4000-8000-0000000000a1', (select today - 1 from ctx), 'e0000000-0000-4000-8000-000000000001',
            (select jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'ingredientId', gen_random_uuid(), 'qty', 1, 'unitCostEur', 1)) from generate_series(1, 201))),
  '22023 invalid_request', '201 lines: 22023');
select is(pg_temp.post('10000000-0000-4000-8000-0000000000a1', (select today - 1 from ctx), 'e0000000-0000-4000-8000-000000000001',
            jsonb_set(pg_temp.lines_of('10000000-0000-4000-8000-0000000000a1'), '{0,id}', '"0d000000-0000-4000-8000-000000000011"') || jsonb_build_array(pg_temp.lines_of('10000000-0000-4000-8000-0000000000a1') -> 0)),
  '22023 invalid_request', 'a repeated line id: 22023');
select is(pg_temp.post('10000000-0000-4000-8000-0000000000a1', null, 'e0000000-0000-4000-8000-000000000001', pg_temp.lines_of('10000000-0000-4000-8000-0000000000a1')),
  '22023 invalid_request', 'a null date: 22023');
select is(pg_temp.post('10000000-0000-4000-8000-0000000000a1', (select today - 1 from ctx), 'e0000000-0000-4000-8000-000000000001',
            jsonb_set(pg_temp.lines_of('10000000-0000-4000-8000-0000000000a1'), '{0,qty}', '25.00001')), 'P0001 opening_qty_invalid', 'a qty with 5 decimals: opening_qty_invalid (never rounded)');
select is(pg_temp.n(), '0/0/7/0', 'none of the refusals wrote anything');

-- 2. AT1: booking Dispensa ----------------------------------------------------------------------------------------------------------------------------------------------------
insert into res select 'first', public.post_opening_stock('10000000-0000-4000-8000-0000000000a1', (select today - 1 from ctx), 'e0000000-0000-4000-8000-000000000001',
                                                         pg_temp.lines_of('10000000-0000-4000-8000-0000000000a1'));
reset role;
select is((select count(*)::int from public.stock_opening o, res where res.label = 'first' and o.id = (res.r ->> 'openingId')::uuid
            and o.location_id = '10000000-0000-4000-8000-0000000000a1' and o.effective_on = (select today - 1 from ctx) and o.line_count = 3
            and o.request_id = 'e0000000-0000-4000-8000-000000000001' and o.created_by = 'a1000000-0000-4000-8000-00000000000a'), 1,
  'owner A books Dispensa''s 3-line draft dated yesterday: one stock_opening row (location, date, request, 3 lines, by the owner)');
select is((select string_agg(i.name || ':' || m.qty::numeric(12, 2) || '@' || m.unit_cost::numeric(12, 2), ',' order by i.name) from public.stock_movement m join public.ingredient i on i.id = m.ingredient_id, res
            where res.label = 'first' and m.type::text = 'opening' and m.ref_type = 'opening' and m.ref_id = (res.r ->> 'openingId')::uuid and m.raw_lot_id is null
              and m.reverses_id is null and m.reason_code is null and m.effective_on = (select today - 1 from ctx) and m.location_id = '10000000-0000-4000-8000-0000000000a1'
              and m.created_by = 'a1000000-0000-4000-8000-00000000000a'),
  'Farina 00 (demo):25.00@0.80,Mozzarella (demo):4.00@6.50,Pomodoro pelato (demo):10.00@1.20',
  'three opening movements with the drafted qty and frozen unit cost, no lot, dated yesterday, ref_id = the opening id');
select is((select (r ->> 'locationId') || '|' || (r ->> 'effectiveOn')::date::text || '|' || (r ->> 'lineCount') || '|' || (r ->> 'totalValueEur') || '|' || (r ->> 'changed') from res where label = 'first'),
  '10000000-0000-4000-8000-0000000000a1|' || (select (today - 1)::text from ctx) || '|3|58.00|true', 'the answer: location, date, 3 lines, total 58,00 EUR, changed');
select is((select count(*)::int from public.opening_draft_line where location_id = '10000000-0000-4000-8000-0000000000a1') || '/'
       || (select count(*)::int from public.opening_draft_line where location_id = '10000000-0000-4000-8000-0000000000a2'), '0/1', 'Dispensa''s draft is empty; Frigo 1''s is untouched');
select is((select string_agg(e.entity_type || '|' || (e.after ->> 'lines') || '|' || (e.after ->> 'total_value_eur') || '|' || (select string_agg(k, ',' order by k) from jsonb_object_keys(e.after) k), ';')
             from public.audit_event e, res where res.label = 'first' and e.action = 'stock.opening_posted' and e.entity_id = (res.r ->> 'openingId')::uuid
              and e.created_by = 'a1000000-0000-4000-8000-00000000000a'),
  'stock_opening|3|58.00|lines,total_value_eur', 'one stock.opening_posted audit row: {lines: 3, total_value_eur: 58.00} and nothing else (no names, no per-line values)');
select is(app.location_on_hand('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-0000000000a1')::numeric(12, 2)::text || '/'
       || app.location_on_hand('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-0000000000a1')::numeric(12, 2)::text,
  '25.00/4.00', 'AT1: the balances at Dispensa include the quantities');

-- 3. Replay (AT9) ------------------------------------------------------------------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('owner');
insert into res select 'replay', public.post_opening_stock('10000000-0000-4000-8000-0000000000a1', (select today - 1 from ctx), 'e0000000-0000-4000-8000-000000000001',
                                                          '[{"id": "0d000000-0000-4000-8000-000000000011", "ingredientId": "1a000000-0000-4000-8000-000000000001", "qty": 25, "unitCostEur": 0.8}]');
select is((select (r - 'changed') = (select r - 'changed' from res where label = 'first') and (r ->> 'changed') = 'false' from res where label = 'replay'), true,
  'the same request_id again: the same answer with changed false (the lines of the replay are not compared)');
select is(pg_temp.n(), '1/3/4/1', 'and nothing new was written');
select is(pg_temp.post('10000000-0000-4000-8000-0000000000a2', (select today - 1 from ctx), 'e0000000-0000-4000-8000-000000000001', pg_temp.lines_of('10000000-0000-4000-8000-0000000000a2')),
  'P0001 opening_request_reused', 'the same request_id at Frigo 1: opening_request_reused');

-- 4. AT4: the date ---------------------------------------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.post('10000000-0000-4000-8000-0000000000a5', (select today + 1 from ctx), 'e0000000-0000-4000-8000-000000000005', pg_temp.lines_of('10000000-0000-4000-8000-0000000000a5')),
  'P0001 opening_date_in_future', 'tomorrow''s business date: opening_date_in_future');
select is(pg_temp.post('10000000-0000-4000-8000-0000000000a5', (select today - 367 from ctx), 'e0000000-0000-4000-8000-000000000005', pg_temp.lines_of('10000000-0000-4000-8000-0000000000a5')),
  'P0001 opening_date_too_old', 'today - 367: opening_date_too_old');
select is(pg_temp.post('10000000-0000-4000-8000-0000000000a3', (select d + 1 from ctx), 'e0000000-0000-4000-8000-000000000003', pg_temp.lines_of('10000000-0000-4000-8000-0000000000a3')),
  'P0001 opening_date_after_receipt ' || (select d::text from ctx), 'Cantina received an invoice on D: D + 1 is opening_date_after_receipt, with D as detail');
select is(pg_temp.post('10000000-0000-4000-8000-0000000000a3', (select d from ctx), 'e0000000-0000-4000-8000-000000000003', pg_temp.lines_of('10000000-0000-4000-8000-0000000000a3')),
  'ok', 'D itself is accepted (Q10)');
select is(pg_temp.n(), '2/4/3/2', 'Cantina booked one line');
-- A receipt at Cantina only does not limit Cella: the business-day case books Cella after D (below, as the admin).

-- 5. AT2: roles --------------------------------------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.act_as('chef');
select is(pg_temp.post('10000000-0000-4000-8000-0000000000a2', (select today from ctx), 'e0000000-0000-4000-8000-000000000002',
            '[{"id": "0d000000-0000-4000-8000-000000000021", "ingredientId": "1a000000-0000-4000-8000-000000000002", "qty": 2, "unitCostEur": 6.5}]'),
  '42501 permission denied: opening stock needs owner or admin', 'the chef: 42501');
select is(pg_temp.err($$ select public.opening_history('10000000-0000-4000-8000-0000000000a1') $$) || ' / ' || pg_temp.err($$ select public.opening_stock_summary() $$),
  '42501 permission denied: opening stock needs owner or admin / 42501 permission denied: opening stock needs owner or admin', 'the chef: 42501 on the history and the summary too');
select pg_temp.act_as('waiter');
select is(pg_temp.post('10000000-0000-4000-8000-0000000000a2', (select today from ctx), 'e0000000-0000-4000-8000-000000000002',
            '[{"id": "0d000000-0000-4000-8000-000000000021", "ingredientId": "1a000000-0000-4000-8000-000000000002", "qty": 2, "unitCostEur": 6.5}]'),
  '42501 permission denied: opening stock needs owner or admin', 'the waiter: 42501');
select is(pg_temp.n(), '2/4/3/2', 'and nothing was written by either');
-- The business day (the date rule reads it, not the calendar): with a cut-off later than the local time of now, the calendar date is still "tomorrow".
reset role;
create temp table bd as
  select (now() at time zone t.timezone)::date as cal, (now() at time zone t.timezone)::time < '23:59' as can_test from public.tenant t where t.id = '11111111-1111-4111-8111-111111111111';
grant select on bd to authenticated;
update public.tenant set settings = settings || '{"business_day_cutoff": "23:59"}' where id = '11111111-1111-4111-8111-111111111111';
set local role authenticated;
select pg_temp.act_as('admin');
select case when (select can_test from bd)
  then is(pg_temp.post('10000000-0000-4000-8000-0000000000a5', (select cal from bd), 'e0000000-0000-4000-8000-000000000005', pg_temp.lines_of('10000000-0000-4000-8000-0000000000a5')),
          'P0001 opening_date_in_future', 'with a 23:59 cut-off, the calendar date is not yet the business date: opening_date_in_future')
  else skip('the local time is 23:59: no cut-off is later') end;
select is(pg_temp.post('10000000-0000-4000-8000-0000000000a5', (select cal - 1 from bd), 'e0000000-0000-4000-8000-000000000005', pg_temp.lines_of('10000000-0000-4000-8000-0000000000a5')),
  'ok', 'the previous date is accepted (by the admin; Cella has no receipt, so Cantina''s D does not limit it)');
reset role;
update public.tenant set settings = settings - 'business_day_cutoff' where id = '11111111-1111-4111-8111-111111111111';
select is((select count(*)::int from public.audit_event e join public.stock_opening o on o.id = e.entity_id
            where e.action = 'stock.opening_posted' and o.location_id = '10000000-0000-4000-8000-0000000000a5'
              and e.created_by = 'a1000000-0000-4000-8000-0000000000fa' and o.created_by = 'a1000000-0000-4000-8000-0000000000fa'), 1,
  'AT2: the admin may book; the operation and its audit row name the admin');

-- 6. AT3: the cut-off, and additions --------------------------------------------------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('owner');
select pg_temp.draft('10000000-0000-4000-8000-0000000000a1', '0d000000-0000-4000-8000-000000000014', '1a000000-0000-4000-8000-000000000004', 1, 10);
select is(pg_temp.post('10000000-0000-4000-8000-0000000000a1', (select today from ctx), 'e0000000-0000-4000-8000-000000000006', pg_temp.lines_of('10000000-0000-4000-8000-0000000000a1')),
  'ok', 'an addition at Dispensa (a second operation, before any count) is accepted');
reset role;
-- Banco: a count is started after its draft was written.
insert into public.count_session (tenant_id, location_id, type, status, started_by)
  values ('11111111-1111-4111-8111-111111111111', '10000000-0000-4000-8000-0000000000a4', 'daily', 'open', 'a1000000-0000-4000-8000-00000000000a');
set local role authenticated;
select pg_temp.act_as('owner');
select is(pg_temp.post('10000000-0000-4000-8000-0000000000a4', (select today from ctx), 'e0000000-0000-4000-8000-000000000004', pg_temp.lines_of('10000000-0000-4000-8000-0000000000a4')),
  'P0001 opening_count_open', 'Banco, during an open count: opening_count_open');
-- History before the count.
insert into res select 'hist', public.opening_history('10000000-0000-4000-8000-0000000000a1');
reset role;
-- Both operations were posted in this one test transaction, so they share createdAt: they are compared by line count here, not by their order.
select is((select string_agg((o ->> 'lineCount') || '|' || (o ->> 'totalValueEur') || '|' || (o ->> 'byName') || '|' || coalesce(o ->> 'reversed', 'null') || '|' || (o ->> 'correctable'), ' ' order by o ->> 'lineCount')
             from res, jsonb_array_elements(r -> 'operations') o where label = 'hist'),
  '1|10.00|Titolare Demo|null|true 3|58.00|Titolare Demo|null|true', 'opening_history(Dispensa): both operations, by the owner, not reversed, correctable');
select is((select string_agg((l ->> 'name') || ':' || (l ->> 'qty') || ' ' || (l ->> 'baseUnit') || '@' || (l ->> 'unitCostEur') || '=' || (l ->> 'valueEur'), ',' order by l ->> 'name')
             from res, jsonb_array_elements(r -> 'operations') o, jsonb_array_elements(o -> 'lines') l where label = 'hist' and (o ->> 'lineCount') = '3'),
  'Farina 00 (demo):25 kg@0.8=20.00,Mozzarella (demo):4 kg@6.5=26.00,Pomodoro pelato (demo):10 kg@1.2=12.00', 'with its lines: name, qty and unit, unit cost and value');
select is((select (r -> 'location' ->> 'name') || '|' || coalesce(r ->> 'countedOn', '-') || '|' || (r ->> 'countOpen') from res where label = 'hist'), 'Dispensa (demo)|-|false',
  'and the location''s state: not counted, no open count');
-- A draft line written at Dispensa before its count, then the count (a closed monthly one, closed after the bookings).
set local role authenticated;
select pg_temp.act_as('owner');
select pg_temp.draft('10000000-0000-4000-8000-0000000000a1', '0d000000-0000-4000-8000-000000000015', '1a000000-0000-4000-8000-000000000003', 2, 1.2);
reset role;
insert into public.count_session (tenant_id, location_id, type, status, started_by, closed_at, closed_by)
  values ('11111111-1111-4111-8111-111111111111', '10000000-0000-4000-8000-0000000000a1', 'monthly', 'closed', 'a1000000-0000-4000-8000-00000000000a', clock_timestamp(), 'a1000000-0000-4000-8000-00000000000a');
set local role authenticated;
select pg_temp.act_as('owner');
select pg_temp.draft('10000000-0000-4000-8000-0000000000a2', '0d000000-0000-4000-8000-000000000022', '1a000000-0000-4000-8000-000000000004', 1, 10);
select is(pg_temp.post('10000000-0000-4000-8000-0000000000a1', (select today from ctx), 'e0000000-0000-4000-8000-000000000007', pg_temp.lines_of('10000000-0000-4000-8000-0000000000a1')),
  'P0001 opening_location_counted ' || (select today::text from ctx), 'after a closed monthly count at Dispensa: opening_location_counted, with the count''s business date');
select is(pg_temp.post('10000000-0000-4000-8000-0000000000a2', (select today from ctx), 'e0000000-0000-4000-8000-000000000002', pg_temp.lines_of('10000000-0000-4000-8000-0000000000a2')),
  'ok', 'Frigo 1 (no count) is still accepted');
select is((select string_agg(o ->> 'correctable', ',') from jsonb_array_elements(public.opening_history('10000000-0000-4000-8000-0000000000a1') -> 'operations') o), 'false,false',
  'after the count, Dispensa''s operations are no longer correctable');
select is((public.opening_history('10000000-0000-4000-8000-0000000000a1') ->> 'countedOn'), (select today::text from ctx), 'and the history says when it was counted');
reset role;
-- Flag 4 (AVT order): every opening row at Dispensa was posted before the location's first closed count, so no AVT window (which starts at a closed monthly count) holds one.
select is((select bool_and(m.created_at < (select min(s.closed_at) from public.count_session s where s.location_id = m.location_id and s.status = 'closed' and s.type = 'monthly'))
             from public.stock_movement m where m.type::text = 'opening' and m.location_id = '10000000-0000-4000-8000-0000000000a1'), true,
  'AVT order: every opening row at Dispensa is older than its first closed monthly count, and a later booking is refused (above)');

-- 7. The summary -------------------------------------------------------------------------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('owner');
select is(public.opening_stock_summary(), jsonb_build_object('booked', true, 'draftLines', 2), 'opening_stock_summary(): booked, and two draft lines left (Banco''s and the refused one at Dispensa)');
select is(public.opening_draft() ->> 'booked', 'true', 'opening_draft() says booked too');
select pg_temp.act_as('admin');
select is(public.opening_stock_summary(), jsonb_build_object('booked', true, 'draftLines', 2), 'the admin reads the same summary');
reset role;
select is(pg_temp.n(), '5/8/2/5', 'in all: five operations (Dispensa twice, Cantina, Cella, Frigo 1 with two lines), eight movements, two draft lines, five audit rows');

-- 8. The history's bounds and errors ------------------------------------------------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('owner');
select is(pg_temp.err($$ select public.opening_history(null) $$), '22023 invalid_request', 'a null location: 22023');
select is(pg_temp.err($$ select public.opening_history(gen_random_uuid()) $$), 'P0001 location_not_found', 'an unknown location: location_not_found');
select is(jsonb_array_length(public.opening_history('10000000-0000-4000-8000-0000000000a4') -> 'operations'), 0, 'a location with no operation has an empty list');
reset role;

select * from finish();
rollback;
