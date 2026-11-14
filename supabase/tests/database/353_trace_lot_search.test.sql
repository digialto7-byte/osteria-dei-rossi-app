-- P2-2 S2 (docs/plans/2026-11-14-p2-2-trace-sell-through.md section 3.3.4 and step S2): the lot search and the lot-capture rate. Fixture (tenant A, p_now 1998-11-14 12:00 Rome):
-- three Farina lots (one coded L-DEMO-0001, one coded "l-demo- 0002", one without a code), a Pomodoro lot outside the default range, 51 bulk lots, and tenant B's own L-DEMO-0001.
-- Plan deviation (code and fixture must agree): the plan's second lot is "l-demo 0002" but its search "l-demo-000" is a prefix of the normalised code only if the code
-- keeps the dash, so the fixture code is "l-demo- 0002" (a space after the dash: it still shows that spaces are ignored). Fake data only; dates in 1998.
begin;
create extension if not exists pgtap with schema extensions;
select plan(42);

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
  ('10000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Cella B (demo)');
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo 1', 'IT12345678903'),
  ('5a000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo 2', 'IT00000000000'),
  ('5b000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Fornitore B Demo', 'IT12345678903');
insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('1a000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Farina Demo', 'kg'),
  ('1a000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'Pomodoro Demo', 'kg'),
  ('1a000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Farina B Demo', 'kg');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status) values
  ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/1998/e1000000-0000-4000-8000-0000000000e1.pdf', 'application/pdf', 2048, 'review'),
  ('e2000000-0000-4000-8000-0000000000e2', '22222222-2222-4222-8222-222222222222',
   '22222222-2222-4222-8222-222222222222/1998/e2000000-0000-4000-8000-0000000000e2.pdf', 'application/pdf', 2048, 'review');

-- One received lot with its invoice line and receipt movement; its id is lpad(p_n) under the 1ee prefix.
create function pg_temp.mklot(p_n int, p_tenant uuid, p_ing uuid, p_sup uuid, p_code text, p_on date, p_qty numeric, p_expiry date default null) returns void language plpgsql as $$
declare
  a boolean := p_tenant = '11111111-1111-4111-8111-111111111111';
  v_line uuid := ('1e000000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid;
  v_lot uuid := ('10700000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid;
  v_loc uuid := case when a then '10000000-0000-4000-8000-0000000000a1'::uuid else '10000000-0000-4000-8000-0000000000b1'::uuid end;
  v_user uuid := case when a then 'a1000000-0000-4000-8000-00000000000a'::uuid else 'b1000000-0000-4000-8000-00000000000b'::uuid end;
begin
  insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price, line_amount, field_confidence, extracted)
    values (v_line, p_tenant, case when a then 'e1000000-0000-4000-8000-0000000000e1'::uuid else 'e2000000-0000-4000-8000-0000000000e2'::uuid end, p_n, 'Riga demo', p_qty, 2, p_qty * 2, '{}', '{}');
  insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code, expiry, received_on, qty_received, base_unit, source_qty, source_unit, base_factor, created_by)
    values (v_lot, p_tenant, p_ing, v_loc, p_sup, v_line, p_code, p_expiry, p_on, p_qty, 'kg', p_qty, 'kg', 1, v_user);
  insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type, ref_id, effective_on, created_at, created_by)
    values (p_tenant, p_ing, v_lot, v_loc, 'receipt', p_qty, 2, 'invoice_line', v_line, p_on, p_on + time '09:00', v_user);
