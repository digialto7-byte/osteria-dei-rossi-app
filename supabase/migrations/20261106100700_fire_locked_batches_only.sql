-- M19 review fix: a batch produced WHILE a fire runs must not be consumed by it. fire_course locked the batches it may touch
-- (app.lock_fire_batches) but the depletion then re-read the FEFO candidates from the whole table: a batch committed by
-- produce_batch in between could be consumed without a row lock (unserialised against a discard, and a 40P01 deadlock risk
-- against a second fire locking in another order). Now lock_fire_batches returns the ids it locked and the depletion (the
-- candidate loop and the shortage fallback) uses only those. The merged migrations 20261106100100 and 20261106100200 are
-- not edited: the two helpers change signature (drop and create, ACL restated) and fire_course is replaced in place.

drop function app.deplete_line_batches(uuid, uuid, uuid, uuid, numeric, timestamptz);
drop function app.lock_fire_batches(uuid, uuid[]);

-- FOR UPDATE on the targets, in id order; the ids locked. A fire waits for a discard or another fire here, and an add
-- (FOR SHARE, M18) waits for the fire.
create function app.lock_fire_batches(p_tenant uuid, p_keys uuid[]) returns uuid[]
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_ids uuid[] := '{}';
  r record;
begin
  for r in
    select b.id
      from public.batch b
     where b.tenant_id = p_tenant and b.id in (select t.batch_id from app.fire_batch_targets(p_tenant, p_keys) t)
     order by b.id
       for update
  loop
    v_ids := v_ids || r.id;
  end loop;
  return v_ids;
end
$$;

-- FEFO depletion of one batch key for one line, over the batches in p_batch_ids only (the ones lock_fire_batches locked).
create function app.deplete_line_batches(
  p_tenant uuid, p_user uuid, p_line uuid, p_key uuid, p_portions numeric, p_at timestamptz, p_batch_ids uuid[]
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
           and b.id = any (p_batch_ids)
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
       where f.tenant_id = p_tenant and f.recipe_key = p_key and f.id = any (p_batch_ids)
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

revoke all on function app.lock_fire_batches(uuid, uuid[]) from public, anon, authenticated, service_role;
revoke all on function app.deplete_line_batches(uuid, uuid, uuid, uuid, numeric, timestamptz, uuid[])
  from public, anon, authenticated, service_role;

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
           where round(x.qty * r.need, 4) > 0);
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
            select * from app.deplete_line_batches(v_tenant, v_user, x.id, n.batch_key, round(x.qty * n.need, 4), v_now, v_locked)
          loop
            if d.shortage and d.batch_id is null then
              v_unbooked := v_unbooked || n.batch_key;
            end if;
          end loop;
        end loop;
        for n in
          select r.ingredient_id, round(x.qty * r.need, 4) as q
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

revoke all on function public.fire_course(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.fire_course(uuid, jsonb) to authenticated;
