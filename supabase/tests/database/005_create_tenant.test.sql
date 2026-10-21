-- Tenant onboarding function used by scripts/create-tenant.ts.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');

set local role service_role;
select lives_ok(
  $$ select public.create_tenant_with_owner('Osteria Demo', 'IT00000000000',
       'a0000000-0000-4000-8000-00000000000a', 'Titolare Demo') $$,
  'service_role creates a tenant with its owner');
reset role;

select is(
  (select role::text from public.app_user where auth_id = 'a0000000-0000-4000-8000-00000000000a'),
  'owner', 'the owner app_user belongs to the new tenant');
select is(
  (select t.name from public.tenant t join public.app_user u on u.tenant_id = t.id
    where u.auth_id = 'a0000000-0000-4000-8000-00000000000a'),
  'Osteria Demo', 'tenant and owner are linked');

set local role service_role;
-- The owner insert fails after the tenant insert succeeded; no half-created tenant may remain.
-- (throws_ok runs the call in a subtransaction, so this documents the contract more than it
-- tests the function body.)
select throws_ok(
  $$ select public.create_tenant_with_owner('Osteria Doppia', 'IT00000000001',
       'a0000000-0000-4000-8000-00000000000a', 'Titolare Doppio') $$,
  '23505', null, 'an auth user who already owns a tenant is rejected');
reset role;
select is(
  (select count(*)::int from public.tenant where vat_number = 'IT00000000001'),
  0, 'the tenant row is rolled back with the failed owner insert');

select ok(
  not has_function_privilege('authenticated', 'public.create_tenant_with_owner(text, text, uuid, text)', 'execute'),
  'authenticated users cannot create tenants');
select ok(
  not has_function_privilege('anon', 'public.create_tenant_with_owner(text, text, uuid, text)', 'execute'),
  'anon cannot create tenants');

select * from finish();
rollback;
