-- P2-0b A4 (sell by weight, plan §3.1 D-7, §3.3, §5 A4): fire, frozen cost, the nightly invariant check and the forecast count a weighted line as
-- weight / reference portion weight portions (app.order_line_portions, unrounded) instead of its qty. A portion line is unchanged: its portions are its qty.
--
--   public.fire_course       the three places x.qty x need appear (the raw-stock lock list, the batch depletion and the raw outflow): nothing else
--   app.freeze_line_cost     the "needed but no row" filter and the non-stock cost use the portions; unit_cost_at_sale = total / qty (qty is 1 for a weighted line)
--   app.ledger_checks_body   fire_depletion compares the originals with round(portions x need, 4); every other check verbatim (still one statement)
--   app.forecast_portion_lines   the portion fraction instead of l.qty
-- The cost is frozen from the movements the depletion booked, so it is the same fraction. void_line is unchanged: it mirrors the rows as booked.

create or replace function public.fire_course(p_session uuid, p_body jsonb) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user uuid;
  v_arr jsonb;
  v_ids uuid[];
  v_n integer;
  v_now timestamptz;
  v_to_fire uuid[] := '{}';
  v_fired uuid[];
  v_skipped jsonb := '[]'::jsonb;
  v_ings uuid[] := '{}';
  v_keys uuid[] := '{}';
  v_locked uuid[];
  v_recipe uuid;
  v_unbooked uuid[];
  s public.table_session;
  x public.order_line;
  m public.menu_item;
  n record;
  d record;
