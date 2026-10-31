-- M22 step 2 (docs/plans/2026-10-31-m22-kpi-reporting.md §3.2; ADR-025): the rollup that freezes the sales facts of a business date, its schedule and its health check.
--
--   app.kpi_finalise_grace()   10 minutes after the cut-off: a close that read the clock just before the cut-off and commits just after the rollup's snapshot
--                              must be in the frozen row (plan §6).
--   app.kpi_cutoff_end(t, D)   the first cut-off strictly after the start of D's business day = the instant app.business_date turns to D + 1. M11's DST-safe
--                              helpers decide it: on the spring night (2027-03-28, 02:00 does not exist) the cut-off is the jump instant 03:00 CEST (Q145).
--   app.kpi_last_final_date    the greatest D with p_at >= kpi_cutoff_end(D) + grace.
--   app.rollup_daily_kpi       idempotent; one advisory lock; each tenant in its own sub-transaction (a failing tenant is skipped, the run ends ok = false,
--                              error_code rollup_failed); a row per date from the tenant's first closed table to the last final date, zero rows included,
--                              at most 400 dates per tenant and run, gaps filled; on conflict do nothing. Recorded in app.job_run.
--   cron 'kpi-rollup'          every 15 minutes, SQL only: no pg_net and no secret.
--   app.job_health_checks      verbatim from 20261027101300 plus: kpi-rollup is stale with no successful run in the last 60 minutes (own-history rule), and
--                              it joins the job_unscheduled list.

create function app.kpi_finalise_grace() returns interval
  language sql immutable
  set search_path = ''
as $$ select interval '10 minutes' $$;

create function app.kpi_rollup_max_days() returns integer
  language sql immutable
  set search_path = ''
as $$ select 400 $$;

create function app.kpi_cutoff_end(p_tenant uuid, p_date date) returns timestamptz
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tz text;
  v_cut time;
begin
  select t.timezone into v_tz from public.tenant t where t.id = p_tenant;
  if not found then
    raise exception 'tenant_not_found' using errcode = 'P0002';
  end if;
  v_cut := app.business_day_cutoff(p_tenant);
  return app.next_cutoff(app.local_instant(p_date, v_cut, v_tz), v_tz, v_cut);
end
$$;

-- The business date containing p_at is not final (its cut-off end is after p_at); the one before it is final once the grace has passed.
create function app.kpi_last_final_date(p_tenant uuid, p_at timestamptz) returns date
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v date := app.business_date(p_tenant, p_at) - 1;
begin
  if p_at < app.kpi_cutoff_end(p_tenant, v) + app.kpi_finalise_grace() then
    v := v - 1;
  end if;
  return v;
end
$$;

create function app.rollup_daily_kpi(p_at timestamptz default now()) returns integer
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_job bigint;
  v_total integer := 0;
  v_n integer;
  v_failed boolean := false;
  v_state text;
  v_first date;
  v_last date;
  t record;
begin
  v_job := app.job_run_begin('kpi-rollup');
  -- One rollup at a time: a second call waits here and then sees the first one's rows.
  perform pg_advisory_xact_lock(hashtextextended('kpi-rollup', 0));
  for t in select x.id from public.tenant x order by x.id loop
    begin
      select min(s.closed_business_date) into v_first
        from public.table_session s
       where s.tenant_id = t.id and s.closed_at is not null and s.closed_business_date is not null;
      -- A tenant that never closed a table gets no row (so a demo can still start on it).
      if v_first is not null then
        v_last := app.kpi_last_final_date(t.id, p_at);
        insert into public.daily_kpi (tenant_id, business_date, tables, covers, revenue_gross, items_net, coperto_net, plates, costed_net, food_cost,
                                      uncosted_net, unmapped_plates, incomplete_plates, covers_by_hour, job_run_id)
          select k.tenant_id, k.business_date, k.tables, k.covers, k.revenue_gross, k.items_net, k.coperto_net, k.plates, k.costed_net, k.food_cost,
                 k.uncosted_net, k.unmapped_plates, k.incomplete_plates, k.covers_by_hour, v_job
            from (select gs.d::date as d
                    from generate_series(v_first::timestamp, v_last::timestamp, interval '1 day') gs (d)
                   where not exists (select 1 from public.daily_kpi e where e.tenant_id = t.id and e.business_date = gs.d::date)
                   order by 1 limit app.kpi_rollup_max_days()) p,
                 lateral app.kpi_day_row(t.id, p.d) k
          on conflict (tenant_id, business_date) do nothing;
        get diagnostics v_n = row_count;
        v_total := v_total + v_n;
      end if;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate;
      -- The sub-transaction is rolled back: this tenant has none of this run's rows. Codes only, never a message.
      raise warning 'kpi_rollup_tenant_failed sqlstate=%', v_state;
      v_failed := true;
    end;
  end loop;
  perform app.job_run_end(v_job, not v_failed, case when v_failed then 'rollup_failed' end, v_total);
  return v_total;
end
$$;

revoke all on function app.kpi_finalise_grace(), app.kpi_rollup_max_days(), app.kpi_cutoff_end(uuid, date),
  app.kpi_last_final_date(uuid, timestamptz), app.rollup_daily_kpi(timestamptz) from public, anon, authenticated, service_role;

select cron.schedule('kpi-rollup', '*/15 * * * *', $job$select app.rollup_daily_kpi()$job$);

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

  return query
    select 'job_failed'::text, count(*)::integer, '{}'::uuid[], r.job
      from app.job_run r
     where r.ok = false and r.finished_at >= v_since and r.finished_at <= p_at
     group by r.job
     order by r.job;

  return query
    select 'job_unscheduled'::text, 1, '{}'::uuid[], j.name
      from unnest(array['alert-rules', 'auth-purge', 'extract-invoices', 'kpi-rollup', 'ledger-invariants']) j (name)
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
