-- M0 acceptance test 10: no column a waiter can read has a cost-like name. Every public table
-- and view gets fixture rows (extend the fixture below when a milestone adds a table); the test
-- then collects the columns of every relation where a waiter sees at least one row.
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

-- Fixture: one tenant with a waiter. Later milestones add rows for their own tables here.
insert into auth.users (id, email)
  values ('c0000000-0000-4000-8000-00000000000c', 'waiter-a@example.test');
insert into public.tenant (id, name, vat_number)
  values ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (tenant_id, auth_id, role, display_name)
  values ('11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c',
          'waiter', 'Cameriere A');
-- M1 master data (one row per table).
insert into public.location (tenant_id, name) values ('11111111-1111-4111-8111-111111111111', 'Cella');
insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('1a000000-0000-4000-8000-00000000001a', '11111111-1111-4111-8111-111111111111', 'Manzo', 'kg');
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111',
   'Fornitore Demo Srl', 'IT12345678903');
insert into public.supplier_item (id, tenant_id, supplier_id, ingredient_id, supplier_code, pack_qty,
                                  pack_unit, last_price)
  values ('51000000-0000-4000-8000-000000000051', '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a',
          '1a000000-0000-4000-8000-00000000001a', 'MAN-1', 1, 'kg', 12.5);

-- M2 invoices.
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, original_filename)
  values ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
          '11111111-1111-4111-8111-111111111111/2026/e1000000-0000-4000-8000-0000000000e1.pdf',
          'application/pdf', 2048, 'fattura.pdf');

-- M4 cost centres.
insert into public.cost_centre (id, tenant_id, name)
  values ('c5000000-0000-4000-8000-0000000000c5', '11111111-1111-4111-8111-111111111111', 'Pulizie');

-- M3 extracted invoice lines, with the M4 review states: a mapped line (position 1), a non-stock
-- line (position 2), and a split line with one child (position 3).
insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price,
                                 line_amount, field_confidence, extracted, unit, suggested_unit,
                                 ingredient_id, supplier_item_id, suggested_ingredient_id,
                                 suggested_supplier_item_id, mapping_source, credit_qty,
                                 corrected_fields, reviewed_at)
  values ('a2000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111',
          'e1000000-0000-4000-8000-0000000000e1', 1, 'Manzo fesa', 2, 12.75, 25.5, '{}', '{}',
          'kg', 'kg', '1a000000-0000-4000-8000-00000000001a',
          '51000000-0000-4000-8000-000000000051', '1a000000-0000-4000-8000-00000000001a',
          '51000000-0000-4000-8000-000000000051', 'auto', 1, '{qty}', now());
insert into public.invoice_line (tenant_id, invoice_id, position, raw_description, qty, unit_price,
                                 line_amount, field_confidence, extracted, is_stock, cost_centre_id)
  values ('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-0000000000e1', 2,
          'Detersivo piatti', 1, 8, 8, '{}', '{}', false, 'c5000000-0000-4000-8000-0000000000c5');
insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price,
                                 line_amount, field_confidence, extracted, split_at)
  values ('a2000000-0000-4000-8000-0000000000a3', '11111111-1111-4111-8111-111111111111',
          'e1000000-0000-4000-8000-0000000000e1', 3, 'Olio', 3, 10, 30, '{}', '{}', now());
insert into public.invoice_line (tenant_id, invoice_id, position, sub_position, parent_line_id,
                                 raw_description, qty, unit_price, line_amount, field_confidence,
                                 extracted)
  values ('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-0000000000e1', 3, 1,
          'a2000000-0000-4000-8000-0000000000a3', 'Olio', 1, 10, 10, '{}', '{}');

-- M5 review fix round 3: a duplicate decision (owner/admin only). Needs a second invoice.
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, original_filename)
  values ('e2000000-0000-4000-8000-0000000000e2', '11111111-1111-4111-8111-111111111111',
          '11111111-1111-4111-8111-111111111111/2026/e2000000-0000-4000-8000-0000000000e2.pdf',
          'application/pdf', 2048, 'fattura2.pdf');
insert into public.invoice_duplicate_decision (tenant_id, invoice_id, other_id, decided_by)
  values ('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-0000000000e1',
          'e2000000-0000-4000-8000-0000000000e2', (select id from public.app_user limit 1));

