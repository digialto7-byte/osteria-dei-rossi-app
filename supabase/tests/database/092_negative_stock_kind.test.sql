-- M12 step 3: the negative_stock alert kind (M12 plan §3.1.7, §3.1.8). Not cost-bearing, owner and chef,
-- quantities and ids only. The chef reads it, the admin, the waiter and another tenant's owner do not (M6 RLS).
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

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

create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
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
grant execute on function pg_temp.act_as(uuid, uuid, text), pg_temp.err(text) to authenticated, anon;

select is((select k.cost_bearing::text || ' ' || k.default_severity::text || ' ' || k.default_audience::text
             from app.alert_kind k where k.kind = 'negative_stock'),
  'false warning {owner,chef}', 'the kind exists: not cost-bearing, warning, owner and chef');

select is((select alert_id is not null and inserted from app.raise_alert('11111111-1111-4111-8111-111111111111',
  'negative_stock', 'ingredient', '1a000000-0000-4000-8000-00000000001a',
  '{"ingredient_id":"1a000000-0000-4000-8000-00000000001a","location_id":"10000000-0000-4000-8000-0000000000a1","on_hand_qty":-1,"unit":"kg","movement_id":"0e000000-0000-4000-8000-0000000000e1"}',
  null, null, '2026-10-23T10:00:00Z')), true, 'a quantity-only payload is raised');
select is((select audience_roles::text || ' ' || cost_bearing::text || ' ' || severity::text from public.alert
            where kind = 'negative_stock'), '{owner,chef} false warning', 'audience owner and chef, severity warning');
select is((select business_date::text from public.alert where kind = 'negative_stock'), '2026-10-23',
  'the business date is the Rome date of the instant');

select is(pg_temp.err($$ select app.raise_alert('11111111-1111-4111-8111-111111111111', 'negative_stock', 'ingredient',
  '1a000000-0000-4000-8000-00000000001a', '{"ingredient_name":"Manzo muscolo (demo)","on_hand_qty":-1,"unit":"kg"}') $$),
  'P0001 alert_payload_not_allowed', 'a payload with ingredient_name is refused');
select is(pg_temp.err($$ select app.raise_alert('11111111-1111-4111-8111-111111111111', 'negative_stock', 'ingredient',
  '1a000000-0000-4000-8000-00000000001a', '{"on_hand_eur":-1}') $$), 'P0001 alert_payload_cost_key',
  'a money key is refused by the older guard');

select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
set local role authenticated;
select is((select count(*)::int from public.alert where kind = 'negative_stock'), 1, 'chef A reads it');
reset role;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
set local role authenticated;
select is((select count(*)::int from public.alert where kind = 'negative_stock'), 1, 'owner A reads it');
reset role;
select pg_temp.act_as('a0000000-0000-4000-8000-0000000000ad', '11111111-1111-4111-8111-111111111111', 'admin');
set local role authenticated;
select is((select count(*)::int from public.alert where kind = 'negative_stock'), 0, 'admin A reads none (M6)');
reset role;
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
set local role authenticated;
select is((select count(*)::int from public.alert where kind = 'negative_stock'), 0, 'waiter A reads none');
reset role;
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
set local role authenticated;
select is((select count(*)::int from public.alert where kind = 'negative_stock'), 0, 'owner B reads none');
reset role;

select * from finish();
rollback;
