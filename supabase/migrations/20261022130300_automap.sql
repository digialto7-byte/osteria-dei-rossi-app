-- M4: auto-mapping at extraction completion and propagation of new mappings (M4 plan §3.1.1, §3.2).
-- It runs inside extraction_complete (service_role, no JWT), so every lookup filters by the
-- invoice's own tenant explicitly. Nothing is swallowed: if it raises, the completion fails as
-- store_failed (M3) and the owner can retry the reading.

-- Maps the unmapped, active, original stock lines of one invoice from the supplier's remembered
-- articles. A line with a supplier code is looked up by code first, then by description; a line
-- without a code by description. The article and its ingredient must be active. p_item restricts
-- the lookup to one article (propagation). The suggestion columns are the fixed baseline the
-- correction metric compares against. Returns the number of lines mapped.
create function app.automap_lines(p_invoice uuid, p_item uuid default null) returns int
  language plpgsql
  set search_path = ''
as $$
declare
  v public.invoice;
  mapped int;
begin
  select * into v from public.invoice i where i.id = p_invoice;
  if not found or v.supplier_id is null then
    return 0;
  end if;
  with hit as (
    select l.id as line_id, m.item_id, m.ingredient_id, m.invoice_unit
      from public.invoice_line l
     cross join lateral (
       select si.id as item_id, si.ingredient_id, si.invoice_unit
         from public.supplier_item si
         join public.ingredient g on g.tenant_id = si.tenant_id and g.id = si.ingredient_id
        where si.tenant_id = v.tenant_id and si.supplier_id = v.supplier_id
          and si.is_active and g.is_active
          and ((l.supplier_code is not null and si.supplier_code = l.supplier_code)
               or si.description_hash = app.description_hash(l.raw_description))
        -- Code match first. coalesce: a hash-keyed item compares to null, and DESC sorts nulls first.
        order by coalesce(si.supplier_code = l.supplier_code, false) desc, si.id
        limit 1) m
     where l.tenant_id = v.tenant_id and l.invoice_id = v.id
       and l.parent_line_id is null and l.split_at is null
       and l.is_stock and l.mapping_source is null
       and (p_item is null or m.item_id = p_item)
  )
  update public.invoice_line t
     set ingredient_id = h.ingredient_id,
         supplier_item_id = h.item_id,
         suggested_ingredient_id = h.ingredient_id,
         suggested_supplier_item_id = h.item_id,
         mapping_source = 'auto',
         -- A unit parsed from the printed one stays; otherwise the article's remembered unit.
         unit = coalesce(t.unit, h.invoice_unit),
         suggested_unit = case when t.unit is null then h.invoice_unit else t.suggested_unit end
    from hit h
   where t.id = h.line_id;
  get diagnostics mapped = row_count;
  return mapped;
end
$$;

-- Everything that can be decided about an invoice from its extraction:
-- 1. no supplier yet: link the active supplier with the extracted VAT; with no VAT, suggest the one
--    active VAT-less supplier with the same normalised name (a name match needs one tap);
-- 2. parse the printed unit of each active original line;
-- 3. map the lines (app.automap_lines).
-- Returns the number of lines mapped.
create function app.automap_invoice(p_invoice uuid) returns int
  language plpgsql
  set search_path = ''
as $$
declare
  v public.invoice;
  v_supplier uuid;
  v_suggestion uuid;
begin
  select * into v from public.invoice i where i.id = p_invoice;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v.supplier_id is null then
    if v.supplier_vat is not null then
      select s.id into v_supplier
        from public.supplier s
       where s.tenant_id = v.tenant_id and s.vat_number = v.supplier_vat and s.is_active;
      if v_supplier is not null then
        update public.invoice set supplier_id = v_supplier where id = p_invoice;
      end if;
    elsif v.supplier_name is not null then
      select min(s.id::text)::uuid into v_suggestion
        from public.supplier s
       where s.tenant_id = v.tenant_id and s.vat_number is null and s.is_active
         and app.normalise_name(s.name) = app.normalise_name(v.supplier_name)
      having count(*) = 1;
      if v_suggestion is not null then
        update public.invoice set supplier_suggestion_id = v_suggestion where id = p_invoice;
      end if;
    end if;
  end if;

  update public.invoice_line l
     set unit = app.parse_unit_raw(l.unit_raw), suggested_unit = app.parse_unit_raw(l.unit_raw)
   where l.tenant_id = v.tenant_id and l.invoice_id = v.id
     and l.parent_line_id is null and l.split_at is null
     and l.unit is null and app.parse_unit_raw(l.unit_raw) is not null;

  return app.automap_lines(p_invoice);
end
$$;

-- A new or changed mapping reaches the unmapped lines of the same supplier in other invoices that
-- are still in review, so two invoices uploaded together both benefit. Invoices are visited in a
-- fixed order. Returns the number of lines mapped.
create function app.propagate_mapping(p_item uuid) returns int
  language plpgsql
  set search_path = ''
as $$
declare
  it public.supplier_item;
  inv record;
  total int := 0;
begin
  select * into it from public.supplier_item si where si.id = p_item;
  if not found then
    return 0;
  end if;
  for inv in
    select i.id
      from public.invoice i
     where i.tenant_id = it.tenant_id and i.supplier_id = it.supplier_id and i.status = 'review'
     order by i.created_at, i.id
  loop
    total := total + app.automap_lines(inv.id, p_item);
  end loop;
  return total;
end
$$;

revoke all on function app.automap_lines(uuid, uuid), app.automap_invoice(uuid),
  app.propagate_mapping(uuid) from public, anon, authenticated;
grant execute on function app.automap_lines(uuid, uuid), app.automap_invoice(uuid) to service_role;

-- extraction_complete as in 20261022120100, plus auto-mapping. It runs after the header is stored
-- (the supplier VAT and name it reads are written by that update), and does not affect the
-- duplicate decision or the returned status. Signature and grants are unchanged.
create or replace function public.extraction_complete(
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

  perform app.automap_invoice(p_invoice);
  return v_status;
end
$$;
