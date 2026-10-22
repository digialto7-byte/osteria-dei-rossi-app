-- M3 data model (plan step 3): extraction columns on invoice and the invoice_line table. Role
-- matrix, tenant isolation, column checks. The worker procedures are tested in 016.
begin;
create extension if not exists pgtap with schema extensions;
select plan(45);

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

-- Invoices: a1 in tenant A, b1 in tenant B (paths follow <tenant>/<year>/<id>.pdf).
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes) values
  ('a1000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/a1000000-0000-4000-8000-0000000000a1.pdf',
   'application/pdf', 1000),
  ('b1000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222',
   '22222222-2222-4222-8222-222222222222/2026/b1000000-0000-4000-8000-0000000000b1.pdf',
   'application/pdf', 1000);

-- Schema: the extraction columns on invoice.
select columns_are('public', 'invoice', array[
  'id', 'tenant_id', 'status', 'source', 'file_path', 'file_mime', 'file_size_bytes',
  'original_filename', 'supplier_vat', 'number_raw', 'number', 'invoice_date', 'duplicate_of',
  'created_at', 'created_by', 'supplier_name', 'duplicate_warning_of', 'duplicate_override',
  'due_date', 'payment_terms', 'net_total', 'vat_total', 'gross_total', 'totals_diff',
  'gate_flags', 'field_confidence', 'extraction_json', 'extraction_model', 'attempts',
  'next_attempt_at', 'extraction_started_at', 'extracted_at', 'claim_token', 'extraction_error'
], 'invoice has the M2, founder-answers and M3 columns');
select col_default_is('public', 'invoice', 'attempts', '0', 'attempts starts at 0');
select col_not_null('public', 'invoice', 'gate_flags', 'gate_flags is not null');
select col_type_is('public', 'invoice', 'gross_total', 'numeric(12,4)', 'gross_total is numeric(12,4)');
select has_index('public', 'invoice', 'invoice_extract_queue_idx', 'the queue index exists');
select has_table('public', 'invoice_line', 'invoice_line exists');

-- Lines. a: two lines on A's invoice, one on B's invoice.
insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty,
    line_amount, field_confidence, extracted, lot_code, expiry) values
  ('a2000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111',
   'a1000000-0000-4000-8000-0000000000a1', 1, 'Manzo fesa', 2, 25.5, '{}', '{}', 'L-0425',
   '2026-11-30'),
  ('a2000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111',
   'a1000000-0000-4000-8000-0000000000a1', 2, 'Olio', 1, 8, '{}', '{}', null, null),
  ('b2000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222',
   'b1000000-0000-4000-8000-0000000000b1', 1, 'Pesce', 3, 30, '{}', '{}', null, null);

create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
grant execute on function pg_temp.act_as(uuid, uuid, text) to authenticated;

-- Roles and tenants.
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is((select count(*) from public.invoice_line), 2::bigint, 'owner A reads A''s two lines');
select is((select count(*) from public.invoice_line where invoice_id = 'b1000000-0000-4000-8000-0000000000b1'),
  0::bigint, 'owner A reads none of B''s lines');
select is((select lot_code from public.invoice_line where position = 1), 'L-0425', 'lot code is stored');
select throws_ok($$ insert into public.invoice_line (tenant_id, invoice_id, position, raw_description,
    qty, line_amount, field_confidence, extracted) values ('11111111-1111-4111-8111-111111111111',
    'a1000000-0000-4000-8000-0000000000a1', 9, 'X', 1, 1, '{}', '{}') $$,
  '42501', null, 'authenticated cannot insert lines');
select throws_ok($$ update public.invoice_line set qty = 5 $$, '42501', null,
  'authenticated cannot update lines');
select throws_ok($$ delete from public.invoice_line $$, '42501', null,
  'authenticated cannot delete lines');
select throws_ok($$ update public.invoice set gate_flags = '{total_mismatch}' $$, '42501', null,
  'the owner cannot write extraction columns on invoice');
select throws_ok($$ update public.invoice set claim_token = gen_random_uuid() $$, '42501', null,
  'the owner cannot write the claim token');
select isnt((select count(*) from public.invoice), 0::bigint, 'owner A still reads invoices');

select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is((select count(*) from public.invoice_line), 2::bigint, 'admin A reads A''s two lines');

select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is((select count(*) from public.invoice_line), 0::bigint, 'chef reads no lines');
select is((select count(*) from public.invoice), 0::bigint, 'chef reads no invoices');

select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is((select count(*) from public.invoice_line), 0::bigint, 'waiter reads no lines');
select is((select count(*) from public.invoice), 0::bigint, 'waiter reads no invoices');

select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is((select count(*) from public.invoice_line), 1::bigint, 'owner B reads only B''s line');
reset role;

