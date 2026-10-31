-- M19b step 3 (docs/plans/2026-10-31-m19b-kitchen-done.md §3.2; AT1, AT2, AT4, AT5, AT8, AT9, AT10, AT11, AT15): the kitchen board, app.kitchen_ticket_rows read at fixed
-- instants (events later than the instant are ignored), then public.kitchen_tickets() as chef, owner, admin and waiter. Tickets are found by key, lines by id.
-- Two tables, a segue comanda of the same course, a closed table, a second tenant. No euro value anywhere. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(43);

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

create function pg_temp.lev(p_line text, p_action text, p_at timestamptz) returns void language sql as $$
  insert into public.kitchen_event (tenant_id, subject, action, order_line_id, created_at, created_by)
    values ('11111111-1111-4111-8111-111111111111', 'line', p_action, pg_temp.id(p_line), p_at, 'c1000000-0000-4000-8000-00000000000c')
$$;
-- A ticket event for the comanda of line p_line (its session, instant, course and segue are read from the line).
create function pg_temp.tev(p_line text, p_action text, p_cause text, p_at timestamptz, p_by text default 'c1000000-0000-4000-8000-00000000000c') returns void language sql as $$
  insert into public.kitchen_event (tenant_id, subject, action, cause, table_session_id, fired_at, course, segue, created_at, created_by)
    select l.tenant_id, 'ticket', p_action, p_cause, l.table_session_id, l.fired_at, l.course, l.segue, p_at, p_by::uuid
      from public.order_line l where l.id = pg_temp.id(p_line)
