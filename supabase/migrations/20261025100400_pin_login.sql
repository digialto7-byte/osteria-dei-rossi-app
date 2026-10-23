-- M11 step 5: PIN login in two phases around Supabase Auth, the lockouts and the device lock alert
-- (M11 plan §3.1.4, §3.1.5, §3.2; ADR-010).
--
--   pin_login_begin  runs BEFORE Auth: device checks, user lock, one attempt in flight, then a `pending`
--                    attempt. Every refusal here means the route never calls Auth.
--   pin_login_finish runs AFTER Auth: records the outcome, applies the lockouts, opens the staff session.
--
-- Both are one transaction, take the device row lock and then a per-user advisory lock (always in that order,
-- so parallel requests cannot pass more guesses than the limits allow), and are executable by service_role
-- only (decision D1). The thresholds live here and nowhere else: 5 failures lock a user for 15 minutes,
-- 20 failures in 60 minutes lock a device. No PIN, and nothing derived from one, ever reaches this code.

-- Lock order: the device row, then the user. A null user (nothing to lock) skips the second lock.
create function app.lock_pin_login(p_device uuid, p_user uuid) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  perform 1 from public.venue_device d where d.id = p_device for no key update;
  if p_user is not null then
    perform pg_advisory_xact_lock(hashtext('pin_user'), hashtext(p_user::text));
  end if;
end
$$;

-- The user's attempts that count: finished successes, failures and resets, and `pending` attempts older than
-- 30 s (an Auth call that never reported back is a failure). `error` attempts never count.
create function app.user_verified_attempts(p_user uuid, p_at timestamptz)
  returns table (is_failure boolean, started_at timestamptz)
  language sql stable
  security definer
  set search_path = ''
as $$
  select (a.outcome in ('failure', 'pending')) as is_failure, a.started_at
    from public.auth_attempt a
   where a.app_user_id = p_user
     and a.started_at <= p_at
     and (a.outcome in ('success', 'failure', 'pin_reset')
          or (a.outcome = 'pending' and a.started_at <= p_at - interval '30 seconds'))
   order by a.started_at desc, a.id desc
   limit 5
$$;

-- Failures since the user's last success or reset, at most 5.
create function app.user_failure_run(p_user uuid, p_at timestamptz) returns integer
  language sql stable
  security definer
  set search_path = ''
as $$
  with v as (
    select x.is_failure, row_number() over (order by x.started_at desc) as rn
      from app.user_verified_attempts(p_user, p_at) x
  )
  select coalesce(min(v.rn) filter (where not v.is_failure) - 1, count(*))::int from v
$$;

-- Null while the user may try; otherwise the instant the lock ends: the newest of 5 failures in a row + 15 min.
create function app.user_lock_until(p_user uuid, p_at timestamptz) returns timestamptz
  language sql stable
  security definer
  set search_path = ''
as $$
  select case when count(*) = 5 and bool_and(v.is_failure) and max(v.started_at) + interval '15 minutes' > p_at
              then max(v.started_at) + interval '15 minutes' end
    from app.user_verified_attempts(p_user, p_at) v
$$;

-- Failures (and stale pendings) on the device in the last 60 minutes, counted from its last unlock.
create function app.device_failures(p_device uuid, p_at timestamptz) returns integer
  language sql stable
  security definer
  set search_path = ''
as $$
  select count(*)::int
    from public.auth_attempt a
    join public.venue_device d on d.id = a.device_id
   where a.device_id = p_device
     and a.started_at <= p_at
     and a.started_at > greatest(p_at - interval '60 minutes', coalesce(d.unlocked_at, '-infinity'::timestamptz))
     and (a.outcome = 'failure'
          or (a.outcome = 'pending' and a.started_at <= p_at - interval '30 seconds'))
$$;

-- Ends the open sessions of a device, of a user, or of both (at least one is named).
create function app.end_staff_sessions(
  p_device uuid, p_user uuid, p_reason public.staff_session_end, p_at timestamptz
) returns integer
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_n integer;
begin
  if p_device is null and p_user is null then
    raise exception 'session_scope_required' using errcode = '22023';
  end if;
  update public.staff_session s
     set ended_at = p_at, end_reason = p_reason
   where s.ended_at is null
     and (p_device is null or s.device_id = p_device)
     and (p_user is null or s.app_user_id = p_user);
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

-- Locks the device once it has 20 failures in 60 minutes, ends its sessions and raises the owner alert.
-- Returns true when the device is (now) locked by this call. A refused alert never undoes the lock
-- (app.try_raise_alert absorbs the guard codes and records the refusal).
create function app.lock_device_if_needed(p_device uuid, p_at timestamptz) returns boolean
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_d public.venue_device;
  v_count integer;
