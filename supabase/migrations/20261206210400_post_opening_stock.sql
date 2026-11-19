-- Opening stock, step 7 (docs/plans/2026-11-18-opening-stock.md §3.5, §5 step 7): the confirm, and the two reads of the screen.
--
--   public.post_opening_stock(location, effective_on, request_id, lines) -> {openingId, locationId, effectiveOn, lineCount, totalValueEur, changed}
--     Books ONE location's draft in one transaction. Order:
--      1. app.require_opening_writer(); the tenant and the user from the token.
--      2. Shape: any null argument -> 22023; lines an array of 1..200 objects, each app.opening_line_values (no locationId); a repeated line id -> 22023; a repeated
--         ingredient -> P0001 opening_line_duplicate (DETAIL = the ingredient id).
--      3. Replay (a double tap): a transaction advisory lock on (tenant, request_id), then, if an operation with that request_id exists: at the same location, its answer with
--         changed false and nothing written; at another location, P0001 opening_request_reused. The lines of a replay are not compared (the draft is gone).
--      4. app.resolve_location: an active location of the tenant.
--      5. The location's draft rows are locked (for update, in id order), then read again: {id, ingredient, qty, unit cost} must equal the lines exactly, else P0001
--         opening_draft_changed. A stale screen or a second device cannot book lines the owner did not see.
--      6. Every ingredient: the tenant's (P0002 ingredient_not_found) and a stock ingredient (P0001 ingredient_not_stock).
--      7. app.lock_ingredient_stock on the ingredients. Lock order: draft rows, then stock locks; no count procedure locks draft rows and this one never locks count_session rows.
--      8. After the locks, in new statements: app.opening_check_bookable (a closed monthly count, an open count) and app.opening_check_date. A count entry on the same
--         ingredients either waits for this commit and then snapshots the carico, or commits first and makes this call refuse.
--      9-13. One stock_opening row; one `opening` movement per line (cost frozen, no lot, effective_on = the chosen date, created_at left to now() as ADR-033 requires);
--         the booked draft rows deleted; one audit row stock.opening_posted with {lines, total_value_eur} only; the answer.
--   public.opening_history(location) -> {location: {id, name}, countedOn, countOpen, operations: [{openingId, effectiveOn, createdAt, byName, lineCount, totalValueEur,
--     reversed: {at, byName, reasonCode} | null, correctable, lines: [{movementId, ingredientId, name, baseUnit, qty, unitCostEur, valueEur}]}]}, newest first, at most 50.
--     reversed comes from the mirror rows and the stock.opening_reversed audit row (the reason lives only there; reversal arrives in step 9). correctable = not reversed, the
--     location not counted and no count open. A location of the tenant, active or not, else location_not_found.
--   public.opening_stock_summary() -> {booked, draftLines}, for /api/today: booked = an operation none of whose rows has a mirror. No money.
-- All three: security definer, empty search_path, authenticated only, owner and admin through app.require_opening_writer().

create function public.post_opening_stock(p_location uuid, p_effective_on date, p_request_id uuid, p_lines jsonb) returns jsonb
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user uuid;
  v_rows jsonb;
  v_dup uuid;
  v_loc uuid;
  v_prev public.stock_opening;
  v_opening uuid;
  v_n integer;
  v_total numeric;
