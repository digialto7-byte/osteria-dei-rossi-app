-- M9 step 10 (migration 20261024100200_payable_alert_kinds.sql): the four payable alert kinds are in the
-- registry, cost-bearing and for the owner alone; only the owner reads their alerts (RLS); the kind list the
-- integration parity test reads holds the M6, M8 and M9 kinds.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111',
   'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111',
   'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo');

-- The registry -------------------------------------------------------------------------------------------
select is((select string_agg(kind || ':' || cost_bearing || ':' || default_severity || ':' || default_audience::text,
                             ' ' order by kind collate "C")
             from app.alert_kind where kind like 'payable%'),
  'payable_due_7d:true:info:{owner} payable_due_today:true:warning:{owner} payable_overdue_3d:true:critical:{owner} payables_weekly_digest:true:info:{owner}',
  'the four kinds: cost-bearing, owner only, with their severities');
select is((select string_agg(kind || ':' || cost_bearing, ' ' order by kind collate "C") from public.alert_kind_list()),
  'payable_due_7d:true payable_due_today:true payable_overdue_3d:true payables_weekly_digest:true price_variance:true test_alert:false test_alert_kitchen:false',
  'alert_kind_list = the M6, M8 and M9 kinds');

-- The guards ------------------------------------------------------------------------------------------------
select is((select count(*)::int from app.raise_alert('11111111-1111-4111-8111-111111111111', 'payable_due_7d',
    'payable', 'e0000000-0000-4000-8000-000000000001', '{"amount_eur": 1234.5}')), 1,
  'a payable alert with money in the payload is accepted (cost-bearing)');
select is((select audience_roles::text from public.alert where kind = 'payable_due_7d'), '{owner}',
  'and its audience is the owner alone');
select throws_ok($$ select * from app.raise_alert('11111111-1111-4111-8111-111111111111', 'payable_due_7d',
    'payable', 'e0000000-0000-4000-8000-000000000002', '{}', null, '{chef}') $$, 'P0001', 'alert_audience_cost',
  'a chef audience on payable_due_7d is refused');
select throws_ok($$ select * from app.raise_alert('11111111-1111-4111-8111-111111111111', 'payables_weekly_digest',
    'tenant', '11111111-1111-4111-8111-111111111111', '{}', null, '{chef}') $$, 'P0001', 'alert_audience_cost',
  'a chef audience on the digest is refused');
select throws_ok($$ select * from app.raise_alert('11111111-1111-4111-8111-111111111111', 'payable_due_today',
    'payable', 'e0000000-0000-4000-8000-000000000003', '{}', null, '{waiter}') $$, 'P0001', 'alert_audience_invalid',
  'a waiter audience is refused');
select throws_ok($$ select * from app.raise_alert('11111111-1111-4111-8111-111111111111', 'payable_overdue_3d',
    'payable', 'e0000000-0000-4000-8000-000000000004', '{}', null, '{admin}') $$, 'P0001', 'alert_audience_invalid',
  'an admin audience is refused');

-- RLS: one alert of each kind, only the owner reads them --------------------------------------------------------------
select app.raise_alert('11111111-1111-4111-8111-111111111111', 'payable_due_today', 'payable',
  'e0000000-0000-4000-8000-000000000005', '{"amount_eur": 10}');
select app.raise_alert('11111111-1111-4111-8111-111111111111', 'payable_overdue_3d', 'payable',
  'e0000000-0000-4000-8000-000000000006', '{"amount_eur": 10}');
select app.raise_alert('11111111-1111-4111-8111-111111111111', 'payables_weekly_digest', 'tenant',
  '11111111-1111-4111-8111-111111111111', '{"amount_eur": 10}');
create function pg_temp.act_as(auth_id uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', auth_id, 'role', 'authenticated',
    'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', app_role)::text, true)
$$;
grant execute on function pg_temp.act_as(uuid, text) to authenticated;
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', 'owner');
select is((select count(*)::int from public.alert where kind like 'payable%'), 4, 'owner A reads all four');
select is((select cost_bearing from public.alert where kind = 'payable_due_7d'), true, 'flagged cost-bearing');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', 'chef');
select is((select count(*)::int from public.alert where kind like 'payable%'), 0, 'chef A reads none');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', 'admin');
select is((select count(*)::int from public.alert where kind like 'payable%'), 0, 'admin A reads none');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', 'waiter');
select is((select count(*)::int from public.alert where kind like 'payable%'), 0, 'waiter A reads none');
reset role;

-- The kinds are not callable by an API role ------------------------------------------------------------------------
select is((select count(*)::int from app.alert_kind where kind like 'payable%'), 4, 'four rows in the registry');
select ok(not has_table_privilege('authenticated', 'app.alert_kind', 'select')
  and not has_table_privilege('service_role', 'app.alert_kind', 'select'),
  'the registry stays closed to API roles');
select throws_ok($$ insert into app.alert_kind (kind, cost_bearing, default_severity, default_audience)
    values ('payable_bad_chef', true, 'info', '{owner,chef}') $$, '23514', null,
  'the registry itself refuses a cost-bearing kind with a chef audience');
select is((select count(*)::int from app.alert_kind where kind in ('price_variance', 'test_alert', 'test_alert_kitchen')), 3,
  'M6 and M8 kinds are still there');
select is((select count(*)::int from public.alert where kind like 'payable%'), 4, 'and the four alerts exist');

select * from finish();
rollback;
