-- M6 step 5 (migration 20261022150300_alert_ack.sql): public.acknowledge_alert and public.raise_test_alert.
-- Roles: the owner acknowledges any alert of the tenant; the chef only the non-cost alerts meant for the
-- kitchen; admin (DigiAlto support) and waiter are refused; a hidden alert is "not found" to the chef.
-- Acceptance test AT4 (acknowledge sets at and by; a second acknowledgement is a no-op).
begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('a0000000-0000-4000-8000-0000000000ad', 'admin-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('a1000000-0000-4000-8000-0000000000ad', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-0000000000ad', 'admin', 'Supporto Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111',
   'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B');
insert into app.alert_kind (kind, cost_bearing, default_severity, default_audience)
  values ('test_cost', true, 'warning', '{owner}');

create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
-- Runs a statement that returns one value; gives it as text, or "SQLSTATE message" on an error.
create function pg_temp.run(stmt text) returns text language plpgsql as $$
declare
  v text;
  state text;
  msg text;
begin
  execute stmt into v;
  return v;
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text;
  return state || ' ' || msg;
end
$$;
create function pg_temp.ack(p_id uuid) returns text language sql as $$
  select pg_temp.run(format('select public.acknowledge_alert(%L)::text', p_id))
$$;
-- One field of the answer, or the error text when there is no JSON answer.
create function pg_temp.ack_field(p_id uuid, p_key text) returns text language sql as $$
  select case when r ~ '^\{' then r::jsonb ->> p_key else r end from (select pg_temp.ack(p_id) r) x
$$;
-- The acknowledgement as "by|at" for the alert, read by the migration owner.
create function pg_temp.stored(p_id uuid) returns text language sql as $$
  select coalesce(right(acknowledged_by::text, 3) || '|' || acknowledged_at::text, '-') from public.alert where id = p_id
$$;
create function pg_temp.mk(n int, p_kind text default 'test_alert', p_audience public.app_role[] default '{owner}',
    p_cost boolean default false, p_created timestamptz default now()) returns uuid language sql as $$
  insert into public.alert (id, tenant_id, kind, entity_type, entity_id, business_date, severity, audience_roles,
      cost_bearing, payload, created_at)
  values (('a1e00000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, '11111111-1111-4111-8111-111111111111',
          p_kind, 'ack_case', ('e0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
          (p_created at time zone 'Europe/Rome')::date, 'info', p_audience, p_cost, '{"note":"keep"}', p_created)
  returning id
$$;
create temporary table fx (name text primary key, id uuid);
insert into fx select 'owner_only', pg_temp.mk(1);
insert into fx select 'kitchen', pg_temp.mk(2, 'test_alert_kitchen', '{owner,chef}');
insert into fx select 'kitchen2', pg_temp.mk(3, 'test_alert_kitchen', '{owner,chef}');
insert into fx select 'cost', pg_temp.mk(4, 'test_cost', '{owner}', true);
insert into fx select 'yesterday', pg_temp.mk(5, p_created => now() - interval '1 day');
insert into fx select 'owner_only2', pg_temp.mk(6);
create function pg_temp.id(p_name text) returns uuid language sql as $$ select id from fx where name = p_name $$;
create temporary table before_ack as
  select id, payload, created_at, business_date, kind, audience_roles, severity from public.alert;
grant select on fx to authenticated;

set local role authenticated;

-- Owner acknowledges (AT4) -----------------------------------------------------------------------------------
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.ack_field(pg_temp.id('owner_only'), 'acknowledgedBy'), 'a1000000-0000-4000-8000-00000000000a',
  'the owner''s acknowledgement names the owner');
select isnt(pg_temp.ack_field(pg_temp.id('kitchen'), 'acknowledgedAt'), null, 'and carries the time');
reset role;
select is(pg_temp.stored(pg_temp.id('owner_only')) ~ '^00a\|', true, 'the row stores the owner and a time');
select is((select count(*)::int from public.alert a join before_ack b using (id)
            where a.payload is distinct from b.payload or a.created_at is distinct from b.created_at
               or a.business_date is distinct from b.business_date or a.kind is distinct from b.kind
               or a.audience_roles is distinct from b.audience_roles or a.severity is distinct from b.severity), 0,
  'payload, created_at, business date, kind, audience and severity are unchanged');

-- A second acknowledgement is a no-op that returns the first (AT4) --------------------------------------------
set local role authenticated;
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.ack_field(pg_temp.id('kitchen'), 'acknowledgedBy'), 'a1000000-0000-4000-8000-00000000000a',
  'the chef''s acknowledgement of an already acknowledged alert returns the owner''s');
reset role;
select is(pg_temp.stored(pg_temp.id('kitchen')) ~ '^00a\|', true, 'and the stored acknowledgement is still the owner''s');

-- The chef --------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.ack_field(pg_temp.id('kitchen2'), 'acknowledgedBy'), 'c1000000-0000-4000-8000-00000000000c',
  'the chef acknowledges a kitchen alert');