begin
  perform app.require_table_operator();
  v_tenant := app.tenant_id();
  v_user := app.app_user_id();
  if p_session is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  perform app.menu_keys_ok(p_body, array['lineIds'], array['lineIds']);
  v_arr := p_body -> 'lineIds';
  if jsonb_typeof(v_arr) <> 'array' or jsonb_array_length(v_arr) not between 1 and 50 then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  v_ids := array(select app.order_uuid(e.value) from jsonb_array_elements(v_arr) e);
  if (select count(distinct u) from unnest(v_ids) u) <> cardinality(v_ids) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  -- Session FOR SHARE (a close takes it FOR UPDATE and waits for us), then the lines FOR UPDATE in id order.
  select z.* into s from public.table_session z where z.tenant_id = v_tenant and z.id = p_session for share;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  if s.closed_at is not null then
    raise exception 'session_closed' using errcode = 'P0001';
  end if;
  perform 1
    from public.order_line l
   where l.tenant_id = v_tenant and l.table_session_id = p_session and l.id = any (v_ids)
   order by l.id
     for update;
  get diagnostics v_n = row_count;
  if v_n <> cardinality(v_ids) then
    raise exception 'line_not_found' using errcode = 'P0002';
  end if;

  -- The lines as they are now (a new statement: an edit committed while we waited is what the kitchen cooks).
  for x in
    select l.* from public.order_line l where l.tenant_id = v_tenant and l.id = any (v_ids) order by l.id
  loop
    if x.voided_at is not null then
      v_skipped := v_skipped || jsonb_build_object('lineId', x.id, 'reason', 'voided');
    elsif x.fired_at is not null then
      v_skipped := v_skipped || jsonb_build_object('lineId', x.id, 'reason', 'already_fired');
    else
      v_to_fire := v_to_fire || x.id;
    end if;
  end loop;

  if cardinality(v_to_fire) > 0 then
    v_now := clock_timestamp();
    update public.order_line set fired_at = v_now, fired_by = v_user
     where tenant_id = v_tenant and id = any (v_to_fire);

    -- What every line needs, to take all the locks first (stock locks, then batch rows).
    for x in
      select l.* from public.order_line l where l.tenant_id = v_tenant and l.id = any (v_to_fire) order by l.id
    loop
      select i.* into m from public.menu_item i where i.tenant_id = v_tenant and i.id = x.menu_item_id;
      if m.recipe_key is not null then
        select r.id into v_recipe
          from public.recipe r
          join public.recipe_key k on k.tenant_id = r.tenant_id and k.id = r.recipe_key and k.current_version = r.version
         where r.tenant_id = v_tenant and r.recipe_key = m.recipe_key;
        v_keys := v_keys || array(select b.batch_key from app.plate_batch_needs(v_tenant, array[m.recipe_key]) b);
        v_ings := v_ings || array(
          select r.ingredient_id
            from app.plate_raw_needs(v_tenant, v_recipe) r
            join public.ingredient g on g.tenant_id = v_tenant and g.id = r.ingredient_id and g.is_stock
           where round(app.order_line_portions(x.qty, x.weight_g, x.portion_weight_g) * r.need, 4) > 0);
      end if;
    end loop;
    perform app.lock_ingredient_stock(v_tenant, v_ings);
    v_locked := app.lock_fire_batches(v_tenant, v_keys);

    -- Depletion and cost, line by line in id order.
    for x in
      select l.* from public.order_line l where l.tenant_id = v_tenant and l.id = any (v_to_fire) order by l.id
    loop
      select i.* into m from public.menu_item i where i.tenant_id = v_tenant and i.id = x.menu_item_id;
      v_recipe := null;
      v_unbooked := '{}';
      if m.recipe_key is not null then
        select r.id into v_recipe
          from public.recipe r
          join public.recipe_key k on k.tenant_id = r.tenant_id and k.id = r.recipe_key and k.current_version = r.version
         where r.tenant_id = v_tenant and r.recipe_key = m.recipe_key;
        for n in
          select b.batch_key, b.need from app.plate_batch_needs(v_tenant, array[m.recipe_key]) b order by b.batch_key
        loop
          for d in
            select * from app.deplete_line_batches(v_tenant, v_user, x.id, n.batch_key, round(app.order_line_portions(x.qty, x.weight_g, x.portion_weight_g) * n.need, 4), v_now, v_locked)
          loop
            if d.shortage and d.batch_id is null then
              v_unbooked := v_unbooked || n.batch_key;
            end if;
          end loop;
        end loop;
        for n in
          select r.ingredient_id, round(app.order_line_portions(x.qty, x.weight_g, x.portion_weight_g) * r.need, 4) as q
            from app.plate_raw_needs(v_tenant, v_recipe) r
            join public.ingredient g on g.tenant_id = v_tenant and g.id = r.ingredient_id and g.is_stock
           order by r.ingredient_id
        loop
          continue when n.q <= 0;
          perform app.post_plate_raw_outflow(v_tenant, v_user, n.ingredient_id, n.q, x.id, v_now);
        end loop;
      end if;
      perform app.freeze_line_cost(v_tenant, v_user, x.id, v_recipe, v_unbooked, v_now);
    end loop;
  end if;

  v_fired := v_to_fire;
  return jsonb_build_object(
    'lines', coalesce((
      select jsonb_agg(app.order_line_json(l) order by l.course, l.created_at, l.id)
        from public.order_line l
       where l.tenant_id = v_tenant and l.id = any (v_ids)), '[]'::jsonb),
    'fired', to_jsonb(coalesce(v_fired, '{}'::uuid[])),
    'skipped', v_skipped);
end
$$;

create or replace function app.freeze_line_cost(
  p_tenant uuid, p_user uuid, p_line uuid, p_recipe_id uuid, p_unbooked uuid[], p_at timestamptz
) returns public.order_line_cost
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_qty numeric;
  v_weight integer;
  v_portion integer;
  v_portions numeric;
  v_total numeric := 0;
  v_part numeric;
  v_missing_batches uuid[];
  v_missing_ings uuid[] := '{}';
  v_more uuid[];
  v_unbooked uuid[] := coalesce(p_unbooked, '{}');
  v_incomplete boolean;
  v_row public.order_line_cost;
begin
  select l.qty, l.weight_g, l.portion_weight_g into v_qty, v_weight, v_portion
    from public.order_line l where l.tenant_id = p_tenant and l.id = p_line;
  if not found then
    raise exception 'line_not_found' using errcode = 'P0002';
  end if;
  -- The portions the line stands for: its qty, or weight / reference portion weight for a weighted line (D-7).
  v_portions := app.order_line_portions(v_qty, v_weight, v_portion);

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
     where round(v_portions * n.need, 4) > 0
       and not exists (select 1 from public.stock_movement s
                        where s.tenant_id = p_tenant and s.type = 'consumption' and s.ref_type = 'order_line'
                          and s.ref_id = p_line and s.ingredient_id = n.ingredient_id and s.reverses_id is null);
    v_missing_ings := v_missing_ings || v_more;

    -- Non-stock ingredients (Sale) are costed, never depleted.
    select coalesce(sum(v_portions * n.need * c.unit_cost), 0),
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

