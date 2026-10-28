-- M19 step 2: the helpers behind fire_course and void_line (M19 plan §3.1.3-3.1.7, §3.2; ADR-019). All in schema app with
-- an empty search_path; none is executable by an API role.
--   order_void_reason_codes   the six coded void reasons (Q103); void_waste_reason maps each onto an existing waste code
--   plate_raw_needs           the raw ingredients of ONE plate version (top level + sub-recipes, batches skipped)
--   fire_batch_targets        the batches a fire may touch: the live ones of each key plus the shortage fallback
--   lock_fire_batches         FOR UPDATE on those batches, in id order (lock order: stock locks -> batch rows)
--   deplete_line_batches      FEFO depletion of one batch key for one line; a shortage is booked and alerted, never refused
--   post_plate_raw_outflow    raw stock of a plate: pure FEFO across the active locations through the M12 engine
--   freeze_line_cost          the cost of a fired line, frozen in order_line_cost (unknown is never zero)
-- Every column reference below is qualified: the RETURNS TABLE names are variables inside plpgsql.

-- ---------------------------------------------------------------------------------------------------------------------
create function app.order_void_reason_codes() returns text[]
  language sql immutable
  set search_path = ''
as $$
  select array['order_error', 'customer_changed', 'kitchen_error', 'returned', 'comp', 'breakage']
$$;

-- The waste code a void after firing writes (both app.batch_waste_reason_codes() and app.stock_reason_codes() contain
-- every result). null for anything else; entry_removed is M18's internal reason and is not a void reason.
create function app.void_waste_reason(p_reason text) returns text
  language sql immutable
  set search_path = ''
as $$
  select case p_reason
    when 'order_error' then 'plating_error'
    when 'customer_changed' then 'over_production'
    when 'kitchen_error' then 'plating_error'
    when 'returned' then 'plating_error'
    when 'comp' then 'comp'
    when 'breakage' then 'breakage'
  end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- The raw ingredients of ONE plate version, in each ingredient's base unit, unrounded: the version's top-level
-- ingredient lines (qty x unit factor / yield) plus the ingredient lines of its sub-recipes, expanded with the version
-- in force (the current one), scaled by (line qty x factor / yield) / sub output. Batch-type sub keys at the top level are
-- skipped: they are portions (consumed at production, depleted as portions). The algorithm of app.batch_requirements:
-- one row per sub key per round with the summed factor of every path, so a diamond graph is not enumerated; the plate is
-- depth 1 and a sub first reached at depth 13 fails closed (graph_too_deep), as does a missing version.
create function app.plate_raw_needs(p_tenant uuid, p_recipe_id uuid)
  returns table (ingredient_id uuid, need numeric)
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_rows jsonb;
  v_acc jsonb := '{}';
  v_add jsonb;
  v_front jsonb;
  v_missing boolean;
  v_depth integer := 1;
