-- Comanda per uscita, M6 (docs/plans/2026-11-18-comanda-uscite.md section 3.9, step 13; ADR-049): the kitchen board by uscita.
--
--   * A kitchen ticket is now (session, ticket instant, uscita). The instant is derived (plan 3.1): fired_at for uscite 0-1, and
--     greatest(fired_at, called_at) for an uscita >= 2 once called. A held line (sent, uscita >= 2 not called) has no ticket: the board folds
--     it under waiting, and kitchen_mark_line refuses it (P0001 line_held).
--   * kitchen_event gains uscita; kitchen_event_shape_ck gets a third branch for uscita ticket events (course and segue null). Legacy rows
--     (line events, course/segue ticket events) keep their shape with uscita null, so the CHECK validates on add. Legacy events are never
--     updated (append-only); they are simply no longer read by the board.
--   * The four keyed helpers are dropped (no cascade: their only callers, kitchen_mark_line and kitchen_set_ticket, are re-created below) and
--     created on the new key. app.line_ticket_at gives a line's instant.
--   * app.kitchen_ticket_rows is re-created with the same signature and ACL. public.kitchen_tickets and app.kitchen_board_json are not
--     re-created (pins 222:37 and 229:53 stay): they call it by name.
--   * app.uscite_kitchen_remap_open_sessions carries the open tables' closed tickets over to the new key, once (idempotent).
-- Kitchen screens are online-only and reload after the deploy (runbook, "Comanda per uscita"). Every definer: empty search_path, role first
-- where an API role can call it; the app helpers are revoked from every API role. No euro value anywhere.

alter table public.kitchen_event add column uscita smallint check (uscita between 0 and 9);
alter table public.kitchen_event drop constraint kitchen_event_shape_ck;
alter table public.kitchen_event add constraint kitchen_event_shape_ck check (
  (subject = 'line' and action in ('done', 'undone') and cause = 'tap' and order_line_id is not null
     and num_nulls(table_session_id, fired_at, course, segue, uscita) = 5)
  or (subject = 'ticket' and action in ('closed', 'reopened') and cause in ('tap', 'auto') and order_line_id is null
     and num_nonnulls(table_session_id, fired_at, course, segue) = 4 and uscita is null)
  or (subject = 'ticket' and action in ('closed', 'reopened') and cause in ('tap', 'auto') and order_line_id is null
     and num_nonnulls(table_session_id, fired_at, uscita) = 3 and course is null and segue is null));
create index kitchen_event_uscita_ticket_idx on public.kitchen_event (tenant_id, table_session_id, fired_at, uscita, seq desc)
  where subject = 'ticket' and uscita is not null;
comment on column public.kitchen_event.uscita is
  'Comanda per uscita: the uscita of a ticket event keyed (table_session_id, fired_at = ticket instant, uscita). null on line events and on legacy (course, segue) ticket events.';

drop function app.kitchen_ticket_key(jsonb);
drop function app.kitchen_ticket_lock(uuid, uuid, timestamptz, public.course, boolean);
drop function app.kitchen_ticket_state(uuid, uuid, timestamptz, public.course, boolean);
drop function app.kitchen_ticket_open_lines(uuid, uuid, timestamptz, public.course, boolean);

-- The ticket instant of a line (plan 3.1): fired_at for uscite 0-1; for an uscita >= 2, greatest(fired_at, called_at) once called, else null
-- (a held line, or a voided line of an uncalled uscita: neither is in a ticket). null for a line voided not_prepared, which only a held
-- line can be (M4): it never reached the kitchen, so it stays out of its uscita's ticket once called. null for a draft, and for a line from before uscite
-- (uscita null), which only closed sessions hold (order_line_uscita_set_ck refuses null on every later write); callers refuse closed
-- sessions before they ask.
create function app.line_ticket_at(p_tenant uuid, p_line public.order_line) returns timestamptz
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select case when p_line.fired_at is null or p_line.uscita is null or p_line.void_reason = 'not_prepared' then null
              when p_line.uscita < 2 then p_line.fired_at
              else (select greatest(p_line.fired_at, c.called_at)
                      from public.uscita_call c
                     where c.tenant_id = p_tenant and c.table_session_id = p_line.table_session_id and c.uscita = p_line.uscita)
         end
$$;

