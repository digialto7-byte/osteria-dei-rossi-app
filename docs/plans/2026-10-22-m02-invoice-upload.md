# Tech plan — Osteria Digitalization · M2 Invoice upload, private storage, signed URLs, duplicate check

- **Client slug / internal:** `osteria-dei-rossi`. No client facts are approved (`docs/client-facts.md`), so fixtures use fake data only: tenants "Osteria Demo A/B" (`IT00000000000`, `IT11111111115`), supplier VAT `IT12345678903`, invoice number "FT 1/2026", in-memory fake PDF/JPEG/PNG bytes.
- **Repo and branch:** `osteria-dei-rossi-app`, branch `feat/m02-invoice-upload`, one draft PR
- **Author:** architect · **Date:** 2026-10-22
- **Sources:** project plan §5a.1 M2, §3.3, §3.4 flow 1, §3.5.1 `invoice`, §3.6, §3.7, §3.11.2, §3.11.4, §3.11.6; `docs/prd.md` 1.1 and NFR Security; ADR-001, ADR-003; M1 plan (format); M0/M1 code on this branch's base.

## 1. Goal and scope
- **Goal:** owners and admins upload an invoice (PDF or phone photo) that is validated, stored privately per tenant with no delete path, listed with a status badge and opened through a short-lived signed URL; the database can find a duplicate by supplier VAT + number + date.
- **In scope:**
  - `invoice` table (M2 columns only), status enum and lifecycle guard, partial unique index;
  - `find_duplicate_invoice(vat, number, date)`;
  - private bucket `invoices` **created by a migration**, Storage RLS policies scoped by tenant folder and role;
  - `POST /api/invoices` (multipart), `GET /api/invoices`, `GET /api/invoices/:id`, `GET /api/invoices/:id/file-url`;
  - `withApi` multipart option (Origin check), file sniffing (magic bytes, MIME match, size, encrypted PDF);
  - Italian screens: invoice list with status badge, upload with phone-camera input, detail with "open document";
  - pgTAP (incl. a storage shim for the native runner), a new real-stack integration suite, Playwright, CI change.
- **Out of scope:** extraction and the `duplicate` status being set (M3); extraction columns (`supplier_id`, totals, `extraction_json`, `confidence`, `gate_flags`, `attempts`: M3); review/line actions (M4); approval, reject endpoint, `audit_event` (M5); Drive intake (M10; the `source='drive'` value is created now); email-in (M37); any delete or purge path.

## 2. Current state
- `supabase/migrations/`: `20261021120000_tenancy_baseline.sql` (`app.tenant_id()`, `app.role()`, hook, no DELETE/TRUNCATE for API roles), `20261021130000_master_types.sql` (`app.app_user_id()`, `app.normalise_name`, `app.is_valid_it_vat`), `…130100_location_ingredient.sql`, `…130200_supplier.sql` (pattern: `tenant_id default app.tenant_id()`, `unique (tenant_id, id)`, composite FKs, column-listed grants, `(select app.…())` policies), `…130300_master_import.sql`, `20261022090000_import_keep_blank.sql` (latest).
- `supabase/tests/database/001` (RLS + tenant_id + policy + no delete + no anon on every public table; covers `invoice` automatically), `004` (needs a fixture row in every public table; waiter cost-column regex), `007`/`008`/`009` (role, constraint and import tests, `pg_temp.act_as` pattern).
- `src/lib/api/with-api.ts`: `withApi({roles, body, params, maxBodyBytes})`; **every POST must be `application/json` or it returns 415**, so a multipart upload needs a new option. `errors.ts`: `ErrorCode` union, `ApiError`, `errorResponse`.
- `src/server/master/{resource,db-errors}.ts`: list/get helpers (`MAX_LIST_ROWS`), `mapDbError`. Routes are thin (`src/app/api/suppliers/[id]/route.ts`).
- `src/lib/supabase/server.ts`: user-session client (publishable key + cookies, RLS applies). `admin.ts`: secret-key client, import restricted by `eslint.config.mjs` (`SECRET_KEY_ALLOWED_FILES`).
- `src/lib/api/client.ts`: `apiJson` only (JSON bodies). `src/lib/time/format.ts`: `formatDateTime`, `VENUE_TIME_ZONE`; no year helper.
- `tests/helpers/fake-supabase.ts`: chainable `from()`/`rpc()`; **no `storage`, no `gte`/`lt`**. `e2e/helpers/session.ts`: `requireSupabaseStack`, `createOwner`, `signInWithMagicLink`, `expectPhoneFriendly`.
- `supabase/config.toml`: `[storage] enabled = true`, global `file_size_limit = "50MiB"`, no buckets declared (keep it that way: config buckets are local-only).
- `.github/workflows/ci.yml`: job `supabase` starts the stack with `-x …,storage-api` (**Storage is excluded today**), then `supabase test db`, exports env (`SUPABASE_SECRET_KEY` from the local stack), build, Playwright.
- `scripts/test-db-native.sh` + `supabase/tests-native/auth_shim.sql`: plain Postgres runner with an `auth` stand-in; **no `storage` schema**.
- No rate limiter exists (`rate_limited` is only an error code).

