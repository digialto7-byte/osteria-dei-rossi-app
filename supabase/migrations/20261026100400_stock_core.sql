-- M12 step 4: the stock core (M12 plan §3.1.4, §3.1.7, §3.1.11-14, §3.2; ADR-011).
-- Role helpers, the per-ingredient stock lock, quantity conversion, FEFO buckets, the expiry state, the
-- contained negative-stock alert and the FEFO engine app.post_stock_outflow. Everything is in schema app and
-- closed to every API role: the public procedures of the next migration are the only way in.
--
-- Balances are never stored. A bucket is Sum(qty) of the movements of one ingredient at one location for one
-- lot (the null lot is the "unlotted" bucket, where a shortfall is booked). The engine never drives a lot
-- below zero and never refuses for lack of stock (plan §3.6 rule 8): the missing part is one explicit
-- unlotted row, and a negative location total raises a quantity-only alert inside a contained block.
--
-- Global lock order for current and future procedures: recipe graph (shared) -> ingredient cost locks ->
-- ingredient stock locks, each in id order. M13 close_count and M14 produce_batch must take the stock locks
-- of their ingredients before reading balances (contract, plan §3.9).

-- Roles: owner, admin and chef (Q1 = owner+chef+admin write, founder 2026-10-23); never the waiter.
create function app.require_stock_reader() returns void
  language plpgsql stable
  set search_path = ''
as $$
begin
  if app.role() is null or app.role()::text not in ('owner', 'admin', 'chef') then
    raise exception 'permission denied: stock needs owner, admin or chef' using errcode = '42501';
  end if;
end
$$;

create function app.require_stock_writer() returns void
  language plpgsql stable
  set search_path = ''
as $$
begin
  if app.role() is null or app.role()::text not in ('owner', 'admin', 'chef') then
    raise exception 'permission denied: stock changes need owner, admin or chef' using errcode = '42501';
  end if;
end
$$;

