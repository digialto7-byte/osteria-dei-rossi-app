-- M12 step 6: the read functions (M12 plan §3.2, §3.4; ADR-011; Q16 = V6).
--   stock_on_hand, stock_lots, stock_movements  - quantities only, owner / admin / chef
--   raw_waste_costs                             - EUR, owner / admin only (app.require_cost_reader, M8)
-- stock_movement keeps its owner/admin-only RLS (it carries unit_cost) and v_stock_on_hand stays the canonical
-- fold. The chef reads stock only through these definer functions: role check FIRST, tenant from app.tenant_id(),
-- an empty search_path, every query filtered by the tenant, execute to `authenticated` only. The three quantity
-- functions have no EUR column and no cost key; the name raw_waste_costs contains "cost", so pgTAP 059's
-- catalogue scan covers it (its expected list is extended in this commit).

-- One row per ingredient x location that has movements: the total and the unlotted bucket, summed from the
-- canonical view v_stock_on_hand. The definer reads every row of the view, so the tenant is filtered here.
create function public.stock_on_hand(p_location uuid default null)
  returns table (ingredient_id uuid, ingredient_name text, base_unit public.base_unit, is_active boolean,
                 location_id uuid, location_name text, on_hand_qty numeric, unlotted_qty numeric)
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tenant uuid;
begin
  perform app.require_stock_reader();
  v_tenant := app.tenant_id();
  if p_location is not null then
    perform 1 from public.location x where x.tenant_id = v_tenant and x.id = p_location;
    if not found then
      raise exception 'location_not_found' using errcode = 'P0002';
    end if;
  end if;
  return query
  select i.id, i.name, i.base_unit, i.is_active, x.id, x.name,
         sum(v.qty_on_hand), coalesce(sum(v.qty_on_hand) filter (where v.raw_lot_id is null), 0)
    from public.v_stock_on_hand v
    join public.ingredient i on i.tenant_id = v.tenant_id and i.id = v.ingredient_id
    join public.location x on x.tenant_id = v.tenant_id and x.id = v.location_id
   where v.tenant_id = v_tenant and (p_location is null or v.location_id = p_location)
   group by i.id, i.name, i.base_unit, i.is_active, x.id, x.name
   order by i.name collate "C", x.name collate "C";
end
$$;

-- The lot buckets of one ingredient per location (the unlotted bucket is a row with a null lot), with the FEFO
-- rank among the positive buckets of the same location (null for the others). A bucket of 0 is listed only with
-- p_include_empty; a non-zero bucket always (a negative unlotted one is the point of the screen).
create function public.stock_lots(p_ingredient uuid, p_include_empty boolean default false)
  returns table (raw_lot_id uuid, lot_code text, location_id uuid, location_name text, expiry date,
                 expiry_state text, received_on date, supplier_name text, qty_received numeric,
                 on_hand_qty numeric, fefo_rank integer)
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tenant uuid;
  v_today date;
begin
  perform app.require_stock_reader();
  v_tenant := app.tenant_id();
  perform 1 from public.ingredient i where i.tenant_id = v_tenant and i.id = p_ingredient;
  if not found then
    raise exception 'ingredient_not_found' using errcode = 'P0002';
  end if;
  select app.venue_date(now(), t.timezone) into v_today from public.tenant t where t.id = v_tenant;
  return query
  select b.raw_lot_id, l.lot_code, b.location_id, x.name, l.expiry,
         case when b.raw_lot_id is null then null else app.expiry_state(l.expiry, v_today) end,
         l.received_on, s.name, l.qty_received, b.qty,
         case when b.qty > 0 then
           (row_number() over (partition by b.location_id, (b.qty > 0)
                               order by l.expiry asc nulls last, l.received_on asc nulls last,
                                        b.raw_lot_id asc nulls last))::integer
         end
    from (select m.location_id, m.raw_lot_id, sum(m.qty) as qty
            from public.stock_movement m
           where m.tenant_id = v_tenant and m.ingredient_id = p_ingredient
           group by m.location_id, m.raw_lot_id) b
    join public.location x on x.tenant_id = v_tenant and x.id = b.location_id
    left join public.raw_lot l on l.tenant_id = v_tenant and l.id = b.raw_lot_id
    left join public.supplier s on s.tenant_id = v_tenant and s.id = l.supplier_id
   where b.qty <> 0 or p_include_empty
   order by x.name collate "C", 11 nulls last, l.expiry nulls last, l.received_on nulls last, b.raw_lot_id nulls last;
