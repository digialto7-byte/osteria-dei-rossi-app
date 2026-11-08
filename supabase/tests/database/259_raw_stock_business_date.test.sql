-- A5b (docs/plans/2026-11-08-a5b-raw-stock-business-date.md, ADR-033): raw stock is dated by the BUSINESS day (cut-off from tenant settings, 02:00 by default, Europe/Rome), like the batch
-- side and raw waste since A5. The readers derive the business day from stock_movement.created_at over [app.business_day_start(D), app.kpi_cutoff_end(D)); receipts keep the invoice date
-- (founder M5 Q1, effective_on). No UPDATE, no backfill: every fixture row carries the CALENDAR effective_on that the writers store (the day AFTER the business day between 00:00 and
-- the cut-off), and created_at is the instant of the event.
--   Section R: public.stock_reconciliation.
-- Fake data only; all dates 1998-1999.
begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('e0000000-0000-4000-8000-0000000000e0', 'waiter-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
-- Tenant B closes at 04:00.
insert into public.tenant (id, name, vat_number, settings) values
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115', '{"business_day_cutoff": "04:00"}'::jsonb);
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('e1000000-0000-4000-8000-0000000000e0', '11111111-1111-4111-8111-111111111111', 'e0000000-0000-4000-8000-0000000000e0', 'waiter', 'Cameriere Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)'),
  ('10000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Cella B (demo)');
insert into public.ingredient (id, tenant_id, name, base_unit, is_stock) values
  ('1a000000-0000-4000-8000-00000000001a', '11111111-1111-4111-8111-111111111111', 'Manzo (demo)', 'kg', true),
  ('1b000000-0000-4000-8000-00000000001b', '11111111-1111-4111-8111-111111111111', 'Sedano (demo)', 'kg', true),
  ('1c000000-0000-4000-8000-00000000001c', '11111111-1111-4111-8111-111111111111', 'Olio (demo)', 'l', true),
  ('1d000000-0000-4000-8000-00000000001d', '11111111-1111-4111-8111-111111111111', 'Burro (demo)', 'kg', true),
  ('1e000000-0000-4000-8000-00000000001e', '22222222-2222-4222-8222-222222222222', 'Pollo B (demo)', 'kg', true);
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo Srl', 'IT12345678903'),
  ('5b000000-0000-4000-8000-00000000005b', '22222222-2222-4222-8222-222222222222', 'Fornitore B Demo', 'IT12345678903');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id) values
  ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/e1000000-0000-4000-8000-0000000000e1.pdf', 'application/pdf', 2048, 'review', '5a000000-0000-4000-8000-00000000005a'),
  ('e2000000-0000-4000-8000-0000000000e2', '22222222-2222-4222-8222-222222222222',
   '22222222-2222-4222-8222-222222222222/2026/e2000000-0000-4000-8000-0000000000e2.pdf', 'application/pdf', 2048, 'review', '5b000000-0000-4000-8000-00000000005b');

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
create function pg_temp.as_owner_a() returns void language sql as $$
  select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner') $$;
create function pg_temp.as_owner_b() returns void language sql as $$
  select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner') $$;

-- One movement of tenant A (or B) at its only location, dated the way the writers date it: effective_on is the CALENDAR date of p_at in Rome (p_eff overrides it), created_at is p_at.
create function pg_temp.mv(p_tenant uuid, p_ing uuid, p_type text, p_qty numeric, p_at timestamptz, p_eff date default null, p_ref_type text default 'manual',
    p_ref uuid default gen_random_uuid(), p_reverses uuid default null, p_reason text default null) returns uuid language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.stock_movement (id, tenant_id, ingredient_id, location_id, type, qty, unit_cost, reason_code, ref_type, ref_id, reverses_id, effective_on, created_at, created_by)
  values (v_id, p_tenant, p_ing,
          case when p_tenant = '11111111-1111-4111-8111-111111111111' then '10000000-0000-4000-8000-0000000000a1'::uuid else '10000000-0000-4000-8000-0000000000b1'::uuid end,
          p_type::public.stock_movement_type, p_qty, case when p_type = 'transfer' then null else 1.00 end, p_reason, p_ref_type, p_ref, p_reverses, coalesce(p_eff, (p_at at time zone 'Europe/Rome')::date), p_at,
          case when p_tenant = '11111111-1111-4111-8111-111111111111' then 'a1000000-0000-4000-8000-00000000000a'::uuid else 'b1000000-0000-4000-8000-00000000000b'::uuid end);
  return v_id;