create or replace function app.ledger_checks_body(p_tenant uuid, p_at timestamptz)
  returns table (check_key text, rows_count integer, sample_ids uuid[])
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
#variable_conflict use_column
begin
  return query
  with
  -- a lot without exactly one receipt that matches it (lot, ingredient, location, invoice line, quantity)
  lot_missing as (
    select l.id
      from public.raw_lot l
     where l.tenant_id = p_tenant
       and (select count(*)
              from public.stock_movement m
             where m.tenant_id = l.tenant_id and m.type::text = 'receipt' and m.raw_lot_id = l.id
               and m.ingredient_id = l.ingredient_id and m.location_id = l.location_id
               and m.ref_id = l.invoice_line_id and m.qty = l.qty_received) <> 1),
  -- a receipt whose lot is missing or differs
  receipt_bad as (
    select m.id
      from public.stock_movement m
     where m.tenant_id = p_tenant and m.type::text = 'receipt'
       and not exists (select 1 from public.raw_lot l
                        where l.tenant_id = m.tenant_id and l.id = m.raw_lot_id and l.ingredient_id = m.ingredient_id
                          and l.location_id = m.location_id and l.invoice_line_id = m.ref_id
                          and l.qty_received = m.qty)),
  -- every user reference must be a user of the same tenant (the foreign keys of the ledgers are not tenant-composite)
  user_bad as (
    select m.id from public.stock_movement m
     where m.tenant_id = p_tenant
       and not exists (select 1 from public.app_user u where u.id = m.created_by and u.tenant_id = m.tenant_id)
    union all
    select l.id from public.raw_lot l
     where l.tenant_id = p_tenant
       and not exists (select 1 from public.app_user u where u.id = l.created_by and u.tenant_id = l.tenant_id)
    union all
    select e.id from public.audit_event e
     where e.tenant_id = p_tenant
       and not exists (select 1 from public.app_user u where u.id = e.created_by and u.tenant_id = e.tenant_id)
    union all
    select c.id from public.count_session c
     where c.tenant_id = p_tenant
       and (not exists (select 1 from public.app_user u where u.id = c.started_by and u.tenant_id = c.tenant_id)
            or (c.closed_by is not null
                and not exists (select 1 from public.app_user u where u.id = c.closed_by and u.tenant_id = c.tenant_id))
            or (c.cancelled_by is not null
                and not exists (select 1 from public.app_user u where u.id = c.cancelled_by and u.tenant_id = c.tenant_id)))),
  -- a lot bucket (ingredient, location, lot) below zero
  lot_neg as (
    select b.raw_lot_id as id
      from (select m.raw_lot_id, m.ingredient_id, m.location_id, sum(m.qty) as q
              from public.stock_movement m
             where m.tenant_id = p_tenant and m.raw_lot_id is not null
             group by m.raw_lot_id, m.ingredient_id, m.location_id) b
     where b.q < 0),
  -- a reversal that does not mirror its original
  rev_bad as (
    select m.id
      from public.stock_movement m
      left join public.stock_movement o on o.tenant_id = m.tenant_id and o.id = m.reverses_id
     where m.tenant_id = p_tenant and m.reverses_id is not null
       and (o.id is null or o.reverses_id is not null or o.ingredient_id <> m.ingredient_id
            or o.location_id <> m.location_id or o.raw_lot_id is distinct from m.raw_lot_id or o.type <> m.type
            or o.reason_code is distinct from m.reason_code or o.unit_cost is distinct from m.unit_cost
            or o.qty <> -m.qty)),
  -- a transfer operation (reversals included) whose rows do not sum to zero, per ingredient
  transfer_bad as (
    select (array_agg(m.id order by m.id))[1] as id
      from public.stock_movement m
     where m.tenant_id = p_tenant and m.type::text = 'transfer'
     group by m.ref_type, m.ref_id, m.ingredient_id
    having sum(m.qty) <> 0),
  -- a closed line whose posted rows differ from counted minus expected (zero for an uncounted line), or a count row
  -- whose session is missing, at another location, not closed, or without a line for the ingredient
  count_bad as (
    select l.id
      from public.count_line l
      join public.count_session s on s.tenant_id = l.tenant_id and s.id = l.session_id
     where l.tenant_id = p_tenant and s.status = 'closed'
       and coalesce((select sum(m.qty) from public.stock_movement m
                      where m.tenant_id = l.tenant_id and m.type::text = 'count' and m.ref_type = 'count_session'
                        and m.ref_id = l.session_id and m.ingredient_id = l.ingredient_id
                        and m.location_id = s.location_id), 0)
           <> coalesce(l.counted_qty - l.expected_qty, 0)
    union all
    select m.id
      from public.stock_movement m
     where m.tenant_id = p_tenant and m.type::text = 'count' and m.ref_type = 'count_session'
       and not exists (select 1
                         from public.count_session s
                         join public.count_line l on l.tenant_id = s.tenant_id and l.session_id = s.id
                        where s.tenant_id = m.tenant_id and s.id = m.ref_id and s.status = 'closed'
                          and s.location_id = m.location_id and l.ingredient_id = m.ingredient_id)),
  -- a batch without exactly one origin movement (a produce for a root batch, the inbound split for a split part), or
  -- whose origin differs from the portions it was made with
  batch_origin_bad as (
    select b.id
      from public.batch b
     where b.tenant_id = p_tenant
       and ((select count(*)
               from public.batch_movement m
              where m.tenant_id = b.tenant_id and m.batch_id = b.id
                and (m.type::text = 'produce' or (m.type::text = 'split' and m.portions > 0))) <> 1
            or (select count(*)
                  from public.batch_movement m
                 where m.tenant_id = b.tenant_id and m.batch_id = b.id and m.portions = b.portions_initial
                   and ((b.split_from_batch_id is null and m.type::text = 'produce')
                        or (b.split_from_batch_id is not null and m.type::text = 'split' and m.ref_id = b.id))) <> 1)),
  -- one row per split operation with what it moved and between which batches
  split_ops as (
    select m.ref_id, count(*) as n, sum(m.portions) as s, (array_agg(m.id order by m.id))[1] as id,
           min(m.batch_id::text) filter (where m.portions < 0) as src,
           min(m.batch_id::text) filter (where m.portions > 0) as dst
      from public.batch_movement m
     where m.tenant_id = p_tenant and m.ref_type = 'batch_split'
     group by m.ref_id),
  -- a split operation that is not exactly two rows summing to zero from a parent to the child it names
  split_bad as (
    select o.id
      from split_ops o
     where o.n <> 2 or o.s <> 0 or o.dst is distinct from o.ref_id::text
        or not exists (select 1 from public.batch c
                        where c.tenant_id = p_tenant and c.id = o.ref_id and c.split_from_batch_id::text = o.src)),
  -- the cost of every fired line is frozen once, every consume row belongs to a fired line, and the consumed portions of a fired line
  -- equal what its plate version needs for each batch key that was booked
  fire_bad as (
    select l.id
      from public.order_line l
     where l.tenant_id = p_tenant and l.fired_at is not null
       and not exists (select 1 from public.order_line_cost c where c.tenant_id = l.tenant_id and c.order_line_id = l.id)
    union
    select m.id
      from public.batch_movement m
     where m.tenant_id = p_tenant and m.type::text = 'consume' and m.ref_type = 'order_line'
       and not exists (select 1 from public.order_line l
                        where l.tenant_id = m.tenant_id and l.id = m.ref_id and l.fired_at is not null)
    union
    select l.id
      from public.order_line l
      join public.order_line_cost c on c.tenant_id = l.tenant_id and c.order_line_id = l.id and c.recipe_id is not null
      cross join lateral (select rl.sub_recipe_key as batch_key, sum(rl.qty / rl.yield_factor) as need
                            from public.recipe_line rl
                            join public.recipe_key bk on bk.tenant_id = rl.tenant_id and bk.id = rl.sub_recipe_key and bk.type::text = 'batch'
                           where rl.tenant_id = l.tenant_id and rl.recipe_id = c.recipe_id
                           group by rl.sub_recipe_key) n
     where l.tenant_id = p_tenant and l.fired_at is not null and n.batch_key <> all (c.unbooked_batch_keys)
       and coalesce((select sum(-m.portions)
                       from public.batch_movement m
                       join public.batch b on b.tenant_id = m.tenant_id and b.id = m.batch_id
                      where m.tenant_id = l.tenant_id and m.type::text = 'consume' and m.ref_type = 'order_line'
                        and m.ref_id = l.id and m.reverses_id is null and b.recipe_key = n.batch_key), 0)
           <> round(app.order_line_portions(l.qty, l.weight_g, l.portion_weight_g) * n.need, 4)),
  -- the state must match the ledger (finished or discarded exactly when nothing is left) and a fresh batch is untouched
  state_bad as (
    select b.id
      from public.batch b
      cross join lateral (select coalesce(sum(m.portions), 0) as rem, count(*) as n
                            from public.batch_movement m
                           where m.tenant_id = b.tenant_id and m.batch_id = b.id) r
     where b.tenant_id = p_tenant
       and ((b.state::text in ('finished', 'discarded')) <> (r.rem <= 0)
            or (b.state::text = 'fresh' and r.n > 1)))
  select 'lot_receipt_missing'::text, count(*)::integer, (array_agg(x.id order by x.id))[1:5] from lot_missing x having count(*) > 0
  union all
  select 'receipt_lot_mismatch', count(*)::integer, (array_agg(x.id order by x.id))[1:5] from receipt_bad x having count(*) > 0
  union all
  select 'movement_user', count(*)::integer, (array_agg(x.id order by x.id))[1:5] from user_bad x having count(*) > 0
  union all
  select 'lot_negative', count(*)::integer, (array_agg(x.id order by x.id))[1:5] from lot_neg x having count(*) > 0
  union all
  select 'reversal_mirror', count(*)::integer, (array_agg(x.id order by x.id))[1:5] from rev_bad x having count(*) > 0
  union all
  select 'transfer_unbalanced', count(*)::integer, (array_agg(x.id order by x.id))[1:5] from transfer_bad x having count(*) > 0
  union all
  select 'count_mismatch', count(*)::integer, (array_agg(x.id order by x.id))[1:5] from count_bad x having count(*) > 0
  union all
  select 'batch_origin', count(*)::integer, (array_agg(x.id order by x.id))[1:5] from batch_origin_bad x having count(*) > 0
  union all
  select 'split_unbalanced', count(*)::integer, (array_agg(x.id order by x.id))[1:5] from split_bad x having count(*) > 0
  union all
  select 'batch_state', count(*)::integer, (array_agg(x.id order by x.id))[1:5] from state_bad x having count(*) > 0
  union all
  select 'fire_depletion', count(*)::integer, (array_agg(x.id order by x.id))[1:5] from fire_bad x having count(*) > 0;
