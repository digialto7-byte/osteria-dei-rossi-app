-- M25c step 3 (docs/plans/2026-11-01-m25c-services.md §3.1.1, §3.2, §3.6, §5 step 3; ADR-031): reading and saving a tenant's service periods. The twin
-- app.set_service_periods_at takes a fixed "now"; the public wrappers are checked for roles, shape and grants. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(65);

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
  return state || ' ' || msg || coalesce(' ' || det, '');
end
$$;
create function pg_temp.act_as(p_auth uuid, p_tenant uuid, p_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated', 'tenant_id', p_tenant, 'app_role', p_role)::text, true)
$$;

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test');
insert into public.tenant (id, name, vat_number, settings) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000', '{}'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115', '{"business_day_cutoff": "00:30"}');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo');

-- shorthand: the twin as owner A at a fixed instant
create function pg_temp.save(p_body jsonb, p_now timestamptz default '1998-11-05 09:00+00') returns jsonb language sql as $$
  select app.set_service_periods_at('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', p_body, p_now)
$$;
create function pg_temp.rows(p_tenant uuid default '11111111-1111-4111-8111-111111111111') returns integer language sql as $$
  select count(*)::int from public.service_schedule where tenant_id = p_tenant
$$;

-- The default, before any save ----------------------------------------------------------------------------------------------------------
select is(app.service_periods_json('11111111-1111-4111-8111-111111111111', '1998-11-05 09:00+00'),
          '{"periods":[{"key":"pranzo","name":"Pranzo","startsAt":"11:00","endsAt":"16:00"},{"key":"cena","name":"Cena","startsAt":"16:00","endsAt":"02:00"}],"cutoff":"02:00","since":null,"isDefault":true}'::jsonb,
          'a tenant with no row reads the default, isDefault true, since null, cutoff 02:00');
select is(app.service_periods_json('22222222-2222-4222-8222-222222222222', '1998-11-05 09:00+00') ->> 'cutoff', '00:30', 'the cutoff is the tenant''s');
select is(app.service_periods_json('22222222-2222-4222-8222-222222222222', '1998-11-05 09:00+00') -> 'periods' -> 1 ->> 'endsAt', '00:30', 'and the last service ends there');
select is(pg_temp.save('{"periods":[{"key":"pranzo","name":"Pranzo","startsAt":"11:00"},{"key":"cena","name":"Cena","startsAt":"16:00"}]}') ->> 'changed', 'false', 'saving the default list writes nothing');
select is(pg_temp.rows(), 0, 'and there is no row');

-- A save that adds Aperitivo ----------------------------------------------------------------------------------------------------------
create temp table first_save as
  select pg_temp.save('{"periods":[{"key":null,"name":"  Aperitivo ","startsAt":"18:00"},{"key":"pranzo","name":"Pranzo","startsAt":"11:00"},{"key":"cena","name":"Cena","startsAt":"19:30"}]}') as r;
select is((select r ->> 'changed' from first_save), 'true', 'a new list is saved: changed true');
select is(pg_temp.rows(), 1, 'one row');
select is((select r -> 'periods' -> 0 ->> 'key' || ',' || (r -> 'periods' -> 2 ->> 'key') from first_save), 'pranzo,cena', 'the reply''s periods are ordered pranzo, aperitivo, cena');
select matches((select r -> 'periods' -> 1 ->> 'key' from first_save), '^s_[0-9a-f]{10}$', 'the new key is s_ plus ten hex digits');
select is((select r -> 'periods' -> 1 ->> 'name' from first_save), 'Aperitivo', 'the name is trimmed');
select is((select array[r -> 'periods' -> 0 ->> 'endsAt', r -> 'periods' -> 1 ->> 'endsAt', r -> 'periods' -> 2 ->> 'endsAt'] from first_save), array['18:00', '19:30', '02:00'], 'ends 18:00, 19:30 and 02:00');
select is((select (r ->> 'isDefault') from first_save), 'false', 'isDefault is false');
select is((select (r ->> 'since')::timestamptz from first_save), '1998-11-05 09:00+00'::timestamptz, 'since is the p_now of the save');
select is((select created_by from public.service_schedule where tenant_id = '11111111-1111-4111-8111-111111111111'), 'a1000000-0000-4000-8000-00000000000a'::uuid, 'created_by is the owner (stored)');
select is((select count(*)::int from jsonb_object_keys((select r from first_save)) k where k ~* 'created|user|by'), 0, 'and no staff key is returned');
select is((select r from first_save), app.service_periods_json('11111111-1111-4111-8111-111111111111', '1998-11-05 09:00+00') || '{"changed": true}', 'the reply is the read plus changed');

