-- M2: duplicate check by supplier VAT + invoice number + date (plan §3.4). M3 calls it after
-- extraction and sets status 'duplicate' and duplicate_of; M2 has no endpoint for it.

-- Core lookup with an explicit tenant, for the extraction worker (service role, no JWT).
-- SECURITY INVOKER: callers with RLS only ever see their own tenant's rows anyway.
create function app.find_duplicate_invoice_in(
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
     and i.id is distinct from p_exclude
   order by i.created_at, i.id
   limit 1
$$;

-- For signed-in users: always the caller's own tenant, RLS applies (chef and waiter get null).
create function public.find_duplicate_invoice(
  supplier_vat text,
  invoice_number text,
  invoice_date date,
  exclude_id uuid default null
) returns uuid
  language sql stable
  set search_path = ''
as $$
  select app.find_duplicate_invoice_in(
    (select app.tenant_id()), supplier_vat, invoice_number, invoice_date, exclude_id)
$$;

revoke all on function app.find_duplicate_invoice_in(uuid, text, text, date, uuid) from public, anon;
grant execute on function app.find_duplicate_invoice_in(uuid, text, text, date, uuid)
  to authenticated, service_role;
revoke all on function public.find_duplicate_invoice(text, text, date, uuid) from public, anon;
grant execute on function public.find_duplicate_invoice(text, text, date, uuid) to authenticated;
