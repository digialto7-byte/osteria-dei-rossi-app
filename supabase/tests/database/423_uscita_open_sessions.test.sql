-- Comanda per uscita, step 8 (docs/plans/2026-11-18-comanda-uscite.md section 3.8; migration 20261206220400_uscita_open_sessions.sql): M5, the
-- open sessions placed in place, the NOT VALID check (T2), and the lead's M5 ruling: order_line.uscita default 1, the one sanctioned Rule B
-- exception for the column, with the guard that no app writer relies on it (no INSERT grant to an API role; every writer names uscita;
-- each refuses a null uscita).
-- The migration ran the backfill on an empty database. To run it again on lines from before uscite, this file drops the NOT VALID check
-- inside its own transaction (rolled back), inserts the fixture with uscita null as the table owner, runs the function, and puts the check
-- back as the migration does. Fake data only.
begin;
set local timezone = 'UTC';
create extension if not exists pgtap with schema extensions;
select plan(24);

-- What the migration left, before this file changes anything (T1, T2, the ruling).
select is((select atthasmissing::text || ' ' || pg_get_expr(d.adbin, d.adrelid) from pg_attribute a
             join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
            where a.attrelid = 'public.order_line'::regclass and a.attname = 'uscita'),
  'false 1', 'order_line.uscita has default 1 and no missing value: SET DEFAULT changed no existing row (T1)');
select is((select convalidated::text || ' ' || pg_get_constraintdef(oid) from pg_constraint where conname = 'order_line_uscita_set_ck'),
  'false CHECK ((uscita IS NOT NULL)) NOT VALID', 'order_line_uscita_set_ck is NOT VALID and never validated (T2)');
select ok(col_description('public.order_line'::regclass, (select attnum from pg_attribute where attrelid = 'public.order_line'::regclass and attname = 'uscita'))
            like '%Rule B exception%', 'the column comment records the sanctioned Rule B exception');

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test');
insert into public.tenant (id, name, vat_number) values ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo');
insert into public.menu_item (id, tenant_id, name, category, course_default, is_available, is_active, created_by, updated_by) values
  ('11000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Bruschetta (demo)', 'Antipasti', 'antipasti', true, true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Tagliatelle (demo)', 'Primi', 'primi', true, true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Spezzatino (demo)', 'Secondi', 'secondi', true, true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'Acqua (demo)', 'Bevande', 'bevande', true, true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.menu_item_price (tenant_id, menu_item_id, price, vat_rate, valid_from, created_by)
  select '11111111-1111-4111-8111-111111111111', id, 10, 10, now() - interval '1 day', 'a1000000-0000-4000-8000-00000000000a' from public.menu_item;
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by)
  select ('13000000-0000-4000-8000-00000000000' || n)::uuid, '11111111-1111-4111-8111-111111111111', 'Tavolo ' || n || ' (demo)', n,
         'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a' from generate_series(1, 2) n;
-- S1 open (G's open session), S2 closed.
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, created_by, updated_by)
  select ('14000000-0000-4000-8000-00000000000' || n)::uuid, '11111111-1111-4111-8111-111111111111', ('13000000-0000-4000-8000-00000000000' || n)::uuid,
         'Tavolo ' || n || ' (demo)', 2, 'd1000000-0000-4000-8000-00000000000d', '1998-10-24', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'
    from generate_series(1, 2) n;