end
$$;

create or replace function app.forecast_portion_lines(p_tenant uuid, p_dates date[]) returns table (business_date date, batch_key uuid, portions numeric)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select s.closed_business_date, rl.sub_recipe_key, sum(app.order_line_portions(l.qty, l.weight_g, l.portion_weight_g) * rl.qty / rl.yield_factor)
    from public.table_session s
    join public.order_line l on l.tenant_id = s.tenant_id and l.table_session_id = s.id
    join public.order_line_cost c on c.tenant_id = l.tenant_id and c.order_line_id = l.id and c.recipe_id is not null
    join public.recipe_line rl on rl.tenant_id = c.tenant_id and rl.recipe_id = c.recipe_id and rl.sub_recipe_key is not null
    join public.recipe_key bk on bk.tenant_id = rl.tenant_id and bk.id = rl.sub_recipe_key and bk.type::text = 'batch'
   where s.tenant_id = p_tenant and s.closed_at is not null
     and s.closed_business_date = any (p_dates)
     and l.voided_at is null
   group by s.closed_business_date, rl.sub_recipe_key
$$;

revoke all on function public.fire_course(uuid, jsonb), app.freeze_line_cost(uuid, uuid, uuid, uuid, uuid[], timestamptz),
  app.ledger_checks_body(uuid, timestamptz), app.forecast_portion_lines(uuid, date[])
  from public, anon, authenticated, service_role;
grant execute on function public.fire_course(uuid, jsonb) to authenticated;
