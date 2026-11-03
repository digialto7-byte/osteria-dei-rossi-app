-- M22 step 2 (docs/plans/2026-10-31-m22-kpi-reporting.md §3.2, §5; ADR-025): app.job_health_checks watches kpi-rollup. It is stale when it has had no successful
-- run in the last 60 minutes (own-history rule: a job with no earlier finished run is never stale), and it is "unscheduled" when its cron job is missing or
-- inactive. The other jobs' rules are those of 117, which stays green. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into public.tenant (id, name, vat_number) values ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');

create function pg_temp.kr(p_at timestamptz) returns text language sql as $$
  select coalesce(string_agg(c.check_key || '/' || c.job_key, ',' order by c.check_key collate "C"), '-')
    from app.job_health_checks('11111111-1111-4111-8111-111111111111', p_at) c where c.job_key = 'kpi-rollup'
$$;

-- The local stack runs pg_cron, which fires kpi-rollup every 15 minutes and may already have logged a real run before this
-- file starts (CI, 2026-11-02 07:45): start from a log with no kpi-rollup run, as test 1 describes (rolled back at the end).
delete from app.job_run where job = 'kpi-rollup';
select is(pg_temp.kr('2026-11-06 12:00+00'), '-', 'a database where kpi-rollup never finished: neither stale nor unscheduled (the migration scheduled it)');
insert into app.job_run (job, started_at, finished_at, ok, items) values ('kpi-rollup', '2026-11-06 11:01+00', '2026-11-06 11:01:05+00', true, 3);
select is(pg_temp.kr('2026-11-06 12:00+00'), '-', 'last successful run 59 minutes ago: not stale');
select is(pg_temp.kr('2026-11-06 12:01+00'), '-', 'exactly 60 minutes: not stale (the run is within the window)');
select is(pg_temp.kr('2026-11-06 12:02+00'), 'job_stale/kpi-rollup', '61 minutes: job_stale');
insert into app.job_run (job, started_at, finished_at, ok, error_code, items) values ('kpi-rollup', '2026-11-06 12:00+00', '2026-11-06 12:00:05+00', false, 'rollup_failed', 0);
select is(pg_temp.kr('2026-11-06 12:02+00'), 'job_failed/kpi-rollup,job_stale/kpi-rollup', 'a failed run does not count as successful: still stale, and the failure is named');
insert into app.job_run (job, started_at, finished_at, ok, items) values ('kpi-rollup', '2026-11-06 12:01+00', '2026-11-06 12:01:05+00', true, 0);
select is(pg_temp.kr('2026-11-06 12:02+00'), 'job_failed/kpi-rollup', 'a later successful run clears the stale flag (the failure is still in the look-back)');
delete from app.job_run where error_code = 'rollup_failed';
select is(pg_temp.kr('2026-11-06 12:50+00'), '-', 'with the failure out of the look-back and the run 49 minutes old, nothing is reported');

select is(cron.unschedule('kpi-rollup'), true, 'the test unschedules the job');
select is(pg_temp.kr('2026-11-06 12:50+00'), 'job_unscheduled/kpi-rollup', 'job_unscheduled lists kpi-rollup');
select cron.schedule('kpi-rollup', '*/15 * * * *', 'select app.rollup_daily_kpi()');
select cron.alter_job((select jobid from cron.job where jobname = 'kpi-rollup'), active := false);
select is(pg_temp.kr('2026-11-06 12:50+00'), 'job_unscheduled/kpi-rollup', 'an inactive job is listed too');
select cron.alter_job((select jobid from cron.job where jobname = 'kpi-rollup'), active := true);
select is(pg_temp.kr('2026-11-06 12:50+00'), '-', 'and an active one is not');

select * from finish();
