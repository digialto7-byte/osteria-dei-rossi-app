-- M12 step 5: the public stock procedures (M12 plan §3.1.3-6, §3.2; ADR-011).
--   consume_raw_fefo, post_waste  - FEFO outflows through app.post_stock_outflow (AT1, AT3, AT6)
--   post_transfer                 - moves stock between two locations, lot by lot (AT4)
--   reverse_movement              - reverses a whole operation (AT5)
-- Each is one transaction (one function call). Every one is SECURITY DEFINER with an empty search_path, checks
-- the role FIRST (owner, admin or chef; Q1 = owner+chef+admin write, founder 2026-10-23), takes the tenant from
-- app.tenant_id() and the user from app.app_user_id(), filters every query by the tenant, and is executable by
-- `authenticated` only. Nobody inserts into stock_movement directly (M5: no INSERT grant).
-- A call is an operation: its rows share (ref_type, ref_id) with a fresh uuid. Answers carry quantities only:
-- no key and no value is a cost (V6, Q16).

-- Shared body of consume_raw_fefo and post_waste. Not callable by any API role.
create function app.run_stock_outflow(
  p_type public.stock_movement_type, p_ingredient uuid, p_qty numeric, p_unit text, p_reason text,
  p_location uuid, p_lot uuid, p_caller text
) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
  v_user uuid := app.app_user_id();
  v_qty numeric;
  v_loc uuid;
  v_op uuid := gen_random_uuid();
  v_moves jsonb;
  v_on_hand numeric;
begin
  v_qty := app.stock_qty_base(v_tenant, p_ingredient, p_qty, p_unit);
  v_loc := app.resolve_location(v_tenant, p_location);
  select coalesce(jsonb_agg(jsonb_build_object('id', r.movement_id, 'rawLotId', r.raw_lot_id,
                                               'locationId', v_loc, 'qty', r.qty) order by r.ord), '[]'::jsonb)
    into v_moves
    from app.post_stock_outflow(v_tenant, v_user, p_ingredient, v_loc, v_qty, p_type, p_reason, p_lot,
                                'manual', v_op, now(), null, p_caller)
         with ordinality r (movement_id, raw_lot_id, qty, ord);
  v_on_hand := app.location_on_hand(v_tenant, p_ingredient, v_loc);
  return jsonb_build_object('operationId', v_op, 'movements', v_moves, 'onHandQty', v_on_hand,
                            'negative', v_on_hand < 0);
end
$$;

create function public.consume_raw_fefo(
  p_ingredient uuid, p_qty numeric, p_unit text, p_location uuid default null, p_lot uuid default null
) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  perform app.require_stock_writer();
  return app.run_stock_outflow('consumption', p_ingredient, p_qty, p_unit, null, p_location, p_lot,
                               'consume_raw_fefo');
end
$$;

create function public.post_waste(
  p_ingredient uuid, p_qty numeric, p_unit text, p_reason text, p_location uuid default null,
  p_lot uuid default null
) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  perform app.require_stock_writer();
  if p_reason is null or p_reason <> all (app.stock_reason_codes()) then
    raise exception 'reason_invalid' using errcode = 'P0001';
  end if;
  return app.run_stock_outflow('waste', p_ingredient, p_qty, p_unit, p_reason, p_location, p_lot, 'post_waste');
end
$$;

-- A transfer moves positive buckets only: the total must be covered by recorded stock, else insufficient_stock
-- and nothing is written (moving more than the ledger shows is a recording error, not a consumption, Q5). Each
-- slice is two rows of one lot: -slice at the source, +slice at the destination, with no unit_cost. The ingredient
-- total is unchanged by construction. An override lot is moved first, then FEFO.
create function public.post_transfer(
  p_ingredient uuid, p_qty numeric, p_unit text, p_from uuid, p_to uuid, p_lot uuid default null
) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user uuid;
  v_qty numeric;
  v_from uuid;
  v_to uuid;
  v_op uuid := gen_random_uuid();
  v_tz text;
  v_date date;
  v_total numeric;
  v_remaining numeric;
  v_slice numeric;
  v_id uuid;
  v_moves jsonb := '[]'::jsonb;
  b record;
