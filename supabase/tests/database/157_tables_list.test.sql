-- M17 step 7: tables_list (plan §3.1.6, §3.2; AT1 status end to end). One set-based read for the waiter: every active
-- table with its derived status and the session shown for it (open one, else the latest one closed today). Tables are
-- found by id, never by index. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(47);

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

-- Tables 1..9 (position = n, except 8 and 9 share position 8, and 10 is inactive), tenant B has one.
insert into public.dining_table (id, tenant_id, name, position, is_active, created_by, updated_by)
select ('13000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, '11111111-1111-4111-8111-111111111111',
       'Tavolo ' || n || ' (demo)', least(n, 8), n <> 10, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'
  from generate_series(1, 10) n;
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by)
  values ('23000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Tavolo 1 (demo)', 1,
          'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');

create function pg_temp.tid(n int) returns uuid language sql as $$ select ('13000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.sid(n int) returns uuid language sql as $$ select ('14000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
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
create function pg_temp.tbl(j jsonb, p_id uuid) returns jsonb language sql as $$
  select jsonb_path_query_first(j, '$.tables[*] ? (@.id == $id)', jsonb_build_object('id', p_id::text)) $$;
create function pg_temp.all_keys(j jsonb) returns setof text language plpgsql as $$
declare
  k text;
  v jsonb;
begin
  if jsonb_typeof(j) = 'object' then
    for k, v in select * from jsonb_each(j) loop
      return next k;
      return query select * from pg_temp.all_keys(v);
    end loop;
  elsif jsonb_typeof(j) = 'array' then
    for v in select * from jsonb_array_elements(j) loop
      return query select * from pg_temp.all_keys(v);
    end loop;
  end if;
end
$$;
-- One session of tenant A. p_closed: closed an hour after opening; p_day: business-date offset in days from today.
create function pg_temp.sess(p_n int, p_table int, p_covers int, p_opened interval, p_day int, p_closed boolean,
                             p_waiter uuid default 'd1000000-0000-4000-8000-00000000000d', p_bill boolean default false,
                             p_coperto numeric default 1.5) returns void language sql as $$
  insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_at, opened_by, business_date,
      coperto_amount, coperto_vat_rate, bill_requested_at, bill_requested_by, closed_at, closed_by, created_by, updated_by)
  values (pg_temp.sid(p_n), '11111111-1111-4111-8111-111111111111', pg_temp.tid(p_table), 'Tavolo ' || p_table || ' (demo)', p_covers,
          clock_timestamp() - p_opened, p_waiter, app.business_date('11111111-1111-4111-8111-111111111111', clock_timestamp()) + p_day,
          p_coperto, case when p_coperto is null then null else 10 end,
          case when p_bill then clock_timestamp() end, case when p_bill then p_waiter end,
          case when p_closed then clock_timestamp() - p_opened + interval '1 hour' end, case when p_closed then p_waiter end,
          p_waiter, p_waiter) $$;

select pg_temp.sess(2, 2, 2, interval '30 minutes', 0, false);
select pg_temp.sess(3, 3, 3, interval '40 minutes', 0, false);
select pg_temp.sess(4, 4, 4, interval '50 minutes', 0, false, 'e1000000-0000-4000-8000-00000000000e', true);
select pg_temp.sess(5, 5, 2, interval '3 hours', 0, true);
select pg_temp.sess(6, 6, 2, interval '30 hours', -1, true);
-- Several sessions per table: T7 an earlier closed and a later open one; T8 two closed today; T9 an open one from yesterday.
select pg_temp.sess(7, 7, 2, interval '5 hours', 0, true);
select pg_temp.sess(17, 7, 5, interval '20 minutes', 0, false);
select pg_temp.sess(8, 8, 2, interval '6 hours', 0, true);
select pg_temp.sess(18, 8, 6, interval '4 hours', 0, true, 'e1000000-0000-4000-8000-00000000000e');
select pg_temp.sess(9, 9, 7, interval '28 hours', -1, false);
select pg_temp.sess(10, 10, 2, interval '10 minutes', 0, false);
-- Tenant B: a closed session today, no coperto.
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_at, opened_by, business_date, closed_at, closed_by, created_by, updated_by)
  values ('24000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', '23000000-0000-4000-8000-000000000001', 'Tavolo 1 (demo)', 2,
          clock_timestamp() - interval '2 hours', 'b1000000-0000-4000-8000-00000000000b',
          app.business_date('22222222-2222-4222-8222-222222222222', clock_timestamp()), clock_timestamp() - interval '1 hour', 'b1000000-0000-4000-8000-00000000000b',
          'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');

select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
create temp table lst (j jsonb);
insert into lst select public.tables_list();

