-- M13 step 2: the count core (M13 plan §3.1.5, §3.1.14, §3.2; ADR-012). Everything is in schema app and closed to
-- every API role: the public procedures of the next migration are the only way in.
--   app.count_qty_base            - a typed count as base units (zero allowed, unlike app.stock_qty_base)
--   app.post_count_adjustment     - posts one line's difference as `count` rows that also normalise the buckets
--   app.require_audit_reader      - owner and admin (the activity log and the € of a count)

-- A counted quantity in the unit the chef typed, as base units of the ingredient. 0 is a valid count ("none
-- left"); a negative quantity, more than COUNT_QTY_MAX base units (a typo guard, as M12) or more than 4 decimals
-- after conversion is qty_invalid.
create function app.count_qty_base(p_tenant uuid, p_ingredient uuid, p_qty numeric, p_unit text) returns numeric
  language plpgsql stable
  set search_path = ''
as $$
declare
  v_base public.base_unit;
  v_stock boolean;
  v_factor numeric;
  v_exact numeric;
  v_qty numeric;
begin
  select i.base_unit, i.is_stock into v_base, v_stock
    from public.ingredient i
   where i.tenant_id = p_tenant and i.id = p_ingredient;
  if not found then
    raise exception 'ingredient_not_found' using errcode = 'P0002';
  end if;
  if not v_stock then
    raise exception 'ingredient_not_stock' using errcode = 'P0001';
  end if;
  v_factor := app.base_factor(p_unit, v_base, null, null, null);
  if v_factor is null then
    raise exception 'unit_mismatch' using errcode = 'P0001';
  end if;
  if p_qty is null or p_qty < 0 then
    raise exception 'qty_invalid' using errcode = 'P0001';
  end if;
  v_exact := p_qty * v_factor;
  v_qty := round(v_exact, 4);
  if v_qty <> v_exact or v_qty > 100000 then
    raise exception 'qty_invalid' using errcode = 'P0001';
  end if;
  return v_qty;
end
$$;

-- Posts the difference p_diff of one counted line as `count` rows (ADR-012). With the buckets of the ingredient at
-- the location read under the stock lock (positive lots P, the unlotted bucket U, total E) and the target total
-- T = E + p_diff:
--   T >= P        lots unchanged, the unlotted bucket becomes T - P (one row T - P - U);
--   0 <= T < P    the unlotted bucket becomes 0 and P - T is taken from the lots in FEFO order (one row per lot
--                 touched, one row -U if U is not 0);
--   T < 0         every lot goes to 0 and the unlotted bucket becomes T.
-- The rows of one call sum to p_diff exactly and no lot is driven below zero. Every row: type count, ref_type
-- count_session, ref_id the session, no reason, unit_cost as passed (null when unknown, never invented), dated by the
-- venue date of p_at. p_diff 0 writes nothing. Returns the rows in insert order.
create function app.post_count_adjustment(
  p_tenant uuid, p_user uuid, p_ingredient uuid, p_location uuid, p_diff numeric, p_session uuid,
  p_at timestamptz, p_unit_cost numeric
) returns table (movement_id uuid, raw_lot_id uuid, qty numeric)
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_tz text;
  v_date date;
  v_lots numeric;
  v_unlotted numeric;
  v_target numeric;
  v_take numeric;
  v_unl_target numeric;
  v_slice numeric;
  v_row numeric;
  v_id uuid;
  b record;
begin
  if p_diff is null then
    raise exception 'qty_invalid' using errcode = 'P0001';
  end if;

  -- The stock lock first, before any balance is read.
  perform app.lock_ingredient_stock(p_tenant, array[p_ingredient]);

  perform 1 from public.ingredient i where i.tenant_id = p_tenant and i.id = p_ingredient;
  if not found then
    raise exception 'ingredient_not_found' using errcode = 'P0002';
  end if;
  if p_diff = 0 then
    return;
  end if;

  select t.timezone into v_tz from public.tenant t where t.id = p_tenant;
  v_date := app.venue_date(p_at, v_tz);

  select coalesce(sum(f.qty), 0) into v_lots
    from app.fefo_buckets(p_tenant, p_ingredient, p_location) f
   where f.raw_lot_id is not null;
  select coalesce(sum(m.qty), 0) into v_unlotted
    from public.stock_movement m
   where m.tenant_id = p_tenant and m.ingredient_id = p_ingredient and m.location_id = p_location
     and m.raw_lot_id is null;
  v_target := app.location_on_hand(p_tenant, p_ingredient, p_location) + p_diff;

  if v_target >= v_lots then
    v_take := 0;
    v_unl_target := v_target - v_lots;
  else
    v_take := v_lots - greatest(v_target, 0);
    v_unl_target := least(v_target, 0);
  end if;

  if v_take > 0 then
    for b in
      select f.raw_lot_id, f.qty
        from app.fefo_buckets(p_tenant, p_ingredient, p_location) f
       where f.raw_lot_id is not null
       order by f.fefo_rank
    loop
      exit when v_take <= 0;
      v_slice := least(v_take, b.qty);
      insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost,
          reason_code, ref_type, ref_id, effective_on, created_by)
        values (p_tenant, p_ingredient, b.raw_lot_id, p_location, 'count', -v_slice, p_unit_cost, null,
                'count_session', p_session, v_date, p_user)
        returning id into v_id;
      v_take := v_take - v_slice;
      movement_id := v_id; raw_lot_id := b.raw_lot_id; qty := -v_slice;
      return next;
    end loop;
  end if;

  v_row := v_unl_target - v_unlotted;
  if v_row <> 0 then
    insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost,
        reason_code, ref_type, ref_id, effective_on, created_by)
      values (p_tenant, p_ingredient, null, p_location, 'count', v_row, p_unit_cost, null,
              'count_session', p_session, v_date, p_user)
      returning id into v_id;
    movement_id := v_id; raw_lot_id := null; qty := v_row;
    return next;
  end if;
  return;
end
$$;

-- The activity log and the € of a count are for the owner and admin; the chef and the waiter get 42501.
create function app.require_audit_reader() returns void
  language plpgsql stable
  set search_path = ''
as $$
begin
  if app.role() is null or app.role()::text not in ('owner', 'admin') then
    raise exception 'permission denied: the activity log needs owner or admin' using errcode = '42501';
  end if;
end
$$;

revoke all on function
  app.count_qty_base(uuid, uuid, numeric, text),
  app.post_count_adjustment(uuid, uuid, uuid, uuid, numeric, uuid, timestamptz, numeric),
  app.require_audit_reader()
  from public, anon, authenticated, service_role;
