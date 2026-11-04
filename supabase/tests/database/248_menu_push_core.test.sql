-- M23 step 1 (docs/plans/2026-10-31-m23-push-forecast.md §3.2, §5; ADR-026): public.menu_push (append-only log of every start and stop of a push, RLS owner/admin,
-- no write grant), app.menu_push_periods (effective periods of the start rows, computed with lead()), app.push_default_until (the end of the current business
-- day, DST-safe) and the purge list (menu_push immediately before menu_item_price). Two tenants, two staff roles each. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(48);

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
insert into public.menu_item (id, tenant_id, name, category, course_default, created_by, updated_by) values
  ('11000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Spezzatino con polenta (demo)', 'Secondi', 'secondi', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Tagliatelle al ragù (demo)', 'Primi', 'primi', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Acqua (demo)', 'Bevande', 'bevande', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('21000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Acqua B (demo)', 'Bevande', 'bevande', 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');

create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare
  state text;
  msg text;
  cname text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text, cname = constraint_name;
  return state || ' ' || coalesce(nullif(cname, ''), msg);
end
$$;
create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
-- One log row of tenant A by the owner.
create function pg_temp.ins(p_item uuid, p_action text, p_at timestamptz, p_until timestamptz default null, p_price numeric default null,
                            p_keys uuid[] default '{}', p_tenant uuid default '11111111-1111-4111-8111-111111111111') returns void language sql as $$
  insert into public.menu_push (tenant_id, menu_item_id, action, push_until, push_price, batch_keys, created_at, created_by)
  values (p_tenant, p_item, p_action, p_until, p_price, p_keys, p_at,
          case when p_tenant = '11111111-1111-4111-8111-111111111111' then 'a1000000-0000-4000-8000-00000000000a' else 'b1000000-0000-4000-8000-00000000000b' end::uuid)
$$;

-- Shape ---------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.err($$select pg_temp.ins('11000000-0000-4000-8000-000000000001', 'start', '1998-11-04T09:00Z')$$), '23514 menu_push_shape_ck', 'a start without push_until: menu_push_shape_ck');
select is(pg_temp.err($$select pg_temp.ins('11000000-0000-4000-8000-000000000001', 'stop', '1998-11-04T09:00Z', null, 12)$$), '23514 menu_push_shape_ck', 'a stop with a price: menu_push_shape_ck');
select is(pg_temp.err($$select pg_temp.ins('11000000-0000-4000-8000-000000000001', 'stop', '1998-11-04T09:00Z', '1998-11-05T01:00Z')$$), '23514 menu_push_shape_ck', 'a stop with push_until: menu_push_shape_ck');
select is(pg_temp.err($$select pg_temp.ins('11000000-0000-4000-8000-000000000001', 'stop', '1998-11-04T09:00Z', null, null, array['ec000000-0000-4000-8000-0000000000e1']::uuid[])$$), '23514 menu_push_shape_ck', 'a stop with batch keys: menu_push_shape_ck');
select is(pg_temp.err($$select pg_temp.ins('11000000-0000-4000-8000-000000000001', 'start', '1998-11-04T09:00Z', '1998-11-05T01:00Z', 0)$$), '23514 menu_push_push_price_check', 'push_price 0: 23514');
select is(pg_temp.err($$select pg_temp.ins('11000000-0000-4000-8000-000000000001', 'start', '1998-11-04T09:00Z', '1998-11-05T01:00Z', 10000.01)$$), '23514 menu_push_push_price_check', 'push_price above 10000: 23514');
select is(pg_temp.err($$select pg_temp.ins('11000000-0000-4000-8000-000000000001', 'pause', '1998-11-04T09:00Z', '1998-11-05T01:00Z')$$), '23514 menu_push_action_check', 'an action other than start or stop: 23514');
select is(pg_temp.err($$select pg_temp.ins('21000000-0000-4000-8000-000000000001', 'start', '1998-11-04T09:00Z', '1998-11-05T01:00Z')$$), '23503 menu_push_item_fkey', 'another tenant''s item: the composite foreign key refuses (23503)');
select is(pg_temp.err($$select pg_temp.ins('11000000-0000-4000-8000-000000000001', 'start', '1998-11-04T09:00Z', '1998-11-05T01:00Z', 12, array['ec000000-0000-4000-8000-0000000000e1']::uuid[])$$), 'ok', 'a start with a price and a batch key is accepted');
select is(pg_temp.err($$select pg_temp.ins('11000000-0000-4000-8000-000000000001', 'stop', '1998-11-04T14:00Z')$$), 'ok', 'a stop is accepted');
select is(pg_temp.err($$select pg_temp.ins('11000000-0000-4000-8000-000000000003', 'start', '1998-11-04T09:00Z', '1998-11-05T01:00Z')$$), 'ok', 'a start without a price (an unmapped drink) is accepted');
select is((select batch_keys from public.menu_push where menu_item_id = '11000000-0000-4000-8000-000000000003'), '{}'::uuid[], 'batch_keys defaults to the empty array');

-- Append-only ---------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.err($$update public.menu_push set push_price = 5$$), 'P0001 append_only', 'UPDATE of menu_push: append_only');
select is(pg_temp.err($$delete from public.menu_push$$), 'P0001 append_only', 'DELETE of menu_push: append_only');
select is(pg_temp.err($$truncate public.menu_push$$), 'P0001 append_only', 'TRUNCATE of menu_push: append_only');

