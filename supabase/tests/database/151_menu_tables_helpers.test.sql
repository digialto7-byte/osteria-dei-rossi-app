-- M17 step 2: the helpers of schema app (plan §3.1.6, §3.1.9, §3.2; AT1 derivation table, AT3 coperto): the role gates,
-- the status derivation and its stub plug-in, the price in force (several candidates), the coperto and the default
-- VAT rate. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(51);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test');
insert into public.tenant (id, name, vat_number, settings) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000', '{"sale_vat_pct": 10}'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115', '{"sale_vat_pct": 22}'),
  ('33333333-3333-4333-8333-333333333333', 'Osteria Demo C', 'IT22222222229', '{"sale_vat_pct": 12}');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111',
   'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111',
   'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo');

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
create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;

-- ----------------------------------------------------------------------------------------------------------------
-- app.table_status: the AT1 derivation table (closed > bill requested > courses sent > open > free).
select is(app.table_status(false, null, null, null), 'free', 'no session: free');
select is(app.table_status(false, null, null, 5), 'free', 'no session wins over a stray line count');
select is(app.table_status(true, null, null, 0), 'open', 'a session with no fired line: open');
select is(app.table_status(true, null, null, null), 'open', 'a null line count: open');
select is(app.table_status(true, null, null, 2), 'courses_sent', 'any fired line: courses_sent');
select is(app.table_status(true, null, now(), 2), 'bill_requested', 'bill requested wins over courses sent');
select is(app.table_status(true, null, now(), 0), 'bill_requested', 'bill requested with no lines');
select is(app.table_status(true, now(), now(), 3), 'closed', 'closed wins over everything');
select is(app.table_status(true, now(), null, 0), 'closed', 'closed without a bill flag');

-- ----------------------------------------------------------------------------------------------------------------
-- Fixture: tables and sessions (tenant A), as the migration owner.
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by)
select ('13000000-0000-4000-8000-00000000000' || n)::uuid, '11111111-1111-4111-8111-111111111111', 'Tavolo ' || n || ' (demo)', n,
       'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'
  from generate_series(1, 5) n;
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date,
                                  bill_requested_at, bill_requested_by, closed_at, closed_by, created_by, updated_by)
values
  ('14000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000001',
   'Tavolo 1 (demo)', 2, 'd1000000-0000-4000-8000-00000000000d', '2026-10-24', null, null, null, null,
   'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'),
  ('14000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000002',
   'Tavolo 2 (demo)', 2, 'd1000000-0000-4000-8000-00000000000d', '2026-10-24', now(), 'd1000000-0000-4000-8000-00000000000d', null, null,
   'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'),
  ('14000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000003',
   'Tavolo 3 (demo)', 2, 'd1000000-0000-4000-8000-00000000000d', '2026-10-24', null, null, now(), 'd1000000-0000-4000-8000-00000000000d',
   'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'),
  ('14000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000004',
   'Tavolo 4 (demo)', 3, 'd1000000-0000-4000-8000-00000000000d', '2026-10-24', null, null, null, null,
   'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d');

-- The stub returns no row: an open session is open, a bill-requested one is bill_requested, a closed one is closed.
select is((select count(*)::int from app.session_fired_lines('11111111-1111-4111-8111-111111111111',
            array['14000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000002']::uuid[])), 0,
  'the M17 stub returns no row');
create function pg_temp.st(p_tenant uuid, p_id uuid) returns text language sql as $$
  select s.status from app.session_statuses(p_tenant, array[p_id]) s
$$;
select is(pg_temp.st('11111111-1111-4111-8111-111111111111', '14000000-0000-4000-8000-000000000001'), 'open', 'stub: an open session is open');
select is(pg_temp.st('11111111-1111-4111-8111-111111111111', '14000000-0000-4000-8000-000000000002'), 'bill_requested', 'stub: bill_requested');
select is(pg_temp.st('11111111-1111-4111-8111-111111111111', '14000000-0000-4000-8000-000000000003'), 'closed', 'stub: closed');
select is(pg_temp.st('22222222-2222-4222-8222-222222222222', '14000000-0000-4000-8000-000000000001'), null,
  'another tenant''s session id gives no row');
select is((select count(*)::int from app.session_statuses('11111111-1111-4111-8111-111111111111',
  array['14000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000002', '14000000-0000-4000-8000-000000000003',
        '14000000-0000-4000-8000-000000000004', 'ffffffff-ffff-4fff-8fff-ffffffffffff']::uuid[])), 4,
  'one row per known session, unknown ids give none');

