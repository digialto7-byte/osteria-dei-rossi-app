-- Reservations A7b (docs/plans/2026-11-08-reservations.md §5c, founder Q-R6 = V4): tables joined while a combined booking is seated, plus a split action. While a reservation is seated and
-- its lead table's session is open, every other table still assigned to it is joined to the lead: public.tables_list shows it as status joined with joinedTo, and public.open_table
-- refuses it with table_joined (the offline apply_op path calls the same function). The lock ends when the lead session closes. public.split_reservation_tables releases tables from
-- a seated booking's assignment (owner, admin, waiter; the chef gets 42501). Both replaced functions keep every earlier behaviour; the md5 of their new bodies is pinned in 296.
-- Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(65);

create function pg_temp.call(p_role text, stmt text) returns text language plpgsql as $$
declare
  v_out text;
  state text;
  msg text;
  v_auth uuid;
begin
  v_auth := case p_role when 'owner' then 'a0000000-0000-4000-8000-00000000000a' when 'admin' then 'f0000000-0000-4000-8000-00000000000f'
                        when 'waiter' then 'd0000000-0000-4000-8000-00000000000d' when 'ownerb' then 'b0000000-0000-4000-8000-00000000000b' else 'c0000000-0000-4000-8000-00000000000c' end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated', 'tenant_id', case p_role when 'ownerb' then '22222222-2222-4222-8222-222222222222' else '11111111-1111-4111-8111-111111111111' end,
                                                            'app_role', case p_role when 'ownerb' then 'owner' else p_role end)::text, true);
  set local role authenticated;
  execute stmt into v_out;
  reset role;
  return v_out;
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text;
  reset role;
  return state || ' ' || msg;
end
$$;
create function pg_temp.go(stmt text) returns text language plpgsql as $$
declare
  v_out text;
  state text;
  msg text;
begin
  execute stmt into v_out;
  return v_out;
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text;
  return state || ' ' || msg;
end
$$;
-- The tile of a table in tables_list, as the waiter.
create function pg_temp.tile(p_table uuid) returns jsonb language sql as $$
  select t from jsonb_array_elements(pg_temp.call('waiter', 'select public.tables_list()::text')::jsonb -> 'tables') t where t ->> 'id' = p_table::text
$$;
-- Closes a session the way the table state needs it (the closing columns the guard requires).
create function pg_temp.close_session(p_session uuid) returns void language sql as $$
  update public.table_session set closed_at = now(), closed_by = 'd1000000-0000-4000-8000-00000000000d', closed_business_date = business_date, receipt_type = 'scontrino', payment_type = 'card', total = 10
   where id = p_session
