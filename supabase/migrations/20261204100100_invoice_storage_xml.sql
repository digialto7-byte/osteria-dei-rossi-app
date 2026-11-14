-- P2-7 S2 (docs/plans/2026-11-14-p2-7-xml-invoice-upload.md section 3.2, 5 S2): the private `invoices` bucket takes the two e-invoice kinds, .xml (application/xml)
-- and .p7m (application/pkcs7-mime), next to PDF, JPEG and PNG. The size limit stays 4 MiB (src/server/invoices/constants.ts MAX_UPLOAD_BYTES; SdI's own limit is 5 MB).
--
-- Objects live at <tenant id>/<yyyy>/<invoice id>.<pdf|jpg|png|xml|p7m>: lower case, one extension, one folder level. The insert policy is dropped and created
-- again with that name pattern, with the same tenant-folder and role conditions as before. The select policy is not touched. There is still NO update and NO delete
-- policy for any role: an e-invoice file is kept for 10 years like a PDF (plan section 3.6 rule 5), and nothing can be overwritten, moved or removed through the API.
update storage.buckets
   set public = false,
       file_size_limit = 4194304,
       allowed_mime_types = '{application/pdf,image/jpeg,image/png,application/xml,application/pkcs7-mime}'
 where id = 'invoices';

drop policy invoices_object_insert on storage.objects;
create policy invoices_object_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'invoices'
    and (storage.foldername(name))[1] = (select app.tenant_id())::text
    and (select app.role()) in ('owner', 'admin')
    and name ~ '^[0-9a-f-]{36}/[0-9]{4}/[0-9a-f-]{36}\.(pdf|jpg|png|xml|p7m)$'
  );
