-- M2 founder answers (plan V5): suppliers without a VAT number are matched by name. A name match
-- is only a warning (duplicate_warning_of), the owner can say "not a duplicate"
-- (duplicate_override). Also pins: punctuation in invoice numbers matters (see 010).
begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare A'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'chef', 'Cuoco A');

-- Schema.
select has_column('public', 'invoice', 'supplier_name', 'invoice.supplier_name exists');
select col_is_null('public', 'invoice', 'supplier_name', 'supplier_name is nullable');
select has_column('public', 'invoice', 'duplicate_warning_of', 'invoice.duplicate_warning_of exists');
select col_is_null('public', 'invoice', 'duplicate_warning_of', 'duplicate_warning_of is nullable');
select col_not_null('public', 'invoice', 'duplicate_override', 'duplicate_override is not null');
select col_default_is('public', 'invoice', 'duplicate_override', 'false', 'duplicate_override defaults to false');

-- Fixtures (migration role). Paths: <tenant>/<year>/<id>.pdf.
-- n1: tenant A, no VAT, name with odd case/spacing. n0: same key, older.
-- v1: tenant A, WITH a VAT, same name/number/date. b1: tenant B, no VAT, same name/number/date.
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status,
                            supplier_vat, supplier_name, number_raw, invoice_date, created_at) values
  ('a1000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/a1000000-0000-4000-8000-0000000000a1.pdf',
   'application/pdf', 10, 'review', null, 'Rossi  Carni S.r.l.', 'FT 1/2026', '2026-10-01',
   now() - interval '1 day'),
  ('f1000000-0000-4000-8000-0000000000f1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/f1000000-0000-4000-8000-0000000000f1.pdf',
   'application/pdf', 10, 'review', 'IT12345678903', 'Verdi Pesce', 'FT 1/2026', '2026-10-01',
   now() - interval '1 day'),
  ('b1000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222',
   '22222222-2222-4222-8222-222222222222/2026/b1000000-0000-4000-8000-0000000000b1.pdf',
   'application/pdf', 10, 'review', null, 'Rossi Carni S.r.l.', 'FT 1/2026', '2026-10-01',
   now() - interval '1 day');

-- Column checks.
select throws_ok($$ update public.invoice set supplier_name = '' where id = 'a1000000-0000-4000-8000-0000000000a1' $$,
  '23514', null, 'an empty supplier name is rejected');
select throws_ok($$ update public.invoice set supplier_name = '   '
    where id = 'a1000000-0000-4000-8000-0000000000a1' $$,
  '23514', null, 'a whitespace-only supplier name is rejected');
select throws_ok($$ update public.invoice set supplier_name = repeat('x', 201)
    where id = 'a1000000-0000-4000-8000-0000000000a1' $$,
  '23514', null, 'a supplier name over 200 characters is rejected');
select lives_ok($$ update public.invoice set supplier_name = repeat('x', 200)
    where id = 'f1000000-0000-4000-8000-0000000000f1' $$, 'a 200 character name is accepted');
update public.invoice set supplier_name = 'Verdi Pesce' where id = 'f1000000-0000-4000-8000-0000000000f1';
select throws_ok($$ update public.invoice set duplicate_warning_of = id
    where id = 'a1000000-0000-4000-8000-0000000000a1' $$,
  '23514', null, 'an invoice cannot warn about itself');
select throws_ok($$ update public.invoice set duplicate_warning_of = 'b1000000-0000-4000-8000-0000000000b1'
    where id = 'a1000000-0000-4000-8000-0000000000a1' $$,
  '23503', null, 'a warning cannot point at another tenant''s invoice');
select lives_ok($$ update public.invoice set duplicate_warning_of = 'f1000000-0000-4000-8000-0000000000f1',
    duplicate_override = true where id = 'a1000000-0000-4000-8000-0000000000a1' $$,
  'a warning and an override can be recorded; the status stays review');
select is((select status::text from public.invoice where id = 'a1000000-0000-4000-8000-0000000000a1'),
  'review', 'a warning is not a duplicate status');
update public.invoice set duplicate_warning_of = null, duplicate_override = false
  where id = 'a1000000-0000-4000-8000-0000000000a1';

-- Older invoice with the same name key, for the "oldest wins" case.
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status,
                            supplier_vat, supplier_name, number_raw, invoice_date, created_at) values
  ('a0000000-0000-4000-8000-0000000000a0', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/a0000000-0000-4000-8000-0000000000a0.pdf',
   'application/pdf', 10, 'review', null, 'ROSSI CARNI S.R.L.', 'FT 1/2026', '2026-10-01',
   now() - interval '2 days');

create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
grant execute on function pg_temp.act_as(uuid, uuid, text) to authenticated;

-- The name lookup has its own partial index.
select has_index('public', 'invoice', 'invoice_name_dedup_idx', 'the name-lookup index exists');

-- Privileges.
select ok(not has_function_privilege('anon',
  'public.find_name_duplicate_invoice(text, text, date, uuid)', 'execute'),
  'anon cannot execute find_name_duplicate_invoice');