$$;

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'), ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'), ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'), ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'), ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('13000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Tavolo 1 (demo)', 1, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('13000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Tavolo 2 (demo)', 2, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('13000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Tavolo 3 (demo)', 3, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('13000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'Tavolo 4 (demo)', 4, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('13000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'Tavolo 5 (demo)', 5, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('13000000-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', 'Tavolo 6 (demo)', 6, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('23000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Tavolo B (demo)', 1, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');

-- Bookings of today (the real clock): R1 on T1+T2, R2 on T3+T4+T5, both accepted and already started; R3 pending; RB in tenant B.
create temp table today as select app.business_date('11111111-1111-4111-8111-111111111111', now()) as d;
create function pg_temp.mk(p_n integer, p_status public.reservation_status, p_tables uuid[]) returns void language plpgsql as $$
declare
  v_id uuid := ('e1000000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid;
  t uuid;
begin
  insert into public.reservation (tenant_id, id, status, business_date, service_key, starts_at, ends_at, party, privacy_notice_version, privacy_ack_at)
    values ('11111111-1111-4111-8111-111111111111', v_id, p_status, (select d from today), 'cena', now() - interval '30 minutes', now() + interval '90 minutes', 4, 'v1', now() - interval '3 days');
  insert into public.reservation_contact (tenant_id, reservation_id, name, phone, email, locale) values ('11111111-1111-4111-8111-111111111111', v_id, 'Cliente Demo', '390000000001', 'cliente.demo@example.com', 'it');
  foreach t in array coalesce(p_tables, '{}') loop
    insert into public.reservation_table (tenant_id, reservation_id, dining_table_id, assigned_at, assigned_by) values ('11111111-1111-4111-8111-111111111111', v_id, t, now() - interval '1 day', 'a1000000-0000-4000-8000-00000000000a');
  end loop;
end
$$;
select pg_temp.mk(1, 'accepted', array['13000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000002']::uuid[]);
select pg_temp.mk(2, 'accepted', array['13000000-0000-4000-8000-000000000003', '13000000-0000-4000-8000-000000000004', '13000000-0000-4000-8000-000000000005']::uuid[]);
select pg_temp.mk(3, 'pending', null);
insert into public.reservation (tenant_id, id, status, business_date, service_key, starts_at, ends_at, party, privacy_notice_version, privacy_ack_at)
  values ('22222222-2222-4222-8222-222222222222', 'e2000000-0000-4000-8000-000000000001', 'accepted', (select d from today), 'cena', now(), now() + interval '2 hours', 2, 'v1', now());

-- Before seating nothing is locked ---------------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.tile('13000000-0000-4000-8000-000000000002') ->> 'status', 'free', 'before seating, an assigned table is not locked (it is free)');
select is(pg_temp.tile('13000000-0000-4000-8000-000000000002') ? 'joinedTo', false, 'and carries no joinedTo key');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.tile('13000000-0000-4000-8000-000000000006')) k), array['id', 'name', 'position', 'session', 'status'], 'a free tile keeps its M17 keys');

-- The waiter opens one table for the party and the booking is seated on it ----------------------------------------------------------------------------------------------
select is(left(pg_temp.call('waiter', $$ select public.open_table('13000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000001', 4)::text $$), 1), '{', 'the waiter opens Tavolo 1');
select is(pg_temp.go($$ select app.seat_reservation_at('11111111-1111-4111-8111-111111111111', 'd1000000-0000-4000-8000-00000000000d', 'waiter', 'e1000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000001', clock_timestamp())::jsonb ->> 'status' $$), 'seated', 'and seats the booking on that session');
select is(pg_temp.tile('13000000-0000-4000-8000-000000000002') ->> 'status', 'joined', 'Tavolo 2 is now joined');
select is(pg_temp.tile('13000000-0000-4000-8000-000000000002') -> 'joinedTo', '{"id": "13000000-0000-4000-8000-000000000001", "name": "Tavolo 1 (demo)", "overtime": false}'::jsonb, 'to the lead: {id, name, overtime} of Tavolo 1, not overtime before the booking''s end');
select is(pg_temp.tile('13000000-0000-4000-8000-000000000002') -> 'session', 'null'::jsonb, 'a joined tile shows no session');
select is(pg_temp.tile('13000000-0000-4000-8000-000000000001') ->> 'status', 'open', 'the lead stays an ordinary open table');
select is(pg_temp.tile('13000000-0000-4000-8000-000000000001') ? 'joinedTo', false, 'with no joinedTo');
select is(pg_temp.tile('13000000-0000-4000-8000-000000000003') ->> 'status', 'free', 'a table of another booking is unaffected');
select is(pg_temp.tile('13000000-0000-4000-8000-000000000006') ->> 'status', 'free', 'and so is a table with no booking');
select is((select count(*)::int from jsonb_array_elements(pg_temp.call('waiter', 'select public.tables_list()::text')::jsonb -> 'tables') t where t ->> 'status' = 'joined'), 1, 'exactly one joined tile');

-- open_table refuses a joined table ---------------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.call('waiter', $$ select public.open_table('13000000-0000-4000-8000-000000000002', '14000000-0000-4000-8000-000000000002', 2)::text $$), 'P0001 table_joined', 'open_table on the joined table: table_joined');
select is((select count(*)::int from public.table_session where id = '14000000-0000-4000-8000-000000000002'), 0, 'and no session was created');
select is(left(pg_temp.call('waiter', $$ select public.open_table('13000000-0000-4000-8000-000000000006', '14000000-0000-4000-8000-000000000006', 2)::text $$), 1), '{', 'a table that is not joined opens as before');
select is(pg_temp.call('waiter', $$ select public.open_table('13000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000009', 2)::text $$), 'P0001 table_already_open', 'the lead still answers table_already_open');
select is(left(pg_temp.call('waiter', $$ select public.open_table('13000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000001', 4)::text $$), 1), '{', 'a replay of the lead''s own session id is still a replay');
-- The offline path: apply_op calls the same function.
create temp table op1 as select jsonb_build_object('opId', 'e2000000-0000-4000-8000-000000000001', 'seq', 1, 'kind', 'open_table', 'clientTs', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                                                   'userId', 'd1000000-0000-4000-8000-00000000000d',
                                                   'payload', jsonb_build_object('tableId', '13000000-0000-4000-8000-000000000002', 'sessionId', 'e2000000-0000-4000-8000-0000000000a1', 'covers', 2)) as op;
create temp table ap1 as select pg_temp.call('waiter', format($$ select public.apply_op(%L::jsonb)::text $$, (select op from op1)))::jsonb as j;
select is((select j ->> 'status' from ap1), 'rejected', 'apply_op: the offline open_table of the joined table is rejected');
select is((select j -> 'result' ->> 'message' from ap1), 'table_joined', 'with table_joined');
select is((select j ->> 'stop' from ap1), 'true', 'and the batch stops (a failed open_table)');
select is((select count(*)::int from public.table_session where id = 'e2000000-0000-4000-8000-0000000000a1'), 0, 'nothing was opened');

-- The Prenotazioni row ----------------------------------------------------------------------------------------------------------------------------------------------------
select is(app.reservation_row_json('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-000000000001', 'waiter', now()) -> 'actions', '["split"]'::jsonb, 'the seated booking offers split to the waiter');
select is(app.reservation_row_json('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-000000000001', 'owner', now()) -> 'actions', '["split", "erase"]'::jsonb, 'and to the owner (with erase)');

-- The lock ends when the lead session closes -----------------------------------------------------------------------------------------------------------------------------------
select pg_temp.close_session('14000000-0000-4000-8000-000000000001');
select is(pg_temp.tile('13000000-0000-4000-8000-000000000002') ->> 'status', 'free', 'after the lead session closes, Tavolo 2 reads free');
select is(left(pg_temp.call('waiter', $$ select public.open_table('13000000-0000-4000-8000-000000000002', '14000000-0000-4000-8000-000000000002', 2)::text $$), 1), '{', 'and opens');
select is(app.reservation_row_json('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-000000000001', 'waiter', now()) -> 'actions', '[]'::jsonb, 'once the lead session is closed the booking offers no split, although its assignment rows are kept (review: the same open-session rule as app.table_joined_to)');

-- Split --------------------------------------------------------------------------------------------------------------------------------------------------------------------
select is(left(pg_temp.call('waiter', $$ select public.open_table('13000000-0000-4000-8000-000000000003', '14000000-0000-4000-8000-000000000003', 5)::text $$), 1), '{', 'the waiter opens Tavolo 3 for the second booking (Tavolo 3, 4 and 5)');
select is(pg_temp.go($$ select app.seat_reservation_at('11111111-1111-4111-8111-111111111111', 'd1000000-0000-4000-8000-00000000000d', 'waiter', 'e1000000-0000-4000-8000-000000000002', '14000000-0000-4000-8000-000000000003', clock_timestamp())::jsonb ->> 'status' $$), 'seated', 'and seats it');
select is((select count(*)::int from jsonb_array_elements(pg_temp.call('waiter', 'select public.tables_list()::text')::jsonb -> 'tables') t where t ->> 'status' = 'joined'), 2, 'Tavolo 4 and Tavolo 5 are joined');
select is(pg_temp.tile('13000000-0000-4000-8000-000000000004') -> 'joinedTo' ->> 'overtime', 'false', 'overtime is false before the seated booking''s ends_at');
update public.reservation set ends_at = now() - interval '1 minute' where id = 'e1000000-0000-4000-8000-000000000002';
select is(pg_temp.tile('13000000-0000-4000-8000-000000000004') -> 'joinedTo' ->> 'overtime', 'true', 'overtime is true once now is past the seated booking''s ends_at');
select is(pg_temp.tile('13000000-0000-4000-8000-000000000004') ->> 'status', 'joined', 'and the tile is still joined: there is no time cut-off (the lock lasts while the lead session is open)');
create temp table sp1 as select pg_temp.call('waiter', $$ select public.split_reservation_tables('e1000000-0000-4000-8000-000000000002', array['13000000-0000-4000-8000-000000000004']::uuid[])::text $$)::jsonb as j;
select is((select j ->> 'changed' from sp1), 'true', 'the waiter splits Tavolo 4: changed');
select is((select j ->> 'status' from sp1), 'seated', 'the reply is the booking detail, still seated');
select is((select jsonb_agg(t ->> 'name' order by o) from sp1, jsonb_array_elements(j -> 'tables') with ordinality x(t, o)), '["Tavolo 3 (demo)", "Tavolo 5 (demo)"]'::jsonb, 'with the two tables that are still assigned');
select is((select count(*)::int || ',' || count(released_at)::int from public.reservation_table where reservation_id = 'e1000000-0000-4000-8000-000000000002'), '3,1', 'the released row is kept, with released_at set');
select is((select kind || ',' || (data -> 'tableIds')::text from public.reservation_event where reservation_id = 'e1000000-0000-4000-8000-000000000002' and kind = 'tables_split'), 'tables_split,["13000000-0000-4000-8000-000000000004"]', 'a tables_split event with the table ids');
select is(pg_temp.tile('13000000-0000-4000-8000-000000000004') ->> 'status', 'free', 'Tavolo 4 is free again while the booking is still seated');
select is(left(pg_temp.call('waiter', $$ select public.open_table('13000000-0000-4000-8000-000000000004', '14000000-0000-4000-8000-000000000004', 2)::text $$), 1), '{', 'and opens');
select is(pg_temp.tile('13000000-0000-4000-8000-000000000005') ->> 'status', 'joined', 'Tavolo 5 stays joined');
select is(pg_temp.call('waiter', $$ select public.split_reservation_tables('e1000000-0000-4000-8000-000000000002', array['13000000-0000-4000-8000-000000000004']::uuid[])::jsonb ->> 'changed' $$), 'false', 'splitting Tavolo 4 again changes nothing');
select is(pg_temp.call('waiter', $$ select public.split_reservation_tables('e1000000-0000-4000-8000-000000000002', array['13000000-0000-4000-8000-000000000003']::uuid[])::text $$), 'P0001 lead_table', 'splitting the lead table is lead_table');
select is(pg_temp.call('waiter', $$ select public.split_reservation_tables('e1000000-0000-4000-8000-000000000002', array['13000000-0000-4000-8000-000000000006']::uuid[])::text $$), 'P0001 table_not_assigned', 'a table of no assignment of this booking is table_not_assigned');
select is(pg_temp.call('waiter', $$ select public.split_reservation_tables('e1000000-0000-4000-8000-000000000002')::jsonb ->> 'changed' $$), 'true', 'null splits all the other tables (Tavolo 5)');
select is(pg_temp.tile('13000000-0000-4000-8000-000000000005') ->> 'status', 'free', 'Tavolo 5 is free');
select is(pg_temp.call('waiter', $$ select public.split_reservation_tables('e1000000-0000-4000-8000-000000000002')::jsonb ->> 'changed' $$), 'false', 'and repeating the null split changes nothing');
select is(app.reservation_row_json('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-000000000002', 'waiter', now()) -> 'actions', '[]'::jsonb, 'with nothing left to split the row offers no split');
select is(pg_temp.call('waiter', $$ select public.split_reservation_tables('e1000000-0000-4000-8000-000000000003')::text $$), 'P0001 status_invalid', 'a booking that is not seated is status_invalid');
select is(pg_temp.call('waiter', $$ select public.split_reservation_tables('e2000000-0000-4000-8000-000000000001')::text $$), 'P0002 reservation_not_found', 'another tenant''s booking is reservation_not_found');
select is(pg_temp.call('owner', $$ select public.split_reservation_tables('e1000000-0000-4000-8000-0000000000ff')::text $$), 'P0002 reservation_not_found', 'an unknown one too');
select is(left(pg_temp.call('chef', $$ select public.split_reservation_tables('e1000000-0000-4000-8000-000000000002')::text $$), 5), '42501', 'the chef gets 42501');
select is(left(pg_temp.call('chef', $$ select public.split_reservation_tables(null)::text $$), 5), '42501', 'before the id is read');
select is(pg_temp.call('owner', $$ select public.split_reservation_tables('e1000000-0000-4000-8000-000000000001')::jsonb ->> 'changed' $$), 'true', 'the owner can still call split on that booking (the API does not need the offer; the first booking''s second table is still on its assignment)');
select is(pg_temp.call('ownerb', $$ select public.split_reservation_tables('e1000000-0000-4000-8000-000000000002')::text $$) like 'P0002%', true, 'tenant B cannot reach A''s booking');

-- Overtime belongs to the booking that is seated on the lead's open session, not to an older booking that still holds the same tables (review finding) -------------------------
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('13000000-0000-4000-8000-000000000007', '11111111-1111-4111-8111-111111111111', 'Tavolo 7 (demo)', 7, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('13000000-0000-4000-8000-000000000008', '11111111-1111-4111-8111-111111111111', 'Tavolo 8 (demo)', 8, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
-- R5 on T7+T8 was seated on day 1 and its session closed normally (close_table never releases the assignment); its end is long past.
select pg_temp.mk(5, 'accepted', array['13000000-0000-4000-8000-000000000007', '13000000-0000-4000-8000-000000000008']::uuid[]);
select is(left(pg_temp.call('waiter', $$ select public.open_table('13000000-0000-4000-8000-000000000007', '14000000-0000-4000-8000-000000000007', 4)::text $$), 1), '{', 'overtime: the waiter opens Tavolo 7 for the first booking');
select is(pg_temp.go($$ select app.seat_reservation_at('11111111-1111-4111-8111-111111111111', 'd1000000-0000-4000-8000-00000000000d', 'waiter', 'e1000000-0000-4000-8000-000000000005', '14000000-0000-4000-8000-000000000007', clock_timestamp())::jsonb ->> 'status' $$), 'seated', 'and seats it');
select pg_temp.close_session('14000000-0000-4000-8000-000000000007');
update public.reservation set starts_at = now() - interval '5 hours', ends_at = now() - interval '3 hours' where id = 'e1000000-0000-4000-8000-000000000005';
-- R6 on the same two tables, seated now, well before its ends_at.
select pg_temp.mk(6, 'accepted', array['13000000-0000-4000-8000-000000000007', '13000000-0000-4000-8000-000000000008']::uuid[]);
select pg_temp.call('waiter', $$ select public.open_table('13000000-0000-4000-8000-000000000007', '14000000-0000-4000-8000-000000000077', 4)::text $$);
select pg_temp.go($$ select app.seat_reservation_at('11111111-1111-4111-8111-111111111111', 'd1000000-0000-4000-8000-00000000000d', 'waiter', 'e1000000-0000-4000-8000-000000000006', '14000000-0000-4000-8000-000000000077', clock_timestamp())::jsonb ->> 'status' $$);
select is(pg_temp.tile('13000000-0000-4000-8000-000000000008') ->> 'status', 'joined', 'overtime: Tavolo 8 is joined to the new booking');
select is(pg_temp.tile('13000000-0000-4000-8000-000000000008') -> 'joinedTo' ->> 'overtime', 'false', 'and is not overtime: the old booking that still holds Tavolo 8 is not the one seated on the open session');
update public.reservation set ends_at = now() - interval '1 minute' where id = 'e1000000-0000-4000-8000-000000000006';
select is(pg_temp.tile('13000000-0000-4000-8000-000000000008') -> 'joinedTo' ->> 'overtime', 'true', 'and it turns true when the booking seated on that session is past its own end');

-- Function rules --------------------------------------------------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'split_reservation_tables' and p.prosecdef and p.proconfig @> array['search_path=""']
            and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('service_role', p.oid, 'execute')), 1, 'split_reservation_tables is a definer with an empty search_path, for authenticated only');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname in ('split_reservation_tables_at', 'table_joined_to') and p.prosecdef and p.proconfig @> array['search_path=""']
            and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('service_role', p.oid, 'execute')), 2, 'its twin and the joined-table helper are closed to every API role');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('open_table', 'tables_list') and p.prosecdef and p.proconfig @> array['search_path=""'] and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')), 2, 'open_table and tables_list keep their security settings and grants');
select is((select count(*)::int from pg_proc where proname in ('open_table', 'tables_list') and pronamespace = 'public'::regnamespace), 2, 'one definition of each');
select is((select count(*)::int from pg_proc where proname = 'split_reservation_tables'), 1, 'one split function');

select * from finish();
rollback;
