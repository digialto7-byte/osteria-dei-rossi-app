-- M19b step 2 (docs/plans/2026-10-31-m19b-kitchen-done.md §3.2): the kitchen helpers in schema app. Role gate, key parser (T3: the six-decimal text round-trips),
-- ticket lock, line done, ticket state, open-line count. Events are inserted as the migration owner with fixed created_at. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

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

create function pg_temp.claims(p_auth text, p_tenant text, p_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated', 'tenant_id', p_tenant, 'app_role', p_role)::text, true)
$$;
-- A line event with a fixed created_at; seq follows the insert order.
create function pg_temp.lev(p_line text, p_action text, p_at timestamptz, p_tenant text default '11111111-1111-4111-8111-111111111111') returns void language sql as $$
  insert into public.kitchen_event (tenant_id, subject, action, order_line_id, created_at, created_by)
    values (p_tenant::uuid, 'line', p_action, pg_temp.id(p_line), p_at, 'c1000000-0000-4000-8000-00000000000c')
$$;
create function pg_temp.tev(p_action text, p_cause text, p_session text, p_course text, p_segue boolean, p_fired timestamptz, p_at timestamptz,
    p_tenant text default '11111111-1111-4111-8111-111111111111', p_by text default 'c1000000-0000-4000-8000-00000000000c') returns void language sql as $$
  insert into public.kitchen_event (tenant_id, subject, action, cause, table_session_id, course, segue, fired_at, created_at, created_by)
    values (p_tenant::uuid, 'ticket', p_action, p_cause, pg_temp.id(p_session), p_course::public.course, p_segue, p_fired, p_at, p_by::uuid)
$$;

-- Fire instants carry microseconds, so the round trip of T3 is a real test.
select pg_temp.mkl('p1', 't1', 'primi', 3, '2026-11-04 20:10:00.123456+00');
select pg_temp.mkl('p2', 't1', 'primi', 3, '2026-11-04 20:10:00.123456+00');
select pg_temp.mkl('p3', 't1', 'primi', 3, '2026-11-04 20:10:00.123456+00');
select pg_temp.mkl('p4', 't1', 'primi', 3, '2026-11-04 20:10:00.123456+00');   -- 'p4' is voided below
select pg_temp.mkl('pd', 't1', 'primi', 3, null);                              -- a draft: never counted
select pg_temp.mkl('s1', 't1', 'primi', 3, '2026-11-04 20:10:00.123456+00', true);  -- the segue comanda of the same course
select pg_temp.mkl('v1', 'tb', 'dolci', 1, '2026-11-04 20:10:00.123456+00', false, 1, null, false, null, 'b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222');
update public.order_line set voided_at = '2026-11-04 20:12:00+00', voided_by = 'd1000000-0000-4000-8000-00000000000d', void_reason = 'kitchen_error' where id = pg_temp.id('p4');

-- Role gate ---------------------------------------------------------------------------------------------------------------------
select pg_temp.claims('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.err($$select app.require_kitchen_marker()$$), 'ok', 'owner passes the marker gate');
select pg_temp.claims('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is(pg_temp.err($$select app.require_kitchen_marker()$$), 'ok', 'admin passes the marker gate');
select pg_temp.claims('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.err($$select app.require_kitchen_marker()$$), 'ok', 'chef passes the marker gate');
select pg_temp.claims('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(pg_temp.err($$select app.require_kitchen_marker()$$), '42501 permission denied: kitchen marks need owner, admin or chef', 'waiter A is refused');
select pg_temp.claims('e0000000-0000-4000-8000-00000000000e', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(split_part(pg_temp.err($$select app.require_kitchen_marker()$$), ' ', 1), '42501', 'waiter A2 is refused too');
select set_config('request.jwt.claims', '', true);
select is(split_part(pg_temp.err($$select app.require_kitchen_marker()$$), ' ', 1), '42501', 'no claims is refused');

-- Key parser (T3) -----------------------------------------------------------------------------------------------------------------
create function pg_temp.key(p_body text) returns text language plpgsql as $$
begin
  return (select k.session_id::text || '|' || k.fired_at::text || '|' || k.course::text || '|' || k.segue::text from app.kitchen_ticket_key(p_body::jsonb) k);
exception when others then
  return 'err ' || sqlstate || ' ' || sqlerrm;
end
$$;
select is((select k.fired_at = '2026-11-04 20:10:00.123456+00'::timestamptz from app.kitchen_ticket_key(
             jsonb_build_object('sessionId', pg_temp.id('t1'), 'firedAt', '2026-11-04T20:10:00.123456Z', 'course', 'primi', 'segue', false)) k), true,
          'firedAt with six decimals round-trips to the stored instant');
select is((select to_char(l.fired_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') from public.order_line l where l.id = pg_temp.id('p1')), '2026-11-04T20:10:00.123456Z',
          'and the printed instant of a stored line is that same text');
select is(pg_temp.key('{"sessionId":"' || pg_temp.id('t1') || '","firedAt":"2026-11-04T20:10:00.123Z","course":"primi","segue":false}'), 'err 22023 invalid_request', 'three decimals are refused');
select is(pg_temp.key('{"sessionId":"' || pg_temp.id('t1') || '","firedAt":"2026-11-04T20:10:00.123456","course":"primi","segue":false}'), 'err 22023 invalid_request', 'no Z is refused');
select is(pg_temp.key('{"sessionId":"' || pg_temp.id('t1') || '","firedAt":"2026-11-04T20:10:00.123456+01:00","course":"primi","segue":false}'), 'err 22023 invalid_request', 'an offset is refused');
select is(pg_temp.key('{"sessionId":"' || pg_temp.id('t1') || '","firedAt":"x","course":"primi","segue":false}'), 'err 22023 invalid_request', 'a word is refused');
select is(pg_temp.key('{"sessionId":"' || pg_temp.id('t1') || '","firedAt":"2026-11-04T20:10:00.123456Z","course":"pizze","segue":false}'), 'err 22023 invalid_request', 'an unknown course is refused');
select is(pg_temp.key('{"sessionId":"' || pg_temp.id('t1') || '","firedAt":"2026-11-04T20:10:00.123456Z","course":"primi","segue":"true"}'), 'err 22023 invalid_request', 'segue as a string is refused');
select is(pg_temp.key('{"sessionId":"not-a-uuid","firedAt":"2026-11-04T20:10:00.123456Z","course":"primi","segue":true}'), 'err 22023 invalid_request', 'a bad uuid is refused');
select is(pg_temp.key('{"sessionId":"' || pg_temp.id('t1') || '","firedAt":"2026-11-04T20:10:00.123456Z","course":"secondi","segue":true,"closed":true}'),
          pg_temp.id('t1') || '|2026-11-04 20:10:00.123456+00|secondi|true', 'a valid body parses (extra keys such as closed are the caller''s business)');

-- Line done: the latest event by seq wins -------------------------------------------------------------------------------------------
select is(app.kitchen_line_done('11111111-1111-4111-8111-111111111111', pg_temp.id('p1')), false, 'no event: not done');
select pg_temp.lev('p1', 'done', '2026-11-04 20:20:00+00');
select is(app.kitchen_line_done('11111111-1111-4111-8111-111111111111', pg_temp.id('p1')), true, 'done: done');
select pg_temp.lev('p1', 'undone', '2026-11-04 20:21:00+00');
select is(app.kitchen_line_done('11111111-1111-4111-8111-111111111111', pg_temp.id('p1')), false, 'done then undone: not done');
select pg_temp.lev('p1', 'done', '2026-11-04 20:22:00+00');
select is(app.kitchen_line_done('11111111-1111-4111-8111-111111111111', pg_temp.id('p1')), true, 'done, undone, done: done');
-- p2: two events with the same created_at; the higher seq wins whichever order they are inserted in.
select pg_temp.lev('p2', 'done', '2026-11-04 20:20:00+00');
select pg_temp.lev('p2', 'undone', '2026-11-04 20:20:00+00');
select pg_temp.lev('p3', 'undone', '2026-11-04 20:20:00+00');
select pg_temp.lev('p3', 'done', '2026-11-04 20:20:00+00');
select is(app.kitchen_line_done('11111111-1111-4111-8111-111111111111', pg_temp.id('p2')) || ',' || app.kitchen_line_done('11111111-1111-4111-8111-111111111111', pg_temp.id('p3')),
          'false,true', 'same created_at: seq decides, in both insert orders');
select is(app.kitchen_line_done('22222222-2222-4222-8222-222222222222', pg_temp.id('p1')), false, 'another tenant''s id never sees these events');

-- Ticket state ----------------------------------------------------------------------------------------------------------------------
select is((select s.closed::text || ',' || coalesce(s.closed_at::text, '-') || ',' || coalesce(s.closed_by::text, '-') || ',' || s.auto::text
             from app.kitchen_ticket_state('11111111-1111-4111-8111-111111111111', pg_temp.id('t1'), '2026-11-04 20:10:00.123456+00', 'primi', false) s),
          'false,-,-,false', 'no ticket event: open');
select pg_temp.tev('closed', 'auto', 't1', 'primi', false, '2026-11-04 20:10:00.123456+00', '2026-11-04 20:30:00+00');
select is((select s.closed::text || ',' || s.closed_at::text || ',' || s.closed_by::text || ',' || s.auto::text
             from app.kitchen_ticket_state('11111111-1111-4111-8111-111111111111', pg_temp.id('t1'), '2026-11-04 20:10:00.123456+00', 'primi', false) s),
          'true,2026-11-04 20:30:00+00,c1000000-0000-4000-8000-00000000000c,true', 'closed auto: closed with its instant, user and auto flag');
select is((select s.closed from app.kitchen_ticket_state('11111111-1111-4111-8111-111111111111', pg_temp.id('t1'), '2026-11-04 20:10:00.123456+00', 'primi', true) s),
          false, 'the segue comanda of the same course is not affected');
select is((select s.closed from app.kitchen_ticket_state('11111111-1111-4111-8111-111111111111', pg_temp.id('t2'), '2026-11-04 20:10:00.123456+00', 'primi', false) s),
          false, 'another session with the same instant and course is not affected');
select pg_temp.tev('reopened', 'tap', 't1', 'primi', false, '2026-11-04 20:10:00.123456+00', '2026-11-04 20:31:00+00', '11111111-1111-4111-8111-111111111111', 'f1000000-0000-4000-8000-00000000000f');
select is((select s.closed::text || ',' || coalesce(s.closed_at::text, '-') from app.kitchen_ticket_state('11111111-1111-4111-8111-111111111111', pg_temp.id('t1'), '2026-11-04 20:10:00.123456+00', 'primi', false) s),
          'false,-', 'closed then reopened: open');
select is((select s.closed from app.kitchen_ticket_state('22222222-2222-4222-8222-222222222222', pg_temp.id('t1'), '2026-11-04 20:10:00.123456+00', 'primi', false) s),
          false, 'tenant B''s read of the key sees nothing');

-- Open lines: p1 done, p4 voided, p2 and p3 mixed, draft not counted ---------------------------------------------------------------------
select is(app.kitchen_ticket_open_lines('11111111-1111-4111-8111-111111111111', pg_temp.id('t1'), '2026-11-04 20:10:00.123456+00', 'primi', false), 1,
          'four fired lines: p1 done, p2 not done, p3 done, p4 voided -> one open (p2); the draft and the segue line are not counted');
select is(app.kitchen_ticket_open_lines('11111111-1111-4111-8111-111111111111', pg_temp.id('t1'), '2026-11-04 20:10:00.123456+00', 'primi', true), 1, 'the segue comanda has its own open line');

-- Lock and ACL -------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.err($$select app.kitchen_ticket_lock('11111111-1111-4111-8111-111111111111', pg_temp.id('t1'), '2026-11-04 20:10:00.123456+00', 'primi', false)$$), 'ok',
          'the ticket lock runs for a valid key (its serialisation is proved by the race cases)');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'app' and p.proname in ('require_kitchen_marker', 'kitchen_ticket_key', 'kitchen_ticket_lock', 'kitchen_line_done', 'kitchen_ticket_state', 'kitchen_ticket_open_lines')), 6, 'all six exist');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace, unnest(array['anon', 'authenticated', 'service_role']) r
            where n.nspname = 'app' and p.proname in ('require_kitchen_marker', 'kitchen_ticket_key', 'kitchen_ticket_lock', 'kitchen_line_done', 'kitchen_ticket_state', 'kitchen_ticket_open_lines')
              and has_function_privilege(r, p.oid, 'execute')), 0, 'no API role executes any of the six');

-- The parser casts text to timestamptz, which depends on the session's settings: it is stable, never immutable.
select is((select provolatile::text from pg_proc where oid = 'app.kitchen_ticket_key(jsonb)'::regprocedure), 's', 'app.kitchen_ticket_key is stable (it casts text to timestamptz)');

select * from finish();
rollback;
