# ADR-034 — Invoice files in the encrypted daily backup: incremental packs kept for good, a full manifest every run

- **Status:** proposed
- **Date:** 2026-11-09 · **Decided by:** founder (requirement, 2026-11-08); design by architect, to be accepted with the plan
  `docs/plans/2026-11-09-backup-invoice-files.md`

## Context

- The private Storage bucket `invoices` holds the invoice PDFs and photos. Invoices are kept for 10 years (plan §3.6 rule 5,
  `supabase/migrations/20261022100200_invoice_storage.sql` lines 11–15). The app has no update and no delete policy on the bucket;
  only a secret-key client can remove objects, and only the staging demo purge does (`scripts/lib/demo/main.ts` line 85).
- Until now the daily backup holds the database only (M25 Q186, accepted risk in `docs/go-live/security-walk.md`). The database
  copy does hold the `storage.objects` rows (names and metadata), not the bytes (`scripts/lib/backup/commands.ts` lines 12–21).
- Production is on Supabase Free: no Supabase-side backup; 1 GB file storage and 5 GB egress per organisation per month as listed on
  <https://supabase.com/pricing> (read 2026-11-09). The bucket refuses files over 4 MiB.
- The founder decided on 2026-11-08: the bucket joins the encrypted daily backup to the Shared Drive, incremental with a periodic full
  manifest; the weekly restore check verifies a sample against checksums; no plaintext leaves the runner; the same gpg passphrase.
- Database copies rotate after 14 days (Q182). Invoice files must outlive that by years.

## Decision

The daily job adds every object that is new since the previous **full manifest** to one encrypted tar **pack** per day
(`osteria-files-<stamp>-<target>-<nn>.tar.gpg`, split above 200 MiB), and uploads an encrypted **full manifest** of every object
(path → sha256, size, pack, member) on **every run** (`osteria-files-manifest-<stamp>-<target>.json.gpg`). **Packs are never deleted
by code**; manifests keep the newest `BACKUP_KEEP_COPIES`. Objects are listed with SQL on `storage.objects` over the existing
database connection and downloaded with the Supabase secret key through `@supabase/supabase-js`. The weekly restore check decrypts
the newest manifest and a sample of whole packs on the runner, checks every sampled file's sha256, and checks that every object row in
the restored database copy has a manifest entry.

## Alternatives

- **One full encrypted tar of the bucket every day** — simplest, and each copy stands alone; but the daily download from Supabase
  grows with the bucket and eats the Free egress, and 14 rotating full copies would still lose a file deleted more than 14 days ago,
  which defeats the 10-year retention. Rejected.
- **Decide "new" by timestamp since the last run** — no manifest to read; but a failed or skipped day loses files unless the window
  is tracked, and clock skew matters. Rejected: diffing against the previous manifest heals itself after any failed run.
- **Supabase's S3-compatible endpoint** — recursive listing and Storage-only keys (a narrower credential than the secret key); but
  it needs SigV4 signing written by hand or an AWS SDK (a new dependency, `tests/config/no-new-deps.test.ts`), and one more
  credential to create and rotate. The job already holds the database URL, which is a wider credential than the secret key.
  Rejected.
- **Storage list API instead of SQL** — no database URL needed in this step; but it lists one folder level per call
  (tenant / year / file), so it needs more calls and paging code. SQL is one read on the same connection the dump already uses.
  Rejected.
- **Weekly check re-hashes the sample against the live bucket** — proves the live bytes still match; but it puts the secret key
  into the weekly workflow, which today holds no Supabase credential, and spends Supabase egress every week. Not the default; it is
  variant V1 of the plan (open question Q-F2).

## Consequences

- Good: Supabase egress is roughly the new files of the day. A file stays recoverable after it is removed from the bucket (the
  manifest marks it `removedAt` and keeps pointing at its pack). Every pack carries its own `index.json`, so any pack can be read
  without a manifest. Removed or changed objects on production fail the run and open the `backup-failure` issue.
- Bad / accepted trade-offs:
  - **A passphrase must be kept as long as any pack encrypted with it exists (up to 10 years and more)**, not two weeks as for the
    database copies. Rotation means a `full_files` run under the new passphrase; old packs are then deleted by hand or their
    passphrase is kept (runbook).
  - Drive holds invoice files (personal data of suppliers who are natural persons) for the retention period. The DPA and
    sub-processor list must say so (checklist DPA-1).
  - The secret key of production now also lives in the GitHub environment `production-backup`.
  - Restoring files into a new project is a manual procedure; no re-upload tool is built (variant V2, Q-F3).
  - No code deletes packs after 10 years (Q-F5).
- What would make us revisit this: a paid Supabase plan with its own Storage backup; the bucket outgrowing what one daily run can
  download; a founder answer to Q-F2 or Q-F3; Drive quota pressure.
