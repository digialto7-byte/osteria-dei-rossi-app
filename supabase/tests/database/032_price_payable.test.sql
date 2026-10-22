-- M5 step 3: price_history and payable (M5 plan §3.3, §3.5). Checks and keys, the payable guard,
-- and RLS: owner and admin read; chef, waiter and the other tenant read nothing (both tables
-- carry money); nobody writes through the API.
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

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
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare A'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'chef', 'Cuoco A'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111',
   'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere A'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111',
   'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin DigiAlto');

insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('1a000000-0000-4000-8000-00000000001a', '11111111-1111-4111-8111-111111111111', 'Manzo', 'kg'),
  ('1b000000-0000-4000-8000-00000000001b', '22222222-2222-4222-8222-222222222222', 'Pollo B', 'kg');
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111',
   'Fornitore Demo Srl', 'IT12345678903'),
  ('5b000000-0000-4000-8000-00000000005b', '22222222-2222-4222-8222-222222222222',
   'Fornitore B Srl', 'IT00000000000');
insert into public.supplier_item (id, tenant_id, supplier_id, ingredient_id, supplier_code, pack_qty,
                                  pack_unit)
  values ('51000000-0000-4000-8000-000000000051', '11111111-1111-4111-8111-111111111111',
          '5a000000-0000-4000-8000-00000000005a', '1a000000-0000-4000-8000-00000000001a',
          'MAN-1', 1, 'kg');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, original_filename)
  values ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
          '11111111-1111-4111-8111-111111111111/2026/e1000000-0000-4000-8000-0000000000e1.pdf',
          'application/pdf', 2048, 'fattura.pdf'),
         ('e2000000-0000-4000-8000-0000000000e2', '11111111-1111-4111-8111-111111111111',
          '11111111-1111-4111-8111-111111111111/2026/e2000000-0000-4000-8000-0000000000e2.pdf',
          'application/pdf', 2048, 'fattura2.pdf');
insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty,
                                 unit_price, line_amount, field_confidence, extracted) values
  ('a2000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111',
   'e1000000-0000-4000-8000-0000000000e1', 1, 'Manzo fesa', 2, 12.75, 25.5, '{}', '{}'),
  ('a2000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111',
   'e1000000-0000-4000-8000-0000000000e1', 2, 'Manzo girello', 3.5, 11, 38.5, '{}', '{}'),
  ('a2000000-0000-4000-8000-0000000000a3', '11111111-1111-4111-8111-111111111111',
   'e1000000-0000-4000-8000-0000000000e1', 3, 'Manzo macinato', 1, 9, 9, '{}', '{}');

-- Fixture (as the migration owner): two price rows in insert order, one payable for invoice 1.
insert into public.price_history (id, tenant_id, ingredient_id, supplier_id, supplier_item_id,
                                  invoice_line_id, unit_price, base_unit, effective_on, created_by)
  values ('90000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111',
          '1a000000-0000-4000-8000-00000000001a', '5a000000-0000-4000-8000-00000000005a',
          '51000000-0000-4000-8000-000000000051', 'a2000000-0000-4000-8000-0000000000a1', 12.75,
          'kg', '2026-09-29', 'a1000000-0000-4000-8000-00000000000a');
insert into public.price_history (id, tenant_id, ingredient_id, supplier_id, invoice_line_id,
                                  unit_price, base_unit, effective_on, created_by)
  values ('90000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111',
          '1a000000-0000-4000-8000-00000000001a', '5a000000-0000-4000-8000-00000000005a',
          'a2000000-0000-4000-8000-0000000000a2', 11, 'kg', '2026-09-29',
          'a1000000-0000-4000-8000-00000000000a');
insert into public.payable (id, tenant_id, invoice_id, supplier_id, gross_amount, credited_amount,
                            amount, due_date, due_date_source, created_by)
  values ('90100000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111',
          'e1000000-0000-4000-8000-0000000000e1', '5a000000-0000-4000-8000-00000000005a', 70.4,
          5.5, 64.9, '2026-10-29', 'supplier_terms', 'a1000000-0000-4000-8000-00000000000a');

create function pg_temp.price(unit_price numeric, line uuid, supplier uuid, created_by uuid)
  returns void language sql as $$
  insert into public.price_history (tenant_id, ingredient_id, supplier_id, invoice_line_id,
                                    unit_price, base_unit, effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-00000000001a', supplier,
          line, unit_price, 'kg', '2026-09-29', created_by)
$$;
create function pg_temp.payable(gross numeric, credited numeric, amount numeric, status text,
                                paid_at timestamptz, invoice uuid) returns void
  language sql as $$
  insert into public.payable (tenant_id, invoice_id, supplier_id, gross_amount, credited_amount,
                              amount, due_date, due_date_source, status, paid_at, created_by)
  values ('11111111-1111-4111-8111-111111111111', invoice, '5a000000-0000-4000-8000-00000000005a',
          gross, credited, amount, '2026-10-29', 'invoice', status::public.payable_status, paid_at,
          'a1000000-0000-4000-8000-00000000000a')
$$;

-- price_history checks.
select throws_ok($$ select pg_temp.price(-0.01, 'a2000000-0000-4000-8000-0000000000a3',
  '5a000000-0000-4000-8000-00000000005a', 'a1000000-0000-4000-8000-00000000000a') $$,
  '23514', null, 'a negative price is refused');
select throws_ok($$ select pg_temp.price(1, 'a2000000-0000-4000-8000-0000000000a1',
  '5a000000-0000-4000-8000-00000000005a', 'a1000000-0000-4000-8000-00000000000a') $$,
  '23505', null, 'a second price row for the same invoice line is refused');
