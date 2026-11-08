-- M25c step 1 (docs/plans/2026-11-01-m25c-services.md §3.2, §5 step 1; ADR-031): the two service tables, the built-in default, the period-list validator
-- and the demo purge list. Fake data only (Osteria Demo A/B, Titolare Demo, Admin Demo, Chef Demo, Cameriere Demo).
begin;
create extension if not exists pgtap with schema extensions;
select plan(87);

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
-- Runs one statement as the authenticated API role with the given claims; returns 'ok' or the SQLSTATE.
create function pg_temp.as_auth(p_auth uuid, p_tenant uuid, p_role text, stmt text) returns text language plpgsql as $$
declare
  state text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated', 'tenant_id', p_tenant, 'app_role', p_role)::text, true);
  set local role authenticated;
  execute stmt;
  reset role;
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate;
  reset role;
  return state;
end
$$;
-- The number of rows a statement `select count(*) from ...` sees as the given user.
create function pg_temp.count_as(p_auth uuid, p_tenant uuid, p_role text, p_table text) returns integer language plpgsql as $$
declare
  n integer;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated', 'tenant_id', p_tenant, 'app_role', p_role)::text, true);
  set local role authenticated;
  execute format('select count(*)::integer from public.%I', p_table) into n;
  reset role;
  return n;
