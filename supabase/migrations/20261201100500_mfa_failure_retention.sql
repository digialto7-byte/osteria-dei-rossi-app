-- P2-1 A4b (docs/plans/2026-11-12-p2-1-totp.md section 3.3a, 5 A4b; founder decision Q-T2 = V2 of 2026-11-12): wrong second-factor codes are deleted after 30 days.
-- The reservation-retention pattern (20261128100300):
--
--   app.run_mfa_failure_retention(now)   per tenant, each in its own sub-transaction (a failing tenant is skipped, the run ends ok = false, error_code
--                                        retention_failed, and the others are still done): app.mfa_failure rows older than 30 days are deleted (a row exactly
--                                        30 days old stays). The permanent audit kinds (enrolments, removals, resets, enforcement changes) are in audit_event,
--                                        which this never touches. Returns the number of rows it deleted, which is also the job_run item count. One advisory
--                                        lock keeps two runs apart. Codes only in warnings; no personal data is read.
--   cron 'mfa-failure-retention'         daily at 03:40 UTC, SQL only (no pg_net and no secret).
--   job_run_job_check                    the current list plus 'mfa-failure-retention'.
--   app.job_health_checks                verbatim from 20261128100300 plus: mfa-failure-retention is stale with no successful run in the last 48 hours
--                                        (own-history rule: a job with no earlier finished run is never stale) and it joins the job_unscheduled list. A failed
--                                        run is named by the existing job_failed check.

alter table app.job_run drop constraint job_run_job_check;
alter table app.job_run
  add constraint job_run_job_check check (job in ('extract', 'alert-rules', 'auth-purge', 'ledger-invariants', 'kpi-rollup', 'reservation-mail', 'reservation-retention', 'mfa-failure-retention'));

create function app.run_mfa_failure_retention(p_now timestamptz default clock_timestamp()) returns integer
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_job bigint;
  v_items integer := 0;
  v_n integer;
  v_failed boolean := false;
  v_state text;
  t record;
begin
  v_job := app.job_run_begin('mfa-failure-retention');
  perform pg_advisory_xact_lock(hashtextextended('mfa-failure-retention', 0));
  for t in select x.id from public.tenant x order by x.id loop
    begin
      delete from app.mfa_failure where tenant_id = t.id and at < p_now - interval '30 days';
      get diagnostics v_n = row_count;
      v_items := v_items + v_n;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate;
      -- The sub-transaction is rolled back: this tenant has none of this run's changes. Codes only, never a message.
      raise warning 'mfa_failure_retention_tenant_failed sqlstate=%', v_state;
      v_failed := true;
    end;
  end loop;
  perform app.job_run_end(v_job, not v_failed, case when v_failed then 'retention_failed' end, v_items);
  return v_items;
end
$$;

revoke all on function app.run_mfa_failure_retention(timestamptz) from public, anon, authenticated, service_role;

select cron.schedule('mfa-failure-retention', '40 3 * * *', $job$select app.run_mfa_failure_retention()$job$);

create or replace function app.job_health_checks(p_tenant uuid, p_at timestamptz)
  returns table (check_key text, rows_count integer, sample_ids uuid[], job_key text)
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
#variable_conflict use_column
declare
  v_own timestamptz;
  v_since timestamptz;
