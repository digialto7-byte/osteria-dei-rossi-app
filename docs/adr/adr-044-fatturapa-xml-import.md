# ADR-044 — FatturaPA XML import: a deterministic reader inside the upload request, refuse before store, p7m unwrapped and not verified

- **Status:** accepted
- **Date:** 2026-11-14 · **Decided by:** lead (plan approval and lead decisions LD-1 to LD-8, 2026-11-14); the "no AI for XML" rule is the founder's (2026-11-13)
- **Plan:** `docs/plans/2026-11-14-p2-7-xml-invoice-upload.md` (decisions D-X1 to D-X18; steps S1 to S20). Screen spec: `docs/ux/p2-7-xml-invoice-upload.md` (Y1 to Y10).
- **Number:** 044 belongs to P2-7 (LD-4). Checked with `git ls-remote` and every remote branch on 2026-11-14: no branch held an ADR above 043.
- **Supersedes nothing.** It completes ADR-004, which left "FatturaPA XML accepted later, skipping the model" open.

## Context
- ADR-004 reads a supplier invoice PDF or photo with a vision model, passes it through a validation gate, and puts it in front of the owner. Founder
  decision 2026-11-13: the supplier's own electronic invoice file (`.xml`, or the signed `.xml.p7m`) is taken as it is, with no AI, into the **same**
  review, duplicate and approval rules. Automatic delivery from the tax system through an accredited intermediary is not in Phase 2.
- Invoices are never deleted (append-only ledgers, ADR-002 and ADR-003). A row made from a wrong file stays forever, and an `extraction_failed`
  row cannot even be rejected, so a bad file must never become a row.
- The file is input from outside, in two formats that are known sources of parser attacks (XML: DTD and entity expansion; CMS: nested lengths).
- E-invoices have no structured field for lot or expiry. P2-2 left the hooks H4 and H5 for this plan.

## Decision
The decisions are those of the plan, recorded here so they outlive it.

1. **D-X1 Synchronous import in the upload request**, not through the extraction queue. Order: parse (pure) → precheck RPC → Storage upload as the user →
   one import RPC in one transaction. The user sees the reason at once; the extraction worker never sees an XML invoice, and a guard makes it refuse one
   without a model call. `extracted_at` stays null, so the AI quality report stays clean.
2. **D-X2 Refuse before store.** Every refusal that concerns the file (unreadable, not an invoice, unsupported type, already uploaded, wrong buyer)
   happens before anything reaches Storage or Postgres. A failure after the uploads leaves an inert object, logged by invoice id and status only.
3. **D-X3 All or nothing per file.** One broken body or line refuses the whole file, with up to five reasons. "Partial parse" only means informational
   blocks Costì ignores, listed as notes (D-X15).
