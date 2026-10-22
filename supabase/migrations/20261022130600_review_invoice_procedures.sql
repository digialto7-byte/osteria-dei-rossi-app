-- M4: invoice-level review actions (M4 plan §3.2): link or create the supplier, correct the header,
-- clear a duplicate flag, and retry a failed extraction. Same shape as review_update_line: SECURITY
-- DEFINER, search_path = '', role checked first, tenant filtered explicitly, one transaction each.
-- None of them approves an invoice or writes a ledger.

-- What the reviewer changed in the header, measured against the extraction (extraction_json), like
-- app.line_corrected_fields for lines: a value the model could not read (null) and the reviewer
-- typed counts, except the supplier VAT, which is only a correction when one was extracted.
-- An invoice without an extraction record has nothing to measure against.
create function app.header_corrected_fields(i public.invoice) returns text[]
  language plpgsql stable
  set search_path = ''
as $$
declare
  ex jsonb := i.extraction_json;
  result text[] := '{}';
begin
  if ex is null then
    return result;
  end if;
  if i.number_raw is distinct from (ex ->> 'invoice_number') then
    result := array_append(result, 'number_raw');
  end if;
  if i.invoice_date is distinct from (ex ->> 'invoice_date')::date then
    result := array_append(result, 'invoice_date');
  end if;
  if i.due_date is distinct from (ex ->> 'due_date')::date then
    result := array_append(result, 'due_date');
  end if;
  if i.net_total is distinct from (ex ->> 'net_total')::numeric then
    result := array_append(result, 'net_total');
  end if;
  if i.vat_total is distinct from (ex ->> 'vat_total')::numeric then
    result := array_append(result, 'vat_total');
  end if;
  if i.gross_total is distinct from (ex ->> 'gross_total')::numeric then
    result := array_append(result, 'gross_total');
  end if;
  if (ex ->> 'supplier_vat') is not null and i.supplier_vat is distinct from (ex ->> 'supplier_vat') then
    result := array_append(result, 'supplier_vat');
  end if;
  return result;
end
$$;

-- Exactly one of p_supplier (an active supplier of the tenant) and p_new {name, vat_number,
-- payment_terms_days} (a supplier created here, in the same transaction). Re-linking to a different
-- supplier clears every line mapping and suggestion, because they belonged to the first one. The
-- supplier's VAT replaces a different printed one; the duplicate check and auto-mapping then re-run.
create function public.review_set_supplier(p_invoice uuid, p_supplier uuid, p_new jsonb)
  returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v public.invoice;
  i public.invoice;
  s public.supplier;
  k text;
begin
  perform app.require_invoice_reviewer();

  if (p_supplier is null) = (p_new is null) then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;
  if p_new is not null then
    if jsonb_typeof(p_new) <> 'object' or not (p_new ? 'name') then
      raise exception 'invalid_request' using errcode = 'P0001';
    end if;
    for k in select jsonb_object_keys(p_new) loop
      if k <> all (array['name', 'vat_number', 'payment_terms_days']) then
        raise exception 'invalid_request' using errcode = 'P0001';
      end if;
    end loop;
  end if;

  v := app.lock_review_invoice(p_invoice);

  if p_new is not null then
    insert into public.supplier (tenant_id, name, vat_number, payment_terms_days, created_by)
      values (v.tenant_id,
        app.patch_value(p_new, 'name', 'string', false),
        case when p_new ? 'vat_number'
             then nullif(btrim(app.patch_value(p_new, 'vat_number', 'string')), '') end,
        case when p_new ? 'payment_terms_days'
             then app.patch_value(p_new, 'payment_terms_days', 'number')::smallint end,
        app.app_user_id())
      returning * into s;
  else
    select * into s
      from public.supplier x
     where x.id = p_supplier and x.tenant_id = v.tenant_id and x.is_active;
    if not found then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
  end if;

  if v.supplier_id is not null and v.supplier_id <> s.id then
    update public.invoice_line l
       set ingredient_id = null, supplier_item_id = null, suggested_ingredient_id = null,
           suggested_supplier_item_id = null, mapping_source = null, pack_corrected = false
     where l.tenant_id = v.tenant_id and l.invoice_id = v.id;
    update public.invoice_line l
       set corrected_fields = app.line_corrected_fields(l)
     where l.tenant_id = v.tenant_id and l.invoice_id = v.id;
  end if;

  i := v;
  i.supplier_id := s.id;
  i.supplier_suggestion_id := null;
  if s.vat_number is not null and s.vat_number is distinct from v.supplier_vat then
    i.supplier_vat := s.vat_number;
  end if;
  i.header_corrected_fields := app.header_corrected_fields(i);
  update public.invoice
     set supplier_id = i.supplier_id, supplier_suggestion_id = i.supplier_suggestion_id,
         supplier_vat = i.supplier_vat, header_corrected_fields = i.header_corrected_fields
   where id = p_invoice;

  perform app.recheck_duplicate(p_invoice);
  perform app.automap_invoice(p_invoice);
