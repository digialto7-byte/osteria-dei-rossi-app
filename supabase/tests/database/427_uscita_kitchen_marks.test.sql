-- Comanda per uscita, step 13 (docs/plans/2026-11-18-comanda-uscite.md section 3.9; migration 20261206220500_uscita_kitchen.sql): M6, the two
-- kitchen writes on the uscita key. kitchen_mark_line finds a line's ticket through app.line_ticket_at: a held line has none (P0001 line_held,
-- nothing written). Auto-close and auto-reopen write uscita ticket events (course and segue null). kitchen_set_ticket takes {sessionId,
-- firedAt, uscita, closed}; the legacy body (course, segue) is 22023. Last, the lead's PR 3 ask: no order_line writer updates a line of a closed
-- session, so the NOT VALID order_line_uscita_set_ck (enforced on every UPDATE) is never hit by an old null-uscita row. Fake data only.
begin;
set local timezone = 'UTC';
create extension if not exists pgtap with schema extensions;
select plan(14);

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
create function pg_temp.mark(p_n int, p_done boolean) returns text language sql as $$
  select 'select public.kitchen_mark_line(' || quote_literal(pg_temp.l(p_n)) || '::uuid, ''{"done": ' || p_done || '}''::jsonb)' $$;
create function pg_temp.set(p_body jsonb) returns text language sql as $$ select 'select public.kitchen_set_ticket(' || quote_literal(p_body::text) || '::jsonb)' $$;
create function pg_temp.fired(p_n int) returns text language sql as $$ select pg_temp.us(fired_at) from public.order_line where id = pg_temp.l(p_n) $$;
create function pg_temp.called(p_s int, p_u int) returns text language sql as $$
  select pg_temp.us(called_at) from public.uscita_call where table_session_id = pg_temp.s(p_s) and uscita = p_u $$;
-- The ticket events of (session s, instant, uscita u), oldest first: action/cause, and whether course and segue are null.
create function pg_temp.ev(p_s int, p_at text, p_u int) returns text language sql as $$
  select coalesce(string_agg(action || '/' || cause || '/' || (course is null and segue is null)::text, ',' order by seq), '')
    from public.kitchen_event where subject = 'ticket' and table_session_id = pg_temp.s(p_s) and pg_temp.us(fired_at) = p_at and uscita = p_u $$;
create function pg_temp.n_events() returns int language sql as $$ select count(*)::int from public.kitchen_event $$;

select pg_temp.draft(1, 1, 2, 1), pg_temp.draft(2, 1, 1, 1), pg_temp.draft(3, 1, 3, 2), pg_temp.draft(4, 1, 3, 2);
select count(*) from (select pg_temp.run('send', pg_temp.fire(1, array[1, 2, 3, 4]))) x;

-- 1-2: a held line has no ticket.
select is(pg_temp.run('held', pg_temp.mark(3, true), 'chef') || ' ' || pg_temp.n_events(), 'P0001 line_held 0', 'kitchen_mark_line on a held line -> P0001 line_held, no event');
select is(pg_temp.run('heldt', pg_temp.set(jsonb_build_object('sessionId', pg_temp.s(1), 'firedAt', pg_temp.fired(3), 'uscita', 2, 'closed', true)), 'chef') || ' ' || pg_temp.n_events(),
  'P0002 ticket_not_found 0', 'kitchen_set_ticket on an uncalled uscita -> P0002 ticket_not_found, no event');

-- 3-5: after the call, marking every line of the 2nd auto-closes it on the uscita key; undone reopens it.
select count(*) from (select pg_temp.run('call', pg_temp.call(1, 2))) x;
select count(*) from (select pg_temp.run('m3', pg_temp.mark(3, true), 'chef')) x;
select count(*) from (select pg_temp.run('m4', pg_temp.mark(4, true), 'chef')) x;
select is((pg_temp.j('m3') ->> 'changed') || ' ' || (pg_temp.j('m3') ->> 'autoClosed') || ' ' || (pg_temp.j('m4') ->> 'changed') || ' ' || (pg_temp.j('m4') ->> 'autoClosed')
          || ' ' || pg_temp.ev(1, pg_temp.called(1, 2), 2),
  'true false true true closed/auto/true', 'marking every line of the called 2nd auto-closes it on (session, call instant, 2), course and segue null');
