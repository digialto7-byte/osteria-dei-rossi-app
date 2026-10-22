-- M2 invoice table (plan §5 step 3): role matrix, tenant isolation, path and size checks, the
-- immutability and status guard, the duplicate key. Storage policies are tested in 012.
begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

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

-- Migration-role fixtures. Invoice ids start with the letter of their purpose; paths follow
-- <tenant>/<year>/<id>.<ext>.
-- g1: guard tests. d1/d2: duplicate key. b1: tenant B's invoice.
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes) values
  ('91000000-0000-4000-8000-000000000091', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/91000000-0000-4000-8000-000000000091.pdf',
   'application/pdf', 1000),
  ('b1000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222',
   '22222222-2222-4222-8222-222222222222/2026/b1000000-0000-4000-8000-0000000000b1.pdf',
   'application/pdf', 1000);

-- Pure helper.
select is(app.normalise_invoice_number(' ft 1/2026 '), 'FT1/2026',
  'invoice numbers are trimmed, de-spaced and upper-cased');
select is(app.normalise_invoice_number(null), null, 'a null number stays null');
-- Founder decision (M2 Q4): punctuation matters, so these are two different numbers.
select isnt(app.normalise_invoice_number('FT 1/2026'), app.normalise_invoice_number('FT-1-2026'),
  'FT 1/2026 and FT-1-2026 are different invoice numbers');

-- Guard trigger, as the migration role (it applies to every writer).
select throws_ok($$ update public.invoice set file_path =
    '11111111-1111-4111-8111-111111111111/2026/91000000-0000-4000-8000-000000000091.png'
    where id = '91000000-0000-4000-8000-000000000091' $$,
  'P0001', 'invoice_immutable', 'the stored file path never changes');
select throws_ok($$ update public.invoice set file_size_bytes = 5
    where id = '91000000-0000-4000-8000-000000000091' $$,
  'P0001', 'invoice_immutable', 'the stored file size never changes');
select throws_ok($$ update public.invoice set status = 'review'
    where id = '91000000-0000-4000-8000-000000000091' $$,
  'P0001', 'invalid_status_transition', 'received cannot jump to review');
select lives_ok($$ update public.invoice set status = 'extracting'
    where id = '91000000-0000-4000-8000-000000000091' $$, 'received -> extracting');
select lives_ok($$ update public.invoice set status = 'review'
    where id = '91000000-0000-4000-8000-000000000091' $$, 'extracting -> review');
select lives_ok($$ update public.invoice set status = 'approved'
    where id = '91000000-0000-4000-8000-000000000091' $$, 'review -> approved');
select throws_ok($$ update public.invoice set status = 'rejected'
    where id = '91000000-0000-4000-8000-000000000091' $$,
  'P0001', 'invalid_status_transition', 'an approved invoice cannot be rejected');
select throws_ok($$ update public.invoice set status = 'review'
    where id = '91000000-0000-4000-8000-000000000091' $$,
  'P0001', 'invalid_status_transition', 'an approved invoice cannot go back to review');
select throws_ok($$ insert into public.invoice (tenant_id, file_path, file_mime, file_size_bytes, status)
    values ('11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111111/2026/' || gen_random_uuid() || '.pdf',
      'application/pdf', 10, 'duplicate') $$,
  '23514', null, 'a duplicate needs duplicate_of');

-- Duplicate key: a plain index, so two confirmed invoices may share it (owner override, V3).
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status,
                            supplier_vat, number_raw, invoice_date) values
  ('d1000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/d1000000-0000-4000-8000-0000000000d1.pdf',
   'application/pdf', 10, 'review', 'IT12345678903', 'FT 1/2026', '2026-10-01');
select lives_ok($$ insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes,
    status, supplier_vat, number_raw, invoice_date) values
  ('d2000000-0000-4000-8000-0000000000d2', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/d2000000-0000-4000-8000-0000000000d2.pdf',
   'application/pdf', 10, 'review', 'IT12345678903', 'ft1/2026', '2026-10-01') $$,
  'the same supplier, number and date twice in review is allowed');