-- Shape.
select is((select array_agg(x order by x collate "C") from lst, jsonb_object_keys(j) x), array['businessDate', 'tables'], 'the top-level keys are {businessDate, tables}');
select is((select j ->> 'businessDate' from lst), app.business_date('11111111-1111-4111-8111-111111111111', clock_timestamp())::text, 'businessDate is today''s business date');
select is((select array_agg(x order by x collate "C") from lst, jsonb_object_keys(pg_temp.tbl(j, pg_temp.tid(2))) x), array['id', 'name', 'position', 'session', 'status'],
  'a table has exactly {id, name, position, status, session}');
select is((select array_agg(x order by x collate "C") from lst, jsonb_object_keys(pg_temp.tbl(j, pg_temp.tid(2)) -> 'session') x),
  array['billRequested', 'coperto', 'covers', 'id', 'openedAt', 'openedToday', 'waiter'], 'a session has exactly the seven documented keys');

-- AT1 end to end.
select is((select pg_temp.tbl(j, pg_temp.tid(1)) ->> 'status' from lst), 'free', 'T1 with no session: free');
select is((select pg_temp.tbl(j, pg_temp.tid(1)) -> 'session' from lst), 'null'::jsonb, 'and session null');
select is((select pg_temp.tbl(j, pg_temp.tid(2)) ->> 'status' from lst), 'open', 'T2 open session: open');
select is((select (pg_temp.tbl(j, pg_temp.tid(2)) -> 'session' ->> 'covers')::int from lst), 2, 'with its covers');
select is((select pg_temp.tbl(j, pg_temp.tid(2)) -> 'session' ->> 'id' from lst), pg_temp.sid(2)::text, 'and its session id');
select is((select (pg_temp.tbl(j, pg_temp.tid(2)) -> 'session' ->> 'openedToday')::boolean from lst), true, 'openedToday true');
select is((select pg_temp.tbl(j, pg_temp.tid(2)) -> 'session' -> 'waiter' ->> 'displayName' from lst), 'Cameriere Demo', 'the waiter is the opener');
select is((select (pg_temp.tbl(j, pg_temp.tid(2)) -> 'session' ->> 'openedAt')::timestamptz = s.opened_at from lst, public.table_session s where s.id = pg_temp.sid(2)), true, 'openedAt is the row''s');
select is((select pg_temp.tbl(j, pg_temp.tid(2)) -> 'session' -> 'coperto' from lst), '{"perPerson":1.5,"vatRate":10,"total":3}'::jsonb, 'coperto is shown: 2 x 1,50 = 3');
select is((select pg_temp.tbl(j, pg_temp.tid(3)) ->> 'status' from lst), 'open', 'T3 with the M17 stub: open');
select is((select pg_temp.tbl(j, pg_temp.tid(4)) ->> 'status' from lst), 'bill_requested', 'T4 bill requested: bill_requested');
select is((select (pg_temp.tbl(j, pg_temp.tid(4)) -> 'session' ->> 'billRequested')::boolean from lst), true, 'with the flag');
select is((select pg_temp.tbl(j, pg_temp.tid(4)) -> 'session' -> 'waiter' ->> 'displayName' from lst), 'Cameriere Due Demo', 'and its opener');
select is((select pg_temp.tbl(j, pg_temp.tid(5)) ->> 'status' from lst), 'closed', 'T5 closed earlier today: closed (Q68 default)');
select is((select pg_temp.tbl(j, pg_temp.tid(5)) -> 'session' ->> 'id' from lst), pg_temp.sid(5)::text, 'showing the closed session');
select is((select pg_temp.tbl(j, pg_temp.tid(6)) ->> 'status' from lst), 'free', 'T6 closed yesterday: free');
select is((select pg_temp.tbl(j, pg_temp.tid(6)) -> 'session' from lst), 'null'::jsonb, 'with no session');

-- Several sessions per table.
select is((select pg_temp.tbl(j, pg_temp.tid(7)) ->> 'status' from lst), 'open', 'T7 earlier closed + later open: open');
select is((select pg_temp.tbl(j, pg_temp.tid(7)) -> 'session' ->> 'id' from lst), pg_temp.sid(17)::text, 'showing the open one');
select is((select pg_temp.tbl(j, pg_temp.tid(8)) ->> 'status' from lst), 'closed', 'T8 two closed today: closed');
select is((select pg_temp.tbl(j, pg_temp.tid(8)) -> 'session' ->> 'id' from lst), pg_temp.sid(18)::text, 'showing the later one (opened 4 hours ago, not 6)');
select is((select pg_temp.tbl(j, pg_temp.tid(8)) -> 'session' -> 'waiter' ->> 'displayName' from lst), 'Cameriere Due Demo', 'and its opener');
select is((select pg_temp.tbl(j, pg_temp.tid(9)) ->> 'status' from lst), 'open', 'T9 an open session from yesterday: open');
select is((select (pg_temp.tbl(j, pg_temp.tid(9)) -> 'session' ->> 'openedToday')::boolean from lst), false, 'with openedToday false');
select is(pg_temp.tbl((select j from lst), pg_temp.tid(10)), null, 'an inactive table is absent');
select is((select jsonb_array_length(j -> 'tables') from lst), 9, 'nine active tables are listed');
select is((select count(*)::int from lst, jsonb_array_elements(j -> 'tables') t where t -> 'session' is null or t -> 'session' = 'null'::jsonb), 2, 'two tables have no session (T1, T6)');

