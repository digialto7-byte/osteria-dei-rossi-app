-- M21 step 4 (docs/plans/2026-10-30-m21-bill-close.md §3.1.4, §5; ADR-023): close_table is one transaction (a fault after the write undoes it),
-- the stored total is the bill's, and what M20's apply_op does with the ops of a phone that arrive after the close: stored as `conflict`
-- (T2: a raised session_closed is {sqlstate, message, detail}, a returned one is the procedure reply {conflict: {reason}}). Close is not an
-- outbox op kind. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('e0000000-0000-4000-8000-00000000000e', 'waiter-a2@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('e1000000-0000-4000-8000-00000000000e', '11111111-1111-4111-8111-111111111111', 'e0000000-0000-4000-8000-00000000000e', 'waiter', 'Cameriere Due Demo');
insert into public.menu_item (id, tenant_id, name, category, course_default, created_by, updated_by) values
  ('11000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Spezzatino con polenta (demo)', 'Secondi', 'secondi', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Acqua (demo)', 'Bevande', 'bevande', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'Vino rosso (demo)', 'Bevande', 'bevande', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.menu_item_price (tenant_id, menu_item_id, price, vat_rate, created_by) values
  ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000001', 14.00, 10, 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000003', 3.00, 10, 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000004', 40.25, 10, 'a1000000-0000-4000-8000-00000000000a');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by)
  select ('13000000-0000-4000-8000-00000000000' || n)::uuid, '11111111-1111-4111-8111-111111111111', 'Tavolo ' || n || ' (demo)', n,
         'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a' from generate_series(1, 4) n;
-- S1: AT2 table (3 covers, coperto 2,00). S2: no coperto. S3: atomicity. S4: late ops after the close, two phones.
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, coperto_amount, coperto_vat_rate, created_by, updated_by) values
  ('14000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000001', 'Tavolo 1 (demo)', 3, 'd1000000-0000-4000-8000-00000000000d', '2026-11-04', 2.00, 10, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'),
  ('14000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000002', 'Tavolo 2 (demo)', 2, 'd1000000-0000-4000-8000-00000000000d', '2026-11-04', null, null, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'),
  ('14000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000003', 'Tavolo 3 (demo)', 2, 'd1000000-0000-4000-8000-00000000000d', '2026-11-04', 2.00, 10, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'),
  ('14000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000004', 'Tavolo 4 (demo)', 2, 'd1000000-0000-4000-8000-00000000000d', '2026-11-04', 2.00, 10, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d');

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
create function pg_temp.sid(n int) returns uuid language sql as $$ select ('14000000-0000-4000-8000-00000000000' || n)::uuid $$;
create function pg_temp.lid(n int) returns uuid language sql as $$ select ('15000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.addl(p_id uuid, p_session uuid, p_item uuid, p_course public.course, p_qty numeric, p_price numeric, p_state text) returns void language sql as $$
  insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source,
                                 client_updated_at, created_by, updated_by, fired_at, fired_by)
  values (p_id, '11111111-1111-4111-8111-111111111111', p_session, p_item, p_course, p_qty, p_price, 10, 'menu',
          now() - interval '1 day', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d',
          case when p_state = 'fired' then now() - interval '10 minutes' end, case when p_state = 'fired' then 'd1000000-0000-4000-8000-00000000000d'::uuid end)
$$;
select pg_temp.addl(pg_temp.lid(1), pg_temp.sid(1), '11000000-0000-4000-8000-000000000001', 'secondi', 2, 14.00, 'fired');
select pg_temp.addl(pg_temp.lid(2), pg_temp.sid(1), '11000000-0000-4000-8000-000000000001', 'secondi', 0.5, 14.00, 'fired');
select pg_temp.addl(pg_temp.lid(3), pg_temp.sid(1), '11000000-0000-4000-8000-000000000003', 'primi', 1.5, 12.50, 'fired');
select pg_temp.addl(pg_temp.lid(4), pg_temp.sid(1), '11000000-0000-4000-8000-000000000004', 'bevande', 1, 40.25, 'fired');
select pg_temp.addl(pg_temp.lid(5), pg_temp.sid(2), '11000000-0000-4000-8000-000000000001', 'secondi', 1.5, 12.50, 'fired');
select pg_temp.addl(pg_temp.lid(6), pg_temp.sid(2), '11000000-0000-4000-8000-000000000003', 'bevande', 0.5, 7.25, 'fired');
select pg_temp.addl(pg_temp.lid(7), pg_temp.sid(3), '11000000-0000-4000-8000-000000000001', 'secondi', 1, 14.00, 'fired');
select pg_temp.addl(pg_temp.lid(8), pg_temp.sid(4), '11000000-0000-4000-8000-000000000001', 'secondi', 1, 14.00, 'fired');

select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
create function pg_temp.body(n int) returns jsonb language sql as $$
  select jsonb_build_object('receiptType', 'scontrino', 'receiptNumber', '0012-0034', 'paymentType', 'card',
                            'billToken', public.session_bill(pg_temp.sid(n), null) ->> 'billToken')
$$;

-- Atomicity: a fault raised AFTER the closing UPDATE (an after-row trigger) undoes the write ---------------------------------------
create function public.m21_test_fault() returns trigger language plpgsql as $$
begin
  if current_setting('test.fail', true) = 'close' and new.closed_at is not null then
    raise exception 'test_fault' using errcode = 'P0001';
  end if;
  return new;
end
$$;
create trigger m21_test_fault after update on public.table_session for each row execute function public.m21_test_fault();
select set_config('test.fail', 'close', true);
select is(pg_temp.err(format($f$select public.close_table(%L, %L::jsonb)$f$, pg_temp.sid(3), pg_temp.body(3)::text)), 'P0001 test_fault', 'a fault after the write makes close_table raise');
select is((select row(closed_at is null, closed_by is null, closed_business_date is null, receipt_type is null, receipt_number is null, payment_type is null, total is null, missing_receipt)::text
             from public.table_session where id = pg_temp.sid(3)),
          row(true, true, true, true, true, true, true, false)::text, 'the session is still open: no closing field set, missing_receipt false');
select set_config('test.fail', '', true);
select is((public.close_table(pg_temp.sid(3), pg_temp.body(3)) ->> 'changed')::boolean, true, 'without the fault the same close succeeds');
drop trigger m21_test_fault on public.table_session;
drop function public.m21_test_fault();

-- Frozen total ----------------------------------------------------------------------------------------------------------------------
select is((public.close_table(pg_temp.sid(1), pg_temp.body(1)) -> 'bill' ->> 'total')::numeric, 100.00, 'AT2 table: the reply total is 100,00');
select is((select total from public.table_session where id = pg_temp.sid(1)), 100.00, 'the stored total is 100,00');
select is((select total from public.table_session where id = pg_temp.sid(1)), (public.session_bill(pg_temp.sid(1), null) ->> 'total')::numeric,
  'the stored total equals the recomputed bill (lines of a closed table cannot change)');
select is((public.close_table(pg_temp.sid(2), pg_temp.body(2)) -> 'bill' ->> 'total')::numeric, 22.38, 'no-coperto table: 18,75 + 3,63 = 22,38');
select is((select total from public.table_session where id = pg_temp.sid(2)), (public.session_bill(pg_temp.sid(2), null) ->> 'total')::numeric,
  'and the stored total equals the recomputed bill there too');
select is((public.session_bill(pg_temp.sid(2), null) -> 'coperto'), 'null'::jsonb, 'the no-coperto bill has coperto null');

-- Late ops of a phone (M20 apply_op): a closed table accepts nothing, the refusal is stored as a conflict ---------------------------
create function pg_temp.op(p_id int, p_kind text, p_payload jsonb, p_user text default 'd1000000-0000-4000-8000-00000000000d') returns jsonb language sql as $$
  select jsonb_build_object('opId', ('0a000000-0000-4000-8000-0000000000' || lpad(p_id::text, 2, '0'))::text, 'seq', p_id, 'kind', p_kind,
                            'clientTs', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'userId', p_user, 'payload', p_payload)
$$;
-- Session 4 is closed by waiter A while waiter B's phone was offline with ops for it. A draft inserted after the close (a state no procedure
-- can reach, written by the owner fixture) lets the edit and remove ops be judged.
select public.close_table(pg_temp.sid(4), pg_temp.body(4));
select pg_temp.addl(pg_temp.lid(10), pg_temp.sid(4), '11000000-0000-4000-8000-000000000003', 'bevande', 1, 3.00, 'draft');
select pg_temp.act_as('e0000000-0000-4000-8000-00000000000e', '11111111-1111-4111-8111-111111111111', 'waiter');
create temporary table late as
  select 'add' as k, public.apply_op(pg_temp.op(1, 'add_line', jsonb_build_object('sessionId', pg_temp.sid(4), 'lineId', pg_temp.lid(20),
           'menuItemId', '11000000-0000-4000-8000-000000000003'), 'e1000000-0000-4000-8000-00000000000e')) as j
  union all select 'fire', public.apply_op(pg_temp.op(2, 'fire', jsonb_build_object('sessionId', pg_temp.sid(4), 'lineIds', jsonb_build_array(pg_temp.lid(10))), 'e1000000-0000-4000-8000-00000000000e'))
  union all select 'void', public.apply_op(pg_temp.op(3, 'void_line', jsonb_build_object('lineId', pg_temp.lid(8), 'reason', (app.order_void_reason_codes())[1]), 'e1000000-0000-4000-8000-00000000000e'))
  union all select 'edit', public.apply_op(pg_temp.op(4, 'edit_line', jsonb_build_object('lineId', pg_temp.lid(10), 'qty', 2), 'e1000000-0000-4000-8000-00000000000e'))
  union all select 'remove', public.apply_op(pg_temp.op(5, 'remove_line', jsonb_build_object('lineId', pg_temp.lid(10)), 'e1000000-0000-4000-8000-00000000000e'));
select is((select j ->> 'status' from late where k = 'add'), 'conflict', 'a queued add_line after the close: status conflict');
select is((select j -> 'result' ->> 'message' from late where k = 'add'), 'session_closed', 'T2: a raised session_closed is stored as {sqlstate, message, detail}');
select is((select j -> 'result' ->> 'sqlstate' from late where k = 'add'), 'P0001', 'with its SQLSTATE');
select is((select j ->> 'status' from late where k = 'fire'), 'conflict', 'a queued fire after the close: status conflict');
select is((select j -> 'result' ->> 'message' from late where k = 'fire'), 'session_closed', 'fire: session_closed');
select is((select j ->> 'status' from late where k = 'void'), 'conflict', 'a queued void_line after the close: status conflict');
select is((select j -> 'result' -> 'conflict' ->> 'reason' from late where k = 'void'), 'session_closed', 'T2: a returned conflict is stored as the procedure reply {conflict: {reason}}');
select is((select j ->> 'status' from late where k = 'edit'), 'conflict', 'a queued edit_line after the close: status conflict');
select is((select j -> 'result' -> 'conflict' ->> 'reason' from late where k = 'edit'), 'session_closed', 'edit_line: reason session_closed');
select is((select j -> 'result' -> 'conflict' ->> 'reason' from late where k = 'remove'), 'session_closed', 'remove_line: reason session_closed');
select is((select array_agg(outcome order by seq) from public.applied_op where op_id in (select ('0a000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid from generate_series(1, 5) n)),
          array['conflict', 'conflict', 'conflict', 'conflict', 'conflict'], 'all five are stored in applied_op with outcome conflict');
select is((select count(*)::int from public.order_line where table_session_id = pg_temp.sid(4) and id = pg_temp.lid(20)), 0, 'and the late dish is not on the table (nothing reopens it)');
select is((select closed_at is not null from public.table_session where id = pg_temp.sid(4)), true, 'the table stays closed');

-- Close is not an op kind ------------------------------------------------------------------------------------------------------------
select is(pg_temp.err(format($f$select public.apply_op(%L::jsonb)$f$, pg_temp.op(6, 'close_table', jsonb_build_object('sessionId', pg_temp.sid(1)), 'e1000000-0000-4000-8000-00000000000e')::text)),
          '22023 invalid_request', 'a close_table op is not a kind: 22023 invalid_request');
select is(app.sync_op_kinds(), array['open_table', 'add_line', 'edit_line', 'remove_line', 'fire', 'void_line'], 'app.sync_op_kinds() is still M20''s six');
select is((select count(*)::int from public.applied_op where op_id = '0a000000-0000-4000-8000-000000000006'), 0, 'and the refused op stored nothing');

select * from finish();
rollback;
