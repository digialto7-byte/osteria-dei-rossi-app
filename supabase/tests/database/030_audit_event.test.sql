-- M5 step 1: audit_event (M5 plan §3.3). Owner and admin of the tenant read its events; chef and
-- waiter read none; nobody writes through the API; the table's checks hold.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

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

-- Fixture rows are inserted as the migration owner (no API role can insert).
insert into public.audit_event (tenant_id, entity_type, entity_id, action, after, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'invoice', 'e1000000-0000-4000-8000-0000000000e1',
   'invoice.approved', '{"status":"approved"}', 'a1000000-0000-4000-8000-00000000000a'),
  ('22222222-2222-4222-8222-222222222222', 'invoice', 'e2000000-0000-4000-8000-0000000000e2',
   'invoice.rejected', '{"status":"rejected"}', 'b1000000-0000-4000-8000-00000000000b');

-- Checks (as the migration owner).
select throws_ok(
  $$ insert into public.audit_event (tenant_id, entity_type, entity_id, action, created_by)
     values ('11111111-1111-4111-8111-111111111111', 'invoice',
             'e1000000-0000-4000-8000-0000000000e1', 'foo',
             'a1000000-0000-4000-8000-00000000000a') $$,
  '23514', null, 'an unknown action is refused');
select throws_ok(
  $$ insert into public.audit_event (tenant_id, entity_type, entity_id, action, created_by)
     values ('11111111-1111-4111-8111-111111111111', 'recipe',
             'e1000000-0000-4000-8000-0000000000e1', 'invoice.approved',
             'a1000000-0000-4000-8000-00000000000a') $$,
  '23514', null, 'an unknown entity type is refused');
select throws_ok(
  $$ insert into public.audit_event (tenant_id, entity_type, entity_id, action, reason, created_by)
     values ('11111111-1111-4111-8111-111111111111', 'invoice',
             'e1000000-0000-4000-8000-0000000000e1', 'invoice.rejected', repeat('x', 201),
             'a1000000-0000-4000-8000-00000000000a') $$,
  '23514', null, 'a 201-character reason is refused');
select throws_ok(
  $$ insert into public.audit_event (tenant_id, entity_type, entity_id, action, reason, created_by)
     values ('11111111-1111-4111-8111-111111111111', 'invoice',
             'e1000000-0000-4000-8000-0000000000e1', 'invoice.rejected', '   ',
             'a1000000-0000-4000-8000-00000000000a') $$,
  '23514', null, 'a blank reason is refused (store null instead)');
select lives_ok(
  $$ insert into public.audit_event (tenant_id, entity_type, entity_id, action, reason, created_by)
     values ('11111111-1111-4111-8111-111111111111', 'invoice',
             'e1000000-0000-4000-8000-0000000000e1', 'invoice.rejected', repeat('x', 200),
             'a1000000-0000-4000-8000-00000000000a') $$,
  'a 200-character reason is accepted');
select throws_ok(
  $$ insert into public.audit_event (tenant_id, entity_type, entity_id, action)
     values ('11111111-1111-4111-8111-111111111111', 'invoice',
             'e1000000-0000-4000-8000-0000000000e1', 'invoice.approved') $$,
  '23502', null, 'created_by is required (no caller, no default)');

create function pg_temp.act_as(auth_id uuid, app_role text, tenant uuid) returns void
  language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated',
    'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
grant execute on function pg_temp.act_as(uuid, text, uuid) to authenticated;

set local role authenticated;

select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', 'owner',
  '11111111-1111-4111-8111-111111111111');
select is((select count(*)::int from public.audit_event), 2,
  'owner A reads A''s events (the fixture and the 200-character one) and none of B''s');
select is((select count(*)::int from public.audit_event where tenant_id = '22222222-2222-4222-8222-222222222222'),
  0, 'owner A reads 0 events of B');
select throws_ok(
  $$ insert into public.audit_event (entity_type, entity_id, action)
     values ('invoice', 'e1000000-0000-4000-8000-0000000000e1', 'invoice.approved') $$,
  '42501', null, 'authenticated cannot insert an audit event');

select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', 'admin',
  '11111111-1111-4111-8111-111111111111');
select is((select count(*)::int from public.audit_event), 2, 'admin A reads the tenant''s events');

select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', 'chef',
  '11111111-1111-4111-8111-111111111111');
select is((select count(*)::int from public.audit_event), 0, 'chef reads no audit events');

select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', 'waiter',
  '11111111-1111-4111-8111-111111111111');
select is((select count(*)::int from public.audit_event), 0, 'waiter reads no audit events');

select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', 'owner',
  '22222222-2222-4222-8222-222222222222');
select is((select count(*)::int from public.audit_event), 1, 'owner B reads only B''s event');

reset role;

select has_index('public', 'audit_event', 'audit_event_entity_idx', 'the entity lookup index exists');
select is((select created_by from public.audit_event where action = 'invoice.rejected'
            and tenant_id = '22222222-2222-4222-8222-222222222222'),
  'b1000000-0000-4000-8000-00000000000b'::uuid, 'created_by is stored');

select * from finish();
rollback;
