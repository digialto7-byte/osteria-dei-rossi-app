-- M4: helpers for the review procedures (M4 plan §3.2). All in schema app, which the Data API does
-- not expose. Execute is revoked from public, anon and authenticated: the review procedures are
-- SECURITY DEFINER and call these as their owner. Only description_hash and parse_unit_raw are
-- granted to service_role, because extraction_complete (SECURITY INVOKER) will use them for
-- auto-mapping. The functions that read tables filter by tenant explicitly: a definer owner
-- bypasses RLS.

-- Rules shared with src/server/extraction/checks.ts. tests/parity/review-sql-parity.test.ts
-- fails if these constants or the rules below drift from the TypeScript side.
create function app.allowed_vat_rates() returns numeric[]
  language sql immutable
  set search_path = ''
as $$ select array[0, 4, 5, 10, 22]::numeric[] $$;

-- Ten-thousandths of a euro (integer maths): 500 = 0.05 EUR.
create function app.total_tolerance_ten_thousandths() returns int
  language sql immutable
  set search_path = ''
as $$ select 500 $$;

create function app.line_amount_tolerance_ten_thousandths() returns int
  language sql immutable
  set search_path = ''
as $$ select 500 $$;

-- The auto-mapping key for a line without a supplier code: SHA-256 (hex) of the description with
-- Unicode NFC, single spaces and lower case. One implementation in SQL, so nothing can disagree.
create function app.description_hash(s text) returns text
  language sql immutable strict
  set search_path = ''
as $$
  select encode(sha256(convert_to(
    lower(regexp_replace(normalize(btrim(s), NFC), '\s+', ' ', 'g')), 'UTF8')), 'hex')
$$;

-- The printed unit to one of kg, g, l, ml, pz, conf. The list is extended when the sample
-- invoices (M3 Q1) arrive. Null when not recognised.
create function app.parse_unit_raw(s text) returns text
  language sql immutable
  set search_path = ''
as $$
  select case regexp_replace(lower(s), '[.\s]', '', 'g')
    when 'kg' then 'kg' when 'kgs' then 'kg' when 'chilo' then 'kg' when 'chili' then 'kg'
    when 'g' then 'g' when 'gr' then 'g' when 'grammi' then 'g'
    when 'l' then 'l' when 'lt' then 'l' when 'litro' then 'l' when 'litri' then 'l'
    when 'ml' then 'ml'
    when 'pz' then 'pz' when 'pezzo' then 'pz' when 'pezzi' then 'pz' when 'n' then 'pz'
    when 'nr' then 'pz' when 'num' then 'pz' when 'cad' then 'pz' when 'un' then 'pz'
    when 'ct' then 'conf' when 'crt' then 'conf' when 'cartone' then 'conf' when 'cf' then 'conf'
    when 'conf' then 'conf' when 'confezione' then 'conf' when 'cassa' then 'conf'
    when 'collo' then 'conf' when 'sc' then 'conf' when 'scatola' then 'conf'
  end
$$;

-- The per-line checks of checks.ts: qty x unit_price against the amount, and the VAT rate list.
create function app.line_checks(
  p_qty numeric, p_unit_price numeric, p_line_amount numeric, p_vat_rate numeric
) returns text[]
  language sql immutable
  set search_path = ''
as $$
  select array_remove(array[
    case when p_unit_price is not null
          and abs(round(p_qty * p_unit_price * 10000) - round(p_line_amount * 10000))
              > app.line_amount_tolerance_ten_thousandths()
         then 'amount_mismatch' end,
    case when p_vat_rate is not null and not (p_vat_rate = any (app.allowed_vat_rates()))
         then 'vat_rate_unexpected' end
  ], null)
$$;

-- Σ active line_amount + vat_total − gross_total against the tolerance (gross basis, as the
-- extraction). A missing total is flagged with a null difference. Active = not a split parent and
-- not a superseded child. One row, or none for an unknown invoice.
create function app.totals_gate(p_invoice uuid)
  returns table (flagged boolean, diff numeric)
  language sql stable
  set search_path = ''
as $$
  select i.vat_total is null or i.gross_total is null
           or abs(round((s.total + i.vat_total - i.gross_total) * 10000))
              > app.total_tolerance_ten_thousandths(),
         case when i.vat_total is null or i.gross_total is null then null
              else s.total + i.vat_total - i.gross_total end
    from public.invoice i
   cross join lateral (
     select coalesce(sum(l.line_amount), 0) as total
       from public.invoice_line l
      where l.tenant_id = i.tenant_id and l.invoice_id = i.id
        and l.split_at is null and l.superseded_at is null) s
   where i.id = p_invoice
$$;

-- Writes totals_diff and adds or removes only total_mismatch; the other flags stay as extracted.
-- total_mismatch goes first, as the extraction writes it.
create function app.refresh_gate(p_invoice uuid) returns void
  language plpgsql
  set search_path = ''
as $$
declare
  g record;
begin
  select * into g from app.totals_gate(p_invoice);
  if not found then
    return;
  end if;
  update public.invoice i
     set totals_diff = g.diff,
         gate_flags = case
           when g.flagged then array['total_mismatch']::text[]
                               || array_remove(i.gate_flags, 'total_mismatch')
           else array_remove(i.gate_flags, 'total_mismatch') end
   where i.id = p_invoice;