-- Parses the three-field ticket key of an API body: the strict six-decimal UTC text (FIRED_AT_RE parity) and an integer uscita 0..9.
create function app.kitchen_ticket_key(p_body jsonb) returns table (session_id uuid, fired_at timestamptz, uscita smallint)
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
  uscita := app.order_uscita(p_body -> 'uscita');
  return next;
end
$$;

create function app.kitchen_ticket_lock(p_tenant uuid, p_session uuid, p_at timestamptz, p_uscita smallint) returns void
  language plpgsql
  set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'kitchen:u:' || p_tenant::text || ':' || p_session::text || ':' || to_char(p_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    || ':' || p_uscita::text, 0));
end
$$;

create function app.kitchen_ticket_state(p_tenant uuid, p_session uuid, p_at timestamptz, p_uscita smallint)
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
                          and e.fired_at = p_at and e.uscita = p_uscita
                        order by e.seq desc limit 1) l on true
$$;

create function app.kitchen_ticket_open_lines(p_tenant uuid, p_session uuid, p_at timestamptz, p_uscita smallint)
  returns integer
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select count(*)::integer
    from public.order_line l
   where l.tenant_id = p_tenant and l.table_session_id = p_session and l.uscita = p_uscita and l.fired_at <= p_at
     and l.voided_at is null and app.line_ticket_at(p_tenant, l) = p_at
     and not app.kitchen_line_done(p_tenant, l.id)
$$;

revoke all on function app.line_ticket_at(uuid, public.order_line), app.kitchen_ticket_key(jsonb),
  app.kitchen_ticket_lock(uuid, uuid, timestamptz, smallint), app.kitchen_ticket_state(uuid, uuid, timestamptz, smallint),
  app.kitchen_ticket_open_lines(uuid, uuid, timestamptz, smallint)
  from public, anon, authenticated, service_role;

