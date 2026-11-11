# ADR-033 — Ledger reports count movements on the business day of `created_at`; `effective_on` is not a report date (receipts excepted)

- **Status:** accepted (PR #64, merge commit 10a0ab5)
- **Date:** 2026-11-08 · **Decided by:** architect, on `docs/plans/2026-11-08-a5b-raw-stock-business-date.md`; accepted with the merge of PR #64 (marked accepted by the lead, 2026-11-11); Q-A5b-3 stays a parked hint (Phase 2 scope)

## Context
- Founder decision A5: batch discards count on the business day (cut-off from tenant settings, 02:00 by default, Europe/Rome). A5 (PRs #49, #50) applied it to `batch_movement` and raw waste by reading `created_at` over `[app.business_day_start(D), app.kpi_cutoff_end(D))`.
- Every ledger writer stores `effective_on = app.venue_date(...)` (calendar day) and leaves `created_at` at `now()`; receipts store the invoice date (founder M5 Q1).
- Ledgers are append-only (ADR-002): `app.append_only()` refuses every UPDATE, so stored dates cannot be corrected.

## Decision
Reports group `stock_movement` and `batch_movement` rows by the business day of `created_at`, computed as one instant range per report, never by `effective_on`. The one exception is `stock_movement` receipts, which keep the invoice date in `effective_on` and are read by it. Writers do not change; no row is backfilled.

## Alternatives
- Write the business date into `effective_on` for new rows: old rows stay wrong and cannot be updated; the column would mean two things by row age.
- Reverse and repost misdated rows: doubles the ledger and the reposts get the wrong `created_at`.
- A stored `business_on` column: cannot be filled for old rows; freezes the cut-off at write time.

## Consequences
- Good: old and new rows behave the same with zero writes; one rule for raw and batch, so `stock_reconciliation`, AVT, `waste_costs` and the KPI report agree for the same night.
- Bad / accepted trade-offs: `effective_on` of non-receipt rows is a calendar date no report reads (documented by column comments); changing a tenant's cut-off re-dates its history on the next read; a writer that sets `created_at` or a client time would break reports (pgTAP 259 G1 guards it); the readers filter `created_at` by instant ranges computed up front and passed as parameters (a run-time subquery bound made the planner scan the ledger), served by `stock_movement_tenant_at_idx`, so the date-only `stock_movement_consumption_idx` is dropped (plan §3.5, measured in §3.2).
- What would make us revisit this: a writer that must record a back-dated or client-timed movement, or a founder decision to date receipts by approval (Q-A5b-1).
