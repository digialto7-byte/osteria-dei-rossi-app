-- M8 step 4: fixed cost, plate outputs, plate_costs, fixed_cost_status and plate_margins_pct
-- (M8 plan §3.1.6-7, §3.2; ADR-008).
--
-- Who sees what (founder decisions 2026-10-23):
--   * Q16 = V6: the chef reads percentages only, through plate_margins_pct (key, food cost %, GP %,
--     a status word). Every function that carries a euro figure refuses the chef and the waiter.
--   * Fixed costs are the owner's alone. plate_costs and recipe_cost_at serve the admin too, but for
--     anyone who is not the owner the fixed cost, full cost, net margin and allocation flag are null
--     and the status has no fixed_cost_unallocated state. The engine does not even read the fixed
--     cost table in that case (p_include_fixed false), so there is nothing to mask afterwards.

-- Plates sold in a window of business dates. M8 has no sales yet, so it is 0 and every fixed cost
-- per plate is "not allocated". Replaced by M19/M21 with `create or replace` (same signature):
-- fired, non-voided plate lines by business date, half portions as 0.5.
create function app.plates_sold(p_tenant uuid, p_from date, p_to date) returns numeric
  language plpgsql stable
  set search_path = ''
as $$
begin
  return 0;
end
$$;

-- The fixed cost per plate on a date. The figures in force are those of the greatest month not after
-- the date's month (the newest entry of that month); plates sold over the 30 complete days before
-- the date. reason: no_fixed_costs (no month in force), no_sales (0 plates), else null.
create function app.fixed_cost_at(p_tenant uuid, p_date date)
  returns table (period_month date, monthly_total numeric, plates_sold numeric, per_plate numeric,
                 reason text)
  language plpgsql stable
  security definer
  set search_path = ''
as $$
declare
  v_month date;
  v_total numeric;
  v_sold numeric;
begin
  select f.month, f.rent + f.labour + f.utilities into v_month, v_total
    from public.fixed_cost_period f
   where f.tenant_id = p_tenant and f.month <= date_trunc('month', p_date)::date
   order by f.month desc, f.created_at desc, f.id desc
   limit 1;
  if not found then
    return query select null::date, null::numeric, null::numeric, null::numeric, 'no_fixed_costs'::text;
    return;
  end if;
  v_sold := app.plates_sold(p_tenant, p_date - 30, p_date - 1);
  return query select v_month, v_total, v_sold,
    case when v_sold > 0 then v_total / v_sold end,
    case when coalesce(v_sold, 0) > 0 then null else 'no_sales' end;
end
$$;

-- Plate outputs at a Rome date (null = now), full precision. p_keys null = every active plate.
-- status, first that applies: incomplete (food cost unknown, or no sale price, or a price of 0),
-- below_target (GP % under the target), fixed_cost_unallocated (only when fixed costs are included
-- and no fixed cost per plate exists), ok. Below-target outranks unallocated on purpose.
create function app.plate_cost_rows(
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
  select b.rkey, b.rname, b.rversion, b.food, v_fixed, x.full_c, b.price, v_vat, e.pex, x.gm, x.nm,
         x.fcp, x.gp, b.target, case when p_include_fixed then v_fixed is not null end, s.st,
         b.creasons || case when b.price is null or b.price <= 0 then array['no_sale_price'] else '{}'::text[] end,
         b.cmissing
    from (
      select c.recipe_key as rkey, c.name as rname, c.version as rversion, c.total_cost as food,
             c.incomplete as cinc, c.reasons as creasons, c.missing_ingredient_ids as cmissing,
             rp.sale_price as price, rp.target_gp_pct as target
        from app.recipe_costs(p_tenant,
               coalesce(p_keys, array(select k.id from public.recipe_key k
                                       where k.tenant_id = p_tenant and k.type = 'plate' and k.is_active)),
               v_at) c
        left join public.recipe_price rp on rp.tenant_id = p_tenant and rp.recipe_id = c.recipe_id
       where c.type = 'plate'
    ) b
   cross join lateral (select case when b.price > 0 then b.price / (1 + v_vat / 100) end as pex) e
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

revoke all on function app.plates_sold(uuid, date, date), app.fixed_cost_at(uuid, date),
  app.plate_cost_rows(uuid, uuid[], date, boolean)
  from public, anon, authenticated, service_role;

-- Owner and admin. Amounts in EUR to 4 decimals, percentages to 2. For the admin the fixed cost,
-- full cost, net margin and allocation flag are null (owner only), as is the fixed_cost_unallocated
-- state.
create function public.plate_costs(p_date date default null)
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
         round(p.gross_margin, 4), round(p.net_margin, 4), round(p.food_cost_pct, 2), round(p.gp_pct, 2),
         p.target_gp_pct, p.fixed_cost_allocated, p.status, p.reasons, p.missing_ingredient_ids
    from app.plate_cost_rows(v_tenant, null, p_date, app.role() = 'owner') p
   order by p.name collate "C", p.recipe_key;
end
$$;

-- Owner only: the fixed cost per plate and why it may be missing.
create function public.fixed_cost_status(p_date date default null) returns jsonb
  language plpgsql stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_tz text;
  f record;
begin
  perform app.require_fixed_cost_reader();
  v_tenant := app.tenant_id();
  select t.timezone into v_tz from public.tenant t where t.id = v_tenant;
  if p_date is not null and p_date > app.venue_date(now(), v_tz) then
    raise exception 'date_in_future' using errcode = 'P0001';
  end if;
  select * into f from app.fixed_cost_at(v_tenant, coalesce(p_date, app.venue_date(now(), v_tz)));
  return jsonb_build_object('periodMonth', f.period_month, 'monthlyTotalEur', f.monthly_total,
    'platesSold', f.plates_sold, 'perPlateEur', round(f.per_plate, 4), 'reason', f.reason);
end
$$;

-- The chef's only cost-derived read (Q16 = V6): the plate key, food cost %, GP % and a status word
-- (ok, below_target, incomplete). No euro field, no fixed cost state. Current, active plates.
create function public.plate_margins_pct()
  returns table (recipe_key uuid, food_cost_pct numeric, gp_pct numeric, status text)
  language plpgsql stable
  security definer
  set search_path = ''
as $$
begin
  perform app.require_margin_reader();
  return query
  select p.recipe_key, round(p.food_cost_pct, 2), round(p.gp_pct, 2), p.status
    from app.plate_cost_rows(app.tenant_id(), null, null, false) p
   order by p.name collate "C", p.recipe_key;
end
$$;

revoke all on function public.plate_costs(date), public.fixed_cost_status(date), public.plate_margins_pct()
  from public, anon, authenticated, service_role;
grant execute on function public.plate_costs(date), public.fixed_cost_status(date),
  public.plate_margins_pct() to authenticated;

-- recipe_cost_at now fills `plate` (null for a batch or a sub), with the same masking as plate_costs.
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
             'netMarginEur', round(p.net_margin, 4), 'foodCostPct', round(p.food_cost_pct, 2),
             'gpPct', round(p.gp_pct, 2), 'targetGpPct', p.target_gp_pct,
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
