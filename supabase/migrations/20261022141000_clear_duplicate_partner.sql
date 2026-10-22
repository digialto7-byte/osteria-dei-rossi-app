-- M5 code-review fix, round 4: "Non è un doppione" names the pair it declares.
--
-- The bug (140900:321). review_clear_duplicate(p_invoice) declared whichever undeclared look-alike came
-- first when it ran, not the one the owner saw. X, Y and W are copies of one document. A double tap on
-- "Non è un doppione" on Y (or a second tab, a second owner, a retry) queues two requests: the first
-- declares (Y, X); the second, run after the first re-pointed Y at W, declares (Y, W) - a pair the owner
-- never looked at. Later W is cleared against X and all three approve: 3 payables for one document.
--
-- The rule. A decision is about one pair and the request names it: review_clear_duplicate(p_invoice,
-- p_partner) declares exactly (p_invoice, p_partner) and nothing else.
--   * the pair is already declared (either way round): a no-op that returns normally. Nothing is written
--     (no second row, no audit row, no re-pointing): a retry or a second tap is harmless. The invoice row
--     lock serialises two clears of one invoice, so the second always sees the first's pair;
--   * p_partner is not an undeclared look-alike of the invoice now (not live, a different key, another
--     tenant, itself, unknown): refused with not_flagged (P0001), nothing written. Why not_flagged and
--     not invalid_request: the request is well formed and was true when the screen drew it; the data moved
--     (the partner was rejected, re-keyed, or declared from the other side). That is a 409 conflict, not a
--     400 client error; the screen reloads on a 409 and shows the partner the database names now;
--   * otherwise the pair is recorded and the invoice is re-pointed to the next undeclared look-alike (or
--     the pointer is cleared), as before.
-- Role check first, empty search_path, tenant scope from the locked row, execute to authenticated only.
-- The one-argument function is dropped, so nothing can call it and declare "the first one".
--
-- The screen's partner. app.approval_blockers puts 'partnerId' (the recomputed first undeclared look-alike,
-- app.undeclared_look_alike) on the duplicate blockers, and the preview now lists blockers for a status
-- 'duplicate' invoice too (only the duplicate_invoice one, with its partnerId, null when the original has
-- left: rejected since). So the id the screen sends is the one this function checks. approve_invoice only
-- reads the code of the first blocker.
--
-- Stale pointers. The old function also cleared a stored pointer whose partner was no longer live (no pair
-- recorded). That path is gone: a refused stale partner changes nothing. A status 'duplicate' invoice whose
-- original was rejected has no partner to declare; the owner rejects it (the screen says so).

-- Is p_other a live look-alike of p_invoice that the owner has not declared a different document? The same
-- predicates as app.find_undeclared_duplicate_invoice_in / _name_duplicate_invoice_in, asked about one
-- named invoice instead of the first (040/041 check that the two agree).
create function app.is_undeclared_look_alike(p_invoice uuid, p_other uuid) returns boolean
  language sql stable
  set search_path = ''
as $$
  select exists (
    select 1
      from public.invoice i
      join public.invoice o on o.tenant_id = i.tenant_id and o.id <> i.id
     where i.id = p_invoice and o.id = p_other
       and i.number_raw is not null and i.invoice_date is not null
       and o.number = app.normalise_invoice_number(i.number_raw)
       and o.invoice_date = i.invoice_date
       and o.status not in ('duplicate', 'rejected')
       and not app.duplicate_pair_declared(i.tenant_id, i.id, o.id)
       and case when i.supplier_vat is not null
                then o.supplier_vat = upper(regexp_replace(i.supplier_vat, '\s', '', 'g'))
                else i.supplier_name is not null and o.supplier_vat is null
                     and app.normalise_name(o.supplier_name) = app.normalise_name(i.supplier_name)
           end)
$$;
revoke all on function app.is_undeclared_look_alike(uuid, uuid) from public, anon, authenticated;

-- 140900's function with 'partnerId' on the duplicate blockers.
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
  v_partner uuid;
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
      else 'invoice_not_in_review' end)
      || case when v.status = 'duplicate'
              then jsonb_build_object('partnerId', app.undeclared_look_alike(p_invoice))
              else '{}'::jsonb end);
  end if;

  -- Both duplicate gates recompute the live look-alikes the owner has not declared (a pair in
  -- invoice_duplicate_decision, either way round). No stored pointer is trusted: duplicate_warning_of and
  -- duplicate_of are a hint for the screen, not the gate. A VAT invoice is blocked with duplicate_invoice,
  -- an invoice without VAT (name match) with duplicate_warning.
  v_partner := app.undeclared_look_alike(p_invoice);
  if v_partner is not null then
    v_out := v_out || jsonb_build_object(
      'code', case when v.supplier_vat is not null then 'duplicate_invoice' else 'duplicate_warning' end,
      'lineIds', '[]'::jsonb, 'partnerId', v_partner);
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


-- 140500's preview, unchanged except that a status 'duplicate' invoice lists its blocker too (with the
-- partnerId); the blockers of any other status than review and duplicate are still not listed.
create or replace function public.invoice_approval_preview(p_invoice uuid, p_location uuid default null)
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

  if v.status in ('review', 'duplicate') then
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


-- "Non è un doppione" for one named pair (see the header).
drop function public.review_clear_duplicate(uuid);
create function public.review_clear_duplicate(p_invoice uuid, p_partner uuid) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v public.invoice;
  v_next uuid;
begin
  perform app.require_invoice_reviewer();
  select * into v
    from public.invoice i
   where i.id = p_invoice and i.tenant_id = (select app.tenant_id())
     for no key update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v.status not in ('review', 'duplicate') then
    raise exception 'not_flagged' using errcode = 'P0001';
  end if;

  -- Already declared (by this request's twin, another tab, another owner): nothing to do.
  if app.duplicate_pair_declared(v.tenant_id, p_invoice, p_partner) then
    return;
  end if;
  if not app.is_undeclared_look_alike(p_invoice, p_partner) then
    raise exception 'not_flagged' using errcode = 'P0001';
  end if;

  insert into public.invoice_duplicate_decision (tenant_id, invoice_id, other_id, decided_by)
    values (v.tenant_id, p_invoice, p_partner, app.app_user_id())
    on conflict do nothing;
  v_next := app.undeclared_look_alike(p_invoice);

  update public.invoice
     set status = case when v.supplier_vat is not null and v_next is not null
                       then 'duplicate'::public.invoice_status else 'review'::public.invoice_status end,
         duplicate_of = case when v.supplier_vat is not null then v_next end,
         duplicate_warning_of = case when v.supplier_vat is null then v_next end,
         duplicate_override = true,
         duplicate_override_of = p_partner,
         duplicate_override_by = app.app_user_id(), duplicate_override_at = now()
   where id = p_invoice;

  insert into public.audit_event (tenant_id, entity_type, entity_id, action, before, after, created_by)
    values (v.tenant_id, 'invoice', v.id, 'invoice.duplicate_cleared',
            jsonb_build_object('status', v.status, 'duplicate_of', v.duplicate_of,
              'duplicate_warning_of', v.duplicate_warning_of),
            jsonb_build_object(
              'status', case when v.supplier_vat is not null and v_next is not null then 'duplicate' else 'review' end,
              'duplicate_override', true,
              'duplicate_override_of', p_partner,
              'next_look_alike', v_next),
            app.app_user_id());
end
$$;
revoke all on function public.review_clear_duplicate(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.review_clear_duplicate(uuid, uuid) to authenticated;
