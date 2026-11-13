-- M25c step 4 (docs/plans/2026-11-01-m25c-services.md §3.1.4, §3.2, §3.8, §5 step 4; ADR-031): moving a table to another service. Owner and admin, while the session is
-- open or its business date is not final (cut-off end + 10 minutes); every move is an appended row, the last one wins, null means automatic. The §3.8 sessions
-- T1 to T5 (without lines: the amounts belong to pgTAP 284). Every "now" is a fixed instant. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(48);

create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare
  state text;
  msg text;
  det text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text, det = pg_exception_detail;
  return state || ' ' || msg || case when det is not null and det <> '' then ' ' || det else '' end;
end
$$;
create function pg_temp.act_as(p_auth uuid, p_tenant uuid, p_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated', 'tenant_id', p_tenant, 'app_role', p_role, 'aal', case when p_role = 'admin' then 'aal2' else 'aal1' end)::text, true)
$$;

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by)
  select ('13000000-0000-4000-8000-00000000000' || n)::uuid, '11111111-1111-4111-8111-111111111111', 'Tavolo ' || n || ' (demo)', n,
         'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a' from generate_series(1, 5) n;
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('23000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Tavolo B (demo)', 1, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');

-- T1 20:10 to 23:10, T2 21:30 to 00:40 (business date D = 1998-11-04), T3 23:50 to 02:20 (business date D + 1), T4 22:00 open, T5 12:30 to 14:10. SB is tenant B.
create function pg_temp.mk(p_id text, p_table text, p_tenant uuid, p_user uuid, p_covers int, p_opened timestamptz, p_closed timestamptz, p_cbd date, p_total numeric) returns void language sql as $$
  insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_at, opened_by, business_date, closed_at, closed_by,
                                    closed_business_date, receipt_type, payment_type, total, created_by, updated_by)
  values (p_id::uuid, p_tenant, p_table::uuid, 'Tavolo (demo)', p_covers, p_opened, p_user, '1998-11-04', p_closed, case when p_closed is not null then p_user end,
          p_cbd, case when p_closed is not null then 'scontrino' end, case when p_closed is not null then 'card' end, p_total, p_user, p_user)
