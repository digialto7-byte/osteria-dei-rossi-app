-- M19b step 2 (docs/plans/2026-10-31-m19b-kitchen-done.md §3.1.4, §3.1.8, §3.2; ADR-024): helpers of the two kitchen write procedures.
-- All in schema app, empty search_path, revoked from every API role.
--
--   app.require_kitchen_marker      owner, admin, chef (42501 otherwise). Separate from require_kitchen_reader so that "the waiter reads,
--                                   the chef writes" can change in one place.
--   app.kitchen_ticket_key          parses the five-field comanda key of an API body: the strict six-decimal UTC text (T3), a known course,
--                                   a JSON boolean segue. Anything else is 22023 invalid_request.
--   app.kitchen_ticket_lock         the transaction advisory lock that serialises every kitchen write of one comanda (same pattern as the
--                                   M21 day_close lock; a hash collision only adds waiting).
--   app.kitchen_line_done           the latest line event by seq is 'done'. Ignores voided_at: callers check it.
--   app.kitchen_ticket_state        the latest ticket event by seq: closed or not, its instant, user and cause.
--   app.kitchen_ticket_open_lines   fired, non-voided lines of the key that are not done.

create function app.require_kitchen_marker() returns void
  language plpgsql
  stable
  set search_path = ''
as $$
begin
  if app.role() is null or app.role() not in ('owner', 'admin', 'chef') then
    raise exception 'permission denied: kitchen marks need owner, admin or chef' using errcode = '42501';
  end if;
end
$$;

create function app.kitchen_ticket_key(p_body jsonb) returns table (session_id uuid, fired_at timestamptz, course public.course, segue boolean)
  language plpgsql
  stable
  set search_path = ''
as $$
declare
  v_fired text;
begin
  if p_body is null or jsonb_typeof(p_body) <> 'object' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  session_id := app.order_uuid(p_body -> 'sessionId');
  -- Same pattern as FIRED_AT_RE in src/server/kitchen/constants.ts (parity test).
  if jsonb_typeof(p_body -> 'firedAt') is distinct from 'string' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  v_fired := p_body ->> 'firedAt';
  if v_fired !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  begin
    fired_at := v_fired::timestamptz;
  exception when others then
    raise exception 'invalid_request' using errcode = '22023';
  end;
  if jsonb_typeof(p_body -> 'course') is distinct from 'string'
     or not ((p_body ->> 'course') = any (enum_range(null::public.course)::text[])) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  course := (p_body ->> 'course')::public.course;
  if jsonb_typeof(p_body -> 'segue') is distinct from 'boolean' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  segue := (p_body ->> 'segue')::boolean;
  return next;
end
$$;

create function app.kitchen_ticket_lock(p_tenant uuid, p_session uuid, p_fired_at timestamptz, p_course public.course, p_segue boolean) returns void
  language plpgsql
  set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'kitchen:' || p_tenant::text || ':' || p_session::text || ':' || to_char(p_fired_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    || ':' || p_course::text || ':' || p_segue::text, 0));
end
$$;

create function app.kitchen_line_done(p_tenant uuid, p_line uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce((select e.action = 'done'
                     from public.kitchen_event e
                    where e.tenant_id = p_tenant and e.subject = 'line' and e.order_line_id = p_line
                    order by e.seq desc limit 1), false)
$$;

create function app.kitchen_ticket_state(p_tenant uuid, p_session uuid, p_fired_at timestamptz, p_course public.course, p_segue boolean)
  returns table (closed boolean, closed_at timestamptz, closed_by uuid, auto boolean)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce(l.action = 'closed', false), case when l.action = 'closed' then l.created_at end,
         case when l.action = 'closed' then l.created_by end, coalesce(l.action = 'closed' and l.cause = 'auto', false)
    from (select 1) one
    left join lateral (select e.action, e.cause, e.created_at, e.created_by
                         from public.kitchen_event e
                        where e.tenant_id = p_tenant and e.subject = 'ticket' and e.table_session_id = p_session
                          and e.fired_at = p_fired_at and e.course = p_course and e.segue = p_segue
                        order by e.seq desc limit 1) l on true
$$;

create function app.kitchen_ticket_open_lines(p_tenant uuid, p_session uuid, p_fired_at timestamptz, p_course public.course, p_segue boolean)
  returns integer
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select count(*)::integer
    from public.order_line l
   where l.tenant_id = p_tenant and l.table_session_id = p_session and l.fired_at = p_fired_at
     and l.course = p_course and l.segue = p_segue and l.voided_at is null
     and not app.kitchen_line_done(p_tenant, l.id)
$$;

revoke all on function app.require_kitchen_marker(), app.kitchen_ticket_key(jsonb),
  app.kitchen_ticket_lock(uuid, uuid, timestamptz, public.course, boolean), app.kitchen_line_done(uuid, uuid),
  app.kitchen_ticket_state(uuid, uuid, timestamptz, public.course, boolean),
  app.kitchen_ticket_open_lines(uuid, uuid, timestamptz, public.course, boolean)
  from public, anon, authenticated, service_role;
