-- M19 step 4: void_line (M19 plan §3.1.7, §3.2, §3.3; ADR-019; AT6).
--
-- void_line(p_line, {reason, clientUpdatedAt}) voids one line with a coded reason (app.order_void_reason_codes(); M18's
-- internal "entry_removed" is not one). Owner, admin, waiter. Security definer, empty search_path, role first, tenant from
-- app.tenant_id(), user from app.app_user_id(). Nothing is deleted.
--   Before firing (a draft): last write wins exactly as remove_order_line; the line is voided, its stamp and updated_* move,
--     and NO movement is written in either ledger.
--   After firing: the stamp is not compared (a fired line cannot have been edited since) and client_updated_at stays (the
--     order_line guard requires it). For each of the line's consume movements a reversal (type consume, +portions, reverses_id,
--     ref order_void) AND a waste row (type waste, -portions, the mapped waste reason, ref order_void) on the same batch; for
--     each consumption stock row a mirrored reversal (same lot, location, type, unit_cost: the M12 guard checks it) AND a
--     waste row on the same lot and location with the mapped reason and the same unit_cost. Net effect per batch and per lot
--     bucket 0: stock is NOT restored, the plate moves from "consumed" to "waste" (PRD 2.3). order_line_cost stays.
--   Replay: a voided line with the same reason by the same caller (for a draft void also the same stamp) answers
--     {changed: false}; any other void answers {conflict: {reason: voided}}. A closed session answers
--     {conflict: {reason: session_closed}}. Conflicts are results, never raised (a DETAIL would put the line into the logs).
-- Lock order (plan §3.3): session SHARE -> the line UPDATE -> ingredient stock locks -> batch rows UPDATE.
-- Errors: 42501; 22023 invalid_request (shape, unknown key, reason not a string, bad instant); P0002 line_not_found; P0001
-- void_reason_invalid, client_time_invalid.

create function public.void_line(p_line uuid, p_body jsonb) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user uuid;
  v_reason text;
  v_at timestamptz;
  v_session uuid;
  v_now timestamptz;
  v_date date;
  v_tz text;
  v_waste text;
  v_batches uuid[];
  v_ings uuid[];
  s public.table_session;
  x public.order_line;
  v_row public.order_line;
  m record;