$$;
select pg_temp.mk('14000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'd1000000-0000-4000-8000-00000000000d', 3, '1998-11-04 19:10+00', '1998-11-04 22:10+00', '1998-11-04', 100.00);
select pg_temp.mk('14000000-0000-4000-8000-000000000002', '13000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'd1000000-0000-4000-8000-00000000000d', 2, '1998-11-04 20:30+00', '1998-11-04 23:40+00', '1998-11-04', 35.00);
select pg_temp.mk('14000000-0000-4000-8000-000000000003', '13000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'd1000000-0000-4000-8000-00000000000d', 2, '1998-11-04 22:50+00', '1998-11-05 01:20+00', '1998-11-05', 12.50);
select pg_temp.mk('14000000-0000-4000-8000-000000000004', '13000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'd1000000-0000-4000-8000-00000000000d', 4, '1998-11-04 21:00+00', null, null, null);
select pg_temp.mk('14000000-0000-4000-8000-000000000005', '13000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'd1000000-0000-4000-8000-00000000000d', 2, '1998-11-04 11:30+00', '1998-11-04 13:10+00', '1998-11-04', 18.00);
select pg_temp.mk('24000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'b1000000-0000-4000-8000-00000000000b', 2, '1998-11-04 19:30+00', '1998-11-04 21:00+00', '1998-11-04', 40.00);

create function pg_temp.mv(p_session text, p_body text, p_now timestamptz) returns jsonb language sql as $$
  select app.set_session_service_at('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', p_session::uuid, p_body::jsonb, p_now)
$$;
create function pg_temp.rows(p_session text) returns integer language sql as $$
  select count(*)::int from public.service_override where table_session_id = p_session::uuid
$$;
create function pg_temp.key_now(p_session text) returns text language sql as $$
  select service_key from app.session_service_one('11111111-1111-4111-8111-111111111111', p_session::uuid)
$$;

-- The first move: T2 (21:30, automatically Cena) to Pranzo, one second before the day is final -------------------------------------
select is(pg_temp.key_now('14000000-0000-4000-8000-000000000002'), 'cena', 'T2 is Cena by its opening time');
create temp table m1 as select pg_temp.mv('14000000-0000-4000-8000-000000000002', '{"serviceKey":"pranzo"}', '1998-11-05 01:09:59+00') as r;
select is((select r from m1), '{"changed": true, "session": {"sessionId": "14000000-0000-4000-8000-000000000002", "serviceKey": "pranzo", "source": "override"}}'::jsonb, 'one second before the grace ends: changed, source override');
select is(pg_temp.rows('14000000-0000-4000-8000-000000000002'), 1, 'one row');
select is(pg_temp.key_now('14000000-0000-4000-8000-000000000002'), 'pranzo', 'and the session is Pranzo');
select is((select created_by from public.service_override where table_session_id = '14000000-0000-4000-8000-000000000002'), 'a1000000-0000-4000-8000-00000000000a'::uuid, 'created_by is the owner (stored, not returned)');
select is((select created_at from public.service_override where table_session_id = '14000000-0000-4000-8000-000000000002'), '1998-11-05 01:09:59+00'::timestamptz, 'created_at is the now of the move');
select is(pg_temp.mv('14000000-0000-4000-8000-000000000002', '{"serviceKey":"pranzo"}', '1998-11-05 01:09:59+00') ->> 'changed', 'false', 'the same move again changes nothing');
select is(pg_temp.rows('14000000-0000-4000-8000-000000000002'), 1, 'and writes no row');
select is(pg_temp.err($$ select pg_temp.mv('14000000-0000-4000-8000-000000000002', '{"serviceKey":"cena"}', '1998-11-05 01:10:00+00') $$), 'P0001 service_day_final', 'at the grace edge (01:10:00) the day is final');
select is(pg_temp.err($$ select pg_temp.mv('14000000-0000-4000-8000-000000000002', '{"serviceKey":null}', '1998-11-05 03:00:00+00') $$), 'P0001 service_day_final', 'and "automatic" is refused too');
select is(pg_temp.err($$ select pg_temp.mv('14000000-0000-4000-8000-000000000001', '{"serviceKey":"pranzo"}', '1998-11-06 12:00:00+00') $$), 'P0001 service_day_final', 'a later day is final as well');
select is(pg_temp.rows('14000000-0000-4000-8000-000000000002'), 1, 'refused moves write nothing');

-- Open and later-business-date sessions ---------------------------------------------------------------------------------------------
select is(pg_temp.mv('14000000-0000-4000-8000-000000000004', '{"serviceKey":"pranzo"}', '1999-01-01 12:00:00+00') ->> 'changed', 'true', 'T4 (open) can be moved at any time');
select is(pg_temp.key_now('14000000-0000-4000-8000-000000000004'), 'pranzo', 'T4 is now Pranzo');
select is(pg_temp.mv('14000000-0000-4000-8000-000000000003', '{"serviceKey":"pranzo"}', '1998-11-05 01:10:00+00') ->> 'changed', 'true', 'T3 (business date D + 1) is not final at D''s grace edge');
select is(pg_temp.err($$ select pg_temp.mv('14000000-0000-4000-8000-000000000003', '{"serviceKey":"cena"}', '1998-11-06 01:10:00+00') $$), 'P0001 service_day_final', 'but it is final one day later');

-- Back to automatic -----------------------------------------------------------------------------------------------------------------------
select is(pg_temp.mv('14000000-0000-4000-8000-000000000002', '{"serviceKey":null}', '1998-11-05 01:09:59+00'),
          '{"changed": true, "session": {"sessionId": "14000000-0000-4000-8000-000000000002", "serviceKey": "cena", "source": "auto"}}'::jsonb, 'null puts T2 back to automatic: a row with null, source auto');
select is(pg_temp.rows('14000000-0000-4000-8000-000000000002'), 2, 'two rows: nothing was overwritten');
select is(pg_temp.key_now('14000000-0000-4000-8000-000000000002'), 'cena', 'T2 is Cena again');
select is(pg_temp.mv('14000000-0000-4000-8000-000000000002', '{"serviceKey":null}', '1998-11-05 01:09:59+00') ->> 'changed', 'false', 'null again changes nothing');
select is(pg_temp.mv('14000000-0000-4000-8000-000000000001', '{"serviceKey":null}', '1998-11-05 01:09:59+00') ->> 'changed', 'false', 'null on T1, never moved, changes nothing');
select is(pg_temp.rows('14000000-0000-4000-8000-000000000001'), 0, 'and writes no row');
select is(pg_temp.mv('14000000-0000-4000-8000-000000000001', '{"serviceKey":"cena"}', '1998-11-05 01:09:59+00') ->> 'changed', 'false', 'asking for the service a session already has (Cena, automatic) changes nothing');
select is(pg_temp.mv('14000000-0000-4000-8000-000000000005', '{"serviceKey":"cena"}', '1998-11-05 01:09:59+00') ->> 'changed', 'true', 'T5 (Pranzo by its time) moves to Cena');
select is(pg_temp.mv('14000000-0000-4000-8000-000000000005', '{"serviceKey":"pranzo"}', '1998-11-05 01:09:59+00') -> 'session' ->> 'source', 'override', 'and back to Pranzo by an explicit move: still an override row');
select is(pg_temp.rows('14000000-0000-4000-8000-000000000005'), 2, 'two rows for T5');

-- Errors ---------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.err($$ select pg_temp.mv('14000000-0000-4000-8000-000000000001', '{"serviceKey":"aperitivo"}', '1998-11-05 01:09:59+00') $$), 'P0001 service_unknown', 'a key not in the version in force at the opening: service_unknown');
select is(pg_temp.err($$ select pg_temp.mv('14000000-0000-4000-8000-000000000001', '{"serviceKey":"Cena"}', '1998-11-05 01:09:59+00') $$), 'P0001 service_unknown', 'a malformed key is unknown too');
select is(left(pg_temp.err($$ select pg_temp.mv('14000000-0000-4000-8000-000000000001', '{}', '1998-11-05 01:09:59+00') $$), 11), '22023 inval', '{}: 22023');
select is(left(pg_temp.err($$ select pg_temp.mv('14000000-0000-4000-8000-000000000001', '{"serviceKey":1}', '1998-11-05 01:09:59+00') $$), 11), '22023 inval', '{"serviceKey":1}: 22023');
select is(left(pg_temp.err($$ select pg_temp.mv('14000000-0000-4000-8000-000000000001', '{"serviceKey":"cena","x":1}', '1998-11-05 01:09:59+00') $$), 11), '22023 inval', 'an extra key: 22023');
select is(pg_temp.err($$ select pg_temp.mv('24000000-0000-4000-8000-000000000001', '{"serviceKey":"cena"}', '1998-11-05 01:09:59+00') $$), 'P0002 session_not_found', 'tenant B''s session id from tenant A: session_not_found');
select is(pg_temp.err($$ select pg_temp.mv('99999999-9999-4999-8999-999999999999', '{"serviceKey":"cena"}', '1998-11-05 01:09:59+00') $$), 'P0002 session_not_found', 'an unknown id too');
select is((select count(*)::int from public.service_override where tenant_id = '22222222-2222-4222-8222-222222222222'), 0, 'and tenant B has no row');

-- A version saved after the opening does not change the choices ------------------------------------------------------------------------
insert into public.service_schedule (tenant_id, periods, created_at, created_by)
  values ('11111111-1111-4111-8111-111111111111', '[{"key":"pranzo","name":"Pranzo","startsAt":"11:00"},{"key":"s_0123456789","name":"Aperitivo","startsAt":"18:00"},{"key":"cena","name":"Cena","startsAt":"19:30"}]',
          '1998-11-04T23:59:00Z', 'a1000000-0000-4000-8000-00000000000a');
select is(pg_temp.err($$ select pg_temp.mv('14000000-0000-4000-8000-000000000001', '{"serviceKey":"s_0123456789"}', '1998-11-05 01:09:59+00') $$), 'P0001 service_unknown', 'T1 opened before the new version: Aperitivo is not one of its choices');
select is(pg_temp.err($$ select pg_temp.mv('14000000-0000-4000-8000-000000000003', '{"serviceKey":"s_0123456789"}', '1998-11-05 01:10:00+00') $$), 'P0001 service_unknown', 'and so is T3 (opened at 22:50Z, before the version)');
select pg_temp.mk('14000000-0000-4000-8000-000000000006', '13000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'd1000000-0000-4000-8000-00000000000d', 2, '1998-11-05 17:30+00', null, null, null);
select is(pg_temp.key_now('14000000-0000-4000-8000-000000000006'), 's_0123456789', 'T6, opened after the new version at 18:30, is Aperitivo');
select is(pg_temp.mv('14000000-0000-4000-8000-000000000006', '{"serviceKey":"cena"}', '1998-11-05 18:00:00+00') -> 'session' ->> 'serviceKey', 'cena', 'and it can be moved to Cena (a key of its version)');

-- Public wrapper: roles first ---------------------------------------------------------------------------------------------------------------
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(left(pg_temp.err($$ select public.set_session_service('99999999-9999-4999-8999-999999999999', '{"serviceKey":"cena"}') $$), 5), '42501', 'the chef: 42501 before the session lookup');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(left(pg_temp.err($$ select public.set_session_service('14000000-0000-4000-8000-000000000004', '{"serviceKey":"cena"}') $$), 5), '42501', 'the waiter: 42501, even on an open table');
-- The public wrapper stamps the real clock, so it moves T7, a session no fixture-dated move has touched (T4's moves above are dated 1999).
select pg_temp.mk('14000000-0000-4000-8000-000000000007', '13000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'd1000000-0000-4000-8000-00000000000d', 2, '1998-11-04 12:00+00', null, null, null);
select is(pg_temp.key_now('14000000-0000-4000-8000-000000000007'), 'pranzo', 'T7 (open, 13:00) is Pranzo');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is(public.set_session_service('14000000-0000-4000-8000-000000000007', '{"serviceKey":"cena"}') -> 'session' ->> 'serviceKey', 'cena', 'the admin moves T7 (open) to Cena');
select is((select created_by from public.service_override where table_session_id = '14000000-0000-4000-8000-000000000007' order by created_at desc, seq desc limit 1), 'f1000000-0000-4000-8000-00000000000f'::uuid, 'created_by is the admin');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(public.set_session_service('14000000-0000-4000-8000-000000000007', '{"serviceKey":"pranzo"}') ->> 'changed', 'true', 'the owner moves it back to Pranzo (an override equal to the automatic key is still a change of state)');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(pg_temp.err($$ select public.set_session_service('14000000-0000-4000-8000-000000000004', '{"serviceKey":"cena"}') $$), 'P0002 session_not_found', 'owner B cannot move tenant A''s table');

-- Definer rules -----------------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from pg_proc p where p.proname in ('set_session_service', 'set_session_service_at') and p.prosecdef and p.proconfig @> array['search_path=""']), 2, 'both functions are definers with an empty search_path');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'set_session_service'
            and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('service_role', p.oid, 'execute')), 1, 'the public one executes for authenticated only');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'set_session_service_at'
            and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('service_role', p.oid, 'execute')), 1, 'the twin is closed to every API role');

select * from finish();
rollback;
