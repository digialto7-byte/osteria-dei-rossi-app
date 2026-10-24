# ADR-012 — Counts: expected quantity snapshotted per line under the stock lock, differences posted at close as normalising count movements; nightly invariant check as a SQL job with a replaceable checks body

- **Status:** proposed
- **Date:** 2026-10-23 · **Decided by:** architect, within ADR-002 (append-only ledgers, derived balances), ADR-003 (tenancy and RLS), ADR-006 (in-app alerts, `app.job_run`), ADR-008 (cost basis) and ADR-011 (raw stock ledger, FEFO, stock lock). Founder decisions in force: Q16 = V6 (the chef never sees €), alerts in the app only with the owner as recipient and admin reading none (M6, 2026-10-23), M12 Q1 (owner, admin and chef write stock). The M13 plan `docs/plans/2026-10-23-m13-counts.md` §7 Q33–Q39 are open, with their defaults in force.

## Context
- PRD 2.1: a daily quick count of the 15–20 critical ingredients ("the app shows the expected quantity and asks only for the actual"), a monthly full count, a variance report (expected vs counted, units and €) and an audit log. PRD acceptance: "opening + receipts − consumption − waste ± adjustments = counted for every ingredient". PRD NFR: a nightly job that checks ledger invariants.
- Plan §3.5.1: `count_session (location_id, type, started_by, closed_at)`; "count lines are stock_movements of type count". M12 reserved the `count` type (`ref_type 'count_session'`), made counts non-reversible through `reverse_movement`, and required `close_count` to take the per-ingredient stock lock (ADR-011, M12 plan §3.9).
- ADR-011 lists "counts needing to correct individual lots" as a reason to revisit it: after a shortfall, lot balances can overstate what is physically there, and the unlotted bucket can be negative. A count is the moment that truth is known.
- A count takes time (a monthly count can take an hour), and the kitchen keeps working: waste, transfers, reversals and, later, batches (M14) and fired plates (M19) land while it is open. "Expected" needs one definition that stays right when that happens.
- `approve_invoice` takes no stock lock (M12 known limit) and receipts are dated by invoice date (M5 Q1), often days after the goods arrived.
- `app.job_run` has no tenant (ADR-006); `app.alert_refusal` records alerts refused or rules failed (M8, M9) and both M8 and M9 asked M13's job-health check to read it. The `extract` job only runs while an invoice is waiting.

## Decision
- **Expected = the location total read under the stock lock at the moment the line is entered, stored on the line.**
  - Saving a line (`count_record_lines`) takes the session row `FOR SHARE`, then `app.lock_ingredient_stock` for the ingredients of the call (id order), then reads `app.location_on_hand` and stores it in `count_line.expected_qty` with `counted_qty`, `entered_at`, `entered_by`. Re-entering a line refreshes the snapshot.
  - The difference posted at close is `d = counted_qty − expected_qty` of that line. Anything recorded after the line was entered applies on top: after close, the location total = counted + the movements recorded after entry.
  - `expected_qty` is a recorded fact of the count ("what the app expected when you counted"), never read as a balance. Balances stay the fold of `stock_movement`.
- **The difference is posted at close, only where `d ≠ 0`, as `count` movements that also normalise the buckets.**
  - `count_close` takes the session `FOR UPDATE`, then the stock locks of every counted ingredient (id order). For each line with `d ≠ 0`, with the current buckets (positive lots `P`, unlotted bucket `U`, total `E`) and target total `T = E + d`:
    - `T ≥ P`: lots unchanged; the unlotted bucket becomes `T − P` (≥ 0): one row `T − P − U`;
    - `0 ≤ T < P`: the unlotted bucket becomes 0; `P − T` is taken from the lots in FEFO order (`app.fefo_buckets`); one row per lot touched and one row `−U` if `U ≠ 0`;
    - `T < 0` (only possible when outflows after entry exceeded the count): every lot to 0, the unlotted bucket becomes `T`.
  - The rows of one ingredient sum to `d` exactly. No lot is ever driven below zero, and after a count with a difference the unlotted bucket is never negative unless the total is.
  - `unit_cost` on every count row = the ingredient's basis in force at close (`app.ingredient_unit_costs(…, null)`), null when unknown, never 0. Variance € = Σ(qty × unit_cost), owner/admin only.
  - `effective_on` = the Europe/Rome date of the close. `ref_type 'count_session'`, `ref_id` = the session. The close is one transaction.
  - A count is never reversed. A wrong count is corrected by another count.
