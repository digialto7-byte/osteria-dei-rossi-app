-- M0 acceptance test 3: an owner of tenant A cannot read or write tenant B's rows.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'waiter-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'newcomer@example.test'),
  ('e0000000-0000-4000-8000-00000000000e', 'former-a@example.test');

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
insert into public.app_user (tenant_id, auth_id, role, display_name, is_active, deactivated_at) values
  ('11111111-1111-4111-8111-111111111111', 'e0000000-0000-4000-8000-00000000000e',
   'owner', 'Ex titolare A', false, now());

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
select is((select count(*)::int from public.app_user), 3, 'owner A sees the users of tenant A');

-- A role the owner may create, for a user with no membership: only the tenant check can reject it.
select throws_ok(
  $$ insert into public.app_user (tenant_id, auth_id, role, display_name)
     values ('22222222-2222-4222-8222-222222222222', 'd0000000-0000-4000-8000-00000000000d',
             'waiter', 'Intruso') $$,
  '42501', null, 'insert with tenant B''s tenant_id is rejected');
select lives_ok(
  $$ insert into public.app_user (tenant_id, auth_id, role, display_name)
     values ('11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d',
             'waiter', 'Nuovo cameriere') $$,
  'the same insert into the owner''s own tenant is allowed');

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

-- A waiter whose token still claims owner (e.g. demoted after login): the role comes from the
-- app_user row, not the token, so they get waiter access only.
select set_config('request.jwt.claims', json_build_object(
  'sub', 'c0000000-0000-4000-8000-00000000000c', 'role', 'authenticated',
  'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'owner')::text, true);
select is((select count(*)::int from public.app_user), 1,
  'a stale owner claim on a waiter row still sees only their own user row');
select throws_ok(
  $$ insert into public.app_user (tenant_id, auth_id, role, display_name)
     values ('11111111-1111-4111-8111-111111111111', 'b0000000-0000-4000-8000-00000000000b',
             'waiter', 'Collega') $$,
  '42501', null, 'a stale owner claim cannot create users');

-- A deactivated owner whose token still carries valid claims sees nothing (no waiting for expiry).
select set_config('request.jwt.claims', json_build_object(
  'sub', 'e0000000-0000-4000-8000-00000000000e', 'role', 'authenticated',
  'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'owner')::text, true);
select is((select count(*)::int from public.app_user) + (select count(*)::int from public.tenant),
  0, 'a deactivated user reads no rows even with a live token');

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
