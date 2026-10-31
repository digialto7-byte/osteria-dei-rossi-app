-- M21 step 5 (docs/plans/2026-10-30-m21-bill-close.md §3.1.6-3.1.7, §3.2, §5; ADR-023; AT1, AT3, AT4): public.enter_day_close and
-- public.app_vs_register. The register entry and its immediate report (AT3), the list of tables closed without a receipt number by business
-- date (AT1, AT4), the totals by document and payment type, open tables, late ops (T2), input validation and tenancy. Every date is relative to
-- today's business date T (the range check is), and sessions are closed at fixed instants through app.close_session_at. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(51);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo');
insert into public.menu_item (id, tenant_id, name, category, course_default, created_by, updated_by) values
  ('11000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'Vino rosso (demo)', 'Bevande', 'bevande', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('21000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Acqua B (demo)', 'Bevande', 'bevande', 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');

-- T = today's business date; D = T - 1 is the evening under test.
create temporary table dates as select app.business_date('11111111-1111-4111-8111-111111111111', now()) as t,
                                       app.business_date('11111111-1111-4111-8111-111111111111', now()) - 1 as d;
create function pg_temp.t() returns date language sql as $$ select t from dates $$;
create function pg_temp.d() returns date language sql as $$ select d from dates $$;
-- Wall-clock instants in Rome.
create function pg_temp.rome(p_date date, p_time time) returns timestamptz language sql as $$ select (p_date + p_time) at time zone 'Europe/Rome' $$;

