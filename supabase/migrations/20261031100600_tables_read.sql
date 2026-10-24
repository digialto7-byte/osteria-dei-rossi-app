-- M17 step 7: tables_list, the waiter's table grid (M17 plan §3.1.6, §3.2; ADR-016).
-- Owner, admin, waiter (the chef gets 42501). One set-based query: every active table, ordered by position, name, id,
-- with the session shown for it and the derived status (app.session_statuses, which joins the M19 stub).
-- The session shown for a table is its open session; otherwise its latest session (by opened_at, id) whose business
-- date is today's and which is closed (status "closed", Q68 default); otherwise none (status "free"). A closed table can
-- be opened again at once. The payload carries no cost, margin or recipe key.

create function public.tables_list() returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_today date;
begin
  perform app.require_service_reader();
  v_tenant := app.tenant_id();
  v_today := app.business_date(v_tenant, clock_timestamp());
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
      )
      select jsonb_agg(jsonb_build_object(
               'id', t.id,
               'name', t.name,
               'position', t.position,
               'status', case when h.id is null then 'free' else st.status end,
               'session', case when h.id is null then null else jsonb_build_object(
                   'id', h.id,
                   'covers', h.covers,
                   'openedAt', h.opened_at,
                   'openedToday', h.business_date = v_today,
                   'waiter', jsonb_build_object('id', u.id, 'displayName', u.display_name),
                   'billRequested', h.bill_requested_at is not null,
                   'coperto', case when h.coperto_amount is null then null
                                   else jsonb_build_object('perPerson', trim_scale(h.coperto_amount),
                                                           'vatRate', trim_scale(h.coperto_vat_rate),
                                                           'total', trim_scale(h.coperto_total)) end) end)
               order by t.position, t.name collate "C", t.id)
        from public.dining_table t
        left join shown h on h.dining_table_id = t.id
        left join st on st.table_session_id = h.id
        left join public.app_user u on u.tenant_id = h.tenant_id and u.id = h.opened_by
       where t.tenant_id = v_tenant and t.is_active
    ), '[]'::jsonb));
end
$$;

revoke all on function public.tables_list() from public, anon, authenticated, service_role;
grant execute on function public.tables_list() to authenticated;
