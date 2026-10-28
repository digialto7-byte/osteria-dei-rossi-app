-- UX plan B12 (docs/plans/2026-10-28-ux-flows.md, P1-10; ADR-008): public.plate_breakdown(), one plate's cost split by
-- line, for the owner's and the chef's view of "where does the money go".
--
-- Same rules as the rest of the cost engine (ADR-008):
-- - the numbers come from the engine (app.recipe_costs, app.recipe_cost_lines, app.plate_cost_rows) at the same instant, in
--   Postgres; the share of a line is its cost over the plate's cost, rounded to two decimals, null when the plate's cost
--   is unknown (unknown is never zero, so no share is claimed) or the line itself is unpriced;
-- - the role gate is first and in Postgres: app.require_margin_reader (owner, admin, chef; the waiter gets 42501);
-- - owner and admin also get the euro figures (a "money" block and each line's cost); the chef gets percentages, words and
--   flags only (founder Q16 = V6): the document built for the chef has no euro key at all, it is not filtered afterwards;
-- - lines come largest first (by cost; unpriced lines last, then by position), so the chef gets the order without the cost;
-- - no fixed cost is read here (owner only, shown on its own screen).
-- SECURITY DEFINER with an empty search_path, the tenant from app.tenant_id(), execute for authenticated only.

create function public.plate_breakdown(p_key uuid, p_date date default null) returns jsonb
  language plpgsql stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_tz text;
  v_at timestamptz;
  v_money boolean;
  v_cost record;
  v_plate record;
  v_lines jsonb;
  v_out jsonb;
begin
  perform app.require_margin_reader();
  v_money := app.role() in ('owner', 'admin');
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
  if v_cost.type <> 'plate' then
    raise exception 'recipe_not_plate' using errcode = 'P0001';
  end if;
  select * into v_plate from app.plate_cost_rows(v_tenant, array[p_key], p_date, false) p;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'position', x.line_position,
             'target', x.target,
             'sharePct', x.share,
             'incomplete', x.incomplete,
             'reason', x.reason)
           || case when v_money then jsonb_build_object('lineCostEur', round(x.line_cost, 4)) else '{}'::jsonb end
           order by x.line_cost desc nulls last, x.line_position), '[]'::jsonb)
    into v_lines
    from (
      select lc.line_position, lc.line_cost, lc.incomplete, lc.reason,
             case when lc.ingredient_id is not null
               then jsonb_build_object('kind', 'ingredient', 'id', lc.ingredient_id, 'name', i.name)
               else jsonb_build_object('kind', 'recipe', 'id', lc.sub_recipe_key,
                      'name', coalesce(sr.name, sk.name_norm)) end as target,
             case when not v_cost.incomplete and not lc.incomplete and v_cost.total_cost > 0
               then round(lc.line_cost / v_cost.total_cost * 100, 2) end as share
        from app.recipe_cost_lines(v_tenant, v_cost.recipe_id, v_at) lc
        left join public.ingredient i on i.tenant_id = v_tenant and i.id = lc.ingredient_id
        left join public.recipe_key sk on sk.tenant_id = v_tenant and sk.id = lc.sub_recipe_key
        left join public.recipe sr on sr.id = app.recipe_in_force(v_tenant, lc.sub_recipe_key, v_at)
    ) x;

  v_out := jsonb_build_object(
    'recipeKey', v_plate.recipe_key, 'name', v_plate.name, 'version', v_plate.version, 'at', p_date,
    'status', v_plate.status, 'incomplete', v_cost.incomplete, 'reasons', to_jsonb(v_plate.reasons),
    'missingIngredientIds', to_jsonb(v_plate.missing_ingredient_ids),
    'foodCostPct', round(v_plate.food_cost_pct, 4), 'gpPct', round(v_plate.gp_pct, 4),
    'targetGpPct', v_plate.target_gp_pct, 'lines', v_lines);
  if v_money then
    v_out := v_out || jsonb_build_object('money', jsonb_build_object(
      'foodCostEur', round(v_plate.food_cost, 4),
      'salePriceExVatEur', round(v_plate.sale_price_ex_vat, 4),
      'grossMarginEur', round(v_plate.gross_margin, 4)));
  end if;
  return v_out;
end
$$;

revoke all on function public.plate_breakdown(uuid, date) from public, anon, service_role;
grant execute on function public.plate_breakdown(uuid, date) to authenticated;
