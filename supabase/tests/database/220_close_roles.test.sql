-- M21 step 6 (docs/plans/2026-10-30-m21-bill-close.md §3.1.9, §5; ADR-023; AT5): who may call what. Waiter and chef cannot write day_close
-- (the procedure's role check, and no INSERT grant); the bill and the close are for owner, admin and waiter; the chef gets 42501 everywhere;
-- tenant B never reaches tenant A's sessions or totals; the M21 functions are definers with an empty search_path, executable by
-- `authenticated` (public ones) or by nobody (app.*). Fake data only.
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
  ('11000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Acqua (demo)', 'Bevande', 'bevande', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('21000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Acqua B (demo)', 'Bevande', 'bevande', 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by)
  select ('13000000-0000-4000-8000-00000000000' || n)::uuid, '11111111-1111-4111-8111-111111111111', 'Tavolo ' || n || ' (demo)', n,
         'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a' from generate_series(1, 5) n;
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('23000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Tavolo B (demo)', 1, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
-- Sessions 1..5 of tenant A (one 3,00 line each), session B of tenant B (one 3,00 line).
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, created_by, updated_by)
  select ('14000000-0000-4000-8000-00000000000' || n)::uuid, '11111111-1111-4111-8111-111111111111', ('13000000-0000-4000-8000-00000000000' || n)::uuid,
         'Tavolo ' || n || ' (demo)', 2, 'd1000000-0000-4000-8000-00000000000d', app.business_date('11111111-1111-4111-8111-111111111111', now()) - 1,
         'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d' from generate_series(1, 5) n;
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, created_by, updated_by) values
  ('24000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', '23000000-0000-4000-8000-000000000001', 'Tavolo B (demo)', 2,
   'b1000000-0000-4000-8000-00000000000b', app.business_date('22222222-2222-4222-8222-222222222222', now()) - 1, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by, fired_at, fired_by)
  select ('15000000-0000-4000-8000-00000000000' || n)::uuid, '11111111-1111-4111-8111-111111111111', ('14000000-0000-4000-8000-00000000000' || n)::uuid,
         '11000000-0000-4000-8000-000000000003', 'bevande', 1, 3.00, 10, 'menu', now() - interval '1 day', 'd1000000-0000-4000-8000-00000000000d',
         'd1000000-0000-4000-8000-00000000000d', now() - interval '1 day', 'd1000000-0000-4000-8000-00000000000d' from generate_series(1, 5) n;
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by, fired_at, fired_by)
  values ('25000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', '24000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001',
          'bevande', 1, 3.00, 10, 'menu', now() - interval '1 day', 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b', now() - interval '1 day', 'b1000000-0000-4000-8000-00000000000b');

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
-- A statement run as the API role `authenticated` (privileges apply), with the claims of a person.
create function pg_temp.as_api(p_auth uuid, p_tenant uuid, p_role text, stmt text) returns text language plpgsql as $$
declare
  state text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated', 'tenant_id', p_tenant, 'app_role', p_role)::text, true);
  set local role authenticated;
  execute stmt;
  reset role;
  return 'ok';
exception when others then
  reset role;
  get stacked diagnostics state = returned_sqlstate;
  return state;
end
$$;
create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
create function pg_temp.sid(n int) returns uuid language sql as $$ select ('14000000-0000-4000-8000-00000000000' || n)::uuid $$;
create function pg_temp.closebody(n int) returns jsonb language sql as $$
  select jsonb_build_object('receiptType', 'scontrino', 'receiptNumber', '00' || n, 'paymentType', 'cash', 'billToken', public.session_bill(pg_temp.sid(n), null) ->> 'billToken')
$$;
create function pg_temp.call(p_fn text, p_arg jsonb) returns text language sql as $$ select format('select %s(%L::jsonb)', p_fn, p_arg::text) $$;

-- AT5: waiter and chef cannot write day_close ---------------------------------------------------------------------------------------
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(pg_temp.err($$select public.enter_day_close('{"registerTotal": "10.00"}')$$), '42501 permission denied: the day close needs owner or admin', 'AT5: a waiter cannot enter the day close');
select is(pg_temp.err($$select public.enter_day_close('{"registerTotal": 1, "x": 2}')$$), '42501 permission denied: the day close needs owner or admin', 'and the role is checked before the body is parsed');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.err($$select public.enter_day_close('{"registerTotal": "10.00"}')$$), '42501 permission denied: the day close needs owner or admin', 'AT5: a chef cannot enter the day close');
select is((select count(*)::int from public.day_close), 0, 'and nothing was written');
select is(pg_temp.as_api('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter',
  $$insert into public.day_close (tenant_id, business_date, register_total, created_by) values ('11111111-1111-4111-8111-111111111111', current_date, 1, 'd1000000-0000-4000-8000-00000000000d')$$),
  '42501', 'AT5: a waiter''s direct INSERT is refused (no grant)');
