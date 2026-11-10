-- Reservations B2 (docs/plans/2026-11-08-reservations.md §3.1.13, §3.3.5, §5 B2; ADR-032): cancel by link. The route has verified the token MAC (c1.<kid>.<id>.<exp>.<mac>) before any
-- call; the two anon wrappers take the reservation id and the token's exp (epoch seconds) behind the same route gate as B1.
--
--   app.reservation_slug_tenant(slug)            the tenant of a slug, whether or not the page is switched on: a customer holding a cancel link can still cancel after the owner
--                                                switches online booking off. Unknown slug: P0002 not_found. (The page, slots and request wrappers still need enabled and ready.)
--   app.reservation_cancel_until(tenant, starts_at, exp)   the instant from which a cancel is closed: the earlier of exp and the start minus cancel_until_minutes. The earlier
--                                                of the two, so a booking moved earlier than the token says closes at its new start.
--   app.reservation_cancel_view_at(tenant, id, exp, now)   {date, time, party, serviceName, status, canCancel}: the local date and time, the effective status (a pending request past
--                                                its start reads expired), no name, phone, e-mail or id. canCancel = pending or accepted and now before the deadline.
--   app.cancel_reservation_at(tenant, id, exp, now)        pending or accepted -> cancelled, the tables released, event cancelled_by_customer (no user, no data). Single use: a
--                                                booking already cancelled answers {already: true} and writes nothing, also after exp. arrived, seated, declined, no_show and expired
--                                                (stored) are P0001 status_invalid; a live booking at or past its deadline is P0001 cancel_closed.
--   public.reservation_cancel_view / public.cancel_reservation (slug, gate ts, gate mac, id, exp)   gate first, then the slug, then the twin with the real clock. anon only.
-- Another tenant's reservation, an unknown id and an unknown slug are all P0002 not_found: nothing can be enumerated. Errors carry codes only.
--
-- One deliberate loosening of PR1's table: reservation_table_released_ck said "released_at and released_by are both set or both null", and a customer who cancels is no app user, so
-- the release has no released_by (like reservation_event.created_by, null = the customer or a job). The check now says "a releaser implies a release time"; the guard still lets a row
-- be released once and nothing else about it change.

alter table public.reservation_table drop constraint reservation_table_released_ck;
alter table public.reservation_table add constraint reservation_table_released_ck check (released_by is null or released_at is not null);

create function app.reservation_slug_tenant(p_slug text) returns uuid
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select s.tenant_id into v_tenant from public.reservation_settings s where s.public_slug = p_slug;
  if v_tenant is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return v_tenant;
end
$$;

create function app.reservation_cancel_until(p_tenant uuid, p_starts timestamptz, p_exp bigint) returns timestamptz
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select least(to_timestamp(p_exp), p_starts - make_interval(mins => (app.reservation_settings_row(p_tenant) ->> 'cancel_until_minutes')::integer))
$$;

create function app.reservation_cancel_view_at(p_tenant uuid, p_id uuid, p_exp bigint, p_now timestamptz) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  r public.reservation;
  v_tz text;
  v_status text;
begin
  select x.* into r from public.reservation x where x.tenant_id = p_tenant and x.id = p_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select t.timezone into v_tz from public.tenant t where t.id = p_tenant;
  v_status := case when r.status = 'pending' and p_now >= r.starts_at then 'expired' else r.status::text end;
  return jsonb_build_object(
    'date', to_char(r.starts_at at time zone v_tz, 'YYYY-MM-DD'),
    'time', to_char(r.starts_at at time zone v_tz, 'HH24:MI'),
    'party', r.party,
    'serviceName', coalesce((select e ->> 'name' from jsonb_array_elements(app.service_periods_at(p_tenant, p_now)) e where e ->> 'key' = r.service_key), r.service_key),
    'status', v_status,
    'canCancel', r.status in ('pending', 'accepted') and p_now < app.reservation_cancel_until(p_tenant, r.starts_at, p_exp));
end
$$;

create function app.cancel_reservation_at(p_tenant uuid, p_id uuid, p_exp bigint, p_now timestamptz) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  r public.reservation;
begin
  select x.* into r from public.reservation x where x.tenant_id = p_tenant and x.id = p_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if r.status = 'cancelled' then
    return jsonb_build_object('status', 'cancelled', 'already', true);
  end if;
  if r.status not in ('pending', 'accepted') then
    raise exception 'status_invalid' using errcode = 'P0001';
  end if;
  if p_now >= app.reservation_cancel_until(p_tenant, r.starts_at, p_exp) then
    raise exception 'cancel_closed' using errcode = 'P0001';
  end if;
  perform app.reservation_tables_lock(p_tenant, r.business_date);
  update public.reservation set status = 'cancelled', updated_at = p_now where tenant_id = p_tenant and id = r.id;
  perform app.reservation_release_tables(p_tenant, r.id, null, p_now);
  perform app.reservation_event(p_tenant, r.id, 'cancelled_by_customer', '{}'::jsonb, null, p_now);
  return jsonb_build_object('status', 'cancelled', 'already', false);
end
$$;

create function public.reservation_cancel_view(p_slug text, p_gate_ts bigint, p_gate_mac text, p_reservation uuid, p_exp bigint) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  perform app.reservation_gate_ok('reservation_cancel_view', p_slug, p_gate_ts, p_gate_mac, v_now);
  return app.reservation_cancel_view_at(app.reservation_slug_tenant(p_slug), p_reservation, p_exp, v_now);
end
$$;

create function public.cancel_reservation(p_slug text, p_gate_ts bigint, p_gate_mac text, p_reservation uuid, p_exp bigint) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  perform app.reservation_gate_ok('cancel_reservation', p_slug, p_gate_ts, p_gate_mac, v_now);
  return app.cancel_reservation_at(app.reservation_slug_tenant(p_slug), p_reservation, p_exp, v_now);
end
$$;

revoke all on function app.reservation_slug_tenant(text), app.reservation_cancel_until(uuid, timestamptz, bigint), app.reservation_cancel_view_at(uuid, uuid, bigint, timestamptz),
  app.cancel_reservation_at(uuid, uuid, bigint, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.reservation_cancel_view(text, bigint, text, uuid, bigint), public.cancel_reservation(text, bigint, text, uuid, bigint) from public, authenticated, service_role;
grant execute on function public.reservation_cancel_view(text, bigint, text, uuid, bigint), public.cancel_reservation(text, bigint, text, uuid, bigint) to anon;
