-- Fixture for scripts/test-db-races.sh (two-session tests of the invoice lock in
-- app.automap_lines, migration 20261022131000, and of invoice approval, M5). Fake data only, one
-- tenant.
--   inv1, inv2: in review, supplier A, one unmapped stock line each with code MAN-1;
--   item MAN-1: supplier A's remembered article for that code (propagation maps it);
--   supplier B: the other supplier a relink moves inv2 to.
-- Approval (M5):
--   location "Cella"; items X (VIT-1, Vitello) and Y (SED-1, Sedano); X's id sorts before Y's;
--   inv3 (2026-09-29, later): line 3a = 2 kg of Y at 12,75 EUR, VAT 10; line 3b = 1 kg of X at 10,00;
--   inv4 (2026-09-15, earlier): line 4a = 1 kg of X at 11,00; line 4b = 1 kg of Y at 8,00
--     (the lines of inv3 and inv4 name the items in opposite order);
--   inv5: like inv3's X line but without supplier VAT, name or number, so no duplicate key: the
--     invoice row lock is the only thing that serialises two approvals of it.
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

insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella');
insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('1c000000-0000-4000-8000-00000000001c', '11111111-1111-4111-8111-111111111111', 'Vitello', 'kg'),
  ('1d000000-0000-4000-8000-00000000001d', '11111111-1111-4111-8111-111111111111', 'Sedano', 'kg');
insert into public.supplier_item
    (id, tenant_id, supplier_id, ingredient_id, supplier_code, pack_qty, pack_unit, invoice_unit)
  values ('58000000-0000-4000-8000-000000000058', '11111111-1111-4111-8111-111111111111',
          '5a000000-0000-4000-8000-00000000005a', '1c000000-0000-4000-8000-00000000001c',
          'VIT-1', 1, 'kg', 'kg'),
         ('59000000-0000-4000-8000-000000000059', '11111111-1111-4111-8111-111111111111',
          '5a000000-0000-4000-8000-00000000005a', '1d000000-0000-4000-8000-00000000001d',
          'SED-1', 1, 'kg', 'kg');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id,
    supplier_vat, supplier_name, number_raw, invoice_date, due_date, net_total, vat_total, gross_total)
  values
  ('00000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/00000000-0000-4000-8000-000000000003.pdf',
   'application/pdf', 100, 'review', '5a000000-0000-4000-8000-00000000005a',
   'IT12345678903', 'Fornitore Demo Srl', 'FT 3', '2026-09-29', '2026-10-31', 35.5, 3.55, 39.05),
  ('00000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/00000000-0000-4000-8000-000000000004.pdf',
   'application/pdf', 100, 'review', '5a000000-0000-4000-8000-00000000005a',
   'IT12345678903', 'Fornitore Demo Srl', 'FT 4', '2026-09-15', '2026-10-31', 19, 1.9, 20.9),
  ('00000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/00000000-0000-4000-8000-000000000005.pdf',
   'application/pdf', 100, 'review', '5a000000-0000-4000-8000-00000000005a',
   null, null, null, '2026-09-29', '2026-10-31', 10, 1, 11);
insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_raw,
    unit_price, line_amount, vat_rate, unit, suggested_unit, ingredient_id, supplier_item_id,
    mapping_source, field_confidence, extracted)
  select v.id, '11111111-1111-4111-8111-111111111111', v.inv, v.pos, v.descr, v.qty, 'kg', v.price,
         v.qty * v.price, 10, 'kg', 'kg', v.ing, v.item, 'manual', '{}',
         jsonb_build_object('qty', v.qty, 'unit_price', v.price, 'line_amount', v.qty * v.price,
                            'vat_rate', 10)
    from (values
      ('a2000000-0000-4000-8000-0000000003a1'::uuid, '00000000-0000-4000-8000-000000000003'::uuid, 1,
       'Sedano', 2, 12.75, '1d000000-0000-4000-8000-00000000001d'::uuid, '59000000-0000-4000-8000-000000000059'::uuid),
      ('a2000000-0000-4000-8000-0000000003b1', '00000000-0000-4000-8000-000000000003', 2,
       'Vitello', 1, 10, '1c000000-0000-4000-8000-00000000001c', '58000000-0000-4000-8000-000000000058'),
      ('a2000000-0000-4000-8000-0000000004a1', '00000000-0000-4000-8000-000000000004', 1,
       'Vitello', 1, 11, '1c000000-0000-4000-8000-00000000001c', '58000000-0000-4000-8000-000000000058'),
      ('a2000000-0000-4000-8000-0000000004b1', '00000000-0000-4000-8000-000000000004', 2,
       'Sedano', 1, 8, '1d000000-0000-4000-8000-00000000001d', '59000000-0000-4000-8000-000000000059'),
      ('a2000000-0000-4000-8000-0000000005a1', '00000000-0000-4000-8000-000000000005', 1,
       'Vitello', 1, 10, '1c000000-0000-4000-8000-00000000001c', '58000000-0000-4000-8000-000000000058')
    ) as v(id, inv, pos, descr, qty, price, ing, item);

create schema race;
create table race.gate (open boolean not null);
grant usage on schema race to authenticated;
grant select on race.gate to authenticated;