## 3. Design

**Constants** (`src/server/invoices/constants.ts`, named once):
- `INVOICE_BUCKET = "invoices"`.
- `MAX_UPLOAD_BYTES = 4_194_304` (4 MiB). The project plan §3.7 proposed 10 MB, but a Vercel Function rejects request bodies over 4.5 MB on every plan, with no configuration to raise it ([Vercel KB](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions), [limits](https://examples.vercel.com/docs/functions/limitations)). 4 MiB + `MULTIPART_OVERHEAD_BYTES = 16_384` stays under it. See Q2 / V2.
- `SIGNED_URL_TTL_SECONDS = 300`; `MAX_UPLOADS_PER_HOUR = 60` (per tenant, proposed); `MAX_INVOICE_LIST_ROWS = 100`; `MAX_FILENAME_CHARS = 200`.
- Accepted kinds: `pdf` (`%PDF-` at offset 0, `application/pdf`), `jpg` (`FF D8 FF`, `image/jpeg`), `png` (`89 50 4E 47 0D 0A 1A 0A`, `image/png`).

**Components**
- `src/lib/time/venue-date.ts`: `venueYear(instant)` → calendar year in Europe/Rome (object path folder).
- `src/server/invoices/file-check.ts` (pure, no I/O):
  - `sniffKind(bytes)` → `pdf | jpg | png | null`;
  - `checkInvoiceFile({bytes, declaredMime, filename})` → `{kind, ext, mime, sizeBytes}`; order: empty → 400 `invalid_request`; `> MAX_UPLOAD_BYTES` → 413 `payload_too_large`; unknown magic → 415 `unsupported_file_type`; declared MIME ≠ sniffed MIME → 415; filename extension present and not one of the kind's (`.pdf`; `.jpg/.jpeg`; `.png`) → 415; PDF containing the `/Encrypt` name token (followed by a PDF delimiter or whitespace) → 422 `encrypted_pdf`.
  - `sanitiseFilename(name)` → basename only, NFC, control and bidi characters removed, ≤ `MAX_FILENAME_CHARS`, `null` if empty. Stored as metadata, never used in the path.
- `src/server/invoices/invoices.ts` (user's Supabase client, RLS applies):
  - `storeInvoiceUpload(supabase, session, file, now)`: rate check → `checkInvoiceFile` → `id = randomUUID()`, `path = <tenantId>/<venueYear(now)>/<id>.<ext>` → `storage.from(INVOICE_BUCKET).upload(path, bytes, {contentType: mime, upsert: false})` → insert `invoice` row → returns the item. A Storage error → 502 `upstream_error`, nothing inserted. A row insert error after a stored object → `reportError` (invoice id and SQLSTATE only) and 500; the orphan object stays private in the tenant folder (accepted, §6).
  - `listInvoices`, `getInvoice` (columns in the API table, camelCase).
  - `createInvoiceFileUrl(supabase, id, ttlSeconds = SIGNED_URL_TTL_SECONDS)`: select `file_path` through RLS (missing → 404) → `storage.createSignedUrl(path, ttlSeconds)` → `{url, expiresAt}`. The TTL parameter exists for the integration test; the route always passes the constant.
- `src/lib/api/with-api.ts` (extended): option `multipart: { maxBodyBytes }`, mutually exclusive with `body`. When set, a state-changing request must be `multipart/form-data` (else 415), must carry `Origin` equal to `new URL(request.url).origin` (else 403 `invalid_origin`), must carry `Content-Length` (else 411 `length_required`; 411 is added to plan §3.3's status list) and ≤ `maxBodyBytes` (else 413), all **before** the session lookup and before the body is read. The handler reads `request.formData()`.
- `src/lib/api/client.ts`: `apiUpload<T>(path, formData)` (no `content-type` header, the browser sets the boundary), same `ApiResult` contract as `apiJson`.
- New `ErrorCode`s: `unsupported_file_type`, `encrypted_pdf`, `invalid_origin`, `length_required`.

**Data model** (migrations after `20261022090000`)
- `20261022100000_invoice.sql`:
  - enums `invoice_status` (`received, extracting, extraction_failed, review, approved, rejected, duplicate`) and `invoice_source` (`upload, drive`).
  - `app.normalise_invoice_number(text)` immutable: `upper(regexp_replace(btrim(s), '\s+', '', 'g'))`, null-safe.
  - `invoice`:
    - common columns as M1 (`id`, `tenant_id default app.tenant_id()`, `created_at`, `created_by default app.app_user_id()`, `unique (tenant_id, id)`);
    - `status invoice_status not null default 'received'`, `source invoice_source not null default 'upload'`;
    - `file_path text not null unique` (the PRD's `pdf_path`, renamed because photos are stored too), check `invoice_file_path_ck`: `file_path ~ ('^' || tenant_id || '/[0-9]{4}/' || id || '\.(pdf|jpg|png)$')`;
    - `file_mime text not null` in the three MIME types, check that it matches the path extension; `file_size_bytes integer not null` check `> 0 and <= 4194304`; `original_filename text null` (1–200);
    - duplicate key, written from M3: `supplier_vat text null` check `~ '^[A-Z]{2}[0-9A-Z]{2,12}$'`; `number_raw text null` (1–64, as printed); `number text generated always as (app.normalise_invoice_number(number_raw)) stored`; `invoice_date date null`;
    - `duplicate_of uuid null`, composite FK `(tenant_id, duplicate_of) → invoice(tenant_id, id)`, check `duplicate_of <> id`, check `status <> 'duplicate' or duplicate_of is not null`.
  - indexes: partial unique `invoice_dedup_uq (tenant_id, supplier_vat, number, invoice_date) where status not in ('duplicate','rejected')`; `invoice_list_idx (tenant_id, created_at desc)`.
  - trigger `app.invoice_guard()` (before update, every role including the secret key):
    - `id, tenant_id, file_path, file_mime, file_size_bytes, source, created_at, created_by` never change: raises `invoice_immutable` (SQLSTATE `P0001`);
    - status changes only along `received→extracting`, `extracting→received|review|duplicate|extraction_failed`, `extraction_failed→received`, `review→approved|rejected|duplicate`, `duplicate→rejected`; anything else raises `invalid_status_transition` (`P0001`).
  - grants: `revoke all … from anon, authenticated`; `revoke delete, truncate … from service_role`; `grant select, insert (id, file_path, file_mime, file_size_bytes, original_filename) to authenticated`. **No UPDATE grant** in M2 (status moves through M3+ procedures).
  - policies `invoice_select`, `invoice_insert`: tenant match and role in (owner, admin). Chef and waiter match nothing (plan §3.11.2).
- `20261022100100_find_duplicate_invoice.sql`:
  - `app.find_duplicate_invoice_in(p_tenant uuid, p_vat text, p_number text, p_date date, p_exclude uuid)` (SECURITY INVOKER, `search_path=''`): oldest invoice (`created_at, id`) of that tenant with `supplier_vat = upper(regexp_replace(p_vat,'\s','','g'))`, `number = app.normalise_invoice_number(p_number)`, `invoice_date = p_date`, status not in (`duplicate`, `rejected`), `id is distinct from p_exclude`. Any null key argument → null. Execute for `authenticated` and `service_role` (M3's worker passes the invoice's tenant).
  - `public.find_duplicate_invoice(supplier_vat text, invoice_number text, invoice_date date, exclude_id uuid default null) returns uuid` (SECURITY INVOKER) = `app.find_duplicate_invoice_in(app.tenant_id(), …)`. RLS still applies, so chef/waiter always get null. Execute for `authenticated` only. No HTTP endpoint in M2.
- `20261022100200_invoice_storage.sql`:
  - `insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('invoices','invoices', false, 4194304, '{application/pdf,image/jpeg,image/png}') on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types` (column names per Supabase bucket options; verified in step 5, else VT).
  - policies on `storage.objects` (all `to authenticated`, all start with `bucket_id = 'invoices'`):
    - `invoices_object_select` using `(storage.foldername(name))[1] = (select app.tenant_id())::text and (select app.role()) in ('owner','admin')`;
    - `invoices_object_insert` with check: the same, plus `name ~ '^[0-9a-f-]{36}/[0-9]{4}/[0-9a-f-]{36}\.(pdf|jpg|png)$'`;
    - **no UPDATE and no DELETE policy** for any role, so upsert/overwrite, move and remove are denied. A comment states why (10-year retention, plan §3.6 rule 5).
  - Signed URLs need the select policy, so the server-issued URL is a third check after `withApi`'s role gate and the RLS lookup of the invoice row.

**API** (W = owner, admin; camelCase; `cache-control: no-store` from `withApi`)

| Endpoint | Roles | Input | Success | Errors |
|---|---|---|---|---|
| `POST /api/invoices` | W | `multipart/form-data` with exactly one part `file`; any other part → 400 | **202** `{invoice:{id,status:"received",source,fileMime,fileSizeBytes,originalFilename,createdAt}}`, `Location: /api/invoices/:id` | 400, 401, 403 (role, `invalid_origin`), 411, 413, 415 (`unsupported_media_type`, `unsupported_file_type`), 422 `encrypted_pdf`, 429 `rate_limited`, 502 `upstream_error` |
| `GET /api/invoices?status=&before=` | W | `status` one of the enum; `before` ISO instant (cursor on `createdAt`); invalid → 400 | 200 `{invoices:[{id,status,source,originalFilename,fileMime,fileSizeBytes,supplierVat,number:numberRaw,invoiceDate,duplicateOf,createdAt}]}` newest first, ≤ `MAX_INVOICE_LIST_ROWS` | 401, 403 |
| `GET /api/invoices/:id` | W | `idParams` | 200 `{invoice:{…same fields}}` | 401, 403, 404 |
| `GET /api/invoices/:id/file-url` | W | `idParams` | 200 `{url, expiresAt}` | 401, 403, 404 (malformed id, other tenant, missing), 502 |

No DELETE or PATCH handler is exported (Next answers 405). The file path is never returned to the browser.

**Flows**
- **Upload:** screen → `apiUpload("/api/invoices", formData)` → `withApi` (multipart, Origin, Content-Length ≤ `MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES`, session, role) → `formData()`, exactly one `File` part → `storeInvoiceUpload`: count of the tenant's invoices with `created_at > now − 1 h` (RLS) ≥ `MAX_UPLOADS_PER_HOUR` → 429 → `checkInvoiceFile` → Storage upload as the user (Storage RLS insert policy) → `invoice` insert (RLS insert policy, path check constraint) → 202. Logs carry invoice id, kind, size and duration only.
- **Open document:** detail screen button → `apiJson GET …/file-url` → render an `<a target="_blank" rel="noopener noreferrer">` "Apri il documento (valido 5 minuti)"; the URL is never stored or logged.
- **Duplicate (M3 caller):** `find_duplicate_invoice` → if an id comes back, M3 sets `status='duplicate'`, `duplicate_of`.

**Screens** (`src/app/(owner)/fatture/…`, Italian, 360 px first, `min-h-tap`, data only from `/api/*`)
- `page.tsx`: list (date in Europe/Rome via `formatDateTime`, original file name rendered as text, status badge), upload panel, nav link "Fatture" in `(owner)/layout.tsx`.
- `upload-form.tsx`: "Scatta foto" `<input type="file" accept="image/jpeg,image/png" capture="environment">` and "Carica PDF o foto" `<input type="file" accept="application/pdf,image/jpeg,image/png">`; a client-side size pre-check only for a friendly message (the server decides); shows the Italian message for each error code.
- `status-badge.tsx`: label per status from i18n (`Ricevuta, In lettura, Lettura non riuscita, Da controllare, Approvata, Rifiutata, Duplicata`), presentational only.
- `[id]/page.tsx`: metadata and the open-document button.

**Tests on the real stack** (new): `vitest.integration.config.ts` (include `tests/integration/**/*.int.ts`, so `npm test` never picks them up), script `test:integration`. `tests/integration/helpers/stack.ts` creates tenants A and B, owners, a chef and a waiter with the local stack's secret key (test code only; `tests/integration/**` is added to `SECRET_KEY_ALLOWED_FILES`) and signs each in with a password through the publishable key, giving real user JWT clients. Like `requireSupabaseStack`, it throws in CI when the env is missing and skips locally.

**Native pgTAP runner without Docker:** `supabase/tests-native/storage_shim.sql` (loaded by `scripts/test-db-native.sh` right after `auth_shim.sql`) creates a minimal `storage` schema: `buckets (id, name, public, file_size_limit, allowed_mime_types, owner, created_at, updated_at)`, `objects (id, bucket_id, name, owner, owner_id, metadata, created_at, updated_at, last_accessed_at, unique (bucket_id, name))` with RLS enabled, `storage.foldername(name)` (path segments without the file name), and Supabase's default grants to `anon, authenticated, service_role`. The policy tests therefore run locally; triggers, the Storage API and signed URLs do not exist there, so **CI (`supabase test db` on the real stack plus the integration suite) is the gate**, as the runner's header already says. `012` asserts `storage.foldername` semantics so shim drift fails CI.

**CI implications** (`.github/workflows/ci.yml`, job `supabase`)
- Remove `storage-api` from the `supabase start -x` list (keep `imgproxy` excluded; step 5 confirms Storage runs without it). The bucket and policies then come from the migration on both the local stack and, via `supabase db push`, production; no dashboard step.
- Add `npm run test:integration` after "Export local Supabase settings" and before `npm run build`.
- Start-up adds one container; no timing promised. The `checks` job is unchanged (unit tests use the fake client).

## 4. Alternatives considered
- **Browser uploads straight to Storage (SDK or signed upload URL):** rejected for the base plan. It avoids the 4.5 MB Vercel limit, but bytes would land before the server checks magic bytes and encryption, and a bad object could never be removed (no delete path). V2 handles large photos in the browser instead.
- **Server uploads with the secret key:** rejected. Ground rule 2 forbids it in user-facing routes, and it would bypass the Storage policies that enforce tenant and role.
- **Streaming the file through `GET /api/invoices/:id/file`:** rejected. It hides the URL but costs function time and bandwidth per view, and the spec asks for signed URLs. The signed URL's risk (bearer link) is bounded by the 300 s TTL.
- **Declaring the bucket in `config.toml [storage.buckets]`:** rejected. It only configures the local stack; production would need a manual step, which the lead forbids.
- **`file-type` (MIT) for magic bytes, or `pdf-lib`/`pdfjs-dist` for the encryption check:** rejected. Three signatures and one token scan are ~40 lines with tests; a PDF parser is a large dependency for one boolean. Accepted trade-off: a false positive is possible if `/Encrypt` appears uncompressed in page content (§6).
- **Storage policy keyed on `owner = auth.uid()`:** rejected. Owner and admin must share the tenant's files; the tenant-id folder does that.
- **Role check only in the UI or only in `withApi`:** rejected (ADR-003). Role is checked in `withApi`, in `invoice` RLS and in Storage RLS.
- **Writing the `invoice` row before the object:** rejected. A failed upload would leave a row pointing at nothing, which M3 would try to extract; an orphan object is inert.

## 5. Build plan (test first; one commit per step; `tdd-guide` follows the order)
| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| 1 | `venueYear` | `src/lib/time/venue-date.ts` | `tests/lib/time/venue-date.test.ts`: `2026-12-31T22:59:59Z` → 2026; `2026-12-31T23:00:00Z` → 2027; `2026-07-01T00:00:00Z` → 2026; invalid `Date` → `RangeError` |
| 2 | File checks, constants, fake file builders | `src/server/invoices/{constants,file-check}.ts`, `tests/helpers/fake-files.ts` (`fakePdf`, `fakeEncryptedPdf` with `/Encrypt 5 0 R` in the trailer, `fakeJpeg`, `fakePng`, `fakeHeic`, `textBytes`) | `tests/server/invoices/file-check.test.ts` (**AT2 unit**): PDF/JPEG/PNG accepted with the right `ext`; text bytes named `fattura.pdf` with `application/pdf` → 415 `unsupported_file_type`; PNG bytes declared `application/pdf` → 415; JPEG bytes named `x.png` → 415; `fakeHeic` → 415; `MAX_UPLOAD_BYTES + 1` → 413, exactly `MAX_UPLOAD_BYTES` passes; 0 bytes → 400; encrypted PDF → 422 `encrypted_pdf`; a PDF containing the longer name `/EncryptMetadata` only is not flagged; `MAX_UPLOAD_BYTES === 4_194_304` (pinned to the migration value). `sanitiseFilename`: `../../a.pdf` → `a.pdf`, control/bidi chars removed, 300 chars → 200, `""` → null |
| 3 | Migration `invoice` (enums, normaliser, table, checks, indexes, guard trigger, grants, policies); `004` fixture row | `supabase/migrations/20261022100000_invoice.sql`, `supabase/tests/database/010_invoice.test.sql`, `004_waiter_cost_columns.test.sql` | `010` (two tenants, `act_as` pattern): owner and admin insert a row with a valid path and read it; `status` = `received`, `created_by` = caller; chef and waiter: 0 rows visible and insert → 42501 (**AT3 DB half**); owner B reads 0 rows of tenant A (**AT5 DB half**); inserting `status`, `tenant_id` or `supplier_vat` → 42501; any UPDATE by owner → 42501; DELETE → 42501; path with another tenant's prefix or another id → 23514; `.pdf` path with `image/png` → 23514; size 4194305 → 23514; as migration role: `file_path` update → `invoice_immutable`; `received→review` → `invalid_status_transition`, `received→extracting→review→approved` passes, `approved→rejected` raises; `duplicate` without `duplicate_of` → 23514; same VAT+number+date twice in `review` → 23505 on `invoice_dedup_uq`, allowed when one is `rejected`; `normalise_invoice_number(' ft 1/2026 ')` = `FT1/2026`. `001` and `004` green with the new table |
| 4 | Migration `find_duplicate_invoice` | `…/20261022100100_find_duplicate_invoice.sql`, `supabase/tests/database/011_find_duplicate_invoice.test.sql` | `011` (**AT7**): fixture invoice A1 (`IT12345678903`, `FT 1/2026`, 2026-10-01, `review`); owner A: same VAT+number+date → A1; `' it12345678903 '` and `'ft1/2026'` → A1; date 2026-10-02 → null; other number → null; `exclude_id` = A1 → null; A1 `rejected` → null; two matches → the older one; owner B (same key only in A) → null; chef → null; `has_function_privilege('anon', …)` false; `app.find_duplicate_invoice_in` as `service_role` with tenant A → A1 |
| 5 | Migration bucket + Storage policies; storage shim for the native runner; CI starts `storage-api` | `…/20261022100200_invoice_storage.sql`, `supabase/tests-native/storage_shim.sql`, `scripts/test-db-native.sh`, `.github/workflows/ci.yml`, `supabase/tests/database/012_invoice_storage.test.sql` | `012`: bucket `invoices` exists, `public = false`, `file_size_limit = 4194304`, `allowed_mime_types` = the three types; `storage.foldername('t/2026/x.pdf') = '{t,2026}'`; policies on `storage.objects` for `invoices` are exactly `invoices_object_select`, `invoices_object_insert` (none for update/delete). Fixture objects for A and B inserted as the migration role. As owner A: sees A's object, 0 of B's (**AT5 storage half**); chef and waiter A: 0 objects; owner A insert at `A/2026/<uuid>.pdf` succeeds; at B's prefix, at `A/x.html` and as chef → error and no row added (**AT3 storage half**); UPDATE of `name` → object unchanged; **DELETE by owner, admin, chef and waiter → the object still exists afterwards** (**AT6 SQL half**; asserted on the row, whether RLS filters silently or a trigger raises). Runs on `scripts/test-db-native.sh` (shim) and in CI (`npx supabase test db`, real Storage schema). The CI run of this commit is the T1 check: the migration applies on `supabase start` with Storage enabled and without `imgproxy` (else VT) |
| 6 | `withApi` multipart option; new `ErrorCode`s; fake client gets `storage` and `gte`/`lt` | `src/lib/api/{with-api,errors}.ts`, `tests/helpers/fake-supabase.ts` | `tests/lib/api/with-api.test.ts`: multipart route + JSON request → 415; no `Origin` or `Origin: https://evil.example` → 403 `invalid_origin`; no `Content-Length` → 411; over the limit → 413; all four before `getClaims` is called; a valid request reaches the handler; JSON routes unchanged (existing cases green); `fake-supabase` exposes `storage.from(bucket).upload/createSignedUrl` spies with scripted results |
| 7 | Upload service + `POST /api/invoices` | `src/server/invoices/invoices.ts`, `src/app/api/invoices/route.ts` | `tests/app/api/invoices/upload.test.ts` (fixed clock 2026-12-31T23:30:00Z): valid PDF → 202, `Location`, upload path matches `^1111…/2027/<uuid>\.pdf$`, `upsert:false`, `contentType` = sniffed MIME, insert values `{id,file_path,file_mime,file_size_bytes,original_filename}` with the same id (**AT1 API**); renamed text file → 415 and neither upload nor insert called; oversize → 413; encrypted → 422 (**AT2 API**); waiter, chef → 403, no session → 401 (**AT3 API**); a second part `tenantId` → 400; no `file` part → 400; 60 invoices in the last hour → 429; Storage error → 502, no insert; insert error after upload → 500 and `reportError` called with no file name or bytes |
| 8 | List and detail | `src/server/invoices/invoices.ts`, `src/app/api/invoices/route.ts` (GET), `src/app/api/invoices/[id]/route.ts` | `tests/app/api/invoices/read.test.ts`: list maps rows to camelCase, newest first, `limit(100)`, no `filePath` key in any response; `?status=review` filters; `?status=foo` and `?before=yesterday` → 400; detail of a missing or other-tenant id (RLS → null) → 404; malformed id → 404; chef/waiter → 403; DELETE and PATCH not exported |
| 9 | Signed URL service + route | `src/server/invoices/invoices.ts`, `src/app/api/invoices/[id]/file-url/route.ts` | `tests/app/api/invoices/file-url.test.ts`: owner → 200 `{url, expiresAt}` and `createSignedUrl(path, 300)` called; row not visible (tenant B) → 404 and `createSignedUrl` **not** called (**AT5 API**); chef/waiter → 403 before any query; Storage error → 502; response has `cache-control: no-store` |
| 10 | Real-stack integration suite + CI step | `vitest.integration.config.ts`, `package.json` (`test:integration`), `tests/integration/helpers/stack.ts`, `tests/integration/invoice-storage.int.ts`, `eslint.config.mjs` (`tests/integration/**` allowed), `.github/workflows/ci.yml` | `invoice-storage.int.ts` (real Auth, PostgREST, Storage; user JWT clients only, except fixtures): `storeInvoiceUpload` as owner A → row `received` and object listed at `<A>/<yyyy>/<id>.pdf` (**AT1**); chef A direct `storage.upload` to A's prefix → error (**AT3**); owner A direct upload with `text/html` content type → rejected by the bucket; `createInvoiceFileUrl(…, 1)` → fetch within the TTL returns 200 and the body starts `%PDF-`; after 3 s the same URL → not OK and no PDF bytes (**AT4**); owner B `createInvoiceFileUrl(A's id)` → `ApiError` 404, and owner B `createSignedUrl(A's path)` directly → error (**AT5**); owner A `storage.remove([path])` → object still downloadable via a new signed URL (**AT6 API half**); upload to an existing path with `upsert:true` → error, original bytes unchanged |
| 11 | `apiUpload`, screens, i18n, nav | `src/lib/api/client.ts`, `src/app/(owner)/fatture/{page,upload-form,status-badge}.tsx`, `src/app/(owner)/fatture/[id]/page.tsx`, `src/app/(owner)/layout.tsx`, `src/lib/i18n/messages/{it,en,keys}.ts` | `tests/lib/api/client.test.ts`: `apiUpload` sends `FormData` without a `content-type` header and passes error bodies through. `tests/lib/i18n.test.ts` key parity. `e2e/invoice-upload.spec.ts` at 360×740 (real stack): owner uploads `fakePdf` → row with badge "Ricevuta" (**AT1 E2E**); text bytes named `.pdf` → Italian unsupported-type message, no new row (**AT2 E2E**); photo input has `capture="environment"` and image `accept`; detail "Apri il documento" → link whose fetch returns 200 `%PDF-`; `expectPhoneFriendly` |

**Acceptance tests → proof**
| AT (plan §5a.1 M2) | Files | Command |
|---|---|---|
| 1 Valid PDF → 202, `received`, object at `<tenant>/<yyyy>/<uuid>.pdf` | `tests/app/api/invoices/upload.test.ts`, `tests/integration/invoice-storage.int.ts`, `e2e/invoice-upload.spec.ts`, `010` (path check) | `npm test`; `npm run test:integration`; `npx playwright test`; `npx supabase test db` |
| 2 Renamed non-PDF → 415; oversize → 413; encrypted → 422 | `tests/server/invoices/file-check.test.ts`, `tests/app/api/invoices/upload.test.ts`, `tests/lib/api/with-api.test.ts` (413 by header), `e2e/invoice-upload.spec.ts` (415) | `npm test`; `npx playwright test` |
| 3 Waiter or chef upload → 403 | `upload.test.ts`, `010_invoice.test.sql`, `012_invoice_storage.test.sql`, `invoice-storage.int.ts` | `npm test`; `npx supabase test db`; `npm run test:integration` |
| 4 Signed URL works within TTL, fails after | `invoice-storage.int.ts` (TTL 1 s) | `npm run test:integration` (CI job `supabase`) |
| 5 Owner B → A's `file-url` → 404 | `file-url.test.ts`, `010`, `012`, `invoice-storage.int.ts` | `npm test`; `npx supabase test db`; `npm run test:integration` |
| 6 Storage delete by an authenticated user → denied | `012_invoice_storage.test.sql`, `invoice-storage.int.ts` | `npx supabase test db`; `npm run test:integration` |
| 7 `find_duplicate_invoice` same key → existing; other date → none | `011_find_duplicate_invoice.test.sql` | `npx supabase test db` |

### 5b. Variants
**V1 — HEIC photos accepted** · Trigger: Q1 = iPhone HEIC must work · Replaces steps: none (adds after 11)
| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V1.1 | Browser re-encodes HEIC/HEIF to JPEG before upload (`createImageBitmap` + canvas `toBlob("image/jpeg")`); server rules unchanged | `src/lib/upload/reencode.ts`, `src/app/(owner)/fatture/upload-form.tsx` | `tests/lib/upload/reencode.test.ts` (canvas mocked): `image/heic` and `.heif` → re-encoded, output `image/jpeg` named `.jpg`; JPEG/PNG/PDF untouched; decode failure → Italian "formato non supportato" result. `file-check.test.ts`: `fakeHeic` still 415 at the server. Manual iPhone check recorded in the PR (HEIC photo → `.jpg` invoice "Ricevuta") |

**V2 — Photos larger than 4 MiB** · Trigger: Q2 = real photos exceed 4 MiB · Replaces steps: none (adds after 11; creates `reencode.ts` if V1 is not built)
| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V2.1 | JPEG/PNG over `MAX_UPLOAD_BYTES` are downscaled in the browser to `PHOTO_MAX_SIDE_PX` (proposed 2400) as JPEG; PDFs are never altered and still get 413 | `src/lib/upload/reencode.ts`, `upload-form.tsx` | `reencode.test.ts`: 6 MB JPEG → re-encoded with long side 2400; 1 MB JPEG untouched; 6 MB PDF untouched. `e2e/invoice-upload.spec.ts`: a generated 5 MB PNG → invoice "Ricevuta" with `fileMime` `image/jpeg` and `fileSizeBytes ≤ MAX_UPLOAD_BYTES` |

**V3 — Owner can clear a duplicate flag** · Trigger: Q3 = yes · Replaces steps: none (amends 3)
| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V3.1 | Guard allows `duplicate→review`; `invoice_dedup_uq` becomes the plain index `invoice_dedup_idx` (two confirmed invoices may share the key) | `…/<ts>_invoice_duplicate_override.sql`, `010_invoice.test.sql` | `010`: `duplicate→review` passes as migration role; two `review` rows with the same key insert; `approved→review` still raises; `011` unchanged and green |

**V4 — Broader invoice-number matching** · Trigger: Q4 = punctuation should not matter · Replaces steps: none (amends 3 and 4)
| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V4.1 | `app.normalise_invoice_number` removes every non-alphanumeric character; the generated `number` column and `invoice_dedup_uq` are recreated | `…/<ts>_invoice_number_alnum.sql`, `010`, `011` | `010`: `'FT-1/2026'` → `FT12026`. `011`: `'FT 1/2026'` matches stored `'ft-1-2026'`; `'FT 1/2025'` does not |

**V5 — Duplicate check for suppliers without a VAT number** · Trigger: Q5 = match on supplier name when there is no VAT · Replaces steps: none (adds after 4)
| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V5.1 | As built: `invoice.supplier_name text null` (1–200 after trim, written from M3), `duplicate_warning_of` and `duplicate_override` columns, and a separate warning-only `find_name_duplicate_invoice(_in)` (normalised name + number + date, VAT-less invoices only; `find_duplicate_invoice` is unchanged) | `…/<ts>_invoice_supplier_name.sql`, `013` | `013`: null VAT + same normalised name + number + date → match; different name → null; VAT present → ignored; `duplicate` and `rejected` rows skipped; name-lookup index exists |

**VT — Bucket limits not settable at migration time** · Trigger: the step 5 CI run fails because `file_size_limit`/`allowed_mime_types` do not exist when migrations run · Replaces steps: the bucket insert in 5 and the bucket-MIME case in 10
| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| VT.1 | Insert `(id, name, public)` only; size and type rest on the API checks; a risk note in the PR | `…/20261022100200_invoice_storage.sql`, `012`, `invoice-storage.int.ts` | `012`: bucket exists and `public = false` (limit assertions removed). `invoice-storage.int.ts`: the `text/html` direct-upload case is removed, all other cases green |

## 6. Risks and mitigations
- **Security / privacy:**
  - *Cross-tenant access:* three layers (`withApi` role, `invoice` RLS, Storage RLS by tenant folder), composite FK for `duplicate_of`, path check constraint. Tested in `010`, `012`, step 9 and step 10.
  - *Secrets:* no M2 app code uses the secret key; uploads and signed URLs run on the user's JWT. Only `tests/integration/helpers/stack.ts` reads the local stack's demo key (CI env, exported by `supabase status`) for fixtures. **No new secrets or env vars**; `.env.example` unchanged; no new account logins. Files live in the existing Supabase project (EU); the production secret key stays in Vercel env, unused here.
  - *Direct Storage/PostgREST calls with the user's own JWT:* an owner/admin can bypass the route and upload unchecked bytes into their own tenant folder, limited by the bucket size/MIME settings and the path regex. Self-harm only; M3 must re-sniff the bytes before sending them to the model and treat content as untrusted (plan §3.11.5).
  - *Signed URL is a bearer link:* 300 s TTL, `no-store`, never logged or stored, `rel="noopener noreferrer"`.
  - *Upload abuse:* owner/admin only, 4 MiB cap, Content-Length required, 60 per hour per tenant, Origin check (CSRF guard for the one multipart route).
  - *Encrypted-PDF heuristic:* a `/Encrypt` token in uncompressed content gives a false 422; the message tells the user to re-save the PDF. The plan Q1 sample invoices will show whether this happens.
  - *Strict `%PDF-` at offset 0:* a generator that writes leading bytes gets 415; checked against the same samples.
  - *Orphan object* if the row insert fails after upload: private, inert, reported to Sentry by invoice id; listing orphans belongs to the M13/M25 invariant work.
  - *Personal data:* invoices may name sole-trader suppliers (plan Q13). No delete path; retention 10 years (PRD), purge policy Q6. `original_filename` is shown escaped and never logged.
- **Unverified (checked in the named step):** bucket option column names at migration time (step 5, else VT); Storage running without `imgproxy` (step 5); the `@supabase/ssr` server client sending the user JWT to Storage, upload with `upsert:false` needing only the insert policy, and the response to an expired signed URL (step 10 asserts behaviour, not error text); whether a direct SQL delete on `storage.objects` raises or silently affects 0 rows on current Supabase (step 5 asserts the object survives either way). Supabase docs could not be fetched while planning; the bucket SQL follows [creating buckets](https://supabase.com/docs/guides/storage/buckets/creating-buckets), and Supabase warns that SQL deletes do not remove stored files ([troubleshooting](https://supabase.com/docs/guides/troubleshooting/storage-unexpectedly-high-usage-or-exceed_storage_size_quota-errors-ae21a5)).
- **Correctness:** year folder from Europe/Rome (step 1 New Year case); `Origin` compared with `request.url`'s origin, proven on `next start` by step 11.
- **Performance / cost:** whole file buffered in memory (≤ 4 MiB); list capped at 100 rows with an index on `(tenant_id, created_at desc)`. No figures promised.
- **Dependencies:** none added (§4).
- **Plan change to record in DigiAlto-Ops `context.md`:** `MAX_UPLOAD_BYTES` 4 MiB instead of the proposed 10 MB (Vercel body limit).

## 7. Open questions for the founder
- **Q1** (plan Q28) Must iPhone HEIC photos be accepted, or is "PDF, JPEG or PNG" fine? Until answered HEIC gets a clear 415 message (→ V1). Can someone test the camera button on an iPhone during the M2 review?
- **Q2** Uploads are capped at 4 MiB because the hosting rejects larger requests. Are any supplier PDFs or phone photos bigger? Please share the size of the largest sample (→ V2 for photos; large PDFs would need a new design).
- **Q3** When an invoice is flagged as a duplicate by mistake, may the owner clear the flag? Base plan: a duplicate can only be rejected (→ V3).
- **Q4** Should `FT 1/2026`, `FT-1-2026` and `ft1/2026` count as the same invoice number? Base plan ignores only spaces and case (→ V4).
- **Q5** Some suppliers have no VAT number on file. Should duplicates be detected by supplier name in that case? Base plan: no duplicate check without a VAT (→ V5).
- **Q6** After the 10-year retention, should invoices be deleted, and who decides (the accountant)? M2 has no delete path at all.
- **Assumptions (confirm):** only owner and admin upload (the chef never does); 60 uploads per hour per venue is ample; links to open a document last 5 minutes.