end
$$;

-- The history of one ingredient, an operation at a time (the rows that share ref_type and ref_id), newest first.
-- nextCursor is {createdAt, id} of the last operation shown (id = its handleId), or null. Per operation:
--   operationId, handleId (a row id to hand to reverse_movement), type, refType, reasonCode, isReversal,
--   reversedByOperationId, reversible (as reverse_movement, minus the transfer stock check), qty (the net
--   quantity; for a transfer the quantity moved), unit, lines, effectiveOn, createdAt, byName, byMe.
-- byName is null for the chef unless the operation is the chef's own. No unit_cost anywhere.
create function public.stock_movements(
  p_ingredient uuid, p_before_at timestamptz default null, p_before_id uuid default null, p_limit integer default 50
) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_me uuid;
  v_role text;
  v_ops jsonb;
  v_next jsonb;
begin
  perform app.require_stock_reader();
  v_tenant := app.tenant_id();
  v_me := app.app_user_id();
  v_role := app.role()::text;
  if p_limit is null or p_limit < 1 or p_limit > 100 or (p_before_at is null) <> (p_before_id is null) then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;
  perform 1 from public.ingredient i where i.tenant_id = v_tenant and i.id = p_ingredient;
  if not found then
    raise exception 'ingredient_not_found' using errcode = 'P0002';
  end if;

  with ops as (
    select m.ref_type, m.ref_id,
           (array_agg(m.id order by m.id))[1] as handle_id,
           min(m.created_at) as created_at
      from public.stock_movement m
     where m.tenant_id = v_tenant and m.ingredient_id = p_ingredient
     group by m.ref_type, m.ref_id
    having p_before_at is null
        or (min(m.created_at), (array_agg(m.id order by m.id))[1]) < (p_before_at, p_before_id)
  ),
  page as (
    select o.*, row_number() over (order by o.created_at desc, o.handle_id desc) as rn
      from ops o
     order by o.created_at desc, o.handle_id desc
     limit p_limit + 1
  ),
  shown as (
    select p.*,
           (select jsonb_build_object(
              'operationId', p.ref_id,
              'handleId', p.handle_id,
              'type', f.type::text,
              'refType', p.ref_type,
              'reasonCode', f.reason_code,
              'isReversal', p.ref_type = 'reversal',
              'reversedByOperationId', (select max(x.ref_id::text)::uuid
                                          from public.stock_movement x
                                          join public.stock_movement y on y.tenant_id = x.tenant_id and y.id = x.reverses_id
                                         where x.tenant_id = v_tenant and y.ref_type = p.ref_type and y.ref_id = p.ref_id),
              'reversible', (f.type::text not in ('receipt', 'count') and p.ref_type in ('manual', 'transfer')
                             and not exists (select 1
                                               from public.stock_movement x
                                               join public.stock_movement y on y.tenant_id = x.tenant_id and y.id = x.reverses_id
                                              where x.tenant_id = v_tenant and y.ref_type = p.ref_type and y.ref_id = p.ref_id)),
              'qty', case when f.type::text = 'transfer' then f.moved else f.net end,
              'unit', i.base_unit::text,
              'lines', f.lines,
              'effectiveOn', f.effective_on,
              'createdAt', p.created_at,
              'byName', case when v_role = 'chef' and f.created_by is distinct from v_me then null else u.display_name end,
              'byMe', f.created_by is not distinct from v_me)
              from (select (array_agg(m.type order by m.id))[1] as type,
                           (array_agg(m.reason_code order by m.id))[1] as reason_code,
                           (array_agg(m.created_by order by m.id))[1] as created_by,
                           min(m.effective_on) as effective_on,
                           sum(m.qty) as net,
                           coalesce(sum(m.qty) filter (where m.qty > 0), 0) as moved,
                           jsonb_agg(jsonb_build_object('movementId', m.id, 'locationId', m.location_id,
                                                        'locationName', x.name, 'rawLotId', m.raw_lot_id,
                                                        'lotCode', l.lot_code, 'qty', m.qty)
                                     order by m.qty, x.name collate "C", coalesce(l.lot_code, '') collate "C", m.id) as lines
                      from public.stock_movement m
                      join public.location x on x.tenant_id = m.tenant_id and x.id = m.location_id
                      left join public.raw_lot l on l.tenant_id = m.tenant_id and l.id = m.raw_lot_id
                     where m.tenant_id = v_tenant and m.ingredient_id = p_ingredient
                       and m.ref_type = p.ref_type and m.ref_id = p.ref_id) f
              join public.ingredient i on i.tenant_id = v_tenant and i.id = p_ingredient
              left join public.app_user u on u.tenant_id = v_tenant and u.id = f.created_by) as op
      from page p
  )
  select coalesce(jsonb_agg(s.op order by s.rn) filter (where s.rn <= p_limit), '[]'::jsonb),
         case when count(*) > p_limit then
           (select jsonb_build_object('createdAt', s2.created_at, 'id', s2.handle_id) from shown s2 where s2.rn = p_limit)
         end
    into v_ops, v_next
    from shown s;

  return jsonb_build_object('operations', v_ops, 'nextCursor', v_next);
