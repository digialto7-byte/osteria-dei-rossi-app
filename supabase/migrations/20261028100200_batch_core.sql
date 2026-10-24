-- M14 step 3: the production core (M14 plan §3.1.1, §3.1.5-7, §3.1.9, §3.1.11, §3.2; ADR-013).
-- Role helpers, the lot lock and sequence, and app.produce_batch_core: one function = one transaction. It
-- validates everything before any lock or write, takes every input's stock lock in one sorted call, consumes the
-- confirmed inputs through the M12 engine (ref_type 'batch', ref_id = a pre-generated batch id), then writes the
-- batch with its lot code, one batch_input per consumption movement, the frozen batch_cost and the 'produce'
-- movement. Any error rolls back all of it, the contained negative_stock alert included.
-- Everything is in schema app and closed to every API role: the public procedures of the next migration are the
-- only way in.
--
-- Global lock order (extends M12): recipe graph (shared) -> ingredient cost locks -> ingredient stock locks (id
-- order) -> batch lot lock. produce_batch takes neither of the first two: recipe rows are immutable and the batch
-- pins the version, the requirement expansion is one statement, and the cost is read once per ingredient. M13's
-- close_count and M15's procedures must take any stock locks before the lot lock.

-- Roles: owner, admin and chef (M12 Q1, founder 2026-10-23); never the waiter. Kept apart from the stock helpers
-- so that a change of who produces cannot silently change who records waste.
create function app.require_batch_writer() returns void
  language plpgsql stable
  set search_path = ''
as $$
begin
  if app.role() is null or app.role()::text not in ('owner', 'admin', 'chef') then
    raise exception 'permission denied: production needs owner, admin or chef' using errcode = '42501';
  end if;
end
$$;

create function app.require_batch_reader() returns void
  language plpgsql stable
  set search_path = ''
as $$
begin
  if app.role() is null or app.role()::text not in ('owner', 'admin', 'chef') then
    raise exception 'permission denied: batches need owner, admin or chef' using errcode = '42501';
  end if;
end
$$;

-- One transaction advisory lock per (tenant, Rome day, printed recipe code): the lot sequence counter. Taken
-- after the stock locks. A hash collision only adds a wait.
create function app.lock_batch_lot(p_tenant uuid, p_date date, p_code text) returns void
  language plpgsql
  set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('batch_lot'), hashtext(p_tenant::text || p_date::text || p_code));
end
$$;

-- The next sequence of a printed code on a day: 1 + the highest among the tenant's batches. The counter is keyed
-- by the printed code, so two recipes whose names share their first 6 characters never print the same lot code.
-- VOLATILE on purpose: a stable function would read the snapshot of the calling query, not what the previous
-- holder of the lot lock committed (plan T2). The unique (tenant_id, lot_code) is the backstop.
create function app.next_lot_seq(p_tenant uuid, p_date date, p_code text) returns integer
  language sql
  volatile
  security definer
  set search_path = ''
as $$
  select coalesce(max(b.lot_seq), 0) + 1
    from public.batch b
   where b.tenant_id = p_tenant and b.lot_date = p_date and b.lot_recipe_code = p_code
$$;

-- The production. p_inputs: [{ingredientId, qty, unit, locationId?, lotId?}], one per stock ingredient of the
-- recipe's requirements (qty 0 = not used). Input errors carry detail '[{"ingredientId": ...}]'. Returns the batch
-- (no cost key anywhere: the chef reads this answer).
create function app.produce_batch_core(
  p_tenant uuid, p_user uuid, p_recipe_id uuid, p_output_qty numeric, p_inputs jsonb, p_portions integer,
  p_shelf_life_hours integer, p_location uuid, p_at timestamptz
) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_name text;
  v_version integer;
  v_key uuid;
  v_type public.recipe_type;
  v_active boolean;
  v_current integer;
  v_recipe_out numeric;
  v_unit public.base_unit;
  v_ppb integer;
  v_recipe_shelf integer;
  v_computed integer;
  v_portions integer;
  v_shelf integer;
  v_batch_loc uuid;
  v_elem jsonb;
  v_norm jsonb := '[]';
  v_req jsonb;
  v_ids text[];
  v_bad text[];
  v_base numeric;
  v_loc uuid;
  v_in jsonb;
  v_rows jsonb := '[]';
  v_row jsonb;
  v_out record;
  v_batch uuid := gen_random_uuid();
  v_tz text;
  v_date date;
  v_code text;
  v_seq integer;
  v_use_by timestamptz;
  v_msg text;
  v_detail text;
  v_total numeric;
  v_missing uuid[];
  v_inputs jsonb;
  v_negatives jsonb;
