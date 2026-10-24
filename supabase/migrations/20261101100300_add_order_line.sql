-- M18 step 4: add_order_line (M18 plan §3.1.2-6, §3.2; ADR-017). Owner, admin and waiter. Security definer, empty
-- search_path, role first, tenant from app.tenant_id(), user from app.app_user_id().
--
-- Errors: 42501 (role); 22023 invalid_request (shape, unknown key, wrong JSON type, malformed id or instant);
-- P0002 session_not_found / menu_item_not_found; P0001 for the business codes: qty_invalid, note_invalid,
-- course_invalid, client_time_invalid (422 at the API), item_unavailable (DETAIL = {menuItemId, reason, portionsLeft}),
-- session_closed, line_id_conflict (409; never a detail, so another tenant's rows stay invisible).
--
-- The client generates the line id. A second request with the same id, session and item is a replay: it is answered
-- created=false and nothing is re-checked or written (M20 replays are safe without applied_op). Two concurrent adds of
-- one id: the second waits on the primary-key index and its unique_violation is answered as the replay.
--
-- Concurrency: session FOR SHARE (blocks M21's closing update until the line commits), then the dish's live batch rows
-- FOR SHARE (a discard/adjust/split/firing holds them FOR UPDATE, so an add and a stock drop serialise; adds do not
-- block each other), then the availability in a new statement. Lock order session -> lines -> batches (plan §3.1.11).
-- The price is frozen here: the push price while the push runs, else the price in force; the VAT rate is always the
-- item's rate in force (ADR-017).

-- Value parsers shared with update_order_line (not executable by an API role).
create function app.order_uuid(p_val jsonb) returns uuid
  language plpgsql
  immutable
  set search_path = ''
as $$
declare
  v uuid;
begin
  v := app.menu_uuid_or_null(p_val);
  if v is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  return v;
end
$$;

-- A JSON number in half steps, 0.5 .. 99.
create function app.order_qty(p_val jsonb) returns numeric
  language plpgsql
  immutable
  set search_path = ''
as $$
declare
  v numeric;
begin
  if p_val is null or jsonb_typeof(p_val) <> 'number' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  v := (p_val #>> '{}')::numeric;
  if v < 0.5 or v > 99 or v * 2 <> trunc(v * 2) then
    raise exception 'qty_invalid' using errcode = 'P0001';
  end if;
  return v;
end
$$;

-- A JSON string trimmed to 1..140 characters without control characters, or null (JSON null or blank).
create function app.order_note(p_val jsonb) returns text
  language plpgsql
  immutable
  set search_path = ''
as $$
declare
  v text;
begin
  if p_val is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if jsonb_typeof(p_val) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_val) <> 'string' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  v := btrim(p_val #>> '{}');
  if v = '' then
    return null;
  end if;
  if char_length(v) > 140 or v ~ '[[:cntrl:]]' then
    raise exception 'note_invalid' using errcode = 'P0001';
  end if;
  return v;
end
$$;

-- A course word: a non-string is invalid_request, an unknown word is course_invalid.
create function app.order_course(p_val jsonb) returns public.course
  language plpgsql
  immutable
  set search_path = ''
as $$
begin
  if p_val is null or jsonb_typeof(p_val) <> 'string' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if not ((p_val #>> '{}') = any (array(select e::text from unnest(enum_range(null::public.course)) e))) then
    raise exception 'course_invalid' using errcode = 'P0001';
  end if;
  return (p_val #>> '{}')::public.course;
end
$$;

-- The answer of a replayed add: null when the id is unknown; line_id_conflict when the id belongs to another tenant,
-- session or item (the caller learns nothing about it); else {created: false, line, item}.
create function app.order_add_replay(p_tenant uuid, p_line uuid, p_session uuid, p_item uuid) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  x public.order_line;
  a record;
begin
  select l.* into x from public.order_line l where l.id = p_line;
  if not found then
    return null;
  end if;
  if x.tenant_id <> p_tenant or x.table_session_id <> p_session or x.menu_item_id <> p_item then
    raise exception 'line_id_conflict' using errcode = 'P0001';
  end if;
  select v.* into a from app.menu_item_availability(p_tenant, array[p_item], clock_timestamp()) v;
  return jsonb_build_object(
    'created', false,
    'line', app.order_line_json(x),
    'item', jsonb_build_object('id', p_item, 'available', a.available,
                               'portionsLeft', trim_scale(a.portions_left), 'lowStock', a.low_stock));
end
$$;

create function public.add_order_line(p_session uuid, p_body jsonb) returns jsonb
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
    array['lineId', 'menuItemId', 'clientUpdatedAt', 'qty', 'course', 'segue', 'note', 'isShared'],
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
  select p.price, p.vat_rate into v_price, v_vat from app.menu_item_price_at(v_tenant, array[i.id], v_now) p;
  if v_vat is null then
    raise exception 'price_missing' using errcode = 'P0001';
  end if;
  if i.push_until > v_now and i.push_price is not null then
    v_price := i.push_price;
    v_source := 'push';
  else
    v_source := 'menu';
  end if;

  begin
    insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, segue, note, is_shared,
                                   unit_price, vat_rate, price_source, client_updated_at,
                                   created_at, created_by, updated_at, updated_by)
      values (v_line, v_tenant, s.id, i.id, coalesce(v_course, i.course_default), v_qty, v_segue, v_note, v_shared,
              v_price, v_vat, v_source, v_at, v_now, v_user, v_now, v_user)
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
    'item', jsonb_build_object('id', i.id, 'available', true,
                               'portionsLeft', trim_scale(a.portions_left), 'lowStock', a.low_stock));
end
$$;

revoke all on function
  app.order_uuid(jsonb), app.order_qty(jsonb), app.order_note(jsonb), app.order_course(jsonb),
  app.order_add_replay(uuid, uuid, uuid, uuid), public.add_order_line(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.add_order_line(uuid, jsonb) to authenticated;
