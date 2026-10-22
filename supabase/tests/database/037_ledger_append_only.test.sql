-- M5 acceptance test 6 (database part): UPDATE, DELETE and TRUNCATE on the audit and ledger
-- tables raise for every role, the migration owner included. Each table is tested eight ways: the
-- API roles have no grant (42501); with a grant added inside this transaction the trigger itself
-- still raises `append_only` (so the trigger, not only the grant, protects the table); the
-- migration owner (this session's role) is stopped by the trigger; TRUNCATE is stopped by the
-- statement trigger (with CASCADE: PostgreSQL refuses a plain TRUNCATE of a table that a foreign
-- key references, with 0A000, before any trigger runs; CASCADE reaches the trigger). Later steps of M5 extend this file with the other ledger tables.
begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

insert into auth.users (id, email) values ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare A');
insert into public.location (id, tenant_id, name)
  values ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella');
insert into public.ingredient (id, tenant_id, name, base_unit)
  values ('1a000000-0000-4000-8000-00000000001a', '11111111-1111-4111-8111-111111111111', 'Manzo', 'kg');
insert into public.supplier (id, tenant_id, name, vat_number)
  values ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111',
          'Fornitore Demo Srl', 'IT12345678903');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, original_filename)
  values ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
          '11111111-1111-4111-8111-111111111111/2026/e1000000-0000-4000-8000-0000000000e1.pdf',
          'application/pdf', 2048, 'fattura.pdf');
insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty,
                                 unit_price, line_amount, field_confidence, extracted)
  values ('a2000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111',
          'e1000000-0000-4000-8000-0000000000e1', 1, 'Manzo fesa', 2, 12.75, 25.5, '{}', '{}');
insert into public.audit_event (tenant_id, entity_type, entity_id, action, created_by)
  values ('11111111-1111-4111-8111-111111111111', 'invoice', 'e1000000-0000-4000-8000-0000000000e1',
          'invoice.approved', 'a1000000-0000-4000-8000-00000000000a');
insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id,
                            received_on, qty_received, base_unit, source_qty, source_unit,
                            base_factor, created_by)
  values ('10700000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111',
          '1a000000-0000-4000-8000-00000000001a', '10000000-0000-4000-8000-0000000000a1',
          '5a000000-0000-4000-8000-00000000005a', 'a2000000-0000-4000-8000-0000000000a1',
          '2026-09-29', 2, 'kg', 2, 'kg', 1, 'a1000000-0000-4000-8000-00000000000a');
insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty,
                                   unit_cost, ref_type, ref_id, effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-00000000001a',
          '10700000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
          'receipt', 2, 12.75, 'invoice_line', 'a2000000-0000-4000-8000-0000000000a1',
          '2026-09-29', 'a1000000-0000-4000-8000-00000000000a');
insert into public.price_history (tenant_id, ingredient_id, supplier_id, invoice_line_id, unit_price,
                                  base_unit, effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-00000000001a',
          '5a000000-0000-4000-8000-00000000005a', 'a2000000-0000-4000-8000-0000000000a1', 12.75,
          'kg', '2026-09-29', 'a1000000-0000-4000-8000-00000000000a');
insert into public.payable (tenant_id, invoice_id, supplier_id, gross_amount, credited_amount, amount,
                            due_date, due_date_source, created_by)
  values ('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-0000000000e1',
          '5a000000-0000-4000-8000-00000000005a', 28.05, 0, 28.05, '2026-10-29', 'supplier_terms',
          'a1000000-0000-4000-8000-00000000000a');

create function pg_temp.act_as_owner() returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
    'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'owner')::text, true)
$$;
grant execute on function pg_temp.act_as_owner() to authenticated;

-- audit_event.
set local role authenticated;
select pg_temp.act_as_owner();
select throws_ok($$ update public.audit_event set reason = 'x' $$, '42501', null,
  'audit_event: UPDATE as owner A has no grant');
select throws_ok($$ delete from public.audit_event $$, '42501', null,
  'audit_event: DELETE as owner A has no grant');
reset role;
set local role service_role;
select throws_ok($$ update public.audit_event set reason = 'x' $$, '42501', null,
  'audit_event: UPDATE as service_role has no grant');
reset role;
grant update, delete on public.audit_event to service_role;
set local role service_role;
select throws_ok($$ update public.audit_event set reason = 'x' $$, 'P0001', 'append_only',
  'audit_event: UPDATE as service_role with a grant still raises append_only');
select throws_ok($$ delete from public.audit_event $$, 'P0001', 'append_only',
  'audit_event: DELETE as service_role with a grant still raises append_only');
reset role;
select throws_ok($$ update public.audit_event set reason = 'x' $$, 'P0001', 'append_only',
  'audit_event: UPDATE as the migration owner raises append_only');
select throws_ok($$ delete from public.audit_event $$, 'P0001', 'append_only',
  'audit_event: DELETE as the migration owner raises append_only');
select throws_ok($$ truncate public.audit_event cascade $$, 'P0001', 'append_only',
  'audit_event: TRUNCATE ... CASCADE as the migration owner raises append_only');

-- raw_lot.
set local role authenticated;
select pg_temp.act_as_owner();
select throws_ok($$ update public.raw_lot set lot_code = 'x' $$, '42501', null,
  'raw_lot: UPDATE as owner A has no grant');