-- One transaction advisory lock per ingredient, in id order (a class separate from M8's ingredient_cost), so
-- two sessions that share ingredients take them in the same order and cannot deadlock. Re-entrant within a
-- transaction: a caller that already locked several ingredients loses nothing by the engine locking again.
-- A hash collision only adds a wait. Under READ COMMITTED every statement after the lock sees what the
-- previous holder committed.
create function app.lock_ingredient_stock(p_tenant uuid, p_ids uuid[]) returns void
  language plpgsql
  set search_path = ''
as $$
declare
  v_id uuid;
begin
  for v_id in
    select x from unnest(p_ids) x where x is not null group by x order by x
  loop
    perform pg_advisory_xact_lock(hashtext('ingredient_stock'), hashtext(p_tenant::text || v_id::text));
  end loop;
end
$$;

-- An input quantity in the unit the chef typed, as base units of the ingredient, rounded to 4 decimals.
create function app.stock_qty_base(p_tenant uuid, p_ingredient uuid, p_qty numeric, p_unit text) returns numeric
  language plpgsql stable
  set search_path = ''
as $$
declare
  v_base public.base_unit;
  v_stock boolean;
  v_factor numeric;
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
  if p_qty is null or p_qty <= 0 then
    raise exception 'qty_invalid' using errcode = 'P0001';
  end if;
  v_qty := round(p_qty * v_factor, 4);
  if v_qty <= 0 or v_qty > 100000 then
    raise exception 'qty_invalid' using errcode = 'P0001';
  end if;
  return v_qty;
end
$$;

-- The expiry state shown on the screens, computed here so React never compares dates. Never derived from the
-- receipt date (M5 Q1 note): a lot without an expiry is 'none'. due_soon = within 1 day (PRD 2.4).
create function app.expiry_state(p_expiry date, p_today date) returns text
  language sql immutable
  set search_path = ''
as $$
  select case
    when p_expiry is null then 'none'
    when p_expiry < p_today then 'expired'
    when p_expiry <= p_today + 1 then 'due_soon'
    else 'ok'
  end
$$;

-- The positive buckets of an ingredient at a location in FEFO order: expiry ascending with no expiry last,
-- then received_on, then the lot id; a positive unlotted bucket comes after every lot. Expired lots are
-- included (pure FEFO, Q7).
create function app.fefo_buckets(p_tenant uuid, p_ingredient uuid, p_location uuid)
  returns table (raw_lot_id uuid, qty numeric, expiry date, received_on date, fefo_rank integer)
  language sql
  security definer
  set search_path = ''
as $$
  select b.raw_lot_id, b.qty, l.expiry, l.received_on,
         (row_number() over (order by l.expiry asc nulls last, l.received_on asc nulls last,
                                      b.raw_lot_id asc nulls last))::integer
    from (select m.raw_lot_id, sum(m.qty) as qty
            from public.stock_movement m
           where m.tenant_id = p_tenant and m.ingredient_id = p_ingredient and m.location_id = p_location
           group by m.raw_lot_id
          having sum(m.qty) > 0) b
    left join public.raw_lot l on l.tenant_id = p_tenant and l.id = b.raw_lot_id
   order by 5
$$;

-- The location total: the sum of all buckets, the unlotted one included.
create function app.location_on_hand(p_tenant uuid, p_ingredient uuid, p_location uuid) returns numeric
  language sql
  security definer
  set search_path = ''
as $$
  select coalesce(sum(m.qty), 0)
    from public.stock_movement m
   where m.tenant_id = p_tenant and m.ingredient_id = p_ingredient and m.location_id = p_location
$$;

-- The negative-stock alert (kind negative_stock, M12 step 3): quantities and ids only, one per ingredient per
-- Rome day (the alert dedup key). Returns the alert id, or null when the location total is not negative or
-- the alert was refused (try_raise_alert absorbs the guard codes and records a refusal row).
create function app.raise_negative_stock(
  p_tenant uuid, p_ingredient uuid, p_location uuid, p_movement uuid, p_at timestamptz, p_caller text
) returns uuid
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_on_hand numeric;
  v_unit public.base_unit;
begin
  v_on_hand := app.location_on_hand(p_tenant, p_ingredient, p_location);
  if v_on_hand >= 0 then
    return null;
  end if;
  select i.base_unit into v_unit
    from public.ingredient i where i.tenant_id = p_tenant and i.id = p_ingredient;
  return app.try_raise_alert(p_tenant, 'negative_stock', 'ingredient', p_ingredient,
    jsonb_build_object('ingredient_id', p_ingredient, 'location_id', p_location, 'on_hand_qty', v_on_hand,
                       'unit', v_unit::text, 'movement_id', p_movement),
    null, null, p_at, null, p_caller);
end
$$;

-- The FEFO engine (AT1, AT3, AT6). One call = one operation: its rows share (ref_type, ref_id). Steps:
--   1. take the stock lock of the ingredient (before any balance is read);
--   2. the override lot first, if given: it must be a lot of this tenant AND ingredient (P0002 lot_not_found)
--      with a positive bucket at this location (P0001 lot_empty); take min(qty, bucket) from it;
--   3. the positive buckets in FEFO order until the quantity is covered;
--   4. any remainder is ONE unlotted row (raw_lot_id null);
--   5. unit_cost on every row = the ingredient's basis in force at p_cost_at (null = now), read once; null when
--      the ingredient has no purchase, never 0 (ADR-008);
--   6. effective_on = the venue date of p_at;
--   7. the negative check, contained: whatever happens in it, the movements stay.
-- Returns the rows in insert order (M14 builds batch_input from them). p_qty is in base units (> 0).
create function app.post_stock_outflow(
  p_tenant uuid, p_user uuid, p_ingredient uuid, p_location uuid, p_qty numeric,
  p_type public.stock_movement_type, p_reason text, p_lot uuid, p_ref_type text, p_ref_id uuid,
  p_at timestamptz, p_cost_at timestamptz, p_caller text
) returns table (movement_id uuid, raw_lot_id uuid, qty numeric)
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_remaining numeric := p_qty;
  v_slice numeric;
  v_bucket numeric;
  v_cost numeric;
  v_tz text;
  v_date date;
  v_caller text := case when p_caller ~ '^[a-z_]{1,40}$' then p_caller else 'unknown' end;
  v_id uuid;
  v_last uuid;
  v_short uuid;
  b record;
begin
  if p_type::text not in ('consumption', 'waste') then
    raise exception 'type_invalid' using errcode = 'P0001';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'qty_invalid' using errcode = 'P0001';
  end if;

  perform app.lock_ingredient_stock(p_tenant, array[p_ingredient]);

  perform 1 from public.ingredient i where i.tenant_id = p_tenant and i.id = p_ingredient;
  if not found then
    raise exception 'ingredient_not_found' using errcode = 'P0002';
  end if;
  select t.timezone into v_tz from public.tenant t where t.id = p_tenant;
  v_date := app.venue_date(p_at, v_tz);
  select c.unit_cost into v_cost from app.ingredient_unit_costs(p_tenant, array[p_ingredient], p_cost_at) c;

  if p_lot is not null then
    perform 1 from public.raw_lot l
     where l.tenant_id = p_tenant and l.id = p_lot and l.ingredient_id = p_ingredient;
    if not found then
      raise exception 'lot_not_found' using errcode = 'P0002';
    end if;
    select coalesce(sum(m.qty), 0) into v_bucket
      from public.stock_movement m
     where m.tenant_id = p_tenant and m.ingredient_id = p_ingredient and m.location_id = p_location
       and m.raw_lot_id = p_lot;
    if v_bucket <= 0 then
      raise exception 'lot_empty' using errcode = 'P0001';
    end if;
    v_slice := least(v_remaining, v_bucket);
    insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost,
        reason_code, ref_type, ref_id, effective_on, created_by)
      values (p_tenant, p_ingredient, p_lot, p_location, p_type, -v_slice, v_cost, p_reason, p_ref_type, p_ref_id,
              v_date, p_user)
      returning id into v_id;
    v_last := v_id;
    v_remaining := v_remaining - v_slice;
    movement_id := v_id; raw_lot_id := p_lot; qty := -v_slice;
    return next;
  end if;

  if v_remaining > 0 then
    -- The query runs after the override insert, so the override lot shows its reduced bucket.
    for b in select f.raw_lot_id, f.qty from app.fefo_buckets(p_tenant, p_ingredient, p_location) f order by f.fefo_rank
    loop
      exit when v_remaining <= 0;
      v_slice := least(v_remaining, b.qty);
      insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost,
          reason_code, ref_type, ref_id, effective_on, created_by)
        values (p_tenant, p_ingredient, b.raw_lot_id, p_location, p_type, -v_slice, v_cost, p_reason, p_ref_type,
                p_ref_id, v_date, p_user)
        returning id into v_id;
      v_last := v_id;
      v_remaining := v_remaining - v_slice;
      movement_id := v_id; raw_lot_id := b.raw_lot_id; qty := -v_slice;
      return next;
    end loop;
  end if;

  if v_remaining > 0 then
    insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost,
        reason_code, ref_type, ref_id, effective_on, created_by)
      values (p_tenant, p_ingredient, null, p_location, p_type, -v_remaining, v_cost, p_reason, p_ref_type, p_ref_id,
              v_date, p_user)
      returning id into v_short;
    v_last := v_short;
    movement_id := v_short; raw_lot_id := null; qty := -v_remaining;
    return next;
  end if;

  -- Contained negative check (plan §3.1.7): a guard refusal is absorbed by try_raise_alert, any other error by
  -- this block; the movements above always commit. The stock lock was taken before the block, so rolling the
  -- block back cannot release it.
  begin
    perform app.raise_negative_stock(p_tenant, p_ingredient, p_location, coalesce(v_short, v_last), p_at, v_caller);
  exception when others then
    perform app.record_alert_refusal(p_tenant, 'negative_stock', 'ingredient', p_ingredient, v_caller,
                                     'check_failed', sqlstate);
  end;
  return;
end
$$;

revoke all on function
  app.require_stock_reader(), app.require_stock_writer(), app.lock_ingredient_stock(uuid, uuid[]),
  app.stock_qty_base(uuid, uuid, numeric, text), app.expiry_state(date, date),
  app.fefo_buckets(uuid, uuid, uuid), app.location_on_hand(uuid, uuid, uuid),
  app.raise_negative_stock(uuid, uuid, uuid, uuid, timestamptz, text),
  app.post_stock_outflow(uuid, uuid, uuid, uuid, numeric, public.stock_movement_type, text, uuid, text, uuid,
                         timestamptz, timestamptz, text)
  from public, anon, authenticated, service_role;
