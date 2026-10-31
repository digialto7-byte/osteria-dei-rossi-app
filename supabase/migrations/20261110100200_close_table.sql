-- M21 step 3 (docs/plans/2026-10-30-m21-bill-close.md §3.1.3, §3.3; ADR-023; AT1, AT4): public.close_table.
--
-- One transaction: role, then the body, then the session FOR UPDATE (it waits for every line writer, which all hold the session FOR SHARE),
-- then in this order: already closed? (a replay of the same close answers changed false, anything else is session_closed), unsent drafts?
-- (unsent_lines, DETAIL ids only), a stale preview? (bill_changed), and last the write. Nothing is written on a refusal. The closing instant
-- decides closed_business_date (the Q18 cut-off, DST-safe through app.business_date). The total is the bill's, frozen on the row.
-- The work after the role check is app.close_session_at, so pgTAP can close at a fixed instant.
--
-- Errors: 42501 (role), 22023 invalid_request (shape), P0002 session_not_found (also for another tenant's session), P0001 session_closed,
-- unsent_lines, bill_changed, receipt_type_invalid, receipt_number_invalid, payment_type_invalid.

create function app.close_session_at(p_tenant uuid, p_user uuid, p_session uuid, p_body jsonb, p_at timestamptz) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_type text;
  v_number text;
  v_payment text;
  v_token text;
  v_unsent jsonb;
  v_bill jsonb;
  s public.table_session;
begin
  perform app.menu_keys_ok(p_body, array['receiptType', 'receiptNumber', 'paymentType', 'billToken'],
                           array['receiptType', 'receiptNumber', 'paymentType', 'billToken']);
  if jsonb_typeof(p_body -> 'receiptType') <> 'string' or jsonb_typeof(p_body -> 'paymentType') <> 'string'
     or jsonb_typeof(p_body -> 'billToken') <> 'string' or jsonb_typeof(p_body -> 'receiptNumber') not in ('string', 'null') then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  v_token := p_body ->> 'billToken';
  if v_token !~ '^[0-9a-f]{32}$' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  v_type := p_body ->> 'receiptType';
  if v_type <> all (app.receipt_types()) then
    raise exception 'receipt_type_invalid' using errcode = 'P0001';
  end if;
  v_payment := p_body ->> 'paymentType';
  if v_payment <> all (app.payment_type_codes()) then
    raise exception 'payment_type_invalid' using errcode = 'P0001';
  end if;
  -- Trimmed; an empty string means "no number" (the table is closed and flagged, never refused).
  v_number := nullif(regexp_replace(coalesce(p_body ->> 'receiptNumber', ''), '^\s+|\s+$', '', 'g'), '');
  if v_number is not null and v_number !~ '^[0-9A-Za-z][0-9A-Za-z/.-]{0,19}$' then
    raise exception 'receipt_number_invalid' using errcode = 'P0001';
  end if;

  select z.* into s from public.table_session z where z.tenant_id = p_tenant and z.id = p_session for update;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;

  if s.closed_at is not null then
    if s.receipt_type = v_type and s.receipt_number is not distinct from v_number and s.payment_type = v_payment then
      return jsonb_build_object('changed', false, 'bill', app.session_bill_json(p_tenant, p_session, null));
    end if;
    raise exception 'session_closed' using errcode = 'P0001';
  end if;

  -- Dishes never sent would never come off stock (Q129). Ids only, at most 50.
  select jsonb_agg(d.id) into v_unsent
    from (select l.id from public.order_line l
           where l.tenant_id = p_tenant and l.table_session_id = p_session and l.state = 'draft'
           order by l.created_at, l.id limit 50) d;
  if v_unsent is not null then
    raise exception 'unsent_lines' using errcode = 'P0001', detail = jsonb_build_object('lineIds', v_unsent)::text;
  end if;

  -- The session lock keeps every line writer out, so this bill is the one that gets frozen.
  v_bill := app.session_bill_json(p_tenant, p_session, null);
  if v_bill ->> 'billToken' <> v_token then
    raise exception 'bill_changed' using errcode = 'P0001';
  end if;

  update public.table_session
     set closed_at = p_at, closed_by = p_user, closed_business_date = app.business_date(p_tenant, p_at),
         receipt_type = v_type, receipt_number = v_number, payment_type = v_payment, total = (v_bill ->> 'total')::numeric,
         updated_at = p_at, updated_by = p_user
   where tenant_id = p_tenant and id = p_session;
  return jsonb_build_object('changed', true, 'bill', app.session_bill_json(p_tenant, p_session, null));
end
$$;

create function public.close_table(p_session uuid, p_body jsonb) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  perform app.require_table_operator();
  return app.close_session_at(app.tenant_id(), app.app_user_id(), p_session, p_body, clock_timestamp());
end
$$;

revoke all on function app.close_session_at(uuid, uuid, uuid, jsonb, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.close_table(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.close_table(uuid, jsonb) to authenticated;
