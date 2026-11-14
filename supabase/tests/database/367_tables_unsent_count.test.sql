-- BQ-1: public.tables_list gives every tile's session an integer unsentCount (drafts that are not fired, not voided and not
-- "a seguire": the server half of unsentLines in src/lib/orders/order-view.ts). One helper, app.session_unsent_lines, holds the rule.
-- The bill and close_table keep their wider rule (any draft) on purpose. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

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
  ('21000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Acqua B (demo)', 'Bevande', 'bevande', 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by)
select ('13000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, '11111111-1111-4111-8111-111111111111',
       'Tavolo ' || n || ' (demo)', n, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'
  from generate_series(1, 4) n;
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by)
  values ('23000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Tavolo 1 (demo)', 1,
          'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');

create function pg_temp.tid(n int) returns uuid language sql as $$ select ('13000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.sid(n int) returns uuid language sql as $$ select ('14000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role, 'aal', case when app_role = 'admin' then 'aal2' else 'aal1' end)::text, true)
$$;
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
create function pg_temp.tbl(j jsonb, p_id uuid) returns jsonb language sql as $$
  select jsonb_path_query_first(j, '$.tables[*] ? (@.id == $id)', jsonb_build_object('id', p_id::text)) $$;
-- The unsentCount of a table's session in a tables_list reply.
create function pg_temp.uc(j jsonb, n int) returns jsonb language sql as $$ select pg_temp.tbl(j, pg_temp.tid(n)) -> 'session' -> 'unsentCount' $$;
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
end
$$;
create function pg_temp.sess(p_n int, p_table int, p_closed boolean) returns void language sql as $$
  insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_at, opened_by, business_date,
      closed_at, closed_by, created_by, updated_by)
  values (pg_temp.sid(p_n), '11111111-1111-4111-8111-111111111111', pg_temp.tid(p_table), 'Tavolo ' || p_table || ' (demo)', 2,
          clock_timestamp() - interval '2 hours', 'd1000000-0000-4000-8000-00000000000d',
          app.business_date('11111111-1111-4111-8111-111111111111', clock_timestamp()),
          case when p_closed then clock_timestamp() - interval '1 hour' end, case when p_closed then 'd1000000-0000-4000-8000-00000000000d'::uuid end,
          'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d') $$;
-- One order line of tenant A (the owner fixture writes states no procedure can write directly): draft, fired, voided (after fire) or removed (before fire).
create function pg_temp.addl(p_n int, p_session uuid, p_state text, p_segue boolean default false) returns void language sql as $$
  insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, segue, unit_price, vat_rate, price_source,
                                 client_updated_at, created_by, updated_by, fired_at, fired_by, voided_at, voided_by, void_reason)
  values (('15000000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid, '11111111-1111-4111-8111-111111111111', p_session,
          '11000000-0000-4000-8000-000000000001', 'secondi', 1, p_segue, 14.00, 10, 'menu', '1998-11-04 20:00+00',
          'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d',
          case when p_state in ('fired', 'voided') then clock_timestamp() end, case when p_state in ('fired', 'voided') then 'd1000000-0000-4000-8000-00000000000d'::uuid end,
          case when p_state in ('voided', 'removed') then clock_timestamp() end, case when p_state in ('voided', 'removed') then 'd1000000-0000-4000-8000-00000000000d'::uuid end,
          case when p_state = 'voided' then 'wrong_dish' when p_state = 'removed' then 'entry_removed' end)
$$;

select pg_temp.sess(1, 1, false);   -- the mixed session
select pg_temp.sess(2, 2, false);   -- no lines
select pg_temp.sess(3, 3, true);    -- closed today
select pg_temp.sess(4, 4, false);   -- a draft that is then fired
-- S1: 2 plain drafts, 1 "a seguire" draft, 1 fired, 1 fired then voided, 1 removed before it was sent.
select pg_temp.addl(1, pg_temp.sid(1), 'draft');
select pg_temp.addl(2, pg_temp.sid(1), 'draft');
select pg_temp.addl(3, pg_temp.sid(1), 'draft', true);
select pg_temp.addl(4, pg_temp.sid(1), 'fired');
select pg_temp.addl(5, pg_temp.sid(1), 'voided');
select pg_temp.addl(6, pg_temp.sid(1), 'removed');
-- S3: closed today, everything was sent.
select pg_temp.addl(7, pg_temp.sid(3), 'fired');
-- S4: two drafts.
select pg_temp.addl(8, pg_temp.sid(4), 'draft');
select pg_temp.addl(9, pg_temp.sid(4), 'draft');
-- Tenant B: its own open session with 3 drafts.
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, created_by, updated_by)
  values ('24000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', '23000000-0000-4000-8000-000000000001', 'Tavolo 1 (demo)', 2,
          'b1000000-0000-4000-8000-00000000000b', app.business_date('22222222-2222-4222-8222-222222222222', clock_timestamp()),
          'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by)
select ('25000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, '22222222-2222-4222-8222-222222222222', '24000000-0000-4000-8000-0000000000b1',
       '21000000-0000-4000-8000-000000000001', 'bevande', 1, 3.00, 10, 'menu', '1998-11-04 20:00+00',
       'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b'
  from generate_series(1, 3) n;

-- The helper: one definition, the rule in its text, no API role can run it.
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'session_unsent_lines'
              and pg_get_function_identity_arguments(p.oid) = 'p_tenant uuid, p_session_ids uuid[]'), 1, 'app.session_unsent_lines(uuid, uuid[]) exists once');
