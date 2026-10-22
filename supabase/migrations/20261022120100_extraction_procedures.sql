-- M3: the extraction worker's procedures (M3 plan §3). Each is one transaction, SECURITY INVOKER,
-- executable by service_role only (the Next.js cron route calls them with the secret key).
-- The invoice_guard trigger still applies to every status change they make.

-- The key that serialises the duplicate check: tenant + supplier (VAT, else normalised name) +
-- number + date. invoice_dedup_idx is no longer unique (M2 founder answers), so two copies of one
-- invoice extracted at the same moment could both miss each other without it. A VAT and a name
-- never share a key. Null when the key is incomplete (no check is made then).
create function app.invoice_dup_lock_key(
  p_tenant uuid,
  p_vat text,
  p_name text,
  p_number text,
  p_date date
) returns bigint
  language sql immutable
  set search_path = ''
as $$
  select case
    when p_tenant is null or p_number is null or p_date is null
      or (p_vat is null and p_name is null) then null
    else hashtextextended(concat_ws('|',
      p_tenant::text,
      case when p_vat is not null then 'vat:' || upper(regexp_replace(p_vat, '\s', '', 'g'))
           else 'name:' || app.normalise_name(p_name) end,
      app.normalise_invoice_number(p_number),
      p_date::text), 0)
  end
$$;

-- Claims the oldest invoice that is due, across tenants: a waiting invoice whose backoff has
-- passed, or one whose lease expired (the run that held it was killed). Every claim counts an
-- attempt. A stale lease with no attempts left fails with lease_expired instead.
create function public.extraction_claim(p_lease_seconds int, p_max_attempts int)
  returns table (
    id uuid, tenant_id uuid, file_path text, file_mime text, claim_token uuid, attempts smallint)
  language plpgsql
  set search_path = ''
as $$
#variable_conflict use_column
declare
  v_id uuid;
  v_stale timestamptz := now() - make_interval(secs => p_lease_seconds);
begin
  update public.invoice i
     set status = 'extraction_failed', extraction_error = 'lease_expired', claim_token = null
   where i.status = 'extracting' and i.extraction_started_at < v_stale
     and i.attempts >= p_max_attempts;

  select i.id into v_id
    from public.invoice i
   where (i.status = 'received' and (i.next_attempt_at is null or i.next_attempt_at <= now()))
      or (i.status = 'extracting' and i.extraction_started_at < v_stale)
   order by i.created_at, i.id
   for update skip locked
   limit 1;
  if v_id is null then
    return;
  end if;

  return query
    update public.invoice i
       set status = 'extracting', attempts = i.attempts + 1, extraction_started_at = now(),
           next_attempt_at = null, claim_token = gen_random_uuid()
     where i.id = v_id
    returning i.id, i.tenant_id, i.file_path, i.file_mime, i.claim_token, i.attempts;
end
$$;

-- Stores a validated extraction and decides the next status: review, duplicate (same VAT, number
-- and date as another live invoice) or review with a warning (no VAT, same normalised name,
-- number and date). The duplicate check is skipped when the owner already cleared the flag.
-- p_result: {header: {supplier_vat, supplier_name, number_raw, invoice_date, due_date,
--   payment_terms, net_total, vat_total, gross_total}, lines: [{raw_description, supplier_code,
--   qty, unit_raw, unit_price, line_amount, vat_rate, lot_code, expiry, field_confidence, checks,
--   extracted}], gate_flags, totals_diff, field_confidence, extraction_json}.
create function public.extraction_complete(
  p_invoice uuid,
  p_claim_token uuid,
  p_result jsonb,
  p_model text
) returns public.invoice_status
  language plpgsql
  set search_path = ''
as $$
declare
  v public.invoice;
  h jsonb := p_result -> 'header';
  v_vat text := nullif(h ->> 'supplier_vat', '');
  v_name text := nullif(h ->> 'supplier_name', '');
  v_number text := nullif(h ->> 'number_raw', '');
  v_date date := nullif(h ->> 'invoice_date', '')::date;
  v_lock bigint;
  v_dup uuid;
  v_warn uuid;
  v_status public.invoice_status;
