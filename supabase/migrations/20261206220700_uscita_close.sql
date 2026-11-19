-- Comanda per uscita, M8 (docs/plans/2026-11-18-comanda-uscite.md section 3.11, step 18; ADR-049): the close guard.
--   app.close_session_at is re-created from 20261206200300 verbatim, plus one block after the unsent_lines refusal: held, non-voided lines (sent,
--   uscita >= 2 not called; app.line_held) refuse the close with P0001 uscita_waiting, detail {lineIds} (at most 50, by created_at and id), and
--   nothing is written. The session row is already locked FOR UPDATE at that point, and fire_course and call_uscita take it FOR SHARE, so a call
--   in flight either finishes first (and the close proceeds) or waits for the close. public.close_table is not re-created; a session with no
--   held line closes exactly as before.

create or replace function app.close_session_at(p_tenant uuid, p_user uuid, p_session uuid, p_body jsonb, p_at timestamptz) returns jsonb
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
  v_held jsonb;
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

  -- The tenant's own lists (SP1 step 5, tenant_close_code): a code the tenant does not offer is refused, after the replay answer above (a session closed with a
  -- code that was later switched off still answers changed false) and before anything is written. The catalogue checks above keep their place, so the error
  -- order for an unknown code is unchanged.
  if v_type <> all (app.tenant_receipt_types(p_tenant)) then
    raise exception 'receipt_type_invalid' using errcode = 'P0001';
  end if;
  if v_payment <> all (app.tenant_payment_types(p_tenant)) then
    raise exception 'payment_type_invalid' using errcode = 'P0001';
  end if;

  -- Dishes never sent would never come off stock (Q129). Ids only, at most 50.
  select jsonb_agg(d.id) into v_unsent
    from (select l.id from public.order_line l
           where l.tenant_id = p_tenant and l.table_session_id = p_session and l.state = 'draft'
           order by l.created_at, l.id limit 50) d;
  if v_unsent is not null then
    raise exception 'unsent_lines' using errcode = 'P0001', detail = jsonb_build_object('lineIds', v_unsent)::text;
  end if;

  -- Comanda per uscita (M8): a dish still waiting for its uscita has never been made. Ids only, at most 50; call the uscita or void the
  -- dishes not_prepared, then close.
  select jsonb_agg(d.id) into v_held
    from (select l.id from public.order_line l
           where l.tenant_id = p_tenant and l.table_session_id = p_session and app.line_held(p_tenant, l)
           order by l.created_at, l.id limit 50) d;
  if v_held is not null then
    raise exception 'uscita_waiting' using errcode = 'P0001', detail = jsonb_build_object('lineIds', v_held)::text;
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