end
$$;
-- A receipt: effective_on is the INVOICE date (p_eff), created_at the moment it was approved (p_at).
create sequence pg_temp.line_seq;
create function pg_temp.receipt(p_tenant uuid, p_ing uuid, p_qty numeric, p_eff date, p_at timestamptz) returns void language plpgsql as $$
declare
  v_n int := nextval('pg_temp.line_seq');
  v_line uuid := gen_random_uuid();
  v_lot uuid := gen_random_uuid();
  v_a boolean := p_tenant = '11111111-1111-4111-8111-111111111111';
begin
  insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price, line_amount, field_confidence, extracted)
    values (v_line, p_tenant, case when v_a then 'e1000000-0000-4000-8000-0000000000e1' else 'e2000000-0000-4000-8000-0000000000e2' end::uuid, v_n, 'Riga demo', 1, 10, 10, '{}', '{}');
  insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code, received_on, qty_received, base_unit, source_qty, source_unit, base_factor, created_by)
    select v_lot, p_tenant, i.id, case when v_a then '10000000-0000-4000-8000-0000000000a1' else '10000000-0000-4000-8000-0000000000b1' end::uuid,
           case when v_a then '5a000000-0000-4000-8000-00000000005a' else '5b000000-0000-4000-8000-00000000005b' end::uuid, v_line, 'L' || v_n, p_eff, p_qty, i.base_unit, p_qty, i.base_unit::text, 1,
           case when v_a then 'a1000000-0000-4000-8000-00000000000a' else 'b1000000-0000-4000-8000-00000000000b' end::uuid
      from public.ingredient i where i.id = p_ing;
  insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type, ref_id, effective_on, created_at, created_by)
    values (p_tenant, p_ing, v_lot, case when v_a then '10000000-0000-4000-8000-0000000000a1' else '10000000-0000-4000-8000-0000000000b1' end::uuid, 'receipt', p_qty, 10, 'invoice_line', v_line,
            p_eff, p_at, case when v_a then 'a1000000-0000-4000-8000-00000000000a' else 'b1000000-0000-4000-8000-00000000000b' end::uuid);
end
$$;
-- A closed count session of tenant A at Cella with one line, closed at p_closed.
create function pg_temp.count_session(p_id uuid, p_ing uuid, p_expected numeric, p_counted numeric, p_closed timestamptz) returns void language plpgsql as $$
begin
  insert into public.count_session (id, tenant_id, location_id, type, started_by, started_at)
    values (p_id, '11111111-1111-4111-8111-111111111111', '10000000-0000-4000-8000-0000000000a1', 'monthly', 'c1000000-0000-4000-8000-00000000000c', p_closed - interval '1 hour');
  insert into public.count_line (tenant_id, session_id, ingredient_id, position, expected_qty, counted_qty, entered_at, entered_by, created_by)
    values ('11111111-1111-4111-8111-111111111111', p_id, p_ing, 1, p_expected, p_counted, p_closed - interval '10 minutes', 'c1000000-0000-4000-8000-00000000000c', 'c1000000-0000-4000-8000-00000000000c');
  update public.count_session set status = 'closed', closed_at = p_closed, closed_by = 'c1000000-0000-4000-8000-00000000000c' where id = p_id;
end
$$;
-- One field of one ingredient's row in stock_reconciliation(p_from, p_to), as the signed-in role.
create function pg_temp.q(p_from date, p_to date, p_ing uuid, p_key text) returns text language sql as $$
  select e ->> p_key from jsonb_array_elements(public.stock_reconciliation(p_from, p_to) -> 'items') e where e ->> 'ingredientId' = p_ing::text $$;
