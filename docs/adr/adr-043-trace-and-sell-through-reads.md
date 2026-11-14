# ADR-043 — Trace and sell-through reads: read-only functions over the existing ledgers, and where origin data will belong

- **Status:** accepted
- **Date:** 2026-11-14 · **Decided by:** lead (plan approval and lead decisions LFD-1 to LFD-6, 2026-11-14); the origin entity choice follows the founder's wish of the same day for a later local-producers network
- **Plan:** `docs/plans/2026-11-14-p2-2-trace-sell-through.md` (decisions D-P1 to D-P13; steps S1 to S20). Screen spec: `docs/ux/p2-2-trace-sell-through.md`.
- **Number:** 043 belongs to P2-2 (LFD-3). No open remote branch held a number above 042 when this was written; the local-producers plan takes the next free number.

## Context
- The owner, admin and chef need to follow a supplier lot forward (which batches, which plates, on which days, what was thrown away) and back (which
  deliveries and suppliers went into a batch or a served plate). The owner also needs to know how a pushed dish sold, and the chef needs the booked
  covers of the day, as numbers only (founder decisions D1 and D9 of 2026-11-11).
- Everything these answers need is already in append-only ledgers: `raw_lot`, `stock_movement`, `batch_input`, `batch_movement`, `order_line`,
  `menu_push`, `reservation`. The write procedures are pinned and single-transaction (`approve_invoice`, `produce_batch`, `split_batch`,
  `discard_batch`, `fire_course`, `void_line`, `push_menu_item`).
- The chef must not read `order_line`, `stock_movement`, `invoice` or `supplier_item` rows (they hold prices and costs), and must read no row of any
  reservation table (D9), yet the trace and the covers need facts from them.
- The founder also wants, later, producers and designations of origin (Cinta Senese, Chianti Classico) on the trace. That network is a separate plan.
  This milestone only has to leave the right place for the data.

## Decision
The decisions are those of the plan, D-P1 to D-P13, recorded here so they outlive it.

1. **D-P1 Read-only over the ledgers.** No table, column, trigger or stored balance. Every figure is folded from movements at read time. Eight public
   functions (`trace_lot_search`, `lot_capture`, `trace_lot`, `trace_batch`, `trace_order_line`, `trace_line_search`, `push_sell_through`,
   `reservations_covers`) and their `app.*_json` twins are `stable`, definers with an empty `search_path`, executable by `authenticated` only. The demo
   purge list (ADR-018) and the export and erasure lists (ADR-040) are unchanged on purpose, and pgTAP 359 pins that.
2. **D-P2 Lot identity is `raw_lot.id`, not the code.** A code search returns the matching rows; a delivery without a code is still found by
   ingredient, supplier and date and is shown as "Lotto senza codice".
3. **D-P3 Gaps are shown, never guessed.** A `batch_input` slice with no lot (stock was at zero at production, ADR-011) is "Senza lotto"; the forward
   trace counts later batches of the same ingredient that used unlotted stock and says "Da verificare a mano".
4. **D-P4 Net of reversals.** A movement reversed by `reverses_id` is not counted as used or sold; a plate fired and then voided is listed apart, with its
   waste (ADR-019).
5. **D-P5 Split children belong to their root.** `app.batch_family` walks `split_from_batch_id` down (forward) and up (backward), depth at most 50, and
   raises `trace_depth_exceeded` beyond that. A split child has no `batch_input` of its own.
6. **D-P6 Business dates everywhere.** Plates are grouped by `app.business_date(tenant, created_at)`, with the 02:00 cut-off and DST-safe day windows
   (ADR-033); times are shown in Europe/Rome. A receipt keeps its `received_on`, the invoice date.
7. **D-P7 No money in any trace reply, for any role.** Owner and admin get the invoice (id, number, date); the chef's reply has no `invoice` key, because
   the chef has no `invoice` read. The role that shapes the reply is the session's, never a parameter.