begin
  -- 1. The recipe version: a batch recipe, active, and the version in force.
  select r.name, r.version, r.recipe_key, k.type, k.is_active, k.current_version, r.output_qty, r.output_unit,
         r.portions_per_batch, r.shelf_life_hours
    into v_name, v_version, v_key, v_type, v_active, v_current, v_recipe_out, v_unit, v_ppb, v_recipe_shelf
    from public.recipe r
    join public.recipe_key k on k.tenant_id = r.tenant_id and k.id = r.recipe_key
   where r.tenant_id = p_tenant and r.id = p_recipe_id;
  if not found then
    raise exception 'recipe_not_found' using errcode = 'P0002';
  end if;
  if v_type <> 'batch' then
    raise exception 'recipe_not_batch' using errcode = 'P0001';
  end if;
  if not v_active then
    raise exception 'recipe_inactive' using errcode = 'P0001';
  end if;
  if v_version <> v_current then
    raise exception 'recipe_version_stale' using errcode = 'P0001';
  end if;

  -- 2. The output: positive, at most 100 000, at most 4 decimals.
  if p_output_qty is null or p_output_qty <= 0 or p_output_qty > 100000 or round(p_output_qty, 4) <> p_output_qty then
    raise exception 'output_invalid' using errcode = 'P0001';
  end if;

  -- 3. The shelf life: the recipe's, or the chef's value for this batch.
  v_shelf := coalesce(p_shelf_life_hours, v_recipe_shelf);
  if v_shelf < 1 or v_shelf > 8760 then
    raise exception 'shelf_life_invalid' using errcode = 'P0001';
  end if;

  -- 4. The portions: computed (rounded down), changeable by the chef. An output so far from the recipe that the
  -- computed figure leaves the 0..10 000 range is an output error.
  if floor(p_output_qty * v_ppb / v_recipe_out) > 10000 then
    raise exception 'output_invalid' using errcode = 'P0001';
  end if;
  v_computed := app.batch_portions(p_output_qty, v_recipe_out, v_ppb);
  v_portions := coalesce(p_portions, v_computed);
  if v_portions < 1 or v_portions > 10000 then
    raise exception 'portions_invalid' using errcode = 'P0001';
  end if;

  -- 5. Where the batch is stored.
  v_batch_loc := app.resolve_location(p_tenant, p_location);

  -- 6. The inputs, all checked before any lock or write.
  if p_inputs is null or jsonb_typeof(p_inputs) <> 'array' or jsonb_array_length(p_inputs) not between 1 and 100 then
    raise exception 'inputs_invalid' using errcode = 'P0001';
  end if;
  for v_elem in select e.value from jsonb_array_elements(p_inputs) e loop
    -- A CASE keeps the order of the tests; any NULL (a missing key) counts as invalid.
    if coalesce(case when jsonb_typeof(v_elem) <> 'object' then true
         else exists (select 1 from jsonb_object_keys(v_elem) k
                       where k <> all (array['ingredientId', 'qty', 'unit', 'locationId', 'lotId']))
              or not (v_elem ?& array['ingredientId', 'qty', 'unit'])
              or jsonb_typeof(v_elem -> 'ingredientId') <> 'string'
              or (v_elem ->> 'ingredientId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              or jsonb_typeof(v_elem -> 'qty') <> 'number'
              or jsonb_typeof(v_elem -> 'unit') <> 'string'
              or jsonb_typeof(coalesce(v_elem -> 'locationId', 'null'::jsonb)) not in ('null', 'string')
              or jsonb_typeof(coalesce(v_elem -> 'lotId', 'null'::jsonb)) not in ('null', 'string')
              or coalesce(v_elem ->> 'locationId', '00000000-0000-0000-0000-000000000000')
                   !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              or coalesce(v_elem ->> 'lotId', '00000000-0000-0000-0000-000000000000')
                   !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         end, true)
    then
      raise exception 'inputs_invalid' using errcode = 'P0001';
    end if;
    v_norm := v_norm || jsonb_build_object('i', lower(v_elem ->> 'ingredientId'), 'q', (v_elem ->> 'qty')::numeric,
      'u', v_elem ->> 'unit', 'l', v_elem ->> 'locationId', 'o', v_elem ->> 'lotId');
  end loop;

  -- The same ingredient twice (plan Q45 default: one location per ingredient).
  select array_agg(x.i order by x.i) into v_bad
    from (select e.value ->> 'i' as i from jsonb_array_elements(v_norm) e group by 1 having count(*) > 1) x;
  if v_bad is not null then
    raise exception 'input_duplicate' using errcode = 'P0001', detail = (
      select jsonb_agg(jsonb_build_object('ingredientId', b))::text from unnest(v_bad) b);
  end if;

  -- The requirements of one batch, with whether each ingredient is in stock.
  select coalesce(jsonb_object_agg(q.ingredient_id::text, i.is_stock), '{}'::jsonb) into v_req
    from app.batch_requirements(p_tenant, p_recipe_id, p_at) q
    join public.ingredient i on i.tenant_id = p_tenant and i.id = q.ingredient_id;

  -- Nothing outside the recipe (Q42 default), and no non-stock ingredient.
  select array_agg(x.i order by x.i) into v_bad
    from (select e.value ->> 'i' as i from jsonb_array_elements(v_norm) e where not (v_req ? (e.value ->> 'i'))) x;
  if v_bad is not null then
    raise exception 'input_not_in_recipe' using errcode = 'P0001', detail = (
      select jsonb_agg(jsonb_build_object('ingredientId', b))::text from unnest(v_bad) b);
  end if;
  select array_agg(x.i order by x.i) into v_bad
    from (select e.value ->> 'i' as i from jsonb_array_elements(v_norm) e where not (v_req ->> (e.value ->> 'i'))::boolean) x;
  if v_bad is not null then
    raise exception 'ingredient_not_stock' using errcode = 'P0001', detail = (
      select jsonb_agg(jsonb_build_object('ingredientId', b))::text from unnest(v_bad) b);
  end if;

  -- Every stock ingredient of the recipe appears.
  select array_agg(r.key order by r.key) into v_bad
    from jsonb_each_text(v_req) r
   where r.value::boolean and not exists (select 1 from jsonb_array_elements(v_norm) e where e.value ->> 'i' = r.key);
  if v_bad is not null then
    raise exception 'input_missing' using errcode = 'P0001', detail = (
      select jsonb_agg(jsonb_build_object('ingredientId', b))::text from unnest(v_bad) b);
  end if;

  if not exists (select 1 from jsonb_array_elements(v_norm) e where (e.value ->> 'q')::numeric > 0)
     and not exists (select 1 from jsonb_array_elements(v_norm) e where (e.value ->> 'q')::numeric < 0) then
    raise exception 'inputs_empty' using errcode = 'P0001';
  end if;

  -- Quantities in base units and locations, in ingredient-id order; the first error names its ingredient.
  v_ids := '{}';
  for v_in in select e.value from jsonb_array_elements(v_norm) e order by e.value ->> 'i' loop
    v_detail := jsonb_build_array(jsonb_build_object('ingredientId', v_in ->> 'i'))::text;
    if (v_in ->> 'q')::numeric < 0 then
      raise exception 'qty_invalid' using errcode = 'P0001', detail = v_detail;
    end if;
    continue when (v_in ->> 'q')::numeric = 0;
    begin
      v_base := app.stock_qty_base(p_tenant, (v_in ->> 'i')::uuid, (v_in ->> 'q')::numeric, v_in ->> 'u');
      v_loc := app.resolve_location(p_tenant, (v_in ->> 'l')::uuid);
    exception when others then
      get stacked diagnostics v_msg = message_text;
      raise exception '%', v_msg using errcode = sqlstate, detail = v_detail;
    end;
    v_ids := v_ids || (v_in ->> 'i');
    v_rows := v_rows || jsonb_build_object('i', v_in ->> 'i', 'b', v_base, 'loc', v_loc, 'o', v_in ->> 'o');
  end loop;

  -- 8. Every stock lock of the inputs in one sorted call, before any balance is read.
  perform app.lock_ingredient_stock(p_tenant, v_ids::uuid[]);

  -- 9. Consume the confirmed quantities through the engine, in ingredient-id order. A shortfall is recorded, never
  -- refused (plan §3.6 rule 8): it is one unlotted row, and the engine raises the contained negative_stock alert.
  v_inputs := '[]';
  for v_in in select e.value from jsonb_array_elements(v_rows) e order by e.value ->> 'i' loop
    v_row := '[]';
    begin
      for v_out in
        select r.movement_id, r.raw_lot_id, r.qty
          from app.post_stock_outflow(p_tenant, p_user, (v_in ->> 'i')::uuid, (v_in ->> 'loc')::uuid,
                 (v_in ->> 'b')::numeric, 'consumption', null, (v_in ->> 'o')::uuid, 'batch', v_batch, p_at, p_at,
                 'produce_batch') r
      loop
        v_row := v_row || jsonb_build_object('id', v_out.movement_id, 'rawLotId', v_out.raw_lot_id, 'qty', v_out.qty);
      end loop;
    exception when others then
      get stacked diagnostics v_msg = message_text;
      raise exception '%', v_msg using errcode = sqlstate,
        detail = jsonb_build_array(jsonb_build_object('ingredientId', v_in ->> 'i'))::text;
    end;
    v_inputs := v_inputs || jsonb_build_object('ingredientId', v_in ->> 'i', 'locationId', v_in ->> 'loc',
      'qty', (v_in ->> 'b')::numeric, 'movements', v_row);
  end loop;

  -- 10. The lot code: the Rome calendar day, the printed recipe code and the next sequence under the lot lock.
  select t.timezone into v_tz from public.tenant t where t.id = p_tenant;
  v_date := app.venue_date(p_at, v_tz);
  v_code := app.lot_recipe_code(v_name);
  perform app.lock_batch_lot(p_tenant, v_date, v_code);
  v_seq := app.next_lot_seq(p_tenant, v_date, v_code);

  -- 11. The batch.
  v_use_by := app.batch_use_by(p_at, v_shelf);
  insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code,
      lot_seq, produced_at, produced_by, output_qty, output_unit, portions_computed, portions_initial, shelf_life_hours,
      use_by, state, location_id, created_by)
    values (v_batch, p_tenant, v_key, p_recipe_id, v_version, to_char(v_date, 'YYMMDD') || '-' || v_code || '-' || v_seq,
      v_date, v_code, v_seq, p_at, p_user, p_output_qty, v_unit, v_computed, v_portions, v_shelf, v_use_by, 'fresh',
      v_batch_loc, p_user);

  -- 12. One batch_input per consumption movement (qty is the positive mirror).
  insert into public.batch_input (tenant_id, batch_id, ingredient_id, location_id, raw_lot_id, qty, stock_movement_id,
      created_by)
    select m.tenant_id, v_batch, m.ingredient_id, m.location_id, m.raw_lot_id, -m.qty, m.id, p_user
      from public.stock_movement m
     where m.tenant_id = p_tenant and m.ref_type = 'batch' and m.ref_id = v_batch;

  -- 13. The frozen cost of the actual inputs. Unknown is never zero: one unpriced row makes it incomplete.
  select array_agg(distinct m.ingredient_id) filter (where m.unit_cost is null),
         sum(-m.qty * m.unit_cost)
    into v_missing, v_total
    from public.stock_movement m
   where m.tenant_id = p_tenant and m.ref_type = 'batch' and m.ref_id = v_batch;
  insert into public.batch_cost (batch_id, tenant_id, total_cost, unit_cost_frozen, incomplete, missing_ingredient_ids,
      cost_at, created_by)
    values (v_batch, p_tenant,
      case when v_missing is null then round(v_total, 4) end,
      case when v_missing is null then round(v_total / v_portions, 4) end,
      v_missing is not null, coalesce(v_missing, '{}'), p_at, p_user);

  -- 14. The portions: one produce movement.
  insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
    values (p_tenant, v_batch, 'produce', v_portions, 'batch', v_batch, v_date, p_user);

  -- 15. The answer: quantities only.
  select coalesce(jsonb_agg(jsonb_build_object('ingredientId', n.ing, 'locationId', n.loc, 'onHandQty', n.on_hand)
                            order by n.ing, n.loc), '[]'::jsonb)
    into v_negatives
    from (select x.ing, x.loc, app.location_on_hand(p_tenant, x.ing::uuid, x.loc::uuid) as on_hand
            from (select distinct e.value ->> 'ingredientId' as ing, e.value ->> 'locationId' as loc
                    from jsonb_array_elements(v_inputs) e) x) n
   where n.on_hand < 0;
  return jsonb_build_object(
    'batchId', v_batch,
    'lotCode', to_char(v_date, 'YYMMDD') || '-' || v_code || '-' || v_seq,
    'recipe', jsonb_build_object('key', v_key, 'id', p_recipe_id, 'version', v_version, 'name', v_name),
    'producedAt', p_at, 'useBy', v_use_by, 'outputQty', p_output_qty, 'outputUnit', v_unit,
    'portionsComputed', v_computed, 'portions', v_portions, 'shelfLifeHours', v_shelf, 'locationId', v_batch_loc,
    'inputs', v_inputs, 'negatives', v_negatives);
end
$$;

revoke all on function
  app.require_batch_writer(), app.require_batch_reader(), app.lock_batch_lot(uuid, date, text),
  app.next_lot_seq(uuid, date, text),
  app.produce_batch_core(uuid, uuid, uuid, numeric, jsonb, integer, integer, uuid, timestamptz)
  from public, anon, authenticated, service_role;
