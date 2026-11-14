-- P2-2 S6 (docs/plans/2026-11-14-p2-2-trace-sell-through.md section 3.5 and step S6): the booked covers per service, counts only (reservations plan V2, D9). The chef reads these numbers through
-- a definer and still reads 0 rows from every reservation table. Fixture day D = 1998-11-20 (p_now 09:00Z, Rome 10:00, business day D): Pranzo: accepted 2, arrived 4, pending 6, declined 3 (party sizes);
-- Cena: seated 5, no_show 2, cancelled 4; a booking under the retired service key brunch (accepted 2). Only confirmed bookings (accepted, arrived, seated) are counted; reservations_day_json
-- (owner, admin, waiter) still counts pending too and is not changed. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

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
  ('13000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Tavolo 1 (demo)', 1, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');

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
end $$;
create function pg_temp.act_as(p_who text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub',
    case p_who when 'owner' then 'a0000000-0000-4000-8000-00000000000a' when 'admin' then 'f0000000-0000-4000-8000-00000000000f' when 'admin1' then 'f0000000-0000-4000-8000-00000000000f'
               when 'chef' then 'c0000000-0000-4000-8000-00000000000c' when 'ownerb' then 'b0000000-0000-4000-8000-00000000000b'
               else 'd0000000-0000-4000-8000-00000000000d' end, 'role', 'authenticated',
    'tenant_id', case when p_who = 'ownerb' then '22222222-2222-4222-8222-222222222222' else '11111111-1111-4111-8111-111111111111' end,
    'app_role', case when p_who = 'ownerb' then 'owner' when p_who = 'admin1' then 'admin' else p_who end, 'aal', case when p_who = 'admin' then 'aal2' else 'aal1' end)::text, true) $$;
create function pg_temp.out(stmt text) returns text language plpgsql as $$
declare
  state text;
  msg text;
begin
  set local role authenticated;
  execute stmt;
  reset role;
  return 'ok';
exception when others then
  reset role;
  get stacked diagnostics state = returned_sqlstate, msg = message_text;
  return state || ' ' || msg;
end $$;
-- Row count of a table read as the authenticated role.
create function pg_temp.cnt(rel text) returns int language plpgsql as $$
declare n int;
begin
  set local role authenticated;
  execute 'select count(*)::int from ' || rel into n;
  reset role;
  return n;
end $$;
create function pg_temp.all_keys(j jsonb) returns setof text language plpgsql as $$
declare
  k text;
  v jsonb;
begin
  if jsonb_typeof(j) = 'object' then
    for k, v in select * from jsonb_each(j) loop
      return next k;
      return query select * from pg_temp.all_keys(v);
    end loop;
  elsif jsonb_typeof(j) = 'array' then
    for v in select * from jsonb_array_elements(j) loop
      return query select * from pg_temp.all_keys(v);
    end loop;
  end if;
end $$;

-- A booking of tenant A on business day p_date at p_from (UTC) for p_party covers, with a contact (name, phone and e-mail all fake).
create sequence pg_temp.seq;
create function pg_temp.mk(p_status public.reservation_status, p_service text, p_party int, p_date date default '1998-11-20', p_from timestamptz default '1998-11-20T12:00Z') returns void language plpgsql as $$
declare
  v_n int := nextval('pg_temp.seq');
  v_id uuid := ('e1000000-0000-4000-8000-' || lpad(v_n::text, 12, '0'))::uuid;
begin
  insert into public.reservation (tenant_id, id, status, business_date, service_key, starts_at, ends_at, party, source)
    values ('11111111-1111-4111-8111-111111111111', v_id, p_status, p_date, p_service, p_from, p_from + interval '2 hours', p_party, 'staff');
  insert into public.reservation_contact (tenant_id, reservation_id, name, phone, email, locale)
    values ('11111111-1111-4111-8111-111111111111', v_id, 'Ospite Riservato ' || v_n, '+3900022' || lpad(v_n::text, 4, '0'), 'ospite.riservato' || v_n || '@example.com', 'it');
