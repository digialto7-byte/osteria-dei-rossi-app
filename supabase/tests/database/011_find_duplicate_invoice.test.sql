-- M2 acceptance test 7 (plan §5 step 4): find_duplicate_invoice returns the existing invoice for
-- the same supplier VAT + number + date, and nothing for another date, number, tenant or role.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

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

-- A1: the existing invoice of tenant A.
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status,
                            supplier_vat, number_raw, invoice_date, created_at) values
  ('a1000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/a1000000-0000-4000-8000-0000000000a1.pdf',
   'application/pdf', 10, 'review', 'IT12345678903', 'FT 1/2026', '2026-10-01',
   now() - interval '1 day');

create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
grant execute on function pg_temp.act_as(uuid, uuid, text) to authenticated;

select ok(not has_function_privilege('anon',
  'public.find_duplicate_invoice(text, text, date, uuid)', 'execute'),
  'anon cannot execute find_duplicate_invoice');
select ok(has_function_privilege('authenticated',
  'public.find_duplicate_invoice(text, text, date, uuid)', 'execute'),
  'authenticated can execute find_duplicate_invoice');

set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');

select is(public.find_duplicate_invoice('IT12345678903', 'FT 1/2026', '2026-10-01'),
  'a1000000-0000-4000-8000-0000000000a1'::uuid, 'the same VAT, number and date finds the invoice');
select is(public.find_duplicate_invoice(' it12345678903 ', 'ft1/2026', '2026-10-01'),
  'a1000000-0000-4000-8000-0000000000a1'::uuid, 'case and spaces do not matter');
select is(public.find_duplicate_invoice('IT12345678903', 'FT 1/2026', '2026-10-02'),
  null, 'another date is not a duplicate');
select is(public.find_duplicate_invoice('IT12345678903', 'FT 2/2026', '2026-10-01'),
  null, 'another number is not a duplicate');
select is(public.find_duplicate_invoice('IT12345678903', 'FT 1/2026', '2026-10-01',
  'a1000000-0000-4000-8000-0000000000a1'), null, 'the invoice itself is excluded');
select is(public.find_duplicate_invoice(null, 'FT 1/2026', '2026-10-01'), null, 'a null VAT finds nothing');
select is(public.find_duplicate_invoice('IT12345678903', null, '2026-10-01'), null, 'a null number finds nothing');
select is(public.find_duplicate_invoice('IT12345678903', 'FT 1/2026', null), null, 'a null date finds nothing');

-- Chef: RLS hides the invoice, so there is never a match.
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(public.find_duplicate_invoice('IT12345678903', 'FT 1/2026', '2026-10-01'),
  null, 'a chef never gets a match');

-- Owner of tenant B: the same key exists only in tenant A.
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(public.find_duplicate_invoice('IT12345678903', 'FT 1/2026', '2026-10-01'),
  null, 'tenant B does not see tenant A''s invoice');

-- The extraction worker (service role) passes the invoice's tenant explicitly.
reset role;
set local role service_role;
select is(app.find_duplicate_invoice_in('11111111-1111-4111-8111-111111111111',
  'IT12345678903', 'FT 1/2026', '2026-10-01', null),
  'a1000000-0000-4000-8000-0000000000a1'::uuid, 'the service role finds it for tenant A');
select is(app.find_duplicate_invoice_in('22222222-2222-4222-8222-222222222222',
  'IT12345678903', 'FT 1/2026', '2026-10-01', null),
  null, 'the service role finds nothing for tenant B');
reset role;

-- Two matches (only possible without the unique index): the older one wins.
drop index public.invoice_dedup_uq;
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status,
                            supplier_vat, number_raw, invoice_date) values
  ('a0000000-0000-4000-8000-0000000000a0', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/a0000000-0000-4000-8000-0000000000a0.pdf',
   'application/pdf', 10, 'review', 'IT12345678903', 'FT 1/2026', '2026-10-01');
select is(app.find_duplicate_invoice_in('11111111-1111-4111-8111-111111111111',
  'IT12345678903', 'FT 1/2026', '2026-10-01', null),
  'a1000000-0000-4000-8000-0000000000a1'::uuid, 'with two matches the older invoice is returned');

-- A rejected (and a duplicate-flagged) invoice no longer counts.
update public.invoice set status = 'rejected' where id in
  ('a1000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-0000000000a0');
select is(app.find_duplicate_invoice_in('11111111-1111-4111-8111-111111111111',
  'IT12345678903', 'FT 1/2026', '2026-10-01', null),
  null, 'rejected invoices are not duplicates');

select * from finish();
rollback;
