-- M2 founder answers (plan V5): duplicate check for suppliers without a VAT number.
-- supplier_name is written by extraction (M3). A name match is only a warning
-- (duplicate_warning_of), never the 'duplicate' status; duplicate_override records that the
-- owner/admin confirmed "not a duplicate". Both are written by later endpoints/procedures, so
-- the authenticated role gets no new grant (insert and update stay as in 20261022100000).

alter table public.invoice
  add column supplier_name text,
  add column duplicate_warning_of uuid,
  add column duplicate_override boolean not null default false,
  add constraint invoice_supplier_name_ck check (length(btrim(supplier_name)) between 1 and 200),
  add constraint invoice_duplicate_warning_of_fk foreign key (tenant_id, duplicate_warning_of)
    references public.invoice (tenant_id, id),
  add constraint invoice_duplicate_warning_of_self_ck check (duplicate_warning_of <> id);

create index invoice_name_dedup_idx
  on public.invoice (tenant_id, (app.normalise_name(supplier_name)), number, invoice_date)
  where supplier_vat is null and status not in ('duplicate', 'rejected');

-- Same shape as app.find_duplicate_invoice_in, keyed on the normalised supplier name and only
-- over invoices that have no VAT number. Punctuation in the number still matters
-- (founder decision: FT 1/2026 is not FT-1-2026).
create function app.find_name_duplicate_invoice_in(
  p_tenant uuid,
  p_supplier_name text,
  p_number text,
  p_date date,
  p_exclude uuid default null
) returns uuid
  language sql stable
  set search_path = ''
as $$
  select i.id
    from public.invoice i
   where p_supplier_name is not null and p_number is not null and p_date is not null
     and i.tenant_id = p_tenant
     and i.supplier_vat is null
     and app.normalise_name(i.supplier_name) = app.normalise_name(p_supplier_name)
     and i.number = app.normalise_invoice_number(p_number)
     and i.invoice_date = p_date
     and i.status not in ('duplicate', 'rejected')
     and i.id is distinct from p_exclude
   order by i.created_at, i.id
   limit 1
$$;

-- For signed-in users: always the caller's own tenant, RLS applies (chef and waiter get null).
create function public.find_name_duplicate_invoice(
  supplier_name text,
  invoice_number text,
  invoice_date date,
  exclude_id uuid default null
) returns uuid
  language sql stable
  set search_path = ''
as $$
  select app.find_name_duplicate_invoice_in(
    (select app.tenant_id()), supplier_name, invoice_number, invoice_date, exclude_id)
$$;

revoke all on function app.find_name_duplicate_invoice_in(uuid, text, text, date, uuid)
  from public, anon;
grant execute on function app.find_name_duplicate_invoice_in(uuid, text, text, date, uuid)
  to authenticated, service_role;
revoke all on function public.find_name_duplicate_invoice(text, text, date, uuid)
  from public, anon;
grant execute on function public.find_name_duplicate_invoice(text, text, date, uuid)
  to authenticated;