begin
  perform 1 from public.recipe r where r.tenant_id = p_tenant and r.id = p_recipe_id;
  if not found then
    raise exception 'recipe_not_found' using errcode = 'P0002';
  end if;
  v_rows := jsonb_build_array(jsonb_build_object('f', 1, 'rid', p_recipe_id));
  loop
    select coalesce(jsonb_object_agg(x.ing, x.q), '{}'::jsonb) into v_add
      from (select l.ingredient_id::text as ing,
                   sum((e.value ->> 'f')::numeric * l.qty * app.recipe_unit_factor(l.unit) / l.yield_factor) as q
              from jsonb_array_elements(v_rows) e
              join public.recipe_line l
                on l.tenant_id = p_tenant and l.recipe_id = (e.value ->> 'rid')::uuid
               and l.ingredient_id is not null
             group by l.ingredient_id) x;
    select coalesce(jsonb_object_agg(u.k, u.q), '{}'::jsonb) into v_acc
      from (select s.key as k, sum(s.value::numeric) as q
              from (select * from jsonb_each_text(v_acc) union all select * from jsonb_each_text(v_add)) s
             group by s.key) u;

    select coalesce(jsonb_agg(jsonb_build_object('f', x.f, 'rid', x.rid)), '[]'::jsonb), coalesce(bool_or(x.rid is null), false)
      into v_front, v_missing
      from (select l.sub_recipe_key,
                   sum((e.value ->> 'f')::numeric * l.qty * app.recipe_unit_factor(l.unit) / l.yield_factor
                       / so.output_qty) as f,
                   app.recipe_in_force(p_tenant, l.sub_recipe_key, null) as rid
              from jsonb_array_elements(v_rows) e
              join public.recipe_line l
                on l.tenant_id = p_tenant and l.recipe_id = (e.value ->> 'rid')::uuid
               and l.sub_recipe_key is not null
              join public.recipe_key sk
                on sk.tenant_id = p_tenant and sk.id = l.sub_recipe_key and sk.type = 'sub'
              left join public.recipe so
                on so.tenant_id = p_tenant and so.id = app.recipe_in_force(p_tenant, l.sub_recipe_key, null)
             group by l.sub_recipe_key) x;
    exit when jsonb_array_length(v_front) = 0;
    if v_missing then
      raise exception 'recipe_not_producible' using errcode = 'P0001', detail = 'sub_not_in_force';
    end if;
    v_depth := v_depth + 1;
    if v_depth > 12 then
      raise exception 'recipe_not_producible' using errcode = 'P0001', detail = 'graph_too_deep';
    end if;
    v_rows := v_front;
  end loop;

  return query
  select a.key::uuid, a.value::numeric
    from jsonb_each_text(v_acc) a
   order by a.key;
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- The batches a fire may touch for some keys: the live ones (fresh or open, use_by after now(): the same "live" as M18's
-- availability) and, per key, the fallback a shortage is booked on when no batch is live: the most recently produced batch
-- that is not discarded, else the most recently produced one. No locks.
create function app.fire_batch_targets(p_tenant uuid, p_keys uuid[]) returns table (batch_id uuid)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select b.id
    from public.batch b
   where b.tenant_id = p_tenant and b.recipe_key = any (p_keys) and b.state in ('fresh', 'open') and b.use_by > now()
  union
  select (select f.id
            from public.batch f
           where f.tenant_id = p_tenant and f.recipe_key = k.key
           order by (f.state = 'discarded'), f.produced_at desc, f.id desc
           limit 1)
    from unnest(p_keys) k (key)
$$;

-- FOR UPDATE on the targets, in id order; the number of rows locked. A fire waits for a discard or another fire here, and
-- an add (FOR SHARE, M18) waits for the fire.
create function app.lock_fire_batches(p_tenant uuid, p_keys uuid[]) returns integer
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_n integer;
begin
  perform 1
    from public.batch b
   where b.tenant_id = p_tenant and b.id in (select t.batch_id from app.fire_batch_targets(p_tenant, p_keys) t)
   order by b.id
     for update;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- FEFO depletion of one batch key for one line. The caller holds the batch row locks (lock_fire_batches); candidates and
-- balances are read in new statements, after the locks. Take min(left, remaining) from each live batch in use_by,
-- produced_at, id order, one consume movement per slice. What the live batches cannot cover is the shortage: booked on the
-- target (the last live batch, else the fallback of fire_batch_targets) as one more consume row, which may take it below
-- zero; with no batch of the key at all nothing is booked and one row with a null batch says so. A shortage raises the
-- negative_stock alert (entity recipe_key) in a contained block: whatever happens there, the movements stay. Every touched
-- batch is settled (finished at or below zero). Rows returned: batch, movement, the positive portions taken, shortage.
create function app.deplete_line_batches(
  p_tenant uuid, p_user uuid, p_line uuid, p_key uuid, p_portions numeric, p_at timestamptz
) returns table (batch_id uuid, movement_id uuid, portions numeric, shortage boolean)
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_left numeric := round(p_portions, 4);
  v_short numeric;
  v_tz text;
  v_date date;
  v_rem numeric;
  v_slice numeric;
  v_id uuid;
  v_target uuid;
  v_short_mv uuid;
  v_after numeric := 0;
  v_touched uuid[] := '{}';
  v_t uuid;
  c record;