4. **D-X4 Document types are an explicit allow-list: TD01, TD24, TD25.** Everything else is refused by default, with the type named (credit notes TD04;
   advances; fee notes; the buyer's own integrations and self-invoices TD16 to TD23 and TD26 to TD29; simplified invoices). Credit notes are variant V1,
   negative lines V2.
5. **D-X5 p7m: unwrap only, no signature or certificate verification** (the section below).
6. **D-X6 A signed `.xml` (XAdES):** the `ds:Signature` subtree is skipped and not verified.
7. **D-X7 Supplier by VAT number.** The existing `automap_invoice` links the active supplier with that VAT; an unknown one is offered through the existing
   "Crea fornitore", prefilled. No supplier is created automatically. The codice fiscale is read only for the buyer check and is never stored.
8. **D-X8 Buyer check.** The buyer's VAT number (or a codice fiscale equal to its digits) must be the tenant's, else `xml_not_addressed_to_tenant`; a
   supplier equal to the tenant is `xml_issued_by_tenant`.
9. **D-X9 Duplicates.** (a) The same file again, by sha256 of the unwrapped XML plus body index among non-rejected invoices, is refused with 409
   `already_uploaded` and the id of the first invoice; a p7m and its extracted `.xml` are the same file. (b) The same invoice from another file (XML
   against PDF or photo, either order, or two XML files) uses the existing key (supplier VAT, normalised number, date): status `duplicate`. (c) The two
   gross totals are compared (0,05 euro) and shown in words; the total never decides.
10. **D-X10 "Usa il file XML al posto del PDF"** is one definer, `review_replace_with_xml`, only against a photo or PDF still in review: it rejects that
    copy and moves the XML to review in one transaction. Against an approved copy there is no replace (stock and a payable are posted and never change).
11. **D-X11 Lines.** One `invoice_line` per `DettaglioLinee` with an amount or a quantity; `unit_price` is the effective net price (`PrezzoTotale` divided
    by `Quantita`), the list price and the discounts are kept in `xml_details`; text-only lines are not imported and are counted in a note; a positive
    residual between the VAT summary and the lines becomes one line. Amounts are decimal strings and are never floats.
12. **D-X12 XML library: `saxes` 6.0.0** (ISC), wrapped in one file. See "Libraries".
13. **D-X13 CMS/ASN.1: no library.** Our own bounded DER/BER reader walks ContentInfo, SignedData, EncapsulatedContentInfo and the content only. No shell,
    no child process.
14. **D-X13b The original is stored as uploaded** (`.xml` as `application/xml`, `.p7m` as `application/pkcs7-mime`) at `<tenant>/<yyyy>/<invoice id>.<ext>`;
    these kinds are **never handed out as a Storage URL**: storage-js appends `download=` after signing, so the attachment disposition is not covered by the
    signature, and a stripped URL would serve an `application/xml` object inline on the Storage origin. `GET /api/invoices/[id]/original` (owner and admin,
    tenant-checked through RLS, another tenant's or an unknown id the same 404) reads the object server-side (buffered, at most 4 MiB, so a Storage failure is a clean 502 before any byte is sent) with the user's own client, never the secret key,
    and answers `Content-Disposition: attachment; filename="<safe name>"`, `Content-Type: application/octet-stream`, `X-Content-Type-Options: nosniff`,
    `Content-Security-Policy: sandbox; default-src 'none'` and `Cache-Control: no-store`. `file-url` answers the route's path for them; a Storage failure is
    reported by status and invoice id and answered 502. Residual risk: an owner or admin can still put hostile XML into their own tenant folder through the
    Storage API, but the app never serves it inline. Rejected: stripping foreign-namespace elements at parse time, because the stored original must stay
    byte-identical (it is the invoice copy and the sha256 key) and it would not stop a direct Storage upload.
15. **D-X14 Totals.** `net_total` is the sum of the summary's taxable amounts, `vat_total` the sum of its tax, `gross_total` the document total (else net
    plus VAT). The existing totals gate decides; a mismatch (a document-level discount, say) blocks approval and the owner corrects the header.
16. **D-X15 Notes instead of silent loss.** What Costì ignores is listed on the invoice and shown on the review ("Nel file c'è anche").
17. **D-X16 No hard lock on fiscal fields.** The existing review edits stay possible and are recorded against the XML baseline; the editor says so (variant
    V4 would lock them).
18. **D-X17 Hooks.** H5 is built: the first `CodiceArticolo` fills `supplier_code`, so the supplier article memory maps the line. H4 is built in part:
    every `AltriDatiGestionali` is shown on its line with one-tap "Usa come lotto" and "Usa come scadenza"; mapping a supplier's label automatically is V5.
19. **D-X18 VAT per rate** is stored in `invoice_vat_summary`: one row per rate and nature, append-only, `tenant_id` and RLS, in the demo purge list (59
    names) from the migration that creates it. The per-rate figures can differ from the line sums by rounding, so they are typed rows and not a jsonb blob.

### p7m: unwrap only, and the sources
- **What it does:** reads the signed envelope to get the invoice and does not check the signature. The review says "File firmato (firma non verificata da
  Costì)". Verification is variant V3.
- **Why:** (1) an unsigned FatturaPA file is equally valid for a private buyer, so a verification step cannot tell a genuine upload from a forged one: a
  forger uploads unsigned XML. (2) Every file the venue receives through the exchange system (SdI) has passed SdI's own check of the signature; the delivery
  is the record, not Costì's copy. (3) Real verification needs the AgID trusted list and the EU list, chain building, revocation status at signing time
  over the network, the CAdES signed attributes and, for certificates issued by the Agenzia delle Entrate, the Agenzia's own service: outbound traffic from
  the upload request, a crypto library and trust-anchor upkeep, against the rule of no new external provider. (4) Costì's copy is operational.
- **Sources** (read on 2026-11-14): Agenzia delle Entrate, *Allegato A, Specifiche tecniche, versione 1.9.1* (31/03/2026), §1.2.1 pages 11 to 12 (SdI
  accepts invoices with and without a signature and checks the signed ones; formats CAdES-B `.xml.p7m` and XAdES-B enveloped `.xml`; rejection codes
  00100 to 00107) and §1.2.2 page 13 (names end in `.xml` or `.xml.p7m`); AgID, the trusted list `https://eidas.agid.gov.it/TL/TSL-IT.xml` and the notice
  of 21/01/2026 on the renewed seal certificates; RFC 5652 (CMS) §3 and §5 for the structure the reader walks.
- **What it reads:** ContentInfo (signedData) → SignedData → EncapsulatedContentInfo (id-data) → eContent, definite DER or indefinite BER with a chunked
  OCTET STRING, base64 or PEM armour, nested envelopes up to 3 levels. A detached signature, another content type, or any structural problem is
  `p7m_unreadable`. Certificates and signer infos are skipped by length, never parsed. Limits: lengths of at most 4 bytes and inside the input, depth 16, at
  most 10 000 TLVs, content no larger than the input. A corrupted signature value still unwraps (stated, not hidden).