$$;
create function pg_temp.rows(p_at timestamptz) returns jsonb language sql as $$ select app.kitchen_ticket_rows('11111111-1111-4111-8111-111111111111', p_at) $$;
-- The comanda of line p_line, from list p_list ('tickets' or 'closedTickets'), as JSON (null when absent). Found by key, never by position.
create function pg_temp.tk(p_at timestamptz, p_list text, p_line text) returns jsonb language sql as $$
  select t from jsonb_array_elements(pg_temp.rows(p_at) -> p_list) t
   where t ->> 'key' = (select l.table_session_id::text || '|' || to_char(l.fired_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || l.course::text || '|' || l.segue::text
                          from public.order_line l where l.id = pg_temp.id(p_line))
$$;
-- The lines of a comanda as 'a1,a3,a2' (ids replaced by their register names), in the order returned, with a marker: '*' done, '!' voided.
create function pg_temp.ln(p_at timestamptz, p_list text, p_line text) returns text language sql as $$
  select string_agg((select r.k from reg r where r.id = (e ->> 'id')::uuid) || case when (e ->> 'done')::boolean then '*' else '' end || case when (e ->> 'voided')::boolean then '!' else '' end, ',' order by o)
    from jsonb_array_elements(pg_temp.tk(p_at, p_list, p_line) -> 'lines') with ordinality x (e, o)
$$;
-- The comande of a list as the registered name of their first-created line... simpler: as 'course HH:MM[ segue]' with the table number, in the order returned.
create function pg_temp.tl(p_at timestamptz, p_list text) returns text language sql as $$
  select coalesce(string_agg(replace(replace(t ->> 'tableName', 'Tavolo ', 'T'), ' (demo)', '') || ' ' || (t ->> 'course') || ' '
           || to_char(((t ->> 'firedAt')::timestamptz) at time zone 'utc', 'HH24:MI') || case when (t ->> 'segue')::boolean then ' segue' else '' end, ', ' order by o), 'none')
    from jsonb_array_elements(pg_temp.rows(p_at) -> p_list) with ordinality x (t, o)
$$;
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

-- The evening of 2026-11-04 (Rome is UTC+1). Lines are created in the order of their names (created_at set so).
select pg_temp.mkl('a1', 't1', 'antipasti', 2, '2026-11-04 20:00:00+00', false, 1, null, false, null, 'd1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', '2026-11-04 18:01:00+00');
select pg_temp.mkl('a2', 't1', 'antipasti', 2, '2026-11-04 20:00:00+00', false, 1, null, false, null, 'd1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', '2026-11-04 18:02:00+00');
select pg_temp.mkl('a3', 't1', 'antipasti', 2, '2026-11-04 20:00:00+00', false, 1, null, false, null, 'd1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', '2026-11-04 18:03:00+00');
select pg_temp.mkl('p1', 't1', 'primi', 3, '2026-11-04 20:10:00+00', false, 1, null, false, null, 'd1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', '2026-11-04 18:01:00+00');
select pg_temp.mkl('p2', 't1', 'primi', 3, '2026-11-04 20:10:00+00', false, 1, null, false, null, 'd1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', '2026-11-04 18:02:00+00');
select pg_temp.mkl('s1', 't1', 'primi', 3, '2026-11-04 20:10:00+00', true);
select pg_temp.mkl('x1', 't2', 'secondi', 1, '2026-11-04 20:15:00+00', false, 1, null, false, null, 'd1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', '2026-11-04 18:01:00+00');
select pg_temp.mkl('x2', 't2', 'secondi', 1, '2026-11-04 20:15:00+00', false, 1, null, false, null, 'd1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', '2026-11-04 18:02:00+00');
select pg_temp.mkl('d1', 't2', 'dolci', 1, '2026-11-04 20:16:00+00');
select pg_temp.mkl('y1', 't3', 'secondi', 1, '2026-11-04 20:00:00+00');                       -- a closed table, a line still to make
select pg_temp.mkl('w1', 'tb', 'dolci', 1, '2026-11-04 20:00:00+00', false, 1, null, false, null, 'b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222');

-- Shape ---------------------------------------------------------------------------------------------------------------------
select is((select array_agg(k order by k collate "C") from jsonb_object_keys(pg_temp.rows('2026-11-04 20:30:00+00')) k), array['closedTickets', 'remaining', 'tickets', 'truncated'],
  'the rows function returns {closedTickets, remaining, tickets, truncated}');
select is((select array_agg(k order by k collate "C") from jsonb_object_keys(pg_temp.tk('2026-11-04 20:30:00+00', 'tickets', 'a1')) k),
  array['autoClosed', 'closedAt', 'closedBy', 'course', 'covers', 'doneCount', 'firedAt', 'firedBy', 'key', 'lineCount', 'lines', 'segue', 'sessionId', 'tableName'], 'a comanda has exactly the fourteen documented keys');
select is((select array_agg(k order by k collate "C") from jsonb_object_keys(pg_temp.tk('2026-11-04 20:30:00+00', 'tickets', 'a1') -> 'lines' -> 0) k),
  array['done', 'id', 'isShared', 'name', 'note', 'qty', 'voidReason', 'voided'], 'a line has exactly the eight documented keys');

-- Baseline at 20:30: nothing done, nothing closed ------------------------------------------------------------------------------------
select is(pg_temp.tl('2026-11-04 20:30:00+00', 'tickets'), 'T1 antipasti 20:00, T1 primi 20:10, T1 primi 20:10 segue, T2 secondi 20:15, T2 dolci 20:16',
  'active comande oldest first; the segue comanda apart; closed T3 and tenant B absent (AT10)');
select is(pg_temp.ln('2026-11-04 20:30:00+00', 'tickets', 'a1'), 'a1,a2,a3', 'lines in creation order, none done');
select is((pg_temp.rows('2026-11-04 20:30:00+00') ->> 'remaining')::int, 9, 'remaining counts the open lines of the active comande (3 + 2 + 1 + 2 + 1), not the closed table''s (AT15)');

-- AT1: one done event ------------------------------------------------------------------------------------------------------------
select pg_temp.lev('a1', 'done', '2026-11-04 20:20:00+00');
select is(pg_temp.ln('2026-11-04 20:21:00+00', 'tickets', 'a1'), 'a2,a3,a1*', 'AT1: after the event the line is done and last');
select is((pg_temp.tk('2026-11-04 20:21:00+00', 'tickets', 'a1') ->> 'doneCount') || '/' || (pg_temp.tk('2026-11-04 20:21:00+00', 'tickets', 'a1') ->> 'lineCount'), '1/3', 'doneCount 1, lineCount 3');
select is(pg_temp.ln('2026-11-04 20:19:00+00', 'tickets', 'a1'), 'a1,a2,a3', 'read before the event (20:19): not done; events after the instant are ignored');
select is((pg_temp.rows('2026-11-04 20:21:00+00') ->> 'remaining')::int, 8, 'remaining 8 after one done');

-- AT2: done, then undone ---------------------------------------------------------------------------------------------------------
select pg_temp.lev('a1', 'undone', '2026-11-04 20:22:00+00');
select is(pg_temp.ln('2026-11-04 20:23:00+00', 'tickets', 'a1'), 'a1,a2,a3', 'AT2: undone puts the line back in creation order');
select is((pg_temp.rows('2026-11-04 20:23:00+00') ->> 'remaining')::int, 9, 'and remaining is 9 again');

-- AT8: a done line later voided; a done line next to it ----------------------------------------------------------------------------
select pg_temp.lev('a2', 'done', '2026-11-04 20:24:00+00');
select pg_temp.lev('a3', 'done', '2026-11-04 20:25:00+00');
update public.order_line set voided_at = '2026-11-04 20:26:00+00', voided_by = 'd1000000-0000-4000-8000-00000000000d', void_reason = 'kitchen_error' where id = pg_temp.id('a2');
select is(pg_temp.ln('2026-11-04 20:30:00+00', 'tickets', 'a1'), 'a1,a2!,a3*', 'AT8: lines to make, then the voided one (never done), then the done one');
select is((pg_temp.tk('2026-11-04 20:30:00+00', 'tickets', 'a1') ->> 'doneCount') || '/' || (pg_temp.tk('2026-11-04 20:30:00+00', 'tickets', 'a1') ->> 'lineCount'), '1/2', 'the voided line is in neither count');
select is((pg_temp.rows('2026-11-04 20:30:00+00') ->> 'remaining')::int, 7, 'remaining 7: a1, p1, p2, s1, x1, x2, d1 (the voided and the done lines are not open)');
select pg_temp.lev('p1', 'done', '2026-11-04 20:40:00+00');
select is((pg_temp.rows('2026-11-04 20:45:00+00') ->> 'remaining')::int, 6, 'AT15: one more done, remaining 6');

-- AT4 / AT5: closing, in two ways ------------------------------------------------------------------------------------------------
select pg_temp.lev('x1', 'done', '2026-11-04 20:41:00+00');
select pg_temp.lev('x2', 'done', '2026-11-04 20:42:00+00');
select pg_temp.tev('x1', 'closed', 'auto', '2026-11-04 20:42:01+00');
select pg_temp.tev('s1', 'closed', 'tap', '2026-11-04 20:43:00+00', 'f1000000-0000-4000-8000-00000000000f');
select pg_temp.tev('d1', 'closed', 'tap', '2026-11-04 20:42:01+00');                      -- same instant as the T2 secondi close
select is(pg_temp.tl('2026-11-04 20:44:00+00', 'tickets'), 'T1 antipasti 20:00, T1 primi 20:10', 'AT4/AT5: the closed comande leave the active list; the segue one closing leaves the non-segue T1 primi active');
select is(pg_temp.tl('2026-11-04 20:44:00+00', 'closedTickets'), 'T1 primi 20:10 segue, T2 secondi 20:15, T2 dolci 20:16', 'closedTickets: latest close first, a tie by key (T2 secondi before T2 dolci)');
select is((pg_temp.tk('2026-11-04 20:44:00+00', 'closedTickets', 'x1') ->> 'autoClosed') || '/' || (pg_temp.tk('2026-11-04 20:44:00+00', 'closedTickets', 'x1') -> 'closedBy' ->> 'displayName'), 'true/Chef Demo', 'closed auto: autoClosed true and closedBy the chef');
select is((pg_temp.tk('2026-11-04 20:44:00+00', 'closedTickets', 's1') ->> 'autoClosed') || '/' || (pg_temp.tk('2026-11-04 20:44:00+00', 'closedTickets', 's1') -> 'closedBy' ->> 'displayName'), 'false/Admin Demo', 'closed by a tap: autoClosed false and closedBy the admin');
select is((pg_temp.tk('2026-11-04 20:44:00+00', 'closedTickets', 's1') ->> 'doneCount') || '/' || (pg_temp.tk('2026-11-04 20:44:00+00', 'closedTickets', 's1') ->> 'lineCount'), '0/1', 'a comanda closed by hand keeps its counts (0 of 1)');
select is(pg_temp.tk('2026-11-04 20:44:00+00', 'tickets', 'x1'), null, 'a closed comanda is not in tickets');
select is((pg_temp.rows('2026-11-04 20:44:00+00') ->> 'remaining')::int, 2, 'remaining 2: a closed comanda''s open lines are not counted (a1 and p2)');
select pg_temp.tev('s1', 'reopened', 'tap', '2026-11-04 20:46:00+00');
select is(pg_temp.tl('2026-11-04 20:50:00+00', 'tickets'), 'T1 antipasti 20:00, T1 primi 20:10, T1 primi 20:10 segue', 'reopened: back in its oldest-first place (after the same-instant non-segue comanda)');
select is((pg_temp.rows('2026-11-04 20:50:00+00') ->> 'remaining')::int, 3, 'and its open line counts again');
select is(pg_temp.tk('2026-11-04 20:50:00+00', 'closedTickets', 's1'), null, 'and it is no longer in closedTickets');

-- AT9: dishes fired after a close form a new comanda ------------------------------------------------------------------------------
select pg_temp.mkl('x3', 't2', 'secondi', 1, '2026-11-04 20:48:00+00');
select is(pg_temp.tl('2026-11-04 20:50:00+00', 'tickets'), 'T1 antipasti 20:00, T1 primi 20:10, T1 primi 20:10 segue, T2 secondi 20:48', 'AT9: a new active comanda T2 secondi 20:48');
select is(pg_temp.ln('2026-11-04 20:50:00+00', 'tickets', 'x3') || '/' || pg_temp.ln('2026-11-04 20:50:00+00', 'closedTickets', 'x1'), 'x3/x1*,x2*', 'the new comanda holds only the new line; the 20:15 one stays closed with its own');

-- AT10: a table closed at the till ------------------------------------------------------------------------------------------------
select pg_temp.tev('y1', 'reopened', 'tap', '2026-11-04 20:47:00+00');                    -- an event on a closed table's comanda changes nothing for the board
select is(pg_temp.tk('2026-11-04 20:50:00+00', 'tickets', 'y1') is null and pg_temp.tk('2026-11-04 20:50:00+00', 'closedTickets', 'y1') is null, true, 'AT10: a closed table''s comanda is in neither list');

-- Business day (cut-off 02:00 Rome = 01:00Z): a comanda fired at 00:30Z (01:30 Rome) and closed ---------------------------------------
select pg_temp.mkl('n1', 't1', 'dolci', 1, '2026-11-05 00:30:00+00');
select pg_temp.tev('n1', 'closed', 'tap', '2026-11-05 00:35:00+00');
select is(pg_temp.tk('2026-11-05 00:50:00+00', 'closedTickets', 'n1') is not null, true, 'at 01:50 Rome the comanda of 01:30 is in closedTickets (same business day)');
select is(pg_temp.tk('2026-11-05 01:40:00+00', 'closedTickets', 'n1') is null, true, 'at 02:40 Rome it is gone: a new business day');

-- No euro value (AT11) -----------------------------------------------------------------------------------------------------------
select is((select count(*)::int from pg_temp.all_keys(pg_temp.rows('2026-11-04 20:50:00+00')) k
            where k ~* '(cost|margin|price|prezz|gp_pct|_eur$|amount|total|importo)'), 0, 'AT11: no key matches the chef cost regex');
select is((select count(*)::int from pg_temp.all_keys(pg_temp.rows('2026-11-04 20:50:00+00')) k where k ~* 'unit|vat|eur|recipe'), 0, 'nor unit, vat, eur or recipe');
select is(pg_temp.rows('2026-11-04 20:50:00+00')::text !~ '€', true, 'and no euro sign in the payload');

-- Cap: 201 closed comande on another day -> 200 returned, truncated -----------------------------------------------------------------
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by, fired_at, fired_by)
  select gen_random_uuid(), '11111111-1111-4111-8111-111111111111', pg_temp.id('t2'), '11000000-0000-4000-8000-000000000001', 'secondi', 1, 14, 10, 'menu', '2026-11-20 10:00+00',
         'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d', '2026-11-20 17:00:00+00'::timestamptz + n * interval '1 second', 'd1000000-0000-4000-8000-00000000000d'
    from generate_series(1, 201) n;
