-- SP2 S5 (docs/plans/2026-11-26-sp02-memberships.md §3.1, retention; pgTAP 373 on #131): the auth-purge job removes selections older than 31
-- days and keeps fresh ones; the cron job and the function's privileges are unchanged. Fake data only.
begin;
-- A scheduled pg_cron job on the local stack can commit an app.job_run row mid-test; this lock makes it wait for the rollback (tests/guards/pgtap-job-run-lock.test.ts).
lock table app.job_run in share row exclusive mode;
-- Clean slate: a cron row committed just before this file started must not be counted (the rollback restores every row).
delete from app.job_run;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values ('a0000000-0000-4000-8000-00000000000a', 'owner-ab@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (tenant_id, auth_id, role, display_name) values
  ('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare in A'),
  ('22222222-2222-4222-8222-222222222222', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare in B');
insert into app.session_tenant (session_id, auth_id, tenant_id, selected_at) values
  ('5e550000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', '1998-01-01T12:00:00Z'),
  ('5e550000-0000-4000-8000-0000000000a2', 'a0000000-0000-4000-8000-00000000000a', '22222222-2222-4222-8222-222222222222', '1998-01-31T12:00:00Z');

select is(app.purge_auth_data('1998-02-02T12:00:00Z'), 1, 'a selection older than 31 days is purged (and counted), a fresh one stays');
select is((select string_agg(session_id::text, ',') from app.session_tenant), '5e550000-0000-4000-8000-0000000000a2', 'the fresh one is the one left');
select is((select job || ' ' || ok::text || ' ' || items::text from app.job_run order by id desc limit 1), 'auth-purge true 1',
  'the run is recorded as auth-purge');
select is(app.purge_auth_data('1998-02-02T12:00:00Z'), 0, 'a second run finds nothing more');
select is((select command from cron.job where jobname = 'auth-purge'), 'select app.purge_auth_data()', 'the cron command is unchanged');
select ok(not has_function_privilege('anon', 'app.purge_auth_data(timestamptz)', 'execute')
          and not has_function_privilege('authenticated', 'app.purge_auth_data(timestamptz)', 'execute'), 'no API role can run the purge');
select is((select count(*)::int from pg_proc where pronamespace = 'app'::regnamespace and proname = 'purge_auth_data'), 1, 'still one purge function');

-- Review of PR 2 (lead ruling 2026-11-27): a demo reset (ADR-018) deletes the demo users' memberships, so their selections go with them
-- (on delete cascade; the selection is a per-session cache, like mfa_failure). Without it the purge failed with 23503.
insert into auth.users (id, email) values
  ('d0000000-0000-4000-8000-0000000000d1', 'demo-owner@example.test'),
  ('d0000000-0000-4000-8000-0000000000d2', 'demo-admin@example.test');
insert into public.tenant (id, name, vat_number) values ('33333333-3333-4333-8333-333333333333', 'Osteria Demo D', 'IT22222222220');
select public.begin_demo_data('33333333-3333-4333-8333-333333333333', 'd0000000-0000-4000-8000-0000000000d1', 'Titolare Demo',
                              'd0000000-0000-4000-8000-0000000000d2', 'Admin Demo');
insert into app.session_tenant (session_id, auth_id, tenant_id) values
  ('5e550000-0000-4000-8000-0000000000d1', 'd0000000-0000-4000-8000-0000000000d1', '33333333-3333-4333-8333-333333333333');
select lives_ok($$ select public.purge_demo_data_by_id('33333333-3333-4333-8333-333333333333', 'Osteria Demo D') $$,
  'a demo reset succeeds after the demo owner chose its tenant');
select is((select count(*)::int from app.session_tenant where tenant_id = '33333333-3333-4333-8333-333333333333'), 0,
  'and the demo users'' selections are gone with their memberships');

select * from finish();
rollback;
