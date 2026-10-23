-- M14 step 5: the public procedures batch_proposal and produce_batch (M14 plan §3.1.5, §3.1.6, §3.1.10, §3.2;
-- ADR-013). Each is SECURITY DEFINER with an empty search_path, checks the role FIRST (owner, admin or chef; the
-- waiter never), takes the tenant from app.tenant_id() and the user from app.app_user_id(), filters every query by
-- the tenant, and is executable by `authenticated` only. Answers carry quantities only: no key and no value is a
-- cost (founder Q16 = project V6; the chef reads these answers).

-- The proposal: the raw quantities of the recipe's current version scaled to an actual output, rounded to 4
-- decimals (multiply first, divide once, round once per ingredient: 5 x 6,2 / 6 = 5,1667), with where each
-- ingredient sits (on-hand per active location, the FEFO lots) and what to suggest. Non-stock ingredients are
-- listed but never consumed. Portions are rounded down (project Q19 default).
create function public.batch_proposal(
  p_recipe_key uuid, p_output_qty numeric default null, p_shelf_life_hours integer default null
) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_now timestamptz := now();
  v_today date;
  v_id uuid;
  v_version integer;
  v_name text;
  v_type public.recipe_type;
  v_active boolean;
  v_out numeric;
  v_unit public.base_unit;
  v_ppb integer;
  v_recipe_shelf integer;
  v_output numeric;
  v_shelf integer;
  v_computed integer;
  v_locs jsonb;
  v_active_count integer;
  v_only uuid;
  v_inputs jsonb;
