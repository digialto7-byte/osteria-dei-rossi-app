-- P2-0b A3 (sell by weight, plan §3.1 D-3, D-4, L-1, P-4, P-6, §3.3, §3.7, §5 A3): weightG on add_order_line and update_order_line, the weight parser,
-- the waiter-safe line JSON with weightG and pricePer100g, and the offline op payload keys.
--
--   * A weighted dish (the unit in force is etto) needs weightG: weight_required otherwise. A portion dish refuses it: weight_not_allowed.
--     A weighted line is one plate (qty 1): a qty other than 1 is qty_invalid.
--   * The per-etto price (the push price while a push runs) and the reference portion weight are frozen on the line at add (L-1);
--     unit_price is the line price, from app.weight_line_price, the one rounding.
--   * update_order_line: weightG on a draft weighted line rewrites weight_g and unit_price together (the price trigger checks the pair).
--     A weight increase re-checks availability as a qty increase does; a decrease never does. An edit without a weight does not name these columns.
--   * app.order_weight judges the weight against the minimum, the step and the tenant's maximum in force now, so an offline op queued above a
--     maximum lowered since is stored rejected (weight_invalid) when it replays.
--   * add_order_line replays are answered before anything is judged (as M18). apply_op_dispatch is unchanged: it passes the payload through.

-- A JSON integer number of grams: at least the minimum, at most the tenant's maximum, on the step; anything else is weight_invalid, a non-number 22023.
create function app.order_weight(p_val jsonb, p_tenant uuid) returns integer
  language plpgsql
  stable
  set search_path = ''
as $$
declare
  v numeric;
