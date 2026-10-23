-- M9 step 2: payable_list, payable_detail and supplier_statement (M9 plan §3.2, AT4, AT6).
-- Fixture, tenant A / supplier S1 "Fornitore Demo Srl" (days relative to today at the venue):
--   L1 open due +10 (100,00)      L2 scheduled due +2 (200,00)    L3 disputed due -1 (300,00)
--   L4 paid due -5, paid -2 (400,00)                              L5 open due -10 (500,00)
-- Supplier S2 "Fornitore Demo Due": one open payable (50,00). Supplier SX "Fornitore Demo Tre":
-- the statement case (AT4): 1.000,00 (credited 50,00) open, 500,00 open, 300,00 (credited 20,00)
-- disputed, and one paid 200,00. Tenant B has its own supplier and payable.
begin;
create extension if not exists pgtap with schema extensions;
select plan(72);

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
   'Fornitore Demo Srl', 'IT12345678903'),
  ('5c000000-0000-4000-8000-00000000005c', '11111111-1111-4111-8111-111111111111',
   'Fornitore Demo Due', 'IT01234567897'),
  ('5d000000-0000-4000-8000-00000000005d', '11111111-1111-4111-8111-111111111111',
   'Fornitore Demo Tre', 'IT00000000000'),
  ('5b000000-0000-4000-8000-00000000005b', '22222222-2222-4222-8222-222222222222',
   'Fornitore B Srl', 'IT00000000000');

create function pg_temp.today() returns date language sql as $$
  select (now() at time zone 'Europe/Rome')::date
$$;
grant execute on function pg_temp.today() to authenticated;
create function pg_temp.id(prefix text, n int) returns uuid language sql as $$
  select (prefix || '-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
-- One invoice and its payable (inserted as the migration owner; the guard only watches UPDATE).
create function pg_temp.mk(n int, tenant uuid, supplier uuid, creator uuid, gross numeric,
                           credited numeric, due int, status text, paid_days_ago int default null)
  returns void language plpgsql as $$
begin
  insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, number_raw,
                              invoice_date)
  values (pg_temp.id('e0000000', n), tenant,
          tenant || '/2026/' || pg_temp.id('e0000000', n) || '.pdf', 'application/pdf', 2048,
          'FT ' || n, '2026-10-01');
  insert into public.payable (id, tenant_id, invoice_id, supplier_id, gross_amount, credited_amount,
                              amount, due_date, due_date_source, status, paid_at, paid_on, created_by)
  values (pg_temp.id('90000000', n), tenant, pg_temp.id('e0000000', n), supplier, gross, credited,
          gross - credited, pg_temp.today() + due, 'invoice', status::public.payable_status,
          case when status = 'paid' then now() end,
          case when status = 'paid' then pg_temp.today() - paid_days_ago end, creator);
end
$$;
select pg_temp.mk(1, '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a',
  'a1000000-0000-4000-8000-00000000000a', 100, 0, 10, 'open');
select pg_temp.mk(2, '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a',
  'a1000000-0000-4000-8000-00000000000a', 200, 0, 2, 'scheduled');
select pg_temp.mk(3, '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a',
  'a1000000-0000-4000-8000-00000000000a', 300, 0, -1, 'disputed');
select pg_temp.mk(4, '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a',
  'a1000000-0000-4000-8000-00000000000a', 400, 0, -5, 'paid', 2);
select pg_temp.mk(5, '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a',
  'a1000000-0000-4000-8000-00000000000a', 500, 0, -10, 'open');
select pg_temp.mk(6, '11111111-1111-4111-8111-111111111111', '5c000000-0000-4000-8000-00000000005c',
  'a1000000-0000-4000-8000-00000000000a', 50, 0, 3, 'open');
select pg_temp.mk(7, '11111111-1111-4111-8111-111111111111', '5d000000-0000-4000-8000-00000000005d',
  'a1000000-0000-4000-8000-00000000000a', 1000, 50, 5, 'open');
