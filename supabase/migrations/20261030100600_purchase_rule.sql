-- M16 step 7: the purchase rule (plan §3.1.7; PRD Macelleria example; AT3, AT7). For each active stock ingredient with a minimum
-- whose preferred active supplier item belongs to an active supplier with a delivery window: the projected stock is the usable
-- stock minus the weekday forecast over the horizon (delivery date minus today); below the minimum, order up to the target in
-- whole preferred packs. Incomplete settings raise nothing (the Riordino screen marks them "Da completare", Q66). Closed to
-- every API role. Returns the number of NEW alerts.
create function app.purchase_rule(p_tenant uuid, p_at timestamptz)
  returns integer
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_today date := app.alert_business_date(p_tenant, p_at);
  v_items integer := 0;
  r record;
  v_packs integer;
  v_order numeric;
begin
  for r in
    select c.*
      from (
        select i.id as ingredient_id, i.base_unit::text as unit, i.min_level, coalesce(i.target_level, i.min_level) as target,
               si.id as item_id, s.id as supplier_id, w.delivery_date, w.order_by_at,
               app.base_factor('conf', i.base_unit, si.pack_count, si.pack_qty, si.pack_unit) as pack,
               coalesce(oh.on_hand_qty, 0) as on_hand,
               app.forecast_qty(coalesce(wc.avgs, '{}'::jsonb), v_today, w.delivery_date - v_today) as forecast
          from public.ingredient i
          join public.supplier_item si on si.tenant_id = i.tenant_id and si.ingredient_id = i.id and si.is_preferred and si.is_active
          join public.supplier s on s.tenant_id = i.tenant_id and s.id = si.supplier_id and s.is_active
          cross join lateral app.supplier_window(p_tenant, s.id, p_at) w
          left join (select u.ingredient_id, u.on_hand_qty from app.usable_on_hand(p_tenant, v_today) u) oh on oh.ingredient_id = i.id
          left join (select x.ingredient_id, jsonb_object_agg(x.isodow::text, x.avg_qty) as avgs
                       from app.weekday_consumption(p_tenant, v_today) x group by x.ingredient_id) wc on wc.ingredient_id = i.id
         where i.tenant_id = p_tenant and i.is_stock and i.is_active and i.min_level is not null
      ) c
     where c.pack > 0 and c.on_hand - c.forecast < c.min_level
     order by c.ingredient_id
  loop
    -- Already raised today: skip it and build no payload.
    continue when exists (
      select 1 from public.alert a
       where a.tenant_id = p_tenant and a.kind = 'purchase_due' and a.entity_type = 'ingredient'
         and a.entity_id = r.ingredient_id and a.business_date = v_today);

    v_packs := ceil((r.target - (r.on_hand - r.forecast)) / r.pack)::integer;
    v_order := round(v_packs * r.pack, 4);
    if app.raise_rule_alert(
         p_tenant, 'purchase_due', 'ingredient', r.ingredient_id,
         jsonb_build_object(
           'ingredient_id', r.ingredient_id, 'supplier_id', r.supplier_id, 'supplier_item_id', r.item_id,
           'order_qty', trim_scale(v_order), 'packs_count', v_packs, 'pack_qty', trim_scale(r.pack), 'unit', r.unit,
           'order_by_at', app.iso_utc(r.order_by_at), 'delivery_date', r.delivery_date,
           'horizon_days', r.delivery_date - v_today,
           'on_hand_qty', trim_scale(r.on_hand), 'forecast_qty', trim_scale(r.forecast),
           'projected_qty', trim_scale(r.on_hand - r.forecast), 'min_qty', trim_scale(r.min_level), 'target_qty', trim_scale(r.target)),
         null, p_at, 'purchase_rules') then
      v_items := v_items + 1;
    end if;
  end loop;
  return v_items;
end
$$;

revoke all on function app.purchase_rule(uuid, timestamptz) from public, anon, authenticated, service_role;
