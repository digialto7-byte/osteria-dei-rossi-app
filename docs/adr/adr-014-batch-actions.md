# ADR-014 — Batch actions: split as a new batch, ledger-driven state, waste valued at read

- **Status:** proposed
- **Date:** 2026-10-24 · **Decided by:** founder (on approval of the M15 plan `docs/plans/2026-10-24-m15-batch-actions.md`)

## Context

M15 lets the kitchen correct the worked layer: adjust, discard, split, reprint, and staff meals (PRD 2.2 "Manual actions on a batch", 2.5). The merged M14 SQL constrains how that can be done:

- `batch` is immutable except `state` (`app.batch_guard`).
- `batch_use_by_ck` requires `use_by − produced_at = shelf_life_hours` in elapsed hours.
- `batch_lot_code_ck` fixes the lot format `YYMMDD-<CODE>-<seq>`.
- `split_from_batch_id` is already reserved.
- The chef reads `batch_movement` but not `batch_cost` (ADR-003, Q16 = project V6).

There are also project-wide requirements:

- Balances are derived only (§3.6 rule 1), and the ledgers are append-only (rule 2).
- Every procedure is one transaction (rule 3).
- Costs are frozen at production (ADR-008).
- Later milestones depend on these decisions: M19 (sales depletion), M23 (discards vs push) and M31 (trace).

## Decision

1. **A split creates a new `batch` row** that has:
   - `split_from_batch_id` = the parent;
   - the parent's recipe version, `produced_at` and `produced_by`;
   - a new lot code in the M14 scheme on the split day, numbered under the same lot lock as production;
   - a shelf life counted from the original production and rounded down to the hour;
   - a copy of the parent's frozen cost per portion;
   - the parent's location when none is given (an id that is given must be an active location of the tenant).

   The two batches are joined by a pair of `split` movements (−n on the parent, +n on the child) that share `ref_type 'batch_split'` and `ref_id` = the child.
2. **`batch.state` is written only by the batch procedures**, through one helper (`app.batch_settle_state`), in the same transaction as the movement:
   - remaining ≤ 0 → `discarded` if the last action was a discard, else `finished`;
   - remaining > 0 after any change → `open`;
   - `fresh` until the first change.

   The nightly invariant check verifies the state against the ledger.
3. **Batch waste carries no € on the ledger.** Its value is `portions × batch_cost.unit_cost_frozen`, computed at read time by the owner/admin-only `waste_costs` report, which also wraps the raw report. Only movements with a complete cost are valued: an incomplete batch is counted (`unvaluedCount`, also per line) and never nulls or hides the value of the complete batches beside it.
4. **Once-per-day staff meals** are enforced by a unique `(tenant_id, rule_id, business_date)` on a small append-only `staff_meal_confirmation` table. The business date uses M11's cut-off helpers.
5. **An ingredient staff-meal rule stores its resolved location.** `set_staff_meal_rule` validates an explicit location, turns null into the single active location, and raises `location_required` when there are two or more. Confirming therefore never meets an ambiguous location.
6. **Global lock order:** ingredient stock locks → batch row locks (id order) → batch lot lock.

## Alternatives

- **Split as movements on one batch with a sub-lot column.** No new table, but the frozen part needs its own location, use-by, label and FEFO position. Rejected.
- **Child lot `<parent>-S1`.** The parent is visible in the code, but it breaks `batch_lot_code_ck` and hides the split day. Rejected; the label prints "Diviso da".
- **Child `produced_at` = the split time.** The use-by is exact, but the production time on the label is false and FEFO is wrong. Rejected.
- **State derived on read only.** There would be no write, but M14 already exposes the column, and M16/M19/M23 filter on it. Rejected in favour of one writer plus a nightly check.
- **`unit_cost` on `batch_movement`.** The € would be stored, but the chef would then read €. Rejected (ADR-003).
- **An advisory lock per rule and day for staff meals.** It works, but it is one more lock class, and the unique index already guarantees the rule. Rejected.

## Consequences

- **Good:**
  - Σ portions across a split is provable, and is checked nightly.
  - Labels and FEFO stay true.
  - No € reaches the chef.
  - The value of batch waste is fixed for good because `batch_cost` is append-only.
  - One lock order covers M12–M15 and binds M19.
- **Bad / accepted trade-offs:**
  - A split's use-by can be up to 59 minutes earlier than asked.
  - `state` is a column that must match the ledger. This is mitigated by the single writer and the nightly check.
  - M19 must call `app.batch_settle_state`.
  - Batch movements are not reversible until a reversal design exists (M15 V4).
- **What would make us revisit this:**
  - the founder wants an exact split use-by (it would need a change to `batch_use_by_ck`);
  - more than one staff meal per day (M15 V2);
  - reversals of batch operations (M15 V4);
  - a trace screen (M31) needing a stored root-batch id.
