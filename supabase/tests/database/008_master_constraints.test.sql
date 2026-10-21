-- M1 constraints: VAT checksum and per-tenant uniqueness (acceptance test 2), positive packs
-- (acceptance test 3), unit compatibility, tenant-safe references and one preferred item.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (tenant_id, auth_id, role, display_name) values
  ('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare A'),
  ('22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B');
insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('1b000000-0000-4000-8000-00000000001b', '22222222-2222-4222-8222-222222222222', 'Manzo B', 'kg');

insert into public.supplier (id, tenant_id, name, vat_number)
  values ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111',
          'Fornitore Demo Srl', 'IT12345678903');
insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('1a000000-0000-4000-8000-00000000001a', '11111111-1111-4111-8111-111111111111', 'Farina', 'kg'),
  ('1c000000-0000-4000-8000-00000000001c', '11111111-1111-4111-8111-111111111111', 'Uova', 'pz');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
  'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'owner')::text, true);


select throws_ok($$ insert into public.supplier (name, vat_number) values ('X', 'IT12345678901') $$,
  '23514', null, 'a VAT number with a bad checksum is rejected');
select throws_ok($$ insert into public.supplier (name, vat_number) values ('Y', 'IT12345678903') $$,
  '23505', null, 'the same VAT number twice in one tenant is rejected');
select lives_ok($$ insert into public.supplier (name, vat_number) values ('Senza IVA', null) $$,
  'a supplier without a VAT number is allowed');

select throws_ok($$ insert into public.supplier_item (supplier_id, ingredient_id, supplier_code, pack_qty, pack_unit)
    values ('5a000000-0000-4000-8000-00000000005a', '1a000000-0000-4000-8000-00000000001a', 'A', 0, 'kg') $$,
  '23514', null, 'pack_qty 0 is rejected');
select throws_ok($$ insert into public.supplier_item (supplier_id, ingredient_id, supplier_code, pack_qty, pack_unit)
    values ('5a000000-0000-4000-8000-00000000005a', '1a000000-0000-4000-8000-00000000001a', 'A', -1, 'kg') $$,
  '23514', null, 'a negative pack_qty is rejected');
select throws_ok($$ insert into public.supplier_item (supplier_id, ingredient_id, supplier_code, pack_count, pack_qty, pack_unit)
    values ('5a000000-0000-4000-8000-00000000005a', '1a000000-0000-4000-8000-00000000001a', 'A', 0, 1, 'kg') $$,
  '23514', null, 'pack_count 0 is rejected');
select throws_ok($$ insert into public.supplier_item (supplier_id, ingredient_id, supplier_code, pack_qty, pack_unit)
    values ('5a000000-0000-4000-8000-00000000005a', '1c000000-0000-4000-8000-00000000001c', 'B', 1, 'kg') $$,
  '22023', 'incompatible_units', 'a kg pack for an ingredient counted in pieces is rejected');
select throws_ok($$ insert into public.supplier_item (supplier_id, ingredient_id, supplier_code, pack_qty, pack_unit)
    values ('5a000000-0000-4000-8000-00000000005a', '1b000000-0000-4000-8000-00000000001b', 'C', 1, 'kg') $$,
  '23503', null, 'an item cannot reference another tenant''s ingredient');
select throws_ok($$ insert into public.supplier_item (supplier_id, ingredient_id, pack_qty, pack_unit)
    values ('5a000000-0000-4000-8000-00000000005a', '1a000000-0000-4000-8000-00000000001a', 1, 'kg') $$,
  '23514', null, 'an item needs a supplier code or a description hash');

reset role;
insert into public.supplier_item (id, tenant_id, supplier_id, ingredient_id, supplier_code, pack_count,
                                  pack_qty, pack_unit, is_preferred)
  values ('17000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
          '5a000000-0000-4000-8000-00000000005a', '1a000000-0000-4000-8000-00000000001a', 'FAR-25',
          1, 25, 'kg', true),
         ('17000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
          '5a000000-0000-4000-8000-00000000005a', '1a000000-0000-4000-8000-00000000001a', 'FAR-10',
          10, 1, 'kg', false);
set local role authenticated;
select throws_ok($$ update public.supplier_item set is_preferred = true
                     where id = '17000000-0000-4000-8000-000000000002' $$,
  '23505', null, 'only one preferred item per ingredient');
select lives_ok($$ select public.set_preferred_supplier_item('17000000-0000-4000-8000-000000000002') $$,
  'set_preferred_supplier_item swaps the preferred item');
select is((select array_agg(supplier_code) from public.supplier_item where is_preferred),
  array['FAR-10'], 'exactly the chosen item is preferred');
select throws_ok($$ select public.set_preferred_supplier_item('99999999-0000-4000-8000-000000000000') $$,
  'P0002', null, 'an unknown or invisible item is not found');

-- Tenant B may use the same VAT number as tenant A.
select set_config('request.jwt.claims', json_build_object(
  'sub', 'b0000000-0000-4000-8000-00000000000b', 'role', 'authenticated',
  'tenant_id', '22222222-2222-4222-8222-222222222222', 'app_role', 'owner')::text, true);
select lives_ok($$ insert into public.supplier (name, vat_number) values ('Fornitore Demo Srl', 'IT12345678903') $$,
  'the same VAT number in another tenant is allowed');

reset role;
select * from finish();
rollback;
