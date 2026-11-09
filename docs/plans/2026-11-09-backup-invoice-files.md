# Tech plan — Osteria Digitalization · Invoice files in the encrypted backup

- **Client slug / internal:** `osteria-dei-rossi`. **Client facts used:** none. Test data is fake (fake tenant and invoice UUIDs,
  `not-a-secret` passphrases, generated RSA keys, demo PDFs from `scripts/lib/demo/pdf.ts`).
- **Repo and branch:** `osteria-dei-rossi-app`, worktree `/home/user/osteria-bkinv`, branch `feat/backup-invoice-files`, from
  `origin/main` `1aaa606`. Not a milestone: one PR.
- **Numbering:** steps **F1–F12**; acceptance tests **AT-F1–AT-F4**; variants **V1–V2**; open questions **Q-F1–Q-F8**;
  technical items **T-F1–T-F3** (§6); ADR-034 (`docs/adr/adr-034-invoice-file-backups.md`, proposed; ADR-033 is taken by PR #64,
  adr-033-ledger-business-date). **No migration** (§3.1 D6).
- **Author:** architect · **Date:** 2026-11-09
- **Sources:** founder decision 2026-11-08 (`docs/go-live/phase1-closeout.md` "Founder decisions" item 2); M25 plan §3.1.5
  (`docs/plans/2026-11-01-m25-go-live.md` lines 289–330); the merged backup code in §2. **Where merged code and a plan differ, the
  code wins.**

> **Flags for the founder (read first)**
> - **New secret in `production-backup`:** the Supabase **secret key** of production (`SUPABASE_SECRET_KEY`). Today it lives in
>   Vercel only. The job that uses it already holds the database URL, a wider credential (§3.7). `staging` already has it.
> - **Files are kept for good, so the passphrase is too.** Database copies rotate after 14 days; invoice-file packs are never
>   deleted by the code. **Every passphrase that encrypted a pack must be kept as long as that pack exists**, or packs must be
>   re-made after a rotation (`full_files` run, §3.4) and the old ones deleted by hand (Q-F6).
> - **Supabase Free has 1 GB of file storage** (pricing page, read 2026-11-09). "A few thousand files of up to ~10 MB" can pass that.
>   The bucket itself refuses files over 4 MiB. This change does not move the plan; the plan choice and its price are yours (Q-F1).
> - **Drive will hold supplier invoices for 10 years.** The DPA and sub-processor list must say so (checklist DPA-1), and someone
>   must delete packs after the retention period: no code does (Q-F5).
> - **Not built by default (Q-F2, Q-F3):** a weekly re-hash against the live bucket and a tool that re-uploads files into a new project
>   are variants V1 and V2. The runbook gets a manual file-recovery procedure.

## 1. Goal and scope

- **Goal:** every object of the private Storage bucket `invoices` is in the encrypted daily backup on the Shared Drive within a day
  of its upload, stays there after the database copies rotate, and the weekly restore check proves a sample of files byte for byte.
- **In scope:**
  - `scripts/backup/files.ts`: incremental daily packing of new objects, a full encrypted manifest every run, manifest retention;
  - `scripts/backup/restore-check.ts`: weekly verification of the newest files manifest, of a sample of packs (sha256 of every file
    in them) and of completeness against the `storage.objects` rows of the restored database copy;
  - the three backup workflows (daily step, weekly flag, self-test on the local stack);
  - docs: runbook, go-live checklist (AT4, FREE-2, S8-9, S8-11, DPA-1), security walk (the backups item and the accepted-risk line),
    the Phase 1 close-out item 4 and decision 2, M25 plan Q186, and the test that guards the security walk.
- **Out of scope:**
  - other buckets (there are none: `invoices` is the only bucket, `supabase/migrations/20261022100200_invoice_storage.sql`);
  - restoring files into a project with a tool, and a live-bucket re-hash (both are variants, §5b);
  - deleting packs after the retention period (Q-F5);
  - any change to the database dump, its 14-copy retention or its restore;
  - any change to the app (`src/`) or the schema.

## 2. Current state (`origin/main` `1aaa606`)

