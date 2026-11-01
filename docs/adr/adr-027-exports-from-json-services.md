# ADR-027: Exports are a rendering of the JSON report services (no second SQL path); CSV in one house format; the monthly pack is a print view saved as PDF by the browser

- **Status:** accepted
- **Date:** 2026-10-31
- **Decided by:** architect, on the M24 plan (`docs/plans/2026-10-31-m24-exports.md`). Accepted by the founder with the plan on 2026-11-01.

## Context

- **PRD 4.5:** "Every table exportable to CSV; monthly pack (KPIs, purchases, waste, variance) as PDF for the accountant."
- **Project plan:**
  - §3.3: `GET /api/exports/:report.csv` and `GET /api/exports/monthly-pack?month=` (print view), owner and admin;
  - §3.11.6: "CSV exports escape formula-leading cells (`= + - @`)";
  - §4 (alternatives): "Server-side PDF generation for the monthly pack: rejected for now. A print stylesheet gives a PDF through the browser's 'Save as PDF' with no dependency. Revisit if the accountant needs emailed PDFs (M36)";
  - §5a M24 AT1: "For each report, the CSV row count and values equal the JSON endpoint for the same range";
  - §7 Q20: the CSV conventions for the accountant (separator, decimals) are open. No later plan or DigiAlto-Ops decision answers them.
- **What exists (merged on `main` `28a3848`):** every report endpoint is a thin route (`withApi` + `parseQuery(<schema>)`) over one service in `src/server/{reports,push,stock,counts}/`. Each service makes one RPC (two for the count variance screen) and parses the reply with a strict, role-shaped Zod schema. The SQL decides every figure, date and order (M22/M23 "no data logic in React"). `src/lib/csv/parse.ts` (M1) reads `;`/`,` CSV with BOM, without a dependency.
- **Invariants:** roles enforced in Postgres and in the route; waiters never see costs; the chef never sees € (project V6); every screen reads `/api/*` JSON; no new dependency unless unavoidable.

## Decision

1. **One export registry, no SQL.** `src/server/exports/registry.ts` maps each export slug to the **same query schema object and the same service function** its JSON route uses, a `rows(output)` selector and a column list. The CSV route renders that output. No file under `src/server/exports/` calls `.rpc(`: a guard test enforces this. So CSV and JSON cannot diverge in the data, and AT1 holds by construction (it is still tested).
2. **One CSV format, in `src/lib/csv/write.ts`** (Q20's open part, M24 default Q170). Separator `;`, decimal comma, no thousands separator, UTF-8 with a BOM, CRLF line endings (RFC 4180 quoting). Dates are `GG/MM/AAAA` and instants `GG/MM/AAAA HH:MM`, both in Europe/Rome. Headers are fixed Italian snake_case keys, as in the M1 import template. An empty cell means "unknown", never zero. Numbers keep the JSON precision (at most four decimals).
3. **Formula injection is handled by typed cells.** A text cell starting with `=`, `+`, `-`, `@`, tab or carriage return gets a leading `'` and is quoted. Numeric cells are written by a formatter whose output can only be `-?\d+(,\d{1,4})?`, so a negative number stays a number.
4. **Owner and admin only, at the route, before any RPC.** This applies even for the tables the chef can read as JSON (push list, forecast, count variance, reconciliation). Each RPC still checks the role in SQL.
5. **The monthly pack is JSON plus a print stylesheet.** `GET /api/exports/monthly-pack` composes the existing KPI, waste and AVT services. `/report/mese` renders it inside the normal shell. A global `@media print` block sets A4, hides every `nav` and the shell's status slots, and prints in the light palette. The owner uses the browser's "Save as PDF".

## Alternatives

- **A second SQL function per export (`*_csv`) or a generic "export any table" function.**
  - Pros: CSV built next to the data; could stream.
  - Cons: two code paths per report, so AT1 becomes something to keep true instead of something true by construction. It adds public functions to every pinned list (pgTAP 207/214/222/229/240). A generic table export would bypass the role-shaped JSON (cost columns to the wrong role).
  - Why not: parity and role shaping are already solved in the services.
- **Build the CSV in the browser from the JSON the screen already has.**
  - Pros: no new route.
  - Cons: formatting and escaping logic in React (against "no data logic in React"); every screen would need it; no single place to test the format.
  - Why not: the project plan names a server endpoint.
- **A CSV library (e.g. papaparse).**
  - Why not: writing RFC 4180 with typed cells is a few dozen tested lines; M1 already rejected a CSV dependency for the reader (M1 plan §4).
- **Server-side PDF (headless Chrome or a PDF library).**
  - Why not: a new dependency or service, function size and time limits on Vercel, and the project plan already rejected it for now.
- **A separate print layout outside the shell.**
  - Pros: no navigation in the DOM at all.
  - Cons: a second layout to maintain, and a sub-page without the shell's Report highlight. The print CSS has to exist anyway for A4 and the light palette.
  - Why not: one global print block also makes every other page print cleanly.

## Consequences

- **Good:**
  - CSV equals JSON by construction;
  - no SQL, no public function, no table, no dependency;
  - the format lives in one tested module, so an answer to Q20 (Q170) is a one-module variant;
  - M36 (accountant export) can reuse the writer.
- **Bad / accepted trade-offs:**
  - the CSV is built in memory per request. Its size is bounded by the JSON reply the same endpoint already sends;
  - instants are written to the minute;
  - text that looks like a number (a lot code `0012`) may be reformatted by a spreadsheet; we do not force text cells;
  - the print result depends on the browser. A4 and hidden navigation are tested in Chromium only.
- **What would make us revisit this:**
  - the accountant's answer to Q20/Q170 (format);
  - a need for emailed or scheduled PDFs (M36);
  - an export larger than the JSON route can answer within Vercel's response limit;
  - a chef or accountant role that needs exports (M36, M44).
