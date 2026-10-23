-- M8 follow-up: percentages are returned to 4 decimals (they were 2). The screens and the alert text
-- round to 1 decimal, and rounding twice turned a true GP of 81.1458 % into 81.15 and then "81,2 %".
-- Only the round() argument of food_cost_pct, gp_pct and the alert's gp_pct and change_pct changes; the
-- bodies are those of 20261023110300_plate_costs.sql and 20261023110600_approve_invoice_variance.sql.
-- Comparisons (below_target, the variance threshold) stay on the unrounded values. Euro figures keep
-- 4 decimals. Same signatures, security definer, empty search_path and role checks.

create or replace function public.plate_costs(p_date date default null)
  returns table (recipe_key uuid, name text, version integer, food_cost_eur numeric,
                 fixed_cost_eur numeric, full_cost_eur numeric, sale_price_eur numeric, vat_pct numeric,
                 sale_price_ex_vat_eur numeric, gross_margin_eur numeric, net_margin_eur numeric,
                 food_cost_pct numeric, gp_pct numeric, target_gp_pct numeric,
                 fixed_cost_allocated boolean, status text, reasons text[],
                 missing_ingredient_ids uuid[])
  language plpgsql stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_tz text;
begin
  perform app.require_cost_reader();
  v_tenant := app.tenant_id();
  select t.timezone into v_tz from public.tenant t where t.id = v_tenant;
  if p_date is not null and p_date > app.venue_date(now(), v_tz) then
    raise exception 'date_in_future' using errcode = 'P0001';
  end if;
  return query
  select p.recipe_key, p.name, p.version, round(p.food_cost, 4), round(p.fixed_cost, 4),
         round(p.full_cost, 4), p.sale_price, p.vat_pct, round(p.sale_price_ex_vat, 4),
         round(p.gross_margin, 4), round(p.net_margin, 4), round(p.food_cost_pct, 4), round(p.gp_pct, 4),
         p.target_gp_pct, p.fixed_cost_allocated, p.status, p.reasons, p.missing_ingredient_ids
    from app.plate_cost_rows(v_tenant, null, p_date, app.role() = 'owner') p
   order by p.name collate "C", p.recipe_key;
end
$$;

create or replace function public.plate_margins_pct()
  returns table (recipe_key uuid, food_cost_pct numeric, gp_pct numeric, status text)
  language plpgsql stable
  security definer
  set search_path = ''
as $$
begin
  perform app.require_margin_reader();
  return query
  select p.recipe_key, round(p.food_cost_pct, 4), round(p.gp_pct, 4), p.status
    from app.plate_cost_rows(app.tenant_id(), null, null, false) p
   order by p.name collate "C", p.recipe_key;
end
$$;

create or replace function public.recipe_cost_at(p_key uuid, p_date date default null) returns jsonb
  language plpgsql stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_tz text;
  v_at timestamptz;
  v_cost record;
  v_lines jsonb;
  v_plate jsonb;
begin
  perform app.require_cost_reader();
  v_tenant := app.tenant_id();
  select t.timezone into v_tz from public.tenant t where t.id = v_tenant;
  if p_date is not null and p_date > app.venue_date(now(), v_tz) then
    raise exception 'date_in_future' using errcode = 'P0001';
  end if;
  perform 1 from public.recipe_key k where k.tenant_id = v_tenant and k.id = p_key;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  v_at := case when p_date is null then null else app.venue_day_end(p_date, v_tz) end;

  select * into v_cost from app.recipe_costs(v_tenant, array[p_key], v_at) c;
  if not found then
    raise exception 'recipe_not_in_force' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'position', lc.line_position,
           'target', case when lc.ingredient_id is not null
                       then jsonb_build_object('kind', 'ingredient', 'id', lc.ingredient_id, 'name', i.name)
                       else jsonb_build_object('kind', 'recipe', 'id', lc.sub_recipe_key,
                              'name', coalesce(sr.name, sk.name_norm)) end,
           'qty', lc.qty, 'unit', lc.unit, 'yieldFactor', lc.yield_factor,
           'unitCostEur', round(lc.unit_cost, 4), 'lineCostEur', round(lc.line_cost, 4),
           'incomplete', lc.incomplete, 'reason', lc.reason) order by lc.line_position), '[]'::jsonb)
    into v_lines
    from app.recipe_cost_lines(v_tenant, v_cost.recipe_id, v_at) lc
    left join public.ingredient i on i.tenant_id = v_tenant and i.id = lc.ingredient_id
    left join public.recipe_key sk on sk.tenant_id = v_tenant and sk.id = lc.sub_recipe_key
    left join public.recipe sr on sr.id = app.recipe_in_force(v_tenant, lc.sub_recipe_key, v_at);

  if v_cost.type = 'plate' then
    select jsonb_build_object(
             'recipeKey', p.recipe_key, 'name', p.name, 'version', p.version,
             'foodCostEur', round(p.food_cost, 4), 'fixedCostEur', round(p.fixed_cost, 4),
             'fullCostEur', round(p.full_cost, 4), 'salePriceEur', p.sale_price, 'vatPct', p.vat_pct,
             'salePriceExVatEur', round(p.sale_price_ex_vat, 4), 'grossMarginEur', round(p.gross_margin, 4),
             'netMarginEur', round(p.net_margin, 4), 'foodCostPct', round(p.food_cost_pct, 4),
             'gpPct', round(p.gp_pct, 4), 'targetGpPct', p.target_gp_pct,
             'fixedCostAllocated', p.fixed_cost_allocated, 'status', p.status,
             'reasons', to_jsonb(p.reasons), 'missingIngredientIds', to_jsonb(p.missing_ingredient_ids))
      into v_plate
      from app.plate_cost_rows(v_tenant, array[p_key], p_date, app.role() = 'owner') p;
  end if;

  return jsonb_build_object(
    'recipeKey', v_cost.recipe_key, 'recipeId', v_cost.recipe_id, 'version', v_cost.version,
    'type', v_cost.type, 'name', v_cost.name, 'at', p_date,
    'totalCostEur', round(v_cost.total_cost, 4), 'unitCostEur', round(v_cost.unit_cost, 4),
    'costUnit', v_cost.cost_unit, 'incomplete', v_cost.incomplete, 'reasons', to_jsonb(v_cost.reasons),
    'missingIngredientIds', to_jsonb(v_cost.missing_ingredient_ids), 'lines', v_lines, 'plate', v_plate);
