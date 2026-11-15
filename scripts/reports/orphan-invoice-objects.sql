-- Orphan invoice Storage objects: a READ-ONLY report (plan G6 / F19, docs/plans/2026-10-22-m02-invoice-upload.md section 6).
--
-- What it is: an upload stores the object in the private `invoices` bucket first and inserts the invoice row second
-- (src/server/invoices/invoices.ts, xml-upload.ts). If the row insert or the XML import RPC fails, the object stays
-- (the bucket has no delete policy) and only its invoice id and the SQLSTATE are logged. This report counts those
-- objects: objects in the bucket, older than the grace window, that no public.invoice row points at. Every stored body
-- (each body of a multi-body XML or p7m file gets its own object and its own invoice row) is referenced by exactly one
-- public.invoice.file_path. file_path is NOT the only reference: a demo reset (purge_demo_data) deletes the invoice rows
-- and keeps the object names in app.demo_purge_log.file_paths until its clean-up has run (cleaned_at is null). Those
-- objects are not orphans: they are counted in demo_cleanup_pending instead.
--
-- Read-only: one SELECT, no function, no DDL, no temp table, no write, no secret. Safe to run in a read-only transaction.
--
-- How to run (two steps; paste into the Supabase SQL connector, or use psql "$DATABASE_URL" -f scripts/reports/orphan-invoice-objects.sql):
--   1. Pre-check, run it first:  select rolbypassrls from pg_roles where rolname = current_user;
--      It must return true before the report can be trusted. Otherwise RLS filters public.invoice and every object looks orphaned.
--   2. Run the report below (the statement after this comment).
--      If orphan_count equals bucket_objects, check the role sees every invoice row first.
--
-- Output: always exactly one row, with these columns.
--   orphan_count          integer      number of orphan objects (0 when there are none); the full count, not capped
--   demo_cleanup_pending  integer      objects named in a demo purge log whose clean-up is not done (a count only)
--   bucket_objects        integer      all objects in the bucket older than the grace window (the sanity anchor)
--   total_bytes           bigint       sum of storage.objects.metadata ->> 'size' of the orphans (0 when there are none)
--   oldest_created        timestamptz  oldest created_at among the orphans (null when there are none)
--   newest_created        timestamptz  newest created_at among the orphans (null when there are none)
--   id_prefixes           text[]       the first 8 characters of the invoice id of the 50 OLDEST orphans at most, oldest first
--                                      (empty when there are none; orphan_count stays the full count). The invoice id is the
--                                      file-name segment of <tenant uuid>/<yyyy>/<invoice uuid>.<ext>, the same id the upload
--                                      error log carries; the tenant folder is never used. An object whose name is not of
--                                      that shape is counted and sized but has no prefix.
-- No full name, path or tenant id is ever returned.
--
-- Deletion is not done here. It waits until after go-live, by script, with the founder's OK.

with settings as (
  select
    'invoices'::text         as bucket,        -- INVOICE_BUCKET (src/server/invoices/constants.ts)
    interval '1 hour'        as grace_window   -- GRACE WINDOW: objects younger than this are ignored (an upload may be in flight)
),
pending as (
  select distinct unnest(l.file_paths) as path from app.demo_purge_log l where l.cleaned_at is null
),
objs as (
  select
    o.created_at,
    case when o.metadata ->> 'size' ~ '^[0-9]+$' then (o.metadata ->> 'size')::bigint else 0 end as size_bytes,
    i.file_path is not null as is_linked,
    p.path is not null as is_demo_pending,
    case when i.file_path is null and p.path is null
      then substring(o.name from '/([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,4}$')
    end as id_prefix
  from storage.objects o
  cross join settings s
  left join public.invoice i on i.file_path = o.name
  left join pending p on p.path = o.name
  where o.bucket_id = s.bucket
    and o.created_at <= now() - s.grace_window
)
select
  count(*) filter (where not is_linked and not is_demo_pending)::integer                          as orphan_count,
  count(*) filter (where not is_linked and is_demo_pending)::integer                              as demo_cleanup_pending,
  count(*)::integer                                                                               as bucket_objects,
  coalesce(sum(size_bytes) filter (where not is_linked and not is_demo_pending), 0)::bigint       as total_bytes,
  min(created_at) filter (where not is_linked and not is_demo_pending)                            as oldest_created,
  max(created_at) filter (where not is_linked and not is_demo_pending)                            as newest_created,
  coalesce(
    (array_agg(id_prefix order by created_at, id_prefix)
       filter (where not is_linked and not is_demo_pending and id_prefix is not null))[1:50],
    '{}'::text[])                                                                                 as id_prefixes
from objs;
