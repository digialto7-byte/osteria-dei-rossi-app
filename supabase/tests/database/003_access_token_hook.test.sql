-- M0 acceptance test 4 (database half): the Custom Access Token Hook adds tenant_id and app_role
-- for an active app_user, and no tenant claims for anyone else.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'nobody@example.test'),
  ('e0000000-0000-4000-8000-00000000000e', 'former@example.test');
insert into public.tenant (id, name, vat_number)
  values ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (tenant_id, auth_id, role, display_name, is_active, deactivated_at) values
  ('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare A', true, null),
  ('11111111-1111-4111-8111-111111111111', 'e0000000-0000-4000-8000-00000000000e', 'chef', 'Ex cuoco', false, now());

-- GoTrue calls the hook as supabase_auth_admin; the test role cannot SET ROLE to it on hosted
-- Supabase, so the function is called directly and that role's access is asserted below. The
-- magic-link E2E test proves the real GoTrue -> hook path.
select is(
  app.custom_access_token_hook(jsonb_build_object(
    'user_id', 'a0000000-0000-4000-8000-00000000000a',
    'claims', jsonb_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated')
  )) -> 'claims' ->> 'tenant_id',
  '11111111-1111-4111-8111-111111111111', 'owner token carries tenant_id');

select is(
  app.custom_access_token_hook(jsonb_build_object(
    'user_id', 'a0000000-0000-4000-8000-00000000000a',
    'claims', jsonb_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated')
  )) -> 'claims' ->> 'app_role',
  'owner', 'owner token carries app_role=owner');

select is(
  app.custom_access_token_hook(jsonb_build_object(
    'user_id', 'a0000000-0000-4000-8000-00000000000a',
    'claims', jsonb_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated')
  )) -> 'claims' ->> 'role',
  'authenticated', 'the Postgres role claim is left untouched');

select ok(
  not (app.custom_access_token_hook(jsonb_build_object(
    'user_id', 'd0000000-0000-4000-8000-00000000000d',
    'claims', jsonb_build_object('sub', 'd0000000-0000-4000-8000-00000000000d', 'role', 'authenticated')
  )) -> 'claims' ? 'tenant_id'),
  'auth user without app_user gets no tenant_id claim');

select ok(
  not (app.custom_access_token_hook(jsonb_build_object(
    'user_id', 'd0000000-0000-4000-8000-00000000000d',
    'claims', jsonb_build_object('sub', 'd0000000-0000-4000-8000-00000000000d', 'role', 'authenticated',
                                 'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'owner')
  )) -> 'claims' ?| array['tenant_id', 'app_role']),
  'stale tenant claims are stripped for a user without app_user');

select ok(
  not (app.custom_access_token_hook(jsonb_build_object(
    'user_id', 'e0000000-0000-4000-8000-00000000000e',
    'claims', jsonb_build_object('sub', 'e0000000-0000-4000-8000-00000000000e', 'role', 'authenticated')
  )) -> 'claims' ? 'tenant_id'),
  'deactivated app_user gets no tenant_id claim');

select ok(
  not has_function_privilege('authenticated', 'app.custom_access_token_hook(jsonb)', 'execute'),
  'authenticated cannot call the hook');
select ok(
  not has_function_privilege('anon', 'app.custom_access_token_hook(jsonb)', 'execute'),
  'anon cannot call the hook');

select ok(
  has_function_privilege('supabase_auth_admin', 'app.custom_access_token_hook(jsonb)', 'execute'),
  'supabase_auth_admin can call the hook');
select ok(
  has_column_privilege('supabase_auth_admin', 'public.app_user', 'is_active', 'select'),
  'supabase_auth_admin can read the membership columns');
select isnt_empty(
  $$ select 1 from pg_policies where schemaname = 'public' and tablename = 'app_user'
       and 'supabase_auth_admin' = any(roles) and cmd = 'SELECT' $$,
  'RLS lets supabase_auth_admin read app_user');

select * from finish();
rollback;
