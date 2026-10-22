-- M5 step 6: approve_invoice and invoice_approval_preview (M5 plan §3.1, §3.3, §3.4).
-- Both are SECURITY DEFINER, search_path = '', and follow the same four rules as the review
-- procedures: (a) the role is checked first (app.require_invoice_approver: owner, admin), (b) the
-- search_path is empty, (c) the invoice is looked up with app.tenant_id() and every other query is
-- filtered by that invoice's tenant, (d) execute is granted to authenticated only. The ledgers have
-- no INSERT grant for any API role: these rows are written here, as the owner of this function.

-- What approving would post, read-only: the same computation approve_invoice runs, so the review
-- screen shows the numbers that will be posted. Any status; the blockers are listed only for an
-- invoice in review. Costs: this carries prices, so only owner and admin may call it (the chef
-- never sees a EUR cost).
create function public.invoice_approval_preview(p_invoice uuid, p_location uuid default null)
  returns jsonb
  language plpgsql stable
  security definer
  set search_path = ''
as $$
declare
  v public.invoice;
  v_blockers jsonb := '[]'::jsonb;
  v_due record;
  v_lines jsonb;
  v_receipts int;
  v_credited numeric;
  v_gross numeric;
  v_locations jsonb;
  v_loc_count int;
  v_loc_default uuid;
begin
  perform app.require_invoice_approver();

  select * into v
    from public.invoice i
   where i.id = p_invoice and i.tenant_id = (select app.tenant_id());
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v.status = 'review' then
    v_blockers := app.approval_blockers(p_invoice, p_location);
  end if;
  select * into v_due from app.resolve_due_date(p_invoice);

  select coalesce(jsonb_agg(jsonb_build_object(
           'lineId', a.line_id, 'receivedQty', a.received_qty, 'baseUnit', a.base_unit,
           'unitPrice', a.unit_price, 'creditedAmount', a.credited_amount)
           order by a.position, a.sub_position), '[]'::jsonb),
         count(*) filter (where a.is_stock and a.received_qty > 0),
         coalesce(sum(a.credited_amount), 0)
    into v_lines, v_receipts, v_credited
    from app.approval_lines(p_invoice) a;
  v_gross := round(v.gross_total, 2);

  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.name, x.id), '[]'::jsonb),
         count(*), case when count(*) = 1 then min(x.id::text)::uuid end
    into v_locations, v_loc_count, v_loc_default
    from public.location x
   where x.tenant_id = v.tenant_id and x.is_active;

  return jsonb_build_object(
    'status', v.status,
    'blockers', v_blockers,
    'receiptDate', app.receipt_date(p_invoice),
    'payable', jsonb_build_object(
      'grossAmount', v_gross, 'creditedAmount', v_credited, 'amount', v_gross - v_credited,
      'dueDate', v_due.due_date, 'dueDateSource', v_due.source),
    'receipts', v_receipts,
    'lines', v_lines,
    'locations', jsonb_build_object(
      'required', v_loc_count > 1, 'options', v_locations, 'defaultId', v_loc_default));
end
$$;

-- One transaction: receipts (lot + movement), price history, last_price, payable, status, audit.
-- Either all of it is written or none (a failure anywhere rolls the whole function back). Raises
-- P0002 not_found, and P0001 with the first applicable code of plan §3.1.4.
create function public.approve_invoice(p_invoice uuid, p_location uuid default null)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v public.invoice;
  v_lock bigint;
  v_blockers jsonb;
  v_lines app.approval_line[];
  v_date date;
  v_loc uuid;
  v_due record;
  v_user uuid := app.app_user_id();
  v_gross numeric;
  v_credited numeric;
  v_payable public.payable;
  v_receipts int;