select is(pg_temp.as_api('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef',
  $$insert into public.day_close (tenant_id, business_date, register_total, created_by) values ('11111111-1111-4111-8111-111111111111', current_date, 1, 'c1000000-0000-4000-8000-00000000000c')$$),
  '42501', 'AT5: a chef''s direct INSERT is refused');
select is(pg_temp.as_api('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner',
  $$insert into public.day_close (tenant_id, business_date, register_total, created_by) values ('11111111-1111-4111-8111-111111111111', current_date, 1, 'a1000000-0000-4000-8000-00000000000a')$$),
  '42501', 'the owner''s direct INSERT is refused too: writes go through the procedure only');
select is(pg_temp.as_api('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin',
  $$insert into public.day_close (tenant_id, business_date, register_total, created_by) values ('11111111-1111-4111-8111-111111111111', current_date, 1, 'f1000000-0000-4000-8000-00000000000f')$$),
  '42501', 'and the admin''s');
select is(pg_temp.as_api('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner', $$update public.day_close set register_total = 1$$), '42501', 'UPDATE is refused to the owner (no grant)');
select is(pg_temp.as_api('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner', $$delete from public.day_close$$), '42501', 'DELETE is refused to the owner (no grant)');
select is(pg_temp.as_api('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter', $$select count(*) from public.day_close$$), 'ok',
  'a waiter may select (RLS leaves no rows; checked next)');
select is(pg_temp.err($$select public.app_vs_register(null)$$), '42501 permission denied: the day close needs owner or admin', 'the chef cannot read the report');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(pg_temp.err($$select public.app_vs_register(null)$$), '42501 permission denied: the day close needs owner or admin', 'the waiter cannot read the report');

-- Owner and admin are allowed -------------------------------------------------------------------------------------------------------
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is((public.enter_day_close('{"registerTotal": "10.00"}') ->> 'changed')::boolean, true, 'the owner enters the day close');
select is((public.app_vs_register(null) ->> 'businessDate')::date, app.business_date('11111111-1111-4111-8111-111111111111', now()), 'and reads the report');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is((public.enter_day_close('{"registerTotal": "11.00"}') ->> 'changed')::boolean, true, 'the admin enters the day close');
select is(jsonb_typeof(public.app_vs_register(null)), 'object', 'and reads the report');
select is((select count(*)::int from public.day_close where tenant_id = '11111111-1111-4111-8111-111111111111'), 2, 'two rows now');
select is(pg_temp.as_api('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter', $$select 1 / count(*) from public.day_close$$), '22012',
  'RLS: a waiter reads 0 rows of day_close');
select is(pg_temp.as_api('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef', $$select 1 / count(*) from public.day_close$$), '22012', 'a chef reads 0 rows');
select is(pg_temp.as_api('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner', $$select 1 / (count(*) - 2) from public.day_close$$), '22012',
  'the owner reads exactly the 2 rows of tenant A');

-- The bill and the close: owner, admin, waiter; not the chef -------------------------------------------------------------------------
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.err(format($f$select public.session_bill(%L, null)$f$, pg_temp.sid(1))), '42501 permission denied: opening tables needs owner, admin or waiter', 'the chef cannot read a bill');
select is(pg_temp.err(format($f$select public.close_table(%L, '{}')$f$, pg_temp.sid(1))), '42501 permission denied: opening tables needs owner, admin or waiter', 'the chef cannot close a table');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is((public.session_bill(pg_temp.sid(1), null) ->> 'total')::numeric, 3.00, 'a waiter reads a bill');
select is((public.close_table(pg_temp.sid(1), pg_temp.closebody(1)) ->> 'changed')::boolean, true, 'a waiter closes a table');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is((public.session_bill(pg_temp.sid(2), null) ->> 'total')::numeric, 3.00, 'the owner reads a bill');
select is((public.close_table(pg_temp.sid(2), pg_temp.closebody(2)) ->> 'changed')::boolean, true, 'the owner closes a table');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is((public.close_table(pg_temp.sid(3), pg_temp.closebody(3)) ->> 'changed')::boolean, true, 'the admin closes a table');
select set_config('request.jwt.claims', '', true);
select is(pg_temp.err(format($f$select public.session_bill(%L, null)$f$, pg_temp.sid(4))), '42501 permission denied: opening tables needs owner, admin or waiter', 'no claims: session_bill 42501');
select is(pg_temp.err(format($f$select public.close_table(%L, '{}')$f$, pg_temp.sid(4))), '42501 permission denied: opening tables needs owner, admin or waiter', 'no claims: close_table 42501');
select is(pg_temp.err($$select public.enter_day_close('{}')$$), '42501 permission denied: the day close needs owner or admin', 'no claims: enter_day_close 42501');
select is(pg_temp.err($$select public.app_vs_register(null)$$), '42501 permission denied: the day close needs owner or admin', 'no claims: app_vs_register 42501');

