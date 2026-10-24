-- M13 step 3: the count procedures (M13 plan §3.1.2-7, §3.2; ADR-012).
--   count_start, count_record_lines, count_close, count_cancel  - the lifecycle of a count session
--   set_ingredient_critical                                     - which ingredients the daily count covers
-- Each is one transaction (one function call), SECURITY DEFINER with an empty search_path, checks the role FIRST
-- (owner, admin or chef, as the other stock writers; never the waiter), takes the tenant from app.tenant_id() and
-- the user from app.app_user_id(), filters every query by the tenant and is executable by `authenticated` only.
-- Answers carry quantities only: no key and no value is a cost (V6, Q16).
--
-- Lock order (plan §3.1.13): the session row (FOR SHARE to save lines, FOR UPDATE to close or cancel), then the
-- ingredient stock locks in id order. The stock writers of M12 take only stock locks, so no cycle exists.

-- A colleague as the viewer may see them: owner and admin see the display name, the chef only their own.
create function app.count_person(p_tenant uuid, p_user uuid) returns jsonb
  language sql stable
  security definer
  set search_path = ''
as $$
  select case when p_user is null then null
              else jsonb_build_object(
                'name', case when app.role()::text in ('owner', 'admin') or p_user = app.app_user_id()
                             then (select u.display_name from public.app_user u
                                    where u.tenant_id = p_tenant and u.id = p_user) end,
                'me', p_user = app.app_user_id()) end
$$;

-- The CountSession object of the API, with the lines and the reminders when p_detail (CountSessionDetail).
-- Counters come from the lines; nothing here is a stock balance except expectedNowQty, which is the location total
-- read now for display only.
create function app.count_session_json(p_tenant uuid, p_session uuid, p_detail boolean) returns jsonb
  language plpgsql stable
  security definer
  set search_path = ''
as $$
declare
  s public.count_session;
  v_loc text;
  v_tz text;
  v_out jsonb;
begin
  select * into s from public.count_session x where x.tenant_id = p_tenant and x.id = p_session;
  if not found then
    raise exception 'count_not_found' using errcode = 'P0002';
  end if;
  select l.name into v_loc from public.location l where l.tenant_id = p_tenant and l.id = s.location_id;
  v_out := jsonb_build_object(
    'id', s.id, 'type', s.type, 'status', s.status,
    'location', jsonb_build_object('id', s.location_id, 'name', v_loc),
    'startedAt', s.started_at, 'startedBy', app.count_person(p_tenant, s.started_by),
    'closedAt', s.closed_at, 'closedBy', app.count_person(p_tenant, s.closed_by),
    'cancelledAt', s.cancelled_at,
    'linesTotal', (select count(*) from public.count_line l where l.tenant_id = p_tenant and l.session_id = s.id),
    'linesCounted', (select count(*) from public.count_line l
                      where l.tenant_id = p_tenant and l.session_id = s.id and l.counted_qty is not null),
    'linesWithDifference', (select count(*) from public.count_line l
                             where l.tenant_id = p_tenant and l.session_id = s.id
                               and l.counted_qty is not null and l.counted_qty <> l.expected_qty));
  if p_detail then
    select t.timezone into v_tz from public.tenant t where t.id = p_tenant;
    v_out := v_out || jsonb_build_object(
      'today', app.venue_date(now(), v_tz),
      'invoicesAwaitingApproval', (select count(*) from public.invoice i
                                    where i.tenant_id = p_tenant and i.status in ('received', 'extracting', 'review')),
      'lines', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'ingredientId', l.ingredient_id, 'name', g.name, 'baseUnit', g.base_unit::text,
                 'position', l.position,
                 'expectedNowQty', app.location_on_hand(p_tenant, l.ingredient_id, s.location_id),
                 'expectedQty', l.expected_qty, 'countedQty', l.counted_qty,
                 'differenceQty', l.counted_qty - l.expected_qty, 'enteredAt', l.entered_at) order by l.position)
          from public.count_line l
          join public.ingredient g on g.tenant_id = l.tenant_id and g.id = l.ingredient_id
         where l.tenant_id = p_tenant and l.session_id = s.id), '[]'::jsonb));
  end if;
  return v_out;