insert into public.kitchen_event (tenant_id, subject, action, cause, table_session_id, fired_at, course, segue, created_at, created_by)
  select l.tenant_id, 'ticket', 'closed', 'tap', l.table_session_id, l.fired_at, l.course, l.segue, l.fired_at + interval '1 minute', 'c1000000-0000-4000-8000-00000000000c'
    from public.order_line l where l.fired_at >= '2026-11-20 17:00:00+00' and l.fired_at < '2026-11-20 18:00:00+00';
select is(pg_temp.rows('2026-11-20 18:00:00+00') ->> 'truncated', 'true', '201 closed comande: truncated true');
select is(jsonb_array_length(pg_temp.rows('2026-11-20 18:00:00+00') -> 'closedTickets'), 200, 'and 200 are returned');
select is(jsonb_array_length(pg_temp.rows('2026-11-20 18:00:00+00') -> 'tickets'), 0, 'with none active');
select is((pg_temp.rows('2026-11-20 18:00:00+00') -> 'closedTickets' -> 0 ->> 'firedAt')::timestamptz, '2026-11-20 17:03:21+00'::timestamptz, 'the latest close comes first');

-- Roles: kitchen_tickets() reads the current business day. The line is fired at the start of the business day, never after now ---------------
create function pg_temp.day_start() returns timestamptz language sql as $$
  select least(app.local_instant(app.business_date(t.id, now()), app.business_day_cutoff(t.id), t.timezone), now())
    from public.tenant t where t.id = '11111111-1111-4111-8111-111111111111' $$;
