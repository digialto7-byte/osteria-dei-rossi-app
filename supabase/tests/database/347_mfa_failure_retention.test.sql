-- P2-1 A4b (docs/plans/2026-11-12-p2-1-totp.md section 3.3a, 5 A4b; founder decision Q-T2 = V2 of 2026-11-12): the wrong-code log is deleted after 30 days by
-- app.run_mfa_failure_retention(p_now), the daily job mfa-failure-retention, in the reservation-retention pattern: one job_run row per run, a failing tenant is skipped,
-- the health checks name the job when it is stale or unscheduled. The permanent audit kinds are never touched. p_now is fixed. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);
-- Hold off pg_cron's own job_run inserts until this file rolls back (the health checks below read the log).
lock table app.job_run in share row exclusive mode;
delete from app.job_run where job = 'mfa-failure-retention';

create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare v_out text; state text; msg text;
begin
  execute stmt into v_out;
  return v_out;
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text;
  return state || ' ' || msg;
end $$;

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('ad000000-0000-4000-8000-0000000000ad', 'admin-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT00000000001');
insert into public.app_user (id, tenant_id, auth_id, role, display_name, login_method) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo', 'email'),
  ('ad100000-0000-4000-8000-0000000000ad', '11111111-1111-4111-8111-111111111111', 'ad000000-0000-4000-8000-0000000000ad', 'admin', 'Admin Demo', 'email'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo', 'email');

-- The run is at 1998-11-20 03:40 UTC. Failures of A: 31, 30 and 29 days old (and 400 days); of B: 31 and 29 days old.
insert into app.mfa_failure (id, tenant_id, app_user_id, stage, at) values
  ('e0000000-0000-4000-8000-000000000031', '11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', 'login', '1998-11-20 03:40+00'::timestamptz - interval '31 days'),
  ('e0000000-0000-4000-8000-000000000030', '11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', 'login', '1998-11-20 03:40+00'::timestamptz - interval '30 days'),
  ('e0000000-0000-4000-8000-000000000029', '11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', 'enrol', '1998-11-20 03:40+00'::timestamptz - interval '29 days'),
  ('e0000000-0000-4000-8000-000000000400', '11111111-1111-4111-8111-111111111111', 'ad100000-0000-4000-8000-0000000000ad', 'login', '1998-11-20 03:40+00'::timestamptz - interval '400 days'),
  ('e0000000-0000-4000-8000-000000000032', '11111111-1111-4111-8111-111111111111', 'ad100000-0000-4000-8000-0000000000ad', 'login', '1998-11-20 03:40+00'::timestamptz - interval '1 hour'),
  ('e0000000-0000-4000-8000-0000000b0031', '22222222-2222-4222-8222-222222222222', 'b1000000-0000-4000-8000-00000000000b', 'login', '1998-11-20 03:40+00'::timestamptz - interval '31 days'),
  ('e0000000-0000-4000-8000-0000000b0029', '22222222-2222-4222-8222-222222222222', 'b1000000-0000-4000-8000-00000000000b', 'login', '1998-11-20 03:40+00'::timestamptz - interval '29 days');
-- The permanent kinds, 400 days old, in the audit log: the job never touches audit_event.
insert into public.audit_event (tenant_id, entity_type, entity_id, action, created_at, created_by)
select '11111111-1111-4111-8111-111111111111', case when k like 'tenant.%' then 'tenant' else 'app_user' end,
       case when k like 'tenant.%' then '11111111-1111-4111-8111-111111111111'::uuid else 'a1000000-0000-4000-8000-00000000000a'::uuid end,
       k, '1998-11-20 03:40+00'::timestamptz - interval '400 days', 'ad100000-0000-4000-8000-0000000000ad'
  from unnest(array['app_user.mfa_enrolled', 'app_user.mfa_unenrolled', 'app_user.mfa_reset', 'app_user.mfa_reset_failed', 'tenant.mfa_enforcement_changed', 'app_user.pin_set_failed']) k;

create temp table run1 as select app.run_mfa_failure_retention('1998-11-20 03:40+00') as n;
select is((select n from run1), 3, 'the run reports the rows it deleted: 31 and 400 days of A, 31 days of B');
select is((select string_agg(right(id::text, 4), ',' order by id) from app.mfa_failure), '0029,0030,0032,0029', 'kept: 30 days (the edge), 29 days, an hour, and B''s 29 days');
select is((select count(*)::int from app.mfa_failure where id = 'e0000000-0000-4000-8000-000000000031'), 0, 'a failure 31 days old is deleted');
select is((select count(*)::int from app.mfa_failure where id = 'e0000000-0000-4000-8000-000000000029'), 1, 'a failure 29 days old is kept');
select is((select count(*)::int from app.mfa_failure where id = 'e0000000-0000-4000-8000-000000000030'), 1, 'a failure exactly 30 days old is kept (older than 30 days is deleted)');
select is((select count(*)::int from app.mfa_failure where id = 'e0000000-0000-4000-8000-0000000b0031'), 0, 'tenant B''s old failure is deleted too');
select is((select count(*)::int from public.audit_event where action in ('app_user.mfa_enrolled', 'app_user.mfa_unenrolled', 'app_user.mfa_reset', 'app_user.mfa_reset_failed', 'tenant.mfa_enforcement_changed', 'app_user.pin_set_failed')), 6,
          'permanent kinds, 400 days old, are never deleted: enrolled, unenrolled, reset, reset failed, enforcement changed, pin set failed');
select is((select count(*)::int from public.audit_event where created_at < '1998-11-20 03:40+00'::timestamptz - interval '399 days'), 6, 'and the audit log has exactly those old rows');

-- The job record.
select is((select count(*)::int from app.job_run where job = 'mfa-failure-retention'), 1, 'one job_run row mfa-failure-retention');
select is((select ok::text || ',' || coalesce(error_code, '-') || ',' || items from app.job_run where job = 'mfa-failure-retention'), 'true,-,3', 'ok, no error code, 3 items');
select is((select finished_at is not null from app.job_run where job = 'mfa-failure-retention'), true, 'and it is finished');

-- Idempotent.
select is(app.run_mfa_failure_retention('1998-11-20 03:40+00'), 0, 'a second run deletes nothing');
select is((select count(*)::int from app.job_run where job = 'mfa-failure-retention'), 2, 'but is recorded');
-- Next month everything of the first day has aged out.
select is(app.run_mfa_failure_retention('1998-12-30 03:40+00'), 4, 'a month later the four remaining rows are past 30 days and go');
select is((select count(*)::int from app.mfa_failure), 0, 'the table is empty');

-- A failing tenant does not stop the others.
insert into app.mfa_failure (tenant_id, app_user_id, stage, at) values
  ('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', 'login', '1999-01-01 00:00+00'),
  ('22222222-2222-4222-8222-222222222222', 'b1000000-0000-4000-8000-00000000000b', 'login', '1999-01-01 00:00+00');
create function public.tmp_retention_fail() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$;
create trigger tmp_retention_fail before delete on app.mfa_failure for each row when (old.tenant_id = '22222222-2222-4222-8222-222222222222') execute function public.tmp_retention_fail();
create temp table run3 as select app.run_mfa_failure_retention('1999-03-01 03:40+00') as n;
select is((select count(*)::int from app.mfa_failure where tenant_id = '11111111-1111-4111-8111-111111111111'), 0, 'tenant A is done although tenant B failed');
select is((select count(*)::int from app.mfa_failure where tenant_id = '22222222-2222-4222-8222-222222222222'), 1, 'tenant B''s sub-transaction was rolled back: its row is still there');
select is((select ok::text || ',' || error_code from app.job_run where job = 'mfa-failure-retention' order by id desc limit 1), 'false,retention_failed', 'the run is recorded ok = false with the code retention_failed');
select is((select n from run3), 1, 'and counts only what it deleted');
drop trigger tmp_retention_fail on app.mfa_failure;
drop function public.tmp_retention_fail();

-- Roles, definer, schedule, job check.
select is((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'app.run_mfa_failure_retention(timestamptz)'::regprocedure), true, 'app.run_mfa_failure_retention is a definer with an empty search_path');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'run_mfa_failure_retention'
            and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))), 0, 'and no API role can execute it');