end
$$;

-- Starts a count at a location, or resumes the open one of the same type (resumed true). The lines are created now,
-- one per ingredient, ordered by name: daily = active stock ingredients flagged critical; monthly = every active
-- stock ingredient plus any ingredient (active or not) whose total at the location is not zero.
create function public.count_start(p_type text, p_location uuid default null) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user uuid;
  v_loc uuid;
  v_session uuid;
  s public.count_session;
begin
  perform app.require_stock_writer();
  v_tenant := app.tenant_id();
  v_user := app.app_user_id();
  if p_type is null or p_type not in ('daily', 'monthly') then
    raise exception 'type_invalid' using errcode = 'P0001';
  end if;
  v_loc := app.resolve_location(v_tenant, p_location);

  select x.* into s from public.count_session x
   where x.tenant_id = v_tenant and x.location_id = v_loc and x.status = 'open';
  if found then
    if s.type <> p_type then
      raise exception 'count_open_exists' using errcode = 'P0001';
    end if;
    return app.count_session_json(v_tenant, s.id, true) || jsonb_build_object('resumed', true);
  end if;

  if p_type = 'daily' then
    perform 1 from public.ingredient i
     where i.tenant_id = v_tenant and i.is_active and i.is_stock and i.is_critical;
    if not found then
      raise exception 'no_critical_ingredients' using errcode = 'P0001';
    end if;
  end if;

  begin
    insert into public.count_session (tenant_id, location_id, type, started_by)
      values (v_tenant, v_loc, p_type, v_user)
      returning id into v_session;
  exception when unique_violation then
    -- A concurrent start won the open slot: resume it if it has our type.
    select x.* into s from public.count_session x
     where x.tenant_id = v_tenant and x.location_id = v_loc and x.status = 'open';
    if not found or s.type <> p_type then
      raise exception 'count_open_exists' using errcode = 'P0001';
    end if;
    return app.count_session_json(v_tenant, s.id, true) || jsonb_build_object('resumed', true);
  end;

  insert into public.count_line (tenant_id, session_id, ingredient_id, position, created_by)
    select v_tenant, v_session, g.id, (row_number() over (order by g.name collate "C", g.id))::integer, v_user
      from public.ingredient g
     where g.tenant_id = v_tenant
       and ((p_type = 'daily' and g.is_active and g.is_stock and g.is_critical)
            or (p_type = 'monthly'
                and ((g.is_active and g.is_stock)
                     or app.location_on_hand(v_tenant, g.id, v_loc) <> 0)));

  return app.count_session_json(v_tenant, v_session, true) || jsonb_build_object('resumed', false);
end
$$;

-- Enters or clears lines (ADR-012). p_lines = array of {ingredient_id, qty|null, unit}. For each line: the stock lock
-- first (ids in order), then the location total is read and stored as expected_qty next to the counted quantity.
-- Re-entering a line refreshes the snapshot. Nothing is posted until count_close.
create function public.count_record_lines(p_session uuid, p_lines jsonb) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user uuid;
  s public.count_session;
  e jsonb;
  v_ids uuid[] := '{}';
  v_id uuid;
  v_qty numeric;
  v_counted numeric;
  v_expected numeric;
  v_out jsonb := '[]'::jsonb;
  l public.count_line;