create function pg_temp.qn(p_from date, p_to date, p_ing uuid, p_key text) returns numeric language sql as $$ select pg_temp.q(p_from, p_to, p_ing, p_key)::numeric $$;
create function pg_temp.balanced(p_from date, p_to date, p_ing uuid) returns boolean language sql as $$ select pg_temp.q(p_from, p_to, p_ing, 'balanced')::boolean $$;

-- R1: Sunday night into Monday (winter, cut-off 02:00) ---------------------------------------------------------------------------------------------------------
-- Manzo: 100 received on 1998-11-01. Sun 23:59 CET consumption 1 | Mon 01:30 consumption 2, waste 4, transfer out 8 | Mon 01:45 a monthly count closes with +0,5 | Mon 02:00 sharp consumption 16 |
-- Mon 02:30 consumption 32. Every row is stored with the calendar effective_on (Monday for the 01:30 rows), as the writers do.
select pg_temp.receipt('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-00000000001a', 100, '1998-11-01', '1998-11-01T09:00Z');
select pg_temp.mv('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-00000000001a', 'consumption', -1, '1998-11-08T22:59Z');
select pg_temp.mv('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-00000000001a', 'consumption', -2, '1998-11-09T00:30Z');
select pg_temp.mv('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-00000000001a', 'waste', -4, '1998-11-09T00:30Z', null, 'manual', gen_random_uuid(), null, 'spoilage');
select pg_temp.mv('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-00000000001a', 'transfer', -8, '1998-11-09T00:30Z', null, 'transfer');
select pg_temp.count_session('c0de0000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-00000000001a', 85, 85.5, '1998-11-09T00:45Z');
select pg_temp.mv('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-00000000001a', 'count', 0.5, '1998-11-09T00:45Z', null, 'count_session', 'c0de0000-0000-4000-8000-000000000001');
select pg_temp.mv('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-00000000001a', 'consumption', -16, '1998-11-09T01:00Z');
select pg_temp.mv('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-00000000001a', 'consumption', -32, '1998-11-09T01:30Z');
select is((select effective_on from public.stock_movement where qty = -2 and type::text = 'consumption' and ingredient_id = '1a000000-0000-4000-8000-00000000001a'), '1998-11-09'::date, 'the 01:30 row is stored with the calendar date Monday (as the writers store it)');
select pg_temp.as_owner_a();
select is(pg_temp.qn('1998-11-08', '1998-11-08', '1a000000-0000-4000-8000-00000000001a', 'consumptionQty'), 3::numeric, 'R1 Sunday: consumption 1 (23:59) + 2 (01:30 Monday)');
select is(pg_temp.qn('1998-11-08', '1998-11-08', '1a000000-0000-4000-8000-00000000001a', 'wasteQty') || '/' || pg_temp.qn('1998-11-08', '1998-11-08', '1a000000-0000-4000-8000-00000000001a', 'transfersOutQty'), '4.0000/8.0000',
          'R1 Sunday: the 01:30 waste 4 and transfer out 8 are Sunday''s');
select is(pg_temp.qn('1998-11-08', '1998-11-08', '1a000000-0000-4000-8000-00000000001a', 'closingQty'), 85.5::numeric, 'R1 Sunday: closing 100 - 3 - 4 - 8 + 0,5 = 85,5');
select is(pg_temp.qn('1998-11-09', '1998-11-09', '1a000000-0000-4000-8000-00000000001a', 'consumptionQty'), 48::numeric, 'R1 Monday: consumption 16 (02:00 sharp) + 32 (02:30)');
select is(pg_temp.qn('1998-11-09', '1998-11-09', '1a000000-0000-4000-8000-00000000001a', 'wasteQty') + pg_temp.qn('1998-11-09', '1998-11-09', '1a000000-0000-4000-8000-00000000001a', 'transfersOutQty'), 0::numeric,
          'R1 Monday: no waste and no transfer (they were Sunday''s)');
