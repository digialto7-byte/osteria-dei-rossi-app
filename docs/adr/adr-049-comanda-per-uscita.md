# ADR-049 — Comanda per uscita: one send, held uscite called later, depletion at the send, `not_prepared` voids

- **Status:** proposed
- **Date:** 2026-11-19 · **Decided by:** lead (plan approval and rulings, 2026-11-18, including the M5 ruling option a); founder need via the
  lead (spec `docs/ux/comanda-uscite.md`). The founder's open questions are listed below (plan §7, Q8).
- **Plan:** `docs/plans/2026-11-18-comanda-uscite.md` (§3, §4; steps 3–25). Migrations `20261206220000`–`20261206220700` (PR2–PR4), `220800`
  (PR5); pgTAP `417`–`430`.
- **Builds on:** ADR-002 and ADR-003 (append-only ledgers, derived balances, `tenant_id` and RLS, roles in Postgres), ADR-017 (last write
  wins on drafts), ADR-019 (firing and voids; see the note added there), ADR-022 (the offline queue), ADR-024 (the kitchen board).

## Context
- Today the waiter sends course by course, and a dish marked "Segue" stays a draft until "Invia a seguire". The founder wants one send per
  table: every dish goes to the kitchen at once, grouped in uscite (1ª, 2ª, …), and the later uscite wait until the waiter says "Via la n".
- Stock, cost and the bill must stay exactly as they are for tenant #1's history (G, pgTAP `417`), and an old bundle still open on a phone
  during service must keep working (offline ops queued before the deploy).

## Decision
1. **A line carries an uscita** (`order_line.uscita`, 0..9; 0 is "Subito" for drinks). It is added without a default, so every existing row
   keeps null ("a line from before uscite"); M5 places the lines of open sessions, adds a NOT VALID check (null is refused for every later
   write), and sets default 1 by the lead's ruling, the one sanctioned Rule B exception for the column: every app writer names `uscita`, no
   API role can insert, and pgTAP `423` scans the writers. `segue` stays as a mirror (`uscita >= 2`) for legacy readers.
2. **One send, depletion at the send (plan §3.2 A).** `fire_course` takes `hold: true`: every named line is fired, depleted and costed as
   today; the lines of uscite ≥ 2 are **held** until their uscita is called. Held is derived, never stored: a sent, live line of uscita ≥ 2
   with no `uscita_call` row for its uscita. "Fire = sale" and "cost frozen at sale" stay literally true, the last portions are protected,
   and shortages surface at the send.
3. **The call is a row.** `public.call_uscita` writes one append-only `uscita_call` row per (session, uscita): the audit, idempotent
   (same caller → `changed: false`, another → `already_called`, nothing held → `nothing_waiting`; conflicts are results). A fire without
   `hold` (every op of an old bundle) also writes the call (`fire_now`), exactly what "Invia a seguire" meant.
4. **Voiding a held dish is `not_prepared`** (Q-U1): reversals only, no waste, the stock comes back; a portion of a batch discarded since
   stays waste with the discard's reason. A called line refuses `not_prepared` and keeps today's reversal + waste. The cost row stays.
5. **Old bundles keep working.** `/api/sync` reads `X-Sync-Version`; without it the results are down-shaped to the frozen v1 schema (no
   `uscita`, no `held`, the new conflict reasons become `stale`). Stored replies from before the deploy are upgraded before the strict
   parse (`uscita: null`, `held: []`), never invented.

## Alternatives
- **Deplete at the call (B, kept as variant V3):** cost not frozen at the sale, the last portion can be promised twice, shortages surface
  mid-service, and the bill, line state and order view all move.
- **A stored held flag or line state:** it would change the bill token, need an update of fired lines at every call (the guard forbids it)
  and must be kept in step. The derived rule needs one indexed lookup.
- **A new op kind `send_comanda`:** two procedures sharing the depletion body; one optional `hold` key keeps every old op exact.
- **Refusing old queued ops:** the waiter's queued dishes would be lost mid-service; mapping them is a few lines and is tested.
- **A default on the ADD COLUMN or a backfill of every row:** it would write or invent values for closed history.
- **A new waste or stock reason "not_prepared":** a dish not cooked is not waste; reversals already carry no reason.
- **`audit_event` rows for calls:** the call row already records who and when.

## Consequences
- Good: one send per table; stock and cost as today; held dishes visible to the kitchen as "in attesa"; idempotent calls offline; closed
  history untouched (G unchanged); old bundles keep their meaning.
- Bad / accepted trade-offs: a held dish is depleted before it is cooked, so a dish never called must be voided `not_prepared` (the close
  refuses a table with held lines, M8); one more conflict family in the offline notices; `segue` lingers as a mirror until Q9's cleanup.
- What would make us revisit this: P0 showing frequent `not_prepared` voids (depletion at the call would then be worth its cost); founder
  answers to Q1 (drinks held), Q3 (renumbering) or Q4 (closing with a waiting uscita).