begin
  perform app.require_stock_writer();
  v_tenant := app.tenant_id();
  v_user := app.app_user_id();

  if p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) not between 1 and 200 then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  select x.* into s from public.count_session x
   where x.tenant_id = v_tenant and x.id = p_session
     for share;
  if not found then
    raise exception 'count_not_found' using errcode = 'P0002';
  end if;
  if s.status = 'closed' then
    raise exception 'count_closed' using errcode = 'P0001';
  elsif s.status = 'cancelled' then
    raise exception 'count_cancelled' using errcode = 'P0001';
  end if;

  for e in select x from jsonb_array_elements(p_lines) x loop
    begin
      if jsonb_typeof(e) <> 'object' or jsonb_typeof(e->'ingredient_id') <> 'string'
         or jsonb_typeof(e->'qty') not in ('number', 'null') or jsonb_typeof(e->'unit') not in ('string', 'null') then
        raise exception 'invalid_request' using errcode = '22023';
      end if;
      v_id := (e->>'ingredient_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'invalid_request' using errcode = '22023';
    end;
    if v_id = any (v_ids) then
      raise exception 'duplicate_line' using errcode = 'P0001';
    end if;
    v_ids := v_ids || v_id;
    perform 1 from public.count_line c
     where c.tenant_id = v_tenant and c.session_id = s.id and c.ingredient_id = v_id;
    if not found then
      raise exception 'count_line_not_found' using errcode = 'P0002';
    end if;
  end loop;

  perform app.lock_ingredient_stock(v_tenant, v_ids);

  for e in select x from jsonb_array_elements(p_lines) x loop
    v_id := (e->>'ingredient_id')::uuid;
    if jsonb_typeof(e->'qty') = 'null' then
      update public.count_line c
         set expected_qty = null, counted_qty = null, entered_at = null, entered_by = null
       where c.tenant_id = v_tenant and c.session_id = s.id and c.ingredient_id = v_id
       returning * into l;
    else
      v_qty := (e->>'qty')::numeric;
      v_counted := app.count_qty_base(v_tenant, v_id, v_qty, e->>'unit');
      v_expected := app.location_on_hand(v_tenant, v_id, s.location_id);
      update public.count_line c
         set expected_qty = v_expected, counted_qty = v_counted, entered_at = now(), entered_by = v_user
       where c.tenant_id = v_tenant and c.session_id = s.id and c.ingredient_id = v_id
       returning * into l;
    end if;
    v_out := v_out || jsonb_build_object(
      'ingredientId', l.ingredient_id, 'expectedQty', l.expected_qty, 'countedQty', l.counted_qty,
      'differenceQty', l.counted_qty - l.expected_qty, 'enteredAt', l.entered_at);
  end loop;

  return jsonb_build_object('lines', v_out);
end
$$;

-- Closes a count: posts the difference of every counted line that has one (app.post_count_adjustment), skips the
-- others, marks the session closed and writes one audit event, all in this transaction. Lines left uncounted change
-- nothing (Q35). A count is never reversed: a wrong one is corrected by counting again.
create function public.count_close(p_session uuid) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user uuid;
  s public.count_session;
  v_ids uuid[];
  v_total integer;
  v_counted integer;
  v_with_diff integer := 0;
  v_diffs jsonb := '[]'::jsonb;
  v_at timestamptz := now();
  v_diff numeric;
  v_cost numeric;
  l record;
begin
  perform app.require_stock_writer();
  v_tenant := app.tenant_id();
  v_user := app.app_user_id();

  select x.* into s from public.count_session x
   where x.tenant_id = v_tenant and x.id = p_session
     for update;
  if not found then
    raise exception 'count_not_found' using errcode = 'P0002';
  end if;
  if s.status = 'closed' then
    raise exception 'count_closed' using errcode = 'P0001';
  elsif s.status = 'cancelled' then
    raise exception 'count_cancelled' using errcode = 'P0001';
  end if;

  select count(*), count(*) filter (where c.counted_qty is not null),
         array_agg(c.ingredient_id) filter (where c.counted_qty is not null)
    into v_total, v_counted, v_ids
    from public.count_line c
   where c.tenant_id = v_tenant and c.session_id = s.id;
  if v_counted = 0 then
    raise exception 'count_empty' using errcode = 'P0001';
  end if;

  perform app.lock_ingredient_stock(v_tenant, v_ids);

  -- The cost basis is read once, without the cost lock (a basis read, as M12's outflows).
  for l in
    select c.ingredient_id, c.counted_qty, c.expected_qty, k.unit_cost
      from public.count_line c
      left join app.ingredient_unit_costs(v_tenant, v_ids, null) k on k.ingredient_id = c.ingredient_id
     where c.tenant_id = v_tenant and c.session_id = s.id and c.counted_qty is not null
     order by c.position
  loop
    v_diff := l.counted_qty - l.expected_qty;
    if v_diff <> 0 then
      v_cost := l.unit_cost;
      perform count(*) from app.post_count_adjustment(v_tenant, v_user, l.ingredient_id, s.location_id, v_diff, s.id,
                                                      v_at, v_cost);
      v_with_diff := v_with_diff + 1;
      v_diffs := v_diffs || jsonb_build_object('ingredientId', l.ingredient_id, 'differenceQty', v_diff);
    end if;
  end loop;

  update public.count_session
     set status = 'closed', closed_at = v_at, closed_by = v_user
   where tenant_id = v_tenant and id = s.id;

  insert into public.audit_event (tenant_id, entity_type, entity_id, action, after, created_by)
    values (v_tenant, 'count_session', s.id, 'count_session.closed',
            jsonb_build_object('type', s.type, 'lines_counted', v_counted, 'lines_skipped', v_total - v_counted,
                               'lines_with_difference', v_with_diff), v_user);

  return jsonb_build_object('sessionId', s.id, 'closedAt', v_at, 'linesCounted', v_counted,
                            'linesSkipped', v_total - v_counted, 'linesWithDifference', v_with_diff,
                            'lines', v_diffs);
end
$$;

create function public.count_cancel(p_session uuid) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user uuid;
  s public.count_session;
  v_at timestamptz := now();
begin
  perform app.require_stock_writer();
  v_tenant := app.tenant_id();
  v_user := app.app_user_id();

  select x.* into s from public.count_session x
   where x.tenant_id = v_tenant and x.id = p_session
     for update;
  if not found then
    raise exception 'count_not_found' using errcode = 'P0002';
  end if;
  if s.status = 'closed' then
    raise exception 'count_closed' using errcode = 'P0001';
  elsif s.status = 'cancelled' then
    raise exception 'count_cancelled' using errcode = 'P0001';
  end if;

  update public.count_session
     set status = 'cancelled', cancelled_at = v_at, cancelled_by = v_user
   where tenant_id = v_tenant and id = s.id;

  insert into public.audit_event (tenant_id, entity_type, entity_id, action, after, created_by)
    values (v_tenant, 'count_session', s.id, 'count_session.cancelled',
            jsonb_build_object('type', s.type), v_user);

  return jsonb_build_object('sessionId', s.id, 'status', 'cancelled', 'cancelledAt', v_at);
end
$$;

-- Chooses the ingredients of the daily count (PRD 2.1: the chef flags them; Q36). A definer procedure, so the
-- chef's lack of an UPDATE policy on ingredient is unchanged. An unchanged value writes nothing.
create function public.set_ingredient_critical(p_ingredient uuid, p_critical boolean) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user uuid;
  i public.ingredient;
begin
  perform app.require_stock_writer();
  v_tenant := app.tenant_id();
  v_user := app.app_user_id();
  if p_critical is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  select x.* into i from public.ingredient x
   where x.tenant_id = v_tenant and x.id = p_ingredient
     for update;
  if not found then
    raise exception 'ingredient_not_found' using errcode = 'P0002';
  end if;
  if not i.is_stock then
    raise exception 'ingredient_not_stock' using errcode = 'P0001';
  end if;
  if i.is_critical = p_critical then
    return jsonb_build_object('ingredientId', i.id, 'isCritical', i.is_critical, 'changed', false);
  end if;

  update public.ingredient set is_critical = p_critical where tenant_id = v_tenant and id = i.id;
  insert into public.audit_event (tenant_id, entity_type, entity_id, action, before, after, created_by)
    values (v_tenant, 'ingredient', i.id, 'ingredient.critical_changed',
            jsonb_build_object('is_critical', i.is_critical), jsonb_build_object('is_critical', p_critical), v_user);
  return jsonb_build_object('ingredientId', i.id, 'isCritical', p_critical, 'changed', true);
end
$$;

revoke all on function app.count_person(uuid, uuid), app.count_session_json(uuid, uuid, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.count_start(text, uuid), public.count_record_lines(uuid, jsonb),
  public.count_close(uuid), public.count_cancel(uuid), public.set_ingredient_critical(uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.count_start(text, uuid), public.count_record_lines(uuid, jsonb),
  public.count_close(uuid), public.count_cancel(uuid), public.set_ingredient_critical(uuid, boolean)
  to authenticated;
