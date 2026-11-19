-- Comanda per uscita, step 3 (docs/plans/2026-11-18-comanda-uscite.md section 3.3, migration 20261206220000_uscita_core.sql): M1, the uscita
-- core. order_line.uscita (0..9, no default: every existing row stays null, T1), public.uscita_call (the append-only record of a call, RLS
-- owner/admin, no write grant), the line guard (uscita free on a draft; on a fired line only null -> value), the purge list and the helpers
-- app.uscita_default, app.order_uscita, app.held_lines, app.line_held. Fake data only: Demo A and Demo B.
begin;
set local timezone = 'UTC';
create extension if not exists pgtap with schema extensions;
select plan(38);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('a2000000-0000-4000-8000-0000000000a2', 'admin-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare A Demo'),
  ('a2100000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-0000000000a2', 'admin', 'Admin A Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef A Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere A Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo');
insert into public.menu_item (id, tenant_id, name, category, course_default, position, created_by, updated_by) values
  ('31000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Spezzatino A Demo', 'Secondi', 'secondi', 1, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('33000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Tavolo 1 Demo', 1, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('33000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Tavolo 2 Demo', 2, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
-- S1 open, S2 closed (a session closed before uscite existed: its lines keep null).
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_at, opened_by, business_date, created_by, updated_by) values
  ('34000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '33000000-0000-4000-8000-000000000001', 'Tavolo 1 Demo', 2,
   '1998-11-04 19:00+00', 'd1000000-0000-4000-8000-00000000000d', '1998-11-04', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'),
  ('34000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', '33000000-0000-4000-8000-000000000002', 'Tavolo 2 Demo', 2,
   '1998-11-04 19:00+00', 'd1000000-0000-4000-8000-00000000000d', '1998-11-04', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d');
-- L1 draft (S1), L2 fired (S1), L3 fired (S2, closed below): lines from before uscite, so uscita null. Re-pinned on purpose by comanda-uscite
-- (step 8): since M5 a null uscita is refused by the NOT VALID check order_line_uscita_set_ck and an omitted one takes the default 1, so the
-- check is dropped for this fixture only, inside this rolled-back transaction, and the lines name uscita null. The lasting proof of T1 (rows
-- that existed before M5 keep null) is pgTAP 423 (atthasmissing).
alter table public.order_line drop constraint if exists order_line_uscita_set_ck;
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, uscita, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by, fired_at, fired_by) values
  ('35000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '34000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001',
   'secondi', 1, null, 14.00, 10, 'menu', '1998-11-04 19:01+00', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d', null, null),
  ('35000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', '34000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001',
   'secondi', 1, null, 14.00, 10, 'menu', '1998-11-04 19:02+00', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d',
   '1998-11-04 19:05+00', 'd1000000-0000-4000-8000-00000000000d'),
  ('35000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', '34000000-0000-4000-8000-000000000002', '31000000-0000-4000-8000-000000000001',
   'secondi', 1, null, 14.00, 10, 'menu', '1998-11-04 19:02+00', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d',
   '1998-11-04 19:05+00', 'd1000000-0000-4000-8000-00000000000d');
update public.table_session set closed_at = '1998-11-04 21:00+00', closed_by = 'd1000000-0000-4000-8000-00000000000d', closed_business_date = '1998-11-04',
  receipt_type = 'scontrino', receipt_number = '0001-0001', payment_type = 'card', total = 14.00
  where id = '34000000-0000-4000-8000-000000000002';

-- Runs a statement as the table owner and returns 'ok' or "SQLSTATE message".
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
create function pg_temp.claims(p_auth uuid, p_tenant uuid, p_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated', 'tenant_id', p_tenant, 'app_role', p_role, 'aal', 'aal1')::text, true)
$$;
-- How many uscita_call rows a given user reads through the table policy.
create function pg_temp.reads(p_auth uuid, p_tenant uuid, p_role text) returns bigint language plpgsql as $$
declare
  n bigint;
begin
  perform pg_temp.claims(p_auth, p_tenant, p_role);
  set local role authenticated;
  select count(*) into n from public.uscita_call;
  reset role;
  return n;
end
$$;

-- The same for a user whose role needs MFA (the admin): an aal2 session.
create function pg_temp.reads_aal2(p_auth uuid, p_tenant uuid, p_role text) returns bigint language plpgsql as $$
declare
  n bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated', 'tenant_id', p_tenant, 'app_role', p_role, 'aal', 'aal2')::text, true);
  set local role authenticated;
  select count(*) into n from public.uscita_call;
  reset role;
  return n;
end
$$;

-- 1-5: the table, its CHECKs, its unique key, append-only.
select is(pg_temp.err($$insert into public.uscita_call (tenant_id, table_session_id, uscita, called_at, called_by, cause)
  values ('11111111-1111-4111-8111-111111111111', '34000000-0000-4000-8000-000000000001', 1, '1998-11-04 19:10+00', 'd1000000-0000-4000-8000-00000000000d', 'call')$$)
  || ' / rls ' || (select relrowsecurity::text from pg_class where oid = 'public.uscita_call'::regclass),
  '23514 new row for relation "uscita_call" violates check constraint "uscita_call_uscita_ck" / rls true',
  'public.uscita_call exists with RLS on, and an insert of uscita 1 is refused with 23514');
select is(left(pg_temp.err($$insert into public.uscita_call (tenant_id, table_session_id, uscita, called_at, called_by, cause)
  values ('11111111-1111-4111-8111-111111111111', '34000000-0000-4000-8000-000000000001', 10, '1998-11-04 19:10+00', 'd1000000-0000-4000-8000-00000000000d', 'call')$$), 5),
  '23514', 'uscita 10 -> 23514');
insert into public.uscita_call (tenant_id, table_session_id, uscita, called_at, called_by, cause)
  values ('11111111-1111-4111-8111-111111111111', '34000000-0000-4000-8000-000000000001', 2, '1998-11-04 19:10+00', 'd1000000-0000-4000-8000-00000000000d', 'call');
select is(left(pg_temp.err($$insert into public.uscita_call (tenant_id, table_session_id, uscita, called_at, called_by, cause)
  values ('11111111-1111-4111-8111-111111111111', '34000000-0000-4000-8000-000000000001', 2, '1998-11-04 19:11+00', 'a1000000-0000-4000-8000-00000000000a', 'fire_now')$$), 5),
  '23505', 'a second row for the same (session, uscita) -> 23505');
select is(pg_temp.err($$update public.uscita_call set called_at = now()$$), 'P0001 append_only', 'update -> refused (append-only)');
select is(pg_temp.err($$delete from public.uscita_call$$), 'P0001 append_only', 'delete -> refused (append-only)');
select is(left(pg_temp.err($$insert into public.uscita_call (tenant_id, table_session_id, uscita, called_at, called_by, cause)
  values ('11111111-1111-4111-8111-111111111111', '34000000-0000-4000-8000-000000000001', 3, '1998-11-04 19:10+00', 'd1000000-0000-4000-8000-00000000000d', 'kitchen')$$), 5),
  '23514', 'cause kitchen is not admitted before PR5 -> 23514');

-- 7-11: who reads.
select is(pg_temp.reads('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner'), 1::bigint, 'the owner reads A''s call');
select is(pg_temp.reads_aal2('a2000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'admin'), 1::bigint, 'the admin reads A''s call');
select is(pg_temp.reads('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter'), 0::bigint, 'the waiter reads 0 rows');
select is(pg_temp.reads('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef'), 0::bigint, 'the chef reads 0 rows');
select is(pg_temp.reads('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner'), 0::bigint, 'B''s owner reads 0 of A''s rows (X)');

-- 12-13: grants.
select is((select array_agg(r.role || ':' || p.priv order by r.role, p.priv) from (values ('anon'), ('authenticated'), ('service_role')) r(role)
             cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(priv)
             where has_table_privilege(r.role, 'public.uscita_call', p.priv)), null, 'no write grant on uscita_call to any API role');
select is((select array_agg(r.role order by r.role) from (values ('anon'), ('authenticated'), ('service_role')) r(role)
             where has_table_privilege(r.role, 'public.uscita_call', 'SELECT')), array['authenticated', 'service_role'], 'select: authenticated and service_role');

-- 14-16: order_line.uscita (T1: added without a default).
select is((select format_type(atttypid, atttypmod) || ' ' || (not attnotnull)::text || ' ' || atthasmissing::text from pg_attribute
             where attrelid = 'public.order_line'::regclass and attname = 'uscita'), 'smallint true false', 'order_line.uscita is a nullable smallint with no missing value');
-- Re-pinned on purpose by comanda-uscite (step 8; was "uscita is null for every closed-session line of the fixture (T1)"): a fixture inserted
-- after every migration cannot show T1 any more (pgTAP 423 does); what holds is that a table-owner line omitting uscita stores the default 1.
savepoint omitted;
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by)
  values ('35000000-0000-4000-8000-000000000009', '11111111-1111-4111-8111-111111111111', '34000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001',
          'secondi', 1, 14.00, 10, 'menu', '1998-11-04 19:01+00', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d');
select is((select uscita::int from public.order_line where id = '35000000-0000-4000-8000-000000000009'), 1, 'a fixture line inserted without uscita stores 1');
rollback to savepoint omitted;
select is(left(pg_temp.err($$update public.order_line set uscita = 10 where id = '35000000-0000-4000-8000-000000000001'$$), 5), '23514', 'order_line.uscita 10 -> 23514');

-- 17-20: the guard.
select is(pg_temp.err($$update public.order_line set uscita = 1 where id = '35000000-0000-4000-8000-000000000001'$$), 'ok', 'on a draft null -> 1 is allowed');
select is(pg_temp.err($$update public.order_line set uscita = 2 where id = '35000000-0000-4000-8000-000000000001'$$), 'ok', 'on a draft 1 -> 2 is allowed');
select is(pg_temp.err($$update public.order_line set uscita = 1 where id = '35000000-0000-4000-8000-000000000002'$$), 'ok', 'on a fired line null -> 1 is allowed');
select is(pg_temp.err($$update public.order_line set uscita = 2 where id = '35000000-0000-4000-8000-000000000002'$$), 'P0001 order_line_fired', 'on a fired line 1 -> 2 is order_line_fired');
select is(pg_temp.err($$update public.order_line set uscita = null where id = '35000000-0000-4000-8000-000000000002'$$), 'P0001 order_line_fired', 'on a fired line 1 -> null is order_line_fired');
-- A voided line of the closed session: null -> 1 alone is the same sanctioned change (M5 places voided lines of open sessions too);
-- run in a savepoint so the closed line keeps its null for the T1 check above.
savepoint voided;
update public.order_line set voided_at = '1998-11-04 19:30+00', voided_by = 'd1000000-0000-4000-8000-00000000000d', void_reason = 'returned'
  where id = '35000000-0000-4000-8000-000000000003';
select is(pg_temp.err($$update public.order_line set uscita = 1 where id = '35000000-0000-4000-8000-000000000003'$$)
          || ' / ' || pg_temp.err($$update public.order_line set uscita = 2, note = 'x' where id = '35000000-0000-4000-8000-000000000003'$$),
  'ok / P0001 order_line_voided', 'on a voided line null -> 1 alone is allowed; any other change is still order_line_voided');
rollback to savepoint voided;

-- 22-27: the helpers.
select is(app.order_uscita('2'::jsonb), 2::smallint, 'app.order_uscita reads a JSON integer');
select is(pg_temp.err($$select app.order_uscita('"2"'::jsonb)$$), '22023 invalid_request', 'app.order_uscita refuses "2"');
select is(pg_temp.err($$select app.order_uscita('1.5'::jsonb)$$), '22023 invalid_request', 'app.order_uscita refuses 1.5');
select is(pg_temp.err($$select app.order_uscita('-1'::jsonb)$$), '22023 invalid_request', 'app.order_uscita refuses -1');
select is(pg_temp.err($$select app.order_uscita('10'::jsonb)$$), '22023 invalid_request', 'app.order_uscita refuses 10');
select is(array[app.uscita_default('bevande'), app.uscita_default('antipasti'), app.uscita_default('primi'), app.uscita_default('secondi'), app.uscita_default('dolci')],
  array[0, 1, 1, 1, 1]::smallint[], 'uscita_default: 0 for bevande, else 1');

-- 28-32: held lines (section 3.1). L4: a fired 3rd-uscita line with no call -> held; L2 is uscita 1 -> never held; uscita 2 is called.
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by, fired_at, fired_by, uscita) values
  ('35000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', '34000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001',
   'secondi', 1, 14.00, 10, 'menu', '1998-11-04 19:03+00', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d',
   '1998-11-04 19:05+00', 'd1000000-0000-4000-8000-00000000000d', 3),
  ('35000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', '34000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001',
   'secondi', 1, 14.00, 10, 'menu', '1998-11-04 19:03+00', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d',
   '1998-11-04 19:05+00', 'd1000000-0000-4000-8000-00000000000d', 2);
select is((select array_agg(x order by x) from app.held_lines('11111111-1111-4111-8111-111111111111', '34000000-0000-4000-8000-000000000001', 3::smallint) x),
  array['35000000-0000-4000-8000-000000000004']::uuid[], 'held_lines: the fired, uncalled 3rd-uscita line');
select is((select count(*)::int from app.held_lines('11111111-1111-4111-8111-111111111111', '34000000-0000-4000-8000-000000000001', 2::smallint)), 0, 'held_lines: none once the uscita is called');
select is((select count(*)::int from app.held_lines('22222222-2222-4222-8222-222222222222', '34000000-0000-4000-8000-000000000001', 3::smallint)), 0, 'held_lines: another tenant sees none');
select is((select array_agg(app.line_held(l.tenant_id, l) order by l.id) from public.order_line l where l.table_session_id = '34000000-0000-4000-8000-000000000001'),
  array[false, false, true, false], 'line_held: the draft, the 1st, the uncalled 3rd and the called 2nd');
select is((select array_agg(p.oid::regprocedure::text order by 1) from pg_proc p
             where p.oid in ('app.uscita_default(public.course)'::regprocedure, 'app.order_uscita(jsonb)'::regprocedure,
                             'app.held_lines(uuid, uuid, smallint)'::regprocedure, 'app.line_held(uuid, public.order_line)'::regprocedure)
               and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
                    or has_function_privilege('service_role', p.oid, 'execute'))), null, 'the four helpers are closed to every API role');

-- 33-34: the purge list (ADR-018): uscita_call right before kitchen_event, which stays right before order_line_cost.
select is((select array_position(app.demo_purge_tables(), 'kitchen_event') - array_position(app.demo_purge_tables(), 'uscita_call')), 1,
  'the purge list has uscita_call immediately before kitchen_event');
select is((select array_position(app.demo_purge_tables(), 'order_line_cost') - array_position(app.demo_purge_tables(), 'kitchen_event')), 1,
  'and kitchen_event stays immediately before order_line_cost');

-- 35-37: tenant boundary of the foreign keys and the default tenant.
select is(left(pg_temp.err($$insert into public.uscita_call (tenant_id, table_session_id, uscita, called_at, called_by, cause)
  values ('22222222-2222-4222-8222-222222222222', '34000000-0000-4000-8000-000000000001', 4, '1998-11-04 19:10+00', 'b1000000-0000-4000-8000-00000000000b', 'call')$$), 5),
  '23503', 'a call row for another tenant''s session -> 23503 (composite foreign key)');
select is(left(pg_temp.err($$insert into public.uscita_call (tenant_id, table_session_id, uscita, called_at, called_by, cause)
  values ('11111111-1111-4111-8111-111111111111', '34000000-0000-4000-8000-000000000001', 4, '1998-11-04 19:10+00', 'b1000000-0000-4000-8000-00000000000b', 'call')$$), 5),
  '23503', 'a call row whose caller is another tenant''s user -> 23503');
select is((select pg_get_expr(adbin, adrelid) from pg_attrdef where adrelid = 'public.order_line'::regclass
             and adnum = (select attnum from pg_attribute where attrelid = 'public.order_line'::regclass and attname = 'uscita')), '1' /* re-pinned on purpose by comanda-uscite (step 8; was null: M1 adds the column without a default, M5 sets 1 by the lead's ruling) */,
  'order_line.uscita has no default from M1; M5 sets 1 (lead ruling M5, option a)');

select * from finish();
rollback;
