-- SP2 S1 (docs/plans/2026-11-14-sp2-memberships.md §3.1.1): platform.organisation groups tenants by VAT number (Q-S3), the tenant VAT number is
-- no longer unique (H1), the trigger fills tenant.organisation_id, and the organisation table is closed to every API role (Q-S6).
-- Fake data only: the VAT numbers are the fixtures' fakes, never a client's.
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

-- 1. AT8: two tenants with one VAT number are accepted and share one organisation -----------------------------------------------------------------------------------
select lives_ok($$ insert into public.tenant (id, name, vat_number) values
    ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
    ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT00000000000') $$,
  'two tenants with the same VAT number are accepted (H1: the unique is gone)');
select is((select count(distinct organisation_id)::int from public.tenant where id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')), 1,
  'and they share one organisation');
select is((select count(*)::int from platform.organisation where vat_number = 'IT00000000000'), 1, 'which is the only organisation with that VAT number');
select is((select o.name from platform.organisation o where o.vat_number = 'IT00000000000'), 'Osteria Demo A', 'named after the first tenant that created it');
select is((select o.legal_name from platform.organisation o where o.vat_number = 'IT00000000000'), null, 'legal_name stays NULL: it is a client fact, never filled by the trigger (F-4)');

-- 2. A different VAT number is a different organisation ---------------------------------------------------------------------------------------------------------------
select lives_ok($$ insert into public.tenant (id, name, vat_number) values ('33333333-3333-4333-8333-333333333333', 'Osteria Demo C', 'IT11111111115') $$,
  'a tenant with another VAT number is accepted');
select isnt((select organisation_id from public.tenant where id = '33333333-3333-4333-8333-333333333333'),
            (select organisation_id from public.tenant where id = '11111111-1111-4111-8111-111111111111'), 'and lands in its own organisation');

-- 3. Every tenant has an organisation (the backfill and the trigger) ---------------------------------------------------------------------------------------------------
select is((select count(*)::int from public.tenant where organisation_id is null), 0, 'no tenant is left without an organisation');
select col_not_null('public', 'tenant', 'organisation_id', 'tenant.organisation_id is not null');
select is((select count(*)::int from public.tenant t join platform.organisation o on o.id = t.organisation_id where o.vat_number <> t.vat_number), 0,
  'every tenant''s organisation has the tenant''s VAT number');
select col_is_null('platform', 'organisation', 'legal_name', 'organisation.legal_name is nullable');

-- 4. Checks that stay ---------------------------------------------------------------------------------------------------------------------------------------------------
-- With an explicit organisation_id the trigger does not run, so only the tenant's own check can refuse the row (and the message names it).
select throws_ok($$ insert into public.tenant (name, vat_number, organisation_id) values ('Osteria Demo D', 'XX1234',
    (select organisation_id from public.tenant where id = '11111111-1111-4111-8111-111111111111')) $$, '23514',
  'new row for relation "tenant" violates check constraint "tenant_vat_number_check"', 'a bad VAT number is still refused by the tenant''s own check');
select throws_ok($$ insert into public.tenant (name, vat_number) values ('Osteria Demo D', 'XX1234') $$, '23514', null, 'and without an organisation the insert is refused as well (the organisation''s check fires first)');
select throws_ok($$ insert into platform.organisation (name, vat_number) values ('Osteria Demo E', 'XX1234') $$, '23514', null, 'and on the organisation');
select throws_ok($$ insert into platform.organisation (name, vat_number) values ('Osteria Demo F', 'IT00000000000') $$, '23505', null, 'one organisation per VAT number');
select throws_ok($$ insert into platform.organisation (name, vat_number) values ('', 'IT22222222220') $$, '23514', null, 'an organisation needs a name');

-- 5. create_tenant_with_owner is unchanged and still gives the tenant its organisation -----------------------------------------------------------------
insert into auth.users (id, email) values ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test');
set local role service_role;
select lives_ok($$ select public.create_tenant_with_owner('Osteria Demo G', 'IT22222222220', 'a0000000-0000-4000-8000-00000000000a', 'Titolare Demo') $$,
  'service_role still creates a tenant with its owner');
reset role;
select is((select count(*)::int from public.tenant t join platform.organisation o on o.id = t.organisation_id where t.name = 'Osteria Demo G' and o.vat_number = 'IT22222222220'), 1,
  'and the new tenant has its organisation');

-- 6. platform.organisation is closed to every API role (Q-S6) -------------------------------------------------------------------------------------------------------
select ok(not has_schema_privilege('anon', 'platform', 'usage') and not has_schema_privilege('authenticated', 'platform', 'usage') and not has_schema_privilege('service_role', 'platform', 'usage'),
  'no API role has usage on the platform schema');
select ok(not has_table_privilege('anon', 'platform.organisation', 'select,insert,update,delete,truncate,references,trigger'), 'anon has no privilege on platform.organisation');
select ok(not has_table_privilege('authenticated', 'platform.organisation', 'select,insert,update,delete,truncate,references,trigger'), 'authenticated has no privilege on platform.organisation');
select ok(not has_table_privilege('service_role', 'platform.organisation', 'select,insert,update,delete,truncate,references,trigger'), 'service_role has no privilege on platform.organisation');
select is((select relrowsecurity from pg_class where oid = 'platform.organisation'::regclass), true, 'row level security is on anyway');
select is((select count(*)::int from pg_policy where polrelid = 'platform.organisation'::regclass), 0, 'with no policy');
select ok(not has_function_privilege('anon', 'app.ensure_organisation(text, text)', 'execute') and not has_function_privilege('authenticated', 'app.ensure_organisation(text, text)', 'execute')
  and not has_function_privilege('service_role', 'app.ensure_organisation(text, text)', 'execute'), 'app.ensure_organisation is executable by no API role');

select * from finish();
rollback;