select pg_temp.mk(8, '11111111-1111-4111-8111-111111111111', '5d000000-0000-4000-8000-00000000005d',
  'a1000000-0000-4000-8000-00000000000a', 500, 0, 6, 'scheduled');
select pg_temp.mk(9, '11111111-1111-4111-8111-111111111111', '5d000000-0000-4000-8000-00000000005d',
  'a1000000-0000-4000-8000-00000000000a', 300, 20, 7, 'disputed');
select pg_temp.mk(10, '11111111-1111-4111-8111-111111111111', '5d000000-0000-4000-8000-00000000005d',
  'a1000000-0000-4000-8000-00000000000a', 200, 0, -3, 'paid', 1);
select pg_temp.mk(11, '22222222-2222-4222-8222-222222222222', '5b000000-0000-4000-8000-00000000005b',
  'b1000000-0000-4000-8000-00000000000b', 77, 0, 4, 'open');

create function pg_temp.act_as(auth_id uuid, app_role text, tenant uuid) returns void
  language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated',
    'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
grant execute on function pg_temp.act_as(uuid, text, uuid) to authenticated;
grant execute on function pg_temp.id(text, int) to authenticated;

-- Privileges.
select is((select count(*)::int from unnest(array['anon', 'service_role']) r,
    unnest(array['public.payable_list(text, uuid, date, uuid, integer)',
                 'public.payable_detail(uuid)', 'public.supplier_statement(uuid)']) f
   where has_function_privilege(r, f, 'execute')), 0,
  'anon and service_role cannot execute the read functions');

set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', 'owner',
  '11111111-1111-4111-8111-111111111111');

-- List.
create temp table r as select 'unpaid'::text k, public.payable_list('unpaid') j;
grant select on r to authenticated;
select is((select jsonb_array_length(j -> 'items') from r where k = 'unpaid'), 8,
  'unpaid: eight open, scheduled or disputed payables of tenant A');
select is((select jsonb_agg(x ->> 'id' order by ordinality)
  from r, jsonb_array_elements(j -> 'items') with ordinality x(x, ordinality) where k = 'unpaid'
   and ordinality <= 4),
  jsonb_build_array(pg_temp.id('90000000', 5)::text, pg_temp.id('90000000', 3)::text,
                    pg_temp.id('90000000', 2)::text, pg_temp.id('90000000', 6)::text),
  'unpaid is ordered by due date, then id');
select is((select j -> 'items' -> 0 ->> 'daysToDue' from r where k = 'unpaid'), '-10',
  'daysToDue of the oldest is -10');
select is((select (j -> 'items' -> 0 ->> 'overdue')::boolean from r where k = 'unpaid'), true,
  'an open payable past its due date is overdue');
select is((select (j -> 'items' -> 2 ->> 'overdue')::boolean from r where k = 'unpaid'), false,
  'a payable due in 2 days is not overdue');
select is((select j -> 'items' -> 0 ->> 'invoiceNumber' from r where k = 'unpaid'), 'FT 5',
  'the item carries the invoice number');
select is((select j -> 'items' -> 0 ->> 'supplierName' from r where k = 'unpaid'),
  'Fornitore Demo Srl', 'the item carries the supplier name');
select is((select j -> 'items' -> 0 ->> 'amount' from r where k = 'unpaid'), '500.00',
  'amounts are JSON numbers with two decimals');
select is((select j -> 'items' -> 0 ->> 'dueDate' from r where k = 'unpaid'),
  (pg_temp.today() - 10)::text, 'dates are ISO strings');
select is((select j ->> 'today' from r where k = 'unpaid'), pg_temp.today()::text,
  'today is the venue date');
select is((select (j -> 'totals' ->> 'count') || '/' || (j -> 'totals' ->> 'amount')
  from r where k = 'unpaid'), '8/2880.00', 'totals cover all unpaid rows (8, 2.880,00)');
