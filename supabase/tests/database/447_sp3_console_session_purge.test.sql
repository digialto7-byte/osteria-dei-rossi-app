-- SP3 step 22 (docs/plans/2026-11-15-sp3-console.md §3.1.5, §3.1.7; R12): old console rows and old platform code failures are purged by the existing jobs.
-- app.purge_auth_data (auth-purge) removes console rows older than 31 days, as it does SP2's selections; app.run_mfa_failure_retention (mfa-failure-retention)
-- removes platform.mfa_failure rows older than the lock window, which no lock reads any more. Cron jobs, their commands and the job list are unchanged
-- (346, 359); 088, 101, 347 and 434 pass unchanged. Fake data only.
begin;
-- A scheduled pg_cron job on the local stack can commit an app.job_run row mid-test; this lock makes it wait for the rollback (tests/guards/pgtap-job-run-lock.test.ts).
lock table app.job_run in share row exclusive mode;
-- Clean slate: a cron row committed just before this file started must not be counted (the rollback restores every row).
delete from app.job_run;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, email) values
  ('aa000000-0000-4000-8000-000000000001', 'platform-admin@example.test'),
  ('aa000000-0000-4000-8000-000000000002', 'support@example.test');
insert into platform.staff (auth_id, role) values ('aa000000-0000-4000-8000-000000000001', 'platform_admin'), ('aa000000-0000-4000-8000-000000000002', 'platform_support');

-- 1. Console rows: the first test of step 22 -------------------------------------------------------------------------------------------------------------------------------
insert into platform.console_session (session_id, auth_id, selected_at) values
  ('ca000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001', '1998-01-01T12:00:00Z'),
  ('ca000000-0000-4000-8000-000000000002', 'aa000000-0000-4000-8000-000000000001', '1998-01-02T12:00:00Z'),
  ('ca000000-0000-4000-8000-000000000003', 'aa000000-0000-4000-8000-000000000001', '1998-01-31T12:00:00Z');
select is(app.purge_auth_data('1998-02-02T12:00:00Z'), 1, 'a console row older than 31 days is purged by app.purge_auth_data (and counted); fresh ones stay');
select is((select string_agg(session_id::text, ',' order by session_id) from platform.console_session),
  'ca000000-0000-4000-8000-000000000002,ca000000-0000-4000-8000-000000000003', 'a row exactly 31 days old and a fresh one are left');
select is((select job || ' ' || ok::text || ' ' || items::text from app.job_run order by id desc limit 1), 'auth-purge true 1', 'the run is recorded as auth-purge');
select is(app.purge_auth_data('1998-02-02T12:00:00Z'), 0, 'a second run finds nothing more');

-- 2. Platform code failures -----------------------------------------------------------------------------------------------------------------------------------------------
insert into platform.mfa_failure (auth_id, stage, at) values
  ('aa000000-0000-4000-8000-000000000001', 'login', '1998-03-01T11:44:00Z'),
  ('aa000000-0000-4000-8000-000000000001', 'login', '1998-03-01T11:45:00Z'),
  ('aa000000-0000-4000-8000-000000000001', 'enrol', '1998-03-01T11:50:00Z'),
  ('aa000000-0000-4000-8000-000000000002', 'login', '1998-02-01T12:00:00Z');
select is(app.run_mfa_failure_retention('1998-03-01T12:00:00Z'), 2,
  'platform.mfa_failure rows older than the lock window (15 minutes) are purged by the mfa-failure-retention function, and counted');
select is((select string_agg(to_char(at at time zone 'UTC', 'HH24:MI') || ' ' || stage, ',' order by at) from platform.mfa_failure),
  '11:45 login,11:50 enrol', 'a row exactly 15 minutes old and a newer one are left (the lock still reads them)');
select is((select job || ' ' || ok::text || ' ' || items::text from app.job_run order by id desc limit 1), 'mfa-failure-retention true 2',
  'the run is recorded as mfa-failure-retention');
select is(app.run_mfa_failure_retention('1998-03-01T12:00:00Z'), 0, 'a second run finds nothing more');

-- 3. The jobs and the functions keep their shape ----------------------------------------------------------------------------------------------------------------------------
select is((select command from cron.job where jobname = 'auth-purge'), 'select app.purge_auth_data()', 'the auth-purge cron command is unchanged');
select is((select command from cron.job where jobname = 'mfa-failure-retention'), 'select app.run_mfa_failure_retention()', 'the mfa-failure-retention cron command is unchanged');
select is((select count(*)::int from pg_proc p where p.oid in ('app.purge_auth_data(timestamptz)'::regprocedure, 'app.run_mfa_failure_retention(timestamptz)'::regprocedure)
             and p.prosecdef and p.proconfig = array['search_path=""'] and p.proowner = 'postgres'::regrole), 2, 'both are definers with search_path = "", owned by postgres');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role', 'platform_staff']) r
            where has_function_privilege(r, 'app.purge_auth_data(timestamptz)', 'execute') or has_function_privilege(r, 'app.run_mfa_failure_retention(timestamptz)', 'execute')), 0,
  'no API role can run either');
select is((select count(*)::int from pg_proc where pronamespace = 'app'::regnamespace and proname in ('purge_auth_data', 'run_mfa_failure_retention')), 2, 'still one of each');
select is((select string_agg(proname, ',' order by proname) from pg_proc where pronamespace = 'app'::regnamespace and proname in ('purge_auth_data', 'run_mfa_failure_retention')
             and provolatile = 'v'), 'purge_auth_data,run_mfa_failure_retention', 'and both stay volatile');

select * from finish();
rollback;
