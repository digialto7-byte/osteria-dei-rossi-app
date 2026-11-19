# ADR-048 — Opening stock: a reversible `opening` movement per location, with a cost used only until the first invoice

- **Status:** proposed
- **Date:** 2026-11-18 · **Decided by:** lead (plan approval, rulings O1–O5 and Q1–Q13, 2026-11-18); founder need via the lead
- **Plan:** `docs/plans/2026-11-18-opening-stock.md` (§3, §4; steps 3–19). Screen spec `docs/ux/avvio-magazzino.md`. Migrations `20261206210000`
  to `20261206210700`; pgTAP `407`–`416`.
- **Number:** 048 is the next free number. 046 is the newest file in `docs/adr/` on main, and 047 is reserved for P2-4 (alert rule
  settings, its Q10).
- **Builds on:** ADR-002 and ADR-003 (append-only ledgers, balances derived from them, `tenant_id` and RLS everywhere, roles in Postgres),
  ADR-018 (the demo purge lists the new tables) and ADR-033 (ledger reports read the business day of `created_at`; this ADR adds a second
  exception, see the note there).

## Context
- A venue that starts on the app already has stock. Until now stock came in only through an approved invoice (a `receipt` with a lot), so
  the first weeks showed negative stock and recipe costs with no price.
- `receipt` cannot carry it: `stock_movement_receipt_ck` needs a lot, and a lot needs an invoice line. Purchases, the reconciliation's
  `receiptsQty` and the history all read `receipt` as "bought".
- The founder wants quantities and a unit cost per ingredient and location, entered from more than one phone, correctable, and right
  from day one for stock and food cost.

## Decision
1. **A new movement type `opening`** (enum value plus one shape CHECK). The rows have no lot and no reason; they have `unit_cost >= 0`
   (never null). A booking row has `ref_type 'opening'` and `qty > 0`. A mirror row has `ref_type 'reversal'`, `qty < 0` and the same cost.
   Balances still come only from the ledger.
2. **One location per call.** `public.post_opening_stock(location, effective_on, request_id, lines)` is one transaction. It writes one
   append-only `stock_opening` header and its rows, and one `stock.opening_posted` audit row. It is replayable on `request_id`, and the
   lines must match the server draft exactly (`opening_draft_changed`).
3. **A server draft** (`opening_draft_line`, not ledger) is shared between devices: one line per ingredient and location, at most 200 lines
   per location. Confirming removes the booked lines from it.
4. **The window (O2).** A location takes a carico only until its first closed **monthly** count. While a count of either type is open the
   carico is refused. The date is at most today, at most 366 days back, and not after the location's first receipt (Q10: the receipt's
   own day is allowed).
5. **Correction.** `public.reverse_opening_stock(id, reason)` is owner or admin only, with one of four reasons. It runs only before the
   window closes, and only with an empty draft at that location. It writes mirror rows dated with the original's `effective_on` and puts
   the original lines back into the draft. `reverse_movement` stays unchanged and refuses `opening`.
6. **The cost (O3).** `app.ingredient_unit_costs` uses the latest non-reversed opening cost of the ingredient (across locations, Q13)
   **only while no invoice price is in force**. From the first invoice the opening cost is ignored, never averaged. Every caller inherits
   this: the outflow cost stamp, counts, recipe costs, the sale freeze, AVT and the cost list. The APIs derive
   `costSource: 'invoice' | 'opening' | null` from the unchanged signature.
7. **Reports.** The reconciliation reads opening rows by `effective_on` (the "Data del carico") into `openingQty`, never into
   `receiptsQty` or `otherQty`. Every other report keeps ADR-033's rule.
8. **No lots, no expiry alerts (O1); base units only (O5); AVT unchanged (O4),** with a runbook line: a monthly count right after the carico.
9. **Concurrency: first receipt vs a concurrent `approve_invoice` (lead ruling, Q2 option A, 2026-11-18).** `post_opening_stock` reads the
   location's first receipt date without a lock that `approve_invoice` would wait on. So an owner confirming a carico in the same instant
   an invoice for that location is approved can end up with a carico dated after the first receipt. This is accepted. It needs two
   people acting at the same moment; the result is visible in the history; and it can be corrected by reversal before the first monthly
   count. No lock and no nightly check are added.
10. **Two devices and the draft (lead ruling, PR 2 review).** A draft edit saved on one device while another device confirms the same
    location can come back into the draft after the confirm (last write wins). The screen reloads the draft after a confirm and says so.
    No server change.

## Alternatives
- **A `receipt` without an invoice, with a source flag.** Rejected: the shape CHECK needs a lot and an invoice line, and every reader of
  `receipt` would have to learn the flag.
- **Count rows as the carico.** Rejected: counts are not reversible, carry the basis cost (null without an invoice), are adjustments to
  the AVT, and would close the very window of O2.
- **A cost column on the ingredient.** Rejected: two price sources with no date and no audit trail, and the blending question (O3) returns.
- **A pseudo-invoice ("Fornitore: Carico iniziale").** Rejected: payables, VAT lines, a supplier and lots (also O1).
- **`raw_lot` for opening stock.** Rejected: `invoice_line_id` is `not null unique`, and O1 says no lots.
- **`reverse_movement` learns `opening`.** Kept as a variant (V1): it has no reason, admits the chef and cannot restore the draft.
- **Reports read the carico by `created_at` (ADR-033 as is).** Rejected for the reconciliation: a carico dated 1 Dec and posted on 5 Dec
  would show 1–4 Dec as negative and the carico as "other". Kept for every other report.
- **A separate "Carico iniziale" column in the reconciliation.** Kept as a variant (V4): it changes the JSON, the TS schema, the CSV export
  and the screen.
- **No server draft (localStorage plus one POST).** Kept as a variant (V5): it is not shared between devices and cannot take rows back.
- **Book all locations in one call.** Rejected: the spec books and reports per location, and one refusal would block every other location.
- **A lock or a nightly check for the first-receipt race.** Rejected (decision 9): the cost is a lock on a hot path, for a case that is
  visible and correctable.

## Consequences
- Good: stock and food cost are right from day one. The carico is dated, audited, reversible and replayable. Balances stay derived from
  the ledger. Every cost reader picks up the fallback without a change. The window keeps the carico from mixing with counted stock.
- Bad / accepted trade-offs:
  - carico stock has no lots and no expiry alerts;
  - the opening cost is one value per ingredient (the latest across locations), not per location;
  - after the first monthly count, corrections go through counts and invoices only;
  - the reconciliation now has two `effective_on` readers (receipts and openings);
  - the race of decision 9 is possible but needs two people acting in the same instant.
- What would make us revisit this:
  - lots on carico stock (O1);
  - a per-location cost;
  - a second use case for a "carico" (for example a transfer in from another venue);
  - a carico dated after the first receipt actually seen in production (decision 9).
