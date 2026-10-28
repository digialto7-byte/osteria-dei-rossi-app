-- Owner dashboard (docs/plans/2026-10-28-owner-dashboard.md) step 1: the plate figures of the dashboard.
--
-- app.dashboard_plates(p_tenant) reads app.plate_cost_rows ONCE with p_include_fixed = false, for every role: no plate
-- figure of the dashboard carries a fixed, full or net cost (founder answer Q107), and the engine does not even read
-- fixed_cost_period in that case.
--   * foodCost.overallPct (decision 4, Q111 default): sum of food cost / sum of price without VAT * 100 over the active
--     plates whose status is not 'incomplete', each plate once, rounded to 2 decimals from the unrounded sums; null (never
--     0) when no plate is complete. It is the menu figure, not weighted by sales (there are no sales before M19-M21).
--   * plates.worst (decision 5, Q110 and Q112 default): the complete plates, those with a target first by how far GP % is
--     below it (gap = GP % - target, on unrounded values), then those without a target by GP %; ties by name (collate "C")
--     and recipe key; the first app.dashboard_worst_plates().
--   * plates.incomplete: the plates with an incomplete cost, by name, as names only (no percentage), first 5 and a count.
-- SECURITY DEFINER with an empty search_path because the plate engine is closed to every API role; the tenant is a
-- parameter, so the helper is closed to every API role as well and only public.dashboard_summary() (step 4) calls it.

create function app.dashboard_worst_plates() returns integer
  language sql immutable
  set search_path = ''
as $$ select 5 $$;

create function app.dashboard_plates(p_tenant uuid) returns jsonb
  language sql stable
  security definer
  set search_path = ''
as $$
  with r as (
    select p.recipe_key, p.name, p.food_cost, p.sale_price_ex_vat, p.gp_pct, p.target_gp_pct, p.status,
           p.gp_pct - p.target_gp_pct as gap
      from app.plate_cost_rows(p_tenant, null, null, false) p
  ), done as (
    select * from r where r.status <> 'incomplete'
  ), worst as (
    select d.* from done d
     order by (d.target_gp_pct is null), coalesce(d.gap, d.gp_pct), d.name collate "C", d.recipe_key
     limit app.dashboard_worst_plates()
  ), incomplete as (
    select i.recipe_key, i.name from r i where i.status = 'incomplete'
     order by i.name collate "C", i.recipe_key
  )
  select jsonb_build_object(
    'foodCost', jsonb_build_object(
      'overallPct', (select round(sum(d.food_cost) / nullif(sum(d.sale_price_ex_vat), 0) * 100, 2) from done d),
      'platesCounted', (select count(*)::int from done),
      'platesIncomplete', (select count(*)::int from incomplete)),
    'plates', jsonb_build_object(
      'worst', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'recipeKey', w.recipe_key, 'name', w.name, 'gpPct', round(w.gp_pct, 2),
                 'targetGpPct', round(w.target_gp_pct, 2), 'gapPct', round(w.gap, 2), 'status', w.status)
               order by (w.target_gp_pct is null), coalesce(w.gap, w.gp_pct), w.name collate "C", w.recipe_key)
          from worst w), '[]'::jsonb),
      'incomplete', coalesce((
        select jsonb_agg(jsonb_build_object('recipeKey', x.recipe_key, 'name', x.name)
                         order by x.name collate "C", x.recipe_key)
          from (select * from incomplete limit 5) x), '[]'::jsonb),
      'incompleteCount', (select count(*)::int from incomplete)))
$$;

revoke all on function app.dashboard_worst_plates(), app.dashboard_plates(uuid)
  from public, anon, authenticated, service_role;
