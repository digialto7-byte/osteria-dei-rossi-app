-- P2-7 S4 (docs/plans/2026-11-14-p2-7-xml-invoice-upload.md section 3.2, 3.3.6, 5 S4): the precheck and the import of a FatturaPA file.
--
--   app.xml_max_bodies() = 10, app.xml_max_lines() = 200, app.xml_document_types() = {TD01, TD24, TD25} (an allow-list: everything else is refused), app.xml_notes_allowed(),
--   app.xml_natures()      the constants and lists; TS twins in src/server/fatturapa/constants.ts (a parity test reads this text).
--   app.xml_buyer_state    match | mismatch of the buyer of the file against the tenant's VAT number (the codice fiscale of a buyer without a VAT counts when it
--                          equals the VAT digits). tenant.vat_number is NOT NULL on main, so the plan's third state (unknown, note buyer_unchecked, for a tenant without a VAT
--                          number) cannot occur and is not built; the note value stays in the invoice_xml_notes_ck list of 20261204100000.
--   public.invoice_xml_precheck(sha256, supplier VAT, buyer VAT, buyer CF) -> {alreadyUploaded: [{id, bodyIndex, status}], buyer, issuedByTenant}: for the early refusal before
--                          anything is stored. Stable, writes nothing.
--   public.import_xml_invoices(payload) -> [{id, bodyIndex, status, duplicateOf}]: ONE transaction for the whole file (all bodies, their lines, their VAT summary rows, the
--                          duplicate decision, the supplier link and the unit/article mapping, the audit row). Any refusal rolls everything back: all or nothing.
--
-- Both are SECURITY DEFINER with an empty search_path, call app.require_invoice_reviewer() first (owner and admin; a gated account at aal1 has no role, so 42501), take the
-- tenant from app.tenant_id() and never from the payload, and are granted to authenticated only. The three-level answer of the import for the duplicate decision is the one of
-- extraction_complete (20261022130300): app.invoice_dup_lock_key, pg_advisory_xact_lock, app.find_duplicate_invoice_in; then status 'duplicate' with duplicate_of, or 'review'.
-- An XML invoice is never queued: extracted_at stays null, so the AI extraction-quality report stays clean. No model call, no extraction_model.
--
-- The payload (amounts are decimal STRINGS, never JSON numbers; unknown keys are refused):
--   {sha256, format, bodyCount, buyer: {vat, cf}, invoices: [{id, filePath, fileMime, fileSizeBytes, originalFilename, bodyIndex, documentType, notes,
--      header: {supplierVat, supplierName, numberRaw, invoiceDate, dueDate, netTotal, vatTotal, grossTotal},
--      lines: [{rawDescription, supplierCode, qty, unitRaw, unitPrice, lineAmount, vatRate, vatNature, xmlDetails}],
--      vatSummary: [{vatRate, vatNature, taxable, tax, rounding, accessoryCosts, vatChargeability, legalReference}]}]}
-- Errors (P0001 unless noted): invalid_request (shape, range, list, path of another tenant), xml_not_addressed_to_tenant, xml_issued_by_tenant, file_missing (no Storage object of
-- that name with the same size and type), already_uploaded (the same file body is live: DETAIL is the id of the first invoice).
--
-- audit_event_action_check is replaced as the union of every earlier action plus invoice.imported_xml (written here) and invoice.replaced_by_xml (written by
-- review_replace_with_xml of 20261204100400): the plan did not list the change, the audit rows need it, and replacing the check once keeps its md5 pins to one re-pin.

alter table public.audit_event
  drop constraint audit_event_action_check;