-- M5 audit events (owner/admin only).
insert into public.audit_event (tenant_id, entity_type, entity_id, action, after, created_by)
  values ('11111111-1111-4111-8111-111111111111', 'invoice', 'e1000000-0000-4000-8000-0000000000e1',
          'invoice.approved', '{"status":"approved"}', (select id from public.app_user limit 1));

-- M6 alert (the owner reads it; a waiter has no policy, so nothing of it is visible to the waiter).
insert into public.alert (tenant_id, kind, entity_type, entity_id, business_date, severity, audience_roles,
                          cost_bearing, payload)
  values ('11111111-1111-4111-8111-111111111111', 'test_alert', 'tenant',
          '11111111-1111-4111-8111-111111111111', '2026-11-02', 'info', '{owner}', false, '{}');

-- M5 stock ledger: a lot (chef-readable, no cost) and its receipt movement (owner/admin only).
insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id,
                            received_on, qty_received, base_unit, source_qty, source_unit,
                            base_factor, created_by)
  values ('10700000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111',
          '1a000000-0000-4000-8000-00000000001a', (select id from public.location limit 1),
          '5a000000-0000-4000-8000-00000000005a', 'a2000000-0000-4000-8000-0000000000a1',
          '2026-09-29', 2, 'kg', 2, 'kg', 1, (select id from public.app_user limit 1));
insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty,
                                   unit_cost, ref_type, ref_id, effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-00000000001a',
          '10700000-0000-4000-8000-0000000000a1', (select id from public.location limit 1),
          'receipt', 2, 12.75, 'invoice_line', 'a2000000-0000-4000-8000-0000000000a1',
          '2026-09-29', (select id from public.app_user limit 1));

-- M5 price history and payable (owner/admin only).
insert into public.price_history (tenant_id, ingredient_id, supplier_id, supplier_item_id,
                                  invoice_line_id, unit_price, base_unit, effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-00000000001a',
          '5a000000-0000-4000-8000-00000000005a', '51000000-0000-4000-8000-000000000051',
          'a2000000-0000-4000-8000-0000000000a1', 12.75, 'kg', '2026-09-29',
          (select id from public.app_user limit 1));
insert into public.payable (tenant_id, invoice_id, supplier_id, gross_amount, credited_amount, amount,
                            due_date, due_date_source, created_by)
  values ('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-0000000000e1',
          '5a000000-0000-4000-8000-00000000005a', 28.05, 0, 28.05, '2026-10-29', 'supplier_terms',
          (select id from public.app_user limit 1));

-- Every public table must have a fixture row, so a new table cannot slip past this test.
select is_empty(
  $$ select t.tablename::text from pg_tables t
      where t.schemaname = 'public'
        and (xpath('/row/c/text()',
               query_to_xml(format('select count(*) as c from public.%I', t.tablename),
                            false, true, '')))[1]::text::int = 0 $$,
  'every public table has a fixture row (extend the fixture when adding a table)');

create temporary table waiter_visible_column (relation text, column_name text);
grant insert on waiter_visible_column to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', 'c0000000-0000-4000-8000-00000000000c', 'role', 'authenticated',
  'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'waiter')::text, true);

do $$
declare
  rel record;
  visible_rows bigint;
begin
  for rel in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p', 'v', 'm')
       and has_table_privilege('authenticated', c.oid, 'select')
  loop
    execute format('select count(*) from public.%I', rel.relname) into visible_rows;
    if visible_rows > 0 then
      insert into waiter_visible_column
        select rel.relname, a.attname
          from pg_attribute a
         where a.attrelid = format('public.%I', rel.relname)::regclass
           and a.attnum > 0 and not a.attisdropped
           and has_column_privilege('authenticated', a.attrelid, a.attnum, 'select');
    end if;
  end loop;
end
$$;

reset role;

select isnt_empty(
  $$ select 1 from waiter_visible_column $$,
  'the fixture makes some rows visible to the waiter (the test is not vacuous)');

select is_empty(
  $$ select relation || '.' || column_name
       from waiter_visible_column
      where column_name ~* '(cost|margin|unit_price|total_cost|price_history|gp_pct|last_price)' $$,
  'no waiter-readable column has a cost-like name');

select * from finish();
rollback;
