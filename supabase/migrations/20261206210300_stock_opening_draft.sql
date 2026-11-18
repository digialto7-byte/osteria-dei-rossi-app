-- Opening stock, step 6 (docs/plans/2026-11-18-opening-stock.md §3.3, §3.4, §5 step 6): the helpers, the cut-off and the draft procedures.
--
-- Helpers (schema app, closed to every API role):
--   app.require_opening_writer()            owner or admin through app.role() (so the MFA gate of #79/FD31 applies), else 42501. The chef is excluded: the carico sets costs.
--   app.opening_max_lines()                 200 (Q7): lines per location in the draft and per confirm.
--   app.opening_location_state(t, loc)      counted_at = the first closed MONTHLY count of the location (V3, lead ruling on Q4: a partial daily count does not end the window);
--                                           count_open = a count of either type is open; first_receipt_on = the invoice date of the location's earliest receipt.
--   app.opening_check_bookable(t, loc)      P0001 opening_location_counted (DETAIL = the business date of counted_at, YYYY-MM-DD) or opening_count_open.
--   app.opening_check_date(t, loc, date)    null -> 22023; after today's business date -> opening_date_in_future; before it minus 366 days -> opening_date_too_old; after the
--                                           location's first receipt -> opening_date_after_receipt (DETAIL = that date). The first receipt's own date is allowed (Q10).
--   app.opening_line_values(line, draft)    one strict line object: exactly the keys id, ingredientId, qty, unitCostEur (plus locationId for a draft write); ids are uuid strings,
--                                           qty and unitCostEur JSON numbers. A missing or extra key, a wrong type or a bad uuid -> 22023 invalid_request. qty > 0, <= 100000,
--                                           at most 4 decimals, else P0001 opening_qty_invalid; unitCostEur >= 0, <= 100000, at most 4 decimals, else P0001 opening_cost_invalid.
--                                           More than 4 decimals is refused, never rounded.
--
-- Draft procedures (public, security definer, empty search_path, authenticated only; app.require_opening_writer() first; the tenant from the token, never from the body):
--   public.opening_draft()                  the state of the screen: today, maxLines, booked, and per location (every active one, and an inactive one that still has draft lines)
--                                           its count state, its first receipt date, bookable, and its lines newest first with valueEur = round(qty x unit cost, 2); totals are
--                                           sums of the rounded values.
--   public.opening_draft_put(lines)         upserts 1..200 lines {id, locationId, ingredientId, qty, unitCostEur}. Each location must be an active one of the tenant
--                                           (location_not_found) and bookable (the cut-off); each ingredient must be the tenant's (P0002 ingredient_not_found) and a stock
--                                           ingredient (ingredient_not_stock). An existing id changes in place (also its location and ingredient). One line per ingredient and
--                                           location (lead ruling on Q3): opening_line_duplicate, DETAIL = the ingredient id. More than 200 lines at a location after the write:
--                                           opening_draft_full. An id that belongs to another tenant is refused as invalid_request. Returns {lines} in the shape of opening_draft,
--                                           plus locationId.
--   public.opening_draft_remove(ids)        deletes 1..200 ids of the tenant; returns {removed}. Unknown ids are not an error (removing is idempotent).
--   public.opening_draft_clear(location)    deletes the draft lines of one location of the tenant ("Svuota la bozza"); returns {removed}.
-- Removing and clearing are allowed at a counted location too: they change no stock, and they are how a draft that can no longer be booked is emptied.
-- A draft write takes a transaction advisory lock per location (in id order), so two devices cannot together push a location past 200 lines.

create function app.require_opening_writer() returns void
  language plpgsql stable
  set search_path = ''
as $$
begin
  if app.role() is null or app.role()::text not in ('owner', 'admin') then
    raise exception 'permission denied: opening stock needs owner or admin' using errcode = '42501';
  end if;
end
$$;

create function app.opening_max_lines() returns integer language sql immutable set search_path = '' as $$ select 200 $$;

create function app.opening_location_state(p_tenant uuid, p_location uuid,
                                           out counted_at timestamptz, out count_open boolean, out first_receipt_on date)
  language sql stable security definer
  set search_path = ''
as $$
  select (select min(s.closed_at) from public.count_session s
           where s.tenant_id = p_tenant and s.location_id = p_location and s.status = 'closed' and s.type = 'monthly'),
         exists (select 1 from public.count_session s where s.tenant_id = p_tenant and s.location_id = p_location and s.status = 'open'),
         (select min(m.effective_on) from public.stock_movement m
           where m.tenant_id = p_tenant and m.location_id = p_location and m.type::text = 'receipt')
$$;

create function app.opening_check_bookable(p_tenant uuid, p_location uuid) returns void
  language plpgsql stable security definer
  set search_path = ''
as $$
declare
  st record;
begin
  select * into st from app.opening_location_state(p_tenant, p_location);
  if st.counted_at is not null then
    raise exception 'opening_location_counted' using errcode = 'P0001',
      detail = to_char(app.business_date(p_tenant, st.counted_at), 'YYYY-MM-DD');
  end if;
  if st.count_open then
    raise exception 'opening_count_open' using errcode = 'P0001';
  end if;
end
$$;

create function app.opening_check_date(p_tenant uuid, p_location uuid, p_date date) returns void
  language plpgsql stable security definer
  set search_path = ''
as $$
declare
  v_today date;
  v_first date;
begin
  if p_tenant is null or p_location is null or p_date is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  v_today := app.business_date(p_tenant, now());
  if p_date > v_today then
    raise exception 'opening_date_in_future' using errcode = 'P0001';
  end if;
  if p_date < v_today - 366 then
    raise exception 'opening_date_too_old' using errcode = 'P0001';
  end if;
  select first_receipt_on into v_first from app.opening_location_state(p_tenant, p_location);
  if v_first is not null and p_date > v_first then
    raise exception 'opening_date_after_receipt' using errcode = 'P0001', detail = to_char(v_first, 'YYYY-MM-DD');
  end if;
end
$$;

-- One line object, checked and typed. p_draft: a draft write, which also carries locationId (null location_id otherwise).
create function app.opening_line_values(p_line jsonb, p_draft boolean,
                                        out id uuid, out location_id uuid, out ingredient_id uuid, out qty numeric, out unit_cost numeric)
  language plpgsql immutable
  set search_path = ''
as $$
declare
  v_keys text[] := case when p_draft then array['id', 'ingredientId', 'locationId', 'qty', 'unitCostEur']
                        else array['id', 'ingredientId', 'qty', 'unitCostEur'] end;
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if p_line is null or jsonb_typeof(p_line) <> 'object'
     or (select array_agg(k order by k) from jsonb_object_keys(p_line) k) is distinct from v_keys
     or jsonb_typeof(p_line -> 'id') <> 'string' or (p_line ->> 'id') !~ v_uuid
     or jsonb_typeof(p_line -> 'ingredientId') <> 'string' or (p_line ->> 'ingredientId') !~ v_uuid
     or (p_draft and (jsonb_typeof(p_line -> 'locationId') <> 'string' or (p_line ->> 'locationId') !~ v_uuid))
     or jsonb_typeof(p_line -> 'qty') <> 'number' or jsonb_typeof(p_line -> 'unitCostEur') <> 'number' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  id := (p_line ->> 'id')::uuid;
  ingredient_id := (p_line ->> 'ingredientId')::uuid;
  location_id := case when p_draft then (p_line ->> 'locationId')::uuid end;
  qty := (p_line ->> 'qty')::numeric;
  unit_cost := (p_line ->> 'unitCostEur')::numeric;
  if not (qty > 0 and qty <= 100000 and qty = round(qty, 4)) then
    raise exception 'opening_qty_invalid' using errcode = 'P0001';
  end if;
  if not (unit_cost >= 0 and unit_cost <= 100000 and unit_cost = round(unit_cost, 4)) then
    raise exception 'opening_cost_invalid' using errcode = 'P0001';
  end if;
end
$$;

revoke all on function app.require_opening_writer(), app.opening_max_lines(), app.opening_location_state(uuid, uuid), app.opening_check_bookable(uuid, uuid),
  app.opening_check_date(uuid, uuid, date), app.opening_line_values(jsonb, boolean)
  from public, anon, authenticated, service_role;

-- One draft line as the screen reads it.
create function app.opening_draft_line_json(p_tenant uuid, p_id uuid) returns jsonb
  language sql stable security definer
  set search_path = ''
as $$
  select jsonb_build_object(
           'id', d.id, 'locationId', d.location_id, 'ingredientId', d.ingredient_id, 'ingredientName', i.name, 'baseUnit', i.base_unit,
           'qty', trim_scale(d.qty), 'unitCostEur', trim_scale(d.unit_cost), 'valueEur', round(d.qty * d.unit_cost, 2),
           'updatedAt', d.updated_at, 'updatedByName', u.display_name)
    from public.opening_draft_line d
    join public.ingredient i on i.tenant_id = d.tenant_id and i.id = d.ingredient_id
    join public.app_user u on u.tenant_id = d.tenant_id and u.id = d.updated_by
   where d.tenant_id = p_tenant and d.id = p_id
$$;
revoke all on function app.opening_draft_line_json(uuid, uuid) from public, anon, authenticated, service_role;

create function public.opening_draft() returns jsonb
  language plpgsql stable security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_locations jsonb;
begin
  perform app.require_opening_writer();
  v_tenant := app.tenant_id();

  select coalesce(jsonb_agg(x.loc order by x.name, x.id), '[]'::jsonb) into v_locations
    from (
      select l.id, l.name,
             jsonb_build_object(
               'locationId', l.id, 'name', l.name,
               'countedOn', case when st.counted_at is not null then app.business_date(v_tenant, st.counted_at) end,
               'countOpen', st.count_open, 'firstReceiptOn', st.first_receipt_on,
               'bookable', l.is_active and st.counted_at is null and not st.count_open,
               'lines', coalesce(ln.lines, '[]'::jsonb), 'lineCount', coalesce(ln.n, 0), 'totalValueEur', coalesce(ln.total, 0.00)) as loc
        from public.location l
        cross join lateral app.opening_location_state(v_tenant, l.id) st
        left join lateral (
          select jsonb_agg(app.opening_draft_line_json(v_tenant, d.id) - 'locationId' order by d.created_at desc, d.id desc) as lines,
                 count(*)::int as n, sum(round(d.qty * d.unit_cost, 2)) as total
            from public.opening_draft_line d
           where d.tenant_id = v_tenant and d.location_id = l.id) ln on true
       where l.tenant_id = v_tenant
         and (l.is_active or coalesce(ln.n, 0) > 0)
    ) x;

  return jsonb_build_object(
    'today', app.business_date(v_tenant, now()),
    'maxLines', app.opening_max_lines(),
    -- an operation none of whose rows has a mirror (reversal arrives in step 9)
    'booked', exists (select 1 from public.stock_opening o
                       where o.tenant_id = v_tenant
                         and not exists (select 1 from public.stock_movement m
                                           join public.stock_movement r on r.tenant_id = m.tenant_id and r.reverses_id = m.id
                                          where m.tenant_id = o.tenant_id and m.ref_type = 'opening' and m.ref_id = o.id)),
    'locations', v_locations,
    'lineCount', (select coalesce(sum((e ->> 'lineCount')::int), 0) from jsonb_array_elements(v_locations) e),
    'totalValueEur', (select coalesce(sum((e ->> 'totalValueEur')::numeric), 0.00) from jsonb_array_elements(v_locations) e));
end
$$;

create function public.opening_draft_put(p_lines jsonb) returns jsonb
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user uuid;
  v_rows jsonb;
  v_loc uuid;
  v_dup uuid;
  v_out jsonb;
begin
  perform app.require_opening_writer();
  v_tenant := app.tenant_id();
  v_user := app.app_user_id();

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and app.opening_max_lines() then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  -- The checked lines, typed once: {pos, id, location_id, ingredient_id, qty, unit_cost}, read back below with jsonb_to_recordset.
  select jsonb_agg(jsonb_build_object('pos', e.pos, 'id', v.id, 'location_id', v.location_id, 'ingredient_id', v.ingredient_id, 'qty', v.qty, 'unit_cost', v.unit_cost) order by e.pos)
    into v_rows
    from jsonb_array_elements(p_lines) with ordinality e(line, pos)
    cross join lateral app.opening_line_values(e.line, true) v;

  -- A repeated id in the call, or an id that belongs to another tenant's draft.
  if (select count(distinct p.id) <> count(*) from jsonb_to_recordset(v_rows) p(id uuid))
     or exists (select 1 from public.opening_draft_line d join jsonb_to_recordset(v_rows) p(id uuid) on p.id = d.id where d.tenant_id <> v_tenant) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  -- Locations, in id order: an active one of the tenant; its advisory lock (no two writers push it past the bound); then the cut-off.
  for v_loc in select distinct p.location_id from jsonb_to_recordset(v_rows) p(location_id uuid) order by p.location_id loop
    perform app.resolve_location(v_tenant, v_loc);
    perform pg_advisory_xact_lock(hashtext('opening_draft'), hashtext(v_tenant::text || v_loc::text));
    perform app.opening_check_bookable(v_tenant, v_loc);
  end loop;

  -- Ingredients: the tenant's, and stock ingredients.
  if exists (select 1 from jsonb_to_recordset(v_rows) p(ingredient_id uuid)
              where not exists (select 1 from public.ingredient i where i.tenant_id = v_tenant and i.id = p.ingredient_id)) then
    raise exception 'ingredient_not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from jsonb_to_recordset(v_rows) p(ingredient_id uuid)
               join public.ingredient i on i.tenant_id = v_tenant and i.id = p.ingredient_id
              where not i.is_stock) then
    raise exception 'ingredient_not_stock' using errcode = 'P0001';
  end if;

  -- One line per ingredient and location: within the call, and against the draft's other lines (those this call does not rewrite).
  select p.ingredient_id into v_dup
    from jsonb_to_recordset(v_rows) p(pos int, id uuid, location_id uuid, ingredient_id uuid)
   where exists (select 1 from jsonb_to_recordset(v_rows) q(id uuid, location_id uuid, ingredient_id uuid)
                  where q.location_id = p.location_id and q.ingredient_id = p.ingredient_id and q.id <> p.id)
      or exists (select 1 from public.opening_draft_line d
                  where d.tenant_id = v_tenant and d.location_id = p.location_id and d.ingredient_id = p.ingredient_id and d.id <> p.id
                    and not exists (select 1 from jsonb_to_recordset(v_rows) q(id uuid) where q.id = d.id))
   order by p.pos
   limit 1;
  if v_dup is not null then
    raise exception 'opening_line_duplicate' using errcode = 'P0001', detail = v_dup::text;
  end if;

  begin
    insert into public.opening_draft_line (id, tenant_id, location_id, ingredient_id, qty, unit_cost, created_by, updated_by)
      select p.id, v_tenant, p.location_id, p.ingredient_id, p.qty, p.unit_cost, v_user, v_user
        from jsonb_to_recordset(v_rows) p(pos int, id uuid, location_id uuid, ingredient_id uuid, qty numeric, unit_cost numeric)
       order by p.pos
    on conflict (id) do update
      set location_id = excluded.location_id, ingredient_id = excluded.ingredient_id, qty = excluded.qty, unit_cost = excluded.unit_cost,
          updated_at = now(), updated_by = excluded.updated_by
      where public.opening_draft_line.tenant_id = v_tenant;
  exception when unique_violation then
    -- two lines of the call swapping ingredients, or a concurrent writer at the same location: the answer of the check above
    raise exception 'opening_line_duplicate' using errcode = 'P0001';
  end;

  if exists (select 1 from public.opening_draft_line d
              where d.tenant_id = v_tenant and d.location_id in (select p.location_id from jsonb_to_recordset(v_rows) p(location_id uuid))
              group by d.location_id
             having count(*) > app.opening_max_lines()) then
    raise exception 'opening_draft_full' using errcode = 'P0001';
  end if;

  select jsonb_agg(app.opening_draft_line_json(v_tenant, p.id) order by p.pos) into v_out
    from jsonb_to_recordset(v_rows) p(pos int, id uuid);
  return jsonb_build_object('lines', v_out);