-- Tables and sessions. Tenant A: 1..5 closed during the test, 10..12 stay open, 13 closed on D-1. Tenant B: one table.
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by)
  select ('13000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, '11111111-1111-4111-8111-111111111111', 'Tavolo ' || n || ' (demo)', n,
         'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a' from generate_series(1, 13) n;
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('23000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Tavolo B (demo)', 1, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
create function pg_temp.sid(n int) returns uuid language sql as $$ select ('14000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.lid(n int) returns uuid language sql as $$ select ('15000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
-- (session, opening business date, price of its one fired line)
create temporary table plan (n int primary key, opened date, price numeric);
insert into plan select n, pg_temp.d(), p from (values (1, 1000.00), (2, 134.50), (3, 100.00), (4, 50.00)) v(n, p);
insert into plan values (10, pg_temp.d(), 22.00), (11, pg_temp.d() - 1, 10.00), (12, pg_temp.t(), 5.00), (13, pg_temp.d() - 1, 18.00);
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, created_by, updated_by)
  select pg_temp.sid(n), '11111111-1111-4111-8111-111111111111', ('13000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'Tavolo ' || n || ' (demo)', 2,
         'd1000000-0000-4000-8000-00000000000d', opened, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d' from plan where n <= 13;
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by, fired_at, fired_by)
  select pg_temp.lid(n), '11111111-1111-4111-8111-111111111111', pg_temp.sid(n), '11000000-0000-4000-8000-000000000004', 'bevande', 1, price, 10, 'menu', now() - interval '1 day',
         'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d', now() - interval '1 day', 'd1000000-0000-4000-8000-00000000000d' from plan;
-- Tenant B: one session closed on D, 77,00.
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, created_by, updated_by) values
  ('24000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', '23000000-0000-4000-8000-000000000001', 'Tavolo B (demo)', 2,
   'b1000000-0000-4000-8000-00000000000b', pg_temp.d(), 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by, fired_at, fired_by)
  values ('25000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', '24000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001',
          'bevande', 1, 77.00, 10, 'menu', now() - interval '1 day', 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b', now() - interval '1 day', 'b1000000-0000-4000-8000-00000000000b');

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
create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
-- Close session n at an instant (token read first).
create function pg_temp.closeat(n int, p_at timestamptz, p_type text, p_number text, p_pay text) returns void language sql as $$
  select app.close_session_at('11111111-1111-4111-8111-111111111111', 'd1000000-0000-4000-8000-00000000000d', pg_temp.sid(n),
    jsonb_build_object('receiptType', p_type, 'receiptNumber', p_number, 'paymentType', p_pay, 'billToken', public.session_bill(pg_temp.sid(n), null) ->> 'billToken'), p_at)
$$;
-- D: A 23:10 scontrino card 1000,00; B 00:40 after midnight scontrino without number, cash 134,50; C 21:00 fattura other 100,00 -> 1 234,50.
select pg_temp.closeat(1, pg_temp.rome(pg_temp.d(), '23:10'), 'scontrino', '0001', 'card');
select pg_temp.closeat(2, pg_temp.rome(pg_temp.d() + 1, '00:40'), 'scontrino', null, 'cash');
select pg_temp.closeat(3, pg_temp.rome(pg_temp.d(), '21:00'), 'fattura', '0003', 'other');
-- D+1 (= T): 02:40 the next morning, with a number; and a 23:00 table of D-1 with a number (for the register-0 case on D-1: 18,00).
select pg_temp.closeat(4, pg_temp.rome(pg_temp.d() + 1, '02:40'), 'scontrino', '0099', 'cash');
select pg_temp.closeat(13, pg_temp.rome(pg_temp.d() - 1, '20:00'), 'scontrino', '0050', 'card');
-- Tenant B's table, closed on D with its own entry.
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select app.close_session_at('22222222-2222-4222-8222-222222222222', 'b1000000-0000-4000-8000-00000000000b', '24000000-0000-4000-8000-000000000001',
  jsonb_build_object('receiptType', 'scontrino', 'receiptNumber', '7', 'paymentType', 'cash',
    'billToken', public.session_bill('24000000-0000-4000-8000-000000000001', null) ->> 'billToken'), pg_temp.rome(pg_temp.d(), '22:00'));
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
insert into public.day_close (tenant_id, business_date, register_total, created_by) values ('22222222-2222-4222-8222-222222222222', pg_temp.d(), 9999.00, 'b1000000-0000-4000-8000-00000000000b');
-- Late ops (M20 applied_op, T2): two session_closed conflicts of D (one raised, one returned), a stale conflict, a rejected one and a row of D+1.
create function pg_temp.late(p_n int, p_at timestamptz, p_outcome text, p_result jsonb) returns void language sql as $$
  insert into public.applied_op (tenant_id, op_id, user_id, kind, seq, client_ts, received_at, outcome, payload_hash, result, created_by)
  values ('11111111-1111-4111-8111-111111111111', ('0a000000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid, 'd1000000-0000-4000-8000-00000000000d',
          'add_line', p_n, p_at, p_at, p_outcome, repeat('a', 64), p_result, 'd1000000-0000-4000-8000-00000000000d')
$$;
select pg_temp.late(1, pg_temp.rome(pg_temp.d(), '22:00'), 'conflict', '{"sqlstate": "P0001", "message": "session_closed", "detail": null}');
select pg_temp.late(2, pg_temp.rome(pg_temp.d(), '22:30'), 'conflict', '{"conflict": {"reason": "session_closed", "line": {}}}');
select pg_temp.late(3, pg_temp.rome(pg_temp.d(), '22:40'), 'conflict', '{"conflict": {"reason": "stale", "line": {}}}');
select pg_temp.late(4, pg_temp.rome(pg_temp.d(), '22:50'), 'rejected', '{"sqlstate": "P0001", "message": "item_unavailable", "detail": null}');
select pg_temp.late(5, pg_temp.rome(pg_temp.d() + 1, '22:00'), 'conflict', '{"sqlstate": "P0001", "message": "session_closed", "detail": null}');
select pg_temp.late(6, pg_temp.rome(pg_temp.d(), '22:55'), 'conflict', '{"sqlstate": "P0001", "message": "table_already_open", "detail": null}');

create function pg_temp.rep(p_date date) returns jsonb language sql as $$ select public.app_vs_register(p_date) $$;
create function pg_temp.reg(p_total jsonb, p_date date default null) returns text language sql as $$
  select format($f$select public.enter_day_close(%L::jsonb)$f$,
                (jsonb_build_object('registerTotal', p_total) || case when p_date is null then '{}'::jsonb else jsonb_build_object('businessDate', p_date) end)::text)
$$;

-- The report before any register entry ---------------------------------------------------------------------------------------------
create temporary table r0 as select pg_temp.rep(pg_temp.d()) as j;
select is((select (j -> 'app' ->> 'total')::numeric from r0), 1234.50, 'app total of D: 1 000,00 + 134,50 (closed 00:40, belongs to D) + 100,00 fattura');
select is((select row((j -> 'app' ->> 'tables')::int, (j -> 'app' ->> 'covers')::int)::text from r0), row(3, 6)::text, 'D has 3 tables and 6 covers');
select is((select j -> 'register' from r0), 'null'::jsonb, 'no register entry: register null');
select is((select j -> 'difference' from r0), 'null'::jsonb, 'and difference null');
select is((select j ->> 'businessDate' from r0), pg_temp.d()::text, 'the business date is echoed');
select is((select array_agg(k order by k collate "C") from r0, jsonb_object_keys(j) k),
          array['app', 'asOf', 'businessDate', 'difference', 'lateOps', 'missingReceipts', 'openTables', 'register'], 'the report has exactly the keys of plan §3.2');
select is((select array_agg(k order by k collate "C") from r0, jsonb_object_keys(j -> 'app') k),
          array['byPaymentType', 'byReceiptType', 'covers', 'tables', 'total'], 'and its app block');
select is((select jsonb_agg(jsonb_build_object('type', e ->> 'type', 'total', (e ->> 'total')::numeric, 'tables', (e ->> 'tables')::int) order by o)
             from r0, jsonb_array_elements(j -> 'app' -> 'byReceiptType') with ordinality t(e, o)),
          '[{"type": "scontrino", "total": 1134.50, "tables": 2}, {"type": "fattura", "total": 100.00, "tables": 1}]'::jsonb,
          'by receipt type: the fattura is in the app total and shown apart');
select is((select jsonb_agg(jsonb_build_object('type', e ->> 'type', 'total', (e ->> 'total')::numeric, 'tables', (e ->> 'tables')::int) order by o)
             from r0, jsonb_array_elements(j -> 'app' -> 'byPaymentType') with ordinality t(e, o)),
          '[{"type": "cash", "total": 134.50, "tables": 1}, {"type": "card", "total": 1000.00, "tables": 1}, {"type": "other", "total": 100.00, "tables": 1}]'::jsonb,
          'by payment type: every code is listed');
select is((select jsonb_agg(jsonb_build_object('type', e ->> 'type', 'total', (e ->> 'total')::numeric, 'tables', (e ->> 'tables')::int) order by o)
             from (select public.app_vs_register(pg_temp.d() - 3) as j) z, jsonb_array_elements(j -> 'app' -> 'byPaymentType') with ordinality t(e, o)),
          '[{"type": "cash", "total": 0, "tables": 0}, {"type": "card", "total": 0, "tables": 0}, {"type": "other", "total": 0, "tables": 0}]'::jsonb,
          'a day without tables lists every code with zeros');

-- AT1 / AT4: the 00:40 table without a number ---------------------------------------------------------------------------------------
select is((select jsonb_agg(e ->> 'sessionId') from r0, jsonb_array_elements(j -> 'missingReceipts') e), to_jsonb(array[pg_temp.sid(2)::text]),
  'AT1/AT4: the table closed at 00:40 without a number is in the missing receipts of D (by session id)');
select is((select array_agg(k order by k collate "C") from r0, jsonb_array_elements(j -> 'missingReceipts') e, jsonb_object_keys(e) k),
          array['closedAt', 'closedBy', 'covers', 'paymentType', 'receiptType', 'sessionId', 'tableName', 'total'], 'a missing-receipt row has the keys of plan §3.2');
select is((select (e ->> 'total')::numeric from r0, jsonb_array_elements(j -> 'missingReceipts') e), 134.50, 'with its total');
select is((select e -> 'closedBy' ->> 'displayName' from r0, jsonb_array_elements(j -> 'missingReceipts') e), 'Cameriere Demo', 'and who closed it');
select is((select jsonb_array_length(pg_temp.rep(pg_temp.t()) -> 'missingReceipts')), 0, 'the same table is not in the next business date''s list (it counts on D)');
select is((select (pg_temp.rep(pg_temp.t()) -> 'app' ->> 'total')::numeric), 50.00, 'the next business date holds only the 02:40 table (50,00)');
select is((select count(*)::int from r0, jsonb_array_elements(j -> 'missingReceipts') e where e ->> 'sessionId' = pg_temp.sid(1)::text), 0,
  'a table closed at 23:10 with a number is not listed');

-- Open tables and late ops -------------------------------------------------------------------------------------------------------
select is((select j -> 'openTables' from r0), '{"count": 2, "provisionalTotal": 32.00}'::jsonb,
  'open tables of D: one opened on D (22,00) and one forgotten from D-1 (10,00); a session opened on T is not counted');
select is((pg_temp.rep(pg_temp.t()) -> 'openTables' ->> 'count')::int, 3, 'the next business date also counts the session opened on T');
select is((select j -> 'lateOps' from r0), '{"count": 2}'::jsonb, 'T2: two session_closed conflicts of D (one raised, one returned); stale, rejected, table_already_open and D+1 not counted');

-- AT3: the register total and its immediate report ---------------------------------------------------------------------------------
create temporary table e1 as select public.enter_day_close(jsonb_build_object('registerTotal', '1222.00', 'businessDate', pg_temp.d())) as j;
select is((select (j ->> 'changed')::boolean from e1), true, 'AT3: the entry is new: changed true');
select is((select j -> 'report' -> 'difference' from e1), '{"amount": 12.50, "pct": 1.0}'::jsonb, 'AT3: the difference is in the very reply: +12,50 (1,0 %)');
select is((select (j -> 'report' -> 'register' ->> 'total')::numeric from e1), 1222.00, 'the reply shows the register total');
select is((select (pg_temp.rep(pg_temp.d()) - 'asOf') = ((select j -> 'report' from e1) - 'asOf') from e1), true, 'a later read returns the same report (minus asOf)');
select is((select pg_temp.rep(pg_temp.d()) -> 'register' ->> 'entries'), '1', 'one entry so far');
select is((select pg_temp.rep(pg_temp.d()) -> 'register' -> 'enteredBy' ->> 'displayName'), 'Titolare Demo', 'entered by the owner');
select is((select (public.enter_day_close(('{"registerTotal": "1222.00", "businessDate": "' || pg_temp.d() || '"}')::jsonb) ->> 'changed')::boolean), false, 'the same total again: changed false');
select is((select count(*)::int from public.day_close where tenant_id = '11111111-1111-4111-8111-111111111111'), 1, 'and still one row');
select is((public.enter_day_close(jsonb_build_object('registerTotal', '1222.00', 'businessDate', pg_temp.d())) ->> 'changed')::boolean, false, 'a repeat in the same transaction is changed false too');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
create temporary table e2 as select public.enter_day_close(jsonb_build_object('registerTotal', '1240.00', 'businessDate', pg_temp.d())) as j;
select is((select (j ->> 'changed')::boolean from e2), true, 'a corrected total by the admin is a new entry');
select is((select row((j -> 'report' -> 'register' ->> 'total')::numeric, j -> 'report' -> 'register' ->> 'entries', j -> 'report' -> 'register' -> 'enteredBy' ->> 'displayName')::text from e2),
          row(1240.00::numeric, '2', 'Admin Demo')::text, 'the latest entry is in force: 1 240,00, two entries, entered by the admin');
select is((select j -> 'report' -> 'difference' from e2), '{"amount": -5.50, "pct": -0.4}'::jsonb, 'the difference is app minus register: -5,50 (-0,4 %)');
select is((select count(*)::int from public.day_close where tenant_id = '11111111-1111-4111-8111-111111111111'), 2, 'two rows in all');
select is((public.enter_day_close('{"registerTotal": "0"}') -> 'report' -> 'difference' ->> 'amount')::numeric, 50.00,
  'today (default date): register 0 against an app total of 50,00 gives +50,00');
select is((select pg_temp.rep(pg_temp.t()) -> 'difference' -> 'pct'), 'null'::jsonb, 'register 0: the percentage is null (no division by zero)');
select is((select pg_temp.rep(pg_temp.d() - 1) -> 'difference'), 'null'::jsonb, 'a date with no entry: difference null');

-- Inputs ---------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.err(pg_temp.reg('1222')), 'P0001 register_total_invalid', 'a JSON number is register_total_invalid');
select is(pg_temp.err(pg_temp.reg('"1.222,00"')), 'P0001 register_total_invalid', '"1.222,00" is register_total_invalid');
select is(pg_temp.err(pg_temp.reg('"-1"')), 'P0001 register_total_invalid', '"-1" is register_total_invalid');
select is(pg_temp.err(pg_temp.reg('"12345678"')), 'P0001 register_total_invalid', '8 digits is register_total_invalid');
select is(pg_temp.err(pg_temp.reg('"1.234"')), 'P0001 register_total_invalid', 'three decimals is register_total_invalid');
select is(pg_temp.err(pg_temp.reg('"9999999.99"', pg_temp.d() - 2)), 'ok', '9 999 999,99 is accepted (boundary)');
select is(pg_temp.err(pg_temp.reg('"10"', pg_temp.t() + 1)), 'P0001 business_date_invalid', 'tomorrow is business_date_invalid');
select is(pg_temp.err(pg_temp.reg('"10"', pg_temp.t() - 63)), 'P0001 business_date_invalid', '63 days back is business_date_invalid');
select is(pg_temp.err(pg_temp.reg('"10"', pg_temp.t() - 62)), 'ok', '62 days back is accepted');
select is(pg_temp.err(format($f$select public.app_vs_register(%L)$f$, pg_temp.t() + 1)), 'P0001 business_date_invalid', 'the report refuses tomorrow too');
select is(pg_temp.err($$select public.enter_day_close('{"registerTotal": "10", "x": 1}')$$), '22023 invalid_request', 'an extra key is invalid_request');
select is(pg_temp.err($$select public.enter_day_close('{}')$$), '22023 invalid_request', 'an empty body is invalid_request');
select is(pg_temp.err($$select public.enter_day_close('{"registerTotal": "10", "businessDate": "05/11/2026"}')$$), '22023 invalid_request', 'a malformed date is invalid_request');

-- Tenancy -----------------------------------------------------------------------------------------------------------------------
select is((select (pg_temp.rep(pg_temp.d()) -> 'app' ->> 'total')::numeric), 1234.50, 'tenant B''s 77,00 never enters A''s total');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is((select row((pg_temp.rep(pg_temp.d()) -> 'app' ->> 'total')::numeric, (pg_temp.rep(pg_temp.d()) -> 'register' ->> 'total')::numeric,
                      jsonb_array_length(pg_temp.rep(pg_temp.d()) -> 'missingReceipts'), (pg_temp.rep(pg_temp.d()) -> 'lateOps' ->> 'count')::int)::text),
          row(77.00::numeric, 9999.00::numeric, 0, 0)::text, 'tenant B sees only its own totals, its own register entry and none of A''s late ops or flags');

select * from finish();
rollback;
