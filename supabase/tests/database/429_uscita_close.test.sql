-- Comanda per uscita, step 18 (docs/plans/2026-11-18-comanda-uscite.md section 3.11; migration 20261206220700_uscita_close.sql): M8, the close
-- guard. A table cannot be closed while an uscita is still waiting: app.close_session_at refuses held, non-voided lines with P0001
-- uscita_waiting and detail {lineIds} (at most 50, by created_at and id), after the unsent_lines refusal, and writes nothing. Once the uscita is
-- called, or its dishes voided not_prepared, the table closes as before. Fake data only (the founder's example).
begin;
set local timezone = 'UTC';
create extension if not exists pgtap with schema extensions;
select plan(7);

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
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('13000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'Tavolo 4 (demo)', 4, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, created_by, updated_by) values
  (pg_temp.s(4), '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000004', 'Tavolo 4 (demo)', 2, 'd1000000-0000-4000-8000-00000000000d', '1998-10-24',
   'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d');
-- The close body of session s: the session's own bill token.
create function pg_temp.body(p_s int) returns jsonb language sql as $$
  select jsonb_build_object('receiptType', 'scontrino', 'receiptNumber', '0012-0034', 'paymentType', 'card',
    'billToken', app.session_bill_json('11111111-1111-4111-8111-111111111111', pg_temp.s(p_s), null) ->> 'billToken') $$;
create function pg_temp.close(p_s int) returns text language sql as $$
  select 'select public.close_table(' || quote_literal(pg_temp.s(p_s)) || '::uuid, ' || quote_literal(pg_temp.body(p_s)::text) || '::jsonb)' $$;
-- A close as waiter A: 'ok' or "SQLSTATE message|detail".
create function pg_temp.closed(p_s int) returns text language plpgsql as $$
declare
  state text;
  msg text;
  det text;
  stmt text := pg_temp.close(p_s);
begin
  perform pg_temp.as_role('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
  set local role authenticated;
  begin
    execute stmt;
  exception when others then
    reset role;
    get stacked diagnostics state = returned_sqlstate, msg = message_text, det = pg_exception_detail;
    return state || ' ' || msg || '|' || coalesce(det, '');
  end;
  reset role;
  return 'ok';
end
$$;
create function pg_temp.total(p_s int) returns text language sql as $$
  select app.session_bill_json('11111111-1111-4111-8111-111111111111', pg_temp.s(p_s), null) ->> 'total' $$;
create function pg_temp.state(p_s int) returns text language sql as $$
  select (closed_at is not null)::text || ':' || coalesce(total::text, 'null') from public.table_session where id = pg_temp.s(p_s) $$;

-- Table 1: the founder's send (1st Tagliatelle + Bruschetta, 2nd two Spezzatino, held). Table 2: the same four dishes sent all at once (an
-- old send: the 2nd is called at once). Table 3: a 1st and a held 2nd whose dishes are then voided not_prepared. Table 4: a held 2nd and a draft.
select pg_temp.draft(1, 1, 2, 1), pg_temp.draft(2, 1, 1, 1), pg_temp.draft(3, 1, 3, 2), pg_temp.draft(4, 1, 3, 2);
select pg_temp.draft(11, 2, 2, 1), pg_temp.draft(12, 2, 1, 1), pg_temp.draft(13, 2, 3, 2), pg_temp.draft(14, 2, 3, 2);
select pg_temp.draft(21, 3, 2, 1), pg_temp.draft(23, 3, 3, 2), pg_temp.draft(24, 3, 3, 2);
select pg_temp.draft(31, 4, 3, 2), pg_temp.draft(32, 4, 1, 1);
select count(*) from (select pg_temp.run('s1', pg_temp.fire(1, array[1, 2, 3, 4]))) x;
select count(*) from (select pg_temp.run('s2', 'select public.fire_course(' || quote_literal(pg_temp.s(2)) || '::uuid, jsonb_build_object(''lineIds'', to_jsonb(array['
  || quote_literal(pg_temp.l(11)) || '::uuid, ' || quote_literal(pg_temp.l(12)) || '::uuid, ' || quote_literal(pg_temp.l(13)) || '::uuid, ' || quote_literal(pg_temp.l(14)) || '::uuid])))')) x;
select count(*) from (select pg_temp.run('s3', pg_temp.fire(3, array[21, 23, 24]))) x;
select count(*) from (select pg_temp.run('s4', pg_temp.fire(4, array[31]))) x;

-- 1-2 (AT8): the 2nd waits.
create temp table before as select id, updated_at from public.table_session where id = pg_temp.s(1);
select is(pg_temp.closed(1), 'P0001 uscita_waiting|{"lineIds": ["' || pg_temp.l(3) || '", "' || pg_temp.l(4) || '"]}',
  'closing the founder''s table with the 2nd waiting -> P0001 uscita_waiting with the two line ids (AT8)');
select is(pg_temp.state(1) || ' ' || ((select updated_at from public.table_session where id = pg_temp.s(1)) = (select updated_at from before))::text, 'false:null true',
  'and nothing is written: the session stays open and unchanged');

-- 3: drafts still win first.
select is(split_part(pg_temp.closed(4), '|', 1), 'P0001 unsent_lines', 'a table with a draft and a waiting uscita answers unsent_lines first');

-- 4-5: after the call it closes, with the bill of an all-at-once send of the same dishes.
select count(*) from (select pg_temp.run('call', pg_temp.call(1, 2))) x;
select is(pg_temp.total(1) || ' ' || pg_temp.total(2), '40.00 40.00', 'after the call its bill equals the bill of the same dishes sent all at once');
select is(pg_temp.closed(1) || ' ' || pg_temp.closed(2) || ' ' || pg_temp.state(1), 'ok ok true:40.00', 'and both tables close');

-- 6-7: after voiding the waiting dishes not_prepared it closes, without them.
select count(*) from (select pg_temp.run('v' || n, 'select public.void_line(' || quote_literal(pg_temp.l(n)) || '::uuid, ''{"reason": "not_prepared", "clientUpdatedAt": "1998-10-24T19:30:00Z"}''::jsonb)')
                        from unnest(array[23, 24]) n) x;
select is((select string_agg(j ->> 'changed', ',') from res where nm in ('v23', 'v24')), 'true,true', 'the two waiting dishes are voided not_prepared');
select is(pg_temp.closed(3) || ' ' || pg_temp.state(3), 'ok true:10.00', 'then the table closes, and its total excludes them');

select * from finish();
rollback;
