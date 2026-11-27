-- SP2 S5 (docs/plans/2026-11-26-sp02-memberships.md §3.1, retention): the existing auth-purge job also removes selection rows older than 31 days.
-- A session lives at most 30 days from sign-in (ADR-029) and a row is never older than its session's last switch, so such a row belongs to a dead
-- session (signed out, expired, or ended by #79's break-glass reset). No new cron job; the function keeps its name, signature, grants and job name.
-- The rest of the body is 20261025101000_auth_purge_pending.sql's, unchanged.
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

