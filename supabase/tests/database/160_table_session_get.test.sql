-- M17 review fix: table_session_get, the read the API uses to name the waiter in a table_already_open answer (the
-- Postgres DETAIL of that error carries the session id only). Roles first, tenant from the token, public session shape.
-- Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('e0000000-0000-4000-8000-00000000000e', 'waiter-a2@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111',
   'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('e1000000-0000-4000-8000-00000000000e', '11111111-1111-4111-8111-111111111111',
   'e0000000-0000-4000-8000-00000000000e', 'waiter', 'Cameriere Due Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111',
   'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo');
insert into public.dining_table (id, tenant_id, name, position, is_active, created_by, updated_by) values
  ('13000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Tavolo 1 (demo)', 1, true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('13000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Tavolo 2 (demo)', 2, true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('13000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Tavolo 3 (demo)', 3, true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('13000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'Tavolo 4 (demo)', 4, false, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('13000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'Tavolo 5 (demo)', 5, true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('23000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Tavolo 1 (demo)', 1, true, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
-- Tenant A has a coperto of 1,50 at 10 %; tenant B has none.
insert into public.sale_settings (tenant_id, coperto_amount, coperto_vat_rate, created_by, updated_by)
  values ('11111111-1111-4111-8111-111111111111', 1.5, 10, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
-- A closed session of Tavolo 3 (inserted as the migration owner: nothing can close a session yet) and one of tenant B.
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, opened_at, business_date, closed_at, closed_by, created_by, updated_by)
  values ('14000000-0000-4000-8000-000000000009', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000003',
          'Tavolo 3 (demo)', 2, 'd1000000-0000-4000-8000-00000000000d', now() - interval '3 hours', '2026-10-24', now() - interval '1 hour',
          'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'),
         ('24000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', '23000000-0000-4000-8000-000000000001',
          'Tavolo 1 (demo)', 2, 'b1000000-0000-4000-8000-00000000000b', now(), '2026-10-24', null, null,
          'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');

create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
-- state, message and detail.
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
  return state || ' ' || msg;
end
$$;
create function pg_temp.detail(stmt text) returns text language plpgsql as $$
declare
  det text;
begin
  execute stmt;
  return 'no error';
exception when others then
  get stacked diagnostics det = pg_exception_detail;
  return det;
end
$$;
create function pg_temp.op(p_table uuid, p_session uuid, p_covers integer) returns text language sql as $$
  select pg_temp.err(format('select public.open_table(%L::uuid, %L::uuid, %L::integer)', p_table, p_session, p_covers)) $$;
create temp table res (k text primary key, j jsonb);
create function pg_temp.open_as(p_k text, p_table uuid, p_session uuid, p_covers integer) returns void language sql as $$
  insert into res select p_k, public.open_table(p_table, p_session, p_covers) $$;


select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select pg_temp.open_as('s1', '13000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000001', 4);

select is((select array_agg(k order by k collate "C") from jsonb_object_keys(public.table_session_get('14000000-0000-4000-8000-000000000001')) k),
  array['session'], 'the reply is {session}');
select is(public.table_session_get('14000000-0000-4000-8000-000000000001') -> 'session', (select j -> 'session' from res where k = 's1'),
  'the session is the public shape open_table returned');
select is(public.table_session_get('14000000-0000-4000-8000-000000000001') -> 'session' -> 'waiter' ->> 'displayName', 'Cameriere Demo',
  'it names the opener');
select is(pg_temp.err($$select public.table_session_get('14000000-0000-4000-8000-0000000000ff')$$), 'P0002 session_not_found', 'an unknown id: session_not_found');
select is(pg_temp.err($$select public.table_session_get(null)$$), 'P0002 session_not_found', 'a null id: session_not_found');
select is(pg_temp.err($$select public.table_session_get('24000000-0000-4000-8000-0000000000b1')$$), 'P0002 session_not_found',
  'another tenant''s session: session_not_found (never cross-tenant)');

select pg_temp.act_as('e0000000-0000-4000-8000-00000000000e', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(pg_temp.err($$select public.table_session_get('14000000-0000-4000-8000-000000000001')$$), 'ok', 'a second waiter can read it');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.err($$select public.table_session_get('14000000-0000-4000-8000-000000000001')$$), 'ok', 'the owner can');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is(pg_temp.err($$select public.table_session_get('14000000-0000-4000-8000-000000000001')$$), 'ok', 'the admin can');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.err($$select public.table_session_get('14000000-0000-4000-8000-000000000001')$$),
  '42501 permission denied: opening tables needs owner, admin or waiter', 'the chef: 42501, before any lookup');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(pg_temp.err($$select public.table_session_get('14000000-0000-4000-8000-000000000001')$$), 'P0002 session_not_found',
  'tenant B''s owner cannot read tenant A''s session');

select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r
            where has_function_privilege(r, 'public.table_session_get(uuid)', 'execute')), 1, 'only authenticated may execute it');
select is((select p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=""'] from pg_proc p
            where p.oid = 'public.table_session_get(uuid)'::regprocedure), true, 'security definer, stable, empty search_path');
select is((select has_function_privilege('anon', 'public.table_session_get(uuid)', 'execute')), false, 'anon cannot execute it');

select * from finish();
rollback;
