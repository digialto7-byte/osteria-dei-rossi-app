-- Reservations B3 (docs/plans/2026-11-08-reservations.md §3.1.11, §3.3.2, §5 B3; ADR-032): the e-mail outbox, its claim and finish, and the cron job that wakes the mail route.
--
-- The rows are written by PR1's functions in the same transaction as the state change (received, accepted, declined) and hold no address and nothing personal. A row is
--   queued   waiting for its next_attempt_at (a failed row is waiting for its backoff the same way);
--   sending  claimed under a lease of 120 s, with one more attempt counted;
--   sent     done (sent_at, provider_message_id);
--   failed   the last try failed. It is retried after 1, 5, 15 and 60 minutes; at attempt 5, or when the provider rejected the mail ('rejected': a 4xx that a retry cannot fix),
--            it is failed for good;
--   skipped  the contact is gone or has no address (erased, purged): no send.
--
--   app.reservation_mail_due(now)              true when a row can be claimed: queued or failed, attempts under 5, not rejected, its time come; or sending with a lease that ran out.
--   app.reservation_mail_claim_at(limit, now)  1..50 rows FOR UPDATE SKIP LOCKED, oldest next_attempt_at first. A sending row whose lease ran out at attempt 5 is first marked failed
--                                              (lease_expired), so a crash cannot leave a row stuck. Each claimed row is returned with what the route needs to write the mail:
--                                              {id, kind, to, locale, name, venueName, slug, reservationId, date, time, party, serviceName, cancelExp}, where date and time are the venue's
--                                              local ones and cancelExp (epoch seconds) is the start minus cancel_until_minutes, null for a declined mail (it carries no link).
--   app.reservation_mail_finish_at(id, ok, provider id, error code, now)   sent, or the retry / final failure above. Only a sending row changes; any other answers changed false.
--                                              The error code must be a plain code (a-z, 0-9, _), else it is stored as 'error', so nothing personal can reach the table.
--   public.reservation_mail_claim(limit) and public.reservation_mail_finish(...)   thin wrappers with the real clock, executable by service_role only (the cron route).
-- pg_cron runs reservation-mail every minute, only when work is due (as extract-invoices does). job_run_job_check gains 'reservation-mail'. Errors carry codes only.

alter table app.job_run drop constraint job_run_job_check;
alter table app.job_run
  add constraint job_run_job_check check (job in ('extract', 'alert-rules', 'auth-purge', 'ledger-invariants', 'kpi-rollup', 'reservation-mail'));

-- finish looks a row up by id alone (the route knows no tenant).
create index reservation_email_id_idx on public.reservation_email (id);

create function app.reservation_mail_due(p_now timestamptz default clock_timestamp()) returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1
      from public.reservation_email e
     where (e.status in ('queued', 'failed') and e.attempts < 5 and e.error_code is distinct from 'rejected' and e.next_attempt_at <= p_now)
        or (e.status = 'sending' and e.lease_until <= p_now))
$$;

create function app.reservation_mail_claim_at(p_limit integer, p_now timestamptz) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  e public.reservation_email;
  c public.reservation_contact;
  r public.reservation;
  v_cfg jsonb;
  v_tz text;
  v_name text;
  v_out jsonb := '[]'::jsonb;