end
$$;

-- Waste in EUR over a range of effective dates: originals AND reversals (a reversal is dated when it is posted,
-- so it reduces the waste of its own period). Per reason and ingredient: qty = -Sum(qty); value = -Sum(qty x
-- unit_cost) over the rows that have a cost. A row with no cost is never valued at 0: it counts in
-- unvaluedCount (net of its reversals) and a line with no valued row has valueEur null. Owner and admin only.
create function public.raw_waste_costs(p_from date, p_to date) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_result jsonb;
begin
  perform app.require_cost_reader();
  v_tenant := app.tenant_id();
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'range_invalid' using errcode = 'P0001';
  end if;
  if p_to - p_from + 1 > 366 then
    raise exception 'range_too_long' using errcode = 'P0001';
  end if;

  with lines as (
    select m.reason_code, m.ingredient_id, i.name as ingredient_name, i.base_unit,
           -sum(m.qty) as qty,
           case when count(m.unit_cost) = 0 then null else round(-sum(m.qty * m.unit_cost), 4) end as value_eur,
           count(*) filter (where m.unit_cost is null and m.reverses_id is null)
             - count(*) filter (where m.unit_cost is null and m.reverses_id is not null) as unvalued
      from public.stock_movement m
      join public.ingredient i on i.tenant_id = m.tenant_id and i.id = m.ingredient_id
     where m.tenant_id = v_tenant and m.type::text = 'waste' and m.effective_on between p_from and p_to
     group by m.reason_code, m.ingredient_id, i.name, i.base_unit
    having sum(m.qty) <> 0
  ),
  reasons as (
    select l.reason_code, coalesce(sum(l.value_eur), 0) as value_eur,
           jsonb_agg(jsonb_build_object('ingredientId', l.ingredient_id, 'ingredientName', l.ingredient_name,
                                        'baseUnit', l.base_unit::text, 'qty', round(l.qty, 4), 'valueEur', l.value_eur)
                     order by l.ingredient_name collate "C", l.ingredient_id) as lines
      from lines l
     group by l.reason_code
  )
  select jsonb_build_object(
           'from', p_from, 'to', p_to,
           'valueEur', round(coalesce((select sum(r.value_eur) from reasons r), 0), 4),
           'unvaluedCount', greatest(coalesce((select sum(l.unvalued) from lines l), 0), 0),
           'reasons', coalesce((select jsonb_agg(jsonb_build_object('reasonCode', r.reason_code,
                                    'valueEur', round(r.value_eur, 4), 'lines', r.lines)
                                  order by r.value_eur desc, r.reason_code collate "C") from reasons r), '[]'::jsonb))
    into v_result;
  return v_result;
end
$$;

revoke all on function public.stock_on_hand(uuid), public.stock_lots(uuid, boolean),
  public.stock_movements(uuid, timestamptz, uuid, integer), public.raw_waste_costs(date, date)
  from public, anon, authenticated, service_role;
grant execute on function public.stock_on_hand(uuid), public.stock_lots(uuid, boolean),
  public.stock_movements(uuid, timestamptz, uuid, integer), public.raw_waste_costs(date, date)
  to authenticated;