end $$;
create function pg_temp.lot(p_n int) returns uuid language sql as $$ select ('10700000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;

select pg_temp.mklot(1, '11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-0000000000a1', '5a000000-0000-4000-8000-0000000000a1', 'L-DEMO-0001', '1998-11-02', 10, '1998-12-01');
select pg_temp.mklot(2, '11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-0000000000a1', '5a000000-0000-4000-8000-0000000000a2', 'l-demo- 0002', '1998-11-05', 5);
select pg_temp.mklot(3, '11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-0000000000a1', '5a000000-0000-4000-8000-0000000000a1', null, '1998-11-09', 4);
select pg_temp.mklot(4, '11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-0000000000a2', '5a000000-0000-4000-8000-0000000000a2', 'P-77', '1998-10-01', 8);
select pg_temp.mklot(5, '22222222-2222-4222-8222-222222222222', '1a000000-0000-4000-8000-0000000000b1', '5b000000-0000-4000-8000-0000000000b1', 'L-DEMO-0001', '1998-11-02', 7);
-- 51 bulk lots of tenant A, all before the default range (so the capture rate of the range is unaffected).
select pg_temp.mklot(100 + g, '11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-0000000000a2', '5a000000-0000-4000-8000-0000000000a2', 'BULK-' || lpad(g::text, 3, '0'), '1998-09-01', 1)
  from generate_series(1, 51) g;
-- On hand: lot 1 takes 3 kg out and the reversal puts it back (net 10); lot 2 takes 2 kg out (3 left); lot 3 has only its receipt.
insert into public.stock_movement (id, tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type, ref_id, effective_on, created_at, created_by) values
  ('5e000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-0000000000a1', pg_temp.lot(1), '10000000-0000-4000-8000-0000000000a1',
   'consumption', -3, 2, 'batch', '0b000000-0000-4000-8000-000000000001', '1998-11-06', '1998-11-06T10:00Z', 'a1000000-0000-4000-8000-00000000000a'),
  ('5e000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-0000000000a1', pg_temp.lot(2), '10000000-0000-4000-8000-0000000000a1',
   'consumption', -2, 2, 'batch', '0b000000-0000-4000-8000-000000000001', '1998-11-06', '1998-11-06T10:00Z', 'a1000000-0000-4000-8000-00000000000a');
insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type, ref_id, reverses_id, effective_on, created_at, created_by) values
  ('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-0000000000a1', pg_temp.lot(1), '10000000-0000-4000-8000-0000000000a1',
   'consumption', 3, 2, 'order_void', '0b000000-0000-4000-8000-000000000002', '5e000000-0000-4000-8000-000000000001', '1998-11-06', '1998-11-06T11:00Z', 'a1000000-0000-4000-8000-00000000000a');

create function pg_temp.act_as(p_auth uuid, p_tenant uuid, p_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated', 'tenant_id', p_tenant, 'app_role', p_role,
    'aal', case when p_role = 'admin' then 'aal2' else 'aal1' end)::text, true) $$;
-- 'ok' or "SQLSTATE message" of a statement run as the authenticated role.
create function pg_temp.out(stmt text) returns text language plpgsql as $$
declare
  state text;
  msg text;
begin
  set local role authenticated;
  execute stmt;
  reset role;
  return 'ok';
exception when others then
  reset role;
  get stacked diagnostics state = returned_sqlstate, msg = message_text;
  return state || ' ' || msg;
end $$;
-- 'ok' or "SQLSTATE message" of a statement run as the owner of the database (the app.* functions are not executable by authenticated).
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
-- The search as tenant A at p_now (1998-11-14 12:00 Rome = 11:00Z): ids of the found lots, in order.
create function pg_temp.found(p_q text, p_ing uuid, p_sup uuid, p_from date, p_to date) returns text[] language sql as $$
  select coalesce(array_agg(l ->> 'lotId' order by o), '{}') from jsonb_array_elements(
    app.trace_lot_search_json('11111111-1111-4111-8111-111111111111', 'owner', p_q, p_ing, p_sup, p_from, p_to, '1998-11-14T11:00Z') -> 'lots') with ordinality as t (l, o) $$;
create function pg_temp.s(p_q text, p_ing uuid, p_sup uuid, p_from date, p_to date) returns jsonb language sql as $$
  select app.trace_lot_search_json('11111111-1111-4111-8111-111111111111', 'owner', p_q, p_ing, p_sup, p_from, p_to, '1998-11-14T11:00Z') $$;

select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');

