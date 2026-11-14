# Tech plan: Osteria Digitalization · P2-7 XML e-invoice upload (C19)

- **Client slug / internal:** `osteria-dei-rossi` (internal planning document, English; every screen string below is Italian first and
  marked "da approvare").
  - **Client facts used:** none. No venue name, supplier, VAT number, price or invoice number from the real venue appears in code, seed or
    fixtures.
  - **Fixtures** are fake FatturaPA files built from the official schema (Allegato A v1.9.1, Appendix 2, XSD 1.2.3) and the official example
    files `IT01234567890_FPR01/02/03.xml` (fatturapa.gov.it), with the data replaced: tenants "Osteria Demo A/B", suppliers "Fornitore Demo
    1/2/3", checksum-valid fake VAT numbers already used by the test suite (`IT12345678903`, `IT00000000000`), lot codes `L-DEMO-0001`…,
    invoice dates in 1998 (no-date-bombs guard, builder hand-off §5). The official examples' own VAT `IT01234567890` fails the Italian
    check digit, so it is never used as a supplier VAT in a fixture that must import.
- **Repo and branch:** `osteria-dei-rossi-app`, branch `feat/p2-7-xml-invoice-upload` with `main` `fdc64da3` merged in (includes P2-2).
- **Context: confirmed pre-go-live queue (lead, founder decisions 2026-11-14):** CB11 (brand logo files) → P2-2 trace and sell-through
  (merged) → **P2-7 XML e-invoice upload (this plan)** → SP0 SaaS spike → P2-4 alert rules → P2-5 accountant file → small fixes → code
  freeze around 19 December. The freeze date is the lead's planning date, not a promise of this plan. No delivery date is promised.
- **Name:** P2-7, candidate C19 (`docs/plans/2026-11-11-phase2-scope.md` lines 852–863; Part 3 row line 882; OQ-4 line 935). Founder
  decision 2026-11-13: deterministic parse, no AI, same review, duplicate and approval rules as today. Automatic SDI delivery through an
  accredited intermediary is **not** in Phase 2.
- **Numbering** (re-check every number against `main` and every remote branch with `git ls-remote` before the PR is marked ready):
  - **Migrations:** `20261204100000`–`20261204100400` (newest on `main`: `20261203100500_reservation_covers.sql`).
  - **pgTAP:** `360`–`365`; variants use `366`+.
  - **ADR:** **ADR-044** (newest on `main`: ADR-043).
  - **IDs:** decisions **D-X1…D-X18** (plus D-X13b); steps **S1–S20**; variants **V1–V6**; acceptance tests **AT-X1…AT-X13**; questions
    **Q-X1…Q-X16**; origin hooks **H4/H5** from P2-2 §3.13.4.
- **Author:** architect · **Date:** 2026-11-14
- **Sources:** `CLAUDE.md`; `docs/handoff/builder.md`; `docs/plans/2026-11-11-phase2-scope.md`; `docs/plans/2026-11-14-p2-2-trace-sell-through.md`
  (format, §3.13); `docs/plans/2026-11-09-backup-invoice-files.md`; ADR-002, ADR-003, ADR-004, ADR-018, ADR-034, ADR-040, ADR-043; the merged
  SQL and TS listed in §2 with line numbers; the fiscal feasibility study in DigiAlto-Ops (read-only, §1(a)–(b)); the official sources in §8.
  **Where merged code and an older plan differ, the code wins.**

---

## 0. Summary for the founder (plain language)

**What you get**

1. **Upload the supplier's electronic invoice file.** On the Fatture page, next to "take a photo" and "choose a PDF", you can now pick the
   electronic invoice file itself: the `.xml` file, or the signed `.xml.p7m` file, exactly as you download it from the tax portal
   ("Fatture e Corrispettivi"), from the PEC e-mail or from your accountant.
2. **No reading mistakes and no AI cost.** Costì reads the file directly: supplier, VAT number, invoice number and date, every line with
   its quantity, price and VAT rate, and the VAT summary per rate. Nothing is guessed. The invoice then appears on the **same check screen
   you use today**, and you approve it **the same way**.
3. **A clear answer straight away.** If the file is damaged, is not an invoice, is a document type Costì does not handle yet (for example
   a **credit note**), or was already uploaded, you see the reason the moment you upload it, and **nothing is saved**. Invoices can never be
   deleted, so a wrong file must never become an invoice.
4. **Duplicates.** If you photographed an invoice at delivery and later upload its electronic file, Costì notices it is the same invoice
   (same supplier VAT number, number and date) and offers one button: **"Usa il file XML al posto del PDF"**. The photo copy is then set
   aside and the exact electronic one is the one you approve. The same file uploaded twice is refused with a link to the first one.
5. **New suppliers.** A supplier Costì does not know yet is shown with its name and VAT number from the file; one tap creates it.
6. **Lot codes.** E-invoices have **no standard box** for lot or expiry. When a supplier writes them in the file anyway, Costì shows them
   on the line with a button **"Usa come lotto"** / **"Usa come scadenza"**, so you copy them with one tap instead of typing.

**What it does not do (yet):** credit notes (note di credito, TD04), self-invoices and integrations (TD16–TD23, TD26–TD29), advance invoices,
professional fee invoices with withholding tax, simplified invoices, invoices in a foreign currency and invoices with negative lines are
refused with a message (today they cannot be entered from a photo either). Costì does not receive invoices automatically from the tax
system: you upload the file (automatic intake is a later SaaS step). Costì's copy of the file is **not** the legal digital preservation
(conservazione): that stays where it is today.

**About the signature on `.p7m` files:** Costì opens the signed envelope to read the invoice, but does not check the signature itself
(the national exchange system, SdI, already checks every signed invoice before delivering it, and unsigned invoices are equally valid). The
screen says so: "File firmato (firma non verificata da Costì)".

**Who sees what:** only the owner and the admin upload, check and approve invoices. The chef and waiters never see invoices or prices.

**Cost:** no new outside service, no new account, no new monthly cost. One small, free open-source code library is added (§3.1 D-X12).

**What we ask outside people:** one question for the commercialista and one for you (§7). Everything else has a recommended default.

---

## Flags for the lead (read first)

1. **Synchronous, refuse-before-store.** An XML file is parsed inside the upload request. Every refusal (bad file, wrong type, already
   uploaded, wrong buyer) happens **before** anything is written to Storage or Postgres, because invoices can never be deleted. The
   extraction worker never sees an XML invoice (it is inserted in `review` or `duplicate`, never `received`).
2. **No pinned procedure is touched.** `approve_invoice`, `extraction_complete`, `app.automap_invoice`, `app.automap_lines`,
   `review_update_line`, `review_set_supplier`, `review_clear_duplicate`, `reject_invoice`, `app.approval_blockers` keep their md5 (pinned in
   pgTAP 365). Three new definers are added: `invoice_xml_precheck`, `import_xml_invoices`, `review_replace_with_xml`.
3. **One new operational table:** `invoice_vat_summary` (append-only, `tenant_id` + RLS) joins the ADR-018 purge list in the same step (S3).
   P2-2's preserves test 359 and storage test 012 are **re-pinned on purpose** (S2, S3, S6).
4. **One new runtime dependency:** `saxes` 6.0.0 (ISC), already in `package-lock.json` as a dependency of `jsdom`. `tests/config/no-new-deps.test.ts`
   changes on purpose (S9). The p7m envelope is opened by ~150 lines of our own bounded DER/BER reader, no library and no shell.
5. **p7m: unwrap only, no signature verification** (D-X5, §3.4). Verification is variant V3.
6. **Multi-body files** (lotto di fatture) become one invoice per body; the file is stored once per body (the `invoice_file_path_uq`
   constraint wants one object per invoice). Capped at 10 bodies.
7. **Size:** M+ (20 steps). If review asks for a split: SQL + server (S1–S14, S17) then UI + integration + e2e + docs (S15–S16, S18–S20).

---

## 1. Goal and scope

- **Goal:** the owner or admin uploads a FatturaPA file (`.xml` or `.xml.p7m`) next to PDF and photo; Costì parses it deterministically into
  the existing invoice, lines and review flow; the invoice is approved with the unchanged `approve_invoice`.
- **In scope:**
  - upload of `.xml` (unsigned or XAdES-signed) and `.xml.p7m` (CAdES), sniffed by content, up to the existing 4 MiB limit;
  - p7m unwrap (DER, BER indefinite length, chunked content, base64 or PEM armour, nested envelopes up to 3 levels);
  - hardened XML reading (no DTD, no entities beyond the five predefined, no external fetch, depth, size, count and encoding limits);
  - mapping of FatturaPA 1.2.x ordinary invoices (`FPR12`, and `FPA12` structurally) for document types **TD01, TD24, TD25**: header,
    supplier, lines (`DettaglioLinee` with `ScontoMaggiorazione`, `CodiceArticolo`, `AltriDatiGestionali`, `Natura`), VAT summary
    (`DatiRiepilogo`), totals, due date; multi-body files;
  - supplier link by VAT number (existing auto-mapping), new-supplier prefill;
  - duplicates: same file again (refused), XML vs PDF/photo of the same invoice in either order (existing duplicate flow plus a new
    "replace" action), amount comparison shown;
  - P2-2 hooks: **H5 built** (first `CodiceArticolo` drives the supplier article memory); **H4 partly built** (other data shown, one-tap copy
    to lot/expiry); automatic per-supplier lot mapping stays a hook (V5);
  - storage of the original file in the `invoices` bucket (path, RLS), included in the existing encrypted backup and the demo purge;
  - screens (upload, list, review), role enforcement in Postgres, guide, ADR-044.
- **Out of scope (each refused with a clear message, or later):** credit notes TD04 (V1); negative lines (V2); signature verification (V3);
  a hard lock on fiscal fields (V4); automatic lot/expiry mapping per supplier (V5); simplified invoices FSM10/TD07 (V6); TD02, TD03, TD05,
  TD06, TD16–TD23, TD26–TD29; withholding (`DatiRitenuta`), pension funds (`DatiCassaPrevidenziale`), split payment (`EsigibilitaIVA` S), non-EUR
  currency; extracting embedded attachments (`Allegati`); automatic SDI intake through an intermediary (SaaS milestones); legal digital
  preservation (conservazione); the accountant CSV (P2-5 reads what this plan stores); any change to the PDF/photo AI path.

## 2. Current state (`main` `fdc64da3`, newest migration `20261203100500`)