-- The board rows (M19, M19b, weight reads), by uscita. Kept: the candidate filter (fired in the last 30 hours, same business day as p_at,
-- open session), the done rule, the 200 cap per list, truncated, and "events after p_at are ignored" (calls too: called_at <= p_at).
create or replace function app.kitchen_ticket_rows(p_tenant uuid, p_at timestamptz) returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
as $$
  with cand as (
    select l.*, s.table_name, s.covers, c.called_at,
           case when l.void_reason = 'not_prepared' then null
                when l.uscita < 2 then l.fired_at
                when c.called_at is not null then greatest(l.fired_at, c.called_at) end as ticket_at
      from public.order_line l
      join public.table_session s on s.tenant_id = l.tenant_id and s.id = l.table_session_id
      left join public.uscita_call c on c.tenant_id = l.tenant_id and c.table_session_id = l.table_session_id and c.uscita = l.uscita
                                    and c.called_at <= p_at
     where l.tenant_id = p_tenant and l.fired_at is not null
       and l.fired_at > p_at - interval '30 hours' and l.fired_at <= p_at
       and s.closed_at is null
       and app.business_date(p_tenant, l.fired_at) = app.business_date(p_tenant, p_at)
  ), held as (
    -- Held: uscita >= 2, not called by p_at, not voided. A voided line of an uncalled uscita is in neither list (spec 7), and a line voided
    -- not_prepared stays out of its uscita's ticket after the call too (it never reached the kitchen).
    select c.* from cand c where c.uscita >= 2 and c.called_at is null and c.voided_at is null
  ), cl as (
    select c.*,
           (c.voided_at is null and coalesce((select e.action = 'done'
                                                from public.kitchen_event e
                                               where e.tenant_id = c.tenant_id and e.subject = 'line' and e.order_line_id = c.id
                                                 and e.created_at <= p_at
                                               order by e.seq desc limit 1), false)) as is_done
      from cand c
     where c.ticket_at is not null
  ), grp as (
    select c.table_session_id, c.ticket_at, c.uscita, min(c.table_name) as table_name, min(c.covers) as covers, min(c.called_at) as called_at,
           (array_agg(c.fired_by order by c.id))[1] as fired_by,
           (count(*) filter (where c.voided_at is null))::integer as line_count,
           (count(*) filter (where c.is_done))::integer as done_count,
           jsonb_agg(jsonb_build_object(
               'id', c.id,
               'name', (select i.name from public.menu_item i where i.tenant_id = c.tenant_id and i.id = c.menu_item_id),
               'course', c.course::text,
               'qty', trim_scale(c.qty),
               'weightG', c.weight_g,
               'note', c.note,
               'isShared', c.is_shared,
               'voided', c.voided_at is not null,
               'voidReason', c.void_reason,
               'done', c.is_done)
             order by c.course, case when c.voided_at is not null then 1 when c.is_done then 2 else 0 end, c.created_at, c.id) as lines
      from cl c
     group by c.table_session_id, c.ticket_at, c.uscita
  ), st as (
    select g.*, t.action, t.cause, t.created_at as ev_at, t.created_by as ev_by,
           g.uscita >= 1 and g.ticket_at > min(g.ticket_at) over (partition by g.table_session_id, g.uscita) as is_addition,
           g.table_session_id::text || '|' || to_char(g.ticket_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|u' || g.uscita::text as key,
           coalesce(t.action = 'closed', false) as is_closed
      from grp g
      left join lateral (select e.action, e.cause, e.created_at, e.created_by
                           from public.kitchen_event e
                          where e.tenant_id = p_tenant and e.subject = 'ticket' and e.table_session_id = g.table_session_id
                            and e.fired_at = g.ticket_at and e.uscita = g.uscita and e.created_at <= p_at
                          order by e.seq desc limit 1) t on true
  ), ranked as (
    select s.*,
           row_number() over (partition by s.is_closed
                              order by case when s.is_closed then null else s.ticket_at end desc nulls last,
                                       case when s.is_closed then null else s.table_name end collate "C" desc nulls last,
                                       case when s.is_closed then null else s.uscita end desc nulls last,
                                       case when s.is_closed then null else s.table_session_id end desc nulls last) as rn_active,
           row_number() over (partition by s.is_closed order by s.ev_at desc, s.key collate "C") as rn_closed,
           count(*) over (partition by s.is_closed) as total,
           jsonb_build_object(
             'key', s.key,
             'sessionId', s.table_session_id,
             'tableName', s.table_name,
             'covers', s.covers,
             'uscita', s.uscita,
             'addition', s.is_addition,
             'firedAt', to_char(s.ticket_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
             'calledAt', case when s.uscita >= 2 then to_jsonb(to_char(s.called_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) else 'null'::jsonb end,
             'firedBy', (select jsonb_build_object('id', u.id, 'displayName', u.display_name)
                           from public.app_user u where u.tenant_id = p_tenant and u.id = s.fired_by),
             'lineCount', s.line_count,
             'doneCount', s.done_count,
             'closedAt', case when s.is_closed then to_jsonb(s.ev_at) else 'null'::jsonb end,
             'closedBy', case when s.is_closed then (select jsonb_build_object('id', u.id, 'displayName', u.display_name)
                                                      from public.app_user u where u.tenant_id = p_tenant and u.id = s.ev_by) end,
             'autoClosed', s.is_closed and s.cause = 'auto',
             'lines', s.lines) as tj
      from st s
  ), waiting as (
    select h.table_session_id, h.uscita, min(h.table_name) as table_name,
           jsonb_build_object(
             'sessionId', h.table_session_id,
             'tableName', min(h.table_name),
             'uscita', h.uscita,
             'lineCount', count(*)::integer,
             'lines', jsonb_agg(jsonb_build_object(
                          'id', h.id,
                          'name', (select i.name from public.menu_item i where i.tenant_id = h.tenant_id and i.id = h.menu_item_id),
                          'course', h.course::text,
                          'qty', trim_scale(h.qty),
                          'weightG', h.weight_g,
                          'note', h.note,
                          'isShared', h.is_shared)
                        order by h.course, h.created_at, h.id)) as wj
      from held h
     group by h.table_session_id, h.uscita
  )
  select jsonb_build_object(
           'truncated', coalesce(bool_or(r.total > 200), false),
           'remaining', coalesce(sum(r.line_count - r.done_count) filter (where not r.is_closed), 0)::integer,
           'waitingCount', (select count(*) from held)::integer,
           'waiting', (select coalesce(jsonb_agg(w.wj order by w.table_name collate "C", w.uscita, w.table_session_id), '[]'::jsonb) from waiting w),
           'tickets', coalesce(jsonb_agg(r.tj order by r.ticket_at, r.table_name collate "C", r.uscita, r.table_session_id)
                                 filter (where not r.is_closed and r.rn_active <= 200), '[]'::jsonb),
           'closedTickets', coalesce(jsonb_agg(r.tj order by r.ev_at desc, r.key collate "C")
                                       filter (where r.is_closed and r.rn_closed <= 200), '[]'::jsonb))
    from ranked r
$$;

-- M19b's kitchen_mark_line on the uscita key (plan 3.9). Lock order unchanged: ticket advisory lock -> order_line FOR SHARE. A held line has
-- no ticket: P0001 line_held, nothing written. A line's instant cannot change once it is not null (calls are never removed, fired_at never
-- changes), so the key read before the lock is the key under it. Errors: 42501; 22023 invalid_request; P0002 line_not_found;
-- P0001 session_closed, line_held. No DETAIL is ever set.
create or replace function public.kitchen_mark_line(p_line uuid, p_body jsonb) returns jsonb
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
  v_at timestamptz;
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

  v_at := app.line_ticket_at(v_tenant, l);
  if v_at is null then
    -- No ticket: held, or voided while its uscita waited. A void in flight finishes first; a voided line is never a mark target.
    select z.* into l from public.order_line z where z.tenant_id = v_tenant and z.id = p_line for share;
    if l.voided_at is not null then
      return jsonb_build_object('changed', false, 'autoClosed', false, 'reopened', false,
                                'board', app.kitchen_board_json(v_tenant, clock_timestamp()));
    end if;
    raise exception 'line_held' using errcode = 'P0001';
  end if;

  perform app.kitchen_ticket_lock(v_tenant, l.table_session_id, v_at, l.uscita);
  -- Read again under the share lock: a void that was in flight has finished, and the row says so.
  select z.* into l from public.order_line z where z.tenant_id = v_tenant and z.id = p_line for share;

  if l.voided_at is not null or app.kitchen_line_done(v_tenant, l.id) = v_done then
    return jsonb_build_object('changed', false, 'autoClosed', false, 'reopened', false,
                              'board', app.kitchen_board_json(v_tenant, clock_timestamp()));
  end if;

  insert into public.kitchen_event (tenant_id, subject, action, cause, order_line_id, created_by)
    values (v_tenant, 'line', case when v_done then 'done' else 'undone' end, 'tap', l.id, v_user);

  select s.closed into v_closed from app.kitchen_ticket_state(v_tenant, l.table_session_id, v_at, l.uscita) s;
  if v_done and not v_closed and app.kitchen_ticket_open_lines(v_tenant, l.table_session_id, v_at, l.uscita) = 0 then
    insert into public.kitchen_event (tenant_id, subject, action, cause, table_session_id, fired_at, uscita, created_by)
      values (v_tenant, 'ticket', 'closed', 'auto', l.table_session_id, v_at, l.uscita, v_user);
    v_auto := true;
  elsif not v_done and v_closed then
    insert into public.kitchen_event (tenant_id, subject, action, cause, table_session_id, fired_at, uscita, created_by)
      values (v_tenant, 'ticket', 'reopened', 'auto', l.table_session_id, v_at, l.uscita, v_user);
    v_reopened := true;
  end if;

  return jsonb_build_object('changed', true, 'autoClosed', v_auto, 'reopened', v_reopened,
                            'board', app.kitchen_board_json(v_tenant, clock_timestamp()));
end
$$;

-- M19b's kitchen_set_ticket on {sessionId, firedAt, uscita, closed}; the legacy body (course, segue) is 22023. A ticket exists when a line of
-- the session has that uscita and that instant. Errors: 42501; 22023 invalid_request; P0002 ticket_not_found; P0001 session_closed.
create or replace function public.kitchen_set_ticket(p_body jsonb) returns jsonb
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

  perform app.menu_keys_ok(p_body, array['sessionId', 'firedAt', 'uscita', 'closed'], array['sessionId', 'firedAt', 'uscita', 'closed']);
  if jsonb_typeof(p_body -> 'closed') is distinct from 'boolean' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  v_closed := (p_body ->> 'closed')::boolean;
  select * into k from app.kitchen_ticket_key(p_body);

  if not exists (select 1 from public.order_line l
                  where l.tenant_id = v_tenant and l.table_session_id = k.session_id and l.uscita = k.uscita and l.fired_at <= k.fired_at
                    and app.line_ticket_at(v_tenant, l) = k.fired_at) then
    raise exception 'ticket_not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.table_session s where s.tenant_id = v_tenant and s.id = k.session_id and s.closed_at is not null) then
    raise exception 'session_closed' using errcode = 'P0001';
  end if;

  perform app.kitchen_ticket_lock(v_tenant, k.session_id, k.fired_at, k.uscita);
  select s.closed into v_state from app.kitchen_ticket_state(v_tenant, k.session_id, k.fired_at, k.uscita) s;
  if v_state = v_closed then
    return jsonb_build_object('changed', false, 'board', app.kitchen_board_json(v_tenant, clock_timestamp()));
  end if;

  insert into public.kitchen_event (tenant_id, subject, action, cause, table_session_id, fired_at, uscita, created_by)
    values (v_tenant, 'ticket', case when v_closed then 'closed' else 'reopened' end, 'tap', k.session_id, k.fired_at, k.uscita, v_user);
  return jsonb_build_object('changed', true, 'board', app.kitchen_board_json(v_tenant, clock_timestamp()));
end
$$;

revoke all on function public.kitchen_mark_line(uuid, jsonb), public.kitchen_set_ticket(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.kitchen_mark_line(uuid, jsonb), public.kitchen_set_ticket(jsonb) to authenticated;

-- The open tables' closed tickets, carried over to the uscita key (plan 3.9). For each open session and each new key (session, ticket
-- instant, uscita) of its fired lines, when every legacy key (fired_at, course, segue) of those lines has 'closed' as its latest event, one
-- uscita 'closed' event is appended with the cause, created_by and created_at of the latest of those closes. A key that already has an
-- uscita event is skipped, so a second run appends nothing. Legacy events are never updated; closed sessions are not read. Lines with no
-- ticket (held) are not keys. The kitchen_event lock keeps a kitchen tap from landing between the read and the insert.
create function app.uscite_kitchen_remap_open_sessions() returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_n integer;
begin
  lock table public.kitchen_event in exclusive mode;
  with lk as (
    select distinct l.tenant_id, l.table_session_id, l.uscita, app.line_ticket_at(l.tenant_id, l) as ticket_at, l.fired_at, l.course, l.segue
      from public.order_line l
      join public.table_session s on s.tenant_id = l.tenant_id and s.id = l.table_session_id
     where s.closed_at is null and l.fired_at is not null
  ), legacy as (
    select k.tenant_id, k.table_session_id, k.uscita, k.ticket_at, e.seq, e.action, e.cause, e.created_at, e.created_by
      from lk k
      left join lateral (select e.seq, e.action, e.cause, e.created_at, e.created_by
                           from public.kitchen_event e
                          where e.tenant_id = k.tenant_id and e.subject = 'ticket' and e.uscita is null and e.table_session_id = k.table_session_id
                            and e.fired_at = k.fired_at and e.course = k.course and e.segue = k.segue
                          order by e.seq desc limit 1) e on true
     where k.ticket_at is not null
  ), keyed as (
    select g.tenant_id, g.table_session_id, g.uscita, g.ticket_at,
           bool_and(coalesce(g.action = 'closed', false)) as all_closed,
           (array_agg(g.cause order by g.created_at desc, g.seq desc))[1] as cause,
           (array_agg(g.created_at order by g.created_at desc, g.seq desc))[1] as created_at,
           (array_agg(g.created_by order by g.created_at desc, g.seq desc))[1] as created_by
      from legacy g
     group by g.tenant_id, g.table_session_id, g.uscita, g.ticket_at
  ), ins as (
    insert into public.kitchen_event (tenant_id, subject, action, cause, table_session_id, fired_at, uscita, created_at, created_by)
    select k.tenant_id, 'ticket', 'closed', k.cause, k.table_session_id, k.ticket_at, k.uscita, k.created_at, k.created_by
      from keyed k
     where k.all_closed
       and not exists (select 1 from public.kitchen_event e
                        where e.tenant_id = k.tenant_id and e.subject = 'ticket' and e.table_session_id = k.table_session_id
                          and e.fired_at = k.ticket_at and e.uscita = k.uscita)
     order by k.tenant_id, k.table_session_id, k.ticket_at, k.uscita
    returning 1
  )
  select count(*)::integer into v_n from ins;
  return jsonb_build_object('tickets', v_n);
end
$$;
revoke all on function app.uscite_kitchen_remap_open_sessions() from public, anon, authenticated, service_role;

select app.uscite_kitchen_remap_open_sessions();
