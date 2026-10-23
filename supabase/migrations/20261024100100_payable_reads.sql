-- M9 step 2: the read functions of the payables screens (M9 plan §3.2): the list, one payable
-- with its history and allowed actions, and the supplier statement. All three are SECURITY DEFINER
-- with the role check first, an explicit tenant filter and "today" at the venue. Amounts are JSON
-- numbers with two decimals; formatting happens in TypeScript only.

-- Same procedure as 20261024100000, with one change: the audit row is stamped with
-- clock_timestamp() so that the history order survives concurrent and same-transaction changes.
create or replace function public.set_payable_status(
  p_payable uuid,
  p_status public.payable_status,
  p_paid_on date default null,
  p_reason text default null,
  p_reversal boolean default false
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
  v_reason text;
  v_p public.payable%rowtype;
  v_tz text;
  v_action text;
  v_new_paid_on date;
begin
  perform app.require_payables_writer();

  if p_reason is not null and length(btrim(p_reason)) > 200 then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;
  v_reason := nullif(btrim(p_reason), '');
  if p_reason is not null and v_reason is null and not coalesce(p_reversal, false) then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;

  select p.* into v_p
    from public.payable p
   where p.id = p_payable and p.tenant_id = v_tenant
     for no key update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select t.timezone into v_tz from public.tenant t where t.id = v_tenant;

  -- Paid date rules (plan §3.1.2): required for paid, refused otherwise, never in the future.
  if p_status = 'paid' and p_paid_on is null then
    raise exception 'paid_on_required' using errcode = 'P0001';
  end if;
  if p_status <> 'paid' and p_paid_on is not null then
    raise exception 'paid_on_not_allowed' using errcode = 'P0001';
  end if;
  if p_paid_on > app.venue_date(now(), v_tz) then
    raise exception 'paid_on_future' using errcode = 'P0001';
  end if;

  if coalesce(p_reversal, false) then
    if v_p.status <> 'paid' then
      raise exception 'payable_not_paid' using errcode = 'P0001';
    end if;
    if p_status <> 'open' then
      raise exception 'reversal_target_invalid' using errcode = 'P0001';
    end if;
    if v_reason is null then
      raise exception 'reason_required' using errcode = 'P0001';
    end if;
    v_action := 'payable.payment_reversed';
  else
    if p_status = v_p.status and p_paid_on is not distinct from v_p.paid_on then
      return jsonb_build_object('payableId', v_p.id, 'status', v_p.status,
                                'paidOn', v_p.paid_on, 'changed', false);
    end if;
    if v_p.status = 'paid' then
      raise exception 'payable_paid_locked' using errcode = 'P0001';
    end if;
    if not (p_status = any (app.payable_allowed_targets(v_p.status))) then
      raise exception 'payable_transition_invalid' using errcode = 'P0001';
    end if;
    v_action := 'payable.status_changed';
  end if;

  v_new_paid_on := case when p_status = 'paid' then p_paid_on end;

  perform set_config('app.payable_transition', 'on', true);
  update public.payable
     set status = p_status,
         paid_on = v_new_paid_on,
         paid_at = case when p_status = 'paid' then clock_timestamp() end
   where id = v_p.id;
  perform set_config('app.payable_transition', '', true);

  -- clock_timestamp(), not the transaction's now(): the history of a payable is ordered by this
  -- column, and a transaction that started earlier can take the row lock later.
  insert into public.audit_event (tenant_id, entity_type, entity_id, action, before, after, reason,
                                  created_at, created_by)
  values (v_tenant, 'payable', v_p.id, v_action,
          jsonb_build_object('status', v_p.status, 'paid_on', v_p.paid_on),
          jsonb_build_object('status', p_status, 'paid_on', v_new_paid_on),
          v_reason, clock_timestamp(), app.app_user_id());

  return jsonb_build_object('payableId', v_p.id, 'status', p_status, 'paidOn', v_new_paid_on,
                            'changed', true);
end
$$;;

-- One PayableItem (plan §3.2). Internal: no API role can execute it.
create function app.payable_item(
  p_payable public.payable, p_invoice_number text, p_invoice_date date, p_supplier_name text,
  p_today date
) returns jsonb
  language sql immutable
  set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_payable.id,
    'invoiceId', p_payable.invoice_id,
    'invoiceNumber', p_invoice_number,
    'invoiceDate', p_invoice_date,
    'supplierId', p_payable.supplier_id,
    'supplierName', p_supplier_name,
    'amount', p_payable.amount,
    'dueDate', p_payable.due_date,
    'status', p_payable.status,
    'paidOn', p_payable.paid_on,
    'daysToDue', p_payable.due_date - p_today,
    'overdue', p_payable.status <> 'paid' and p_payable.due_date < p_today)
