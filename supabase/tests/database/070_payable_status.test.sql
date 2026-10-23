-- M9 step 1: payable status procedure (M9 plan §3.1, §3.2; ADR-009). Transitions and their audit
-- rows, the paid-date rules, the reversal of a payment (AT5), roles (AT6), the tightened guard,
-- the new check, privileges and the widened audit lists.
begin;
create extension if not exists pgtap with schema extensions;
select plan(60);

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
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111',
   'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111',
   'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo');
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111',
   'Fornitore Demo Srl', 'IT12345678903');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, original_filename)
select ('e' || n || '000000-0000-4000-8000-0000000000e' || n)::uuid,
       '11111111-1111-4111-8111-111111111111',
       '11111111-1111-4111-8111-111111111111/2026/e' || n || '000000-0000-4000-8000-0000000000e' || n || '.pdf',
       'application/pdf', 2048, 'fattura' || n || '.pdf'
  from generate_series(1, 4) n;
-- P1 walks the whole matrix, P2 takes the refusals, P3 is the admin's, P4 the direct-write checks.
insert into public.payable (id, tenant_id, invoice_id, supplier_id, gross_amount, credited_amount,
                            amount, due_date, due_date_source, created_by)
select ('90' || n || '00000-0000-4000-8000-0000000000a' || n)::uuid,
       '11111111-1111-4111-8111-111111111111',
       ('e' || n || '000000-0000-4000-8000-0000000000e' || n)::uuid,
       '5a000000-0000-4000-8000-00000000005a', 100, 10, 90, '2026-12-10', 'invoice',
       'a1000000-0000-4000-8000-00000000000a'
  from generate_series(1, 4) n;

create function pg_temp.act_as(auth_id uuid, app_role text, tenant uuid) returns void
  language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated',
    'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
grant execute on function pg_temp.act_as(uuid, text, uuid) to authenticated;
create function pg_temp.today() returns date language sql as $$
  select (now() at time zone 'Europe/Rome')::date
$$;
grant execute on function pg_temp.today() to authenticated;

-- Privileges (before any role switch).
select is(has_function_privilege('anon',
  'public.set_payable_status(uuid, public.payable_status, date, text, boolean)', 'execute'), false,
  'anon cannot execute set_payable_status');
select is(has_function_privilege('service_role',
  'public.set_payable_status(uuid, public.payable_status, date, text, boolean)', 'execute'), false,
  'service_role cannot execute set_payable_status');
select is(has_function_privilege('authenticated',
  'public.set_payable_status(uuid, public.payable_status, date, text, boolean)', 'execute'), true,
  'authenticated can execute set_payable_status');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r,
    unnest(array['app.require_payables_writer()', 'app.require_payables_reader()',
                 'app.payable_allowed_targets(public.payable_status)']) f
   where has_function_privilege(r, f, 'execute')), 0,
  'no API role can execute the app.* payable helpers');

-- The transition matrix (pure function).
select is(app.payable_allowed_targets('open'), array['scheduled', 'paid', 'disputed']::public.payable_status[],
  'open may go to scheduled, paid, disputed');
select is(app.payable_allowed_targets('scheduled'), array['open', 'paid', 'disputed']::public.payable_status[],
  'scheduled may go to open, paid, disputed');
select is(app.payable_allowed_targets('disputed'), array['open', 'scheduled', 'paid']::public.payable_status[],
  'disputed may go to open, scheduled, paid');
select is(app.payable_allowed_targets('paid'), array[]::public.payable_status[],
  'paid has no ordinary target (reversal only)');

set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', 'owner',
  '11111111-1111-4111-8111-111111111111');

-- Owner A walks the matrix on P1.
select is((select public.set_payable_status('90100000-0000-4000-8000-0000000000a1', 'scheduled')
  ->> 'changed')::boolean, true, 'open -> scheduled changes');
select is((select public.set_payable_status('90100000-0000-4000-8000-0000000000a1', 'disputed',
  null, 'Merce non conforme') ->> 'status'), 'disputed', 'scheduled -> disputed, status returned');
