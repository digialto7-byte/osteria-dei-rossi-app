-- M17 step 6b: update_table_session (plan §3.1.4, §3.2; AT1 bill_requested, several waiters on one table, T1 generated
-- coperto_total). Covers change from the frozen amount, the bill flag, closed sessions, tenants, roles. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('e0000000-0000-4000-8000-00000000000e', 'waiter-a2@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111',
   'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('e1000000-0000-4000-8000-00000000000e', '11111111-1111-4111-8111-111111111111',
   'e0000000-0000-4000-8000-00000000000e', 'waiter', 'Cameriere Due Demo');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('13000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Tavolo 1 (demo)', 1, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('13000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Tavolo 2 (demo)', 2, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('23000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Tavolo 1 (demo)', 1, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.sale_settings (tenant_id, coperto_amount, coperto_vat_rate, created_by, updated_by)
  values ('11111111-1111-4111-8111-111111111111', 1.5, 10, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
-- A closed session on Tavolo 2 and tenant B's open session.
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, closed_at, closed_by, created_by, updated_by)
  values ('14000000-0000-4000-8000-000000000009', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000002',
          'Tavolo 2 (demo)', 2, 'd1000000-0000-4000-8000-00000000000d', '2026-10-24', now(), 'd1000000-0000-4000-8000-00000000000d',
          'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'),
         ('24000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', '23000000-0000-4000-8000-000000000001',
          'Tavolo 1 (demo)', 2, 'b1000000-0000-4000-8000-00000000000b', '2026-10-24', null, null,
          'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');

create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
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
create function pg_temp.us(p_session uuid, p_patch text) returns text language sql as $$
  select pg_temp.err(format('select public.update_table_session(%L::uuid, %L::jsonb)', p_session, p_patch)) $$;
create temp table res (k text primary key, j jsonb);
create function pg_temp.update_as(p_k text, p_session uuid, p_patch text) returns void language sql as $$
  insert into res select p_k, public.update_table_session(p_session, p_patch::jsonb) $$;

-- Waiter A opens the table; waiter B edits it.
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select public.open_table('13000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000001', 4);
select pg_temp.act_as('e0000000-0000-4000-8000-00000000000e', '11111111-1111-4111-8111-111111111111', 'waiter');
select pg_temp.update_as('c5', '14000000-0000-4000-8000-000000000001', '{"covers":5}');
select is((select j -> 'session' ->> 'covers' from res where k = 'c5'), '5', 'waiter B changes the covers of waiter A''s table to 5');
select is((select coperto_total from public.table_session where id = '14000000-0000-4000-8000-000000000001'), 7.50::numeric, 'coperto_total is 5 x the frozen 1,50 = 7,50');
select is((select j -> 'session' -> 'coperto' from res where k = 'c5'), '{"perPerson":1.5,"vatRate":10,"total":7.5}'::jsonb, 'the reply shows the new total');
select is((select opened_by from public.table_session where id = '14000000-0000-4000-8000-000000000001'), 'd1000000-0000-4000-8000-00000000000d'::uuid, 'opened_by is still waiter A (several waiters)');
select is((select j -> 'session' -> 'waiter' ->> 'displayName' from res where k = 'c5'), 'Cameriere Demo', 'the waiter shown is the opener');
select is((select updated_by from public.table_session where id = '14000000-0000-4000-8000-000000000001'), 'e1000000-0000-4000-8000-00000000000e'::uuid, 'updated_by is waiter B');
select is((select count(*)::int from public.audit_event where entity_type = 'table_session' and action = 'table_session.covers_changed'
            and entity_id = '14000000-0000-4000-8000-000000000001' and created_by = 'e1000000-0000-4000-8000-00000000000e'
            and before = '{"covers":4,"coperto_total":6}'::jsonb and after = '{"covers":5,"coperto_total":7.5}'::jsonb), 1,
  'one covers_changed audit row by waiter B with covers and coperto_total before and after');
select is((select j -> 'session' ->> 'status' from res where k = 'c5'), 'open', 'the reply carries the status (open)');
select is((select array_agg(x order by x collate "C") from jsonb_object_keys((select j -> 'session' from res where k = 'c5')) x),
  array['billRequested', 'businessDate', 'coperto', 'covers', 'id', 'openedAt', 'status', 'tableId', 'tableName', 'waiter'],
  'the reply is the session shape plus status');
select pg_temp.update_as('c5b', '14000000-0000-4000-8000-000000000001', '{"covers":5}');
select is((select count(*)::int from public.audit_event where entity_type = 'table_session'), 1, 'the same covers again writes no second audit row');
-- Settings changing later never reaches the session.
update public.sale_settings set coperto_amount = 3 where tenant_id = '11111111-1111-4111-8111-111111111111';
select pg_temp.update_as('c6', '14000000-0000-4000-8000-000000000001', '{"covers":6}');
select is((select j -> 'session' -> 'coperto' ->> 'total' from res where k = 'c6'), '9', 'covers 6 is still priced at the frozen 1,50 (9,00), not the new 3,00');

-- The bill flag.
select pg_temp.update_as('b1', '14000000-0000-4000-8000-000000000001', '{"billRequested":true}');
select is((select j -> 'session' ->> 'status' from res where k = 'b1'), 'bill_requested', 'billRequested true: status bill_requested');
select is((select (j -> 'session' ->> 'billRequested')::boolean from res where k = 'b1'), true, 'and the flag is shown');
select is((select bill_requested_by from public.table_session where id = '14000000-0000-4000-8000-000000000001'), 'e1000000-0000-4000-8000-00000000000e'::uuid, 'bill_requested_by is waiter B');
select isnt((select bill_requested_at from public.table_session where id = '14000000-0000-4000-8000-000000000001'), null, 'bill_requested_at is set');
select is((select count(*)::int from public.audit_event where entity_type = 'table_session'), 2, 'the bill flag writes no audit row (2 covers changes only)');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select pg_temp.update_as('b1b', '14000000-0000-4000-8000-000000000001', '{"billRequested":true}');
select is((select bill_requested_by from public.table_session where id = '14000000-0000-4000-8000-000000000001'), 'e1000000-0000-4000-8000-00000000000e'::uuid,
  'requesting again keeps the first requester');
select pg_temp.update_as('b0', '14000000-0000-4000-8000-000000000001', '{"billRequested":false}');
select is((select j -> 'session' ->> 'status' from res where k = 'b0'), 'open', 'billRequested false: status open again');
select is((select bill_requested_at is null and bill_requested_by is null from public.table_session where id = '14000000-0000-4000-8000-000000000001'), true, 'and the columns are cleared');
select pg_temp.update_as('both', '14000000-0000-4000-8000-000000000001', '{"covers":2,"billRequested":true}');
select is((select (j -> 'session' ->> 'covers') || '/' || (j -> 'session' ->> 'status') from res where k = 'both'), '2/bill_requested', 'covers and the flag in one patch');

-- Errors.
select is(pg_temp.us('14000000-0000-4000-8000-000000000009', '{"covers":3}'), 'P0001 session_closed', 'a closed session: session_closed (covers)');
select is(pg_temp.us('14000000-0000-4000-8000-000000000009', '{"billRequested":true}'), 'P0001 session_closed', 'a closed session: session_closed (bill)');
select is(pg_temp.us('24000000-0000-4000-8000-0000000000b1', '{"covers":3}'), 'P0002 session_not_found', 'tenant B''s session: session_not_found');
select is(pg_temp.us('14000000-0000-4000-8000-0000000000ff', '{"covers":3}'), 'P0002 session_not_found', 'an unknown session: session_not_found');
select is(pg_temp.us('14000000-0000-4000-8000-000000000001', '{}'), '22023 invalid_request', 'an empty patch: invalid_request');
select is(pg_temp.us('14000000-0000-4000-8000-000000000001', '{"tableName":"X"}'), '22023 invalid_request', 'an unknown key: invalid_request');
select is(pg_temp.us('14000000-0000-4000-8000-000000000001', '{"covers":"3"}'), '22023 invalid_request', 'a string covers: invalid_request');
select is(pg_temp.us('14000000-0000-4000-8000-000000000001', '{"billRequested":1}'), '22023 invalid_request', 'a numeric billRequested: invalid_request');
select is(pg_temp.us('14000000-0000-4000-8000-000000000001', '{"covers":0}'), 'P0001 covers_invalid', 'covers 0: covers_invalid');
select is(pg_temp.us('14000000-0000-4000-8000-000000000001', '{"covers":100}'), 'P0001 covers_invalid', 'covers 100: covers_invalid');
select is(pg_temp.us('14000000-0000-4000-8000-000000000001', '{"covers":2.5}'), 'P0001 covers_invalid', 'covers 2,5: covers_invalid');
select is((select covers from public.table_session where id = '14000000-0000-4000-8000-000000000001'), 2::smallint, 'no refused call changed the covers');

-- Roles.
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.us('14000000-0000-4000-8000-000000000001', '{"covers":3}'), '42501 permission denied: opening tables needs owner, admin or waiter', 'chef: 42501');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.us('14000000-0000-4000-8000-000000000001', '{"covers":3}'), 'ok', 'the owner can edit a session');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r where has_function_privilege(r, 'public.update_table_session(uuid, jsonb)', 'execute')), 1,
  'only authenticated executes update_table_session');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'update_table_session'
              and p.prosecdef and p.proconfig = array['search_path=""']), 1, 'it is security definer with an empty search_path');

select * from finish();
rollback;