$$;
revoke all on function app.payable_item(public.payable, text, date, text, date)
  from public, anon, authenticated, service_role;

create function public.payable_list(
  p_filter text default 'unpaid',
  p_supplier uuid default null,
  p_cursor_date date default null,
  p_cursor_id uuid default null,
  p_limit integer default 50
) returns jsonb
  language plpgsql stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
  v_today date;
  v_asc boolean := p_filter = 'unpaid';
  v_items jsonb;
  v_cursor jsonb;
  v_totals jsonb := null;
begin
  perform app.require_payables_reader();
  if p_filter is null or p_filter not in ('unpaid', 'paid', 'all')
     or p_limit is null or p_limit < 1 or p_limit > 200
     or (p_cursor_date is null) <> (p_cursor_id is null) then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;
  select app.venue_date(now(), t.timezone) into v_today
    from public.tenant t where t.id = v_tenant;

  with ranked as (
    select p, i.number_raw, i.invoice_date, s.name as supplier_name,
           case when p_filter = 'paid' then p.paid_on else p.due_date end as k,
           row_number() over (
             order by case when v_asc then case when p_filter = 'paid' then p.paid_on else p.due_date end end asc,
                      case when not v_asc then case when p_filter = 'paid' then p.paid_on else p.due_date end end desc,
                      case when v_asc then p.id end asc,
                      case when not v_asc then p.id end desc) as rn
      from public.payable p
      join public.invoice i on i.tenant_id = p.tenant_id and i.id = p.invoice_id
      join public.supplier s on s.tenant_id = p.tenant_id and s.id = p.supplier_id
     where p.tenant_id = v_tenant
       and (p_supplier is null or p.supplier_id = p_supplier)
       and case p_filter when 'unpaid' then p.status <> 'paid'
                         when 'paid' then p.status = 'paid'
                         else true end
       and (p_cursor_date is null
            or (v_asc and (case when p_filter = 'paid' then p.paid_on else p.due_date end, p.id)
                          > (p_cursor_date, p_cursor_id))
            or (not v_asc and (case when p_filter = 'paid' then p.paid_on else p.due_date end, p.id)
                          < (p_cursor_date, p_cursor_id)))
  ), page as (
    select * from ranked where rn <= p_limit + 1
  )
  select coalesce(jsonb_agg(app.payable_item(page.p, page.number_raw, page.invoice_date,
                                             page.supplier_name, v_today) order by page.rn)
                    filter (where page.rn <= p_limit), '[]'::jsonb),
         (select jsonb_build_object('date', x.k, 'id', (x.p).id)
            from page x
           where x.rn = p_limit and exists (select 1 from page y where y.rn = p_limit + 1))
    into v_items, v_cursor
    from page;

  if p_filter = 'unpaid' then
    select jsonb_build_object('count', count(*), 'amount', coalesce(sum(p.amount), 0::numeric(12, 2)))
      into v_totals
      from public.payable p
     where p.tenant_id = v_tenant and p.status <> 'paid'
       and (p_supplier is null or p.supplier_id = p_supplier);
  end if;

  return jsonb_build_object('items', v_items, 'nextCursor', v_cursor, 'totals', v_totals,
                            'today', v_today);
end
$$;

create function public.payable_detail(p_payable uuid) returns jsonb
  language plpgsql stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
  v_today date;
  v_p public.payable%rowtype;
  v_number text;
  v_invoice_date date;
  v_supplier text;
  v_creator text;
  v_history jsonb;
