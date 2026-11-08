-- Reservations A5 (docs/plans/1998-11-08-reservations.md §3.2, §5 A5): the staff actions on a request. Accept (with tables, a group or none), decline, move, assign tables,
-- mark arrived or no-show, seat on an open table session, erase the contact. Each _at twin takes p_now so the clock is fixed; the roles are tested on the public wrappers.
-- Fake data only (Osteria Demo A/B, Titolare Demo, Admin Demo, Chef Demo, Cameriere Demo, Cliente Demo, cliente.demo@example.com).
begin;
create extension if not exists pgtap with schema extensions;
select plan(127);

create function pg_temp.go(stmt text) returns text language plpgsql as $$
declare
  v_out text;
  state text;
  msg text;
  det text;
begin
  execute stmt into v_out;
  return v_out;
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text, det = pg_exception_detail;
  return state || ' ' || msg || coalesce(' ' || nullif(det, ''), '');
end
$$;
-- The twin as the owner of A with a fixed now; p_what is the function name, p_args the arguments after the user.
create function pg_temp.tw(p_what text, p_id uuid, p_body text, p_now text default '1998-11-10 10:00+00', p_role text default 'owner') returns text language sql as $$
  select pg_temp.go(format('select app.%s_at(%L, %L, %L, %L, %L::jsonb, %L::timestamptz)::text', p_what, '11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', p_role, p_id, p_body, p_now))