begin
  perform app.require_stock_writer();
  v_tenant := app.tenant_id();
  v_user := app.app_user_id();
  v_qty := app.stock_qty_base(v_tenant, p_ingredient, p_qty, p_unit);
  v_from := app.resolve_location(v_tenant, p_from);
  v_to := app.resolve_location(v_tenant, p_to);
  if v_from = v_to then
    raise exception 'same_location' using errcode = 'P0001';
  end if;

  perform app.lock_ingredient_stock(v_tenant, array[p_ingredient]);

  if p_lot is not null then
    perform 1 from public.raw_lot l
     where l.tenant_id = v_tenant and l.id = p_lot and l.ingredient_id = p_ingredient;
    if not found then
      raise exception 'lot_not_found' using errcode = 'P0002';
    end if;
    perform 1 from app.fefo_buckets(v_tenant, p_ingredient, v_from) f where f.raw_lot_id = p_lot;
    if not found then
      raise exception 'lot_empty' using errcode = 'P0001';
    end if;
  end if;
  select coalesce(sum(f.qty), 0) into v_total from app.fefo_buckets(v_tenant, p_ingredient, v_from) f;
  if v_total < v_qty then
    raise exception 'insufficient_stock' using errcode = 'P0001';
  end if;

  select t.timezone into v_tz from public.tenant t where t.id = v_tenant;
  v_date := app.venue_date(now(), v_tz);
  v_remaining := v_qty;
  for b in
    select f.raw_lot_id, f.qty
      from app.fefo_buckets(v_tenant, p_ingredient, v_from) f
     order by case when f.raw_lot_id = p_lot then 0 else 1 end, f.fefo_rank
  loop
    exit when v_remaining <= 0;
    v_slice := least(v_remaining, b.qty);
    insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost,
        reason_code, ref_type, ref_id, effective_on, created_by)
      values (v_tenant, p_ingredient, b.raw_lot_id, v_from, 'transfer', -v_slice, null, null, 'transfer', v_op,
              v_date, v_user)
      returning id into v_id;
    v_moves := v_moves || jsonb_build_object('id', v_id, 'rawLotId', b.raw_lot_id, 'locationId', v_from,
                                             'qty', -v_slice);
    insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost,
        reason_code, ref_type, ref_id, effective_on, created_by)
      values (v_tenant, p_ingredient, b.raw_lot_id, v_to, 'transfer', v_slice, null, null, 'transfer', v_op,
              v_date, v_user)
      returning id into v_id;
    v_moves := v_moves || jsonb_build_object('id', v_id, 'rawLotId', b.raw_lot_id, 'locationId', v_to,
                                             'qty', v_slice);
    v_remaining := v_remaining - v_slice;
  end loop;

  return jsonb_build_object('operationId', v_op, 'movements', v_moves,
    'fromOnHandQty', app.location_on_hand(v_tenant, p_ingredient, v_from),
    'toOnHandQty', app.location_on_hand(v_tenant, p_ingredient, v_to));
end
$$;