begin
  -- The look-back of job_failed and alerts_refused: everything since the previous ledger-invariants run started.
  -- The nightly run starts a few tenths of a second later every night, so a fixed 24 hours misses what happened
  -- right after the previous check read its data, and a fixed 26 hours reports the same failure two nights in a
  -- row. A job run is judged by when it finished: one that finished before the previous run started was already in
  -- that run's window, one that started earlier and finished later was not. Without a previous
  -- run (the first night, or a run that never finished) the window is 26 hours. A run that began while the previous
  -- check was still working can be named twice. A second run on the same Rome business date raises no new alert (the
  -- first one stays), so a manual run moves this window forward; see the known limit in the plan.
  select max(r.started_at) into v_since
    from app.job_run r
   where r.job = 'ledger-invariants' and r.finished_at is not null and r.started_at < p_at;
  v_since := coalesce(v_since, p_at - interval '26 hours');

  -- A job is judged from its own history: with no earlier finished run of its own it is never stale (a job that
  -- was just added, like ledger-invariants on the night of its deploy, must not alert on its first run). The run
  -- being executed is unfinished, so it never counts. A job that never ran is caught by job_unscheduled.
  -- alert-rules runs hourly: stale after 3 hours without a successful run
  select min(r.started_at) into v_own from app.job_run r where r.job = 'alert-rules' and r.finished_at is not null;
  if v_own is not null and p_at >= v_own + interval '3 hours'
     and not exists (select 1 from app.job_run r
                      where r.job = 'alert-rules' and r.ok and r.started_at >= p_at - interval '3 hours') then
    return query select 'job_stale'::text, 1, '{}'::uuid[], 'alert-rules'::text;
  end if;
  -- ledger-invariants runs nightly: stale when its previous run started more than 26 hours ago
  select min(r.started_at) into v_own from app.job_run r where r.job = 'ledger-invariants' and r.finished_at is not null;
  if v_own is not null and p_at >= v_own + interval '26 hours'
     and not exists (select 1 from app.job_run r
                      where r.job = 'ledger-invariants' and r.finished_at is not null
                        and r.started_at >= p_at - interval '26 hours') then
    return query select 'job_stale'::text, 1, '{}'::uuid[], 'ledger-invariants'::text;
  end if;
  -- auth-purge (M11) runs daily: stale when it has no successful run in the last 26 hours
  select min(r.started_at) into v_own from app.job_run r where r.job = 'auth-purge' and r.finished_at is not null;
  if v_own is not null and p_at >= v_own + interval '26 hours'
     and not exists (select 1 from app.job_run r
                      where r.job = 'auth-purge' and r.ok and r.started_at >= p_at - interval '26 hours') then
    return query select 'job_stale'::text, 1, '{}'::uuid[], 'auth-purge'::text;
  end if;

  -- kpi-rollup (M22) runs every 15 minutes: stale when it has no successful run in the last 60 minutes
  select min(r.started_at) into v_own from app.job_run r where r.job = 'kpi-rollup' and r.finished_at is not null;
  if v_own is not null and p_at >= v_own + interval '60 minutes'
     and not exists (select 1 from app.job_run r
                      where r.job = 'kpi-rollup' and r.ok and r.started_at >= p_at - interval '60 minutes') then
    return query select 'job_stale'::text, 1, '{}'::uuid[], 'kpi-rollup'::text;
  end if;
  -- reservation-retention (reservations B4) runs daily: stale when it has no successful run in the last 48 hours (a GDPR job must not fail silently)
  select min(r.started_at) into v_own from app.job_run r where r.job = 'reservation-retention' and r.finished_at is not null;
  if v_own is not null and p_at >= v_own + interval '48 hours'
     and not exists (select 1 from app.job_run r
                      where r.job = 'reservation-retention' and r.ok and r.started_at >= p_at - interval '48 hours') then
    return query select 'job_stale'::text, 1, '{}'::uuid[], 'reservation-retention'::text;
  end if;
  -- mfa-failure-retention (P2-1 A4b) runs daily: stale when it has no successful run in the last 48 hours (a retention job must not fail silently)
  select min(r.started_at) into v_own from app.job_run r where r.job = 'mfa-failure-retention' and r.finished_at is not null;
  if v_own is not null and p_at >= v_own + interval '48 hours'
     and not exists (select 1 from app.job_run r
                      where r.job = 'mfa-failure-retention' and r.ok and r.started_at >= p_at - interval '48 hours') then
    return query select 'job_stale'::text, 1, '{}'::uuid[], 'mfa-failure-retention'::text;
  end if;

  return query
    select 'job_failed'::text, count(*)::integer, '{}'::uuid[], r.job
      from app.job_run r
     where r.ok = false and r.finished_at >= v_since and r.finished_at <= p_at
     group by r.job
     order by r.job;

  return query
    select 'job_unscheduled'::text, 1, '{}'::uuid[], j.name
      from unnest(array['alert-rules', 'auth-purge', 'extract-invoices', 'kpi-rollup', 'ledger-invariants', 'mfa-failure-retention', 'reservation-retention']) j (name)
     where not exists (select 1 from cron.job c where c.jobname = j.name and c.active)
     order by j.name;

  -- the extract job runs only when there is work, so an invoice that keeps waiting is the signal
  return query
    select 'extract_backlog'::text, count(*)::integer, (array_agg(i.id order by i.id))[1:5], null::text
      from public.invoice i
     where i.tenant_id = p_tenant and i.status = 'received' and i.created_at < p_at - interval '60 minutes'
       and (i.next_attempt_at is null or i.next_attempt_at <= p_at)
    having count(*) > 0;

  return query
    select 'alerts_refused'::text, count(*)::integer, '{}'::uuid[], null::text
      from app.alert_refusal a
     -- the margin: a refusal commits after its insert time (see the header of this migration)
     where a.tenant_id = p_tenant and a.at >= v_since - interval '10 minutes' and a.at <= p_at
    having count(*) > 0;
end
$$;
