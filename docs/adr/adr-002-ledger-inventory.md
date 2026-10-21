# ADR-002 — Append-only movement ledgers with derived balances and transactional stored procedures

- **Status:** proposed
- **Date:** 2026-10-21 · **Decided by:** founder

## Context
- The PRD (Module 2 intro, "Integrity rules enforced in Postgres", NFR Auditability) requires the following:
  - "Both layers are ledgers of movements, never editable balances, so the monthly audit can always explain a number."
  - "Stock balances are views over movement ledgers."
  - "Batch production and order firing are single transactions (stored procedures) so partial writes cannot happen."
  - "Recipes are immutable rows with a version number and a valid_from."
  - "Nothing is deleted, only reversed."
- The PRD's acceptance criteria depend on this design:
  - The variance report must reconcile opening + receipts − consumption − waste ± adjustments = counted for every ingredient.
  - A batch must reduce raw stock and create N portions in one transaction.
  - A fired plate must reduce the right batch by one portion.
- There are two layers that move at different moments:
  - Raw stock moves on invoice approval and on batch production.
  - Worked batches move on production and on order firing.
- Traceability (invoice line → raw lot → batch input → batch → order line) has to fall out of the ledger.

## Decision
- **Two append-only ledgers:**
  - `stock_movement` (raw layer: receipt, consumption, count, waste, transfer; with lot, location and unit cost).
  - `batch_movement` (worked layer: produce, consume, count, waste, split).
- **Supporting tables:** `raw_lot`, `batch_input`, `price_history` and `audit_event` are also append-only.
- **Mutation is blocked:** triggers raise on `UPDATE`/`DELETE` for every role, the secret key included. Corrections are reversing movements that point to the original row through `reverses_id`.
- **Balances are only derived:** `v_stock_on_hand` and `v_batch_portions` are `security_invoker` views. No balance column exists anywhere.
- **Every ledger write goes through a `SECURITY DEFINER` procedure:** `approve_invoice`, `produce_batch`, `fire_course`, `void_line`, `consume_raw_fefo`, `post_waste`, `post_transfer`, `close_count`, `adjust_batch`, `discard_batch`, `split_batch` and `reverse_movement`.
  - Each runs as one transaction and takes the tenant and user from the JWT.
  - Each checks the caller's role.
  - Clients have no direct INSERT on ledger tables.
- **Recipes are immutable versioned rows.** Cost is frozen where history matters: `batch_cost` at production and `order_line_cost` at firing.
- **Negative balances are allowed and alerted, never blocked, at firing.** The food has already been served, and blocking would lose the sale record. Order entry is still blocked when the mapped batch has 0 portions (PRD 3.2).
- **A nightly `check_ledger_invariants()`** emails the owner about any drift.

## Alternatives
- **Stored balance columns updated by triggers or application code.** Pros: fast reads. Cons: balances can drift from movements and need repair jobs, and the audit cannot explain a number once it drifts. Why not: the PRD forbids editable balances. The volume (one venue, ~25 invoices a month, one service a day) does not need caching.
- **Event sourcing with a separate event store and projections.** Pros: a full history. Cons: more infrastructure, eventual consistency, and projection rebuilds. Why not: Postgres tables plus views give the same audit property with transactional reads.
- **Application-level transactions (TypeScript, several queries).** Pros: logic stays in TS. Cons: a partial write is possible on a crash or timeout in serverless functions, and roles would be enforced only in the API. Why not: the PRD requires single transactions and Postgres-enforced roles.
- **Soft deletes (`deleted_at`) on movements.** Pros: familiar. Cons: they rewrite history and break the reconciliation identity. Why not: the PRD says "nothing is deleted, only reversed".

## Consequences
- Good:
  - Every number is explainable.
  - The reconciliation identity holds by construction and is tested.
  - Traceability links exist from day one.
  - Partial writes are impossible.
  - The same procedures serve the UI, offline replay and the Phase 3 assistant.
- Bad / accepted trade-offs:
  - More logic lives in SQL (plpgsql), so it needs pgTAP tests and SQL-literate review.
  - Views recompute on every read. If they become slow, materialisation or indexed rollups are the fix (KPIs are already materialised nightly).
  - Allowing negative balances means alerts must be acted on.
  - Corrections take an extra step (a reversal plus a new movement) rather than an edit.
- What would make us revisit this:
  - View latency breaks the PRD NFRs (dashboard under 2 s, order entry under 300 ms) at multi-venue volume. The response would be cached aggregates rebuilt from the ledger, never editable balances.
  - A regulatory need for a different audit format.