8. **D-P8 Sell-through definition.** Per push period clipped to the business day: plates sold are fired, not voided, lines of the item fired inside the
   window, in portions (`app.order_line_portions`). At-risk stock is the batches of the push's `batch_keys` that were due soon at the window start
   (`app.use_by_state`), with their split children. The percentage is computed once, in SQL. Sold during the push counts any plate that used the batch,
   and the screen says so in a footnote.
9. **D-P9 Covers for the chef come from a definer function that returns counts only.** The chef keeps 0 rows from `reservation`, `reservation_contact`,
   `reservation_table`, `reservation_event` and `reservation_email`.
10. **D-P10 The chef's covers count confirmed bookings only** (`accepted`, `arrived`, `seated`). Pending requests are not counted (variant V4 if the chef asks).
11. **D-P11 The lot nudge is computed in the server reply.** `lotMissing` per review line and `summary.stockLinesWithoutLot` come from
    `src/server/invoices/review.ts`; React only renders them. The approval is never blocked, because `raw_lot` is append-only and copies the lot code at
    approval, so the reminder sits before it.
12. **D-P12 Bounded replies.** `TRACE_MAX_LOTS` 50, `TRACE_MAX_BATCHES` 200, `TRACE_MAX_PLATE_GROUPS` 400, `TRACE_MAX_LINES` 200,
    `TRACE_MAX_RANGE_DAYS` 366, `TRACE_SPLIT_DEPTH` 50. They live in SQL with TS twins and a parity test, and every list carries `truncated`.
13. **D-P13 Purchase-line identity in the owner and admin trace.** `lot.purchase = {supplierItemId|null, supplierCode|null, description}` is read from
    the lot's `invoice_line` (the line as it was approved; `supplier_item` is mutable and is not read). A recall letter names the supplier's article
    code and description, and this is the join where origin attaches later. The chef's reply has no `purchase`. No origin field is added.

### Origin: which entity holds what (plan §3.13.1), and the hooks H1 to H7
Nothing about origin is stored in P2-2. When the local-producers plan adds it, it follows this choice:

| Datum | Home | Why not the others |
|---|---|---|
| Protected designation (DOP, IGP, STG, DOCG, DOC, IGT) and its registered name | `supplier_item`, with an optional reference to the official EU register entry | Not `ingredient`: one recipe ingredient can be bought both with and without a designation. Not `supplier`: a wholesaler sells many products, only some designated |
| Producer (farm, winery, maker) | `supplier_item` as the default producer; the per-lot snapshot records the producer actually received | Not `supplier`: the supplier is often a distributor. When the supplier is the producer, a flag on `supplier` links the two (producer-network plan) |
| Place of origin | Default on `supplier_item`; the actual value per delivery in the lot snapshot | Origin can change between deliveries of the same article, so only the lot can say what was received |
| What was actually received | A frozen, append-only origin snapshot per `raw_lot`, written in the approval transaction | `supplier_item` is mutable, so reading it at trace time would rewrite history; `raw_lot` is append-only. A side table keyed by `raw_lot_id` keeps both rules |

Origin then flows through `batch_input` to `raw_lot` like the lot code does, so batches and orders need no change. The named hooks (none built):

| # | Hook | Where it plugs in |
|---|---|---|
| H1 | `supplier_item` origin defaults: producer reference, place of origin, designation type and name, optional EU register reference | Master data; owner and admin setting; RLS as `supplier_item` |
| H2 | `raw_lot_origin` append-only snapshot written inside `approve_invoice` | Re-pins `approve_invoice`; joins the purge list (ADR-018) and the export list (ADR-040) in the same step |
| H3 | `origin` object in `trace_lot`, `trace_batch`, `trace_order_line` (no money) | The P2-2 functions, replaced on purpose |
| H4 | P2-7: per-supplier mapping of `AltriDatiGestionali` or `CodiceArticolo` labels to `invoice_line.lot_code` and `expiry` | P2-7 parser; the review screen marks them as read from the file |
| H5 | P2-7: `CodiceArticolo` (EAN or supplier code) used to map lines to `supplier_item` | P2-7 auto-mapping |
| H6 | `supplier.is_producer` and a producer identity shared across tenants | Producer-network plan only; the first cross-tenant entity, so it needs its own ADR (ADR-003) and a data-protection review |
| H7 | Designation names validated against the official EU register instead of free text | Producer-network plan; no external call from P2-2 |