end
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
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('13000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Tavolo 1 (demo)', 1, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('23000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Tavolo B (demo)', 1, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_at, opened_by, business_date, created_by, updated_by) values
  ('14000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000001', 'Tavolo 1 (demo)', 2, '1998-11-04 19:10+00', 'd1000000-0000-4000-8000-00000000000d', '1998-11-04', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'),
  ('24000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', '23000000-0000-4000-8000-000000000001', 'Tavolo B (demo)', 2, '1998-11-04 19:30+00', 'b1000000-0000-4000-8000-00000000000b', '1998-11-04', 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');

-- The built-in default and the limit ------------------------------------------------------------------------------------------------
select is(app.service_max_periods(), 6, 'at most six services');
select is(app.default_service_periods(),
          '[{"key":"pranzo","name":"Pranzo","startsAt":"11:00"},{"key":"cena","name":"Cena","startsAt":"16:00"}]'::jsonb, 'the default is Pranzo from 11:00 and Cena from 16:00 (Q220)');
select is(md5(app.default_service_periods()::text), md5('[{"key":"pranzo","name":"Pranzo","startsAt":"11:00"},{"key":"cena","name":"Cena","startsAt":"16:00"}]'::jsonb::text), 'the default text is stable');

-- The validator ---------------------------------------------------------------------------------------------------------------------
select is(app.service_periods_ok(app.default_service_periods()), true, 'the default is valid');
select is(app.service_periods_ok('[{"key":"pranzo","name":"Pranzo","startsAt":"11:00"},{"key":"s_0123456789","name":"Aperitivo","startsAt":"18:00"},{"key":"cena","name":"Cena","startsAt":"19:30"}]'), true, 'a three-period list is valid');
select is(app.service_periods_ok('[{"key":"cena","name":"Cena","startsAt":"00:00"}]'), true, 'one period is valid, 00:00 is a valid start');
select is(app.service_periods_ok('[{"key":"cena","name":"Cena","startsAt":"23:59"}]'), true, '23:59 is a valid start');
select is(app.service_periods_ok('[]'), false, 'an empty list is refused');
select is(app.service_periods_ok('null'), false, 'a JSON null is refused');
select is(app.service_periods_ok('{"key":"cena","name":"Cena","startsAt":"16:00"}'), false, 'an object instead of an array is refused');
select is(app.service_periods_ok(null), false, 'SQL null is refused');
select is(app.service_periods_ok((select jsonb_agg(jsonb_build_object('key', 'k' || n, 'name', 'S' || n, 'startsAt', lpad(n::text, 2, '0') || ':00')) from generate_series(1, 6) n)), true, 'six periods are valid');
select is(app.service_periods_ok((select jsonb_agg(jsonb_build_object('key', 'k' || n, 'name', 'S' || n, 'startsAt', lpad(n::text, 2, '0') || ':00')) from generate_series(1, 7) n)), false, 'seven periods are refused');
select is(app.service_periods_ok('[{"key":"cena","startsAt":"16:00"}]'), false, 'a missing name is refused');
select is(app.service_periods_ok('[{"name":"Cena","startsAt":"16:00"}]'), false, 'a missing key is refused');
select is(app.service_periods_ok('[{"key":"cena","name":"Cena","startsAt":"16:00","endsAt":"23:00"}]'), false, 'an extra key is refused');
select is(app.service_periods_ok('[{"key":"cena","name":"Cena","startsAt":"24:00"}]'), false, '24:00 is refused');
select is(app.service_periods_ok('[{"key":"cena","name":"Cena","startsAt":"9:00"}]'), false, '9:00 is refused');
select is(app.service_periods_ok('[{"key":"cena","name":"Cena","startsAt":"11:00:00"}]'), false, '11:00:00 is refused');
select is(app.service_periods_ok('[{"key":"cena","name":"Cena","startsAt":"11:60"}]'), false, '11:60 is refused');
select is(app.service_periods_ok('[{"key":"pranzo","name":"Pranzo","startsAt":"11:00"},{"key":"cena","name":"Cena","startsAt":"11:00"}]'), false, 'two equal starts are refused');
select is(app.service_periods_ok('[{"key":"pranzo","name":"Cena","startsAt":"11:00"},{"key":"cena","name":"cena","startsAt":"16:00"}]'), false, 'two names that differ only by case are refused');
select is(app.service_periods_ok(jsonb_build_array(jsonb_build_object('key', 'cena', 'name', repeat('x', 31), 'startsAt', '16:00'))), false, 'a 31-character name is refused');
select is(app.service_periods_ok(jsonb_build_array(jsonb_build_object('key', 'cena', 'name', repeat('x', 30), 'startsAt', '16:00'))), true, 'a 30-character name is valid');
select is(app.service_periods_ok('[{"key":"cena","name":"   ","startsAt":"16:00"}]'), false, 'a blank name is refused');
select is(app.service_periods_ok('[{"key":"cena","name":" Cena ","startsAt":"16:00"}]'), false, 'an untrimmed name is refused (the writer trims it)');
select is(app.service_periods_ok('[{"key":"Pranzo","name":"Pranzo","startsAt":"11:00"}]'), false, 'an upper-case key is refused');
select is(app.service_periods_ok('[{"key":"p","name":"Pranzo","startsAt":"11:00"}]'), false, 'a one-character key is refused');
select is(app.service_periods_ok('[{"key":"1pranzo","name":"Pranzo","startsAt":"11:00"}]'), false, 'a key that starts with a digit is refused');
select is(app.service_periods_ok(jsonb_build_array(jsonb_build_object('key', 'a' || repeat('b', 32), 'name', 'X', 'startsAt', '11:00'))), false, 'a 33-character key is refused');
select is(app.service_periods_ok(jsonb_build_array(jsonb_build_object('key', 'a' || repeat('b', 31), 'name', 'X', 'startsAt', '11:00'))), true, 'a 32-character key is valid');
select is(app.service_periods_ok('[{"key":"cena","name":"Cena","startsAt":"16:00"},{"key":"cena","name":"Cena 2","startsAt":"17:00"}]'), false, 'two equal keys are refused');
select is(app.service_periods_ok('[{"key":"cena","name":"Cena","startsAt":16}]'), false, 'a non-string start is refused');
select is(app.service_periods_ok('[["cena","Cena","16:00"]]'), false, 'an array element that is not an object is refused');

-- The tables: append-only, RLS, no write grant -----------------------------------------------------------------------------------------
insert into public.service_schedule (tenant_id, periods, created_by)
  values ('11111111-1111-4111-8111-111111111111', app.default_service_periods(), 'a1000000-0000-4000-8000-00000000000a'),
         ('22222222-2222-4222-8222-222222222222', '[{"key":"cena","name":"Cena","startsAt":"16:00"}]', 'b1000000-0000-4000-8000-00000000000b');
insert into public.service_override (tenant_id, table_session_id, service_key, created_by)
  values ('11111111-1111-4111-8111-111111111111', '14000000-0000-4000-8000-000000000001', 'cena', 'a1000000-0000-4000-8000-00000000000a'),
         ('22222222-2222-4222-8222-222222222222', '24000000-0000-4000-8000-000000000001', null, 'b1000000-0000-4000-8000-00000000000b');
select is((select count(*)::int from public.service_schedule), 2, 'a schedule version inserts (migration owner)');
select is((select count(*)::int from public.service_override), 2, 'an override inserts, with a key and with null (back to automatic)');
select is(left(pg_temp.err($$ insert into public.service_schedule (tenant_id, periods, created_by) values ('11111111-1111-4111-8111-111111111111', '[]', 'a1000000-0000-4000-8000-00000000000a') $$), 5), '23514', 'the table check refuses an invalid list');
select is(left(pg_temp.err($$ insert into public.service_override (tenant_id, table_session_id, service_key, created_by) values ('11111111-1111-4111-8111-111111111111', '14000000-0000-4000-8000-000000000001', 'Cena', 'a1000000-0000-4000-8000-00000000000a') $$), 5), '23514', 'the table check refuses a malformed key');
select is(left(pg_temp.err($$ insert into public.service_override (tenant_id, table_session_id, service_key, created_by) values ('11111111-1111-4111-8111-111111111111', '24000000-0000-4000-8000-000000000001', 'cena', 'a1000000-0000-4000-8000-00000000000a') $$), 5), '23503', 'T1: an override of tenant A pointing at tenant B''s session is a foreign key violation');
select is(left(pg_temp.err($$ insert into public.service_override (tenant_id, table_session_id, service_key, created_by) values ('11111111-1111-4111-8111-111111111111', '14000000-0000-4000-8000-000000000001', 'cena', 'b1000000-0000-4000-8000-00000000000b') $$), 5), '23503', 'a tenant-B user on a tenant-A override is a foreign key violation');
select is(left(pg_temp.err($$ insert into public.service_schedule (tenant_id, periods, created_by) values ('11111111-1111-4111-8111-111111111111', app.default_service_periods(), 'b1000000-0000-4000-8000-00000000000b') $$), 5), '23503', 'a tenant-B user on a tenant-A schedule is a foreign key violation');
select is(pg_temp.err($$ update public.service_schedule set periods = '[{"key":"cena","name":"Cena","startsAt":"17:00"}]' $$), 'P0001 append_only', 'UPDATE of a schedule is refused');
select is(pg_temp.err($$ delete from public.service_schedule $$), 'P0001 append_only', 'DELETE of a schedule is refused');
select is(pg_temp.err($$ truncate public.service_schedule $$), 'P0001 append_only', 'TRUNCATE of a schedule is refused');
select is(pg_temp.err($$ update public.service_override set service_key = 'pranzo' $$), 'P0001 append_only', 'UPDATE of an override is refused');
select is(pg_temp.err($$ delete from public.service_override $$), 'P0001 append_only', 'DELETE of an override is refused');
select is(pg_temp.err($$ truncate public.service_override $$), 'P0001 append_only', 'TRUNCATE of an override is refused');
select is((select array_agg(tgname::text order by tgname::text) from pg_trigger where tgrelid = 'public.service_schedule'::regclass and not tgisinternal),
          array['service_schedule_append_only', 'service_schedule_no_truncate'], 'the two guard triggers of the schedule are named like the other ledgers');
select is((select array_agg(tgname::text order by tgname::text) from pg_trigger where tgrelid = 'public.service_override'::regclass and not tgisinternal),
          array['service_override_append_only', 'service_override_no_truncate'], 'and those of the override');
select is((select count(*)::int from pg_class where oid in ('public.service_schedule'::regclass, 'public.service_override'::regclass) and relrowsecurity), 2, 'RLS is enabled on both');
select is((select count(*)::int from pg_policy where polrelid in ('public.service_schedule'::regclass, 'public.service_override'::regclass) and polcmd = 'r'), 2, 'each has one select policy');
select is((select count(*)::int from pg_policy where polrelid in ('public.service_schedule'::regclass, 'public.service_override'::regclass)), 2, 'and no other policy: there is no write policy');

select is(pg_temp.as_auth('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner',
                          $$ insert into public.service_schedule (tenant_id, periods, created_by) values ('11111111-1111-4111-8111-111111111111', app.default_service_periods(), 'a1000000-0000-4000-8000-00000000000a') $$), '42501', 'the owner cannot insert a schedule directly');
select is(pg_temp.as_auth('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner',
                          $$ insert into public.service_override (tenant_id, table_session_id, service_key, created_by) values ('11111111-1111-4111-8111-111111111111', '14000000-0000-4000-8000-000000000001', 'cena', 'a1000000-0000-4000-8000-00000000000a') $$), '42501', 'nor an override');
select is(pg_temp.as_auth('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner', $$ update public.service_schedule set periods = periods $$), '42501', 'nor update a schedule');
select is(pg_temp.as_auth('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner', $$ delete from public.service_schedule $$), '42501', 'nor delete one');
select is(pg_temp.as_auth('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner', $$ update public.service_override set service_key = null $$), '42501', 'nor update an override');
select is(pg_temp.as_auth('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner', $$ delete from public.service_override $$), '42501', 'nor delete one');
select is(pg_temp.as_auth('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner', $$ truncate public.service_override $$), '42501', 'nor truncate');
select is((select bool_and(has_table_privilege('authenticated', t, 'select')) from unnest(array['public.service_schedule', 'public.service_override']) t), true, 'authenticated holds select on both (RLS decides the rows)');

select is(pg_temp.count_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner', 'service_schedule'), 1, 'owner A sees A''s schedule only');
select is(pg_temp.count_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin', 'service_schedule'), 1, 'admin A sees it too');
select is(pg_temp.count_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef', 'service_schedule'), 0, 'the chef sees none');
select is(pg_temp.count_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter', 'service_schedule'), 0, 'the waiter sees none');
select is(pg_temp.count_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner', 'service_schedule'), 1, 'owner B sees B''s schedule, not A''s');
select is(pg_temp.count_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner', 'service_override'), 1, 'owner A sees A''s override only');
select is(pg_temp.count_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin', 'service_override'), 1, 'admin A sees it too');
select is(pg_temp.count_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef', 'service_override'), 0, 'the chef sees no override');
select is(pg_temp.count_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter', 'service_override'), 0, 'the waiter sees no override');
select is(pg_temp.count_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner', 'service_override'), 1, 'owner B sees B''s override, not A''s');

-- Functions: definer rules ---------------------------------------------------------------------------------------------------------
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname in ('service_max_periods', 'default_service_periods', 'service_periods_ok')), 3, 'the three helpers exist');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname in ('service_max_periods', 'default_service_periods', 'service_periods_ok')
            and p.proconfig @> array['search_path=""']), 3, 'each has an empty search_path');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname in ('service_max_periods', 'default_service_periods', 'service_periods_ok')
            and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))), 0, 'and no API role can execute it');

-- The purge list -------------------------------------------------------------------------------------------------------------------
select is((select o from unnest(app.demo_purge_tables()) with ordinality t(n, o) where n = 'service_override') + 1,
          (select o from unnest(app.demo_purge_tables()) with ordinality t(n, o) where n = 'table_session'), 'service_override is immediately before table_session');
select is((select o from unnest(app.demo_purge_tables()) with ordinality t(n, o) where n = 'service_schedule') - 1,
          (select o from unnest(app.demo_purge_tables()) with ordinality t(n, o) where n = 'dashboard_open'), 'service_schedule is immediately after dashboard_open');
select is((select o from unnest(app.demo_purge_tables()) with ordinality t(n, o) where n = 'service_schedule') + 1,
          (select o from unnest(app.demo_purge_tables()) with ordinality t(n, o) where n = 'reservation_settings'), 'and immediately before reservation_settings (A1 of the reservations feature), which comes before app_user');
select is((select count(*)::int from unnest(app.demo_purge_tables()) n where n in ('service_override', 'service_schedule')), 2, 'each is listed once');
select is((select count(*)::int from (select n from unnest(app.demo_purge_tables()) n group by n having count(*) > 1) d), 0, 'and no name is listed twice');
select is((select cardinality(app.demo_purge_tables())), 58, 'the list holds the 47 names of M23, the two of M25c and the nine of the reservations feature');

-- Q231: a saved schedule is operational data. Tenant E holds nothing else.
insert into public.tenant (id, name, vat_number) values ('55555555-5555-4555-8555-555555555555', 'Osteria Demo E', 'IT55555555559');
insert into auth.users (id, email) values ('e0000000-0000-4000-8000-00000000000e', 'owner-e@example.test');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('e1000000-0000-4000-8000-00000000000e', '55555555-5555-4555-8555-555555555555', 'e0000000-0000-4000-8000-00000000000e', 'owner', 'Titolare E Demo');
select is(app.tenant_has_operational_data('55555555-5555-4555-8555-555555555555'), false, 'tenant E holds no operational data');
insert into public.service_schedule (tenant_id, periods, created_by) values ('55555555-5555-4555-8555-555555555555', app.default_service_periods(), 'e1000000-0000-4000-8000-00000000000e');
select is(app.tenant_has_operational_data('55555555-5555-4555-8555-555555555555'), true, 'a tenant whose only row is a saved schedule has operational data (Q231)');

-- The reset removes both tables' rows of the demo tenant and leaves the others'.
insert into auth.users (id, email) values ('d0000000-0000-4000-8000-0000000000d1', 'demo-owner@example.test'), ('d0000000-0000-4000-8000-0000000000d2', 'demo-admin@example.test'), ('f0000000-0000-4000-8000-0000000000f2', 'founder-d@example.test');
insert into public.tenant (id, name, vat_number) values ('66666666-6666-4666-8666-666666666666', 'Osteria Demo D', 'IT66666666666');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('f2000000-0000-4000-8000-0000000000f2', '66666666-6666-4666-8666-666666666666', 'f0000000-0000-4000-8000-0000000000f2', 'owner', 'Titolare D Demo');
select public.begin_demo_data('66666666-6666-4666-8666-666666666666', 'd0000000-0000-4000-8000-0000000000d1', 'Titolare (demo)', 'd0000000-0000-4000-8000-0000000000d2', 'Admin (demo)');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by)
  select '63000000-0000-4000-8000-000000000001', '66666666-6666-4666-8666-666666666666', 'Tavolo D (demo)', 1, u.id, u.id from public.app_user u where u.auth_id = 'd0000000-0000-4000-8000-0000000000d1';
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_at, opened_by, business_date, created_by, updated_by)
  select '64000000-0000-4000-8000-000000000001', '66666666-6666-4666-8666-666666666666', '63000000-0000-4000-8000-000000000001', 'Tavolo D (demo)', 2, '1998-11-04 19:10+00', u.id, '1998-11-04', u.id, u.id
    from public.app_user u where u.auth_id = 'd0000000-0000-4000-8000-0000000000d1';
insert into public.service_schedule (tenant_id, periods, created_by)
  select '66666666-6666-4666-8666-666666666666', app.default_service_periods(), u.id from public.app_user u where u.auth_id = 'd0000000-0000-4000-8000-0000000000d1';
insert into public.service_override (tenant_id, table_session_id, service_key, created_by)
  select '66666666-6666-4666-8666-666666666666', '64000000-0000-4000-8000-000000000001', 'pranzo', u.id from public.app_user u where u.auth_id = 'd0000000-0000-4000-8000-0000000000d1';
select is((select (app.demo_tenant_counts('66666666-6666-4666-8666-666666666666') ->> 'service_override')::int || ',' || (app.demo_tenant_counts('66666666-6666-4666-8666-666666666666') ->> 'service_schedule')::int), '1,1', 'the demo tenant holds one schedule and one override');
select app.purge_demo_data_core('66666666-6666-4666-8666-666666666666', 'script', null);
select is((select count(*)::int from public.service_schedule where tenant_id = '66666666-6666-4666-8666-666666666666'), 0, 'the reset removed the demo tenant''s schedule');
select is((select count(*)::int from public.service_override where tenant_id = '66666666-6666-4666-8666-666666666666'), 0, 'and its override');
select is((select count(*)::int from public.service_schedule where tenant_id <> '66666666-6666-4666-8666-666666666666'), 3, 'the other tenants'' schedules stay');
select is((select count(*)::int from public.service_override where tenant_id <> '66666666-6666-4666-8666-666666666666'), 2, 'and their overrides');
select is(pg_temp.err($$ delete from public.service_schedule $$), 'P0001 append_only', 'the tables are append-only again after the reset');

select * from finish();
rollback;