select is((select public.set_payable_status('90100000-0000-4000-8000-0000000000a1', 'open')
  ->> 'changed')::boolean, true, 'disputed -> open changes');
select is((select public.set_payable_status('90100000-0000-4000-8000-0000000000a1', 'paid',
  pg_temp.today()) ->> 'paidOn'), pg_temp.today()::text, 'open -> paid returns the paid date');
reset role;

select is((select count(*)::int from public.audit_event
  where entity_id = '90100000-0000-4000-8000-0000000000a1' and action = 'payable.status_changed'
    and entity_type = 'payable'), 4, 'one audit row per change');
select is((select before from public.audit_event
  where entity_id = '90100000-0000-4000-8000-0000000000a1' and after ->> 'status' = 'scheduled'),
  '{"status":"open","paid_on":null}'::jsonb, 'audit before of the first change');
select is((select after from public.audit_event
  where entity_id = '90100000-0000-4000-8000-0000000000a1' and after ->> 'status' = 'paid'),
  jsonb_build_object('status', 'paid', 'paid_on', pg_temp.today()), 'audit after of the payment');
select is((select reason from public.audit_event
  where entity_id = '90100000-0000-4000-8000-0000000000a1' and after ->> 'status' = 'disputed'),
  'Merce non conforme', 'the reason is stored in the audit row');
select is((select created_by from public.audit_event
  where entity_id = '90100000-0000-4000-8000-0000000000a1' and after ->> 'status' = 'scheduled'),
  'a1000000-0000-4000-8000-00000000000a'::uuid, 'created_by is the owner');
select is((select paid_at is not null and paid_on = pg_temp.today() from public.payable
  where id = '90100000-0000-4000-8000-0000000000a1'), true, 'paid_at and paid_on are set when paid');

set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', 'owner',
  '11111111-1111-4111-8111-111111111111');
select is((select public.set_payable_status('90100000-0000-4000-8000-0000000000a1', 'paid',
  pg_temp.today()) ->> 'changed')::boolean, false, 'paid again with the same date is a no-op');
select throws_ok($$ select public.set_payable_status('90100000-0000-4000-8000-0000000000a1',
  'paid', pg_temp.today() - 1) $$, 'P0001', 'payable_paid_locked',
  'paid with another date is locked');
select throws_ok($$ select public.set_payable_status('90100000-0000-4000-8000-0000000000a1',
  'open') $$, 'P0001', 'payable_paid_locked', 'AT5: paid -> open without a reversal is locked');
select throws_ok($$ select public.set_payable_status('90100000-0000-4000-8000-0000000000a1',
  'disputed') $$, 'P0001', 'payable_paid_locked', 'paid -> disputed is locked');
reset role;
select is((select count(*)::int from public.audit_event
  where entity_id = '90100000-0000-4000-8000-0000000000a1'), 4,
  'no-ops and refusals write no audit row');
select is((select status::text || coalesce(paid_on::text, '') from public.payable
  where id = '90100000-0000-4000-8000-0000000000a1'), 'paid' || pg_temp.today()::text,
  'the payable is unchanged by the refusals');

set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', 'owner',
  '11111111-1111-4111-8111-111111111111');
-- Reversal rules (AT5).
select throws_ok($$ select public.set_payable_status('90100000-0000-4000-8000-0000000000a1',
  'open', null, null, true) $$, 'P0001', 'reason_required', 'a reversal needs a reason');
select throws_ok($$ select public.set_payable_status('90100000-0000-4000-8000-0000000000a1',
  'open', null, '   ', true) $$, 'P0001', 'reason_required', 'a blank reason is no reason');
select throws_ok($$ select public.set_payable_status('90100000-0000-4000-8000-0000000000a1',
  'disputed', null, 'Errore', true) $$, 'P0001', 'reversal_target_invalid',
  'a reversal can only go to open');
select throws_ok($$ select public.set_payable_status('90200000-0000-4000-8000-0000000000a2',
  'open', null, 'Errore', true) $$, 'P0001', 'payable_not_paid',
  'a reversal of an unpaid payable is refused');
