-- Comanda per uscita, step 17 (docs/plans/2026-11-18-comanda-uscite.md section 3.10; migration 20261206220600_uscita_tables_order_view.sql): M7, the
-- waiter reads. tables_list gives every session uscite = {cooking, waiting, cookingDone} (null when nothing of uscita >= 1 is sent):
-- cooking is the highest uscita in the kitchen, waiting the lowest held one, cookingDone every line of cooking done. unsentCount counts every
-- draft (a segue draft too: everything goes with the one send). order_view gains uscite = [{uscita, state, calledAt, lineCount}] for every
-- uscita >= 1 with sent, non-voided lines (state waiting, cooking or done). Fake data only (the founder's example).
begin;
set local timezone = 'UTC';
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('b3000000-0000-4000-8000-0000000000c3', 'chef-b@example.test'),
  ('b3000000-0000-4000-8000-0000000000d3', 'waiter-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('b3100000-0000-4000-8000-0000000000c3', '22222222-2222-4222-8222-222222222222', 'b3000000-0000-4000-8000-0000000000c3', 'chef', 'Chef B Demo'),
  ('b3100000-0000-4000-8000-0000000000d3', '22222222-2222-4222-8222-222222222222', 'b3000000-0000-4000-8000-0000000000d3', 'waiter', 'Cameriere B Demo');
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
-- S1, S2 and S3: three open tables of tenant A (each block below says what it puts on them).
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
    when 'waiterb' then perform pg_temp.as_role('b3000000-0000-4000-8000-0000000000d3', '22222222-2222-4222-8222-222222222222', 'waiter');
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

create function pg_temp.tile(p_nm text, p_s int) returns jsonb language sql as $$
  select t -> 'session' from jsonb_array_elements(pg_temp.j(p_nm) -> 'tables') t where t -> 'session' ->> 'id' = pg_temp.s(p_s)::text $$;
create function pg_temp.tables(p_nm text, p_who text default 'waiter') returns text language sql as $$ select pg_temp.run(p_nm, 'select public.tables_list()', p_who) $$;
create function pg_temp.ov(p_nm text, p_s int, p_who text default 'waiter') returns text language sql as $$
  select pg_temp.run(p_nm, 'select public.order_view(' || quote_literal(pg_temp.s(p_s)) || '::uuid)', p_who) $$;
create function pg_temp.mark(p_n int) returns text language sql as $$
  select pg_temp.run('m' || p_n, 'select public.kitchen_mark_line(' || quote_literal(pg_temp.l(p_n)) || '::uuid, ''{"done": true}''::jsonb)', 'chef') $$;
create function pg_temp.called(p_s int, p_u int) returns text language sql as $$
  select to_char(called_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') from public.uscita_call where table_session_id = pg_temp.s(p_s) and uscita = p_u $$;

-- The founder's send on table 1: 1st Tagliatelle + Bruschetta, 2nd two Spezzatino, held. Table 2 sends only a drink. Table 3 has a segue draft.
select pg_temp.draft(1, 1, 2, 1), pg_temp.draft(2, 1, 1, 1), pg_temp.draft(3, 1, 3, 2), pg_temp.draft(4, 1, 3, 2), pg_temp.draft(5, 2, 4, 0), pg_temp.draft(6, 3, 3, 2);
select count(*) from (select pg_temp.run('send', pg_temp.fire(1, array[1, 2, 3, 4]))) x;
select count(*) from (select pg_temp.run('drink', pg_temp.fire(2, array[5]))) x;

-- 1-4 (AT2): the tile.
select count(*) from (select pg_temp.tables('t1')) x;
select is((pg_temp.tile('t1', 1) -> 'uscite')::text, '{"cooking": 1, "waiting": 2, "cookingDone": false}',
  'after the founder''s send the tile has uscite = {cooking: 1, waiting: 2, cookingDone: false} (AT2)');
select is((pg_temp.tile('t1', 2) -> 'uscite')::text || ' ' || (pg_temp.tile('t1', 3) -> 'uscite')::text, 'null null',
  'a table with only drinks sent, and one with nothing sent, have uscite null');
select is((pg_temp.tile('t1', 3) ->> 'unsentCount') || ' ' || (pg_temp.tile('t1', 1) ->> 'unsentCount'), '1 0',
  'unsentCount counts a segue draft too (everything goes with the one send)');
select count(*) from (select pg_temp.mark(1)) x;
select count(*) from (select pg_temp.mark(2)) x;
select count(*) from (select pg_temp.tables('t2')) x;
select is((pg_temp.tile('t2', 1) -> 'uscite')::text, '{"cooking": 1, "waiting": 2, "cookingDone": true}', 'with both 1st lines done, cookingDone is true');

-- 5-8: order_view.
select count(*) from (select pg_temp.ov('o1', 1)) x;
select is((pg_temp.j('o1') -> 'uscite')::text,
  '[{"state": "done", "uscita": 1, "calledAt": null, "lineCount": 2}, {"state": "waiting", "uscita": 2, "calledAt": null, "lineCount": 2}]',
  'order_view.uscite: the 1st done (both lines marked), the 2nd waiting; drinks and drafts are not in it');
select count(*) from (select pg_temp.run('call', pg_temp.call(1, 2))) x;
select count(*) from (select pg_temp.tables('t3')) x;
select count(*) from (select pg_temp.ov('o2', 1)) x;
select is((pg_temp.tile('t3', 1) -> 'uscite')::text || ' / ' || (pg_temp.j('o2') -> 'uscite' -> 1)::text,
  '{"cooking": 2, "waiting": null, "cookingDone": false} / {"state": "cooking", "uscita": 2, "calledAt": "' || pg_temp.called(1, 2) || '", "lineCount": 2}',
  'after the call: the tile has {cooking: 2, waiting: null}, and the 2nd is cooking with its calledAt');
select count(*) from (select pg_temp.mark(3)) x;
select count(*) from (select pg_temp.mark(4)) x;
select count(*) from (select pg_temp.ov('o3', 1)) x;
select count(*) from (select pg_temp.tables('t4')) x;
select is((select string_agg(u ->> 'state', ',') from jsonb_array_elements(pg_temp.j('o3') -> 'uscite') u) || ' / ' || (pg_temp.tile('t4', 1) -> 'uscite')::text,
  'done,done / {"cooking": 2, "waiting": null, "cookingDone": true}', 'every line marked: both uscite done, and cookingDone on the tile');
select count(*) from (select pg_temp.ov('o4', 2)) x;
select is((pg_temp.j('o4') -> 'uscite')::text, '[]', 'a session with only drinks sent has uscite []');

-- 9-10: no cost key on the new objects (059's chef regex is about the chef; here the waiter's payloads: still no euro key in them).
select is((select string_agg(k, ',' order by k collate "C") from jsonb_object_keys(pg_temp.tile('t1', 1) -> 'uscite') k)
          || ' / ' || (select string_agg(k, ',' order by k collate "C") from jsonb_object_keys(pg_temp.j('o1') -> 'uscite' -> 0) k),
  'cooking,cookingDone,waiting / calledAt,lineCount,state,uscita', 'the new objects carry exactly their documented keys');
select is((select count(*)::int from jsonb_array_elements(pg_temp.j('o1') -> 'uscite') u, jsonb_object_keys(u) k
            where k ~* '(cost|margin|price|prezz|gp_pct|_eur$|amount|total|importo)'), 0, 'no key of order_view.uscite matches the cost regex');

-- 11-12: X. B's waiter sees no session of A's on the tiles and cannot read A's order.
select count(*) from (select pg_temp.tables('tb', 'waiterb')) x;
select is((select count(*)::int from jsonb_array_elements(pg_temp.j('tb') -> 'tables') t where t ->> 'id' like '13000000-%'), 0, 'X: B''s tiles hold none of A''s tables');
select is(pg_temp.ov('ob', 1, 'waiterb'), 'P0002 session_not_found', 'X: order_view of A''s session as B''s waiter is P0002 session_not_found');

-- 13: the helper is closed to the API roles (as app.session_unsent_lines in pgTAP 367).
reset role;
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r
            where has_function_privilege(r, 'app.session_uscite(uuid, uuid[])', 'execute')), 0, 'no API role can execute app.session_uscite');

select * from finish();
rollback;