$$;
create function pg_temp.j(p text) returns jsonb language sql as $$ select p::jsonb $$;
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
  ('23000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Tavolo B (demo)', 1, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.table_group (tenant_id, id, name, seats, created_by) values ('11111111-1111-4111-8111-111111111111', 'e5000000-0000-4000-8000-000000000001', 'T1+T3', 6, 'a1000000-0000-4000-8000-00000000000a');
insert into public.table_group_member (tenant_id, table_group_id, dining_table_id) values
  ('11111111-1111-4111-8111-111111111111', 'e5000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000001'),
  ('11111111-1111-4111-8111-111111111111', 'e5000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000003');
-- Sessions: s1 open on Tavolo 2, s3 open on Tavolo 3, s2 closed on Tavolo 1; sB open in tenant B. (Tavolo 1 has no open session.)
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_at, opened_by, business_date, created_by, updated_by) values
  ('14000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000002', 'Tavolo 2 (demo)', 3, '1998-11-20 19:10+00', 'd1000000-0000-4000-8000-00000000000d', '1998-11-20', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'),
  ('14000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000003', 'Tavolo 3 (demo)', 3, '1998-11-20 19:10+00', 'd1000000-0000-4000-8000-00000000000d', '1998-11-20', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'),
  ('24000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', '23000000-0000-4000-8000-000000000001', 'Tavolo B (demo)', 2, '1998-11-20 19:30+00', 'b1000000-0000-4000-8000-00000000000b', '1998-11-20', 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_at, opened_by, business_date, closed_at, closed_by, created_by, updated_by) values
  ('14000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000001', 'Tavolo 1 (demo)', 2, '1998-11-20 17:10+00', 'd1000000-0000-4000-8000-00000000000d', '1998-11-20', '1998-11-20 18:30+00', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d');

-- Bookings: R1..R6 pending on 1998-11-20 (20:00Z to 22:00Z), each with a contact; R6's contact has no e-mail; RB belongs to tenant B.
create function pg_temp.mk(p_n integer, p_status public.reservation_status default 'pending', p_from timestamptz default '1998-11-20 20:00+00', p_party integer default 3, p_email text default 'cliente.demo@example.com') returns uuid language plpgsql as $$
declare
  v_id uuid := ('e1000000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid;
begin
  insert into public.reservation (tenant_id, id, status, business_date, service_key, starts_at, ends_at, party, privacy_notice_version, privacy_ack_at)
    values ('11111111-1111-4111-8111-111111111111', v_id, p_status, (p_from at time zone 'Europe/Rome')::date, 'cena', p_from, p_from + interval '2 hours', p_party, 'v1', '1998-11-01 10:00+00');
  insert into public.reservation_contact (tenant_id, reservation_id, name, phone, email, locale)
    values ('11111111-1111-4111-8111-111111111111', v_id, 'Cliente Demo', '39000000' || lpad(p_n::text, 4, '0'), p_email, 'it');
  return v_id;
end
$$;
select pg_temp.mk(1);
select pg_temp.mk(2);
select pg_temp.mk(3);
select pg_temp.mk(4);
select pg_temp.mk(5, 'pending', '1998-11-20 20:00+00', 3, null);
insert into public.reservation (tenant_id, id, business_date, service_key, starts_at, ends_at, party, privacy_notice_version, privacy_ack_at)
  values ('22222222-2222-4222-8222-222222222222', 'e2000000-0000-4000-8000-000000000001', '1998-11-20', 'cena', '1998-11-20 20:00+00', '1998-11-20 22:00+00', 2, 'v1', now());
insert into public.reservation_contact (tenant_id, reservation_id, name, phone, email, locale)
  values ('22222222-2222-4222-8222-222222222222', 'e2000000-0000-4000-8000-000000000001', 'Cliente B Demo', '390000009999', 'cliente.b@example.com', 'it');

-- Accept ---------------------------------------------------------------------------------------------------------------------------------------------------------
create temp table a1 as select pg_temp.tw('accept_reservation', 'e1000000-0000-4000-8000-000000000001', '{"tableIds": ["13000000-0000-4000-8000-000000000002"], "groupId": null}')::jsonb as j;
select is((select j ->> 'changed' from a1), 'true', 'accept with the suggested table: changed');
select is((select j ->> 'status' from a1), 'accepted', 'the reply is the detail: status accepted');
select is((select j -> 'tables' -> 0 ->> 'name' from a1), 'Tavolo 2 (demo)', 'with its table');
select is((select status::text from public.reservation where id = 'e1000000-0000-4000-8000-000000000001'), 'accepted', 'stored as accepted');
select is((select count(*)::int from public.reservation_table where reservation_id = 'e1000000-0000-4000-8000-000000000001' and released_at is null and table_group_id is null), 1, 'one assignment row, no group');
select is((select kind || ',' || (created_by = 'a1000000-0000-4000-8000-00000000000a')::text from public.reservation_event where reservation_id = 'e1000000-0000-4000-8000-000000000001' order by seq desc limit 1), 'accepted,true', 'an accepted event by the user');
select is((select data from public.reservation_event where reservation_id = 'e1000000-0000-4000-8000-000000000001' and kind = 'accepted'), '{"tableIds": ["13000000-0000-4000-8000-000000000002"], "groupId": null}'::jsonb, 'whose data is table ids only');
select is((select kind || ',' || status from public.reservation_email where reservation_id = 'e1000000-0000-4000-8000-000000000001'), 'accepted,queued', 'an accepted e-mail is queued');
select is(pg_temp.tw('accept_reservation', 'e1000000-0000-4000-8000-000000000001', '{"tableIds": ["13000000-0000-4000-8000-000000000002"], "groupId": null}')::jsonb ->> 'changed', 'false', 'accepting again with the same tables changes nothing');
select is((select count(*)::int from public.reservation_event where reservation_id = 'e1000000-0000-4000-8000-000000000001'), 1, 'and writes no event');
select is((select count(*)::int from public.reservation_email where reservation_id = 'e1000000-0000-4000-8000-000000000001'), 1, 'and no second e-mail');
select is(pg_temp.tw('accept_reservation', 'e1000000-0000-4000-8000-000000000001', '{"tableIds": ["13000000-0000-4000-8000-000000000003"], "groupId": null}'), 'P0001 status_invalid', 'accepting an accepted booking with other tables is status_invalid (use assign)');
select is(pg_temp.tw('accept_reservation', 'e1000000-0000-4000-8000-000000000002', '{"tableIds": ["13000000-0000-4000-8000-000000000002"], "groupId": null}'), 'P0001 table_taken', 'the same table for an overlapping booking is table_taken');
select is((select status::text from public.reservation where id = 'e1000000-0000-4000-8000-000000000002'), 'pending', 'and the second booking stays pending');
select is(pg_temp.tw('accept_reservation', 'e1000000-0000-4000-8000-000000000002', '{"tableIds": ["13000000-0000-4000-8000-000000000001"], "groupId": "e5000000-0000-4000-8000-000000000001"}'), 'P0001 group_mismatch', 'a groupId with other tableIds is group_mismatch');
select is(pg_temp.tw('accept_reservation', 'e1000000-0000-4000-8000-000000000002', '{"tableIds": ["23000000-0000-4000-8000-000000000001"], "groupId": null}'), 'P0002 table_not_found', 'tenant B''s table is table_not_found');
select is(pg_temp.tw('accept_reservation', 'e1000000-0000-4000-8000-000000000002', '{"tableIds": null, "groupId": "e5000000-0000-4000-8000-0000000000ff"}'), 'P0002 table_not_found', 'an unknown group is table_not_found');
select is(pg_temp.tw('accept_reservation', 'e1000000-0000-4000-8000-000000000002', '{"tableIds": ["13000000-0000-4000-8000-000000000001", "13000000-0000-4000-8000-000000000001"], "groupId": null}'), 'P0002 table_not_found', 'the same table twice is refused');
select is(pg_temp.tw('accept_reservation', 'e1000000-0000-4000-8000-000000000002', '{"tableIds": ["13000000-0000-4000-8000-000000000001"]}'), '22023 invalid_request', 'a body without groupId is 22023');
select is(pg_temp.tw('accept_reservation', 'e1000000-0000-4000-8000-000000000002', '{"tableIds": null, "groupId": null, "x": 1}'), '22023 invalid_request', 'an unknown key is 22023');
select is(pg_temp.tw('accept_reservation', 'e1000000-0000-4000-8000-000000000002', '{"tableIds": "x", "groupId": null}'), '22023 invalid_request', 'tableIds must be an array or null');
create temp table a2 as select pg_temp.tw('accept_reservation', 'e1000000-0000-4000-8000-000000000002', '{"tableIds": null, "groupId": "e5000000-0000-4000-8000-000000000001"}')::jsonb as j;
select is((select j ->> 'status' from a2), 'accepted', 'a group alone: accepted');
select is((select string_agg(dining_table_id::text || ':' || (table_group_id is not null)::text, ',' order by dining_table_id) from public.reservation_table where reservation_id = 'e1000000-0000-4000-8000-000000000002' and released_at is null),
          '13000000-0000-4000-8000-000000000001:true,13000000-0000-4000-8000-000000000003:true', 'both members are assigned, tagged with the group');
select is((select j ->> 'groupName' from a2), 'T1+T3', 'the detail names the group');
create temp table a3 as select pg_temp.tw('accept_reservation', 'e1000000-0000-4000-8000-000000000003', '{"tableIds": null, "groupId": null}')::jsonb as j;
select is((select j ->> 'status' from a3), 'accepted', 'null and null: accepted without a table');
select is((select count(*)::int from public.reservation_table where reservation_id = 'e1000000-0000-4000-8000-000000000003'), 0, 'with no assignment row');
-- The clock: now = start is expired, start - 1 s is ok.
select is(pg_temp.tw('accept_reservation', 'e1000000-0000-4000-8000-000000000004', '{"tableIds": null, "groupId": null}', '1998-11-20 20:00+00'), 'P0001 reservation_expired', 'at p_now = start: reservation_expired');
select is((select status::text from public.reservation where id = 'e1000000-0000-4000-8000-000000000004'), 'pending', 'and nothing changed');
select is(pg_temp.tw('accept_reservation', 'e1000000-0000-4000-8000-000000000004', '{"tableIds": null, "groupId": null}', '1998-11-20 19:59:59+00')::jsonb ->> 'status', 'accepted', 'at start minus one second: ok');
-- No e-mail address: no e-mail is queued.
select is(pg_temp.tw('accept_reservation', 'e1000000-0000-4000-8000-000000000005', '{"tableIds": null, "groupId": null}')::jsonb ->> 'status', 'accepted', 'a booking whose contact has no e-mail address is accepted');
select is((select count(*)::int from public.reservation_email where reservation_id = 'e1000000-0000-4000-8000-000000000005'), 0, 'and queues no e-mail');
select is(pg_temp.tw('accept_reservation', 'e1000000-0000-4000-8000-000000000099', '{"tableIds": null, "groupId": null}'), 'P0002 reservation_not_found', 'an unknown booking is reservation_not_found');
select is(pg_temp.tw('accept_reservation', 'e2000000-0000-4000-8000-000000000001', '{"tableIds": null, "groupId": null}'), 'P0002 reservation_not_found', 'and so is another tenant''s');

-- Decline --------------------------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.mk(10);
select pg_temp.mk(11, 'pending', '1998-11-21 20:00+00');
select is(pg_temp.tw('decline_reservation', 'e1000000-0000-4000-8000-000000000010', '{"reason": "full"}')::jsonb ->> 'status', 'declined', 'decline a pending booking');
select is((select kind || ',' || (data ->> 'reason') from public.reservation_event where reservation_id = 'e1000000-0000-4000-8000-000000000010' order by seq desc limit 1), 'declined,full', 'a declined event with the reason code');
select is((select kind || ',' || status from public.reservation_email where reservation_id = 'e1000000-0000-4000-8000-000000000010'), 'declined,queued', 'one declined e-mail');
select is(pg_temp.tw('decline_reservation', 'e1000000-0000-4000-8000-000000000010', '{"reason": "full"}')::jsonb ->> 'changed', 'false', 'declining again changes nothing');
select is((select count(*)::int from public.reservation_email where reservation_id = 'e1000000-0000-4000-8000-000000000010'), 1, 'and sends no second e-mail');
select is(pg_temp.tw('decline_reservation', 'e1000000-0000-4000-8000-000000000001', '{"reason": "closed"}')::jsonb ->> 'status', 'declined', 'decline an accepted booking');
select is((select count(*)::int || ',' || count(released_at)::int || ',' || count(released_by)::int from public.reservation_table where reservation_id = 'e1000000-0000-4000-8000-000000000001'), '1,1,1', 'its table is released (released_at set, the row kept)');
select is((select count(*)::int from public.reservation_email where reservation_id = 'e1000000-0000-4000-8000-000000000001' and kind = 'declined'), 1, 'and a declined e-mail is queued');
select is(pg_temp.tw('decline_reservation', 'e1000000-0000-4000-8000-000000000011', '{"reason": "weather"}'), '22023 invalid_request', 'a reason other than full, closed, other is 22023');
select is(pg_temp.tw('decline_reservation', 'e1000000-0000-4000-8000-000000000011', '{}'), '22023 invalid_request', 'an empty body is 22023');
select is(pg_temp.tw('accept_reservation', 'e1000000-0000-4000-8000-000000000010', '{"tableIds": null, "groupId": null}'), 'P0001 status_invalid', 'a declined booking cannot be accepted');
select pg_temp.mk(12, 'cancelled');
select is(pg_temp.tw('decline_reservation', 'e1000000-0000-4000-8000-000000000012', '{"reason": "other"}'), 'P0001 status_invalid', 'a cancelled booking cannot be declined');
select pg_temp.mk(13, 'seated');
select is(pg_temp.tw('decline_reservation', 'e1000000-0000-4000-8000-000000000013', '{"reason": "other"}'), 'P0001 status_invalid', 'nor a seated one');

-- Move -----------------------------------------------------------------------------------------------------------------------------------------------------------
-- Defaults: Cena online 19:30 to 22:00 on a 15-minute grid, stay 120 minutes, lead 120, max party 8 online. 21:00 Rome on 1998-11-22 is 20:00Z.
select pg_temp.mk(20, 'pending', '1998-11-20 20:00+00');
select is(pg_temp.tw('move_reservation', 'e1000000-0000-4000-8000-000000000020', '{"date": "1998-11-22", "time": "21:00", "serviceKey": "cena", "party": 4}')::jsonb ->> 'status', 'pending', 'move a pending booking: the status is kept');
select is((select starts_at::text || ',' || ends_at::text || ',' || business_date || ',' || party from public.reservation where id = 'e1000000-0000-4000-8000-000000000020'), '1998-11-22 20:00:00+00,1998-11-22 22:00:00+00,1998-11-22,4', 'the slot, the end (+120 minutes), the business date and the party are recomputed');
select is((select kind || ',' || (data -> 'to' ->> 'party') from public.reservation_event where reservation_id = 'e1000000-0000-4000-8000-000000000020' order by seq desc limit 1), 'moved,4', 'a moved event');
select is((select count(*)::int from public.reservation_email where reservation_id = 'e1000000-0000-4000-8000-000000000020'), 0, 'and no e-mail (Q-R9: you call the customer)');
select is(pg_temp.tw('move_reservation', 'e1000000-0000-4000-8000-000000000020', '{"date": "1998-11-22", "time": "21:00", "serviceKey": "cena", "party": 4}')::jsonb ->> 'changed', 'false', 'the same slot and party change nothing');
select pg_temp.mk(21, 'accepted', '1998-11-20 20:00+00');
insert into public.reservation_table (tenant_id, reservation_id, dining_table_id, assigned_at, assigned_by)
  values ('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-000000000021', '13000000-0000-4000-8000-000000000002', now(), 'a1000000-0000-4000-8000-00000000000a');
create temp table m1 as select pg_temp.tw('move_reservation', 'e1000000-0000-4000-8000-000000000021', '{"date": "1998-11-22", "time": "21:15", "serviceKey": "cena", "party": 3}')::jsonb as j;
select is((select j ->> 'status' from m1), 'accepted', 'move an accepted booking: still accepted');
select is((select count(*)::int || ',' || count(released_at)::int from public.reservation_table where reservation_id = 'e1000000-0000-4000-8000-000000000021'), '1,1', 'its tables are released (the row stays)');
select is((select j -> 'tables' from m1), '[]'::jsonb, 'the reply shows no table');
select is((select j -> 'suggestion' -> 'suggested' ->> 'kind' from m1), 'group', 'and carries a suggestion (no table has seats configured here, so the group of 6 seats, which has its own, is the fit)');
select is((select j ? 'suggestion' from m1), true, 'the suggestion key is present for the owner');
-- Staff are not bound by the lead time or the online maximum: now 12:00Z, a booking at 13:05Z (14:05 Rome is off the 19:30 to 22:00 window, so use the evening) .
select pg_temp.mk(22, 'pending', '1998-11-25 20:00+00', 2);
select is(pg_temp.tw('move_reservation', 'e1000000-0000-4000-8000-000000000022', '{"date": "1998-11-25", "time": "21:00", "serviceKey": "cena", "party": 12}', '1998-11-25 19:05+00')::jsonb ->> 'party', '12', 'a move inside the lead time (55 minutes ahead) and with party 12 is allowed for staff');
select is(pg_temp.tw('move_reservation', 'e1000000-0000-4000-8000-000000000022', '{"date": "1998-11-25", "time": "20:00", "serviceKey": "cena", "party": 12}', '1998-11-25 19:30+00'), 'P0001 slot_unavailable {"reason": "lead"}', 'but not into the past (20:00 Rome is 19:00Z, before now)');
select is(pg_temp.tw('move_reservation', 'e1000000-0000-4000-8000-000000000022', '{"date": "1998-11-25", "time": "21:10", "serviceKey": "cena", "party": 4}', '1998-11-20 10:00+00'), 'P0001 slot_unavailable {"reason": "grid"}', 'off the grid is refused');
select is(pg_temp.tw('move_reservation', 'e1000000-0000-4000-8000-000000000022', '{"date": "1998-11-25", "time": "23:00", "serviceKey": "cena", "party": 4}', '1998-11-20 10:00+00'), 'P0001 slot_unavailable {"reason": "seating"}', 'outside the booking hours is refused');
select is(pg_temp.tw('move_reservation', 'e1000000-0000-4000-8000-000000000022', '{"date": "1998-11-25", "time": "20:00", "serviceKey": "pranzo", "party": 4}', '1998-11-20 10:00+00'), 'P0001 slot_unavailable {"reason": "service"}', 'the wrong service is refused');
select app.set_reservation_settings_at('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', '{"closedDates": ["1998-11-26"]}', '1998-11-10 10:00+00');
select is(pg_temp.tw('move_reservation', 'e1000000-0000-4000-8000-000000000022', '{"date": "1998-11-26", "time": "20:00", "serviceKey": "cena", "party": 4}', '1998-11-20 10:00+00'), 'P0001 slot_unavailable {"reason": "closed"}', 'a closed date is refused');
select is(pg_temp.tw('move_reservation', 'e1000000-0000-4000-8000-000000000022', '{"date": "1998-11-27", "time": "20:00", "serviceKey": "cena", "party": 4, "x": 1}', '1998-11-20 10:00+00'), '22023 invalid_request', 'an unknown key is 22023');
select is(pg_temp.tw('move_reservation', 'e1000000-0000-4000-8000-000000000010', '{"date": "1998-11-27", "time": "20:00", "serviceKey": "cena", "party": 4}', '1998-11-20 10:00+00'), 'P0001 status_invalid', 'a declined booking cannot be moved');

-- Assign tables --------------------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.mk(30, 'accepted', '1998-11-27 20:00+00');
select pg_temp.mk(31, 'accepted', '1998-11-27 20:00+00');
select pg_temp.mk(32, 'pending', '1998-11-27 20:00+00');
select is(pg_temp.tw('assign_reservation_tables', 'e1000000-0000-4000-8000-000000000030', '{"tableIds": ["13000000-0000-4000-8000-000000000002"], "groupId": null}')::jsonb ->> 'changed', 'true', 'assign a table to an accepted booking');
select is((select count(*)::int from public.reservation_event where reservation_id = 'e1000000-0000-4000-8000-000000000030' and kind = 'tables_assigned'), 1, 'a tables_assigned event');
select is(pg_temp.tw('assign_reservation_tables', 'e1000000-0000-4000-8000-000000000030', '{"tableIds": ["13000000-0000-4000-8000-000000000002"], "groupId": null}')::jsonb ->> 'changed', 'false', 'the same tables again: nothing changes');
select is(pg_temp.tw('assign_reservation_tables', 'e1000000-0000-4000-8000-000000000031', '{"tableIds": ["13000000-0000-4000-8000-000000000002"], "groupId": null}'), 'P0001 table_taken', 'a table held by an overlapping booking is table_taken');
select is(pg_temp.tw('assign_reservation_tables', 'e1000000-0000-4000-8000-000000000030', '{"tableIds": ["13000000-0000-4000-8000-000000000003"], "groupId": null}')::jsonb ->> 'changed', 'true', 'changing the table works (the booking''s own hold never blocks it)');
select is((select count(*)::int || ',' || count(released_at)::int from public.reservation_table where reservation_id = 'e1000000-0000-4000-8000-000000000030'), '2,1', 'the old assignment is released, the new one is current');
select is(pg_temp.tw('assign_reservation_tables', 'e1000000-0000-4000-8000-000000000031', '{"tableIds": ["13000000-0000-4000-8000-000000000002"], "groupId": null}')::jsonb ->> 'changed', 'true', 'and the released table can go to another booking');
select is(pg_temp.tw('assign_reservation_tables', 'e1000000-0000-4000-8000-000000000032', '{"tableIds": ["13000000-0000-4000-8000-000000000001"], "groupId": null}'), 'P0001 status_invalid', 'a pending booking cannot be assigned (accept it)');
select is(pg_temp.tw('assign_reservation_tables', 'e1000000-0000-4000-8000-000000000031', '{"tableIds": null, "groupId": null}')::jsonb ->> 'changed', 'true', 'null and null clears the assignment');
select is((select count(*)::int from public.reservation_table where reservation_id = 'e1000000-0000-4000-8000-000000000031' and released_at is null), 0, 'leaving none current');

-- Mark ------------------------------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.mk(40, 'accepted', '1998-11-20 20:00+00');
select is(pg_temp.tw('mark_reservation', 'e1000000-0000-4000-8000-000000000040', '{"mark": "arrived"}', '1998-11-19 12:00+00', 'waiter'), 'P0001 too_early', 'arrived the day before is too_early');
select is(pg_temp.tw('mark_reservation', 'e1000000-0000-4000-8000-000000000040', '{"mark": "arrived"}', '1998-11-20 12:00+00', 'waiter')::jsonb ->> 'status', 'arrived', 'arrived on the day is ok');
select is((select kind from public.reservation_event where reservation_id = 'e1000000-0000-4000-8000-000000000040' order by seq desc limit 1), 'arrived', 'an arrived event');
select is(pg_temp.tw('mark_reservation', 'e1000000-0000-4000-8000-000000000040', '{"mark": "arrived"}', '1998-11-20 12:00+00', 'waiter')::jsonb ->> 'changed', 'false', 'arrived again changes nothing');
select is(pg_temp.tw('mark_reservation', 'e1000000-0000-4000-8000-000000000040', '{"mark": "no_show"}', '1998-11-20 19:59:59+00', 'waiter'), 'P0001 too_early', 'no_show at start minus one second is too_early');
select is(pg_temp.tw('mark_reservation', 'e1000000-0000-4000-8000-000000000040', '{"mark": "no_show"}', '1998-11-20 20:00+00', 'waiter')::jsonb ->> 'status', 'no_show', 'no_show at the start is ok (an arrived booking can still be a no-show)');
select pg_temp.mk(41, 'accepted', '1998-11-20 20:00+00');
select is(pg_temp.tw('mark_reservation', 'e1000000-0000-4000-8000-000000000041', '{"mark": "no_show"}', '1998-11-20 21:00+00', 'waiter')::jsonb ->> 'status', 'no_show', 'an accepted booking becomes a no-show');
select is(pg_temp.tw('mark_reservation', 'e1000000-0000-4000-8000-000000000041', '{"mark": "arrived"}', '1998-11-20 21:00+00', 'waiter'), 'P0001 status_invalid', 'a no-show cannot arrive');
select pg_temp.mk(42, 'pending', '1998-11-20 20:00+00');
select is(pg_temp.tw('mark_reservation', 'e1000000-0000-4000-8000-000000000042', '{"mark": "arrived"}', '1998-11-20 20:30+00', 'waiter'), 'P0001 status_invalid', 'a pending booking cannot be marked');
select is(pg_temp.tw('mark_reservation', 'e1000000-0000-4000-8000-000000000042', '{"mark": "late"}', '1998-11-20 20:30+00', 'waiter'), '22023 invalid_request', 'a mark other than arrived and no_show is 22023');

-- Seat ------------------------------------------------------------------------------------------------------------------------------------------------------------
create function pg_temp.seat(p_id uuid, p_session uuid, p_now text default '1998-11-20 19:30+00') returns text language sql as $$
  select pg_temp.go(format('select app.seat_reservation_at(%L, %L, %L, %L, %L, %L::timestamptz)::text', '11111111-1111-4111-8111-111111111111', 'd1000000-0000-4000-8000-00000000000d', 'waiter', p_id, p_session, p_now))
$$;
select pg_temp.mk(50, 'accepted', '1998-11-20 20:00+00');
insert into public.reservation_table (tenant_id, reservation_id, dining_table_id, assigned_at, assigned_by) values
  ('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-000000000050', '13000000-0000-4000-8000-000000000002', now(), 'a1000000-0000-4000-8000-00000000000a');
select is(pg_temp.seat('e1000000-0000-4000-8000-000000000050', '14000000-0000-4000-8000-000000000003'), 'P0001 table_not_assigned', 'a session on a table that is not assigned is table_not_assigned');
select is(pg_temp.seat('e1000000-0000-4000-8000-000000000050', '14000000-0000-4000-8000-000000000002'), 'P0001 table_not_assigned', 'a closed session on another table: the table check comes first');
select is(pg_temp.seat('e1000000-0000-4000-8000-000000000050', '24000000-0000-4000-8000-000000000001'), 'P0002 session_not_found', 'tenant B''s session is session_not_found');
select is(pg_temp.seat('e1000000-0000-4000-8000-000000000050', '14000000-0000-4000-8000-0000000000ff'), 'P0002 session_not_found', 'an unknown session is session_not_found');
select is(pg_temp.seat('e1000000-0000-4000-8000-000000000050', '14000000-0000-4000-8000-000000000001', '1998-11-19 19:30+00'), 'P0001 too_early', 'seating the day before is too_early');
select is(pg_temp.seat('e1000000-0000-4000-8000-000000000050', '14000000-0000-4000-8000-000000000001')::jsonb ->> 'status', 'seated', 'an open session on an assigned table: seated');
select is((select table_session_id from public.reservation where id = 'e1000000-0000-4000-8000-000000000050'), '14000000-0000-4000-8000-000000000001'::uuid, 'with table_session_id set');
select is((select data from public.reservation_event where reservation_id = 'e1000000-0000-4000-8000-000000000050' and kind = 'seated'), '{"sessionId": "14000000-0000-4000-8000-000000000001", "tableId": "13000000-0000-4000-8000-000000000002"}'::jsonb, 'and a seated event with ids');
select is(pg_temp.seat('e1000000-0000-4000-8000-000000000050', '14000000-0000-4000-8000-000000000001')::jsonb ->> 'changed', 'false', 'seating with the same session again changes nothing');
select is(pg_temp.seat('e1000000-0000-4000-8000-000000000050', '14000000-0000-4000-8000-000000000003'), 'P0001 status_invalid', 'a seated booking cannot take another session');
select pg_temp.mk(51, 'accepted', '1998-11-20 20:00+00');
select is(pg_temp.seat('e1000000-0000-4000-8000-000000000051', '14000000-0000-4000-8000-000000000002'), 'P0001 session_closed', 'a closed session is session_closed (no table assigned: any table is allowed)');
select is(pg_temp.seat('e1000000-0000-4000-8000-000000000051', '14000000-0000-4000-8000-000000000003')::jsonb ->> 'status', 'seated', 'with no assignment, any table''s open session will do');
select pg_temp.mk(52, 'arrived', '1998-11-20 20:00+00');
select is(pg_temp.seat('e1000000-0000-4000-8000-000000000052', '14000000-0000-4000-8000-000000000001')::jsonb ->> 'status', 'seated', 'an arrived booking can be seated (the session is shared in the fixture: only the table check and the status matter here)');
select pg_temp.mk(53, 'pending', '1998-11-20 20:00+00');
select is(pg_temp.seat('e1000000-0000-4000-8000-000000000053', '14000000-0000-4000-8000-000000000001'), 'P0001 status_invalid', 'a pending booking cannot be seated');
select pg_temp.mk(54, 'accepted', '1998-11-20 20:00+00');
select is(pg_temp.go(format('select app.seat_reservation_at(%L, %L, %L, %L, %L, %L::timestamptz)::text', '11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', 'owner', 'e1000000-0000-4000-8000-000000000054', null, '1998-11-20 19:30+00')), 'P0002 session_not_found', 'a null session is session_not_found');

-- Erase the contact ------------------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.mk(60);
insert into public.reservation_email (tenant_id, reservation_id, kind) values ('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-000000000060', 'received');
create temp table er as select pg_temp.go(format('select app.erase_reservation_contact_at(%L, %L, %L, %L, %L::timestamptz)::text', '11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', 'owner', 'e1000000-0000-4000-8000-000000000060', '1998-11-10 10:00+00'))::jsonb as j;
select is((select j ->> 'changed' from er), 'true', 'erase: changed');
select is((select count(*)::int from public.reservation_contact where reservation_id = 'e1000000-0000-4000-8000-000000000060'), 0, 'the contact is gone');
select is((select count(*)::int from public.reservation where id = 'e1000000-0000-4000-8000-000000000060'), 1, 'the reservation stays');
select is((select kind from public.reservation_event where reservation_id = 'e1000000-0000-4000-8000-000000000060' order by seq desc limit 1), 'contact_erased', 'a contact_erased event');
select is((select status from public.reservation_email where reservation_id = 'e1000000-0000-4000-8000-000000000060'), 'skipped', 'the queued e-mail is skipped');
select is((select j -> 'name' from er), 'null'::jsonb, 'the detail shows a null name');
select is(pg_temp.go(format('select app.erase_reservation_contact_at(%L, %L, %L, %L, %L::timestamptz)::text', '11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', 'owner', 'e1000000-0000-4000-8000-000000000060', '1998-11-10 10:00+00'))::jsonb ->> 'changed', 'false', 'erasing again changes nothing');
select is(pg_temp.go(format('select app.erase_reservation_contact_at(%L, %L, %L, %L, %L::timestamptz)::text', '11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', 'owner', 'e2000000-0000-4000-8000-000000000001', '1998-11-10 10:00+00')), 'P0002 reservation_not_found', 'another tenant''s booking is reservation_not_found');
select is(coalesce(nullif(current_setting('app.contact_delete', true), ''), 'off'), 'off', 'the local delete flag is not left on after the erase');

-- Roles (public wrappers, real clock): the bookings below are dated from today. ------------------------------------------------------------------------------------------
create temp table today as select app.business_date('11111111-1111-4111-8111-111111111111', now()) as d;
insert into public.reservation (tenant_id, id, status, business_date, service_key, starts_at, ends_at, party, privacy_notice_version, privacy_ack_at)
  select '11111111-1111-4111-8111-111111111111', ('e1000000-0000-4000-8000-0000000007' || lpad(n::text, 2, '0'))::uuid, st::public.reservation_status, (select d from today), 'cena',
         now() + (off || ' hours')::interval, now() + (off + 2 || ' hours')::interval, 2, 'v1', now()
    from (values (1, 'pending', 48), (2, 'pending', 49), (3, 'pending', 50), (4, 'pending', 51), (5, 'pending', 52), (6, 'accepted', -1), (7, 'accepted', -1), (8, 'accepted', -1)) v (n, st, off);
update public.reservation set business_date = (select d from today) where id in ('e1000000-0000-4000-8000-000000000706', 'e1000000-0000-4000-8000-000000000707', 'e1000000-0000-4000-8000-000000000708');
insert into public.reservation_contact (tenant_id, reservation_id, name, phone, email, locale)
  select tenant_id, id, 'Cliente Demo', '390000008' || right(id::text, 3), 'cliente.demo@example.com', 'it' from public.reservation where id::text like 'e1000000-0000-4000-8000-0000000007%';
select is((select string_agg(r || ':' || left(pg_temp.call(r, format($$ select public.accept_reservation(%L, '{"tableIds": null, "groupId": null}'::jsonb)::text $$, 'e1000000-0000-4000-8000-000000000701')), 5), ',' order by r) from unnest(array['waiter', 'chef']) r),
          'chef:42501,waiter:42501', 'accept: waiter and chef get 42501');
select is((select string_agg(r || ':' || left(pg_temp.call(r, format($$ select public.decline_reservation(%L, '{"reason": "full"}'::jsonb)::text $$, 'e1000000-0000-4000-8000-000000000701')), 5), ',' order by r) from unnest(array['waiter', 'chef']) r),
          'chef:42501,waiter:42501', 'decline: 42501');
select is((select string_agg(r || ':' || left(pg_temp.call(r, format($$ select public.move_reservation(%L, '{"date": "1998-12-01", "time": "20:00", "serviceKey": "cena", "party": 2}'::jsonb)::text $$, 'e1000000-0000-4000-8000-000000000701')), 5), ',' order by r) from unnest(array['waiter', 'chef']) r),
          'chef:42501,waiter:42501', 'move: 42501');
select is((select string_agg(r || ':' || left(pg_temp.call(r, format($$ select public.assign_reservation_tables(%L, '{"tableIds": null, "groupId": null}'::jsonb)::text $$, 'e1000000-0000-4000-8000-000000000701')), 5), ',' order by r) from unnest(array['waiter', 'chef']) r),
          'chef:42501,waiter:42501', 'assign: 42501');
select is((select string_agg(r || ':' || left(pg_temp.call(r, format($$ select public.erase_reservation_contact(%L)::text $$, 'e1000000-0000-4000-8000-000000000701')), 5), ',' order by r) from unnest(array['waiter', 'chef']) r),
          'chef:42501,waiter:42501', 'erase: 42501');
select is((select string_agg(r || ':' || left(pg_temp.call(r, $$ select public.accept_reservation(null, '"garbage"'::jsonb)::text $$), 5), ',' order by r) from unnest(array['waiter', 'chef']) r), 'chef:42501,waiter:42501', 'the role is checked before the id and the body are read');
select is(pg_temp.call('waiter', format($$ select public.mark_reservation(%L, '{"mark": "arrived"}'::jsonb)::text $$, 'e1000000-0000-4000-8000-000000000706')) like '{%', true, 'mark: the waiter can mark arrived');
select is(pg_temp.call('waiter', format($$ select public.seat_reservation(%L, %L)::text $$, 'e1000000-0000-4000-8000-000000000707', '14000000-0000-4000-8000-000000000003')) like '{%', true, 'seat: the waiter can seat (no assignment: any table''s open session)');
select is(pg_temp.call('chef', format($$ select public.mark_reservation(%L, '{"mark": "no_show"}'::jsonb)::text $$, 'e1000000-0000-4000-8000-000000000707')), '42501', 'mark: the chef gets 42501');
select is(pg_temp.call('chef', format($$ select public.seat_reservation(%L, %L)::text $$, 'e1000000-0000-4000-8000-000000000707', '14000000-0000-4000-8000-000000000003')), '42501', 'seat: the chef gets 42501');
select is(pg_temp.call('owner', format($$ select public.accept_reservation(%L, '{"tableIds": null, "groupId": null}'::jsonb)::text $$, 'e1000000-0000-4000-8000-000000000701')) like '{%', true, 'the owner can accept');
select is(pg_temp.call('admin', format($$ select public.decline_reservation(%L, '{"reason": "other"}'::jsonb)::text $$, 'e1000000-0000-4000-8000-000000000702')) like '{%', true, 'the admin can decline');
select is(pg_temp.call('admin', format($$ select public.erase_reservation_contact(%L)::text $$, 'e1000000-0000-4000-8000-000000000703')) like '{%', true, 'the admin can erase');
select is(pg_temp.call('ownerb', format($$ select public.accept_reservation(%L, '{"tableIds": null, "groupId": null}'::jsonb)::text $$, 'e1000000-0000-4000-8000-000000000704'), '22222222-2222-4222-8222-222222222222'), 'P0002', 'owner B cannot reach A''s booking');

-- Replies carry no money and no staff names -----------------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from (select jsonb_object_keys(j) k from a1) x where k ~* 'eur|cost|price|margin|total'), 0, 'no key of a reply names money');
select is((select j::text !~* 'titolare|admin demo|cameriere' from a1), true, 'and the events name no staff member');

-- Function rules ---------------------------------------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('accept_reservation', 'decline_reservation', 'move_reservation', 'assign_reservation_tables', 'mark_reservation', 'seat_reservation', 'erase_reservation_contact')), 7, 'the seven public functions exist');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('accept_reservation', 'decline_reservation', 'move_reservation', 'assign_reservation_tables', 'mark_reservation', 'seat_reservation', 'erase_reservation_contact')
            and p.prosecdef and p.proconfig @> array['search_path=""'] and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('service_role', p.oid, 'execute')), 7,
          'each is a definer with an empty search_path, executable by authenticated only');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname ~ '^(accept_reservation_at|decline_reservation_at|move_reservation_at|assign_reservation_tables_at|mark_reservation_at|seat_reservation_at|erase_reservation_contact_at|reservation_row_json|reservation_detail_json|reservation_pick_tables|reservation_lock|reservation_release_tables)$'
            and p.prosecdef and p.proconfig @> array['search_path=""'] and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('service_role', p.oid, 'execute')), 12,
          'the twelve app helpers are definers with an empty search_path, closed to every API role');

select * from finish();
rollback;