-- M19 plug-in: the stub is replaced (same signature) and the status function is untouched.
create or replace function app.session_fired_lines(p_tenant uuid, p_session_ids uuid[])
  returns table (table_session_id uuid, fired_lines integer)
  language sql stable set search_path = ''
as $$ select s.id, 1 from public.table_session s where s.tenant_id = p_tenant and s.id = '14000000-0000-4000-8000-000000000001' $$;
select is(pg_temp.st('11111111-1111-4111-8111-111111111111', '14000000-0000-4000-8000-000000000001'), 'courses_sent',
  'plug-in: a session with a fired line is courses_sent');
select is(pg_temp.st('11111111-1111-4111-8111-111111111111', '14000000-0000-4000-8000-000000000004'), 'open',
  'plug-in: another open session stays open');
update public.table_session set bill_requested_at = now(), bill_requested_by = 'd1000000-0000-4000-8000-00000000000d'
 where id = '14000000-0000-4000-8000-000000000001';
select is(pg_temp.st('11111111-1111-4111-8111-111111111111', '14000000-0000-4000-8000-000000000001'), 'bill_requested',
  'plug-in: a bill-requested session with fired lines is bill_requested');
select is(pg_temp.st('11111111-1111-4111-8111-111111111111', '14000000-0000-4000-8000-000000000002'), 'bill_requested',
  'plug-in: unaffected sessions keep their status');

-- ----------------------------------------------------------------------------------------------------------------
-- app.menu_item_price_at: the price in force (>= 2 candidates).
insert into public.menu_item (id, tenant_id, name, category, course_default, created_by, updated_by) values
  ('11000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Spezzatino (demo)', 'Secondi', 'secondi',
   'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Acqua (demo)', 'Bevande', 'bevande',
   'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.menu_item_price (tenant_id, menu_item_id, price, vat_rate, valid_from, created_by) values
  ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000001', 12, 10, now() - interval '3 hours', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000001', 14, 22, now() - interval '2 hours', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000001', 99, 4, now() + interval '1 hour', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000002', 2, 10, now() - interval '1 day', 'a1000000-0000-4000-8000-00000000000a');
select results_eq(
  $$ select price, vat_rate from app.menu_item_price_at('11111111-1111-4111-8111-111111111111',
       array['11000000-0000-4000-8000-000000000001']::uuid[], now() - interval '150 minutes') $$,
  $$ values (12.00::numeric, 10.00::numeric) $$, 'between the first and second row: the first (12,00 / 10)');
select results_eq(
  $$ select price, vat_rate from app.menu_item_price_at('11111111-1111-4111-8111-111111111111',
       array['11000000-0000-4000-8000-000000000001']::uuid[], now()) $$,
  $$ values (14.00::numeric, 22.00::numeric) $$, 'now: the second row (14,00 / 22); the future row is ignored');
select is((select count(*)::int from app.menu_item_price_at('11111111-1111-4111-8111-111111111111',
       array['11000000-0000-4000-8000-000000000001']::uuid[], now() - interval '4 hours')), 0, 'before the first row: no row');
select results_eq(
  $$ select price from app.menu_item_price_at('11111111-1111-4111-8111-111111111111',
       array['11000000-0000-4000-8000-000000000001']::uuid[], now() + interval '2 hours') $$,
  $$ values (99.00::numeric) $$, 'after the future row starts: the future row');
select results_eq(
  $$ select menu_item_id, price from app.menu_item_price_at('11111111-1111-4111-8111-111111111111',
       array['11000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000002']::uuid[], now())
      order by menu_item_id $$,
  $$ values ('11000000-0000-4000-8000-000000000001'::uuid, 14.00::numeric), ('11000000-0000-4000-8000-000000000002'::uuid, 2.00::numeric) $$,
  'two items in one call: one row each');
select is((select valid_from from app.menu_item_price_at('11111111-1111-4111-8111-111111111111',
       array['11000000-0000-4000-8000-000000000002']::uuid[], now())), (select valid_from from public.menu_item_price
        where menu_item_id = '11000000-0000-4000-8000-000000000002'), 'valid_from of the row in force is returned');
select is((select count(*)::int from app.menu_item_price_at('22222222-2222-4222-8222-222222222222',
       array['11000000-0000-4000-8000-000000000001']::uuid[], now())), 0, 'another tenant gets no row for the item');
select is((select count(*)::int from app.menu_item_price_at('11111111-1111-4111-8111-111111111111', null, now())), 0, 'a null item list gives no row');

