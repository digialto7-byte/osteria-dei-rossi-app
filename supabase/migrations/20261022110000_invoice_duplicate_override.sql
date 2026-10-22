-- M2 founder answer (plan V3): an owner may clear a wrong duplicate flag, so a flagged invoice
-- can go back to review and two confirmed invoices may share the supplier + number + date key.
-- Schema only: the endpoint and its audit trail arrive with the M4 review screen.

-- The duplicate check (find_duplicate_invoice) only warns; it no longer blocks at the database.
drop index public.invoice_dedup_uq;
create index invoice_dedup_idx
  on public.invoice (tenant_id, supplier_vat, number, invoice_date)
  where status not in ('duplicate', 'rejected');

-- Same guard as before, plus duplicate -> review. approved -> review stays forbidden.
create or replace function app.invoice_guard() returns trigger
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
    or (old.status = 'duplicate' and new.status in ('review', 'rejected'))
  ) then
    raise exception 'invalid_status_transition' using errcode = 'P0001';
  end if;
  return new;
end
$$;
