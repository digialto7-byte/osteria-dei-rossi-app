-- M13 review fix 2: the look-back of job_failed and alerts_refused, and a tenant whose check raises.
--
-- 1. job_failed and alerts_refused looked back exactly 24 hours from p_at, so yesterday's failure, started 24 hours
--    and a few tenths of a second earlier, was missed. They now look back to the start of the previous
--    ledger-invariants run (26 hours when there is none).
-- 2. If ledger_checks_body raised for a tenant, the whole select of that tenant's block failed, so the job findings
--    and last night's check_failed refusal never reached its owner and the next night did the same. The runner now
--    computes the job health in its own block, so a tenant whose ledger checks raise still gets an alert from the
--    second night on (alerts_refused names the refusal recorded the night before). Otherwise unchanged from
--    20261027100700_ledger_invariants.sql and 20261027100900_job_health_own_history.sql.
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

create or replace function app.run_ledger_invariants(p_at timestamptz default now()) returns integer
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_run bigint := app.job_run_begin('ledger-invariants');
  v_with integer := 0;
  v_failed boolean := false;
  v_ledger jsonb;
  v_health jsonb;
  v_checks jsonb;
  t record;
begin
  for t in select x.id from public.tenant x order by x.id loop
    begin
      v_ledger := null;
      v_health := null;
      begin
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                 'check_key', b.check_key, 'rows_count', b.rows_count, 'sample_ids', to_jsonb(b.sample_ids)))
               order by b.check_key)
          into v_ledger
          from app.ledger_checks_body(t.id, p_at) b;
      exception when others then
        v_failed := true;
        perform app.record_alert_refusal(t.id, 'ledger_drift', 'tenant', t.id, 'ledger_invariants', 'check_failed', sqlstate);
        raise warning 'ledger invariant check failed: %', sqlstate;
      end;
      -- the job health does not depend on the ledger checks: it reaches the owner even when they raise
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'check_key', h.check_key, 'rows_count', h.rows_count, 'sample_ids', to_jsonb(h.sample_ids),
               'job_key', h.job_key)) order by h.check_key, h.job_key)
        into v_health
        from app.job_health_checks(t.id, p_at) h;
      select jsonb_agg(c order by c->>'check_key', c->>'job_key')
        into v_checks
        from (select jsonb_array_elements(coalesce(v_ledger, '[]'::jsonb) || coalesce(v_health, '[]'::jsonb)) c) u;
      if v_checks is not null then
        perform app.try_raise_alert(t.id, 'ledger_drift', 'tenant', t.id,
                                    jsonb_build_object('checks', v_checks, 'checked_at', p_at),
                                    null, null, p_at, null, 'ledger_invariants');
        v_with := v_with + 1;
      end if;
    exception when others then
      v_failed := true;
      perform app.record_alert_refusal(t.id, 'ledger_drift', 'tenant', t.id, 'ledger_invariants', 'check_failed', sqlstate);
      raise warning 'ledger invariant check failed: %', sqlstate;
    end;
  end loop;
  perform app.job_run_end(v_run, not v_failed, case when v_failed then 'check_failed' end, v_with);
  return v_with;
end
$$;
