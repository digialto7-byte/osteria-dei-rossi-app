-- M25b step 6 (docs/plans/2026-11-01-m25b-navigation.md §3.2, §5): payable_list learns a date range (p_from, p_to) on the list's own key date:
-- the due date for 'unpaid' and 'all', the payment date for 'paid'. Totals (the unpaid ones) follow the supplier and the range.
-- Fixture, all dates fixed (never relative to now(), so the test holds at any hour and day):
--   tenant A, supplier S1 "Fornitore Demo A", S2 "Fornitore Demo B"
--   P1 S1 open due 1998-11-05 (100,00)      P2 S1 open due 1998-11-20 (200,00)      P3 S2 open due 1998-11-10 (300,00)
--   P4 S1 paid, due 1998-11-01, paid_on 1998-11-03 (400,00)
--   tenant B: one open payable due 1998-11-10 (77,00)
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

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
   'Fornitore Demo A', 'IT12345678903'),
  ('5c000000-0000-4000-8000-00000000005c', '11111111-1111-4111-8111-111111111111',
   'Fornitore Demo B', 'IT01234567897'),
  ('5b000000-0000-4000-8000-00000000005b', '22222222-2222-4222-8222-222222222222',
   'Fornitore B Srl', 'IT00000000000');

create function pg_temp.id(prefix text, n int) returns uuid language sql as $$
  select (prefix || '-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
grant execute on function pg_temp.id(text, int) to authenticated;
-- One invoice and its payable (inserted as the migration owner). The paid payable carries a fixed paid_on.
create function pg_temp.mk(n int, tenant uuid, supplier uuid, creator uuid, gross numeric,
                           due date, status text, paid_on date default null)
  returns void language plpgsql as $$
begin
  insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, number_raw,
                              invoice_date)
  values (pg_temp.id('e0000000', n), tenant,
          tenant || '/2026/' || pg_temp.id('e0000000', n) || '.pdf', 'application/pdf', 2048,
          'FT ' || n, '1998-10-01');
  insert into public.payable (id, tenant_id, invoice_id, supplier_id, gross_amount, credited_amount,
                              amount, due_date, due_date_source, status, paid_at, paid_on, created_by)
  values (pg_temp.id('90000000', n), tenant, pg_temp.id('e0000000', n), supplier, gross, 0,
          gross, due, 'invoice', status::public.payable_status,
          case when status = 'paid' then timestamptz '1998-11-03 10:00:00+01' end, paid_on, creator);
end
$$;
select pg_temp.mk(1, '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a',
  'a1000000-0000-4000-8000-00000000000a', 100, date '1998-11-05', 'open');
select pg_temp.mk(2, '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a',
  'a1000000-0000-4000-8000-00000000000a', 200, date '1998-11-20', 'open');
select pg_temp.mk(3, '11111111-1111-4111-8111-111111111111', '5c000000-0000-4000-8000-00000000005c',
  'a1000000-0000-4000-8000-00000000000a', 300, date '1998-11-10', 'open');
select pg_temp.mk(4, '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a',
  'a1000000-0000-4000-8000-00000000000a', 400, date '1998-11-01', 'paid', date '1998-11-03');
select pg_temp.mk(5, '22222222-2222-4222-8222-222222222222', '5b000000-0000-4000-8000-00000000005b',
  'b1000000-0000-4000-8000-00000000000b', 77, date '1998-11-10', 'open');
analyze public.payable;

create function pg_temp.act_as(auth_id uuid, app_role text, tenant uuid) returns void
  language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated',
    'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
grant execute on function pg_temp.act_as(uuid, text, uuid) to authenticated;
-- The invoice numbers of a reply's items, in order: 'FT 3,FT 1'.
create function pg_temp.nums(r jsonb) returns text language sql as $$
  select coalesce(string_agg(i ->> 'invoiceNumber', ',' order by o), '')
    from jsonb_array_elements(r -> 'items') with ordinality t(i, o)
