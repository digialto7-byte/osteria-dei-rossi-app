-- DS-BQ-2: public.order_view gives the session four more keys, so the comanda's header can show who opened the table, when, and
-- the coperto from the order read alone:
--   openedAt     the session's opened_at (the same value as the tile's)
--   openedToday  business_date = today's business date (the same expression as tables_list)
--   openedBy     {displayName}: the opener's display name and no staff id
--   coperto      {perPerson, vatRate, total} or null when the session has none (the same numbers as the tile's)
-- The values come from app.table_session_json, so the order read and the tile cannot drift; the coperto's keys are picked by name,
-- so a key that helper gains later never reaches the waiter unseen. coperto.vatRate is a sale fact (a price component, not a cost):
-- it is allowed at that exact path only (lead decision DS-BQ-2 Q-D1; the cost-key guards exempt exactly session.coperto.vatRate).
-- The payload still carries no cost, margin, GP, food or recipe key, and no other VAT key.
-- Same signature, volatility, security definer and empty search_path; create or replace keeps the grants. Role gate, tenant filter and
-- errors (42501, P0002 session_not_found) are unchanged.

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
    'lines', coalesce((
      select jsonb_agg(app.order_line_json(l) order by l.course, l.created_at, l.id)
        from public.order_line l
       where l.tenant_id = v_tenant and l.table_session_id = s.id
         and not (l.voided_at is not null and l.fired_at is null)), '[]'::jsonb));
end
$$;
