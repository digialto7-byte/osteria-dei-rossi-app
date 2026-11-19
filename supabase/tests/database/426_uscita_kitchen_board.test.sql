-- Comanda per uscita, step 13 (docs/plans/2026-11-18-comanda-uscite.md section 3.9; migration 20261206220500_uscita_kitchen.sql): M6, the kitchen
-- board by uscita. A ticket is (session, ticket instant, uscita): the instant is fired_at for uscite 0-1 and greatest(fired_at, called_at) for a
-- called uscita >= 2. Held lines (sent, uscita not called) are not tickets: they are folded per (session, uscita) under waiting. Lines are
-- ordered by course inside a ticket; there is no course or segue at ticket level. A later ticket of the same (session, uscita) is an addition.
-- The open-session remap appends one uscita close for a new key whose legacy keys are all closed. Fake data only (the founder's example).
begin;
set local timezone = 'UTC';
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('b3000000-0000-4000-8000-0000000000c3', 'chef-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('b3100000-0000-4000-8000-0000000000c3', '22222222-2222-4222-8222-222222222222', 'b3000000-0000-4000-8000-0000000000c3', 'chef', 'Chef B Demo');
-- No recipes: the board does not read stock, and depletion at send is pgTAP 421's.
insert into public.menu_item (id, tenant_id, name, category, course_default, recipe_key, is_available, is_active, created_by, updated_by) values
  ('11000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Bruschetta (demo)', 'Antipasti', 'antipasti', null, true, true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Tagliatelle (demo)', 'Primi', 'primi', null, true, true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Spezzatino (demo)', 'Secondi', 'secondi', null, true, true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'Acqua (demo)', 'Bevande', 'bevande', null, true, true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.menu_item_price (tenant_id, menu_item_id, price, vat_rate, valid_from, created_by)
  select '11111111-1111-4111-8111-111111111111', id, 10, 10, now() - interval '1 day', 'a1000000-0000-4000-8000-00000000000a' from public.menu_item;
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by)
  select ('13000000-0000-4000-8000-00000000000' || n)::uuid, '11111111-1111-4111-8111-111111111111', 'Tavolo ' || n || ' (demo)', n,
         'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a' from generate_series(1, 3) n;
-- S1 the founder's table, S2 another table, S3 an open table from before M6 (legacy kitchen events).
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, created_by, updated_by)
  select ('14000000-0000-4000-8000-00000000000' || n)::uuid, '11111111-1111-4111-8111-111111111111', ('13000000-0000-4000-8000-00000000000' || n)::uuid,
         'Tavolo ' || n || ' (demo)', 2, 'd1000000-0000-4000-8000-00000000000d', '1998-10-24', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'
    from generate_series(1, 3) n;

-- A draft line n of session s, item i, uscita u (as the table owner: the entry path is pgTAP 420's).
create function pg_temp.draft(p_n int, p_s int, p_i int, p_u int) returns void language sql as $$
  insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, uscita, segue, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by)
  select ('e1000000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid, '11111111-1111-4111-8111-111111111111',
         ('14000000-0000-4000-8000-00000000000' || p_s)::uuid, m.id, m.course_default, 1, p_u, p_u >= 2, 10, 10, 'menu', '1998-10-24 19:00+00',
         'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'
    from public.menu_item m where m.id = ('11000000-0000-4000-8000-00000000000' || p_i)::uuid $$;
create function pg_temp.l(p_n int) returns uuid language sql as $$ select ('e1000000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid $$;
create function pg_temp.s(p_s int) returns uuid language sql as $$ select ('14000000-0000-4000-8000-00000000000' || p_s)::uuid $$;
create function pg_temp.as_role(p_auth uuid, p_tenant uuid, p_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated', 'tenant_id', p_tenant, 'app_role', p_role, 'aal', 'aal1')::text, true) $$;
create temp table res (nm text primary key, j jsonb);
grant all on res to authenticated;
-- Runs a statement returning jsonb as the given user (waiter A unless named); stores the reply under nm; returns 'ok' or "SQLSTATE message".
create function pg_temp.run(p_nm text, stmt text, p_who text default 'waiter') returns text language plpgsql as $$
declare
  v jsonb;
  state text;
  msg text;
begin
  case p_who
    when 'waiter' then perform pg_temp.as_role('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
    when 'chef' then perform pg_temp.as_role('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
    when 'chefb' then perform pg_temp.as_role('b3000000-0000-4000-8000-0000000000c3', '22222222-2222-4222-8222-222222222222', 'chef');
  end case;
  set local role authenticated;
  begin
    execute stmt into v;
  exception when others then
    reset role;
    get stacked diagnostics state = returned_sqlstate, msg = message_text;
    return state || ' ' || msg;
  end;
  reset role;
  insert into res values (p_nm, v) on conflict (nm) do update set j = excluded.j;
  return 'ok';
end
$$;
create function pg_temp.j(p_nm text) returns jsonb language sql as $$ select j from res where nm = p_nm $$;
create function pg_temp.fire(p_s int, p_lines int[]) returns text language sql as $$
  select 'select public.fire_course(''14000000-0000-4000-8000-00000000000' || p_s || ''', jsonb_build_object(''lineIds'', to_jsonb(array['
         || array_to_string(array(select quote_literal(pg_temp.l(n)) || '::uuid' from unnest(p_lines) n), ',') || ']), ''hold'', true))' $$;
create function pg_temp.call(p_s int, p_u int) returns text language sql as $$
  select 'select public.call_uscita(''14000000-0000-4000-8000-00000000000' || p_s || ''', ''{"uscita": ' || p_u || '}''::jsonb)' $$;
create function pg_temp.us(p timestamptz) returns text language sql as $$ select to_char(p at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') $$;
create function pg_temp.board(p_nm text, p_who text default 'chef') returns text language sql as $$ select pg_temp.run(p_nm, 'select public.kitchen_tickets()', p_who) $$;
-- The tickets of session s and uscita u in a stored board, in board order.
create function pg_temp.tk(p_nm text, p_s int, p_u int) returns setof jsonb language sql as $$
  select t from jsonb_array_elements(pg_temp.j(p_nm) -> 'tickets') with ordinality x(t, o)
   where t ->> 'sessionId' = pg_temp.s(p_s)::text and (t ->> 'uscita')::int = p_u order by o $$;
create function pg_temp.keys(p jsonb) returns text language sql as $$ select string_agg(k, ',' order by k collate "C") from jsonb_object_keys(p) k $$;
create function pg_temp.fired(p_n int) returns text language sql as $$ select pg_temp.us(fired_at) from public.order_line where id = pg_temp.l(p_n) $$;
create function pg_temp.called(p_s int, p_u int) returns text language sql as $$
  select pg_temp.us(called_at) from public.uscita_call where table_session_id = pg_temp.s(p_s) and uscita = p_u $$;
create function pg_temp.try(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return 'ok';
exception when others then
  return sqlstate;
end
$$;
-- Every object key of a jsonb value, at any depth.
create function pg_temp.all_keys(p jsonb) returns setof text language sql as $$
  with recursive v(x) as (
    select p
    union all
    select c.value from v, lateral (select e.value from jsonb_each(case when jsonb_typeof(v.x) = 'object' then v.x else '{}' end) e
                                    union all
                                    select a.value from jsonb_array_elements(case when jsonb_typeof(v.x) = 'array' then v.x else '[]' end) a) c)
  select distinct k from v, lateral jsonb_object_keys(case when jsonb_typeof(v.x) = 'object' then v.x else '{}' end) k $$;

-- 1-4 (AT1): the founder's send. Tagliatelle is entered before Bruschetta, so only the course order puts the Bruschetta first.
select pg_temp.draft(1, 1, 2, 1), pg_temp.draft(2, 1, 1, 1), pg_temp.draft(3, 1, 3, 2), pg_temp.draft(4, 1, 3, 2);
select count(*) from (select pg_temp.run('send', pg_temp.fire(1, array[1, 2, 3, 4]))) x;
select count(*) from (select pg_temp.board('b1')) x;
select is((select count(*) || ' ' || min(t ->> 'uscita') || ' ' || min((select string_agg(e ->> 'name', ',' order by o) from jsonb_array_elements(t -> 'lines') with ordinality y(e, o)))
             from pg_temp.tk('b1', 1, 1) t)
          || ' / ' || (select string_agg((w ->> 'uscita') || ':' || (w ->> 'lineCount'), ',') from jsonb_array_elements(pg_temp.j('b1') -> 'waiting') w
                        where w ->> 'sessionId' = pg_temp.s(1)::text)
          || ' / ' || (select count(*) from jsonb_array_elements(pg_temp.j('b1') -> 'tickets')),
  '1 1 Bruschetta (demo),Tagliatelle (demo) / 2:2 / 1',
  'after the founder''s send the board has one 1st ticket, Bruschetta (antipasti) before Tagliatelle (primi), and waiting has the 2nd with 2 lines (AT1)');
select is((select pg_temp.keys(t) || ' / ' || pg_temp.keys(t -> 'lines' -> 0) || ' / ' || (select string_agg(e ->> 'course', ',' order by o) from jsonb_array_elements(t -> 'lines') with ordinality y(e, o))
             from pg_temp.tk('b1', 1, 1) t),
  'addition,autoClosed,calledAt,closedAt,closedBy,covers,doneCount,firedAt,firedBy,key,lineCount,lines,sessionId,tableName,uscita / '
  || 'course,done,id,isShared,name,note,qty,voidReason,voided,weightG / antipasti,primi',
  'a ticket has uscita, addition and calledAt and no course or segue; each line carries its course');
select is((select pg_temp.keys(w) || ' / ' || pg_temp.keys(w -> 'lines' -> 0) from jsonb_array_elements(pg_temp.j('b1') -> 'waiting') w)
          || ' / ' || pg_temp.keys(pg_temp.j('b1')) || ' / ' || (pg_temp.j('b1') ->> 'remaining') || ' ' || (pg_temp.j('b1') ->> 'waitingCount'),
  'lineCount,lines,sessionId,tableName,uscita / course,id,isShared,name,note,qty,weightG / asOf,closedTickets,remaining,tickets,truncated,waiting,waitingCount / 2 2',
  'waiting items and their lines have no done and no mark target; remaining counts in-kitchen lines only, waitingCount = 2');
select is((select (t ->> 'key') || ' ' || (t ->> 'firedAt') || ' ' || coalesce(t ->> 'calledAt', 'null') || ' ' || (t ->> 'addition') from pg_temp.tk('b1', 1, 1) t),
  pg_temp.s(1) || '|' || pg_temp.fired(1) || '|u1 ' || pg_temp.fired(1) || ' null false',
  'the 1st ticket key is "<sessionId>|<firedAt>|u1"; calledAt null; not an addition');

-- 5: a dish added to the waiting 2nd stays folded with it.
select pg_temp.draft(5, 1, 3, 2);
select count(*) from (select pg_temp.run('add', pg_temp.fire(1, array[5]))) x;
select count(*) from (select pg_temp.board('b2')) x;
select is((select string_agg((w ->> 'uscita') || ':' || (w ->> 'lineCount'), ',') from jsonb_array_elements(pg_temp.j('b2') -> 'waiting') w)
          || ' ' || (pg_temp.j('b2') ->> 'waitingCount') || ' ' || (select count(*) from pg_temp.tk('b2', 1, 2)),
  '2:3 3 0', 'a dish added to the 2nd while it waits joins the folded 2nd, and no 2nd ticket exists yet');

-- 6-7: another table sends, then the founder's 2nd is called.
select pg_temp.draft(6, 2, 1, 1);
select count(*) from (select pg_temp.run('send2', pg_temp.fire(2, array[6]))) x;
select count(*) from (select pg_temp.run('call', pg_temp.call(1, 2)))x;
select count(*) from (select pg_temp.board('b3')) x;
select is((select count(*) || ' ' || min(t ->> 'lineCount') || ' ' || min(t ->> 'firedAt') || ' ' || min(t ->> 'calledAt') || ' ' || min(t ->> 'addition')
             from pg_temp.tk('b3', 1, 2) t) || ' ' || (pg_temp.j('b3') -> 'waiting')::text,
  '1 3 ' || pg_temp.called(1, 2) || ' ' || pg_temp.called(1, 2) || ' false []',
  'after the call the 2nd is one ticket of 3 lines with firedAt = calledAt = the call instant, and nothing waits');
select is((select string_agg(right(t ->> 'sessionId', 1) || ':' || (t ->> 'uscita'), ',' order by o) from jsonb_array_elements(pg_temp.j('b3') -> 'tickets') with ordinality x(t, o)),
  '1:1,2:1,1:2', 'tickets are ordered by instant: the called 2nd comes after a table sent earlier');

-- 8: a dish fired into the 2nd after its call is an addition.
select pg_temp.draft(7, 1, 3, 2);
select count(*) from (select pg_temp.run('late', pg_temp.fire(1, array[7]))) x;
select count(*) from (select pg_temp.board('b4')) x;
select is((select string_agg((t ->> 'lineCount') || ':' || (t ->> 'addition') || ':' || (t ->> 'firedAt') || ':' || (t ->> 'calledAt'), ' ') from pg_temp.tk('b4', 1, 2) t),
  '3:false:' || pg_temp.called(1, 2) || ':' || pg_temp.called(1, 2) || ' 1:true:' || pg_temp.fired(7) || ':' || pg_temp.called(1, 2),
  'one added after the call is a second 2nd ticket at its own fired_at with addition: true (AT3)');

-- 9-11: a drink, the counters, and a voided held line.
select pg_temp.draft(8, 1, 4, 0);
select count(*) from (select pg_temp.run('drink', pg_temp.fire(1, array[8]))) x;
select pg_temp.draft(9, 2, 3, 3);
select count(*) from (select pg_temp.run('send3', pg_temp.fire(2, array[9]))) x;
select count(*) from (select pg_temp.board('b5')) x;
select is((select string_agg((t ->> 'uscita') || ':' || (t ->> 'addition') || ':' || coalesce(t ->> 'calledAt', 'null') || ':' || (t -> 'lines' -> 0 ->> 'course'), ' ') from pg_temp.tk('b5', 1, 0) t),
  '0:false:null:bevande', 'a drink ticket has uscita 0, no calledAt and is never an addition');
select is((pg_temp.j('b5') ->> 'remaining') || ' ' || (pg_temp.j('b5') ->> 'waitingCount') || ' '
          || (select string_agg(right(w ->> 'sessionId', 1) || ':' || (w ->> 'uscita'), ',') from jsonb_array_elements(pg_temp.j('b5') -> 'waiting') w),
  '8 1 2:3', 'remaining counts the eight lines in the kitchen; the held 3rd of table 2 waits');
select count(*) from (select pg_temp.run('void', 'select public.void_line(' || quote_literal(pg_temp.l(9)) || '::uuid, ''{"reason": "not_prepared", "clientUpdatedAt": "1998-10-24T19:30:00Z"}''::jsonb)')) x;
select count(*) from (select pg_temp.board('b6')) x;
select is((pg_temp.j('b6') -> 'waiting')::text || ' ' || (pg_temp.j('b6') ->> 'waitingCount') || ' ' || (pg_temp.j('b6') ->> 'remaining')
          || ' ' || (select count(*) from pg_temp.tk('b6', 2, 3)) || ' ' || (pg_temp.j('void') ->> 'changed'),
  '[] 0 8 0 true', 'a voided held line leaves waiting and becomes no ticket');

-- 12-16 (AT7): the open-session remap. Table 3 was sent before M6: one send of an antipasto and a primo (two legacy tickets, both closed),
-- and a later secondo whose legacy ticket was closed and reopened.
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, uscita, segue, unit_price, vat_rate, price_source, client_updated_at,
                               fired_at, fired_by, created_by, updated_by)
  select pg_temp.l(v.n), '11111111-1111-4111-8111-111111111111', pg_temp.s(3), ('11000000-0000-4000-8000-00000000000' || v.i)::uuid, v.c::public.course, 1, 1, false, 10, 10, 'menu',
         '1998-10-24 19:00+00', now() - v.ago, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'
    from (values (20, 1, 'antipasti', interval '3 seconds'), (21, 2, 'primi', interval '3 seconds'), (22, 3, 'secondi', interval '2 seconds')) v(n, i, c, ago);
insert into public.kitchen_event (tenant_id, subject, action, cause, table_session_id, fired_at, course, segue, created_at, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'ticket', 'closed', 'tap', pg_temp.s(3), now() - interval '3 seconds', 'antipasti', false, now() - interval '2500 milliseconds', 'c1000000-0000-4000-8000-00000000000c'),
  ('11111111-1111-4111-8111-111111111111', 'ticket', 'closed', 'auto', pg_temp.s(3), now() - interval '3 seconds', 'primi', false, now() - interval '2200 milliseconds', 'c1000000-0000-4000-8000-00000000000c'),
  ('11111111-1111-4111-8111-111111111111', 'ticket', 'closed', 'tap', pg_temp.s(3), now() - interval '2 seconds', 'secondi', false, now() - interval '1500 milliseconds', 'c1000000-0000-4000-8000-00000000000c'),
  ('11111111-1111-4111-8111-111111111111', 'ticket', 'reopened', 'tap', pg_temp.s(3), now() - interval '2 seconds', 'secondi', false, now() - interval '1 second', 'c1000000-0000-4000-8000-00000000000c');
create temp table legacy as select md5(string_agg(to_jsonb(e)::text, ',' order by e.seq)) as h from public.kitchen_event e;
insert into res select 'remap', app.uscite_kitchen_remap_open_sessions();
select is(pg_temp.j('remap')::text, '{"tickets": 1}', 'the remap appends one uscita close: the key whose legacy tickets are all closed');
select is((select string_agg(action || ' ' || cause || ' ' || pg_temp.us(fired_at) || ' ' || uscita || ' ' || coalesce(course::text, 'null') || ' ' || coalesce(segue::text, 'null')
                           || ' ' || (created_at = now() - interval '2200 milliseconds')::text || ' ' || created_by, ';')
             from public.kitchen_event where uscita is not null),
  'closed auto ' || pg_temp.us(now() - interval '3 seconds') || ' 1 null null true c1000000-0000-4000-8000-00000000000c',
  'it is closed under the new key with the cause, created_at and created_by of the latest legacy close');
insert into res select 'remap2', app.uscite_kitchen_remap_open_sessions();
select is(pg_temp.j('remap2')::text || ' ' || (select count(*) from public.kitchen_event where uscita is not null), '{"tickets": 0} 1', 'a second run appends nothing');
select is((select md5(string_agg(to_jsonb(e)::text, ',' order by e.seq)) from public.kitchen_event e where e.uscita is null), (select h from legacy),
  'legacy events are unchanged (none updated, none added)');
select count(*) from (select pg_temp.board('b7')) x;
select is((select string_agg((t ->> 'firedAt') || ':' || (t ->> 'autoClosed') || ':' || (t ->> 'lineCount'), ' ') from jsonb_array_elements(pg_temp.j('b7') -> 'closedTickets') t)
          || ' / ' || (select string_agg((t ->> 'firedAt') || ':' || (t ->> 'lineCount'), ' ') from pg_temp.tk('b7', 3, 1) t),
  pg_temp.us(now() - interval '3 seconds') || ':true:2 / ' || pg_temp.us(now() - interval '2 seconds') || ':1',
  'the board shows table 3''s first send as one closed ticket and its reopened secondo as an active one');

-- 17-18: no euro key (059's chef regex), and B's board holds nothing of A's (X).
select is((select count(*)::int from pg_temp.all_keys(pg_temp.j('b7')) k where k ~* '(cost|margin|price|prezz|gp_pct|_eur$|amount|total|importo)'), 0,
  'no key of the board matches 059''s chef regex');
select count(*) from (select pg_temp.board('bb', 'chefb')) x;
select is((pg_temp.j('bb') - 'asOf')::text, '{"tickets": [], "waiting": [], "remaining": 0, "truncated": false, "waitingCount": 0, "closedTickets": []}',
  'B''s chef sees an empty board: nothing of A''s (X)');

-- 19-20: the event shape and the index.
select is(pg_temp.try($q$insert into public.kitchen_event (tenant_id, subject, action, cause, table_session_id, fired_at, uscita, created_by)
                         values ('11111111-1111-4111-8111-111111111111', 'ticket', 'closed', 'tap', pg_temp.s(1), now(), 10, 'c1000000-0000-4000-8000-00000000000c')$q$)
          || ' ' || pg_temp.try($q$insert into public.kitchen_event (tenant_id, subject, action, cause, table_session_id, fired_at, uscita, course, created_by)
                         values ('11111111-1111-4111-8111-111111111111', 'ticket', 'closed', 'tap', pg_temp.s(1), now(), 2, 'secondi', 'c1000000-0000-4000-8000-00000000000c')$q$)
          || ' ' || pg_temp.try($q$insert into public.kitchen_event (tenant_id, subject, action, cause, order_line_id, uscita, created_by)
                         values ('11111111-1111-4111-8111-111111111111', 'line', 'done', 'tap', pg_temp.l(1), 1, 'c1000000-0000-4000-8000-00000000000c')$q$),
  '23514 23514 23514', 'kitchen_event refuses uscita 10, an uscita ticket with a course, and a line event with an uscita');
select is((select indexdef from pg_indexes where indexname = 'kitchen_event_uscita_ticket_idx'),
  'CREATE INDEX kitchen_event_uscita_ticket_idx ON public.kitchen_event USING btree (tenant_id, table_session_id, fired_at, uscita, seq DESC) WHERE ((subject = ''ticket''::text) AND (uscita IS NOT NULL))',
  'the uscita ticket index exists');

-- 21-22: the helpers.
select is((select k.session_id || ' ' || pg_temp.us(k.fired_at) || ' ' || k.uscita
             from app.kitchen_ticket_key(jsonb_build_object('sessionId', pg_temp.s(1), 'firedAt', pg_temp.called(1, 2), 'uscita', 2)) k)
          || ' ' || pg_temp.try($q$select app.kitchen_ticket_key(jsonb_build_object('sessionId', pg_temp.s(1), 'firedAt', pg_temp.called(1, 2), 'uscita', '2'))$q$)
          || ' ' || pg_temp.try($q$select app.kitchen_ticket_key(jsonb_build_object('sessionId', pg_temp.s(1), 'firedAt', pg_temp.called(1, 2), 'course', 'secondi', 'segue', true))$q$),
  pg_temp.s(1) || ' ' || pg_temp.called(1, 2) || ' 2 22023 22023', 'kitchen_ticket_key parses {sessionId, firedAt, uscita}; "2" or the legacy key -> 22023');
select is((select string_agg(coalesce(pg_temp.us(app.line_ticket_at(l.tenant_id, l)), 'null'), ' ' order by l.id) from public.order_line l where l.id in (pg_temp.l(1), pg_temp.l(3), pg_temp.l(7), pg_temp.l(9))),
  pg_temp.fired(1) || ' ' || pg_temp.called(1, 2) || ' ' || pg_temp.fired(7) || ' null',
  'line_ticket_at: fired_at for the 1st, the call for a 2nd line sent before it, its own fired_at after it, null for an uncalled uscita');

select * from finish();
rollback;
