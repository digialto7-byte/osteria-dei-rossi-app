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