| Path | What it does | Used here |
|---|---|---|
| `scripts/backup/dump.ts` | Dumps roles, schema, data and migration history with the supabase CLI, writes `manifest.json` (migrations, table counts), tars, encrypts with gpg (passphrase on stdin), writes `.sha256`. Clear text in `<out>/work`, removed in `finally` | Pattern for the new script (deps injection, `createLogger` redaction, `finally` clean-up). Unchanged |
| `scripts/backup/upload.ts` | Uploads one `osteria-backup-*.tar.gpg` to Drive, checks MD5, keeps the newest N of the target | Unchanged |
| `scripts/backup/restore-check.ts` | `--file` or `--from-drive <target>` (newest copy, ≤ 36 h, MD5), decrypts, restores into an empty **local** stack, checks (a)–(d), `--require-nonzero` | Extended in F7 |
| `scripts/backup/keepalive.ts` | Auth health ping | Unchanged |
| `scripts/lib/backup/commands.ts` | gpg argument lists (`--passphrase-fd 0`), `assertPassphrase` (≥ 32), `assertLocalDbUrl`, `assertProjectRef`, `PSQL_SAFE_FLAGS`, `failureSummary`, `redact`/`createLogger`, `backupFileName`/`isBackupFileName` (regex `^osteria-backup-<stamp>-<target>\.tar\.gpg$`). The data dump keeps `storage.objects` rows (lines 12–21) | Extended in F1 |
| `scripts/lib/backup/drive.ts` | Service-account JWT (scope `drive.file`), token, `uploadResumable` (one PUT, MD5 check, deletes a damaged upload), private `listBackups` (query `name contains 'osteria-backup-'` + regex), `newestBackup`, `download`, `applyRetention` | Extended in F3 |
| `scripts/lib/backup/exec.ts` | `spawnRunner` (no shell, stdin input, 256 MiB buffer) | Reused |
| `scripts/lib/backup/freshness.ts` | `assertFresh` (≤ 36 h) | Reused for the files manifest |
| `scripts/lib/backup/manifest.ts` | Database manifest (names and integers only) | Unchanged |
| `.github/workflows/backup-daily.yml` | 02:15 UTC; arm gate on `vars.PRODUCTION_PROJECT_REF`; ref guard; `npm ci` without secrets; dump → upload → keep-alive → `always()` `rm -rf "$RUNNER_TEMP/backup"` → `failure()` `backup-failure` issue (last step) | F8 adds one step |
| `.github/workflows/backup-restore-weekly.yml` | Monday 04:00 UTC; Drive + passphrase secrets in the restore step only, **no Supabase secret** | F9 adds a flag only |
| `.github/workflows/backup-selftest.yml` | Ready PRs and `main` pushes on backup paths: local stack, demo tenant and demo data (uploads demo PDFs to `invoices`), dump, stop, empty stack, restore check. No secret | F10 |
| `tests/scripts/backup/*.test.ts`, `tests/config/backup-*-workflow.test.ts` | Unit tests with fake `run`/`fetch`; workflow text tests | Extended |
| `tests/config/go-live-docs.test.ts` line 101 | `expect(WALK).toContain("accepted risk: invoice files not backed up")` | Inverted in F12 |
| `tests/config/runbook.test.ts` | Secrets table rows for every workflow secret; `production-backup`/`staging` lists; "Until the six secrets are set"; every `(test: …)` path exists | Updated in F11 |
| `tests/config/no-new-deps.test.ts` | Dependency list pinned | Unchanged: no package added |

**Storage facts (checked):**
- App uploads go to `<tenant uuid>/<yyyy>/<invoice uuid>.<pdf|jpg|png>` with `upsert: false` (`src/server/invoices/invoices.ts`
  lines 139–144). The insert policy enforces that shape for `authenticated` (migration line 30). Secret-key clients bypass it
  (demo seed `scripts/lib/demo/seed.ts` line 395 uses the same shape; e2e helpers write their own).
- **No update and no delete policy** for any role (migration lines 11–15). The only code that removes objects is the demo purge,
  with the secret key (`scripts/lib/demo/main.ts` line 85), for a demo tenant on staging. Real Storage blocks direct SQL deletes on
  `storage.objects` (`supabase/tests-native/storage_shim.sql` line 5).
- Bucket limit 4 MiB per file (migration line 5). `storage.objects` has `name`, `updated_at`, `metadata` (shim lines 24–37).
- Secret-key downloads already work in the app: `admin.storage.from(INVOICE_BUCKET).download(path)` in
  `src/server/cron/extract-job.ts` line 120.

## 3. Design

### 3.1 Decisions

- **D1 What is new:** diff the live object list against the **previous full manifest** on the store (Drive). Not timestamps: a
  failed day is picked up by the next run without bookkeeping.
- **D2 Listing:** one read-only SQL on `storage.objects where bucket_id = 'invoices'` through `SUPABASE_DB_URL` (the connection
  the dump uses). Not the Storage list API (one folder level per call) and not the S3 endpoint (SigV4 or a new dependency; ADR-034).
