-- M19b step 4 (docs/plans/2026-10-31-m19b-kitchen-done.md §3.1.3, §3.1.4, §3.1.6, §3.2, §3.3; ADR-024): the two kitchen write procedures.
--
--   public.kitchen_mark_line(p_line, {done})            sets a fired line to a target state. Idempotent: when the state already equals the target nothing is
--                                                       written. The done that leaves no open line closes the comanda (closed, cause auto) in the same
--                                                       transaction; an undone on a line of a closed comanda reopens it (reopened, cause auto).
--   public.kitchen_set_ticket({sessionId, firedAt, course, segue, closed})   closes or reopens a comanda by hand (cause tap). Idempotent.
--
-- Both: role first (owner, admin, chef), tenant from app.tenant_id(), user from app.app_user_id(), every statement tenant-filtered, empty
-- search_path. Writes of one comanda are serialised by its advisory lock; a line mark also holds the line FOR SHARE, so a void in flight
-- finishes first (lock order: ticket advisory -> order_line, M19b plan §3.3). No session lock is taken: a close_table that races a mark
-- is neither blocked nor blocking (Q138). Replies carry the whole board, read after the writes (T1: a later statement of this function
-- sees them). Errors: 42501; 22023 invalid_request; P0002 line_not_found / ticket_not_found; P0001 session_closed. No DETAIL is ever set.

create function public.kitchen_mark_line(p_line uuid, p_body jsonb) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user uuid;
  v_done boolean;
  l public.order_line;
  v_closed boolean;
  v_auto boolean := false;
  v_reopened boolean := false;
begin
  perform app.require_kitchen_marker();
  v_tenant := app.tenant_id();
  v_user := app.app_user_id();

  if p_line is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  perform app.menu_keys_ok(p_body, array['done'], array['done']);
  if jsonb_typeof(p_body -> 'done') is distinct from 'boolean' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  v_done := (p_body ->> 'done')::boolean;

  -- Found without a lock first: the key is needed to take the comanda lock, which must come before the line lock.
  select z.* into l from public.order_line z where z.tenant_id = v_tenant and z.id = p_line;
  if not found or l.fired_at is null then
    raise exception 'line_not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.table_session s where s.tenant_id = v_tenant and s.id = l.table_session_id and s.closed_at is not null) then
    raise exception 'session_closed' using errcode = 'P0001';
  end if;

  perform app.kitchen_ticket_lock(v_tenant, l.table_session_id, l.fired_at, l.course, l.segue);
  -- Read again under the share lock: a void that was in flight has finished, and the row says so.
  select z.* into l from public.order_line z where z.tenant_id = v_tenant and z.id = p_line for share;

  if l.voided_at is not null or app.kitchen_line_done(v_tenant, l.id) = v_done then
    return jsonb_build_object('changed', false, 'autoClosed', false, 'reopened', false,
                              'board', app.kitchen_board_json(v_tenant, clock_timestamp()));
  end if;

  insert into public.kitchen_event (tenant_id, subject, action, cause, order_line_id, created_by)
    values (v_tenant, 'line', case when v_done then 'done' else 'undone' end, 'tap', l.id, v_user);

  select s.closed into v_closed from app.kitchen_ticket_state(v_tenant, l.table_session_id, l.fired_at, l.course, l.segue) s;
  if v_done and not v_closed and app.kitchen_ticket_open_lines(v_tenant, l.table_session_id, l.fired_at, l.course, l.segue) = 0 then
    insert into public.kitchen_event (tenant_id, subject, action, cause, table_session_id, fired_at, course, segue, created_by)
      values (v_tenant, 'ticket', 'closed', 'auto', l.table_session_id, l.fired_at, l.course, l.segue, v_user);
    v_auto := true;
  elsif not v_done and v_closed then
    insert into public.kitchen_event (tenant_id, subject, action, cause, table_session_id, fired_at, course, segue, created_by)
      values (v_tenant, 'ticket', 'reopened', 'auto', l.table_session_id, l.fired_at, l.course, l.segue, v_user);
    v_reopened := true;
  end if;

  return jsonb_build_object('changed', true, 'autoClosed', v_auto, 'reopened', v_reopened,
                            'board', app.kitchen_board_json(v_tenant, clock_timestamp()));
end
$$;

create function public.kitchen_set_ticket(p_body jsonb) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user uuid;
  v_closed boolean;
  k record;
  v_state boolean;
begin
  perform app.require_kitchen_marker();
  v_tenant := app.tenant_id();
  v_user := app.app_user_id();

  perform app.menu_keys_ok(p_body, array['sessionId', 'firedAt', 'course', 'segue', 'closed'],
                           array['sessionId', 'firedAt', 'course', 'segue', 'closed']);
  if jsonb_typeof(p_body -> 'closed') is distinct from 'boolean' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  v_closed := (p_body ->> 'closed')::boolean;
  select * into k from app.kitchen_ticket_key(p_body);

  if not exists (select 1 from public.order_line l
                  where l.tenant_id = v_tenant and l.table_session_id = k.session_id and l.fired_at = k.fired_at
                    and l.course = k.course and l.segue = k.segue) then
    raise exception 'ticket_not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.table_session s where s.tenant_id = v_tenant and s.id = k.session_id and s.closed_at is not null) then
    raise exception 'session_closed' using errcode = 'P0001';
  end if;

  perform app.kitchen_ticket_lock(v_tenant, k.session_id, k.fired_at, k.course, k.segue);
  select s.closed into v_state from app.kitchen_ticket_state(v_tenant, k.session_id, k.fired_at, k.course, k.segue) s;
  if v_state = v_closed then
    return jsonb_build_object('changed', false, 'board', app.kitchen_board_json(v_tenant, clock_timestamp()));
  end if;

  insert into public.kitchen_event (tenant_id, subject, action, cause, table_session_id, fired_at, course, segue, created_by)
    values (v_tenant, 'ticket', case when v_closed then 'closed' else 'reopened' end, 'tap', k.session_id, k.fired_at, k.course, k.segue, v_user);
  return jsonb_build_object('changed', true, 'board', app.kitchen_board_json(v_tenant, clock_timestamp()));
end
$$;

revoke all on function public.kitchen_mark_line(uuid, jsonb), public.kitchen_set_ticket(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.kitchen_mark_line(uuid, jsonb), public.kitchen_set_ticket(jsonb) to authenticated;