select is(pg_temp.ack(pg_temp.id('owner_only2')), 'P0002 not_found', 'the chef cannot find an owner-only alert');
select is(pg_temp.ack(pg_temp.id('cost')), 'P0002 not_found', 'nor a cost-bearing one');
reset role;
select is(pg_temp.stored(pg_temp.id('owner_only2')), '-', 'which stays unacknowledged');

-- Refused roles and tenants --------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-0000000000ad', '11111111-1111-4111-8111-111111111111', 'admin');
select is(pg_temp.ack(pg_temp.id('owner_only2')), '42501 insufficient_privilege', 'the admin cannot acknowledge');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(pg_temp.ack(pg_temp.id('kitchen')), '42501 insufficient_privilege', 'the waiter cannot acknowledge');
select set_config('request.jwt.claims', '{}', true);
select is(pg_temp.ack(pg_temp.id('owner_only2')), '42501 insufficient_privilege', 'a caller with no claims cannot');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(pg_temp.ack(pg_temp.id('owner_only2')), 'P0002 not_found', 'owner B cannot find tenant A''s alert');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.ack('99999999-9999-4999-8999-999999999999'), 'P0002 not_found', 'an unknown id is not found');
select is(pg_temp.ack_field(pg_temp.id('yesterday'), 'acknowledgedBy'), 'a1000000-0000-4000-8000-00000000000a',
  'an alert from yesterday can be acknowledged today');
select is(pg_temp.ack_field(pg_temp.id('cost'), 'acknowledgedBy'), 'a1000000-0000-4000-8000-00000000000a',
  'and the owner can acknowledge a cost-bearing one');
reset role;
select is(pg_temp.stored(pg_temp.id('owner_only2')), '-', 'the refused calls changed nothing');
select is((select created_at from public.alert where id = pg_temp.id('yesterday')) < now() - interval '23 hours', true,
  'the yesterday alert kept its date');

-- Test alerts -------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
create temporary table tests (label text, result jsonb);
grant insert on tests to authenticated;
insert into tests values ('first', public.raise_test_alert());
insert into tests values ('again', public.raise_test_alert());
insert into tests values ('kitchen', public.raise_test_alert(true));
insert into tests values ('kitchen_again', public.raise_test_alert(p_include_kitchen => true));
reset role;
select is((select (result ->> 'inserted')::boolean from tests where label = 'first'), true, 'the owner raises a test alert');
select is((select (result ->> 'inserted')::boolean from tests where label = 'again'), false, 'again the same day: not inserted');
select is((select result ->> 'alertId' from tests where label = 'again'), (select result ->> 'alertId' from tests where label = 'first'),
  'with the same id');
select is((select kind || ' ' || audience_roles::text || ' ' || coalesce(created_by::text, '-')
             from public.alert where id = (select (result ->> 'alertId')::uuid from tests where label = 'first')),
  'test_alert {owner} a1000000-0000-4000-8000-00000000000a', 'a plain test alert is for the owner, created by the owner');
select is((select kind || ' ' || audience_roles::text from public.alert
            where id = (select (result ->> 'alertId')::uuid from tests where label = 'kitchen')),
  'test_alert_kitchen {owner,chef}', 'the kitchen one includes the chef');
select is((select (result ->> 'inserted')::boolean from tests where label = 'kitchen_again'), false, 'and is deduplicated too');

set local role authenticated;
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.run('select public.raise_test_alert()::text'), '42501 insufficient_privilege', 'the chef cannot raise a test alert');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(pg_temp.run('select public.raise_test_alert()::text'), '42501 insufficient_privilege', 'the waiter cannot');
select pg_temp.act_as('a0000000-0000-4000-8000-0000000000ad', '11111111-1111-4111-8111-111111111111', 'admin');
select is(pg_temp.run('select public.raise_test_alert()::text'), '42501 insufficient_privilege', 'the admin cannot');
select set_config('request.jwt.claims', '{}', true);
select is(pg_temp.run('select public.raise_test_alert()::text'), '42501 insufficient_privilege', 'no claims cannot');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(pg_temp.run('select (public.raise_test_alert() ->> ''inserted'')'), 'true',
  'owner B gets his own test alert (the tenant comes from the token)');
reset role;
select is((select count(*)::int from public.alert where tenant_id = '22222222-2222-4222-8222-222222222222'), 1,
  'stored under tenant B');

-- Privileges ------------------------------------------------------------------------------------------------
select ok(has_function_privilege('authenticated', 'public.acknowledge_alert(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.raise_test_alert(boolean)', 'execute'),
  'authenticated can execute both');
select ok(not has_function_privilege('anon', 'public.acknowledge_alert(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.raise_test_alert(boolean)', 'execute'),
  'anon cannot execute either');
select ok(not has_function_privilege('service_role', 'public.acknowledge_alert(uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.raise_test_alert(boolean)', 'execute'),
  'service_role cannot execute either');
set local role anon;
select throws_ok($$ select public.acknowledge_alert('a1e00000-0000-4000-8000-000000000001') $$, '42501', null,
  'calling acknowledge_alert as anon is refused');
select throws_ok($$ select public.raise_test_alert() $$, '42501', null, 'calling raise_test_alert as anon is refused');
reset role;

select * from finish();
rollback;