begin
  perform app.require_batch_writer();
  v_tenant := app.tenant_id();

  select r.id, r.version, r.name, k.type, k.is_active, r.output_qty, r.output_unit, r.portions_per_batch,
         r.shelf_life_hours
    into v_id, v_version, v_name, v_type, v_active, v_out, v_unit, v_ppb, v_recipe_shelf
    from public.recipe_key k
    join public.recipe r on r.tenant_id = k.tenant_id and r.recipe_key = k.id and r.version = k.current_version
   where k.tenant_id = v_tenant and k.id = p_recipe_key;
  if not found then
    raise exception 'recipe_not_found' using errcode = 'P0002';
  end if;
  if v_type <> 'batch' then
    raise exception 'recipe_not_batch' using errcode = 'P0001';
  end if;
  if not v_active then
    raise exception 'recipe_inactive' using errcode = 'P0001';
  end if;

  v_output := coalesce(p_output_qty, v_out);
  if v_output <= 0 or v_output > 100000 or round(v_output, 4) <> v_output
     or floor(v_output * v_ppb / v_out) > 10000 then
    raise exception 'output_invalid' using errcode = 'P0001';
  end if;
  v_shelf := coalesce(p_shelf_life_hours, v_recipe_shelf);
  if v_shelf < 1 or v_shelf > 8760 then
    raise exception 'shelf_life_invalid' using errcode = 'P0001';
  end if;
  v_computed := app.batch_portions(v_output, v_out, v_ppb);

  select app.venue_date(v_now, t.timezone) into v_today from public.tenant t where t.id = v_tenant;
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.name collate "C", x.id), '[]'::jsonb),
         count(*), (array_agg(x.id))[1]
    into v_locs, v_active_count, v_only
    from public.location x
   where x.tenant_id = v_tenant and x.is_active;
  if v_active_count <> 1 then
    v_only := null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'ingredientId', q.ingredient_id, 'name', i.name, 'baseUnit', i.base_unit, 'isStock', i.is_stock,
           'proposedQty', round(q.qty_per_batch * v_output / v_out, 4),
           'units', case when not i.is_stock then '[]'::jsonb
                         when i.base_unit = 'kg' then '["kg", "g"]'::jsonb
                         when i.base_unit = 'l' then '["l", "ml"]'::jsonb
                         else '["pz"]'::jsonb end,
           'suggestedLocationId', case when i.is_stock then coalesce(s.location_id, v_only) end,
           'onHand', oh.j, 'lots', lt.j)
         order by i.name collate "C", q.ingredient_id), '[]'::jsonb)
    into v_inputs
    from app.batch_requirements(v_tenant, v_id, v_now) q
    join public.ingredient i on i.tenant_id = v_tenant and i.id = q.ingredient_id
    -- Where the first-expiring stock is (expiry, received_on, lot id across the active locations).
    left join lateral (
      select f.location_id
        from (select x.id as location_id, b.raw_lot_id, b.expiry, b.received_on
                from public.location x
               cross join lateral app.fefo_buckets(v_tenant, i.id, x.id) b
               where x.tenant_id = v_tenant and x.is_active and i.is_stock) f
       order by f.expiry nulls last, f.received_on nulls last, f.raw_lot_id nulls last
       limit 1) s on true
    cross join lateral (
      select coalesce(jsonb_agg(jsonb_build_object('locationId', x.id, 'onHandQty', t.qty)
                                order by x.name collate "C", x.id), '[]'::jsonb) as j
        from public.location x
       cross join lateral (select app.location_on_hand(v_tenant, i.id, x.id) as qty) t
       where x.tenant_id = v_tenant and x.is_active and i.is_stock and t.qty <> 0) oh
    cross join lateral (
      select coalesce(jsonb_agg(jsonb_build_object('rawLotId', l.raw_lot_id, 'lotCode', l.lot_code,
               'locationId', l.location_id, 'expiry', l.expiry, 'expiryState', l.state, 'onHandQty', l.qty,
               'fefoRank', l.rank) order by l.location_name collate "C", l.location_id, l.rank nulls last), '[]'::jsonb) as j
        from (
          -- The positive buckets in FEFO order, then any non-zero unlotted bucket (a negative one is a shortfall).
          select b.raw_lot_id, rl.lot_code, x.id as location_id, x.name as location_name, rl.expiry,
                 case when b.raw_lot_id is null then null::text else app.expiry_state(rl.expiry, v_today) end as state,
                 b.qty, b.fefo_rank as rank
            from public.location x
           cross join lateral app.fefo_buckets(v_tenant, i.id, x.id) b
            left join public.raw_lot rl on rl.tenant_id = v_tenant and rl.id = b.raw_lot_id
           where x.tenant_id = v_tenant and x.is_active and i.is_stock
          union all
          select null::uuid, null::text, x.id, x.name, null::date, null::text, sum(m.qty), null::integer
            from public.location x
            join public.stock_movement m
              on m.tenant_id = v_tenant and m.ingredient_id = i.id and m.location_id = x.id and m.raw_lot_id is null
           where x.tenant_id = v_tenant and x.is_active and i.is_stock
           group by x.id, x.name
          having sum(m.qty) < 0) l) lt;

  return jsonb_build_object(
    'recipe', jsonb_build_object('key', p_recipe_key, 'id', v_id, 'version', v_version, 'name', v_name,
      'outputQty', v_out, 'outputUnit', v_unit, 'portionsPerBatch', v_ppb, 'shelfLifeHours', v_recipe_shelf,
      'portionSize', round(v_out / v_ppb, 4)),
    'outputQty', v_output, 'portionsComputed', v_computed, 'shelfLifeHours', v_shelf,
    'useByPreview', app.batch_use_by(v_now, v_shelf), 'today', v_today,
    'locations', v_locs, 'suggestedLocationId', v_only, 'inputs', v_inputs);
end
$$;

-- The production: one call = one transaction (app.produce_batch_core). This is the project plan's
-- produce_batch(recipe_id, output_qty, inputs) with three optional parameters added.
create function public.produce_batch(
  p_recipe_id uuid, p_output_qty numeric, p_inputs jsonb, p_portions integer default null,
  p_shelf_life_hours integer default null, p_location uuid default null
) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  perform app.require_batch_writer();
  return app.produce_batch_core(app.tenant_id(), app.app_user_id(), p_recipe_id, p_output_qty, p_inputs, p_portions,
                                p_shelf_life_hours, p_location, now());
end
$$;

revoke all on function public.batch_proposal(uuid, numeric, integer),
  public.produce_batch(uuid, numeric, jsonb, integer, integer, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.batch_proposal(uuid, numeric, integer),
  public.produce_batch(uuid, numeric, jsonb, integer, integer, uuid)
  to authenticated;
