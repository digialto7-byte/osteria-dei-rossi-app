-- Reservations A1 (docs/plans/1998-11-08-reservations.md §3.2, §5 A1; ADR-032): the nine public tables, the throttle table of the app schema, their guards,
-- RLS and grants, the demo purge list, and the immutable source. Fake data only (Osteria Demo A/B, Titolare Demo, Admin Demo, Chef Demo, Cameriere Demo,
-- Cliente Demo, cliente.demo@example.com, +39 000 0000001).
begin;
create extension if not exists pgtap with schema extensions;
select plan(120);

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
create function pg_temp.as_auth(p_auth uuid, p_tenant uuid, p_role text, stmt text) returns text language plpgsql as $$
declare
  state text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated', 'tenant_id', p_tenant, 'app_role', p_role, 'aal', case when p_role = 'admin' then 'aal2' else 'aal1' end)::text, true);
  set local role authenticated;
  execute stmt;
  reset role;
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate;
  reset role;
  return state;
end
$$;
create function pg_temp.count_as(p_auth uuid, p_tenant uuid, p_role text, p_table text) returns integer language plpgsql as $$
declare
  n integer;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated', 'tenant_id', p_tenant, 'app_role', p_role, 'aal', case when p_role = 'admin' then 'aal2' else 'aal1' end)::text, true);
  set local role authenticated;
  execute format('select count(*)::integer from public.%I', p_table) into n;
  reset role;
  return n;
