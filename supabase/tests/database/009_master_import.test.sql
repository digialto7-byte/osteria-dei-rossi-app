-- M1 acceptance test 5 (database half): imports create, update or leave rows unchanged, match
-- suppliers by VAT number (else by name), and write nothing when any row is invalid.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test');
insert into public.tenant (id, name, vat_number)
  values ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (tenant_id, auth_id, role, display_name) values
  ('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare A'),
  ('11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Cuoco A');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
  'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'owner')::text, true);

create temporary table suppliers_file as select $json$[
  {"row": 2, "name": "Fornitore Demo Srl", "vat_number": "IT12345678903", "payment_terms_days": 30},
  {"row": 3, "name": "Caseificio Demo", "vat_number": "IT01234567897", "payment_terms_days": null},
  {"row": 4, "name": "Mercato Rionale", "vat_number": null, "payment_terms_days": null}
]$json$::jsonb as rows;

select is(public.import_suppliers((select rows from suppliers_file)),
  '{"created": 3, "updated": 0, "unchanged": 0}'::jsonb, 'first import creates every row');
select is(public.import_suppliers((select rows from suppliers_file)),
  '{"created": 0, "updated": 0, "unchanged": 3}'::jsonb, 'the same file again changes nothing');
select is(public.import_suppliers($json$[
  {"row": 2, "name": "Fornitore Demo S.r.l.", "vat_number": "IT12345678903", "payment_terms_days": 30},
  {"row": 3, "name": " mercato  rionale ", "vat_number": null, "payment_terms_days": 15}
]$json$::jsonb), '{"created": 0, "updated": 2, "unchanged": 0}'::jsonb,
  'a changed field updates; a supplier without VAT matches by normalised name');
select is((select name from public.supplier where vat_number = 'IT12345678903'),
  'Fornitore Demo S.r.l.', 'matched by VAT number, so the new name is stored');

insert into public.supplier (name) values ('Mercato Rionale');
select throws_ok($$ select public.import_suppliers('[{"row": 7, "name": "Mercato Rionale",
    "vat_number": null, "payment_terms_days": null}]'::jsonb) $$,
  'P0001', 'ambiguous_match', 'two suppliers without VAT sharing the name are ambiguous');

select throws_ok($$ select public.import_suppliers('[
    {"row": 2, "name": "Nuovo", "vat_number": "IT11111111115", "payment_terms_days": null},
    {"row": 3, "name": "Rotto", "vat_number": "IT12345678901", "payment_terms_days": null}]'::jsonb) $$,
  '23514', null, 'an invalid VAT number fails the whole import');
select is((select count(*)::int from public.supplier where vat_number = 'IT11111111115'), 0,
  'nothing from a failed import is written');

select is(public.import_ingredients($json$[
  {"row": 2, "name": "Farina 00", "base_unit": "kg", "category": "Secco", "is_stock": true,
   "allergens": ["glutine"], "default_shelf_life_days": 180},
  {"row": 3, "name": "Uova", "base_unit": "pz", "category": null, "is_stock": true,
   "allergens": ["uova"], "default_shelf_life_days": 21}
]$json$::jsonb), '{"created": 2, "updated": 0, "unchanged": 0}'::jsonb, 'ingredients import');
select is(public.import_ingredients($json$[
  {"row": 2, "name": "farina 00", "base_unit": "kg", "category": "Secco", "is_stock": true,
   "allergens": ["glutine"], "default_shelf_life_days": 180}
]$json$::jsonb), '{"created": 0, "updated": 0, "unchanged": 1}'::jsonb,
  'ingredients match by normalised name');
select is(public.import_ingredients($json$[
  {"row": 2, "name": "Farina 00", "base_unit": "kg", "category": "Farine", "is_stock": true,
   "allergens": ["glutine"], "default_shelf_life_days": 180}
]$json$::jsonb), '{"created": 0, "updated": 1, "unchanged": 0}'::jsonb, 'a changed category updates');
-- Several allergens, given in an order that differs from the enum's: still idempotent.
select is(public.import_ingredients($json$[
  {"row": 2, "name": "Maionese", "base_unit": "kg", "category": null, "is_stock": true,
   "allergens": ["uova", "arachidi", "senape"], "default_shelf_life_days": null}
]$json$::jsonb), '{"created": 1, "updated": 0, "unchanged": 0}'::jsonb, 'ingredient with three allergens');
select is(public.import_ingredients($json$[
  {"row": 2, "name": "Maionese", "base_unit": "kg", "category": null, "is_stock": true,
   "allergens": ["arachidi", "senape", "uova"], "default_shelf_life_days": null}
]$json$::jsonb), '{"created": 0, "updated": 0, "unchanged": 1}'::jsonb,
  'the same allergens in another order are unchanged');
select throws_ok($$ select public.import_ingredients('[{"row": 5, "name": "Uova", "base_unit": "kg",
    "category": null, "is_stock": true, "allergens": [], "default_shelf_life_days": null}]'::jsonb) $$,
  'P0001', 'base_unit_conflict', 'an import cannot change an ingredient''s base unit');

select set_config('request.jwt.claims', json_build_object(
  'sub', 'c0000000-0000-4000-8000-00000000000c', 'role', 'authenticated',
  'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'chef')::text, true);
select throws_ok($$ select public.import_suppliers('[]'::jsonb) $$,
  '42501', null, 'a chef cannot import');

reset role;
select ok(not has_function_privilege('anon', 'public.import_ingredients(jsonb)', 'execute'),
  'anon cannot import');

select * from finish();
rollback;