begin
  if v_left is null or v_left <= 0 then
    raise exception 'qty_invalid' using errcode = 'P0001';
  end if;
  select t.timezone into v_tz from public.tenant t where t.id = p_tenant;
  v_date := app.venue_date(p_at, v_tz);

  for c in
    select b.id
      from public.batch b
     where b.tenant_id = p_tenant and b.recipe_key = p_key and b.state in ('fresh', 'open') and b.use_by > p_at
     order by b.use_by, b.produced_at, b.id
  loop
    v_target := c.id;
    v_rem := app.batch_remaining(p_tenant, c.id);
    continue when v_rem <= 0;
    v_slice := least(v_left, v_rem);
    insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
      values (p_tenant, c.id, 'consume', -v_slice, 'order_line', p_line, v_date, p_user)
      returning id into v_id;
    v_left := v_left - v_slice;
    v_touched := v_touched || c.id;
    batch_id := c.id; movement_id := v_id; portions := v_slice; shortage := false;
    return next;
    exit when v_left <= 0;
  end loop;

  if v_left > 0 then
    v_short := v_left;
    if v_target is null then
      select f.id into v_target
        from public.batch f
       where f.tenant_id = p_tenant and f.recipe_key = p_key
       order by (f.state = 'discarded'), f.produced_at desc, f.id desc
       limit 1;
    end if;
    if v_target is not null then
      insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
        values (p_tenant, v_target, 'consume', -v_short, 'order_line', p_line, v_date, p_user)
        returning id into v_short_mv;
      v_touched := v_touched || v_target;
    end if;
    batch_id := v_target; movement_id := v_short_mv; portions := v_short; shortage := true;
    return next;
  end if;

  foreach v_t in array (select coalesce(array_agg(distinct x order by x), '{}') from unnest(v_touched) x) loop
    perform app.batch_settle_state(p_tenant, v_t, 'consume');
  end loop;

  if v_short is not null then
    if v_target is not null then
      v_after := app.batch_remaining(p_tenant, v_target);
    end if;
    begin
      perform app.try_raise_alert(p_tenant, 'negative_stock', 'recipe_key', p_key,
        jsonb_build_object('recipe_key', p_key, 'batch_id', v_target, 'remaining_portions_qty', trim_scale(v_after),
                           'short_portions_qty', trim_scale(v_short), 'order_line_id', p_line,
                           'movement_id', v_short_mv),
        null, null, p_at, null, 'fire_course');
    exception when others then
      perform app.record_alert_refusal(p_tenant, 'negative_stock', 'recipe_key', p_key, 'fire_course',
                                       'check_failed', sqlstate);
    end;
  end if;
  return;
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Raw stock of a plate (decision 5, Q100): pure FEFO across the active locations through the unchanged M12 engine.
-- 1. the positive lotted buckets in every active location by lot expiry (no expiry last), received_on, lot id: one engine
--    call per bucket with the lot override, taking exactly min(left, bucket);
-- 2. the positive unlotted buckets by location id (every lot is empty by then, so the engine reaches the unlotted bucket);
-- 3. a remainder: one engine call without a lot at the shortfall location: the location of the last bucket used, else that
--    of the ingredient's most recent movement (active locations only), else the lowest-id active location. The engine
--    writes the unlotted negative row and raises its own contained negative_stock alert (entity ingredient).
-- No active location: no row (the cost then lists the ingredient as missing). The caller normally holds the stock lock;
-- it is re-entrant, and taking it here makes a standalone call safe too.
create function app.post_plate_raw_outflow(
  p_tenant uuid, p_user uuid, p_ingredient uuid, p_qty numeric, p_line uuid, p_at timestamptz
) returns table (movement_id uuid, location_id uuid, raw_lot_id uuid, qty numeric)
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_left numeric := p_qty;
  v_slice numeric;
  v_last_loc uuid;
  v_loc uuid;
  b record;
  r record;
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'qty_invalid' using errcode = 'P0001';
  end if;
  perform app.lock_ingredient_stock(p_tenant, array[p_ingredient]);

  for b in
    select m.location_id as loc, m.raw_lot_id as lot, sum(m.qty) as bucket
      from public.stock_movement m
      join public.location l on l.tenant_id = m.tenant_id and l.id = m.location_id and l.is_active
      join public.raw_lot rl on rl.tenant_id = m.tenant_id and rl.id = m.raw_lot_id
     where m.tenant_id = p_tenant and m.ingredient_id = p_ingredient
     group by m.location_id, m.raw_lot_id, rl.expiry, rl.received_on
    having sum(m.qty) > 0
     order by rl.expiry asc nulls last, rl.received_on asc, m.raw_lot_id asc
  loop
    exit when v_left <= 0;
    v_slice := least(v_left, b.bucket);
    for r in
      select o.movement_id as mv, o.raw_lot_id as lot, o.qty as q
        from app.post_stock_outflow(p_tenant, p_user, p_ingredient, b.loc, v_slice, 'consumption', null, b.lot,
                                    'order_line', p_line, p_at, p_at, 'fire_course') o
    loop
      movement_id := r.mv; location_id := b.loc; raw_lot_id := r.lot; qty := r.q;
      return next;
    end loop;
    v_left := v_left - v_slice;
    v_last_loc := b.loc;
  end loop;

  if v_left > 0 then
    for b in
      select m.location_id as loc, sum(m.qty) as bucket
        from public.stock_movement m
        join public.location l on l.tenant_id = m.tenant_id and l.id = m.location_id and l.is_active
       where m.tenant_id = p_tenant and m.ingredient_id = p_ingredient and m.raw_lot_id is null
       group by m.location_id
      having sum(m.qty) > 0
       order by m.location_id
    loop
      exit when v_left <= 0;
      v_slice := least(v_left, b.bucket);
      for r in
        select o.movement_id as mv, o.raw_lot_id as lot, o.qty as q
          from app.post_stock_outflow(p_tenant, p_user, p_ingredient, b.loc, v_slice, 'consumption', null, null,
                                      'order_line', p_line, p_at, p_at, 'fire_course') o
      loop
        movement_id := r.mv; location_id := b.loc; raw_lot_id := r.lot; qty := r.q;
        return next;
      end loop;
      v_left := v_left - v_slice;
      v_last_loc := b.loc;
    end loop;
  end if;

  if v_left > 0 then
    v_loc := v_last_loc;
    if v_loc is null then
      select m.location_id into v_loc
        from public.stock_movement m
        join public.location l on l.tenant_id = m.tenant_id and l.id = m.location_id and l.is_active
       where m.tenant_id = p_tenant and m.ingredient_id = p_ingredient
       order by m.created_at desc, m.id desc
       limit 1;
    end if;
    if v_loc is null then
      select l.id into v_loc
        from public.location l
       where l.tenant_id = p_tenant and l.is_active
       order by l.id
       limit 1;
    end if;
    if v_loc is not null then
      for r in
        select o.movement_id as mv, o.raw_lot_id as lot, o.qty as q
          from app.post_stock_outflow(p_tenant, p_user, p_ingredient, v_loc, v_left, 'consumption', null, null,
                                      'order_line', p_line, p_at, p_at, 'fire_course') o
      loop
        movement_id := r.mv; location_id := v_loc; raw_lot_id := r.lot; qty := r.q;
        return next;
      end loop;
    end if;
  end if;
  return;
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- The cost of a fired line, frozen in order_line_cost (append-only). total = the line's consume movements x the batch's
-- frozen unit cost + its consumption stock rows x their unit_cost + the non-stock needs x the ingredient's basis at p_at,
-- rounded to 4 decimals; unit_cost_at_sale = total / qty (per full plate). Unknown is never zero: an unmapped item
-- (p_recipe_id null), a batch of unknown cost, an unpriced row, a needed stock ingredient with no row at all, an
-- unpriced non-stock ingredient or an unbooked batch key make the row incomplete with null totals and the lists filled.
create function app.freeze_line_cost(
  p_tenant uuid, p_user uuid, p_line uuid, p_recipe_id uuid, p_unbooked uuid[], p_at timestamptz
) returns public.order_line_cost
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_qty numeric;
  v_total numeric := 0;
  v_part numeric;
  v_missing_batches uuid[];
  v_missing_ings uuid[] := '{}';
  v_more uuid[];
  v_unbooked uuid[] := coalesce(p_unbooked, '{}');
  v_incomplete boolean;
  v_row public.order_line_cost;
