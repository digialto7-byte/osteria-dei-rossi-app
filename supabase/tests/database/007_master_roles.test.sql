-- M1 role matrix (plan §3.11.2): owner/admin write master data, chef reads suppliers,
-- ingredients and locations, the waiter sees none of it; no cross-tenant access, no delete.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

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

-- Tenant B already has data the tenant A users must never see.
insert into public.location (tenant_id, name) values ('22222222-2222-4222-8222-222222222222', 'Cella B');
insert into public.ingredient (tenant_id, name, base_unit)
  values ('22222222-2222-4222-8222-222222222222', 'Manzo B', 'kg');

create function pg_temp.act_as(auth_id uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated',
    'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', app_role)::text, true)
$$;
grant execute on function pg_temp.act_as(uuid, text) to authenticated;

set local role authenticated;

-- Owner of tenant A.
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', 'owner');
select lives_ok($$ insert into public.location (name) values ('Cella') $$, 'owner creates a location');
select lives_ok($$ insert into public.ingredient (name, base_unit) values ('Manzo', 'kg') $$,
  'owner creates an ingredient');
select is((select tenant_id from public.ingredient where name = 'Manzo'),
  '11111111-1111-4111-8111-111111111111'::uuid, 'tenant_id defaults to the caller''s tenant');
select is((select created_by from public.ingredient where name = 'Manzo'),
  'a1000000-0000-4000-8000-00000000000a'::uuid, 'created_by defaults to the caller');
select throws_ok($$ insert into public.ingredient (name, base_unit) values (' manzo ', 'kg') $$,
  '23505', null, 'names are unique per tenant after normalisation');
select is((select count(*)::int from public.location) + (select count(*)::int from public.ingredient),
  2, 'owner A reads none of tenant B''s master data');
select throws_ok(
  $$ insert into public.location (tenant_id, name) values ('22222222-2222-4222-8222-222222222222', 'X') $$,
  '42501', null, 'tenant_id cannot be set by the caller');
select throws_ok($$ insert into public.location (name, created_by)
    values ('Y', 'a1000000-0000-4000-8000-00000000000a') $$,
  '42501', null, 'created_by cannot be set by the caller');
select throws_ok($$ update public.ingredient set base_unit = 'l' $$,
  '42501', null, 'an ingredient''s base unit cannot be changed');
select lives_ok($$ update public.ingredient set is_active = false where name = 'Manzo' $$,
  'owner deactivates an ingredient');
select throws_ok($$ delete from public.location $$, '42501', null, 'no delete on location');

-- Admin of tenant A.
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', 'admin');
select lives_ok($$ insert into public.location (name) values ('Dispensa') $$, 'admin creates a location');

-- Chef of tenant A.
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', 'chef');
select is((select count(*)::int from public.location), 2, 'chef reads locations');
select is((select count(*)::int from public.ingredient), 1, 'chef reads ingredients');
select throws_ok($$ insert into public.location (name) values ('Chef') $$,
  '42501', null, 'chef cannot create a location');
update public.ingredient set category = 'Carne';
select is((select category from public.ingredient), null, 'chef updates change nothing');

-- Waiter of tenant A.
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', 'waiter');
select is((select count(*)::int from public.location), 0, 'waiter reads no locations');
select is((select count(*)::int from public.ingredient), 0, 'waiter reads no ingredients');
select throws_ok($$ insert into public.ingredient (name, base_unit) values ('Pane', 'pz') $$,
  '42501', null, 'waiter cannot create an ingredient');

-- A waiter whose token still says owner gets waiter access (role comes from the app_user row).
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', 'owner');
select is((select count(*)::int from public.ingredient), 0, 'a stale owner claim on a waiter reads nothing');

reset role;
select * from finish();
rollback;