select is((select indisunique from pg_index where indexrelid = 'public.invoice_dedup_uq'::regclass),
  false, 'invoice_dedup_uq is a plain index');

-- Owner override: a wrongly flagged duplicate goes back to review.
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status,
                            supplier_vat, number_raw, invoice_date, duplicate_of) values
  ('d4000000-0000-4000-8000-0000000000d4', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/d4000000-0000-4000-8000-0000000000d4.pdf',
   'application/pdf', 10, 'duplicate', 'IT12345678903', 'FT 1/2026', '2026-10-01',
   'd1000000-0000-4000-8000-0000000000d1');
select lives_ok($$ update public.invoice set status = 'review'
    where id = 'd4000000-0000-4000-8000-0000000000d4' $$, 'duplicate -> review');
select lives_ok($$ insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes,
    status, supplier_vat, number_raw, invoice_date) values
  ('d3000000-0000-4000-8000-0000000000d3', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/d3000000-0000-4000-8000-0000000000d3.pdf',
   'application/pdf', 10, 'rejected', 'IT12345678903', 'FT 1/2026', '2026-10-01') $$,
  'the same key is allowed when the other invoice is rejected');

-- Owner of tenant A.
create function pg_temp.act_as(auth_id uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated',
    'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', app_role)::text, true)
$$;
grant execute on function pg_temp.act_as(uuid, text) to authenticated;

set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', 'owner');

select lives_ok($$ insert into public.invoice (id, file_path, file_mime, file_size_bytes, original_filename)
  values ('e1000000-0000-4000-8000-0000000000e1',
    '11111111-1111-4111-8111-111111111111/2026/e1000000-0000-4000-8000-0000000000e1.pdf',
    'application/pdf', 2048, 'fattura.pdf') $$, 'owner uploads an invoice');
select is((select status::text from public.invoice where id = 'e1000000-0000-4000-8000-0000000000e1'),
  'received', 'a new invoice is received');
select is((select created_by from public.invoice where id = 'e1000000-0000-4000-8000-0000000000e1'),
  'a1000000-0000-4000-8000-00000000000a'::uuid, 'created_by defaults to the caller');
select is((select tenant_id from public.invoice where id = 'e1000000-0000-4000-8000-0000000000e1'),
  '11111111-1111-4111-8111-111111111111'::uuid, 'tenant_id defaults to the caller''s tenant');
select is((select count(*)::int from public.invoice where tenant_id <> '11111111-1111-4111-8111-111111111111'),
  0, 'owner A reads none of tenant B''s invoices');

select throws_ok($$ insert into public.invoice (id, file_path, file_mime, file_size_bytes, status)
  values ('e2000000-0000-4000-8000-0000000000e2',
    '11111111-1111-4111-8111-111111111111/2026/e2000000-0000-4000-8000-0000000000e2.pdf',
    'application/pdf', 10, 'approved') $$, '42501', null, 'status cannot be set by the caller');
select throws_ok($$ insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes)
  values ('e3000000-0000-4000-8000-0000000000e3', '22222222-2222-4222-8222-222222222222',
    '22222222-2222-4222-8222-222222222222/2026/e3000000-0000-4000-8000-0000000000e3.pdf',
    'application/pdf', 10) $$, '42501', null, 'tenant_id cannot be set by the caller');
select throws_ok($$ insert into public.invoice (id, file_path, file_mime, file_size_bytes, supplier_vat)
  values ('e4000000-0000-4000-8000-0000000000e4',
    '11111111-1111-4111-8111-111111111111/2026/e4000000-0000-4000-8000-0000000000e4.pdf',
    'application/pdf', 10, 'IT12345678903') $$, '42501', null, 'supplier_vat cannot be set by the caller');
select throws_ok($$ update public.invoice set original_filename = 'x' $$,
  '42501', null, 'the API roles cannot update an invoice');
