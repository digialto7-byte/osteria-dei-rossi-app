# ADR-026: "Push today" keeps its current state on `menu_item` and its history in an append-only `menu_push` log; the temporary price never enters the price history

- **Status:** proposed
- **Date:** 2026-10-31
- **Decided by:** architect, on the M23 plan (`docs/plans/2026-10-31-m23-push-forecast.md`). Awaiting the founder with the plan.

## Context

- **PRD:**
  - 4.1: "One tap marks a plate as 'push today': it is pinned in the waiters' menu (Module 3.2) and can carry a temporary price."
  - 3.2: "items on today's push list are pinned at the top of the menu with a small marker".
  - Risk table: "Shelf life values set wrong → weekly report of discards vs push". That report must know, for a past week, which plates were pushed and when.
- **What already exists (merged, M17/M18):**
  - `menu_item.push_until` and `menu_item.push_price` (with `menu_item_push_ck`: no price without an end). M17's comment says they are "written by M23 only". No procedure writes them yet.
  - "Pushed" is derived, never stored: `push_until > now()` (`menu_list`, `menu_list` availability, `add_order_line`). pgTAP `153`, `162` and `163` pin this.
  - `add_order_line` freezes the line price: the push price while the item is pushed (`price_source = 'push'`), else the menu price in force (`price_source = 'menu'`).
  - `menu_item_price` is append-only: the price in force is the newest row with `valid_from` not after the instant asked.
- **Invariants:** append-only ledgers, nothing deleted, every table with `tenant_id` and RLS, prices and costs frozen at sale (CLAUDE.md, ADR-002, ADR-003, ADR-016, ADR-017).
- **The problem:** the two `menu_item` columns are overwritten by every push and every stop. On their own they cannot say, next week, whether a plate was pushed on Wednesday.

## Decision

- **The current state stays where M17/M18 read it.** `public.push_menu_item` (owner, admin) sets `menu_item.push_until` and `push_price`, or clears both to stop a push. No reader changes: the waiter menu, the pinned strip and `add_order_line` keep working unchanged.
- **Every change is also one row in a new append-only table, `public.menu_push`, written in the same transaction:**
  - `action` is `start` (with `push_until`, an optional `push_price` and a snapshot of the batch recipe keys the plate's current version uses) or `stop`;
  - a start row's effective end is the earlier of its `push_until` and the next row's `created_at` for the same item. It is computed at read time with `lead()`, never stored;
  - update, delete and truncate are refused (the demo purge excepted, ADR-018). RLS lets owner and admin read it.
- **The temporary price never touches `menu_item_price`.** The menu price history stays the menu price history. A sale at the push price is already frozen on its `order_line` with `price_source = 'push'`. The KPI reports therefore use the price actually charged.
- **The batch keys are snapshotted at push time,** so a later recipe version that drops or adds a batch cannot rewrite which batches a past push covered.
- **"Push today" ends at the end of the current business day:** `push_until = app.kpi_cutoff_end(tenant, app.business_date(tenant, now))`. That is the next cut-off, computed with M11's DST rule and reused from M22. No cron job is needed: a push simply stops being "pushed" when the instant passes.

## Alternatives

- **Write the temporary price as a `menu_item_price` row and a second row to restore the old price at the end.**
  - Pros: one price source.
  - Cons: the restore needs a scheduled job or a lazy write. A missed restore leaves the discount in force. The price history would show discounts as menu price changes. M18's `price_source` distinction would be lost.
  - Why not: it corrupts the meaning of the immutable price history.
- **Record pushes only in `audit_event`.**
  - Pros: no new table.
  - Cons: it widens the shared audit check lists. The audit is a free-form before/after record and has no batch-key snapshot. The weekly report would have to parse JSON.
  - Why not: a typed log is smaller to query and to test.
- **Keep only the log and derive the current state from it (drop the two columns).**
  - Pros: one source of truth.
  - Cons: it replaces `menu_list`, the availability read and `add_order_line`, which are md5-pinned by earlier milestones, for no user-visible gain.
  - Why not: a larger change than the milestone needs. The two columns are written only together with the log, in one transaction, so they cannot drift.
- **No history at all.**
  - Why not: the PRD's "discards vs push" report cannot be built.

## Consequences

- **Good:**
  - no M17/M18/M19 function changes;
  - pushes are auditable (who, when, until, at which price);
  - the weekly report reads one small indexed table;
  - the price history and the frozen sale prices keep their meaning.
- **Bad / accepted trade-offs:**
  - two places hold push data. This is mitigated by a single writer (`push_menu_item`), one transaction, and a pgTAP check that the latest start row matches the columns;
  - a push made directly in SQL by an operator (tests, support) would bypass the log. Only the definer function has write access for API roles; fixture writes in tests are explicit.
- **What would make us revisit this:**
  - pushes per time slot (lunch/dinner) or scheduled pushes;
  - Phase 2 sell-through (M38), which reads this log and may need the line-level link `order_line.price_source = 'push'`, which already exists;
  - the founder's answers to Q156–Q158.