$$;
grant execute on function pg_temp.nums(jsonb) to authenticated;

-- Definer shape (as the migration owner, before switching role) -------------------------------------------------------------
select is((select count(*)::int from pg_proc where proname = 'payable_list' and pronamespace = 'public'::regnamespace), 1,
  'exactly one public.payable_list');
select is((select pg_get_function_identity_arguments(oid) from pg_proc
            where proname = 'payable_list' and pronamespace = 'public'::regnamespace),
  'p_filter text, p_supplier uuid, p_cursor_date date, p_cursor_id uuid, p_limit integer, p_from date, p_to date',
  'the signature has the two new parameters');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc
            where proname = 'payable_list' and pronamespace = 'public'::regnamespace),
  'payable_list stays security definer with an empty search_path');
select is((select count(*)::int from unnest(array['anon', 'service_role']) r
            where has_function_privilege(r,
              'public.payable_list(text, uuid, date, uuid, integer, date, date)', 'execute')), 0,
  'anon and service_role cannot execute it');
select ok(has_function_privilege('authenticated',
  'public.payable_list(text, uuid, date, uuid, integer, date, date)', 'execute'),
  'authenticated can execute it');

set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', 'owner',
  '11111111-1111-4111-8111-111111111111');

-- Unpaid: the range is on the due date -------------------------------------------------------------------------------------------
select is(pg_temp.nums(public.payable_list('unpaid', null, null, null, 50, '1998-11-06', '1998-11-15')), 'FT 3',
  'unpaid, both sides: only P3 (due 1998-11-10)');
select is(public.payable_list('unpaid', null, null, null, 50, '1998-11-06', '1998-11-15') -> 'totals',
  jsonb_build_object('count', 1, 'amount', 300.00), 'the unpaid totals follow the range');
select is(pg_temp.nums(public.payable_list('unpaid', '5a000000-0000-4000-8000-00000000005a', null, null, 50, null, '1998-11-10')),
  'FT 1', 'unpaid, supplier S1 and only "to": P1');
select is(public.payable_list('unpaid', '5a000000-0000-4000-8000-00000000005a', null, null, 50, null, '1998-11-10') -> 'totals',
  jsonb_build_object('count', 1, 'amount', 100.00), 'the totals follow supplier and "to"');
select is(pg_temp.nums(public.payable_list('unpaid', null, null, null, 50, '1998-11-10', null)), 'FT 3,FT 2',
  'unpaid, only "from": P3 then P2, ascending');
select is(public.payable_list('unpaid', null, null, null, 50, '1998-11-10', null) -> 'totals',
  jsonb_build_object('count', 2, 'amount', 500.00), 'the totals follow "from"');
select is(pg_temp.nums(public.payable_list('unpaid', null, null, null, 50, '1998-11-05', '1998-11-05')), 'FT 1',
  'the bounds are inclusive');

-- Paid: the range is on the payment date, not the due date -----------------------------------------------------------------------
select is(pg_temp.nums(public.payable_list('paid', null, null, null, 50, '1998-11-03', '1998-11-03')), 'FT 4',
  'paid: found by paid_on 1998-11-03');
select is(pg_temp.nums(public.payable_list('paid', null, null, null, 50, '1998-11-01', '1998-11-01')), '',
  'paid: not found by its due date 1998-11-01');
select is(public.payable_list('paid', null, null, null, 50, '1998-11-01', '1998-11-01') -> 'totals', 'null'::jsonb,
  'paid has no totals, as before');

-- All: the due date, descending --------------------------------------------------------------------------------------------------
select is(pg_temp.nums(public.payable_list('all', null, null, null, 50, '1998-11-05', null)), 'FT 2,FT 3,FT 1',
  'all, only "from": P2, P3, P1 (descending); P4 (due 1998-11-01) is absent');
select is(pg_temp.nums(public.payable_list('all', null, null, null, 50, null, '1998-11-01')), 'FT 4',
  'all, only "to": the paid P4 by its due date');