-- ----------------------------------------------------------------------------------------------------------------
-- app.coperto_settings and app.default_vat_rate: two tenants with different values.
insert into public.sale_settings (tenant_id, coperto_amount, coperto_vat_rate, created_by, updated_by)
  values ('11111111-1111-4111-8111-111111111111', 1.5, 10, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
select results_eq($$ select amount, vat_rate from app.coperto_settings('11111111-1111-4111-8111-111111111111') $$,
  $$ values (1.50::numeric, 10.00::numeric) $$, 'tenant A: coperto 1,50 at 10 %');
select is((select count(*)::int from app.coperto_settings('22222222-2222-4222-8222-222222222222')), 0, 'tenant B: no coperto, no row');
insert into public.sale_settings (tenant_id, coperto_amount, coperto_vat_rate, created_by, updated_by)
  values ('22222222-2222-4222-8222-222222222222', null, null, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
select is((select count(*)::int from app.coperto_settings('22222222-2222-4222-8222-222222222222')), 0, 'a cleared settings row (both null): no row');
select is(app.default_vat_rate('11111111-1111-4111-8111-111111111111'), 10::numeric, 'default VAT rate, tenant A (sale_vat_pct 10): 10');
select is(app.default_vat_rate('22222222-2222-4222-8222-222222222222'), 22::numeric, 'tenant B (sale_vat_pct 22): 22');
select is(app.default_vat_rate('33333333-3333-4333-8333-333333333333'), null, 'tenant C (sale_vat_pct 12, not an allowed rate): null');

-- ----------------------------------------------------------------------------------------------------------------
-- Role gates.
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.err('select app.require_service_reader()'), 'ok', 'owner passes require_service_reader');
select is(pg_temp.err('select app.require_table_operator()'), 'ok', 'owner passes require_table_operator');
select is(pg_temp.err('select app.require_menu_writer()'), 'ok', 'owner passes require_menu_writer');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is(pg_temp.err('select app.require_service_reader()'), 'ok', 'admin passes require_service_reader');
select is(pg_temp.err('select app.require_table_operator()'), 'ok', 'admin passes require_table_operator');
select is(pg_temp.err('select app.require_menu_writer()'), 'ok', 'admin passes require_menu_writer');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(pg_temp.err('select app.require_service_reader()'), 'ok', 'waiter passes require_service_reader');
select is(pg_temp.err('select app.require_table_operator()'), 'ok', 'waiter passes require_table_operator');
select matches(pg_temp.err('select app.require_menu_writer()'), '^42501 ', 'waiter fails require_menu_writer');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select matches(pg_temp.err('select app.require_service_reader()'), '^42501 ', 'chef fails require_service_reader');
select matches(pg_temp.err('select app.require_table_operator()'), '^42501 ', 'chef fails require_table_operator');
select matches(pg_temp.err('select app.require_menu_writer()'), '^42501 ', 'chef fails require_menu_writer');
select set_config('request.jwt.claims', '{}', true);
select matches(pg_temp.err('select app.require_service_reader()'), '^42501 ', 'no claims: require_service_reader fails');
select matches(pg_temp.err('select app.require_table_operator()'), '^42501 ', 'no claims: require_table_operator fails');
select matches(pg_temp.err('select app.require_menu_writer()'), '^42501 ', 'no claims: require_menu_writer fails');

-- No API role executes any function of the helpers migration.
select is((select count(*)::int
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
                  unnest(array['anon', 'authenticated', 'service_role']) r
            where n.nspname = 'app'
              and p.proname in ('require_service_reader', 'require_table_operator', 'require_menu_writer', 'table_status',
                                'session_fired_lines', 'session_statuses', 'menu_item_price_at', 'coperto_settings',
                                'default_vat_rate')
              and has_function_privilege(r, p.oid, 'execute')), 0,
  'no API role can execute any helper of this migration');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'app'
              and p.proname in ('require_service_reader', 'require_table_operator', 'require_menu_writer', 'table_status',
                                'session_fired_lines', 'session_statuses', 'menu_item_price_at', 'coperto_settings',
                                'default_vat_rate')), 9, 'all nine helpers exist');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'app' and p.prosecdef
              and p.proname in ('session_fired_lines', 'session_statuses', 'menu_item_price_at', 'coperto_settings', 'default_vat_rate')
              and p.proconfig is distinct from array['search_path=""']), 0,
  'the definer helpers have an empty search_path');

select * from finish();
rollback;
