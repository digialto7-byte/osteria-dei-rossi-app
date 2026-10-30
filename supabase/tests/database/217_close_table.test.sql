-- M21 step 3 (docs/plans/2026-10-30-m21-bill-close.md §3.1.3, §3.1.5, §5; ADR-023; AT1, AT4): public.close_table and app.close_session_at.
-- Happy path, closing without a receipt number (flagged), the business date of the closing instant (cut-off 02:00 and 00:30, both DST nights),
-- refusals that write nothing, the idempotent replay, and what a closed table refuses afterwards. Two tenants, two waiters. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(70);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('e0000000-0000-4000-8000-00000000000e', 'waiter-a2@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('e1000000-0000-4000-8000-00000000000e', '11111111-1111-4111-8111-111111111111', 'e0000000-0000-4000-8000-00000000000e', 'waiter', 'Cameriere Due Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo');

insert into public.menu_item (id, tenant_id, name, category, course_default, created_by, updated_by) values
  ('11000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Spezzatino con polenta (demo)', 'Secondi', 'secondi', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Acqua (demo)', 'Bevande', 'bevande', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'Vino rosso (demo)', 'Bevande', 'bevande', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('21000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Acqua B (demo)', 'Bevande', 'bevande', 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.menu_item_price (tenant_id, menu_item_id, price, vat_rate, created_by) values
  ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000001', 14.00, 10, 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000003', 3.00, 10, 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000004', 40.25, 10, 'a1000000-0000-4000-8000-00000000000a');
-- 24 tables of tenant A, one open session each (2 covers, coperto 2,00 at 10 %; session 1 has 3 covers), one of tenant B. The opening business
-- date is today's, so tables_list shows a closed session.
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by)
  select ('13000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, '11111111-1111-4111-8111-111111111111', 'Tavolo ' || n || ' (demo)', n,
         'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a' from generate_series(1, 24) n;
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('23000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Tavolo B (demo)', 1, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, coperto_amount, coperto_vat_rate, created_by, updated_by)
  select ('14000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, '11111111-1111-4111-8111-111111111111',
         ('13000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'Tavolo ' || n || ' (demo)', case when n = 1 then 3 else 2 end,
         'd1000000-0000-4000-8000-00000000000d', app.business_date('11111111-1111-4111-8111-111111111111', now()), 2.00, 10,
         'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d' from generate_series(1, 24) n;
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, created_by, updated_by) values
  ('24000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', '23000000-0000-4000-8000-000000000001', 'Tavolo B (demo)', 2,
   'b1000000-0000-4000-8000-00000000000b', app.business_date('22222222-2222-4222-8222-222222222222', now()), 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');

create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare
  state text;
  msg text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text;
  return state || ' ' || msg;
end
$$;
create function pg_temp.detail_of(stmt text) returns jsonb language plpgsql as $$
declare
  d text;
begin
  execute stmt;
  return null;
exception when others then
  get stacked diagnostics d = pg_exception_detail;
  return d::jsonb;
end
$$;
create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
create function pg_temp.sid(n int) returns uuid language sql as $$ select ('14000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
-- The start of the current business day (the cut-off before now, DST-safe), in tenant A's time zone.
create function pg_temp.day_start() returns timestamptz language sql as $$
  select ((app.next_cutoff(now(), t.timezone, app.business_day_cutoff(t.id)) at time zone t.timezone) - interval '1 day') at time zone t.timezone
    from public.tenant t where t.id = '11111111-1111-4111-8111-111111111111'
$$;
-- One order line written by the owner fixture. Its instants are p_secs_ago seconds before now(), but never before the start of the current
-- business day, so the kitchen list (which lists the lines fired on the current business day) shows them at any time of day, also seconds after the cut-off.
create function pg_temp.addl(p_id uuid, p_session uuid, p_item uuid, p_course public.course, p_qty numeric, p_price numeric, p_state text, p_secs_ago int) returns void language sql as $$
  insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source,
                                 client_updated_at, created_at, created_by, updated_by, fired_at, fired_by)
  values (p_id, '11111111-1111-4111-8111-111111111111', p_session, p_item, p_course, p_qty, p_price, 10, 'menu',
          now() - interval '1 day', greatest(now() - make_interval(secs => p_secs_ago), pg_temp.day_start()), 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d',
          case when p_state = 'fired' then greatest(now() - make_interval(secs => p_secs_ago), pg_temp.day_start()) end,
          case when p_state = 'fired' then 'd1000000-0000-4000-8000-00000000000d'::uuid end)
$$;
create function pg_temp.lid(n int) returns uuid language sql as $$ select ('15000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
-- Sessions 2..24: one fired Spezzatino 14,00 each (bill 14,00 + 2 x 2,00 = 18,00). Session 1: the AT2 table (100,00).
select pg_temp.addl(pg_temp.lid(n), pg_temp.sid(n), '11000000-0000-4000-8000-000000000001', 'secondi', 1, 14.00, 'fired', 30) from generate_series(2, 24) n;
select pg_temp.addl(pg_temp.lid(41), pg_temp.sid(1), '11000000-0000-4000-8000-000000000001', 'secondi', 2, 14.00, 'fired', 40);
select pg_temp.addl(pg_temp.lid(42), pg_temp.sid(1), '11000000-0000-4000-8000-000000000001', 'secondi', 0.5, 14.00, 'fired', 39);
select pg_temp.addl(pg_temp.lid(43), pg_temp.sid(1), '11000000-0000-4000-8000-000000000003', 'primi', 1.5, 12.50, 'fired', 38);
select pg_temp.addl(pg_temp.lid(44), pg_temp.sid(1), '11000000-0000-4000-8000-000000000004', 'bevande', 1, 40.25, 'fired', 37);
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by)
  values ('25000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', '24000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001',
          'bevande', 1, 3.00, 10, 'menu', now(), 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');

select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
create function pg_temp.tok(n int) returns text language sql as $$ select public.session_bill(pg_temp.sid(n), null) ->> 'billToken' $$;
-- A valid body for session n; p_over replaces keys.
create function pg_temp.body(n int, p_over jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('receiptType', 'scontrino', 'receiptNumber', '0012-0034', 'paymentType', 'card', 'billToken', pg_temp.tok(n)) || p_over
$$;
create function pg_temp.closed_at_null(n int) returns boolean language sql as $$ select closed_at is null from public.table_session where id = pg_temp.sid(n) $$;
create function pg_temp.at_of(n int, p_at text, p_over jsonb default '{}') returns jsonb language sql as $$
  select app.close_session_at('11111111-1111-4111-8111-111111111111', 'd1000000-0000-4000-8000-00000000000d', pg_temp.sid(n), pg_temp.body(n, p_over), p_at::timestamptz)
$$;

create function pg_temp.nowz() returns text language sql as $$ select to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') $$;

-- Happy path (session 1, AT2) ------------------------------------------------------------------------------------------------------
create temporary table r1 as select public.close_table(pg_temp.sid(1), pg_temp.body(1)) as j;
select is((select (j ->> 'changed')::boolean from r1), true, 'close_table answers changed true');
select is((select row(closed_at is not null, closed_by, receipt_type, receipt_number, payment_type, total, missing_receipt)::text
             from public.table_session where id = pg_temp.sid(1)),
          row(true, 'd1000000-0000-4000-8000-00000000000d'::uuid, 'scontrino', '0012-0034', 'card', 100.00::numeric, false)::text,
          'the row holds who, the receipt, the payment and the frozen total 100,00');
select is((select (j -> 'bill' ->> 'total')::numeric from r1), 100.00, 'the reply carries the bill with the same total');
select is((select (j -> 'bill' ->> 'closed')::boolean from r1), true, 'and the bill says closed');
select is((select (j -> 'bill' -> 'receipt') - 'closedAt' from r1),
          jsonb_build_object('type', 'scontrino', 'number', '0012-0034', 'paymentType', 'card', 'missingReceipt', false,
                             'closedBy', jsonb_build_object('id', 'd1000000-0000-4000-8000-00000000000d', 'displayName', 'Cameriere Demo'),
                             'businessDate', (select closed_business_date from public.table_session where id = pg_temp.sid(1))),
          'the reply''s receipt is filled');
select is((select closed_business_date from public.table_session where id = pg_temp.sid(1)), app.business_date('11111111-1111-4111-8111-111111111111', now()),
  'closed_business_date is the business date of the closing instant');
select is((select (e ->> 'status') from jsonb_array_elements(public.tables_list() -> 'tables') e where e ->> 'id' = '13000000-0000-4000-8000-000000000001'), 'closed',
  'tables_list shows the table as closed');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(public.kitchen_tickets()::text like '%' || pg_temp.sid(1)::text || '%', false, 'the closed session left the kitchen list');
select is(public.kitchen_tickets()::text like '%' || pg_temp.sid(2)::text || '%', true, 'an open session with fired lines is still on it');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is((select count(*)::int from jsonb_object_keys(public.close_table(pg_temp.sid(1), pg_temp.body(1)) -> 'bill') k where k ~* 'cost|margin|gp|food|recipe|vat'), 0,
  'the reply has no cost-like key');

-- AT1: closing without a receipt number ---------------------------------------------------------------------------------------------
select is((public.close_table(pg_temp.sid(2), pg_temp.body(2, '{"receiptNumber": null}')) -> 'bill' -> 'receipt' ->> 'missingReceipt')::boolean, true, 'AT1: a null number closes and is flagged');
select is((select row(receipt_number, missing_receipt, closed_at is not null)::text from public.table_session where id = pg_temp.sid(2)), row(null, true, true)::text,
  'the row has no number and missing_receipt true');
select is((public.close_table(pg_temp.sid(3), pg_temp.body(3, '{"receiptNumber": ""}')) -> 'bill' -> 'receipt' ->> 'number'), null, 'an empty string is stored as null');
select is((select missing_receipt from public.table_session where id = pg_temp.sid(3)), true, 'and is flagged');
select is(public.close_table(pg_temp.sid(4), pg_temp.body(4, '{"receiptNumber": "  "}')) -> 'bill' -> 'receipt' -> 'number', 'null'::jsonb, 'two spaces are stored as null');
select is((select missing_receipt from public.table_session where id = pg_temp.sid(4)), true, 'and are flagged');
create temporary table r5 as select public.close_table(pg_temp.sid(5), pg_temp.body(5, '{"receiptType": "fattura", "receiptNumber": null}')) as j;
select is((select row(receipt_type, receipt_number, missing_receipt)::text from public.table_session where id = pg_temp.sid(5)), row('fattura', null, true)::text,
  'a fattura without a number is flagged too');
create temporary table r13 as select public.close_table(pg_temp.sid(13), pg_temp.body(13, '{"receiptNumber": " 0012-0034 "}')) as j;
select is((select receipt_number from public.table_session where id = pg_temp.sid(13)), '0012-0034', 'a number is trimmed');

-- AT4: the business date of the closing instant (through app.close_session_at, at fixed instants) -------------------------------------
select is((select (pg_temp.at_of(6, '2026-11-05 00:40:00+01') -> 'bill' -> 'receipt' ->> 'businessDate')), '2026-11-04', 'AT4: closed at 00:40 with the cut-off at 02:00 -> the previous business date');
select is((select row(business_date, closed_business_date)::text from public.table_session where id = pg_temp.sid(6)),
          row(app.business_date('11111111-1111-4111-8111-111111111111', now()), '2026-11-04'::date)::text, 'and the opening business_date is unchanged');
select is((select (pg_temp.at_of(14, '2026-11-05 02:40:00+01') -> 'bill' -> 'receipt' ->> 'businessDate')), '2026-11-05', 'closed at 02:40 -> the new business date');
update public.tenant set settings = settings || '{"business_day_cutoff": "00:30"}' where id = '11111111-1111-4111-8111-111111111111';
select is((select (pg_temp.at_of(7, '2026-11-05 00:40:00+01') -> 'bill' -> 'receipt' ->> 'businessDate')), '2026-11-05', 'with the cut-off at 00:30, 00:40 belongs to the same calendar date');
update public.tenant set settings = settings - 'business_day_cutoff' where id = '11111111-1111-4111-8111-111111111111';
select is((select (pg_temp.at_of(8, '2026-10-25 01:30:00+02') -> 'bill' -> 'receipt' ->> 'businessDate')), '2026-10-24', 'autumn change: 01:30 CEST -> 2026-10-24');
select is((select (pg_temp.at_of(9, '2026-10-25 02:30:00+01') -> 'bill' -> 'receipt' ->> 'businessDate')), '2026-10-25', 'autumn change: 02:30 CET (after the change) -> 2026-10-25');
select is((select (pg_temp.at_of(10, '2027-03-28 01:59:00+01') -> 'bill' -> 'receipt' ->> 'businessDate')), '2027-03-27', 'spring change: 01:59 CET -> 2027-03-27');
select is((select (pg_temp.at_of(11, '2027-03-28 03:05:00+02') -> 'bill' -> 'receipt' ->> 'businessDate')), '2027-03-28', 'spring change: 03:05 CEST -> 2027-03-28');
select is((select closed_at from public.table_session where id = pg_temp.sid(6)), '2026-11-05 00:40:00+01'::timestamptz, 'closed_at is the instant given');

-- Refusals write nothing ------------------------------------------------------------------------------------------------------------
select pg_temp.addl(pg_temp.lid(60), pg_temp.sid(12), '11000000-0000-4000-8000-000000000003', 'bevande', 1, 3.00, 'draft', 5);
select is(pg_temp.err(format($f$select public.close_table(%L, %L::jsonb)$f$, pg_temp.sid(12), pg_temp.body(12)::text)), 'P0001 unsent_lines', 'a draft line: unsent_lines');
select is(pg_temp.detail_of(format($f$select public.close_table(%L, %L::jsonb)$f$, pg_temp.sid(12), pg_temp.body(12)::text)),
          jsonb_build_object('lineIds', jsonb_build_array(pg_temp.lid(60))), 'the DETAIL holds the line ids and nothing else');
select is(pg_temp.closed_at_null(12), true, 'and the session is still open');
select is(pg_temp.err(format($f$select public.close_table(%L, %L::jsonb)$f$, pg_temp.sid(12), (pg_temp.body(12) || '{"billToken": "00000000000000000000000000000000"}')::text)),
          'P0001 unsent_lines', 'unsent lines come before the token check');

create temporary table stale as select pg_temp.tok(15) as t;
select pg_temp.addl(pg_temp.lid(61), pg_temp.sid(15), '11000000-0000-4000-8000-000000000003', 'bevande', 1, 3.00, 'fired', 4);
select is(pg_temp.err(format($f$select public.close_table(%L, %L::jsonb)$f$, pg_temp.sid(15),
          jsonb_build_object('receiptType', 'scontrino', 'receiptNumber', '1', 'paymentType', 'cash', 'billToken', (select t from stale))::text)), 'P0001 bill_changed',
          'a token from before an add: bill_changed');
select is(pg_temp.closed_at_null(15), true, 'and the session is still open');
select is((public.close_table(pg_temp.sid(15), pg_temp.body(15)) ->> 'changed')::boolean, true, 'after re-reading the bill the waiter can close');

select is(pg_temp.err(format($f$select public.close_table(%L, %L::jsonb)$f$, pg_temp.sid(16), pg_temp.body(16, '{"receiptType": "pos"}')::text)), 'P0001 receipt_type_invalid', 'type "pos": receipt_type_invalid');
select is(pg_temp.err(format($f$select public.close_table(%L, %L::jsonb)$f$, pg_temp.sid(16), pg_temp.body(16, '{"receiptNumber": "12 34"}')::text)), 'P0001 receipt_number_invalid', 'number "12 34": receipt_number_invalid');
select is(pg_temp.err(format($f$select public.close_table(%L, %L::jsonb)$f$, pg_temp.sid(16), pg_temp.body(16, jsonb_build_object('receiptNumber', repeat('1', 21)))::text)),
          'P0001 receipt_number_invalid', 'a 21 character number: receipt_number_invalid');
select is(pg_temp.err(format($f$select public.close_table(%L, %L::jsonb)$f$, pg_temp.sid(16), pg_temp.body(16, '{"paymentType": "cheque"}')::text)), 'P0001 payment_type_invalid', 'payment "cheque": payment_type_invalid');
select is(pg_temp.err(format($f$select public.close_table(%L, %L::jsonb)$f$, pg_temp.sid(16), pg_temp.body(16, '{"billToken": "ABC"}')::text)), '22023 invalid_request', 'a bad token: 22023');
select is(pg_temp.err(format($f$select public.close_table(%L, %L::jsonb)$f$, pg_temp.sid(16), pg_temp.body(16, '{"receiptNumber": 12}')::text)), '22023 invalid_request', 'a numeric receipt number: 22023');
select is(pg_temp.err(format($f$select public.close_table(%L, %L::jsonb)$f$, pg_temp.sid(16), (pg_temp.body(16) - 'paymentType')::text)), '22023 invalid_request', 'a missing key: 22023');
select is(pg_temp.err(format($f$select public.close_table(%L, %L::jsonb)$f$, pg_temp.sid(16), pg_temp.body(16, '{"extra": 1}')::text)), '22023 invalid_request', 'an extra key: 22023');
select is(pg_temp.err(format($f$select public.close_table(%L, null)$f$, pg_temp.sid(16))), '22023 invalid_request', 'no body: 22023');
select is(pg_temp.closed_at_null(16), true, 'none of those closed session 16');
select is(pg_temp.err(format($f$select public.close_table(%L, %L::jsonb)$f$, '24000000-0000-4000-8000-000000000001', pg_temp.body(16)::text)), 'P0002 session_not_found', 'tenant B''s session: session_not_found');
select is(pg_temp.err(format($f$select public.close_table(%L, %L::jsonb)$f$, 'ffffffff-ffff-4fff-8fff-ffffffffffff', pg_temp.body(16)::text)), 'P0002 session_not_found', 'an unknown session: session_not_found');
select is((select closed_at is null from public.table_session where id = '24000000-0000-4000-8000-000000000001'), true, 'and tenant B''s session is untouched');

-- Roles -----------------------------------------------------------------------------------------------------------------------------
create temporary table b17 as select pg_temp.body(17) as b;
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.err(format($f$select public.close_table(%L, %L::jsonb)$f$, pg_temp.sid(17), (select b from b17)::text)), '42501 permission denied: opening tables needs owner, admin or waiter', 'the chef gets 42501');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is((public.close_table(pg_temp.sid(17), (select b from b17)) ->> 'changed')::boolean, true, 'the owner can close');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is((public.close_table(pg_temp.sid(18), pg_temp.body(18)) ->> 'changed')::boolean, true, 'the admin can close');
select is((select closed_by from public.table_session where id = pg_temp.sid(18)), 'f1000000-0000-4000-8000-00000000000f'::uuid, 'closed_by is the caller');
select set_config('request.jwt.claims', '', true);
select is(pg_temp.err(format($f$select public.close_table(%L, %L::jsonb)$f$, pg_temp.sid(19), '{}')), '42501 permission denied: opening tables needs owner, admin or waiter', 'no claims: 42501 before any parse');
select is((select has_function_privilege('anon', 'public.close_table(uuid, jsonb)', 'execute') or has_function_privilege('service_role', 'public.close_table(uuid, jsonb)', 'execute')), false,
  'anon and service_role cannot execute close_table');
select is((select has_function_privilege('authenticated', 'public.close_table(uuid, jsonb)', 'execute')), true, 'authenticated can');
select is((select has_function_privilege('authenticated', 'app.close_session_at(uuid, uuid, uuid, jsonb, timestamptz)', 'execute')), false, 'but not app.close_session_at');

-- Replay ----------------------------------------------------------------------------------------------------------------------------
select pg_temp.act_as('e0000000-0000-4000-8000-00000000000e', '11111111-1111-4111-8111-111111111111', 'waiter');
create temporary table before_replay as select closed_at, closed_by, total, receipt_number, updated_at from public.table_session where id = pg_temp.sid(1);
select is((public.close_table(pg_temp.sid(1), '{"receiptType": "scontrino", "receiptNumber": "0012-0034", "paymentType": "card", "billToken": "00000000000000000000000000000000"}') ->> 'changed')::boolean,
          false, 'the same close again (another waiter, a lost reply) answers changed false');
select is((select row(closed_at, closed_by, total, receipt_number, updated_at)::text from public.table_session where id = pg_temp.sid(1)),
          (select row(closed_at, closed_by, total, receipt_number, updated_at)::text from before_replay), 'and the row is unchanged');
select is((public.close_table(pg_temp.sid(2), '{"receiptType": "scontrino", "receiptNumber": null, "paymentType": "card", "billToken": "00000000000000000000000000000000"}') ->> 'changed')::boolean,
          false, 'a replay of a close without a number is a replay too');
select is(pg_temp.err(format($f$select public.close_table(%L, %L::jsonb)$f$, pg_temp.sid(1), '{"receiptType": "scontrino", "receiptNumber": "0012-0099", "paymentType": "card", "billToken": "00000000000000000000000000000000"}')),
          'P0001 session_closed', 'another receipt number: session_closed');
select is(pg_temp.err(format($f$select public.close_table(%L, %L::jsonb)$f$, pg_temp.sid(1), '{"receiptType": "scontrino", "receiptNumber": "0012-0034", "paymentType": "cash", "billToken": "00000000000000000000000000000000"}')),
          'P0001 session_closed', 'another payment type: session_closed');
select is(pg_temp.err(format($f$select public.close_table(%L, %L::jsonb)$f$, pg_temp.sid(1), '{"receiptType": "fattura", "receiptNumber": "0012-0034", "paymentType": "card", "billToken": "00000000000000000000000000000000"}')),
          'P0001 session_closed', 'another receipt type: session_closed');

-- What a closed table refuses -------------------------------------------------------------------------------------------------------
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select pg_temp.addl(pg_temp.lid(62), pg_temp.sid(2), '11000000-0000-4000-8000-000000000003', 'bevande', 1, 3.00, 'draft', 2);
select is(pg_temp.err(format($f$select public.add_order_line(%L, %L::jsonb)$f$, pg_temp.sid(1),
          jsonb_build_object('lineId', '15000000-0000-4000-8000-0000000000aa', 'menuItemId', '11000000-0000-4000-8000-000000000003', 'clientUpdatedAt', pg_temp.nowz())::text)),
          'P0001 session_closed', 'add_order_line: session_closed');
select is(public.update_order_line(pg_temp.lid(62), ('{"qty": 2, "clientUpdatedAt": "' || pg_temp.nowz() || '"}')::jsonb) -> 'conflict' ->> 'reason', 'session_closed', 'update_order_line: conflict session_closed');
select is(public.remove_order_line(pg_temp.lid(62), ('{"clientUpdatedAt": "' || pg_temp.nowz() || '"}')::jsonb) -> 'conflict' ->> 'reason', 'session_closed', 'remove_order_line: conflict session_closed');
select is(public.void_line(pg_temp.lid(41), jsonb_build_object('reason', (app.order_void_reason_codes())[1], 'clientUpdatedAt', pg_temp.nowz())) -> 'conflict' ->> 'reason',
          'session_closed', 'void_line: conflict session_closed');
select is(pg_temp.err(format($f$select public.fire_course(%L, %L::jsonb)$f$, pg_temp.sid(2), jsonb_build_object('lineIds', jsonb_build_array(pg_temp.lid(62)))::text)), 'P0001 session_closed', 'fire_course: session_closed');
select is(pg_temp.err(format($f$select public.update_table_session(%L, '{"covers": 5}')$f$, pg_temp.sid(1))), 'P0001 session_closed', 'update_table_session: session_closed');
select is(pg_temp.err(format($f$select public.open_table('13000000-0000-4000-8000-000000000001', %L, 3)$f$, pg_temp.sid(1))), 'P0001 session_closed', 'open_table with the closed session''s id: session_closed');
select is((public.open_table('13000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-0000000000f1', 3) ->> 'created')::boolean, true, 'open_table of the same table with a new id opens a new session at once');
select is((select count(*)::int from public.order_line where table_session_id = pg_temp.sid(1)), 4, 'and the closed session''s lines are unchanged');

select * from finish();
rollback;