begin
  if p_val is null or jsonb_typeof(p_val) <> 'number' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  v := (p_val #>> '{}')::numeric;
  if v <> trunc(v) or v < app.weight_min_g() or v > app.weight_max_g(p_tenant) or v % app.weight_step_g() <> 0 then
    raise exception 'weight_invalid' using errcode = 'P0001';
  end if;
  return v::integer;
end
$$;
revoke all on function app.order_weight(jsonb, uuid) from public, anon, authenticated, service_role;

create or replace function app.order_line_json(p_line public.order_line) returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select jsonb_build_object(
           'id', p_line.id,
           'menuItemId', p_line.menu_item_id,
           'name', (select i.name from public.menu_item i where i.tenant_id = p_line.tenant_id and i.id = p_line.menu_item_id),
           'course', p_line.course::text,
           'qty', trim_scale(p_line.qty),
           'segue', p_line.segue,
           'note', p_line.note,
           'isShared', p_line.is_shared,
           'unitPrice', trim_scale(p_line.unit_price),
           'weightG', p_line.weight_g,
           'pricePer100g', trim_scale(p_line.price_per_100g),
           'state', p_line.state,
           'clientUpdatedAt', p_line.client_updated_at,
           'updatedAt', p_line.updated_at,
           'updatedBy', (select jsonb_build_object('id', u.id, 'displayName', u.display_name)
                           from public.app_user u where u.tenant_id = p_line.tenant_id and u.id = p_line.updated_by))
$$;

create or replace function public.add_order_line(p_session uuid, p_body jsonb) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user uuid;
  v_line uuid;
  v_item uuid;
  v_at timestamptz;
  v_qty numeric := 1;
  v_weight integer;
  v_unit text;
  v_pw integer;
  v_per100 numeric;
  v_course public.course;
  v_segue boolean := false;
  v_note text;
  v_shared boolean := false;
  v_reply jsonb;
  s public.table_session;
  i public.menu_item;
  a record;
  v_keys uuid[];
  v_now timestamptz;
  v_price numeric;
  v_vat numeric;
  v_source text;
  v_row public.order_line;
begin
  perform app.require_table_operator();
  v_tenant := app.tenant_id();
  v_user := app.app_user_id();
  if p_session is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  perform app.menu_keys_ok(p_body,
    array['lineId', 'menuItemId', 'clientUpdatedAt', 'qty', 'course', 'segue', 'note', 'isShared', 'weightG'],
    array['lineId', 'menuItemId', 'clientUpdatedAt']);
  v_line := app.order_uuid(p_body -> 'lineId');
  v_item := app.order_uuid(p_body -> 'menuItemId');
  v_at := app.parse_client_time(p_body -> 'clientUpdatedAt');
  if p_body ? 'qty' then
    v_qty := app.order_qty(p_body -> 'qty');
  end if;
  if p_body ? 'course' then
    v_course := app.order_course(p_body -> 'course');
  end if;
  if p_body ? 'segue' then
    v_segue := app.menu_bool(p_body -> 'segue');
  end if;
  if p_body ? 'note' then
    v_note := app.order_note(p_body -> 'note');
  end if;
  if p_body ? 'isShared' then
    v_shared := app.menu_bool(p_body -> 'isShared');
  end if;

  -- A replay (or a collision) of the client's line id comes before every state check.
  v_reply := app.order_add_replay(v_tenant, v_line, p_session, v_item);
  if v_reply is not null then
    return v_reply;
  end if;
  -- The weight is judged against the tenant's maximum in force now (a queued offline op above a lowered maximum is rejected here).
  if p_body ? 'weightG' then
    v_weight := app.order_weight(p_body -> 'weightG', v_tenant);
  end if;

  select x.* into s from public.table_session x
   where x.tenant_id = v_tenant and x.id = p_session
     for share;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  if s.closed_at is not null then
    raise exception 'session_closed' using errcode = 'P0001';
  end if;

  select m.* into i from public.menu_item m where m.tenant_id = v_tenant and m.id = v_item;
  if not found then
    raise exception 'menu_item_not_found' using errcode = 'P0002';
  end if;

  -- Shared locks on the live batches of the dish, then the availability in a new statement (sees what a concurrent
  -- discard committed before releasing its lock).
  if i.recipe_key is not null then
    select array_agg(distinct n.batch_key) into v_keys from app.plate_batch_needs(v_tenant, array[i.recipe_key]) n;
    if v_keys is not null then
      perform app.lock_live_batches(v_tenant, v_keys);
    end if;
  end if;
  v_now := clock_timestamp();
  select v.* into a from app.menu_item_availability(v_tenant, array[i.id], v_now) v;
  if not a.available then
    raise exception 'item_unavailable' using errcode = 'P0001',
      detail = jsonb_build_object('menuItemId', i.id, 'reason', a.reason,
                                  'portionsLeft', trim_scale(a.portions_left))::text;
  end if;

  -- The price, frozen for good.
  select p.price, p.vat_rate, p.price_unit, p.portion_weight_g into v_price, v_vat, v_unit, v_pw
    from app.menu_item_sale_terms_at(v_tenant, array[i.id], v_now) p;
  if v_vat is null then
    raise exception 'price_missing' using errcode = 'P0001';
  end if;
  if v_unit = 'etto' then
    -- A weighted dish: the weight is required, the line is one plate (qty 1), and the reference portion weight must exist.
    if v_weight is null then
      raise exception 'weight_required' using errcode = 'P0001';
    end if;
    if v_qty <> 1 then
      raise exception 'qty_invalid' using errcode = 'P0001';
    end if;
    if v_pw is null then
      raise exception 'portion_weight_missing' using errcode = 'P0001';
    end if;
  elsif v_weight is not null then
    raise exception 'weight_not_allowed' using errcode = 'P0001';
  end if;
  if i.push_until > v_now and i.push_price is not null then
    v_price := i.push_price;
    v_source := 'push';
  else
    v_source := 'menu';
  end if;
  -- The per-etto price (the push price while it runs) is frozen on the line; the line price is the one rounding (D-4, L-1).
  if v_unit = 'etto' then
    v_per100 := v_price;
    v_price := app.weight_line_price(v_per100, v_weight);
  end if;

  begin
    insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, segue, note, is_shared,
                                   unit_price, vat_rate, price_source, client_updated_at,
                                   weight_g, price_per_100g, portion_weight_g,
                                   created_at, created_by, updated_at, updated_by)
      values (v_line, v_tenant, s.id, i.id, coalesce(v_course, i.course_default), v_qty, v_segue, v_note, v_shared,
              v_price, v_vat, v_source, v_at,
              v_weight, v_per100, case when v_unit = 'etto' then v_pw end,
              v_now, v_user, v_now, v_user)
      returning * into v_row;
  exception when unique_violation then
    v_reply := app.order_add_replay(v_tenant, v_line, p_session, v_item);
    if v_reply is null then
      raise;
    end if;
    return v_reply;
  end;

  return jsonb_build_object(
    'created', true,
    'line', app.order_line_json(v_row),
    'item', jsonb_build_object('id', i.id, 'available', true, 'unavailableReason', null,
                               'portionsLeft', trim_scale(a.portions_left), 'lowStock', a.low_stock));