-- Reverses a whole operation (every row that shares the movement's ref_type and ref_id), never one row alone:
-- half of a FEFO split or one transfer leg reversed alone would break the totals. One mirror row per original,
-- same type, lot, location, reason and unit_cost, the opposite quantity, ref_type 'reversal' with a fresh ref_id,
-- dated today (Rome). Refused (P0001): movement_is_reversal; movement_not_reversible (receipt, count, or any
-- ref_type other than manual and transfer: M14 and M19 rows have their own corrections); already_reversed;
-- transfer_already_used (a destination no longer holds what was moved). The originals are never touched.
create function public.reverse_movement(p_movement uuid) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user uuid;
  o public.stock_movement;
  r public.stock_movement;
  v_ings uuid[];
  v_op uuid := gen_random_uuid();
  v_tz text;
  v_date date;
  v_id uuid;
  v_moves jsonb := '[]'::jsonb;
begin
  perform app.require_stock_writer();
  v_tenant := app.tenant_id();
  v_user := app.app_user_id();

  select m.* into o from public.stock_movement m where m.tenant_id = v_tenant and m.id = p_movement;
  if not found then
    raise exception 'movement_not_found' using errcode = 'P0002';
  end if;
  if o.ref_type = 'reversal' then
    raise exception 'movement_is_reversal' using errcode = 'P0001';
  end if;
  if o.type::text in ('receipt', 'count') or o.ref_type not in ('manual', 'transfer') then
    raise exception 'movement_not_reversible' using errcode = 'P0001';
  end if;
  if exists (select 1
               from public.stock_movement m
               join public.stock_movement x on x.tenant_id = m.tenant_id and x.reverses_id = m.id
              where m.tenant_id = v_tenant and m.ref_type = o.ref_type and m.ref_id = o.ref_id) then
    raise exception 'already_reversed' using errcode = 'P0001';
  end if;

  select array_agg(distinct m.ingredient_id) into v_ings
    from public.stock_movement m
   where m.tenant_id = v_tenant and m.ref_type = o.ref_type and m.ref_id = o.ref_id;
  perform app.lock_ingredient_stock(v_tenant, v_ings);

  -- Again, in a new statement after the lock: a concurrent reversal that committed meanwhile is visible now.
  if exists (select 1
               from public.stock_movement m
               join public.stock_movement x on x.tenant_id = m.tenant_id and x.reverses_id = m.id
              where m.tenant_id = v_tenant and m.ref_type = o.ref_type and m.ref_id = o.ref_id) then
    raise exception 'already_reversed' using errcode = 'P0001';
  end if;

  if o.type::text = 'transfer' then
    if exists (
      select 1
        from (select m.location_id, m.raw_lot_id, sum(m.qty) as q
                from public.stock_movement m
               where m.tenant_id = v_tenant and m.ref_type = o.ref_type and m.ref_id = o.ref_id and m.qty > 0
               group by m.location_id, m.raw_lot_id) d
       where (select coalesce(sum(x.qty), 0)
                from public.stock_movement x
               where x.tenant_id = v_tenant and x.ingredient_id = o.ingredient_id
                 and x.location_id = d.location_id and x.raw_lot_id is not distinct from d.raw_lot_id) < d.q) then
      raise exception 'transfer_already_used' using errcode = 'P0001';
    end if;
  end if;

  select t.timezone into v_tz from public.tenant t where t.id = v_tenant;
  v_date := app.venue_date(now(), v_tz);
  begin
    for r in
      select m.* from public.stock_movement m
       where m.tenant_id = v_tenant and m.ref_type = o.ref_type and m.ref_id = o.ref_id
       order by m.id
    loop
      insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost,
          reason_code, ref_type, ref_id, reverses_id, effective_on, created_by)
        values (v_tenant, r.ingredient_id, r.raw_lot_id, r.location_id, r.type, -r.qty, r.unit_cost, r.reason_code,
                'reversal', v_op, r.id, v_date, v_user)
        returning id into v_id;
      v_moves := v_moves || jsonb_build_object('id', v_id, 'rawLotId', r.raw_lot_id, 'locationId', r.location_id,
                                               'qty', -r.qty);
    end loop;
  exception when unique_violation then
    -- The unique index stock_movement_reverses_uq is the backstop: a row of this operation was reversed.
    raise exception 'already_reversed' using errcode = 'P0001';
  end;

  return jsonb_build_object('operationId', v_op, 'reversedOperationId', o.ref_id, 'movements', v_moves);
end
$$;

revoke all on function app.run_stock_outflow(public.stock_movement_type, uuid, numeric, text, text, uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.consume_raw_fefo(uuid, numeric, text, uuid, uuid),
  public.post_waste(uuid, numeric, text, text, uuid, uuid),
  public.post_transfer(uuid, numeric, text, uuid, uuid, uuid),
  public.reverse_movement(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.consume_raw_fefo(uuid, numeric, text, uuid, uuid),
  public.post_waste(uuid, numeric, text, text, uuid, uuid),
  public.post_transfer(uuid, numeric, text, uuid, uuid, uuid),
  public.reverse_movement(uuid)
  to authenticated;