end
$$;

create or replace function app.price_variance_payload(
  p_tenant uuid, p_invoice uuid, p_ingredient uuid, p_new_price numeric, p_baseline numeric,
  p_purchases integer, p_change_pct numeric, p_threshold numeric
) returns jsonb
  language plpgsql stable
  security definer
  set search_path = ''
as $$
declare
  v_keys uuid[] := app.affected_recipe_keys(p_tenant, p_ingredient);
  v_recipes jsonb;
  v_count integer := cardinality(v_keys);
  v_head jsonb;
  v_payload jsonb;
begin
  select jsonb_build_object(
           'ingredient_id', i.id, 'ingredient_name', left(i.name, 80), 'unit', i.base_unit,
           'invoice_id', inv.id, 'invoice_number', left(coalesce(inv.number_raw, ''), 80),
           'supplier_id', s.id, 'supplier_name', left(s.name, 80))
    into v_head
    from public.ingredient i
    join public.invoice inv on inv.tenant_id = i.tenant_id and inv.id = p_invoice
    join public.supplier s on s.tenant_id = inv.tenant_id and s.id = inv.supplier_id
   where i.tenant_id = p_tenant and i.id = p_ingredient;

  if v_head is null then
    raise exception 'variance_input_missing' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(e.entry order by e.rk, e.status_rank, e.gp, e.nm collate "C", e.rkey), '[]'::jsonb)
    into v_recipes
    from (
      select c.type, c.recipe_key as rkey, c.name as nm,
             case c.type when 'plate' then 1 when 'batch' then 2 else 3 end as rk,
             case when pr.status in ('below_target', 'incomplete') then 0 else 1 end as status_rank,
             pr.gp_pct as gp,
             jsonb_build_object('recipe_key', c.recipe_key, 'type', c.type, 'name', left(c.name, 80),
               'unit_cost_eur', round(c.unit_cost, 4), 'cost_unit', c.cost_unit)
             || case when c.type = 'plate' then jsonb_build_object(
                  'margin_eur', round(pr.gross_margin, 4), 'gp_pct', round(pr.gp_pct, 4),
                  'target_gp_pct', pr.target_gp_pct, 'status', pr.status)
                else '{}'::jsonb end as entry
        from app.recipe_costs(p_tenant, v_keys, null) c
        left join app.plate_cost_rows(p_tenant, v_keys, null, false) pr on pr.recipe_key = c.recipe_key
    ) e;
  -- At most 20 entries (PRICE_ALERT_MAX_RECIPES).
  v_recipes := coalesce((select jsonb_agg(x.value order by x.ord)
                           from jsonb_array_elements(v_recipes) with ordinality x (value, ord)
                          where x.ord <= 20), '[]'::jsonb);

  v_payload := v_head || jsonb_build_object(
    'new_price_eur', round(p_new_price, 4), 'baseline_eur', round(p_baseline, 4),
    'change_pct', round(p_change_pct, 4), 'threshold_pct', p_threshold,
    'purchases_in_baseline', p_purchases, 'recipes_count', v_count,
    'recipes_listed', jsonb_array_length(v_recipes), 'recipes', v_recipes);
  while octet_length(v_payload::text) > 7680 and jsonb_array_length(v_payload -> 'recipes') > 0 loop
    v_recipes := v_payload -> 'recipes';
    v_recipes := v_recipes - (jsonb_array_length(v_recipes) - 1);
    v_payload := v_payload || jsonb_build_object('recipes', v_recipes,
      'recipes_listed', jsonb_array_length(v_recipes));
  end loop;
  return v_payload;
end
$$;

revoke all on function public.plate_costs(date), public.plate_margins_pct(), public.recipe_cost_at(uuid, date)
  from public, anon, authenticated, service_role;
grant execute on function public.plate_costs(date), public.plate_margins_pct(), public.recipe_cost_at(uuid, date)
  to authenticated;
revoke all on function app.price_variance_payload(uuid, uuid, uuid, numeric, numeric, integer, numeric, numeric)
  from public, anon, authenticated, service_role;
