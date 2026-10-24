-- M13 review fix 3: auth-purge is judged stale too (plan header and section 3.9; M11 runs it daily at 03:30 UTC).
-- app.purge_auth_data records every run with job_run_begin / job_run_end('auth-purge'), ok = false for a failed one.
-- Same own-history rule as the other jobs. Otherwise unchanged from 20261027101000_job_health_window.sql.
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
  -- row. Anything that began before the previous run started was already in that run's window. Without a previous
  -- run (the first night, or a run that never finished) the window is 26 hours. A run that began while the previous
  -- check was still working can be named twice (the alert of a Rome day is raised once, the second run updates it).
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

  return query
    select 'job_failed'::text, count(*)::integer, '{}'::uuid[], r.job
      from app.job_run r
     where r.ok = false and r.started_at >= v_since and r.started_at <= p_at
     group by r.job
     order by r.job;

  return query
    select 'job_unscheduled'::text, 1, '{}'::uuid[], j.name
      from unnest(array['alert-rules', 'auth-purge', 'extract-invoices', 'ledger-invariants']) j (name)
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
     where a.tenant_id = p_tenant and a.at >= v_since and a.at <= p_at
    having count(*) > 0;
end
$$;