alter table public.audit_event
  add constraint audit_event_action_check
    check (action in ('invoice.approved', 'invoice.rejected', 'invoice.duplicate_cleared',
                      'ingredient.allergens_confirmed', 'recipe.deactivated', 'recipe.reactivated',
                      'tenant.settings_changed', 'payable.status_changed', 'payable.payment_reversed',
                      'app_user.created', 'app_user.updated', 'app_user.deactivated',
                      'app_user.reactivated', 'app_user.pin_set', 'device_enrolment.created',
                      'venue_device.enrolled', 'venue_device.revoked', 'venue_device.unlocked',
                      'count_session.closed', 'count_session.cancelled', 'ingredient.critical_changed',
                      'staff_meal_rule.created', 'staff_meal_rule.updated',
                      'ingredient.rules_changed', 'supplier.delivery_changed', 'recipe.rules_changed',
                      'menu_item.created', 'menu_item.updated', 'dining_table.created',
                      'dining_table.updated', 'table_session.covers_changed', 'sale_settings.changed',
                      'tenant.demo_data_loaded', 'tenant.demo_data_removed', 'reservation_settings.changed',
                      'app_user.mfa_enrolled', 'app_user.mfa_unenrolled', 'app_user.mfa_reset',
                      'app_user.mfa_reset_failed', 'app_user.pin_set_failed', 'tenant.mfa_enforcement_changed',
                      'app_user.mfa_locked', 'invoice.imported_xml', 'invoice.replaced_by_xml'));

-- Constants and lists ------------------------------------------------------------------------------------------------------------------------------------
create function app.xml_max_bodies() returns integer language sql immutable set search_path = '' as $$ select 10 $$;
create function app.xml_max_lines() returns integer language sql immutable set search_path = '' as $$ select 200 $$;
create function app.xml_document_types() returns text[] language sql immutable set search_path = ''
  as $$ select array['TD01', 'TD24', 'TD25']::text[] $$;
create function app.xml_notes_allowed() returns text[] language sql immutable set search_path = ''
  as $$ select array['attachments', 'ddt_refs', 'order_refs', 'text_lines_skipped', 'rounding_line_added', 'riepilogo_negative_residual', 'document_discount', 'stamp_duty',
                     'instalments', 'buyer_unchecked', 'vehicle_data']::text[] $$;
create function app.xml_natures() returns text[] language sql immutable set search_path = ''
  as $$ select array['N1', 'N2.1', 'N2.2', 'N3.1', 'N3.2', 'N3.3', 'N3.4', 'N3.5', 'N3.6', 'N4', 'N5', 'N6.1', 'N6.2', 'N6.3', 'N6.4', 'N6.5', 'N6.6', 'N6.7', 'N6.8', 'N6.9', 'N7']::text[] $$;

-- The buyer of the file against the tenant: match or mismatch (tenant.vat_number is never null).
create function app.xml_buyer_state(p_tenant uuid, p_buyer_vat text, p_buyer_cf text) returns text
  language sql
  stable
  set search_path = ''
as $$
  select case when upper(p_buyer_vat) = t.vat_number or upper(p_buyer_cf) = substr(t.vat_number, 3) then 'match' else 'mismatch' end
    from public.tenant t
   where t.id = p_tenant
$$;

-- Payload helpers: a JSON string, a whole number in a range, an amount, all null when the value is not of that kind.
create function app.xml_str(p jsonb) returns text language sql immutable set search_path = ''
  as $$ select case when jsonb_typeof(p) = 'string' then p #>> '{}' end $$;
