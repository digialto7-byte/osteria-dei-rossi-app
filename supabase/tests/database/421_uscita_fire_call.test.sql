-- Comanda per uscita, step 5 (docs/plans/2026-11-18-comanda-uscite.md sections 3.5, 3.6; migration 20261206220200_uscita_fire_call.sql): M3, one
-- send and the call. fire_course takes an optional boolean hold: every line it names is fired, depleted and costed exactly as today (depletion
-- at send, plan 3.2 A); without hold it also records a 'fire_now' call for every uscita >= 2 it fired (what "Invia a seguire" meant for an old
-- bundle). The reply gains held. public.call_uscita records "Via la n" once: same caller again -> changed false; another caller -> conflict
-- already_called; nothing held -> conflict nothing_waiting. Fake data only (the founder's example: 1st Bruschetta + Tagliatelle, 2nd two Spezzatino).
begin;
set local timezone = 'UTC';
create extension if not exists pgtap with schema extensions;
select plan(27);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('e0000000-0000-4000-8000-00000000000e', 'waiter-a2@example.test'),
  ('b3000000-0000-4000-8000-0000000000d3', 'waiter-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('e1000000-0000-4000-8000-00000000000e', '11111111-1111-4111-8111-111111111111', 'e0000000-0000-4000-8000-00000000000e', 'waiter', 'Cameriere Due Demo'),
  ('b3100000-0000-4000-8000-0000000000d3', '22222222-2222-4222-8222-222222222222', 'b3000000-0000-4000-8000-0000000000d3', 'waiter', 'Cameriere B Demo');
insert into public.location (id, tenant_id, name) values ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)');
-- The stew: a batch recipe (10 portions) and the plate that takes one portion of it.
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'spezzatino (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e2', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'spezzatino con polenta (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch, shelf_life_hours, created_by) values
  ('ed000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e1', 1, now() - interval '5 days', 'Spezzatino (demo)', 2, 'kg', 10, 48, 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by) values
  ('ed000000-0000-4000-8000-0000000000d2', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e2', 1, now() - interval '5 days', 'Spezzatino con polenta (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe_line (tenant_id, recipe_id, position, sub_recipe_key, qty, unit, yield_factor, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d2', 1, 'ec000000-0000-4000-8000-0000000000e1', 1, 'porz', 1, 'a1000000-0000-4000-8000-00000000000a');
insert into public.menu_item (id, tenant_id, name, category, course_default, recipe_key, is_available, is_active, created_by, updated_by) values
  ('11000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Bruschetta (demo)', 'Antipasti', 'antipasti', null, true, true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Tagliatelle (demo)', 'Primi', 'primi', null, true, true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Spezzatino con polenta (demo)', 'Secondi', 'secondi', 'ec000000-0000-4000-8000-0000000000e2', true, true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'Acqua (demo)', 'Bevande', 'bevande', null, true, true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.menu_item_price (tenant_id, menu_item_id, price, vat_rate, valid_from, created_by)
  select '11111111-1111-4111-8111-111111111111', id, 10, 10, now() - interval '1 day', 'a1000000-0000-4000-8000-00000000000a' from public.menu_item;
insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code, lot_seq, produced_at, produced_by,
                          output_qty, output_unit, portions_computed, portions_initial, shelf_life_hours, use_by, state, location_id, created_by)
  values ('ba000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e1', 'ed000000-0000-4000-8000-0000000000d1', 1,
          '981023-SPE-1', '1998-10-23', 'SPE', 1, now() - interval '2 hours', 'a1000000-0000-4000-8000-00000000000a', 2, 'kg', 20, 20, 48, now() + interval '46 hours',
          'fresh', '10000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-00000000000a');
insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', 'ba000000-0000-4000-8000-000000000001', 'produce', 20, 'batch', 'ba000000-0000-4000-8000-000000000001', '1998-10-23',
          'a1000000-0000-4000-8000-00000000000a');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by)
  select ('13000000-0000-4000-8000-00000000000' || n)::uuid, '11111111-1111-4111-8111-111111111111', 'Tavolo ' || n || ' (demo)', n,
         'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a' from generate_series(1, 3) n;
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('13000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Tavolo B (demo)', 1, 'b3100000-0000-4000-8000-0000000000d3', 'b3100000-0000-4000-8000-0000000000d3');
-- S1 the founder's table, S2 the comparison (sent without hold), S3 closed; SB of tenant B.
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, created_by, updated_by)
  select ('14000000-0000-4000-8000-00000000000' || n)::uuid, '11111111-1111-4111-8111-111111111111', ('13000000-0000-4000-8000-00000000000' || n)::uuid,
         'Tavolo ' || n || ' (demo)', 2, 'd1000000-0000-4000-8000-00000000000d', '1998-10-24', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'
    from generate_series(1, 3) n;
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, created_by, updated_by) values
  ('14000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', '13000000-0000-4000-8000-0000000000b1', 'Tavolo B (demo)', 2,
   'b3100000-0000-4000-8000-0000000000d3', '1998-10-24', 'b3100000-0000-4000-8000-0000000000d3', 'b3100000-0000-4000-8000-0000000000d3');
