# DRAFT — paused 2026-11-14, incomplete

> Paused by the lead for a higher-priority item. This file holds only the inputs gathered so far and the section skeleton.
> No design decision below is final. Nothing here has been fact-checked against official sources yet (no web research done).
> Do not build from this file.

# Tech plan: Osteria Digitalization · P2-7 XML e-invoice upload (C19)

- **Client slug / internal:** `osteria-dei-rossi` (internal planning document, English; screen strings Italian first, marked "da approvare").
- **Client facts used:** none. Fixtures will be fake FatturaPA files built from the official schema and examples only.
- **Repo and branch:** `osteria-dei-rossi-app`, branch `feat/p2-7-xml-invoice-upload` from `main` `3164ef1e` (includes P2-2).
- **Numbering (provisional, to re-check against `main` and remote branches):** migrations after `20261203100500_reservation_covers.sql`;
  pgTAP from `360`; ADR from `044`.
- **Author:** architect · **Date:** 2026-11-14

## Status of this draft

**Read so far**
- `CLAUDE.md` (ground rules, invariants).
- `docs/handoff/builder.md` (process, CI, local limits, security rules).
- `docs/plans/2026-11-11-phase2-scope.md` C19 (lines 852–863), Part 3 row P2-7 (line 882), OQ-4 (line 935).
- `docs/plans/2026-11-14-p2-2-trace-sell-through.md`: format, §3.13.3 FatturaPA findings, hooks H1–H7 (H4 and H5 are P2-7's).
- `/home/user/digialto-ops/clients/osteria-dei-rossi/context.md` (read-only, first 422 lines).
- File list of the invoice pipeline (`src/app/api/invoices/**`, `src/server/invoices/*`, `src/lib/invoices/*`). The file contents have
  **not** been read yet.

**Not done (missing)**
- Reading the current pipeline: upload route `src/app/api/invoices/route.ts`, `src/server/invoices/{invoices,file-check,constants,
  review,review-actions,approval}.ts`, `src/server/cron/extract-job.ts`, the Storage bucket and policies, `approve_invoice`,
  supplier and supplier_item matching, duplicate detection, the `invoice_line` VAT fields. No file:line references yet.
- Reading `docs/plans/2026-11-09-backup-invoice-files.md`, ADR-004 (extraction), ADR-034 (invoice file backups), ADR-002/003/018/040.
- All official-source research: Agenzia delle Entrate Allegato A v1.9.x, fatturapa.gov.it schema FPR12/FPA12, AgID CAdES and the
  verification needs (trust list, revocation). The p7m recommendation is not made yet.
- Library research (XML parser, CMS/ASN.1) and their security posture.
- Every design section below: decisions, data model and migrations, API routes with Zod, screens, RLS/role matrix, security,
  performance, build steps S1…Sn with tests, acceptance tests, variants, risks, open questions, sources.

## Inputs already fixed by earlier documents

- **Scope (C19, founder 2026-11-13):** upload `.xml` and `.xml.p7m` beside PDF and photo; deterministic parse, no AI; the same review,
  duplicate and approval rules as today. Automatic SDI delivery through an accredited intermediary is **not** in Phase 2 (SaaS milestones,
  after the commercialista answers).
- **Queue (lead, 2026-11-14):** CB11 → P2-2 (merged) → **P2-7** → SP0 → P2-4 → P2-5 → small fixes → code freeze around 19 December.
- **From P2-2 §3.13.3 (Allegato A v1.9.1, §2.2.10.1 DettaglioLinee, as recorded there, to be re-checked):** no dedicated field for lot,
  expiry, origin, producer or designation. Lot and expiry appear only if a supplier writes them in `AltriDatiGestionali` or
  `CodiceArticolo`, with non-standard labels. `CodiceArticolo` (EAN or supplier code) can map lines to `supplier_item`.
- **Hooks to decide here:** H4 (per-supplier mapping of `AltriDatiGestionali` / `CodiceArticolo` labels to `invoice_line.lot_code` and
  `expiry`) and H5 (`CodiceArticolo` used for `supplier_item` auto-mapping). Whether each is built in P2-7 or stays a hook is still open.
- **Planning input not read:** the fiscal feasibility study in DigiAlto-Ops (`clients/osteria-dei-rossi/deliverables/2026-11-13-fiscal-feasibility/study.md`).

## 0. Summary for the founder (plain language)
_Not written._

## 1. Goal and scope
_Not written beyond the inputs above._

## 2. Current state
_Not written. Requires reading the pipeline code (see "Not done")._

## 3. Design
### 3.1 Decisions — _not written_
### 3.2 Data model and migrations — _not written_
### 3.3 Parsing (DettaglioLinee, DatiRiepilogo, Natura, ScontoMaggiorazione, multi-body, TD codes incl. TD04) — _not written_
### 3.4 p7m signature: unwrap or verify — _not written; no recommendation yet_
### 3.5 Supplier matching and duplicates — _not written_
### 3.6 API routes (Zod) — _not written_
### 3.7 Screens — _not written_
### 3.8 RLS / role matrix — _not written_
### 3.9 Security — _not written_
### 3.10 Performance — _not written_

## 4. Alternatives considered
_Not written._

## 5. Build plan
_Not written._

### Acceptance tests
_Not written._

### 5b. Variants
_Not written._

## 6. Risks and mitigations
_Not written._

## 7. Open questions
_Not written._

## 8. Sources
- Repo documents listed under "Read so far".
- Official sources: not yet consulted in this session.

---

## Lead decisions

> Entries here override the text above.

_None yet._