-- RLS: owner A and admin A read A's rows; chef, waiter and owner B do not ----------------------------------------------------------------------
select pg_temp.ins('21000000-0000-4000-8000-000000000001', 'start', '1998-11-04T09:00Z', '1998-11-05T01:00Z', null, '{}', '22222222-2222-4222-8222-222222222222');
create temporary table seen (who text, n int);
grant all on seen to authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
set local role authenticated;
insert into seen select 'owner_a', count(*)::int from public.menu_push;
reset role;
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
set local role authenticated;
insert into seen select 'admin_a', count(*)::int from public.menu_push;
reset role;
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
set local role authenticated;
insert into seen select 'chef_a', count(*)::int from public.menu_push;
reset role;
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
set local role authenticated;
insert into seen select 'waiter_a', count(*)::int from public.menu_push;
reset role;
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
set local role authenticated;
insert into seen select 'owner_b', count(*)::int from public.menu_push;
reset role;
select is((select n from seen where who = 'owner_a'), 3, 'owner A reads A''s three rows (and not B''s)');
select is((select n from seen where who = 'admin_a'), 3, 'admin A reads them too');
select is((select n from seen where who = 'chef_a'), 0, 'chef A reads 0 rows');
select is((select n from seen where who = 'waiter_a'), 0, 'waiter A reads 0 rows');
select is((select n from seen where who = 'owner_b'), 1, 'owner B reads B''s own row only');
select set_config('request.jwt.claims', '', true);

-- Privileges ----------------------------------------------------------------------------------------------------------------------------
select is((select bool_or(has_table_privilege('authenticated', 'public.menu_push', p)) from unnest(array['insert', 'update', 'delete', 'truncate']) p), false, 'authenticated has no write privilege');
select is(has_table_privilege('authenticated', 'public.menu_push', 'select'), true, 'authenticated may select (RLS filters)');
select is(has_table_privilege('anon', 'public.menu_push', 'select'), false, 'anon reads nothing');
select is(has_table_privilege('service_role', 'public.menu_push', 'select'), true, 'service_role may select');
select is((select bool_or(has_table_privilege('service_role', 'public.menu_push', p)) from unnest(array['insert', 'update', 'delete']) p), false, 'and may not write');
select is((select relrowsecurity from pg_class where oid = 'public.menu_push'::regclass), true, 'RLS is on');
select is((select bool_or(has_function_privilege(r, f, 'execute')) from unnest(array['anon', 'authenticated', 'service_role']) r,
            unnest(array['app.menu_push_periods(uuid, timestamptz, timestamptz)', 'app.push_default_until(uuid, timestamptz)']) f), false, 'no API role can execute the new app.* functions');