end
$$;

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
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('13000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Tavolo 1 (demo)', 1, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('13000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Tavolo 2 (demo)', 2, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('23000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Tavolo B (demo)', 1, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_at, opened_by, business_date, created_by, updated_by) values
  ('14000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000001', 'Tavolo 1 (demo)', 2, '1998-11-04 19:10+00', 'd1000000-0000-4000-8000-00000000000d', '1998-11-04', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'),
  ('14000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000002', 'Tavolo 2 (demo)', 2, '1998-11-04 19:10+00', 'd1000000-0000-4000-8000-00000000000d', '1998-11-04', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d');

-- Fixture rows: R1 pending and R3 pending (A), R2 declined (A), RB (B). ---------------------------------------------------------------------------
insert into public.reservation (tenant_id, id, status, business_date, service_key, starts_at, ends_at, party, privacy_notice_version, privacy_ack_at) values
  ('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-000000000001', 'pending', '1998-11-20', 'cena', '1998-11-20 19:00+00', '1998-11-20 21:00+00', 4, 'v1', '1998-11-08 10:00+00'),
  ('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-000000000002', 'declined', '1998-11-20', 'cena', '1998-11-20 19:00+00', '1998-11-20 21:00+00', 2, 'v1', '1998-11-08 10:00+00'),
  ('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-000000000003', 'pending', '1998-11-21', 'cena', '1998-11-21 19:00+00', '1998-11-21 21:00+00', 2, 'v1', '1998-11-08 10:00+00'),
  ('22222222-2222-4222-8222-222222222222', 'e2000000-0000-4000-8000-000000000001', 'pending', '1998-11-20', 'cena', '1998-11-20 19:00+00', '1998-11-20 21:00+00', 2, 'v1', '1998-11-08 10:00+00');
insert into public.reservation_contact (tenant_id, reservation_id, name, phone, email, locale) values
  ('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-000000000001', 'Cliente Demo', '390000000001', 'cliente.demo@example.com', 'it'),
  ('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-000000000002', 'Cliente Due Demo', '390000000002', 'cliente.due@example.com', 'en'),
  ('22222222-2222-4222-8222-222222222222', 'e2000000-0000-4000-8000-000000000001', 'Cliente B Demo', '390000000003', 'cliente.b@example.com', 'it');
insert into public.reservation_event (tenant_id, id, reservation_id, kind, data) values
  ('11111111-1111-4111-8111-111111111111', 'e3000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'requested', '{"party": 4}'),
  ('22222222-2222-4222-8222-222222222222', 'e3000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001', 'requested', '{"party": 2}');
insert into public.reservation_email (tenant_id, id, reservation_id, kind) values
  ('11111111-1111-4111-8111-111111111111', 'e4000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'received'),
  ('22222222-2222-4222-8222-222222222222', 'e4000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001', 'received');
insert into public.table_group (tenant_id, id, name, seats, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'e5000000-0000-4000-8000-000000000001', 'T1+T2', 6, 'a1000000-0000-4000-8000-00000000000a');
insert into public.table_group_member (tenant_id, table_group_id, dining_table_id) values
  ('11111111-1111-4111-8111-111111111111', 'e5000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000001'),
  ('11111111-1111-4111-8111-111111111111', 'e5000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000002');
insert into public.dining_table_booking (tenant_id, dining_table_id, bookable, seats) values
  ('11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000001', true, 2);
insert into public.reservation_settings (tenant_id, enabled, public_slug) values
  ('11111111-1111-4111-8111-111111111111', false, 'osteria-demo-a');
insert into public.reservation_table (tenant_id, id, reservation_id, dining_table_id, table_group_id, assigned_at, assigned_by) values
  ('11111111-1111-4111-8111-111111111111', 'e6000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000001', '1998-11-08 10:00+00', 'a1000000-0000-4000-8000-00000000000a');

-- Grants and RLS ---------------------------------------------------------------------------------------------------------------------------------
create temp table resv_tables (t text);
insert into resv_tables values ('reservation_settings'), ('dining_table_booking'), ('table_group'), ('table_group_member'), ('reservation'),
  ('reservation_contact'), ('reservation_table'), ('reservation_event'), ('reservation_email');
select is((select count(*)::int from resv_tables r join pg_class c on c.oid = ('public.' || r.t)::regclass where c.relrowsecurity), 9, 'RLS is enabled on the nine public tables');
select is((select count(*)::int from resv_tables r join information_schema.columns c on c.table_schema = 'public' and c.table_name = r.t and c.column_name = 'tenant_id' and c.is_nullable = 'NO'), 9, 'each has a non-null tenant_id');
select is((select count(*)::int from resv_tables r cross join unnest(array['authenticated', 'service_role', 'anon']) role cross join unnest(array['insert', 'update', 'delete', 'truncate']) priv
            where has_table_privilege(role, 'public.' || r.t, priv)), 0, 'no insert, update, delete or truncate grant for anon, authenticated or service_role');
select is((select count(*)::int from resv_tables r where has_table_privilege('anon', 'public.' || r.t, 'select')), 0, 'anon holds no privilege on any of them');
select is((select count(*)::int from resv_tables r where has_table_privilege('authenticated', 'public.' || r.t, 'select') and has_table_privilege('service_role', 'public.' || r.t, 'select')), 9, 'authenticated and service_role hold select (RLS decides the rows)');
select is((select count(*)::int from pg_policy p join resv_tables r on p.polrelid = ('public.' || r.t)::regclass where p.polcmd = 'r'), 9, 'each has one select policy');
select is((select count(*)::int from pg_policy p join resv_tables r on p.polrelid = ('public.' || r.t)::regclass), 9, 'and no other policy: there is no write policy');
select is(pg_temp.as_auth('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner',
          $$ insert into public.reservation (tenant_id, business_date, service_key, starts_at, ends_at, party, privacy_notice_version, privacy_ack_at) values ('11111111-1111-4111-8111-111111111111', '1998-11-20', 'cena', now(), now() + interval '2 hours', 2, 'v1', now()) $$),
          '42501', 'the owner cannot insert a reservation directly');
select is(pg_temp.as_auth('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner',
          $$ insert into public.reservation_settings (tenant_id) values ('11111111-1111-4111-8111-111111111111') $$), '42501', 'nor settings');
select is(pg_temp.as_auth('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner', $$ update public.reservation set party = 3 $$), '42501', 'nor update one');
select is(pg_temp.as_auth('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner', $$ delete from public.reservation_contact $$), '42501', 'nor delete a contact');
select is(pg_temp.as_auth('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner', $$ truncate public.reservation_event $$), '42501', 'nor truncate the events');

select is(pg_temp.count_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner', 'reservation'), 3, 'owner A sees A''s three reservations');
select is(pg_temp.count_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin', 'reservation'), 3, 'admin A sees them');
select is(pg_temp.count_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter', 'reservation'), 3, 'waiter A sees them');
select is(pg_temp.count_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef', 'reservation'), 0, 'the chef sees none');
select is(pg_temp.count_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner', 'reservation'), 1, 'owner B sees B''s only');
select is(pg_temp.count_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner', 'reservation_contact'), 2, 'owner A sees A''s two contacts');
select is(pg_temp.count_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter', 'reservation_contact'), 2, 'waiter A sees them too');
select is(pg_temp.count_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef', 'reservation_contact'), 0, 'the chef sees no contact');
select is(pg_temp.count_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner', 'reservation_contact'), 1, 'owner B sees B''s contact only');
select is(pg_temp.count_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter', 'reservation_table'), 1, 'the waiter sees the assignment');
select is(pg_temp.count_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter', 'reservation_event'), 1, 'and the events');
select is(pg_temp.count_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef', 'reservation_table') + pg_temp.count_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef', 'reservation_event'), 0, 'the chef sees neither');
select is(pg_temp.count_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner', 'reservation_event'), 1, 'owner B sees B''s event only');
select is((select sum(pg_temp.count_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner', t))::int
             from unnest(array['reservation_settings', 'dining_table_booking', 'table_group', 'table_group_member', 'reservation_email']) t), 1 + 1 + 1 + 2 + 1, 'owner A sees the owner/admin tables');
select is((select sum(pg_temp.count_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin', t))::int
             from unnest(array['reservation_settings', 'dining_table_booking', 'table_group', 'table_group_member', 'reservation_email']) t), 6, 'admin A sees them too');
select is((select sum(pg_temp.count_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter', t))::int
             from unnest(array['reservation_settings', 'dining_table_booking', 'table_group', 'table_group_member', 'reservation_email']) t), 0, 'the waiter sees none of them');
select is((select sum(pg_temp.count_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef', t))::int
             from unnest(array['reservation_settings', 'dining_table_booking', 'table_group', 'table_group_member', 'reservation_email']) t), 0, 'nor the chef');
select is((select sum(pg_temp.count_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner', t))::int
             from unnest(array['reservation_settings', 'dining_table_booking', 'table_group', 'table_group_member', 'reservation_email']) t), 1, 'owner B sees only B''s e-mail row');

-- The throttle table (schema app): RLS on, no API grant --------------------------------------------------------------------------------------------
select is((select relrowsecurity from pg_class where oid = 'app.reservation_throttle'::regclass), true, 'app.reservation_throttle has RLS');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r cross join unnest(array['select', 'insert', 'update', 'delete']) p
            where has_table_privilege(r, 'app.reservation_throttle', p)), 0, 'and no API role holds a privilege on it');
insert into app.reservation_throttle (tenant_id, day, kind, key_hash, hits) values ('11111111-1111-4111-8111-111111111111', '1998-11-20', 'ip', repeat('a', 64), 1);
select is(left(pg_temp.err($$ insert into app.reservation_throttle (tenant_id, day, kind, key_hash) values ('11111111-1111-4111-8111-111111111111', '1998-11-20', 'ip', 'not-a-hash') $$), 5), '23514', 'the key must be a 64-digit hex hash');
select is(left(pg_temp.err($$ insert into app.reservation_throttle (tenant_id, day, kind, key_hash) values ('11111111-1111-4111-8111-111111111111', '1998-11-20', 'name', repeat('b', 64)) $$), 5), '23514', 'the kind is ip, email or phone');
select is(pg_temp.err($$ delete from app.reservation_throttle $$), 'P0001 append_only', 'a throttle row is not deletable outside the retention job');
select is(pg_temp.err($$ truncate app.reservation_throttle $$), 'P0001 append_only', 'nor truncatable');
select set_config('app.throttle_delete', 'on', true);
select is(pg_temp.err($$ delete from app.reservation_throttle $$), 'ok', 'the retention job''s local flag allows the delete');
select set_config('app.throttle_delete', '', true);

-- Guards ---------------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.err($$ update public.reservation set created_at = now() where id = 'e1000000-0000-4000-8000-000000000001' $$), 'P0001 reservation_immutable', 'created_at is immutable');
select is(pg_temp.err($$ update public.reservation set privacy_ack_at = now() where id = 'e1000000-0000-4000-8000-000000000001' $$), 'P0001 reservation_immutable', 'privacy_ack_at is immutable');
select is(pg_temp.err($$ update public.reservation set privacy_notice_version = 'v2' where id = 'e1000000-0000-4000-8000-000000000001' $$), 'P0001 reservation_immutable', 'privacy_notice_version is immutable');
select is(pg_temp.err($$ update public.reservation set id = gen_random_uuid() where id = 'e1000000-0000-4000-8000-000000000001' $$), 'P0001 reservation_immutable', 'the id is immutable');
select is(pg_temp.err($$ update public.reservation set status = 'accepted' where id = 'e1000000-0000-4000-8000-000000000002' $$), 'P0001 status_invalid', 'declined to accepted is refused');
select is(pg_temp.err($$ update public.reservation set status = 'seated' where id = 'e1000000-0000-4000-8000-000000000001' $$), 'P0001 status_invalid', 'pending to seated is refused');
select is(pg_temp.err($$ update public.reservation set status = 'arrived' where id = 'e1000000-0000-4000-8000-000000000001' $$), 'P0001 status_invalid', 'pending to arrived is refused');
select is(pg_temp.err($$ update public.reservation set status = 'accepted' where id = 'e1000000-0000-4000-8000-000000000001' $$), 'ok', 'pending to accepted is allowed');
select is(pg_temp.err($$ update public.reservation set status = 'arrived' where id = 'e1000000-0000-4000-8000-000000000001' $$), 'ok', 'accepted to arrived is allowed');
select is(pg_temp.err($$ update public.reservation set status = 'accepted' where id = 'e1000000-0000-4000-8000-000000000001' $$), 'P0001 status_invalid', 'arrived back to accepted is refused');
select is(pg_temp.err($$ update public.reservation set status = 'declined' where id = 'e1000000-0000-4000-8000-000000000001' $$), 'P0001 status_invalid', 'arrived to declined is refused');
select is(pg_temp.err($$ update public.reservation set status = 'seated' where id = 'e1000000-0000-4000-8000-000000000001' $$), 'ok', 'arrived to seated is allowed');
select is(pg_temp.err($$ update public.reservation set status = 'no_show' where id = 'e1000000-0000-4000-8000-000000000001' $$), 'P0001 status_invalid', 'seated is final');
select is(pg_temp.err($$ update public.reservation set status = 'expired' where id = 'e1000000-0000-4000-8000-000000000003' $$), 'ok', 'pending to expired is allowed (the nightly job)');
select is(pg_temp.err($$ update public.reservation set status = 'pending' where id = 'e1000000-0000-4000-8000-000000000003' $$), 'P0001 status_invalid', 'and expired is final');
select is(pg_temp.err($$ update public.reservation set party = 6, updated_at = now() where id = 'e1000000-0000-4000-8000-000000000002' $$), 'ok', 'the slot and party may change (a move)');
select is(pg_temp.err($$ update public.reservation set table_session_id = '14000000-0000-4000-8000-000000000001' where id = 'e1000000-0000-4000-8000-000000000001' $$), 'ok', 'the table session is set once');
select is(pg_temp.err($$ update public.reservation set table_session_id = '14000000-0000-4000-8000-000000000002' where id = 'e1000000-0000-4000-8000-000000000001' $$), 'P0001 reservation_immutable', 'and never changed');
select is(pg_temp.err($$ update public.reservation set table_session_id = null where id = 'e1000000-0000-4000-8000-000000000001' $$), 'P0001 reservation_immutable', 'nor cleared');
select is(pg_temp.err($$ delete from public.reservation where id = 'e1000000-0000-4000-8000-000000000003' $$), 'P0001 append_only', 'a reservation is not deletable');
select is(left(pg_temp.err($$ truncate public.reservation $$), 5), '0A000', 'nor truncatable (foreign keys point at it)');
select is(pg_temp.err($$ update public.reservation_event set kind = 'accepted' $$), 'P0001 append_only', 'UPDATE of an event is refused');
select is(pg_temp.err($$ delete from public.reservation_event $$), 'P0001 append_only', 'DELETE of an event is refused');
select is(pg_temp.err($$ truncate public.reservation_event $$), 'P0001 append_only', 'TRUNCATE of the events is refused');
select is(pg_temp.err($$ update public.table_group_member set dining_table_id = dining_table_id $$), 'P0001 append_only', 'UPDATE of a group member is refused');
select is(pg_temp.err($$ delete from public.table_group_member $$), 'P0001 append_only', 'DELETE of a group member is refused');
select is(pg_temp.err($$ truncate public.table_group_member $$), 'P0001 append_only', 'TRUNCATE of the members is refused');
select is(pg_temp.err($$ delete from public.table_group $$), 'P0001 append_only', 'a table group is not deletable');
select is(pg_temp.err($$ update public.table_group set seats = 8 $$), 'P0001 table_group_immutable', 'a group''s seats never change');
select is(pg_temp.err($$ update public.table_group set is_active = false, deactivated_at = now(), deactivated_by = 'a1000000-0000-4000-8000-00000000000a' $$), 'ok', 'a group can be deactivated');
select is(pg_temp.err($$ update public.table_group set is_active = true $$), 'P0001 table_group_immutable', 'and not reactivated');
select is(pg_temp.err($$ delete from public.reservation_email $$), 'P0001 append_only', 'an outbox row is not deletable');
select is(pg_temp.err($$ delete from public.reservation_settings $$), 'P0001 append_only', 'settings are not deletable');
select is(pg_temp.err($$ delete from public.dining_table_booking $$), 'P0001 append_only', 'a table booking row is not deletable');
select is(pg_temp.err($$ truncate public.reservation_email $$), 'P0001 append_only', 'the outbox is not truncatable');
select is(pg_temp.err($$ update public.reservation_table set released_at = now(), released_by = 'a1000000-0000-4000-8000-00000000000a' where id = 'e6000000-0000-4000-8000-000000000001' $$), 'ok', 'an assignment is released, not deleted');
select is(pg_temp.err($$ update public.reservation_table set released_at = now() where id = 'e6000000-0000-4000-8000-000000000001' $$), 'P0001 reservation_table_immutable', 'a release is final');
select is(pg_temp.err($$ update public.reservation_table set dining_table_id = '13000000-0000-4000-8000-000000000002' where id = 'e6000000-0000-4000-8000-000000000001' $$), 'P0001 reservation_table_immutable', 'an assignment never moves to another table');
select is(pg_temp.err($$ delete from public.reservation_table $$), 'P0001 append_only', 'an assignment is not deletable');
select is(pg_temp.err($$ update public.reservation_contact set name = 'X' $$), 'P0001 reservation_contact_immutable', 'a contact is never updated');
select is(pg_temp.err($$ delete from public.reservation_contact where reservation_id = 'e1000000-0000-4000-8000-000000000002' $$), 'P0001 append_only', 'a contact delete is refused without the local flag');
select is(pg_temp.err($$ truncate public.reservation_contact $$), 'P0001 append_only', 'a contact table truncate is refused');
select set_config('app.contact_delete', 'on', true);
select is(pg_temp.err($$ delete from public.reservation_contact where reservation_id = 'e1000000-0000-4000-8000-000000000002' $$), 'ok', 'and allowed with it');
select set_config('app.contact_delete', '', true);
select is((select count(*)::int from public.reservation_contact where tenant_id = '11111111-1111-4111-8111-111111111111'), 1, 'one contact of A is left, the reservation stays');
select is((select count(*)::int from public.reservation where id = 'e1000000-0000-4000-8000-000000000002'), 1, 'the anonymous reservation stays');

-- Cross-tenant foreign keys -----------------------------------------------------------------------------------------------------------------------
select is(left(pg_temp.err($$ insert into public.reservation_table (tenant_id, reservation_id, dining_table_id, assigned_at, assigned_by) values ('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-000000000003', '23000000-0000-4000-8000-000000000001', now(), 'a1000000-0000-4000-8000-00000000000a') $$), 5), '23503',
          'T1: an assignment of A pointing at B''s table is a foreign key violation');
select is(left(pg_temp.err($$ insert into public.reservation_table (tenant_id, reservation_id, dining_table_id, assigned_at, assigned_by) values ('11111111-1111-4111-8111-111111111111', 'e2000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000002', now(), 'a1000000-0000-4000-8000-00000000000a') $$), 5), '23503',
          'an assignment of A on B''s reservation is a foreign key violation');
select is(left(pg_temp.err($$ insert into public.reservation_contact (tenant_id, reservation_id, name, phone, email, locale) values ('11111111-1111-4111-8111-111111111111', 'e2000000-0000-4000-8000-000000000001', 'X', '390000000009', 'x@example.com', 'it') $$), 5), '23503',
          'a contact of A on B''s reservation is a foreign key violation');
select is(left(pg_temp.err($$ insert into public.table_group_member (tenant_id, table_group_id, dining_table_id) values ('11111111-1111-4111-8111-111111111111', 'e5000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000001') $$), 5), '23503',
          'a group member of A pointing at B''s table is a foreign key violation');
select is(left(pg_temp.err($$ insert into public.reservation_table (tenant_id, reservation_id, dining_table_id, assigned_at, assigned_by) values ('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-000000000003', '13000000-0000-4000-8000-000000000002', now(), 'b1000000-0000-4000-8000-00000000000b') $$), 5), '23503',
          'a tenant-B user as the assigner is a foreign key violation');

-- The source -----------------------------------------------------------------------------------------------------------------------------------------
insert into public.reservation (tenant_id, id, business_date, service_key, starts_at, ends_at, party, privacy_notice_version, privacy_ack_at)
  values ('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-000000000009', '1998-11-22', 'cena', '1998-11-22 19:00+00', '1998-11-22 21:00+00', 2, 'v1', now());
select is((select source from public.reservation where id = 'e1000000-0000-4000-8000-000000000009'), 'online', 'source defaults to online');
select is(left(pg_temp.err($$ insert into public.reservation (tenant_id, business_date, service_key, starts_at, ends_at, party, source, privacy_notice_version, privacy_ack_at) values ('11111111-1111-4111-8111-111111111111', '1998-11-22', 'cena', now(), now() + interval '2 hours', 2, 'phone', 'v1', now()) $$), 5), '23514', 'source rejects any other value');
select is(pg_temp.err($$ update public.reservation set source = 'staff' where id = 'e1000000-0000-4000-8000-000000000009' $$), 'P0001 reservation_immutable', 'source cannot be updated');
select is(left(pg_temp.err($$ insert into public.reservation (tenant_id, business_date, service_key, starts_at, ends_at, party) values ('11111111-1111-4111-8111-111111111111', '1998-11-22', 'cena', now(), now() + interval '2 hours', 2) $$), 5), '23514', 'an online reservation needs the privacy fields');
select is(left(pg_temp.err($$ insert into public.reservation (tenant_id, business_date, service_key, starts_at, ends_at, party, privacy_notice_version) values ('11111111-1111-4111-8111-111111111111', '1998-11-22', 'cena', now(), now() + interval '2 hours', 2, 'v1') $$), 5), '23514', 'both of them');
select is(pg_temp.err($$ insert into public.reservation (tenant_id, business_date, service_key, starts_at, ends_at, party, source, status) values ('11111111-1111-4111-8111-111111111111', '1998-11-22', 'cena', now(), now() + interval '2 hours', 2, 'staff', 'accepted') $$), 'ok', 'a staff reservation needs none');
select is(pg_temp.err($$ insert into public.reservation_contact (tenant_id, reservation_id, name, phone, locale) values ('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-000000000009', 'Cliente Demo', '390000000001', 'it') $$), 'ok', 'a contact may have no e-mail');
select is(left(pg_temp.err($$ insert into public.reservation_contact (tenant_id, reservation_id, name, phone, email, locale) values ('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-000000000003', 'Cliente Demo', '390000000001', 'a', 'it') $$), 5), '23514', 'but a given e-mail is checked (3 to 254 characters)');
select is(left(pg_temp.err($$ insert into public.reservation_contact (tenant_id, reservation_id, name, phone, locale) values ('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-000000000003', 'Cliente Demo', '39 0000', 'it') $$), 5), '23514', 'the phone is digits only');

-- No money, no raw address ----------------------------------------------------------------------------------------------------------------------------
select is_empty($$ select c.table_name || '.' || c.column_name from information_schema.columns c
                    where ((c.table_schema = 'public' and c.table_name in (select t from resv_tables)) or (c.table_schema = 'app' and c.table_name = 'reservation_throttle'))
                      and c.column_name ~* 'cost|margin|price|eur|total' $$, 'no column of the new tables names cost, margin, price, eur or total');
select is((select count(*)::int from public.reservation_settings where venue_phone is not null), 0, 'the venue phone is not invented');

-- Function rules (PR1's six; PR2's app.reservation_gate_ok matches the pattern and is pinned in 297) -------------------------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname ~ '^reservation_.*(guard|ok|default_services)$' and p.proname <> 'reservation_gate_ok'), 6, 'the six helpers and guards exist');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname ~ '^reservation_.*(guard|ok|default_services)$' and p.proname <> 'reservation_gate_ok' and p.prosecdef and p.proconfig @> array['search_path=""']), 6, 'each is a definer with an empty search_path');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname ~ '^reservation_.*(guard|ok|default_services)$'
            and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))), 0, 'and no API role can execute it');

-- The purge list -------------------------------------------------------------------------------------------------------------------------------------
select is((select string_agg(n, ',' order by o) from unnest(app.demo_purge_tables()) with ordinality t(n, o) where n in ('reservation_email', 'reservation_event', 'reservation_table', 'reservation_contact', 'reservation', 'service_override', 'table_session')),
          'reservation_email,reservation_event,reservation_table,reservation_contact,reservation,service_override,table_session', 'the five reservation tables sit immediately before service_override');
select is((select o from unnest(app.demo_purge_tables()) with ordinality t(n, o) where n = 'reservation_email') + 5, (select o from unnest(app.demo_purge_tables()) with ordinality t(n, o) where n = 'service_override'), 'with nothing between them');
select is((select string_agg(n, ',' order by o) from unnest(app.demo_purge_tables()) with ordinality t(n, o) where n in ('table_group_member', 'table_group', 'dining_table_booking', 'dining_table')),
          'table_group_member,table_group,dining_table_booking,dining_table', 'the group and booking tables sit immediately before dining_table');
select is((select o from unnest(app.demo_purge_tables()) with ordinality t(n, o) where n = 'table_group_member') + 3, (select o from unnest(app.demo_purge_tables()) with ordinality t(n, o) where n = 'dining_table'), 'with nothing between them');
select is((select o from unnest(app.demo_purge_tables()) with ordinality t(n, o) where n = 'reservation_settings') - 1, (select o from unnest(app.demo_purge_tables()) with ordinality t(n, o) where n = 'service_schedule'), 'reservation_settings is immediately after service_schedule');
select is((select o from unnest(app.demo_purge_tables()) with ordinality t(n, o) where n = 'reservation_settings') + 1, (select o from unnest(app.demo_purge_tables()) with ordinality t(n, o) where n = 'app_user'), 'and immediately before app_user');
select is((select count(*)::int from unnest(app.demo_purge_tables()) n where n in (select t from resv_tables)), 9, 'each of the nine is listed once');
select is((select cardinality(app.demo_purge_tables())), 59, 'the list holds the 49 names of M25c plus the nine and invoice_vat_summary (P2-7 S3, changed on purpose)');
select is((select count(*)::int from (select n from unnest(app.demo_purge_tables()) n group by n having count(*) > 1) d), 0, 'and no name is listed twice');
select is((select count(*)::int from unnest(app.demo_purge_tables()) n where n = 'reservation_throttle'), 0, 'the throttle (schema app, no foreign key from anything) is not in the list');

-- The reset removes everything of the demo tenant and leaves the others'.
insert into auth.users (id, email) values ('d0000000-0000-4000-8000-0000000000d1', 'demo-owner@example.test'), ('d0000000-0000-4000-8000-0000000000d2', 'demo-admin@example.test'), ('f0000000-0000-4000-8000-0000000000f2', 'founder-d@example.test');
insert into public.tenant (id, name, vat_number) values ('66666666-6666-4666-8666-666666666666', 'Osteria Demo D', 'IT66666666666');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('f2000000-0000-4000-8000-0000000000f2', '66666666-6666-4666-8666-666666666666', 'f0000000-0000-4000-8000-0000000000f2', 'owner', 'Titolare D Demo');
select public.begin_demo_data('66666666-6666-4666-8666-666666666666', 'd0000000-0000-4000-8000-0000000000d1', 'Titolare (demo)', 'd0000000-0000-4000-8000-0000000000d2', 'Admin (demo)');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by)
  select x.id::uuid, '66666666-6666-4666-8666-666666666666', x.n, x.p, u.id, u.id
    from public.app_user u, (values ('63000000-0000-4000-8000-000000000001', 'Tavolo D1 (demo)', 1), ('63000000-0000-4000-8000-000000000002', 'Tavolo D2 (demo)', 2)) x (id, n, p)
   where u.auth_id = 'd0000000-0000-4000-8000-0000000000d1';
insert into public.reservation (tenant_id, id, business_date, service_key, starts_at, ends_at, party, privacy_notice_version, privacy_ack_at)
  values ('66666666-6666-4666-8666-666666666666', '63100000-0000-4000-8000-000000000001', '1998-11-20', 'cena', '1998-11-20 19:00+00', '1998-11-20 21:00+00', 3, 'v1', now());
insert into public.reservation_contact (tenant_id, reservation_id, name, phone, email, locale)
  values ('66666666-6666-4666-8666-666666666666', '63100000-0000-4000-8000-000000000001', 'Cliente Demo', '390000000001', 'cliente.demo@example.com', 'it');
insert into public.reservation_event (tenant_id, reservation_id, kind) values ('66666666-6666-4666-8666-666666666666', '63100000-0000-4000-8000-000000000001', 'requested');
insert into public.reservation_email (tenant_id, reservation_id, kind) values ('66666666-6666-4666-8666-666666666666', '63100000-0000-4000-8000-000000000001', 'received');
insert into public.table_group (tenant_id, id, name, seats, created_by)
  select '66666666-6666-4666-8666-666666666666', '63200000-0000-4000-8000-000000000001', 'D1+D2', 6, u.id from public.app_user u where u.auth_id = 'd0000000-0000-4000-8000-0000000000d1';
insert into public.table_group_member (tenant_id, table_group_id, dining_table_id) values
  ('66666666-6666-4666-8666-666666666666', '63200000-0000-4000-8000-000000000001', '63000000-0000-4000-8000-000000000001'),
  ('66666666-6666-4666-8666-666666666666', '63200000-0000-4000-8000-000000000001', '63000000-0000-4000-8000-000000000002');
insert into public.reservation_table (tenant_id, reservation_id, dining_table_id, table_group_id, assigned_at, assigned_by)
  select '66666666-6666-4666-8666-666666666666', '63100000-0000-4000-8000-000000000001', '63000000-0000-4000-8000-000000000001', '63200000-0000-4000-8000-000000000001', now(), u.id
    from public.app_user u where u.auth_id = 'd0000000-0000-4000-8000-0000000000d1';
insert into public.dining_table_booking (tenant_id, dining_table_id, bookable, seats) values ('66666666-6666-4666-8666-666666666666', '63000000-0000-4000-8000-000000000001', true, 4);
insert into public.reservation_settings (tenant_id, created_by) select '66666666-6666-4666-8666-666666666666', u.id from public.app_user u where u.auth_id = 'd0000000-0000-4000-8000-0000000000d1';
select is((select (app.demo_tenant_counts('66666666-6666-4666-8666-666666666666') ->> 'reservation')::int || ',' || (app.demo_tenant_counts('66666666-6666-4666-8666-666666666666') ->> 'reservation_contact')::int
           || ',' || (app.demo_tenant_counts('66666666-6666-4666-8666-666666666666') ->> 'table_group_member')::int), '1,1,2', 'the demo tenant holds the new rows');
select is(app.tenant_has_operational_data('66666666-6666-4666-8666-666666666666'), true, 'and counts as having data');
select app.purge_demo_data_core('66666666-6666-4666-8666-666666666666', 'script', null);
select is((select count(*)::int from public.reservation where tenant_id = '66666666-6666-4666-8666-666666666666'), 0, 'the reset removed the demo tenant''s reservations');
select is((select count(*)::int from public.reservation_contact where tenant_id = '66666666-6666-4666-8666-666666666666')
          + (select count(*)::int from public.reservation_event where tenant_id = '66666666-6666-4666-8666-666666666666')
          + (select count(*)::int from public.reservation_email where tenant_id = '66666666-6666-4666-8666-666666666666')
          + (select count(*)::int from public.reservation_table where tenant_id = '66666666-6666-4666-8666-666666666666'), 0, 'with their contacts, events, e-mails and assignments');
select is((select count(*)::int from public.table_group where tenant_id = '66666666-6666-4666-8666-666666666666')
          + (select count(*)::int from public.table_group_member where tenant_id = '66666666-6666-4666-8666-666666666666')
          + (select count(*)::int from public.dining_table_booking where tenant_id = '66666666-6666-4666-8666-666666666666')
          + (select count(*)::int from public.reservation_settings where tenant_id = '66666666-6666-4666-8666-666666666666'), 0, 'and its groups, members, bookable tables and settings');
select is((select count(*)::int from public.reservation where tenant_id <> '66666666-6666-4666-8666-666666666666'), 6, 'the other tenants'' reservations stay');
select is((select count(*)::int from public.reservation_contact where tenant_id <> '66666666-6666-4666-8666-666666666666'), 3, 'and their contacts');
select is(pg_temp.err($$ delete from public.reservation_event $$), 'P0001 append_only', 'the ledger is append-only again after the reset');
select is(pg_temp.err($$ delete from public.reservation_contact $$), 'P0001 append_only', 'and the contacts are guarded again');

select * from finish();
rollback;
