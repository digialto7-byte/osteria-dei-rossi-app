# ADR-013 — Batch production: a portion ledger beside an immutable batch row, cost split out, production through the M12 engine, lot codes under an advisory lock, use-by in elapsed hours

- **Status:** proposed
- **Date:** 2026-10-23 · **Decided by:** architect, within ADR-002 (append-only ledgers, derived balances), ADR-003 (split cost tables), ADR-007 (immutable recipe versions), ADR-008 (frozen costs are copies, unknown is never zero), ADR-011 (the FEFO engine and the stock lock), and the founder's decisions already in force: Q16 = project V6 (the chef never sees €) and M12 Q1 (admin writes stock like owner and chef). The M14 plan `docs/plans/2026-10-23-m14-batch-production.md` §7 Q40–Q47 and project Q19 are open, with their defaults in force.

## Context
- PRD 2.2 and Module 2 acceptance:
  - the chef picks a batch recipe, enters the actual output, and the app proposes the raw consumption scaled to that output;
  - the ledger records the quantities the chef confirms;
  - portions = output ÷ portion size; shelf life from the recipe, overridable; use-by; lot `YYMMDD-recipe-seq`;
  - the batch cost is frozen at production "with the raw lots consumed";
  - production reduces raw stock and creates N portions **in one transaction**.
- Traceability: the batch → raw lots link is stored at production (M31 builds the trace on it).
- Project plan §3.5: `batch`, `batch_input`, `batch_movement`, `batch_cost` (cost split out of `batch` for role isolation), `v_batch_portions`; §3.6: balances only derived, append-only ledgers, negative balances allowed and alerted.
- What exists:
  - M7: immutable recipe versions; batch lines hold ingredients and sub-recipes (never batches); nesting ≤ 12;
  - M8: `app.ingredient_unit_costs(…, p_at)`, null when unknown;
  - M12: `app.post_stock_outflow` (FEFO, override lot first, explicit unlotted shortfall, contained `negative_stock` alert, cost on every row) and `app.lock_ingredient_stock` (id order, re-entrant).
- Later callers: M15 (adjust, discard, split, states), M16 (expiry, prep), M19 (portion depletion and order cost).

## Decision
- **Two ledgers, one call.** `produce_batch` is one SQL function: it consumes every confirmed input through the M12 engine (`ref_type 'batch'`, `ref_id` = a pre-generated batch id), then writes the `batch` row, one `batch_input` per consumption movement (lot or null for a shortfall), the `batch_cost` row and one `produce` movement of N portions. Any error rolls back everything.
- **Portions only in `batch_movement`.** `v_batch_portions` folds the movements; `batch.portions_initial` is the produced fact, equal to the `produce` movement. The movement type enum is complete now (`produce, consume, count, waste, split`), but M14 allows only `produce`; M15/M19 replace the shape constraint.
- **The batch row is immutable except `state`**, and pins the recipe version (`recipe_id`, `recipe_key`, `recipe_version`, checked by a guard). `portions_computed` is stored beside the confirmed `portions_initial`.
- **Requirements are computed in SQL** by expanding sub-recipes level by level (summed factors per key per round, no path enumeration), with sub versions in force at production; the proposal and the validation share the function.
- **Cost copied at production** into `batch_cost`: Σ(−qty × unit_cost) of the batch's consumption rows at the basis in force at `produced_at`, per portion = total ÷ `portions_initial`, incomplete (null, flagged, missing ingredients listed) when any input has no price. Owner and admin read it; the chef and the waiter read none of it (RLS, and `batch_costs` checks the cost-reader role).
- **Lock order:** all input stock locks in one sorted call before any outflow, then one advisory lock per (tenant, Rome day, printed recipe code) for the lot sequence; global order recipe graph → cost → stock → batch lot. `produce_batch` takes neither the recipe-graph nor the cost locks (immutable versions, one-snapshot expansion, one cost read).
- **Lot code:** Rome calendar date, a 6-character code derived from the recipe name, and `max + 1` under the lot lock, keyed by the printed code; unique `(tenant_id, lot_code)` as the backstop.
- **Use-by = `produced_at + make_interval(hours => shelf_life_hours)`**: elapsed hours, independent of the session time zone, shown in Europe/Rome.

## Alternatives
- **A counter table for lot sequences** — pros: one row per counter — cons: mutable state beside the ledgers, its own RLS and fixtures — why not: an advisory lock plus `max + 1` and a unique index give the same guarantee with nothing new to protect.
- **A Postgres `SEQUENCE`** — pros: built in — cons: not transactional (rolled-back productions burn numbers), not per day — why not: the code must restart every day and have no gaps from failures.
- **A per-`recipe_key` counter with a derived code** — pros: literally "per recipe" — cons: two recipes with the same 6-character prefix would print identical lot codes on the same day — why not: keying by the printed code equals "per recipe" whenever codes differ and never duplicates.
- **Cost on `batch` with a chef-hiding view** — cons: the cost would sit beside rows the kitchen and later the waiter path read — why not: ADR-003 split-table rule and Q16 = project V6.
- **Recomputing the batch cost from the recipe when reported** — cons: a price change would rewrite past batches, and the actual inputs differ from the recipe — why not: ADR-008 and PRD 2.2.
- **Calendar-day use-by (`interval 'N days'`, or same clock time)** — pros: the same clock time on the label — cons: the stored shelf life is in hours, and the elapsed time would be 71 or 73 hours across DST — why not for now: kept as plan variant V1 behind Q40.
- **Refusing production when recorded stock is short** — cons: the food was cooked; refusing hides the recording error — why not: plan §3.6 rule 8; a confirmation step is plan variant V8 behind Q47.
- **Sub-recipe expansion in TypeScript** — cons: the validation must run inside the production transaction — why not: one SQL engine (M8).

## Consequences
- **Good:**
  - "Producing reduces raw stock by the confirmed quantities and creates N portions in one transaction" holds by construction and is tested with injected faults.
  - Portions are only derived; the nightly invariant (M13) can check `produce` = `portions_initial`.
  - The batch → raw lot link exists for every slice, the shortfall included (null lot), ready for M31.
  - The frozen cost never moves, is never 0 when unknown, and never reaches the chef.
  - Productions never deadlock with each other or with M12 writers; lot codes are never duplicated.
  - Use-by is the same instant whatever the server's or session's time zone.
- **Bad / accepted trade-offs:**
  - A wrong production cannot be undone until M15 (adjust, discard); batch consumption rows are not reversible through `reverse_movement`.
  - Two recipes whose names share 6 characters share a daily counter (`-1`, `-2` across both).
  - The label shows a use-by one hour later (spring) or earlier (autumn) in clock time than a "same time N days later" reading.
  - Receipts are still not serialised with production (inherited from ADR-011).
  - The chef sees colleagues' initials on batch lists and labels (a HACCP label field).
- **What would make us revisit this:**
  - the founder choosing clock-time use-by (Q40), recipe-chosen lot codes (Q41), extra inputs (Q42) or exact per-lot quantities (Q46);
  - batches inside batches (M7 Q4), which would make a batch consume portions of another batch;
  - multi-venue tenants, where the lot code needs a venue part and the lock key a venue id.