- **D3 Download:** a plain `fetch` GET on `/storage/v1/object/invoices/<path>` (what storage-js `download()` sends, with `apikey` and
  `Authorization: Bearer` headers) in `scripts/lib/backup/download.ts`, every path segment encoded, unsafe paths refused (review of #66);
  `SUPABASE_SECRET_KEY` is used there only; one retry per object.
- **D4 Packaging:** one encrypted tar pack per run holding the new and changed objects, split when it would pass
  `MAX_PACK_BYTES = 200 MiB`; per run at most `MAX_RUN_BYTES = 1 GiB` downloaded (runner disk and time guard; the Free bucket is
  1 GB). Tar member names are opaque (`o/000001`), never the object path; each pack carries its own `index.json`.
- **D5 Manifest:** an encrypted **full** manifest on **every run** (founder: "periodic full manifest"; every run costs little:
  thousands of entries, no bytes). Removed objects stay in it with `removedAt`. Manifests keep the newest `BACKUP_KEEP_COPIES`
  (default 14); **packs are never deleted by code**.
- **D6 No migration:** reads only `storage.objects`, as the `postgres` user the dump already uses; nothing is written to a database.
- **D7 Anomalies alert:** on target `production`, an object that disappeared from the bucket or whose bytes changed fails the run
  **after** the manifest is uploaded (so the backup is complete) and so opens the `backup-failure` issue. A path counts once: the
  next run sees it already marked. Staging (demo purge) does not fail.
- **D8 Weekly check without Supabase credentials:** the weekly workflow keeps holding no Supabase secret. Completeness is checked
  against the `storage.objects` rows **in the restored database copy** (a snapshot of the bucket's index at dump time), not against
  the live bucket (see V1).
- **D9 Same encryption path:** `gpgEncryptArgs` / `gpgDecryptArgs`, AES256, `BACKUP_ENCRYPTION_PASSPHRASE` on stdin. Clear text only
  under `$RUNNER_TEMP`, removed in `finally` and by the workflow's `always()` step. No artifact.
- **D10 Logs:** counts, byte totals, our own Drive file names (UTC stamp + target) and error codes. **Never an object path**:
  app paths are UUIDs only, but secret-key writes bypass the path policy, and an invoice id still points at a supplier who may be a
  natural person. The manifest, which holds the paths, is encrypted.

### 3.2 Store layout and names (same Shared Drive folder, `BACKUP_DRIVE_FOLDER_ID`)

| File | Name | Kept |
|---|---|---|
| Database copy (unchanged) | `osteria-backup-<stamp>-<target>.tar.gpg` | newest 14 |
| Files pack | `osteria-files-<stamp>-<target>-<nn>.tar.gpg` (`nn` = `01`…`99`, the split index within a run) | **always** |
| Files manifest | `osteria-files-manifest-<stamp>-<target>.json.gpg` | newest `BACKUP_KEEP_COPIES` |

`<stamp>` is `backupFileName`'s `YYYYMMDDTHHMMSSZ`. The existing database listing (`name contains 'osteria-backup-'` plus the anchored
regex) never sees `osteria-files-*`, and the new listings never see `osteria-backup-*` (pinned in F1 and F3). Google documents a
limit of 500,000 items per shared drive; this adds about one pack a day plus 14 manifests.

### 3.3 Data shapes (plain validators, like `manifest.ts`)

Files manifest (encrypted JSON):

```
{ "version": 1, "createdAt": "<ISO>", "target": "staging" | "production",
  "objects": { "<object path>": {
      "sha256": "<64 hex>", "size": <int ≥ 0>, "updatedAt": "<ISO from storage.objects>",
      "pack": "<pack file name>", "member": "o/<6 digits>",
      "removedAt": null | "<ISO>",
      "previous": [ { "pack": "…", "member": "…", "sha256": "…" } ] } } }
```

Pack `index.json` (inside the encrypted tar, next to `o/000001`…): `{ "version": 1, "createdAt", "target", "objects": [ { "path",
"member", "sha256", "size" } ] }`. `parseFilesManifest` / `parsePackIndex` refuse anything else (unknown version, bad hex, negative
size, pack or member name not matching its regex, path empty or over 1,024 characters or holding a control character).

### 3.4 Daily flow: `scripts/backup/files.ts`

```
npx tsx scripts/backup/files.ts --work <dir> --target staging|production --keep <n>
        (--ref <project ref> | --local --store-dir <dir>) [--full]
env: SUPABASE_DB_URL, SUPABASE_URL, SUPABASE_SECRET_KEY, BACKUP_ENCRYPTION_PASSPHRASE,
     and without --store-dir: BACKUP_DRIVE_SA_JSON, BACKUP_DRIVE_FOLDER_ID
```

1. Parse arguments (`--local` and `--store-dir` only together; `--ref` only without them). Missing env names →
   `backup_env_missing:<names>`. `assertPassphrase`. Remote: `assertProjectRef(dbUrl, supabaseUrl, ref)` (the secret key is only
   sent to the guarded host). Local: `assertLocalDbUrl` and the new `assertLocalApiUrl` (http(s), host `127.0.0.1`/`localhost`, no
   query, no fragment). The logger redacts the DB URL parts, passphrase, secret key, SA JSON and folder id.
2. Open the store: Drive (token from the service account) or the directory store (F4).
3. List the store's `osteria-files-*` of the target. Newest manifest → download (MD5), decrypt into `<work>`, parse. None, or
   `--full` → empty previous. Unreadable (wrong passphrase, damaged) → `files_manifest_unreadable`, exit 1 (the runbook says: run with
   `full_files`).
4. `psql <db url> -At -v ON_ERROR_STOP=1 PSQL_SAFE_FLAGS -c FILES_LIST_SQL` → `[{ name, updatedAt }]` (stdout kept in memory, never
   logged; failure → `files_list_failed (exit n, SQLSTATE x)`).
5. `planFilesRun(previous, listed)` → `toFetch` (path not in previous, previously removed, or `updatedAt` differs), `unchanged`,
   `newlyRemoved`.
6. For each `toFetch` path in name order: download (retry once; then `files_download_failed`), sha256 in memory, size. Same sha256 as
   the previous entry → only `updatedAt` is refreshed (not packed, not a change). Otherwise write to `<work>/pack/o/<n>`; a path with a
   previous entry and a different sha256 is **changed** (old reference moves to `previous`). Before a file would push the open pack
   past `MAX_PACK_BYTES`, seal it: write `index.json`, `tar -cf`, gpg encrypt, upload (MD5 check), remove the clear text. Stop
   fetching once `MAX_RUN_BYTES` is reached (`capReached`).
7. Seal the last pack. Build the next manifest (`nextFilesManifest`), encrypt, upload. A name already in the listing →
   `files_name_taken` (Drive allows duplicate names; we do not).
8. Retention: keep the newest `--keep` manifests of the target (`applyRetention(..., "files-manifest")`).
9. Log one JSON line: `{"objects":N,"new":n,"changed":c,"removed":r,"packs":["osteria-files-…"],"bytes":b,"manifest":"osteria-files-manifest-…"}`.
10. Exit 1 with `files_run_cap_reached` if `capReached`; else exit 1 with `files_bucket_anomaly` if target is `production` and
    `changed + removed > 0`; else 0. `finally`: remove `<work>`.

`--full` (workflow input `full_files`) packs every object again and writes a manifest with no history. It is the path after a
passphrase rotation or a damaged pack; it re-downloads the whole bucket (Supabase egress).

### 3.5 Weekly flow: `scripts/backup/restore-check.ts` additions

New flags: `--files-packs <n|all>` (turns the files check on), `--files-dir <dir>` (only with `--file`; the self-test's directory
store), `--require-files`. Without `--files-packs` the script behaves exactly as today. After the database restore and checks (a)–(d):

- (e) The newest files manifest of the target exists and is ≤ 36 h old (`assertFresh`; problems `files_manifest_missing`,
  `files_manifest_stale`), downloads with a matching MD5, decrypts and parses.
- (f) Every pack named in it (current and `previous`) exists in the store: problem `files: <n> packs named in the manifest are missing`.
- (g) Completeness: `RESTORED_OBJECTS_SQL` on the **local** restored database lists the `invoices` object names; each must have a
  manifest entry (removed or not): problem `files: <n> objects of the database copy are not in the files manifest`. The daily job
  dumps the database before it lists the bucket, so the manifest is the later snapshot.
- (h) Sample: the newest pack plus random other packs up to `n` (`all` = every pack), random source injected. For each: download
  (MD5), decrypt, untar into `<work>/files-check/<k>`, parse `index.json`, which must equal the manifest's references to that pack;
  sha256 of every member must equal the manifest. Problems name the pack and counts only: `pack <name>: <n> files differ`,
  `pack <name>: index differs from the manifest`.
- (i) `--require-files`: at least one manifest entry that is not removed.
- The final JSON line gains `"files":{"objects":N,"packsChecked":p,"filesChecked":f}`. `finally` removes `<work>/files-check` and
  the decrypted manifest.

Bound: `--files-packs 5` downloads at most 5 × 200 MiB from Drive. **No Supabase egress**: the weekly check reads Drive only.

### 3.6 Self-test flow (`backup-selftest.yml`, local stack, no secret)

demo tenant and demo PDFs → dump → **files run 1** (`--local --store-dir "$RUNNER_TEMP/files-store"`) → **files run 2**, whose JSON
line must say `"new":0` (incremental proof) → stop → empty stack → `restore-check.ts --file … --files-dir "$RUNNER_TEMP/files-store"
--files-packs all --require-files` → clean-up of the stacks, `files-store`, `files-work` and the second run's log.

### 3.7 Secrets and configuration

| Name | Lives in | Used by (new use in bold) |
|---|---|---|
| `SUPABASE_SECRET_KEY` | Vercel; GitHub `staging` (already); **GitHub `production-backup` (new)** | **the daily files step only** (`scripts/`, allowed by CLAUDE.md rule 2) |
| `SUPABASE_DB_URL` | GitHub `production-backup`, `staging` | the dump, **and the files listing** |
| `SUPABASE_URL` | same | ref guard, keep-alive, **the files download host** |
| `BACKUP_ENCRYPTION_PASSPHRASE` | founder's password manager; GitHub `production-backup`, `staging` | dump, restore check, **packs and manifests** |
| `BACKUP_DRIVE_SA_JSON`, `BACKUP_DRIVE_FOLDER_ID` | GitHub `production-backup`, `staging` | upload, restore check, **files step** |
| `BACKUP_KEEP_COPIES` (variable) | `production-backup` | database copies **and files manifests** kept |
| Google Cloud and Supabase account logins | the owner's password manager, MFA on (runbook table, unchanged) | humans |

No new variable, no new package, no secret in any file. The self-test uses the local stack's key from `supabase status` (as today)
and the existing fake passphrase. The secret key is only ever sent to the host that `assertProjectRef` (or `assertLocalApiUrl`)
accepted, and is redacted from every log line (both tested in F5).

### 3.8 Free plan and runner limits (sizing)

- Supabase Free: 1 GB file storage, 5 GB egress per organisation per month, pooled across Storage, database and the rest
  (<https://supabase.com/pricing>, <https://supabase.com/docs/guides/platform/billing-on-supabase>). Daily download = the day's new
  files; first run and `full_files` runs = the whole bucket. The weekly check costs no Supabase egress.
- Runner: one open pack at a time on disk (≤ 200 MiB files + tar + gpg output), per-run cap 1 GiB; plaintext removed after each pack.
- Drive: item limit above; storage is the Workspace pool (Q-F4). No figure for time or cost is promised.

## 4. Alternatives considered

- **A full tar of the bucket every day** — rejected: Supabase egress grows with the bucket, and a 14-copy rotation loses any file
  removed more than 14 days ago, against the 10-year retention.
- **"New since the last run" by timestamp** — rejected: a failed day needs extra state; the manifest diff heals itself (D1).
- **S3-compatible endpoint** — rejected: SigV4 by hand or a new AWS SDK dependency, plus a new credential; the step already holds the
  wider database URL (ADR-034).
- **Storage list API for listing** — rejected: per-folder calls and paging; SQL is one read on an existing connection (D2).
- **Manifest only weekly** — rejected: a daily full manifest costs little and lets every day's copy stand alone for recovery.
- **Object paths as tar member names** — rejected: paths could hold anything when written with the secret key; opaque members make
  extraction safe from `../` and keep paths out of tar listings (D4).
- **A separate files workflow** — rejected: a second schedule, environment wiring and failure step for the same secrets; one more step
  in `backup-daily.yml` reuses its gate, guard, clean-up and issue step.
- **Weekly re-hash against the live bucket** — not the default (D8); it is V1 if Q-F2 says yes.

## 5. Build plan (test first: each step's named test is written and seen failing, then the code; one commit per step)

| # | Step (one commit) | Files | Test that proves it (written first, seen red) |
|---|---|---|---|
| F1 | Names, SQL and guard: `filesPackName(now, target, seq)`, `filesManifestName(now, target)`, `isFilesPackName`, `isFilesManifestName`, `stampOf(name)`; `FILES_LIST_SQL` (`select coalesce(json_agg(json_build_object('name', name, 'updatedAt', updated_at) order by name), '[]'::json) from storage.objects where bucket_id = 'invoices'`); `RESTORED_OBJECTS_SQL` (names only, same filter); `assertLocalApiUrl` | `scripts/lib/backup/commands.ts` | `tests/scripts/backup/commands.test.ts`: names round-trip with target and split index; `isBackupFileName` is false for both files names, and both files predicates are false for a database copy name and for the other target; `nn` outside 01–99 refused; both SQL texts read `storage.objects`, filter `bucket_id = 'invoices'`, contain no write keyword; `assertLocalApiUrl` accepts `http://127.0.0.1:54321` and refuses a `*.supabase.co` URL, `?host=`, a fragment and `ftp:` with the code `files_source_not_local` |
| F2 | Files manifest model: types, `parseFilesManifest`, `parsePackIndex`, `planFilesRun(previous, listed)`, `nextFilesManifest(previous, packed, refreshed, newlyRemoved, now, target)` | `scripts/lib/backup/files-manifest.ts` (new) | `tests/scripts/backup/files-manifest.test.ts`: new path → fetch; same `updatedAt` → unchanged; different `updatedAt` → fetch; same sha256 after fetch → refreshed, not changed; different sha256 → changed, old ref in `previous`; missing path → `removedAt` set once and not counted again next run; a removed path that reappears → fetched, old ref in `previous`; empty previous (the `--full` case) → all fetched, no history; parse refuses version 2, bad hex, negative size, bad pack/member names, a control character in a path; output key order is sorted (stable files) |
| F3 | Drive: export `listFiles(fetch, token, folder, prefix, accept)`; `newestBackup` and the database `applyRetention` built on it with unchanged behaviour; `applyRetention(..., kind: "db" \| "files-manifest")` | `scripts/lib/backup/drive.ts` | `tests/scripts/backup/drive.test.ts`: `files-manifest` retention deletes only manifests of the target beyond `keep`, never a pack, never a database copy, never the other target; `db` retention never deletes an `osteria-files-*` name (pins the never-delete rule for packs); `listFiles` follows `nextPageToken`; the existing upload/retention tests stay green unchanged (`tests/scripts/backup/upload.test.ts`) |
| F4 | Store: `BackupStore` (`list(target)`, `put(name, bytes)`, `get(file)` with MD5 check, `remove(file)`); `driveStore` over F3; `dirStore(dir)` for the self-test | `scripts/lib/backup/store.ts` (new) | `tests/scripts/backup/store.test.ts` (temp dir + fake fetch): dir store refuses any name that is not a backup/pack/manifest name (`../x`, `/abs`), refuses an existing name, lists `createdTime` from the name's stamp, round-trips bytes; drive store's `get` throws `backup_checksum_mismatch` on a wrong MD5; no error message contains the folder id or token |
| F5 | Daily files script `runFiles(argv, deps)` per §3.4 | `scripts/backup/files.ts` (new) | `tests/scripts/backup/files.test.ts` (fake `run`, fake store, fake `downloadObject`, fake paths such as `11111111-…/2026/aaaa….pdf` and one secret-key-style path `demo/Mario Rossi fattura.pdf`): first run packs all and uploads one pack + one manifest; second run with the same list uploads a manifest only and logs `"new":0`; one added object → one pack with one member; split at `MAX_PACK_BYTES`; `MAX_RUN_BYTES` → manifest uploaded, then exit 1 `files_run_cap_reached`; download fails twice → `files_download_failed`, nothing uploaded; production with a removed or changed object → manifest uploaded, then exit 1 `files_bucket_anomaly`; staging, same case → exit 0; unreadable previous manifest → `files_manifest_unreadable`, and with `--full` → succeeds; name collision → `files_name_taken`; `--store-dir` without `--local`, and `--local` with a remote URL, refused before any `run` or fetch; with `--ref`, a `SUPABASE_URL` or DB user of another project refused (`backup_supabase_host_mismatch` / `backup_db_user_mismatch`) before any fetch, so the secret key never reaches an unguarded host; missing env names listed; the passphrase only on gpg stdin, never in an argument; **no log line contains any object path, `Mario Rossi`, the secret key, the DB password, the passphrase or the folder id**; `<work>` removed on success and on every failure; manifest retention called with `--keep` |
| F6 | Verification lib: `choosePacks(manifest, n \| "all", random)`, `checkPack(packName, index, manifest, sha256Of)`, `missingFromManifest(restoredNames, manifest)`, `missingPacks(manifest, listed)` | `scripts/lib/backup/files-verify.ts` (new) | `tests/scripts/backup/files-verify.test.ts`: the newest pack is always chosen; `n` ≥ pack count or `all` → every pack; fixed random → fixed choice; one member with another sha256 → `pack <name>: 1 file differs` (no path in the text); index with an extra or missing entry → `index differs`; restored names include a removed entry → no problem; a restored name absent → counted; a `previous` pack missing from the listing → counted |
| F7 | `restore-check.ts`: `--files-packs`, `--files-dir`, `--require-files`, checks (e)–(i) of §3.5 | `scripts/backup/restore-check.ts` | `tests/scripts/backup/restore-check.test.ts`: without `--files-packs` the calls and log are exactly today's (existing cases unchanged); `--from-drive production --files-packs 2` downloads the newest manifest and two packs, passes and logs `"files":{…}` counts; no manifest → `files_manifest_missing`, stale manifest → `files_manifest_stale`, each exit 1; a differing member → exit 1; a restored object name missing from the manifest → exit 1; `--files-dir` with `--from-drive` → usage error; `--require-files` with an empty manifest → exit 1; no log line holds an object path; `files-check` and the decrypted manifest removed in `finally` |
| F8 | Daily workflow: step "Back up the invoice files" after the keep-alive and before the clean-up; `if: steps.arm.outputs.armed == 'true'`; env `SUPABASE_DB_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `BACKUP_ENCRYPTION_PASSPHRASE`, `BACKUP_DRIVE_SA_JSON`, `BACKUP_DRIVE_FOLDER_ID` from `secrets.`, `FULL_FILES` from `inputs.full_files`; missing-name check with `::error title=Missing backup settings::`; `--work "$RUNNER_TEMP/backup/files" --target "$TARGET" --ref "$PROJECT_REF" --keep "$BACKUP_KEEP"` plus `--full` when `FULL_FILES` is true; new dispatch input `full_files` (boolean, default false) after `target`; header comment updated | `.github/workflows/backup-daily.yml` | `tests/config/backup-daily-workflow.test.ts`: allowed secret steps become dump, upload, keep-alive, **files**; `SUPABASE_SECRET_KEY` appears in the files step only; the files step's six secrets and flags; order keep-alive < files < clean-up < issue (issue still last); work dir is under `$RUNNER_TEMP/backup` (covered by the existing clean-up); `full_files` is a boolean input defaulting to false and reaches the script only through `env`; the arming tests still pass for the new step |
| F9 | Weekly workflow: restore step adds `--files-packs 5`; header comment adds checks (e)–(i); timeout unchanged | `.github/workflows/backup-restore-weekly.yml` | `tests/config/backup-restore-workflow.test.ts`: the restore step contains `--files-packs 5`; the workflow still has no `SUPABASE_DB_URL`, `SUPABASE_URL` or `SUPABASE_SECRET_KEY` (new assertion for the key) |
| F10 | Self-test: step "Back up the invoice files twice into a local folder" between the dump and the stop (`SUPABASE_DB_URL` local, `SUPABASE_URL: ${{ env.NEXT_PUBLIC_SUPABASE_URL }}`, `SUPABASE_SECRET_KEY` from the exported local env, fake passphrase); second run piped through `tee "$RUNNER_TEMP/files-second.log"` then `grep -q '"new":0'`; restore step adds `--files-dir "$RUNNER_TEMP/files-store" --files-packs all --require-files`; clean-up removes `files-store`, `files-work`, `files-second.log` | `.github/workflows/backup-selftest.yml` | `tests/config/backup-selftest-workflow.test.ts`: order install < start < demo < dump < **files** < stop < empty stack < restore < clean-up; the files step uses `--local --store-dir`, runs the script twice and greps `"new":0`; restore flags; clean-up paths; still no `secrets.`, no environment, no artifact. **And the workflow's own run on the PR** (AT-F1) |
| F11 | Runbook | `docs/runbook.md` (details in "Docs to update" below) | `tests/config/runbook.test.ts`: `production-backup` and `staging` lists include `SUPABASE_SECRET_KEY`; "Until the seven secrets are set"; the `BACKUP_ENCRYPTION_PASSPHRASE` row still says "old backups need the old passphrase" and now also "invoice-file packs"; the "Backups and restore" section names `osteria-files-` and `full_files`, cites `tests/scripts/backup/files.test.ts` and `tests/scripts/backup/files-verify.test.ts` (existence is checked by the cited-tests case), says to try one file first when recovering files, and no longer contains "What is not backed up:** invoice" |
| F12 | Go-live docs, close-out, M25 Q186 | `docs/go-live/security-walk.md`, `docs/go-live/checklist.md`, `docs/go-live/phase1-closeout.md`, `docs/plans/2026-11-01-m25-go-live.md` | `tests/config/go-live-docs.test.ts`: line 101 inverted to `not.toContain("invoice files not backed up")`; the "Backups exist…" walk entry has `verdict: yes` and its evidence cites `ADR-034`, `tests/scripts/backup/files.test.ts` and `tests/config/backup-selftest-workflow.test.ts`; AT4 and FREE-2 mention the invoice files without "once `feat/backup-invoice-files` lands"; the env-name list case gains `SUPABASE_SECRET_KEY`; DPA-1 mentions the invoice files' retention; new cases: the close-out's item 4 contains `feat/backup-invoice-files` and no longer "relies on Storage's durability alone"; the M25 plan's Q186 answer line contains "superseded 2026-11-08" |

**Acceptance tests**

| ID | What | Who | Proof |
|---|---|---|---|
| AT-F1 | Self-test green on the ready PR: demo PDFs packed, second run `"new":0`, restore check verifies **every** pack file by file and completeness against the restored `storage.objects` | DigiAlto | `backup-selftest.yml` run link in the PR (part of AT4) |
| AT-F2 | Staging: "Daily backup" (target staging) green with one pack and one manifest in Drive; then "Weekly restore check" (staging) green with `files.filesChecked` > 0 | founder | run links (AT4, S8-11) |
| AT-F3 | Production: first daily and weekly runs green once production holds invoices | founder | run links (AT4, FREE-2) |
| AT-F4 | One pack and one manifest decrypted by hand from Drive with the passphrase; one PDF opens | founder | date in S8-11 |

**Docs to update (all in F11/F12)**

| Doc | Change |
|---|---|
| `docs/runbook.md` secrets table | `SUPABASE_SECRET_KEY`: lives also in `production-backup`; used by the invoice-file backup; rotate there too. `BACKUP_ENCRYPTION_PASSPHRASE`: keep "old backups need the old passphrase"; add that invoice-file packs are never deleted, so keep every passphrase as long as a pack made with it exists, or after a rotation run "Daily backup" with `full_files`, wait for a green weekly check, then delete the older packs by hand (Q-F6). `BACKUP_KEEP_COPIES`: also the number of files manifests; packs are never deleted |
| runbook `production-backup` / `staging` | add `SUPABASE_SECRET_KEY` (production: a separate secret key for backups if the dashboard allows several, Q-F8); "six" → "seven" secrets |
| runbook "Backups and restore" | "What exists": the files step, packs, manifests, the weekly checks (e)–(i). Replace "What is not backed up" with what is backed up and how fresh (up to a day; packs kept for good). "Open one by hand": also a pack (`index.json` maps `o/<n>` to the path) and a manifest. New "Recover the invoice files": newest manifest → its packs → upload each file to the same path in the new project's `invoices` bucket by hand; no tool (Q-F3); try one file on the spare project first (T-F3). `files_bucket_anomaly`: what it means and what to check |
| runbook "Supabase Free" | the files step's egress (daily new files; `full_files` = whole bucket) |
| runbook "Go-live day" step 8 | check that a pack and a manifest are in Drive |
| `docs/go-live/security-walk.md` | item "Backups exist…": `verdict: yes`, evidence as tested in F12, no `accepted risk:` line; remove the "invoice files not backed up" bullet (line 115) from "Accepted risks" |
| `docs/go-live/checklist.md` | AT4 (invoice files included, AT-F1–AT-F4), FREE-2 (newest database copy **and** files manifest under 36 h), S8-9 (`SUPABASE_SECRET_KEY`, seven secrets), S8-11 (decrypt one pack too), DPA-1 (Drive keeps invoice files for the retention period) |
| `docs/go-live/phase1-closeout.md` | decision 2: built in `feat/backup-invoice-files` (this plan, ADR-034); item 4 rewritten as reversed and built |
| `docs/plans/2026-11-01-m25-go-live.md` | lines 84, 150, 603, 796, 863: "(superseded 2026-11-08: backed up since `feat/backup-invoice-files`, ADR-034)". §8 untouched (the checklist test counts its 16 steps) |

### 5b. Variants

**V1 — Weekly re-hash of the sample against the live bucket** · Trigger: Q-F2 = yes · Replaces steps: none (adds after F9)

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V1.1 | `compareWithLive(entries, downloadObject)` and `restore-check.ts --files-live <n> --ref <ref>`: downloads `n` sampled non-removed paths from the live bucket with the secret key after a host guard on `SUPABASE_URL`, compares sha256 with the manifest; problem `files: <n> live files differ from the backup` | `scripts/lib/backup/files-verify.ts`, `scripts/backup/restore-check.ts`, `scripts/lib/backup/commands.ts` (`assertApiHost(url, ref)` split out of `assertProjectRef`) | `tests/scripts/backup/files-verify.test.ts` (live cases: equal, differs, object gone counts as differs); `tests/scripts/backup/restore-check.test.ts` (`--files-live` refused without `--ref` or with a non-matching host before any fetch; no path or key in logs); `tests/scripts/backup/commands.test.ts` (`assertApiHost`) |
| V1.2 | Weekly workflow: restore step gets `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `PROJECT_REF` (as in the daily job, with its ref guard step) and `--files-live 5 --ref "$PROJECT_REF"` | `.github/workflows/backup-restore-weekly.yml` | `tests/config/backup-restore-workflow.test.ts`: the two names only in the restore step; still no `SUPABASE_DB_URL`; ref guard step before checkout |
| V1.3 | Runbook and walk evidence name the live check and its weekly Supabase egress | `docs/runbook.md`, `docs/go-live/security-walk.md` | `tests/config/runbook.test.ts` (weekly check listed as a user of `SUPABASE_SECRET_KEY`); `tests/config/go-live-docs.test.ts` (evidence mentions the live check) |

**V2 — Re-upload tool and a full files restore in the self-test** · Trigger: Q-F3 = yes · Replaces steps: none (adds after F10); its
V2.3 replaces the manual "Recover the invoice files" text written in F11

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V2.1 | `scripts/backup/files-restore.ts (--from-drive <target> \| --store-dir <dir>) (--to-local \| --ref <ref>) --work <dir>`: decrypts the newest manifest and its packs one at a time, uploads every non-removed object to its path in `invoices`, then downloads it back and compares sha256. The upload mode over a restored `storage.objects` row (T-F3) is fixed on the local stack in V2.2 | `scripts/backup/files-restore.ts`, `scripts/lib/backup/files-verify.ts` | `tests/scripts/backup/files-restore.test.ts` (fake store and storage: uploads every live entry once, skips removed ones, sha256 check after upload, refuses a non-guarded host, no path in logs, work dir removed) |
| V2.2 | Self-test: after the restore check, `files-restore.ts --store-dir … --to-local` into the empty stack | `.github/workflows/backup-selftest.yml` | `tests/config/backup-selftest-workflow.test.ts` (order and flags) and the workflow's run on the PR |
| V2.3 | Runbook "Recover the invoice files" uses the tool | `docs/runbook.md` | `tests/config/runbook.test.ts` (section cites `tests/scripts/backup/files-restore.test.ts`) |

## 6. Risks and mitigations

- **Security / privacy**
  - *Secret key in a scheduled job.* It bypasses RLS. Mitigation: environment `production-backup` (main only), only in the files step,
    never in `npm ci`, sent only to the guarded host, redacted from logs (F5, F8). The step already holds `SUPABASE_DB_URL`, which is
    wider. A dedicated, separately revocable key if the dashboard allows (Q-F8).
  - *`npm ci` install scripts can change `node_modules/.bin` before the secret steps run* (existing, noted in the workflow). Unchanged;
    the files step adds no binary: it runs `tsx`, and `psql`, `tar` and `gpg` from the runner.
  - *Paths or personal data in logs.* Never logged (D10; asserted in F5, F6 and F7, with a path that looks like a person's name in F5).
    psql stdout is not printed; failures go through `failureSummary`.
  - *Plaintext leaving the runner.* Only `.gpg` files are uploaded; manifests are encrypted too; no artifact; `finally` and `always()`
    clean-up (F5, F8, F10).
  - *Hostile pack content.* Packs are our own gpg output (gpg's integrity check fails on tampering); members are opaque names checked
    against the index (F6); paths are never used as file-system paths during checks.
  - *Personal data held for 10 years on Drive.* Follows the founder's retention decision; DPA-1 updated (F12); deletion after the
    period is Q-F5.
  - *Passphrase loss.* Losing an old passphrase makes its packs unreadable for good (Q-F6, runbook F11).
- **Correctness**
  - *T-F1: `updated_at` may not change on an overwrite* (not verified). Then a changed object is not re-fetched and the backup keeps
    the original bytes, which is the version the 10-year rule protects. The app cannot overwrite (no update policy, `upsert: false`).
  - *T-F2: Drive delete by a Content manager.* Manifest retention reuses the database copies' delete call, which M25 relies on (S8-8);
    the first staging run proves it (AT-F2).
  - *T-F3: re-uploading onto a restored row.* After a database restore the `storage.objects` rows exist without their bytes. Whether a
    Storage upload to such a path succeeds, and with which option, is not verified. Mitigation: the runbook's manual recovery says to
    try one file on the spare project first (F11).
  - *Skew between the dump and the listing.* The manifest is the later snapshot, and removed entries still count as present (§3.5 g,
    tested in F6).
  - *A files failure hides nothing else:* the step runs after the database upload and the keep-alive (F8), and opens the issue.
- **Performance / cost**
  - Supabase egress: daily new files only; `full_files` and the first run download the whole bucket (§3.8). Free storage of 1 GB is a
    business limit, Q-F1.
  - Runner disk/time: one pack at a time, 1 GiB per run; `files_run_cap_reached` makes a backlog loud and the next run continues (F5).
  - Weekly check: at most 5 packs from Drive; expected to fit the existing 25-minute job timeout, not measured; AT-F2 records minutes.
  - GitHub Actions minutes: one more step daily and in the self-test; recorded in AT4 (no figure promised).
- **Dependencies:** none added (`@supabase/supabase-js` is already a dependency; `tests/config/no-new-deps.test.ts` unchanged).

## 7. Open questions for the founder

Each has a default in force for this build; the PR body repeats them.

- **Q-F1 Supabase Free file storage.** The pricing page lists 1 GB of file storage on Free; a few thousand files of a few MB passes it.
  Which plan, when, and at what price is yours; prices are not estimated here. *Default:* no change in this PR; the backup works on any
  plan.
- **Q-F2 Live-bucket check.** Should the weekly check also re-hash its sample against the live bucket? It puts the secret key into the
  weekly job and spends Supabase egress each week. *Default:* no (D8). Yes → V1.
- **Q-F3 Re-upload tool.** Build a tool that restores the files into a new project, proven in the self-test? *Default:* no; manual
  procedure in the runbook. Yes → V2.
- **Q-F4 Drive storage.** Which Google Workspace account and plan holds the Shared Drive for 10+ years of invoice files, who owns it
  (runbook Q26), and its storage price: not estimated here. *Default:* the existing backup folder.
- **Q-F5 End of retention.** Who deletes packs after the 10 years, and how (a pack holds one day's invoices, so deleting one invoice
  means re-packing)? *Default:* nothing is deleted by code; a yearly manual review. The client's DPA and processing register must state
  that Google Drive holds invoice files for the retention period (DPA-1).
- **Q-F6 Passphrase rotation.** Keep every passphrase as long as its packs exist (default), or after each rotation re-pack with
  `full_files` and delete the old packs by hand?
- **Q-F7 Weekly sample size.** 5 packs (the newest plus 4 at random), every file in them checked. *Default:* 5.
- **Q-F8 A dedicated backup secret key.** If the Supabase dashboard lets you create more than one secret key (not verified here), make
  one named for the backups so it can be revoked alone. *Default:* the project's secret key.

## 8. Manual steps for the founder

1. Add `SUPABASE_SECRET_KEY` (production's) to the GitHub environment `production-backup` (Q-F8 for a dedicated key). `staging` has it.
2. After merge: run "Daily backup" with target staging, then "Weekly restore check" with target staging (AT-F2); record minutes.
3. Download one `osteria-files-*` pack and the newest `osteria-files-manifest-*`, decrypt both by hand, open one PDF, delete the clear
   text (AT-F4, S8-11).
4. Once production holds invoices: the same two runs on production (AT-F3, AT4, FREE-2).

## 9. Sources

- Supabase pricing (Free: 1 GB file storage, 5 GB egress, pause after one week of inactivity): <https://supabase.com/pricing>
- Supabase billing, pooled egress across Storage and database: <https://supabase.com/docs/guides/platform/billing-on-supabase>
- Google Drive API, shared drives limits (500,000 items): <https://developers.google.com/workspace/drive/api/guides/about-shareddrives>
- Merged code and docs listed in §2.