select is((select public.set_payable_status('90100000-0000-4000-8000-0000000000a1', 'open',
  null, 'Pagamento registrato per errore', true) ->> 'status'), 'open',
  'a reversal with a reason reopens the payable');
reset role;
select is((select paid_on is null and paid_at is null and status = 'open' from public.payable
  where id = '90100000-0000-4000-8000-0000000000a1'), true, 'paid_on and paid_at are cleared');
select is((select reason from public.audit_event
  where entity_id = '90100000-0000-4000-8000-0000000000a1' and action = 'payable.payment_reversed'),
  'Pagamento registrato per errore', 'the reversal is audited with its reason');
select is((select before ->> 'paid_on' from public.audit_event
  where entity_id = '90100000-0000-4000-8000-0000000000a1' and action = 'payable.payment_reversed'),
  pg_temp.today()::text, 'the reversal keeps the reversed paid date in before');

set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', 'owner',
  '11111111-1111-4111-8111-111111111111');
-- Paid-date rules on P2.
select throws_ok($$ select public.set_payable_status('90200000-0000-4000-8000-0000000000a2',
  'paid') $$, 'P0001', 'paid_on_required', 'paid without a date');
select throws_ok($$ select public.set_payable_status('90200000-0000-4000-8000-0000000000a2',
  'scheduled', pg_temp.today()) $$, 'P0001', 'paid_on_not_allowed', 'a date on a non-paid status');
select throws_ok($$ select public.set_payable_status('90200000-0000-4000-8000-0000000000a2',
  'paid', pg_temp.today() + 1) $$, 'P0001', 'paid_on_future', 'a paid date after today');
select lives_ok($$ select public.set_payable_status('90200000-0000-4000-8000-0000000000a2',
  'paid', '2020-01-31') $$, 'a paid date long before the invoice is accepted');
select throws_ok($$ select public.set_payable_status('90300000-0000-4000-8000-0000000000a3',
  'scheduled', null, repeat('x', 201)) $$, 'P0001', 'invalid_request', 'a 201-character reason');
select lives_ok($$ select public.set_payable_status('90300000-0000-4000-8000-0000000000a3',
  'scheduled', null, repeat('x', 200)) $$, 'a 200-character reason is accepted');
select throws_ok($$ select public.set_payable_status('90300000-0000-4000-8000-0000000000a3',
  'scheduled', null, '   ') $$, 'P0001', 'invalid_request', 'a blank reason is refused');
select throws_ok($$ select public.set_payable_status('90900000-0000-4000-8000-0000000000a9',
  'scheduled') $$, 'P0002', 'not_found', 'an unknown payable');
-- A null status is a bad request (invalid_request, 400), not a NOT NULL violation (23502, 500).
select throws_ok($$ select public.set_payable_status('90400000-0000-4000-8000-0000000000a4',
  null) $$, 'P0001', 'invalid_request', 'a null status is invalid_request');
select throws_ok($$ select public.set_payable_status('90400000-0000-4000-8000-0000000000a4',
  null, null, 'una nota', true) $$, 'P0001', 'invalid_request', 'also as a reversal');
select throws_ok($$ select public.set_payable_status('90900000-0000-4000-8000-0000000000a9',
  null) $$, 'P0001', 'invalid_request', 'and before the payable is looked up');

-- Roles (AT6).
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', 'admin',
  '11111111-1111-4111-8111-111111111111');
select lives_ok($$ select public.set_payable_status('90400000-0000-4000-8000-0000000000a4',
  'scheduled') $$, 'admin A may change a status');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', 'chef',
  '11111111-1111-4111-8111-111111111111');
select throws_ok($$ select public.set_payable_status('90400000-0000-4000-8000-0000000000a4',
  'open') $$, '42501', null, 'chef A is refused');
select throws_ok($$ select public.set_payable_status('90400000-0000-4000-8000-0000000000a4',
  null) $$, '42501', null, 'the role is checked before the status: a chef with a null status gets 42501');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', 'waiter',
  '11111111-1111-4111-8111-111111111111');
