-- P2-1 A5 (docs/plans/2026-11-12-p2-1-totp.md section 3.10, 5 A5; follow-up F13): the PIN-change window.
--
-- Before: record_pin_change (audit, a pin_reset attempt row, end the sessions) runs BEFORE the Auth password change. A PIN sign-in with the OLD PIN in that gap
-- opens a session that survives, and a failed Auth call leaves an audit row for a change that did not happen.
--
--   app.pin_login_finish_at     replaced on purpose (public.pin_login_finish, the service-role wrapper, calls it and is unchanged): a success for an attempt that
--                               STARTED before the newest pin_reset row of the user is stored as a failure and opens no session; the reply is the wrong-PIN reply
--                               with "reason": "superseded". Everything else is the body of 20261025100400.
--   public.finish_pin_change    new, owner and admin (the staff manager gate; 42501 for anyone else, a gated account included), called by the route after the Auth
--                               call. success: under the per-user PIN lock, a second pin_reset attempt row now and every open session of the user ends with
--                               pin_reset. failure: one app_user.pin_set_failed audit row (no data) and nothing else; the route answers 502 as before.
-- Together: a sign-in that started before the new password was in place is refused (if it finishes after a reset row) or ended (by the second reset). A new-PIN
-- sign-in in the few milliseconds between the Auth update and finish_pin_change is also ended: the person signs in again. Accepted (plan 3.10).
-- Codes only.

create or replace function app.pin_login_finish_at(
  p_attempt uuid, p_outcome public.auth_attempt_outcome, p_auth_session uuid, p_at timestamptz
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_a public.auth_attempt;
  v_dev public.venue_device;
  v_tenant public.tenant;
  v_ends timestamptz;
  v_until timestamptz;
  v_run integer;
  v_superseded boolean := false;
begin
  if p_outcome not in ('success', 'failure', 'error') then
    raise exception 'invalid_outcome' using errcode = '22023';
  end if;
  if p_outcome = 'success' and p_auth_session is null then
    raise exception 'session_required' using errcode = '22023';
  end if;

  select * into v_a from public.auth_attempt a where a.id = p_attempt;
  if not found then
    raise exception 'attempt_not_found' using errcode = 'P0002';
  end if;

  perform app.lock_pin_login(v_a.device_id, v_a.app_user_id);
  select * into v_a from public.auth_attempt a where a.id = p_attempt for update;   -- fresh, after the lock
  if v_a.outcome <> 'pending' then
    raise exception 'attempt_not_pending' using errcode = 'P0001';
  end if;
  select * into v_dev from public.venue_device d where d.id = v_a.device_id;

  if p_outcome = 'error' then
    update public.auth_attempt set outcome = 'error', finished_at = p_at where id = v_a.id;
    return jsonb_build_object('status', 'auth_error');
  end if;

  if p_outcome = 'success' then
    -- A device revoked or locked while Auth was running opens no session; the attempt is not a failure.
    if v_dev.revoked_at is not null or v_dev.locked_at is not null then
      update public.auth_attempt set outcome = 'error', finished_at = p_at where id = v_a.id;
      return jsonb_build_object('status', case when v_dev.revoked_at is not null then 'device_revoked'
                                               else 'device_locked' end);
    end if;
    -- F13: the PIN was changed after this attempt started, so the PIN it signed in with is the old one (or the change is still in flight).
    if exists (select 1 from public.auth_attempt r
                where r.app_user_id = v_a.app_user_id and r.outcome = 'pin_reset' and r.started_at > v_a.started_at) then
      v_superseded := true;
      p_outcome := 'failure';
    else
      select * into v_tenant from public.tenant t where t.id = v_a.tenant_id;
      v_ends := app.next_cutoff(p_at, v_tenant.timezone, app.business_day_cutoff(v_tenant.id));
      update public.auth_attempt set outcome = 'success', finished_at = p_at where id = v_a.id;
      insert into public.staff_session (tenant_id, app_user_id, device_id, auth_session_id, started_at, ends_at)
        values (v_a.tenant_id, v_a.app_user_id, v_a.device_id, p_auth_session, p_at, v_ends);
      update public.venue_device set last_login_at = p_at where id = v_a.device_id;
      return jsonb_build_object('status', 'ok', 'endsAt', v_ends);
    end if;
  end if;

  -- A wrong PIN (or a superseded success).
  update public.auth_attempt set outcome = 'failure', finished_at = p_at where id = v_a.id;
  if app.lock_device_if_needed(v_a.device_id, p_at) then
    return jsonb_build_object('status', 'device_locked');
  end if;
  v_until := app.user_lock_until(v_a.app_user_id, p_at);
  if v_until is not null then
    return jsonb_build_object('status', 'user_locked', 'lockedUntil', v_until);
  end if;
  v_run := app.user_failure_run(v_a.app_user_id, p_at);
  return jsonb_build_object('status', 'pin_invalid', 'attemptsLeft', greatest(5 - v_run, 0))
         || case when v_superseded then jsonb_build_object('reason', 'superseded') else '{}'::jsonb end;
end
$$;

create function public.finish_pin_change(p_user uuid, p_outcome text) returns void
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_u public.app_user;
  v_now timestamptz := clock_timestamp();
begin
  perform app.require_staff_manager();
  if p_outcome is null or p_outcome not in ('success', 'failure') then
    raise exception 'invalid_outcome' using errcode = '22023';
  end if;
  v_u := app.pin_change_target(p_user);
  if p_outcome = 'success' then
    -- The same per-user lock the PIN login takes, so a finish in flight is either seen by the reset row or ended by it.
    perform pg_advisory_xact_lock(hashtext('pin_user'), hashtext(v_u.id::text));
    insert into public.auth_attempt (tenant_id, device_id, app_user_id, outcome, started_at, finished_at)
      values (v_u.tenant_id, null, v_u.id, 'pin_reset', v_now, v_now);
    perform app.end_staff_sessions(null, v_u.id, 'pin_reset', v_now);
  else
    insert into public.audit_event (tenant_id, entity_type, entity_id, action, created_by)
      values (v_u.tenant_id, 'app_user', v_u.id, 'app_user.pin_set_failed', app.app_user_id());
  end if;
end
$$;

revoke all on function public.finish_pin_change(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.finish_pin_change(uuid, text) to authenticated;
