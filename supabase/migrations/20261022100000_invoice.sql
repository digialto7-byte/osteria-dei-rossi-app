-- M2: invoices (plan §3.5.1). Only the columns M2 needs; extraction columns arrive in M3.
-- Owner/admin only (invoices carry supplier prices, plan §3.11.2). No UPDATE grant: status moves
-- through M3+ procedures, which run as the migration owner or service role and still pass the
-- guard trigger below. No delete path at all (10-year retention, plan §3.6).

create type public.invoice_status as enum
  ('received', 'extracting', 'extraction_failed', 'review', 'approved', 'rejected', 'duplicate');
create type public.invoice_source as enum ('upload', 'drive');

-- The "same invoice number" key: trimmed, no whitespace, upper case. Null-safe.
create function app.normalise_invoice_number(s text) returns text
  language sql immutable
  set search_path = ''
as $$
  select upper(regexp_replace(btrim(s), '\s+', '', 'g'))
$$;

create table public.invoice (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenant (id),
  status public.invoice_status not null default 'received',
  source public.invoice_source not null default 'upload',
  -- The PRD's pdf_path, renamed because photos are stored too: <tenant>/<yyyy>/<id>.<ext>.
  file_path text not null,
  file_mime text not null,
  file_size_bytes integer not null,
  original_filename text,
  -- Duplicate key, written from M3.
  supplier_vat text,
  number_raw text,
  number text generated always as (app.normalise_invoice_number(number_raw)) stored,
  invoice_date date,
  duplicate_of uuid,
  created_at timestamptz not null default now(),
  created_by uuid default app.app_user_id() references public.app_user (id),
  constraint invoice_tenant_id_id_uq unique (tenant_id, id),
  constraint invoice_file_path_uq unique (file_path),
  constraint invoice_file_path_ck
    check (file_path ~ ('^' || tenant_id || '/[0-9]{4}/' || id || '\.(pdf|jpg|png)$')),
  constraint invoice_file_mime_ck check (
    (file_mime = 'application/pdf' and file_path like '%.pdf')
    or (file_mime = 'image/jpeg' and file_path like '%.jpg')
    or (file_mime = 'image/png' and file_path like '%.png')
  ),
  constraint invoice_file_size_ck check (file_size_bytes > 0 and file_size_bytes <= 4194304),
  constraint invoice_original_filename_ck
    check (length(original_filename) between 1 and 200),
  constraint invoice_supplier_vat_ck check (supplier_vat ~ '^[A-Z]{2}[0-9A-Z]{2,12}$'),
  constraint invoice_number_raw_ck check (length(number_raw) between 1 and 64),
  constraint invoice_duplicate_of_fk foreign key (tenant_id, duplicate_of)
    references public.invoice (tenant_id, id),
  constraint invoice_duplicate_of_self_ck check (duplicate_of <> id),
  constraint invoice_duplicate_status_ck check (status <> 'duplicate' or duplicate_of is not null)
);

-- One live invoice per supplier + number + date; duplicates and rejected ones may repeat the key.
create unique index invoice_dedup_uq
  on public.invoice (tenant_id, supplier_vat, number, invoice_date)
  where status not in ('duplicate', 'rejected');
create index invoice_list_idx on public.invoice (tenant_id, created_at desc);

-- Guards every writer, including the migration owner and the secret key: the stored file never
-- changes, and status only moves along the invoice lifecycle.
create function app.invoice_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.file_path is distinct from old.file_path
     or new.file_mime is distinct from old.file_mime
     or new.file_size_bytes is distinct from old.file_size_bytes
     or new.source is distinct from old.source
     or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'invoice_immutable' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'received' and new.status = 'extracting')
    or (old.status = 'extracting'
        and new.status in ('received', 'review', 'duplicate', 'extraction_failed'))
    or (old.status = 'extraction_failed' and new.status = 'received')
    or (old.status = 'review' and new.status in ('approved', 'rejected', 'duplicate'))
    or (old.status = 'duplicate' and new.status = 'rejected')
  ) then
    raise exception 'invalid_status_transition' using errcode = 'P0001';
  end if;
  return new;
end
$$;

create trigger invoice_guard
  before update on public.invoice
  for each row execute function app.invoice_guard();

alter table public.invoice enable row level security;

revoke all on public.invoice from anon, authenticated;
revoke delete, truncate on public.invoice from service_role;

grant select,
  insert (id, file_path, file_mime, file_size_bytes, original_filename)
  on public.invoice to authenticated;

create policy invoice_select on public.invoice
  for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'));
create policy invoice_insert on public.invoice
  for insert to authenticated
  with check (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'));

revoke all on function app.normalise_invoice_number(text), app.invoice_guard() from public, anon;
grant execute on function app.normalise_invoice_number(text) to authenticated, service_role;