select is((select j -> 'nextCursor' from r where k = 'unpaid'), 'null'::jsonb,
  'no next page for 8 rows with the default limit');

select is((select jsonb_array_length(public.payable_list('paid') -> 'items')), 2,
  'paid: two paid payables');
select is((select public.payable_list('paid') -> 'items' -> 0 ->> 'id'),
  pg_temp.id('90000000', 10)::text, 'paid is ordered by paid date, newest first');
select is((select public.payable_list('paid') -> 'items' -> 0 ->> 'paidOn'),
  (pg_temp.today() - 1)::text, 'a paid item carries its paid date');
select is((select (public.payable_list('paid') -> 'items' -> 1 ->> 'overdue')::boolean), false,
  'a paid payable is never overdue');
select is((select public.payable_list('paid') -> 'totals'), 'null'::jsonb,
  'totals only come with the unpaid filter');
select is((select jsonb_array_length(public.payable_list('all') -> 'items')), 10,
  'all: ten payables of tenant A');
select is((select public.payable_list('all') -> 'items' -> 0 ->> 'id'),
  pg_temp.id('90000000', 1)::text, 'all is ordered by due date, newest first');

-- Supplier filter.
select is((select jsonb_array_length(public.payable_list('unpaid', '5a000000-0000-4000-8000-00000000005a')
  -> 'items')), 4, 'the supplier filter keeps supplier S1''s four unpaid payables');
select is((select public.payable_list('unpaid', '5a000000-0000-4000-8000-00000000005a')
  -> 'totals' ->> 'amount'), '1100.00', 'the totals follow the supplier filter');
select is((select jsonb_array_length(public.payable_list('unpaid', '5b000000-0000-4000-8000-00000000005b')
  -> 'items')), 0, 'another tenant''s supplier id matches nothing');

-- Pages (limit 2): no gap, no repeat.
create temp table pg1 as select public.payable_list('unpaid', null, null, null, 2) j;
grant select on pg1 to authenticated;
select is((select jsonb_array_length(j -> 'items') from pg1), 2, 'limit 2 returns two items');
select isnt((select j -> 'nextCursor' from pg1), 'null'::jsonb, 'and a next cursor');
select is((select j -> 'nextCursor' ->> 'id' from pg1), pg_temp.id('90000000', 3)::text,
  'the cursor is the last returned item');
create temp table pg2 as select public.payable_list('unpaid', null,
  (select (j -> 'nextCursor' ->> 'date')::date from pg1),
  (select (j -> 'nextCursor' ->> 'id')::uuid from pg1), 2) j;
grant select on pg2 to authenticated;
create temp table pg3 as select public.payable_list('unpaid', null,
  (select (j -> 'nextCursor' ->> 'date')::date from pg2),
  (select (j -> 'nextCursor' ->> 'id')::uuid from pg2), 2) j;
grant select on pg3 to authenticated;
create temp table pg4 as select public.payable_list('unpaid', null,
  (select (j -> 'nextCursor' ->> 'date')::date from pg3),
  (select (j -> 'nextCursor' ->> 'id')::uuid from pg3), 2) j;
grant select on pg4 to authenticated;
select is((select (select jsonb_agg(x ->> 'id') from jsonb_array_elements(a.j -> 'items') x)
    || (select jsonb_agg(x ->> 'id') from jsonb_array_elements(b.j -> 'items') x)
    || (select jsonb_agg(x ->> 'id') from jsonb_array_elements(c.j -> 'items') x)
    || (select jsonb_agg(x ->> 'id') from jsonb_array_elements(d.j -> 'items') x)
   from pg1 a, pg2 b, pg3 c, pg4 d),
  (select jsonb_agg(x ->> 'id') from r, jsonb_array_elements(j -> 'items') x where k = 'unpaid'),
  'four pages of two walk the eight rows without a gap or a repeat');
