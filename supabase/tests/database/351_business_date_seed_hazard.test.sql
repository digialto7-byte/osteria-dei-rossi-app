-- Guard for the e2e seed hazard (fix/e2e-seed-business-date). Between 00:00 and the cut-off (02:00 by default, Europe/Rome) the Rome CALENDAR date is one day ahead of the BUSINESS date.
-- Receipts count by effective_on (the invoice date, founder M5 Q1) while counts and other movements count by business-day instants (A5b), so a receipt dated with the calendar date
-- falls outside a report that ends on the business date, while a count closed in the same minute stays inside: nothing reconciles. The app is right; a seed must date its invoice with the
-- business date the owner reads from public.business_date_of. Instant used: 1998-11-13T23:30:00Z = 00:30 Rome on 14/11 (CET). Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, email) values ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test');
insert into public.tenant (id, name, vat_number) values ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo');
insert into public.location (id, tenant_id, name) values ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)');
insert into public.ingredient (id, tenant_id, name, base_unit, is_stock) values
  ('1a000000-0000-4000-8000-00000000001a', '11111111-1111-4111-8111-111111111111', 'Calendario (demo)', 'kg', true),
  ('1b000000-0000-4000-8000-00000000001b', '11111111-1111-4111-8111-111111111111', 'Business (demo)', 'kg', true);
insert into public.supplier (id, tenant_id, name, vat_number) values ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo Srl', 'IT12345678903');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id) values
  ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/e1000000-0000-4000-8000-0000000000e1.pdf', 'application/pdf', 2048, 'review', '5a000000-0000-4000-8000-00000000005a');

create function pg_temp.as_owner_a() returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
    'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'owner', 'aal', 'aal1')::text, true) $$;

-- 5 kg of an ingredient received on the invoice date p_eff (approved at p_at), then a count of 5 kg closed at p_at + 30 minutes.
create sequence pg_temp.n;
create function pg_temp.receive_and_count(p_ing uuid, p_eff date, p_at timestamptz, p_session uuid) returns void language plpgsql as $$
declare
  v_n int := nextval('pg_temp.n');
  v_line uuid := gen_random_uuid();
  v_lot uuid := gen_random_uuid();
begin
  insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price, line_amount, field_confidence, extracted)
    values (v_line, '11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-0000000000e1', v_n, 'Riga demo', 5, 10, 50, '{}', '{}');
  insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code, received_on, qty_received, base_unit, source_qty, source_unit, base_factor, created_by)
    values (v_lot, '11111111-1111-4111-8111-111111111111', p_ing, '10000000-0000-4000-8000-0000000000a1', '5a000000-0000-4000-8000-00000000005a', v_line, 'L' || v_n, p_eff, 5, 'kg', 5, 'kg', 1,
            'a1000000-0000-4000-8000-00000000000a');
  insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type, ref_id, effective_on, created_at, created_by)
    values ('11111111-1111-4111-8111-111111111111', p_ing, v_lot, '10000000-0000-4000-8000-0000000000a1', 'receipt', 5, 10, 'invoice_line', v_line, p_eff, p_at, 'a1000000-0000-4000-8000-00000000000a');
  insert into public.count_session (id, tenant_id, location_id, type, started_by, started_at)
    values (p_session, '11111111-1111-4111-8111-111111111111', '10000000-0000-4000-8000-0000000000a1', 'monthly', 'a1000000-0000-4000-8000-00000000000a', p_at);
  insert into public.count_line (tenant_id, session_id, ingredient_id, position, expected_qty, counted_qty, entered_at, entered_by, created_by)
    values ('11111111-1111-4111-8111-111111111111', p_session, p_ing, 1, 5, 5, p_at + interval '20 minutes', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
  update public.count_session set status = 'closed', closed_at = p_at + interval '30 minutes', closed_by = 'a1000000-0000-4000-8000-00000000000a' where id = p_session;
end
$$;
create function pg_temp.q(p_from date, p_to date, p_ing uuid, p_key text) returns text language sql as $$
  select e ->> p_key from jsonb_array_elements(public.stock_reconciliation(p_from, p_to) -> 'items') e where e ->> 'ingredientId' = p_ing::text $$;

-- The seed approved the invoice at 23:00Z (00:00 Rome) and the chef closes the count at 23:30Z (00:30 Rome on 14/11).
-- Calendario: the invoice dated with the Rome calendar date (the old seed). Business: dated with the business date (the fix).
select pg_temp.receive_and_count('1a000000-0000-4000-8000-00000000001a', '1998-11-14', '1998-11-13T23:00Z', 'c0de0000-0000-4000-8000-000000000001');
select pg_temp.receive_and_count('1b000000-0000-4000-8000-00000000001b', '1998-11-13', '1998-11-13T23:00Z', 'c0de0000-0000-4000-8000-000000000002');

select pg_temp.as_owner_a();
select is(app.venue_date('1998-11-13T23:30:00Z', 'Europe/Rome'), '1998-11-14'::date, 'the Rome calendar date of 23:30Z is 14/11');
select is(public.business_date_of('1998-11-13T23:30:00Z'), '1998-11-13'::date, 'the business date of the same instant is 13/11 (the cut-off is 02:00)');
select is(public.business_date_of('1998-11-14T01:30:00Z'), '1998-11-14'::date, 'after the cut-off (02:30 Rome) the business date has caught up with the calendar');

-- The report as getReconciliation defaults it: from the 1st of the month to the business date.
select is(pg_temp.q('1998-11-01', '1998-11-13', '1a000000-0000-4000-8000-00000000001a', 'receiptsQty')::numeric, 0::numeric,
          'a receipt dated with the calendar date 14/11 is outside a report ending on the business date 13/11');
select is(pg_temp.q('1998-11-01', '1998-11-13', '1a000000-0000-4000-8000-00000000001a', 'countedQty')::numeric, 5::numeric, 'while the count closed at 00:30 Rome is inside it');
select is(pg_temp.q('1998-11-01', '1998-11-13', '1a000000-0000-4000-8000-00000000001a', 'matchesCount'), 'false', 'so the row does not reconcile (the failing e2e shape: finale 0, contato 5)');
select is(pg_temp.q('1998-11-01', '1998-11-14', '1a000000-0000-4000-8000-00000000001a', 'matchesCount'), 'true', 'a report that reaches 14/11 would have reconciled: the app is right, the seed date was wrong');

select is(pg_temp.q('1998-11-01', '1998-11-13', '1b000000-0000-4000-8000-00000000001b', 'receiptsQty')::numeric, 5::numeric, 'a receipt dated with the business date 13/11 is in the report');
select is(pg_temp.q('1998-11-01', '1998-11-13', '1b000000-0000-4000-8000-00000000001b', 'matchesCount'), 'true', 'and the row reconciles');
select is(pg_temp.q('1998-11-01', public.business_date_of('1998-11-13T23:30:00Z')::text::date, '1b000000-0000-4000-8000-00000000001b', 'closingQty')::numeric, 5::numeric,
          'with the end taken from business_date_of, as the route does, the closing is 5 kg');

select * from finish();
rollback;
