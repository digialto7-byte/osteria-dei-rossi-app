-- M19b step 8 (docs/plans/2026-10-31-m19b-kitchen-done.md §3.11, §5 step 8): performance net. A regression net, not a latency claim: under statement_timeout = 5 s, on a
-- fixture of 300 lines fired today on 30 sessions and 5 000 older, with 3 000 kitchen events today and 50 000 older, kitchen_tickets(), kitchen_mark_line and kitchen_set_ticket
-- answer, and the line-state and ticket-state lookups read through kitchen_event_line_idx and kitchen_event_ticket_idx. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

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
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('e1000000-0000-4000-8000-00000000000e', '11111111-1111-4111-8111-111111111111', 'e0000000-0000-4000-8000-00000000000e', 'waiter', 'Cameriere Due Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo');
insert into public.menu_item (id, tenant_id, name, category, course_default, created_by, updated_by) values
  ('11000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Spezzatino con polenta (demo)', 'Secondi', 'secondi', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Bruschetta (demo)', 'Antipasti', 'antipasti', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Zuppa del giorno (demo)', 'Primi', 'primi', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Solo B (demo)', 'Altro', 'dolci', 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('13000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Tavolo 1 (demo)', 1, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('13000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Tavolo 2 (demo)', 2, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('13000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Tavolo 3 (demo)', 3, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('13000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Tavolo B (demo)', 1, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
-- T1 (4 covers) and T2 (2 covers) open, T3 closed, B1 of tenant B.
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, closed_at, closed_by, created_by, updated_by) values
  ('14000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000001', 'Tavolo 1 (demo)', 4, 'a1000000-0000-4000-8000-00000000000a', '2026-11-04', null, null, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('14000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000002', 'Tavolo 2 (demo)', 2, 'a1000000-0000-4000-8000-00000000000a', '2026-11-04', null, null, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('14000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000003', 'Tavolo 3 (demo)', 2, 'a1000000-0000-4000-8000-00000000000a', '2026-11-04', now(), 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('14000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', '13000000-0000-4000-8000-0000000000b1', 'Tavolo B (demo)', 2, 'b1000000-0000-4000-8000-00000000000b', '2026-11-04', null, null, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');

create temporary table reg (k text primary key, id uuid not null);
insert into reg values ('t1', '14000000-0000-4000-8000-000000000001'), ('t2', '14000000-0000-4000-8000-000000000002'),
  ('t3', '14000000-0000-4000-8000-000000000003'), ('tb', '14000000-0000-4000-8000-0000000000b1');
create function pg_temp.id(p_k text) returns uuid language sql as $$ select id from reg where k = p_k $$;
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
-- An order line fired at p_fired (null = draft). Item 1 secondi, 2 antipasti, 3 primi; the waiter who sent it is p_by.
create function pg_temp.mkl(p_k text, p_session text, p_course text, p_item int, p_fired timestamptz, p_segue boolean default false,
    p_qty numeric default 1, p_note text default null, p_shared boolean default false, p_void text default null, p_by text default 'd1000000-0000-4000-8000-00000000000d',
    p_tenant text default '11111111-1111-4111-8111-111111111111', p_created timestamptz default null) returns void language plpgsql as $$
begin
  insert into reg values (p_k, gen_random_uuid());
  insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, segue, note, is_shared, unit_price, vat_rate, price_source,
      client_updated_at, created_at, created_by, updated_by, fired_at, fired_by, voided_at, voided_by, void_reason)
    values (pg_temp.id(p_k), p_tenant::uuid, pg_temp.id(p_session),
      case when p_tenant = '22222222-2222-4222-8222-222222222222' then '11000000-0000-4000-8000-0000000000b1'::uuid
           else ('11000000-0000-4000-8000-00000000000' || p_item)::uuid end,
      p_course::public.course, p_qty, p_segue, p_note, p_shared, 14, 10, 'menu', '2026-11-04 18:00+00',
      coalesce(p_created, '2026-11-04 18:00+00'),
      case when p_tenant = '22222222-2222-4222-8222-222222222222' then 'b1000000-0000-4000-8000-00000000000b'::uuid else 'd1000000-0000-4000-8000-00000000000d'::uuid end,
      case when p_tenant = '22222222-2222-4222-8222-222222222222' then 'b1000000-0000-4000-8000-00000000000b'::uuid else 'd1000000-0000-4000-8000-00000000000d'::uuid end,
      p_fired, case when p_fired is null then null else p_by::uuid end,
      case when p_void is null then null else p_fired + interval '1 minute' end,
      case when p_void is null then null else p_by::uuid end, p_void);
end
$$;

-- The instant lines are fired at: the start of the current business day, clamped to now (the 217 pattern).
create function pg_temp.day_start() returns timestamptz language sql as $$
  select least(app.local_instant(app.business_date(t.id, now()), app.business_day_cutoff(t.id), t.timezone), clock_timestamp())
    from public.tenant t where t.id = '11111111-1111-4111-8111-111111111111' $$;
create function pg_temp.claims(p_who text) returns void language sql as $$
  select set_config('request.jwt.claims', case p_who
    when 'chef' then json_build_object('sub', 'c0000000-0000-4000-8000-00000000000c', 'role', 'authenticated', 'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'chef')::text
    when 'owner' then json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated', 'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'owner')::text
    when 'waiter' then json_build_object('sub', 'd0000000-0000-4000-8000-00000000000d', 'role', 'authenticated', 'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'waiter')::text
    when 'ownerb' then json_build_object('sub', 'b0000000-0000-4000-8000-00000000000b', 'role', 'authenticated', 'tenant_id', '22222222-2222-4222-8222-222222222222', 'app_role', 'owner')::text
    else '' end, true) $$;
create function pg_temp.mark(p_line text, p_done boolean) returns jsonb language sql as $$
  select public.kitchen_mark_line(pg_temp.id(p_line), jsonb_build_object('done', p_done)) $$;
-- The five-field body of the comanda a line belongs to.
create function pg_temp.kbody(p_line text, p_closed boolean) returns jsonb language sql as $$
  select jsonb_build_object('sessionId', l.table_session_id, 'firedAt', to_char(l.fired_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                            'course', l.course::text, 'segue', l.segue, 'closed', p_closed)
    from public.order_line l where l.id = pg_temp.id(p_line) $$;
create function pg_temp.setk(p_line text, p_closed boolean) returns jsonb language sql as $$
  select public.kitchen_set_ticket(pg_temp.kbody(p_line, p_closed)) $$;
-- Events of a line, or of the comanda of a line, as 'subject:action:cause' in seq order.
create function pg_temp.lev(p_line text) returns text language sql as $$
  select coalesce(string_agg(e.subject || ':' || e.action || ':' || e.cause, ',' order by e.seq), '-') from public.kitchen_event e where e.order_line_id = pg_temp.id(p_line) $$;
create function pg_temp.tev(p_line text) returns text language sql as $$
  select coalesce(string_agg(e.subject || ':' || e.action || ':' || e.cause, ',' order by e.seq), '-')
    from public.kitchen_event e join public.order_line l on l.id = pg_temp.id(p_line)
   where e.subject = 'ticket' and e.table_session_id = l.table_session_id and e.fired_at = l.fired_at and e.course = l.course and e.segue = l.segue $$;
create function pg_temp.nev() returns integer language sql as $$ select count(*)::int from public.kitchen_event $$;
-- A comanda of a board (from a reply), found by one of its line ids; list = tickets / closedTickets. Null when absent.
create function pg_temp.bt(p_board jsonb, p_list text, p_line text) returns jsonb language sql as $$
  select t from jsonb_array_elements(p_board -> p_list) t, jsonb_array_elements(t -> 'lines') e where e ->> 'id' = pg_temp.id(p_line)::text limit 1 $$;
-- 'SQLSTATE message|detail' of a statement.
create function pg_temp.errd(stmt text) returns text language plpgsql as $$
declare
  state text;
  msg text;
  det text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text, det = pg_exception_detail;
  return state || ' ' || msg || '|' || coalesce(det, '');
end
$$;

insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by)
  select ('13000000-0000-4000-8000-0000000001' || lpad(n::text, 2, '0'))::uuid, '11111111-1111-4111-8111-111111111111', 'Tavolo P' || n || ' (demo)', 100 + n,
         'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a' from generate_series(1, 30) n;
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, created_by, updated_by)
  select ('14000000-0000-4000-8000-0000000001' || lpad(n::text, 2, '0'))::uuid, '11111111-1111-4111-8111-111111111111',
         ('13000000-0000-4000-8000-0000000001' || lpad(n::text, 2, '0'))::uuid, 'Tavolo P' || n || ' (demo)', 2, 'a1000000-0000-4000-8000-00000000000a', current_date,
         'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a' from generate_series(1, 30) n;
-- 300 lines fired today (each on its own microsecond, never after now) and 5 000 fired 36 hours ago and earlier
create temporary table pl as select n, md5('today' || n)::uuid id, ('14000000-0000-4000-8000-0000000001' || lpad((n % 30 + 1)::text, 2, '0'))::uuid sid,
  least(pg_temp.day_start() + n * interval '1 microsecond', clock_timestamp()) fired from generate_series(1, 300) n;
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by, fired_at, fired_by)
  select id, '11111111-1111-4111-8111-111111111111', sid, '11000000-0000-4000-8000-000000000001', 'secondi', 1, 14, 10, 'menu', '2026-10-24 12:00+00',
         'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d', fired, 'd1000000-0000-4000-8000-00000000000d' from pl;
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by, fired_at, fired_by)
  select md5('old' || n)::uuid, '11111111-1111-4111-8111-111111111111', ('14000000-0000-4000-8000-0000000001' || lpad((n % 30 + 1)::text, 2, '0'))::uuid,
         '11000000-0000-4000-8000-000000000001', 'secondi', 1, 14, 10, 'menu', '2026-10-24 12:00+00',
         'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d', now() - interval '36 hours' - n * interval '10 minutes', 'd1000000-0000-4000-8000-00000000000d'
    from generate_series(1, 5000) n;
-- 3 000 events today (10 per fresh line, done/undone alternating) and 50 000 older (10 per old line)
insert into public.kitchen_event (tenant_id, subject, action, order_line_id, created_at, created_by)
  select '11111111-1111-4111-8111-111111111111', 'line', case when k % 2 = 1 then 'done' else 'undone' end, p.id, now() - interval '10 minutes' + k * interval '1 second', 'c1000000-0000-4000-8000-00000000000c'
    from pl p, generate_series(1, 10) k;
insert into public.kitchen_event (tenant_id, subject, action, order_line_id, created_at, created_by)
  select '11111111-1111-4111-8111-111111111111', 'line', case when k % 2 = 1 then 'done' else 'undone' end, md5('old' || n)::uuid, now() - interval '40 hours' + k * interval '1 second', 'c1000000-0000-4000-8000-00000000000c'
    from generate_series(1, 5000) n, generate_series(1, 10) k;
analyze public.order_line; analyze public.kitchen_event;
select is((select count(*)::int from public.order_line), 5300, 'the fixture: 300 lines today and 5 000 older');
select is((select count(*)::int from public.kitchen_event), 53000, 'and 3 000 + 50 000 kitchen events');

select pg_temp.claims('chef');
set local statement_timeout = '5s';
create temporary table res (k text primary key, j jsonb);
insert into res select 'board', public.kitchen_tickets();
select is((select jsonb_array_length(j -> 'tickets') > 0 from res where k = 'board'), true, 'kitchen_tickets answers under a 5 s statement limit and returns comande');
insert into res select 'mark', public.kitchen_mark_line((select id from pl where n = 1), '{"done": true}');
select is((select j ->> 'changed' from res where k = 'mark'), 'true', 'kitchen_mark_line answers under the limit (line 1 had ten events, the last one undone, so done changes it)');
insert into res select 'set', public.kitchen_set_ticket((select jsonb_build_object('sessionId', l.table_session_id, 'firedAt', to_char(l.fired_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'course', l.course::text, 'segue', l.segue, 'closed', true) from public.order_line l where l.id = (select id from pl where n = 2)));
select is((select j ->> 'changed' from res where k = 'set'), 'true', 'kitchen_set_ticket answers under the limit');
reset statement_timeout;

-- Plans
create function pg_temp.plan_of(p_sql text) returns text language plpgsql as $$
declare
  v json;
begin
  execute 'explain (format json) ' || p_sql into v;
  return v::text;
end
$$;
select ok(pg_temp.plan_of(format($q$ select e.action from public.kitchen_event e where e.tenant_id = '11111111-1111-4111-8111-111111111111' and e.subject = 'line'
    and e.order_line_id = %L order by e.seq desc limit 1 $q$, (select id from pl where n = 3))) like '%kitchen_event_line_idx%', 'the line-state lookup reads through kitchen_event_line_idx');
select ok(pg_temp.plan_of(format($q$ select e.action from public.kitchen_event e where e.tenant_id = '11111111-1111-4111-8111-111111111111' and e.subject = 'ticket'
    and e.table_session_id = %L and e.fired_at = now() and e.course = 'secondi' and e.segue = false order by e.seq desc limit 1 $q$, pg_temp.id('t1'))) like '%kitchen_event_ticket_idx%',
  'the ticket-state lookup reads through kitchen_event_ticket_idx');
select ok(pg_temp.plan_of($q$ select l.id from public.order_line l where l.tenant_id = '11111111-1111-4111-8111-111111111111' and l.fired_at is not null
      and l.fired_at > now() - interval '30 hours' and l.fired_at <= now() $q$) like '%order_line_fired_idx%', 'the comanda window still reads through order_line_fired_idx');

select * from finish();
rollback;