select is(pg_temp.qn('1998-11-09', '1998-11-09', '1a000000-0000-4000-8000-00000000001a', 'openingQty'), pg_temp.qn('1998-11-08', '1998-11-08', '1a000000-0000-4000-8000-00000000001a', 'closingQty'),
          'R1: opening of Monday = closing of Sunday');
select is(pg_temp.qn('1998-11-09', '1998-11-09', '1a000000-0000-4000-8000-00000000001a', 'closingQty'), 37.5::numeric, 'R1 Monday: closing 85,5 - 48 = 37,5');
select ok(pg_temp.balanced('1998-11-08', '1998-11-08', '1a000000-0000-4000-8000-00000000001a') and pg_temp.balanced('1998-11-09', '1998-11-09', '1a000000-0000-4000-8000-00000000001a'), 'R1: balanced on both days');
select is(pg_temp.qn('1998-11-01', '1998-11-09', '1a000000-0000-4000-8000-00000000001a', 'closingQty'), 37.5::numeric, 'R1: the whole fortnight closes on the same 37,5 (the day rule loses and invents nothing)');

-- R2: the count closed Monday 01:45 is Sunday's count --------------------------------------------------------------------------------------------------------
select is(pg_temp.q('1998-11-08', '1998-11-08', '1a000000-0000-4000-8000-00000000001a', 'countSessionId'), 'c0de0000-0000-4000-8000-000000000001', 'R2: the count closed Monday 01:45 is the count of Sunday 11-08');
select is(pg_temp.q('1998-11-08', '1998-11-08', '1a000000-0000-4000-8000-00000000001a', 'matchesCount'), 'true', 'R2: and Sunday''s closing matches it (its count row is on the same day)');
select is(pg_temp.q('1998-11-09', '1998-11-09', '1a000000-0000-4000-8000-00000000001a', 'countSessionId'), null, 'R2: Monday has no count');

-- R3: receipts keep the invoice date -----------------------------------------------------------------------------------------------------------------------------
-- Sedano: an invoice dated 11-09 approved Sunday 23:00 counts on 11-09; an invoice dated 11-07 approved on 11-10 counts on 11-07.
select pg_temp.receipt('11111111-1111-4111-8111-111111111111', '1b000000-0000-4000-8000-00000000001b', 10, '1998-11-09', '1998-11-08T22:00Z');
select pg_temp.receipt('11111111-1111-4111-8111-111111111111', '1b000000-0000-4000-8000-00000000001b', 5, '1998-11-07', '1998-11-10T09:00Z');
select is(pg_temp.qn('1998-11-09', '1998-11-09', '1b000000-0000-4000-8000-00000000001b', 'receiptsQty'), 10::numeric, 'R3: the invoice dated 11-09, approved Sunday 23:00, counts on 11-09');
select is(pg_temp.qn('1998-11-08', '1998-11-08', '1b000000-0000-4000-8000-00000000001b', 'closingQty'), 5::numeric, 'R3: Sunday does not hold it (closing = the 11-07 receipt only)');
select is(pg_temp.qn('1998-11-07', '1998-11-07', '1b000000-0000-4000-8000-00000000001b', 'receiptsQty'), 5::numeric, 'R3: the invoice dated 11-07, approved 11-10, counts on 11-07');