begin
  select * into v_d from public.venue_device d where d.id = p_device;
  if v_d.locked_at is not null then
    return false;
  end if;
  v_count := app.device_failures(p_device, p_at);
  if v_count < 20 then
    return false;
  end if;
  update public.venue_device set locked_at = p_at where id = p_device;
  perform app.end_staff_sessions(p_device, null, 'device_locked', p_at);
  perform app.try_raise_alert(
    v_d.tenant_id, 'device_locked', 'venue_device', p_device,
    jsonb_build_object('device_id', p_device, 'device_label', v_d.label, 'failures_count', v_count,
                       'window_minutes', 60,
                       'locked_at', to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
    null, '{owner}'::public.app_role[], p_at, null, 'pin_login_finish');
  return true;
end
$$;

create function app.pin_login_begin_at(p_token_hash text, p_user uuid, p_at timestamptz) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_dev_id uuid;
  v_dev public.venue_device;
  v_user public.app_user;
  v_until timestamptz;
  v_attempt uuid;
begin
  select d.id into v_dev_id from public.venue_device d where d.token_hash = p_token_hash;
  if not found then
    return jsonb_build_object('status', 'device_unknown');
  end if;

  perform app.lock_pin_login(v_dev_id, p_user);
  select * into v_dev from public.venue_device d where d.id = v_dev_id;   -- fresh, after the lock

  if v_dev.revoked_at is not null then
    return jsonb_build_object('status', 'device_revoked');
  end if;
  if v_dev.locked_at is not null then
    return jsonb_build_object('status', 'device_locked');
  end if;

  -- One attempt in flight per device and per user.
  if exists (select 1 from public.auth_attempt a
              where a.outcome = 'pending' and a.started_at > p_at - interval '30 seconds'
                and (a.device_id = v_dev.id or (p_user is not null and a.app_user_id = p_user))) then
    return jsonb_build_object('status', 'attempt_in_progress');
  end if;

  select * into v_user from public.app_user u
   where u.id = p_user and u.tenant_id = v_dev.tenant_id and u.is_active
     and u.login_method = 'pin' and u.role in ('chef', 'waiter');
  if not found then
    -- Answered like a wrong PIN, and it counts against the device (probing ids is guessing too).
    insert into public.auth_attempt (tenant_id, device_id, app_user_id, outcome, started_at, finished_at)
      values (v_dev.tenant_id, v_dev.id, null, 'failure', p_at, p_at);
    if app.lock_device_if_needed(v_dev.id, p_at) then
      return jsonb_build_object('status', 'device_locked');
    end if;
    return jsonb_build_object('status', 'pin_invalid');
  end if;

  v_until := app.user_lock_until(v_user.id, p_at);
  if v_until is not null then
    return jsonb_build_object('status', 'user_locked', 'lockedUntil', v_until);
  end if;

  insert into public.auth_attempt (tenant_id, device_id, app_user_id, outcome, started_at)
    values (v_dev.tenant_id, v_dev.id, v_user.id, 'pending', p_at)
    returning id into v_attempt;

  return jsonb_build_object(
    'status', 'proceed', 'attemptId', v_attempt,
    'authEmail', (select au.email from auth.users au where au.id = v_user.auth_id));
end
$$;

create function app.pin_login_finish_at(
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
    select * into v_tenant from public.tenant t where t.id = v_a.tenant_id;
    v_ends := app.next_cutoff(p_at, v_tenant.timezone, app.business_day_cutoff(v_tenant.id));
    update public.auth_attempt set outcome = 'success', finished_at = p_at where id = v_a.id;
    insert into public.staff_session (tenant_id, app_user_id, device_id, auth_session_id, started_at, ends_at)
      values (v_a.tenant_id, v_a.app_user_id, v_a.device_id, p_auth_session, p_at, v_ends);
    update public.venue_device set last_login_at = p_at where id = v_a.device_id;
    return jsonb_build_object('status', 'ok', 'endsAt', v_ends);
  end if;

  -- A wrong PIN.
  update public.auth_attempt set outcome = 'failure', finished_at = p_at where id = v_a.id;
  if app.lock_device_if_needed(v_a.device_id, p_at) then
    return jsonb_build_object('status', 'device_locked');
  end if;
  v_until := app.user_lock_until(v_a.app_user_id, p_at);
  if v_until is not null then
    return jsonb_build_object('status', 'user_locked', 'lockedUntil', v_until);
  end if;
  v_run := app.user_failure_run(v_a.app_user_id, p_at);
  return jsonb_build_object('status', 'pin_invalid', 'attemptsLeft', greatest(5 - v_run, 0));
end
$$;

revoke all on function app.lock_pin_login(uuid, uuid), app.user_verified_attempts(uuid, timestamptz),
  app.user_failure_run(uuid, timestamptz), app.user_lock_until(uuid, timestamptz),
  app.device_failures(uuid, timestamptz),
  app.end_staff_sessions(uuid, uuid, public.staff_session_end, timestamptz),
  app.lock_device_if_needed(uuid, timestamptz), app.pin_login_begin_at(text, uuid, timestamptz),
  app.pin_login_finish_at(uuid, public.auth_attempt_outcome, uuid, timestamptz)
  from public, anon, authenticated, service_role;

-- The route-facing wrappers (real clock). service_role only.
create function public.pin_login_begin(p_token_hash text, p_user uuid) returns jsonb
  language sql
  security definer
  set search_path = ''
as $$
  select app.pin_login_begin_at(p_token_hash, p_user, clock_timestamp())
$$;

create function public.pin_login_finish(p_attempt uuid, p_outcome text, p_auth_session uuid) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if p_outcome is null or p_outcome not in ('success', 'failure', 'error') then
    raise exception 'invalid_outcome' using errcode = '22023';
  end if;
  return app.pin_login_finish_at(p_attempt, p_outcome::public.auth_attempt_outcome, p_auth_session,
                                 clock_timestamp());
end
$$;

revoke all on function public.pin_login_begin(text, uuid), public.pin_login_finish(uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.pin_login_begin(text, uuid), public.pin_login_finish(uuid, text, uuid)
  to service_role;
