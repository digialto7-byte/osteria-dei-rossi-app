-- M0 acceptance test 3: an owner of tenant A cannot read or write tenant B's rows.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'waiter-a@example.test');

insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT00000000001');

insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare A'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'waiter', 'Cameriere A');

-- Act as the owner of tenant A, with the claims the access token hook issues.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
  'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'owner')::text, true);

select is((select count(*)::int from public.tenant), 1, 'owner A sees exactly one tenant');
select is((select name from public.tenant), 'Osteria Demo A', 'and it is tenant A');
select is(
  (select count(*)::int from public.app_user where tenant_id = '22222222-2222-4222-8222-222222222222'),
  0, 'owner A reads 0 app_user rows of tenant B');
select is((select count(*)::int from public.app_user), 2, 'owner A sees both users of tenant A');

select throws_ok(
  $$ insert into public.app_user (tenant_id, auth_id, role, display_name)
     values ('22222222-2222-4222-8222-222222222222', 'a0000000-0000-4000-8000-00000000000a',
             'admin', 'Intruso') $$,
  '42501', null, 'insert with tenant B''s tenant_id is rejected');

select throws_ok(
  $$ insert into public.app_user (tenant_id, auth_id, role, display_name)
     values ('11111111-1111-4111-8111-111111111111', 'b0000000-0000-4000-8000-00000000000b',
             'admin', 'Nuovo admin') $$,
  '42501', null, 'an owner cannot create an admin');

select throws_ok(
  $$ update public.tenant set name = 'Hijacked' $$,
  '42501', null, 'authenticated users cannot update tenant rows in M0');
select throws_ok(
  $$ delete from public.app_user where id = 'c1000000-0000-4000-8000-00000000000c' $$,
  '42501', null, 'authenticated users cannot delete app_user rows');

-- A waiter of tenant A sees only their own app_user row and cannot edit the tenant.
select set_config('request.jwt.claims', json_build_object(
  'sub', 'c0000000-0000-4000-8000-00000000000c', 'role', 'authenticated',
  'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'waiter')::text, true);
select is((select count(*)::int from public.app_user), 1, 'waiter sees only their own user row');
select throws_ok(
  $$ insert into public.app_user (tenant_id, auth_id, role, display_name)
     values ('11111111-1111-4111-8111-111111111111', 'b0000000-0000-4000-8000-00000000000b',
             'waiter', 'Collega') $$,
  '42501', null, 'a waiter cannot create users');

-- No tenant claim at all: nothing is visible.
select set_config('request.jwt.claims', json_build_object(
  'sub', 'c0000000-0000-4000-8000-00000000000c', 'role', 'authenticated')::text, true);
select is((select count(*)::int from public.tenant), 0, 'no tenant claim → no tenant rows');

reset role;
select is(
  (select array_agg(name order by name) from public.tenant),
  array['Osteria Demo A', 'Osteria Demo B'],
  'tenant rows are unchanged');

select * from finish();
rollback;