begin
  perform app.require_opening_writer();
  v_tenant := app.tenant_id();
  v_user := app.app_user_id();

  -- 2. Shape.
  if p_location is null or p_effective_on is null or p_request_id is null or p_lines is null
     or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and app.opening_max_lines() then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  select jsonb_agg(jsonb_build_object('pos', e.pos, 'id', v.id, 'ingredient_id', v.ingredient_id, 'qty', v.qty, 'unit_cost', v.unit_cost) order by e.pos)
    into v_rows
    from jsonb_array_elements(p_lines) with ordinality e(line, pos)
    cross join lateral app.opening_line_values(e.line, false) v;
  v_n := jsonb_array_length(v_rows);
  if (select count(distinct p.id) from jsonb_to_recordset(v_rows) p(id uuid)) <> v_n then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  select p.ingredient_id into v_dup
    from jsonb_to_recordset(v_rows) p(pos int, ingredient_id uuid)
   group by p.ingredient_id
  having count(*) > 1
   order by min(p.pos)
   limit 1;
  if v_dup is not null then
    raise exception 'opening_line_duplicate' using errcode = 'P0001', detail = v_dup::text;
  end if;

  -- 3. Replay.
  perform pg_advisory_xact_lock(hashtext('opening_request'), hashtext(v_tenant::text || p_request_id::text));
  select * into v_prev from public.stock_opening o where o.tenant_id = v_tenant and o.request_id = p_request_id;
  if found then
    if v_prev.location_id <> p_location then
      raise exception 'opening_request_reused' using errcode = 'P0001';
    end if;
    return jsonb_build_object(
      'openingId', v_prev.id, 'locationId', v_prev.location_id, 'effectiveOn', v_prev.effective_on, 'lineCount', v_prev.line_count,
      'totalValueEur', (select coalesce(sum(round(m.qty * m.unit_cost, 2)), 0.00) from public.stock_movement m
                         where m.tenant_id = v_tenant and m.ref_type = 'opening' and m.ref_id = v_prev.id),
      'changed', false);
  end if;

  -- 4. The location.
  v_loc := app.resolve_location(v_tenant, p_location);

  -- 5. Lock the location's draft, then read it again: it must equal the lines exactly.
  perform 1 from public.opening_draft_line d where d.tenant_id = v_tenant and d.location_id = v_loc order by d.id for update;
  if (select count(*) from public.opening_draft_line d where d.tenant_id = v_tenant and d.location_id = v_loc) <> v_n
     or exists (select 1 from jsonb_to_recordset(v_rows) p(id uuid, ingredient_id uuid, qty numeric, unit_cost numeric)
                 where not exists (select 1 from public.opening_draft_line d
                                    where d.tenant_id = v_tenant and d.location_id = v_loc and d.id = p.id
                                      and d.ingredient_id = p.ingredient_id and d.qty = p.qty and d.unit_cost = p.unit_cost)) then
    raise exception 'opening_draft_changed' using errcode = 'P0001';
  end if;

  -- 6. The ingredients (the draft's foreign key keeps them in the tenant; a stock flag may have changed since the draft was written).
  if exists (select 1 from jsonb_to_recordset(v_rows) p(ingredient_id uuid)
              where not exists (select 1 from public.ingredient i where i.tenant_id = v_tenant and i.id = p.ingredient_id)) then
    raise exception 'ingredient_not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from jsonb_to_recordset(v_rows) p(ingredient_id uuid)
               join public.ingredient i on i.tenant_id = v_tenant and i.id = p.ingredient_id
              where not i.is_stock) then
    raise exception 'ingredient_not_stock' using errcode = 'P0001';
  end if;

  -- 7. The stock locks, in id order.
  perform app.lock_ingredient_stock(v_tenant, (select array_agg(p.ingredient_id) from jsonb_to_recordset(v_rows) p(ingredient_id uuid)));

  -- 8. After the locks: the cut-off, then the date.
  perform app.opening_check_bookable(v_tenant, v_loc);
  perform app.opening_check_date(v_tenant, v_loc, p_effective_on);

  -- 9-12. The operation, its movements, the draft, the audit row.
  insert into public.stock_opening (tenant_id, location_id, effective_on, request_id, line_count, created_by)
    values (v_tenant, v_loc, p_effective_on, p_request_id, v_n, v_user)
    returning id into v_opening;
  insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, reason_code, ref_type, ref_id, effective_on, created_by)
    select v_tenant, p.ingredient_id, null, v_loc, 'opening'::public.stock_movement_type, p.qty, p.unit_cost, null, 'opening', v_opening, p_effective_on, v_user
      from jsonb_to_recordset(v_rows) p(pos int, ingredient_id uuid, qty numeric, unit_cost numeric)
     order by p.pos;
  delete from public.opening_draft_line d
   where d.tenant_id = v_tenant and d.location_id = v_loc and d.id in (select p.id from jsonb_to_recordset(v_rows) p(id uuid));
  select coalesce(sum(round(p.qty * p.unit_cost, 2)), 0.00) into v_total from jsonb_to_recordset(v_rows) p(qty numeric, unit_cost numeric);
  insert into public.audit_event (tenant_id, entity_type, entity_id, action, after, created_by)
    values (v_tenant, 'stock_opening', v_opening, 'stock.opening_posted', jsonb_build_object('lines', v_n, 'total_value_eur', v_total), v_user);

  return jsonb_build_object('openingId', v_opening, 'locationId', v_loc, 'effectiveOn', p_effective_on, 'lineCount', v_n,
                            'totalValueEur', v_total, 'changed', true);
end
$$;

