-- Reservations review (docs/plans/2026-11-08-reservations.md section 5, A5/A6): the tables a booking with no assigned table may be seated at, as the database says them. public.reservation_detail
-- carries seatChoices [{id, name}] for owner, admin and waiter on a booking that offers "seat" and has no lead table: every active table with no open session of its own that is not joined
-- to a seated combined booking (so free and closed tables are in), by position. Any other booking has []. The screen only renders the list; it never filters Sala's tiles itself. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

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

insert into public.dining_table (id, tenant_id, name, position, is_active, created_by, updated_by) values
  ('13000000-0000-4000-8000-000000000007', '11111111-1111-4111-8111-111111111111', 'Tavolo 7 (demo)', 7, false, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
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
-- R1 on T3+T4 (to be seated), X without a table (seat offered), Y without a table for another day (no seat), Z pending without a table, W with a table (the lead is known).
select pg_temp.mk(1, 'accepted', array['13000000-0000-4000-8000-000000000003', '13000000-0000-4000-8000-000000000004']::uuid[]);
select pg_temp.mk(2, 'accepted', null);
select pg_temp.mk(3, 'pending', null);
select pg_temp.mk(4, 'accepted', array['13000000-0000-4000-8000-000000000005']::uuid[]);
select pg_temp.mk(5, 'accepted', null);
update public.reservation set business_date = business_date + 1, starts_at = starts_at + interval '1 day', ends_at = ends_at + interval '1 day' where id = 'e1000000-0000-4000-8000-000000000005';
-- The reading, as a role: the names of the seat choices of one booking, in the order given.
create function pg_temp.choices(p_role text, p_id uuid) returns text language sql as $$
  select coalesce(pg_temp.call(p_role, format($q$ select coalesce((select string_agg(c ->> 'name', ', ' order by o) from jsonb_array_elements(public.reservation_detail(%L) -> 'seatChoices') with ordinality x(c, o)), '(none)') $q$, p_id)), 'x')
$$;
create function pg_temp.name_of(p_n integer) returns uuid language sql as $$ select ('e1000000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid $$;

-- Nothing is open: every active table is a choice, in position order (the inactive Tavolo 7 and tenant B's table are not).
select is(pg_temp.choices('waiter', pg_temp.name_of(2)), 'Tavolo 1 (demo), Tavolo 2 (demo), Tavolo 3 (demo), Tavolo 4 (demo), Tavolo 5 (demo), Tavolo 6 (demo)', 'all six active tables of the tenant, by position');
-- T1 is open for a walk-in, T2 was used and closed today, T3 is open and R1 is seated on it (T4 is joined).
select pg_temp.call('waiter', $$ select public.open_table('13000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000001', 2)::text $$);
select pg_temp.call('waiter', $$ select public.open_table('13000000-0000-4000-8000-000000000002', '14000000-0000-4000-8000-000000000002', 2)::text $$);
select pg_temp.close_session('14000000-0000-4000-8000-000000000002');
select pg_temp.call('waiter', $$ select public.open_table('13000000-0000-4000-8000-000000000003', '14000000-0000-4000-8000-000000000003', 4)::text $$);
select is(pg_temp.go($$ select app.seat_reservation_at('11111111-1111-4111-8111-111111111111', 'd1000000-0000-4000-8000-00000000000d', 'waiter', 'e1000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000003', clock_timestamp())::jsonb ->> 'status' $$), 'seated', 'R1 is seated on Tavolo 3');
select is(pg_temp.tile('13000000-0000-4000-8000-000000000002') ->> 'status', 'closed', 'Tavolo 2 reads closed in Sala');
select is(pg_temp.tile('13000000-0000-4000-8000-000000000004') ->> 'status', 'joined', 'Tavolo 4 reads joined');
select is(pg_temp.choices('waiter', pg_temp.name_of(2)), 'Tavolo 2 (demo), Tavolo 5 (demo), Tavolo 6 (demo)', 'the closed table is a choice; the open ones and the joined one are not');
select is(pg_temp.choices('owner', pg_temp.name_of(2)), 'Tavolo 2 (demo), Tavolo 5 (demo), Tavolo 6 (demo)', 'the owner reads the same list');
select is(pg_temp.choices('admin', pg_temp.name_of(2)), 'Tavolo 2 (demo), Tavolo 5 (demo), Tavolo 6 (demo)', 'and the admin');
select is(pg_temp.call('waiter', format($$ select (public.reservation_detail(%L) -> 'seatChoices' -> 0)::text $$, pg_temp.name_of(2)))::jsonb, '{"id": "13000000-0000-4000-8000-000000000002", "name": "Tavolo 2 (demo)"}'::jsonb, 'a choice is exactly {id, name}');
-- The lock ends with the lead session: Tavolo 3 and Tavolo 4 are choices again (both closed or free).
select pg_temp.close_session('14000000-0000-4000-8000-000000000003');
select is(pg_temp.choices('waiter', pg_temp.name_of(2)), 'Tavolo 2 (demo), Tavolo 3 (demo), Tavolo 4 (demo), Tavolo 5 (demo), Tavolo 6 (demo)', 'once the lead session closes, the booking''s tables are choices again');
-- Bookings that do not ask for a table.
select is(pg_temp.choices('waiter', pg_temp.name_of(4)), '(none)', 'a booking with an assigned table has no choices');
select is(pg_temp.choices('waiter', pg_temp.name_of(3)), '(none)', 'a pending request offers no seat, so no choices');
select is(pg_temp.choices('waiter', pg_temp.name_of(5)), '(none)', 'a booking of another day offers no seat, so no choices');
select is(pg_temp.call('waiter', format($$ select public.reservation_detail(%L) -> 'seatChoices' $$, pg_temp.name_of(5))), '[]', 'which is an empty array, never missing');
select is(pg_temp.choices('waiter', 'e1000000-0000-4000-8000-0000000000ff'), 'P0002 reservation_not_found', 'an unknown booking is still P0002');
select is(left(pg_temp.choices('chef', pg_temp.name_of(2)), 5), '42501', 'the chef still gets 42501');
select is(pg_temp.call('ownerb', format($$ select public.reservation_detail(%L)::text $$, pg_temp.name_of(2))), 'P0002 reservation_not_found', 'another tenant cannot read it');

select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'reservation_seat_choices' and p.prosecdef and p.proconfig @> array['search_path=""']
            and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('service_role', p.oid, 'execute')), 1, 'the helper is a definer with an empty search_path, closed to every API role');

select * from finish();
rollback;