FatturaPA (Allegato A, v1.9.1, §2.2.10.1) has no dedicated field for lot, expiry, origin, producer or designation, so P2-7 can fill lot and expiry only
where a supplier writes them in `AltriDatiGestionali` or `CodiceArticolo`, and should not fill origin at all.

## Alternatives (rejected)
- **A materialised trace table (lot, batch, line) filled by the write procedures.** It would change `produce_batch`, `fire_course`, `void_line` and
  `split_batch`, add a table to the purge and export lists, and duplicate links the ledgers already hold.
- **Views with `security_invoker` instead of definer functions.** The chef must not read `order_line` or `stock_movement` rows, yet the trace needs
  facts from them; a definer with a fixed, cost-free shape is the house pattern (M12 stock reads, M19 kitchen reads).
- **Making the lot code mandatory at approval.** Real invoices may not print one; kept as variant V2 for categories the HACCP consultant names.
- **Editing a lot code on `raw_lot` after approval.** `raw_lot` is append-only (ADR-002); an append-only note is variant V1.
- **Origin columns now, on `ingredient` or `supplier`.** Wrong entity (see above), nothing reads them in P2-2, and the producer network decides the shared
  producer identity.
- **Parsing lot and origin out of the invoice description in P2-7.** Free text is not deterministic, and P2-7 is deterministic by decision.
- **Sell-through as plates sold against the usual weekday only.** It needs weeks of history and does not say whether the at-risk batch was saved;
  kept as variant V3.
- **Sell-through counting only lines at the push price.** A push with no day price leaves `price_source = 'menu'`, so those sales would vanish.
- **Showing the chef the reservation day with names hidden in the UI.** Names would still reach the phone; roles are enforced in Postgres.
- **Lot search by substring (trigram).** Needs `pg_trgm` and its index; a recall letter gives the full code, so a prefix that ignores spaces and case is enough.
- **A new dependency.** None.

## As built (deviations from the plan text)
- **Key names of the sell-through reply:** the totals object is `summary` (`{pushes, lines, portions}`), not `totals`, and the day-price flag on a push
  is `hasDayRate`, not `withDayPrice`. The amount, `pushPrice`, stays owner and admin only. The TS schemas, the screens and the tests use the built names.
- **Fixture rows written directly for the 1998 and DST cases.** The procedures stamp the transaction time, so pgTAP 354 to 356 write the ledger rows
  with the shapes and ref types the procedures write, at fixed 1998 instants (the cut-off and the DST nights need fixed instants). Part B of 354 also runs the
  real procedures at transaction time and reads the trace back, so the shapes the forward trace relies on are proven against what the procedures really write.
- **"PIN waiter" in the integration suite** is the stack's password waiter (the PIN path has its own suite); the role is the same. The booked covers e2e
  uses a customer request for tomorrow's dinner that the owner accepts, because a booking for today needs a start still ahead.

## Consequences
- Good: no pinned procedure is touched, no table is added, and the purge and export lists stay correct by construction; the chef sees what a recall
  needs and no money; the same SQL answers the owner, admin and chef with role-shaped replies parsed by strict schemas.
- Accepted: the lot code cannot be added after approval in this version (variant V1 if the founder asks). A trace is only as complete as the lots
  entered, so gaps are shown and the owner guide says so. The functions read large ledgers at request time, kept in bounds by the caps, the indexes
  of migration 20261203100000 and the pgTAP 358 perf net.
- What would make us revisit this: a tenant whose ledgers exceed the caps often (a file export, V5), a legal or consultant requirement that makes the lot
  mandatory (V2), or the producer network needing shared origin data (H6, its own ADR).
- This ADR states no legal rule. Traceability duties are for the venue's HACCP consultant to confirm.
