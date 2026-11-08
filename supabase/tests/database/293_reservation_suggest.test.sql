-- Reservations A4 (docs/plans/2026-11-08-reservations.md §3.1.7, §3.2, §5 A4): the free tables of a time window and the suggestion for a booking. Smallest fit first: a
-- bookable table with enough seats, the fewest seats, then position, then name; otherwise the active group with the fewest seats whose members are all free.
-- Fixture note (a departure from the plan text, which names a group T1+T2): the group here is T1+T5, because a group whose member is held is not free, so it could not be
-- the answer for "T2 and T3 held" if it contained T2. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

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

insert into auth.users (id, email) values ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'), ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'), ('c0000000-0000-4000-8000-00000000000c', 'owner-c@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115'),
  ('33333333-3333-4333-8333-333333333333', 'Osteria Demo C', 'IT22222222220');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '33333333-3333-4333-8333-333333333333', 'c0000000-0000-4000-8000-00000000000c', 'owner', 'Titolare C Demo');
-- Tenant A: T1 (2 seats), T3 (4, position 2), T2 (4, position 3), T4 (6, not bookable), T5 (2). Group T1+T5 (6 seats). Tenant B: one table with 8 seats.
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('13000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Tavolo 1 (demo)', 1, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('13000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Tavolo 3 (demo)', 2, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('13000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Tavolo 2 (demo)', 3, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('13000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'Tavolo 4 (demo)', 4, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('13000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'Tavolo 5 (demo)', 5, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('23000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Tavolo B (demo)', 1, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.dining_table_booking (tenant_id, dining_table_id, bookable, seats) values
  ('11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000001', true, 2),
  ('11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000003', true, 4),
  ('11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000002', true, 4),
  ('11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000004', false, 6),
  ('11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000005', true, 2),
  ('22222222-2222-4222-8222-222222222222', '23000000-0000-4000-8000-000000000001', true, 8);
insert into public.table_group (tenant_id, id, name, seats, created_by) values ('11111111-1111-4111-8111-111111111111', 'e5000000-0000-4000-8000-000000000001', 'T1+T5', 6, 'a1000000-0000-4000-8000-00000000000a');
insert into public.table_group_member (tenant_id, table_group_id, dining_table_id) values
  ('11111111-1111-4111-8111-111111111111', 'e5000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000001'),
  ('11111111-1111-4111-8111-111111111111', 'e5000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000005');

-- The booking to place: party 3, 20:00 to 22:00 on 2026-11-20. And a helper that makes a holder with an assignment.
insert into public.reservation (tenant_id, id, business_date, service_key, starts_at, ends_at, party, privacy_notice_version, privacy_ack_at)
  values ('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-000000000001', '2026-11-20', 'cena', '2026-11-20 20:00+00', '2026-11-20 22:00+00', 3, 'v1', now());
create function pg_temp.hold(p_n integer, p_table uuid, p_status public.reservation_status, p_from timestamptz, p_to timestamptz, p_released boolean default false) returns void language plpgsql as $$
declare
  v_id uuid := ('e1000000-0000-4000-8000-0000000001' || lpad(p_n::text, 2, '0'))::uuid;
begin
  insert into public.reservation (tenant_id, id, status, business_date, service_key, starts_at, ends_at, party, privacy_notice_version, privacy_ack_at)
    values ('11111111-1111-4111-8111-111111111111', v_id, p_status, '2026-11-20', 'cena', p_from, p_to, 2, 'v1', now());
  insert into public.reservation_table (tenant_id, reservation_id, dining_table_id, assigned_at, assigned_by, released_at, released_by)
    values ('11111111-1111-4111-8111-111111111111', v_id, p_table, now(), 'a1000000-0000-4000-8000-00000000000a',
            case when p_released then now() end, case when p_released then 'a1000000-0000-4000-8000-00000000000a'::uuid end);
end
$$;
create function pg_temp.sg(p_res uuid default 'e1000000-0000-4000-8000-000000000001') returns jsonb language sql as $$
  select app.reservation_suggest('11111111-1111-4111-8111-111111111111', p_res)
$$;
create function pg_temp.names(p_j jsonb) returns text language sql as $$
  select coalesce((p_j -> 'suggested' ->> 'kind') || ':' || (select string_agg(t ->> 'name', '+' order by o) from jsonb_array_elements(p_j -> 'suggested' -> 'tables') with ordinality x(t, o)) || ' | ', 'none | ')
         || coalesce((select string_agg((a ->> 'kind') || ':' || (select string_agg(t ->> 'name', '+' order by o) from jsonb_array_elements(a -> 'tables') with ordinality x(t, o)), ' ; ' order by ao)
                        from jsonb_array_elements(p_j -> 'alternatives') with ordinality y(a, ao)), '')
$$;

-- Free tables ----------------------------------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from app.reservation_free_tables('11111111-1111-4111-8111-111111111111', '2026-11-20 20:00+00', '2026-11-20 22:00+00', null)), 5, 'with nothing held, the five active tables of A are free (and none of B''s)');
select is((select string_agg(name, ',' order by position) from app.reservation_free_tables('11111111-1111-4111-8111-111111111111', '2026-11-20 20:00+00', '2026-11-20 22:00+00', null)),
          'Tavolo 1 (demo),Tavolo 3 (demo),Tavolo 2 (demo),Tavolo 4 (demo),Tavolo 5 (demo)', 'in position order');

-- A declined and a cancelled booking still have unreleased assignment rows, and hold nothing.
select pg_temp.hold(7, '13000000-0000-4000-8000-000000000003', 'declined', '2026-11-20 20:00+00', '2026-11-20 22:00+00');
select pg_temp.hold(8, '13000000-0000-4000-8000-000000000002', 'cancelled', '2026-11-20 20:00+00', '2026-11-20 22:00+00');
select is((select count(*)::int from public.reservation_table where released_at is null and reservation_id in ('e1000000-0000-4000-8000-000000000107', 'e1000000-0000-4000-8000-000000000108')), 2, 'a declined and a cancelled booking keep their assignment rows');
select is((select count(*)::int from app.reservation_free_tables('11111111-1111-4111-8111-111111111111', '2026-11-20 20:00+00', '2026-11-20 22:00+00', null) where name in ('Tavolo 2 (demo)', 'Tavolo 3 (demo)')), 2, 'but hold no table');

-- The smallest fit ---------------------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.names(pg_temp.sg()), 'table:Tavolo 3 (demo) | table:Tavolo 2 (demo) ; group:Tavolo 1 (demo)+Tavolo 5 (demo)',
          'party 3: Tavolo 3 (4 seats, positioned before Tavolo 2); the alternatives are Tavolo 2 and the group');
select is(pg_temp.sg() -> 'suggested', jsonb_build_object('kind', 'table', 'tableIds', jsonb_build_array('13000000-0000-4000-8000-000000000003'), 'groupId', null, 'seats', 4,
          'tables', jsonb_build_array(jsonb_build_object('id', '13000000-0000-4000-8000-000000000003', 'name', 'Tavolo 3 (demo)')), 'groupName', null), 'the suggestion is {kind, tableIds, groupId, seats} plus the names');
select is(pg_temp.sg() -> 'alternatives' -> 1 -> 'groupId', '"e5000000-0000-4000-8000-000000000001"'::jsonb, 'a group alternative carries its group id');
select is(pg_temp.sg() -> 'alternatives' -> 1 ->> 'seats', '6', 'and its seats');
select is((pg_temp.sg() -> 'suggested' -> 'tableIds') @> '["13000000-0000-4000-8000-000000000004"]', false, 'Tavolo 4 (not bookable, 6 seats) is never suggested');

-- Overlap --------------------------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.hold(1, '13000000-0000-4000-8000-000000000003', 'accepted', '2026-11-20 20:00+00', '2026-11-20 22:00+00');
select is(pg_temp.names(pg_temp.sg()), 'table:Tavolo 2 (demo) | group:Tavolo 1 (demo)+Tavolo 5 (demo)', 'Tavolo 3 held 20:00 to 22:00: Tavolo 2');
select pg_temp.hold(2, '13000000-0000-4000-8000-000000000002', 'seated', '2026-11-20 19:00+00', '2026-11-20 21:00+00');
select is(pg_temp.names(pg_temp.sg()), 'group:Tavolo 1 (demo)+Tavolo 5 (demo) | ', 'Tavolo 2 and Tavolo 3 held (a seated booking holds too): the group of 6 seats');
select pg_temp.hold(3, '13000000-0000-4000-8000-000000000005', 'arrived', '2026-11-20 21:30+00', '2026-11-20 23:30+00');
select is(pg_temp.names(pg_temp.sg()), 'none | ', 'a group with one member held is not free: no suggestion');
select is(pg_temp.sg() -> 'alternatives', '[]'::jsonb, 'and no alternative');
-- Back to back: an end equal to a start touches, it does not overlap.
select is((select count(*)::int from app.reservation_free_tables('11111111-1111-4111-8111-111111111111', '2026-11-20 21:00+00', '2026-11-20 21:30+00', null) where name = 'Tavolo 2 (demo)'), 1, 'Tavolo 2 (held until 21:00) is free from 21:00');
select is((select count(*)::int from app.reservation_free_tables('11111111-1111-4111-8111-111111111111', '2026-11-20 20:59+00', '2026-11-20 21:30+00', null) where name = 'Tavolo 2 (demo)'), 0, 'but not from 20:59');
select is((select count(*)::int from app.reservation_free_tables('11111111-1111-4111-8111-111111111111', '2026-11-20 21:00+00', '2026-11-20 21:30+00', null) where name = 'Tavolo 5 (demo)'), 1, 'Tavolo 5 (held from 21:30) is free in a window that ends exactly at 21:30');
select is((select count(*)::int from app.reservation_free_tables('11111111-1111-4111-8111-111111111111', '2026-11-20 21:00+00', '2026-11-20 21:31+00', null) where name = 'Tavolo 5 (demo)'), 0, 'and not in one that runs a minute into it');
select is((select count(*)::int from app.reservation_free_tables('11111111-1111-4111-8111-111111111111', '2026-11-20 17:00+00', '2026-11-20 19:00+00', null) where name = 'Tavolo 2 (demo)'), 1, 'Tavolo 2 (held from 19:00) is free in a window that ends at 19:00');
select is((select count(*)::int from app.reservation_free_tables('11111111-1111-4111-8111-111111111111', '2026-11-20 17:00+00', '2026-11-20 19:01+00', null) where name = 'Tavolo 2 (demo)'), 0, 'and not one minute later');
select is((select count(*)::int from app.reservation_free_tables('11111111-1111-4111-8111-111111111111', '2026-11-20 22:00+00', '2026-11-20 23:00+00', null) where name = 'Tavolo 3 (demo)'), 1, 'Tavolo 3 (held until 22:00) is free from 22:00');
select is((select count(*)::int from app.reservation_free_tables('11111111-1111-4111-8111-111111111111', '2026-11-20 21:59+00', '2026-11-20 23:00+00', null) where name = 'Tavolo 3 (demo)'), 0, 'but not from 21:59');

-- Back to back and released ------------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.hold(4, '13000000-0000-4000-8000-000000000001', 'accepted', '2026-11-20 18:00+00', '2026-11-20 20:00+00');
select pg_temp.hold(5, '13000000-0000-4000-8000-000000000001', 'accepted', '2026-11-20 22:00+00', '2026-11-21 00:00+00');
select pg_temp.hold(6, '13000000-0000-4000-8000-000000000001', 'accepted', '2026-11-20 21:00+00', '2026-11-20 23:00+00', true);
select is((select count(*)::int from app.reservation_free_tables('11111111-1111-4111-8111-111111111111', '2026-11-20 20:00+00', '2026-11-20 22:00+00', null) where name = 'Tavolo 1 (demo)'), 1, 'bookings ending at 20:00 and starting at 22:00, and a released assignment, do not block 20:00 to 22:00');
select is((select count(*)::int from app.reservation_free_tables('11111111-1111-4111-8111-111111111111', '2026-11-20 20:00+00', '2026-11-20 22:00+00', null) where name = 'Tavolo 5 (demo)'), 0, 'while the arrived booking on Tavolo 5 blocks it');
select is((select count(*)::int from app.reservation_free_tables('11111111-1111-4111-8111-111111111111', '2026-11-20 20:00+00', '2026-11-20 22:00+00', 'e1000000-0000-4000-8000-000000000103') where name = 'Tavolo 5 (demo)'), 1, 'p_except leaves the named reservation''s own hold out');

-- Party 7, party 5, the booking's own hold (a second booking on a day with no holds) ------------------------------------------------------------------------------------
insert into public.reservation (tenant_id, id, business_date, service_key, starts_at, ends_at, party, privacy_notice_version, privacy_ack_at)
  values ('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-000000000002', '2026-11-21', 'cena', '2026-11-21 20:00+00', '2026-11-21 22:00+00', 7, 'v1', now());
select is(pg_temp.names(pg_temp.sg('e1000000-0000-4000-8000-000000000002')), 'none | ', 'party 7: nothing fits (the 8-seat table is another tenant''s, the 6-seat one is not bookable)');
update public.reservation set party = 5 where id = 'e1000000-0000-4000-8000-000000000002';
select is(pg_temp.names(pg_temp.sg('e1000000-0000-4000-8000-000000000002')), 'group:Tavolo 1 (demo)+Tavolo 5 (demo) | ', 'party 5: only the group of 6 (Tavolo 4 is not bookable)');
update public.reservation set party = 6 where id = 'e1000000-0000-4000-8000-000000000002';
select is(pg_temp.names(pg_temp.sg('e1000000-0000-4000-8000-000000000002')), 'group:Tavolo 1 (demo)+Tavolo 5 (demo) | ', 'party 6: the group of 6 seats (seats equal to the party fit)');
update public.reservation set party = 3 where id = 'e1000000-0000-4000-8000-000000000002';
insert into public.reservation_table (tenant_id, reservation_id, dining_table_id, assigned_at, assigned_by)
  values ('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-000000000002', '13000000-0000-4000-8000-000000000003', now(), 'a1000000-0000-4000-8000-00000000000a');
update public.reservation set status = 'accepted' where id = 'e1000000-0000-4000-8000-000000000002';
select is(pg_temp.names(pg_temp.sg('e1000000-0000-4000-8000-000000000002')), 'table:Tavolo 3 (demo) | table:Tavolo 2 (demo) ; group:Tavolo 1 (demo)+Tavolo 5 (demo)', 'the booking''s own assignment does not block it');
select is(pg_temp.err($$ select app.reservation_suggest('11111111-1111-4111-8111-111111111111', '99999999-9999-4999-8999-999999999999') $$), 'P0002 reservation_not_found', 'an unknown reservation is reservation_not_found');
select is(pg_temp.err($$ select app.reservation_suggest('22222222-2222-4222-8222-222222222222', 'e1000000-0000-4000-8000-000000000001') $$), 'P0002 reservation_not_found', 'and so is another tenant''s');
select is((select count(*)::int from app.reservation_free_tables('22222222-2222-4222-8222-222222222222', '2026-11-20 20:00+00', '2026-11-20 22:00+00', null)), 1, 'tenant B sees only its own table');

-- At most five alternatives, in order, ties broken by position then name (tenant C: eight four-seat tables, two at position 1) -----------------------------------------------
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by)
  select ('33000000-0000-4000-8000-00000000000' || n)::uuid, '33333333-3333-4333-8333-333333333333', nm, pos, 'c1000000-0000-4000-8000-00000000000c', 'c1000000-0000-4000-8000-00000000000c'
    from (values (1, 'Z uno (demo)', 1), (2, 'A uno (demo)', 1), (3, 'Tavolo 3 (demo)', 3), (4, 'Tavolo 4 (demo)', 4), (5, 'Tavolo 5 (demo)', 5), (6, 'Tavolo 6 (demo)', 6), (7, 'Tavolo 7 (demo)', 7), (8, 'Tavolo 8 (demo)', 8)) v (n, nm, pos);
insert into public.dining_table_booking (tenant_id, dining_table_id, bookable, seats)
  select tenant_id, id, true, 4 from public.dining_table where tenant_id = '33333333-3333-4333-8333-333333333333';
insert into public.reservation (tenant_id, id, business_date, service_key, starts_at, ends_at, party, privacy_notice_version, privacy_ack_at)
  values ('33333333-3333-4333-8333-333333333333', 'e3000000-0000-4000-8000-000000000001', '2026-11-20', 'cena', '2026-11-20 20:00+00', '2026-11-20 22:00+00', 2, 'v1', now());
create temp table sc as select app.reservation_suggest('33333333-3333-4333-8333-333333333333', 'e3000000-0000-4000-8000-000000000001') as j;
select is((select jsonb_array_length(j -> 'alternatives') from sc), 5, 'at most five alternatives (eight candidates)');
select is((select j -> 'suggested' -> 'tables' -> 0 ->> 'name' from sc), 'A uno (demo)', 'same seats and position: the name decides');
select is((select string_agg(a -> 'tables' -> 0 ->> 'name', ' ; ' order by o) from sc, jsonb_array_elements(j -> 'alternatives') with ordinality t(a, o)),
          'Z uno (demo) ; Tavolo 3 (demo) ; Tavolo 4 (demo) ; Tavolo 5 (demo) ; Tavolo 6 (demo)', 'the alternatives follow in the same order');

-- Function rules ----------------------------------------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname in ('reservation_free_tables', 'reservation_suggest')), 2, 'the two functions exist');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname in ('reservation_free_tables', 'reservation_suggest') and p.prosecdef and p.proconfig @> array['search_path=""']), 2, 'each is a definer with an empty search_path');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname in ('reservation_free_tables', 'reservation_suggest')
            and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))), 0, 'and no API role can execute it');

select * from finish();
rollback;