select is((select string_agg(t ->> 'key', ',') from jsonb_array_elements(pg_temp.j('m4') -> 'board' -> 'closedTickets') t),
  pg_temp.s(1) || '|' || pg_temp.called(1, 2) || '|u2', 'the reply board lists the 2nd under closedTickets');
select count(*) from (select pg_temp.run('u4', pg_temp.mark(4, false), 'chef')) x;
select is((pg_temp.j('u4') ->> 'reopened') || ' ' || pg_temp.ev(1, pg_temp.called(1, 2), 2), 'true closed/auto/true,reopened/auto/true', 'undone reopens it');

-- 6-8: kitchen_set_ticket by hand, and the legacy body.
select is(pg_temp.run('c1', pg_temp.set(jsonb_build_object('sessionId', pg_temp.s(1), 'firedAt', pg_temp.called(1, 2), 'uscita', 2, 'closed', true)), 'chef')
          || ' ' || (pg_temp.j('c1') ->> 'changed')
          || ' ' || pg_temp.run('c2', pg_temp.set(jsonb_build_object('sessionId', pg_temp.s(1), 'firedAt', pg_temp.called(1, 2), 'uscita', 2, 'closed', true)), 'chef')
          || ' ' || (pg_temp.j('c2') ->> 'changed'),
  'ok true ok false', 'kitchen_set_ticket {sessionId, firedAt, uscita, closed: true} closes; again -> changed: false');
select is(pg_temp.run('c3', pg_temp.set(jsonb_build_object('sessionId', pg_temp.s(1), 'firedAt', pg_temp.called(1, 2), 'uscita', 2, 'closed', false)), 'chef')
          || ' ' || (pg_temp.j('c3') ->> 'changed') || ' ' || pg_temp.ev(1, pg_temp.called(1, 2), 2),
  'ok true closed/auto/true,reopened/auto/true,closed/tap/true,reopened/tap/true', 'closed: false reopens it (cause tap)');
select is(pg_temp.run('l1', pg_temp.set(jsonb_build_object('sessionId', pg_temp.s(1), 'firedAt', pg_temp.fired(1), 'course', 'primi', 'segue', false, 'closed', true)), 'chef')
          || ' / ' || pg_temp.run('l2', pg_temp.set(jsonb_build_object('sessionId', pg_temp.s(1), 'firedAt', pg_temp.fired(1), 'closed', true)), 'chef')
          || ' / ' || pg_temp.run('l3', pg_temp.set(jsonb_build_object('sessionId', pg_temp.s(1), 'firedAt', pg_temp.fired(1), 'uscita', '1', 'closed', true)), 'chef')
          || ' / ' || pg_temp.run('l4', pg_temp.set(jsonb_build_object('sessionId', pg_temp.s(1), 'firedAt', pg_temp.fired(1), 'uscita', 1, 'course', 'primi', 'closed', true)), 'chef'),
  '22023 invalid_request / 22023 invalid_request / 22023 invalid_request / 22023 invalid_request',
  'the legacy body (course, segue), a missing uscita, uscita "1" or an extra course -> 22023');

-- 9-10: an addition is its own ticket; the 1st closes on its own key.
select pg_temp.draft(5, 1, 3, 2);
select count(*) from (select pg_temp.run('late', pg_temp.fire(1, array[5]))) x;
select count(*) from (select pg_temp.run('m5', pg_temp.mark(5, true), 'chef')) x;
select is((pg_temp.j('m5') ->> 'autoClosed') || ' ' || pg_temp.ev(1, pg_temp.fired(5), 2) || ' ' || (select closed::text from app.kitchen_ticket_state(
             '11111111-1111-4111-8111-111111111111', pg_temp.s(1), pg_temp.called(1, 2)::timestamptz, 2::smallint)),
  'true closed/auto/true false', 'the addition auto-closes on its own key; the first 2nd ticket stays open');
select count(*) from (select pg_temp.run('m1', pg_temp.mark(1, true), 'chef')) x;
select count(*) from (select pg_temp.run('m2', pg_temp.mark(2, true), 'chef')) x;
select is((pg_temp.j('m1') ->> 'autoClosed') || ' ' || (pg_temp.j('m2') ->> 'autoClosed') || ' ' || pg_temp.ev(1, pg_temp.fired(1), 1), 'false true closed/auto/true',
  'the 1st auto-closes on (session, fired_at, 1)');