select pg_temp.mkl('r1', 't1', 'secondi', 1, pg_temp.day_start());
create temporary table kt (nm text primary key, j jsonb);
grant insert, select on kt to authenticated;
grant select on reg to authenticated;
grant execute on function pg_temp.id(text), pg_temp.act_as(uuid, uuid, text) to authenticated;
set local role authenticated;
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
insert into kt select 'chef', public.kitchen_tickets();
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
insert into kt select 'owner', public.kitchen_tickets();
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
insert into kt select 'admin', public.kitchen_tickets();
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(pg_temp.err($$ select public.kitchen_tickets() $$), '42501 permission denied: the kitchen list needs owner, admin or chef', 'the waiter is refused');
reset role;
select is((select array_agg(k order by k collate "C") from kt, jsonb_object_keys(j) k where nm = 'chef'), array['asOf', 'closedTickets', 'remaining', 'tickets', 'truncated'], 'kitchen_tickets returns the whole board');
select is((select j - 'asOf' from kt where nm = 'owner'), (select j - 'asOf' from kt where nm = 'chef'), 'the owner gets the same payload as the chef');
select is((select j - 'asOf' from kt where nm = 'admin'), (select j - 'asOf' from kt where nm = 'chef'), 'and so does the admin');
select is((select (j ->> 'remaining')::int from kt where nm = 'chef'), 1, 'the chef''s board holds the one line of today: r1');

select * from finish();
rollback;
