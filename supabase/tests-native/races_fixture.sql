-- Fixture for scripts/test-db-races.sh (two-session tests of the invoice lock in
-- app.automap_lines, migration 20261022131000). Fake data only, one tenant.
--   inv1, inv2: in review, supplier A, one unmapped stock line each with code MAN-1;
--   item MAN-1: supplier A's remembered article for that code (propagation maps it);
--   supplier B: the other supplier a relink moves inv2 to.
-- race.gate holds the first session open until the script lets it commit.
insert into auth.users (id, email) values ('a0000000-0000-4000-8000-00000000000a', 'owner@example.test');
insert into public.tenant (id, name, vat_number)
  values ('11111111-1111-4111-8111-111111111111', 'Demo Race', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Owner');
insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('1a000000-0000-4000-8000-00000000001a', '11111111-1111-4111-8111-111111111111', 'Manzo', 'kg');
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111',
   'Fornitore Demo Srl', 'IT12345678903'),
  ('5b000000-0000-4000-8000-00000000005b', '11111111-1111-4111-8111-111111111111',
   'Altro Demo Srl', 'IT01234567897');
insert into public.supplier_item
    (id, tenant_id, supplier_id, ingredient_id, supplier_code, pack_qty, pack_unit, invoice_unit)
  values ('54000000-0000-4000-8000-000000000054', '11111111-1111-4111-8111-111111111111',
          '5a000000-0000-4000-8000-00000000005a', '1a000000-0000-4000-8000-00000000001a',
          'MAN-1', 1, 'kg', 'kg');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id) values
  ('00000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/00000000-0000-4000-8000-000000000001.pdf',
   'application/pdf', 100, 'review', '5a000000-0000-4000-8000-00000000005a'),
  ('00000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/00000000-0000-4000-8000-000000000002.pdf',
   'application/pdf', 100, 'review', '5a000000-0000-4000-8000-00000000005a');
insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, supplier_code,
    qty, unit_raw, unit_price, line_amount, vat_rate, unit, suggested_unit, field_confidence, extracted)
  values
  ('a2000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   '00000000-0000-4000-8000-000000000001', 1, 'Manzo fesa', 'MAN-1', 2, 'kg', 12.75, 25.5, 10,
   'kg', 'kg', '{}',
   '{"qty":2,"unit_price":12.75,"line_amount":25.5,"vat_rate":10,"supplier_code":"MAN-1"}'),
  ('a2000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
   '00000000-0000-4000-8000-000000000002', 1, 'Manzo fesa', 'MAN-1', 2, 'kg', 12.75, 25.5, 10,
   'kg', 'kg', '{}',
   '{"qty":2,"unit_price":12.75,"line_amount":25.5,"vat_rate":10,"supplier_code":"MAN-1"}');

create schema race;
create table race.gate (open boolean not null);
grant usage on schema race to authenticated;
grant select on race.gate to authenticated;
