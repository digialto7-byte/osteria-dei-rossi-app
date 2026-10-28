-- M19 step 6: the kitchen ticket list (M19 plan §3.1.8, §3.1.12, §3.2; ADR-019). app.kitchen_ticket_rows is called with a fixed
-- instant, public.kitchen_tickets() as chef, owner, admin and waiter. Tickets are found by key (session, firedAt, course, segue),
-- lines by id, never by position. Two tables, two courses in one call, a segue ticket, a closed table, yesterday, drafts and a
-- second tenant. No euro value anywhere. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(40);

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
-- The tickets as 'table course HH:MM segue' (UTC clock) in the order returned.
create function pg_temp.tk(j jsonb) returns text language sql as $$
  select coalesce(string_agg(replace(replace(t ->> 'tableName', 'Tavolo ', 'T'), ' (demo)', '') || ' ' || (t ->> 'course') || ' '
           || to_char(((t ->> 'firedAt')::timestamptz) at time zone 'utc', 'HH24:MI') || case when (t ->> 'segue')::boolean then ' segue' else '' end,
           ', ' order by o), 'none')
    from jsonb_array_elements(j -> 'tickets') with ordinality x (t, o) $$;
create function pg_temp.rows(p_at timestamptz) returns jsonb language sql as $$ select app.kitchen_ticket_rows('11111111-1111-4111-8111-111111111111', p_at) $$;
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

-- The evening of 2026-11-04 (Rome is UTC+1 then). The list is read at 20:30Z.
select pg_temp.mkl('a1', 't1', 'antipasti', 2, '2026-11-04 20:00:00+00', false, 2, 'senza aglio');
select pg_temp.mkl('a2', 't1', 'antipasti', 2, '2026-11-04 20:00:00+00', false, 0.5, null, true, 'kitchen_error');
select pg_temp.mkl('b1', 't2', 'primi', 3, '2026-11-04 20:05:00+00');
select pg_temp.mkl('c1', 't1', 'primi', 3, '2026-11-04 20:10:00+00', true);
select pg_temp.mkl('d1', 't1', 'primi', 3, '2026-11-04 20:20:00+00');
select pg_temp.mkl('d2', 't1', 'secondi', 1, '2026-11-04 20:20:00+00', false, 1, '<script>alert(1)</script>');
select pg_temp.mkl('x3', 't3', 'secondi', 1, '2026-11-04 20:00:00+00');                      -- closed table
select pg_temp.mkl('y1', 't1', 'secondi', 1, '2026-11-03 20:00:00+00');                      -- yesterday
select pg_temp.mkl('z1', 't1', 'secondi', 1, null);                                           -- a draft
select pg_temp.mkl('z2', 't2', 'primi', 3, null);                                             -- a draft
select pg_temp.mkl('w1', 'tb', 'dolci', 1, '2026-11-04 20:00:00+00', false, 1, null, false, null, 'b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222');

select is(pg_temp.tk(pg_temp.rows('2026-11-04 20:30:00+00')),
  'T1 antipasti 20:00, T2 primi 20:05, T1 primi 20:10 segue, T1 primi 20:20, T1 secondi 20:20',
  'tickets oldest first, then table, course; the segue ticket apart; closed T3, yesterday, drafts and tenant B absent');
select is((select count(*)::int from jsonb_array_elements(pg_temp.rows('2026-11-04 20:30:00+00') -> 'tickets') t where t ->> 'sessionId' = pg_temp.id('t3')::text), 0, 'the closed table has no ticket');
select is((select count(*)::int from jsonb_array_elements(pg_temp.rows('2026-11-04 20:30:00+00') -> 'tickets') t where t ->> 'sessionId' = pg_temp.id('tb')::text), 0, 'tenant B has no ticket in A''s list');
select is(pg_temp.rows('2026-11-04 20:30:00+00') ->> 'truncated', 'false', 'not truncated');
select is((select array_agg(k order by k collate "C") from jsonb_object_keys(pg_temp.rows('2026-11-04 20:30:00+00')) k), array['tickets', 'truncated'],
  'the rows function returns {tickets, truncated}');

-- Ticket shape, found by key
create temporary table tj as select t from jsonb_array_elements(pg_temp.rows('2026-11-04 20:30:00+00') -> 'tickets') t;
select is((select array_agg(k order by k collate "C") from tj, jsonb_object_keys(t) k where t ->> 'sessionId' = pg_temp.id('t1')::text and t ->> 'course' = 'antipasti'),
  array['course', 'covers', 'firedAt', 'firedBy', 'key', 'lines', 'segue', 'sessionId', 'tableName'], 'a ticket has exactly the nine documented keys');