- **One open session per location**, types `daily` (active stock ingredients flagged critical) and `monthly` (every active stock ingredient plus any with a non-zero total there). Sessions end `closed` or `cancelled` (nothing deleted). Lines are a working table while the session is open and immutable afterwards (trigger).
- **Nightly invariant check `app.run_ledger_invariants(p_at)`, a pg_cron SQL job (`ledger-invariants`, `45 2 * * *` UTC).**
  - Fixed runner, like `app.run_alert_rules`: `job_run` begin → per tenant, in its own savepoint, `app.ledger_checks_body(tenant, p_at)` (ledger checks, **one SQL statement, so one snapshot**) and `app.job_health_checks(tenant, p_at)` → one `ledger_drift` alert per tenant per Rome day listing every failing check → `job_run` end. A failing tenant block is recorded in `app.alert_refusal` (`check_failed`) and does not stop the others.
  - Later milestones extend the check by `create or replace` of `app.ledger_checks_body` (M14 batches, M19 order lines), keeping every earlier check; their pgTAP asserts the earlier checks still fire.
  - One alert kind `ledger_drift`: not cost-bearing, severity `critical`, audience `{owner}`, entity `tenant`, payload of check keys, counts and sample ids only. In the app (M6 channel); no email.

## Alternatives
- **Expected = snapshot at close.** Pros: nothing stored on the line. Cons: a waste recorded between counting a shelf and closing is erased by the count (the count row puts it back), and a monthly count spans an hour of service. Rejected.
- **Expected = snapshot when the session opens.** Cons: every movement during the count is counted twice or lost. Rejected.
- **Expected by movement timestamps (`created_at ≤ entered_at`).** Pros: nothing stored. Cons: `created_at` is the transaction start, so a movement that started before the entry but committed after it is misclassified; the lock-ordered snapshot has no such gap. Rejected.
- **Post the difference as one unlotted row.** Pros: one row per line. Cons: lots keep overstating stock after a shortage, FEFO keeps taking lots that are not there, and a negative unlotted bucket survives the count that was meant to fix it (ADR-011's revisit trigger). Rejected.
- **Count each lot separately.** Pros: exact lot balances. Cons: one input per lot breaks the PRD's "one number per ingredient, under 5 minutes"; most lots have no printed code to find on the shelf. Rejected for the MVP.
- **Rebalance even when `d = 0`** (zero-net rows that clear a negative unlotted bucket). Cons: contradicts M13 acceptance test 2 ("movements posted only where actual ≠ expected"). Rejected; recorded as a known limit.
- **Invariant check in the hourly `alert_rules_body`.** Cons: replaces a body pinned by md5 in `075`, runs 24 times more often than needed, and couples a drift scan to the rules' savepoint. Rejected.
- **Checks as rows of a registry table with dynamic dispatch.** Rejected for the same reason as M6's rule registry: dynamic SQL for a handful of checks; a replaceable body is simpler and pgTAP can stub it.
- **Two kinds (`ledger_drift` and `job_stale`) as sketched in the M6 kind table.** Pros: separate dedup. Cons: two alerts on a bad night for one cause, one more registry entry in every parity list. Rejected: one alert per tenant per night lists every failing check.

## Consequences
- **Good:**
  - Balances stay derived; a count is a set of ordinary ledger rows, explained by the variance report and the audit log.
  - The posted difference is right however long the count takes, because each line's snapshot and every later movement are ordered by the same stock lock.
  - After a count with a difference, lots and the unlotted bucket are clean again, so FEFO, M14 traceability and M16 expiry alerts read real quantities.
  - The reconciliation identity is a fold by movement type, so it holds by construction and the report can flag any type it does not classify.
  - A silent scheduler, failed rules, refused alerts or a corrupted ledger reach the owner the next morning.
- **Bad / accepted trade-offs:**
  - A line counted equal to its expected quantity posts nothing, so an imbalance between lots and the unlotted bucket with a correct total survives until a count with a difference.
  - Receipts are not serialised with line entry (no stock lock in `approve_invoice`), and they are posted at approval, not delivery: goods delivered but not yet approved are counted as a surplus, then added again at approval. The count screen shows how many invoices await approval.
  - A reversal posted after a count of the same ingredient adds back stock the count already saw as missing.
  - Job-level findings (`app.job_run` has no tenant) appear in every tenant's alert.
  - The owner sees drift only in the app; DigiAlto support (admin) reads no alerts unless variant V1 is chosen.
- **What would make us revisit this:** lot-level counting being required; counts that must be dated by the business day with a cut-off; receipts dated by delivery and posted on arrival; multi-venue volume making the nightly full scan slow; an outbound alert channel (email) being approved.