create function public.opening_history(p_location uuid) returns jsonb
  language plpgsql stable security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_name text;
  st record;
  v_bookable boolean;
  v_ops jsonb;
begin
  perform app.require_opening_writer();
  v_tenant := app.tenant_id();
  if p_location is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  select l.name into v_name from public.location l where l.tenant_id = v_tenant and l.id = p_location;
  if not found then
    raise exception 'location_not_found' using errcode = 'P0001';
  end if;
  select * into st from app.opening_location_state(v_tenant, p_location);
  v_bookable := st.counted_at is null and not st.count_open;

  select coalesce(jsonb_agg(x.op order by x.created_at desc, x.id desc), '[]'::jsonb) into v_ops
    from (
      select o.id, o.created_at,
             jsonb_build_object(
               'openingId', o.id, 'effectiveOn', o.effective_on, 'createdAt', o.created_at, 'byName', u.display_name,
               'lineCount', o.line_count, 'totalValueEur', ln.total,
               'reversed', case when rv.at is not null then jsonb_build_object('at', rv.at, 'byName', rv.by_name, 'reasonCode', rv.reason_code) end,
               'correctable', rv.at is null and v_bookable,
               'lines', ln.lines) as op
        from public.stock_opening o
        join public.app_user u on u.tenant_id = o.tenant_id and u.id = o.created_by
        cross join lateral (
          select jsonb_agg(jsonb_build_object('movementId', m.id, 'ingredientId', m.ingredient_id, 'name', i.name, 'baseUnit', i.base_unit,
                                              'qty', trim_scale(m.qty), 'unitCostEur', trim_scale(m.unit_cost), 'valueEur', round(m.qty * m.unit_cost, 2))
                           order by i.name, m.id) as lines,
                 coalesce(sum(round(m.qty * m.unit_cost, 2)), 0.00) as total
            from public.stock_movement m
            join public.ingredient i on i.tenant_id = m.tenant_id and i.id = m.ingredient_id
           where m.tenant_id = o.tenant_id and m.ref_type = 'opening' and m.ref_id = o.id) ln
        left join lateral (
          select min(r.created_at) as at,
                 (select ru.display_name from public.stock_movement r2 join public.app_user ru on ru.tenant_id = r2.tenant_id and ru.id = r2.created_by
                   where r2.tenant_id = o.tenant_id and r2.reverses_id in (select m2.id from public.stock_movement m2
                                                                            where m2.tenant_id = o.tenant_id and m2.ref_type = 'opening' and m2.ref_id = o.id)
                   order by r2.created_at, r2.id limit 1) as by_name,
                 (select e.after ->> 'reason_code' from public.audit_event e
                   where e.tenant_id = o.tenant_id and e.entity_type = 'stock_opening' and e.entity_id = o.id and e.action = 'stock.opening_reversed'
                   order by e.created_at desc limit 1) as reason_code
            from public.stock_movement m
            join public.stock_movement r on r.tenant_id = m.tenant_id and r.reverses_id = m.id
           where m.tenant_id = o.tenant_id and m.ref_type = 'opening' and m.ref_id = o.id) rv on true
       where o.tenant_id = v_tenant and o.location_id = p_location
       order by o.created_at desc, o.id desc
       limit 50
    ) x;

  return jsonb_build_object(
    'location', jsonb_build_object('id', p_location, 'name', v_name),
    'countedOn', case when st.counted_at is not null then app.business_date(v_tenant, st.counted_at) end,
    'countOpen', st.count_open,
    'operations', v_ops);
end
$$;

create function public.opening_stock_summary() returns jsonb
  language plpgsql stable security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  perform app.require_opening_writer();
  v_tenant := app.tenant_id();
  return jsonb_build_object(
    'booked', exists (select 1 from public.stock_opening o
                       where o.tenant_id = v_tenant
                         and not exists (select 1 from public.stock_movement m
                                           join public.stock_movement r on r.tenant_id = m.tenant_id and r.reverses_id = m.id
                                          where m.tenant_id = o.tenant_id and m.ref_type = 'opening' and m.ref_id = o.id)),
    'draftLines', (select count(*)::int from public.opening_draft_line d where d.tenant_id = v_tenant));
end
$$;

revoke all on function public.post_opening_stock(uuid, date, uuid, jsonb), public.opening_history(uuid), public.opening_stock_summary()
  from public, anon, authenticated, service_role;
grant execute on function public.post_opening_stock(uuid, date, uuid, jsonb), public.opening_history(uuid), public.opening_stock_summary()
  to authenticated;
