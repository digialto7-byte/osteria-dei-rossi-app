-- SP3 step 1 (docs/plans/2026-11-15-sp3-console.md §3.1.1): the organisation-side VAT guard. With SP2's tenant-side trigger it closes both sides: a
-- VAT number cannot change on an organisation that a tenant points at, for any role (the migration owner included). Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into platform.organisation (id, name, vat_number) values ('99999999-9999-4999-8999-999999999999', 'Gruppo senza locali', 'IT22222222220');

-- 1. The first test: as the migration owner, a VAT change on an organisation a tenant points at is refused ---------------------------------------------------------
select throws_ok($$ update platform.organisation set vat_number = 'IT33333333331'
    where id = (select organisation_id from public.tenant where id = '11111111-1111-4111-8111-111111111111') $$, 'P0001', 'organisation_vat_in_use',
  'as the migration owner, changing the VAT number of an organisation a tenant points at raises organisation_vat_in_use');
select is((select vat_number from platform.organisation where id = (select organisation_id from public.tenant where id = '11111111-1111-4111-8111-111111111111')), 'IT00000000000',
  'and the organisation row is unchanged afterwards');
select is((select count(*)::int from public.tenant t join platform.organisation o on o.id = t.organisation_id where o.vat_number <> t.vat_number), 0,
  'every tenant still has an organisation with its own VAT number');

-- 2. What stays allowed -------------------------------------------------------------------------------------------------------------------------------------------
select lives_ok($$ update platform.organisation set name = 'Gruppo Demo A'
    where id = (select organisation_id from public.tenant where id = '11111111-1111-4111-8111-111111111111') $$, 'a name change on that row succeeds');
select lives_ok($$ update platform.organisation set vat_number = 'IT00000000000'
    where id = (select organisation_id from public.tenant where id = '11111111-1111-4111-8111-111111111111') $$, 'setting the same VAT number succeeds');
select lives_ok($$ update platform.organisation set vat_number = 'IT33333333331' where id = '99999999-9999-4999-8999-999999999999' $$,
  'an organisation no tenant points at changes its VAT number');

-- 3. After the tenant moves (both tenant columns together), the old organisation is free ------------------------------------------------------------------
select lives_ok($$ update public.tenant set vat_number = 'IT33333333331', organisation_id = '99999999-9999-4999-8999-999999999999' where id = '11111111-1111-4111-8111-111111111111' $$,
  'a tenant moves to another legal entity by changing both columns together');
select lives_ok($$ update platform.organisation set vat_number = 'IT44444444446' where vat_number = 'IT00000000000' $$,
  'the organisation it left (now pointed at by no tenant) can change its VAT number');
select is((select count(*)::int from platform.organisation where vat_number = 'IT44444444446'), 1, 'and it did');

-- 4. The guard fires for every row of a multi-row update --------------------------------------------------------------------------------------------------------
select throws_ok($$ update platform.organisation set vat_number = 'IT55555555551' where vat_number in ('IT44444444446', 'IT11111111115') $$, 'P0001', 'organisation_vat_in_use',
  'a statement touching one organisation with a tenant and one without is refused as a whole');
select is((select count(*)::int from platform.organisation where vat_number = 'IT55555555551'), 0, 'and changes neither');

-- 5. The API roles have no way in -----------------------------------------------------------------------------------------------------------------------------------
set local role service_role;
select throws_ok($$ update platform.organisation set name = 'x' $$, '42501', null, 'service_role cannot update an organisation');
reset role;
set local role authenticated;
select throws_ok($$ update platform.organisation set name = 'x' $$, '42501', null, 'authenticated cannot update an organisation');
reset role;
set local role anon;
select throws_ok($$ update platform.organisation set name = 'x' $$, '42501', null, 'anon cannot update an organisation');
reset role;

-- 6. The function: a definer with an empty search_path, executable by no API role, living in the platform schema ------------------------------------------
select ok((select p.prosecdef from pg_proc p where p.pronamespace = 'platform'::regnamespace and p.proname = 'organisation_vat_locked'), 'platform.organisation_vat_locked is a security definer');
select ok((select 'search_path=""' = any (p.proconfig) from pg_proc p where p.pronamespace = 'platform'::regnamespace and p.proname = 'organisation_vat_locked'), 'with search_path = ""');
select ok(not has_function_privilege('anon', 'platform.organisation_vat_locked()', 'execute') and not has_function_privilege('authenticated', 'platform.organisation_vat_locked()', 'execute')
  and not has_function_privilege('service_role', 'platform.organisation_vat_locked()', 'execute'), 'executable by no API role');
select is((select count(*)::int from pg_proc p where p.proname = 'organisation_vat_locked' and p.pronamespace <> 'platform'::regnamespace), 0, 'there is no copy of it in public or app (the app catalogue pins do not move)');
select is((select t.tgenabled::text from pg_trigger t where t.tgrelid = 'platform.organisation'::regclass and t.tgname = 'organisation_vat_locked'), 'O',
  'the trigger organisation_vat_locked on platform.organisation is enabled for every role');
select is((select (t.tgtype & 1)::int from pg_trigger t where t.tgrelid = 'platform.organisation'::regclass and t.tgname = 'organisation_vat_locked'), 1, 'and fires for each row');

select * from finish();
rollback;