create function app.xml_int(p jsonb, p_lo integer, p_hi integer) returns integer language sql immutable set search_path = ''
  as $$ select case when jsonb_typeof(p) = 'number' and (p #>> '{}') ~ '^[0-9]{1,9}$' and (p #>> '{}')::integer between p_lo and p_hi then (p #>> '{}')::integer end $$;
-- An amount string: up to 8 integer digits and 4 decimals (a leading minus only when p_signed), never an exponent, a space or a JSON number.
create function app.xml_amount(p jsonb, p_signed boolean default false) returns numeric language sql immutable set search_path = ''
  as $$ select case when jsonb_typeof(p) = 'string' and (p #>> '{}') ~ (case when p_signed then '^-?[0-9]{1,8}(\.[0-9]{1,4})?$' else '^[0-9]{1,8}(\.[0-9]{1,4})?$' end)
                    then (p #>> '{}')::numeric end $$;
create function app.xml_keys_ok(p jsonb, p_allowed text[]) returns boolean language sql immutable set search_path = ''
  as $$ select case when jsonb_typeof(p) = 'object' then not exists (select 1 from jsonb_object_keys(p) k where k <> all (p_allowed)) else false end $$;

-- The shape and range check of the whole payload. Raises invalid_request on the first problem; writes nothing.
create function app.xml_check_payload(p jsonb, p_tenant uuid) returns void
  language plpgsql
  stable
  set search_path = ''
as $$
declare
  v_count integer;
  b jsonb;
  l jsonb;
  s jsonb;
  v_ord integer;
  v_id uuid;
  v_ids uuid[] := '{}';
  v_amount numeric;
begin
  if not app.xml_keys_ok(p, array['sha256', 'format', 'bodyCount', 'buyer', 'invoices'])
     or app.xml_str(p -> 'sha256') is null or app.xml_str(p -> 'sha256') !~ '^[0-9a-f]{64}$'
     or app.xml_str(p -> 'format') is null or app.xml_str(p -> 'format') not in ('FPR12', 'FPA12')
     or jsonb_typeof(p -> 'invoices') is distinct from 'array'
     or not app.xml_keys_ok(p -> 'buyer', array['vat', 'cf'])
     or (p -> 'buyer' -> 'vat') is not null and jsonb_typeof(p -> 'buyer' -> 'vat') not in ('string', 'null')
     or (p -> 'buyer' -> 'cf') is not null and jsonb_typeof(p -> 'buyer' -> 'cf') not in ('string', 'null') then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;
  v_count := jsonb_array_length(p -> 'invoices');
  if v_count < 1 or v_count > app.xml_max_bodies() or app.xml_int(p -> 'bodyCount', 1, app.xml_max_bodies()) is distinct from v_count then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;

  for b, v_ord in select e.value, e.ordinality::integer from jsonb_array_elements(p -> 'invoices') with ordinality e loop
    if not app.xml_keys_ok(b, array['id', 'filePath', 'fileMime', 'fileSizeBytes', 'originalFilename', 'bodyIndex', 'documentType', 'notes', 'header', 'lines', 'vatSummary'])
       or app.xml_int(b -> 'bodyIndex', 1, 10) is distinct from v_ord
       or app.xml_str(b -> 'documentType') is null or app.xml_str(b -> 'documentType') <> all (app.xml_document_types())
       or app.xml_str(b -> 'id') is null or app.xml_str(b -> 'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or app.xml_str(b -> 'fileMime') is null or app.xml_str(b -> 'fileMime') not in ('application/xml', 'application/pkcs7-mime')
       or app.xml_int(b -> 'fileSizeBytes', 1, 4194304) is null
       or (b -> 'originalFilename') is not null and jsonb_typeof(b -> 'originalFilename') <> 'null'
          and (app.xml_str(b -> 'originalFilename') is null or length(app.xml_str(b -> 'originalFilename')) not between 1 and 200)
       or jsonb_typeof(b -> 'notes') is distinct from 'array'
       or jsonb_typeof(b -> 'lines') is distinct from 'array'
       or jsonb_typeof(b -> 'vatSummary') is distinct from 'array' then
      raise exception 'invalid_request' using errcode = 'P0001';
    end if;
    v_id := (b ->> 'id')::uuid;
    if v_id = any (v_ids) then
      raise exception 'invalid_request' using errcode = 'P0001';
    end if;
    v_ids := v_ids || v_id;
    -- The object name: this tenant's folder, a year, the invoice id, the one extension of the MIME type. Never another tenant's path.
    if app.xml_str(b -> 'filePath') is null
       or app.xml_str(b -> 'filePath') !~ ('^' || p_tenant::text || '/[0-9]{4}/' || v_id::text || case b ->> 'fileMime' when 'application/xml' then '\.xml' else '\.p7m' end || '$') then
      raise exception 'invalid_request' using errcode = 'P0001';
    end if;
    if exists (select 1 from jsonb_array_elements_text(b -> 'notes') n where n <> all (app.xml_notes_allowed())) then
      raise exception 'invalid_request' using errcode = 'P0001';
    end if;
    if jsonb_array_length(b -> 'lines') > app.xml_max_lines() or jsonb_array_length(b -> 'vatSummary') < 1 or jsonb_array_length(b -> 'vatSummary') > app.xml_max_lines() then
      raise exception 'invalid_request' using errcode = 'P0001';
    end if;

    -- The header: the duplicate key, the parties and the three totals (each at most 10 000 000 euros, the invoice_totals_ck range).
    if not app.xml_keys_ok(b -> 'header', array['supplierVat', 'supplierName', 'numberRaw', 'invoiceDate', 'dueDate', 'netTotal', 'vatTotal', 'grossTotal'])
       or app.xml_str(b -> 'header' -> 'supplierVat') is null or app.xml_str(b -> 'header' -> 'supplierVat') !~ '^[A-Z]{2}[0-9A-Z]{2,12}$'
       or app.xml_str(b -> 'header' -> 'supplierName') is null or length(btrim(app.xml_str(b -> 'header' -> 'supplierName'))) not between 1 and 200
       or app.xml_str(b -> 'header' -> 'numberRaw') is null or length(app.xml_str(b -> 'header' -> 'numberRaw')) not between 1 and 64
       or app.reservation_date(app.xml_str(b -> 'header' -> 'invoiceDate')) is null
       or ((b -> 'header' -> 'dueDate') is not null and jsonb_typeof(b -> 'header' -> 'dueDate') <> 'null'
           and app.reservation_date(app.xml_str(b -> 'header' -> 'dueDate')) is null)
       or app.xml_amount(b -> 'header' -> 'netTotal') is null or app.xml_amount(b -> 'header' -> 'netTotal') > 10000000
       or app.xml_amount(b -> 'header' -> 'vatTotal') is null or app.xml_amount(b -> 'header' -> 'vatTotal') > 10000000
       or app.xml_amount(b -> 'header' -> 'grossTotal') is null or app.xml_amount(b -> 'header' -> 'grossTotal') > 10000000 then
      raise exception 'invalid_request' using errcode = 'P0001';
    end if;

    -- The lines: no negative amount (refused before the upload), a VAT nature exactly on the 0 % lines.
    for l in select e.value from jsonb_array_elements(b -> 'lines') e loop
      if not app.xml_keys_ok(l, array['rawDescription', 'supplierCode', 'qty', 'unitRaw', 'unitPrice', 'lineAmount', 'vatRate', 'vatNature', 'xmlDetails'])
         or app.xml_str(l -> 'rawDescription') is null or length(app.xml_str(l -> 'rawDescription')) not between 1 and 500
         or ((l -> 'supplierCode') is not null and jsonb_typeof(l -> 'supplierCode') <> 'null'
             and (app.xml_str(l -> 'supplierCode') is null or length(app.xml_str(l -> 'supplierCode')) not between 1 and 64))
         or ((l -> 'unitRaw') is not null and jsonb_typeof(l -> 'unitRaw') <> 'null'
             and (app.xml_str(l -> 'unitRaw') is null or length(app.xml_str(l -> 'unitRaw')) not between 1 and 20))
         or app.xml_amount(l -> 'qty') is null or app.xml_amount(l -> 'qty') >= 100000000
         or ((l -> 'unitPrice') is not null and jsonb_typeof(l -> 'unitPrice') <> 'null'
             and (app.xml_amount(l -> 'unitPrice') is null or app.xml_amount(l -> 'unitPrice') > 10000000))
         or app.xml_amount(l -> 'lineAmount') is null or app.xml_amount(l -> 'lineAmount') > 10000000
         or app.xml_amount(l -> 'vatRate') is null or app.xml_amount(l -> 'vatRate') > 100
         or ((l -> 'vatNature') is not null and jsonb_typeof(l -> 'vatNature') <> 'null'
             and (app.xml_str(l -> 'vatNature') is null or app.xml_str(l -> 'vatNature') <> all (app.xml_natures())))
         or ((app.xml_amount(l -> 'vatRate') = 0) is distinct from (app.xml_str(l -> 'vatNature') is not null))
         or ((l -> 'xmlDetails') is not null and jsonb_typeof(l -> 'xmlDetails') not in ('object', 'null')) then
        raise exception 'invalid_request' using errcode = 'P0001';
      end if;
    end loop;

    -- The VAT summary rows (DatiRiepilogo); the rounding is the only signed amount.
    for s in select e.value from jsonb_array_elements(b -> 'vatSummary') e loop
      if not app.xml_keys_ok(s, array['vatRate', 'vatNature', 'taxable', 'tax', 'rounding', 'accessoryCosts', 'vatChargeability', 'legalReference'])
         or app.xml_amount(s -> 'vatRate') is null or app.xml_amount(s -> 'vatRate') > 100
         or ((s -> 'vatNature') is not null and jsonb_typeof(s -> 'vatNature') <> 'null'
             and (app.xml_str(s -> 'vatNature') is null or app.xml_str(s -> 'vatNature') <> all (app.xml_natures())))
         or ((app.xml_amount(s -> 'vatRate') = 0) is distinct from (app.xml_str(s -> 'vatNature') is not null))
         or app.xml_amount(s -> 'taxable') is null or app.xml_amount(s -> 'tax') is null
         or ((s -> 'rounding') is not null and jsonb_typeof(s -> 'rounding') <> 'null' and app.xml_amount(s -> 'rounding', true) is null)
         or ((s -> 'accessoryCosts') is not null and jsonb_typeof(s -> 'accessoryCosts') <> 'null' and app.xml_amount(s -> 'accessoryCosts') is null)
         or ((s -> 'vatChargeability') is not null and jsonb_typeof(s -> 'vatChargeability') <> 'null'
             and (app.xml_str(s -> 'vatChargeability') is null or app.xml_str(s -> 'vatChargeability') not in ('I', 'D')))
         or ((s -> 'legalReference') is not null and jsonb_typeof(s -> 'legalReference') <> 'null'
             and (app.xml_str(s -> 'legalReference') is null or length(app.xml_str(s -> 'legalReference')) not between 1 and 100)) then
        raise exception 'invalid_request' using errcode = 'P0001';
      end if;
    end loop;
  end loop;
end
$$;

-- The precheck ----------------------------------------------------------------------------------------------------------------------------------------------
create function public.invoice_xml_precheck(p_sha256 text, p_supplier_vat text, p_buyer_vat text, p_buyer_cf text) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  perform app.require_invoice_reviewer();
  v_tenant := (select app.tenant_id());
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' or p_supplier_vat is null or p_supplier_vat !~ '^[A-Z]{2}[0-9A-Z]{2,12}$' then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'alreadyUploaded', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'bodyIndex', i.xml_body_index, 'status', i.status) order by i.xml_body_index, i.created_at)
                                  from public.invoice i
                                 where i.tenant_id = v_tenant and i.xml_sha256 = p_sha256 and i.status <> 'rejected'), '[]'::jsonb),
    'buyer', app.xml_buyer_state(v_tenant, p_buyer_vat, p_buyer_cf),
    'issuedByTenant', exists (select 1 from public.tenant t where t.id = v_tenant and t.vat_number = p_supplier_vat));
end
$$;

-- The import ----------------------------------------------------------------------------------------------------------------------------------------------
create function public.import_xml_invoices(p_payload jsonb) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user uuid;
  v_vat text;
  v_sha text;
  v_format text;
  v_count integer;
  v_buyer text;
  b jsonb;
  v_ord integer;
  v_id uuid;
  v_path text;
  v_vat_supplier text;
  v_number text;
  v_date date;
  v_notes text[];
  v_first uuid;
  v_lock bigint;
  v_dup uuid;
  v_status public.invoice_status;
  v_out jsonb := '[]'::jsonb;
begin
  perform app.require_invoice_reviewer();
  v_tenant := (select app.tenant_id());
  v_user := (select app.app_user_id());
  perform app.xml_check_payload(p_payload, v_tenant);

  v_sha := p_payload ->> 'sha256';
  v_format := p_payload ->> 'format';
  v_count := jsonb_array_length(p_payload -> 'invoices');
  select t.vat_number into strict v_vat from public.tenant t where t.id = v_tenant;

  -- The venue's own invoice is not a supplier invoice; a file for another buyer is not ours to hold.
  if exists (select 1 from jsonb_array_elements(p_payload -> 'invoices') e where e.value -> 'header' ->> 'supplierVat' = v_vat) then
    raise exception 'xml_issued_by_tenant' using errcode = 'P0001';
  end if;
  v_buyer := app.xml_buyer_state(v_tenant, p_payload -> 'buyer' ->> 'vat', p_payload -> 'buyer' ->> 'cf');
  if v_buyer is distinct from 'match' then
    raise exception 'xml_not_addressed_to_tenant' using errcode = 'P0001';
  end if;

  -- First pass, nothing written yet: the Storage object of every body exists with the same size and type, and no body of this file is live already.
  for b, v_ord in select e.value, e.ordinality::integer from jsonb_array_elements(p_payload -> 'invoices') with ordinality e loop
    if not exists (select 1 from storage.objects o
                    where o.bucket_id = 'invoices' and o.name = b ->> 'filePath'
                      and o.metadata ->> 'size' = b ->> 'fileSizeBytes' and o.metadata ->> 'mimetype' = b ->> 'fileMime') then
      raise exception 'file_missing' using errcode = 'P0001';
    end if;
    -- Held until the end of the transaction: two uploads of the same file wait here, and the second sees the first one's rows.
    perform pg_advisory_xact_lock(hashtextextended('xmlfile|' || v_tenant::text || '|' || v_sha || '|' || v_ord::text, 0));
    select i.id into v_first from public.invoice i
     where i.tenant_id = v_tenant and i.xml_sha256 = v_sha and i.xml_body_index = v_ord and i.status <> 'rejected'
     order by i.created_at, i.id limit 1;
    if v_first is not null then
      raise exception 'already_uploaded' using errcode = 'P0001', detail = v_first::text;
    end if;
  end loop;

  -- Second pass: one invoice per body.
  for b, v_ord in select e.value, e.ordinality::integer from jsonb_array_elements(p_payload -> 'invoices') with ordinality e loop
    v_id := (b ->> 'id')::uuid;
    v_vat_supplier := b -> 'header' ->> 'supplierVat';
    v_number := b -> 'header' ->> 'numberRaw';
    v_date := (b -> 'header' ->> 'invoiceDate')::date;
    select coalesce(array_agg(distinct n order by n), '{}') into v_notes from jsonb_array_elements_text(b -> 'notes') n;

    v_dup := null;
    v_lock := app.invoice_dup_lock_key(v_tenant, v_vat_supplier, null, v_number, v_date);
    perform pg_advisory_xact_lock(v_lock);
    v_dup := app.find_duplicate_invoice_in(v_tenant, v_vat_supplier, v_number, v_date, v_id);
    v_status := case when v_dup is not null then 'duplicate' else 'review' end;

    insert into public.invoice (id, tenant_id, status, source, file_path, file_mime, file_size_bytes, original_filename, supplier_vat, supplier_name, number_raw,
        invoice_date, duplicate_of, due_date, net_total, vat_total, gross_total, document_type, xml_format, xml_sha256, xml_body_index, xml_body_count, xml_notes, created_by)
      values (v_id, v_tenant, v_status, 'upload', b ->> 'filePath', b ->> 'fileMime', (b ->> 'fileSizeBytes')::integer, b ->> 'originalFilename', v_vat_supplier,
        btrim(b -> 'header' ->> 'supplierName'), v_number, v_date, v_dup, (b -> 'header' ->> 'dueDate')::date, (b -> 'header' ->> 'netTotal')::numeric,
        (b -> 'header' ->> 'vatTotal')::numeric, (b -> 'header' ->> 'grossTotal')::numeric, b ->> 'documentType', v_format, v_sha, v_ord, v_count, v_notes, v_user);

    insert into public.invoice_line (tenant_id, invoice_id, position, raw_description, supplier_code, qty, unit_raw, unit_price, line_amount, vat_rate, vat_nature,
        lot_code, expiry, field_confidence, checks, extracted, xml_details, created_by)
      select v_tenant, v_id, e.ordinality::integer, e.value ->> 'rawDescription', e.value ->> 'supplierCode', (e.value ->> 'qty')::numeric, e.value ->> 'unitRaw',
             (e.value ->> 'unitPrice')::numeric, (e.value ->> 'lineAmount')::numeric, (e.value ->> 'vatRate')::numeric, e.value ->> 'vatNature', null, null, '{}'::jsonb,
             app.line_checks((e.value ->> 'qty')::numeric, (e.value ->> 'unitPrice')::numeric, (e.value ->> 'lineAmount')::numeric, (e.value ->> 'vatRate')::numeric),
             jsonb_build_object('description', e.value ->> 'rawDescription', 'supplier_code', e.value ->> 'supplierCode', 'qty', (e.value ->> 'qty')::numeric,
               'unit', e.value ->> 'unitRaw', 'unit_price', (e.value ->> 'unitPrice')::numeric, 'line_amount', (e.value ->> 'lineAmount')::numeric,
               'vat_rate', (e.value ->> 'vatRate')::numeric, 'lot_code', null, 'expiry', null),
             case when jsonb_typeof(e.value -> 'xmlDetails') = 'object' then e.value -> 'xmlDetails' end, v_user
        from jsonb_array_elements(b -> 'lines') with ordinality e;

    insert into public.invoice_vat_summary (tenant_id, invoice_id, position, vat_rate, vat_nature, taxable, tax, rounding, accessory_costs, vat_chargeability,
        legal_reference, created_by)
      select v_tenant, v_id, e.ordinality::integer, (e.value ->> 'vatRate')::numeric, e.value ->> 'vatNature', (e.value ->> 'taxable')::numeric, (e.value ->> 'tax')::numeric,
             (e.value ->> 'rounding')::numeric, (e.value ->> 'accessoryCosts')::numeric, e.value ->> 'vatChargeability', e.value ->> 'legalReference', v_user
        from jsonb_array_elements(b -> 'vatSummary') with ordinality e;

    perform app.refresh_gate(v_id);
    perform app.automap_invoice(v_id);

    insert into public.audit_event (tenant_id, entity_type, entity_id, action, after, created_by)
      values (v_tenant, 'invoice', v_id, 'invoice.imported_xml',
              jsonb_build_object('documentType', b ->> 'documentType', 'bodyIndex', v_ord, 'bodyCount', v_count, 'status', v_status), v_user);

    v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_id, 'bodyIndex', v_ord, 'status', v_status, 'duplicateOf', v_dup));
  end loop;
  return v_out;
end
$$;

revoke all on function app.xml_max_bodies(), app.xml_max_lines(), app.xml_document_types(), app.xml_notes_allowed(), app.xml_natures(),
  app.xml_buyer_state(uuid, text, text), app.xml_str(jsonb), app.xml_int(jsonb, integer, integer), app.xml_amount(jsonb, boolean), app.xml_keys_ok(jsonb, text[]),
  app.xml_check_payload(jsonb, uuid) from public, anon, authenticated, service_role;
revoke all on function public.invoice_xml_precheck(text, text, text, text), public.import_xml_invoices(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.invoice_xml_precheck(text, text, text, text), public.import_xml_invoices(jsonb) to authenticated;
