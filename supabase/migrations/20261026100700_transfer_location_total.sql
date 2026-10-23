-- M12 review fix 1: post_transfer refuses to take a location below zero.
-- The 20261026100500 body summed only the positive lots, so a negative "senza lotto" bucket at the same location
-- was ignored (lot 2 kg, waste 3 kg, a receipt of 2 kg: the location holds 1 kg but 2 kg could be moved).
-- Re-created from that body with ONE new guard after the per-ingredient lock: qty > location total is
-- insufficient_stock (P0001), nothing written. The grants of the original are kept by create or replace.

create or replace function public.post_transfer(
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
  -- The location total counts every bucket, a negative "senza lotto" one included: a transfer never takes a
  -- location below zero (Q5, ADR-011). The positive-lot check above says the lots can serve the slices; this one
  -- says the location really holds the quantity.
  if v_qty > app.location_on_hand(v_tenant, p_ingredient, v_from) then
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

  -- With the refusals above the source cannot end below zero (slices come from positive buckets only, and
  -- qty <= the location total). If it ever did, the contained negative_stock alert path of waste is not the
  -- answer for a transfer: refuse and roll back, so the ledger never shows an invented shortfall.
  if app.location_on_hand(v_tenant, p_ingredient, v_from) < 0 then
    raise exception 'transfer_left_negative' using errcode = 'XX000';
  end if;

  return jsonb_build_object('operationId', v_op, 'movements', v_moves,
    'fromOnHandQty', app.location_on_hand(v_tenant, p_ingredient, v_from),
    'toOnHandQty', app.location_on_hand(v_tenant, p_ingredient, v_to));
end
$$;
