-- DS-BQ-2: public.order_view gives the session its opener (display name only, no id), openedAt, openedToday and the coperto
-- {perPerson, vatRate, total} | null, all taken from app.table_session_json so the order read and the tile agree. The coperto's
-- vatRate is a sale fact allowed at that exact path (lead decision Q-D1); every other cost-like key stays forbidden. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'waiter-b@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('e0000000-0000-4000-8000-00000000000e', 'waiter-a2@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'waiter', 'Cameriere B Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('e1000000-0000-4000-8000-00000000000e', '11111111-1111-4111-8111-111111111111', 'e0000000-0000-4000-8000-00000000000e', 'waiter', 'Cameriere Due Demo');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('13000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Tavolo 1 (demo)', 1, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('13000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Tavolo 2 (demo)', 2, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');

create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role, 'aal', 'aal1')::text, true) $$;
create function pg_temp.as_owner() returns void language sql as $$ select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner') $$;
create function pg_temp.as_waiter_a() returns void language sql as $$ select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter') $$;
create function pg_temp.as_waiter_a2() returns void language sql as $$ select pg_temp.act_as('e0000000-0000-4000-8000-00000000000e', '11111111-1111-4111-8111-111111111111', 'waiter') $$;
create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare
  state text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate;
  return state;
end
$$;
create function pg_temp.s1() returns uuid language sql as $$ select '14000000-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.s2() returns uuid language sql as $$ select '14000000-0000-4000-8000-000000000002'::uuid $$;
-- The session object of the order read and the tile of a table.
create function pg_temp.sess(p_session uuid) returns jsonb language sql as $$ select public.order_view(p_session) -> 'session' $$;
create function pg_temp.tile(p_table uuid) returns jsonb language sql as $$
  select jsonb_path_query_first(public.tables_list(), '$.tables[*] ? (@.id == $id)', jsonb_build_object('id', p_table::text)) -> 'session' $$;
-- The keys, at any depth, matching the cost-like regex of the plan (§3.6).
create function pg_temp.bad_keys(j jsonb) returns text[] language sql as $$
  select coalesce(array_agg(distinct k), '{}') from jsonb_path_query(j, 'strict $.**') v,
    lateral jsonb_object_keys(case when jsonb_typeof(v) = 'object' then v else '{}'::jsonb end) k
   where k ~* 'cost|margin|food|gp|vat|recipe' $$;

-- The owner sets the coperto (2,50 at 10 %); waiter A opens table 1 with 4 covers.
select pg_temp.as_owner();
select public.set_sale_settings('{"copertoAmount":2.5,"copertoVatRate":10}');
select pg_temp.as_waiter_a();
select public.open_table('13000000-0000-4000-8000-000000000001', pg_temp.s1(), 4);

-- Waiter B (another waiter, same tenant) reads it.
select pg_temp.as_waiter_a2();
select is((select array_agg(k order by k collate "C") from jsonb_object_keys(pg_temp.sess(pg_temp.s1())) k),
  array['billRequested', 'closed', 'coperto', 'covers', 'id', 'openedAt', 'openedBy', 'openedToday', 'status', 'tableId', 'tableName'],
  'the session has exactly the eleven keys');
select is((select array_agg(k) from jsonb_object_keys(pg_temp.sess(pg_temp.s1()) -> 'openedBy') k), array['displayName'], 'openedBy has the display name and no id');
select is(pg_temp.sess(pg_temp.s1()) -> 'openedBy' ->> 'displayName', 'Cameriere Demo', 'the opener is waiter A, read by waiter B');
select is(pg_temp.sess(pg_temp.s1()) -> 'openedAt', (select to_jsonb(opened_at) from public.table_session where id = pg_temp.s1()), 'openedAt is the session''s opened_at');
select is(pg_temp.sess(pg_temp.s1()) -> 'openedToday', 'true'::jsonb, 'a session opened now was opened today');
select is(pg_temp.sess(pg_temp.s1()) -> 'coperto', '{"perPerson": 2.5, "vatRate": 10, "total": 10}'::jsonb, '4 covers at 2,50 with VAT 10: exactly {perPerson, vatRate, total}');

