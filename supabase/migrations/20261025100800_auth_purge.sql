-- M11 step 9: the retention purge of the staff-login security logs (M11 plan §3.1.10; project plan §3.9, Q14).
--
-- Why deletion is allowed here: auth_attempt, staff_session, device_enrolment and app.enrol_failure are
-- not ledgers (none feeds a balance or a business record). They are security logs of personal data, kept
-- only as long as lockouts and support need them (GDPR storage limitation). audit_event rows about staff
-- and devices are NOT purged: they follow the audit trail's own retention.
--
-- How it is constrained: no API role has DELETE or TRUNCATE on any of them, and each guard trigger refuses
-- a delete unless the transaction-local setting app.auth_purge = 'on', which only this function sets, and
-- it deletes only rows past retention. Every run is recorded in app.job_run.

alter table app.job_run drop constraint job_run_job_check;
alter table app.job_run
  add constraint job_run_job_check check (job in ('extract', 'alert-rules', 'auth-purge'));

create function app.purge_auth_data(p_at timestamptz default now()) returns integer
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

    delete from public.auth_attempt a
     where a.outcome <> 'pending' and a.started_at < p_at - interval '30 days';
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
revoke all on function app.purge_auth_data(timestamptz) from public, anon, authenticated, service_role;

select cron.schedule('auth-purge', '30 3 * * *', $job$select app.purge_auth_data()$job$);