select is((select j -> 'nextCursor' from pg4), 'null'::jsonb, 'the last page has no cursor');
select is((select jsonb_array_length(j -> 'items') from pg4), 2, 'the last page holds two rows');
select is((select public.payable_list('paid', null, null, null, 1) -> 'nextCursor' ->> 'date'),
  (pg_temp.today() - 1)::text, 'the cursor of the paid filter is the paid date');
select is((select public.payable_list('paid', null, pg_temp.today() - 1, pg_temp.id('90000000', 10), 5)
  -> 'items' -> 0 ->> 'id'), pg_temp.id('90000000', 4)::text,
  'the paid page continues strictly after the cursor (descending)');

select throws_ok($$ select public.payable_list('foo') $$, 'P0001', 'invalid_request',
  'an unknown filter is refused');
select throws_ok($$ select public.payable_list('unpaid', null, null, null, 0) $$, 'P0001',
  'invalid_request', 'a limit of 0 is refused');
select throws_ok($$ select public.payable_list('unpaid', null, pg_temp.today(), null, 5) $$,
  'P0001', 'invalid_request', 'half a cursor is refused');

-- Detail: the allowed statuses per status (the matrix of plan §3.1.3).
select is((select public.payable_detail(pg_temp.id('90000000', 1)) ->> 'allowedStatuses'),
  '["scheduled", "paid", "disputed"]', 'open: scheduled, paid, disputed');
select is((select public.payable_detail(pg_temp.id('90000000', 2)) ->> 'allowedStatuses'),
  '["open", "paid", "disputed"]', 'scheduled: open, paid, disputed');
select is((select public.payable_detail(pg_temp.id('90000000', 3)) ->> 'allowedStatuses'),
  '["open", "scheduled", "paid"]', 'disputed: open, scheduled, paid');
select is((select public.payable_detail(pg_temp.id('90000000', 4)) ->> 'allowedStatuses'),
  '[]', 'paid: none');
select is((select (public.payable_detail(pg_temp.id('90000000', 4)) ->> 'canReversePayment')::boolean),
  true, 'a paid payable can be reversed');
select is((select (public.payable_detail(pg_temp.id('90000000', 1)) ->> 'canReversePayment')::boolean),
  false, 'an open payable cannot');
select is((select public.payable_detail(pg_temp.id('90000000', 7)) -> 'payable' ->> 'creditedAmount'),
  '50.00', 'the detail carries the credited amount');
select is((select public.payable_detail(pg_temp.id('90000000', 7)) -> 'payable' ->> 'grossAmount'),
  '1000.00', 'and the gross amount');
select is((select public.payable_detail(pg_temp.id('90000000', 7)) -> 'payable' ->> 'dueDateSource'),
  'invoice', 'and the due date source');

-- History: created, then each audit row in order, with the name of who did it.
select public.set_payable_status(pg_temp.id('90000000', 1), 'scheduled');
select public.set_payable_status(pg_temp.id('90000000', 1), 'disputed', null, 'Merce non conforme');
select public.set_payable_status(pg_temp.id('90000000', 1), 'paid', pg_temp.today());
create temp table h as select public.payable_detail(pg_temp.id('90000000', 1)) -> 'history' j;
grant select on h to authenticated;
select is((select count(distinct created_at)::int from public.audit_event
  where entity_type = 'payable' and entity_id = pg_temp.id('90000000', 1)), 3,
  'each change gets its own timestamp, even inside one transaction (history order is stable)');
select is((select jsonb_array_length(j) from h), 4, 'history: created plus three changes');
select is((select j -> 0 ->> 'action' from h), 'created', 'the first entry is the creation');
select is((select string_agg(x ->> 'toStatus', ',' order by ordinality)
  from h, jsonb_array_elements(j) with ordinality x(x, ordinality)), 'open,scheduled,disputed,paid',
  'the entries follow the order of the changes, even inside one transaction');
