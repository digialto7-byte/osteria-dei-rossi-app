-- M21 step 5 (docs/plans/2026-10-30-m21-bill-close.md §3.1.4, §3.1.6-3.1.7, §3.2; ADR-023; AT1, AT3, AT4): the end of the day.
--
--   public.enter_day_close    owner and admin: the register total of a business date as a new append-only row (the latest row of a date is in
--                             force); the reply carries the report, so the difference is visible at once (AT3). Money comes in as a decimal
--                             STRING so the value stays exact from the keyboard to numeric.
--   public.app_vs_register    owner and admin: the same report, computed live on each call (no cache, no job).
-- The report counts a table on closed_business_date (the business date of the close, Q128), lists the tables closed without a receipt number,
-- the tables still open, and the late ops of other phones that M20 refused after a close (T2: a raised session_closed is stored as
-- {sqlstate, message, detail}, a returned one as {conflict: {reason}}). Fatture are in the app total and shown apart (Q130).

create function app.require_day_closer() returns void
  language plpgsql
  stable
  set search_path = ''
as $$
begin
  if app.role() is null or app.role() not in ('owner', 'admin') then
    raise exception 'permission denied: the day close needs owner or admin' using errcode = '42501';
  end if;
end
$$;

-- null = today's business date; a date from 62 days back to today's is accepted, anything else is business_date_invalid.
create function app.day_close_range_ok(p_tenant uuid, p_date date) returns date
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_today date := app.business_date(p_tenant, now());
begin
  if p_date is null then
    return v_today;
  end if;
  if p_date > v_today or p_date < v_today - 62 then
    raise exception 'business_date_invalid' using errcode = 'P0001';
  end if;
  return p_date;
end
$$;

-- Ops a phone sent that a closed table refused, received on the business date: outcome conflict with reason session_closed.
create function app.late_op_count(p_tenant uuid, p_date date) returns integer
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select count(*)::integer
    from public.applied_op a
   where a.tenant_id = p_tenant
     and a.outcome = 'conflict'
     and a.received_at >= ((p_date::timestamp - interval '2 days') at time zone 'UTC')
     and a.received_at <= ((p_date::timestamp + interval '3 days') at time zone 'UTC')
     and (a.result ->> 'message' = 'session_closed' or a.result -> 'conflict' ->> 'reason' = 'session_closed')
     and app.business_date(p_tenant, a.received_at) = p_date
$$;

create function app.app_vs_register_json(p_tenant uuid, p_date date) returns jsonb
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

  select jsonb_agg(jsonb_build_object('type', c.code, 'total', coalesce(x.total, 0.00), 'tables', coalesce(x.tables, 0)) order by c.ord)
    into v_by_receipt
    from unnest(app.receipt_types()) with ordinality c (code, ord)
    left join (select s.receipt_type as code, sum(s.total) as total, count(*)::integer as tables
                 from public.table_session s
                where s.tenant_id = p_tenant and s.closed_at is not null and s.closed_business_date = p_date
                group by s.receipt_type) x on x.code = c.code;
  select jsonb_agg(jsonb_build_object('type', c.code, 'total', coalesce(x.total, 0.00), 'tables', coalesce(x.tables, 0)) order by c.ord)
    into v_by_payment
    from unnest(app.payment_type_codes()) with ordinality c (code, ord)
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

create function public.app_vs_register(p_date date default null) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  perform app.require_day_closer();
  return app.app_vs_register_json(app.tenant_id(), app.day_close_range_ok(app.tenant_id(), p_date));
end
$$;

create function public.enter_day_close(p_body jsonb) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user uuid;
  v_date date := null;
  v_amount numeric;
  v_last numeric;
  v_changed boolean := true;
begin
  perform app.require_day_closer();
  v_tenant := app.tenant_id();
  v_user := app.app_user_id();
  perform app.menu_keys_ok(p_body, array['businessDate', 'registerTotal'], array['registerTotal']);
  if jsonb_typeof(p_body -> 'registerTotal') <> 'string' or (p_body ->> 'registerTotal') !~ '^[0-9]{1,7}(\.[0-9]{1,2})?$' then
    raise exception 'register_total_invalid' using errcode = 'P0001';
  end if;
  v_amount := (p_body ->> 'registerTotal')::numeric;
  if p_body ? 'businessDate' then
    if jsonb_typeof(p_body -> 'businessDate') <> 'string' or (p_body ->> 'businessDate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'invalid_request' using errcode = '22023';
    end if;
    begin
      v_date := (p_body ->> 'businessDate')::date;
    exception when others then
      raise exception 'invalid_request' using errcode = '22023';
    end;
  end if;
  v_date := app.day_close_range_ok(v_tenant, v_date);

  -- One writer per (tenant, date): a second call waits here and then sees the first one's row.
  perform pg_advisory_xact_lock(hashtextextended('day_close:' || v_tenant::text || ':' || v_date::text, 0));
  select z.register_total into v_last from public.day_close z
   where z.tenant_id = v_tenant and z.business_date = v_date
   order by z.created_at desc, z.id desc limit 1;
  if found and v_last = v_amount then
    v_changed := false;
  else
    -- clock_timestamp(), not the default now(): two entries of one transaction must still order.
    insert into public.day_close (tenant_id, business_date, register_total, created_at, created_by)
      values (v_tenant, v_date, v_amount, clock_timestamp(), v_user);
  end if;
  return jsonb_build_object('changed', v_changed, 'report', app.app_vs_register_json(v_tenant, v_date));
end
$$;

revoke all on function app.require_day_closer(), app.day_close_range_ok(uuid, date), app.late_op_count(uuid, date),
  app.app_vs_register_json(uuid, date) from public, anon, authenticated, service_role;
revoke all on function public.app_vs_register(date), public.enter_day_close(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.app_vs_register(date), public.enter_day_close(jsonb) to authenticated;
