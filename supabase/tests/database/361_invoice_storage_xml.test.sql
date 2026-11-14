-- P2-7 S2 (docs/plans/2026-11-14-p2-7-xml-invoice-upload.md section 3.2, 5 S2): the `invoices` bucket takes the two e-invoice kinds, .xml (application/xml) and .p7m
-- (application/pkcs7-mime), next to the three existing ones. The size limit is unchanged (4 MiB). Owner and admin of the tenant add objects in their own tenant folder with
-- a name <tenant>/<yyyy>/<uuid>.<pdf|jpg|png|xml|p7m> (lower case, one extension, one folder level); the chef, the waiter and another tenant cannot. The select policy is
-- unchanged, and there is still no update and no delete policy for any role (10-year retention). Runs on the native runner (storage_shim.sql) and in CI against the real
-- Storage schema. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

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
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare A'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Cuoco A'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere A'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin DigiAlto');

-- Fixture objects, created by the migration role: one e-invoice per tenant.
insert into storage.objects (bucket_id, name) values
  ('invoices', '11111111-1111-4111-8111-111111111111/1998/a1000000-0000-4000-8000-0000000000a1.xml'),
  ('invoices', '22222222-2222-4222-8222-222222222222/1998/b1000000-0000-4000-8000-0000000000b1.p7m');

-- The bucket.
select is((select allowed_mime_types from storage.buckets where id = 'invoices'),
  array['application/pdf', 'image/jpeg', 'image/png', 'application/xml', 'application/pkcs7-mime'],
  'the bucket accepts PDF, JPEG, PNG, XML and PKCS#7 (p7m) only');
select is((select file_size_limit from storage.buckets where id = 'invoices'), 4194304::bigint, 'the bucket limit is still 4 MiB');
select is((select public from storage.buckets where id = 'invoices'), false, 'the bucket is still private');

-- The policies: select and insert only, for authenticated only, none for update or delete.
select set_eq(
  $$ select policyname::text, cmd::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and (coalesce(qual, '') || coalesce(with_check, '')) like '%invoices%' $$,
  $$ values ('invoices_object_select', 'SELECT'), ('invoices_object_insert', 'INSERT') $$,
  'only a select and an insert policy exist for the invoices bucket (no update, no delete)');
select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects' and policyname like 'invoices_%'
        and roles <> array['authenticated']::name[] $$,
  'both apply to authenticated only');
select ok((select qual !~ '(pdf|jpg|png|xml|p7m)' and qual like '%tenant_id%' from pg_policies where schemaname = 'storage' and policyname = 'invoices_object_select'),
  'the select policy is the tenant-folder and role rule, with no extension condition (unchanged)');
select ok((select with_check ~ 'xml\|p7m' from pg_policies where schemaname = 'storage' and policyname = 'invoices_object_insert'),
  'the insert policy names the two new extensions');

create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role, 'aal', case when app_role = 'admin' then 'aal2' else 'aal1' end)::text, true)
$$;
grant execute on function pg_temp.act_as(uuid, uuid, text) to authenticated;

-- Tries a delete and swallows any error: RLS may filter the row silently or a trigger may raise.
create function pg_temp.try_delete() returns void language plpgsql as $$
begin
  delete from storage.objects where bucket_id = 'invoices';
exception when others then
  null;
end
$$;
grant execute on function pg_temp.try_delete() to authenticated;

set local role authenticated;

-- Owner of tenant A.
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is((select count(*)::int from storage.objects where bucket_id = 'invoices'), 1, 'owner A reads exactly tenant A''s e-invoice');
select lives_ok($$ insert into storage.objects (bucket_id, name) values
  ('invoices', '11111111-1111-4111-8111-111111111111/1998/a2000000-0000-4000-8000-0000000000a2.xml') $$, 'owner A adds a .xml in the tenant folder');
select lives_ok($$ insert into storage.objects (bucket_id, name) values
  ('invoices', '11111111-1111-4111-8111-111111111111/1998/a3000000-0000-4000-8000-0000000000a3.p7m') $$, 'owner A adds a .p7m in the tenant folder');