select is((select j -> 2 ->> 'reason' from h), 'Merce non conforme', 'a reason is shown');
select is((select j -> 3 ->> 'paidOn' from h), pg_temp.today()::text, 'and the paid date');
select is((select j -> 1 ->> 'byName' from h), 'Titolare Demo', 'byName is the display name');
select is((select j -> 1 ->> 'fromStatus' from h), 'open', 'fromStatus is kept');
select throws_ok($$ select public.payable_detail(pg_temp.id('90000000', 99)) $$, 'P0002', 'not_found',
  'an unknown payable');

-- AT4: the statement.
create temp table st as select public.supplier_statement('5d000000-0000-4000-8000-00000000005d') j;
grant select on st to authenticated;
select is((select j -> 'totals' ->> 'invoicesTotal' from st), '1800.00', 'AT4: invoices total 1.800,00');
select is((select j -> 'totals' ->> 'creditsTotal' from st), '70.00', 'AT4: credits total 70,00');
select is((select j -> 'totals' ->> 'balance' from st), '1730.00', 'AT4: balance 1.730,00');
select is((select (j -> 'totals' ->> 'balance')::numeric from st),
  (select sum(amount) from public.payable
    where supplier_id = '5d000000-0000-4000-8000-00000000005d' and status <> 'paid'),
  'AT4: the balance equals the sum of the unpaid payable amounts');
select is((select j -> 'totals' ->> 'disputedAmount' from st), '280.00', 'AT4: disputed share 280,00');
select is((select jsonb_array_length(j -> 'credits') from st), 2, 'two credited invoices');
select is((select jsonb_array_length(j -> 'invoices') from st), 3, 'the paid invoice is absent');
select is((select j -> 'supplier' ->> 'name' from st), 'Fornitore Demo Tre', 'the supplier block');
select is((select j ->> 'asOf' from st), pg_temp.today()::text, 'asOf is today at the venue');
select is(public.supplier_statement('5c000000-0000-4000-8000-00000000005c') -> 'totals' ->> 'creditsTotal',
  '0.00', 'credits total is zero when nothing is credited');

-- Roles (AT6).
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', 'chef',
  '11111111-1111-4111-8111-111111111111');
select throws_ok($$ select public.payable_list() $$, '42501', null, 'chef: list refused');
select throws_ok($$ select public.payable_detail(pg_temp.id('90000000', 1)) $$, '42501', null,
  'chef: detail refused');
select throws_ok($$ select public.supplier_statement('5d000000-0000-4000-8000-00000000005d') $$,
  '42501', null, 'chef: statement refused');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', 'waiter',
  '11111111-1111-4111-8111-111111111111');
select throws_ok($$ select public.payable_list() $$, '42501', null, 'waiter: list refused');
select throws_ok($$ select public.payable_detail(pg_temp.id('90000000', 1)) $$, '42501', null,
  'waiter: detail refused');
select throws_ok($$ select public.supplier_statement('5d000000-0000-4000-8000-00000000005d') $$,
  '42501', null, 'waiter: statement refused');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', 'admin',
  '11111111-1111-4111-8111-111111111111');
select is((select jsonb_array_length(public.payable_list() -> 'items')), 7, 'admin A reads the list (L1 is paid by now)');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', 'owner',
  '22222222-2222-4222-8222-222222222222');
select throws_ok($$ select public.payable_detail(pg_temp.id('90000000', 1)) $$, 'P0002', 'not_found',
  'owner B: A''s payable is not found');
select throws_ok($$ select public.supplier_statement('5d000000-0000-4000-8000-00000000005d') $$,
  'P0002', 'not_found', 'owner B: A''s supplier is not found');
select is((select jsonb_agg(x ->> 'supplierName') from jsonb_array_elements(
  public.payable_list('all') -> 'items') x), '["Fornitore B Srl"]'::jsonb,
  'owner B''s list holds only B''s payable');

reset role;
select * from finish();
rollback;
