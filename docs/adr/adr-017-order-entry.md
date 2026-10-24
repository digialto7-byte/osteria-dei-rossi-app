# ADR-017 — Order lines: client ids, last write wins per line with a conflict reply, price frozen at entry, availability under shared batch locks

- **Status:** proposed
- **Date:** 2026-10-24 · **Decided by:** founder (on the M18 plan; defaults Q75–Q81 open)

## Context
- PRD requirements:
  - 3.1: "Multiple waiters can edit the same table; last write wins per line, no locking."
  - 3.2: items mapped to a batch with 0 portions are greyed and cannot be ordered; "3 portions left" hint; pushed items pinned; half portion 0.5; shared plate.
  - 3.5: orders queue offline and sync in order; conflicts are resolved server-side by timestamp with a visible warning.
  - NFR: order entry under 300 ms on 4G.
- ADR-005 (offline queue) needs two things from M18:
  - entity ids generated on the client;
  - writes that are safe to replay.
- Project §3.6.4 requires sale prices and costs frozen at sale. M17 (ADR-016) gives every menu item a price history and push fields (`push_until`, `push_price`).
- Firing is the depletion event (PRD 2.3; M19). M15's batch actions and M19's firing take batch rows FOR UPDATE.
- Waiters must never read costs (§3.11.2). `004`/`059` forbid waiter-readable `unit_price` columns.

## Decision
- **Client-generated line ids.** `order_line.id` comes from the client. A repeated add with the same id answers the existing line (`created: false`) and writes nothing. A second add racing on the same id is caught at the PK and answered the same way.
- **Last write wins per line, decided on the server.** Every write carries `clientUpdatedAt`. Under a row lock the server applies these rules in order:
  1. fired, voided and closed states win over any timestamp;
  2. an older timestamp loses;
  3. an equal timestamp with equal content from the same user is a no-op replay;
  4. otherwise the write applies.
  - A loser gets 409 `conflict` with the current line, so the waiter is warned with the line as it now is.
  - Client time more than 120 s ahead of the server is refused.
- **The sale price is frozen at entry.** `unit_price` (the push price when a push is active, else the menu price in force), `vat_rate` and `price_source` are written at add and never change. The cost stays frozen at fire (M19 `order_line_cost`, which waiters cannot read).
- **Availability is checked at entry under shared batch locks.** The add takes FOR SHARE on the dish's live batch rows, then computes portions left from `v_batch_portions` in a new statement, and refuses at 0 (`item_unavailable`). Discards, adjustments and firing serialise with it; adds do not wait for each other. Unsent lines reserve nothing.
- **Nothing is deleted.** Removing a line before fire voids it with `entry_removed`. `state` is a generated column over `fired_at`/`voided_at`.

## Alternatives
- **Price at fire** — pros: one moment for price and cost. Cons: a push ending between order and fire changes the price quoted at the table, and offline replays re-price. Why not: the sale is agreed at the table (kept as variant V5 of the M18 plan).
- **Optimistic locking with version numbers** — pros: no silent overwrite. Cons: contradicts "no locking"; frequent rejections during service. Why not: PRD 3.1 and ADR-005.
- **LWW by server arrival time** — pros: immune to client clocks. Cons: a slow request carrying the earlier edit overwrites the later one, and queued offline ops would always win on arrival. Why not: the PRD asks for timestamp resolution. Server time is recorded beside it and the clock is bounded.
- **An `applied_op` table in M18** — pros: generic op dedupe now. Cons: it duplicates M20's design before the outbox exists. Why not: entity-id idempotency covers M18; M20 adds `applied_op` on top.
- **Reserving portions for unsent lines** — pros: earlier warning for the waiter. Cons: abandoned drafts hold stock, and adds of one dish must serialise. Why not: the PRD blocks on batch portions and depletes at fire (kept as variant V2).
- **Advisory locks or `serializable` for the availability check** — pros: no row locks. Cons: a new lock class to order against M15's row locks, or retries. Why not: FOR SHARE matches the existing FOR UPDATE writers exactly.
- **A waiter RLS policy on `order_line`** — pros: simpler reads. Cons: `unit_price` becomes waiter-readable column-wise and trips `004`/`059`. Why not: definer reads with fixed key sets, as M17.

## Consequences
- Good:
  - Replays are safe before M20 exists.
  - Two waiters never silently lose an edit.
  - Bills (M21) and revenue (M22) read frozen per-line prices and VAT rates.
  - A dish that runs out is refused even under concurrent discards.
  - The menu read stays one call.
- Bad / accepted trade-offs:
  - A phone clock more than 2 minutes fast cannot write until fixed.
  - Equal-millisecond edits from two users: the first applied wins.
  - A batch produced during an add is seen on the next request.
  - Pushed prices persist on lines even after the push ends.
  - Draft lines do not reserve portions, so a shortage can appear at fire (M19 records it and raises the alert).
- What would make us revisit this:
  - Founder answers to Q76 (reservations), Q78 (cap at portions left) or Q79 (price at fire).
  - AT7 showing the availability check or the PIN-session round trip dominates entry time.
  - The supervised run showing frequent conflicts between waiters.
