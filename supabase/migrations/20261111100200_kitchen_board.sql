-- M19b step 3 (docs/plans/2026-10-31-m19b-kitchen-done.md §3.1.5, §3.2; ADR-024): the kitchen board with done lines, counts and closed comande.
-- app.kitchen_ticket_rows and public.kitchen_tickets are replaced in place, with the same signatures and ACL. Every M19 rule is kept
-- (migration 20261106100400): the candidate filter (business day of the instant, fired within 30 hours, sessions not closed, tenant), the
-- grouping by (table_session_id, fired_at, course, segue), the ordering, the 200 cap and the key format. Added:
--   * per line `done`: not voided and the latest line event (created_at <= instant, highest seq) is 'done'. Line order: to make, then
--     voided, then done; inside each by creation instant and id. The voided line stays struck with its reason and never counts.
--   * per comanda `lineCount` (non-voided lines), `doneCount`, `closedAt` / `closedBy` / `autoClosed` from the latest ticket event
--     (<= instant) when that event is 'closed'.
--   * `tickets` = the active comande (M19 order, newest 200 returned oldest first); `closedTickets` = the closed ones, latest close first,
--     then key, at most 200; `truncated` when either list was cut; `remaining` = the open lines of ALL active comande (before the cap).
--   * events later than the instant are ignored, so tests read the board at a fixed instant.
-- No euro value anywhere; no key matches the chef regex of pgTAP 059.

create or replace function app.kitchen_ticket_rows(p_tenant uuid, p_at timestamptz) returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
as $$
  with cand as (
    select l.*, s.table_name, s.covers
      from public.order_line l
      join public.table_session s on s.tenant_id = l.tenant_id and s.id = l.table_session_id
     where l.tenant_id = p_tenant and l.fired_at is not null
       and l.fired_at > p_at - interval '30 hours' and l.fired_at <= p_at
       and s.closed_at is null
       and app.business_date(p_tenant, l.fired_at) = app.business_date(p_tenant, p_at)
  ), cl as (
    select c.*,
           (c.voided_at is null and coalesce((select e.action = 'done'
                                                from public.kitchen_event e
                                               where e.tenant_id = c.tenant_id and e.subject = 'line' and e.order_line_id = c.id
                                                 and e.created_at <= p_at
                                               order by e.seq desc limit 1), false)) as is_done
      from cand c
  ), grp as (
    select c.table_session_id, c.fired_at, c.course, c.segue, min(c.table_name) as table_name, min(c.covers) as covers,
           (array_agg(c.fired_by order by c.id))[1] as fired_by,
           (count(*) filter (where c.voided_at is null))::integer as line_count,
           (count(*) filter (where c.is_done))::integer as done_count,
           jsonb_agg(jsonb_build_object(
               'id', c.id,
               'name', (select i.name from public.menu_item i where i.tenant_id = c.tenant_id and i.id = c.menu_item_id),
               'qty', trim_scale(c.qty),
               'note', c.note,
               'isShared', c.is_shared,
               'voided', c.voided_at is not null,
               'voidReason', c.void_reason,
               'done', c.is_done)
             order by case when c.voided_at is not null then 1 when c.is_done then 2 else 0 end, c.created_at, c.id) as lines
      from cl c
     group by c.table_session_id, c.fired_at, c.course, c.segue
  ), st as (
    select g.*, t.action, t.cause, t.created_at as ev_at, t.created_by as ev_by,
           g.table_session_id::text || '|' || to_char(g.fired_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
             || '|' || g.course::text || '|' || g.segue::text as key,
           coalesce(t.action = 'closed', false) as is_closed
      from grp g
      left join lateral (select e.action, e.cause, e.created_at, e.created_by
                           from public.kitchen_event e
                          where e.tenant_id = p_tenant and e.subject = 'ticket' and e.table_session_id = g.table_session_id
                            and e.fired_at = g.fired_at and e.course = g.course and e.segue = g.segue and e.created_at <= p_at
                          order by e.seq desc limit 1) t on true
  ), ranked as (
    select s.*,
           row_number() over (partition by s.is_closed
                              order by case when s.is_closed then null else s.fired_at end desc nulls last,
                                       case when s.is_closed then null else s.table_name end collate "C" desc nulls last,
                                       case when s.is_closed then null else s.course end desc nulls last,
                                       case when s.is_closed then null else s.segue end desc nulls last,
                                       case when s.is_closed then null else s.table_session_id end desc nulls last) as rn_active,
           row_number() over (partition by s.is_closed order by s.ev_at desc, s.key collate "C") as rn_closed,
           count(*) over (partition by s.is_closed) as total,
           jsonb_build_object(
             'key', s.key,
             'sessionId', s.table_session_id,
             'tableName', s.table_name,
             'covers', s.covers,
             'course', s.course::text,
             'segue', s.segue,
             'firedAt', to_char(s.fired_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
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
  )
  select jsonb_build_object(
           'truncated', coalesce(bool_or(r.total > 200), false),
           'remaining', coalesce(sum(r.line_count - r.done_count) filter (where not r.is_closed), 0)::integer,
           'tickets', coalesce(jsonb_agg(r.tj order by r.fired_at, r.table_name collate "C", r.course, r.segue, r.table_session_id)
                                 filter (where not r.is_closed and r.rn_active <= 200), '[]'::jsonb),
           'closedTickets', coalesce(jsonb_agg(r.tj order by r.ev_at desc, r.key collate "C")
                                       filter (where r.is_closed and r.rn_closed <= 200), '[]'::jsonb))
    from ranked r
$$;

create function app.kitchen_board_json(p_tenant uuid, p_at timestamptz) returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select jsonb_build_object('asOf', p_at) || app.kitchen_ticket_rows(p_tenant, p_at)
$$;

create or replace function public.kitchen_tickets() returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  perform app.require_kitchen_reader();
  return app.kitchen_board_json(app.tenant_id(), clock_timestamp());
end
$$;

revoke all on function app.kitchen_board_json(uuid, timestamptz) from public, anon, authenticated, service_role;