create temp table keys as select (r -> 'periods' -> 1 ->> 'key') as k from first_save;
select is(pg_temp.save(format('{"periods":[{"key":"cena","name":"Cena","startsAt":"19:30"},{"key":"%s","name":"Aperitivo","startsAt":"18:00"},{"key":"pranzo","name":"Pranzo","startsAt":"11:00"}]}', (select k from keys))::jsonb,
                       '1998-11-05 10:00+00') ->> 'changed', 'false', 'the same list in another order changes nothing');
select is(pg_temp.rows(), 1, 'and writes no row');
select is(pg_temp.save(format('{"periods":[{"key":"cena","name":"Cena","startsAt":"19:30"},{"key":"%s","name":"Aperitivo","startsAt":"18:00"},{"key":"pranzo","name":"Pranzo","startsAt":"11:30"}]}', (select k from keys))::jsonb,
                       '1998-11-05 10:00+00') ->> 'changed', 'true', 'a moved start is a change');
select is(pg_temp.rows(), 2, 'a second row is appended');
select is((select (r ->> 'since')::timestamptz from (select app.service_periods_json('11111111-1111-4111-8111-111111111111', '1998-11-05 10:30+00') r) x), '1998-11-05 10:00+00'::timestamptz, 'the newest version is in force');
select is((select (r ->> 'since')::timestamptz from (select app.service_periods_json('11111111-1111-4111-8111-111111111111', '1998-11-05 09:30+00') r) x), '1998-11-05 09:00+00'::timestamptz, 'and at an earlier instant the older one');
select is(app.service_periods_json('11111111-1111-4111-8111-111111111111', '1998-11-05 08:59+00') ->> 'isDefault', 'true', 'before the first save the default');
select is(pg_temp.save(format('{"periods":[{"key":"cena","name":"Cena","startsAt":"19:30"},{"key":"%s","name":"Aperitivo","startsAt":"18:00"},{"key":"pranzo","name":"Pranzo","startsAt":"11:30"}]}', (select k from keys))::jsonb,
                       '1998-11-05 11:00+00') ->> 'changed', 'false', 'saving the newest version again changes nothing');
select is(pg_temp.save(format('{"periods":[{"key":"cena","name":"Cena","startsAt":"19:30"},{"key":"pranzo","name":"PRANZO","startsAt":"11:30"},{"key":"%s","name":"Aperitivo","startsAt":"18:00"}]}', (select k from keys))::jsonb,
                       '1998-11-05 11:00+00') ->> 'changed', 'true', 'a renamed service (same key) is a change');
select is(pg_temp.rows(), 3, 'three versions now');

-- Errors: SQLSTATE, message and the DETAIL reason --------------------------------------------------------------------------------------
create function pg_temp.bad(p_body text) returns text language sql as $$
  select pg_temp.err(format('select pg_temp.save(%L::jsonb, %L::timestamptz)', p_body, '1998-11-06 09:00+00'))
$$;
select is(pg_temp.bad('{"periods":[]}'), 'P0001 service_periods_invalid {"reason": "count"}', '0 periods: count');
select is(pg_temp.bad((select jsonb_build_object('periods', jsonb_agg(jsonb_build_object('key', null, 'name', 'S' || n, 'startsAt', lpad(n::text, 2, '0') || ':00')))::text from generate_series(1, 7) n)),
          'P0001 service_periods_invalid {"reason": "count"}', '7 periods: count');