end
$$;

-- p_patch keys (at least one, null clears): number_raw, invoice_date, due_date, net_total,
-- vat_total, gross_total. The totals gate re-runs; a changed number or date re-runs the duplicate
-- check, which may move the invoice from review to duplicate.
create function public.review_update_header(p_invoice uuid, p_patch jsonb) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v public.invoice;
  i public.invoice;
  k text;
begin
  perform app.require_invoice_reviewer();

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k <> all (array['number_raw', 'invoice_date', 'due_date', 'net_total', 'vat_total',
                       'gross_total']) then
      raise exception 'invalid_request' using errcode = 'P0001';
    end if;
  end loop;

  v := app.lock_review_invoice(p_invoice);
  i := v;
  if p_patch ? 'number_raw' then
    i.number_raw := nullif(btrim(app.patch_value(p_patch, 'number_raw', 'string')), '');
  end if;
  if p_patch ? 'invoice_date' then
    i.invoice_date := app.patch_value(p_patch, 'invoice_date', 'string')::date;
  end if;
  if p_patch ? 'due_date' then
    i.due_date := app.patch_value(p_patch, 'due_date', 'string')::date;
  end if;
  if p_patch ? 'net_total' then
    i.net_total := app.patch_value(p_patch, 'net_total', 'number')::numeric;
  end if;
  if p_patch ? 'vat_total' then
    i.vat_total := app.patch_value(p_patch, 'vat_total', 'number')::numeric;
  end if;
  if p_patch ? 'gross_total' then
    i.gross_total := app.patch_value(p_patch, 'gross_total', 'number')::numeric;
  end if;
  i.header_corrected_fields := app.header_corrected_fields(i);

  update public.invoice
     set number_raw = i.number_raw, invoice_date = i.invoice_date, due_date = i.due_date,
         net_total = i.net_total, vat_total = i.vat_total, gross_total = i.gross_total,
         header_corrected_fields = i.header_corrected_fields
   where id = p_invoice;

  perform app.refresh_gate(p_invoice);
  if i.number_raw is distinct from v.number_raw or i.invoice_date is distinct from v.invoice_date then
    perform app.recheck_duplicate(p_invoice);
  end if;
end
$$;

-- "Non è un doppione" (M2 founder answer): a duplicate goes back to review, or a name-match warning
-- is dismissed; the choice is recorded (who, when) until audit_event arrives with M5.
create function public.review_clear_duplicate(p_invoice uuid) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v public.invoice;
begin
  perform app.require_invoice_reviewer();
  select * into v
    from public.invoice i
   where i.id = p_invoice and i.tenant_id = (select app.tenant_id())
     for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v.status = 'duplicate' then
    update public.invoice
       set status = 'review', duplicate_of = null, duplicate_override = true,
           duplicate_override_by = app.app_user_id(), duplicate_override_at = now()
     where id = p_invoice;
  elsif v.status = 'review' and v.duplicate_warning_of is not null then
    update public.invoice
       set duplicate_warning_of = null, duplicate_override = true,
           duplicate_override_by = app.app_user_id(), duplicate_override_at = now()
     where id = p_invoice;
  else
    raise exception 'not_flagged' using errcode = 'P0001';
  end if;
end
$$;

-- "Riprova lettura": a failed extraction goes back in the queue with fresh attempts. The existing
-- worker makes the (paid) call.
create function public.retry_extraction(p_invoice uuid) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v public.invoice;
begin
  perform app.require_invoice_reviewer();
  select * into v
    from public.invoice i
   where i.id = p_invoice and i.tenant_id = (select app.tenant_id())
     for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v.status <> 'extraction_failed' then
    raise exception 'not_failed' using errcode = 'P0001';
  end if;
  update public.invoice
     set status = 'received', attempts = 0, next_attempt_at = null, extraction_error = null
   where id = p_invoice;
end
$$;

revoke all on function app.header_corrected_fields(public.invoice) from public, anon, authenticated;
revoke all on function public.review_set_supplier(uuid, uuid, jsonb),
  public.review_update_header(uuid, jsonb), public.review_clear_duplicate(uuid),
  public.retry_extraction(uuid) from public, anon, authenticated, service_role;
grant execute on function public.review_set_supplier(uuid, uuid, jsonb),
  public.review_update_header(uuid, jsonb), public.review_clear_duplicate(uuid),
  public.retry_extraction(uuid) to authenticated;
