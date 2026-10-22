-- M2 Storage (plan §5 step 5): the private `invoices` bucket and its policies. Owner and admin of
-- the tenant read and add objects under their tenant folder; nobody can update or delete.
-- Runs on the native runner (storage_shim.sql) and in CI against the real Storage schema.
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

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

-- Fixture objects, created by the migration role.
insert into storage.objects (bucket_id, name) values
  ('invoices', '11111111-1111-4111-8111-111111111111/2026/a1000000-0000-4000-8000-0000000000a1.pdf'),
  ('invoices', '22222222-2222-4222-8222-222222222222/2026/b1000000-0000-4000-8000-0000000000b1.pdf');

-- The bucket.
select is((select count(*)::int from storage.buckets where id = 'invoices'), 1, 'bucket invoices exists');
select is((select public from storage.buckets where id = 'invoices'), false, 'the bucket is private');
select is((select file_size_limit from storage.buckets where id = 'invoices'), 4194304::bigint,
  'the bucket limit is 4 MiB');
select is((select allowed_mime_types from storage.buckets where id = 'invoices'),
  array['application/pdf', 'image/jpeg', 'image/png'], 'the bucket accepts PDF, JPEG and PNG only');

-- Guards against drift between the shim and real Storage.
select is(storage.foldername('t/2026/x.pdf'), array['t', '2026'], 'storage.foldername drops the file name');

-- The policies: select and insert only, for authenticated only.
select set_eq(
  $$ select policyname::text, cmd::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and (coalesce(qual, '') || coalesce(with_check, '')) like '%invoices%' $$,
  $$ values ('invoices_object_select', 'SELECT'), ('invoices_object_insert', 'INSERT') $$,
  'only select and insert policies exist for the invoices bucket (no update, no delete)');
select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects' and policyname like 'invoices_%'
        and roles <> array['authenticated']::name[] $$,
  'the invoices policies apply to authenticated only');

create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
grant execute on function pg_temp.act_as(uuid, uuid, text) to authenticated;

-- Tries a delete and swallows any error: RLS may filter the row silently or a trigger may raise.
-- Either way the object must still exist afterwards (checked as the migration role at the end).
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
select is((select count(*)::int from storage.objects where bucket_id = 'invoices'), 1,
  'owner A sees exactly tenant A''s object');
select is((select count(*)::int from storage.objects
            where name like '22222222-2222-4222-8222-222222222222/%'), 0, 'owner A sees none of tenant B''s objects');
select lives_ok($$ insert into storage.objects (bucket_id, name) values
  ('invoices', '11111111-1111-4111-8111-111111111111/2026/a2000000-0000-4000-8000-0000000000a2.pdf') $$,
  'owner A adds an object in the tenant folder');
select throws_ok($$ insert into storage.objects (bucket_id, name) values
  ('invoices', '22222222-2222-4222-8222-222222222222/2026/a3000000-0000-4000-8000-0000000000a3.pdf') $$,
  '42501', null, 'owner A cannot add an object under tenant B''s prefix');
select throws_ok($$ insert into storage.objects (bucket_id, name) values
  ('invoices', '11111111-1111-4111-8111-111111111111/x.html') $$,
  '42501', null, 'owner A cannot add an object with an unexpected path or extension');
select lives_ok($$ update storage.objects set name =
  '11111111-1111-4111-8111-111111111111/2026/a4000000-0000-4000-8000-0000000000a4.pdf'
  where bucket_id = 'invoices' $$, 'owner A''s rename attempt does not raise');
select lives_ok($$ select pg_temp.try_delete() $$, 'owner A''s delete attempt is handled');

-- Admin of tenant A.
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is((select count(*)::int from storage.objects where bucket_id = 'invoices'), 2,
  'admin A sees the tenant''s objects');
select lives_ok($$ select pg_temp.try_delete() $$, 'admin A''s delete attempt is handled');

-- Chef of tenant A.
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is((select count(*)::int from storage.objects where bucket_id = 'invoices'), 0, 'chef A sees no objects');
select throws_ok($$ insert into storage.objects (bucket_id, name) values
  ('invoices', '11111111-1111-4111-8111-111111111111/2026/a5000000-0000-4000-8000-0000000000a5.pdf') $$,
  '42501', null, 'chef A cannot add an object');
select lives_ok($$ select pg_temp.try_delete() $$, 'chef A''s delete attempt is handled');

-- Waiter of tenant A.
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is((select count(*)::int from storage.objects where bucket_id = 'invoices'), 0, 'waiter A sees no objects');
select throws_ok($$ insert into storage.objects (bucket_id, name) values
  ('invoices', '11111111-1111-4111-8111-111111111111/2026/a6000000-0000-4000-8000-0000000000a6.pdf') $$,
  '42501', null, 'waiter A cannot add an object');
select lives_ok($$ select pg_temp.try_delete() $$, 'waiter A''s delete attempt is handled');

-- Owner of tenant B.
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is((select count(*)::int from storage.objects where bucket_id = 'invoices'), 1,
  'owner B sees only tenant B''s object');
select lives_ok($$ select pg_temp.try_delete() $$, 'owner B''s delete attempt is handled');

-- Back as the migration role: nothing was deleted, renamed or added outside the rules.
reset role;
select is((select count(*)::int from storage.objects where name in (
  '11111111-1111-4111-8111-111111111111/2026/a1000000-0000-4000-8000-0000000000a1.pdf',
  '22222222-2222-4222-8222-222222222222/2026/b1000000-0000-4000-8000-0000000000b1.pdf',
  '11111111-1111-4111-8111-111111111111/2026/a2000000-0000-4000-8000-0000000000a2.pdf')), 3,
  'no delete or rename by any role changed an object');
select is((select count(*)::int from storage.objects where bucket_id = 'invoices'), 3,
  'the rejected inserts added no rows');

select * from finish();
rollback;