select throws_ok($$ select public.set_payable_status('90400000-0000-4000-8000-0000000000a4',
  'open') $$, '42501', null, 'waiter A is refused');
select set_config('request.jwt.claims', '{}', true);
select throws_ok($$ select public.set_payable_status('90400000-0000-4000-8000-0000000000a4',
  'open') $$, '42501', null, 'no claims is refused');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', 'owner',
  '22222222-2222-4222-8222-222222222222');
select throws_ok($$ select public.set_payable_status('90400000-0000-4000-8000-0000000000a4',
  'open') $$, 'P0002', 'not_found', 'owner B cannot see A''s payable');
select throws_ok($$ update public.payable set status = 'paid' $$, '42501', null,
  'authenticated has no UPDATE on payable');
reset role;
select is((select status::text from public.payable where id = '90400000-0000-4000-8000-0000000000a4'),
  'scheduled', 'the refused calls changed nothing');

-- The guard (as the migration owner, after the procedure ran in this transaction: the flag is off).
select throws_ok($$ update public.payable set status = 'disputed'
  where id = '90400000-0000-4000-8000-0000000000a4' $$, 'P0001', 'payable_immutable',
  'a direct UPDATE of status is refused, even for the migration owner');
select throws_ok($$ update public.payable set paid_on = '2026-10-01'
  where id = '90400000-0000-4000-8000-0000000000a4' $$, 'P0001', 'payable_immutable',
  'a direct UPDATE of paid_on is refused');
select throws_ok($$ update public.payable set paid_at = now()
  where id = '90400000-0000-4000-8000-0000000000a4' $$, 'P0001', 'payable_immutable',
  'a direct UPDATE of paid_at is refused');
select throws_ok($$ update public.payable set due_date = '2026-12-11'
  where id = '90400000-0000-4000-8000-0000000000a4' $$, 'P0001', 'payable_immutable',
  'a direct UPDATE of due_date is refused');
select throws_ok($$ delete from public.payable
  where id = '90400000-0000-4000-8000-0000000000a4' $$, 'P0001', 'append_only',
  'DELETE is refused');
select throws_ok($$ insert into public.payable (tenant_id, invoice_id, supplier_id, gross_amount,
    credited_amount, amount, due_date, due_date_source, status, paid_at, created_by)
  select tenant_id, invoice_id, supplier_id, 1, 0, 1, due_date, 'invoice', 'paid', now(), created_by
    from public.payable limit 1 $$, '23514', null,
  'payable_paid_on_ck: paid without paid_on is refused (23514 before the unique key)');
select is((select count(*)::int from pg_constraint
  where conrelid = 'public.payable'::regclass and conname = 'payable_paid_on_ck'), 1,
  'the paid_on check exists');

-- Audit lists: M7, M8 and M9 values are all accepted.
select lives_ok($$ insert into public.audit_event (tenant_id, entity_type, entity_id, action, created_by)
  select '11111111-1111-4111-8111-111111111111', e, gen_random_uuid(), a,
         'a1000000-0000-4000-8000-00000000000a'
    from unnest(array['invoice', 'ingredient', 'recipe', 'tenant', 'payable']) e,
         unnest(array['invoice.approved', 'invoice.rejected', 'invoice.duplicate_cleared',
                      'ingredient.allergens_confirmed', 'recipe.deactivated', 'recipe.reactivated',
                      'tenant.settings_changed', 'payable.status_changed',
                      'payable.payment_reversed']) a $$,
  'every entity type and action of M7, M8 and M9 is accepted');
select throws_ok($$ insert into public.audit_event (tenant_id, entity_type, entity_id, action, created_by)
  values ('11111111-1111-4111-8111-111111111111', 'payable', gen_random_uuid(), 'payable.deleted',
          'a1000000-0000-4000-8000-00000000000a') $$, '23514', null, 'an unknown action is refused');

select * from finish();
rollback;