select is(pg_temp.bad('{"periods":[{"key":"pranzo","name":"Pranzo","startsAt":"9:00"}]}'), 'P0001 service_periods_invalid {"reason": "start"}', '"9:00": start');
select is(pg_temp.bad('{"periods":[{"key":"pranzo","name":"Pranzo","startsAt":"24:00"}]}'), 'P0001 service_periods_invalid {"reason": "start"}', '"24:00": start');
select is(pg_temp.bad('{"periods":[{"key":"pranzo","name":"Pranzo","startsAt":"11:00"},{"key":"cena","name":"Cena","startsAt":"11:00"}]}'), 'P0001 service_periods_invalid {"reason": "start_twice"}', 'equal starts: start_twice');
select is(pg_temp.bad('{"periods":[{"key":"pranzo","name":"Cena","startsAt":"11:00"},{"key":"cena","name":"cena","startsAt":"16:00"}]}'), 'P0001 service_periods_invalid {"reason": "name_twice"}', '"Cena" and "cena": name_twice');
select is(pg_temp.bad('{"periods":[{"key":"pranzo","name":"   ","startsAt":"11:00"}]}'), 'P0001 service_periods_invalid {"reason": "name"}', 'a blank name: name');
select is(pg_temp.bad('{"periods":[{"key":"pranzo","name":"' || repeat('x', 31) || '","startsAt":"11:00"}]}'), 'P0001 service_periods_invalid {"reason": "name"}', 'a 31-character name: name');
select is(pg_temp.bad('{"periods":[{"key":"cucina","name":"Cucina","startsAt":"11:00"}]}'), 'P0001 service_periods_invalid {"reason": "key_unknown"}', 'a key never seen: key_unknown');
select is(pg_temp.bad('{"periods":[{"key":"Cucina","name":"Cucina","startsAt":"11:00"}]}'), 'P0001 service_periods_invalid {"reason": "key"}', 'a malformed key: key');
select is(pg_temp.bad('{"periods":[{"key":"pranzo","name":"Pranzo","startsAt":"11:00"},{"key":"pranzo","name":"Pranzo 2","startsAt":"12:00"}]}'), 'P0001 service_periods_invalid {"reason": "key_twice"}', 'an existing key twice: key_twice');
select is(left(pg_temp.bad('{"periods":[], "x":1}'), 11), '22023 inval', 'an extra top-level key: 22023');
select is(left(pg_temp.bad('{}'), 11), '22023 inval', 'an empty object: 22023');
select is(left(pg_temp.bad('{"periods":"x"}'), 11), '22023 inval', 'periods that is not an array: 22023');
select is(left(pg_temp.bad('{"periods":[{"key":"pranzo","name":"Pranzo","startsAt":"11:00","endsAt":"15:00"}]}'), 11), '22023 inval', 'an extra key in a period: 22023');
select is(left(pg_temp.bad('{"periods":[{"key":"pranzo","name":"Pranzo"}]}'), 11), '22023 inval', 'a missing key in a period: 22023');
select is(left(pg_temp.bad('{"periods":[{"key":"pranzo","name":5,"startsAt":"11:00"}]}'), 11), '22023 inval', 'a name that is not a string: 22023');
select is(left(pg_temp.bad('{"periods":["x"]}'), 11), '22023 inval', 'a period that is not an object: 22023');
select is(pg_temp.rows(), 3, 'no failed save wrote a row');

