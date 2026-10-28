-- M19 step 6: the kitchen ticket list (M19 plan §3.1.8, §3.1.12, §3.2; ADR-019).
--   app.require_kitchen_reader   owner, admin, chef (42501 otherwise); the waiter has no kitchen list
--   app.kitchen_ticket_rows      the list for the business day of an instant (tenant cut-off); a pure read, so tests can fix the instant
--   public.kitchen_tickets       role check, then {asOf, truncated, tickets} for now
-- A ticket = the lines fired in one call for one table, one course and one segue value: (table_session_id, fired_at, course,
-- segue). Shown: lines fired in the business day of the instant, of sessions not closed; a line fired and then voided stays,
-- marked with its reason, so the kitchen stops cooking it (Q105). Ordered oldest first (fired_at), then table name (C
-- collation), course (enum order), segue false first; lines by creation instant, id. At most 200 tickets (the newest 200,
-- returned ascending) with `truncated`. No euro value anywhere: no unit price, cost, VAT or total, and every key passes the
-- chef regex of pgTAP 059. The key `sessionId|firedAt|course|segue` is the ticket id for the screen (firedAt in UTC with
-- microseconds). `fired_at > instant - 30 hours` bounds the read through order_line_fired_idx before the business-day filter.

create function app.require_kitchen_reader() returns void
  language plpgsql
  stable
  set search_path = ''
as $$
begin
  if app.role() is null or app.role() not in ('owner', 'admin', 'chef') then
    raise exception 'permission denied: the kitchen list needs owner, admin or chef' using errcode = '42501';
  end if;
end
$$;

create function app.kitchen_ticket_rows(p_tenant uuid, p_at timestamptz) returns jsonb
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
  ), grp as (
    select c.table_session_id, c.fired_at, c.course, c.segue, min(c.table_name) as table_name, min(c.covers) as covers,
           (array_agg(c.fired_by order by c.id))[1] as fired_by,
           jsonb_agg(jsonb_build_object(
               'id', c.id,
               'name', (select i.name from public.menu_item i where i.tenant_id = c.tenant_id and i.id = c.menu_item_id),
               'qty', trim_scale(c.qty),
               'note', c.note,
               'isShared', c.is_shared,
               'voided', c.voided_at is not null,
               'voidReason', c.void_reason) order by c.created_at, c.id) as lines
      from cand c
     group by c.table_session_id, c.fired_at, c.course, c.segue
  ), ranked as (
    select g.*, row_number() over (order by g.fired_at desc, g.table_name collate "C" desc, g.course desc, g.segue desc,
                                            g.table_session_id desc) as rn,
           count(*) over () as total
      from grp g
  )
  select jsonb_build_object(
           'truncated', coalesce(max(r.total), 0) > 200,
           'tickets', coalesce(jsonb_agg(
             jsonb_build_object(
               'key', r.table_session_id::text || '|' || to_char(r.fired_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
                      || '|' || r.course::text || '|' || r.segue::text,
               'sessionId', r.table_session_id,
               'tableName', r.table_name,
               'covers', r.covers,
               'course', r.course::text,
               'segue', r.segue,
               'firedAt', to_char(r.fired_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
               'firedBy', (select jsonb_build_object('id', u.id, 'displayName', u.display_name)
                             from public.app_user u where u.tenant_id = p_tenant and u.id = r.fired_by),
               'lines', r.lines)
             order by r.fired_at, r.table_name collate "C", r.course, r.segue, r.table_session_id), '[]'::jsonb))
    from ranked r
   where r.rn <= 200
$$;

create function public.kitchen_tickets() returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_at timestamptz;
  v_rows jsonb;
begin
  perform app.require_kitchen_reader();
  v_at := clock_timestamp();
  v_rows := app.kitchen_ticket_rows(app.tenant_id(), v_at);
  return jsonb_build_object('asOf', v_at, 'truncated', v_rows -> 'truncated', 'tickets', v_rows -> 'tickets');
end
$$;

revoke all on function app.require_kitchen_reader(), app.kitchen_ticket_rows(uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.kitchen_tickets() from public, anon, authenticated, service_role;
grant execute on function public.kitchen_tickets() to authenticated;