end $$;
select pg_temp.mk('accepted', 'pranzo', 2); select pg_temp.mk('arrived', 'pranzo', 4); select pg_temp.mk('pending', 'pranzo', 6); select pg_temp.mk('declined', 'pranzo', 3);
select pg_temp.mk('seated', 'cena', 5, '1998-11-20', '1998-11-20T19:00Z'); select pg_temp.mk('no_show', 'cena', 2, '1998-11-20', '1998-11-20T19:00Z'); select pg_temp.mk('cancelled', 'cena', 4, '1998-11-20', '1998-11-20T19:00Z');
select pg_temp.mk('accepted', 'brunch', 2);
-- Other days and tenant B: never counted for D.
select pg_temp.mk('accepted', 'cena', 8, '1998-11-21', '1998-11-21T19:00Z');
insert into public.reservation (tenant_id, id, status, business_date, service_key, starts_at, ends_at, party, source)
  values ('22222222-2222-4222-8222-222222222222', 'e2000000-0000-4000-8000-000000000001', 'accepted', '1998-11-20', 'cena', '1998-11-20T19:00Z', '1998-11-20T21:00Z', 7, 'staff');
-- One row in each of the other reservation tables, so the chef's zero is not a shrug (the first booking of D: its table, event and e-mail).
insert into public.reservation_table (tenant_id, reservation_id, dining_table_id, assigned_at, assigned_by)
  values ('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000001', '1998-11-10T10:00Z', 'a1000000-0000-4000-8000-00000000000a');
insert into public.reservation_event (tenant_id, reservation_id, kind, data, created_by)
  values ('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-000000000001', 'created_by_staff', '{"party": 2}', 'a1000000-0000-4000-8000-00000000000a');
insert into public.reservation_email (tenant_id, reservation_id, kind)
  values ('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-000000000001', 'accepted');

create function pg_temp.cv(p_date date, p_now timestamptz default '1998-11-20T09:00Z') returns jsonb language sql as $$
  select app.reservations_covers_json('11111111-1111-4111-8111-111111111111', p_date, p_now) $$;

select pg_temp.act_as('owner');

-- 1. The counts -----------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.cv('1998-11-20'),
  jsonb_build_object('businessDate', '1998-11-20', 'services', jsonb_build_array(
    jsonb_build_object('key', 'pranzo', 'name', 'Pranzo', 'reservations', 2, 'covers', 6),
    jsonb_build_object('key', 'cena', 'name', 'Cena', 'reservations', 1, 'covers', 5),
    jsonb_build_object('key', 'brunch', 'name', 'brunch', 'reservations', 1, 'covers', 2))),
  'Pranzo 2 bookings and 6 covers (accepted 2 + arrived 4; pending and declined are out), Cena 1 and 5 (seated; no-show and cancelled are out), then the retired key brunch');
select is((select array_agg(distinct k order by k) from pg_temp.all_keys(pg_temp.cv('1998-11-20')) k), array['businessDate', 'covers', 'key', 'name', 'reservations', 'services'],
  'the reply has exactly the keys businessDate, services, key, name, reservations, covers (recursively)');
select is(pg_temp.cv('1998-11-21') -> 'services' -> 1, jsonb_build_object('key', 'cena', 'name', 'Cena', 'reservations', 1, 'covers', 8), 'another day has its own booking');
select is(pg_temp.cv('1998-11-22'), jsonb_build_object('businessDate', '1998-11-22', 'services', jsonb_build_array(
    jsonb_build_object('key', 'pranzo', 'name', 'Pranzo', 'reservations', 0, 'covers', 0), jsonb_build_object('key', 'cena', 'name', 'Cena', 'reservations', 0, 'covers', 0))),
  'a day with no booking lists the current services with zeros');
select is(app.reservations_covers_json('22222222-2222-4222-8222-222222222222', '1998-11-20', '1998-11-20T09:00Z') -> 'services' -> 1 ->> 'covers', '7', 'tenant B counts its own booking (7) and none of A''s');
select is((pg_temp.cv('1998-11-20') -> 'services' -> 1 ->> 'covers')::int, 5, 'and A''s Cena never includes B''s 7');

-- 2. Parity with the day view (owner, admin, waiter) for the same statuses -----------------------------------------------------------------------------
select is((select string_agg(s ->> 'key' || ':' || (s ->> 'covers'), ',' order by s ->> 'key') from jsonb_array_elements(pg_temp.cv('1998-11-20') -> 'services') s),
          (select string_agg(d.key || ':' || d.covers, ',' order by d.key)
             from (select s ->> 'key' as key, coalesce(sum((r ->> 'party')::int) filter (where r ->> 'status' in ('accepted', 'arrived', 'seated')), 0) as covers
                     from jsonb_array_elements(app.reservations_day_json('11111111-1111-4111-8111-111111111111', 'owner', '1998-11-20', '1998-11-20T09:00Z') -> 'services') s
                     cross join lateral jsonb_array_elements(s -> 'reservations') r group by s ->> 'key') d),
          'for every service covers equals the sum of party over the accepted, arrived and seated rows of reservations_day_json');