- **What would make us verify:** a legal adviser or the commercialista requiring verified signatures on Costì's copy, or an intermediary that hands over
  verification results (SaaS intake).

### Libraries
- **`saxes` 6.0.0** (ISC, one dependency `xmlchars`) is strict and streaming, processes no DTD and only the five predefined entities, so the depth,
  count and size limits stop a hostile file early. It was already in `package-lock.json` through `jsdom`, with the same integrity hash, so the shipped
  tree gains no new code; it is now a direct dependency and `tests/config/no-new-deps.test.ts` lists it on purpose. Caveat: no release since
  2021-11-07; the wrapper keeps a swap to one file (`fast-xml-parser` 5.10.1 or later with entity processing off and our DOCTYPE refusal).
- **DTD and ENTITY are refused before parsing.** A text holding `<!DOCTYPE` or `<!ENTITY` anywhere is `xml_unreadable` (reason `dtd`): FatturaPA never
  has a DTD. The parser also aborts on a doctype event as defence in depth. XInclude elements are ordinary unknown elements and are never processed. The
  reader does no I/O at all (tests spy on `fs` and `fetch`). Further limits: depth 32, 200 000 elements, 32 attributes, 10 000 characters of text per
  node (not counted inside attachments and signatures), 4 MiB of input; UTF-8 strict, Latin-1 tolerated, every other encoding refused.
- **Our own bounded DER/BER reader** (`src/server/fatturapa/cms.ts`, about 150 lines) instead of a CMS library: unwrapping needs only a walk by length.
- **Decimal maths** is `BigInt` on strings (`decimal.ts`), no library.

## Alternatives rejected (plan §4)
- **Parse in the extraction worker (status `received`).** Reuses the queue, but a bad file becomes a permanent row, feedback waits for the next cron
  minute, and the worker holds the secret key for a job that needs none.
- **Send the XML to the model as text.** Contradicts the founder's decision, costs tokens and brings back misreads.
- **`fast-xml-parser` 5.x.** Builds the whole tree, has six runtime dependencies, processes DOCTYPE entities by default and had four 2026 advisories in
  that area (CVE-2026-26278, CVE-2026-33036, CVE-2026-33349, CVE-2026-73569). Kept as the documented fallback.
- **`@xmldom/xmldom`, `libxmljs2`.** A DOM with a history of parsing advisories, and native bindings unsuitable for Vercel functions.
- **Our own XML parser.** Well-formedness is far larger than DER.
- **`node-forge` for p7m.** Dual BSD/GPL licence and ASN.1 advisories (CVE-2025-12816, CVE-2025-66031).
- **`pkijs` 4.0.1 with `asn1js` 4.0.0.** The right tools to verify CMS, and a large surface for an unwrap. They would arrive with V3.
- **`openssl cms` in a child process.** No guaranteed binary on the runtime; process and temp-file handling per request.
- **Verify the signature now.** See above.
- **The VAT summary as jsonb on `invoice`.** P2-5 sums per rate in SQL; typed rows with checks are simpler to query and test.
- **One invoice for a whole multi-body file, or refusing multi-body files.** Wrong fiscally, or blocks legitimate files. Chosen: one invoice per body (up to
  10), the file stored once per body, because `invoice_file_path_uq` and every reader assume one object per invoice.
- **Automatic supplier creation from the file.** Creates master data without a decision and collides with inactive suppliers.
- **A hard lock of fiscal fields.** The default is today's review rules; V4 if the commercialista asks.
- **Parsing the lot from `Descrizione`.** Free text, not deterministic.

## As built (deviations from the plan text)
- **The import payload is camelCase, with amounts as decimal strings** (`netTotal: "40.00"`), and the SQL checks them with a pattern, never as JSON numbers.
- **No `unknown` buyer state.** `tenant.vat_number` is NOT NULL on `main`, so a tenant without a VAT number cannot exist: `app.xml_buyer_state` answers
  `match` or `mismatch` only. The note `buyer_unchecked` stays in the allowed list (`invoice_xml_notes_ck`) and is never written.
- **`audit_event_action_check` is replaced** in the import migration (`20261204100300`), adding `invoice.imported_xml` and `invoice.replaced_by_xml`. The
  plan did not list the change; the audit rows need it, and one replacement keeps its md5 pin to a single re-pin.
- **Descriptions** are capped at 1000 characters by the schema (XSD) and cut to 500 on the line.
- **The p7m download name** is `fattura.xml.p7m` when the original name is missing or unusable (and `fattura.xml` for an XML); a usable name keeps its
  extension.
