-- M22 step 4 (docs/plans/2026-10-31-m22-kpi-reporting.md §3.2, §3.3; ADR-025; AT1 per-item rows, AT2): the items report.
--
--   app.kpi_items_json   plates, mix, net revenue, food cost and food margin per menu item over a period (the period rules of app.kpi_period), summed from
--                        app.kpi_sales_lines, the same source as the rollup, so the totals equal kpi_report.current to the last digit:
--                        totals.foodCostPct = current.foodCostPct, totals.foodCostEur and costedRevenueNetEur are the same, and totals.revenueNetEur is the items' net
--                        revenue (the report's revenueNetEur minus the coperto).
--                        Status: costed (every plate has a frozen cost), partial (some), incomplete (mapped, none costed), unmapped (no recipe at sale).
--                        The OWNER also gets the fixed cost per plate (the costed lines' qty x app.fixed_cost_at(date).per_plate, over the costed plates), the gross margin per
--                        plate (food margin - fixed cost) and the contribution (gross margin per plate x plates), from unrounded values; all three are null when a date lacks a
--                        per-plate figure (fixedCostReason says why: no_fixed_costs or no_sales) or the item has no costed plate. For anyone else the keys are not built and
--                        app.fixed_cost_at is not even called (Q107).
--   public.kpi_items     the wrapper: owner and admin only, checked first.
-- Order: plates descending, then name (collate "C"), then id.

create function app.kpi_items_json(p_tenant uuid, p_role text, p_period text, p_date date, p_from date, p_to date, p_now timestamptz) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  per record;
  v_owner boolean := p_role = 'owner';
  v_rows jsonb;
  v_totals jsonb;
  v_final boolean;
begin
  select * into per from app.kpi_period(p_tenant, p_period, p_date, p_from, p_to, p_now);
  v_final := (select count(*) from public.daily_kpi s where s.tenant_id = p_tenant and s.business_date between per.from_d and per.to_d) = per.to_d - per.from_d + 1;

  with l as (
    select x.* from app.kpi_sales_lines(p_tenant, per.from_d, per.to_d) x
  ),
  -- Only the owner's call reads the fixed costs: the distinct dates of the costed lines, and none for anyone else.
  fc as (
    select d.business_date, f.per_plate, f.reason
      from (select distinct l2.business_date from l l2 where l2.costed and v_owner) d,
           lateral app.fixed_cost_at(p_tenant, d.business_date) f
  ),
  it as (
    select l.menu_item_id,
           min(l.item_name) as name,
           sum(l.qty) as plates,
           sum(l.net) as net,
           coalesce(sum(l.qty) filter (where l.costed), 0) as c_plates,
           coalesce(sum(l.net) filter (where l.costed), 0) as c_net,
           sum(l.food_cost) filter (where l.costed) as f_cost,
           coalesce(sum(l.qty) filter (where l.mapped), 0) as m_plates,
           sum(l.qty * fc.per_plate) filter (where l.costed) as fx,
           coalesce(bool_or(fc.per_plate is null) filter (where l.costed), false) as fx_missing,
           min(fc.reason) filter (where l.costed and fc.per_plate is null) as fx_reason
      from l
      left join fc on fc.business_date = l.business_date
     group by l.menu_item_id
  ),
  tot as (
    select coalesce(sum(it.plates), 0) as plates, coalesce(sum(it.net), 0) as net, coalesce(sum(it.c_net), 0) as c_net, coalesce(sum(it.f_cost), 0) as f_cost
      from it
  ),
  rowj as (
    select it.plates as sort_plates, it.name, it.menu_item_id,
           jsonb_build_object(
             'menuItemId', it.menu_item_id, 'name', it.name, 'course', mi.course_default::text, 'plates', it.plates,
             'mixPct', case when tot.plates > 0 then round(it.plates / tot.plates * 100, 2) end,
             'revenueNetEur', round(it.net, 4), 'costedPlates', it.c_plates, 'costedRevenueNetEur', round(it.c_net, 4),
             'foodCostEur', round(it.f_cost, 4),
             'foodCostPct', case when it.c_net > 0 then round(it.f_cost / it.c_net * 100, 2) end,
             'foodMarginPerPlateEur', case when it.c_plates > 0 then round((it.c_net - it.f_cost) / it.c_plates, 4) end,
             'status', case when it.c_plates = it.plates then 'costed'
                            when it.c_plates > 0 then 'partial'
                            when it.m_plates > 0 then 'incomplete'
                            else 'unmapped' end)
           || case when v_owner then jsonb_build_object(
                'fixedCostPerPlateEur',
                  case when it.c_plates > 0 and not it.fx_missing then round(it.fx / it.c_plates, 4) end,
                'grossMarginPerPlateEur',
                  case when it.c_plates > 0 and not it.fx_missing then round((it.c_net - it.f_cost) / it.c_plates - it.fx / it.c_plates, 4) end,
                'contributionEur',
                  case when it.c_plates > 0 and not it.fx_missing then round(((it.c_net - it.f_cost) / it.c_plates - it.fx / it.c_plates) * it.plates, 4) end,
                'fixedCostReason', case when it.c_plates > 0 and it.fx_missing then it.fx_reason end)
              else '{}'::jsonb end as j
      from it
      join public.menu_item mi on mi.tenant_id = p_tenant and mi.id = it.menu_item_id
     cross join tot
  )
  select coalesce((select jsonb_agg(r.j order by r.sort_plates desc, r.name collate "C", r.menu_item_id) from rowj r), '[]'::jsonb),
         (select jsonb_build_object('plates', t.plates, 'revenueNetEur', round(t.net, 4), 'costedRevenueNetEur', round(t.c_net, 4),
                                    'foodCostEur', round(t.f_cost, 4),
                                    'foodCostPct', case when t.c_net > 0 then round(t.f_cost / t.c_net * 100, 2) end)
            from tot t)
    into v_rows, v_totals;

  return jsonb_build_object('role', case when v_owner then 'owner' else 'admin' end, 'period', p_period, 'from', per.from_d, 'to', per.to_d,
                            'final', v_final, 'rows', v_rows, 'totals', v_totals);
end
$$;

create function public.kpi_items(p_period text, p_date date, p_from date, p_to date) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  perform app.require_day_closer();
  return app.kpi_items_json(app.tenant_id(), app.role()::text, p_period, p_date, p_from, p_to, now());
end
$$;

revoke all on function app.kpi_items_json(uuid, text, text, date, date, date, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.kpi_items(text, date, date, date) from public, anon, authenticated, service_role;
grant execute on function public.kpi_items(text, date, date, date) to authenticated;