select is((app.reservations_day_json('11111111-1111-4111-8111-111111111111', 'owner', '1998-11-20', '1998-11-20T09:00Z') -> 'services' -> 0 -> 'counts' ->> 'covers')::int, 12,
          'and the day view is unchanged: it still counts the pending request (2 + 4 + 6)');

-- 3. Day range -------------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.cv(null) ->> 'businessDate', '1998-11-20', 'p_date null: today''s business date');
select is(pg_temp.err($$select pg_temp.cv('1998-11-26')$$), 'ok', 'today + 6 is allowed');
select is(pg_temp.err($$select pg_temp.cv('1998-11-27')$$), 'P0001 date_out_of_range', 'today + 7: P0001 date_out_of_range');
select is(pg_temp.err($$select pg_temp.cv('1998-11-19')$$), 'P0001 date_out_of_range', 'yesterday: P0001 date_out_of_range');
select is(pg_temp.cv(null, '1998-11-21T00:30Z') ->> 'businessDate', '1998-11-20', 'at 01:30 Rome on the 21st the business day is still the 20th');

-- 4. Privacy: counts only --------------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from (select (pg_temp.cv('1998-11-20'))::text t) x where x.t like '%Ospite%' or x.t like '%+39000%' or x.t like '%example.com%'), 0, 'no value of the reply is a guest name, phone or e-mail');
select is(app.payload_money_keys(pg_temp.cv('1998-11-20')), '{}'::text[], 'no money key');

-- 5. Roles ----------------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.out('select public.reservations_covers(null)'), 'ok', 'owner: public.reservations_covers');
select pg_temp.act_as('admin');
select is(pg_temp.out('select public.reservations_covers(null)'), 'ok', 'admin at aal2: ok');
select pg_temp.act_as('waiter');
select is(pg_temp.out('select public.reservations_covers(null)'), 'ok', 'waiter: ok');
select pg_temp.act_as('chef');
select is(pg_temp.out('select public.reservations_covers(null)'), 'ok', 'chef: ok');
select is(pg_temp.out(format('select public.reservations_covers(%L)', (current_date + 20))), 'P0001 date_out_of_range', 'a date far ahead through the public function: P0001 date_out_of_range');
select pg_temp.act_as('admin1');
select matches(pg_temp.out('select public.reservations_covers(null)'), '^42501 ', 'admin at aal1 (the P2-1 gate): 42501');
select set_config('request.jwt.claims', '', true);
select matches(pg_temp.out('select public.reservations_covers(null)'), '^42501 ', 'a signed-out session: 42501');
select pg_temp.act_as('chef');
select is(pg_temp.cnt('public.reservation'), 0, 'the chef still reads 0 rows from reservation');
select is(pg_temp.cnt('public.reservation_contact'), 0, 'from reservation_contact');
select is(pg_temp.cnt('public.reservation_table'), 0, 'from reservation_table');
select is(pg_temp.cnt('public.reservation_event'), 0, 'from reservation_event');
select is(pg_temp.cnt('public.reservation_email'), 0, 'from reservation_email');
select pg_temp.act_as('owner');
select is(pg_temp.cnt('public.reservation_table') + pg_temp.cnt('public.reservation_event') + pg_temp.cnt('public.reservation_email'), 3, 'while the owner reads the three rows of the setup (the zero is the chef''s RLS)');
select is(pg_temp.cnt('public.reservation_contact') > 0, true, 'and the owner reads contacts');
select pg_temp.act_as('ownerb');
select is(pg_temp.out(format('select public.reservations_covers(%L)', (select app.business_date('22222222-2222-4222-8222-222222222222', now())))), 'ok', 'owner B: ok on its own tenant');
select pg_temp.act_as('owner');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'reservations_covers' and p.prosecdef and p.proconfig = array['search_path=""']
            and has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE') and not has_function_privilege('service_role', p.oid, 'EXECUTE')), 1,
  'public.reservations_covers is a definer with an empty search_path, executable by authenticated only');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname in ('require_covers_reader', 'reservations_covers_json')
            and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('service_role', p.oid, 'EXECUTE'))), 0,
  'the two app functions are executable by no API role');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'reservations_covers_json' and p.prosrc ~* '\y(insert|update|delete|truncate)\y'), 0, 'the reading function has no write');

select * from finish();
rollback;
