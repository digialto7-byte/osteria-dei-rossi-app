-- SP3 step 22 (docs/plans/2026-11-15-sp3-console.md §3.1.5, §3.1.7; R12): the existing jobs also purge SP3's session state. No new cron job; each function keeps its
-- name, signature, grants, volatility and job name.
--  * app.purge_auth_data (auth-purge): 20261207100300_session_tenant_purge.sql's body plus one delete: console rows older than 31 days. A session lives at most
--    30 days from sign-in (ADR-029), so such a row belongs to a dead session, like an old selection.
--  * app.run_mfa_failure_retention (mfa-failure-retention): 20261201100500_mfa_failure_retention.sql's body plus one sub-transaction after the tenants:
--    platform.mfa_failure rows older than the lock window (app.mfa_lock_minutes()) are deleted; the lock reads only newer ones. A failure there is a warning
--    with its code and the run ends ok = false (retention_failed), as for a tenant. Codes only, never a message.

create or replace function app.purge_auth_data(p_at timestamptz default now()) returns integer
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_run bigint := app.job_run_begin('auth-purge');
  v_n integer := 0;
  v_part integer;
begin
  begin
    perform set_config('app.auth_purge', 'on', true);

    -- Every outcome, pending included: an attempt that never finished (a crashed request) is personal data
    -- like the rest and would otherwise be kept for ever (project Q14).
    delete from public.auth_attempt a
     where a.started_at < p_at - interval '30 days';
    get diagnostics v_part = row_count;
    v_n := v_n + v_part;

    delete from public.staff_session s
     where coalesce(s.ended_at, s.ends_at) < p_at - interval '30 days';
    get diagnostics v_part = row_count;
    v_n := v_n + v_part;

    delete from public.device_enrolment e
     where e.used_at is null and e.expires_at < p_at - interval '30 days';
    get diagnostics v_part = row_count;
    v_n := v_n + v_part;

    delete from app.enrol_failure f where f.at < p_at - interval '1 day';
    get diagnostics v_part = row_count;
    v_n := v_n + v_part;

    -- SP2: selections of dead sessions.
    delete from app.session_tenant s where s.selected_at < p_at - interval '31 days';
    get diagnostics v_part = row_count;
    v_n := v_n + v_part;

    -- SP3: console rows of dead sessions (the same 31 days as the selections).
    delete from platform.console_session c where c.selected_at < p_at - interval '31 days';
    get diagnostics v_part = row_count;
    v_n := v_n + v_part;

    perform set_config('app.auth_purge', '', true);
  exception when others then
    -- The block's deletes are rolled back; the run is recorded as failed (a code, never a message).
    perform set_config('app.auth_purge', '', true);
    raise warning 'auth purge failed: %', sqlstate;
    perform app.job_run_end(v_run, false, 'purge_failed', 0);
    return 0;
  end;

  perform app.job_run_end(v_run, true, null, v_n);
  return v_n;
end
$$;

create or replace function app.run_mfa_failure_retention(p_now timestamptz default clock_timestamp()) returns integer
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
  -- SP3: platform staff's own failures, once older than the lock window (no lock reads them any more); in their own sub-transaction like a tenant.
  begin
    delete from platform.mfa_failure where at < p_now - make_interval(mins => app.mfa_lock_minutes());
    get diagnostics v_n = row_count;
    v_items := v_items + v_n;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    raise warning 'mfa_failure_retention_platform_failed sqlstate=%', v_state;
    v_failed := true;
  end;
  perform app.job_run_end(v_job, not v_failed, case when v_failed then 'retention_failed' end, v_items);
  return v_items;
end
$$;