-- Privileges.
select ok(not has_table_privilege('anon', 'public.invoice_line', 'select'), 'anon has no access');
select ok(has_table_privilege('service_role', 'public.invoice_line', 'insert'),
  'service_role can insert lines');
select ok(not has_table_privilege('service_role', 'public.invoice_line', 'delete'),
  'service_role cannot delete lines');
select ok(not has_table_privilege('service_role', 'public.invoice_line', 'truncate'),
  'service_role cannot truncate lines');

-- Column checks on invoice (migration role).
select throws_ok($$ update public.invoice set gate_flags = '{foo}'
    where id = 'a1000000-0000-4000-8000-0000000000a1' $$, '23514', null,
  'an unknown gate flag is rejected');
select lives_ok($$ update public.invoice set gate_flags = '{total_mismatch,low_confidence}'
    where id = 'a1000000-0000-4000-8000-0000000000a1' $$, 'both known flags are accepted');
select throws_ok($$ update public.invoice set extraction_error = 'x'
    where id = 'a1000000-0000-4000-8000-0000000000a1' $$, '23514', null,
  'an unknown extraction error code is rejected');
select lives_ok($$ update public.invoice set extraction_error = 'lease_expired'
    where id = 'a1000000-0000-4000-8000-0000000000a1' $$, 'a known code is accepted');
select throws_ok($$ update public.invoice set attempts = 11
    where id = 'a1000000-0000-4000-8000-0000000000a1' $$, '23514', null,
  'attempts above 10 are rejected');
select throws_ok($$ update public.invoice set payment_terms = ''
    where id = 'a1000000-0000-4000-8000-0000000000a1' $$, '23514', null,
  'empty payment terms are rejected');
select throws_ok($$ update public.invoice set payment_terms = repeat('x', 201)
    where id = 'a1000000-0000-4000-8000-0000000000a1' $$, '23514', null,
  'payment terms over 200 characters are rejected');
select throws_ok($$ update public.invoice set extraction_model = ''
    where id = 'a1000000-0000-4000-8000-0000000000a1' $$, '23514', null,
  'an empty model name is rejected');

-- Column checks on invoice_line (migration role).
create function pg_temp.add_line(p_pos int, p_desc text, p_qty numeric, p_amount numeric,
    p_tenant uuid default '11111111-1111-4111-8111-111111111111',
    p_vat numeric default null, p_checks text[] default '{}', p_unit text default null,
    p_code text default null) returns void language sql as $$
  insert into public.invoice_line (tenant_id, invoice_id, position, raw_description, qty,
      line_amount, vat_rate, checks, unit_raw, supplier_code, field_confidence, extracted)
  values (p_tenant, 'a1000000-0000-4000-8000-0000000000a1', p_pos, p_desc, p_qty, p_amount,
      p_vat, p_checks, p_unit, p_code, '{}', '{}')
$$;
select lives_ok($$ select pg_temp.add_line(3, repeat('x', 500), 0, 0) $$,
  'a 500 character description and zero quantity are accepted');
select throws_ok($$ select pg_temp.add_line(4, repeat('x', 501), 1, 1) $$, '23514', null,
  'a 501 character description is rejected');
select throws_ok($$ select pg_temp.add_line(4, '', 1, 1) $$, '23514', null,
  'an empty description is rejected');
select throws_ok($$ select pg_temp.add_line(4, 'X', -1, 1) $$, '23514', null,
  'a negative quantity is rejected');
select throws_ok($$ select pg_temp.add_line(4, 'X', 1, -1) $$, '23514', null,
  'a negative line amount is rejected');
select throws_ok($$ select pg_temp.add_line(4, 'X', 1, 1, p_vat => 100.01) $$, '23514', null,
  'a VAT rate above 100 is rejected');
select throws_ok($$ select pg_temp.add_line(4, 'X', 1, 1, p_checks => '{foo}') $$, '23514', null,
  'an unknown line check is rejected');
select throws_ok($$ select pg_temp.add_line(4, 'X', 1, 1, p_unit => repeat('u', 21)) $$,
  '23514', null, 'a unit over 20 characters is rejected');
select throws_ok($$ select pg_temp.add_line(4, 'X', 1, 1, p_code => repeat('c', 65)) $$,
  '23514', null, 'a supplier code over 64 characters is rejected');
select throws_ok($$ select pg_temp.add_line(0, 'X', 1, 1) $$, '23514', null,
  'position 0 is rejected');
select throws_ok($$ select pg_temp.add_line(1, 'X', 1, 1) $$, '23505', null,
  'a position is unique per invoice');
select throws_ok($$ select pg_temp.add_line(4, 'X', 1, 1, '22222222-2222-4222-8222-222222222222') $$,
  '23503', null, 'a line with B''s tenant on A''s invoice is refused');
select * from finish();
rollback;