end
$$;

-- What the reviewer changed on a line (M4 plan §3.1.6), recomputed from the row, its extraction
-- baseline and the stored suggestions. A value the model could not read (null) and the reviewer
-- typed counts; a lot or expiry typed where none was extracted does not (PRD Traceability).
-- Split children are new lines without a baseline, so they never count.
create function app.line_corrected_fields(l public.invoice_line) returns text[]
  language plpgsql stable
  set search_path = ''
as $$
declare
  ex jsonb := l.extracted;
  result text[] := '{}';
begin
  if l.parent_line_id is not null then
    return result;
  end if;
  if l.qty is distinct from (ex ->> 'qty')::numeric then result := array_append(result, 'qty'); end if;
  if l.unit_price is distinct from (ex ->> 'unit_price')::numeric then
    result := array_append(result, 'unit_price');
  end if;
  if l.line_amount is distinct from (ex ->> 'line_amount')::numeric then
    result := array_append(result, 'line_amount');
  end if;
  if l.vat_rate is distinct from (ex ->> 'vat_rate')::numeric then result := array_append(result, 'vat_rate'); end if;
  if l.supplier_code is distinct from (ex ->> 'supplier_code') then
    result := array_append(result, 'supplier_code');
  end if;
  if (ex ->> 'lot_code') is not null and l.lot_code is distinct from (ex ->> 'lot_code') then
    result := array_append(result, 'lot_code');
  end if;
  if (ex ->> 'expiry') is not null and l.expiry is distinct from (ex ->> 'expiry')::date then
    result := array_append(result, 'expiry');
  end if;
  if l.suggested_unit is not null and l.unit is distinct from l.suggested_unit then
    result := array_append(result, 'unit');
  end if;
  if l.suggested_ingredient_id is not null
     and l.ingredient_id is distinct from l.suggested_ingredient_id then
    result := array_append(result, 'ingredient');
  end if;
  if l.pack_corrected then result := array_append(result, 'pack'); end if;
  return result;
end
$$;

-- Owner and admin review invoices (plan §3.11.2). The one place to change if the chef may too (V3).
create function app.require_invoice_reviewer() returns void
  language plpgsql
  set search_path = ''
as $$
begin
  if coalesce((select app.role())::text, '') not in ('owner', 'admin') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
end
$$;

-- Locks the caller's tenant's invoice for the rest of the transaction. Tenant B's invoice is
-- "not found" to tenant A. Only an invoice in review can be edited.
create function app.lock_review_invoice(p_invoice uuid) returns public.invoice
  language plpgsql
  set search_path = ''
as $$
declare
  v public.invoice;
begin
  select * into v
    from public.invoice i
   where i.id = p_invoice and i.tenant_id = (select app.tenant_id())
     for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v.status <> 'review' then
    raise exception 'invoice_not_in_review' using errcode = 'P0001';
  end if;
  return v;
end
$$;

-- The duplicate decision of extraction_complete, for an invoice in review whose supplier or
-- header changed: the same VAT, number and date as another live invoice moves it to duplicate; with
-- no VAT, a normalised-name match sets or clears the warning. Skipped when the owner cleared the
-- flag. The caller holds the invoice lock; the advisory lock serialises two invoices of one key.
create function app.recheck_duplicate(p_invoice uuid) returns void
  language plpgsql
  set search_path = ''
as $$
declare
  v public.invoice;
  v_lock bigint;
  v_dup uuid;
  v_warn uuid;
begin
  select * into v from public.invoice i where i.id = p_invoice;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v.duplicate_override or v.status <> 'review' then
    return;
  end if;
  v_lock := app.invoice_dup_lock_key(
    v.tenant_id, v.supplier_vat, v.supplier_name, v.number_raw, v.invoice_date);
  if v_lock is not null then
    perform pg_advisory_xact_lock(v_lock);
    if v.supplier_vat is not null then
      v_dup := app.find_duplicate_invoice_in(
        v.tenant_id, v.supplier_vat, v.number_raw, v.invoice_date, p_invoice);
    else
      v_warn := app.find_name_duplicate_invoice_in(
        v.tenant_id, v.supplier_name, v.number_raw, v.invoice_date, p_invoice);
    end if;
  end if;
  update public.invoice i
     set status = case when v_dup is not null then 'duplicate'::public.invoice_status else i.status end,
         duplicate_of = v_dup,
         duplicate_warning_of = v_warn
   where i.id = p_invoice;
end
$$;

revoke all on function
  app.allowed_vat_rates(),
  app.total_tolerance_ten_thousandths(),
  app.line_amount_tolerance_ten_thousandths(),
  app.description_hash(text),
  app.parse_unit_raw(text),
  app.line_checks(numeric, numeric, numeric, numeric),
  app.totals_gate(uuid),
  app.refresh_gate(uuid),
  app.line_corrected_fields(public.invoice_line),
  app.require_invoice_reviewer(),
  app.lock_review_invoice(uuid),
  app.recheck_duplicate(uuid)
  from public, anon, authenticated;
grant execute on function app.description_hash(text), app.parse_unit_raw(text) to service_role;