select lives_ok($$ insert into storage.objects (bucket_id, name) values
  ('invoices', '11111111-1111-4111-8111-111111111111/1998/a4000000-0000-4000-8000-0000000000a4.pdf') $$, 'and a .pdf still');
select throws_ok($$ insert into storage.objects (bucket_id, name) values
  ('invoices', '22222222-2222-4222-8222-222222222222/1998/a5000000-0000-4000-8000-0000000000a5.xml') $$,
  '42501', null, 'owner A cannot add a .xml under tenant B''s prefix');
select throws_ok($$ insert into storage.objects (bucket_id, name) values
  ('invoices', '11111111-1111-4111-8111-111111111111/1998/a6000000-0000-4000-8000-0000000000a6.exe') $$,
  '42501', null, 'owner A cannot add a .exe');
select throws_ok($$ insert into storage.objects (bucket_id, name) values
  ('invoices', '11111111-1111-4111-8111-111111111111/1998/a7000000-0000-4000-8000-0000000000a7.xml.p7m') $$,
  '42501', null, 'owner A cannot add a .xml.p7m (the stored name carries one extension)');
select throws_ok($$ insert into storage.objects (bucket_id, name) values
  ('invoices', '11111111-1111-4111-8111-111111111111/1998/a8000000-0000-4000-8000-0000000000a8.XML') $$,
  '42501', null, 'owner A cannot add an upper-case .XML');
select throws_ok($$ insert into storage.objects (bucket_id, name) values
  ('invoices', '11111111-1111-4111-8111-111111111111/1998/extra/a9000000-0000-4000-8000-0000000000a9.xml') $$,
  '42501', null, 'owner A cannot add an object one folder level deeper');
select lives_ok($$ select pg_temp.try_delete() $$, 'owner A''s delete attempt is handled');

-- Admin of tenant A.
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is((select count(*)::int from storage.objects where bucket_id = 'invoices'), 4, 'admin A reads the tenant''s four objects');
select lives_ok($$ insert into storage.objects (bucket_id, name) values
  ('invoices', '11111111-1111-4111-8111-111111111111/1998/f1000000-0000-4000-8000-0000000000f1.p7m') $$, 'admin A adds a .p7m');
select lives_ok($$ select pg_temp.try_delete() $$, 'admin A''s delete attempt is handled');

-- Chef of tenant A.
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is((select count(*)::int from storage.objects where bucket_id = 'invoices'), 0, 'chef A reads no objects');
select throws_ok($$ insert into storage.objects (bucket_id, name) values
  ('invoices', '11111111-1111-4111-8111-111111111111/1998/c1000000-0000-4000-8000-0000000000c1.xml') $$,
  '42501', null, 'chef A cannot add a .xml');

-- Waiter of tenant A.
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is((select count(*)::int from storage.objects where bucket_id = 'invoices'), 0, 'waiter A reads no objects');
select throws_ok($$ insert into storage.objects (bucket_id, name) values
  ('invoices', '11111111-1111-4111-8111-111111111111/1998/d1000000-0000-4000-8000-0000000000d1.p7m') $$,
  '42501', null, 'waiter A cannot add a .p7m');

-- Owner of tenant B.
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is((select count(*)::int from storage.objects where bucket_id = 'invoices'), 1, 'owner B reads only tenant B''s object');
select throws_ok($$ insert into storage.objects (bucket_id, name) values
  ('invoices', '11111111-1111-4111-8111-111111111111/1998/b2000000-0000-4000-8000-0000000000b2.xml') $$,
  '42501', null, 'owner B cannot add under tenant A''s prefix');
select lives_ok($$ select pg_temp.try_delete() $$, 'owner B''s delete attempt is handled');

-- Back as the migration role: nothing was deleted, renamed or added outside the rules.
reset role;
select is((select count(*)::int from storage.objects where bucket_id = 'invoices'), 6,
  'six objects remain: two fixtures, owner A''s three, admin A''s one (no delete took effect, no refused insert added a row)');
select is((select count(*)::int from storage.objects where name ~ '\.(xml|p7m)$' and bucket_id = 'invoices'), 5, 'five of them are e-invoice files');

select * from finish();
rollback;