select throws_ok($$ select pg_temp.price(1, 'a2000000-0000-4000-8000-0000000000a3',
  '5b000000-0000-4000-8000-00000000005b', 'a1000000-0000-4000-8000-00000000000a') $$,
  '23503', null, 'tenant B''s supplier on a tenant A price row is refused');
select throws_ok($$ select pg_temp.price(1, 'a2000000-0000-4000-8000-0000000000a3',
  '5a000000-0000-4000-8000-00000000005a', null) $$,
  '23502', null, 'created_by is required on a price row');
select lives_ok($$ select pg_temp.price(0, 'a2000000-0000-4000-8000-0000000000a3',
  '5a000000-0000-4000-8000-00000000005a', 'a1000000-0000-4000-8000-00000000000a') $$,
  'a price of 0 is accepted');
select cmp_ok((select seq from public.price_history where id = '90000000-0000-4000-8000-0000000000a2'),
  '>', (select seq from public.price_history where id = '90000000-0000-4000-8000-0000000000a1'),
  'seq increases in insert order');
select cmp_ok((select max(seq) from public.price_history
                where invoice_line_id = 'a2000000-0000-4000-8000-0000000000a3'),
  '>', (select seq from public.price_history where id = '90000000-0000-4000-8000-0000000000a2'),
  'the next row gets a larger seq again');

-- payable checks.
select throws_ok($$ select pg_temp.payable(100, 10, 91, 'open', null,
  'e2000000-0000-4000-8000-0000000000e2') $$, '23514', null,
  'amount different from gross - credited is refused');
select throws_ok($$ select pg_temp.payable(100, 10, 90, 'paid', null,
  'e2000000-0000-4000-8000-0000000000e2') $$, '23514', null,
  'status paid without paid_at is refused');
select throws_ok($$ select pg_temp.payable(100, 10, 90, 'open', now(),
  'e2000000-0000-4000-8000-0000000000e2') $$, '23514', null,
  'paid_at on an open payable is refused');
select throws_ok($$ select pg_temp.payable(10, 20, -10, 'open', null,
  'e2000000-0000-4000-8000-0000000000e2') $$, '23514', null, 'a negative amount is refused');
select throws_ok($$ select pg_temp.payable(100, 0, 100, 'open', null,
  'e1000000-0000-4000-8000-0000000000e1') $$, '23505', null,
  'a second payable for one invoice is refused');
select throws_ok($$ select pg_temp.payable(100, 0, 100, 'open', null,
  'e9000000-0000-4000-8000-0000000000e9') $$, '23503', null, 'an unknown invoice is refused');
select lives_ok($$ select pg_temp.payable(100, 10, 90, 'open', null,
  'e2000000-0000-4000-8000-0000000000e2') $$, 'a consistent payable is accepted');

-- The guard (as the migration owner): money and identity never change; status may.
select throws_ok($$ update public.payable set amount = 1, credited_amount = 69.4
  where id = '90100000-0000-4000-8000-0000000000a1' $$, 'P0001', 'payable_immutable',
  'UPDATE of amount raises payable_immutable');
select throws_ok($$ update public.payable set invoice_id = 'e2000000-0000-4000-8000-0000000000e2'
  where id = '90100000-0000-4000-8000-0000000000a1' $$, 'P0001', 'payable_immutable',
  'UPDATE of invoice_id raises payable_immutable');
select throws_ok($$ update public.payable set due_date_source = 'invoice'
  where id = '90100000-0000-4000-8000-0000000000a1' $$, 'P0001', 'payable_immutable',
  'UPDATE of due_date_source raises payable_immutable');
select lives_ok($$ update public.payable set status = 'scheduled'
  where id = '90100000-0000-4000-8000-0000000000a1' $$,
  'UPDATE of status to scheduled is allowed (M9 column)');

create function pg_temp.act_as(auth_id uuid, app_role text, tenant uuid) returns void
  language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated',
    'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
grant execute on function pg_temp.act_as(uuid, text, uuid) to authenticated;

set local role authenticated;

select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', 'owner',
  '11111111-1111-4111-8111-111111111111');
select is((select count(*)::int from public.price_history), 3, 'owner A reads A''s price rows');
select is((select count(*)::int from public.payable), 2, 'owner A reads A''s payables');
select throws_ok($$ update public.payable set status = 'paid' $$, '42501', null,
  'authenticated cannot update a payable');
select throws_ok($$ insert into public.price_history (unit_price) values (1) $$, '42501', null,
  'authenticated cannot insert a price row');

select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', 'admin',
  '11111111-1111-4111-8111-111111111111');
select is((select count(*)::int from public.price_history), 3, 'admin A reads A''s price rows');

select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', 'chef',
  '11111111-1111-4111-8111-111111111111');
select is((select count(*)::int from public.price_history) + (select count(*)::int from public.payable),
  0, 'chef A reads no prices and no payables');

select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', 'waiter',
  '11111111-1111-4111-8111-111111111111');
select is((select count(*)::int from public.price_history) + (select count(*)::int from public.payable),
  0, 'waiter A reads no prices and no payables');

select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', 'owner',
  '22222222-2222-4222-8222-222222222222');
select is((select count(*)::int from public.price_history) + (select count(*)::int from public.payable),
  0, 'owner B reads none of A''s prices and payables');

reset role;

select is(col_description('public.supplier_item'::regclass,
  (select attnum from pg_attribute where attrelid = 'public.supplier_item'::regclass
    and attname = 'last_price')) ~ 'base unit', true,
  'supplier_item.last_price is documented as EUR per ingredient base unit');

select * from finish();
rollback;
