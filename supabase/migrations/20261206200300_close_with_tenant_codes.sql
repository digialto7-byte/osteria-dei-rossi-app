-- SP1 step 6 (docs/plans/2026-11-15-sp01-tenant-config.md section 3.2, 5 step 6; platform plan 5.4 H20): close_table and the day-close report read the tenant's receipt and
-- payment lists (public.tenant_close_code, step 5, 20261206200200) instead of the fixed catalogue.
--   app.close_session_at  keeps the catalogue checks at their place (an unknown code answers as before, before the session is looked up); after the replay comparison and
--                         before the write it adds the tenant check: a code the tenant does not offer is P0001 receipt_type_invalid / payment_type_invalid, nothing written. A replay of an
--                         already-closed session with a since-deactivated code still answers changed false.
--   app.app_vs_register_json  the receipt and payment buckets are the tenant's active codes in position order, then any deactivated code that the day used (in catalogue order).
-- The CHECKs on table_session stay the catalogue bound. public.close_table is not re-created. Tenant #1 offers every code, so its payloads do not change (pgTAP 389).

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

create or replace function app.app_vs_register_json(p_tenant uuid, p_date date) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_total numeric;
  v_tables integer;
  v_covers integer;
  v_by_receipt jsonb;
  v_by_payment jsonb;
  v_missing jsonb;
  v_open_count integer;
  v_open_total numeric;
  r public.day_close;
  v_entries integer;
  v_register jsonb := null;
  v_difference jsonb := null;
  v_amount numeric;
begin
  select coalesce(sum(s.total), 0.00), count(*)::integer, coalesce(sum(s.covers), 0)::integer
    into v_total, v_tables, v_covers
    from public.table_session s
   where s.tenant_id = p_tenant and s.closed_at is not null and s.closed_business_date = p_date;

  -- The buckets (SP1 step 6, on step 5's lists; an empty list is [], never null): the tenant's active codes in position order, then any code that the day's closed sessions used and that is no longer active, in
  -- catalogue order, so a deactivated code never hides a day's totals. A deactivated code nobody used that day is not listed.
  select coalesce(jsonb_agg(jsonb_build_object('type', c.code, 'total', coalesce(x.total, 0.00), 'tables', coalesce(x.tables, 0)) order by c.grp, c.ord, c.code), '[]'::jsonb)
    into v_by_receipt
    from (select t.code, 0 as grp, t.position::bigint as ord
            from public.tenant_close_code t
           where t.tenant_id = p_tenant and t.kind = 'receipt' and t.is_active
          union all
          select k.code, 1, k.ord
            from unnest(app.receipt_types()) with ordinality k (code, ord)
           where k.code not in (select t.code from public.tenant_close_code t where t.tenant_id = p_tenant and t.kind = 'receipt' and t.is_active)
             and exists (select 1 from public.table_session s
                          where s.tenant_id = p_tenant and s.closed_at is not null and s.closed_business_date = p_date and s.receipt_type = k.code)) c
    left join (select s.receipt_type as code, sum(s.total) as total, count(*)::integer as tables
                 from public.table_session s
                where s.tenant_id = p_tenant and s.closed_at is not null and s.closed_business_date = p_date
                group by s.receipt_type) x on x.code = c.code;
  select coalesce(jsonb_agg(jsonb_build_object('type', c.code, 'total', coalesce(x.total, 0.00), 'tables', coalesce(x.tables, 0)) order by c.grp, c.ord, c.code), '[]'::jsonb)
    into v_by_payment
    from (select t.code, 0 as grp, t.position::bigint as ord
            from public.tenant_close_code t
           where t.tenant_id = p_tenant and t.kind = 'payment' and t.is_active
          union all
          select k.code, 1, k.ord
            from unnest(app.payment_type_codes()) with ordinality k (code, ord)
           where k.code not in (select t.code from public.tenant_close_code t where t.tenant_id = p_tenant and t.kind = 'payment' and t.is_active)
             and exists (select 1 from public.table_session s
                          where s.tenant_id = p_tenant and s.closed_at is not null and s.closed_business_date = p_date and s.payment_type = k.code)) c
    left join (select s.payment_type as code, sum(s.total) as total, count(*)::integer as tables
                 from public.table_session s
                where s.tenant_id = p_tenant and s.closed_at is not null and s.closed_business_date = p_date
                group by s.payment_type) x on x.code = c.code;
  select z.* into r from public.day_close z
   where z.tenant_id = p_tenant and z.business_date = p_date
   order by z.created_at desc, z.id desc limit 1;
  if found then
    select count(*)::integer into v_entries from public.day_close z where z.tenant_id = p_tenant and z.business_date = p_date;
    v_register := jsonb_build_object(
      'total', r.register_total, 'enteredAt', r.created_at, 'entries', v_entries,
      'enteredBy', (select jsonb_build_object('id', u.id, 'displayName', u.display_name)
                      from public.app_user u where u.tenant_id = p_tenant and u.id = r.created_by));
    -- App minus register (Q131); the percentage is of the register total, null when that is 0.
    v_amount := v_total - r.register_total;
    v_difference := jsonb_build_object(
      'amount', v_amount,
      'pct', case when r.register_total = 0 then null else round(v_amount / r.register_total * 100, 1) end);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'sessionId', s.id, 'tableName', s.table_name, 'covers', s.covers, 'closedAt', s.closed_at,
           'closedBy', (select jsonb_build_object('id', u.id, 'displayName', u.display_name)
                          from public.app_user u where u.tenant_id = p_tenant and u.id = s.closed_by),
           'receiptType', s.receipt_type, 'paymentType', s.payment_type, 'total', s.total) order by s.closed_at, s.id), '[]'::jsonb)
    into v_missing
    from public.table_session s
   where s.tenant_id = p_tenant and s.closed_at is not null and s.closed_business_date = p_date and s.missing_receipt;

  -- A table forgotten open shows up too: every open session opened on or before the date, at its bill as of now.
  select count(*)::integer, coalesce(sum((app.session_bill_json(p_tenant, s.id, null) ->> 'total')::numeric), 0.00)
    into v_open_count, v_open_total
    from public.table_session s
   where s.tenant_id = p_tenant and s.closed_at is null and s.business_date <= p_date;

  return jsonb_build_object(
    'businessDate', p_date,
    'asOf', clock_timestamp(),
    'app', jsonb_build_object('total', v_total, 'tables', v_tables, 'covers', v_covers,
                              'byReceiptType', v_by_receipt, 'byPaymentType', v_by_payment),
    'register', v_register,
    'difference', v_difference,
    'missingReceipts', v_missing,
    'openTables', jsonb_build_object('count', v_open_count, 'provisionalTotal', v_open_total),
    'lateOps', jsonb_build_object('count', app.late_op_count(p_tenant, p_date)));
end
$$;
revoke all on function app.close_session_at(uuid, uuid, uuid, jsonb, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.app_vs_register_json(uuid, date) from public, anon, authenticated, service_role;