-- Paging inside a range ----------------------------------------------------------------------------------------------------------
create temp table page1 on commit drop as
  select public.payable_list('unpaid', null, null, null, 1, '1998-11-01', '1998-11-30') r;
select is(pg_temp.nums((select r from page1)), 'FT 1', 'page 1 of the range: P1');
select isnt((select r -> 'nextCursor' from page1), 'null'::jsonb, 'page 1 has a cursor');
create temp table page2 on commit drop as
  select public.payable_list('unpaid', null, ((select r from page1) -> 'nextCursor' ->> 'date')::date,
    ((select r from page1) -> 'nextCursor' ->> 'id')::uuid, 1, '1998-11-01', '1998-11-30') r;
select is(pg_temp.nums((select r from page2)), 'FT 3', 'page 2 of the range: P3');
create temp table page3 on commit drop as
  select public.payable_list('unpaid', null, ((select r from page2) -> 'nextCursor' ->> 'date')::date,
    ((select r from page2) -> 'nextCursor' ->> 'id')::uuid, 1, '1998-11-01', '1998-11-30') r;
select is(pg_temp.nums((select r from page3)), 'FT 2', 'page 3 of the range: P2');
select is((select r -> 'nextCursor' from page3), 'null'::jsonb, 'the last page has no cursor');

-- Invalid range, no range, other tenant -----------------------------------------------------------------------------------------
select throws_ok($$ select public.payable_list('unpaid', null, null, null, 50, '1998-11-15', '1998-11-01') $$,
  'P0001', 'invalid_request', 'from after to is refused');
select is(public.payable_list('unpaid'), public.payable_list('unpaid', null, null, null, 50),
  'one and five positional arguments give the same reply');
select is(pg_temp.nums(public.payable_list('unpaid')), 'FT 1,FT 3,FT 2', 'with no range: P1, P3, P2');
select is(public.payable_list('unpaid') -> 'totals', jsonb_build_object('count', 3, 'amount', 600.00),
  'with no range the totals are the three open payables');
select is(pg_temp.nums(public.payable_list('all', null, null, null, 50, '1998-11-10', '1998-11-10')), 'FT 3',
  'tenant B''s payable due the same day never appears');
select is(pg_temp.nums(public.payable_list('unpaid', '5b000000-0000-4000-8000-00000000005b', null, null, 50, null, null)), '',
  'tenant B''s supplier id gives an empty list for owner A, not an error');
select is(public.payable_list('unpaid', '5b000000-0000-4000-8000-00000000005b', null, null, 50, null, null) -> 'totals',
  jsonb_build_object('count', 0, 'amount', 0), 'and empty totals');

-- Roles ---------------------------------------------------------------------------------------------------------------------------
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', 'admin', '11111111-1111-4111-8111-111111111111');
select is(pg_temp.nums(public.payable_list('unpaid', null, null, null, 50, '1998-11-06', '1998-11-15')), 'FT 3',
  'the admin can use the range');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', 'chef', '11111111-1111-4111-8111-111111111111');
select throws_ok($$ select public.payable_list('unpaid', null, null, null, 50, '1998-11-01', '1998-11-30') $$,
  '42501', null, 'chef: refused');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', 'waiter', '11111111-1111-4111-8111-111111111111');
select throws_ok($$ select public.payable_list('unpaid', null, null, null, 50, '1998-11-01', '1998-11-30') $$,
  '42501', null, 'waiter: refused');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', 'owner', '22222222-2222-4222-8222-222222222222');
select is(pg_temp.nums(public.payable_list('unpaid', null, null, null, 50, '1998-11-01', '1998-11-30')), 'FT 5',
  'owner B sees only tenant B''s payable');
select is(pg_temp.nums(public.payable_list('unpaid', '5a000000-0000-4000-8000-00000000005a', null, null, 50, null, null)), '',
  'owner B with a supplier of tenant A: empty');

select * from finish();
rollback;
