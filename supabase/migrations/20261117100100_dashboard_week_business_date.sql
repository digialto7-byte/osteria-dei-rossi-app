-- Founder decision A5, review fix: the dashboard's week and the default waste range follow the BUSINESS date, as the batch waste they read now does.
--   app.dashboard_week      the ISO week of the business date of p_at (was the calendar date through app.alert_business_date). Its only users are the waste tile of
--                           dashboard_summary_at, dashboard_kpis and dashboard_push_list (each reads v_week for public.waste_costs and nothing else), so it changes in place.
--                           Between 00:00 and the cut-off on a Monday the tile is still the previous week, where the batch discards of that night now count.
--                           The alert and Oggi lists keep app.alert_business_date (the calendar date, Q109): they do not use this function.
--   public.business_date_of the business date of an instant for the caller's tenant. The waste-costs route uses it for its default range (to = business date, from = the
--                           1st of that month), because the cut-off is tenant data and the web tier has no copy of it. Any signed-in staff role; it returns one date.
-- raw_waste_costs (raw stock) still counts by the calendar date; that is the lead's open question and is not changed here.

create or replace function app.dashboard_week(p_tenant uuid, p_at timestamptz) returns table (week_from date, week_to date)
  language plpgsql stable
  security definer
  set search_path = ''
as $$
declare
  v_day date := app.business_date(p_tenant, p_at);  -- raises tenant_not_found (P0002)
  v_monday date := v_day - (extract(isodow from v_day)::integer - 1);
begin
  return query select v_monday, v_monday + 6;
end
$$;

revoke all on function app.dashboard_week(uuid, timestamptz) from public, anon, authenticated, service_role;

create function public.business_date_of(p_at timestamptz) returns date
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  v_tenant := app.tenant_id();
  if v_tenant is null or app.role() is null then
    raise exception 'permission denied: sign in with a staff role' using errcode = '42501';
  end if;
  if p_at is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  return app.business_date(v_tenant, p_at);
end
$$;

revoke all on function public.business_date_of(timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.business_date_of(timestamptz) to authenticated;
