-- Comanda per uscita, step 5, M3 (docs/plans/2026-11-18-comanda-uscite.md sections 3.5, 3.6, 3.12; ADR-049): one send and the call.
--   * public.fire_course re-created from 20261130100300_weight_fire.sql verbatim (signature, locks, order, depletion and cost), plus an
--     optional JSON boolean hold. Every named line is fired, depleted and costed exactly as today (depletion at send, plan 3.2 A). Without
--     hold the send also inserts one 'fire_now' call for every uscita >= 2 it fired (on conflict do nothing): an old bundle's send meant that.
--     The reply gains held: the ids of the lines this call fired that are held afterwards.
--   * public.call_uscita(session, {uscita}): "Via la n". Definer, table operators only (the chef is 42501 until PR5). Lock order session SHARE,
--     then the held lines FOR UPDATE by id (as fire and void), so a call and a not_prepared void of the same line serialise. Conflicts are
--     results, never raised: already_called (another caller), nothing_waiting (no held line). The same caller again answers changed false.
--   * app.sync_op_kinds appends call_uscita (last, the order kept); app.apply_op_dispatch dispatches it (the 120 s bound as for fire) and
--     passes hold to fire_course; app.apply_op_check_payload admits hold for fire and checks the call_uscita payload. apply_op is unchanged.

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
  v_hold boolean := false;
  v_held uuid[];
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
  perform app.menu_keys_ok(p_body, array['lineIds', 'hold'], array['lineIds']);
  -- Comanda per uscita: hold (a JSON boolean, absent = false) keeps the later uscite of this send waiting for their call.
  if p_body ? 'hold' then
    if jsonb_typeof(p_body -> 'hold') <> 'boolean' then
      raise exception 'invalid_request' using errcode = '22023';
    end if;
    v_hold := (p_body ->> 'hold')::boolean;
  end if;
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

    -- Without hold, a send is also the call of every later uscita it fired (what "Invia a seguire" meant: every op an old bundle
    -- queues). One row per uscita, the first one wins; no new lock beyond the unique index.
    if not v_hold then
      insert into public.uscita_call (tenant_id, table_session_id, uscita, called_at, called_by, cause)
        select distinct v_tenant, p_session, l.uscita, v_now, v_user, 'fire_now'
          from public.order_line l
         where l.tenant_id = v_tenant and l.id = any (v_to_fire) and l.uscita >= 2
        on conflict on constraint uscita_call_once_uq do nothing;
    end if;
  end if;

  -- The lines this call fired that are held now (plan 3.1), read in a new statement.
  select coalesce(array_agg(l.id order by l.id), '{}') into v_held
    from public.order_line l
   where l.tenant_id = v_tenant and l.id = any (v_to_fire) and app.line_held(v_tenant, l);

  v_fired := v_to_fire;
  return jsonb_build_object(
    'lines', coalesce((
      select jsonb_agg(app.order_line_json(l) order by l.course, l.created_at, l.id)
        from public.order_line l
       where l.tenant_id = v_tenant and l.id = any (v_ids)), '[]'::jsonb),
    'fired', to_jsonb(coalesce(v_fired, '{}'::uuid[])),
    'skipped', v_skipped,
    'held', to_jsonb(v_held));
end
$$;

create function public.call_uscita(p_session uuid, p_body jsonb) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user uuid;
  v_uscita smallint;
  v_n integer;
  v_inserted integer;
  c public.uscita_call;
  s public.table_session;
begin
  perform app.require_table_operator();
  v_tenant := app.tenant_id();
  v_user := app.app_user_id();
  if p_session is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  perform app.menu_keys_ok(p_body, array['uscita'], array['uscita']);
  v_uscita := app.order_uscita(p_body -> 'uscita');
  if v_uscita < 2 then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  -- Session FOR SHARE (a close takes it FOR UPDATE and waits for us), then the held lines FOR UPDATE in id order.
  select z.* into s from public.table_session z where z.tenant_id = v_tenant and z.id = p_session for share;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  if s.closed_at is not null then
    raise exception 'session_closed' using errcode = 'P0001';
  end if;
  perform 1
    from public.order_line l
   where l.tenant_id = v_tenant and l.table_session_id = p_session and l.uscita = v_uscita
     and l.fired_at is not null and l.voided_at is null
   order by l.id
     for update;

  for v_n in 1 .. 2 loop
    -- A call that exists (a new statement: one committed while we waited counts).
    select u.* into c from public.uscita_call u
     where u.tenant_id = v_tenant and u.table_session_id = p_session and u.uscita = v_uscita;
    if found then
      if c.called_by = v_user then
        return jsonb_build_object('changed', false, 'call', app.uscita_call_json(c), 'lines', app.uscita_lines_json(v_tenant, p_session, v_uscita));
      end if;
      return jsonb_build_object('conflict', jsonb_build_object('reason', 'already_called', 'uscita', v_uscita, 'calledAt', c.called_at));
    end if;
    -- Nothing held (every dish voided, or the send was refused): nothing is written.
    if not exists (select 1 from app.held_lines(v_tenant, p_session, v_uscita)) then
      return jsonb_build_object('conflict', jsonb_build_object('reason', 'nothing_waiting', 'uscita', v_uscita));
    end if;
    insert into public.uscita_call (tenant_id, table_session_id, uscita, called_at, called_by, cause)
      values (v_tenant, p_session, v_uscita, clock_timestamp(), v_user, 'call')
      on conflict on constraint uscita_call_once_uq do nothing
      returning * into c;
    get diagnostics v_inserted = row_count;
    if v_inserted = 1 then
      return jsonb_build_object('changed', true, 'call', app.uscita_call_json(c), 'lines', app.uscita_lines_json(v_tenant, p_session, v_uscita));
    end if;
    -- A concurrent call won the unique key: answer as for an existing call.
  end loop;
  raise exception 'uscita_call_lost' using errcode = 'XX000';