select is((select array_agg(k order by k collate "C") from tj, jsonb_object_keys(t -> 'lines' -> 0) k where t ->> 'sessionId' = pg_temp.id('t1')::text and t ->> 'course' = 'antipasti'),
  array['id', 'isShared', 'name', 'note', 'qty', 'voidReason', 'voided'], 'a line has exactly the seven documented keys');
select is((select t ->> 'tableName' || '/' || (t ->> 'covers') || '/' || (t -> 'firedBy' ->> 'displayName') || '/' || (t -> 'firedBy' ->> 'id')
             from tj where t ->> 'sessionId' = pg_temp.id('t2')::text),
  'Tavolo 2 (demo)/2/Cameriere Demo/d1000000-0000-4000-8000-00000000000d', 'table name, covers and who sent it');
select is((select t ->> 'key' from tj where t ->> 'sessionId' = pg_temp.id('t1')::text and t ->> 'course' = 'primi' and (t ->> 'segue')::boolean),
  pg_temp.id('t1')::text || '|2026-11-04T20:10:00.000000Z|primi|true', 'the key is sessionId|firedAt|course|segue');
-- lines, by id
select is((select e ->> 'name' || '/' || (e ->> 'qty') || '/' || (e ->> 'note') || '/' || (e ->> 'isShared') || '/' || (e ->> 'voided')
             from tj, jsonb_array_elements(t -> 'lines') e where e ->> 'id' = pg_temp.id('a1')::text),
  'Bruschetta (demo)/2/senza aglio/false/false', 'a line: name, qty, note, flags');
select is((select e ->> 'qty' || '/' || (e ->> 'isShared') || '/' || (e ->> 'voided') || '/' || (e ->> 'voidReason')
             from tj, jsonb_array_elements(t -> 'lines') e where e ->> 'id' = pg_temp.id('a2')::text),
  '0.5/true/true/kitchen_error', 'a half portion, shared, fired then voided: voided with its reason');
select is((select jsonb_typeof(e -> 'voidReason') from tj, jsonb_array_elements(t -> 'lines') e where e ->> 'id' = pg_temp.id('a1')::text), 'null', 'a live line has voidReason null');
select is((select jsonb_typeof(e -> 'note') from tj, jsonb_array_elements(t -> 'lines') e where e ->> 'id' = pg_temp.id('a2')::text), 'null', 'and a missing note is null');
select is((select count(*)::int from tj, jsonb_array_elements(t -> 'lines') e where t ->> 'sessionId' = pg_temp.id('t1')::text and t ->> 'course' = 'antipasti'), 2,
  'the voided line stays on its ticket');
select is((select e ->> 'note' from tj, jsonb_array_elements(t -> 'lines') e where e ->> 'id' = pg_temp.id('d2')::text), '<script>alert(1)</script>',
  'a note is data and is returned as is (rendered as text by the screen)');
select is((select count(*)::int from tj, jsonb_array_elements(t -> 'lines') e where t ->> 'sessionId' = pg_temp.id('t1')::text and t ->> 'course' = 'primi'
             and e ->> 'id' in (pg_temp.id('d1')::text, pg_temp.id('c1')::text)), 2, 'the segue and the normal primi lines are on separate tickets, one line each');
select is((select count(*)::int from tj where t ->> 'sessionId' = pg_temp.id('t1')::text and t ->> 'course' = 'primi'), 2, 'two primi tickets for T1');

-- Lines of one ticket are ordered by creation, then id
select pg_temp.mkl('o1', 't2', 'primi', 3, '2026-11-04 20:25:00+00', false, 1, null, false, null, 'd1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', '2026-11-04 18:02:00+00');
select pg_temp.mkl('o2', 't2', 'primi', 3, '2026-11-04 20:25:00+00', false, 1, null, false, null, 'd1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', '2026-11-04 18:01:00+00');
select is((select string_agg(e ->> 'id', ',' order by o) from jsonb_array_elements(
    (select t -> 'lines' from jsonb_array_elements(pg_temp.rows('2026-11-04 20:30:00+00') -> 'tickets') t where t ->> 'firedAt' like '2026-11-04T20:25%')) with ordinality x (e, o)),
  pg_temp.id('o2')::text || ',' || pg_temp.id('o1')::text, 'lines are ordered by creation instant (o2 was added first)');

-- Business day, cut-off 02:00 Rome: 00:30Z = 01:30 Rome belongs to the previous day, 01:30Z = 02:30 Rome to the new one
select pg_temp.mkl('n1', 't1', 'dolci', 1, '2026-11-05 00:30:00+00');
select pg_temp.mkl('n2', 't1', 'dolci', 1, '2026-11-05 01:30:00+00');
select is((select count(*)::int from jsonb_array_elements(pg_temp.rows('2026-11-05 00:50:00+00') -> 'tickets') t where t ->> 'course' = 'dolci'), 1,
  'at 01:50 Rome (still 4 November) the 01:30 line is on the list');