-- 1. Search by code prefix: case, spaces and dashes as typed; newest receipt first; never tenant B's lot.
select is(pg_temp.found('l-demo-000', null, null, null, null), array[pg_temp.lot(2)::text, pg_temp.lot(1)::text], 'q = "l-demo-000": A''s two coded lots, newest first, never B''s');
select is(pg_temp.found('L-DEMO-0001', null, null, null, null), array[pg_temp.lot(1)::text], 'q = "L-DEMO-0001": exactly one lot (B''s lot with the same code is not found)');
select is(pg_temp.found('  l-demo-0002 ', null, null, null, null), array[pg_temp.lot(2)::text], 'spaces around and inside are ignored (the stored code "l-demo- 0002" is found by "  l-demo-0002 ")');
select is(pg_temp.found('%', null, null, null, null), '{}'::text[], 'q = "%" finds nothing (escaped)');
select is(pg_temp.found('_', null, null, null, null), '{}'::text[], 'q = "_" finds nothing (escaped)');
select is(pg_temp.found('\', null, null, null, null), '{}'::text[], 'q = a backslash finds nothing (escaped)');
select is(pg_temp.err($$select pg_temp.s(repeat('a', 65), null, null, null, null)$$), '22023 query_invalid', 'q of 65 characters is refused with 22023 query_invalid');
select is(pg_temp.err($$select pg_temp.s(repeat('a', 64), null, null, null, null)$$), 'ok', 'q of 64 characters is accepted');
select is(pg_temp.err($$select pg_temp.s('   ', null, null, null, null)$$), '22023 query_invalid', 'q of only spaces is refused with 22023 query_invalid');
select is(pg_temp.err($$select pg_temp.s(null, null, null, null, null)$$), '22023 query_invalid', 'no filter at all is refused with 22023 query_invalid');
select is(pg_temp.err($$select pg_temp.s(null, null, null, '1998-11-01', '1998-11-10')$$), '22023 query_invalid', 'dates alone are no filter: 22023 query_invalid');

-- 2. Ingredient / supplier / dates. The default range is the 30 business days to today (1998-10-16 to 1998-11-14).
select is(pg_temp.found(null, '1a000000-0000-4000-8000-0000000000a1', null, null, null), array[pg_temp.lot(3)::text, pg_temp.lot(2)::text, pg_temp.lot(1)::text],
          'ingredient = Farina, default range: all three Farina lots, newest first (the uncoded one included)');
select is((select l ->> 'lotCode' from jsonb_array_elements(pg_temp.s(null, '1a000000-0000-4000-8000-0000000000a1', null, null, null) -> 'lots') l where l ->> 'lotId' = pg_temp.lot(3)::text), null,
          'the delivery without a code has lotCode null');
select is(pg_temp.found(null, null, '5a000000-0000-4000-8000-0000000000a1', null, null), array[pg_temp.lot(3)::text, pg_temp.lot(1)::text], 'supplier = Fornitore Demo 1: its two deliveries');
select is(pg_temp.found(null, '1a000000-0000-4000-8000-0000000000a2', null, null, null), '{}'::text[], 'Pomodoro (received 1998-10-01) is outside the default range');
select is(pg_temp.found(null, '1a000000-0000-4000-8000-0000000000a2', null, '1998-09-30', '1998-10-02'), array[pg_temp.lot(4)::text], 'an explicit range reaches it');
select is(pg_temp.found(null, '1a000000-0000-4000-8000-0000000000a1', null, '1998-11-05', '1998-11-05'), array[pg_temp.lot(2)::text], 'a one-day range');
select is(pg_temp.found('p-7', null, null, null, null), array[pg_temp.lot(4)::text], 'with q, dates are not applied unless given (the 1998-10-01 lot is found by its code)');
select is(pg_temp.found('p-7', null, null, '1998-11-01', null), '{}'::text[], 'with q and from given, the date applies');
select is(pg_temp.err($$select pg_temp.s(null, '1a000000-0000-4000-8000-0000000000a1', null, null, '1998-11-15')$$), 'P0001 date_in_future', 'to = tomorrow: P0001 date_in_future');
select is(pg_temp.err($$select pg_temp.s('l-demo', null, null, null, '1998-11-15')$$), 'P0001 date_in_future', 'to = tomorrow with q: P0001 date_in_future');
select is(pg_temp.err($$select pg_temp.s(null, '1a000000-0000-4000-8000-0000000000a1', null, '1998-11-10', '1998-11-09')$$), '22023 query_invalid', 'from after to: 22023');
select is(pg_temp.err($$select pg_temp.s(null, '1a000000-0000-4000-8000-0000000000a1', null, '1997-11-13', '1998-11-14')$$), 'P0001 range_too_long', 'a 367-day range: P0001 range_too_long');
select is(pg_temp.err($$select pg_temp.s(null, '1a000000-0000-4000-8000-0000000000a1', null, '1997-11-14', '1998-11-14')$$), 'ok', 'a 366-day range is allowed');

-- 3. The cap: 51 bulk lots found by their code give 50 and truncated; a narrower prefix does not truncate.
select is(jsonb_array_length(pg_temp.s('bulk', null, null, null, null) -> 'lots'), 50, '51 matching lots: the reply holds 50');
select is(pg_temp.s('bulk', null, null, null, null) -> 'truncated', 'true'::jsonb, 'and truncated is true');
select is(pg_temp.s('bulk-05', null, null, null, null) -> 'truncated', 'false'::jsonb, 'a search under the cap is not truncated');

-- 4. Row shape and onHand (the ledger fold, a consumption and its reversal net to zero).
select is(pg_temp.s('L-DEMO-0001', null, null, null, null) -> 'lots' -> 0,
          jsonb_build_object('lotId', pg_temp.lot(1), 'ingredient', jsonb_build_object('id', '1a000000-0000-4000-8000-0000000000a1', 'name', 'Farina Demo'),
                             'supplier', jsonb_build_object('id', '5a000000-0000-4000-8000-0000000000a1', 'name', 'Fornitore Demo 1'),
                             'lotCode', 'L-DEMO-0001', 'expiry', '1998-12-01', 'receivedOn', '1998-11-02', 'qtyReceived', 10, 'unit', 'kg', 'onHand', 10),
          'a lot row: ids and names, lot code, expiry, receipt date, quantity received, unit and onHand (3 kg consumed and reversed: 10)');
select is((pg_temp.s('l-demo-0002', null, null, null, null) -> 'lots' -> 0 ->> 'onHand')::numeric, 3::numeric, 'onHand of a lot with an unreversed consumption: 5 - 2 = 3');
select is((pg_temp.s(null, '1a000000-0000-4000-8000-0000000000a1', null, null, null) -> 'lots' -> 0 ->> 'onHand')::numeric, 4::numeric, 'a lot with only its receipt: onHand = quantity received');

-- 5. Capture rate over the default range: three Farina lots, two with a code; Fornitore Demo 1 misses one so it comes first.
select is(app.lot_capture_json('11111111-1111-4111-8111-111111111111', null, null, '1998-11-14T11:00Z'),
          jsonb_build_object('from', '1998-10-16', 'to', '1998-11-14', 'lots', 3, 'withLotCode', 2, 'bySupplier', jsonb_build_array(
            jsonb_build_object('supplierId', '5a000000-0000-4000-8000-0000000000a1', 'name', 'Fornitore Demo 1', 'lots', 2, 'withLotCode', 1),
            jsonb_build_object('supplierId', '5a000000-0000-4000-8000-0000000000a2', 'name', 'Fornitore Demo 2', 'lots', 1, 'withLotCode', 1))),
          'lot_capture: 3 lots, 2 with a code, by supplier with the most missing first');
select is(app.lot_capture_json('11111111-1111-4111-8111-111111111111', '1998-09-01', '1998-09-01', '1998-11-14T11:00Z') -> 'lots', '51'::jsonb, 'lot_capture over an explicit one-day range');
select is(pg_temp.err($$select app.lot_capture_json('11111111-1111-4111-8111-111111111111', null, '1998-11-15', '1998-11-14T11:00Z')$$), 'P0001 date_in_future', 'lot_capture: to = tomorrow is P0001 date_in_future');
select is(pg_temp.err($$select app.lot_capture_json('11111111-1111-4111-8111-111111111111', '1997-11-13', '1998-11-14', '1998-11-14T11:00Z')$$), 'P0001 range_too_long', 'lot_capture: 367 days is P0001 range_too_long');
select is(pg_temp.err($$select app.lot_capture_json('11111111-1111-4111-8111-111111111111', '1998-11-10', '1998-11-09', '1998-11-14T11:00Z')$$), '22023 query_invalid', 'lot_capture: from after to is 22023');

-- 6. Money keys: no key of any reply is a money key.
select is(app.payload_money_keys(pg_temp.s('l-demo', null, null, null, null)), '{}'::text[], 'the search reply has no money key');
select is(app.payload_money_keys(app.lot_capture_json('11111111-1111-4111-8111-111111111111', null, null, '1998-11-14T11:00Z')), '{}'::text[], 'the capture reply has no money key');

-- 7. The public functions: roles, tenancy and grants (owner, admin at aal2 and chef are allowed; the waiter and a signed-out session are not).
select is(pg_temp.out($$select public.trace_lot_search('l-demo', null, null, null, null)$$), 'ok', 'owner: public.trace_lot_search is allowed');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.out($$select public.trace_lot_search('l-demo', null, null, null, null)$$), 'ok', 'chef: public.trace_lot_search is allowed');
select is(pg_temp.out($$select public.lot_capture(null, null)$$), 'ok', 'chef: public.lot_capture is allowed');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select matches(pg_temp.out($$select public.trace_lot_search('l-demo', null, null, null, null)$$), '^42501 ', 'waiter: public.trace_lot_search is refused with 42501');
select matches(pg_temp.out($$select public.lot_capture(null, null)$$), '^42501 ', 'waiter: public.lot_capture is refused with 42501');

select * from finish();
rollback;