-- R4: both DST nights ----------------------------------------------------------------------------------------------------------------------------------------------
-- Olio, consumption only. Autumn 1998-10-25 (02:00 happens twice; the cut-off is the first, 00:00Z): 10-24T23:30Z -> 10-24, 10-25T00:30Z and 10-26T00:30Z -> 10-25, 10-26T01:00Z -> 10-26.
-- Spring 1999-03-28 (02:00 does not exist; the cut-off is the jump instant 01:00Z): 00:30Z -> 03-27, 01:00Z and 01:30Z -> 03-28.
select pg_temp.mv('11111111-1111-4111-8111-111111111111', '1c000000-0000-4000-8000-00000000001c', 'consumption', -1, '1998-10-24T23:30Z');
select pg_temp.mv('11111111-1111-4111-8111-111111111111', '1c000000-0000-4000-8000-00000000001c', 'consumption', -2, '1998-10-25T00:30Z');
select pg_temp.mv('11111111-1111-4111-8111-111111111111', '1c000000-0000-4000-8000-00000000001c', 'consumption', -4, '1998-10-26T00:30Z');
select pg_temp.mv('11111111-1111-4111-8111-111111111111', '1c000000-0000-4000-8000-00000000001c', 'consumption', -8, '1998-10-26T01:00Z');
select is(pg_temp.qn('1998-10-24', '1998-10-24', '1c000000-0000-4000-8000-00000000001c', 'consumptionQty'), 1::numeric, 'R4 autumn: 01:30 CEST on the 25th is the 24th''s business day');
select is(pg_temp.qn('1998-10-25', '1998-10-25', '1c000000-0000-4000-8000-00000000001c', 'consumptionQty'), 6::numeric, 'R4 autumn: 02:30 CEST and Monday 01:30 CET (the day is 25 hours) are the 25th');
select is(pg_temp.qn('1998-10-26', '1998-10-26', '1c000000-0000-4000-8000-00000000001c', 'consumptionQty'), 8::numeric, 'R4 autumn: Monday 02:00 CET sharp is the 26th');
select pg_temp.mv('11111111-1111-4111-8111-111111111111', '1c000000-0000-4000-8000-00000000001c', 'consumption', -16, '1999-03-28T00:30Z');
select pg_temp.mv('11111111-1111-4111-8111-111111111111', '1c000000-0000-4000-8000-00000000001c', 'consumption', -32, '1999-03-28T01:00Z');
select pg_temp.mv('11111111-1111-4111-8111-111111111111', '1c000000-0000-4000-8000-00000000001c', 'consumption', -64, '1999-03-28T01:30Z');
select is(pg_temp.qn('1999-03-27', '1999-03-27', '1c000000-0000-4000-8000-00000000001c', 'consumptionQty'), 16::numeric, 'R4 spring: Sunday 01:30 CET is Saturday 03-27''s business day');
select is(pg_temp.qn('1999-03-28', '1999-03-28', '1c000000-0000-4000-8000-00000000001c', 'consumptionQty'), 96::numeric, 'R4 spring: 03:00 CEST sharp and 03:30 count on Sunday 03-28');

-- R5: a row stored with the calendar date counts by created_at, and nothing is written ----------------------------------------------------------------------------
select is((select effective_on from public.stock_movement where qty = -2 and type::text = 'consumption' and ingredient_id = '1a000000-0000-4000-8000-00000000001a'), '1998-11-09'::date, 'R5: the 01:30 row still holds the calendar effective_on after every read above');
select is((select count(*)::int from public.stock_movement where tenant_id = '11111111-1111-4111-8111-111111111111'), 17, 'R5: the ledger holds exactly the rows the fixture inserted (reads write nothing)');

-- R6: a reversal counts on the day it is posted ---------------------------------------------------------------------------------------------------------------
-- Burro: 10 received on 11-01; Sun 21:00 waste 2, reversed Mon 01:50 (business Sunday); Sun 21:30 waste 1, reversed Mon 02:30 (business Monday).
select pg_temp.receipt('11111111-1111-4111-8111-111111111111', '1d000000-0000-4000-8000-00000000001d', 10, '1998-11-01', '1998-11-01T09:00Z');
select pg_temp.mv('11111111-1111-4111-8111-111111111111', '1d000000-0000-4000-8000-00000000001d', 'waste', -2, '1998-11-08T20:00Z', null, 'manual', gen_random_uuid(), null, 'spoilage');
select pg_temp.mv('11111111-1111-4111-8111-111111111111', '1d000000-0000-4000-8000-00000000001d', 'waste', 2, '1998-11-09T00:50Z', null, 'reversal', gen_random_uuid(),
  (select id from public.stock_movement where ingredient_id = '1d000000-0000-4000-8000-00000000001d' and qty = -2), 'spoilage');
