-- M11 step 4 (migration 20261025100300_device_locked_kind.sql): the device_locked alert kind. It is raised only
-- inside pin_login_finish (step 5); there is no hourly rule. Owner audience only; the chef never sees it, and
-- admin and waiter read no alerts at all.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Cuoco Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo');

create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;

select is((select kind || ':' || cost_bearing || ':' || default_severity || ':' || default_audience::text
             from app.alert_kind where kind = 'device_locked'),
  'device_locked:false:warning:{owner}', 'the registry row: not cost-bearing, warning, owner only');

create temporary table raised (n int, id uuid);
insert into raised
  select 1, app.try_raise_alert('11111111-1111-4111-8111-111111111111', 'device_locked', 'venue_device',
    'd2000000-0000-4000-8000-0000000000d2',
    '{"device_id": "d2000000-0000-4000-8000-0000000000d2", "device_label": "Telefono sala (demo)", "failures_count": 20, "window_minutes": 60, "locked_at": "2026-10-24T19:00:00Z"}',
    null, null, '2026-10-24T19:00:00Z', null, 'pin_login_finish');
select isnt((select id from raised where n = 1), null, 'try_raise_alert raises it');
select is((select audience_roles::text from public.alert where kind = 'device_locked'), '{owner}',
  'the default audience is the owner alone');
select is((select cost_bearing from public.alert where kind = 'device_locked'), false, 'and it is not cost-bearing');
insert into raised
  select 2, app.try_raise_alert('11111111-1111-4111-8111-111111111111', 'device_locked', 'venue_device',
    'd2000000-0000-4000-8000-0000000000d2', '{"failures_count": 21}',
    null, null, '2026-10-24T20:00:00Z', null, 'pin_login_finish');
select is((select count(*)::int from public.alert where kind = 'device_locked'), 1,
  'a second raise for the same device on the same business date adds no row (dedup)');
select is((select id from raised where n = 2), (select id from raised where n = 1), 'and returns the first alert');

set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is((select count(id)::int from public.alert where kind = 'device_locked'), 1, 'the owner reads it');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is((select count(id)::int from public.alert where kind = 'device_locked'), 0, 'the chef reads none');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is((select count(id)::int from public.alert where kind = 'device_locked'), 0, 'the admin reads none');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is((select count(id)::int from public.alert where kind = 'device_locked'), 0, 'the waiter reads none');
reset role;

select * from finish();
rollback;
