-- M17 step 6a: open_table (plan §3.1.4, §3.1.5, §3.2; AT2 an open table cannot be opened twice, AT3 coperto frozen at
-- opening, business date with the cut-off and DST). Idempotent replay, id conflicts, roles, tenants. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(57);

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
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111',
   'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('e1000000-0000-4000-8000-00000000000e', '11111111-1111-4111-8111-111111111111',
   'e0000000-0000-4000-8000-00000000000e', 'waiter', 'Cameriere Due Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111',
   'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo');
insert into public.dining_table (id, tenant_id, name, position, is_active, created_by, updated_by) values
  ('13000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Tavolo 1 (demo)', 1, true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('13000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Tavolo 2 (demo)', 2, true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('13000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Tavolo 3 (demo)', 3, true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('13000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'Tavolo 4 (demo)', 4, false, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('13000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'Tavolo 5 (demo)', 5, true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('23000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Tavolo 1 (demo)', 1, true, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
-- Tenant A has a coperto of 1,50 at 10 %; tenant B has none.
insert into public.sale_settings (tenant_id, coperto_amount, coperto_vat_rate, created_by, updated_by)
  values ('11111111-1111-4111-8111-111111111111', 1.5, 10, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
-- A closed session of Tavolo 3 (inserted as the migration owner: nothing can close a session yet) and one of tenant B.
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, opened_at, business_date, closed_at, closed_by, created_by, updated_by)
  values ('14000000-0000-4000-8000-000000000009', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000003',
          'Tavolo 3 (demo)', 2, 'd1000000-0000-4000-8000-00000000000d', now() - interval '3 hours', '2026-10-24', now() - interval '1 hour',
          'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'),
         ('24000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', '23000000-0000-4000-8000-000000000001',
          'Tavolo 1 (demo)', 2, 'b1000000-0000-4000-8000-00000000000b', now(), '2026-10-24', null, null,
          'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');

create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
-- state, message and detail.
create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare
  state text;
  msg text;
  det text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text, det = pg_exception_detail;
  return state || ' ' || msg;
end
$$;
create function pg_temp.detail(stmt text) returns text language plpgsql as $$
declare
  det text;
begin
  execute stmt;
  return 'no error';
exception when others then
  get stacked diagnostics det = pg_exception_detail;
  return det;
end
$$;
create function pg_temp.op(p_table uuid, p_session uuid, p_covers integer) returns text language sql as $$
  select pg_temp.err(format('select public.open_table(%L::uuid, %L::uuid, %L::integer)', p_table, p_session, p_covers)) $$;
create temp table res (k text primary key, j jsonb);
create function pg_temp.open_as(p_k text, p_table uuid, p_session uuid, p_covers integer) returns void language sql as $$
  insert into res select p_k, public.open_table(p_table, p_session, p_covers) $$;

-- ----------------------------------------------------------------------------------------------------------------
-- Open: the waiter opens Tavolo 1.
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select pg_temp.open_as('s1', '13000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000001', 4);
select is((select (j ->> 'created')::boolean from res where k = 's1'), true, 'a first opening: created true');
select is((select array_agg(x order by x collate "C") from res, jsonb_object_keys((select j -> 'session' from res where k = 's1')) x where k = 's1'),
  array['billRequested', 'businessDate', 'coperto', 'covers', 'id', 'openedAt', 'tableId', 'tableName', 'waiter'],
  'the session has exactly the nine documented keys');
select is((select j -> 'session' ->> 'id' from res where k = 's1'), '14000000-0000-4000-8000-000000000001', 'the session id is the client''s');
select is((select j -> 'session' ->> 'tableId' from res where k = 's1'), '13000000-0000-4000-8000-000000000001', 'tableId');
select is((select j -> 'session' ->> 'tableName' from res where k = 's1'), 'Tavolo 1 (demo)', 'tableName is the snapshot');
select is((select (j -> 'session' ->> 'covers')::int from res where k = 's1'), 4, 'covers');
select is((select j -> 'session' -> 'waiter' from res where k = 's1'), '{"id":"d1000000-0000-4000-8000-00000000000d","displayName":"Cameriere Demo"}'::jsonb,
  'the waiter is the opener');
select is((select (j -> 'session' ->> 'billRequested')::boolean from res where k = 's1'), false, 'no bill requested yet');
select is((select j -> 'session' -> 'coperto' from res where k = 's1'), '{"perPerson":1.5,"vatRate":10,"total":6}'::jsonb, 'AT3: coperto 1,50 x 4 = 6 at 10 %');
select is((select table_name || '/' || opened_by || '/' || covers from public.table_session where id = '14000000-0000-4000-8000-000000000001'),
  'Tavolo 1 (demo)/d1000000-0000-4000-8000-00000000000d/4', 'the row: name snapshot, opened_by, covers');
select is((select business_date = app.business_date(tenant_id, opened_at) from public.table_session where id = '14000000-0000-4000-8000-000000000001'), true,
  'business_date is app.business_date(tenant, opened_at)');
select is((select coperto_total from public.table_session where id = '14000000-0000-4000-8000-000000000001'), 6.00::numeric, 'coperto_total 6,00');
select is((select (j -> 'session' ->> 'openedAt')::timestamptz = opened_at from res, public.table_session s where k = 's1' and s.id = '14000000-0000-4000-8000-000000000001'), true,
  'openedAt is the row''s opened_at');
select is((select count(*)::int from public.audit_event), 0, 'opening writes no audit row (nothing of the venue''s configuration changed)');

-- AT2: a second session on the same table is refused and names the first.
select is(pg_temp.op('13000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000002', 2), 'P0001 table_already_open', 'AT2: another session on an open table: table_already_open');
select is((pg_temp.detail($$select public.open_table('13000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000002', 2)$$)::jsonb) ->> 'id',
  '14000000-0000-4000-8000-000000000001', 'the detail carries the open session''s id');
select is((pg_temp.detail($$select public.open_table('13000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000002', 2)$$)::jsonb) -> 'waiter' ->> 'displayName',
  'Cameriere Demo', 'and who opened it');
select is((pg_temp.detail($$select public.open_table('13000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000002', 2)$$)::jsonb) ->> 'covers',
  '4', 'and its covers');
select is((select count(*)::int from public.table_session where dining_table_id = '13000000-0000-4000-8000-000000000001'), 1, 'still one session on the table');

-- Replay: the same id on the same table is idempotent.
select pg_temp.open_as('s1b', '13000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000001', 4);
select is((select (j ->> 'created')::boolean from res where k = 's1b'), false, 'a replay: created false');
select is((select j -> 'session' from res where k = 's1b'), (select j -> 'session' from res where k = 's1'), 'and the same session');
select pg_temp.open_as('s1c', '13000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000001', 9);
select is((select (j -> 'session' ->> 'covers')::int from res where k = 's1c'), 4, 'a replay with other covers does not change the session');
select is((select count(*)::int from public.table_session where id = '14000000-0000-4000-8000-000000000001'), 1, 'still one row');
-- A replay by the second waiter returns the same session (idempotent by id, not by user).
select pg_temp.act_as('e0000000-0000-4000-8000-00000000000e', '11111111-1111-4111-8111-111111111111', 'waiter');
select pg_temp.open_as('s1d', '13000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000001', 4);
select is((select j -> 'session' -> 'waiter' ->> 'displayName' from res where k = 's1d'), 'Cameriere Demo', 'a replay shows the original opener');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');

-- Id conflicts.
select is(pg_temp.op('13000000-0000-4000-8000-000000000002', '14000000-0000-4000-8000-000000000001', 2), 'P0001 session_id_conflict', 'an id used for another table: session_id_conflict');
select is(pg_temp.op('13000000-0000-4000-8000-000000000003', '14000000-0000-4000-8000-000000000009', 2), 'P0001 session_closed', 'the id of a closed session on its table: session_closed');
select is(pg_temp.op('13000000-0000-4000-8000-000000000002', '14000000-0000-4000-8000-000000000009', 2), 'P0001 session_id_conflict', 'the id of a closed session for another table: session_id_conflict');
select is(pg_temp.op('13000000-0000-4000-8000-000000000002', '24000000-0000-4000-8000-0000000000b1', 2), 'P0001 session_id_conflict', 'another tenant''s session id: session_id_conflict');
select is(pg_temp.detail($$select public.open_table('13000000-0000-4000-8000-000000000002', '24000000-0000-4000-8000-0000000000b1', 2)$$), '',
  'and with no detail (nothing of tenant B leaks)');
select is((select count(*)::int from public.table_session where tenant_id = '22222222-2222-4222-8222-222222222222'), 1, 'tenant B''s session is untouched');

-- Other refusals.
select is(pg_temp.op('13000000-0000-4000-8000-000000000004', '14000000-0000-4000-8000-000000000003', 2), 'P0001 table_inactive', 'an inactive table: table_inactive');
select is(pg_temp.op('23000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000003', 2), 'P0002 table_not_found', 'tenant B''s table: table_not_found');
select is(pg_temp.op('13000000-0000-4000-8000-0000000000ff', '14000000-0000-4000-8000-000000000003', 2), 'P0002 table_not_found', 'an unknown table: table_not_found');
select is(pg_temp.op('13000000-0000-4000-8000-000000000002', '14000000-0000-4000-8000-000000000003', 0), 'P0001 covers_invalid', 'covers 0: covers_invalid');
select is(pg_temp.op('13000000-0000-4000-8000-000000000002', '14000000-0000-4000-8000-000000000003', 100), 'P0001 covers_invalid', 'covers 100: covers_invalid');
select is(pg_temp.op('13000000-0000-4000-8000-000000000002', '14000000-0000-4000-8000-000000000003', null), 'P0001 covers_invalid', 'null covers: covers_invalid');
select is(pg_temp.err($$select public.open_table('13000000-0000-4000-8000-000000000002', null, 2)$$), '22023 invalid_request', 'a null session id: invalid_request');
select is(pg_temp.err($$select public.open_table(null, '14000000-0000-4000-8000-000000000003', 2)$$), 'P0002 table_not_found', 'a null table: table_not_found');
select is((select count(*)::int from public.table_session where tenant_id = '11111111-1111-4111-8111-111111111111'), 2, 'no refused call wrote a session (S1 and the closed fixture)');

-- A closed table can be opened again at once; opens of different tables are independent.
select pg_temp.open_as('s10', '13000000-0000-4000-8000-000000000003', '14000000-0000-4000-8000-000000000010', 3);
select is((select (j ->> 'created')::boolean from res where k = 's10'), true, 'a table whose session is closed can be opened again');
select pg_temp.open_as('s3', '13000000-0000-4000-8000-000000000002', '14000000-0000-4000-8000-000000000003', 2);
select is((select (j ->> 'created')::boolean from res where k = 's3'), true, 'a different table opens independently');

-- AT3: the coperto is frozen at opening; a settings change never touches an open session.
update public.sale_settings set coperto_amount = 2 where tenant_id = '11111111-1111-4111-8111-111111111111';
select is((select coperto_amount from public.table_session where id = '14000000-0000-4000-8000-000000000001'), 1.50::numeric, 'AT3: the open session keeps 1,50 after the setting becomes 2,00');
select pg_temp.open_as('s5', '13000000-0000-4000-8000-000000000005', '14000000-0000-4000-8000-000000000005', 3);
select is((select j -> 'session' -> 'coperto' from res where k = 's5'), '{"perPerson":2,"vatRate":10,"total":6}'::jsonb, 'a new opening takes 2,00 (3 x 2 = 6)');
select is((select coperto_amount from public.table_session where id = '14000000-0000-4000-8000-000000000003'), 1.50::numeric, 'the session opened before the change keeps 1,50');
-- Tenant B has no coperto.
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
update public.table_session set covers = 3 where id = '24000000-0000-4000-8000-0000000000b1';
select is((select coperto_total is null from public.table_session where id = '24000000-0000-4000-8000-0000000000b1'), true, 'AT3: a session without coperto has a null total');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by)
  values ('23000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'Tavolo 2 (demo)', 2, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
select pg_temp.open_as('sb', '23000000-0000-4000-8000-000000000002', '24000000-0000-4000-8000-0000000000b2', 2);
select is((select j -> 'session' -> 'coperto' from res where k = 'sb'), 'null'::jsonb, 'AT3: tenant B (no coperto) gets coperto null');
select is((select coperto_amount is null and coperto_vat_rate is null from public.table_session where id = '24000000-0000-4000-8000-0000000000b2'), true, 'and no frozen amount');

-- Business date: the cut-off (default 02:00 Europe/Rome) and DST, at three instants.
select is(app.business_date('11111111-1111-4111-8111-111111111111', '2026-11-03T00:30:00Z'), '2026-11-02'::date, '01:30 Rome (before the 02:00 cut-off): the previous business day');
select is(app.business_date('11111111-1111-4111-8111-111111111111', '2026-10-24T23:30:00Z'), '2026-10-24'::date, '01:30 CEST on the DST night (before the cut-off): the previous business day');
select is(app.business_date('11111111-1111-4111-8111-111111111111', '2026-10-25T00:30:00Z'), '2026-10-25'::date, '02:30 CEST on the DST night (after the 02:00 cut-off): the same day');
select is(app.business_date('11111111-1111-4111-8111-111111111111', '2026-10-25T02:30:00Z'), '2026-10-25'::date, '03:30 CET after the change: the same day');

-- Roles.
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is(pg_temp.op('13000000-0000-4000-8000-000000000003', '14000000-0000-4000-8000-000000000011', 2), 'P0001 table_already_open', 'admin reaches the table checks (role passes)');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.op('13000000-0000-4000-8000-000000000003', '14000000-0000-4000-8000-000000000011', 2), 'P0001 table_already_open', 'owner reaches the table checks (role passes)');
update public.dining_table set is_active = true where id = '13000000-0000-4000-8000-000000000004';
select is(pg_temp.op('13000000-0000-4000-8000-000000000004', '14000000-0000-4000-8000-000000000012', 2), 'ok', 'the owner can open a table');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.op('13000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000001', 4), '42501 permission denied: opening tables needs owner, admin or waiter', 'chef: 42501, even for a replay');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r where has_function_privilege(r, 'public.open_table(uuid, uuid, integer)', 'execute')), 1,
  'only authenticated executes open_table');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'open_table'
              and p.prosecdef and p.proconfig = array['search_path=""']), 1, 'open_table is security definer with an empty search_path');

select * from finish();
rollback;
