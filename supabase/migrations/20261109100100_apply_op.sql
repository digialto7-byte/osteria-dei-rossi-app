-- M20 step 2 (docs/plans/2026-10-29-m20-offline.md §3.1.3-3.1.5, §3.2; ADR-022): public.apply_op, the one SQL dispatcher of the offline queue.
--
-- One call = one transaction: it checks the role, the envelope and the user binding, takes an advisory lock on (tenant, op id),
-- answers `duplicate` from applied_op when the op was decided before, otherwise calls the EXISTING public procedure of the op's kind
-- (open_table, add_order_line, update_order_line, remove_order_line, fire_course, void_line; none is replaced, no rule is copied)
-- and records the outcome in applied_op in the same transaction.
--
-- A business error (P0001, P0002, 22023) raised by the procedure is trapped in a sub-block, so everything the procedure wrote is rolled
-- back, and the refusal is stored (`conflict` for a closed or already-open table, `rejected` otherwise). Any other error (deadlock,
-- serialization, timeout, XX000) is NOT trapped: the whole call rolls back, nothing is stored, and the route stops the batch.
--
-- Plan deviation, recorded in the PR: the payload KEY check (a stamp inside a payload, an unknown or missing key) is its own helper,
-- app.apply_op_check_payload, called with the envelope checks, so such a call raises 22023 and stores nothing (plan §5 step 2 test list).
-- Anything the procedures themselves refuse with 22023 (a malformed uuid inside a valid key) is stored as `rejected invalid_request`.

