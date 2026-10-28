# ADR-019 — Firing depletes FEFO with recorded shortages, voids after firing are reversal + waste, the kitchen list polls

- **Status:** proposed
- **Date:** 2026-10-28 · **Decided by:** founder (on the M19 plan; defaults Q97–Q105 open)

## Context
- PRD requirements:
  - 2.2: "Portions deplete from the oldest fresh batch first (FEFO). A plate that uses half a portion depletes 0.5."
  - 2.3: "When the item is sent to the kitchen (not when the table closes), the app depletes batch portions and direct raw ingredients." "Voids restore stock if the item was not yet fired; after firing, a void becomes waste with a reason."
  - 3.3: "Send" fires a course; the kitchen sees a chronological ticket list; "Re-fire of a course after a kitchen error is a void with reason."
  - NFR Offline: "kitchen screen shows a stale banner after 60 s without a heartbeat". Accessibility: "high-contrast kitchen mode".
- ADR-002 and project plan §3.6 rule 8: negative balances are allowed and alerted at firing, never blocked, because the food has been served.
- ADR-017 (M18): lines are client-id'd, priced at entry, and do not reserve portions. M18 left `fired_*`, `voided_*`, `void_reason` on `order_line` and a guard that lets a fired line change only by being voided.
- M15 (ADR-014): `batch.state` follows the ledger (`app.batch_settle_state`); the nightly check requires finished/discarded exactly when remaining ≤ 0.
- Founder Q16 = project V6: the chef never reads a euro figure (pgTAP `059`).
- M0 chose HttpOnly session cookies and no browser Supabase client (`src/lib/supabase/cookies.ts`), so the browser holds no access token.

## Decision
- **One procedure fires a set of lines** (`fire_course(p_session, {lineIds})`), in one transaction: lines FOR UPDATE, then the raw stock locks, then the batch rows FOR UPDATE. Each line takes `qty × need` portions per batch key of its plate's current version, FEFO over unexpired fresh/open batches (use_by, produced_at, id), and its raw ingredients through the M12 FEFO engine across locations. Lines already fired or voided are skipped, so a replay changes nothing.
- **A shortage never blocks.** What the live batches cannot cover is booked on the last batch drained (or, with none live, on the most recent non-discarded batch of the key), which goes negative and is settled `finished`. A `negative_stock` alert (entity `recipe_key`) is raised in a contained block. With no batch of the key at all, nothing is booked and the cost row lists the key as unbooked.
- **The cost is frozen at firing** in `order_line_cost`: the depleted batches' frozen unit costs plus the raw movements' unit costs. Unknown is never zero (`incomplete` with the missing ids). Readable by owner and admin only (Q16 = V6), select-only for `service_role`.
- **A void before firing writes no movement. A void after firing writes, per consumption row, a reversal (`reverses_id`) and a waste row with the reason mapped to the existing waste codes.** Stock is not restored. Nothing is deleted. Re-fire = void with reason + a new line, fired.
- **The kitchen list is a polled read** (`GET /api/kitchen/tickets`, every 5 s while visible), grouped by table, firing, course and segue, with no price or cost. The stale banner shows when the last successful read is more than 60 s old (client clock).

## Alternatives
- **Block firing on shortage** — pros: balances never negative. Cons: loses the sale record of food already served. Why not: ADR-002, §3.6 rule 8.
- **Void after firing = waste row only, no reversal** — pros: one row. Cons: the plate then counts as both consumption and waste, so M16's forecast and M22's sold-vs-waste double count. Why not: reversal + waste keeps each total right and is how M12 corrects.
- **Void after firing restores the portions** — Why not: PRD 2.3 says it becomes waste.
- **Supabase Realtime on the kitchen screen** (project §3.1) — pros: instant. Cons: needs the user's access token in the browser, which M0 deliberately keeps HttpOnly; RLS on `order_line` gives the chef no rows anyway. Why not now: kept as M19 variant V2 (Q98).
- **A `kitchen_ticket` table** — pros: an explicit ticket id and later "done" state. Cons: a second write per fire and a second idempotency key. Why not: tickets are derived from (session, fired_at, course, segue); M40's bump bar can add a table.
- **Chef can read `order_line_cost`** (project §3.5.2 base plan) — Why not: Q16 = V6 removed every chef cost read.

## Consequences
- Good: every fired plate is in the ledger with its batch and lots (traceability); replays are safe before M20; the chef sees quantities only; balances stay derived.
- Bad / accepted trade-offs: a negative batch must be fixed by a count (M15 `adjust_batch`); a batch produced during a fire is used only from the next fire; the kitchen sees a new ticket up to 5 s late; tickets have no "done" state in the MVP.
- What would make us revisit this: founder answers to Q97 (segue), Q98 (instant kitchen), Q99 (chef sends), Q100 (one service location), Q101 (expired batches); the supervised run showing frequent shortages.
