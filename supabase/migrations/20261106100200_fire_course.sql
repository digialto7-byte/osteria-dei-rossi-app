-- M19 step 3: fire_course and the real app.session_fired_lines (M19 plan §3.1.1-3.1.6, §3.2, §3.3; ADR-019).
--
-- fire_course(p_session, {lineIds}) sends a set of the session's lines to the kitchen. The client names the lines (never
-- "all drafts of the course"), so a replay is exact. One transaction, locks in the global order (session SHARE, lines
-- UPDATE, ingredient stock locks, batch rows UPDATE): see the plan's lock-order table. A line already fired or voided is
-- skipped, not an error, so a replay writes nothing. Stock never refuses a fire: a shortage is booked and alerted
-- (app.deplete_line_batches, the M12 engine). The cost of each line is frozen here (app.freeze_line_cost), also for an
-- unmapped item. updated_* and client_updated_at stay as they are (the order_line guard needs it, and "who edited last"
-- stays true). Role: owner, admin, waiter (app.require_table_operator); the chef gets 42501.
-- Errors: 42501; 22023 invalid_request (shape, 1-50 distinct uuids, extra key); P0002 session_not_found, line_not_found
-- (a missing line, another tenant's, or a line of another session: nothing is written); P0001 session_closed.

create function public.fire_course(p_session uuid, p_body jsonb) returns jsonb
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
    perform app.lock_fire_batches(v_tenant, v_keys);

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
            select * from app.deplete_line_batches(v_tenant, v_user, x.id, n.batch_key, round(x.qty * n.need, 4), v_now)
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

-- ---------------------------------------------------------------------------------------------------------------------
-- The M17 stub replaced: how many lines of each session have been sent. A line fired and then voided still counts (the
-- course was sent). Same signature, same ACL (no API role), still stable: app.session_statuses reads it.
create or replace function app.session_fired_lines(p_tenant uuid, p_session_ids uuid[])
  returns table (table_session_id uuid, fired_lines integer)
  language sql
  stable
  set search_path = ''
as $$
  select l.table_session_id, count(*)::integer
    from public.order_line l
   where l.tenant_id = p_tenant and l.table_session_id = any (p_session_ids) and l.fired_at is not null
   group by l.table_session_id
$$;