select is((select count(*)::int from jsonb_array_elements(pg_temp.rows('2026-11-05 00:50:00+00') -> 'tickets') t where t ->> 'firedAt' like '2026-11-05T01:30%'), 0, 'and the 02:30 line is not (it has not happened yet)');
select is(pg_temp.tk(pg_temp.rows('2026-11-05 02:00:00+00')), 'T1 dolci 01:30', 'at 03:00 Rome (5 November) only the 02:30 line is on the list: the 01:30 one and the evening belong to yesterday');
select is(pg_temp.tk(pg_temp.rows('2026-11-05 00:50:00+00')) like '%T1 dolci 00:30%', true, 'at 01:50 Rome the evening and the 01:30 line are the same business day');

-- No euro value: the key set and a recursive scan with 059's chef regex
select is((select count(*)::int from pg_temp.all_keys(pg_temp.rows('2026-11-04 20:30:00+00')) k
            where k ~* '(cost|margin|price|prezz|gp_pct|_eur$|amount|total|importo)'), 0, 'no key matches the chef cost regex (cost, margin, price, prezz, gp_pct, _eur, amount, total, importo)');
select is((select count(*)::int from pg_temp.all_keys(pg_temp.rows('2026-11-04 20:30:00+00')) k where k ~* 'unit|vat|eur|recipe'), 0, 'nor unit, vat, eur or recipe');
select is(pg_temp.rows('2026-11-04 20:30:00+00')::text !~ '€', true, 'and no euro sign in the payload');

-- Truncation: 201 tickets on another business day, the newest 200 returned oldest first
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by, fired_at, fired_by)
  select gen_random_uuid(), '11111111-1111-4111-8111-111111111111', pg_temp.id('t2'), '11000000-0000-4000-8000-000000000001', 'secondi', 1, 14, 10, 'menu', '2026-11-20 10:00+00',
         'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d', '2026-11-20 17:00:00+00'::timestamptz + n * interval '1 second', 'd1000000-0000-4000-8000-00000000000d'
    from generate_series(1, 201) n;
select is(pg_temp.rows('2026-11-20 18:00:00+00') ->> 'truncated', 'true', '201 tickets: truncated true');
select is(jsonb_array_length(pg_temp.rows('2026-11-20 18:00:00+00') -> 'tickets'), 200, 'and 200 tickets are returned');
select is((select (t ->> 'firedAt')::timestamptz from jsonb_array_elements(pg_temp.rows('2026-11-20 18:00:00+00') -> 'tickets') t limit 1), '2026-11-20 17:00:02+00'::timestamptz,
  'the oldest one was dropped, and the list starts at the second ticket (ascending)');
select is((pg_temp.rows('2026-11-20 18:00:00+00') -> 'tickets' -> 199 ->> 'firedAt')::timestamptz, '2026-11-20 17:03:21+00'::timestamptz, 'and ends with the newest');

-- Roles: kitchen_tickets() reads the current business day; a line fired now for the check
select pg_temp.mkl('r1', 't1', 'secondi', 1, clock_timestamp() - interval '1 minute');
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
select set_config('request.jwt.claims', '', true);
select is(pg_temp.err($$ select public.kitchen_tickets() $$), '42501 permission denied: the kitchen list needs owner, admin or chef', 'no claims: refused');
reset role;
select is((select array_agg(k order by k collate "C") from kt, jsonb_object_keys(j) k where nm = 'chef'), array['asOf', 'tickets', 'truncated'], 'kitchen_tickets returns {asOf, truncated, tickets}');
select is((select (j -> 'tickets' -> 0 ->> 'sessionId') || '/' || jsonb_array_length(j -> 'tickets') from kt where nm = 'chef'), pg_temp.id('t1')::text || '/1', 'the chef sees the ticket fired now (and not the old evenings)');
select is((select j - 'asOf' from kt where nm = 'owner'), (select j - 'asOf' from kt where nm = 'chef'), 'the owner gets the same payload as the chef');
select is((select j - 'asOf' from kt where nm = 'admin'), (select j - 'asOf' from kt where nm = 'chef'), 'and so does the admin');
select is((select (j ->> 'asOf')::timestamptz between now() - interval '1 minute' and clock_timestamp() + interval '1 second' from kt where nm = 'chef'), true, 'asOf is the server instant of the read');

select * from finish();
rollback;
