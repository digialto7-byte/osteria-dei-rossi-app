-- M17 step 8: app.plate_cost_rows takes the price and VAT rate of the active menu item that maps a plate (M8 plan §3.8
-- contract "M17: the menu item's VAT rate (and price) replace these for mapped plates"; M17 plan §3.1.8, Q74 default;
-- ADR-016). Same signature, output columns, security definer, search_path and revokes as 20261023110300_plate_costs.sql.
--
--   * For a plate key mapped by an ACTIVE menu item (at most one: menu_item_recipe_uq), price and VAT come from the item's
--     menu_item_price row in force on the date (the venue day's end for a date, now for null). The price in force is read
--     with clock_timestamp() when the date is null, so a row written earlier in the same transaction counts.
--   * Otherwise (no item, an inactive item, or no price in force yet on that date) the recipe price and the tenant's
--     sale_vat_pct apply, as before. The target GP % stays the recipe's.
--   * vat_pct is therefore per row. The item's active state is the current one: an item deactivated today makes past
--     dates fall back to the recipe price (ADR-016, accepted trade-off).
-- Callers (plate_costs, plate_margins_pct, recipe_cost_at, app.price_variance_payload) are unchanged.
create or replace function app.plate_cost_rows(
  p_tenant uuid, p_keys uuid[], p_date date, p_include_fixed boolean default true
) returns table (recipe_key uuid, name text, version integer, food_cost numeric, fixed_cost numeric,
                 full_cost numeric, sale_price numeric, vat_pct numeric, sale_price_ex_vat numeric,
                 gross_margin numeric, net_margin numeric, food_cost_pct numeric, gp_pct numeric,
                 target_gp_pct numeric, fixed_cost_allocated boolean, status text, reasons text[],
                 missing_ingredient_ids uuid[])
  language plpgsql stable
  security definer
  set search_path = ''
as $$
declare
  v_tz text;
  v_at timestamptz;
  v_vat numeric;
  v_fixed numeric;
begin
  select t.timezone into v_tz from public.tenant t where t.id = p_tenant;
  select s.sale_vat_pct into v_vat from app.cost_settings(p_tenant) s;
  v_at := case when p_date is null then null else app.venue_day_end(p_date, v_tz) end;
  if p_include_fixed then
    select f.per_plate into v_fixed
      from app.fixed_cost_at(p_tenant, coalesce(p_date, app.venue_date(now(), v_tz))) f;
  end if;

  return query
  select b.rkey, b.rname, b.rversion, b.food, v_fixed, x.full_c, b.price, b.vat, e.pex, x.gm, x.nm,
         x.fcp, x.gp, b.target, case when p_include_fixed then v_fixed is not null end, s.st,
         b.creasons || case when b.price is null or b.price <= 0 then array['no_sale_price'] else '{}'::text[] end,
         b.cmissing
    from (
      select c.recipe_key as rkey, c.name as rname, c.version as rversion, c.total_cost as food,
             c.incomplete as cinc, c.reasons as creasons, c.missing_ingredient_ids as cmissing,
             case when m.menu_price is not null then m.menu_price else rp.sale_price end as price,
             case when m.menu_price is not null then trim_scale(m.menu_vat) else v_vat end as vat,
             rp.target_gp_pct as target
        from app.recipe_costs(p_tenant,
               coalesce(p_keys, array(select k.id from public.recipe_key k
                                       where k.tenant_id = p_tenant and k.type = 'plate' and k.is_active)),
               v_at) c
        left join public.recipe_price rp on rp.tenant_id = p_tenant and rp.recipe_id = c.recipe_id
        left join lateral (
          select pr.price as menu_price, pr.vat_rate as menu_vat
            from public.menu_item mi
            join app.menu_item_price_at(p_tenant, array[mi.id], coalesce(v_at, clock_timestamp())) pr
              on pr.menu_item_id = mi.id
           where mi.tenant_id = p_tenant and mi.is_active and mi.recipe_key = c.recipe_key
           limit 1
        ) m on true
       where c.type = 'plate'
    ) b
   cross join lateral (select case when b.price > 0 then b.price / (1 + b.vat / 100) end as pex) e
   cross join lateral (
     select b.food + v_fixed as full_c,
            e.pex - b.food as gm,
            e.pex - (b.food + v_fixed) as nm,
            b.food / e.pex * 100 as fcp,
            (e.pex - b.food) / e.pex * 100 as gp
   ) x
   cross join lateral (
     select case when b.cinc or e.pex is null then 'incomplete'
                 when x.gp < b.target then 'below_target'
                 when p_include_fixed and v_fixed is null then 'fixed_cost_unallocated'
                 else 'ok' end as st
   ) s;
end
$$;

revoke all on function app.plate_cost_rows(uuid, uuid[], date, boolean)
  from public, anon, authenticated, service_role;