select is((select bool_and(prosecdef and proconfig = array['search_path=""']) from pg_proc
            where oid in ('app.menu_push_periods(uuid, timestamptz, timestamptz)'::regprocedure, 'app.push_default_until(uuid, timestamptz)'::regprocedure)), true, 'they are definers with an empty search_path');

-- Periods: a start ends at the earlier of its push_until and the next row of the same item -------------------------------------------------
-- Item 1 already holds a start 1998-11-04 09:00Z (until 11-05 01:00Z) and a stop at 14:00Z.
-- Item 2: a start at 09:00Z and another at 11:00Z. Item 2 of tenant B: one start (never in A's periods).
select pg_temp.ins('11000000-0000-4000-8000-000000000002', 'start', '1998-11-04T09:00Z', '1998-11-05T01:00Z', 10);
select pg_temp.ins('11000000-0000-4000-8000-000000000002', 'start', '1998-11-04T11:00Z', '1998-11-05T01:00Z', 11);
-- Item 3 (the drink): a start on 11-01 whose push_until passed long ago, and the 11-04 start above.
select pg_temp.ins('11000000-0000-4000-8000-000000000003', 'start', '1998-11-01T09:00Z', '1998-11-02T01:00Z');
select is((select effective_end from app.menu_push_periods('11111111-1111-4111-8111-111111111111', '1998-11-04T00:00Z', '1998-11-05T00:00Z')
            where menu_item_id = '11000000-0000-4000-8000-000000000001'), '1998-11-04T14:00Z'::timestamptz, 'a start stopped at 15:00 local ends at the stop');
select is((select array_agg(effective_end order by started_at) from app.menu_push_periods('11111111-1111-4111-8111-111111111111', '1998-11-04T00:00Z', '1998-11-05T00:00Z')
            where menu_item_id = '11000000-0000-4000-8000-000000000002'), array['1998-11-04T11:00Z', '1998-11-05T01:00Z']::timestamptz[], 'a start followed by another ends at the next row; the last ends at its push_until');
select is((select effective_end from app.menu_push_periods('11111111-1111-4111-8111-111111111111', '1998-11-01T00:00Z', '1998-11-02T00:00Z')
            where menu_item_id = '11000000-0000-4000-8000-000000000003'), '1998-11-02T01:00Z'::timestamptz, 'a start whose push_until passed ends at push_until');
select is((select count(*)::int from app.menu_push_periods('11111111-1111-4111-8111-111111111111', '1998-11-06T00:00Z', '1998-11-07T00:00Z')), 0, 'a window after every period finds none');
select is((select count(*)::int from app.menu_push_periods('11111111-1111-4111-8111-111111111111', '1998-11-02T01:00Z', '1998-11-03T00:00Z')), 0, 'a period that ended exactly at the window start is absent');
select is((select count(*)::int from app.menu_push_periods('11111111-1111-4111-8111-111111111111', '1998-10-01T00:00Z', '1998-11-10T00:00Z')), 5, 'a wide window finds the five start rows of tenant A (stops are not periods)');
select is((select count(*)::int from app.menu_push_periods('22222222-2222-4222-8222-222222222222', '1998-10-01T00:00Z', '1998-11-10T00:00Z')), 1, 'tenant B finds only its own');
select is((select push_price from app.menu_push_periods('11111111-1111-4111-8111-111111111111', '1998-11-04T00:00Z', '1998-11-05T00:00Z') where menu_item_id = '11000000-0000-4000-8000-000000000001'),
          12.00::numeric, 'the period carries the push price');
select is((select batch_keys from app.menu_push_periods('11111111-1111-4111-8111-111111111111', '1998-11-04T00:00Z', '1998-11-05T00:00Z') where menu_item_id = '11000000-0000-4000-8000-000000000001'),
          array['ec000000-0000-4000-8000-0000000000e1']::uuid[], 'and the batch keys snapshot');

-- push_default_until --------------------------------------------------------------------------------------------------------------------
select is(app.push_default_until('11111111-1111-4111-8111-111111111111', '1998-11-04T09:00Z'), '1998-11-05T01:00Z'::timestamptz, 'at 10:00 CET the push ends at the next 02:00 (01:00Z)');
select is(app.push_default_until('11111111-1111-4111-8111-111111111111', '1998-11-05T00:30Z'), '1998-11-05T01:00Z'::timestamptz, 'at 01:30 CET, before the cut-off, it still ends at that day''s 02:00');
select is(app.push_default_until('11111111-1111-4111-8111-111111111111', '1998-10-24T20:00Z'), '1998-10-25T00:00Z'::timestamptz, 'autumn night: at 22:00 CEST it ends at the first 02:00 (00:00Z)');
select is(app.push_default_until('11111111-1111-4111-8111-111111111111', '1999-03-27T20:00Z'), '1999-03-28T01:00Z'::timestamptz, 'spring night: at 21:00 CET it ends at 03:00 CEST (01:00Z)');

-- Purge list ------------------------------------------------------------------------------------------------------------------------------
select is((select o from unnest(app.demo_purge_tables()) with ordinality t(n, o) where n = 'menu_push') + 1,
          (select o from unnest(app.demo_purge_tables()) with ordinality t(n, o) where n = 'menu_item_price'), 'menu_push is listed immediately before menu_item_price');
select is((select count(*)::int from unnest(app.demo_purge_tables()) n where n = 'menu_push'), 1, 'and once');
insert into auth.users (id, email) values ('e0000000-0000-4000-8000-0000000000e1', 'owner-d@example.test'), ('e0000000-0000-4000-8000-0000000000e2', 'admin-d@example.test');
insert into public.tenant (id, name, vat_number) values ('33333333-3333-4333-8333-333333333333', 'Osteria Demo D', 'IT22222222226');
select public.begin_demo_data('33333333-3333-4333-8333-333333333333', 'e0000000-0000-4000-8000-0000000000e1', 'Titolare D (demo)', 'e0000000-0000-4000-8000-0000000000e2', 'Admin D (demo)');
insert into public.menu_item (id, tenant_id, name, category, course_default, created_by, updated_by)
  select '31000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'Acqua D (demo)', 'Bevande', 'bevande', u.id, u.id
    from public.app_user u where u.auth_id = 'e0000000-0000-4000-8000-0000000000e1';
insert into public.menu_push (tenant_id, menu_item_id, action, push_until, created_by)
  select '33333333-3333-4333-8333-333333333333', '31000000-0000-4000-8000-000000000001', 'start', '1998-11-05T01:00Z', u.id
    from public.app_user u where u.auth_id = 'e0000000-0000-4000-8000-0000000000e1';
select is((select count(*)::int from public.menu_push where tenant_id = '33333333-3333-4333-8333-333333333333'), 1, 'the demo tenant holds a menu_push row');
select public.purge_demo_data_by_id('33333333-3333-4333-8333-333333333333', 'Osteria Demo D');
select is((select count(*)::int from public.menu_push where tenant_id = '33333333-3333-4333-8333-333333333333'), 0, 'purge_demo_data removes it');
select is((select count(*)::int from public.menu_push where tenant_id = '11111111-1111-4111-8111-111111111111'), 6, 'and leaves tenant A''s rows');
select is((select count(*)::int from public.menu_push where tenant_id = '22222222-2222-4222-8222-222222222222'), 1, 'and tenant B''s');
select is(pg_temp.err($$delete from public.menu_push$$), 'P0001 append_only', 'outside a purge the log is still append-only');

select * from finish();
rollback;