end
$$;

create or replace function public.update_order_line(p_line uuid, p_patch jsonb) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user uuid;
  v_at timestamptz;
  v_qty numeric;
  v_weight integer;
  v_course public.course;
  v_segue boolean;
  v_note text;
  v_shared boolean;
  v_session uuid;
  v_same boolean;
  v_keys uuid[];
  v_now timestamptz;
  s public.table_session;
  x public.order_line;
  i public.menu_item;
  a record;
  v_row public.order_line;
begin
  perform app.require_table_operator();
  v_tenant := app.tenant_id();
  v_user := app.app_user_id();
  if p_line is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  perform app.menu_keys_ok(p_patch, array['clientUpdatedAt', 'qty', 'course', 'segue', 'note', 'isShared', 'weightG'],
                           array['clientUpdatedAt']);
  if not (p_patch ?| array['qty', 'course', 'segue', 'note', 'isShared', 'weightG']) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  v_at := app.parse_client_time(p_patch -> 'clientUpdatedAt');
  if p_patch ? 'qty' then
    v_qty := app.order_qty(p_patch -> 'qty');
  end if;
  if p_patch ? 'weightG' then
    v_weight := app.order_weight(p_patch -> 'weightG', v_tenant);
  end if;
  if p_patch ? 'course' then
    v_course := app.order_course(p_patch -> 'course');
  end if;
  if p_patch ? 'segue' then
    v_segue := app.menu_bool(p_patch -> 'segue');
  end if;
  if p_patch ? 'note' then
    v_note := app.order_note(p_patch -> 'note');
  end if;
  if p_patch ? 'isShared' then
    v_shared := app.menu_bool(p_patch -> 'isShared');
  end if;

  -- The line's session (it never changes), then the locks: session FOR SHARE, line FOR UPDATE.
  select l.table_session_id into v_session from public.order_line l where l.tenant_id = v_tenant and l.id = p_line;
  if not found then
    raise exception 'line_not_found' using errcode = 'P0002';
  end if;
  select z.* into s from public.table_session z where z.tenant_id = v_tenant and z.id = v_session for share;
  select l.* into x from public.order_line l where l.tenant_id = v_tenant and l.id = p_line for update;

  if x.voided_at is not null then
    return app.order_conflict('voided', x);
  end if;
  if x.fired_at is not null then
    return app.order_conflict('fired', x);
  end if;
  if s.closed_at is not null then
    return app.order_conflict('session_closed', x);
  end if;

  -- A weighted line is one plate: its size is the weight, never the qty; a portion line has no weight.
  if x.weight_g is not null then
    if p_patch ? 'qty' then
      raise exception 'qty_invalid' using errcode = 'P0001';
    end if;
  elsif p_patch ? 'weightG' then
    raise exception 'weight_not_allowed' using errcode = 'P0001';
  end if;

  v_same := (not (p_patch ? 'qty') or v_qty = x.qty)
        and (not (p_patch ? 'weightG') or v_weight = x.weight_g)
        and (not (p_patch ? 'course') or v_course = x.course)
        and (not (p_patch ? 'segue') or v_segue = x.segue)
        and (not (p_patch ? 'note') or v_note is not distinct from x.note)
        and (not (p_patch ? 'isShared') or v_shared = x.is_shared);
  if v_at < x.client_updated_at then
    return app.order_conflict('stale', x);
  end if;
  if v_at = x.client_updated_at then
    if v_same and x.updated_by = v_user then
      return jsonb_build_object('changed', false, 'line', app.order_line_json(x));
    end if;
    return app.order_conflict('stale', x);
  end if;

  -- A quantity or weight increase is checked like an add: shared locks on the live batches, then the availability.
  if (p_patch ? 'qty' and v_qty > x.qty) or (p_patch ? 'weightG' and v_weight > x.weight_g) then
    select m.* into i from public.menu_item m where m.tenant_id = v_tenant and m.id = x.menu_item_id;
    if i.recipe_key is not null then
      select array_agg(distinct n.batch_key) into v_keys from app.plate_batch_needs(v_tenant, array[i.recipe_key]) n;
      if v_keys is not null then
        perform app.lock_live_batches(v_tenant, v_keys);
      end if;
    end if;
    v_now := clock_timestamp();
    select v.* into a from app.menu_item_availability(v_tenant, array[i.id], v_now) v;
    if not a.available then
      raise exception 'item_unavailable' using errcode = 'P0001',
        detail = jsonb_build_object('menuItemId', i.id, 'reason', a.reason,
                                    'portionsLeft', trim_scale(a.portions_left))::text;
    end if;
  end if;

  if p_patch ? 'weightG' then
    -- The weight and the line price are written together (the price trigger checks the pair). Edits without a weight never name
    -- these columns, so they never re-run the price check (L-4).
    update public.order_line
       set weight_g = v_weight,
           unit_price = app.weight_line_price(x.price_per_100g, v_weight),
           course = case when p_patch ? 'course' then v_course else course end,
           segue = case when p_patch ? 'segue' then v_segue else segue end,
           note = case when p_patch ? 'note' then v_note else note end,
           is_shared = case when p_patch ? 'isShared' then v_shared else is_shared end,
           client_updated_at = v_at,
           updated_at = clock_timestamp(),
           updated_by = v_user
     where tenant_id = v_tenant and id = x.id
     returning * into v_row;
  else
    update public.order_line
       set qty = case when p_patch ? 'qty' then v_qty else qty end,
           course = case when p_patch ? 'course' then v_course else course end,
           segue = case when p_patch ? 'segue' then v_segue else segue end,
           note = case when p_patch ? 'note' then v_note else note end,
           is_shared = case when p_patch ? 'isShared' then v_shared else is_shared end,
           client_updated_at = v_at,
           updated_at = clock_timestamp(),
           updated_by = v_user
     where tenant_id = v_tenant and id = x.id
     returning * into v_row;
  end if;
  return jsonb_build_object('changed', not v_same, 'line', app.order_line_json(v_row));