select throws_ok($$ delete from public.raw_lot $$, '42501', null,
  'raw_lot: DELETE as owner A has no grant');
reset role;
set local role service_role;
select throws_ok($$ update public.raw_lot set lot_code = 'x' $$, '42501', null,
  'raw_lot: UPDATE as service_role has no grant');
reset role;
grant update, delete on public.raw_lot to service_role;
set local role service_role;
select throws_ok($$ update public.raw_lot set lot_code = 'x' $$, 'P0001', 'append_only',
  'raw_lot: UPDATE as service_role with a grant still raises append_only');
select throws_ok($$ delete from public.raw_lot $$, 'P0001', 'append_only',
  'raw_lot: DELETE as service_role with a grant still raises append_only');
reset role;
select throws_ok($$ update public.raw_lot set lot_code = 'x' $$, 'P0001', 'append_only',
  'raw_lot: UPDATE as the migration owner raises append_only');
select throws_ok($$ delete from public.raw_lot $$, 'P0001', 'append_only',
  'raw_lot: DELETE as the migration owner raises append_only');
select throws_ok($$ truncate public.raw_lot cascade $$, 'P0001', 'append_only',
  'raw_lot: TRUNCATE ... CASCADE as the migration owner raises append_only');

-- stock_movement.
set local role authenticated;
select pg_temp.act_as_owner();
select throws_ok($$ update public.stock_movement set reason_code = 'x' $$, '42501', null,
  'stock_movement: UPDATE as owner A has no grant');
select throws_ok($$ delete from public.stock_movement $$, '42501', null,
  'stock_movement: DELETE as owner A has no grant');
reset role;
set local role service_role;
select throws_ok($$ update public.stock_movement set reason_code = 'x' $$, '42501', null,
  'stock_movement: UPDATE as service_role has no grant');
reset role;
grant update, delete on public.stock_movement to service_role;
set local role service_role;
select throws_ok($$ update public.stock_movement set reason_code = 'x' $$, 'P0001', 'append_only',
  'stock_movement: UPDATE as service_role with a grant still raises append_only');
select throws_ok($$ delete from public.stock_movement $$, 'P0001', 'append_only',
  'stock_movement: DELETE as service_role with a grant still raises append_only');
reset role;
select throws_ok($$ update public.stock_movement set reason_code = 'x' $$, 'P0001', 'append_only',
  'stock_movement: UPDATE as the migration owner raises append_only');
select throws_ok($$ delete from public.stock_movement $$, 'P0001', 'append_only',
  'stock_movement: DELETE as the migration owner raises append_only');
select throws_ok($$ truncate public.stock_movement cascade $$, 'P0001', 'append_only',
  'stock_movement: TRUNCATE ... CASCADE as the migration owner raises append_only');

-- price_history.
set local role authenticated;
select pg_temp.act_as_owner();
select throws_ok($$ update public.price_history set unit_price = 1 $$, '42501', null,
  'price_history: UPDATE as owner A has no grant');
select throws_ok($$ delete from public.price_history $$, '42501', null,
  'price_history: DELETE as owner A has no grant');
reset role;
set local role service_role;
select throws_ok($$ update public.price_history set unit_price = 1 $$, '42501', null,
  'price_history: UPDATE as service_role has no grant');
reset role;
grant update, delete on public.price_history to service_role;
set local role service_role;
select throws_ok($$ update public.price_history set unit_price = 1 $$, 'P0001', 'append_only',
  'price_history: UPDATE as service_role with a grant still raises append_only');
select throws_ok($$ delete from public.price_history $$, 'P0001', 'append_only',
  'price_history: DELETE as service_role with a grant still raises append_only');
reset role;
select throws_ok($$ update public.price_history set unit_price = 1 $$, 'P0001', 'append_only',
  'price_history: UPDATE as the migration owner raises append_only');
select throws_ok($$ delete from public.price_history $$, 'P0001', 'append_only',
  'price_history: DELETE as the migration owner raises append_only');
select throws_ok($$ truncate public.price_history cascade $$, 'P0001', 'append_only',
  'price_history: TRUNCATE ... CASCADE as the migration owner raises append_only');

-- payable: money columns are frozen by payable_guard (pgTAP 032); rows cannot be deleted.
set local role authenticated;
select pg_temp.act_as_owner();
select throws_ok($$ delete from public.payable $$, '42501', null,
  'payable: DELETE as owner A has no grant');
reset role;
grant delete on public.payable to service_role;
set local role service_role;
select throws_ok($$ delete from public.payable $$, 'P0001', 'append_only',
  'payable: DELETE as service_role with a grant still raises append_only');
reset role;
select throws_ok($$ delete from public.payable $$, 'P0001', 'append_only',
  'payable: DELETE as the migration owner raises append_only');
select throws_ok($$ update public.payable set amount = 1, credited_amount = 27.05 $$, 'P0001',
  'payable_immutable', 'payable: UPDATE of the amount as the migration owner raises payable_immutable');
select throws_ok($$ truncate public.payable cascade $$, 'P0001', 'append_only',
  'payable: TRUNCATE ... CASCADE as the migration owner raises append_only');

select * from finish();
rollback;