-- Tenant B is separate ------------------------------------------------------------------------------------------------------------------
select is(app.set_service_periods_at('22222222-2222-4222-8222-222222222222', 'b1000000-0000-4000-8000-00000000000b', '{"periods":[{"key":"cena","name":"Cena","startsAt":"17:00"}]}', '1998-11-05 09:00+00') ->> 'changed', 'true', 'B saves its own list (the last service of B ends at B''s cut-off)');
select is(app.service_periods_json('22222222-2222-4222-8222-222222222222', '1998-11-05 12:00+00') -> 'periods' -> 0 ->> 'endsAt', '00:30', 'B''s window ends at 00:30');
select is(pg_temp.rows(), 3, 'and A is unchanged');
select is(pg_temp.err($$ select app.set_service_periods_at('22222222-2222-4222-8222-222222222222', 'b1000000-0000-4000-8000-00000000000b', '{"periods":[{"key":"pranzo","name":"Pranzo","startsAt":"11:00"}]}', '1998-11-06 09:00+00') $$),
          'P0001 service_periods_invalid {"reason": "key_unknown"}', 'B cannot reuse a key that only A''s versions hold (pranzo is not in B''s version in force)');

-- Public functions: roles, then shape ----------------------------------------------------------------------------------------------
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(left(pg_temp.err($$ select public.service_periods() $$), 5), '42501', 'the chef cannot read the services');
select is(left(pg_temp.err($$ select public.set_service_periods('{"periods":[]}'::jsonb) $$), 5), '42501', 'the chef cannot save (before parsing: the body would be a count error)');
select is(left(pg_temp.err($$ select public.set_service_periods('null'::jsonb) $$), 5), '42501', 'nor with a malformed body');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(left(pg_temp.err($$ select public.service_periods() $$), 5), '42501', 'the waiter cannot read');
select is(left(pg_temp.err($$ select public.set_service_periods('null'::jsonb) $$), 5), '42501', 'nor save');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is(public.service_periods() -> 'periods' -> 0 ->> 'key', 'pranzo', 'the admin reads the newest version (pranzo first)');
select is((select count(*)::int from jsonb_object_keys(public.service_periods())), 4, 'with the four keys periods, cutoff, since, isDefault');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
-- The public writer stamps the real clock; the fixtures above are dated in 1998, long before now, so the version it writes is the newest and the one in force.
create temp table pub as select public.set_service_periods('{"periods":[{"key":null,"name":"Brunch","startsAt":"09:00"},{"key":"pranzo","name":"Pranzo","startsAt":"11:00"},{"key":"cena","name":"Cena","startsAt":"16:00"}]}'::jsonb) as r;
grant select on pub to public;
select is((select r ->> 'changed' from pub), 'true', 'the owner saves through the public function');
select is(pg_temp.rows(), 4, 'a fourth version');
select is((select created_by from public.service_schedule where tenant_id = '11111111-1111-4111-8111-111111111111' order by created_at desc, seq desc limit 1), 'a1000000-0000-4000-8000-00000000000a'::uuid, 'created_by comes from app.app_user_id()');
select is(public.service_periods() -> 'periods' -> 0 ->> 'name', 'Brunch', 'the owner reads the new version back');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is(public.set_service_periods(format('{"periods":[{"key":"%s","name":"Brunch","startsAt":"09:00"},{"key":"pranzo","name":"Pranzo","startsAt":"11:00"},{"key":"cena","name":"Cena","startsAt":"16:00"}]}', (select r -> 'periods' -> 0 ->> 'key' from pub))::jsonb) ->> 'changed', 'false', 'the admin saves the same list: nothing changes');
select is(left(pg_temp.err($$ select public.set_service_periods('{"periods":[]}'::jsonb) $$), 5), 'P0001', 'the admin gets the count error for an empty list');

-- Definer rules and grants --------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('service_periods', 'set_service_periods')
            and p.prosecdef and p.proconfig @> array['search_path=""']), 2, 'both public functions are definers with an empty search_path');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('service_periods', 'set_service_periods')
            and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('service_role', p.oid, 'execute')), 2, 'execute for authenticated only');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname in ('service_periods_json', 'set_service_periods_at')
            and p.prosecdef and p.proconfig @> array['search_path=""']
            and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('service_role', p.oid, 'execute')), 2, 'the two twins are definers closed to every API role');

select * from finish();
rollback;
