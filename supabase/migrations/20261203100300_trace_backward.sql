-- P2-2 S4 (docs/plans/2026-11-14-p2-2-trace-sell-through.md sections 3.3.2 and 3.3.3): the backward traces. Read-only definers with an empty search_path; the public wrappers call
-- app.require_trace_reader() first and take the tenant and the role from the session; executable by `authenticated` only. An unknown id and another tenant's id are the same P0002 not_found.
--
--   app.trace_batch_json(p_tenant, p_role, p_batch) -> {
--     batch {batchId, lotCode, recipeName, recipeVersion, producedAt, useBy, portionsInitial, state, splitFrom|null, root {batchId, lotCode}},
--     inputs [{ingredient {id, name}, qty, unit, inherited, lot {lotId, lotCode|null, expiry|null, receivedOn, supplier {id, name}, invoice?} | null}],
--     portions {sold, wasted, staffMeal, counted, splitOut, remaining}, plates [...as in trace_lot, via batch], platesTruncated }
--     The inputs are the ROOT's batch_input rows (a split child has none of its own: inherited true); lot null is the unlotted shortfall slice (D-P3). The portions and plates are this
--     batch only. splitOut is the sum of the batch's split movements (a parent: minus what it gave away; a child: plus what it received).
--   app.trace_line_search_json(p_tenant, p_role, p_date, p_menu_item, p_now) -> {businessDate, lines [{lineId, menuItemName, tableName, firedAt, portions, weightG|null, state}], truncated}
--     The lines fired in the business day [kpi_cutoff_end(D-1), kpi_cutoff_end(D)), a line voided after the send reads 'voided'; drafts are not served plates. Oldest first, at most
--     TRACE_MAX_LINES. A null date is 22023 query_invalid, a date after the business today is P0001 date_in_future.
--   app.trace_line_json(p_tenant, p_role, p_line) -> {line {...}, batches [{batchId, lotCode, recipeName, producedAt, portions, reversed}],
--     rawDirect [{ingredient, qty, unit, lot|null}], lots [distinct lots reached through the batches' roots and the direct rows, each with ingredient, supplier and (owner, admin) invoice]}
--     A draft line answers with empty lists. No guest data: the reply has the table name and times only, and nothing here reads a reservation table (Q-P10).
--   Only owner and admin get `invoice` (id, number as printed, date). No money key for any role.

create function app.trace_batch_json(p_tenant uuid, p_role text, p_batch uuid) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_max_plates integer := (app.trace_constants() ->> 'TRACE_MAX_PLATE_GROUPS')::integer;
  b public.batch;
  v_root uuid;
  v_block jsonb;
  v_inputs jsonb;
  v_portions jsonb;
  v_plates jsonb;
  v_plates_n integer;
begin
  select * into b from public.batch x where x.tenant_id = p_tenant and x.id = p_batch;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  v_root := app.batch_root(p_tenant, b.id);

  select jsonb_build_object(
           'batchId', b.id,
           'lotCode', b.lot_code,
           'recipeName', rc.name,
           'recipeVersion', b.recipe_version,
           'producedAt', app.iso_utc(b.produced_at),
           'useBy', app.iso_utc(b.use_by),
           'portionsInitial', b.portions_initial,
           'state', b.state::text,
           'splitFrom', case when pb.id is null then null else jsonb_build_object('batchId', pb.id, 'lotCode', pb.lot_code) end,
           'root', jsonb_build_object('batchId', rb.id, 'lotCode', rb.lot_code))
    into v_block
    from public.recipe rc, public.batch rb
    left join public.batch pb on pb.tenant_id = p_tenant and pb.id = b.split_from_batch_id
   where rc.tenant_id = p_tenant and rc.id = b.recipe_id and rb.tenant_id = p_tenant and rb.id = v_root;

  select coalesce(jsonb_agg(jsonb_build_object(
           'ingredient', jsonb_build_object('id', i.id, 'name', i.name),
           'qty', bi.qty,
           'unit', i.base_unit::text,
           'inherited', v_root <> b.id,
           'lot', case when rl.id is null then null::jsonb
                  else jsonb_build_object('lotId', rl.id, 'lotCode', rl.lot_code, 'expiry', rl.expiry, 'receivedOn', rl.received_on, 'supplier', jsonb_build_object('id', s.id, 'name', s.name))
                       || case when p_role in ('owner', 'admin')
                               then jsonb_build_object('invoice', jsonb_build_object('id', inv.id, 'number', inv.number_raw, 'date', inv.invoice_date))
                               else '{}'::jsonb end end)
           order by i.name collate "C", rl.id is null, rl.received_on, bi.created_at, bi.id), '[]'::jsonb)
    into v_inputs
    from public.batch_input bi
    join public.ingredient i on i.tenant_id = bi.tenant_id and i.id = bi.ingredient_id
    left join public.raw_lot rl on rl.tenant_id = bi.tenant_id and rl.id = bi.raw_lot_id
    left join public.supplier s on s.tenant_id = rl.tenant_id and s.id = rl.supplier_id
    left join public.invoice_line il on il.tenant_id = rl.tenant_id and il.id = rl.invoice_line_id
    left join public.invoice inv on inv.tenant_id = il.tenant_id and inv.id = il.invoice_id
   where bi.tenant_id = p_tenant and bi.batch_id = v_root;

  select jsonb_build_object(
           'sold', coalesce(-sum(m.portions) filter (where m.type::text = 'consume'), 0),
           'wasted', coalesce(-sum(m.portions) filter (where m.type::text = 'waste' and m.ref_type <> 'staff_meal'), 0),
           'staffMeal', coalesce(-sum(m.portions) filter (where m.type::text = 'waste' and m.ref_type = 'staff_meal'), 0),
           'counted', coalesce(sum(m.portions) filter (where m.type::text = 'count'), 0),
           'splitOut', coalesce(sum(m.portions) filter (where m.type::text = 'split'), 0),
           'remaining', coalesce(sum(m.portions), 0))
    into v_portions
    from public.batch_movement m
   where m.tenant_id = p_tenant and m.batch_id = b.id;

  select coalesce(jsonb_agg(x.j order by x.rn) filter (where x.rn <= v_max_plates), '[]'::jsonb), count(*)::integer
    into v_plates, v_plates_n
    from (
      select row_number() over (order by g.bd, g.name collate "C", g.menu_item_id) as rn,
             jsonb_build_object('businessDate', g.bd, 'menuItemId', g.menu_item_id, 'name', g.name, 'lines', g.lines, 'portions', g.portions,
                                'firstAt', app.iso_utc(g.first_at), 'lastAt', app.iso_utc(g.last_at), 'via', 'batch') as j
        from (
          select pl.bd, pl.menu_item_id, pl.name, count(*)::integer as lines, sum(pl.portions) as portions, min(pl.first_at) as first_at, max(pl.last_at) as last_at
            from (
              select app.business_date(p_tenant, m.created_at) as bd, ol.menu_item_id, mi.name, m.ref_id as line_id,
                     min(m.created_at) as first_at, max(m.created_at) as last_at, max(app.order_line_portions(ol.qty, ol.weight_g, ol.portion_weight_g)) as portions
                from public.batch_movement m
                join public.order_line ol on ol.tenant_id = p_tenant and ol.id = m.ref_id
                join public.menu_item mi on mi.tenant_id = ol.tenant_id and mi.id = ol.menu_item_id
               where m.tenant_id = p_tenant and m.batch_id = b.id and m.type::text = 'consume' and m.ref_type = 'order_line' and m.reverses_id is null
                 and not exists (select 1 from public.batch_movement r where r.tenant_id = m.tenant_id and r.reverses_id = m.id)
               group by 1, 2, 3, 4
            ) pl
           group by pl.bd, pl.menu_item_id, pl.name
        ) g
       order by g.bd, g.name collate "C", g.menu_item_id
       limit v_max_plates + 1
    ) x;

  return jsonb_build_object('batch', v_block, 'inputs', v_inputs, 'portions', v_portions, 'plates', v_plates, 'platesTruncated', v_plates_n > v_max_plates);
end
$$;

create function app.trace_line_search_json(p_tenant uuid, p_role text, p_date date, p_menu_item uuid, p_now timestamptz) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_max integer := (app.trace_constants() ->> 'TRACE_MAX_LINES')::integer;
  v_lines jsonb;
  v_found integer;
begin
  if p_date is null then
    raise exception 'query_invalid' using errcode = '22023';
  end if;
  if p_date > app.business_date(p_tenant, p_now) then
    raise exception 'date_in_future' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(x.j order by x.rn) filter (where x.rn <= v_max), '[]'::jsonb), count(*)::integer
    into v_lines, v_found
    from (
      select row_number() over (order by ol.fired_at, ol.id) as rn,
             jsonb_build_object(
               'lineId', ol.id,
               'menuItemName', mi.name,
               'tableName', ts.table_name,
               'firedAt', app.iso_utc(ol.fired_at),
               'portions', app.order_line_portions(ol.qty, ol.weight_g, ol.portion_weight_g),
               'weightG', ol.weight_g,
               'state', ol.state) as j
        from public.order_line ol
        join public.menu_item mi on mi.tenant_id = ol.tenant_id and mi.id = ol.menu_item_id
        join public.table_session ts on ts.tenant_id = ol.tenant_id and ts.id = ol.table_session_id
       where ol.tenant_id = p_tenant
         and ol.fired_at >= app.kpi_cutoff_end(p_tenant, p_date - 1) and ol.fired_at < app.kpi_cutoff_end(p_tenant, p_date)
         and (p_menu_item is null or ol.menu_item_id = p_menu_item)
       order by ol.fired_at, ol.id
       limit v_max + 1
    ) x;
  return jsonb_build_object('businessDate', p_date, 'lines', v_lines, 'truncated', v_found > v_max);
end
$$;

create function app.trace_line_json(p_tenant uuid, p_role text, p_line uuid) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  l public.order_line;
  v_line jsonb;
  v_batches jsonb;
  v_raw jsonb;
  v_lots jsonb;
begin
  select * into l from public.order_line x where x.tenant_id = p_tenant and x.id = p_line;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  select jsonb_build_object(
           'lineId', l.id,
           'menuItemName', mi.name,
           'tableName', ts.table_name,
           'businessDate', case when l.fired_at is not null then app.business_date(p_tenant, l.fired_at) else ts.business_date end,
           'firedAt', app.iso_utc(l.fired_at),
           'state', l.state,
           'portions', app.order_line_portions(l.qty, l.weight_g, l.portion_weight_g),
           'weightG', l.weight_g)
    into v_line
    from public.menu_item mi, public.table_session ts
   where mi.tenant_id = p_tenant and mi.id = l.menu_item_id and ts.tenant_id = p_tenant and ts.id = l.table_session_id;

  -- The batches the line took portions from: its consume rows, with whether a void reversed them.
  select coalesce(jsonb_agg(jsonb_build_object('batchId', y.id, 'lotCode', y.lot_code, 'recipeName', y.recipe_name, 'producedAt', app.iso_utc(y.produced_at),
                                               'portions', y.portions, 'reversed', y.reversed) order by y.produced_at, y.lot_code, y.id), '[]'::jsonb)
    into v_batches
    from (
      select b.id, b.lot_code, rc.name as recipe_name, b.produced_at, -sum(m.portions) as portions,
             bool_or(exists (select 1 from public.batch_movement r where r.tenant_id = m.tenant_id and r.reverses_id = m.id)) as reversed
        from public.batch_movement m
        join public.batch b on b.tenant_id = m.tenant_id and b.id = m.batch_id
        join public.recipe rc on rc.tenant_id = b.tenant_id and rc.id = b.recipe_id
       where m.tenant_id = p_tenant and m.type::text = 'consume' and m.ref_type = 'order_line' and m.ref_id = l.id and m.reverses_id is null
       group by b.id, b.lot_code, rc.name, b.produced_at
    ) y;

  -- The raw ingredients taken straight from stock by the plate.
  select coalesce(jsonb_agg(jsonb_build_object(
           'ingredient', jsonb_build_object('id', i.id, 'name', i.name),
           'qty', -m.qty,
           'unit', i.base_unit::text,
           'lot', case when rl.id is null then null::jsonb
                  else jsonb_build_object('lotId', rl.id, 'lotCode', rl.lot_code, 'expiry', rl.expiry, 'receivedOn', rl.received_on, 'supplier', jsonb_build_object('id', s.id, 'name', s.name))
                       || case when p_role in ('owner', 'admin')
                               then jsonb_build_object('invoice', jsonb_build_object('id', inv.id, 'number', inv.number_raw, 'date', inv.invoice_date))
                               else '{}'::jsonb end end)
           order by i.name collate "C", m.created_at, m.id), '[]'::jsonb)
    into v_raw
    from public.stock_movement m
    join public.ingredient i on i.tenant_id = m.tenant_id and i.id = m.ingredient_id
    left join public.raw_lot rl on rl.tenant_id = m.tenant_id and rl.id = m.raw_lot_id
    left join public.supplier s on s.tenant_id = rl.tenant_id and s.id = rl.supplier_id
    left join public.invoice_line il on il.tenant_id = rl.tenant_id and il.id = rl.invoice_line_id
    left join public.invoice inv on inv.tenant_id = il.tenant_id and inv.id = il.invoice_id
   where m.tenant_id = p_tenant and m.type::text = 'consumption' and m.ref_type = 'order_line' and m.ref_id = l.id and m.reverses_id is null;

  -- The distinct lots reached: the root inputs of every batch of the line, and the direct rows.
  select coalesce(jsonb_agg(jsonb_build_object('lotId', rl.id, 'lotCode', rl.lot_code, 'expiry', rl.expiry, 'receivedOn', rl.received_on,
                                               'ingredient', jsonb_build_object('id', i.id, 'name', i.name), 'supplier', jsonb_build_object('id', s.id, 'name', s.name))
                            || case when p_role in ('owner', 'admin')
                                    then jsonb_build_object('invoice', jsonb_build_object('id', inv.id, 'number', inv.number_raw, 'date', inv.invoice_date))
                                    else '{}'::jsonb end
                            order by i.name collate "C", rl.received_on, rl.id), '[]'::jsonb)
    into v_lots
    from public.raw_lot rl
    join public.ingredient i on i.tenant_id = rl.tenant_id and i.id = rl.ingredient_id
    join public.supplier s on s.tenant_id = rl.tenant_id and s.id = rl.supplier_id
    left join public.invoice_line il on il.tenant_id = rl.tenant_id and il.id = rl.invoice_line_id
    left join public.invoice inv on inv.tenant_id = il.tenant_id and inv.id = il.invoice_id
   where rl.tenant_id = p_tenant
     and rl.id in (
       select bi.raw_lot_id
         from public.batch_movement m
         join public.batch_input bi on bi.tenant_id = m.tenant_id and bi.batch_id = app.batch_root(m.tenant_id, m.batch_id)
        where m.tenant_id = p_tenant and m.type::text = 'consume' and m.ref_type = 'order_line' and m.ref_id = l.id and m.reverses_id is null and bi.raw_lot_id is not null
       union
       select m.raw_lot_id
         from public.stock_movement m
        where m.tenant_id = p_tenant and m.type::text = 'consumption' and m.ref_type = 'order_line' and m.ref_id = l.id and m.reverses_id is null and m.raw_lot_id is not null);

  return jsonb_build_object('line', v_line, 'batches', v_batches, 'rawDirect', v_raw, 'lots', v_lots);
end
$$;

create function public.trace_batch(p_batch uuid) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  perform app.require_trace_reader();
  return app.trace_batch_json(app.tenant_id(), app.role()::text, p_batch);
end
$$;

create function public.trace_order_line(p_line uuid) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  perform app.require_trace_reader();
  return app.trace_line_json(app.tenant_id(), app.role()::text, p_line);
end
$$;

create function public.trace_line_search(p_date date, p_menu_item uuid default null) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  perform app.require_trace_reader();
  return app.trace_line_search_json(app.tenant_id(), app.role()::text, p_date, p_menu_item, clock_timestamp());
end
$$;

revoke all on function app.trace_batch_json(uuid, text, uuid), app.trace_line_search_json(uuid, text, date, uuid, timestamptz), app.trace_line_json(uuid, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.trace_batch(uuid), public.trace_order_line(uuid), public.trace_line_search(date, uuid) from public, anon, authenticated, service_role;
grant execute on function public.trace_batch(uuid), public.trace_order_line(uuid), public.trace_line_search(date, uuid) to authenticated;
