-- P2-2 S6 (docs/plans/2026-11-14-p2-2-trace-sell-through.md section 3.5, D-P9, D-P10; reservations plan V2): the booked covers per service, counts only. The chef must plan the prep with the
-- number of confirmed bookings and covers but must never see a name, a phone or an e-mail (D9), so the numbers come from a definer and the chef keeps 0 rows from every reservation table.
--
--   app.require_covers_reader     owner, admin, waiter, chef; 42501 otherwise (a signed-out session, or an owner or admin the P2-1 gate holds at aal1: app.role() is null).
--   app.reservations_covers_json  {businessDate, services: [{key, name, reservations, covers}]} and no other key. p_date null is the business today; the date must be from today to
--                                 today + app.forecast_days_ahead() (6, the forecast panel's day picker), else P0001 date_out_of_range. Services: those of the version in force in window order, then any
--                                 other key that has a booking that day (under its latest name, or the key). Counted: status accepted, arrived or seated (D-P10; pending requests are not counted,
--                                 Q-P7). app.reservations_day_json is not changed (its counts still include pending, for owner, admin and waiter).
--   public.reservations_covers    calls the gate first, tenant from the session; executable by `authenticated` only.

create function app.require_covers_reader() returns void
  language plpgsql
  stable
  set search_path = ''
as $$
begin
  if app.role() is null or app.role() not in ('owner', 'admin', 'waiter', 'chef') then
    raise exception 'permission denied: the booked covers need owner, admin, waiter or chef' using errcode = '42501';
  end if;
end
$$;

create function app.reservations_covers_json(p_tenant uuid, p_date date, p_now timestamptz) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_today date := app.business_date(p_tenant, p_now);
  v_date date;
  v_labels jsonb := app.service_labels(p_tenant, p_now);
begin
  v_date := coalesce(p_date, v_today);
  if v_date < v_today or v_date > v_today + app.forecast_days_ahead() then
    raise exception 'date_out_of_range' using errcode = 'P0001';
  end if;
  return jsonb_build_object('businessDate', v_date, 'services', coalesce((
    with res as (
      select r.service_key, r.party
        from public.reservation r
       where r.tenant_id = p_tenant and r.business_date = v_date and r.status in ('accepted', 'arrived', 'seated')),
    cur as (
      select w ->> 'key' as key, w ->> 'name' as name, (w ->> 'position')::integer as pos
        from jsonb_array_elements(app.service_windows(app.service_periods_at(p_tenant, p_now), app.business_day_cutoff(p_tenant))) w),
    extra as (
      select d.service_key as key, coalesce(v_labels -> d.service_key ->> 'name', d.service_key) as name, 1000 as pos
        from (select distinct res.service_key from res where res.service_key not in (select cur.key from cur)) d),
    keys as (
      select c.key, c.name, c.pos from cur c
      union all
      select e.key, e.name, e.pos from extra e)
    select jsonb_agg(jsonb_build_object(
             'key', k.key, 'name', k.name,
             'reservations', (select count(*)::integer from res where res.service_key = k.key),
             'covers', (select coalesce(sum(res.party), 0)::integer from res where res.service_key = k.key))
           order by k.pos, k.key)
      from keys k), '[]'::jsonb));
end
$$;

create function public.reservations_covers(p_date date default null) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  perform app.require_covers_reader();
  return app.reservations_covers_json(app.tenant_id(), p_date, clock_timestamp());
end
$$;

revoke all on function app.require_covers_reader(), app.reservations_covers_json(uuid, date, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.reservations_covers(date) from public, anon, authenticated, service_role;
grant execute on function public.reservations_covers(date) to authenticated;
