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
--   inv6 (2026-09-29, number FT 6, supplier A, one mapped 1 kg line of X at 10,00, approvable) and inv7
--     (extracting, claim token 7c000000-..., the same document as inv6): extraction_complete of inv7
--     finds inv6 as its original, so its update of duplicate_of needs a KEY SHARE lock on inv6's row
--     while it holds the duplicate advisory lock (case approve-vs-extraction, set-supplier-vs-extraction).
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

insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id,
    supplier_vat, supplier_name, number_raw, invoice_date, due_date, net_total, vat_total, gross_total)
  values
  ('00000000-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/00000000-0000-4000-8000-000000000006.pdf',
   'application/pdf', 100, 'review', '5a000000-0000-4000-8000-00000000005a',
   'IT12345678903', 'Fornitore Demo Srl', 'FT 6', '2026-09-29', '2026-10-31', 10, 1, 11);
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, attempts,
    extraction_started_at, claim_token)
  values
  ('00000000-0000-4000-8000-000000000007', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/00000000-0000-4000-8000-000000000007.pdf',
   'application/pdf', 100, 'extracting', 1, now(), '7c000000-0000-4000-8000-00000000007c');
insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_raw,
    unit_price, line_amount, vat_rate, unit, suggested_unit, ingredient_id, supplier_item_id,
    mapping_source, field_confidence, extracted)
  values ('a2000000-0000-4000-8000-0000000006a1', '11111111-1111-4111-8111-111111111111',
          '00000000-0000-4000-8000-000000000006', 1, 'Vitello', 1, 'kg', 10, 10, 10, 'kg', 'kg',
          '1c000000-0000-4000-8000-00000000001c', '58000000-0000-4000-8000-000000000058', 'manual', '{}',
          '{"qty":1,"unit_price":10,"line_amount":10,"vat_rate":10}');

--   inv8, inv9 (no VAT, same name and number, in review) warn of each other: two owners clearing them at
--     once declare the same pair from both sides (case clear-vs-clear).
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_name,
    number_raw, invoice_date)
  values
  ('00000000-0000-4000-8000-000000000008', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/00000000-0000-4000-8000-000000000008.pdf',
   'application/pdf', 100, 'review', 'Trattoria Demo', 'FT 8', '2026-09-29'),
  ('00000000-0000-4000-8000-000000000009', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/00000000-0000-4000-8000-000000000009.pdf',
   'application/pdf', 100, 'review', 'Trattoria Demo', 'FT 8', '2026-09-29');
update public.invoice set duplicate_warning_of = '00000000-0000-4000-8000-000000000009'
 where id = '00000000-0000-4000-8000-000000000008';
update public.invoice set duplicate_warning_of = '00000000-0000-4000-8000-000000000008'
 where id = '00000000-0000-4000-8000-000000000009';

--   inv10 (X), inv11 (Y), inv12 (W): no VAT, one name and number (FT 10), in review; Y and W warn of X, the
--     repro of review round 3 (case clear-repoint).
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_name,
    number_raw, invoice_date)
  values
  ('00000000-0000-4000-8000-000000000010', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/00000000-0000-4000-8000-000000000010.pdf',
   'application/pdf', 100, 'review', 'Trattoria Demo', 'FT 10', '2026-09-29'),
  ('00000000-0000-4000-8000-000000000011', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/00000000-0000-4000-8000-000000000011.pdf',
   'application/pdf', 100, 'review', 'Trattoria Demo', 'FT 10', '2026-09-29'),
  ('00000000-0000-4000-8000-000000000012', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/00000000-0000-4000-8000-000000000012.pdf',
   'application/pdf', 100, 'review', 'Trattoria Demo', 'FT 10', '2026-09-29');
update public.invoice set duplicate_warning_of = '00000000-0000-4000-8000-000000000010'
 where id in ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000012');

--   inv13 (X), inv14 (Y), inv15 (W): no VAT, one name and number (FT 13), in review; Y and W warn of X (case
--     clear-same-partner: the same clear twice must not declare Y against W).
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_name,
    number_raw, invoice_date)
  values
  ('00000000-0000-4000-8000-000000000013', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/00000000-0000-4000-8000-000000000013.pdf',
   'application/pdf', 100, 'review', 'Trattoria Demo', 'FT 13', '2026-09-29'),
  ('00000000-0000-4000-8000-000000000014', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/00000000-0000-4000-8000-000000000014.pdf',
   'application/pdf', 100, 'review', 'Trattoria Demo', 'FT 13', '2026-09-29'),
  ('00000000-0000-4000-8000-000000000015', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/00000000-0000-4000-8000-000000000015.pdf',
   'application/pdf', 100, 'review', 'Trattoria Demo', 'FT 13', '2026-09-29');