select ok(has_function_privilege('authenticated',
  'public.find_name_duplicate_invoice(text, text, date, uuid)', 'execute'),
  'authenticated can execute find_name_duplicate_invoice');
select ok(not has_function_privilege('anon',
  'app.find_name_duplicate_invoice_in(uuid, text, text, date, uuid)', 'execute'),
  'anon cannot execute the app-schema lookup');
select ok(has_function_privilege('service_role',
  'app.find_name_duplicate_invoice_in(uuid, text, text, date, uuid)', 'execute'),
  'service_role can execute the app-schema lookup');

set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');

select throws_ok($$ insert into public.invoice (id, file_path, file_mime, file_size_bytes, supplier_name)
  values ('e1000000-0000-4000-8000-0000000000e1',
    '11111111-1111-4111-8111-111111111111/2026/e1000000-0000-4000-8000-0000000000e1.pdf',
    'application/pdf', 10, 'Rossi') $$, '42501', null, 'the caller cannot set supplier_name');
select throws_ok($$ insert into public.invoice (id, file_path, file_mime, file_size_bytes, duplicate_override)
  values ('e2000000-0000-4000-8000-0000000000e2',
    '11111111-1111-4111-8111-111111111111/2026/e2000000-0000-4000-8000-0000000000e2.pdf',
    'application/pdf', 10, true) $$, '42501', null, 'the caller cannot set duplicate_override');
select throws_ok($$ update public.invoice set duplicate_override = true $$,
  '42501', null, 'no UPDATE grant on duplicate_override for authenticated');

-- Matching.
select is(public.find_name_duplicate_invoice('rossi carni s.r.l.', 'FT 1/2026', '2026-10-01'),
  'a0000000-0000-4000-8000-0000000000a0'::uuid,
  'same name (case and spacing aside), number and date finds the oldest invoice');
select is(public.find_name_duplicate_invoice('  Rossi   CARNI S.r.l. ', ' ft1/2026 ', '2026-10-01'),
  'a0000000-0000-4000-8000-0000000000a0'::uuid, 'spaces in name and number do not matter');
select is(public.find_name_duplicate_invoice('Rossi Carni S.r.l.', 'FT-1-2026', '2026-10-01'),
  null, 'FT 1/2026 and FT-1-2026 are different numbers (founder decision)');
select is(public.find_name_duplicate_invoice('Bianchi Latticini', 'FT 1/2026', '2026-10-01'),
  null, 'a different name is not a duplicate');
select is(public.find_name_duplicate_invoice('Verdi Pesce', 'FT 1/2026', '2026-10-01'),
  null, 'an invoice that has a VAT number is ignored');
select is(public.find_name_duplicate_invoice('Rossi Carni S.r.l.', 'FT 1/2026', '2026-10-02'),
  null, 'another date is not a duplicate');
select is(public.find_name_duplicate_invoice('Rossi Carni S.r.l.', 'FT 1/2026', '2026-10-01',
  'a0000000-0000-4000-8000-0000000000a0'), 'a1000000-0000-4000-8000-0000000000a1'::uuid,
  'the excluded invoice is skipped');
select is(public.find_name_duplicate_invoice(null, 'FT 1/2026', '2026-10-01'), null, 'a null name finds nothing');
select is(public.find_name_duplicate_invoice('Rossi Carni S.r.l.', null, '2026-10-01'), null, 'a null number finds nothing');
select is(public.find_name_duplicate_invoice('Rossi Carni S.r.l.', 'FT 1/2026', null), null, 'a null date finds nothing');

select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(public.find_name_duplicate_invoice('Rossi Carni S.r.l.', 'FT 1/2026', '2026-10-01'),
  null, 'a chef never gets a match');

select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(public.find_name_duplicate_invoice('Rossi Carni S.r.l.', 'FT 1/2026', '2026-10-01'),
  'b1000000-0000-4000-8000-0000000000b1'::uuid, 'tenant B finds only its own invoice');

reset role;
set local role service_role;
select is(app.find_name_duplicate_invoice_in('11111111-1111-4111-8111-111111111111',
  'Rossi Carni S.r.l.', 'FT 1/2026', '2026-10-01', null),
  'a0000000-0000-4000-8000-0000000000a0'::uuid, 'the service role finds it for tenant A');
reset role;

-- Rejected invoices no longer count.
update public.invoice set status = 'rejected' where id = 'a0000000-0000-4000-8000-0000000000a0';
select is(app.find_name_duplicate_invoice_in('11111111-1111-4111-8111-111111111111',
  'Rossi Carni S.r.l.', 'FT 1/2026', '2026-10-01', null),
  'a1000000-0000-4000-8000-0000000000a1'::uuid, 'a rejected invoice is skipped');

-- Rows in 'duplicate' status are skipped as well.
update public.invoice set status = 'duplicate',
  duplicate_of = 'a0000000-0000-4000-8000-0000000000a0'
  where id = 'a1000000-0000-4000-8000-0000000000a1';
select is(app.find_name_duplicate_invoice_in('11111111-1111-4111-8111-111111111111',
  'Rossi Carni S.r.l.', 'FT 1/2026', '2026-10-01', null),
  null, 'a duplicate-status invoice is skipped');
select * from finish();
rollback;
