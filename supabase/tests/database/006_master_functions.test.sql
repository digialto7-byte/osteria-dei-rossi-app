-- M1 SQL helpers: the VAT checksum matches src/lib/vat/it-vat.ts on the same vectors; name
-- normalisation; the caller's app_user id; unit dimensions.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

select ok(app.is_valid_it_vat(v), v || ' is valid')
  from unnest(array['IT00000000000', 'IT12345678903', 'IT01234567897', 'IT11111111115',
                    'IT99999999990']) v;
select ok(not app.is_valid_it_vat(v), coalesce(v, 'null') || ' is not valid')
  from unnest(array['IT12345678901', 'IT00000000001', 'IT01234567890', 'IT1234567890',
                    'IT123456789012', '12345678903', 'FR12345678903', 'IT1234567890A', '']) v;
select ok(app.is_valid_it_vat(null) is null, 'null VAT gives null (a check constraint passes it)');

select is(app.normalise_name('  Pomodoro   San '), 'pomodoro san', 'names are trimmed, collapsed and lower-cased');

select is(app.unit_dimension('g'), 'mass', 'g is mass');
select is(app.unit_dimension('ml'), 'volume', 'ml is volume');
select is(app.unit_dimension('pz'), 'count', 'pz is count');

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('e0000000-0000-4000-8000-00000000000e', 'former-a@example.test');
insert into public.tenant (id, name, vat_number)
  values ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name, is_active, deactivated_at) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare A', true, null),
  ('e1000000-0000-4000-8000-00000000000e', '11111111-1111-4111-8111-111111111111',
   'e0000000-0000-4000-8000-00000000000e', 'owner', 'Ex titolare A', false, now());

set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
  'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'owner')::text, true);
select is(app.app_user_id(), 'a1000000-0000-4000-8000-00000000000a'::uuid, 'app_user_id is the caller''s row');
select set_config('request.jwt.claims', json_build_object(
  'sub', 'e0000000-0000-4000-8000-00000000000e', 'role', 'authenticated',
  'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'owner')::text, true);
select is(app.app_user_id(), null, 'a deactivated user has no app_user_id');
reset role;

select ok(not has_function_privilege('anon', 'app.app_user_id()', 'execute'), 'anon cannot call app_user_id');

select * from finish();
rollback;