begin
  perform app.require_invoice_approver();

  -- The invoice first, as every review procedure does: one lock order everywhere.
  select * into v
    from public.invoice i
   where i.id = p_invoice and i.tenant_id = (select app.tenant_id())
     for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v.status = 'approved' then
    raise exception 'invoice_already_approved' using errcode = 'P0001';
  elsif v.status = 'rejected' then
    raise exception 'invoice_rejected' using errcode = 'P0001';
  elsif v.status = 'duplicate' then
    raise exception 'duplicate_invoice' using errcode = 'P0001';
  elsif v.status <> 'review' then
    raise exception 'invoice_not_in_review' using errcode = 'P0001';
  end if;

  -- The duplicate key's lock, so a concurrent extraction of the same document cannot slip past the
  -- live-duplicate check below.
  v_lock := app.invoice_dup_lock_key(
    v.tenant_id, v.supplier_vat, v.supplier_name, v.number_raw, v.invoice_date);
  if v_lock is not null then
    perform pg_advisory_xact_lock(v_lock);
  end if;

  v_blockers := app.approval_blockers(p_invoice, p_location);
  if jsonb_array_length(v_blockers) > 0 then
    raise exception '%', v_blockers -> 0 ->> 'code' using errcode = 'P0001';
  end if;

  -- One read of the lines, after the invoice lock: every insert below uses this same view.
  v_lines := array(select a from app.approval_lines(p_invoice) a);
  v_date := app.receipt_date(p_invoice);
  v_loc := app.resolve_location(v.tenant_id, p_location);
  select * into v_due from app.resolve_due_date(p_invoice);

  -- The supplier items this invoice uses, in id order (two approvals sharing items lock them in the
  -- same order, so they cannot deadlock).
  perform 1
    from public.supplier_item si
   where si.tenant_id = v.tenant_id
     and si.id = any (array(select l.supplier_item_id from unnest(v_lines) l
                             where l.supplier_item_id is not null))
   order by si.id
     for update;

  -- Receipts: a lot and its movement per received stock line, in line order.
  with src as (
    select l.* from unnest(v_lines) l where l.is_stock and l.received_qty > 0
  ), lots as (
    insert into public.raw_lot (tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id,
        lot_code, expiry, received_on, qty_received, base_unit, source_qty, source_unit, base_factor,
        created_by)
      select v.tenant_id, s.ingredient_id, v_loc, v.supplier_id, s.line_id, s.lot_code, s.expiry,
             v_date, s.received_qty, s.base_unit, s.qty - s.credit_qty, s.unit, s.base_factor, v_user
        from src s
       order by s.position, s.sub_position
      returning id, invoice_line_id, ingredient_id, qty_received
  )
  insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty,
      unit_cost, ref_type, ref_id, effective_on, created_by)
    select v.tenant_id, t.ingredient_id, t.id, v_loc, 'receipt', t.qty_received, s.unit_price,
           'invoice_line', t.invoice_line_id, v_date, v_user
      from lots t
      join src s on s.line_id = t.invoice_line_id;
  get diagnostics v_receipts = row_count;

  -- Price history, EUR per base unit, in line order (so seq follows the invoice).
  insert into public.price_history (tenant_id, ingredient_id, supplier_id, supplier_item_id,
      invoice_line_id, unit_price, base_unit, effective_on, created_by)
    select v.tenant_id, s.ingredient_id, v.supplier_id, s.supplier_item_id, s.line_id, s.unit_price,
           s.base_unit, v_date, v_user
      from unnest(v_lines) s
     where s.is_stock and s.received_qty > 0
     order by s.position, s.sub_position;

  -- last_price: the newest price row of each item, by invoice date then seq. Recomputed from the
  -- ledger after the item locks, so an older invoice approved late never overwrites a newer price.
  update public.supplier_item si
     set last_price = (select p.unit_price
                         from public.price_history p
                        where p.tenant_id = si.tenant_id and p.supplier_item_id = si.id
                        order by p.effective_on desc, p.seq desc
                        limit 1)
   where si.tenant_id = v.tenant_id
     and si.id = any (array(select l.supplier_item_id from unnest(v_lines) l
                             where l.is_stock and l.received_qty > 0
                               and l.supplier_item_id is not null));

  -- The payable: the gross total less the value of the credits (the supplier is paid the VAT too).
  v_gross := round(v.gross_total, 2);
  select coalesce(sum(l.credited_amount), 0) into v_credited from unnest(v_lines) l;
  insert into public.payable (tenant_id, invoice_id, supplier_id, gross_amount, credited_amount,
      amount, due_date, due_date_source, created_by)
    values (v.tenant_id, v.id, v.supplier_id, v_gross, v_credited, v_gross - v_credited,
            v_due.due_date, v_due.source, v_user)
    returning * into v_payable;

  update public.invoice set status = 'approved' where id = v.id;

  insert into public.audit_event (tenant_id, entity_type, entity_id, action, before, after, created_by)
    values (v.tenant_id, 'invoice', v.id, 'invoice.approved',
            jsonb_build_object('status', 'review'),
            jsonb_build_object('status', 'approved', 'payable_id', v_payable.id,
              'amount', v_payable.amount, 'due_date', v_payable.due_date,
              'due_date_source', v_payable.due_date_source, 'receipt_date', v_date,
              'location_id', v_loc, 'receipts', v_receipts),
            v_user);

  return jsonb_build_object('payableId', v_payable.id, 'amount', v_payable.amount,
    'dueDate', v_payable.due_date, 'receipts', v_receipts);
end
$$;

revoke all on function public.invoice_approval_preview(uuid, uuid), public.approve_invoice(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.invoice_approval_preview(uuid, uuid), public.approve_invoice(uuid, uuid)
  to authenticated;
