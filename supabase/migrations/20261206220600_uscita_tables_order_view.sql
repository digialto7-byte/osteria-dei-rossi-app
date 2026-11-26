-- Comanda per uscita, M7 (docs/plans/2026-11-18-comanda-uscite.md section 3.10, step 17; ADR-049): the waiter reads.
--
--   * app.session_uscite (new, stable, closed to API roles): per session, over its sent, non-voided lines of uscita >= 1, cooking = the highest
--     uscita in the kitchen (not held), waiting = the lowest held uscita, cooking_done = every line of cooking is done (app.kitchen_line_done).
--     A session with no such line has no row. Drinks (uscita 0) are never in it.
--   * public.tables_list (re-created from 20261205100000, the same text plus one CTE, one left join and one key): every session object gains
--     uscite = {cooking, waiting, cookingDone}, or null when nothing of uscita >= 1 is sent. status is unchanged.
--   * app.session_unsent_lines (re-created from 20261205100000): every draft counts, a segue draft too (everything goes with the one send,
--     spec 2.3, 4 row 1).
--   * public.order_view (re-created from 20261206100000, the same text plus one key): uscite = [{uscita, state, calledAt, lineCount}] for every
--     uscita >= 1 with sent, non-voided lines, by uscita; state is waiting (held), done (every line done), else cooking; calledAt is the call's
--     six-decimal UTC text (as the kitchen board's) or null. Drinks and drafts are not in it.
-- Same signatures, security, search_path and grants (create or replace). No cost, price or VAT key is added.

create function app.session_uscite(p_tenant uuid, p_session_ids uuid[])
  returns table (table_session_id uuid, cooking smallint, waiting smallint, cooking_done boolean)
  language sql
  stable
  set search_path = ''
as $$
  with fl as (
    select l.table_session_id, l.uscita, l.id, app.line_held(p_tenant, l) as held
      from public.order_line l
     where l.tenant_id = p_tenant and l.table_session_id = any (p_session_ids)
       and l.fired_at is not null and l.voided_at is null and l.uscita >= 1
  ), agg as (
    select f.table_session_id, max(f.uscita) filter (where not f.held) as cooking, min(f.uscita) filter (where f.held) as waiting
      from fl f
     group by f.table_session_id
  )
  select a.table_session_id, a.cooking::smallint, a.waiting::smallint,
         a.cooking is not null
           and not exists (select 1 from fl f
                            where f.table_session_id = a.table_session_id and f.uscita = a.cooking and not f.held
                              and not app.kitchen_line_done(p_tenant, f.id))
    from agg a
$$;
revoke all on function app.session_uscite(uuid, uuid[]) from public, anon, authenticated, service_role;

create or replace function app.session_unsent_lines(p_tenant uuid, p_session_ids uuid[])
  returns table (table_session_id uuid, unsent_lines integer)
  language sql
  stable
  set search_path = ''
as $$
  select l.table_session_id, count(*)::integer
    from public.order_line l
   where l.tenant_id = p_tenant and l.table_session_id = any (p_session_ids)
     and l.state = 'draft'
   group by l.table_session_id
$$;
revoke all on function app.session_unsent_lines(uuid, uuid[]) from public, anon, authenticated, service_role;

create or replace function public.tables_list() returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_today date;
  v_now timestamptz;
begin
  perform app.require_service_reader();
  v_tenant := app.tenant_id();
  v_now := clock_timestamp();
  v_today := app.business_date(v_tenant, v_now);
  return jsonb_build_object(
    'businessDate', v_today,
    'tables', coalesce((
      with shown as (
        select distinct on (s.dining_table_id) s.*
          from public.table_session s
         where s.tenant_id = v_tenant and (s.closed_at is null or s.business_date = v_today)
         order by s.dining_table_id, (s.closed_at is null) desc, s.opened_at desc, s.id desc
      ), st as (
        select * from app.session_statuses(v_tenant, array(select h.id from shown h))
      ), un as (
        select * from app.session_unsent_lines(v_tenant, array(select h.id from shown h))
      ), us as (
        select * from app.session_uscite(v_tenant, array(select h.id from shown h))
      )
      select jsonb_agg(jsonb_build_object(
               'id', t.id,
               'name', t.name,
               'position', t.position,
               'status', case when jt.lead_id is not null and (h.id is null or h.closed_at is not null) then 'joined'
                              when h.id is null then 'free' else st.status end,
               'session', case when h.id is null or (jt.lead_id is not null and h.closed_at is not null) then null else jsonb_build_object(
                   'id', h.id,
                   'covers', h.covers,
                   'openedAt', h.opened_at,
                   'openedToday', h.business_date = v_today,
                   'waiter', jsonb_build_object('id', u.id, 'displayName', u.display_name),
                   'billRequested', h.bill_requested_at is not null,
                   'unsentCount', coalesce(un.unsent_lines, 0),
                   'uscite', case when us.table_session_id is null then null
                                  else jsonb_build_object('cooking', us.cooking, 'waiting', us.waiting, 'cookingDone', us.cooking_done) end,
                   'coperto', case when h.coperto_amount is null then null
                                   else jsonb_build_object('perPerson', trim_scale(h.coperto_amount),
                                                           'vatRate', trim_scale(h.coperto_vat_rate),
                                                           'total', trim_scale(h.coperto_total)) end) end)
               || case when jt.lead_id is not null and (h.id is null or h.closed_at is not null)
                       then jsonb_build_object('joinedTo', jsonb_build_object('id', jt.lead_id, 'name', jt.lead_name, 'overtime', jt.overtime)) else '{}'::jsonb end
               order by t.position, t.name collate "C", t.id)
        from public.dining_table t
        left join shown h on h.dining_table_id = t.id
        left join st on st.table_session_id = h.id
        left join un on un.table_session_id = h.id
        left join us on us.table_session_id = h.id
        left join public.app_user u on u.tenant_id = h.tenant_id and u.id = h.opened_by
        left join lateral (select j.lead_id, d.name as lead_name,
                                  -- Only for a joined tile: is the booking seated on the lead's OPEN session past its ends_at? Same rule as app.table_joined_to: an older booking that still holds the table
                                  -- (close_table releases nothing) is not the one. The lock does not end by the clock; the tile just says so (Q-R6, lead 2026-11-08).
                                  case when j.lead_id is null then null else exists (
                                    select 1 from public.reservation_table rt
                                      join public.reservation r on r.tenant_id = rt.tenant_id and r.id = rt.reservation_id
                                      join public.table_session ls on ls.tenant_id = r.tenant_id and ls.id = r.table_session_id
                                     where rt.tenant_id = v_tenant and rt.dining_table_id = t.id and rt.released_at is null
                                       and r.status = 'seated' and ls.closed_at is null and ls.dining_table_id = j.lead_id and r.ends_at < v_now) end as overtime
                             from (select app.table_joined_to(v_tenant, t.id) as lead_id) j
                             left join public.dining_table d on d.tenant_id = v_tenant and d.id = j.lead_id) jt on true
       where t.tenant_id = v_tenant and t.is_active
    ), '[]'::jsonb));
end
$$;

-- create or replace keeps the owner and the grants of tables_list (authenticated only); restated here so the file shows them.
revoke all on function public.tables_list() from public, anon, service_role;
grant execute on function public.tables_list() to authenticated;

create or replace function public.order_view(p_session uuid) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  s public.table_session;
  v_status text;
  v_head jsonb;
begin
  perform app.require_table_operator();
  v_tenant := app.tenant_id();
  select z.* into s from public.table_session z where z.tenant_id = v_tenant and z.id = p_session;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  select st.status into v_status from app.session_statuses(v_tenant, array[s.id]) st;
  v_head := app.table_session_json(v_tenant, s.id, false);
  return jsonb_build_object(
    'session', jsonb_build_object(
      'id', s.id,
      'tableId', s.dining_table_id,
      'tableName', s.table_name,
      'covers', s.covers,
      'status', v_status,
      'billRequested', s.bill_requested_at is not null,
      'closed', s.closed_at is not null,
      'openedAt', v_head -> 'openedAt',
      'openedToday', s.business_date = app.business_date(v_tenant, clock_timestamp()),
      'openedBy', jsonb_build_object('displayName', v_head -> 'waiter' -> 'displayName'),
      'coperto', case when jsonb_typeof(v_head -> 'coperto') = 'object'
                      then jsonb_build_object('perPerson', v_head -> 'coperto' -> 'perPerson',
                                              'vatRate', v_head -> 'coperto' -> 'vatRate',
                                              'total', v_head -> 'coperto' -> 'total')
                      else 'null'::jsonb end),
    'uscite', coalesce((
      select jsonb_agg(jsonb_build_object(
               'uscita', u.uscita,
               'state', case when u.held then 'waiting' when u.all_done then 'done' else 'cooking' end,
               'calledAt', case when c.called_at is null then 'null'::jsonb
                                else to_jsonb(to_char(c.called_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) end,
               'lineCount', u.line_count)
             order by u.uscita)
        from (select l.uscita, count(*)::integer as line_count, bool_or(app.line_held(v_tenant, l)) as held,
                     bool_and(app.kitchen_line_done(v_tenant, l.id)) as all_done
                from public.order_line l
               where l.tenant_id = v_tenant and l.table_session_id = s.id and l.fired_at is not null and l.voided_at is null and l.uscita >= 1
               group by l.uscita) u
        left join public.uscita_call c on c.tenant_id = v_tenant and c.table_session_id = s.id and c.uscita = u.uscita), '[]'::jsonb),
    'lines', coalesce((
      select jsonb_agg(app.order_line_json(l) order by l.course, l.created_at, l.id)
        from public.order_line l
       where l.tenant_id = v_tenant and l.table_session_id = s.id
         and not (l.voided_at is not null and l.fired_at is null)), '[]'::jsonb));
end
$$;

-- create or replace keeps the owner and the grants of order_view; restated here so the file shows them.
revoke all on function public.order_view(uuid) from public, anon, service_role;
grant execute on function public.order_view(uuid) to authenticated;