update public.table_session set closed_at = now(), closed_by = 'd1000000-0000-4000-8000-00000000000d', closed_business_date = '1998-10-24',
  receipt_type = 'scontrino', receipt_number = '0001-0001', payment_type = 'card', total = 0 where id = '14000000-0000-4000-8000-000000000003';

-- A draft line n of session s, item i, uscita u (as the table owner: the entry path is pgTAP 420's).
create function pg_temp.draft(p_n int, p_s int, p_i int, p_u int) returns void language sql as $$
  insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, uscita, segue, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by)
  select ('e1000000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid, '11111111-1111-4111-8111-111111111111',
         ('14000000-0000-4000-8000-00000000000' || p_s)::uuid, m.id, m.course_default, 1, p_u, p_u >= 2, 10, 10, 'menu', now() - interval '1 hour',
         'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'
    from public.menu_item m where m.id = ('11000000-0000-4000-8000-00000000000' || p_i)::uuid $$;
create function pg_temp.l(p_n int) returns uuid language sql as $$ select ('e1000000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid $$;
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
    when 'waiter2' then perform pg_temp.as_role('e0000000-0000-4000-8000-00000000000e', '11111111-1111-4111-8111-111111111111', 'waiter');
    when 'chef' then perform pg_temp.as_role('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
    when 'waiterb' then perform pg_temp.as_role('b3000000-0000-4000-8000-0000000000d3', '22222222-2222-4222-8222-222222222222', 'waiter');
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
create function pg_temp.fire(p_s int, p_lines int[], p_hold text) returns text language sql as $$
  select 'select public.fire_course(''14000000-0000-4000-8000-00000000000' || p_s || ''', jsonb_build_object(''lineIds'', to_jsonb(array['
         || array_to_string(array(select quote_literal(pg_temp.l(n)) || '::uuid' from unnest(p_lines) n), ',') || '])'
         || coalesce(', ''hold'', ' || p_hold, '') || '))' $$;
create function pg_temp.call(p_s int, p_body text) returns text language sql as $$
  select 'select public.call_uscita(''14000000-0000-4000-8000-00000000000' || p_s || ''', ''' || p_body || '''::jsonb)' $$;
create function pg_temp.ids(p jsonb) returns uuid[] language sql as $$ select coalesce(array(select e::uuid from jsonb_array_elements_text(p) e order by 1), '{}') $$;

-- The founder's send: 1st Bruschetta + Tagliatelle, 2nd two Spezzatino; one "Invia comanda" with hold.
select pg_temp.draft(1, 1, 1, 1), pg_temp.draft(2, 1, 2, 1), pg_temp.draft(3, 1, 3, 2), pg_temp.draft(4, 1, 3, 2);
-- 1-4
select count(*) from (select pg_temp.run('send', pg_temp.fire(1, array[1, 2, 3, 4], 'true'))) x;
select is(jsonb_array_length(pg_temp.j('send') -> 'fired')
          || ' ' || (select count(*) from public.order_line_cost c where c.order_line_id in (pg_temp.l(1), pg_temp.l(2), pg_temp.l(3), pg_temp.l(4)))
          || ' ' || (pg_temp.ids(pg_temp.j('send') -> 'held') = array[pg_temp.l(3), pg_temp.l(4)])::text,
  '4 4 true', 'a fire of the founder''s four lines with hold: true fires and depletes all four, freezes four cost rows, and held = the two secondi');
select is((select count(*)::int from public.uscita_call where table_session_id = '14000000-0000-4000-8000-000000000001'), 0, 'and writes no call row');
select is((select string_agg(trim_scale(-m.portions)::text, ',' order by m.ref_id) from public.batch_movement m where m.type = 'consume'
             and m.ref_id in (pg_temp.l(3), pg_temp.l(4))), '1,1', 'the held secondi are depleted at the send (one consume each)');
select is((select count(*)::int from public.order_line where id in (pg_temp.l(1), pg_temp.l(2), pg_temp.l(3), pg_temp.l(4)) and state = 'fired'), 4, 'all four are fired');

-- 5-7: without hold (every old bundle): fire and call, exactly as "Invia a seguire" did.
select pg_temp.draft(5, 2, 3, 2), pg_temp.draft(6, 2, 3, 2);
select is(pg_temp.run('old', pg_temp.fire(2, array[5, 6], null)) || ' ' || (pg_temp.j('old') -> 'held')::text, 'ok []', 'with hold absent the same fire answers held = []');
select is((select string_agg(uscita || ':' || cause || ':' || (called_by = 'd1000000-0000-4000-8000-00000000000d')::text, ',') from public.uscita_call
             where table_session_id = '14000000-0000-4000-8000-000000000002'), '2:fire_now:true', 'and inserts one uscita_call (2, fire_now) by the sender');
select is((select array_agg(c.unit_cost_at_sale || '/' || c.incomplete order by c.order_line_id) from public.order_line_cost c where c.order_line_id in (pg_temp.l(3), pg_temp.l(5))),
  (select array_agg(c.unit_cost_at_sale || '/' || c.incomplete order by c.order_line_id) from public.order_line_cost c where c.order_line_id in (pg_temp.l(5), pg_temp.l(3))),
  'freeze_line_cost of a held line equals that of an unheld fire of the same dish (depletion at send)');

-- 8-12: more sends on the founder's table.
select is(pg_temp.run('bad', pg_temp.fire(1, array[1], '''"yes"''::jsonb')), '22023 invalid_request', 'hold: "yes" -> 22023');
select pg_temp.draft(7, 1, 4, 0);
select is(pg_temp.run('drink', pg_temp.fire(1, array[7], 'true')) || ' ' || (pg_temp.j('drink') -> 'held')::text, 'ok []', 'a drink with hold: true is never held (AT4)');
select pg_temp.draft(8, 1, 1, 1);
select is(pg_temp.run('add1', pg_temp.fire(1, array[8], 'true')) || ' ' || (pg_temp.j('add1') -> 'held')::text, 'ok []', 'a line added to uscita 1 after the send fires unheld (AT3)');
select pg_temp.draft(9, 1, 3, 2);
select is(pg_temp.run('add2', pg_temp.fire(1, array[9], 'true')) || ' ' || (pg_temp.ids(pg_temp.j('add2') -> 'held') = array[pg_temp.l(9)])::text, 'ok true',
  'a line added to the waiting 2nd is held');
select is(pg_temp.run('again', pg_temp.fire(1, array[3], 'true')) || ' ' || (pg_temp.j('again') -> 'held')::text || ' ' || (pg_temp.j('again') -> 'skipped' -> 0 ->> 'reason'),
  'ok [] already_fired', 'a line sent again is skipped and the reply still carries held');

-- 13-19: the call.
select is(pg_temp.run('call', pg_temp.call(1, '{"uscita": 2}')) || ' ' || (pg_temp.j('call') ->> 'changed') || ' ' || (pg_temp.j('call') -> 'call' ->> 'uscita')
          || ' ' || (pg_temp.j('call') -> 'call' -> 'calledBy' ->> 'displayName')
          || ' ' || (select pg_temp.ids(jsonb_path_query_array(pg_temp.j('call') -> 'lines', '$[*].id')) = array[pg_temp.l(3), pg_temp.l(4), pg_temp.l(9)])::text,
  'ok true 2 Cameriere Demo true', 'call_uscita(2) -> changed: true, and the reply lines are the 2nd''s');
select is((select count(*)::int || ':' || min(cause) from public.uscita_call where table_session_id = '14000000-0000-4000-8000-000000000001'), '1:call', 'one row, cause call');
select is((select count(*)::int from app.held_lines('11111111-1111-4111-8111-111111111111', '14000000-0000-4000-8000-000000000001', 2::smallint)), 0, 'nothing of the 2nd is held any more');
select is(pg_temp.run('call2', pg_temp.call(1, '{"uscita": 2}')) || ' ' || (pg_temp.j('call2') ->> 'changed')
          || ' ' || (pg_temp.j('call2') -> 'call' ->> 'calledAt' = pg_temp.j('call') -> 'call' ->> 'calledAt')::text, 'ok false true',
  'the same user again -> changed: false with the stored call');
select is(pg_temp.run('call3', pg_temp.call(1, '{"uscita": 2}'), 'waiter2') || ' ' || (pg_temp.j('call3') -> 'conflict' ->> 'reason')
          || ' ' || (pg_temp.j('call3') -> 'conflict' ->> 'uscita') || ' ' || (pg_temp.j('call3') -> 'conflict' ->> 'calledAt' = pg_temp.j('call') -> 'call' ->> 'calledAt')::text,
  'ok already_called 2 true', 'another waiter -> conflict already_called with calledAt (AT2)');
select is((select count(*)::int from public.uscita_call where table_session_id = '14000000-0000-4000-8000-000000000001'), 1, 'and still one row');
select pg_temp.draft(10, 1, 3, 2);
select is(pg_temp.run('late', pg_temp.fire(1, array[10], 'true')) || ' ' || (pg_temp.j('late') -> 'held')::text, 'ok []',
  'a dish fired into the 2nd after its call is not held (an addition)');

-- 20-24: refusals.
select is(pg_temp.run('u1', pg_temp.call(1, '{"uscita": 1}')) || ' / ' || pg_temp.run('u10', pg_temp.call(1, '{"uscita": 10}'))
          || ' / ' || pg_temp.run('us', pg_temp.call(1, '{"uscita": "3"}')) || ' / ' || pg_temp.run('ux', pg_temp.call(1, '{"uscita": 3, "x": 1}')),
  '22023 invalid_request / 22023 invalid_request / 22023 invalid_request / 22023 invalid_request', 'uscita 1, 10, "3" or an extra key -> 22023');
select pg_temp.draft(11, 1, 3, 3);
select count(*) from (select pg_temp.run('send3', pg_temp.fire(1, array[11], 'true'))) x;
update public.order_line set voided_at = now(), voided_by = 'd1000000-0000-4000-8000-00000000000d', void_reason = 'comp' where id = pg_temp.l(11);
select count(*) from (select pg_temp.run('none', pg_temp.call(1, '{"uscita": 3}'))) x;
select is('ok ' || (pg_temp.j('none') -> 'conflict' ->> 'reason') || ' ' || (pg_temp.j('none') -> 'conflict' ->> 'uscita')
          || ' ' || (select count(*) from public.uscita_call where table_session_id = '14000000-0000-4000-8000-000000000001' and uscita = 3),
  'ok nothing_waiting 3 0', 'all held lines voided -> nothing_waiting, no row');
select is(pg_temp.run('closed', pg_temp.call(3, '{"uscita": 2}')), 'P0001 session_closed', 'closed session -> P0001 session_closed');
select is(left(pg_temp.run('chef', pg_temp.call(1, '{"uscita": 4}'), 'chef'), 5), '42501', 'the chef -> 42501 (until PR5)');
select is(pg_temp.run('xb', pg_temp.call(1, '{"uscita": 4}'), 'waiterb'), 'P0002 session_not_found', 'B''s waiter on A''s session -> P0002 (X)');

-- 25-27: grants and the reply shape.
select is((select array_agg(r.role order by r.role) from (values ('anon'), ('authenticated'), ('service_role')) r(role)
             where has_function_privilege(r.role, 'public.call_uscita(uuid, jsonb)', 'execute')), array['authenticated'], 'call_uscita: authenticated only');
select is((select prosecdef::text || ' ' || array_to_string(proconfig, ',') from pg_proc where oid = 'public.call_uscita(uuid, jsonb)'::regprocedure), 'true search_path=""',
  'call_uscita is a definer with an empty search_path');
select ok((select pg_temp.j('call')::text !~* 'cost' and pg_temp.j('call3')::text !~* 'cost'), 'no cost key in a call reply');

select * from finish();
rollback;