begin
  perform app.require_table_operator();
  v_tenant := app.tenant_id();
  v_user := app.app_user_id();
  if p_line is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  perform app.menu_keys_ok(p_body, array['reason', 'clientUpdatedAt'], array['reason', 'clientUpdatedAt']);
  if jsonb_typeof(p_body -> 'reason') <> 'string' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  v_reason := p_body ->> 'reason';
  if v_reason <> all (app.order_void_reason_codes()) then
    raise exception 'void_reason_invalid' using errcode = 'P0001';
  end if;
  v_at := app.parse_client_time(p_body -> 'clientUpdatedAt');
  v_waste := app.void_waste_reason(v_reason);

  -- The line's session (it never changes), then the locks: session FOR SHARE, line FOR UPDATE.
  select l.table_session_id into v_session from public.order_line l where l.tenant_id = v_tenant and l.id = p_line;
  if not found then
    raise exception 'line_not_found' using errcode = 'P0002';
  end if;
  select z.* into s from public.table_session z where z.tenant_id = v_tenant and z.id = v_session for share;
  select l.* into x from public.order_line l where l.tenant_id = v_tenant and l.id = p_line for update;

  if x.voided_at is not null then
    if x.void_reason = v_reason and x.voided_by = v_user and (x.fired_at is not null or x.client_updated_at = v_at) then
      return jsonb_build_object('changed', false, 'line', app.order_line_json(x));
    end if;
    return app.order_conflict('voided', x);
  end if;
  if s.closed_at is not null then
    return app.order_conflict('session_closed', x);
  end if;

  if x.fired_at is null then
    -- A draft: last write wins, no movement.
    if v_at < x.client_updated_at or (v_at = x.client_updated_at and x.updated_by <> v_user) then
      return app.order_conflict('stale', x);
    end if;
    update public.order_line
       set voided_at = clock_timestamp(),
           voided_by = v_user,
           void_reason = v_reason,
           client_updated_at = v_at,
           updated_at = clock_timestamp(),
           updated_by = v_user
     where tenant_id = v_tenant and id = x.id
     returning * into v_row;
    return jsonb_build_object('changed', true, 'line', app.order_line_json(v_row));
  end if;

  -- A fired line: reversal + waste for each movement it wrote and has not yet reversed. Stock locks, then batch rows.
  select coalesce(array_agg(distinct b.batch_id), '{}') into v_batches
    from public.batch_movement b
   where b.tenant_id = v_tenant and b.type = 'consume' and b.ref_type = 'order_line' and b.ref_id = x.id
     and b.reverses_id is null;
  select coalesce(array_agg(distinct t.ingredient_id), '{}') into v_ings
    from public.stock_movement t
   where t.tenant_id = v_tenant and t.type = 'consumption' and t.ref_type = 'order_line' and t.ref_id = x.id
     and t.reverses_id is null;
  perform app.lock_ingredient_stock(v_tenant, v_ings);
  if cardinality(v_batches) > 0 then
    perform app.lock_batch_rows(v_tenant, v_batches);
  end if;

  v_now := clock_timestamp();
  select t.timezone into v_tz from public.tenant t where t.id = v_tenant;
  v_date := app.venue_date(v_now, v_tz);

  for m in
    select b.id, b.batch_id, b.portions
      from public.batch_movement b
     where b.tenant_id = v_tenant and b.type = 'consume' and b.ref_type = 'order_line' and b.ref_id = x.id
       and b.reverses_id is null
       and not exists (select 1 from public.batch_movement r where r.tenant_id = b.tenant_id and r.reverses_id = b.id)
     order by b.created_at, b.id
  loop
    insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, reverses_id, effective_on, created_by)
      values (v_tenant, m.batch_id, 'consume', -m.portions, 'order_void', x.id, m.id, v_date, v_user);
    insert into public.batch_movement (tenant_id, batch_id, type, portions, reason_code, ref_type, ref_id, effective_on, created_by)
      values (v_tenant, m.batch_id, 'waste', m.portions, v_waste, 'order_void', x.id, v_date, v_user);
  end loop;

  for m in
    select t.id, t.ingredient_id, t.raw_lot_id, t.location_id, t.qty, t.unit_cost
      from public.stock_movement t
     where t.tenant_id = v_tenant and t.type = 'consumption' and t.ref_type = 'order_line' and t.ref_id = x.id
       and t.reverses_id is null
       and not exists (select 1 from public.stock_movement r where r.tenant_id = t.tenant_id and r.reverses_id = t.id)
     order by t.created_at, t.id
  loop
    insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type, ref_id,
        reverses_id, effective_on, created_by)
      values (v_tenant, m.ingredient_id, m.raw_lot_id, m.location_id, 'consumption', -m.qty, m.unit_cost, 'order_void', x.id,
              m.id, v_date, v_user);
    insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, reason_code,
        ref_type, ref_id, effective_on, created_by)
      values (v_tenant, m.ingredient_id, m.raw_lot_id, m.location_id, 'waste', m.qty, m.unit_cost, v_waste, 'order_void', x.id,
              v_date, v_user);
  end loop;

  -- The net effect is 0, so no state is expected to change; settling keeps the state rule (finished at or below zero) true.
  for m in select unnest(v_batches) as batch_id loop
    perform app.batch_settle_state(v_tenant, m.batch_id, 'consume');
  end loop;

  update public.order_line
     set voided_at = v_now,
         voided_by = v_user,
         void_reason = v_reason,
         updated_at = v_now,
         updated_by = v_user
   where tenant_id = v_tenant and id = x.id
   returning * into v_row;
  return jsonb_build_object('changed', true, 'line', app.order_line_json(v_row));
end
$$;

revoke all on function public.void_line(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.void_line(uuid, jsonb) to authenticated;
