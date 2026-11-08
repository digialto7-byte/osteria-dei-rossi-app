-- Reservations A6 (docs/plans/1998-11-08-reservations.md §3.2, §5 A6): the day view, the detail of a booking and the pending count. Services in M25c order with counts; rows by start,
-- then id; a pending request past its start reads expired; actions per role; the waiter's reply has no emailStatus and no suggestion; an erased contact reads null; the chef gets
-- 42501; tenant B's bookings are never listed; no key of any reply names money.
-- Departures from the plan text, both because of the house rule that no key names a total: the day view's per-service block is called counts (not totals), and joinedTo is a key of
-- each table of a Row (a Row is one booking), with leadTable naming the lead.
begin;
create extension if not exists pgtap with schema extensions;
select plan(87);

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
create function pg_temp.call(p_role text, stmt text, p_tenant uuid default '11111111-1111-4111-8111-111111111111') returns text language plpgsql as $$
declare
  v_out text;
  state text;
  v_auth uuid;
begin
  v_auth := case p_role when 'owner' then 'a0000000-0000-4000-8000-00000000000a' when 'admin' then 'f0000000-0000-4000-8000-00000000000f'
                        when 'waiter' then 'd0000000-0000-4000-8000-00000000000d' when 'chef' then 'c0000000-0000-4000-8000-00000000000c' else 'b0000000-0000-4000-8000-00000000000b' end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated', 'tenant_id', p_tenant, 'app_role', case p_role when 'ownerb' then 'owner' else p_role end)::text, true);
  set local role authenticated;
  execute stmt into v_out;
  reset role;
  return v_out;
exception when others then
  get stacked diagnostics state = returned_sqlstate;
  reset role;
  return state;
end
$$;
-- Like call, but the reply is the SQLSTATE and the message.
create function pg_temp.callm(p_role text, stmt text) returns text language plpgsql as $$
declare
  v_out text;
  state text;
  msg text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', case p_role when 'owner' then 'a0000000-0000-4000-8000-00000000000a' else 'd0000000-0000-4000-8000-00000000000d' end, 'role', 'authenticated', 'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', p_role)::text, true);
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
-- The day view of tenant A for a role at a fixed now.
create function pg_temp.day(p_role text, p_date date default '1998-11-20', p_now text default '1998-11-20 18:00+00') returns jsonb language sql as $$
  select app.reservations_day_json('11111111-1111-4111-8111-111111111111', p_role, p_date, p_now::timestamptz)
$$;
create function pg_temp.row_of(p_j jsonb, p_id text) returns jsonb language sql as $$
  select r from jsonb_array_elements(p_j -> 'services') s, jsonb_array_elements(s -> 'reservations') r where r ->> 'id' = p_id