begin
  select l.qty into v_qty from public.order_line l where l.tenant_id = p_tenant and l.id = p_line;
  if not found then
    raise exception 'line_not_found' using errcode = 'P0002';
  end if;

  select coalesce(sum(-m.portions * c.unit_cost_frozen), 0),
         coalesce(array_agg(distinct m.batch_id) filter (where c.unit_cost_frozen is null), '{}')
    into v_part, v_missing_batches
    from public.batch_movement m
    left join public.batch_cost c on c.tenant_id = m.tenant_id and c.batch_id = m.batch_id
   where m.tenant_id = p_tenant and m.type = 'consume' and m.ref_type = 'order_line' and m.ref_id = p_line
     and m.reverses_id is null;
  v_total := v_total + v_part;

  select coalesce(sum(-s.qty * s.unit_cost), 0),
         coalesce(array_agg(distinct s.ingredient_id) filter (where s.unit_cost is null), '{}')
    into v_part, v_missing_ings
    from public.stock_movement s
   where s.tenant_id = p_tenant and s.type = 'consumption' and s.ref_type = 'order_line' and s.ref_id = p_line
     and s.reverses_id is null;
  v_total := v_total + v_part;

  if p_recipe_id is not null then
    -- A needed stock ingredient with no consumption row at all (no active location) is unknown, not free.
    select coalesce(array_agg(n.ingredient_id), '{}') into v_more
      from app.plate_raw_needs(p_tenant, p_recipe_id) n
      join public.ingredient i on i.tenant_id = p_tenant and i.id = n.ingredient_id and i.is_stock
     where round(v_qty * n.need, 4) > 0
       and not exists (select 1 from public.stock_movement s
                        where s.tenant_id = p_tenant and s.type = 'consumption' and s.ref_type = 'order_line'
                          and s.ref_id = p_line and s.ingredient_id = n.ingredient_id and s.reverses_id is null);
    v_missing_ings := v_missing_ings || v_more;

    -- Non-stock ingredients (Sale) are costed, never depleted.
    select coalesce(sum(v_qty * n.need * c.unit_cost), 0),
           coalesce(array_agg(n.ingredient_id) filter (where c.unit_cost is null), '{}')
      into v_part, v_more
      from app.plate_raw_needs(p_tenant, p_recipe_id) n
      join public.ingredient i on i.tenant_id = p_tenant and i.id = n.ingredient_id and not i.is_stock
      left join app.ingredient_unit_costs(p_tenant, array[n.ingredient_id], p_at) c on c.ingredient_id = n.ingredient_id;
    v_total := v_total + v_part;
    v_missing_ings := v_missing_ings || v_more;
  end if;

  select coalesce(array_agg(distinct x order by x), '{}') into v_missing_ings from unnest(v_missing_ings) x;
  v_incomplete := p_recipe_id is null
    or cardinality(v_missing_ings) + cardinality(v_missing_batches) + cardinality(v_unbooked) > 0;

  insert into public.order_line_cost (order_line_id, tenant_id, recipe_id, total_cost, unit_cost_at_sale, incomplete,
      missing_ingredient_ids, missing_batch_ids, unbooked_batch_keys, cost_at, created_by)
    values (p_line, p_tenant, p_recipe_id,
      case when v_incomplete then null else round(v_total, 4) end,
      case when v_incomplete then null else round(round(v_total, 4) / v_qty, 4) end,
      v_incomplete, v_missing_ings, v_missing_batches, v_unbooked, p_at, p_user)
    returning * into v_row;
  return v_row;
end
$$;

revoke all on function
  app.order_void_reason_codes(), app.void_waste_reason(text), app.plate_raw_needs(uuid, uuid),
  app.fire_batch_targets(uuid, uuid[]), app.lock_fire_batches(uuid, uuid[]),
  app.deplete_line_batches(uuid, uuid, uuid, uuid, numeric, timestamptz),
  app.post_plate_raw_outflow(uuid, uuid, uuid, numeric, uuid, timestamptz),
  app.freeze_line_cost(uuid, uuid, uuid, uuid, uuid[], timestamptz)
  from public, anon, authenticated, service_role;
