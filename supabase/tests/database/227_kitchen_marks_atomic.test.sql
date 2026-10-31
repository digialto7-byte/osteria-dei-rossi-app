-- M19b step 5 (docs/plans/2026-10-31-m19b-kitchen-done.md §3.1.4; AT13): the kitchen procedures are single transactions. A test-only trigger on kitchen_event raises on a
-- ticket event when a flag is set; the done that would auto-close, the undone that would reopen and a manual close must leave no row at all. Without the flag the same
-- calls succeed (the fixture is valid). Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

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

select pg_temp.mkl('q1', 't2', 'secondi', 1, pg_temp.day_start());
select pg_temp.mkl('q2', 't2', 'secondi', 1, pg_temp.day_start());
select pg_temp.mkl('r1', 't1', 'antipasti', 2, pg_temp.day_start());
select pg_temp.mkl('r2', 't1', 'antipasti', 2, pg_temp.day_start());

-- The fault: any ticket event insert raises while test.fail = 'ticket'.
create function pg_temp.kitchen_fault() returns trigger language plpgsql as $$
begin
  if current_setting('test.fail', true) = 'ticket' and new.subject = 'ticket' then
    raise exception 'test fault' using errcode = 'P0001';
  end if;
  return new;
end
$$;
create trigger kitchen_event_test_fault before insert on public.kitchen_event for each row execute function pg_temp.kitchen_fault();

select pg_temp.claims('chef');
select set_config('test.fail', '', true);
select pg_temp.mark('q1', true);

-- The done that would auto-close ----------------------------------------------------------------------------------------------------------
select set_config('test.fail', 'ticket', true);
select is(pg_temp.err($$select pg_temp.mark('q2', true)$$), 'P0001 test fault', 'AT13: a fault on the auto-close raises out of kitchen_mark_line');
select is(pg_temp.lev('q2') || ' + ' || pg_temp.tev('q2'), '- + -', 'AT13: no done row for the line and no ticket row: the done was undone with the fault');
select is(pg_temp.lev('q1'), 'line:done:tap', 'and the earlier done of the other line is intact');

-- The undone that would reopen --------------------------------------------------------------------------------------------------------------
select set_config('test.fail', '', true);
select is((pg_temp.mark('q2', true) ->> 'autoClosed'), 'true', 'without the fault the same call closes the comanda (the fixture is valid)');
select set_config('test.fail', 'ticket', true);
select is(pg_temp.err($$select pg_temp.mark('q2', false)$$), 'P0001 test fault', 'AT13: a fault on the auto-reopen raises');
select is(pg_temp.lev('q2') || ' + ' || pg_temp.tev('q2'), 'line:done:tap + ticket:closed:auto', 'AT13: no undone row; the comanda is still closed');

-- A manual close ---------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.err($$select pg_temp.setk('r1', true)$$), 'P0001 test fault', 'a fault on kitchen_set_ticket raises');
select is(pg_temp.tev('r1'), '-', 'and no ticket row was written');
select set_config('test.fail', '', true);
select is((pg_temp.setk('r1', true) ->> 'changed') || '/' || pg_temp.tev('r1'), 'true/ticket:closed:tap', 'without the fault the close succeeds');
select is((pg_temp.mark('q2', false) ->> 'reopened') || '/' || pg_temp.tev('q2'), 'true/ticket:closed:auto,ticket:reopened:auto', 'and so does the reopen');

select * from finish();
rollback;