select throws_ok($$ delete from public.invoice $$, '42501', null, 'the API roles cannot delete an invoice');

select throws_ok($$ insert into public.invoice (id, file_path, file_mime, file_size_bytes)
  values ('e5000000-0000-4000-8000-0000000000e5',
    '22222222-2222-4222-8222-222222222222/2026/e5000000-0000-4000-8000-0000000000e5.pdf',
    'application/pdf', 10) $$, '23514', null, 'a path with another tenant''s prefix is rejected');
select throws_ok($$ insert into public.invoice (id, file_path, file_mime, file_size_bytes)
  values ('e6000000-0000-4000-8000-0000000000e6',
    '11111111-1111-4111-8111-111111111111/2026/' || gen_random_uuid() || '.pdf',
    'application/pdf', 10) $$, '23514', null, 'a path with another id is rejected');
select throws_ok($$ insert into public.invoice (id, file_path, file_mime, file_size_bytes)
  values ('e7000000-0000-4000-8000-0000000000e7',
    '11111111-1111-4111-8111-111111111111/2026/e7000000-0000-4000-8000-0000000000e7.pdf',
    'image/png', 10) $$, '23514', null, 'a .pdf path with an image MIME type is rejected');
select throws_ok($$ insert into public.invoice (id, file_path, file_mime, file_size_bytes)
  values ('e8000000-0000-4000-8000-0000000000e8',
    '11111111-1111-4111-8111-111111111111/2026/e8000000-0000-4000-8000-0000000000e8.pdf',
    'application/pdf', 4194305) $$, '23514', null, 'a file over 4 MiB is rejected');
select lives_ok($$ insert into public.invoice (id, file_path, file_mime, file_size_bytes)
  values ('e9000000-0000-4000-8000-0000000000e9',
    '11111111-1111-4111-8111-111111111111/2026/e9000000-0000-4000-8000-0000000000e9.png',
    'image/png', 4194304) $$, 'a photo of exactly 4 MiB is accepted');

-- Admin of tenant A.
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', 'admin');
select lives_ok($$ insert into public.invoice (id, file_path, file_mime, file_size_bytes)
  values ('ea000000-0000-4000-8000-0000000000ea',
    '11111111-1111-4111-8111-111111111111/2026/ea000000-0000-4000-8000-0000000000ea.jpg',
    'image/jpeg', 10) $$, 'admin uploads an invoice');
select ok((select count(*) from public.invoice where id = 'e1000000-0000-4000-8000-0000000000e1') = 1,
  'admin reads the owner''s invoice');

-- Chef and waiter of tenant A.
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', 'chef');
select is((select count(*)::int from public.invoice), 0, 'chef reads no invoices');
select throws_ok($$ insert into public.invoice (id, file_path, file_mime, file_size_bytes)
  values ('eb000000-0000-4000-8000-0000000000eb',
    '11111111-1111-4111-8111-111111111111/2026/eb000000-0000-4000-8000-0000000000eb.pdf',
    'application/pdf', 10) $$, '42501', null, 'chef cannot upload an invoice');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', 'waiter');
select is((select count(*)::int from public.invoice), 0, 'waiter reads no invoices');
select throws_ok($$ insert into public.invoice (id, file_path, file_mime, file_size_bytes)
  values ('ec000000-0000-4000-8000-0000000000ec',
    '11111111-1111-4111-8111-111111111111/2026/ec000000-0000-4000-8000-0000000000ec.pdf',
    'application/pdf', 10) $$, '42501', null, 'waiter cannot upload an invoice');

-- Owner of tenant B: tenant A's invoices do not exist for them.
select set_config('request.jwt.claims', json_build_object(
  'sub', 'b0000000-0000-4000-8000-00000000000b', 'role', 'authenticated',
  'tenant_id', '22222222-2222-4222-8222-222222222222', 'app_role', 'owner')::text, true);
select is((select count(*)::int from public.invoice), 1, 'owner B reads only tenant B''s own invoice');

select * from finish();
rollback;