end
$$;

create or replace function app.apply_op_check_payload(p_kind text, p_payload jsonb) returns void
  language plpgsql immutable
  set search_path = ''
as $$
begin
  case p_kind
    when 'open_table' then
      perform app.menu_keys_ok(p_payload, array['tableId', 'sessionId', 'covers'], array['tableId', 'sessionId', 'covers']);
    when 'add_line' then
      perform app.menu_keys_ok(p_payload, array['sessionId', 'lineId', 'menuItemId', 'qty', 'course', 'segue', 'note', 'isShared', 'weightG'],
                               array['sessionId', 'lineId', 'menuItemId']);
    when 'edit_line' then
      perform app.menu_keys_ok(p_payload, array['lineId', 'qty', 'course', 'segue', 'note', 'isShared', 'weightG'], array['lineId']);
    when 'remove_line' then
      perform app.menu_keys_ok(p_payload, array['lineId'], array['lineId']);
    when 'fire' then
      perform app.menu_keys_ok(p_payload, array['sessionId', 'lineIds'], array['sessionId', 'lineIds']);
    when 'void_line' then
      perform app.menu_keys_ok(p_payload, array['lineId', 'reason'], array['lineId', 'reason']);
    else
      raise exception 'invalid_request' using errcode = '22023';
  end case;
end
$$;

revoke all on function app.order_line_json(public.order_line), app.apply_op_check_payload(text, jsonb),
  public.add_order_line(uuid, jsonb), public.update_order_line(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.add_order_line(uuid, jsonb), public.update_order_line(uuid, jsonb) to authenticated;
