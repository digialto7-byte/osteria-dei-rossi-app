-- M19b step 4 (docs/plans/2026-10-31-m19b-kitchen-done.md §3.2; AT1-AT5, AT8, AT10, T1): public.kitchen_mark_line and public.kitchen_set_ticket, called as chef A unless named.
-- Lines are fired at the start of the current business day (never after now, safe at any hour incl. the 02:00 cut-off and DST nights), so the board in each reply
-- (read at the server's clock) contains them. Comande are told apart by session, course and segue. Errors are asserted as 'SQLSTATE message'. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(55);

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

-- Comande, all fired at the start of today's business day:
--   P  T1 primi (p1 p2 p3)           AT1-AT3        Q  T2 secondi (q1 q2)        AT4 auto close and reopen
--   R  T1 antipasti (r1..r5)         AT5 and done on a closed comanda            V  T2 dolci (v1 v2)  AT8, v1 voided
--   C  T3 (closed table) c1          AT10           Z  T2 primi segue (z1)       a second comanda of a table with others
select pg_temp.mkl('p1', 't1', 'primi', 3, pg_temp.day_start());
select pg_temp.mkl('p2', 't1', 'primi', 3, pg_temp.day_start());
select pg_temp.mkl('p3', 't1', 'primi', 3, pg_temp.day_start());
select pg_temp.mkl('q1', 't2', 'secondi', 1, pg_temp.day_start());
select pg_temp.mkl('q2', 't2', 'secondi', 1, pg_temp.day_start());
select pg_temp.mkl('r1', 't1', 'antipasti', 2, pg_temp.day_start());
select pg_temp.mkl('r2', 't1', 'antipasti', 2, pg_temp.day_start());
select pg_temp.mkl('r3', 't1', 'antipasti', 2, pg_temp.day_start());
select pg_temp.mkl('r4', 't1', 'antipasti', 2, pg_temp.day_start());
select pg_temp.mkl('r5', 't1', 'antipasti', 2, pg_temp.day_start());
select pg_temp.mkl('v1', 't2', 'dolci', 1, pg_temp.day_start(), false, 1, null, false, 'kitchen_error');
select pg_temp.mkl('v2', 't2', 'dolci', 1, pg_temp.day_start());
select pg_temp.mkl('z1', 't2', 'primi', 3, pg_temp.day_start(), true);
select pg_temp.mkl('c1', 't3', 'secondi', 1, pg_temp.day_start());
select pg_temp.mkl('d0', 't1', 'dolci', 1, null);                                           -- a draft
select pg_temp.mkl('b1', 'tb', 'dolci', 1, pg_temp.day_start(), false, 1, null, false, null, 'b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222');

select pg_temp.claims('chef');
create temporary table rep (k text primary key, j jsonb);

-- AT1: one tap marks a dish done ----------------------------------------------------------------------------------------------------
insert into rep select 'p1done', pg_temp.mark('p1', true);
select is((select j ->> 'changed' || '/' || (j ->> 'autoClosed') || '/' || (j ->> 'reopened') from rep where k = 'p1done'), 'true/false/false', 'AT1: {done: true} changes the state; no auto close, no reopen');
select is(pg_temp.lev('p1'), 'line:done:tap', 'AT1: one line event, done, cause tap');
select is((select created_by from public.kitchen_event where order_line_id = pg_temp.id('p1')), 'c1000000-0000-4000-8000-00000000000c'::uuid, 'written by the chef (app.app_user_id())');
select is((select e ->> 'done' from rep, jsonb_array_elements(pg_temp.bt(j -> 'board', 'tickets', 'p1') -> 'lines') e where k = 'p1done' and e ->> 'id' = pg_temp.id('p1')::text), 'true',
  'T1: the board in the reply already contains the new event (p1 done)');

-- AT2: the second tap undoes it; history keeps both rows ---------------------------------------------------------------------------------
create temporary table before as select to_jsonb(e) j from public.kitchen_event e where e.order_line_id = pg_temp.id('p1');
insert into rep select 'p1undone', pg_temp.mark('p1', false);
select is((select j ->> 'changed' from rep where k = 'p1undone'), 'true', 'AT2: {done: false} changes the state');
select is(pg_temp.lev('p1'), 'line:done:tap,line:undone:tap', 'AT2: both rows are in the history');
select is((select j from before), (select to_jsonb(e) from public.kitchen_event e where e.order_line_id = pg_temp.id('p1') and e.action = 'done'), 'AT2: the first row is unchanged');

-- AT3: a double tap writes once ------------------------------------------------------------------------------------------------------
insert into rep select 'p2a', pg_temp.mark('p2', true);
insert into rep select 'p2b', pg_temp.mark('p2', true);
select is((select j ->> 'changed' from rep where k = 'p2a') || '/' || (select j ->> 'changed' from rep where k = 'p2b'), 'true/false', 'AT3: the second identical tap changes nothing');
select is(pg_temp.lev('p2'), 'line:done:tap', 'AT3: still one done row');
select is((select j ->> 'autoClosed' || '/' || (j ->> 'reopened') from rep where k = 'p2b'), 'false/false', 'and the no-op reply says no auto close, no reopen');
select is((select jsonb_typeof(j -> 'board') from rep where k = 'p2b'), 'object', 'and still carries the board');
-- an undone on a line that is not done is a no-op too
insert into rep select 'p3u', pg_temp.mark('p3', false);
select is((select j ->> 'changed' from rep where k = 'p3u') || '/' || pg_temp.lev('p3'), 'false/-', '{done: false} on a line that is not done changes nothing and writes nothing');

-- Two of three done: no auto close -----------------------------------------------------------------------------------------------------
select is(pg_temp.tev('p1'), '-', 'P: 1 of 3 done (p2), no ticket event yet');
insert into rep select 'p1done2', pg_temp.mark('p1', true);
select is((select j ->> 'autoClosed' from rep where k = 'p1done2') || '/' || pg_temp.tev('p1'), 'false/-', 'marking 2 of 3 does not auto-close');

-- AT4: the last open line closes the comanda; "undo" reopens it ----------------------------------------------------------------------------
insert into rep select 'q1done', pg_temp.mark('q1', true);
insert into rep select 'q2done', pg_temp.mark('q2', true);
select is((select j ->> 'autoClosed' from rep where k = 'q1done') || '/' || (select j ->> 'autoClosed' from rep where k = 'q2done'), 'false/true', 'AT4: the last open line reports autoClosed');
select is(pg_temp.lev('q1') || ' + ' || pg_temp.lev('q2') || ' + ' || pg_temp.tev('q1'), 'line:done:tap + line:done:tap + ticket:closed:auto', 'AT4: two done rows and exactly one closed auto');
select is((select max(e.seq) filter (where e.subject = 'ticket') > max(e.seq) filter (where e.subject = 'line') from public.kitchen_event e where e.table_session_id = pg_temp.id('t2') or e.order_line_id in (pg_temp.id('q1'), pg_temp.id('q2'))),
  true, 'the closed row follows the done row in seq order');
select is((pg_temp.bt((select j -> 'board' from rep where k = 'q2done'), 'closedTickets', 'q2') ->> 'autoClosed') || '/' || coalesce((pg_temp.bt((select j -> 'board' from rep where k = 'q2done'), 'tickets', 'q2') ->> 'key'), 'absent'),
  'true/absent', 'AT4: the reply''s board has the comanda in closedTickets and not in tickets');
insert into rep select 'q2undo', pg_temp.mark('q2', false);
select is((select j ->> 'reopened' || '/' || (j ->> 'autoClosed') from rep where k = 'q2undo'), 'true/false', 'AT4: undoing a line of the closed comanda reopens it');
select is(pg_temp.lev('q2') || ' + ' || pg_temp.tev('q1'), 'line:done:tap,line:undone:tap + ticket:closed:auto,ticket:reopened:auto', 'AT4: undone and reopened auto, both appended');
select is(coalesce(pg_temp.bt((select j -> 'board' from rep where k = 'q2undo'), 'tickets', 'q2') ->> 'doneCount', 'absent') || '/' || coalesce(pg_temp.bt((select j -> 'board' from rep where k = 'q2undo'), 'closedTickets', 'q2') ->> 'key', 'absent'),
  '1/absent', 'AT4: the reply''s board has it back in tickets with 1 of 2 done');
-- the segue comanda of the same table and course is a different comanda
insert into rep select 'z1done', pg_temp.mark('z1', true);
select is((select j ->> 'autoClosed' from rep where k = 'z1done') || '/' || pg_temp.tev('z1') || '/' || pg_temp.tev('q1'), 'true/ticket:closed:auto/ticket:closed:auto,ticket:reopened:auto', 'a segue comanda closes on its own lines and leaves the others alone');

-- AT5: "Chiudi comanda" closes at once, counts stay ----------------------------------------------------------------------------------------
insert into rep select 'r1done', pg_temp.mark('r1', true);
insert into rep select 'r2done', pg_temp.mark('r2', true);
insert into rep select 'r5close', pg_temp.setk('r1', true);
select is((select j ->> 'changed' from rep where k = 'r5close'), 'true', 'AT5: closing changes the state');
select is((pg_temp.bt((select j -> 'board' from rep where k = 'r5close'), 'closedTickets', 'r1') ->> 'doneCount') || '/' || (pg_temp.bt((select j -> 'board' from rep where k = 'r5close'), 'closedTickets', 'r1') ->> 'lineCount')
  || '/' || (pg_temp.bt((select j -> 'board' from rep where k = 'r5close'), 'closedTickets', 'r1') ->> 'autoClosed'), '2/5/false', 'AT5: the comanda is in closedTickets, still 2 of 5, closed by a tap');
select is(pg_temp.tev('r1'), 'ticket:closed:tap', 'AT5: one ticket row, cause tap');
insert into rep select 'r5close2', pg_temp.setk('r1', true);
select is((select j ->> 'changed' from rep where k = 'r5close2') || '/' || pg_temp.tev('r1'), 'false/ticket:closed:tap', 'AT5: closing again changes nothing');
-- a done on a closed comanda records the line only
insert into rep select 'r3done', pg_temp.mark('r3', true);
select is((select j ->> 'changed' || '/' || (j ->> 'autoClosed') from rep where k = 'r3done') || '/' || pg_temp.lev('r3') || '/' || pg_temp.tev('r1'), 'true/false/line:done:tap/ticket:closed:tap',
  'done on a manually closed comanda: one line row, no ticket row, still closed');
select is(pg_temp.bt((select j -> 'board' from rep where k = 'r3done'), 'closedTickets', 'r3') ->> 'doneCount', '3', 'and the board shows 3 done, still closed');
insert into rep select 'r1reopen', pg_temp.setk('r1', false);
select is((select j ->> 'changed' from rep where k = 'r1reopen') || '/' || coalesce(pg_temp.bt((select j -> 'board' from rep where k = 'r1reopen'), 'tickets', 'r1') ->> 'doneCount', 'absent'), 'true/3', 'AT5: reopening puts it back in tickets');
select is(pg_temp.tev('r1'), 'ticket:closed:tap,ticket:reopened:tap', 'AT5: the reopen is a tap row');
insert into rep select 'r1reopen2', pg_temp.setk('r1', false);
select is((select j ->> 'changed' from rep where k = 'r1reopen2'), 'false', 'AT5: reopening an open comanda changes nothing');
-- and the board of a set_ticket reply carries the whole board
select is((select array_agg(kk order by kk collate "C") from rep, jsonb_object_keys(j) kk where rep.k = 'r1reopen'), array['board', 'changed'], 'the set_ticket reply is {board, changed}');
select is((select array_agg(kk order by kk collate "C") from rep, jsonb_object_keys(j) kk where rep.k = 'p1done'), array['autoClosed', 'board', 'changed', 'reopened'], 'the mark_line reply is {autoClosed, board, changed, reopened}');

-- AT8: a voided line cannot be marked ----------------------------------------------------------------------------------------------------
insert into rep select 'v1done', pg_temp.mark('v1', true);
select is((select j ->> 'changed' from rep where k = 'v1done') || '/' || pg_temp.lev('v1'), 'false/-', 'AT8: marking a voided line changes nothing and writes nothing');

-- AT10: a closed table refuses both ---------------------------------------------------------------------------------------------------------
create temporary table n0 as select pg_temp.nev() n;
select is(pg_temp.err($$select pg_temp.mark('c1', true)$$), 'P0001 session_closed', 'AT10: mark on a closed table: session_closed');
select is(pg_temp.err($$select pg_temp.setk('c1', true)$$), 'P0001 session_closed', 'AT10: set_ticket on a closed table: session_closed');
select is(pg_temp.nev() - (select n from n0), 0, 'AT10: nothing written');

-- Errors ---------------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.err($$select pg_temp.mark('d0', true)$$), 'P0002 line_not_found', 'a draft line: line_not_found');
select is(pg_temp.err($$select pg_temp.mark('b1', true)$$), 'P0002 line_not_found', 'tenant B''s line: line_not_found');
select is(pg_temp.err($$select public.kitchen_mark_line(gen_random_uuid(), '{"done":true}')$$), 'P0002 line_not_found', 'an unknown id: line_not_found');
select is(pg_temp.err($$select public.kitchen_mark_line(null, '{"done":true}')$$), '22023 invalid_request', 'a null line: invalid_request');
select is(pg_temp.err($$select public.kitchen_mark_line(pg_temp.id('p1'), '{}')$$), '22023 invalid_request', '{}: invalid_request');
select is(pg_temp.err($$select public.kitchen_mark_line(pg_temp.id('p1'), '{"done":1}')$$), '22023 invalid_request', '{done: 1}: invalid_request');
select is(pg_temp.err($$select public.kitchen_mark_line(pg_temp.id('p1'), '{"done":true,"x":1}')$$), '22023 invalid_request', 'an extra key: invalid_request');
select is(pg_temp.err($$select public.kitchen_mark_line(pg_temp.id('p1'), '[true]')$$), '22023 invalid_request', 'an array body: invalid_request');
select is(pg_temp.err($$select public.kitchen_set_ticket(pg_temp.kbody('p1', true) - 'segue')$$), '22023 invalid_request', 'a ticket body missing segue: invalid_request');
select is(pg_temp.err($$select public.kitchen_set_ticket(jsonb_set(pg_temp.kbody('p1', true), '{firedAt}', '"2026-11-04T20:10:00.123Z"'))$$), '22023 invalid_request', 'a firedAt with 3 decimals: invalid_request');
select is(pg_temp.err($$select public.kitchen_set_ticket(jsonb_set(pg_temp.kbody('p1', true), '{closed}', '"yes"'))$$), '22023 invalid_request', 'closed as a string: invalid_request');
select is(pg_temp.err($$select public.kitchen_set_ticket(pg_temp.kbody('p1', true) || '{"x":1}')$$), '22023 invalid_request', 'an extra key in a ticket body: invalid_request');
select is(pg_temp.err($$select public.kitchen_set_ticket(jsonb_set(pg_temp.kbody('p1', true), '{course}', '"dolci"'))$$), 'P0002 ticket_not_found', 'a key with no fired line: ticket_not_found');
select is(pg_temp.err($$select public.kitchen_set_ticket(jsonb_set(pg_temp.kbody('p1', true), '{firedAt}', '"2026-11-04T20:10:00.123456Z"'))$$), 'P0002 ticket_not_found', 'a well-formed key with an instant no line was fired at: ticket_not_found');
select is(pg_temp.err($$select public.kitchen_set_ticket(pg_temp.kbody('b1', true))$$), 'P0002 ticket_not_found', 'tenant B''s key: ticket_not_found');
select is((select count(*)::int from unnest(array[
    $$select pg_temp.mark('d0', true)$$, $$select pg_temp.mark('b1', true)$$, $$select public.kitchen_mark_line(null, '{"done":true}')$$,
    $$select pg_temp.mark('c1', true)$$, $$select pg_temp.setk('c1', true)$$, $$select public.kitchen_set_ticket('{}')$$,
    $$select public.kitchen_set_ticket(pg_temp.kbody('b1', true))$$]) s where split_part(pg_temp.errd(s), '|', 2) <> ''), 0, 'no error carries a DETAIL');

-- A waiter: 42501 and nothing written ----------------------------------------------------------------------------------------------------------
update n0 set n = pg_temp.nev();
select pg_temp.claims('waiter');
select is(split_part(pg_temp.err($$select pg_temp.mark('p3', true)$$), ' ', 1) || '/' || split_part(pg_temp.err($$select pg_temp.setk('p3', true)$$), ' ', 1), '42501/42501', 'a waiter is refused by both procedures');
select is(pg_temp.nev() - (select n from n0), 0, 'and nothing is written');
select pg_temp.claims('chef');

select * from finish();
rollback;