-- Tenancy ---------------------------------------------------------------------------------------------------------------------------
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(pg_temp.err(format($f$select public.session_bill(%L, null)$f$, pg_temp.sid(4))), 'P0002 session_not_found', 'tenant B''s owner gets session_not_found for A''s session (bill)');
select is(pg_temp.err(format($f$select public.close_table(%L, %L::jsonb)$f$, pg_temp.sid(4), '{"receiptType": "scontrino", "receiptNumber": null, "paymentType": "cash", "billToken": "00000000000000000000000000000000"}')),
          'P0002 session_not_found', 'and for the close');
select is((select closed_at is null from public.table_session where id = pg_temp.sid(4)), true, 'A''s session is still open');
select is((public.app_vs_register(null) -> 'app' ->> 'total')::numeric, 0.00, 'B''s report does not count A''s closed tables');
select is((public.app_vs_register(null) -> 'register'), 'null'::jsonb, 'nor A''s register entries');
select is((public.app_vs_register(null) -> 'openTables' ->> 'count')::int, 1, 'and its open tables are B''s own');

-- Function privileges and definer settings --------------------------------------------------------------------------------------------
select is((select bool_or(has_function_privilege(r, f, 'execute')) from unnest(array['anon', 'service_role']) r,
            unnest(array['public.session_bill(uuid, jsonb)', 'public.close_table(uuid, jsonb)', 'public.enter_day_close(jsonb)', 'public.app_vs_register(date)']) f), false,
  'anon and service_role cannot execute the four public functions');
select is((select bool_and(has_function_privilege('authenticated', f, 'execute')) from unnest(array['public.session_bill(uuid, jsonb)', 'public.close_table(uuid, jsonb)',
            'public.enter_day_close(jsonb)', 'public.app_vs_register(date)']) f), true, 'authenticated can');
select is((select string_agg(p.proname::text, ',' order by p.proname::text collate "C") from pg_proc p
            where p.pronamespace = 'app'::regnamespace
              and p.proname in ('cents_to_num', 'split_cents', 'bill_split_check', 'bill_split_items', 'session_bill_json', 'close_session_at', 'require_day_closer',
                                'day_close_range_ok', 'late_op_count', 'app_vs_register_json', 'receipt_types', 'payment_type_codes')
              and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))),
          null, 'no API role executes any M21 app.* function');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace
            and p.proname in ('cents_to_num', 'split_cents', 'bill_split_check', 'bill_split_items', 'session_bill_json', 'close_session_at', 'require_day_closer',
                              'day_close_range_ok', 'late_op_count', 'app_vs_register_json', 'receipt_types', 'payment_type_codes')), 12, 'all twelve app.* helpers exist');
select is((select string_agg(p.proname::text, ',' order by p.proname::text collate "C") from pg_proc p
            where p.proname in ('session_bill', 'close_table', 'enter_day_close', 'app_vs_register', 'session_bill_json', 'close_session_at', 'app_vs_register_json', 'late_op_count', 'day_close_range_ok')
              and p.pronamespace in ('public'::regnamespace, 'app'::regnamespace) and not (p.prosecdef and p.proconfig @> array['search_path=""'])), null,
  'the public functions and the app.* functions that read tables are definers with search_path = ''''');
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname in ('session_bill', 'close_table', 'enter_day_close', 'app_vs_register')
             and proname ~* '(cost|margin|price)'), 0, 'none of the four public names is cost-named');
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname ~* '(cost|margin|price)'), 14,
  'the cost-named public functions are still the 14 that 059 and 214 pin');
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname in ('session_bill', 'close_table', 'enter_day_close', 'app_vs_register')), 4,
  'exactly one definition of each public function');
select is((select relrowsecurity from pg_class where oid = 'public.day_close'::regclass), true, 'RLS is on for day_close');
select is((select count(*)::int from pg_policy where polrelid = 'public.day_close'::regclass), 1, 'with its one select policy');

select * from finish();
rollback;