select pg_temp.mv('11111111-1111-4111-8111-111111111111', '1d000000-0000-4000-8000-00000000001d', 'waste', -1, '1998-11-08T20:30Z', null, 'manual', gen_random_uuid(), null, 'spoilage');
select pg_temp.mv('11111111-1111-4111-8111-111111111111', '1d000000-0000-4000-8000-00000000001d', 'waste', 1, '1998-11-09T01:30Z', null, 'reversal', gen_random_uuid(),
  (select id from public.stock_movement where ingredient_id = '1d000000-0000-4000-8000-00000000001d' and qty = -1), 'spoilage');
select is(pg_temp.qn('1998-11-08', '1998-11-08', '1d000000-0000-4000-8000-00000000001d', 'wasteQty'), 1::numeric, 'R6 Sunday: waste 2 + 1, minus the reversal of 2 posted Monday 01:50');
select is(pg_temp.qn('1998-11-09', '1998-11-09', '1d000000-0000-4000-8000-00000000001d', 'wasteQty'), -1::numeric, 'R6 Monday: the reversal posted at 02:30 (-1 of waste)');
select ok(pg_temp.balanced('1998-11-08', '1998-11-08', '1d000000-0000-4000-8000-00000000001d') and pg_temp.balanced('1998-11-09', '1998-11-09', '1d000000-0000-4000-8000-00000000001d'), 'R6: balanced on both days');

-- R7: tenant B (04:00), roles, shape --------------------------------------------------------------------------------------------------------------------------------
select pg_temp.receipt('22222222-2222-4222-8222-222222222222', '1e000000-0000-4000-8000-00000000001e', 100, '1998-11-01', '1998-11-01T09:00Z');
select pg_temp.mv('22222222-2222-4222-8222-222222222222', '1e000000-0000-4000-8000-00000000001e', 'consumption', -1, '1998-11-09T02:30Z');
select pg_temp.mv('22222222-2222-4222-8222-222222222222', '1e000000-0000-4000-8000-00000000001e', 'consumption', -2, '1998-11-09T03:30Z');
select pg_temp.as_owner_b();
select is(pg_temp.qn('1998-11-08', '1998-11-08', '1e000000-0000-4000-8000-00000000001e', 'consumptionQty'), 1::numeric, 'R7 tenant B (04:00): Monday 03:30 CET is Sunday''s business day');
select is(pg_temp.qn('1998-11-09', '1998-11-09', '1e000000-0000-4000-8000-00000000001e', 'consumptionQty'), 2::numeric, 'R7 tenant B: Monday 04:30 CET is Monday');
select pg_temp.as_owner_a();
select is(pg_temp.qn('1998-11-08', '1998-11-08', '1a000000-0000-4000-8000-00000000001a', 'consumptionQty'), 3::numeric, 'R7: and tenant A''s Sunday did not move');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(left(pg_temp.err($$select public.stock_reconciliation('1998-11-08', '1998-11-08')$$), 6), '42501 ', 'R7: the waiter is refused');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.err($$select public.stock_reconciliation('1998-11-08', '1998-11-08')$$), 'ok', 'R7: the chef may reconcile');
select ok(not (public.stock_reconciliation('1998-11-08', '1998-11-08')::text ~* '"[^"]*(cost|price|eur|value|amount|margin)[^"]*"\s*:'), 'R7: and gets no cost-like key');
select pg_temp.as_owner_a();
select is(left(pg_temp.err($$select public.stock_reconciliation('1998-11-09', '1998-11-08')$$), 19), 'P0001 range_invalid', 'R7: from after to is range_invalid');
select is(left(pg_temp.err($$select public.stock_reconciliation('1998-01-01', '1999-01-02')$$), 20), 'P0001 range_too_long', 'R7: 367 days is range_too_long');
select is((select array_agg(r order by r) from unnest(array['anon', 'authenticated', 'service_role']) r where has_function_privilege(r, 'public.stock_reconciliation(date,date,uuid)', 'execute')), array['authenticated'],
          'R7: only authenticated executes stock_reconciliation');
select is((select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = 'public.stock_reconciliation(date,date,uuid)'::regprocedure), true, 'R7: still a definer with an empty search_path');

select * from finish();
rollback;