-- Lines from before uscite (uscita null): the NOT VALID check is dropped for the fixture only, inside this rolled-back transaction.
alter table public.order_line drop constraint order_line_uscita_set_ck;
create function pg_temp.line(p_n int, p_s int, p_i int, p_segue boolean, p_fired_min int) returns void language sql as $$
  insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, uscita, segue, unit_price, vat_rate, price_source, client_updated_at,
                                 created_by, updated_by, fired_at, fired_by)
  select ('e1000000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid, '11111111-1111-4111-8111-111111111111',
         ('14000000-0000-4000-8000-00000000000' || p_s)::uuid, m.id, m.course_default, 1, null, p_segue, 10, 10, 'menu', '1998-10-24 19:00+00',
         'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d',
         case when p_fired_min is not null then '1998-10-24 19:00+00'::timestamptz + p_fired_min * interval '1 minute' end,
         case when p_fired_min is not null then 'd1000000-0000-4000-8000-00000000000d'::uuid end
    from public.menu_item m where m.id = ('11000000-0000-4000-8000-00000000000' || p_i)::uuid $$;
create function pg_temp.l(p_n int) returns uuid language sql as $$ select ('e1000000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid $$;
create function pg_temp.us(p_n int) returns text language sql as $$ select coalesce(uscita::text, 'null') from public.order_line where id = pg_temp.l(p_n) $$;
-- S1: a draft (segue false), a segue draft, a fired antipasto, a fired segue secondo (19:20), a fired drink. S2 (closed): a fired line.
select pg_temp.line(1, 1, 2, false, null), pg_temp.line(2, 1, 3, true, null), pg_temp.line(3, 1, 1, false, 10),
       pg_temp.line(4, 1, 3, true, 20), pg_temp.line(5, 1, 4, false, 10), pg_temp.line(6, 2, 2, false, 5);
update public.table_session set closed_at = now(), closed_by = 'd1000000-0000-4000-8000-00000000000d', closed_business_date = '1998-10-24',
  receipt_type = 'scontrino', receipt_number = '0001-0001', payment_type = 'card', total = 10 where id = '14000000-0000-4000-8000-000000000002';

create temp table run1 as select app.uscite_backfill_open_sessions() as j;
-- 4-9 (AT7)
select is(pg_temp.us(2) || ' ' || pg_temp.us(5) || ' ' || pg_temp.us(3) || ' ' || pg_temp.us(1)
          || ' ' || (select string_agg(uscita || ':' || cause || ':' || (called_at = '1998-10-24 19:20+00')::text, ',') from public.uscita_call
                      where table_session_id = '14000000-0000-4000-8000-000000000001'),
  '2 0 1 1 2:migration:true', 'on G''s open session, after the backfill, the segue draft has uscita 2, the drink 0, the antipasto 1, and the fired segue secondo has a migration call at its own fired_at');
select is(pg_temp.us(4), '2', 'the fired segue secondo is in the 2nd');
select is((select count(*)::int from public.order_line l where l.table_session_id = '14000000-0000-4000-8000-000000000001' and app.line_held(l.tenant_id, l)), 0,
  'no fired open-session line is held');
select is((select j from run1), '{"calls": 1, "lines": 5}'::jsonb, 'the run placed five lines and wrote one call');
select is(app.uscite_backfill_open_sessions(), '{"calls": 0, "lines": 0}'::jsonb, 'a second run writes nothing and returns {lines: 0, calls: 0}');
select is(pg_temp.us(6), 'null', 'the closed-session line keeps null');

-- 10-12: the check is put back as the migration adds it; an explicit null is refused; a table-owner insert without uscita stores 1.
alter table public.order_line add constraint order_line_uscita_set_ck check (uscita is not null) not valid;
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
select is(left(pg_temp.err($$update public.order_line set uscita = null where id = 'e1000000-0000-4000-8000-000000000001'$$), 5), '23514',
  'an update to an explicit null uscita now -> 23514');
select is(left(pg_temp.err($$insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, uscita, segue, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by)
  values ('e1000000-0000-4000-8000-000000000010', '11111111-1111-4111-8111-111111111111', '14000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001',
          'antipasti', 1, null, false, 10, 10, 'menu', '1998-10-24 19:00+00', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d')$$), 5), '23514',
  'an insert with an explicit null uscita now -> 23514');
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, segue, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by)
  values ('e1000000-0000-4000-8000-000000000011', '11111111-1111-4111-8111-111111111111', '14000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001',
          'antipasti', 1, false, 10, 10, 'menu', '1998-10-24 19:00+00', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d');
select is(pg_temp.us(11), '1', 'a table-owner insert that omits uscita stores 1 (the default)');

-- 13-18: the Rule B guard: no app writer relies on the default.
select is((select array_agg(r.role order by r.role) from (values ('anon'), ('authenticated')) r(role) where has_table_privilege(r.role, 'public.order_line', 'INSERT')),
  null, 'INSERT on order_line is false for authenticated and anon');
create temp table writers as
  select p.oid::regprocedure::text as fn, m[1] as cols
    from pg_proc p, regexp_matches(p.prosrc, 'insert\s+into\s+(?:public\.)?order_line\s*\(([^)]*)\)', 'gi') m
   where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace);
select ok((select count(*) > 0 from writers where fn = 'add_order_line(uuid,jsonb)'), 'positive control: the scan finds public.add_order_line, so it is not empty');
select is((select count(*)::int from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace)
             and p.prosrc ~* 'insert\s+into\s+(public\.)?order_line\M'), (select count(*)::int from writers),
  'every insert into order_line in a public or app function has a column list the scan read');
select is((select array_agg(fn order by fn) from writers where cols !~* '\muscita\M'), null, 'every insert into order_line names uscita, statement by statement');
select is((select array_agg(p.oid::regprocedure::text order by 1) from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace)
             and p.prosrc ~* '\mexecute\M' and p.prosrc ~* 'order_line\M'), null, 'no public or app function builds SQL with execute and mentions order_line');
select set_config('request.jwt.claims', json_build_object('sub', 'd0000000-0000-4000-8000-00000000000d', 'role', 'authenticated',
  'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'waiter', 'aal', 'aal1')::text, true);
select is(pg_temp.err($$set local role authenticated; select public.add_order_line('14000000-0000-4000-8000-000000000001',
            jsonb_build_object('lineId', 'e1000000-0000-4000-8000-000000000012', 'menuItemId', '11000000-0000-4000-8000-000000000001',
                               'clientUpdatedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'uscita', null))$$)
          || ' ' || (select count(*) from public.order_line where id = 'e1000000-0000-4000-8000-000000000012'),
  '22023 invalid_request 0', 'the one writer (add_order_line) refuses a null uscita and writes nothing');
reset role;

-- 19-21: the self-check refuses a sent open-session line that would be held.
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, uscita, segue, unit_price, vat_rate, price_source, client_updated_at,
                               created_by, updated_by, fired_at, fired_by)
  values ('e1000000-0000-4000-8000-000000000013', '11111111-1111-4111-8111-111111111111', '14000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000003',
          'secondi', 1, 3, true, 10, 10, 'menu', '1998-10-24 19:00+00', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d',
          '1998-10-24 19:30+00', 'd1000000-0000-4000-8000-00000000000d');
select is(pg_temp.err($$select app.uscite_backfill_open_sessions()$$), 'P0001 uscite_backfill_failed',
  'the self-check raises uscite_backfill_failed when a sent open-session line would be held');
select is((select count(*)::int from public.uscita_call where table_session_id = '14000000-0000-4000-8000-000000000001'), 1, 'and nothing was written');
select is((select array_agg(r.role order by r.role) from (values ('anon'), ('authenticated'), ('service_role')) r(role)
             where has_function_privilege(r.role, 'app.uscite_backfill_open_sessions()', 'execute')), null, 'the backfill is closed to every API role');

-- 22-24: the old UI path still works on the migrated session: a legacy fire (no hold) of the segue draft.
select set_config('request.jwt.claims', json_build_object('sub', 'd0000000-0000-4000-8000-00000000000d', 'role', 'authenticated',
  'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'waiter', 'aal', 'aal1')::text, true);
set local role authenticated;
create temp table legacy as select public.fire_course('14000000-0000-4000-8000-000000000001', jsonb_build_object('lineIds', jsonb_build_array('e1000000-0000-4000-8000-000000000002'))) as j;
reset role;
select is((select (j -> 'fired' ->> 0) || ' ' || (j -> 'held')::text from legacy), 'e1000000-0000-4000-8000-000000000002 []', 'a legacy fire of the segue draft fires it, not held');
select is((select state || ' ' || uscita from public.order_line where id = pg_temp.l(2)), 'fired 2', 'it is sent in the 2nd');
select is((select count(*)::int from public.order_line_cost where order_line_id = pg_temp.l(2)), 1, 'and costed (depleted at the send, as today)');

select * from finish();
rollback;