$$;
create function pg_temp.keys(p_j jsonb) returns text[] language sql as $$
  with recursive walk(v) as (
    select p_j
    union all
    select x.c from walk w cross join lateral (
      select e.value as c from jsonb_each(case when jsonb_typeof(w.v) = 'object' then w.v else '{}'::jsonb end) e
      union all
      select a from jsonb_array_elements(case when jsonb_typeof(w.v) = 'array' then w.v else '[]'::jsonb end) a) x)
  select coalesce(array_agg(distinct k order by k), '{}') from (select jsonb_object_keys(v) k from walk where jsonb_typeof(v) = 'object') x
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
  ('23000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Tavolo B (demo)', 1, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.table_group (tenant_id, id, name, seats, created_by) values ('11111111-1111-4111-8111-111111111111', 'e5000000-0000-4000-8000-000000000001', 'T1+T2', 6, 'a1000000-0000-4000-8000-00000000000a');
insert into public.table_group_member (tenant_id, table_group_id, dining_table_id) values
  ('11111111-1111-4111-8111-111111111111', 'e5000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000001'),
  ('11111111-1111-4111-8111-111111111111', 'e5000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000002');

-- The day, 1998-11-20 (UTC times; Rome is one hour ahead). Pranzo: P1 accepted, started (11:30Z). Cena: C3 pending 17:00Z (before now, so expired), C1 pending 19:00Z, C2 accepted 19:00Z on
-- T1+T2, C4 declined 20:00Z, C5 accepted 20:00Z with an erased contact. Also: a booking of another day (X), a booking of tenant B (RB), and a booking of the old service key 'brunch' (H).
create function pg_temp.mk(p_n integer, p_status public.reservation_status, p_from timestamptz, p_party integer, p_service text default 'cena', p_date date default '1998-11-20', p_contact boolean default true) returns void language plpgsql as $$
declare
  v_id uuid := ('e1000000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid;
begin
  insert into public.reservation (tenant_id, id, status, business_date, service_key, starts_at, ends_at, party, privacy_notice_version, privacy_ack_at)
    values ('11111111-1111-4111-8111-111111111111', v_id, p_status, p_date, p_service, p_from, p_from + interval '2 hours', p_party, 'v1', '1998-11-01 10:00+00');
  if p_contact then
    insert into public.reservation_contact (tenant_id, reservation_id, name, phone, email, locale)
      values ('11111111-1111-4111-8111-111111111111', v_id, 'Cliente ' || p_n || ' Demo', '39000000' || lpad(p_n::text, 4, '0'), 'cliente' || p_n || '@example.com', 'it');
  end if;
end
$$;
select pg_temp.mk(1, 'accepted', '1998-11-20 11:30+00', 2, 'pranzo');
select pg_temp.mk(13, 'pending', '1998-11-20 17:00+00', 3);
select pg_temp.mk(11, 'pending', '1998-11-20 19:00+00', 4);
select pg_temp.mk(12, 'accepted', '1998-11-20 19:00+00', 2);
select pg_temp.mk(14, 'declined', '1998-11-20 20:00+00', 5);
select pg_temp.mk(15, 'accepted', '1998-11-20 20:00+00', 2, 'cena', '1998-11-20', false);
select pg_temp.mk(20, 'pending', '1998-11-21 19:00+00', 2, 'cena', '1998-11-21');
select pg_temp.mk(21, 'accepted', '1998-11-20 12:00+00', 2, 'brunch');
insert into public.reservation (tenant_id, id, business_date, service_key, starts_at, ends_at, party, privacy_notice_version, privacy_ack_at)
  values ('22222222-2222-4222-8222-222222222222', 'e2000000-0000-4000-8000-000000000001', '1998-11-20', 'cena', '1998-11-20 19:00+00', '1998-11-20 21:00+00', 2, 'v1', now());
insert into public.reservation_contact (tenant_id, reservation_id, name, phone, email, locale)
  values ('22222222-2222-4222-8222-222222222222', 'e2000000-0000-4000-8000-000000000001', 'Cliente B Demo', '390000009999', 'cliente.b@example.com', 'it');
insert into public.reservation_table (tenant_id, reservation_id, dining_table_id, table_group_id, assigned_at, assigned_by) values
  ('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-000000000012', '13000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000001', '1998-11-10 10:00+00', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-000000000012', '13000000-0000-4000-8000-000000000002', 'e5000000-0000-4000-8000-000000000001', '1998-11-10 10:00+00', 'a1000000-0000-4000-8000-00000000000a');
insert into public.reservation_event (tenant_id, reservation_id, kind, data, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-000000000011', 'requested', '{"party": 4}', null),
  ('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-000000000012', 'requested', '{"party": 2}', null),
  ('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-000000000012', 'accepted', '{"tableIds": [], "groupId": null}', 'a1000000-0000-4000-8000-00000000000a');
insert into public.reservation_email (tenant_id, reservation_id, kind, status) values
  ('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-000000000011', 'received', 'sent'),
  ('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-000000000012', 'received', 'sent'),
  ('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-000000000012', 'accepted', 'queued');

-- The day ----------------------------------------------------------------------------------------------------------------------------------------------------------
create temp table d_owner as select pg_temp.day('owner') as j;
select is((select j ->> 'businessDate' from d_owner), '1998-11-20', 'the business date');
select is((select jsonb_agg(s ->> 'key' order by o) from d_owner, jsonb_array_elements(j -> 'services') with ordinality t(s, o)), '["pranzo", "cena", "brunch"]'::jsonb, 'services in M25c order, then an old key that still has a booking');
select is((select s ->> 'name' || ',' || (s ->> 'startsAt') || ',' || (s ->> 'endsAt') from d_owner, jsonb_array_elements(j -> 'services') s where s ->> 'key' = 'pranzo'), 'Pranzo,11:00,16:00', 'Pranzo: name and window');
select is((select s ->> 'name' || ',' || (s ->> 'startsAt') || ',' || (s ->> 'endsAt') from d_owner, jsonb_array_elements(j -> 'services') s where s ->> 'key' = 'cena'), 'Cena,16:00,02:00', 'Cena: name and window (to the cut-off)');
select is((select (s -> 'startsAt') from d_owner, jsonb_array_elements(j -> 'services') s where s ->> 'key' = 'brunch'), 'null'::jsonb, 'an old key has no window');
select is((select s ->> 'name' from d_owner, jsonb_array_elements(j -> 'services') s where s ->> 'key' = 'brunch'), 'brunch', 'and shows its key as its name');
select is((select s -> 'counts' from d_owner, jsonb_array_elements(j -> 'services') s where s ->> 'key' = 'cena'), '{"reservations": 3, "covers": 8, "pending": 1}'::jsonb,
          'Cena counts: 3 live bookings (pending, accepted, accepted), 8 covers, 1 to confirm; the expired and the declined are not counted');
select is((select s -> 'counts' from d_owner, jsonb_array_elements(j -> 'services') s where s ->> 'key' = 'pranzo'), '{"reservations": 1, "covers": 2, "pending": 0}'::jsonb, 'Pranzo counts');
select is((select jsonb_agg(r ->> 'id' order by o) from d_owner, jsonb_array_elements(j -> 'services') s, jsonb_array_elements(s -> 'reservations') with ordinality t(r, o) where s ->> 'key' = 'cena'),
          '["e1000000-0000-4000-8000-000000000013", "e1000000-0000-4000-8000-000000000011", "e1000000-0000-4000-8000-000000000012", "e1000000-0000-4000-8000-000000000014", "e1000000-0000-4000-8000-000000000015"]'::jsonb,
          'rows ordered by start, then id');
select is((select count(*)::int from d_owner, jsonb_array_elements(j -> 'services') s, jsonb_array_elements(s -> 'reservations') r where r ->> 'id' in ('e1000000-0000-4000-8000-000000000020', 'e2000000-0000-4000-8000-000000000001')), 0, 'another day''s booking and tenant B''s are not listed');
select is(pg_temp.row_of((select j from d_owner), 'e1000000-0000-4000-8000-000000000013') ->> 'status', 'expired', 'a pending request past its start reads expired');
select is((select status::text from public.reservation where id = 'e1000000-0000-4000-8000-000000000013'), 'pending', 'while the stored status is still pending');
select is(pg_temp.row_of((select j from d_owner), 'e1000000-0000-4000-8000-000000000011') ->> 'status', 'pending', 'a future pending request reads pending');
select is(pg_temp.day('owner', '1998-11-20', '1998-11-20 16:59:59+00') -> 'services' -> 1 -> 'reservations' -> 0 ->> 'status', 'pending', 'one second before its start it still reads pending (17:00Z is the start)');
select is(pg_temp.day('owner', '1998-11-20', '1998-11-20 17:00:00+00') -> 'services' -> 1 -> 'reservations' -> 0 ->> 'status', 'expired', 'at its start it reads expired');
select is(pg_temp.row_of((select j from d_owner), 'e1000000-0000-4000-8000-000000000011') ->> 'time', '20:00', 'the time is local (Rome): 19:00Z is 20:00');
select is(pg_temp.row_of((select j from d_owner), 'e1000000-0000-4000-8000-000000000011') ->> 'name', 'Cliente 11 Demo', 'the row carries the name');
select is(pg_temp.row_of((select j from d_owner), 'e1000000-0000-4000-8000-000000000011') ->> 'phone', '390000000011', 'the phone');
select is(pg_temp.row_of((select j from d_owner), 'e1000000-0000-4000-8000-000000000011') ->> 'email', 'cliente11@example.com', 'and the e-mail');
select is(pg_temp.row_of((select j from d_owner), 'e1000000-0000-4000-8000-000000000011') ->> 'emailStatus', 'sent', 'emailStatus is the latest outbox status (owner)');
select is(pg_temp.row_of((select j from d_owner), 'e1000000-0000-4000-8000-000000000012') ->> 'emailStatus', 'queued', 'the latest of two rows');
select is(pg_temp.row_of((select j from d_owner), 'e1000000-0000-4000-8000-000000000012') -> 'tables', '[{"id": "13000000-0000-4000-8000-000000000001", "name": "Tavolo 1 (demo)", "joinedTo": null}, {"id": "13000000-0000-4000-8000-000000000002", "name": "Tavolo 2 (demo)", "joinedTo": {"id": "13000000-0000-4000-8000-000000000001", "name": "Tavolo 1 (demo)"}}]'::jsonb,
          'a two-table assignment: the second table is joined to the lead (the lowest position)');
select is(pg_temp.row_of((select j from d_owner), 'e1000000-0000-4000-8000-000000000012') -> 'leadTable' ->> 'name', 'Tavolo 1 (demo)', 'the Row names its lead table');
select is(pg_temp.row_of((select j from d_owner), 'e1000000-0000-4000-8000-000000000012') ->> 'groupName', 'T1+T2', 'and the group');
select is(pg_temp.row_of((select j from d_owner), 'e1000000-0000-4000-8000-000000000011') -> 'tables', '[]'::jsonb, 'a booking with no table lists none');
select is(pg_temp.row_of((select j from d_owner), 'e1000000-0000-4000-8000-000000000015') -> 'name', 'null'::jsonb, 'an erased contact: name null');
select is(pg_temp.row_of((select j from d_owner), 'e1000000-0000-4000-8000-000000000015') -> 'phone', 'null'::jsonb, 'phone null');
select is(pg_temp.row_of((select j from d_owner), 'e1000000-0000-4000-8000-000000000015') -> 'email', 'null'::jsonb, 'e-mail null');

-- Actions per role ---------------------------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.row_of((select j from d_owner), 'e1000000-0000-4000-8000-000000000011') -> 'actions', '["accept", "decline", "move", "erase"]'::jsonb, 'owner on a pending booking: accept, decline, move, erase');
select is(pg_temp.row_of((select j from d_owner), 'e1000000-0000-4000-8000-000000000013') -> 'actions', '["erase"]'::jsonb, 'owner on an expired request: only erase');
select is(pg_temp.row_of((select j from d_owner), 'e1000000-0000-4000-8000-000000000012') -> 'actions', '["decline", "move", "tables", "arrived", "seat", "erase"]'::jsonb, 'owner on an accepted booking on its day, before its start: decline, move, tables, arrived, seat, erase');
select is(pg_temp.row_of((select j from d_owner), 'e1000000-0000-4000-8000-000000000001') -> 'actions', '["decline", "move", "tables", "arrived", "no_show", "seat", "erase"]'::jsonb, 'once it has started: no_show too');
select is(pg_temp.row_of((select j from d_owner), 'e1000000-0000-4000-8000-000000000014') -> 'actions', '["erase"]'::jsonb, 'a declined booking: erase only');
select is(pg_temp.row_of((select j from d_owner), 'e1000000-0000-4000-8000-000000000015') -> 'actions', '["decline", "move", "tables", "arrived", "seat"]'::jsonb, 'an erased contact has no erase action (and, before its start, no no_show)');
create temp table d_waiter as select pg_temp.day('waiter') as j;
select is(pg_temp.row_of((select j from d_waiter), 'e1000000-0000-4000-8000-000000000001') -> 'actions', '["arrived", "no_show", "seat"]'::jsonb, 'waiter on an accepted booking on its day: arrived, no_show, seat');
select is(pg_temp.row_of((select j from d_waiter), 'e1000000-0000-4000-8000-000000000011') -> 'actions', '[]'::jsonb, 'the waiter never gets accept (nor anything on a pending booking)');
select is(pg_temp.row_of((select j from d_waiter), 'e1000000-0000-4000-8000-000000000012') -> 'actions', '["arrived", "seat"]'::jsonb, 'before the start there is no no_show');
select is((select count(*)::int from d_waiter, jsonb_array_elements(j -> 'services') s, jsonb_array_elements(s -> 'reservations') r, jsonb_array_elements_text(r -> 'actions') a where a in ('accept', 'decline', 'move', 'tables', 'erase')), 0, 'no owner action appears anywhere in the waiter''s day');
select is((select count(*)::int from d_waiter, jsonb_array_elements(j -> 'services') s, jsonb_array_elements(s -> 'reservations') r where r ? 'emailStatus'), 0, 'the waiter''s rows have no emailStatus key');
select is(pg_temp.row_of((select j from d_waiter), 'e1000000-0000-4000-8000-000000000011') ->> 'name', 'Cliente 11 Demo', 'but they carry the customer''s name');
select is(pg_temp.day('waiter', '1998-11-20', '1998-11-19 12:00+00') -> 'services' -> 1 -> 'reservations' -> 1 -> 'actions', '[]'::jsonb, 'the day before there is no arrived or seat action');

-- Detail ----------------------------------------------------------------------------------------------------------------------------------------------------------
create temp table dt_owner as select app.reservation_detail_json('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-000000000011', 'owner', '1998-11-20 18:00+00') as j;
select is((select j -> 'events' from dt_owner), jsonb_build_array(jsonb_build_object('kind', 'requested', 'at', (select created_at from public.reservation_event where reservation_id = 'e1000000-0000-4000-8000-000000000011'))), 'the events carry only kind and at');
select is((select (j ? 'suggestion') from dt_owner), true, 'the owner''s detail of a pending booking has a suggestion');
select is((select j -> 'suggestion' -> 'suggested' from dt_owner), 'null'::jsonb, 'whose value is null here: the only fit, the group T1+T2, is held by the accepted booking at the same time');
select is((select (j ? 'suggestion') from (select app.reservation_detail_json('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-000000000011', 'waiter', '1998-11-20 18:00+00') as j) x), false, 'the waiter''s detail has no suggestion');
select is((select (j ? 'emailStatus') from (select app.reservation_detail_json('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-000000000011', 'waiter', '1998-11-20 18:00+00') as j) x), false, 'and no emailStatus');
select is((select (j ? 'suggestion') from (select app.reservation_detail_json('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-000000000014', 'owner', '1998-11-20 18:00+00') as j) x), false, 'a declined booking has no suggestion');
select is((select (j ? 'suggestion') from (select app.reservation_detail_json('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-000000000013', 'owner', '1998-11-20 18:00+00') as j) x), false, 'nor an expired one');
select is(pg_temp.go($$ select app.reservation_detail_json('11111111-1111-4111-8111-111111111111', 'e2000000-0000-4000-8000-000000000001', 'owner', now())::text $$), 'P0002 reservation_not_found', 'tenant B''s booking is reservation_not_found');
select is(pg_temp.go($$ select app.reservation_detail_json('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-0000000000ff', 'owner', now())::text $$), 'P0002 reservation_not_found', 'and so is an unknown one');

-- The keys: no money ----------------------------------------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from unnest(pg_temp.keys((select j from d_owner))) k where k ~* 'eur|cost|price|margin|total'), 0, 'no key of the owner''s day view names money (a recursive key scan)');
select is((select count(*)::int from unnest(pg_temp.keys((select j from dt_owner))) k where k ~* 'eur|cost|price|margin|total'), 0, 'nor of the detail');
select is((select count(*)::int from unnest(pg_temp.keys((select j from d_owner))) k where k in ('createdBy', 'created_by', 'userId', 'staff')), 0, 'and no key names a staff member');

-- The window of the day read (plan 3.4: 62 days back up to the settings horizon, 60 by default; anything else is P0001 date_invalid) -----------------------------------------------
select is(pg_temp.go($$ select (pg_temp.day('owner', '1998-11-20'::date - 62) ->> 'businessDate') $$), '1998-09-19', 'the window: 62 days back is read');
select is(pg_temp.go($$ select (pg_temp.day('owner', '1998-11-20'::date - 63) ->> 'businessDate') $$), 'P0001 date_invalid', '63 days back is date_invalid');
select is(pg_temp.go($$ select (pg_temp.day('owner', '1998-11-20'::date + 60) ->> 'businessDate') $$), '1999-01-19', 'the default horizon (60 days ahead) is read');
select is(pg_temp.go($$ select (pg_temp.day('owner', '1998-11-20'::date + 61) ->> 'businessDate') $$), 'P0001 date_invalid', 'one day past the horizon is date_invalid');
select is(pg_temp.go($$ select (pg_temp.day('waiter', '1998-11-20'::date + 61) ->> 'businessDate') $$), 'P0001 date_invalid', 'for the waiter too');
-- The window is the business date of the call, not the calendar's: at 00:30 Rome (23:30Z) the business day is still the day before (cut-off 02:00).
select is(pg_temp.go($$ select (app.reservations_day_json('11111111-1111-4111-8111-111111111111', 'owner', '1998-11-20'::date - 62, '1998-11-20 23:30+00'::timestamptz) ->> 'businessDate') $$), '1998-09-19', 'at 00:30 Rome the 21st''s window still starts from the 20th (62 days back is read)');
select is(pg_temp.go($$ select (app.reservations_day_json('11111111-1111-4111-8111-111111111111', 'owner', '1998-11-20'::date - 63, '1998-11-20 23:30+00'::timestamptz) ->> 'businessDate') $$), 'P0001 date_invalid', 'and 63 days back is still refused');
-- The horizon is the tenant's setting.
select pg_temp.go($$ select app.set_reservation_settings_at('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', '{"horizonDays": 10}'::jsonb, '1998-11-20 18:00+00'::timestamptz)::text $$);
select is(pg_temp.go($$ select (pg_temp.day('owner', '1998-11-20'::date + 10) ->> 'businessDate') $$), '1998-11-30', 'with horizonDays 10, ten days ahead is read');
select is(pg_temp.go($$ select (pg_temp.day('owner', '1998-11-20'::date + 11) ->> 'businessDate') $$), 'P0001 date_invalid', 'and eleven is date_invalid');
-- Through the public function, on the real clock: a date out of the window is P0001, for every role that may read.
select is(pg_temp.callm('owner', $$ select public.reservations_day(((now() at time zone 'Europe/Rome')::date - 65))::text $$), 'P0001 date_invalid', 'public.reservations_day: 65 days back is P0001');
select is(pg_temp.callm('waiter', $$ select public.reservations_day(((now() at time zone 'Europe/Rome')::date + 12))::text $$), 'P0001 date_invalid', 'with horizonDays 10, twelve ahead is P0001 for the waiter');

-- Staff bookings are not bound by the horizon, so the window's upper end is the later of the horizon and the latest live booking (pending, accepted, arrived); a finished one does not widen it.
select pg_temp.go($$ select app.set_reservation_settings_at('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', '{"horizonDays": 60}'::jsonb, '1998-11-20 18:00+00'::timestamptz)::text $$);
select pg_temp.mk(40, 'accepted', '1999-02-18 19:00+00', 2, 'cena', '1999-02-18');
select is(pg_temp.go($$ select (pg_temp.day('owner', '1998-11-20'::date + 90) ->> 'businessDate') $$), '1999-02-18', 'horizon 60, a staff booking at +90: its day is read');
select is(pg_temp.go($$ select (pg_temp.day('owner', '1998-11-20'::date + 91) ->> 'businessDate') $$), 'P0001 date_invalid', 'and the day after it is date_invalid');
select pg_temp.mk(41, 'declined', '1999-03-20 19:00+00', 2, 'cena', '1999-03-20');
select is(pg_temp.go($$ select (pg_temp.day('owner', '1998-11-20'::date + 120) ->> 'businessDate') $$), 'P0001 date_invalid', 'a declined booking further out does not widen the window');
select pg_temp.go($$ select app.set_reservation_settings_at('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', '{"horizonDays": 30}'::jsonb, '1998-11-20 18:00+00'::timestamptz)::text $$);
select pg_temp.mk(42, 'accepted', '1999-01-04 19:00+00', 2, 'cena', '1999-01-04');
select is(pg_temp.go($$ select (pg_temp.day('owner', '1998-11-20'::date + 45) ->> 'businessDate') $$), '1999-01-04', 'the horizon lowered to 30 with a booking on day 45: day 45 is still read');
select is(pg_temp.go($$ select (pg_temp.day('waiter', '1998-11-20'::date + 91) ->> 'businessDate') $$), 'P0001 date_invalid', 'and beyond the latest live booking is still date_invalid, for the waiter too');

-- The public reads run on the real clock, so they read today's business day (1998 is outside the window): one accepted booking per service of A (and an old key), one of B.
create temp table today_bd as select app.business_date('11111111-1111-4111-8111-111111111111', now()) as d;
select pg_temp.mk(31, 'accepted', now(), 2, 'pranzo', (select d from today_bd));
select pg_temp.mk(32, 'accepted', now(), 2, 'cena', (select d from today_bd));
select pg_temp.mk(33, 'accepted', now(), 2, 'brunch', (select d from today_bd));
insert into public.reservation (tenant_id, id, status, business_date, service_key, starts_at, ends_at, party, privacy_notice_version, privacy_ack_at)
  values ('22222222-2222-4222-8222-222222222222', 'e2000000-0000-4000-8000-000000000002', 'accepted', (select d from today_bd), 'cena', now(), now() + interval '2 hours', 2, 'v1', now());

-- Public wrappers, roles, pending count -------------------------------------------------------------------------------------------------------------------------------
select is(left(pg_temp.call('chef', $$ select public.reservations_day('1998-11-20')::text $$), 5), '42501', 'reservations_day: the chef gets 42501');
select is(left(pg_temp.call('chef', $$ select public.reservation_detail('e1000000-0000-4000-8000-000000000011')::text $$), 5), '42501', 'reservation_detail: the chef gets 42501');
select is(left(pg_temp.call('chef', $$ select public.reservations_pending_count()::text $$), 5), '42501', 'reservations_pending_count: the chef gets 42501');
select is(left(pg_temp.call('waiter', $$ select public.reservations_pending_count()::text $$), 5), '42501', 'reservations_pending_count: the waiter gets 42501 too (owner and admin only)');
select is(pg_temp.call('waiter', format($$ select (public.reservations_day(%L) ->> 'businessDate') $$, (select d from today_bd))), (select d::text from today_bd), 'reservations_day: the waiter reads the day');
select is(pg_temp.call('owner', format($$ select jsonb_array_length(public.reservations_day(%L) -> 'services')::text $$, (select d from today_bd))), '3', 'the owner reads it');
select is(pg_temp.call('waiter', format($$ select (public.reservation_detail(%L) ->> 'party') $$, 'e1000000-0000-4000-8000-000000000011')), '4', 'the waiter reads a detail');
select is(pg_temp.call('ownerb', format($$ select (public.reservations_day(%L) -> 'services' -> 0 -> 'reservations')::text $$, (select d from today_bd)), '22222222-2222-4222-8222-222222222222'), '[]', 'owner B''s Pranzo has none of A''s bookings');
select is(pg_temp.call('ownerb', format($$ select (public.reservations_day(%L) -> 'services' -> 1 -> 'reservations' -> 0 ->> 'id') $$, (select d from today_bd)), '22222222-2222-4222-8222-222222222222'), 'e2000000-0000-4000-8000-000000000002', 'which is its own');
select is(pg_temp.call('ownerb', format($$ select public.reservation_detail(%L)::text $$, 'e1000000-0000-4000-8000-000000000011'), '22222222-2222-4222-8222-222222222222'), 'P0002', 'B cannot read A''s detail');
select is(pg_temp.call('owner', $$ select (public.reservations_day(null) ->> 'businessDate') $$), app.business_date('11111111-1111-4111-8111-111111111111', now())::text, 'a null date is today''s business date');
select is(app.reservations_pending_json('11111111-1111-4111-8111-111111111111', '1998-11-20 18:00+00'), '{"pending": 2}'::jsonb, 'the pending count: two requests that have not started yet (the expired one, the accepted ones and tenant B''s are not counted)');
select is(app.reservations_pending_json('11111111-1111-4111-8111-111111111111', '1998-11-20 16:59:59+00'), '{"pending": 3}'::jsonb, 'one second before the 17:00Z request starts it still counts');
select is(app.reservations_pending_json('11111111-1111-4111-8111-111111111111', '1998-11-20 17:00:00+00'), '{"pending": 2}'::jsonb, 'at its start it no longer counts');
select is(app.reservations_pending_json('22222222-2222-4222-8222-222222222222', '1998-11-20 18:00+00'), '{"pending": 1}'::jsonb, 'tenant B counts its own request only');
select is(pg_temp.call('admin', $$ select (public.reservations_pending_count() -> 'pending')::text $$) ~ '^[0-9]+$', true, 'the admin reads the count through the public function');

-- Function rules --------------------------------------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('reservations_day', 'reservation_detail', 'reservations_pending_count') and p.prosecdef and p.proconfig @> array['search_path=""']
            and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('service_role', p.oid, 'execute')), 3,
          'the three public functions are definers with an empty search_path, for authenticated only');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname in ('reservations_day_json', 'reservations_pending_json') and p.prosecdef and p.proconfig @> array['search_path=""']
            and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('service_role', p.oid, 'execute')), 2, 'the two twins are closed to every API role');

select * from finish();
rollback;
