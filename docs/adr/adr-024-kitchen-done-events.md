# ADR-024 — Kitchen "done" and comanda close are append-only events on a derived ticket key, set by idempotent procedures serialised per comanda

- **Status:** proposed
- **Date:** 2026-10-31 · **Decided by:** founder (request on 2026-10-31, through the lead, on the M19b plan; defaults Q136–Q144 open)

## Context
- **The request:** the chef marks each dish of a comanda "Fatto" with one tap and undoes it with another. A comanda closes in one tap, or by itself when every dish is done, and can be reopened. The request asks for append-only events (done, undone, closed, reopened), state derived from them, idempotent taps, single transactions, and role enforcement in Postgres. It overrides M19 Q105 ("no done button") and brings forward part of M40 (KDS bump).
- **M19 (ADR-019):** a comanda is derived, not stored. Its key is `(table_session_id, fired_at, course, segue)`, and one `fire_course` call shares one `fired_at`. ADR-019 rejected a `kitchen_ticket` table and left "a done state" to M40. The kitchen list polls every 5 s (Q98).
- **Pins and guards:** `fire_course` and `void_line` are md5-pinned (pgTAP `214`, `222`) and replayed by M20's `apply_op`. `app.order_line_guard` lets a fired line change only by being voided.
- **CLAUDE.md invariants:** ledgers are append-only and balances are derived; procedures are single transactions; roles are enforced in Postgres; the chef never sees €.
- **M20 (ADR-022):** kitchen writes are online-only.
- **M21 (ADR-023):** `close_table` takes the session FOR UPDATE and refuses unsent dishes.

## Decision
- **One append-only table, `public.kitchen_event`.**
  - **Line events** (`done`/`undone`) reference `order_line`. **Ticket events** (`closed`/`reopened`, cause `tap` or `auto`) store the four columns of the M19 ticket key. A shape check keeps the two kinds apart.
  - **Current state is derived:** the latest event by an identity `seq` wins, and a voided line is never done. No state column exists anywhere.
- **The comanda stays a derived key.** No ticket table is added, and `fire_course` is not touched. A later fire for the same table and course is therefore a new comanda.
- **Taps carry the target state, not a toggle.** `kitchen_mark_line(p_line, {done})` and `kitchen_set_ticket({sessionId, firedAt, course, segue, closed})` write nothing when the state already matches, so double taps and retries are safe.
- **Each write is one transaction.** It is serialised per comanda by `pg_advisory_xact_lock` on the key, and a line mark also holds the line FOR SHARE.
  - The `done` that empties a comanda also writes `closed auto` in the same transaction. An `undone` on a closed comanda also writes `reopened auto`.
- **Roles:** owner, admin and chef, through `app.require_kitchen_marker()` called first. The waiter gets 42501. Writes go only through the procedures: no API role has a write grant, and RLS select is limited to owner and admin.
- **Unchanged neighbours:**
  - kitchen writes are online-only and are not outbox op kinds;
  - `close_table` is not blocked by kitchen *state* (open dishes never stop a close). A ticket event's foreign key does take FOR KEY SHARE on the session row, so a ticket write and `close_table` can wait briefly for each other, in either order; there is no cycle (the kitchen takes its advisory lock first and nothing after the session row; `close_table` takes no kitchen lock);
  - the kitchen keeps polling;
  - the board read is replaced in place with counts, `remaining` and `closedTickets`, and no euro value.

## Alternatives
- **A `kitchen_ticket` table written at firing.**
  - Pros: an explicit ticket id.
  - Cons: it changes a pinned, offline-replayed procedure and adds a second write per fire.
  - Why not: the derived key is already unique per fire call.
- **`done_at`/`done_by` columns on `order_line`.**
  - Pros: simple reads.
  - Cons: it is an UPDATE of history, and the M18/M19 guard forbids changing fired lines.
  - Why not: the request and the append-only rule.
- **Toggle endpoints.**
  - Why not: a double tap or a retry would flip the state back.
- **Derived auto-close with no event row.**
  - Pros: one fewer row.
  - Cons: reopening a fully done comanda needs extra rules, and history would not show the close.
  - Why not: "latest event wins" stays the only rule.
- **Two event tables.**
  - Why not: twice the fixture, purge-list and pin updates for the same derivation.
- **Block `close_table` while the kitchen has open dishes.**
  - Why not: it puts a kitchen tap on the payment path and needs M21 and M20 changes. A warning is variant V2 of the M19b plan.
- **Realtime.**
  - Why not now: as in ADR-019, there is no browser token. The tapping device gets the board in the write reply.

## Consequences
- **Good:**
  - every tap is recorded and reversible without UPDATE or DELETE;
  - concurrent kitchen devices cannot double-close or miss the auto-close;
  - the waiter and the till flows are unchanged;
  - no euro value reaches the kitchen.
- **Bad / accepted trade-offs:**
  - one more table (demo purge list, role-scan fixtures and the public-table pins of `207`, `214` and `222` updated);
  - other kitchen devices see a tap within the 5 s poll;
  - a comanda of a closed table leaves the kitchen screen even with dishes open;
  - two fires sharing one microsecond would share a comanda (accepted, practically unreachable);
  - the event log records which staff member tapped and when (Q144).
- **What would make us revisit this:**
  - founder answers to Q136 ("pronto" for waiters), Q138 (close and kitchen), Q139, Q140, Q141;
  - M40 adding a printer or bump bar;
  - the supervised run showing that kitchen devices need instant sync (M19 V2).
