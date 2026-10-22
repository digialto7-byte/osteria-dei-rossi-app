-- M2: the private `invoices` bucket and its Storage policies. Created here (not in config.toml)
-- so the local stack and production get the same bucket from `supabase db push`.
-- Limits match src/server/invoices/constants.ts (MAX_UPLOAD_BYTES = 4 MiB).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('invoices', 'invoices', false, 4194304, '{application/pdf,image/jpeg,image/png}')
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Objects live at <tenant id>/<yyyy>/<invoice id>.<pdf|jpg|png>. Owner and admin of that tenant
-- may read (signed URLs need this policy) and add. There is deliberately NO update and NO delete
-- policy for any role: nothing can be overwritten, moved or removed through the API, because
-- invoices are kept for 10 years (plan §3.6 rule 5). Only a service role or the migration owner
-- could change objects, and no application code does.
create policy invoices_object_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'invoices'
    and (storage.foldername(name))[1] = (select app.tenant_id())::text
    and (select app.role()) in ('owner', 'admin')
  );

create policy invoices_object_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'invoices'
    and (storage.foldername(name))[1] = (select app.tenant_id())::text
    and (select app.role()) in ('owner', 'admin')
    and name ~ '^[0-9a-f-]{36}/[0-9]{4}/[0-9a-f-]{36}\.(pdf|jpg|png)$'
  );