- **`amountsMatch` can be null** (when one of the two totals is missing), not only true or false; the screen shows the comparison only when it is known.
- **Notes carry no figure.** `attachments`, `text_lines_skipped` and `rounding_line_added` are worded without a count or an amount ("Allegati nel file (non
  importati)"), because the notes are stored as codes.
- **Dates on the screens** use the app's `formatCalendarDate` (`03/11/1998`), not the plan's "3 nov 1998".
- **Guide name.** The owner guide is `docs/guides/fatture-xml.md` (the plan said `fatture-elettroniche.md`).
- **Fixtures.** The Playwright and integration suites build their files from `tests/fixtures/fatturapa/demo-invoice.ts` addressed to the run's tenant VAT,
  not from static files under `e2e/fixtures/`: the tenant's VAT number is made up per run, and the buyer must match it.

## Statistics-independent automap (lead decision 2026-11-14)

The heavy CI run at db1ce40e timed out on pgTAP 363's maximum-size file (10 bodies x 200 lines) at its 5 s budget on PG17. Measuring the cause
locally (PG16, auto_explain) found a plan cliff in the shared `app.automap_lines` (the AI path uses it too):

- The article lookup was one correlated subquery per line, with an OR over code and description hash, ordered and limited. When `supplier_item` had
  no fresh statistics (a catalogue that grew since its last autoanalyze, or rows of the same transaction), Postgres seq-scanned the supplier's whole
  catalogue for each line and hashed the line's description once per catalogue row: lines x articles.
- The 10 x 200 file against 5 000 articles of its supplier took **52 s** with no statistics, and 1.03 s after `analyze`. Supabase gives `authenticated`
  an 8 s statement_timeout (read on staging: anon 3 s, authenticated 8 s, authenticator 8 s plus lock_timeout 8 s), so a real owner could hit it.
- A first rewrite to two equality probes, one per unique key, was not enough. With no statistics the two unique indexes,
  (tenant_id, supplier_id, supplier_code) and (tenant_id, supplier_id, description_hash), look equally cheap. So the code probe could run on the
  hash index's (tenant, supplier) prefix: a range scan per line. That took 1.9 s at 5 000 articles and 6.1 s at 20 000.

**Decision.** Migration `20261204100500_automap_statistics_independent.sql` replaces `app.automap_lines` (same signature, grants, locking and
UPDATE; the md5 is re-pinned in pgTAP 365). Only the lookup changes:

- The eligible lines are read once, with each description hashed once.
- The supplier's usable articles whose code or description occurs on the invoice are found by one statement, an array match on the two keys. Whatever
  plan the statistics lead to, that is at most one pass over that supplier's catalogue per invoice, never one per line.
- Each line takes its article from that small set, code first.

**Result** (same file, no statistics, local PG16): **0.9 s at 1 000, 5 000 and 1.1 s at 20 000 articles.** The time no longer grows with the
catalogue. The semantics are unchanged:

- code before description;
- inactive articles and articles of inactive ingredients skipped (so the description's article applies when the code's one cannot);
- `p_item`;
- untouched lines only;
- tenant and supplier scoping.

pgTAP 366 pins the time and the semantics, including a line matching article A by code and article B by description (A wins). 022 and the
two-session race cases run unchanged. 363 prints its elapsed ms as a diagnostic on every run.

## Consequences
- Good: an XML invoice costs no model call, has exact lines, VAT per rate and totals, and goes through the unchanged review and `approve_invoice`. No pinned
  procedure is touched; three new definers (`invoice_xml_precheck`, `import_xml_invoices`, `review_replace_with_xml`) are owner and admin only, in Postgres.
  Nothing bad becomes a row. The original is archived, backed up (ADR-034 lists the bucket by SQL, extension-agnostic) and cleaned by the demo purge.
- **Purge and export lists.** `invoice_vat_summary` joins the demo purge list (ADR-018) in its own migration (59 names). **ADR-040's tenant export and
  erasure lists are not built on `main`; whoever builds them must list `invoice_vat_summary`** (and the XML columns of `invoice` and `invoice_line`).
- Accepted: Costì does not verify a signature. The copy Costì keeps is **not** the legal digital preservation (conservazione), which stays where it is
  today; this ADR states no legal rule, and the commercialista confirms the fiscal points (Q-X1). A look-alike missed because a photo was read without a
  VAT number or with a differently written number can still produce two approved copies of one invoice (plan §6); the amount comparison and the supplier
  statement are the guard. `saxes` has had no release since 2021, mitigated by one wrapper file, the attack fixtures in CI and `npm audit`.
- What would make us revisit this: credit notes or negative lines needed (V1, V2); a requirement for verified signatures (V3); a supplier writing lot or
  expiry with a stable label (V5); simplified invoices in real files (V6); automatic intake through an intermediary (a SaaS milestone, its own ADR).
- **This ADR states no law.** Fiscal and preservation duties are for the venue's accountant to confirm.