| What exists | Where (file:line) | How P2-7 uses it |
|---|---|---|
| **Upload route** `POST /api/invoices`: roles owner/admin, multipart limit `MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES`, reply 202 `{invoice}` | `src/app/api/invoices/route.ts:16-29` | Branches on the sniffed kind: PDF/photo unchanged; XML/p7m to the new import (S11) |
| `readUploadedFile` (one part `file`) and `storeInvoiceUpload` (hourly limit 60, check, path `<tenant>/<yyyy>/<id>.<ext>`, Storage upload as the user, row insert, orphan object on insert failure logged by id + SQLSTATE) | `src/server/invoices/invoices.ts:69-87`, `:118-166` (limit `:124-136`, path `:140`, upload `:142-145`, insert `:147-157`, orphan `:158-164`) | Reused; the hourly limit counts bodies; same "object first, then row" order |
| File check: magic bytes PDF/JPEG/PNG; declared MIME must equal the canonical one; extension must match; encrypted PDF refused | `src/server/invoices/file-check.ts:27-32`, `:59-85` (MIME `:74`, extension `:75-76`); `sanitiseFilename` `:94-102` | Extended with kinds `xml` and `p7m` and a per-kind declared-MIME allow-list (S7) |
| Limits and kinds: bucket `invoices`, 4 MiB, 60 uploads/h, kinds `pdf|jpg|png` | `src/server/invoices/constants.ts:2-25`; `src/lib/invoices/limits.ts:6` | New kinds; 4 MiB unchanged (Vercel body limit; SdI's own limit is 5 MB, Allegato A p. 5 and p. 18) |
| `invoice` table: `file_path_ck` `\.(pdf|jpg|png)$`, `file_mime_ck`, size ≤ 4 MiB, `supplier_vat_ck`, `number_raw` 1–64, generated `number`; guard trigger (immutable file columns, status lifecycle); RLS owner/admin; no delete path | `supabase/migrations/20261022100000_invoice.sql:18-54` (path `:38-39`, mime `:40-44`), guard `:64-95`, RLS `:97-111`; guard replaced (duplicate→review) `20261022110000_invoice_duplicate_override.sql:12-39` | Two constraints replaced to allow `.xml` / `.p7m`; XML metadata columns added (S1); guard unchanged, a second guard for the new columns |
| **Storage**: private bucket `invoices`, 4 MiB, MIME allow-list PDF/JPEG/PNG; select/insert policies owner/admin in own tenant folder, name regex `\.(pdf|jpg|png)$`; **no update, no delete** policy | `supabase/migrations/20261022100200_invoice_storage.sql:4-9`, `:16-31` (regex `:30`); pgTAP `supabase/tests/database/012_invoice_storage.test.sql:39,50` | MIME list and insert regex extended (S2) |
| **Backup** of the bucket (ADR-034): lists every object of `invoices` by SQL, extension-agnostic; encrypted packs; safe path check | `docs/adr/adr-034-invoice-file-backups.md`; `scripts/lib/backup/commands.ts:347-354`; `scripts/lib/backup/download.ts:9` | XML/p7m objects are included with no code change; S17 proves it with a test |
| **Demo purge** clean-up: path regex `\.(?:pdf|jpg|png)$` for logged objects; the reset logs every `invoice.file_path` | `scripts/lib/demo/purge.ts:37-38,61`; `supabase/migrations/20261105100300_demo_purge.sql:145`; purge list `20261124100100_demo_purge_tables_resv.sql:9-49` (invoice tables `:21`) | Regex extended (S17); `invoice_vat_summary` joins the list (S3) |
| **AI extraction** (PDF/photo): cron every minute when `app.extraction_due()`; worker claims a `received` invoice, re-checks bytes, calls the model with `env.modelId` read from `EXTRACTION_MODEL_ID` (`readExtractionEnv`), stores via `extraction_complete` | `supabase/migrations/20261022120200_cron_extract.sql:23-34,69-72`; `src/server/cron/extract-job.ts:78-196` (env `:81`, claim `:83-90`, re-check `:124-134`, model `:153-162`, store `:178-183`); `src/server/extraction/checks.ts:47-51,111-157`; `src/server/extraction/schema.ts:36-61` | Not used for XML; a guard makes the worker refuse an XML kind without a model call (S12). `normaliseVat` and `clean` reused by the mapper |
| `extraction_complete` (service role): inserts lines, duplicate decision under an advisory lock, header, then `app.automap_invoice` | `20261022120100_extraction_procedures.sql:9-29` (lock key), replaced in `20261022130300_automap.sql:143-227` (duplicate `:183-197`, automap `:224`) | The XML import repeats the same order in its own definer; `extraction_complete` itself is unchanged |
| **Duplicate detection**: VAT + normalised number + date among live invoices (`find_duplicate_invoice_in`); VAT-less name warning; non-unique index; owner may declare "not a duplicate" per pair; approval recomputes look-alikes | `20261022100100_find_duplicate_invoice.sql:6-27`; `20261022110000_invoice_duplicate_override.sql:6-9`; `20261022130200_review_helpers.sql:200-235` (`recheck_duplicate`); `20261022141000_clear_duplicate_partner.sql:37-56` (`is_undeclared_look_alike`), `:60-157` (`approval_blockers`, duplicate gate `:94-99`), `:229-284` (`review_clear_duplicate`) | Reused unchanged for XML vs PDF in both orders; exact-file check added (sha256) |
| `invoice_line`: `qty ≥ 0`, `unit_price ≥ 0`, `line_amount ≥ 0` numeric(12,4), `vat_rate` numeric(5,2) 0–100, `supplier_code` 1–64, `lot_code`, `expiry`, `checks`, `extracted` baseline; review columns (`is_stock`, cost centre rule, mapping) | `20261022120000_invoice_extraction.sql:43-78` (qty `:71`, amount `:74`, vat `:75`); `20261022130100_invoice_review_columns.sql:32-97` (non-stock needs a cost centre `:90`) | Lines written as today; **no negative amounts** (refused, V2); two nullable columns added (`vat_nature`, `xml_details`) |
| Review helpers: allowed VAT rates `{0,4,5,10,22}`, `line_checks`, `totals_gate` (Σ lines + VAT − gross, ±0.05 €), `refresh_gate`, `line_corrected_fields` (compares with `extracted`) | `20261022130200_review_helpers.sql:10-13,56-70,75-92,96-115,121-159` | Called by the import; `extracted` holds the XML values as the correction baseline |
| **Supplier matching**: `automap_invoice` links the active supplier whose `vat_number` equals `invoice.supplier_vat`, else a one-tap name suggestion; `automap_lines` maps by `supplier_code` first, then description hash | `20261022130900_mapping_decisions.sql:496-546` (VAT `:511-518`); `20261022131000_automap_locks_invoice.sql:39-128` (code first `:82-85`) | Called unchanged by the import; `CodiceArticolo` fills `supplier_code` (H5) |
| `review_set_supplier` (create supplier `{name, vat_number, payment_terms_days}` or link; re-check duplicate; automap) | `20261022130900_mapping_decisions.sql:351-429` (create `:381-390`, VAT overwrite `:417-419`) | The "Crea fornitore" path for an unknown XML supplier, unchanged |
| `supplier`: `vat_number` must pass `app.is_valid_it_vat` (`IT` + 11 digits, check digit), unique per tenant; `supplier_item` with `supplier_code` unique per supplier | `20261021130200_supplier.sql:5-22,24-52`; `20261021130000_master_types.sql:35-60` | Unchanged |
| **`approve_invoice`** (definer, one transaction): lock, duplicate-key lock, blockers, receipts copying `lot_code`/`expiry` into `raw_lot`, price history, payable = gross − credits, audit, price-variance check | `20261023110600_approve_invoice_variance.sql:204-362` (receipts `:283-300`, payable `:326-332`); `approval_lines` `20261022140400_approval_lines.sql:33-56`; `resolve_due_date` `:69-82` | Unchanged; approves XML invoices exactly like others |
| `reject_invoice` (review or duplicate → rejected, audit with reason) | `20261022140700_approval_review_fixes.sql:334-372` | Called inside `review_replace_with_xml` |
| Extraction-quality report counts only invoices with `extracted_at` | `20261022130700_extraction_quality.sql:40-41` | XML invoices keep `extracted_at` null, so the AI metric stays clean |
| **Review reply** assembled in TS, with P2-2's `lotMissing` and `summary.stockLinesWithoutLot` | `src/server/invoices/review.ts:242-252,300,498,509-512`; `src/server/invoices/review-types.ts:16-66,125-166` | Extended with XML fields (S14) |
| Screens: upload card (accept list), document panel (PDF iframe or image by MIME), file URL (signed, 300 s) | `src/app/(owner)/fatture/upload-form.tsx:107-113` (accept `:111`); `src/app/(owner)/fatture/[id]/revisione/document-panel.tsx:20-81` (`:60-75`); `src/app/api/invoices/[id]/file-url/route.ts:5-8`; `src/server/invoices/invoices.ts:332-353` | XML branch: no iframe, a "Dal file XML" card and a download link (S13, S16) |
| Guards: no new dependency; P2-2 preserves (md5 pins, purge list size 58, schema snapshot) | `tests/config/no-new-deps.test.ts:6-34`; `supabase/tests/database/359_p22_preserves.test.sql:28,37-38,41-99` | Changed on purpose (S3, S6, S9) |
| Open outside questions already asked: negative lines and credit notes (M3 Q3 / M4 Q2 / M5 Q3; M9 Q30) | `docs/go-live/phase1-closeout.md:144,155`; `docs/plans/2026-10-23-m09-payables.md:431-436,501-503` | Not asked again; their answers trigger V2 and V1 |

## 3. Design

### 3.1 Decisions

| # | Decision | Why |
|---|---|---|
| D-X1 | **Synchronous import in the upload request**, not through the extraction queue. Order: parse (pure) → precheck RPC → Storage upload (as the user) → one import RPC (one transaction) | Parsing is deterministic and takes no paid call; the user gets the reason at once; refusals never leave a row (rows cannot be deleted, an `extraction_failed` row cannot even be rejected) |
| D-X2 | **Refuse before store**: every file-level refusal happens before Storage. An import RPC failure after the upload leaves an inert object, logged by id + SQLSTATE only (the existing pattern, `invoices.ts:158-164`) | No junk invoices; same orphan handling as today |
| D-X3 | **All or nothing per file**: if any body or line breaks a rule, the whole file is refused, with up to 5 reasons (`details`) | No partial invoices; a "partial parse" only means *ignored informational blocks*, listed as notes (D-X15) |
| D-X4 | **Supported document types: an explicit allow-list, TD01, TD24, TD25** (ordinary and deferred invoices); every other `TipoDocumento` is refused by default. Refused with a named reason: TD02, TD03 (advances), TD04 (credit note), TD05 (debit note), TD06 (fee note), TD16–TD23, TD26–TD29 (integrations, self-invoices, deposit extractions, San Marino, omitted invoicing), FSM10 simplified | TD16–TD23 and TD27–TD29 are the buyer's own fiscal documents, and TD26 (sale of depreciable goods and internal transfers, art. 36 DPR 633/72) is not a supplier purchase invoice; TD24 and TD25 sit inside the old TD16–TD29 range and are supported; credit notes and negative lines are already unsupported for PDFs (`phase1-closeout.md:144,155`); Allegato A p. 79–80 list |
| D-X5 | **p7m: unwrap only, no signature or certificate verification**; the screen says "File firmato (firma non verificata da Costì)". Verification is V3 (§3.4) | SdI accepts unsigned invoices and verifies signed ones itself (Allegato A §1.2.1 p. 11–12); verification would need trust lists, revocation and network calls for no gain against a forged upload (§3.4) |
| D-X6 | **XAdES-signed `.xml`**: the `ds:Signature` element is skipped, not verified | Same reasoning; it carries no invoice data |
| D-X7 | **Supplier by VAT**: `IdPaese` + `IdCodice` of `CedentePrestatore/DatiAnagrafici/IdFiscaleIVA`; an `IT` number must pass the check digit (else refused as invalid content). The existing `automap_invoice` links the active supplier with that VAT. Unknown → "Crea fornitore" prefilled with name and VAT (existing `review_set_supplier`); **no automatic supplier creation**. `CodiceFiscale` is read only for the buyer check, never stored | Reuse; master data stays a deliberate tap; data minimisation (a sole trader's codice fiscale is personal data) |
| D-X8 | **Buyer check**: when `tenant.vat_number` is set, the `CessionarioCommittente` VAT (or a codice fiscale equal to the VAT digits) must match, else refused `xml_not_addressed_to_tenant`; a supplier VAT equal to the tenant's is refused `xml_issued_by_tenant`. When the tenant VAT is not set, the import proceeds with the note `buyer_unchecked` | Catches a wrong file early; the tenant VAT may be unset until client facts are approved |
| D-X9 | **Duplicates**: (a) **exact file** = sha256 of the unwrapped XML bytes + body index among non-rejected invoices → refused `already_uploaded` (409, with the existing invoice id); a p7m and its extracted `.xml` are the same file. (b) **Same invoice, other file** (XML vs PDF/photo, either order, or two different XML files) = the existing key VAT + normalised number + date → status `duplicate` with `duplicate_of`, as today. (c) **Total**: the gross totals of the pair are compared (±0.05 €) and shown as "importi uguali / diversi"; the total never decides on its own | Reuses the M2–M5 duplicate rules and their race fixes; the total helps the owner decide |
| D-X10 | **"Usa il file XML al posto del PDF"**: new definer `review_replace_with_xml(p_xml, p_other)`: only when the XML invoice is `duplicate` of a non-XML invoice still in `review`; rejects the other (reason "Sostituita dal file XML") and moves the XML to `review`, one transaction. Against an **approved** PDF/photo: no replace; the XML is rejected and stays archived | The common real flow (photo at delivery, XML days later) in one tap; an approved invoice has posted stock and a payable and never changes |
| D-X11 | **Lines**: one `invoice_line` per `DettaglioLinee` with an amount or a quantity; `unit_price` = effective net price `PrezzoTotale ÷ Quantita` (4 decimals), the list price and discounts kept in `xml_details`; `Quantita` absent → qty 1; `vat_rate` = `AliquotaIVA`, `vat_nature` = `Natura`. Text-only lines (no quantity, `PrezzoTotale` 0) are **not imported** and counted in a note. A positive residual between `ImponibileImporto` and Σ `PrezzoTotale` of a rate becomes one line "Differenza dal riepilogo IVA <rate>%" | `PrezzoTotale` already includes `ScontoMaggiorazione` (00423, Allegato A p. 117), so the existing `amount_mismatch` check stays meaningful; descriptive DDT lines would otherwise each need a cost centre; `ImponibileImporto` = Σ `PrezzoTotale` + cassa + `Arrotondamento` (00422, p. 116) |
| D-X12 | **XML library: `saxes` 6.0.0** (ISC, 1 dependency `xmlchars`), wrapped in one file. It does not process DTDs (only the five predefined entities), is strict and streaming, so our depth/count/size limits stop a hostile file early. It is already in `package-lock.json` through `jsdom` (same integrity hash), so the shipped tree gains no new code. Caveat: no release since 6.0.0 (2021-11-07); the wrapper keeps a swap to the alternative to one file | §4 compares `fast-xml-parser` (active, but four 2026 DOCTYPE/entity DoS advisories) |
| D-X13 | **CMS/ASN.1: no library.** Our own bounded DER/BER reader (`src/server/fatturapa/cms.ts`) walks ContentInfo → SignedData → EncapsulatedContentInfo → eContent only; certificates and signer infos are skipped by length, never parsed. **No shelling out** (no `openssl` on the Vercel runtime is guaranteed; a child process per upload adds attack surface) | Unwrap needs ~150 lines; `node-forge` has 2025 ASN.1 advisories; `pkijs`/`asn1js` are the right tools only when verifying |
| D-X13b | **Original file stored as uploaded** (`.xml` as `application/xml`, `.p7m` as `application/pkcs7-mime`) at `<tenant>/<yyyy>/<invoice id>.<xml|p7m>`; the signed URL for these kinds forces a **download** (attachment), never inline rendering | A browser renders XML with processing instructions and namespaced XHTML; a download avoids any rendering on the Storage origin |
| D-X14 | **Totals**: `net_total` = Σ `ImponibileImporto`, `vat_total` = Σ `Imposta`, `gross_total` = `ImportoTotaleDocumento`, or net + VAT when absent. The existing totals gate decides; a mismatch (e.g. a document-level discount) is shown and blocks approval as today, and the owner corrects the header | No new gate; transparent; the payable stays gross − credits (`approve_invoice:326-332`) |
| D-X15 | **Notes instead of silent loss**: blocks Costì ignores are listed on the invoice (`xml_notes`): attachments, DDT/order references, text lines skipped, rounding line added, negative residual, document discount, stamp duty, instalments, buyer unchecked | The owner knows what the file held that is not in Costì |
| D-X16 | **No hard lock** on fiscal fields of an XML invoice: the existing review edits stay possible, recorded by `corrected_fields` / `header_corrected_fields` against the XML baseline, and the editor says "Dal file XML: cambialo solo se il fornitore ha sbagliato" (V4 = hard lock) | C19: "the same review rules as today"; avoids a dead end when the file itself is inconsistent |
| D-X17 | **H5 built**: the first `CodiceArticolo` (document order) → `invoice_line.supplier_code` (≤ 64), so the existing supplier article memory maps the line; all codes are kept in `xml_details.codes`. **H4 partly built**: every `AltriDatiGestionali` is shown on the line; "Usa come lotto" / "Usa come scadenza" copy a value through the existing line PATCH. Automatic per-supplier label mapping stays a hook (V5) | P2-2 §3.13.3: labels are not standardised; no real sample files yet (project Q1) |
| D-X18 | **VAT per rate**: each line carries `vat_rate` + `vat_nature`; the file's `DatiRiepilogo` rows are stored in the new append-only `invoice_vat_summary` (one row per rate/nature) and shown on the review screen. P2-5 reads it for XML invoices | The legal per-rate amounts can differ from line sums (rounding); typed rows are simpler for P2-5 than a jsonb blob |

### 3.2 Data model and migrations

Five migrations, numbered after `20261203100500`. No merged migration is edited. No ledger changes; no stored balance.

| File | Adds / changes | Notes |
|---|---|---|
| `supabase/migrations/20261204100000_xml_invoice_columns.sql` | **`invoice`**: `document_type text` check in (`TD01`,`TD24`,`TD25`); `xml_format text` check in (`FPR12`,`FPA12`); `xml_sha256 text` check `^[0-9a-f]{64}$`; `xml_body_index smallint`, `xml_body_count smallint` (1–10, index ≤ count); `xml_notes text[] not null default '{}'` check ⊆ (`attachments`,`ddt_refs`,`order_refs`,`text_lines_skipped`,`rounding_line_added`,`riepilogo_negative_residual`,`document_discount`,`stamp_duty`,`instalments`,`buyer_unchecked`,`vehicle_data`); `invoice_xml_meta_ck` (the five XML columns all null or all set); `invoice_xml_mime_ck` (`document_type is not null` ⇔ `file_mime in ('application/xml','application/pkcs7-mime')`); **replaced** `invoice_file_path_ck` (`\.(pdf|jpg|png|xml|p7m)$`) and `invoice_file_mime_ck` (+ `application/xml` ↔ `.xml`, `application/pkcs7-mime` ↔ `.p7m`); partial **unique** index `invoice_xml_file_uq on invoice (tenant_id, xml_sha256, xml_body_index) where xml_sha256 is not null and status <> 'rejected'`; trigger `invoice_xml_guard` (before update of the six XML columns → `invoice_immutable`). **`invoice_line`**: `vat_nature text` check in (`N1`,`N2.1`,`N2.2`,`N3.1`…`N3.6`,`N4`,`N5`,`N6.1`…`N6.9`,`N7`); `xml_details jsonb` check (`jsonb_typeof = 'object'` and `pg_column_size ≤ 16384`) | No grant widened (authenticated keeps the M2 column insert grant on `invoice`, which does not include the new columns). Existing rows satisfy the replaced checks |
| `…20261204100100_invoice_storage_xml.sql` | Bucket `invoices`: `allowed_mime_types` = `{application/pdf,image/jpeg,image/png,application/xml,application/pkcs7-mime}`, `file_size_limit` unchanged 4194304; policy `invoices_object_insert` dropped and re-created with name regex `\.(pdf|jpg|png|xml|p7m)$` (same tenant-folder and role conditions); select policy unchanged; still no update/delete policy | 10-year retention unchanged |
| `…20261204100200_invoice_vat_summary.sql` | **Table `invoice_vat_summary`**: `id`, `tenant_id` (not null, set by the definer), `invoice_id`, `position smallint ≥ 1`, `vat_rate numeric(5,2)` 0–100, `vat_nature text` (same list), check `(vat_rate = 0) = (vat_nature is not null)`, `taxable numeric(12,2) ≥ 0`, `tax numeric(12,2) ≥ 0`, `rounding numeric(12,2)` (signed, null), `accessory_costs numeric(12,2) ≥ 0` (null), `vat_chargeability text` in (`I`,`D`) (null), `legal_reference text` 1–100 (null), `created_at`, `created_by`; FK `(tenant_id, invoice_id)` → `invoice`; unique `(tenant_id, invoice_id, position)`; triggers `app.append_only()` / `app.append_only_truncate()` (pattern of `raw_lot`, `20261022140100_stock_ledger.sql:95-117`); RLS select owner/admin; grants: select to `authenticated`, `service_role`; no insert/update/delete for any API role. **`app.demo_purge_tables()`** replaced: `'invoice_vat_summary'` inserted between `'invoice_line'` and `'invoice'` (59 names) | New operational table joins the ADR-018 purge list in the same migration; ADR-040's tenant export (not built on `main`) must list it when built (noted in ADR-044) |
| `…20261204100300_import_xml_invoices.sql` | `app.xml_max_bodies()` = 10, `app.xml_max_lines()` = 200 (immutable, TS twins); `app.xml_buyer_state(p_tenant, p_buyer_vat, p_buyer_cf)` → `match`/`mismatch`/`unknown`; **`public.invoice_xml_precheck(p_sha256 text, p_supplier_vat text, p_buyer_vat text, p_buyer_cf text) returns jsonb`** (stable definer: `{alreadyUploaded:[{id,bodyIndex,status}], buyer, issuedByTenant}`); **`public.import_xml_invoices(p_payload jsonb) returns jsonb`** (definer, one transaction, §3.3.6) | Both: `app.require_invoice_reviewer()` first, empty `search_path`, tenant from `app.tenant_id()`, execute to `authenticated` only |
| `…20261204100400_replace_with_xml.sql` | **`public.review_replace_with_xml(p_xml uuid, p_other uuid) returns jsonb`** (definer; §3.5.3) | Calls `public.reject_invoice` and `app.automap_invoice` unchanged |

Invariant check:
- balances derived only from ledgers: nothing posts stock or prices except the unchanged `approve_invoice`;
- ledgers append-only: `invoice_vat_summary` append-only by trigger and grants; `invoice`/`invoice_line` keep their rules (no delete; the XML
  columns are immutable); the purge exception (ADR-018) covers the new table through the purge list only;
- procedures single transactions: `import_xml_invoices` (all bodies, lines, summaries, duplicate decision, automap, audit) and
  `review_replace_with_xml` (reject + move + automap + audit) are each one transaction;
- recipes and frozen costs: untouched; costs are frozen at approval as today;
- every table has `tenant_id` and RLS; roles enforced in Postgres (`require_invoice_reviewer`); waiters and chef never read invoices;
- every screen reads `/api/*` JSON (S14 builds the XML view server-side);
- the extraction model ID: XML never reaches the model; `EXTRACTION_MODEL_ID` untouched; `extraction_model` stays null for XML.

### 3.3 Parsing (deterministic, `src/server/fatturapa/`)

Files: `sniff.ts`, `cms.ts` (p7m), `decode.ts` (encoding), `xml.ts` (saxes wrapper, limits, element tree of allow-listed paths),
`schema.ts` (Zod 4, XSD patterns), `map.ts` (to the import payload), `rules.ts` (refusals), `decimal.ts` (string decimal maths, BigInt),
`labels.ts` (Italian labels for TD and Natura codes), `constants.ts` (limits with SQL twins), `errors.ts` (`FatturaError {code, reason, details}`).
Pure functions, no I/O, no clock.

#### 3.3.1 From bytes to XML text

1. **Kind** (S7): `xml` = optional UTF-8 BOM, ASCII whitespace, then `<?xml` or `<` + a name start character; `p7m` = DER (`0x30`, and the
   signedData OID bytes `06 09 2A 86 48 86 F7 0D 01 07 02` within the first 64 bytes) or base64/PEM text whose decoded head has that OID.
2. **p7m unwrap** (§3.4): up to 3 nested envelopes → the XML bytes.
3. **sha256** of the XML bytes (after unwrap, before decoding): the exact-file key.
4. **Encoding**: strip a UTF-8 BOM; a UTF-16/32 BOM → `xml_unreadable` (reason `encoding`). Read `encoding="…"` from the declaration: absent or
   `utf-8` → `TextDecoder('utf-8', {fatal: true})`; `iso-8859-1` / `windows-1252` → `TextDecoder('windows-1252')`; anything else, XML 1.1, or a
   decoding error → `xml_unreadable`. (The official XSD is declared `utf-8`, Allegato A p. 124; accepting Latin-1 is a tolerance, Q-X8.)
5. **DTD refusal before parsing**: the text contains `<!DOCTYPE` or `<!ENTITY` anywhere → `xml_unreadable` (reason `dtd`). FatturaPA never has a DTD.

#### 3.3.2 Reading (saxes wrapper `xml.ts`)

- Options: `xmlns: true`, strict well-formedness; handlers on `doctype` (abort, defence in depth), `opentag`, `closetag`, `text`, `cdata`,
  `error`; processing instructions (e.g. `xml-stylesheet`) and comments ignored; no handler fetches anything; the code has no I/O at all.
- **Limits** (constants with tests): depth ≤ 32; elements ≤ 200 000; attributes per element ≤ 32; text per node ≤ 10 000 characters except
  inside `Allegati` and `ds:Signature`, whose content is **counted, never kept**; input ≤ 4 MiB (upload limit). A limit hit → `xml_unreadable`
  (reason `limits`).
- **Namespaces**: root local name `FatturaElettronica` in `http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2` (any prefix) with
  attribute `versione` ∈ {`FPR12`,`FPA12`} (Allegato A p. 124–125); root `FatturaElettronicaSemplificata` in `…/fatture/v1.0` →
  `xml_simplified_unsupported`; anything else → `xml_not_fatturapa`. Children are matched by local name with an empty namespace (the XSD's
  unqualified children); the `http://www.w3.org/2000/09/xmldsig#` subtree is skipped; unknown elements are skipped (known optional blocks
  set a note, D-X15). XInclude elements are just unknown elements: never processed.
- **No prototype pollution**: only allow-listed paths are copied, into objects created with `Object.create(null)`; Zod strict parse follows.

#### 3.3.3 Validation (`schema.ts`, from the XSD in Allegato A Appendix 2, p. 124–151)

`Amount2DecimalType` `-?[0-9]{1,11}\.[0-9]{2}`; `Amount8DecimalType` `-?[0-9]{1,11}\.[0-9]{2,8}`; `QuantitaType` `[0-9]{1,12}\.[0-9]{2,8}`;
`RateType` `[0-9]{1,3}\.[0-9]{2}` ≤ 100.00; dates `YYYY-MM-DD` ≥ 1970-01-01; `Numero` ≤ 20 characters with at least one digit (00425);
`Descrizione` ≤ 1000; `CodiceTipo`/`CodiceValore` ≤ 35; `TipoDato` ≤ 10, `RiferimentoTesto` ≤ 60; `UnitaMisura` ≤ 10; `NumeroLinea` 1–9999;
`IdCodice` 1–28; `Natura` in the list of p. 83–84; `Natura` present ⇔ `AliquotaIVA` 0.00 on lines and summaries (00400/00401/00429/00430);
every line rate/nature present in `DatiRiepilogo` (00443/00444). Failures → `xml_invalid_content` with details `{body, line?, field}`.

#### 3.3.4 Rules (`rules.ts`; per body; all-or-nothing; at most 5 details)

| Condition | Code (HTTP 422 unless noted) | Reason key |
|---|---|---|
| `TipoDocumento` not TD01/TD24/TD25 | `xml_document_type_unsupported` | the TD code and its label (p. 79–80) |
| `Divisa` ≠ `EUR` | `xml_content_unsupported` | `currency` |
| `DatiRitenuta`, `DatiCassaPrevidenziale` or a line `Ritenuta` = `SI` | `xml_content_unsupported` | `withholding` |
| `EsigibilitaIVA` = `S` | `xml_content_unsupported` | `split_payment` |
| a negative `PrezzoTotale` or `PrezzoUnitario`, or a negative `ImportoTotaleDocumento` | `xml_content_unsupported` | `negative_line` (line number) / `negative_total` |
| more than 200 imported lines in a body; more than 10 bodies | `xml_content_unsupported` | `too_many_lines` / `too_many_bodies` |
| a line or total beyond the column ranges (line ≤ 10 000 000 €, qty < 100 000 000, totals ≤ 10 000 000 €, `invoice_totals_ck`) | `xml_content_unsupported` | `amount_out_of_range` |
| supplier `IT` VAT failing the check digit; foreign VAT not `^[A-Z]{2}[0-9A-Z]{2,12}$`; mandatory field missing | `xml_invalid_content` | field path |

#### 3.3.5 Mapping (per body → one invoice)

- **Header:** `supplier_vat` = `IdPaese`+`IdCodice` upper case; `supplier_name` = `Denominazione`, else `Nome` + " " + `Cognome` (cleaned with
  `clean`, ≤ 200); `number_raw` = `Numero`; `invoice_date` = `Data`; `due_date` = earliest `DataScadenzaPagamento`, else
  `DataRiferimentoTerminiPagamento` + `GiorniTerminiPagamento`, else null (the existing supplier-terms fallback and `due_date_required` blocker
  apply); `payment_terms` null; `net_total`, `vat_total`, `gross_total` per D-X14; `document_type`, `xml_format`, body index/count, notes.
  Not stored: IBAN, addresses, contacts, codice fiscale, `Causale`, `Allegati`.
- **Lines** (document order = `position`): skip text-only lines (no `Quantita` and `PrezzoTotale` = 0) and count them (`text_lines_skipped`);
  `raw_description` = `Descrizione` cleaned, cut to 500 code points; `supplier_code` = first `CodiceArticolo/CodiceValore` cleaned (≤ 64) or
  null; `qty` = `Quantita` (4 decimals, half away from zero) or 1; `unit_raw` = `UnitaMisura`; `line_amount` = `PrezzoTotale` (4 decimals);
  `unit_price` = `line_amount ÷ qty` (4 decimals) when qty > 0, else `PrezzoUnitario`; `vat_rate`, `vat_nature`; `lot_code`, `expiry` null;
  `checks` = `app.line_checks(...)`; `field_confidence` `{}`; `extracted` = the same values as the correction baseline;
  `xml_details` = `{lineNumber, kind (SC|PR|AB|AC|null), codes:[{type,value}], otherData:[{type,text,number,date}], discounts:[{type,percent,amount}],
  listUnitPrice, periodStart, periodEnd}`.
- **Residual per rate** (D-X11): r = `ImponibileImporto` − Σ `PrezzoTotale` of that rate/nature. r > 0.005 → a line "Differenza dal riepilogo IVA
  22%" (`kind: "residual"`, note `rounding_line_added`); r < −0.005 → no line, note `riepilogo_negative_residual` (the gate decides).
- **VAT summary rows:** one per `DatiRiepilogo` in order.
- **Payload** (amounts as decimal strings, never floats): `{sha256, format, bodyCount, buyer:{vat,cf}, invoices:[{id, filePath, fileMime,
  fileSizeBytes, originalFilename, bodyIndex, documentType, notes, header:{…}, lines:[…], vatSummary:[…]}]}`. Zod schema `XmlImportPayload`
  mirrors the SQL checks (parity test).

#### 3.3.6 `import_xml_invoices` (one transaction)

1. `app.require_invoice_reviewer()`; tenant = `app.tenant_id()`; strict payload shape (unknown key → `invalid_request`); amounts match
   `^[0-9]{1,8}(\.[0-9]{1,4})?$` (summary `rounding` may carry a leading `-`); counts ≤ `app.xml_max_bodies()` / `app.xml_max_lines()`;
   `documentType` in the list.
2. Buyer and issuer rules (D-X8) again (authoritative; the precheck is only for early refusal).
3. Per body: `file_path` = `<tenant>/<yyyy>/<id>.(xml|p7m)` matching `fileMime`; a `storage.objects` row exists in `invoices` with that name and
   the same size and MIME (else `file_missing`); insert-time conflict on `invoice_xml_file_uq` → `already_uploaded` (DETAIL = existing id).
4. Duplicate decision exactly as `extraction_complete`: `app.invoice_dup_lock_key` → `pg_advisory_xact_lock` → `app.find_duplicate_invoice_in`
   → status `duplicate` (with `duplicate_of`) or `review`.
5. Insert `invoice` (status as decided, `extracted_at` null, `created_by` = `app.app_user_id()`), its lines, its summary rows;
   `app.refresh_gate`; `app.automap_invoice` (VAT link, unit parse, code/description mapping); audit `invoice.imported_xml`
   `{documentType, bodyIndex, bodyCount, status}`.
6. Return `[{id, bodyIndex, status, duplicateOf}]`.

### 3.4 p7m (CAdES) signature: unwrap or verify — recommendation: **unwrap only** (D-X5)

**Facts (official):**
- SdI handles invoices **with and without** an electronic signature; when signed, SdI checks the qualified certificate against AgID's public
  list and the formats **CAdES Baseline B** (`.xml.p7m`) and **XAdES Baseline B** (enveloped, `.xml`), plus CAdES with a certificate issued by
  the Agenzia delle Entrate itself, which "non è una Certification Authority qualificata" and can be verified only with the AdE service
  (Allegato A v1.9.1 §1.2.1, p. 11–12). The signing-time attribute must be present and not later than receipt; a failed check discards the
  file with codes 00100 (certificate expired), 00101 (revoked), 00103 (no time reference), 00104 (CA not trusted), 00105 (time reference
  incoherent), 00107 (certificate not valid) (p. 12, footnote 1). File names end in `.xml` or `.xml.p7m` (§1.2.2, p. 13).
- AgID publishes the Italian trusted list at `https://eidas.agid.gov.it/TL/TSL-IT.xml`; its signing certificates change (two new keys usable
  from 10 February 2026), and integrators must add them (AgID notice of 21/01/2026).

**Why unwrap only:**
1. Unsigned FatturaPA files are equally valid for private buyers, so a verification step cannot tell a genuine upload from a forged one
   (a forger simply uploads unsigned XML). It adds no protection against the realistic risk.
2. Every file the venue receives through SdI has already passed SdI's signature check; the fiscal truth is the SdI delivery, not our check.
3. Real verification would need: the AgID TSL (signed XML, verified with AgID's rotating seal certificates) and the EU list of trusted lists
   for other member states' providers; certificate chain building; **revocation status at signing time** via OCSP or CRL (network calls to
   each CA, and historical status once a certificate has expired); CAdES-B attribute checks (signing time, signing-certificate attribute);
   and, for AdE-issued certificates, the AdE verification service. That is outbound network traffic from the upload request, a crypto library,
   trust-anchor maintenance, and new failure modes, against the "no new external provider" rule.
4. Costì's copy is operational, not legal preservation (Q-X1).

**What we do:** parse ContentInfo (`1.2.840.113549.1.7.2` signedData) → SignedData → EncapsulatedContentInfo (`eContentType`
`1.2.840.113549.1.7.1` id-data) → `eContent` (OCTET STRING, possibly constructed/chunked under BER); detached signature (no eContent) →
`p7m_unreadable` (reason `detached`); nested envelopes (CAdES parallel/countersignatures produce `.p7m.p7m`) up to 3 levels; certificates and
signer infos skipped by length. **DER/BER reader limits:** definite lengths ≤ 4 bytes and within the remaining input; indefinite length only on
constructed types, closed by end-of-contents; depth ≤ 16; ≤ 10 000 TLVs visited; concatenated content ≤ input size; base64 input validated
against the alphabet (optional PEM armour) and decoded once. The screen shows "File firmato (firma non verificata da Costì)".
Structure per RFC 5652 (CMS) §3 and §5.

**What would make us verify:** a legal adviser or the commercialista requiring verified signatures on Costì's copy, or SaaS intake through
an intermediary that hands over verification results (trigger of V3).

### 3.5 Supplier matching and duplicates

#### 3.5.1 Supplier

| Case | What happens |
|---|---|
| Active supplier with the file's VAT | Linked automatically (`automap_invoice`); lines mapped from its article memory |
| No supplier with that VAT | `supplier_id` null; review shows "Fornitore nuovo" with name and VAT from the file and "Crea fornitore" (prefilled, `review_set_supplier` with `{name, vat_number}`); or "Collega a un fornitore esistente". Approval stays blocked by `supplier_required` until then (existing) |
| Supplier exists but inactive | Not linked (existing rule); creating a new one fails the per-tenant VAT unique key: the error tells the owner to re-activate it in Fornitori (existing 409 `duplicate_vat_number`) |
| Foreign supplier VAT (`IdPaese` ≠ IT) | Stored on the invoice; `supplier.vat_number` accepts only valid IT numbers, so "Crea fornitore" creates it without a VAT (existing behaviour for PDFs) |
| Supplier VAT = venue VAT | Refused `xml_issued_by_tenant` (before storage) |
| Buyer is another business (tenant VAT set) | Refused `xml_not_addressed_to_tenant` (before storage) |

#### 3.5.2 Duplicates (key = supplier VAT + normalised number + date; total compared, never deciding)

| First | Then | Outcome | What the owner does |
|---|---|---|---|
| XML file F | F again (or the p7m of F after its `.xml`, or the reverse) | **Refused 409 `already_uploaded`**, nothing stored; link to the first invoice. If the first was rejected, the upload is allowed again | Open the first |
| XML A (any live status) | another XML B with the same key (re-generated file) | B is `duplicate` of A | Reject B (existing) |
| PDF/photo P in `review` | XML X | X is `duplicate` of P; banner with amount comparison; **"Usa il file XML al posto del PDF"** → P rejected ("Sostituita dal file XML"), X to `review` (D-X10) | One tap |
| PDF/photo P `received`/`extracting` (no key yet) | XML X | X in `review`; when P's extraction completes it becomes `duplicate` of X (existing `extraction_complete`) | Reject P |
| PDF/photo P `approved` | XML X | X is `duplicate` of P; banner "Già approvata dal PDF/foto il …", amount comparison; **no replace** | Reject X (the file stays archived) |
| XML X (any live status) | PDF/photo P | P is extracted by AI (as today), then `duplicate` of X; banner "Esiste già il file XML di questa fattura" | Reject P |
| PDF/photo read without VAT (name-only) | XML X | No VAT match until P is linked to a supplier with a VAT (that link sets P's VAT and re-checks, `review_set_supplier:417-426`) | Residual risk, §6 |
| Any | "Non è un doppione" | Existing per-pair declaration (`review_clear_duplicate`), unchanged | — |

Amount comparison: `|gross_this − gross_partner| ≤ 0.05 €` → "Importi uguali", else "Importi diversi: 1.234,50 € qui, 1.230,00 € nell'altra".

#### 3.5.3 `review_replace_with_xml(p_xml, p_other)`

`require_invoice_reviewer()`; lock both invoices `for no key update` in id order; both in the caller's tenant (else `not_found`); refuse with
`replace_not_allowed` (P0001) unless: `p_xml` has `document_type` and status `duplicate`; `p_other` has no `document_type` and status `review`;
`app.is_undeclared_look_alike(p_xml, p_other)`. Then `public.reject_invoice(p_other, 'Sostituita dal file XML')`; recompute
`app.undeclared_look_alike(p_xml)`: null → status `review`, `duplicate_of` null; another live look-alike → stays `duplicate` pointing at it;
`app.automap_invoice(p_xml)`; audit `invoice.replaced_by_xml {other}`. A second call finds `p_other` rejected → `replace_not_allowed`
(nothing written twice). Mapping done on the photo copy is not copied line by line; the supplier memory it created applies when code or
description match.

### 3.6 P2-2 lot/origin hooks in P2-7

| Hook | P2-7 | Detail |
|---|---|---|
| **H5** `CodiceArticolo` → `supplier_item` | **Built** (D-X17) | First code → `supplier_code`; `automap_lines` already matches code first (`20261022131000:82-85`); reviewer mapping creates code-keyed memory (`20261022130900:237-243,274`) |
| **H4** `AltriDatiGestionali` / `CodiceArticolo` → `lot_code`, `expiry` | **Partly built**: shown + one-tap copy | `xml_details.otherData` in the review reply; "Usa come lotto" sends `PATCH /api/invoices/:id/lines/:lineId {lotCode}` (≤ 64), "Usa come scadenza" `{expiry}` for a `RiferimentoData`; P2-2's "Lotto mancante" chip then disappears. Automatic mapping per supplier label is a hook (trigger of V5) |
| H1–H3, H6, H7 (origin) | Not touched | Producer-network plan |

No structured lot, expiry, origin, producer or designation field exists in `DettaglioLinee` (re-checked in Allegato A v1.9.1 §2.2.10.1,
p. 92–94: `CodiceArticolo` 0..N, `AltriDatiGestionali` with `TipoDato` ≤ 10 / `RiferimentoTesto` ≤ 60 / `RiferimentoNumero` / `RiferimentoData`).

### 3.7 API routes (`withApi`, Zod 4, `Cache-Control: no-store`)

| Route | Roles | Input (Zod) | Reply | Errors |
|---|---|---|---|---|
| `POST /api/invoices` (changed) | owner, admin (403 before any work otherwise) | multipart, exactly one part `file` (existing `readUploadedFile`); content sniffed | PDF/photo: **202** `{invoice}` (unchanged). XML/p7m: **201** `{invoice, invoices: [{id, status, bodyIndex, bodyCount, number, invoiceDate, supplierName, grossTotal, duplicateOf}]}`, `location` of the first | 400, 401, 403, 413, 415 (existing); 422 `xml_unreadable`, `xml_not_fatturapa`, `xml_simplified_unsupported`, `p7m_unreadable`, `xml_document_type_unsupported` (`details:[{body, code, label}]`), `xml_content_unsupported` (`details:[{body, line?, reason}]`), `xml_invalid_content` (`details:[{body, line?, field}]`), `xml_not_addressed_to_tenant`, `xml_issued_by_tenant`; 409 `already_uploaded` (`details:{invoiceId}`); 429; 502 Storage |
| `GET /api/invoices/[id]/file-url` (changed) | owner, admin | `id` `z.uuid()` | `{url, expiresAt, disposition: "inline" | "attachment"}`; XML/p7m URLs are created with `download: <sanitised original name or "fattura.xml">` | 404, 502 |
| `GET /api/invoices/[id]/review` (changed reply) | owner, admin | as today | + `invoice.xml: {format, documentType, documentTypeLabel, signed, bodyIndex, bodyCount, notes[]} | null`; `vatSummary: [{rate, nature, natureLabel, taxable, tax}]`; `lines[].xml: {lineNumber, kind, codes[], otherData[], discounts[], listUnitPrice} | null`; `duplicatePartner` + `grossTotal`, `format: "xml" | "document"`, `status`, `amountsMatch`; `replaceWithXml: {partnerId} | null` | as today |
| `POST /api/invoices/[id]/use-xml` (new) | owner, admin | `params: {id: z.uuid()}`; body `z.strictObject({ replaces: z.uuid() })` | 200 `{status: "review" | "duplicate"}` | 400 (0 RPCs), 404 `not_found`, 409 `replace_not_allowed`, 401, 403 |
| `PATCH /api/invoices/[id]/lines/[lineId]` | unchanged | used by "Usa come lotto/scadenza" | unchanged | unchanged |

- Files: `src/server/fatturapa/*` (§3.3); `src/server/invoices/xml-upload.ts` (orchestration), `xml-view.ts` (labels, notes, comparison);
  changes in `invoices.ts`, `file-check.ts`, `constants.ts`, `review.ts`, `review-types.ts`, `review-actions.ts`, `review-errors.ts`
  (P0001 codes → HTTP), `src/lib/api/errors.ts` (new `ErrorCode`s: `xml_unreadable`, `xml_not_fatturapa`, `xml_simplified_unsupported`,
  `p7m_unreadable`, `xml_document_type_unsupported`, `xml_content_unsupported`, `xml_invalid_content`, `xml_not_addressed_to_tenant`,
  `xml_issued_by_tenant`, `already_uploaded`, `replace_not_allowed`, `file_missing`); route `src/app/api/invoices/[id]/use-xml/route.ts`.
- Error mapping: P0002 → 404; 42501 → 403; listed P0001 codes → 409/422 as above; anything else → 500 reported by code only.

### 3.8 Screens (Italian first, all strings "da approvare"; 360 px first; targets ≥ 44 px; amounts `1.234,50 €`; dates Europe/Rome; every value from `/api/*`)

Roles: only **owner and admin** reach `/fatture` (nav and routes as today). **Chef and waiter** have no entry and get 403 on every route here;
after approval the chef sees lots in Magazzino and Tracciabilità without prices, as today.

**A. Upload card on `/fatture`** (`upload-form.tsx`)
- Title "Carica una fattura". Field "Scatta una foto" unchanged. Field "Scegli un file", hint: "PDF, JPEG, PNG o fattura elettronica (.xml
  o .xml.p7m), massimo 4 MB." The picker accepts `.xml,.p7m,application/xml,text/xml,application/pkcs7-mime` in addition.
- File picked: name + chip "Fattura elettronica" (by extension, cosmetic only). Button "Carica".
- Busy: "Caricamento e lettura del file…".
- **Success, one invoice:** "Fattura FT 12 del 3 nov 1998 · Fornitore Demo 1 · 1.234,50 € letta dal file XML. Controllala e approvala." +
  button "Controlla ora" → `/fatture/<id>/revisione`.
- **Success, several invoices:** "Il file conteneva 3 fatture, tutte lette:" then one row each: "FT 12 del 3 nov · 1.234,50 € · Da
  controllare" (link), a duplicate row "FT 13 del 3 nov · Sembra già caricata" (link).
- **Success but duplicate:** "Fattura letta, ma sembra già caricata (FT 12 del 3 nov, da foto). Aprila per decidere." + "Apri".
- **Errors** (alert, `aria-live`), each with the action in the text:
  - bad type (415): "Formato non supportato: servono PDF, JPEG, PNG o fattura elettronica XML/P7M."
  - too large (413) on an XML/p7m: "Il file supera 4 MB. Succede quando contiene un PDF allegato: scarica dal portale la fattura senza
    allegati, oppure carica il PDF."
  - `xml_unreadable`: "Il file XML è danneggiato o non leggibile. Scaricalo di nuovo e riprova."
  - `xml_not_fatturapa`: "Questo file XML non è una fattura elettronica."
  - `p7m_unreadable` (signature envelope unreadable): "Non riesco ad aprire il file firmato (.p7m). Prova a caricare la versione .xml della
    stessa fattura."
  - `xml_simplified_unsupported`: "È una fattura semplificata: non ancora gestita. Carica il PDF o una foto."
  - `xml_document_type_unsupported`: TD04 "È una nota di credito (TD04): Costì non la registra ancora. Passala al commercialista."; other
    types "Tipo di documento non gestito: {etichetta} ({codice}). Passalo al commercialista."
  - `xml_content_unsupported`: withholding "Fattura con ritenuta d'acconto o cassa previdenziale: non ancora gestita."; currency "Fattura
    in una valuta diversa dall'euro: non gestita."; negative line "La riga {n} ha un importo negativo (sconto o reso su una riga a parte):
    non ancora gestito."; split payment "Scissione dei pagamenti: riguarda solo la Pubblica Amministrazione."; too many lines "La fattura ha
    più di 200 righe."; too many bodies "Il file contiene più di 10 fatture: chiedi file separati."
  - `xml_invalid_content`: "Nel file mancano dati obbligatori o sono scritti male." + up to 5 rows "Fattura 1, riga 3: aliquota IVA
    mancante" / "Partita IVA del fornitore non valida".
  - `xml_not_addressed_to_tenant`: "Questa fattura è intestata a un'altra partita IVA, non al locale."
  - `xml_issued_by_tenant`: "Questa fattura è emessa dal locale, non da un fornitore."
  - `already_uploaded`: "Questo file è già stato caricato." + link "Apri la fattura".
  - 429 and network errors: existing texts.

**B. Invoice list `/fatture`:** each row gains a chip "XML" or "XML firmato" (from `fileMime`) next to the status badge. Filters unchanged.

**C. Review `/fatture/[id]/revisione`** (existing page; phone layout one column, laptop two columns as today)
- **Header card:** chip "Fattura elettronica · Fattura (TD01)"; when `bodyCount` > 1 "Fattura 2 di 3 nello stesso file"; for p7m "File
  firmato (firma non verificata da Costì)".
- **Document panel (XML branch, no iframe):** card "Dati dal file XML": supplier name and "P.IVA IT…", "Numero FT 12 · Data 3 nov 1998 ·
  Scadenza 3 dic 1998", "Riepilogo IVA" as stacked rows on phone ("22% — imponibile 100,00 € · IVA 22,00 €", "Esente (N4) — imponibile
  10,00 €"), "Totale documento 132,00 €"; button "Scarica il file originale" (downloads, never opens inline). On phone the card is
  collapsible ("Dati dal file XML ▾"), open by default.
- **Notes card "Nel file c'è anche"** (only when notes exist, the "partial parse" state): "1 allegato (non importato)", "Riferimenti a DDT
  o ordini (non importati)", "3 righe descrittive senza importo (non importate)", "Arrotondamento di 0,40 € aggiunto come riga", "Sconto sul
  totale documento: controlla il totale", "Pagamento a rate: scadenza della prima rata", "Partita IVA del locale non impostata: intestatario
  non controllato".
- **Lines:** chip "Dal file XML"; "Cod. EAN 8000000000001" (the first code, with the hint "usato per riconoscere l'articolo"); discounts
  "Prezzo 10,00 € − sconto 10%"; kind "Spesa accessoria" for AC; residual line labelled "Differenza dal riepilogo IVA 22%". Other data chips:
  "LOTTO: L-DEMO-0001" with button **"Usa come lotto"**; "SCADENZA: 1 dic 1998" with **"Usa come scadenza"**; after the tap the line shows
  the lot and P2-2's "Lotto mancante" chip disappears. The line editor shows under Quantità/Prezzo/Importo/IVA: "Dal file XML: cambialo solo
  se il fornitore ha sbagliato."
- **Supplier panel, unknown supplier:** "Fornitore nuovo: Fornitore Demo 3 · P.IVA IT12345678903" with **"Crea fornitore"** (sheet prefilled
  with name and VAT, optional "Giorni di pagamento") and "Scegli un fornitore esistente".
- **Duplicate banners** (replacing the generic one when the partner is known):
  1. XML duplicate of a photo/PDF in review: "Questa fattura è già presente da foto/PDF (FT 12 del 3 nov, da controllare). Importi uguali."
     Buttons: **"Usa il file XML al posto del PDF"** (primary), "Non è un doppione", "Rifiuta questo file". Sheet: title "Usare il file
     XML?", text "La copia da foto/PDF verrà rifiutata e resterà in archivio. Gli abbinamenti già memorizzati per il fornitore vengono
     riapplicati alle righe del file XML quando codice o descrizione coincidono." Buttons "Usa il file XML" / "Annulla". A 409 reloads the
     page with "La situazione è cambiata: ricarico la fattura."
  2. XML duplicate of an approved photo/PDF: "Già approvata da foto/PDF il 12 nov 1998. Importi diversi: 1.234,50 € qui, 1.230,00 €
     approvati." Button "Rifiuta questo file (resta in archivio)".
  3. Photo/PDF duplicate of an XML: "Esiste già il file XML di questa fattura. Rifiuta questa copia." Button "Rifiuta".
  4. XML duplicate of another XML: "Doppione di un altro file XML (FT 12 del 3 nov)." Buttons "Non è un doppione", "Rifiuta".
- **Approval panel:** unchanged (payable from the file's total, blockers as today).

### 3.9 RLS / role matrix

Owner and admin rows assume the P2-1 gate is satisfied; a gated owner/admin at `aal1` gets null from `app.role()`, so every definer below
raises 42501 and RLS returns 0 rows. The DigiAlto platform account holds `admin` in a tenant (ADR-037) and is the admin column.

| Object | owner | admin | chef | waiter | Enforcement |
|---|---|---|---|---|---|
| `invoice` new columns, `invoice_line` new columns | read | read | 0 rows | 0 rows | existing RLS (`20261022100000:106-111`, `20261022120000:86-88`); no new grant |
| `invoice_vat_summary` | read | read | 0 rows | 0 rows | RLS select owner/admin; no write grant for any API role; append-only triggers |
| Storage `invoices` objects `.xml`/`.p7m` | read, insert own folder | same | none | none | re-created insert policy; select policy unchanged; no update/delete policy |
| `invoice_xml_precheck`, `import_xml_invoices`, `review_replace_with_xml` | ✓ | ✓ | 42501 | 42501 | `app.require_invoice_reviewer()` first; definer, `search_path = ''`; execute to `authenticated` only (not `anon`, not `service_role`) |
| Routes `POST /api/invoices`, `file-url`, `review`, `use-xml` | ✓ | ✓ | 403 | 403 | `withApi` roles, before any RPC; Postgres repeats the check |
| Another tenant's invoice id or object path | 404 / refused | same | — | — | ids looked up with `tenant_id = app.tenant_id()`; path must start with the caller's tenant |

### 3.10 Security and privacy

- **XML hardening:** DTD/`ENTITY` refused before parsing; saxes processes no DTD and only the five predefined entities, so no external
  entity, no parameter entity, no billion-laughs expansion; no XInclude processing; no I/O in the parser; depth 32, 200 000 elements, 32
  attributes, 10 000 characters per kept text node; UTF-8 strict (Latin-1 tolerated); namespaces checked on the root and `versione` on
  `FPR12`/`FPA12`; strict Zod after mapping; prototype-safe objects.
- **p7m safety:** own DER/BER reader with depth, length, TLV-count and size limits; base64 validated; no `openssl`, no child process, no temp
  files; certificates and signatures never parsed (smaller surface).
- **Upload limits:** 4 MiB per file (existing route and bucket limit), Content-Length and Origin checks (existing `withApi`), 60 invoices per
  hour per tenant counting bodies, magic bytes decide the kind; the declared MIME must be in the kind's allow-list (`xml`: `application/xml`,
  `text/xml`, `application/octet-stream`, empty; `p7m`: `application/pkcs7-mime`, `application/x-pkcs7-mime`, `application/octet-stream`,
  empty: phones and Windows send these) and the extension must be `xml` or `p7m`.
- **Storage:** private bucket `invoices`, path `<tenant>/<yyyy>/<invoice id>.<xml|p7m>` (never the user's file name), Storage RLS owner/admin
  in the own folder, no update/delete for any role, stored content type canonical; signed URLs 300 s with attachment disposition for XML/p7m;
  the URL is a bearer link, never logged. Included in the encrypted daily backup (ADR-034, extension-agnostic listing) and in the demo purge.
- **Trust of the import payload:** the import RPC is callable by an owner/admin with any payload, as every review procedure is. Mitigations:
  strict shape and range checks in SQL, the Storage object must exist with the same size and type, `document_type` restricted, XML columns
  immutable after insert, audit event per import. Owner/admin can already edit every invoice field, so no privilege is gained.
- **Output:** all file text rendered by React (escaped); descriptions cleaned of control and bidirectional characters (`clean`,
  `CONTROL_OR_BIDI`); no `dangerouslySetInnerHTML`; the XML is never rendered as HTML; no new CSP origin (ADR-028).
- **Personal data (GDPR):** FatturaPA files contain personal data of sole-trader suppliers (name, codice fiscale, address, IBAN, contacts) and
  of the venue. The original file is stored exactly like a PDF today (same bucket, same 10-year retention, same backups, already in the
  DPA-1 scope). Extracted columns keep only what the feature needs: supplier name and VAT, invoice data; **not** codice fiscale, IBAN,
  addresses, contacts, signer identity. No new processor. **Logs:** error codes, invoice ids, counts and timings only, never file content, VAT
  numbers, names, numbers or amounts (`reportError` spy tests).
- **Secrets:** none new. Application secrets stay in Vercel environment variables, database secrets in Supabase Vault, the backup passphrase
  in the GitHub environments and the founder's password manager (ADR-034), account logins in the owners' password manager. The upload route
  uses the user's session only; the Supabase secret key stays in `scripts/` and `src/server/staff-auth/privileged.ts`
  (`tests/guards/admin-client-importers.test.ts`, `privileged-importers.test.ts` unchanged). No provider, no API key.
- **Dependency audit:** `saxes` 6.0.0 and `xmlchars` 2.2.0 are already in the lockfile; `npm audit` must stay clean (S9).

### 3.11 Performance (phone on 4G)

- One request: parse in memory (≤ 4 MiB bytes, decoded string ≤ ~8 MiB), ≤ 10 Storage uploads (one per body, usually 1), 2 RPCs. No model
  call, no background wait, so the success message and the review link come in the upload reply; no polling for XML invoices.
- SQL: the import uses the existing duplicate index `invoice_dedup_idx`, the new partial unique index for the exact-file check, and the
  existing automap paths; one advisory lock per body key.
- Bounds, not promises: the S9/S10 Vitest suites parse a 4 MiB 200-line file and every hostile fixture within the default Vitest timeout on
  CI; pgTAP 363 imports a 10-body, 200-lines-per-body payload under `statement_timeout = '5s'`. The `perf-4g` Playwright project records the
  upload timing as information only.
- Review screen: the XML summary is part of the existing review reply (one extra indexed read of `invoice_vat_summary`).

### 3.12 Sequences

1. **Single XML:** `/fatture` → pick file → `POST /api/invoices` → sniff `xml` → parse/map/rules → `rpc invoice_xml_precheck` → Storage upload
   `<t>/<yyyy>/<id>.xml` → `rpc import_xml_invoices` → 201 → "Controlla ora" → `GET /api/invoices/:id/review` → map, lot → `POST …/approve`
   (unchanged).
2. **p7m with 3 bodies:** as 1, after `cms.unwrap`; 3 ids, 3 uploads of the same bytes as `.p7m`, one import RPC creating 3 invoices.
3. **Photo first, XML later:** photo → AI → `review`; XML → import → `duplicate` of the photo → banner → `POST /api/invoices/:xml/use-xml
   {replaces: photo}` → `review_replace_with_xml` → XML in `review`.
4. **XML first, PDF later:** PDF → AI → `extraction_complete` → `duplicate` of the XML → banner 3 → "Rifiuta".
5. **Same file twice:** second upload → precheck `alreadyUploaded` → 409 before any upload.

## 4. Alternatives considered

- **Parse XML in the extraction worker (status `received`, cron):** reuses the queue, but a bad file becomes a permanent row (no delete; an
  `extraction_failed` row cannot be rejected), feedback waits for the next cron minute, and the worker uses the secret key for a job that
  needs none. Rejected (D-X1).
- **Send the XML to the model as text:** contradicts the founder decision (no AI for XML), costs tokens and reintroduces misreads. Rejected.
- **`fast-xml-parser` 5.x (MIT, active, 5.12.1 latest):** builds the whole tree, has six runtime dependencies, processes DOCTYPE entities by
  default, and had four DoS advisories in 2026 in that area (CVE-2026-26278, CVE-2026-33036, CVE-2026-33349, CVE-2026-73569). Usable with
  `processEntities: false` and our DOCTYPE pre-refusal; kept as the fallback if `saxes` must be replaced (Q-X16). Not the default.
- **`@xmldom/xmldom` / `libxmljs2`:** a DOM with a history of parsing advisories / native bindings unsuitable for Vercel functions. Rejected.
- **Our own XML parser:** XML well-formedness is far larger than DER; rejected (unlike the DER reader).
- **`node-forge` for p7m:** dual BSD/GPL licence, ASN.1 advisories in November 2025 (CVE-2025-12816 validator desynchronisation,
  CVE-2025-66031 unbounded recursion). Rejected.
- **`pkijs` 4.0.1 + `asn1js` 4.0.0 (BSD-3-Clause, PeculiarVentures):** the right tools to verify CMS signatures; for unwrap only they add a
  large surface we would not use. Rejected for P2-7 (V3 would add them).
- **`openssl cms -verify -noverify` in a child process:** no guaranteed binary on the runtime, process and temp-file handling per request.
  Rejected.
- **Verify p7m signatures now:** §3.4. Rejected for P2-7.
- **Store the VAT summary as jsonb on `invoice`:** no new table, but P2-5 sums per rate across invoices in SQL; typed rows with checks are
  simpler to query and test. Rejected.
- **One invoice for a whole multi-body file, or refuse multi-body files:** wrong fiscally (each body is an invoice) / blocks legitimate
  files. Rejected in favour of one invoice per body with a file copy each (the `invoice_file_path_uq` constraint and every reader assume one
  object per invoice; a shared-file table would touch the worker, signed URLs, purge and backup checks).
- **Automatic supplier creation from the file:** creates master data without a decision and collides with inactive suppliers. Rejected (D-X7).
- **Hard lock of fiscal fields:** the default keeps today's review rules (C19, D-X16). Rejected for the default.
- **Lot parsing from `Descrizione`:** free text, not deterministic. Rejected (P2-2 §4).
- **New dependency for decimal maths:** `BigInt` string arithmetic in `decimal.ts` (~40 lines). No library.

## 5. Build plan (test first: each step's named test is written and seen failing, then the code; one commit per step)

### Shared lists changed on purpose

| List | Change | Step |
|---|---|---|
| `tests/config/p2-7-preserves.test.ts` **new** | the `20261204*` files in step order; created tables: `invoice_vat_summary` only; altered tables: `invoice`, `invoice_line`; replaced functions: `app.demo_purge_tables` only; new functions of §3.2 | S1 (grown each step) |
| `tests/config/{…}-preserves.test.ts` (`AFTER_MAIN` / allowed-migration lists, including `p2-2-preserves.test.ts`) | `20261204*` names allowed | S1–S5 |
| `supabase/tests/database/359_p22_preserves.test.sql` | re-pinned: `app.demo_purge_tables` md5 and size 59, table/column/trigger/policy/function snapshots (each change listed in the PR) | S3, S6 |
| `supabase/tests/database/012_invoice_storage.test.sql:39` | bucket MIME list with the two new types | S2 |
| pgTAP files listing `public` functions (find with `grep -ln "invoice_approval_preview" supabase/tests/database`) | the three new public functions | S4, S5 |
| `tests/config/no-new-deps.test.ts` | `saxes` added to `EXPECTED` | S9 |
| `src/lib/api/errors.ts` `ErrorCode`; i18n `src/lib/i18n/messages/{it,en}.ts` | new codes and strings; key parity test green | S11, S14–S16 |
| **Unchanged on purpose** (md5 in 365, values from the rebased `main`): `public.approve_invoice`, `public.extraction_complete`, `public.extraction_claim`, `app.automap_invoice`, `app.automap_lines`, `app.propagate_mapping`, `public.review_update_line`, `public.review_update_header`, `public.review_set_supplier`, `public.review_clear_duplicate`, `public.reject_invoice`, `app.approval_blockers`, `app.approval_lines`, `public.invoice_approval_preview`, `app.find_duplicate_invoice_in`, `app.invoice_dup_lock_key`, `app.invoice_guard`, `public.extraction_quality`, `app.tenant_id`, `app.role`, `app.app_user_id`; `cron.job` names; `OFFLINE_CACHE_PATHS` | — | S6 |

### Steps

| # | Step (one commit) | Files | Test that proves it (written first, must fail first) |
|---|---|---|---|
| S1 | **XML columns and constraints** | `supabase/migrations/20261204100000_xml_invoice_columns.sql`; `supabase/tests/database/360_xml_invoice_columns.test.sql`; `tests/config/p2-7-preserves.test.ts`; earlier preserves files | Insert (as owner role in test) of `<t>/1998/<id>.xml` + `application/xml` and `.p7m` + `application/pkcs7-mime` with full XML metadata → ok; `.xml` with `application/pdf`, `.p7m.xml`, `.XML`, `<id>.xml.p7m` → `invoice_file_path_ck`/`mime_ck` violation; XML metadata partly null → `invoice_xml_meta_ck`; XML MIME without `document_type` → `invoice_xml_mime_ck`; `document_type` TD04 → check violation; unknown note → violation; update of `xml_sha256` (also as service role) → `invoice_immutable`; second live row with the same tenant+sha+body → 23505; allowed after the first is rejected; tenant B may hold the same sha; `vat_nature` `N2` (generic) → violation, `N2.1` ok; `xml_details` array or > 16 KB → violation; every existing PDF/photo fixture row still valid; preserves: only `20261204*` after `20261203100500` |
| S2 | **Storage for `.xml` and `.p7m`** | `…20261204100100_invoice_storage_xml.sql`; `supabase/tests/database/361_invoice_storage_xml.test.sql`; `012_invoice_storage.test.sql` (re-pin) | Bucket MIME list equals the five types; size limit 4194304; owner A inserts `A/1998/<uuid>.xml` and `.p7m` → ok; chef A, waiter A → refused; owner A into B's folder → refused; `.exe`, `.xml.p7m`, upper-case extension, extra folder level → refused; no update and no delete policy exists for any role; select policy unchanged |
| S3 | **`invoice_vat_summary` and purge list** | `…20261204100200_invoice_vat_summary.sql`; `supabase/tests/database/362_invoice_vat_summary.test.sql`; `359_p22_preserves.test.sql` (purge list re-pin) | Owner/admin read A's rows; chef, waiter, owner B → 0 rows; `authenticated` and `service_role` have no insert/update/delete; update, delete, truncate as table owner → `append_only`; `(vat_rate = 0) = (vat_nature is not null)` enforced; negative `taxable` refused, negative `rounding` allowed; FK to another tenant's invoice refused; `app.demo_purge_tables()` has `invoice_vat_summary` right before `invoice` and 59 names; purge of a demo tenant removes its summaries and keeps tenant B's; pgTAP 194 and 196 green |
| S4 | **Precheck and import procedures** | `…20261204100300_import_xml_invoices.sql`; `supabase/tests/database/363_import_xml_invoices.test.sql`; pgTAP public-function lists | Fixture tenant A (VAT set), active supplier "Fornitore Demo 1" (`IT12345678903`) with article memory keyed by code `ART-1` and by a description hash; fake `storage.objects` rows. **Import** of a 1-body payload (3 lines: code `ART-1`, a known description, an unknown one; rates 10 and 22; one N4 line) → status `review`, 3 lines with `extracted` baseline, 3 summary rows, `totals_diff` 0 and no `total_mismatch`, supplier linked, 2 lines auto-mapped (code first), `extracted_at` null and `extraction_quality` unchanged, audit `invoice.imported_xml`, `created_by` = caller. **3 bodies** → 3 invoices same sha, bodies 1..3; a third body with a bad path → nothing written (one transaction). **Refusals:** unknown payload key, float-looking amount `1e3`, 11 bodies, 201 lines, `documentType` TD04 → `invalid_request`; object row missing or with another size → `file_missing`; buyer VAT ≠ tenant VAT → `xml_not_addressed_to_tenant`; buyer CF equal to the VAT digits → ok; supplier VAT = tenant VAT → `xml_issued_by_tenant`; tenant VAT null → ok with note `buyer_unchecked`; same sha+body live → `already_uploaded` with DETAIL = the first id. **Precheck** returns `alreadyUploaded`, `buyer`, `issuedByTenant` for the same cases and writes nothing. **Roles:** chef, waiter, admin at `aal1` → 42501; B's object path → `invalid_request`. **Perf net:** 10 bodies × 200 lines under `statement_timeout = '5s'` |
| S5 | **Duplicates and replace** | `…20261204100400_replace_with_xml.sql`; `supabase/tests/database/364_xml_duplicates.test.sql`; `scripts/test-db-races.sh` (case `replace-vs-approve`) | XML with the key of a photo invoice in `review` → `duplicate`, `duplicate_of` = photo; of an `approved` one → `duplicate`; number `FT 12` vs `ft12` → duplicate (normalised); XML first then `extraction_complete` (service role) of a PDF with the same key → PDF `duplicate`; two XML files, same key, different sha → second `duplicate`. **Replace:** (xml dup, photo in review) → photo `rejected` with audit reason "Sostituita dal file XML", XML `review`, `duplicate_of` null, audit `invoice.replaced_by_xml`, automap ran; a third live look-alike → XML stays `duplicate` pointing at it; refused `replace_not_allowed` when the photo is approved, when the other is XML, when the XML is in `review`, when not look-alikes; second call → `replace_not_allowed` and exactly one `invoice.rejected` audit row; B's ids → `not_found`; chef → 42501. **Race** (two sessions): approve the photo vs replace → exactly one succeeds, never both an approved photo and a reviewable XML |
| S6 | **Role matrix and preserves** | `supabase/tests/database/365_p27_roles_preserves.test.sql`; `359_p22_preserves.test.sql` (snapshot re-pins) | The three new public functions × {owner, admin, chef, waiter, PIN waiter, admin at `aal1`, owner B} exactly as §3.9; each `prosecdef`, `search_path=''`, execute for `authenticated` only; pgTAP 341 gate-coverage scan green; md5 of every "unchanged on purpose" function equals the rebased `main`; no new trigger except `invoice_xml_guard` and the two on `invoice_vat_summary`; no new policy except the re-created Storage insert policy and `invoice_vat_summary_select`; `cron.job` names unchanged |
| S7 | **File kinds and checks** | `src/server/invoices/{file-check,constants}.ts`; `src/server/fatturapa/sniff.ts`; `tests/server/invoices/file-check-xml.test.ts` | `sniffKind`: XML with BOM, leading spaces, `<?xml`, `<p:FatturaElettronica` → `xml`; DER p7m (OID within 64 bytes) → `p7m`; base64 and PEM p7m → `p7m`; PDF/JPEG/PNG unchanged; random text → null. Declared MIME allow-lists per kind (`text/xml`, empty, `application/octet-stream` ok for XML; `application/pkcs7-mime`, `application/x-pkcs7-mime`, empty ok for p7m; `image/png` for XML → 415). Extensions: `x.xml`, `x.xml.p7m`, `x.P7M` ok; `x.pdf` with XML bytes → 415; `x.p7m` with XML bytes → 415. Empty and > 4 MiB unchanged. Existing file-check tests green |
| S8 | **p7m unwrap** | `src/server/fatturapa/cms.ts`; `tests/fixtures/fatturapa/build-cms.ts` (DER builder, test-only); `tests/server/fatturapa/cms.test.ts` | Definite DER → the exact eContent bytes; BER indefinite length with chunked OCTET STRING → concatenation; base64 and PEM armour → same bytes; nested 2 levels → inner XML; 4 levels → `p7m_unreadable`; detached (no eContent) → reason `detached`; envelopedData OID → unreadable; eContentType ≠ id-data → unreadable; 5-byte length, length beyond input, depth 17, 10 001 TLVs → unreadable; every truncation of a valid file (loop over offsets) and 1 000 seeded random inputs → `FatturaError` only, never another exception, whole suite within the default timeout; a corrupted signature value still unwraps (documented: not verified); source scan: no `child_process`, `exec`, `spawn` import under `src/server/fatturapa/` |
| S9 | **Safe XML reader (adds `saxes`)** | `package.json`, `package-lock.json` (`saxes` 6.0.0 promoted to `dependencies`); `src/server/fatturapa/{xml,decode}.ts`; `tests/server/fatturapa/xml-reader.test.ts`; `tests/fixtures/fatturapa/attacks/*`; `tests/config/no-new-deps.test.ts` | `<!DOCTYPE` (inline, external, `SYSTEM "file:///…"`, `http://…`), `<!ENTITY` billion-laughs → `xml_unreadable` reason `dtd`, with `fs` and `fetch` spies at 0 calls; undefined entity `&x;` → unreadable; `xi:include` → ignored, 0 fetches; depth 33, 200 001 elements, 33 attributes, 10 001-char text outside `Allegati` → reason `limits`; a 3 MB base64 `Attachment` → accepted, not present in the result; UTF-16 BOM, invalid UTF-8, `encoding="utf-16"` → `encoding`; `iso-8859-1` byte `0xE8` → `è`; UTF-8 BOM ok; `xml-stylesheet` PI and comments ignored; CDATA text kept; root with prefix `p:`, `ns2:` and default namespace → ok; wrong namespace → `xml_not_fatturapa`; FSM10 root → `xml_simplified_unsupported`; `versione="FPX12"` → not FatturaPA; XAdES fixture with `ds:Signature` → skipped; elements `__proto__`, `constructor` → `Object.prototype` unchanged; no-new-deps list includes `saxes`; `npm audit --omit=dev` clean |
| S10 | **Mapping and rules** | `src/server/fatturapa/{schema,map,rules,decimal,labels,constants,errors}.ts`; `tests/fixtures/fatturapa/*.xml` (fake data from FPR01/02/03); `tests/server/fatturapa/map.test.ts`; `tests/server/fatturapa/rules.test.ts`; `tests/parity/fatturapa-sql-parity.test.ts` | **Map:** FPR single → header and 1 line as §3.3.5; multi-line: N4 line `vat_rate` 0 + `N4`, rates 10/22, `ScontoMaggiorazione` SC 10% → `unit_price` = `PrezzoTotale ÷ qty`, `listUnitPrice` and discount kept, no `amount_mismatch`; `Quantita` absent → qty 1; `"0.12345678"` → `"0.1235"` (string maths, no float); text-only line skipped + note; qty 3 with amount 0 kept; residual +0.40 → one residual line; −0.40 → no line + note; first `CodiceArticolo` → `supplierCode`, all codes kept; `AltriDatiGestionali` LOTTO/SCADENZA → `otherData`; 1 200-char description → 500 code points; control/bidi characters stripped; due date earliest of two instalments + note `instalments`; reference date + 30 days; none → null; `ImportoTotaleDocumento` absent → net+VAT; document-level discount → note; FPR03 lotto → 3 invoices with the same sha and bodies 1..3; FPA12 → ok. **Rules:** TD02, TD03, TD04, TD05, TD06, TD16…TD23, TD26…TD29 → `xml_document_type_unsupported` (and TD24, TD25 → accepted; the rule is the allow-list TD01/TD24/TD25, anything else refused) with code and label; USD, `DatiRitenuta`, `DatiCassaPrevidenziale`, line `Ritenuta` SI, `EsigibilitaIVA` S, negative `PrezzoTotale` (line number in details), negative total, 201 lines, 11 bodies → `xml_content_unsupported` with reason; IT VAT bad check digit, missing `Numero`, `Numero` without digits, rate 0 without `Natura`, `Natura` with rate 22, line rate missing in the summary → `xml_invalid_content`; details capped at 5. **Parity:** TD list, Natura list, notes list, max bodies/lines equal the SQL migration text; `XmlImportPayload` strict |
| S11 | **Upload route, XML branch** | `src/server/invoices/{xml-upload,invoices}.ts`; `src/app/api/invoices/route.ts`; `src/lib/api/errors.ts`; `src/server/invoices/review-errors.ts`; `tests/app/api/invoices/upload-xml.test.ts` | Order: parse → precheck → N Storage uploads → import RPC; a parse/rule error → 422/415 with 0 Storage calls and 0 RPCs; precheck `alreadyUploaded` → 409 `{invoiceId}`, 0 uploads; buyer mismatch / issued by tenant → 422, 0 uploads; Storage failure on body 2 → 502, import not called, the orphan logged as id + status only; import P0001 `already_uploaded` (race) → 409; `file_missing` → 500 reported by code; success → 201 with `invoice` and `invoices` and `location`; 59 invoices in the last hour + a 2-body file → 429; chef → 403 with 0 work; PDF upload path and its tests unchanged (202); `reportError` spy never receives names, numbers, VAT, descriptions or amounts |
| S12 | **Worker never reads XML** | `src/server/cron/extract-job.ts`; `tests/server/cron/extract-job-xml.test.ts` | A claimed row with `application/xml` or `application/pkcs7-mime` → `extraction_fail` `file_mismatch`, not retryable; `makeClient` never called; PDF path tests green |
| S13 | **Download URL for XML** | `src/server/invoices/invoices.ts` (`createInvoiceFileUrl`); `src/app/api/invoices/[id]/file-url/route.ts`; `tests/server/invoices/file-url-xml.test.ts` | XML/p7m → `createSignedUrl(path, 300, {download: <sanitised name>})` and `disposition: "attachment"`; a name with path separators or bidi characters is sanitised; PDF/photo → no `download`, `disposition: "inline"`; the URL never reaches `reportError` |
| S14 | **Review reply and replace route** | `src/server/invoices/{review,review-types,review-actions,xml-view}.ts`; `src/app/api/invoices/[id]/use-xml/route.ts`; `tests/server/invoices/review-xml.test.ts`; `tests/app/api/invoices/use-xml.test.ts` | XML invoice → `invoice.xml` (labels from `labels.ts`), `vatSummary` rows with Natura labels, `lines[].xml`; PDF invoice → `xml` null and `vatSummary` []; `duplicatePartner` carries `grossTotal`, `format`, `status`, `amountsMatch` (±0.05 €: 100,00 vs 100,04 → true; vs 100,06 → false); `replaceWithXml` set only for an XML duplicate of a non-XML invoice in review; P2-2 `lotMissing` still computed. Route: extra body key or bad uuid → 400 with 0 RPCs; P0001 `replace_not_allowed` → 409; P0002 → 404; chef → 403; success → 200 `{status}` |
| S15 | **Upload card and list chip** | `src/app/(owner)/fatture/{upload-form,page}.tsx`; `src/lib/invoices/invoice-view.ts`; `src/lib/i18n/messages/{it,en}.ts`; `tests/components/upload-form-xml.test.ts` | Accept list includes `.xml,.p7m`; hint text; chip "Fattura elettronica" after picking `x.xml.p7m`; `reencodeForUpload` passes an XML file unchanged; success single / multi / duplicate texts and links from a fixture reply; table-driven: every error code renders its §3.8 text in `aria-live`, `already_uploaded` renders "Apri la fattura" linking the id; list rows show "XML" / "XML firmato" from `fileMime`; i18n key parity green |
| S16 | **Review screen, XML branch** | `src/app/(owner)/fatture/[id]/revisione/{document-panel,xml-summary,xml-notes,review-line,line-editor,duplicate-action,replace-sheet,supplier-panel}.tsx`; `tests/components/review-xml.test.ts` | No iframe/img for an XML invoice; summary rows rendered from the reply (no arithmetic in components; amounts "1.234,50 €"); "Scarica il file originale" requests `file-url`; notes card only when notes exist; "Usa come lotto" sends exactly `{lotCode}`, "Usa come scadenza" `{expiry}`; editor helper text on fiscal fields; supplier panel "Fornitore nuovo" prefill; the four duplicate banners from fixtures; the replace sheet sends `{replaces}` and a 409 reloads with the message; "File firmato (firma non verificata da Costì)" for p7m; targets ≥ 44 px |
| S17 | **Demo purge and backup accept the new files** | `scripts/lib/demo/purge.ts`; `tests/scripts/demo/purge.test.ts`; `tests/scripts/backup/files.test.ts` | Purge clean-up accepts `<t>/1998/<id>.xml` and `.p7m` of the same tenant, still refuses another tenant's path and `.exe`; the backup files step lists, downloads, hashes and packs `.xml` and `.p7m` objects with fake `run`/`fetch` (no code change in `scripts/lib/backup/`; the test proves inclusion) |
| S18 | **Integration on the real stack** | `tests/integration/xml-invoice.int.ts`; `tests/integration/helpers/xml.ts` | Owner A uploads a 2-body p7m fixture → 201, 2 invoices, 2 objects with content type `application/pkcs7-mime`; review shows `xml`; fetching the `file-url` answers with `Content-Disposition: attachment`; create the supplier, map lines, approve body 1 → receipts and payable as for a PDF; re-upload the same p7m → 409; upload its plain `.xml` → 409; a seeded photo invoice in review with the key of a third fixture → XML `duplicate` → `POST use-xml` → photo rejected, XML in review; chef → 403 on upload and use-xml; owner B → 404 on A's ids. Skips without the stack; throws in CI when settings are missing (existing rule) |
| S19 | **Playwright** | `e2e/xml-invoice.spec.ts`; `e2e/helpers/xml-invoice.ts`; fixtures under `e2e/fixtures/fatturapa/` | `phone` project: owner uploads an `.xml` → success text → "Controlla ora" → "Dati dal file XML", VAT summary, "Usa come lotto" fills the lot and removes "Lotto mancante"; create supplier; approve; upload a TD04 fixture → credit-note message, list unchanged; upload the same `.xml` again → "Questo file è già stato caricato." with a working link; `expectPhoneFriendly` on `/fatture` and the review page. Fixture invoice dates are past fixed dates (1998); any seed later read by a business-date default uses `businessDateOf(ownerPage)` |
| S20 | **ADR, guide, pointers** | `docs/adr/adr-044-fatturapa-xml-import.md` (number re-checked with `git ls-remote`); `docs/guides/fatture-elettroniche.md` (Italian: where to download the `.xml`/`.xml.p7m`, what is imported and refused, duplicates, "Usa il file XML", lot copy, signature note; states no law); `docs/plans/2026-11-11-phase2-scope.md` (C19: "planned in `docs/plans/2026-11-14-p2-7-xml-invoice-upload.md`"); `docs/adr/adr-004-invoice-extraction.md` (pointer line to ADR-044 for "FatturaPA XML later") | `npm run format:check` green; the owner-guide test (`tests/config/owner-guide.test.ts`, if it lists guides) extended; code review confirms ADR-044 records D-X1, D-X5, D-X9, D-X12, D-X13, D-X18 and the §4 rejections, and that ADR-040's future export lists `invoice_vat_summary` |

### Acceptance tests (AT-X, §5a style)

| # | Requirement → proof | Step(s) | Command |
|---|---|---|---|
| AT-X1 | `.xml` and `.xml.p7m` upload beside PDF/photo, parsed with no model call, land in the same review screen and are approved by the unchanged `approve_invoice` | S4, S6, S7–S12, S18, S19 | `npx supabase test db`; `npm test`; `npx playwright test` |
| AT-X2 | Lines carry VAT rate and Natura; the file's per-rate summary is stored and shown; totals pass the existing gate on the fixtures; discounts, missing quantity and rounding residual are handled | S4, S10, S14, S16 | as above |
| AT-X3 | A multi-body file becomes one invoice per body, atomically | S4, S10, S11, S18 | as above |
| AT-X4 | Unsupported types (TD02–TD06, TD16–TD23, TD26–TD29), simplified invoices, withholding/cassa, split payment, non-EUR, negative lines are refused before anything is stored, each with its message | S9, S10, S11, S15, S19 | as above |
| AT-X5 | Supplier linked by VAT; unknown supplier offered "Crea fornitore" prefilled; another buyer or the venue as issuer refused | S4, S10, S16 | as above |
| AT-X6 | Same file twice (also p7m vs its `.xml`) → 409 and nothing stored; XML vs PDF/photo in either order → `duplicate` with the partner and amount comparison; "Usa il file XML" replaces a photo in review; never an approved one | S1, S4, S5, S11, S14, S16, S18 | as above |
| AT-X7 | XML hardening: DTD, XXE, entity expansion, XInclude, depth, counts, size and encoding cases refused or neutral, with zero file-system or network access | S9 | `npm test` |
| AT-X8 | p7m DER, BER, base64/PEM and nested envelopes unwrapped; detached and malformed refused; no child process; the signature is not verified and the screen says so | S8, S16 | `npm test` |
| AT-X9 | Originals stored under the tenant folder with Storage RLS owner/admin and no update/delete; downloaded as attachment; included in the encrypted backup and the demo purge | S2, S13, S17, S18 | as AT-X1 |
| AT-X10 | Chef and waiter get 403/42501 everywhere; admin at `aal1` 42501; cross-tenant ids 404 | S4, S5, S6, S11, S14, S18 | as AT-X1 |
| AT-X11 | H5: lines map through `CodiceArticolo` and the supplier memory; H4: other data shown and copied to lot/expiry in one tap | S4, S10, S16, S19 | as AT-X1 |
| AT-X12 | No log line carries file content, VAT numbers, names, numbers or amounts; new screens phone-friendly (no horizontal scroll at 360 px, targets ≥ 44 px) | S11, S13, S15, S16, S19 | `npm test`; `npx playwright test` |
| AT-X13 | Invariants: no pinned procedure changed; the new table is append-only with `tenant_id` + RLS and is in the purge list; every existing suite green | S3, S6 | all |

**CI implications:** pgTAP `360`–`365`; one new race case; one integration suite; one e2e spec (no TOTP steps); coverage ≥ 80 % on new TS.
One new direct dependency (`saxes`, already locked).

**Before the PR is marked ready:** merge `main`; re-check the newest migration, pgTAP and ADR numbers (`git ls-remote`); recompute the md5
pins in 359 and 365; list every re-pin and changed snapshot in the PR body.

### 5b. Variants

**V1 — Credit notes (TD04) recorded** · Trigger: Q-X2 (founder) answered "record them" (or M9 Q30 answered "yes") · Replaces steps: the TD04
cases of S10 (refusal) and S15/S19 (credit-note message); adds V1.1–V1.4

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V1.1 | Table `supplier_credit_note` (append-only; `tenant_id`, supplier, number, date, gross, net, VAT, optional link to the original invoice from `DatiFattureCollegate`, file path, sha256; RLS owner/admin; purge list in the same migration) and definer `import_xml_credit_note(p_payload)`; reuses the M9 plan V2 design (`docs/plans/2026-10-23-m09-payables.md:431-436`) | `supabase/migrations/<ts>_supplier_credit_note.sql`; `supabase/tests/database/366_supplier_credit_note.test.sql` | Import as owner → one row, no stock movement, no payable change; chef → 42501; same sha → `already_uploaded`; purge of a demo tenant removes it; update/delete refused |
| V1.2 | Parser branch for TD04 (same rules as invoices, positive amounts) | `src/server/fatturapa/{map,rules}.ts`; `tests/server/fatturapa/credit-note.test.ts` | TD04 fixture → credit-note payload; negative lines still refused |
| V1.3 | Supplier statement subtracts unreversed credit notes (M9 V2.2) | `supabase/migrations/<ts>_statement_credit_notes.sql`; `supabase/tests/database/367_statement_credit_notes.test.sql` | Statement balance lowered by the note; `credits` lists both kinds with `source` |
| V1.4 | Upload success "Nota di credito registrata" and statement row | `src/app/(owner)/fatture/upload-form.tsx`; `src/app/(owner)/fornitori/…`; `tests/components/credit-note.test.ts`; `e2e/xml-credit-note.spec.ts` | Message and statement row rendered; e2e upload of TD04 shows the note on the supplier statement |

**V2 — Negative lines (line discounts and returns on separate lines)** · Trigger: the accountant's answer to the existing M3 Q3 / M4 Q2 / M5 Q3
(`phase1-closeout.md:144`) is "import them", confirmed by the founder · Replaces steps: the negative-line and negative-total cases of S10;
adds V2.1–V2.3

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V2.1 | `invoice_line_amount_ck` replaced by `line_amount >= 0 or xml_details is not null`; `app.approval_blockers` replaced to add `line_negative_stock` (a stock line with a negative amount must be marked non-stock with a cost centre); re-pinned on purpose | `supabase/migrations/<ts>_xml_negative_lines.sql`; `supabase/tests/database/368_xml_negative_lines.test.sql`; pgTAP files pinning `approval_blockers` | Negative XML line insertable, negative AI line still refused; approval blocked while a negative line is stock; allowed once non-stock; totals gate sums signed amounts; payable rule unchanged |
| V2.2 | Parser emits negative lines (kind SC/PR/AB) | `src/server/fatturapa/{map,rules}.ts`; `tests/server/fatturapa/negative-lines.test.ts` | Fixture with a −5,00 € discount line imports; the residual rule unchanged |
| V2.3 | Review shows "Sconto/abbuono" and asks for the cost centre | `src/app/(owner)/fatture/[id]/revisione/review-line.tsx`; `tests/components/review-negative-line.test.ts` | Chip and cost-centre prompt rendered; 422 `line_negative_stock` message shown |

**V3 — p7m signature verification** · Trigger: Q-X4 (lead) or a legal adviser requires verified signatures · Replaces steps: S8's "corrupted
signature still unwraps" assertion; adds V3.1–V3.4

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V3.1 | Add `pkijs` 4.0.1 + `asn1js` 4.0.0 (BSD-3-Clause; maintained by PeculiarVentures; replaces nothing) and verify the CMS signature and CAdES-B signed attributes with Node WebCrypto | `package.json`; `src/server/fatturapa/verify.ts`; `tests/server/fatturapa/verify.test.ts`; `tests/config/no-new-deps.test.ts` | Valid test signature → `valid`; altered content → `invalid`; missing signing time → `invalid`; AdE-issued certificate fixture → `unknown` |
| V3.2 | Trust list snapshot: cron `/api/cron/trust-list` fetches the public `TSL-IT.xml` (no credential, no secret), verifies it with AgID's published seal certificates, stores qualified CA certificates in `app.trust_anchor` (platform table, no tenant data) | `supabase/migrations/<ts>_trust_anchor.sql`; `src/app/api/cron/trust-list/route.ts`; `supabase/tests/database/369_trust_anchor.test.sql`; `tests/app/api/cron/trust-list.test.ts` | Fake signed TSL accepted, tampered TSL refused; anchors replaced atomically; no tenant can read the table |
| V3.3 | Revocation at signing time via OCSP (timeout 5 s, no retry in the request) with CRL fallback; result `signature_status` (`valid`/`invalid`/`unknown`) stored on the invoice | `supabase/migrations/<ts>_signature_status.sql`; `src/server/fatturapa/revocation.ts`; `supabase/tests/database/370_signature_status.test.sql`; `tests/server/fatturapa/revocation.test.ts` | Mocked OCSP good/revoked/timeout → valid/invalid/unknown; the upload never fails on `unknown` |
| V3.4 | Screen shows "Firma valida" / "Firma non valida" / "Firma non verificabile" | `src/app/(owner)/fatture/[id]/revisione/xml-summary.tsx`; `tests/components/signature-status.test.ts` | Each status renders its text |

**V4 — Hard lock of fiscal fields on XML invoices** · Trigger: Q-X5 (lead) or Q-X1 (commercialista) asks that XML amounts never change in Costì
· Replaces steps: S16's "editor helper text" assertion; adds V4.1–V4.2

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V4.1 | Trigger `invoice_xml_fields_lock`: on lines of an invoice with `document_type`, refuse changes to `qty`, `unit_price`, `line_amount`, `vat_rate`, `vat_nature`, `raw_description`; on the header refuse `number_raw`, `invoice_date`, totals, `supplier_vat` → P0001 `xml_field_locked` | `supabase/migrations/<ts>_xml_fields_lock.sql`; `supabase/tests/database/371_xml_fields_lock.test.sql` | Each locked field refused through `review_update_line` / `review_update_header`; mapping, unit, lot, expiry, credit and splits still allowed; PDF invoices unaffected |
| V4.2 | Editor hides locked fields for XML lines; 422 message | `src/app/(owner)/fatture/[id]/revisione/line-editor.tsx`; `src/server/invoices/review-errors.ts`; `tests/components/line-editor-xml-lock.test.ts` | Locked inputs absent; `xml_field_locked` shows "Valore fissato dal file XML" |

**V5 — Automatic lot/expiry from `AltriDatiGestionali` per supplier (H4 complete)** · Trigger: real sample files (project Q1) show a supplier
writing lot or expiry with a stable `TipoDato` · Replaces steps: none (extends S10, S16); adds V5.1–V5.3

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V5.1 | Table `supplier_xml_label` (`tenant_id`, `supplier_id`, `kind` lot/expiry, `tipo_dato` ≤ 10; owner/admin; audited setter; in the purge list) | `supabase/migrations/<ts>_supplier_xml_label.sql`; `supabase/tests/database/372_supplier_xml_label.test.sql` | Owner sets/clears; chef → 42501; purge removes it |
| V5.2 | Import fills `lot_code`/`expiry` from the matching `AltriDatiGestionali` (case-insensitive exact `TipoDato`); `extracted` baseline records it | `supabase/migrations/<ts>_import_xml_lot_labels.sql` (replaces `import_xml_invoices`); `supabase/tests/database/373_import_xml_lot_labels.test.sql`; `src/server/fatturapa/map.ts`; `tests/server/fatturapa/lot-labels.test.ts` | Configured label → lot filled; other suppliers unaffected; an invalid date → expiry left null |
| V5.3 | Supplier screen setting "Etichetta lotto nel file XML" | `src/app/(owner)/fornitori/[id]/…`; `tests/components/supplier-xml-label.test.ts` | Setting saved and shown |

**V6 — Simplified invoices (FSM10, TD07)** · Trigger: real sample files include simplified invoices · Replaces steps: the FSM10 refusal case of
S9 (`xml_simplified_unsupported`); adds V6.1–V6.3

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V6.1 | Mapper for `FatturaElettronicaSemplificata` (`…/fatture/v1.0`, `versione` FSM10): one line per `DatiBeniServizi` (`Descrizione`, `Importo`, `DatiIVA`), qty 1 | `src/server/fatturapa/map-simplified.ts`; `tests/server/fatturapa/simplified.test.ts` | Official-schema-based fixture → payload; rules as §3.3.4 |
| V6.2 | `document_type` check and import accept `TD07` | `supabase/migrations/<ts>_xml_simplified.sql`; `supabase/tests/database/374_xml_simplified.test.sql` | TD07 import ok; TD08/TD09 refused |
| V6.3 | e2e upload of a simplified invoice | `e2e/xml-simplified.spec.ts` | Review shows the lines; approval works |

## 6. Risks and mitigations

- **Real files differ from the fixtures** (supplier software quirks, Latin-1, base64 p7m, huge attachments): mitigation: tolerant reading
  where safe (§3.3.1), clear refusals, real sample files from the venue (project Q1) run through `scripts/` locally before go-live, never
  committed (client data).
- **Owners expect credit notes and negative lines to work:** refused with a message naming what to do; V1/V2 are planned; the guide says so.
- **Duplicate missed when the PDF was read without a VAT** or with a differently formatted number (`FT 12/98` vs `12/98`): the VAT is set when
  the PDF is linked to a supplier (re-check runs); the number normaliser only strips spaces and case. Residual risk: two approved copies of
  one invoice. Mitigation: the amount comparison and the existing supplier statement; a looser number match is a later candidate (Q-X14).
- **Supplier memory keyed by PDF codes** may not match XML `CodiceValore` formats: the description-hash fallback still applies; the first
  XML invoice of a supplier may need one mapping pass.
- **`saxes` without releases since 2021:** wrapper in one file, attack fixtures in CI, `npm audit` in CI, fallback library documented
  (Q-X16).
- **Own DER reader bugs:** narrow scope (no crypto), limits, truncation and fuzz tests (S8).
- **Storage use on the Free plan** (1 GB): XML files are small; a 10-body file stores 10 copies; the 4 MiB cap bounds the worst case.
  ADR-034's egress note applies unchanged.
- **Inconsistent files** (document discount, negative rounding): imported with a note; the totals gate blocks approval until the owner corrects
  the header (no hard lock, D-X16).
- **Payload forgery by an owner/admin** through the RPC: no privilege gain (they can edit every invoice field today); audit, immutability of
  XML columns and the Storage object check limit misuse.
- **Legal expectations:** Costì's copy is not conservazione; the guide and Q-X1 state it; the plan states no law.
- **Merge pressure before the freeze:** no pinned procedure touched; the split in Flag 7; UI strings ship as drafts ("da approvare").
- **Re-pins of P2-2's 359:** each change listed in the PR; `code-reviewer` checks every one is explained.
- **Security:** XML/ASN.1 parsing, cross-tenant paths, role leaks and log leaks are each pinned by tests (S2, S4, S6, S8, S9, S11).
- **Dependencies:** one direct dependency added (`saxes`, ISC, already locked); no provider, no licence issue.

**Explicitly out of scope (repeated for the reviewer):** credit notes, negative lines, signature verification, hard lock, automatic lot labels,
simplified invoices (V1–V6); TD02/03/05/06 and TD16–TD23, TD26–TD29; withholding, cassa, split payment, foreign currency; attachment extraction; SDI intake
through an intermediary; conservazione; the P2-5 file; any change to the AI path or to `approve_invoice`.

## 7. Open questions (founder rule: official sources first, one question per outside party, each with our recommended default)

### 7.1 Commercialista — one question

| # | Question | Recommended answer (default in force) | If the answer differs |
|---|---|---|---|
| Q-X1 | "Costì will read the venue's supplier e-invoices from the XML file the venue uploads, and import only ordinary and deferred invoices (TD01, TD24, TD25). Credit notes, self-invoices and integrations (TD04, TD16–TD23, TD26–TD29), advance and fee invoices, and invoices with withholding tax are refused and stay with you as today. Costì's copy of the file is an operational copy only: the legal digital preservation (conservazione) stays where it is today. Is this right for how you keep the venue's books?" | **Yes** | Types to add → V1 (TD04) or a new variant; "Costì must also preserve legally" → a separate plan with a conservation provider (out of Phase 2) |

### 7.2 Founder — one question

| # | Question | Recommended default | If not default |
|---|---|---|---|
| Q-X2 | "When a supplier sends a credit note (nota di credito) as an XML file, should Costì record it now (it lowers what you owe that supplier and appears in the accountant file), or is it fine that Costì refuses it for the moment and credit notes stay handled outside the app, as today?" | **Refuse for now**, with the message "È una nota di credito (TD04): Costì non la registra ancora. Passala al commercialista." | V1 |

Already-asked outside questions this plan relies on (not asked again): M3 Q3 / M4 Q2 / M5 Q3 negative lines (accountant, `phase1-closeout.md:144`)
→ V2; M9 Q30 separate credit notes (`:155`) → V1; project Q1 real sample invoices (founder) → V5/V6 triggers.

### 7.3 Internal / lead questions (each with the default in force)

| # | Question | Default | Variant if not default |
|---|---|---|---|
| Q-X3 | Multi-body files | One invoice per body, file stored once per body, ≤ 10 bodies | — (refusing multi-body is a one-line rule change) |
| Q-X4 | p7m signature | Unwrap only, labelled "firma non verificata da Costì" | V3 |
| Q-X5 | Hard lock on XML fiscal fields | No lock; helper text; corrections tracked | V4 |
| Q-X6 | Lot/expiry from the file | Show other data + one-tap copy | V5 |
| Q-X7 | Text-only lines (no quantity, amount 0) | Not imported, counted in a note | — |
| Q-X8 | Encodings | UTF-8; ISO-8859-1/windows-1252 tolerated; others refused | — |
| Q-X9 | Buyer check | Refuse a file addressed to another VAT when the venue VAT is set; note when unset | — |
| Q-X10 | "Usa il file XML al posto del PDF" | Built; only against a non-approved photo/PDF | — |
| Q-X11 | Embedded attachments (`Allegati`) | Ignored (counted in a note), not extracted | — (later candidate) |
| Q-X12 | Limits | 4 MiB, 10 bodies, 200 lines per body | — |
| Q-X13 | Simplified invoices | Refused | V6 |
| Q-X14 | Looser duplicate number match (digits only) | No; exact normalised number as today | — (later candidate) |
| Q-X15 | Due date with instalments | Earliest `DataScadenzaPagamento`, note "Pagamento a rate" | — |
| Q-X16 | XML library | `saxes` 6.0.0 (stable, locked via jsdom) | — (swap to `fast-xml-parser` ≥ 5.10.1 with `processEntities: false` and DOCTYPE pre-refusal inside the same wrapper, re-running S9) |

This plan states no law. Fiscal points are the commercialista's to confirm.

## 8. Sources

- Repo documents, migrations and code listed in the header and §2 (read on 2026-11-14 in `/home/user/osteria-dei-rossi-app`, branch
  `feat/p2-7-xml-invoice-upload`).
- DigiAlto-Ops, read-only: `clients/osteria-dei-rossi/context.md` (decision 2026-11-13, P2-7); `clients/osteria-dei-rossi/deliverables/2026-11-13-fiscal-feasibility/study.md`
  §1(a)–(b), §8.
- Agenzia delle Entrate, *Allegato A – Specifiche tecniche, versione 1.9.1* (31/03/2026), read 2026-11-14:
  <https://www.agenziaentrate.gov.it/portale/documents/d/guest/allegato-a-specifiche-tecniche-vers-1-9-1>. Pages used: 5 (5 MB per file),
  8–9 (versions 1.9 and 1.9.1), 11–12 §1.2.1 (signature formats, SdI checks, codes 00100–00107), 12–13 §1.2.2 (`.xml` / `.xml.p7m`), 18
  §1.3.2 (delivery, 5 MB), 61–64 (root, `DatiTrasmissione`, `FPR12`, `CedentePrestatore`), 79–84 (`TipoDocumento` TD01–TD29, `Numero` ≤ 20,
  `DatiRitenuta`, `DatiCassaPrevidenziale`, `Natura`, `ScontoMaggiorazione`, `ImportoTotaleDocumento`, `Arrotondamento`), 92–97 (§2.2.10
  `DettaglioLinee`, `AltriDatiGestionali`, §2.2.10.2 `DatiRiepilogo`, `EsigibilitaIVA`), 98–100 (§2.2.12 `DatiPagamento`), 116–119 (Appendix 1
  codes 00419, 00421, 00422, 00423, 00424, 00425, 00428–00430, 00443–00445, 00471–00475), 124–127 and 150–153 (XSD 1.2.3: namespace,
  `versione` FPA12/FPR12, `utf-8`, number and date types; tabular representation).
- fatturapa.gov.it, *Formato FatturaPA* (schema 1.2.3 valid from 1 April 2025; FSM10 1.0.2; example files `IT01234567890_FPR01/02/03.xml`),
  read 2026-11-14: <https://www.fatturapa.gov.it/it/norme-e-regole/documentazione-fattura-elettronica/formato-fatturapa/>
- AgID: Italian trusted list <https://eidas.agid.gov.it/TL/TSL-IT.xml>; notice "Firma elettronica qualificata: aggiornati i certificati per
  la verifica della lista dei prestatori" (21/01/2026) <https://www.agid.gov.it/it/notizie/firma-elettronica-qualificata-aggiornati-i-certificati-la-verifica-della-lista-dei>;
  active QTSPs <https://www.agid.gov.it/it/piattaforme/firma-elettronica-qualificata/prestatori-di-servizi-fiduciari-attivi-in-italia>.
  Found but **not read in full** in this session (to be read before V3 is planned): Deliberazione CNIPA 45/2009
  <https://www.agid.gov.it/sites/default/files/repository_files/circolari/deliberazione_cnipa_45_9_novembre_2009_gu.pdf>; AgID *firme
  multiple* <https://www.agid.gov.it/sites/default/files/repository_files/linee_guida/firme_multiple.pdf>.
- RFC 5652 *Cryptographic Message Syntax* (ContentInfo, SignedData, EncapsulatedContentInfo): <https://www.rfc-editor.org/rfc/rfc5652>
  (standard reference; not fetched in this session; S8's fixtures encode the structure and are reviewed against the RFC text).
- Supabase JS `createSignedUrl` `download` option: <https://supabase.com/docs/reference/javascript/storage-from-createsignedurl> (not fetched
  in this session; S18 asserts the `Content-Disposition` header on the real stack).
- npm registry: `saxes` 6.0.0, ISC, dependency `xmlchars`, published 2021-11-07 <https://registry.npmjs.org/saxes>; `fast-xml-parser` 5.12.1,
  MIT <https://registry.npmjs.org/fast-xml-parser/latest>; `pkijs` 4.0.1 and `asn1js` 4.0.0, BSD-3-Clause
  <https://registry.npmjs.org/pkijs/latest>, <https://registry.npmjs.org/asn1js/latest>.
- Advisories: `fast-xml-parser` CVE-2026-26278 <https://advisories.gitlab.com/npm/fast-xml-parser/CVE-2026-26278/>, CVE-2026-33036
  <https://advisories.gitlab.com/npm/fast-xml-parser/CVE-2026-33036/>, CVE-2026-33349 <https://advisories.gitlab.com/npm/fast-xml-parser/CVE-2026-33349/>,
  CVE-2026-73569 <https://corgea.com/advisories/vulnerabilities/CVE-2026-73569>; `node-forge` CVE-2025-12816
  <https://advisories.gitlab.com/npm/node-forge/CVE-2025-12816/>, CVE-2025-66031 <https://advisories.gitlab.com/pkg/npm/node-forge/CVE-2025-66031/>.
  `saxes`: no advisory found in this session's searches; its README states DTD-defined entities are not processed.
- EUR-Lex was not needed and not used (blocked from this environment).

---

## Lead decisions

> Entries here override the text above.

| # | Decision | Date | Effect on steps / variants |
|---|---|---|---|
| LD-1 | Plan approved as written. Internal questions Q-X3 to Q-X16 take their defaults | 2026-11-14 | S1–S20 as written |
| LD-2 | Q-X1 joins the existing single commercialista question in the DigiAlto-Ops outside-party sheet (not a second question). Build on "yes" | 2026-11-14 | TD01/TD24/TD25 only; others refused |
| LD-3 | Q-X2 has been put to the founder. Build on "refuse for now"; a later "record them" becomes V1 as a follow-up, not a change to this PR | 2026-11-14 | TD04 refused with a message |
| LD-4 | ADR-044 is P2-7's | 2026-11-14 | S20 writes ADR-044 |
| LD-5 | The UX/UI session specs the screens from §3.8. Build the server and SQL steps (S1–S14, S17) first. If its spec lands before S15–S16, follow it where it differs; if after, keep §3.8 and the differences become small follow-ups | 2026-11-14 | Order: S1–S14, S17, then S15–S16, S18–S20 |
| LD-6 | Before pushing, grep `e2e/` and `tests/` for every list the feature extends (nav, purge list, MIME lists, pinned names). Mark the PR ready as soon as the code is written, so the heavy CI runs alongside `code-reviewer`; push review fixes afterwards in one batch. The lead does a security read of the parser, the DER reader and the storage policy before merging | 2026-11-14 | PR flow |
| LD-7 | The P2-7 screen spec `docs/ux/p2-7-xml-invoice-upload.md` (#104) governs S15–S16 where it differs from §3.8. Its §8 Y1–Y10 are accepted; Y4 (header label "Scadenza pagamento", so it is not confused with a product expiry "Usa come scadenza") is the important one | 2026-11-14 | S15–S16 follow the spec |
| LD-8 | Correction (go-live ops): document types are an explicit allow-list, TD01, TD24, TD25; everything else is refused by default. The old "TD16–TD29" refused range wrongly covered TD24/TD25 and now reads TD16–TD23, TD26–TD29 everywhere. The S10 test asserts TD24 and TD25 accepted and TD16–TD23, TD26–TD29 refused. The S1 SQL already encodes the allow-list (`document_type` check, `app.xml_document_types()`) | 2026-11-14 | S10 test; plan text (§0, §1, D-X4, S10, AT-X4, §6, Q-X1) |