select is((select prosrc ~* 'state = ''draft''' and prosrc ~* 'not l\.segue' from pg_proc where oid = 'app.session_unsent_lines(uuid, uuid[])'::regprocedure), true,
  'and it counts the drafts that are not "a seguire"');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r
            where has_function_privilege(r, 'app.session_unsent_lines(uuid, uuid[])', 'execute')), 0, 'no API role can execute it');
select is((select count(*)::int from app.session_unsent_lines('11111111-1111-4111-8111-111111111111', array[pg_temp.sid(1), pg_temp.sid(2), '24000000-0000-4000-8000-0000000000b1'::uuid])), 1,
  'the helper returns only sessions that have unsent lines, and ignores a session of another tenant');
select is((select unsent_lines from app.session_unsent_lines('22222222-2222-4222-8222-222222222222', array['24000000-0000-4000-8000-0000000000b1'::uuid])), 3, 'and counts tenant B''s drafts for tenant B');

-- The tile, as the waiter.
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
create temp table lst (j jsonb);
insert into lst select public.tables_list();
select is((select array_agg(x order by x collate "C") from lst, jsonb_object_keys(pg_temp.tbl(j, pg_temp.tid(2)) -> 'session') x),
  array['billRequested', 'coperto', 'covers', 'id', 'openedAt', 'openedToday', 'unsentCount', 'waiter'], 'a session gets unsentCount beside the seven documented keys');
select is((select pg_temp.uc(j, 1) from lst), '2'::jsonb, '2 plain drafts count; the "a seguire" draft, the fired, the voided and the removed line do not');
select is((select jsonb_typeof(pg_temp.uc(j, 1)) from lst), 'number', 'and it is a JSON number');
select is((select pg_temp.uc(j, 2) from lst), '0'::jsonb, 'a session with no lines: 0');
select is((select pg_temp.uc(j, 3) from lst), '0'::jsonb, 'a session closed today: 0');
select is((select pg_temp.uc(j, 4) from lst), '2'::jsonb, 'two drafts: 2');
select is((select pg_temp.tbl(j, pg_temp.tid(1)) ? 'unsentCount' from lst), false, 'unsentCount is inside the session, not on the tile');

-- A draft that is then fired drops the count by 1.
reset role;
update public.order_line set fired_at = clock_timestamp(), fired_by = 'd1000000-0000-4000-8000-00000000000d'
 where id = '15000000-0000-4000-8000-000000000008';
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is((select pg_temp.uc(public.tables_list(), 4)), '1'::jsonb, 'after one of the two drafts is fired: 1');
reset role;
update public.order_line set voided_at = clock_timestamp(), voided_by = 'd1000000-0000-4000-8000-00000000000d', void_reason = 'entry_removed'
 where id = '15000000-0000-4000-8000-000000000009';
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is((select pg_temp.uc(public.tables_list(), 4)), '0'::jsonb, 'and after the other one is removed: 0');

-- Tenant isolation.
select is((select count(*)::int from lst, jsonb_array_elements(j -> 'tables') t where t -> 'session' ->> 'id' = '24000000-0000-4000-8000-0000000000b1'), 0, 'tenant B''s session is not in tenant A''s payload');
select is((select pg_temp.uc(j, 1) from lst), '2'::jsonb, 'and tenant B''s drafts changed nothing in A''s counts');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is((select pg_temp.tbl(public.tables_list(), '23000000-0000-4000-8000-000000000001') -> 'session' -> 'unsentCount'), '3'::jsonb, 'owner B sees B''s count');
select is((select jsonb_array_length(public.tables_list() -> 'tables')), 1, 'and only B''s table');

-- Roles: waiter, owner and admin get the same number; chef is refused.
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is((select pg_temp.uc(public.tables_list(), 1)), '2'::jsonb, 'owner A: the same 2');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is((select pg_temp.uc(public.tables_list(), 1)), '2'::jsonb, 'admin A: the same 2');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is((select pg_temp.uc(public.tables_list(), 1)), '2'::jsonb, 'waiter A: the same 2');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.err('select public.tables_list()'), '42501 permission denied: the service menu and tables need owner, admin or waiter', 'chef: 42501');

-- The waiter still sees no cost key anywhere, and the read writes nothing.
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is((select count(*)::int from pg_temp.all_keys(public.tables_list()) k where k ~* 'cost|margin|gp|food|eur$|recipe'), 0, 'a recursive key scan finds no cost, margin, GP, food, eur or recipe key');
select is((select count(*)::int from public.table_session), 5, 'the read wrote nothing (sessions)');
select is((select count(*)::int from public.order_line), 12, 'the read wrote nothing (lines)');
-- Every shown session has the field.
select is((select count(*)::int from jsonb_array_elements(public.tables_list() -> 'tables') t
            where t -> 'session' <> 'null'::jsonb and jsonb_typeof(t -> 'session' -> 'unsentCount') is distinct from 'number'), 0, 'every session in the reply has a numeric unsentCount');
select is((select bool_and((t -> 'session' ->> 'unsentCount')::int >= 0) from jsonb_array_elements(public.tables_list() -> 'tables') t where t -> 'session' <> 'null'::jsonb), true, 'and none is negative');

select * from finish();
rollback;
