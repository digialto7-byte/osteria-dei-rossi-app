-- P2-7 S1 (docs/plans/2026-11-14-p2-7-xml-invoice-upload.md section 3.2, 5 S1): the XML columns and constraints.
--
--   invoice       document_type (TD01, TD24, TD25), xml_format (FPR12, FPA12), xml_sha256 (the sha256 of the unwrapped XML), xml_body_index and
--                 xml_body_count (1..10, index <= count; a lotto di fatture is one invoice per body) and xml_notes (what Costi ignored in the file).
--                 The five metadata columns are all null (a photo or PDF) or all set (an XML file), and an XML file is the only thing that carries a
--                 document type. The file path and MIME constraints accept .xml / application/xml and .p7m / application/pkcs7-mime next to the
--                 three existing kinds (replaced under the same names; every existing row still satisfies them). The same file (tenant, sha256,
--                 body) cannot be live twice: a partial unique index over the rows that are not rejected, so a rejected copy may be uploaded again.
--                 The six XML columns never change after insert, for any role (a second guard trigger; app.invoice_guard is not replaced).
--   invoice_line  vat_nature (the Natura code of a 0 % line) and xml_details (a bounded jsonb object: codes, other data, discounts).
--
-- No grant is widened: authenticated keeps the M2 column insert grant on invoice, which does not include the new columns, and reads them through
-- the existing select grant and RLS. The columns are written only by the definer of a later step (import_xml_invoices).
-- Ledgers, procedures and the purge list are untouched.

alter table public.invoice
  add column document_type text,
  add column xml_format text,
  add column xml_sha256 text,
  add column xml_body_index smallint,
  add column xml_body_count smallint,
  add column xml_notes text[] not null default '{}',
  add constraint invoice_document_type_ck check (document_type in ('TD01', 'TD24', 'TD25')),
  add constraint invoice_xml_format_ck check (xml_format in ('FPR12', 'FPA12')),
  add constraint invoice_xml_sha256_ck check (xml_sha256 ~ '^[0-9a-f]{64}$'),
  add constraint invoice_xml_body_ck check (
    xml_body_count between 1 and 10 and xml_body_index between 1 and xml_body_count),
  add constraint invoice_xml_notes_ck check (xml_notes <@ array[
    'attachments', 'ddt_refs', 'order_refs', 'text_lines_skipped', 'rounding_line_added',
    'riepilogo_negative_residual', 'document_discount', 'stamp_duty', 'instalments', 'buyer_unchecked',
    'vehicle_data']),
  add constraint invoice_xml_meta_ck check (
    (document_type is null and xml_format is null and xml_sha256 is null
       and xml_body_index is null and xml_body_count is null)
    or (document_type is not null and xml_format is not null and xml_sha256 is not null
       and xml_body_index is not null and xml_body_count is not null)),
  add constraint invoice_xml_mime_ck check (
    (document_type is not null) = (file_mime in ('application/xml', 'application/pkcs7-mime')));

-- The two file constraints, widened. Same names, same columns; every existing row (pdf, jpg, png) satisfies both.
alter table public.invoice
  drop constraint invoice_file_path_ck,
  drop constraint invoice_file_mime_ck;
alter table public.invoice
  add constraint invoice_file_path_ck
    check (file_path ~ ('^' || tenant_id || '/[0-9]{4}/' || id || '\.(pdf|jpg|png|xml|p7m)$')),
  add constraint invoice_file_mime_ck check (
    (file_mime = 'application/pdf' and file_path like '%.pdf')
    or (file_mime = 'image/jpeg' and file_path like '%.jpg')
    or (file_mime = 'image/png' and file_path like '%.png')
    or (file_mime = 'application/xml' and file_path like '%.xml')
    or (file_mime = 'application/pkcs7-mime' and file_path like '%.p7m')
  );

-- The exact-file key: one live invoice per file body in a tenant.
create unique index invoice_xml_file_uq
  on public.invoice (tenant_id, xml_sha256, xml_body_index)
  where xml_sha256 is not null and status <> 'rejected';

-- The XML columns never change, for any writer (the service role and the migration owner included).
create function app.invoice_xml_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.document_type is distinct from old.document_type
     or new.xml_format is distinct from old.xml_format
     or new.xml_sha256 is distinct from old.xml_sha256
     or new.xml_body_index is distinct from old.xml_body_index
     or new.xml_body_count is distinct from old.xml_body_count
     or new.xml_notes is distinct from old.xml_notes then
    raise exception 'invoice_immutable' using errcode = 'P0001';
  end if;
  return new;
end
$$;
revoke all on function app.invoice_xml_guard() from public, anon, authenticated;

create trigger invoice_xml_guard
  before update of document_type, xml_format, xml_sha256, xml_body_index, xml_body_count, xml_notes on public.invoice
  for each row execute function app.invoice_xml_guard();

alter table public.invoice_line
  add column vat_nature text,
  add column xml_details jsonb,
  add constraint invoice_line_vat_nature_ck check (vat_nature in (
    'N1', 'N2.1', 'N2.2', 'N3.1', 'N3.2', 'N3.3', 'N3.4', 'N3.5', 'N3.6', 'N4', 'N5',
    'N6.1', 'N6.2', 'N6.3', 'N6.4', 'N6.5', 'N6.6', 'N6.7', 'N6.8', 'N6.9', 'N7')),
  add constraint invoice_line_xml_details_ck check (
    jsonb_typeof(xml_details) = 'object' and pg_column_size(xml_details) <= 16384);
