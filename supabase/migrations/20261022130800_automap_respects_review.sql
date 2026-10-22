-- M4 fix: auto-mapping and propagation never touch a line the reviewer already worked on.
-- Replaces app.automap_lines and app.automap_invoice of 20261022130300 (same signatures and grants);
-- app.propagate_mapping calls automap_lines and so follows. History stays append-only.
--
-- "Edited" (the rule, in one place: app.line_is_untouched): a line is open to auto-mapping only if
-- it has none of: an ingredient or supplier item, a mapping_source, a stored ingredient or supplier
-- item suggestion, a non-empty corrected_fields, or a reviewed_at stamp. The stamp is what
-- catches a decision that leaves no other trace, such as non-stock and back to stock. The suggestion
-- columns are the correction baseline: they are written once, only while they are null, and a
-- supplier change clears them first. The unit suggestion is written by the unit pass, which runs
-- before the mapping and so must not block it; a cleared unit shows as corrected_fields {unit}.
-- A line the reviewer touched in any way is therefore left to the reviewer, also after a supplier
-- change (the owner maps it by hand).
-- Round 2 narrowed this: see 20261022130900, where only a mapping decision stops auto-mapping.
-- Every line written here ends with corrected_fields = app.line_corrected_fields(row).

create function app.line_is_untouched(l public.invoice_line) returns boolean
  language sql immutable
  set search_path = ''
as $$
  select l.ingredient_id is null and l.supplier_item_id is null and l.mapping_source is null
     and l.suggested_ingredient_id is null and l.suggested_supplier_item_id is null
     and cardinality(l.corrected_fields) = 0 and l.reviewed_at is null
$$;

-- Maps the untouched, active, original stock lines of one invoice from the supplier's remembered
-- articles (see 20261022130300 for the lookup). p_item restricts it to one article (propagation).
-- Returns the number of lines mapped.
create or replace function app.automap_lines(p_invoice uuid, p_item uuid default null) returns int
  language plpgsql
  set search_path = ''
as $$
declare
  v public.invoice;
  ids uuid[];
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
       and l.is_stock and app.line_is_untouched(l)
       and (p_item is null or m.item_id = p_item)
  ),
  written as (
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
     where t.id = h.line_id
    returning t.id
  )
  select coalesce(array_agg(w.id), '{}') into ids from written w;
  -- The statement above sees the old rows, so the correction list is recomputed after it.
  update public.invoice_line t
     set corrected_fields = app.line_corrected_fields(t)
   where t.id = any (ids);
  return coalesce(cardinality(ids), 0);
end
$$;

-- As in 20261022130300, but the unit pass only fills the unit of an untouched line, and
-- recomputes corrected_fields on the lines it writes.
create or replace function app.automap_invoice(p_invoice uuid) returns int
  language plpgsql
  set search_path = ''
as $$
declare
  v public.invoice;
  v_supplier uuid;
  v_suggestion uuid;
  ids uuid[];
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

  with written as (
    update public.invoice_line l
       set unit = app.parse_unit_raw(l.unit_raw), suggested_unit = app.parse_unit_raw(l.unit_raw)
     where l.tenant_id = v.tenant_id and l.invoice_id = v.id
       and l.parent_line_id is null and l.split_at is null
       and l.unit is null and l.suggested_unit is null and app.parse_unit_raw(l.unit_raw) is not null
       and app.line_is_untouched(l)
    returning l.id
  )
  select coalesce(array_agg(w.id), '{}') into ids from written w;
  update public.invoice_line t
     set corrected_fields = app.line_corrected_fields(t)
   where t.id = any (ids);

  return app.automap_lines(p_invoice);
end
$$;

revoke all on function app.line_is_untouched(public.invoice_line) from public, anon, authenticated;
-- extraction_complete is SECURITY INVOKER (service_role), so the pure helpers it now reaches through
-- auto-mapping are granted to service_role, as description_hash and parse_unit_raw are. Neither reads
-- a table.
grant execute on function app.line_is_untouched(public.invoice_line),
  app.line_corrected_fields(public.invoice_line) to service_role;
