-- M11 review fix: attempts left `pending` were never purged, against the 30-day retention (project Q14).
-- app.purge_auth_data is re-created from its body in 20261025100800_auth_purge.sql with one change: the attempts
-- delete no longer skips `pending`. A pending attempt older than 30 days is long past its 30-second in-flight
-- window, so nothing reads it. create or replace keeps the owner and the revoked grants; the cron job
-- `auth-purge` (03:30 UTC) calls the same function and is not touched.

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
