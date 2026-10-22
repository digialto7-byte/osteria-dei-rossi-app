-- M5 code-review fixes. Committed migrations are not edited, so each fix is made here with
-- create or replace / alter / revoke. One section per fix.
--
-- Fix 1 (review FAIL): after "Non è un doppione" on a copy, the original could never be approved.
--   The copy C of an original O was cleared (duplicate_override = true, status review), but
--   approval_blockers still counted C as a live duplicate of O, so O was blocked with
--   duplicate_invoice, and review_clear_duplicate(O) answered not_flagged (O was never flagged).
--   The owner had already decided the pair is two documents. The approval gate for X now ignores a
--   matching invoice Y whose duplicate_override is true (the existing skip for X's own override
--   stays). The exclusion lives in a new approval-only finder and NOT in the shared
--   app.find_duplicate_invoice_in: extraction (extraction_complete, automap, recheck_duplicate)
--   must still see a cleared invoice as a live match, otherwise a later copy D of a document whose
--   original was rejected would slip past the check against the cleared one. A third copy that
--   nobody cleared still blocks both the original and itself.
--
-- Fix 2 (review note 1): deadlock between approve_invoice and the extraction of a copy. approve_invoice
--   locked the invoice FOR UPDATE and then waited for the duplicate advisory lock; extraction_complete
--   of a copy holds that advisory lock and then writes duplicate_of, whose foreign key needs a KEY SHARE
--   lock on the original's row, which FOR UPDATE refuses. Each waited for the other. FOR NO KEY UPDATE
--   still excludes every other writer, FOR UPDATE and FOR NO KEY UPDATE (so one approval or review
--   action per invoice, and the SKIP LOCKED propagation still skips it) but does not conflict with
--   KEY SHARE. The same cycle existed in every review procedure that locks the invoice and then calls
--   app.recheck_duplicate (review_set_supplier, review_update_header), all through
--   app.lock_review_invoice, so that helper gets the same one-word change. reject_invoice has no
--   advisory lock but takes the same lock mode, so the invoice row has one lock mode everywhere.
--   review_clear_duplicate and retry_extraction (FOR UPDATE, no advisory lock) cannot close the cycle
--   and are left alone. The row is never updated in a key column by these procedures.
--
-- Fix 3 (review note 2): service_role kept TRIGGER and REFERENCES on the five ledger tables, because
--   the earlier migrations revoked only insert, update, delete and truncate. A ledger needs no other
--   privilege for the cron routes (nothing in src/ or scripts/ touches these tables with the secret
--   key; the app reads them with the user's session). service_role now has SELECT and nothing else.
--   authenticated and anon are re-stated the same way (authenticated SELECT only, anon none), so a
--   future default privilege cannot widen them silently.
--
-- Fix 4 (review note 3): raw_lot.base_factor was numeric(16,8) and rounded on insert, while the
--   received quantity is computed from the unrounded factor (app.approval_lines), so for a pack such
--   as 1,2345 x 3,3333 g (factor 0.00411495885, 11 decimals) round(source_qty * stored factor, 4)
--   could differ from the received quantity by 0.0001 and raw_lot_qty_ck raised 23514 at approval.
--   The simplest correct option is to store the exact factor: the column becomes unconstrained
--   numeric (supplier_item allows pack_count and pack_qty of 4 decimals each, so a factor has up to
--   11). No rewrite of the ledger rows is needed (widening a numeric); existing values are
--   unchanged. raw_lot_qty_ck stays as it was and now always holds for what approval computes.

-- The live-duplicate lookup of the approval gate: like app.find_duplicate_invoice_in (same VAT,
-- number and date, not duplicate or rejected, not p_exclude) but a match whose own
-- duplicate_override is true is skipped, because the owner declared that invoice a different
-- document from its look-alikes. The extraction finder is left as it is (see the header).
create function app.find_undeclared_duplicate_invoice_in(
  p_tenant uuid,
  p_vat text,
  p_number text,
  p_date date,
  p_exclude uuid default null
) returns uuid
  language sql stable
  set search_path = ''
as $$
  select i.id
    from public.invoice i
   where p_vat is not null and p_number is not null and p_date is not null
     and i.tenant_id = p_tenant
     and i.supplier_vat = upper(regexp_replace(p_vat, '\s', '', 'g'))
     and i.number = app.normalise_invoice_number(p_number)
     and i.invoice_date = p_date
     and i.status not in ('duplicate', 'rejected')
     and not i.duplicate_override
     and i.id is distinct from p_exclude
   order by i.created_at, i.id
   limit 1
$$;
revoke all on function app.find_undeclared_duplicate_invoice_in(uuid, text, text, date, uuid)
  from public, anon, authenticated;

-- Every reason the invoice cannot be approved now, as [{code, lineIds}] in the order of the gates
-- of plan §3.1.4 (approve_invoice raises the first, the preview lists all). Takes no locks and
-- trusts no stored flag: totals and duplicates are computed now. A status other than review has
-- only its status blocker. Raises P0002 for an unknown invoice.
create or replace function app.approval_blockers(p_invoice uuid, p_location uuid) returns jsonb
  language plpgsql stable
  set search_path = ''
as $$
declare
  v public.invoice;
  v_tz text;
  v_out jsonb := '[]'::jsonb;
  v_ids jsonb;
  v_credited numeric;
  v_due date;
  g record;
begin
  select * into v from public.invoice i where i.id = p_invoice;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v.status <> 'review' then
    return jsonb_build_array(jsonb_build_object('lineIds', '[]'::jsonb, 'code', case v.status
      when 'approved' then 'invoice_already_approved'
      when 'rejected' then 'invoice_rejected'
      when 'duplicate' then 'duplicate_invoice'
      else 'invoice_not_in_review' end));
  end if;

  if not v.duplicate_override
     and app.find_undeclared_duplicate_invoice_in(
           v.tenant_id, v.supplier_vat, v.number_raw, v.invoice_date, v.id) is not null then
    v_out := v_out || jsonb_build_object('code', 'duplicate_invoice', 'lineIds', '[]'::jsonb);
  end if;
  if v.duplicate_warning_of is not null and not v.duplicate_override then
    v_out := v_out || jsonb_build_object('code', 'duplicate_warning', 'lineIds', '[]'::jsonb);
  end if;

  select * into g from app.totals_gate(p_invoice);
  if g.flagged then
    v_out := v_out || jsonb_build_object('code', 'total_mismatch', 'lineIds', '[]'::jsonb);
  end if;

  if v.supplier_id is null then
    v_out := v_out || jsonb_build_object('code', 'supplier_required', 'lineIds', '[]'::jsonb);
  end if;

  select t.timezone into v_tz from public.tenant t where t.id = v.tenant_id;
  if v.invoice_date is null then
    v_out := v_out || jsonb_build_object('code', 'invoice_date_required', 'lineIds', '[]'::jsonb);
  elsif v.invoice_date > app.venue_date(now(), v_tz) then
    v_out := v_out || jsonb_build_object('code', 'invoice_date_in_future', 'lineIds', '[]'::jsonb);
  end if;

  select d.due_date into v_due from app.resolve_due_date(p_invoice) d;
  if v_due is null then
    v_out := v_out || jsonb_build_object('code', 'due_date_required', 'lineIds', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(a.line_id order by a.position, a.sub_position), '[]'::jsonb) into v_ids
    from app.approval_lines(p_invoice) a
   where a.is_stock and a.ingredient_id is null;
  if v_ids <> '[]'::jsonb then
    v_out := v_out || jsonb_build_object('code', 'lines_unmapped', 'lineIds', v_ids);
  end if;

  select coalesce(jsonb_agg(a.line_id order by a.position, a.sub_position), '[]'::jsonb) into v_ids
    from app.approval_lines(p_invoice) a
   where a.is_stock and a.ingredient_id is not null and a.base_factor is null
     and a.qty - a.credit_qty > 0;
  if v_ids <> '[]'::jsonb then
    v_out := v_out || jsonb_build_object('code', 'line_base_qty_unavailable', 'lineIds', v_ids);
  end if;

  select coalesce(jsonb_agg(a.line_id order by a.position, a.sub_position), '[]'::jsonb) into v_ids
    from app.approval_lines(p_invoice) a
   where a.credit_qty > 0 and a.credited_amount is null;
  if v_ids <> '[]'::jsonb then
    v_out := v_out || jsonb_build_object('code', 'credit_vat_rate_missing', 'lineIds', v_ids);
  end if;

  select coalesce(sum(a.credited_amount), 0) into v_credited from app.approval_lines(p_invoice) a;
  if v_credited > round(coalesce(v.gross_total, 0), 2) then
    v_out := v_out || jsonb_build_object('code', 'payable_negative', 'lineIds', '[]'::jsonb);
  end if;

  begin
    perform app.resolve_location(v.tenant_id, p_location);
  exception when sqlstate 'P0001' then
    v_out := v_out || jsonb_build_object('code', sqlerrm, 'lineIds', '[]'::jsonb);
  end;

  return v_out;
end
$$;

revoke all on function app.approval_blockers(uuid, uuid) from public, anon, authenticated;

create or replace function app.lock_review_invoice(p_invoice uuid) returns public.invoice
  language plpgsql
  set search_path = ''
as $$
declare
  v public.invoice;
begin
  select * into v
    from public.invoice i
   where i.id = p_invoice and i.tenant_id = (select app.tenant_id())
     for no key update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v.status <> 'review' then
    raise exception 'invoice_not_in_review' using errcode = 'P0001';
  end if;
  return v;
end
$$;

create or replace function public.approve_invoice(p_invoice uuid, p_location uuid default null)
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

  -- The invoice first, as every review procedure does: one lock order everywhere. FOR NO KEY UPDATE,
  -- not FOR UPDATE: the advisory lock below can be held by an extraction of a copy that then needs a
  -- KEY SHARE lock on this row (its duplicate_of foreign key); FOR UPDATE would deadlock with it.
  select * into v
    from public.invoice i
   where i.id = p_invoice and i.tenant_id = (select app.tenant_id())
     for no key update;
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

create or replace function public.reject_invoice(p_invoice uuid, p_reason text default null) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v public.invoice;
  v_reason text := nullif(btrim(p_reason), '');
begin
  perform app.require_invoice_approver();

  if length(v_reason) > 200 then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;

  select * into v
    from public.invoice i
   where i.id = p_invoice and i.tenant_id = (select app.tenant_id())
     for no key update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v.status = 'approved' then
    raise exception 'invoice_already_approved' using errcode = 'P0001';
  elsif v.status = 'rejected' then
    raise exception 'invoice_rejected' using errcode = 'P0001';
  elsif v.status not in ('review', 'duplicate') then
    raise exception 'invoice_not_in_review' using errcode = 'P0001';
  end if;

  update public.invoice set status = 'rejected' where id = v.id;

  insert into public.audit_event (tenant_id, entity_type, entity_id, action, before, after, reason,
      created_by)
    values (v.tenant_id, 'invoice', v.id, 'invoice.rejected',
            jsonb_build_object('status', v.status), jsonb_build_object('status', 'rejected'),
            v_reason, app.app_user_id());
end
$$;

revoke all on public.audit_event, public.raw_lot, public.stock_movement, public.price_history,
  public.payable from anon, authenticated, service_role;
grant select on public.audit_event, public.raw_lot, public.stock_movement, public.price_history,
  public.payable to authenticated, service_role;

alter table public.raw_lot alter column base_factor type numeric;
comment on column public.raw_lot.base_factor is
  'Base units per one source unit, exact (not rounded): qty_received = round(source_qty * base_factor, 4).';