begin
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  -- A lease that ran out at the attempt cap: nothing more is tried.
  update public.reservation_email x set status = 'failed', lease_until = null, error_code = 'lease_expired'
   where x.status = 'sending' and x.lease_until <= p_now and x.attempts >= 5;

  for e in
    select x.* from public.reservation_email x
     where (x.status in ('queued', 'failed') and x.attempts < 5 and x.error_code is distinct from 'rejected' and x.next_attempt_at <= p_now)
        or (x.status = 'sending' and x.lease_until <= p_now)
     order by x.next_attempt_at, x.id
     limit p_limit
       for update skip locked
  loop
    select k.* into c from public.reservation_contact k where k.tenant_id = e.tenant_id and k.reservation_id = e.reservation_id;
    if not found or c.email is null then
      update public.reservation_email set status = 'skipped', lease_until = null, error_code = 'contact_gone' where tenant_id = e.tenant_id and id = e.id;
      continue;
    end if;
    select x.* into r from public.reservation x where x.tenant_id = e.tenant_id and x.id = e.reservation_id;
    v_cfg := app.reservation_settings_row(e.tenant_id);
    select t.timezone, t.name into v_tz, v_name from public.tenant t where t.id = e.tenant_id;
    update public.reservation_email set status = 'sending', lease_until = p_now + interval '120 seconds', attempts = attempts + 1
     where tenant_id = e.tenant_id and id = e.id;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'id', e.id,
      'kind', e.kind,
      'to', c.email,
      'locale', c.locale,
      'name', c.name,
      'venueName', v_name,
      'slug', v_cfg -> 'public_slug',
      'reservationId', e.reservation_id,
      'date', to_char(r.starts_at at time zone v_tz, 'YYYY-MM-DD'),
      'time', to_char(r.starts_at at time zone v_tz, 'HH24:MI'),
      'party', r.party,
      'serviceName', coalesce((select p ->> 'name' from jsonb_array_elements(app.service_periods_at(e.tenant_id, p_now)) p where p ->> 'key' = r.service_key), r.service_key),
      'cancelExp', case when e.kind = 'declined' then null
                        else extract(epoch from r.starts_at - make_interval(mins => (v_cfg ->> 'cancel_until_minutes')::integer))::bigint end));
  end loop;
  return v_out;
end
$$;

create function app.reservation_mail_finish_at(p_id uuid, p_ok boolean, p_provider text, p_error text, p_now timestamptz) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  e public.reservation_email;
  v_code text;
  v_backoff integer[] := array[1, 5, 15, 60];
begin
  select x.* into e from public.reservation_email x where x.id = p_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if e.status <> 'sending' then
    return jsonb_build_object('status', e.status, 'changed', false);
  end if;
  if p_ok then
    update public.reservation_email set status = 'sent', sent_at = p_now, provider_message_id = p_provider, lease_until = null, error_code = null
     where tenant_id = e.tenant_id and id = e.id;
    return jsonb_build_object('status', 'sent', 'changed', true);
  end if;
  v_code := case when p_error ~ '^[a-z0-9_]{1,40}$' then p_error else 'error' end;
  update public.reservation_email
     set status = 'failed', lease_until = null, error_code = v_code,
         next_attempt_at = case when v_code = 'rejected' or e.attempts >= 5 then e.next_attempt_at
                                else p_now + make_interval(mins => v_backoff[least(greatest(e.attempts, 1), 4)]) end
   where tenant_id = e.tenant_id and id = e.id;
  return jsonb_build_object('status', 'failed', 'changed', true);
end
$$;

create function public.reservation_mail_claim(p_limit integer) returns jsonb
  language sql
  volatile
  security definer
  set search_path = ''
as $$
  select app.reservation_mail_claim_at(p_limit, clock_timestamp())
$$;

create function public.reservation_mail_finish(p_id uuid, p_ok boolean, p_provider text, p_error text) returns jsonb
  language sql
  volatile
  security definer
  set search_path = ''
as $$
  select app.reservation_mail_finish_at(p_id, p_ok, p_provider, p_error, clock_timestamp())
$$;

revoke all on function app.reservation_mail_due(timestamptz), app.reservation_mail_claim_at(integer, timestamptz),
  app.reservation_mail_finish_at(uuid, boolean, text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.reservation_mail_claim(integer), public.reservation_mail_finish(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.reservation_mail_claim(integer), public.reservation_mail_finish(uuid, boolean, text, text) to service_role;

select cron.schedule(
  'reservation-mail',
  '* * * * *',
  $job$select app.call_cron_route('/api/cron/reservation-mail') where app.reservation_mail_due()$job$);