begin
  select * into v from public.invoice where id = p_invoice for update;
  if not found or v.status <> 'extracting' or v.claim_token is distinct from p_claim_token then
    raise exception 'stale_claim' using errcode = 'P0001';
  end if;

  insert into public.invoice_line (tenant_id, invoice_id, position, raw_description, supplier_code,
      qty, unit_raw, unit_price, line_amount, vat_rate, lot_code, expiry, field_confidence,
      checks, extracted, created_by)
    select v.tenant_id, p_invoice, e.ord::smallint, r.raw_description, r.supplier_code, r.qty,
           r.unit_raw, r.unit_price, r.line_amount, r.vat_rate, r.lot_code, r.expiry,
           coalesce(r.field_confidence, '{}'::jsonb), coalesce(r.checks, '{}'::text[]),
           coalesce(r.extracted, '{}'::jsonb), v.created_by
      from jsonb_array_elements(coalesce(p_result -> 'lines', '[]'::jsonb))
             with ordinality as e(elem, ord)
      cross join lateral jsonb_to_record(e.elem) as r(
        raw_description text, supplier_code text, qty numeric, unit_raw text, unit_price numeric,
        line_amount numeric, vat_rate numeric, lot_code text, expiry date,
        field_confidence jsonb, checks text[], extracted jsonb);

  if not v.duplicate_override then
    v_lock := app.invoice_dup_lock_key(v.tenant_id, v_vat, v_name, v_number, v_date);
    if v_lock is not null then
      -- Held until this transaction ends, so a concurrent extraction of the same invoice waits
      -- here and then sees this one's committed result.
      perform pg_advisory_xact_lock(v_lock);
      if v_vat is not null then
        v_dup := app.find_duplicate_invoice_in(v.tenant_id, v_vat, v_number, v_date, p_invoice);
      else
        v_warn := app.find_name_duplicate_invoice_in(
          v.tenant_id, v_name, v_number, v_date, p_invoice);
      end if;
    end if;
  end if;
  v_status := case when v_dup is not null then 'duplicate' else 'review' end;

  update public.invoice
     set status = v_status,
         duplicate_of = v_dup,
         duplicate_warning_of = v_warn,
         supplier_vat = v_vat,
         supplier_name = v_name,
         number_raw = v_number,
         invoice_date = v_date,
         due_date = nullif(h ->> 'due_date', '')::date,
         payment_terms = nullif(h ->> 'payment_terms', ''),
         net_total = (h ->> 'net_total')::numeric,
         vat_total = (h ->> 'vat_total')::numeric,
         gross_total = (h ->> 'gross_total')::numeric,
         totals_diff = (p_result ->> 'totals_diff')::numeric,
         gate_flags = coalesce(
           array(select jsonb_array_elements_text(p_result -> 'gate_flags')), '{}'::text[]),
         field_confidence = p_result -> 'field_confidence',
         extraction_json = p_result -> 'extraction_json',
         extraction_model = p_model,
         extraction_error = null,
         next_attempt_at = null,
         claim_token = null,
         extracted_at = now()
   where id = p_invoice;
  return v_status;
end
$$;

-- Records a failed attempt. Retryable and attempts left: back to received after the backoff for
-- this attempt (the last value is reused past the end of the list). Otherwise extraction_failed.
-- p_backoff_seconds[n] is the wait after the n-th attempt. No lines are written either way.
create function public.extraction_fail(
  p_invoice uuid,
  p_claim_token uuid,
  p_code text,
  p_retryable boolean,
  p_backoff_seconds int[],
  p_max_attempts int
) returns public.invoice_status
  language plpgsql
  set search_path = ''
as $$
declare
  v public.invoice;
  v_retry boolean;
  v_wait int;
  v_status public.invoice_status;
begin
  select * into v from public.invoice where id = p_invoice for update;
  if not found or v.status <> 'extracting' or v.claim_token is distinct from p_claim_token then
    raise exception 'stale_claim' using errcode = 'P0001';
  end if;
  v_retry := p_retryable and v.attempts < p_max_attempts;
  v_wait := coalesce(p_backoff_seconds[v.attempts],
                     p_backoff_seconds[coalesce(array_upper(p_backoff_seconds, 1), 0)], 0);
  v_status := case when v_retry then 'received' else 'extraction_failed' end;
  update public.invoice
     set status = v_status,
         next_attempt_at = case when v_retry then now() + make_interval(secs => v_wait) end,
         extraction_error = p_code,
         claim_token = null
   where id = p_invoice;
  return v_status;
end
$$;

-- Gives the invoice back without burning an attempt (a configuration fault such as a rejected
-- provider key): received again after p_backoff_seconds.
create function public.extraction_release(
  p_invoice uuid,
  p_claim_token uuid,
  p_code text,
  p_backoff_seconds int
) returns public.invoice_status
  language plpgsql
  set search_path = ''
as $$
declare
  v public.invoice;
  v_status public.invoice_status;
begin
  select * into v from public.invoice where id = p_invoice for update;
  if not found or v.status <> 'extracting' or v.claim_token is distinct from p_claim_token then
    raise exception 'stale_claim' using errcode = 'P0001';
  end if;
  update public.invoice
     set status = 'received',
         attempts = greatest(attempts - 1, 0),
         next_attempt_at = now() + make_interval(secs => p_backoff_seconds),
         extraction_error = p_code,
         claim_token = null
   where id = p_invoice
  returning status into v_status;
  return v_status;
end
$$;

revoke all on function
  app.invoice_dup_lock_key(uuid, text, text, text, date),
  public.extraction_claim(int, int),
  public.extraction_complete(uuid, uuid, jsonb, text),
  public.extraction_fail(uuid, uuid, text, boolean, int[], int),
  public.extraction_release(uuid, uuid, text, int)
  from public, anon, authenticated;
grant execute on function
  app.invoice_dup_lock_key(uuid, text, text, text, date),
  public.extraction_claim(int, int),
  public.extraction_complete(uuid, uuid, jsonb, text),
  public.extraction_fail(uuid, uuid, text, boolean, int[], int),
  public.extraction_release(uuid, uuid, text, int)
  to service_role;
