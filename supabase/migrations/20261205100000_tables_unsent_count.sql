-- BQ-1: every tile that has a session gets session.unsentCount, an integer >= 0 (docs/plans/2026-11-14-bq1-tables-unsent-count.md).
-- It counts the session's order lines that are drafts and not "a seguire": the server half of unsentLines in src/lib/orders/order-view.ts
-- (QW5's rule; keep the two in step). A closed session counts 0 (close_table refuses while any draft exists). The bill and close_table
-- keep their wider rule (any draft) on purpose.
--   app.session_unsent_lines   NEW helper, same shape and ACL as app.session_fired_lines (no API role can execute it)
--   public.tables_list         REPLACED on purpose (create or replace, same signature, security and grants as 20261124100650): one new CTE, one new
--                              left join and one new key; everything else is the text of 20261124100650. Its md5 pins (pgTAP 222, 229, 296, 301) move to this body.

create function app.session_unsent_lines(p_tenant uuid, p_session_ids uuid[])
  returns table (table_session_id uuid, unsent_lines integer)
  language sql
  stable
  set search_path = ''
as $$
  select l.table_session_id, count(*)::integer
    from public.order_line l
   where l.tenant_id = p_tenant and l.table_session_id = any (p_session_ids)
     and l.state = 'draft' and not l.segue
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
