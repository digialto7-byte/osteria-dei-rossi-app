-- M13 review fixes d and e (count procedures).
--  d. count_record_lines: a line without an ingredient_id or qty key gave jsonb_typeof NULL and passed the validation.
--     A missing key is now invalid_request (22023), as in the M14 CASE chain (coalesce(..., true)). A missing unit
--     stays equal to a JSON null unit.
--  e. count_start: a monthly count listed ingredients that are not stock items but have a non-zero total; their
--     lines could never be entered (ingredient_not_stock). Only stock ingredients are lines now: the active ones,
--     and the inactive ones that still have stock.
-- Both functions are copied from 20261027100200_count_procedures.sql with only these changes; create or replace
-- keeps the owner and the grants.

create or replace function public.count_start(p_type text, p_location uuid default null) returns jsonb
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
                and g.is_stock
                and (g.is_active or app.location_on_hand(v_tenant, g.id, v_loc) <> 0)));

  return app.count_session_json(v_tenant, v_session, true) || jsonb_build_object('resumed', false);
end
$$;

create or replace function public.count_record_lines(p_session uuid, p_lines jsonb) returns jsonb
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
      -- jsonb_typeof of a missing key is NULL, which would pass every comparison: a missing key is invalid
      if coalesce(jsonb_typeof(e) <> 'object', true)
         or coalesce(jsonb_typeof(e->'ingredient_id') <> 'string', true)
         or coalesce(jsonb_typeof(e->'qty') not in ('number', 'null'), true)
         or coalesce(jsonb_typeof(e->'unit') not in ('string', 'null'), true) then
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
