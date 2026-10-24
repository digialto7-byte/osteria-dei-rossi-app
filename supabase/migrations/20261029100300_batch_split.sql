-- M15 step 4: split_batch (M15 plan §3.1.4, §3.1.5, §3.1.12, §3.2; AT1, AT4; ADR-014). One transaction:
--   1. the parent row lock, 2. the remaining portions (read after the lock), 3. the lot lock, 4. the sequence,
--   5. the child batch, 6. the child's frozen cost (copied), 7. the pair of split movements, 8. the parent's state.
-- Lock order: stock locks (none here), batch rows, batch lot. Role checked first (owner, admin or chef), tenant and
-- user from the session, definer, empty search_path, executable by `authenticated` only. The answer carries no value.
--
-- The child keeps the parent's recipe version, production time and producer (the food was made then, by that person),
-- so the label and FEFO stay true and a split of a split keeps the root's production time. Its shelf life is counted
-- from the original production in whole hours, rounded down, so M14's elapsed-hours check on use_by holds unchanged and
-- the use-by is never later than the chef asked (at most 59 minutes earlier; plan assumption A2). Without a location
-- the child stays where the parent is.
create function public.split_batch(
  p_batch uuid, p_portions integer, p_hours_from_now integer, p_location uuid default null
) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user uuid;
  v_now timestamptz := now();
  v_tz text;
  v_date date;
  v_parent public.batch;
  v_cost public.batch_cost;
  v_remaining numeric;
  v_location uuid;
  v_shelf integer;
  v_use_by timestamptz;
  v_seq integer;
  v_child uuid := gen_random_uuid();
  v_lot text;
  v_output numeric;
  v_state public.batch_state;
begin
  perform app.require_batch_writer();
  v_tenant := app.tenant_id();
  v_user := app.app_user_id();

  if p_portions is null or p_portions < 1 or p_portions > 10000 then
    raise exception 'portions_invalid' using errcode = 'P0001';
  end if;
  if p_hours_from_now is null or p_hours_from_now < 1 or p_hours_from_now > 8760 then
    raise exception 'shelf_life_invalid' using errcode = 'P0001';
  end if;
  if p_batch is null then
    raise exception 'batch_not_found' using errcode = 'P0002';
  end if;

  -- 1-2. The parent row lock, then the remaining portions in a new statement.
  perform app.lock_batch_rows(v_tenant, array[p_batch]);
  select * into v_parent from public.batch b where b.tenant_id = v_tenant and b.id = p_batch;
  if v_parent.use_by <= v_now then
    raise exception 'batch_expired' using errcode = 'P0001';
  end if;
  v_remaining := app.batch_remaining(v_tenant, p_batch);
  if p_portions > floor(v_remaining) then
    raise exception 'portions_insufficient' using errcode = 'P0001';
  end if;

  -- The new shelf life, counted from the original production in whole elapsed hours.
  v_shelf := floor(extract(epoch from (v_now + make_interval(hours => p_hours_from_now) - v_parent.produced_at)) / 3600);
  v_use_by := app.batch_use_by(v_parent.produced_at, v_shelf);
  if v_shelf < 1 or v_shelf > 8760 or v_use_by <= v_now then
    raise exception 'shelf_life_invalid' using errcode = 'P0001';
  end if;
  -- No location given: the part stays where its parent is, so a tenant with several locations is never ambiguous.
  -- An id that is given must be an active location of the tenant (location_not_found).
  v_location := case when p_location is null then v_parent.location_id
                     else app.resolve_location(v_tenant, p_location) end;

  select * into v_cost from public.batch_cost c where c.tenant_id = v_tenant and c.batch_id = p_batch;
  if not found then
    raise exception 'batch_cost_missing' using errcode = 'P0001';
  end if;

  -- 3-4. The lot code on the split's Rome day, numbered under the same lot lock as production.
  select t.timezone into v_tz from public.tenant t where t.id = v_tenant;
  v_date := app.venue_date(v_now, v_tz);
  perform app.lock_batch_lot(v_tenant, v_date, v_parent.lot_recipe_code);
  v_seq := app.next_lot_seq(v_tenant, v_date, v_parent.lot_recipe_code);
  v_lot := to_char(v_date, 'YYMMDD') || '-' || v_parent.lot_recipe_code || '-' || v_seq;
  v_output := greatest(round(v_parent.output_qty * p_portions / v_parent.portions_initial, 4), 0.0001);

  -- 5. The child batch.
  insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code,
      lot_seq, produced_at, produced_by, output_qty, output_unit, portions_computed, portions_initial, shelf_life_hours,
      use_by, state, location_id, split_from_batch_id, created_by)
    values (v_child, v_tenant, v_parent.recipe_key, v_parent.recipe_id, v_parent.recipe_version, v_lot, v_date,
      v_parent.lot_recipe_code, v_seq, v_parent.produced_at, v_parent.produced_by, v_output, v_parent.output_unit,
      p_portions, p_portions, v_shelf, v_use_by, 'fresh', v_location, p_batch, v_user);

  -- 6. The frozen cost per portion is copied, never recomputed (ADR-008); an incomplete cost stays incomplete.
  insert into public.batch_cost (batch_id, tenant_id, total_cost, unit_cost_frozen, incomplete, missing_ingredient_ids,
      cost_at, created_by)
    values (v_child, v_tenant,
      case when not v_cost.incomplete then round(v_cost.unit_cost_frozen * p_portions, 4) end,
      v_cost.unit_cost_frozen, v_cost.incomplete, v_cost.missing_ingredient_ids, v_cost.cost_at, v_user);

  -- 7. The pair of movements: -n on the parent, +n on the child, both pointing at the child.
  insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
    values (v_tenant, p_batch, 'split', -p_portions, 'batch_split', v_child, v_date, v_user),
           (v_tenant, v_child, 'split', p_portions, 'batch_split', v_child, v_date, v_user);

  -- 8. The parent's state.
  v_state := app.batch_settle_state(v_tenant, p_batch, 'split');

  return jsonb_build_object('batchId', p_batch, 'newBatchId', v_child, 'lotCode', v_lot, 'portions', p_portions,
                            'producedAt', v_parent.produced_at, 'useBy', v_use_by, 'shelfLifeHours', v_shelf,
                            'locationId', v_location, 'portionsRemaining', app.batch_remaining(v_tenant, p_batch),
                            'state', v_state);
end
$$;

revoke all on function public.split_batch(uuid, integer, integer, uuid) from public, anon, authenticated, service_role;
grant execute on function public.split_batch(uuid, integer, integer, uuid) to authenticated;
