-- M18 step 5: update_order_line and remove_order_line (M18 plan §3.1.2, §3.1.3, §3.2; ADR-017). Owner, admin and waiter
-- (any of them may change any line of an open session of the tenant: several waiters share a table). Security definer,
-- empty search_path, role first, tenant from app.tenant_id(), user from app.app_user_id().
--
-- Errors: 42501 (role); 22023 invalid_request (shape, unknown key, no field to change, wrong JSON type, malformed
-- instant); P0002 line_not_found; P0001 for the business codes: qty_invalid, note_invalid, course_invalid,
-- client_time_invalid and item_unavailable (as add_order_line).
-- A conflict is not an error: nothing has been written when it is found, so both functions RETURN
-- {"conflict": {"reason", "line"}} (reason stale, fired, voided or session_closed; line is the current one as
-- order_view renders it). Raising it would put the line, with its free-text note and the editor's display name, into
-- the Postgres error DETAIL and so into the database logs; logs carry codes only (plan §3.1.13). The service maps the
-- result to 409 conflict.
--
-- Last write wins per line. The line is locked FOR UPDATE (after its session FOR SHARE), then:
--   1. irreversible states win over any instant: voided, then fired, then a closed session;
--   2. clientUpdatedAt older than the line's: stale;
--   3. equal: the same fields by the same caller is a replay (changed false, nothing written), else stale;
--   4. otherwise applied: only the fields in the patch change, client_updated_at moves to the new instant.
-- A quantity increase re-checks availability under shared batch locks (decreases, moves and notes never do).
-- remove_order_line voids a draft with the reason entry_removed ("delete before fire"; nothing is deleted, no stock
-- effect). A removal at the instant of the caller's own last write is applied; at the instant of someone else's, stale.
-- The dish and the price never change here: changing the dish is remove + add.

create function app.order_conflict(p_reason text, p_line public.order_line) returns jsonb
  language sql
  stable
  set search_path = ''
as $$
  select jsonb_build_object('conflict', jsonb_build_object('reason', p_reason, 'line', app.order_line_json(p_line)))
$$;

create function public.update_order_line(p_line uuid, p_patch jsonb) returns jsonb
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
  perform app.menu_keys_ok(p_patch, array['clientUpdatedAt', 'qty', 'course', 'segue', 'note', 'isShared'],
                           array['clientUpdatedAt']);
  if not (p_patch ?| array['qty', 'course', 'segue', 'note', 'isShared']) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  v_at := app.parse_client_time(p_patch -> 'clientUpdatedAt');
  if p_patch ? 'qty' then
    v_qty := app.order_qty(p_patch -> 'qty');
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

  v_same := (not (p_patch ? 'qty') or v_qty = x.qty)
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

  -- A quantity increase is checked like an add: shared locks on the live batches, then the availability.
  if p_patch ? 'qty' and v_qty > x.qty then
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
  return jsonb_build_object('changed', not v_same, 'line', app.order_line_json(v_row));
end
$$;

create function public.remove_order_line(p_line uuid, p_body jsonb) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user uuid;
  v_at timestamptz;
  v_session uuid;
  s public.table_session;
  x public.order_line;
  v_row public.order_line;
begin
  perform app.require_table_operator();
  v_tenant := app.tenant_id();
  v_user := app.app_user_id();
  if p_line is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  perform app.menu_keys_ok(p_body, array['clientUpdatedAt'], array['clientUpdatedAt']);
  v_at := app.parse_client_time(p_body -> 'clientUpdatedAt');

  select l.table_session_id into v_session from public.order_line l where l.tenant_id = v_tenant and l.id = p_line;
  if not found then
    raise exception 'line_not_found' using errcode = 'P0002';
  end if;
  select z.* into s from public.table_session z where z.tenant_id = v_tenant and z.id = v_session for share;
  select l.* into x from public.order_line l where l.tenant_id = v_tenant and l.id = p_line for update;

  if x.voided_at is not null then
    -- The replay of this very removal; any other voided line is final.
    if x.void_reason = 'entry_removed' and x.voided_by = v_user and x.client_updated_at = v_at then
      return jsonb_build_object('changed', false, 'line', app.order_line_json(x));
    end if;
    return app.order_conflict('voided', x);
  end if;
  if x.fired_at is not null then
    return app.order_conflict('fired', x);
  end if;
  if s.closed_at is not null then
    return app.order_conflict('session_closed', x);
  end if;
  if v_at < x.client_updated_at or (v_at = x.client_updated_at and x.updated_by <> v_user) then
    return app.order_conflict('stale', x);
  end if;

  update public.order_line
     set voided_at = clock_timestamp(),
         voided_by = v_user,
         void_reason = 'entry_removed',
         client_updated_at = v_at,
         updated_at = clock_timestamp(),
         updated_by = v_user
   where tenant_id = v_tenant and id = x.id
   returning * into v_row;
  return jsonb_build_object('changed', true, 'line', app.order_line_json(v_row));
end
$$;

revoke all on function
  app.order_conflict(text, public.order_line), public.update_order_line(uuid, jsonb), public.remove_order_line(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.update_order_line(uuid, jsonb), public.remove_order_line(uuid, jsonb) to authenticated;