select is((select schedule || ' | ' || command from cron.job where jobname = 'mfa-failure-retention'), '40 3 * * * | select app.run_mfa_failure_retention()', 'the cron job mfa-failure-retention runs daily at 03:40 UTC and calls it');
select lives_ok($$ insert into app.job_run (job, started_at, finished_at, ok, items) values ('mfa-failure-retention', now(), now(), true, 0) $$, 'job_run accepts mfa-failure-retention');
select is((select count(*)::int from pg_proc where proname = 'job_health_checks' and pronamespace = 'app'::regnamespace), 1, 'app.job_health_checks has one definition');

-- The health check: stale after 48 hours without a successful run, unscheduled, failed.
delete from app.job_run where job = 'mfa-failure-retention';
create function pg_temp.hc(p_at timestamptz) returns text language sql as $$
  select coalesce(string_agg(c.check_key || '/' || c.job_key, ',' order by c.check_key collate "C"), '-')
    from app.job_health_checks('11111111-1111-4111-8111-111111111111', p_at) c where c.job_key = 'mfa-failure-retention'
$$;
select is(pg_temp.hc('1998-12-06 12:00+00'), '-', 'a database where the job never finished: neither stale nor unscheduled');
insert into app.job_run (job, started_at, finished_at, ok, items) values ('mfa-failure-retention', '1998-12-01 03:40+00', '1998-12-01 03:40:05+00', true, 0);
select is(pg_temp.hc('1998-12-03 03:40+00'), '-', 'a successful run exactly 48 hours ago: not stale');
select is(pg_temp.hc('1998-12-03 03:41+00'), 'job_stale/mfa-failure-retention', 'just over 48 hours: job_stale');
insert into app.job_run (job, started_at, finished_at, ok, error_code, items) values ('mfa-failure-retention', '1998-12-02 12:00+00', '1998-12-02 12:00:05+00', false, 'retention_failed', 0);
select is(pg_temp.hc('1998-12-02 20:00+00'), 'job_failed/mfa-failure-retention', 'a failed run is named by job_failed');
delete from app.job_run where job = 'mfa-failure-retention' and ok = false;
select is(cron.unschedule('mfa-failure-retention'), true, 'the test unschedules the job');
select is(pg_temp.hc('1998-12-02 03:20+00'), 'job_unscheduled/mfa-failure-retention', 'job_unscheduled lists it');
select cron.schedule('mfa-failure-retention', '40 3 * * *', 'select app.run_mfa_failure_retention()');
select is(pg_temp.hc('1998-12-02 03:20+00'), '-', 'and a scheduled one is not listed');
select is((select count(*)::int from app.job_health_checks('11111111-1111-4111-8111-111111111111', '1998-12-02 03:20+00') c where c.check_key = 'job_unscheduled'), 0, 'every other job is still scheduled');
select is((select string_agg(jobname, ',' order by jobname collate "C") from cron.job), 'alert-rules,auth-purge,extract-invoices,kpi-rollup,ledger-invariants,mfa-failure-retention,reservation-mail,reservation-retention', 'the cron jobs are the earlier ones plus mfa-failure-retention');

select * from finish();
rollback;