end
$$;

-- The waiter-safe call JSON: uscita, instant, caller (no cost, no money).
create function app.uscita_call_json(p_call public.uscita_call) returns jsonb
  language sql
  stable
  set search_path = ''
as $$
  select jsonb_build_object(
           'uscita', p_call.uscita,
           'calledAt', p_call.called_at,
           'calledBy', (select jsonb_build_object('id', u.id, 'displayName', u.display_name)
                          from public.app_user u where u.tenant_id = p_call.tenant_id and u.id = p_call.called_by))
$$;

-- The sent, live lines of one uscita of a session, in the fire reply's order (app.order_line_json, waiter-safe).
create function app.uscita_lines_json(p_tenant uuid, p_session uuid, p_uscita smallint) returns jsonb
  language sql
  stable
  set search_path = ''
as $$
  select coalesce(jsonb_agg(app.order_line_json(l) order by l.course, l.created_at, l.id), '[]'::jsonb)
    from public.order_line l
   where l.tenant_id = p_tenant and l.table_session_id = p_session and l.uscita = p_uscita
     and l.fired_at is not null and l.voided_at is null
$$;

create or replace function app.sync_op_kinds() returns text[]
  language sql immutable
  set search_path = ''
as $$ select array['open_table', 'add_line', 'edit_line', 'remove_line', 'fire', 'void_line', 'call_uscita']::text[] $$;

create or replace function app.apply_op_check_payload(p_kind text, p_payload jsonb) returns void
  language plpgsql immutable
  set search_path = ''
as $$
begin
  case p_kind
    when 'open_table' then
      perform app.menu_keys_ok(p_payload, array['tableId', 'sessionId', 'covers'], array['tableId', 'sessionId', 'covers']);
    when 'add_line' then
      perform app.menu_keys_ok(p_payload, array['sessionId', 'lineId', 'menuItemId', 'qty', 'course', 'uscita', 'segue', 'note', 'isShared', 'weightG'],
                               array['sessionId', 'lineId', 'menuItemId']);
    when 'edit_line' then
      perform app.menu_keys_ok(p_payload, array['lineId', 'qty', 'course', 'uscita', 'segue', 'note', 'isShared', 'weightG'], array['lineId']);
    when 'remove_line' then
      perform app.menu_keys_ok(p_payload, array['lineId'], array['lineId']);
    when 'fire' then
      perform app.menu_keys_ok(p_payload, array['sessionId', 'lineIds', 'hold'], array['sessionId', 'lineIds']);
    when 'void_line' then
      perform app.menu_keys_ok(p_payload, array['lineId', 'reason'], array['lineId', 'reason']);
    when 'call_uscita' then
      perform app.menu_keys_ok(p_payload, array['sessionId', 'uscita'], array['sessionId', 'uscita']);
    else
      raise exception 'invalid_request' using errcode = '22023';
  end case;
end
$$;

create or replace function app.apply_op_dispatch(p_kind text, p_payload jsonb, p_client_ts text) returns jsonb
  language plpgsql volatile
  set search_path = ''
as $$
declare
  v_stamp jsonb := jsonb_build_object('clientUpdatedAt', p_client_ts);
  v_covers text;
begin
  case p_kind
    when 'open_table' then
      -- open_table takes no stamp; the 120 s future bound is still enforced (P0001 client_time_invalid, stored as rejected).
      perform app.parse_client_time(to_jsonb(p_client_ts));
      if jsonb_typeof(p_payload -> 'covers') <> 'number' then
        raise exception 'invalid_request' using errcode = '22023';
      end if;
      v_covers := p_payload ->> 'covers';
      if v_covers !~ '^[0-9]{1,4}$' then
        raise exception 'covers_invalid' using errcode = 'P0001';
      end if;
      return public.open_table(app.order_uuid(p_payload -> 'tableId'), app.order_uuid(p_payload -> 'sessionId'), v_covers::int);
    when 'add_line' then
      return public.add_order_line(app.order_uuid(p_payload -> 'sessionId'), (p_payload - 'sessionId') || v_stamp);
    when 'edit_line' then
      return public.update_order_line(app.order_uuid(p_payload -> 'lineId'), (p_payload - 'lineId') || v_stamp);
    when 'remove_line' then
      return public.remove_order_line(app.order_uuid(p_payload -> 'lineId'), v_stamp);
    when 'fire' then
      -- fire_course takes no stamp and beats any stamp (ADR-019); the 120 s future bound is still enforced.
      perform app.parse_client_time(to_jsonb(p_client_ts));
      return public.fire_course(app.order_uuid(p_payload -> 'sessionId'),
                                jsonb_build_object('lineIds', p_payload -> 'lineIds') || (p_payload - 'sessionId' - 'lineIds'));
    when 'void_line' then
      return public.void_line(app.order_uuid(p_payload -> 'lineId'), jsonb_build_object('reason', p_payload -> 'reason') || v_stamp);
    when 'call_uscita' then
      -- call_uscita takes no stamp (the call row's instant is the server's); the 120 s future bound is still enforced, as for fire.
      perform app.parse_client_time(to_jsonb(p_client_ts));
      return public.call_uscita(app.order_uuid(p_payload -> 'sessionId'), jsonb_build_object('uscita', p_payload -> 'uscita'));
    else
      raise exception 'invalid_request' using errcode = '22023';
  end case;
end
$$;

revoke all on function public.call_uscita(uuid, jsonb), app.uscita_call_json(public.uscita_call), app.uscita_lines_json(uuid, uuid, smallint)
  from public, anon, authenticated, service_role;
grant execute on function public.call_uscita(uuid, jsonb) to authenticated;