update public.invoice set duplicate_warning_of = '00000000-0000-4000-8000-000000000013'
 where id in ('00000000-0000-4000-8000-000000000014', '00000000-0000-4000-8000-000000000015');

--   M6 alerts: a chef (auth c0..0c, app_user c1..0c) in the same tenant, and a kitchen test alert
--     (a1e..a1, audience owner and chef, not acknowledged) for the case ack-twice.
insert into auth.users (id, email) values ('c0000000-0000-4000-8000-00000000000c', 'chef@example.test');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef');
insert into public.alert (id, tenant_id, kind, entity_type, entity_id, business_date, severity, audience_roles,
    cost_bearing, payload)
  values ('a1e00000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'test_alert_kitchen',
          'tenant', '11111111-1111-4111-8111-111111111111', '2026-11-02', 'info', '{owner,chef}', false, '{}');

--   M7 recipes: an admin (auth f0..0f, app_user f1..0f); the stew batch (key ec..e01, v1: 6 kg, 30 portions,
--     72 h, 5 kg of Manzo) for the cases version-twice and import-vs-version; two sub-recipes, Sub A (key
--     ec..e0a) and Sub B (key ec..e0b), each v1 with 1 kg of Sedano, for cycle-crossed; and an ingredient
--     "Pepe (demo)" (1e..1e) with the declared list {glutine} for confirm-then-import.
insert into auth.users (id, email) values ('f0000000-0000-4000-8000-00000000000f', 'admin@example.test');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111',
   'f0000000-0000-4000-8000-00000000000f', 'admin', 'Supporto Demo');
insert into public.ingredient (id, tenant_id, name, base_unit, allergens) values
  ('1e000000-0000-4000-8000-00000000001e', '11111111-1111-4111-8111-111111111111', 'Pepe (demo)', 'kg', '{glutine}');
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-000000000e01', '11111111-1111-4111-8111-111111111111', 'batch', 1,
   'spezzatino (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-000000000e0a', '11111111-1111-4111-8111-111111111111', 'sub', 1,
   'sub a (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-000000000e0b', '11111111-1111-4111-8111-111111111111', 'sub', 1,
   'sub b (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit,
    portions_per_batch, shelf_life_hours, prep_time_min, min_portions, target_portions, created_by) values
  ('ed000000-0000-4000-8000-000000000d01', '11111111-1111-4111-8111-111111111111',
   'ec000000-0000-4000-8000-000000000e01', 1, now(), 'Spezzatino (demo)', 6, 'kg', 30, 72, 180, 5, 30,
   'a1000000-0000-4000-8000-00000000000a'),
  ('ed000000-0000-4000-8000-000000000d0a', '11111111-1111-4111-8111-111111111111',
   'ec000000-0000-4000-8000-000000000e0a', 1, now(), 'Sub A (demo)', 1, 'kg', null, null, null, null, null,
   'a1000000-0000-4000-8000-00000000000a'),
  ('ed000000-0000-4000-8000-000000000d0b', '11111111-1111-4111-8111-111111111111',
   'ec000000-0000-4000-8000-000000000e0b', 1, now(), 'Sub B (demo)', 1, 'kg', null, null, null, null, null,
   'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, qty, unit, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-000000000d01', 1,
   '1a000000-0000-4000-8000-00000000001a', 5, 'kg', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-000000000d0a', 1,
   '1d000000-0000-4000-8000-00000000001d', 1, 'kg', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-000000000d0b', 1,
   '1d000000-0000-4000-8000-00000000001d', 1, 'kg', 'a1000000-0000-4000-8000-00000000000a');

--   M8 price variance (cases variance-twice, approve-vs-version, version-after-approve). One fake ingredient
--     per case, so the cases never share a baseline; each has three earlier purchases at 10,00 EUR/kg
--     (2026-09-01 to 03, price rows on a fake invoice f1) and its invoices dated 2026-10-10:
--       "Manzo (demo)" (1f..b01): items MZD-1 and MZD-2 (two items of one ingredient, so only the ingredient
--         cost lock stands between two approvals); inv20 maps MZD-1, inv21 maps MZD-2, each 2 kg at 11,20;
--       "Vitello (demo)" (1f..b02): inv22 2 kg at 11,10; plate P (key ec..e11) = 1 kg of "Sale (demo)"
--         (1f..b04, 2,00), price 11,00, target 70, without veal;
--       "Agnello (demo)" (1f..b03): inv23 2 kg at 11,10; plate Q (key ec..e12), like P, without lamb.
insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('1f000000-0000-4000-8000-000000000b01', '11111111-1111-4111-8111-111111111111', 'Manzo (demo)', 'kg'),
  ('1f000000-0000-4000-8000-000000000b02', '11111111-1111-4111-8111-111111111111', 'Vitello (demo)', 'kg'),
  ('1f000000-0000-4000-8000-000000000b03', '11111111-1111-4111-8111-111111111111', 'Agnello (demo)', 'kg'),
  ('1f000000-0000-4000-8000-000000000b04', '11111111-1111-4111-8111-111111111111', 'Sale (demo)', 'kg');
