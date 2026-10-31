-- M22 step 7 (docs/plans/2026-10-31-m22-kpi-reporting.md §3.2; ADR-025; AT2 on the dashboard, AT9): the dashboard learns yesterday, and the owner's opens are counted.
--
--   app.dashboard_yesterday(tenant, now)   the "Ieri" tile: yesterday's business date (app.business_date(now) - 1) and its comparison day (7 earlier), built with
--                                          app.kpi_range_agg like kpi_report('day', D), so the figures and the deltas are the report's; stored rows when final, the
--                                          same figures live otherwise. costedRevenueNetEur is here beyond the plan's list: the hint "sui piatti con costo noto
--                                          (71,59 EUR di 119,13 EUR)" needs it and the browser must not compute it.
--   app.dashboard_summary_at(t, role, now) the body of dashboard_summary of 20261108100300 verbatim, with the tenant, the role and the instant as parameters, comingSoon =
--                                          ["pushList"] (covers, revenue and average spend are real now) and the new key yesterday for both roles.
--   public.dashboard_summary()             keeps its role gate (owner or admin, else 42501, before any read) and calls the twin with the caller's tenant, role and now().
--   public.record_dashboard_open()         owner only: counts one open of Oggi in the venue's ISO week (Monday of app.venue_date(now)), count only, no time of the
--                                          visit is stored at all. Its twin app.record_dashboard_open_at(tenant, user, now) is what pgTAP calls.
-- Every app.* function is closed to the API roles.

create function app.dashboard_yesterday(p_tenant uuid, p_now timestamptz) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_d date := app.business_date(p_tenant, p_now) - 1;
  v_cur jsonb := app.kpi_range_agg(p_tenant, v_d, v_d);
  v_prev jsonb := app.kpi_range_agg(p_tenant, v_d - 7, v_d - 7);
  v_delta jsonb;
begin
  select jsonb_object_agg(x.k, case when x.c is null or x.p is null then null
                                    else jsonb_build_object('abs', round(x.c - x.p, 4),
                                                            'pct', case when x.p = 0 then null else round((x.c - x.p) / x.p * 100, 1) end) end)
    into v_delta
    from (select k.key as k, (v_cur ->> k.key)::numeric as c, (v_prev ->> k.key)::numeric as p
            from (values ('covers'), ('revenueNetEur'), ('avgSpendPerCoverEur'), ('avgTicketEur'), ('foodCostPct')) k (key)) x;
  return jsonb_build_object(
    'businessDate', v_d, 'final', v_cur -> 'final', 'covers', v_cur -> 'covers', 'tables', v_cur -> 'tables',
    'revenueNetEur', v_cur -> 'revenueNetEur', 'avgSpendPerCoverEur', v_cur -> 'avgSpendPerCoverEur', 'avgTicketEur', v_cur -> 'avgTicketEur',
    'foodCostPct', v_cur -> 'foodCostPct', 'costedSharePct', v_cur -> 'costedSharePct', 'costedRevenueNetEur', v_cur -> 'costedRevenueNetEur',
    'compare', jsonb_build_object('businessDate', v_d - 7, 'covers', v_prev -> 'covers', 'revenueNetEur', v_prev -> 'revenueNetEur',
                                  'avgSpendPerCoverEur', v_prev -> 'avgSpendPerCoverEur', 'avgTicketEur', v_prev -> 'avgTicketEur', 'foodCostPct', v_prev -> 'foodCostPct'),
    'delta', v_delta);
end
$$;

create function app.dashboard_summary_at(p_tenant uuid, p_role text, p_now timestamptz) returns jsonb
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
             'comingSoon', jsonb_build_array('pushList'));

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


create or replace function public.dashboard_summary() returns jsonb
  language plpgsql stable
  security definer
  set search_path = ''
as $$
declare
  v_role text := coalesce((select app.role())::text, '');
  v_tenant uuid;
begin
  if v_role not in ('owner', 'admin') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  v_tenant := app.tenant_id();
  if v_tenant is null then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  return app.dashboard_summary_at(v_tenant, v_role, now());
end
$$;

create function app.record_dashboard_open_at(p_tenant uuid, p_user uuid, p_now timestamptz) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_tz text;
  v_date date;
  v_week date;
  v_opens integer;
begin
  select t.timezone into v_tz from public.tenant t where t.id = p_tenant;
  if not found then
    raise exception 'tenant_not_found' using errcode = 'P0002';
  end if;
  v_date := app.venue_date(p_now, v_tz);
  v_week := v_date - (extract(isodow from v_date)::integer - 1);
  -- One statement: two concurrent opens of one owner serialise on the row and both count.
  insert into public.dashboard_open (tenant_id, app_user_id, iso_week, opens)
    values (p_tenant, p_user, v_week, 1)
  on conflict (tenant_id, app_user_id, iso_week) do update set opens = public.dashboard_open.opens + 1
  returning opens into v_opens;
  return jsonb_build_object('isoWeek', v_week, 'opens', v_opens);
end
$$;

create function public.record_dashboard_open() returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  if coalesce((select app.role())::text, '') <> 'owner' then
    raise exception 'permission denied: only the owner''s opens are counted' using errcode = '42501';
  end if;
  return app.record_dashboard_open_at(app.tenant_id(), app.app_user_id(), now());
end
$$;

revoke all on function app.dashboard_yesterday(uuid, timestamptz), app.dashboard_summary_at(uuid, text, timestamptz),
  app.record_dashboard_open_at(uuid, uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.record_dashboard_open() from public, anon, authenticated, service_role;
grant execute on function public.record_dashboard_open() to authenticated;