-- 11: a voided line of an uncalled uscita is no mark target: changed false, nothing written.
select pg_temp.draft(6, 1, 3, 3);
select count(*) from (select pg_temp.run('send3', pg_temp.fire(1, array[6]))) x;
select count(*) from (select pg_temp.run('void', 'select public.void_line(' || quote_literal(pg_temp.l(6)) || '::uuid, ''{"reason": "not_prepared", "clientUpdatedAt": "1998-10-24T19:30:00Z"}''::jsonb)')) x;
create temp table n0 as select pg_temp.n_events() as n;
select is(pg_temp.run('mv', pg_temp.mark(6, true), 'chef') || ' ' || (pg_temp.j('mv') ->> 'changed') || ' ' || (pg_temp.n_events() - (select n from n0)),
  'ok false 0', 'marking a voided line of an uncalled uscita -> changed: false, no event');

-- 12-13: roles and tenants unchanged.
select is(pg_temp.run('w', pg_temp.mark(1, false)), '42501 permission denied: kitchen marks need owner, admin or chef', 'a waiter still cannot mark');
select is(pg_temp.run('xb', pg_temp.mark(1, false), 'chefb') || ' / '
          || pg_temp.run('xbt', pg_temp.set(jsonb_build_object('sessionId', pg_temp.s(1), 'firedAt', pg_temp.called(1, 2), 'uscita', 2, 'closed', true)), 'chefb'),
  'P0002 line_not_found / P0002 ticket_not_found', 'B''s chef cannot mark A''s line or close A''s ticket (X)');

-- 14 (lead, PR 3): every order_line writer refuses a closed session before its UPDATE, so a closed-session line from before uscite (uscita
-- null) never meets the NOT VALID order_line_uscita_set_ck. Built as the table owner: the check is dropped inside this transaction to insert
-- the two null-uscita lines, then put back NOT VALID as M5 left it, and the session is closed.
alter table public.order_line drop constraint order_line_uscita_set_ck;
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, uscita, segue, unit_price, vat_rate, price_source, client_updated_at,
                               fired_at, fired_by, created_by, updated_by)
  select pg_temp.l(v.n), '11111111-1111-4111-8111-111111111111', pg_temp.s(2), '11000000-0000-4000-8000-000000000002', 'primi', 1, null, false, 10, 10, 'menu',
         '1998-10-24 19:00+00', v.f, case when v.f is not null then 'd1000000-0000-4000-8000-00000000000d'::uuid end,
         'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'
    from (values (30, null::timestamptz), (31, now())) v(n, f);
alter table public.order_line add constraint order_line_uscita_set_ck check (uscita is not null) not valid;
update public.table_session set closed_at = now(), closed_by = 'd1000000-0000-4000-8000-00000000000d', closed_business_date = '1998-10-24',
  receipt_type = 'scontrino', receipt_number = '0001-0002', payment_type = 'card', total = 0 where id = pg_temp.s(2);
select is(pg_temp.run('cu', 'select public.update_order_line(' || quote_literal(pg_temp.l(30)) || '::uuid, ''{"clientUpdatedAt": "1998-10-24T19:30:00Z", "qty": 2}''::jsonb)')
          || ' ' || (pg_temp.j('cu') -> 'conflict' ->> 'reason')
          || ' / ' || pg_temp.run('cr', 'select public.remove_order_line(' || quote_literal(pg_temp.l(30)) || '::uuid, ''{"clientUpdatedAt": "1998-10-24T19:30:00Z"}''::jsonb)')
          || ' ' || (pg_temp.j('cr') -> 'conflict' ->> 'reason')
          || ' / ' || pg_temp.run('cv', 'select public.void_line(' || quote_literal(pg_temp.l(31)) || '::uuid, ''{"reason": "returned", "clientUpdatedAt": "1998-10-24T19:30:00Z"}''::jsonb)')
          || ' ' || (pg_temp.j('cv') -> 'conflict' ->> 'reason')
          || ' / ' || pg_temp.run('cf', pg_temp.fire(2, array[30]))
          || ' / ' || (select string_agg(coalesce(uscita::text, 'null') || ':' || state, ',' order by id) from public.order_line where id in (pg_temp.l(30), pg_temp.l(31))),
  'ok session_closed / ok session_closed / ok session_closed / P0001 session_closed / null:draft,null:fired',
  'update, remove, void and fire answer session_closed on a closed session''s null-uscita lines: no UPDATE, so no 23514');

select * from finish();
rollback;