-- Order: position, then name (T8 and T9 share position 8).
select is((select array_agg(t ->> 'name' order by ord) from lst, jsonb_array_elements(j -> 'tables') with ordinality x(t, ord)),
  array['Tavolo 1 (demo)', 'Tavolo 2 (demo)', 'Tavolo 3 (demo)', 'Tavolo 4 (demo)', 'Tavolo 5 (demo)', 'Tavolo 6 (demo)', 'Tavolo 7 (demo)', 'Tavolo 8 (demo)', 'Tavolo 9 (demo)'],
  'tables are ordered by position, then name');

-- Waiter key scan.
select is((select count(*)::int from lst, pg_temp.all_keys(j) k where k ~* 'cost|margin|gp|food|eur$|recipe'), 0, 'a recursive key scan finds no cost, margin, GP, food, eur or recipe key');
select is((select count(*)::int from public.table_session), 12, 'the read wrote nothing');

-- M19 plug-in: the replaced stub makes T3 courses_sent, and a bill-requested T4 stays bill_requested.
create or replace function app.session_fired_lines(p_tenant uuid, p_session_ids uuid[])
  returns table (table_session_id uuid, fired_lines integer)
  language sql stable set search_path = ''
as $$ select s.id, 2 from public.table_session s where s.tenant_id = p_tenant and s.id = any (p_session_ids) and s.id in
  ('14000000-0000-4000-8000-000000000003', '14000000-0000-4000-8000-000000000004', '14000000-0000-4000-8000-000000000005') $$;
select is((select pg_temp.tbl(public.tables_list(), pg_temp.tid(3)) ->> 'status'), 'courses_sent', 'T3 with fired lines (stub replaced): courses_sent');
select is((select pg_temp.tbl(public.tables_list(), pg_temp.tid(4)) ->> 'status'), 'bill_requested', 'T4 with fired lines and a bill request: bill_requested');
select is((select pg_temp.tbl(public.tables_list(), pg_temp.tid(5)) ->> 'status'), 'closed', 'T5 closed with fired lines: closed');
select is((select pg_temp.tbl(public.tables_list(), pg_temp.tid(2)) ->> 'status'), 'open', 'T2 without fired lines: still open');

-- Today's closed sessions drop to free the next business day: a closed session of a past business date is not shown.
alter table public.table_session disable trigger table_session_guard;
update public.table_session set business_date = business_date - 1 where id = pg_temp.sid(5);
alter table public.table_session enable trigger table_session_guard;
select is((select pg_temp.tbl(public.tables_list(), pg_temp.tid(5)) ->> 'status'), 'free', 'the same closed session dated yesterday: free');
-- Roles and tenants.
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is((select jsonb_array_length(public.tables_list() -> 'tables')), 1, 'owner B sees only its own table');
select is((select public.tables_list() -> 'tables' -> 0 ->> 'status'), 'closed', 'owner B''s table is closed today');
select is((select public.tables_list() -> 'tables' -> 0 -> 'session' -> 'coperto'), 'null'::jsonb, 'tenant B: coperto null');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.err('select public.tables_list()'), '42501 permission denied: the service menu and tables need owner, admin or waiter', 'chef: 42501');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.err('select public.tables_list()'), 'ok', 'the owner can read the list');
select pg_temp.act_as('e0000000-0000-4000-8000-00000000000e', '11111111-1111-4111-8111-111111111111', 'waiter');
select is((select pg_temp.tbl(public.tables_list(), pg_temp.tid(2)) -> 'session' -> 'waiter' ->> 'displayName'), 'Cameriere Demo', 'a second waiter sees the opener, not himself');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r where has_function_privilege(r, 'public.tables_list()', 'execute')), 1, 'only authenticated executes tables_list');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'tables_list'
              and p.prosecdef and p.proconfig = array['search_path=""']), 1, 'tables_list is security definer with an empty search_path');

select * from finish();
rollback;
