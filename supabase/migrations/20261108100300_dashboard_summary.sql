-- Owner dashboard (docs/plans/2026-10-28-owner-dashboard.md) step 4: public.dashboard_summary(), one JSON document per call
-- for the owner and the admin (founder answers Q106-Q108).
--
-- SECURITY DEFINER, as the plan justifies (§3.1 decision 1): it must call app.plate_cost_rows, app.usable_on_hand and
-- app.expiry_state, which are closed to every API role because they take the tenant as a parameter. Granting them to
-- `authenticated` so that an INVOKER function could call them would let any user pass another tenant's id. So, as for every
-- definer function of the project:
--   * the role is checked FIRST: owner or admin, else 42501 before any read;
--   * search_path is empty and every name is schema-qualified;
--   * the tenant comes from app.tenant_id(), never from a parameter (there is none), and every helper filters by it;
--   * the app.dashboard_* helpers are closed to every API role; only this function reaches them.
-- It also calls three public functions that re-check the role (they pass for owner and admin): today_counts() (INVOKER, PR B;
-- it filters by tenant itself, which pgTAP 205 proves), waste_costs(from, to) and, for the owner only, fixed_cost_status().
--
-- The admin's document has no fixedCosts key and none of the owner-only alert keys (alertsOpen, priceVariance, todayLists,
-- names): the admin reads no alert (alert RLS), and fixed costs are the owner's alone (Q107). The plate figures exclude
-- fixed costs for both roles (app.dashboard_plates). pgTAP 204 proves the exact key sets.
create function public.dashboard_summary() returns jsonb
  language plpgsql stable
  security definer
  set search_path = ''
as $$
declare
  v_role text := coalesce((select app.role())::text, '');
  v_tenant uuid;
  v_now timestamptz := now();
  v_today date;
  v_week record;
  v_waste jsonb;
  v_alerts jsonb;
  v_out jsonb;
begin
  if v_role not in ('owner', 'admin') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  v_tenant := app.tenant_id();
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
             'comingSoon', jsonb_build_array('covers', 'revenue', 'averageSpend'));

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

revoke all on function public.dashboard_summary() from public, anon, service_role;
grant execute on function public.dashboard_summary() to authenticated;
