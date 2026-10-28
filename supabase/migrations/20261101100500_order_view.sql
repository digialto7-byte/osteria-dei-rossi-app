-- M18 step 6: order_view (M18 plan §3.1.9, §3.2; ADR-017). Owner, admin and waiter (the chef gets 42501 until M19's
-- kitchen tickets). One set-based read of a session and its lines for the waiter's screen:
--   {session: {id, tableId, tableName, covers, status, billRequested, closed}, lines: [line]}
-- Lines are ordered by course (enum order), creation instant, id. A line removed before the fire (voided and never
-- fired) is left out; a line fired and then voided stays, with state voided. The status comes from M17's one
-- derivation (app.session_statuses). The payload carries no cost, margin, VAT, GP, food or recipe key.
-- Errors: 42501 (role), P0002 session_not_found (also for another tenant's session).

create function public.order_view(p_session uuid) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  s public.table_session;
  v_status text;
begin
  perform app.require_table_operator();
  v_tenant := app.tenant_id();
  select z.* into s from public.table_session z where z.tenant_id = v_tenant and z.id = p_session;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  select st.status into v_status from app.session_statuses(v_tenant, array[s.id]) st;
  return jsonb_build_object(
    'session', jsonb_build_object(
      'id', s.id,
      'tableId', s.dining_table_id,
      'tableName', s.table_name,
      'covers', s.covers,
      'status', v_status,
      'billRequested', s.bill_requested_at is not null,
      'closed', s.closed_at is not null),
    'lines', coalesce((
      select jsonb_agg(app.order_line_json(l) order by l.course, l.created_at, l.id)
        from public.order_line l
       where l.tenant_id = v_tenant and l.table_session_id = s.id
         and not (l.voided_at is not null and l.fired_at is null)), '[]'::jsonb));
end
$$;

revoke all on function public.order_view(uuid) from public, anon, authenticated, service_role;
grant execute on function public.order_view(uuid) to authenticated;
