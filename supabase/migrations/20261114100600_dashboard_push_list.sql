-- M23 step 6 (docs/plans/2026-10-31-m23-push-forecast.md §3.1.8, §3.2; T3): the dashboard fills the M22 "pushList" slot.
--
--   app.dashboard_push_list(tenant, now)   {count, expired: {batches, lots}, items}: the first app.dashboard_list_cap() rows of app.push_list_json with the owner/admin keys
--                                          (both dashboard roles see euro). Still one RPC per dashboard load.
--   app.dashboard_summary_at               the body of 20261112100600 (M22) verbatim, with `pushList` added and comingSoon = [] (the M22 SQL and TS schemas already accept
--                                          an empty list). public.dashboard_summary() is not touched: it keeps its role gate and calls this twin.
-- pgTAP 253 compares the reply minus pushList and comingSoon with a copy of the M22 body.

create function app.dashboard_push_list(p_tenant uuid, p_now timestamptz) returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select jsonb_build_object(
           'count', (x.j -> 'totals' ->> 'count')::integer,
           'expired', x.j -> 'expired',
           'items', coalesce((select jsonb_agg(e.value order by e.ord)
                                from jsonb_array_elements(x.j -> 'rows') with ordinality e (value, ord)
                               where e.ord <= app.dashboard_list_cap()), '[]'::jsonb))
    from (select app.push_list_json(p_tenant, 'owner', p_now) as j) x
$$;

create or replace function app.dashboard_summary_at(p_tenant uuid, p_role text, p_now timestamptz) returns jsonb
  language plpgsql stable
  security definer
  set search_path = ''
as $$
declare
  v_role text := coalesce(p_role, '');
  v_tenant uuid := p_tenant;
  v_now timestamptz := p_now;
  v_today date;
  v_week record;
  v_waste jsonb;
  v_alerts jsonb;
  v_out jsonb;
begin
  if v_role not in ('owner', 'admin') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if v_tenant is null then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  v_today := app.alert_business_date(v_tenant, v_now);
  select * into v_week from app.dashboard_week(v_tenant, v_now);

  -- waste_costs, reduced to what the tile shows (its lines stay on the waste screen).
  v_waste := public.waste_costs(v_week.week_from, v_week.week_to);
  v_waste := jsonb_build_object(
    'from', v_waste -> 'from', 'to', v_waste -> 'to', 'valueEur', v_waste -> 'valueEur',
    'rawValueEur', v_waste -> 'rawValueEur', 'batchValueEur', v_waste -> 'batchValueEur',
    'unvaluedCount', v_waste -> 'unvaluedCount',
    'reasons', coalesce((select jsonb_agg(jsonb_build_object('reasonCode', r.value -> 'reasonCode', 'valueEur', r.value -> 'valueEur')
                                          order by r.ord)
                           from jsonb_array_elements(v_waste -> 'reasons') with ordinality r (value, ord)), '[]'::jsonb));

  v_out := jsonb_build_object('role', v_role, 'asOf', app.iso_utc(v_now), 'today', public.today_counts())
        || app.dashboard_plates(v_tenant)
        || jsonb_build_object(
             'payables', app.dashboard_payables(v_tenant, v_today),
             'stockAtRisk', app.dashboard_stock_at_risk(v_tenant, v_now),
             'waste', v_waste,
             'yesterday', app.dashboard_yesterday(v_tenant, v_now),
             'pushList', app.dashboard_push_list(v_tenant, v_now),
             'comingSoon', '[]'::jsonb);

  if v_role = 'owner' then
    v_alerts := app.dashboard_alerts(v_tenant, v_now);
    v_out := v_out || v_alerts || jsonb_build_object(
      'names', app.dashboard_alert_names(v_tenant,
                 (v_alerts -> 'priceVariance' -> 'items') || (v_alerts -> 'todayLists' -> 'prep') || (v_alerts -> 'todayLists' -> 'purchase')),
      'fixedCosts', public.fixed_cost_status());
  end if;
  return v_out;
end
$$;

revoke all on function app.dashboard_push_list(uuid, timestamptz), app.dashboard_summary_at(uuid, text, timestamptz)
  from public, anon, authenticated, service_role;