end
$$;

create function public.opening_draft_remove(p_ids uuid[]) returns jsonb
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_n int;
begin
  perform app.require_opening_writer();
  v_tenant := app.tenant_id();
  if p_ids is null or cardinality(p_ids) not between 1 and app.opening_max_lines() or array_position(p_ids, null) is not null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  delete from public.opening_draft_line d where d.tenant_id = v_tenant and d.id = any (p_ids);
  get diagnostics v_n = row_count;
  return jsonb_build_object('removed', v_n);
end
$$;

create function public.opening_draft_clear(p_location uuid) returns jsonb
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_n int;
begin
  perform app.require_opening_writer();
  v_tenant := app.tenant_id();
  if p_location is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if not exists (select 1 from public.location l where l.tenant_id = v_tenant and l.id = p_location) then
    raise exception 'location_not_found' using errcode = 'P0001';
  end if;
  delete from public.opening_draft_line d where d.tenant_id = v_tenant and d.location_id = p_location;
  get diagnostics v_n = row_count;
  return jsonb_build_object('removed', v_n);
end
$$;

revoke all on function public.opening_draft(), public.opening_draft_put(jsonb), public.opening_draft_remove(uuid[]), public.opening_draft_clear(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.opening_draft(), public.opening_draft_put(jsonb), public.opening_draft_remove(uuid[]), public.opening_draft_clear(uuid)
  to authenticated;