begin
  perform app.require_payables_reader();
  select p.* into v_p from public.payable p where p.id = p_payable and p.tenant_id = v_tenant;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select app.venue_date(now(), t.timezone) into v_today
    from public.tenant t where t.id = v_tenant;
  select i.number_raw, i.invoice_date into v_number, v_invoice_date
    from public.invoice i where i.tenant_id = v_tenant and i.id = v_p.invoice_id;
  select s.name into v_supplier
    from public.supplier s where s.tenant_id = v_tenant and s.id = v_p.supplier_id;
  select u.display_name into v_creator
    from public.app_user u where u.tenant_id = v_tenant and u.id = v_p.created_by;

  select coalesce(jsonb_agg(h.e order by h.at, h.ord), '[]'::jsonb) into v_history
    from (
      select v_p.created_at as at, 0 as ord,
             jsonb_build_object('action', 'created', 'fromStatus', null, 'toStatus', 'open',
                                'paidOn', null, 'reason', null, 'at', v_p.created_at,
                                'byName', v_creator) as e
      union all
      select a.created_at, 1,
             jsonb_build_object('action', a.action, 'fromStatus', a.before ->> 'status',
                                'toStatus', a.after ->> 'status', 'paidOn', a.after ->> 'paid_on',
                                'reason', a.reason, 'at', a.created_at, 'byName', u.display_name)
        from public.audit_event a
        left join public.app_user u on u.tenant_id = a.tenant_id and u.id = a.created_by
       where a.tenant_id = v_tenant and a.entity_type = 'payable' and a.entity_id = v_p.id
    ) h;

  return jsonb_build_object(
    'payable', app.payable_item(v_p, v_number, v_invoice_date, v_supplier, v_today)
               || jsonb_build_object('grossAmount', v_p.gross_amount,
                                     'creditedAmount', v_p.credited_amount,
                                     'dueDateSource', v_p.due_date_source,
                                     'paidAt', v_p.paid_at),
    'allowedStatuses', to_jsonb(app.payable_allowed_targets(v_p.status)),
    'canReversePayment', v_p.status = 'paid',
    'history', v_history);
end
$$;

create function public.supplier_statement(p_supplier uuid) returns jsonb
  language plpgsql stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
  v_today date;
  v_name text;
  v_vat text;
  v_invoices jsonb;
  v_credits jsonb;
  v_totals jsonb;
begin
  perform app.require_payables_reader();
  select s.name, s.vat_number into v_name, v_vat
    from public.supplier s where s.id = p_supplier and s.tenant_id = v_tenant;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select app.venue_date(now(), t.timezone) into v_today
    from public.tenant t where t.id = v_tenant;

  select coalesce(jsonb_agg(app.payable_item(p, i.number_raw, i.invoice_date, v_name, v_today)
                            order by p.due_date, p.id), '[]'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object(
                    'payableId', p.id, 'invoiceId', p.invoice_id, 'invoiceNumber', i.number_raw,
                    'invoiceDate', i.invoice_date, 'creditedAmount', p.credited_amount)
                  order by p.due_date, p.id) filter (where p.credited_amount > 0), '[]'::jsonb),
         jsonb_build_object(
           'invoicesTotal', coalesce(sum(p.gross_amount), 0::numeric(12, 2)),
           'creditsTotal', coalesce(sum(p.credited_amount), 0::numeric(12, 2)),
           'balance', coalesce(sum(p.gross_amount) - sum(p.credited_amount), 0::numeric(12, 2)),
           'disputedAmount', coalesce(sum(p.amount) filter (where p.status = 'disputed'),
                                      0::numeric(12, 2)))
    into v_invoices, v_credits, v_totals
    from public.payable p
    join public.invoice i on i.tenant_id = p.tenant_id and i.id = p.invoice_id
   where p.tenant_id = v_tenant and p.supplier_id = p_supplier and p.status <> 'paid';

  return jsonb_build_object(
    'supplier', jsonb_build_object('id', p_supplier, 'name', v_name, 'vatNumber', v_vat),
    'asOf', v_today, 'invoices', v_invoices, 'credits', v_credits, 'totals', v_totals);
end
$$;

revoke all on function public.payable_list(text, uuid, date, uuid, integer),
  public.payable_detail(uuid), public.supplier_statement(uuid) from public, anon, service_role;
grant execute on function public.payable_list(text, uuid, date, uuid, integer),
  public.payable_detail(uuid), public.supplier_statement(uuid) to authenticated;
