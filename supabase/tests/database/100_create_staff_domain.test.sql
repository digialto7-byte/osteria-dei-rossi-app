-- M11 review fix (migration 20261025100900_create_staff_domain.sql): create_staff links only an auth user whose
-- email is exactly staff-<id>@staff.invalid, the address the route creates. Any other domain is refused.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

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

insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('90000000-0000-4000-8000-000000000001', 'staff-91000000-0000-4000-8000-000000000001@staff.invalid'),
  ('90000000-0000-4000-8000-000000000002', 'staff-91000000-0000-4000-8000-000000000002@example.test'),
  ('90000000-0000-4000-8000-000000000003', 'staff-91000000-0000-4000-8000-000000000003@staff.invalid.example.test'),
  ('90000000-0000-4000-8000-000000000004', 'staff-91000000-0000-4000-8000-000000000004@staff.invalidx'),
  ('90000000-0000-4000-8000-000000000005', 'staff-91000000-0000-4000-8000-000000000005@'),
  ('90000000-0000-4000-8000-000000000006', 'staff-91000000-0000-4000-8000-000000000006@sub.staff.invalid');
insert into public.app_user (id, tenant_id, auth_id, role, display_name, login_method) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo', 'email');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
  'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'owner')::text, true);

select is(pg_temp.err($$ select public.create_staff('91000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000002', 'X', 'chef') $$),
  'P0001 auth_user_invalid', 'staff-<id>@example.test: refused');
select is(pg_temp.err($$ select public.create_staff('91000000-0000-4000-8000-000000000003', '90000000-0000-4000-8000-000000000003', 'X', 'chef') $$),
  'P0001 auth_user_invalid', 'staff-<id>@staff.invalid.example.test: refused');
select is(pg_temp.err($$ select public.create_staff('91000000-0000-4000-8000-000000000004', '90000000-0000-4000-8000-000000000004', 'X', 'chef') $$),
  'P0001 auth_user_invalid', 'staff-<id>@staff.invalidx: refused');
select is(pg_temp.err($$ select public.create_staff('91000000-0000-4000-8000-000000000005', '90000000-0000-4000-8000-000000000005', 'X', 'chef') $$),
  'P0001 auth_user_invalid', 'staff-<id>@ with no domain: refused');
select is(pg_temp.err($$ select public.create_staff('91000000-0000-4000-8000-000000000006', '90000000-0000-4000-8000-000000000006', 'X', 'chef') $$),
  'P0001 auth_user_invalid', 'staff-<id>@sub.staff.invalid: refused');
select is(pg_temp.err($$ select public.create_staff('91000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', 'Cuoco Demo', 'chef') $$),
  'ok', 'staff-<id>@staff.invalid: created');
reset role;
select is((select count(*)::int from public.app_user where login_method = 'pin'), 1, 'only the staff.invalid account became a user');

select is((select count(*)::int from unnest(array['anon', 'service_role']) r(role)
           where has_function_privilege(r.role, 'public.create_staff(uuid, uuid, text, public.app_role)', 'execute')), 0,
  'anon and service_role still cannot execute create_staff');
select ok(has_function_privilege('authenticated', 'public.create_staff(uuid, uuid, text, public.app_role)', 'execute'),
  'authenticated still can (the role check is inside)');

select * from finish();
rollback;
