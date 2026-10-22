-- M4: the extraction-quality report (M4 plan §3.2, PRD acceptance "90% of lines from a mapped
-- supplier need no correction", Gate 1). SECURITY INVOKER and stable: the caller's RLS applies,
-- so only owner/admin see any lines, and only their own tenant's.
--
-- Counts original lines (parent_line_id is null: a split parent counts once, its children not
-- at all) of invoices in review or approved (p_status 'all'), or approved only (p_status
-- 'approved'), whose extraction date, taken in the tenant's time zone, is between p_from and p_to. Duplicate,
-- rejected and never-extracted invoices are not counted. "Lines from a mapped supplier" are the
-- lines that had an auto-suggested ingredient. Rates are rounded to four decimals and are null
-- when there are no lines.
create function public.extraction_quality(
  p_from date,
  p_to date,
  p_supplier uuid default null,
  p_status text default 'all'
) returns jsonb
  language plpgsql
  stable
  set search_path = ''
as $$
declare
  result jsonb;
begin
  if p_from is null or p_to is null or p_from > p_to or p_status is null
     or p_status not in ('all', 'approved') then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;
  if p_to - p_from + 1 > 366 then
    raise exception 'range_too_long' using errcode = 'P0001';
  end if;

  with scope as (
    select i.id, i.supplier_id
      from public.invoice i
      join public.tenant t on t.id = i.tenant_id
     where i.status = any (case when p_status = 'approved'
                                then array['approved']::public.invoice_status[]
                                else array['review', 'approved']::public.invoice_status[] end)
       and (p_supplier is null or i.supplier_id = p_supplier)
       and i.extracted_at is not null
       and (i.extracted_at at time zone t.timezone)::date between p_from and p_to
  ),
  lines as (
    select l.corrected, l.corrected_fields, l.suggested_ingredient_id, l.mapping_source, l.split_at,
           s.supplier_id
      from public.invoice_line l
      join scope s on s.id = l.invoice_id
     where l.parent_line_id is null
  ),
  total as (
    select count(*) as n,
           count(*) filter (where corrected) as corrected,
           count(*) filter (where suggested_ingredient_id is not null) as auto_n,
           count(*) filter (where suggested_ingredient_id is not null and corrected) as auto_corrected,
           count(*) filter (where mapping_source = 'manual') as manual_n,
           count(*) filter (where split_at is not null) as split_n
      from lines
  ),
  by_supplier as (
    select l.supplier_id, sup.name, count(*) as n, count(*) filter (where l.corrected) as corrected
      from lines l
      join public.supplier sup on sup.id = l.supplier_id
     group by l.supplier_id, sup.name
  )
  select jsonb_build_object(
    'invoices', (select count(*) from scope),
    'lines', t.n,
    'correctedLines', t.corrected,
    'correctionRate', case when t.n > 0 then round(t.corrected::numeric / t.n, 4) end,
    'autoMappedLines', t.auto_n,
    'autoMappedCorrected', t.auto_corrected,
    'autoMappedCorrectionRate',
      case when t.auto_n > 0 then round(t.auto_corrected::numeric / t.auto_n, 4) end,
    'manualMappedLines', t.manual_n,
    'splitLines', t.split_n,
    'byField', (
      select jsonb_object_agg(f.field, (
        select count(*) from lines l where f.field = any (l.corrected_fields)))
        from unnest(array['qty', 'unit_price', 'line_amount', 'vat_rate', 'supplier_code', 'lot_code',
                          'expiry', 'unit', 'ingredient', 'pack']) as f(field)),
    'bySupplier', coalesce((
      select jsonb_agg(jsonb_build_object(
          'supplierId', b.supplier_id, 'name', b.name, 'lines', b.n, 'correctedLines', b.corrected,
          'correctionRate', round(b.corrected::numeric / b.n, 4))
        order by b.n desc, b.name)
        from by_supplier b), '[]'::jsonb))
    into result
    from total t;
  return result;
end
$$;

revoke all on function public.extraction_quality(date, date, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.extraction_quality(date, date, uuid, text) to authenticated;
