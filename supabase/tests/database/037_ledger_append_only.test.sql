-- M5 acceptance test 6 (database part): UPDATE, DELETE and TRUNCATE on the audit and ledger
-- tables raise for every role, the migration owner included. Each table is tested four ways: the
-- API role has no grant (42501); with a grant added inside this transaction the trigger itself
-- still raises `append_only` (so the trigger, not only the grant, protects the table); the
-- migration owner is stopped by the trigger; TRUNCATE is stopped by the statement trigger.
-- Later steps of M5 extend this file with the ledger tables.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email) values ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare A');
insert into public.audit_event (tenant_id, entity_type, entity_id, action, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'invoice', 'e1000000-0000-4000-8000-0000000000e1',
   'invoice.approved', 'a1000000-0000-4000-8000-00000000000a');

-- audit_event.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
  'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'owner')::text, true);
select throws_ok($$ update public.audit_event set reason = 'x' $$, '42501', null,
  'audit_event: UPDATE as owner A has no grant');
select throws_ok($$ delete from public.audit_event $$, '42501', null,
  'audit_event: DELETE as owner A has no grant');
reset role;

set local role service_role;
select throws_ok($$ update public.audit_event set reason = 'x' $$, '42501', null,
  'audit_event: UPDATE as service_role has no grant');
reset role;

-- The trigger, not only the grant: give service_role the privileges and try again.
grant update, delete on public.audit_event to service_role;
set local role service_role;
select throws_ok($$ update public.audit_event set reason = 'x' $$, 'P0001', 'append_only',
  'audit_event: UPDATE as service_role with a grant still raises append_only');
select throws_ok($$ delete from public.audit_event $$, 'P0001', 'append_only',
  'audit_event: DELETE as service_role with a grant still raises append_only');
reset role;

-- The migration owner (the test session's role).
select throws_ok($$ update public.audit_event set reason = 'x' $$, 'P0001', 'append_only',
  'audit_event: UPDATE as the migration owner raises append_only');
select throws_ok($$ truncate public.audit_event $$, 'P0001', 'append_only',
  'audit_event: TRUNCATE as the migration owner raises append_only');

select * from finish();
rollback;
