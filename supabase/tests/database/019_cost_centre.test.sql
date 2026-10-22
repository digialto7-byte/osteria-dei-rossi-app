-- M4 step 1: cost_centre (plan §3.2). Owner/admin read and create; chef and waiter see nothing;
-- no delete for anyone; names are unique per tenant after normalisation.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

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

-- Rows the tenant A users must never see (B) and rows chef and waiter must not see (A).
insert into public.cost_centre (tenant_id, name) values
  ('22222222-2222-4222-8222-222222222222', 'Gas B'),
  ('11111111-1111-4111-8111-111111111111', 'Gas');

create function pg_temp.act_as(auth_id uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated',
    'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', app_role)::text, true)
$$;
grant execute on function pg_temp.act_as(uuid, text) to authenticated;

set local role authenticated;

-- Owner of tenant A.
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', 'owner');
select lives_ok($$ insert into public.cost_centre (name) values ('Pulizie') $$,
  'owner creates a cost centre');
select is((select tenant_id from public.cost_centre where name = 'Pulizie'),
  '11111111-1111-4111-8111-111111111111'::uuid, 'tenant_id defaults to the caller''s tenant');
select is((select created_by from public.cost_centre where name = 'Pulizie'),
  'a1000000-0000-4000-8000-00000000000a'::uuid, 'created_by defaults to the caller');
select is((select count(*)::int from public.cost_centre), 2,
  'owner A reads A''s centres and none of B''s');
select throws_ok($$ insert into public.cost_centre (name) values (' PULIZIE  ') $$,
  '23505', null, 'a name differing only in case or spaces is a duplicate');
select throws_ok($$ insert into public.cost_centre (name) values (repeat('x', 61)) $$,
  '23514', null, 'a 61-character name is refused');
select throws_ok($$ insert into public.cost_centre (name) values ('   ') $$,
  '23514', null, 'a blank name is refused');
select throws_ok($$ delete from public.cost_centre $$, '42501', null, 'no delete');
select throws_ok(
  $$ insert into public.cost_centre (tenant_id, name)
     values ('22222222-2222-4222-8222-222222222222', 'X') $$,
  '42501', null, 'tenant_id cannot be set by the caller');

-- Admin of tenant A.
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', 'admin');
select lives_ok($$ insert into public.cost_centre (name) values ('Coperti') $$,
  'admin creates a cost centre');
select is((select count(*)::int from public.cost_centre), 3, 'admin reads the tenant''s centres');

-- Chef of tenant A.
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', 'chef');
select is((select count(*)::int from public.cost_centre), 0, 'chef reads no cost centres');
select throws_ok($$ insert into public.cost_centre (name) values ('Chef') $$,
  '42501', null, 'chef cannot create a cost centre');

-- Waiter of tenant A.
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', 'waiter');
select is((select count(*)::int from public.cost_centre), 0, 'waiter reads no cost centres');

reset role;
select * from finish();
rollback;