-- An open session whose business date is yesterday, without a coperto.
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, created_by, updated_by) values
  (pg_temp.s2(), '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000002', 'Tavolo 2 (demo)', 2, 'd1000000-0000-4000-8000-00000000000d',
   app.business_date('11111111-1111-4111-8111-111111111111', now()) - 1, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d');
select is(pg_temp.sess(pg_temp.s2()) -> 'openedToday', 'false'::jsonb, 'a session of yesterday''s business date: openedToday false');
select is(pg_temp.sess(pg_temp.s2()) -> 'coperto', 'null'::jsonb, 'no coperto: JSON null');

-- Covers change: the total follows (computed by Postgres); a changed setting does not touch the open session (frozen).
select pg_temp.as_waiter_a();
select public.update_table_session(pg_temp.s1(), '{"covers":6}');
select is(pg_temp.sess(pg_temp.s1()) -> 'coperto', '{"perPerson": 2.5, "vatRate": 10, "total": 15}'::jsonb, 'after 6 covers the total is 15');
select pg_temp.as_owner();
select public.set_sale_settings('{"copertoAmount":3,"copertoVatRate":22}');
select pg_temp.as_waiter_a();
select is(pg_temp.sess(pg_temp.s1()) -> 'coperto', '{"perPerson": 2.5, "vatRate": 10, "total": 15}'::jsonb, 'a new setting leaves the open session''s coperto frozen');

-- The order read and the tile agree.
select is(pg_temp.sess(pg_temp.s1()) -> 'openedBy' -> 'displayName', pg_temp.tile('13000000-0000-4000-8000-000000000001') -> 'waiter' -> 'displayName', 'order_view and tables_list agree: the opener');
select is(pg_temp.sess(pg_temp.s1()) -> 'openedAt', pg_temp.tile('13000000-0000-4000-8000-000000000001') -> 'openedAt', 'order_view and tables_list agree: openedAt');
select is(pg_temp.sess(pg_temp.s1()) -> 'openedToday', pg_temp.tile('13000000-0000-4000-8000-000000000001') -> 'openedToday', 'order_view and tables_list agree: openedToday (today)');
select is(pg_temp.sess(pg_temp.s2()) -> 'openedToday', pg_temp.tile('13000000-0000-4000-8000-000000000002') -> 'openedToday', 'order_view and tables_list agree: openedToday (yesterday)');
select is(pg_temp.sess(pg_temp.s1()) -> 'coperto', pg_temp.tile('13000000-0000-4000-8000-000000000001') -> 'coperto', 'order_view and tables_list agree: the coperto');
select is(pg_temp.sess(pg_temp.s2()) -> 'coperto', pg_temp.tile('13000000-0000-4000-8000-000000000002') -> 'coperto', 'order_view and tables_list agree: no coperto');

-- The cost scan: the one exempt path is session.coperto.vatRate; everything else stays guarded.
select ok((public.order_view(pg_temp.s1()) #> '{session,coperto,vatRate}') is not null, 'the exempt path exists in the reply (the exemption is not vacuous)');
select is(pg_temp.bad_keys(public.order_view(pg_temp.s1()) #- '{session,coperto,vatRate}'), '{}'::text[], 'the reply has no cost-like key outside session.coperto.vatRate');
select is(pg_temp.bad_keys(jsonb_set(public.order_view(pg_temp.s1()) #- '{session,coperto,vatRate}', '{session,vatRate}', '10')), array['vatRate'], 'a vatRate at session.vatRate is flagged');
select is(pg_temp.bad_keys(jsonb_set(public.order_view(pg_temp.s1()) #- '{session,coperto,vatRate}', '{lines}', '[{"unitCost": 1}]')), array['unitCost'], 'a cost key on a line is flagged');

-- Roles and tenants.
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.err('select public.order_view(pg_temp.s1())'), '42501', 'the chef is refused');
select set_config('request.jwt.claims', '', true);
select is(pg_temp.err('select public.order_view(pg_temp.s1())'), '42501', 'no claims: 42501');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'waiter');
select is(pg_temp.err('select public.order_view(pg_temp.s1())'), 'P0002', 'tenant B''s waiter asking for A''s session: P0002');

select is((select count(*)::int from pg_proc p where p.proname = 'order_view' and p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proconfig = array['search_path=""']
            and (select count(*) from unnest(array['anon', 'authenticated', 'service_role']) r where has_function_privilege(r, p.oid, 'execute')) = 1
            and has_function_privilege('authenticated', p.oid, 'execute')), 1,
  'one order_view, a definer with an empty search_path, executable only by authenticated');

select * from finish();
rollback;