-- The raised P0001 messages that count as `conflict` (the server's state won), not `rejected`.
create function app.sync_conflict_codes() returns text[]
  language sql immutable
  set search_path = ''
as $$ select array['session_closed', 'table_already_open']::text[] $$;
revoke all on function app.sync_conflict_codes() from public, anon, authenticated, service_role;

-- Payload keys per kind (the stamp is never in a payload: it is the envelope's clientTs).
create function app.apply_op_check_payload(p_kind text, p_payload jsonb) returns void
  language plpgsql immutable
  set search_path = ''
as $$
begin
  case p_kind
    when 'open_table' then
      perform app.menu_keys_ok(p_payload, array['tableId', 'sessionId', 'covers'], array['tableId', 'sessionId', 'covers']);
    when 'add_line' then
      perform app.menu_keys_ok(p_payload, array['sessionId', 'lineId', 'menuItemId', 'qty', 'course', 'segue', 'note', 'isShared'],
                               array['sessionId', 'lineId', 'menuItemId']);
    when 'edit_line' then
      perform app.menu_keys_ok(p_payload, array['lineId', 'qty', 'course', 'segue', 'note', 'isShared'], array['lineId']);
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
revoke all on function app.apply_op_check_payload(text, jsonb) from public, anon, authenticated, service_role;

-- Calls the public procedure of the kind. The payload keys were checked by apply_op_check_payload.
create function app.apply_op_dispatch(p_kind text, p_payload jsonb, p_client_ts text) returns jsonb
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
      return public.fire_course(app.order_uuid(p_payload -> 'sessionId'), jsonb_build_object('lineIds', p_payload -> 'lineIds'));
    when 'void_line' then
      return public.void_line(app.order_uuid(p_payload -> 'lineId'), jsonb_build_object('reason', p_payload -> 'reason') || v_stamp);
    else
      raise exception 'invalid_request' using errcode = '22023';
  end case;
end
$$;
revoke all on function app.apply_op_dispatch(text, jsonb, text) from public, anon, authenticated, service_role;

create function public.apply_op(p_op jsonb) returns jsonb
  language plpgsql volatile security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user uuid;
  v_op uuid;
  v_seq bigint;
  v_kind text;
  v_ts text;
  v_payload jsonb;
  v_hash text;
  v_client_ts timestamptz;
  v_received timestamptz;
  v_outcome text;
  v_reply jsonb;
  v_stored public.applied_op;
  v_state text;
  v_msg text;
  v_detail text;
  v_detail_json jsonb;
begin
  -- 1. Role first, then the tenant and the caller from the claims.
  perform app.require_table_operator();
  v_tenant := app.tenant_id();
  v_user := app.app_user_id();

  -- 2. The envelope: shape only (the 120 s future bound is judged inside the dispatch).
  perform app.menu_keys_ok(p_op, array['opId', 'seq', 'kind', 'clientTs', 'userId', 'payload'],
                           array['opId', 'seq', 'kind', 'clientTs', 'userId', 'payload']);
  v_op := app.order_uuid(p_op -> 'opId');
  if jsonb_typeof(p_op -> 'seq') <> 'number' or (p_op ->> 'seq') !~ '^[0-9]{1,15}$' or (p_op ->> 'seq')::bigint < 1 then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  v_seq := (p_op ->> 'seq')::bigint;
  if jsonb_typeof(p_op -> 'kind') <> 'string' or not ((p_op ->> 'kind') = any (app.sync_op_kinds())) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  v_kind := p_op ->> 'kind';
  if jsonb_typeof(p_op -> 'clientTs') <> 'string'
     or (p_op ->> 'clientTs') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  v_ts := p_op ->> 'clientTs';
  begin
    v_client_ts := v_ts::timestamptz;
  exception when others then
    raise exception 'invalid_request' using errcode = '22023';
  end;
  if jsonb_typeof(p_op -> 'payload') <> 'object' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  v_payload := p_op -> 'payload';
  perform app.apply_op_check_payload(v_kind, v_payload);

  -- 3. User binding, before any lookup: a client cannot apply another person's op.
  if app.order_uuid(p_op -> 'userId') <> v_user then
    raise exception 'user_mismatch' using errcode = '42501';
  end if;

  -- 4. Idempotency: one lock per (tenant, op id); a second call with the same op waits here, then finds the stored row.
  v_hash := encode(sha256(convert_to(v_payload::text || '|' || v_kind || '|' || v_ts, 'UTF8')), 'hex');
  perform pg_advisory_xact_lock(hashtextextended('applied_op:' || v_tenant::text || ':' || v_op::text, 0));
  select a.* into v_stored from public.applied_op a where a.tenant_id = v_tenant and a.op_id = v_op;
  if found then
    if v_stored.payload_hash <> v_hash then
      raise exception 'op_id_reused' using errcode = 'P0001';
    end if;
    return jsonb_build_object(
      'opId', v_op, 'status', 'duplicate',
      'stop', v_stored.kind in ('open_table', 'add_line') and v_stored.outcome <> 'applied',
      'stored', jsonb_build_object('status', v_stored.outcome, 'receivedAt', v_stored.received_at, 'result', v_stored.result));
  end if;

  -- 5. Dispatch to the existing procedure. A trapped business error rolls back what the procedure wrote.
  v_received := clock_timestamp();
  begin
    v_reply := app.apply_op_dispatch(v_kind, v_payload, v_ts);
    v_outcome := case when v_reply ? 'conflict' then 'conflict' else 'applied' end;
  exception
    when sqlstate 'P0001' or sqlstate 'P0002' or sqlstate '22023' then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_detail = pg_exception_detail;
      v_outcome := case when v_state = 'P0001' and v_msg = any (app.sync_conflict_codes()) then 'conflict' else 'rejected' end;
      begin
        v_detail_json := v_detail::jsonb;
      exception when others then
        v_detail_json := null;
      end;
      v_reply := jsonb_build_object('sqlstate', v_state, 'message', v_msg, 'detail', v_detail_json);
  end;

  -- 6. The record, in the same transaction as the procedure.
  insert into public.applied_op (tenant_id, op_id, user_id, kind, seq, client_ts, received_at, outcome, payload_hash, result, created_by)
    values (v_tenant, v_op, v_user, v_kind, v_seq, v_client_ts, v_received, v_outcome, v_hash, v_reply, v_user);

  -- 7. A failed open_table or add_line means the session or line does not exist: later ops may name it, so the batch stops.
  return jsonb_build_object(
    'opId', v_op, 'status', v_outcome, 'receivedAt', v_received,
    'stop', v_kind in ('open_table', 'add_line') and v_outcome <> 'applied',
    'result', v_reply);
end
$$;
revoke all on function public.apply_op(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.apply_op(jsonb) to authenticated;
