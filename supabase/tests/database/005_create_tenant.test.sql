-- Tenant onboarding function used by scripts/create-tenant.ts.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

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
-- Re-pinned on purpose by SP2 (step S3; was "an auth user who already owns a tenant is rejected" (23505) and "the tenant row is rolled back with the
-- failed owner insert"): with the key (tenant_id, auth_id) one login may own several tenants (ADR-038); a PIN login still cannot own one (the two tests after it).
select lives_ok(
  $$ select public.create_tenant_with_owner('Osteria Doppia', 'IT00000000001',
       'a0000000-0000-4000-8000-00000000000a', 'Titolare Doppio') $$,
  'an owner of A becomes owner of a second tenant too');
reset role;
select is(
  (select count(*)::int from public.app_user where auth_id = 'a0000000-0000-4000-8000-00000000000a' and role = 'owner' and is_active),
  2, 'and holds two active owner memberships, one per tenant');

-- SP2 S3/S9 (plan §3.8): a PIN login as owner is refused, and the tenant row goes with the failed owner insert (create-tenant --existing-owner-id
-- with a PIN login's id takes this path).
insert into auth.users (id, email) values ('90000000-0000-4000-8000-000000000001', 'pin-staff@example.test');
insert into public.app_user (tenant_id, auth_id, role, display_name, login_method)
  select t.id, '90000000-0000-4000-8000-000000000001', 'waiter', 'Cameriere PIN', 'pin'
    from public.tenant t where t.vat_number = 'IT00000000000';
set local role service_role;
select throws_ok(
  $$ select public.create_tenant_with_owner('Osteria PIN', 'IT00000000002',
       '90000000-0000-4000-8000-000000000001', 'Titolare PIN') $$,
  'P0001', 'pin_single_membership', 'a PIN login cannot own a tenant');
reset role;
select is(
  (select count(*)::int from public.tenant where vat_number = 'IT00000000002'),
  0, 'the tenant row is rolled back with the failed owner insert');

select ok(
  not has_function_privilege('authenticated', 'public.create_tenant_with_owner(text, text, uuid, text)', 'execute'),
  'authenticated users cannot create tenants');
select ok(
  not has_function_privilege('anon', 'public.create_tenant_with_owner(text, text, uuid, text)', 'execute'),
  'anon cannot create tenants');

select * from finish();
rollback;