insert into public.supplier_item
    (id, tenant_id, supplier_id, ingredient_id, supplier_code, pack_qty, pack_unit, invoice_unit)
  values
  ('5d000000-0000-4000-8000-000000000b01', '11111111-1111-4111-8111-111111111111',
   '5a000000-0000-4000-8000-00000000005a', '1f000000-0000-4000-8000-000000000b01', 'MZD-1', 1, 'kg', 'kg'),
  ('5d000000-0000-4000-8000-000000000b11', '11111111-1111-4111-8111-111111111111',
   '5a000000-0000-4000-8000-00000000005a', '1f000000-0000-4000-8000-000000000b01', 'MZD-2', 1, 'kg', 'kg'),
  ('5d000000-0000-4000-8000-000000000b02', '11111111-1111-4111-8111-111111111111',
   '5a000000-0000-4000-8000-00000000005a', '1f000000-0000-4000-8000-000000000b02', 'VTD-1', 1, 'kg', 'kg'),
  ('5d000000-0000-4000-8000-000000000b03', '11111111-1111-4111-8111-111111111111',
   '5a000000-0000-4000-8000-00000000005a', '1f000000-0000-4000-8000-000000000b03', 'AGD-1', 1, 'kg', 'kg');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id)
  values ('00000000-0000-4000-8000-0000000000f1', '11111111-1111-4111-8111-111111111111',
          '11111111-1111-4111-8111-111111111111/2026/00000000-0000-4000-8000-0000000000f1.pdf',
          'application/pdf', 100, 'review', '5a000000-0000-4000-8000-00000000005a');
insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price,
    line_amount, field_confidence, extracted)
  select ('b2000000-0000-4000-8000-' || lpad((i * 10 + d)::text, 12, '0'))::uuid,
         '11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-0000000000f1', i * 10 + d,
         'Acquisto demo', 1, case when i = 4 then 2 else 10 end, case when i = 4 then 2 else 10 end, '{}', '{}'
    from generate_series(1, 4) i, generate_series(1, 3) d where i < 4 or d = 1;
insert into public.price_history (tenant_id, ingredient_id, supplier_id, invoice_line_id, unit_price, base_unit,
    effective_on, created_by)
  select '11111111-1111-4111-8111-111111111111', ('1f000000-0000-4000-8000-000000000b0' || i)::uuid,
         '5a000000-0000-4000-8000-00000000005a',
         ('b2000000-0000-4000-8000-' || lpad((i * 10 + d)::text, 12, '0'))::uuid,
         case when i = 4 then 2 else 10 end, 'kg', ('2026-09-0' || d)::date, 'a1000000-0000-4000-8000-00000000000a'
    from generate_series(1, 4) i, generate_series(1, 3) d where i < 4 or d = 1;
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id,
    supplier_vat, supplier_name, number_raw, invoice_date, due_date, net_total, vat_total, gross_total)
  select ('00000000-0000-4000-8000-0000000000' || n)::uuid, '11111111-1111-4111-8111-111111111111',
         '11111111-1111-4111-8111-111111111111/2026/00000000-0000-4000-8000-0000000000' || n || '.pdf',
         'application/pdf', 100, 'review', '5a000000-0000-4000-8000-00000000005a', 'IT12345678903',
         'Fornitore Demo Srl', 'FT ' || n, '2026-10-10', '2026-12-31', 2 * price, round(2 * price * 0.1, 2),
         2 * price + round(2 * price * 0.1, 2)
    from (values ('20', 11.20), ('21', 11.20), ('22', 11.10), ('23', 11.10)) v (n, price);
insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_raw,
    unit_price, line_amount, vat_rate, unit, suggested_unit, ingredient_id, supplier_item_id,
    mapping_source, field_confidence, extracted)
  select v.id::uuid, '11111111-1111-4111-8111-111111111111', ('00000000-0000-4000-8000-0000000000' || v.inv)::uuid,
         1, v.descr, 2, 'kg', v.price, 2 * v.price, 10, 'kg', 'kg', v.ing::uuid, v.item::uuid, 'manual', '{}',
         jsonb_build_object('qty', 2, 'unit_price', v.price, 'line_amount', 2 * v.price, 'vat_rate', 10)
    from (values
      ('a2000000-0000-4000-8000-0000000020a1', '20', 'Manzo', 11.20, '1f000000-0000-4000-8000-000000000b01', '5d000000-0000-4000-8000-000000000b01'),
      ('a2000000-0000-4000-8000-0000000021a1', '21', 'Manzo', 11.20, '1f000000-0000-4000-8000-000000000b01', '5d000000-0000-4000-8000-000000000b11'),
      ('a2000000-0000-4000-8000-0000000022a1', '22', 'Vitello', 11.10, '1f000000-0000-4000-8000-000000000b02', '5d000000-0000-4000-8000-000000000b02'),
      ('a2000000-0000-4000-8000-0000000023a1', '23', 'Agnello', 11.10, '1f000000-0000-4000-8000-000000000b03', '5d000000-0000-4000-8000-000000000b03')
    ) as v(id, inv, descr, price, ing, item);
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-000000000e11', '11111111-1111-4111-8111-111111111111', 'plate', 1,
   'piatto p (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-000000000e12', '11111111-1111-4111-8111-111111111111', 'plate', 1,
   'piatto q (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by) values
  ('ed000000-0000-4000-8000-000000000d11', '11111111-1111-4111-8111-111111111111',
   'ec000000-0000-4000-8000-000000000e11', 1, now(), 'Piatto P (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ed000000-0000-4000-8000-000000000d12', '11111111-1111-4111-8111-111111111111',
   'ec000000-0000-4000-8000-000000000e12', 1, now(), 'Piatto Q (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, qty, unit, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-000000000d11', 1,
   '1f000000-0000-4000-8000-000000000b04', 1, 'kg', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-000000000d12', 1,
   '1f000000-0000-4000-8000-000000000b04', 1, 'kg', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe_price (recipe_id, tenant_id, sale_price, target_gp_pct, created_by) values
  ('ed000000-0000-4000-8000-000000000d11', '11111111-1111-4111-8111-111111111111', 11, 70, 'a1000000-0000-4000-8000-00000000000a'),
  ('ed000000-0000-4000-8000-000000000d12', '11111111-1111-4111-8111-111111111111', 11, 70, 'a1000000-0000-4000-8000-00000000000a');

-- M11 (staff PIN login, step 10): pin waiter W, devices D1 and D2, and an unused enrolment code C.
--   pin-same-user:    two pin_login_begin calls for W, from D1 and from D2.
--   redeem-twice:     two redemptions of code C.
--   finish-vs-revoke: pin_login_finish(success) on D1 against revoke_device(D1).
insert into auth.users (id, email) values
  ('90000000-0000-4000-8000-000000000f01', 'staff-91000000-0000-4000-8000-000000000f01@staff.invalid');
insert into public.app_user (id, tenant_id, auth_id, role, display_name, login_method) values
  ('91000000-0000-4000-8000-000000000f01', '11111111-1111-4111-8111-111111111111',
   '90000000-0000-4000-8000-000000000f01', 'waiter', 'Cameriere Demo', 'pin');
insert into public.venue_device (id, tenant_id, label, token_hash, created_by) values
  ('d0000000-0000-4000-8000-000000000f01', '11111111-1111-4111-8111-111111111111', 'Telefono sala (demo)',
   repeat('1', 64), 'a1000000-0000-4000-8000-00000000000a'),
  ('d0000000-0000-4000-8000-000000000f02', '11111111-1111-4111-8111-111111111111', 'Tablet cucina (demo)',
   repeat('2', 64), 'a1000000-0000-4000-8000-00000000000a');
insert into public.device_enrolment (id, tenant_id, label, code_hash, expires_at, created_by) values
  ('e0000000-0000-4000-8000-000000000f01', '11111111-1111-4111-8111-111111111111', 'Telefono bar (demo)',
   repeat('c', 64), now() + interval '1 day', 'a1000000-0000-4000-8000-00000000000a');

create schema race;
create table race.gate (open boolean not null);
-- What a session saw, for the script to read back (label, value).
create table race.result (label text not null, value text not null);
grant usage on schema race to authenticated, service_role;
grant select on race.gate to authenticated, service_role;
grant select, insert on race.result to authenticated;
