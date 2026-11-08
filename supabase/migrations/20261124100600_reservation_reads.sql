-- Reservations A6 (docs/plans/2026-11-08-reservations.md §3.2, §5 A6): what the staff screens read.
--
--   public.reservations_day(p_date)         owner, admin, waiter (app.require_table_operator): {businessDate, services: [{key, name, startsAt, endsAt, counts, reservations: [Row]}]}.
--                                           Services: those of the version in force in M25c order, then any older key that still has a booking that day (listed under its stored key,
--                                           with its latest name, or the key, and no window). Rows by start, then id. counts: bookings that are live (pending, accepted, arrived,
--                                           seated: an expired, declined, cancelled or no-show booking is not counted), their covers, and how many are still pending.
--                                           A null date is today's business date. The date must be from 62 days back to the settings horizon ahead (the business calendar), else P0001 date_invalid.
--   public.reservation_detail(p_id)         owner, admin, waiter: the Row plus events [{kind, at}] (no staff names), seatChoices [{id, name}] (the tables a booking that offers seat and has no table may
--                                           take: active, no open session of their own, not joined; [] otherwise) and, for owner and admin on a pending or accepted booking, the
--                                           suggestion. Another tenant's id is P0002 reservation_not_found.
--   public.reservations_pending_count()     owner, admin: {pending}, the requests that are pending and have not started: the badge of Prenotazioni.
-- The Row (app.reservation_row_json, A5) holds the personal data (null once erased), the effective status (a pending request past its start reads expired), the actions the caller may take,
-- and emailStatus for owner and admin only. The chef gets 42501 on all three, before anything is read.
-- Departures from the plan text: the per-service block is called counts, not totals (no key of any reply names a total), and joinedTo sits on each table of a Row with leadTable naming the lead.

create function app.reservations_day_json(p_tenant uuid, p_role text, p_date date, p_now timestamptz) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_labels jsonb := app.service_labels(p_tenant, p_now);
  v_today date := app.business_date(p_tenant, p_now);
begin
  -- The window of plan 3.4: 62 days back up to the tenant's booking horizon ahead, on the business calendar. Anything else is date_invalid.
  if p_date < v_today - 62 or p_date > v_today + (app.reservation_settings_row(p_tenant) ->> 'horizon_days')::integer then
    raise exception 'date_invalid' using errcode = 'P0001';
  end if;
  return jsonb_build_object('businessDate', p_date, 'services', coalesce((
    with res as (
      select r.id, r.service_key, r.party, r.starts_at, x.j
        from public.reservation r
       cross join lateral (select app.reservation_row_json(p_tenant, r.id, p_role, p_now) as j) x
       where r.tenant_id = p_tenant and r.business_date = p_date),
    cur as (
      select w ->> 'key' as key, w ->> 'name' as name, w ->> 'startsAt' as s, w ->> 'endsAt' as e, (w ->> 'position')::integer as pos
        from jsonb_array_elements(app.service_windows(app.service_periods_at(p_tenant, p_now), app.business_day_cutoff(p_tenant))) w),
    keys as (
      select c.key, c.name, c.s, c.e, c.pos from cur c
      union all
      select d.service_key, coalesce(v_labels -> d.service_key ->> 'name', d.service_key), null, null, 1000
        from (select distinct res.service_key from res where res.service_key not in (select cur.key from cur)) d)
    select jsonb_agg(jsonb_build_object(
             'key', k.key, 'name', k.name, 'startsAt', to_jsonb(k.s), 'endsAt', to_jsonb(k.e),
             'counts', jsonb_build_object(
               'reservations', (select count(*) from res where res.service_key = k.key and res.j ->> 'status' in ('pending', 'accepted', 'arrived', 'seated')),
               'covers', (select coalesce(sum(res.party), 0) from res where res.service_key = k.key and res.j ->> 'status' in ('pending', 'accepted', 'arrived', 'seated')),
               'pending', (select count(*) from res where res.service_key = k.key and res.j ->> 'status' = 'pending')),
             'reservations', coalesce((select jsonb_agg(res.j order by res.starts_at, res.id) from res where res.service_key = k.key), '[]'::jsonb))
           order by k.pos, k.key)
      from keys k), '[]'::jsonb));
end
$$;

create function app.reservations_pending_json(p_tenant uuid, p_now timestamptz) returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select jsonb_build_object('pending', (select count(*) from public.reservation r where r.tenant_id = p_tenant and r.status = 'pending' and r.starts_at > p_now))
$$;

create function public.reservations_day(p_date date) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  perform app.require_table_operator();
  return app.reservations_day_json(app.tenant_id(), app.role()::text, coalesce(p_date, app.business_date(app.tenant_id(), clock_timestamp())), clock_timestamp());
end
$$;

-- The detail of a booking, plus seatChoices: app.reservation_seat_choices (20261124100650, next to the joined-table rule it uses; plpgsql resolves it when called) when the booking offers "seat" and has no lead table, else [].
create function public.reservation_detail(p_id uuid) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_detail jsonb;
begin
  perform app.require_table_operator();
  v_tenant := app.tenant_id();
  v_detail := app.reservation_detail_json(v_tenant, p_id, app.role()::text, clock_timestamp());
  return v_detail || jsonb_build_object('seatChoices',
    case when v_detail -> 'actions' ? 'seat' and v_detail -> 'leadTable' = 'null'::jsonb then app.reservation_seat_choices(v_tenant) else '[]'::jsonb end);
end
$$;

create function public.reservations_pending_count() returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  perform app.require_day_closer();
  return app.reservations_pending_json(app.tenant_id(), clock_timestamp());
end
$$;

revoke all on function app.reservations_day_json(uuid, text, date, timestamptz), app.reservations_pending_json(uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.reservations_day(date), public.reservation_detail(uuid), public.reservations_pending_count() from public, anon, service_role;
grant execute on function public.reservations_day(date), public.reservation_detail(uuid), public.reservations_pending_count() to authenticated;
