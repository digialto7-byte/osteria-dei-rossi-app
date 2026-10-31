# ADR-023 — The bill is computed in SQL, closing a table is online-only and final, the day close is an append-only register entry

- **Status:** proposed
- **Date:** 2026-10-30 · **Decided by:** founder (on the M21 plan; defaults Q126–Q135 open)

## Context
- PRD 3.4: bill preview with coperto, VAT-inclusive total, split by covers or by items; "the app never takes payment and never issues fiscal documents"; close requires the RCH receipt number (or "fattura" + number) and the payment type; end of day: app total vs register total entered by the owner, with the list of tables closed without a receipt number. Acceptance: "closing without a receipt number is allowed but flagged"; "the end-of-day variance is visible before midnight".
- Project plan §5a M21 (AT1–AT5), §3.5.1 (`table_session` closing columns, `business_date`, `missing_receipt`), §3.5.2 (`day_close`), §3.11.2 (day_close owner/admin only).
- M17 (ADR-016): prices are VAT-inclusive and frozen on the line at entry (`order_line.unit_price`); the coperto is frozen on the session at opening; `table_session_guard` makes a closed session final and leaves the closing columns to M21.
- M19 (ADR-019): fired lines deplete stock; voided lines stay in the table, struck through. Every line writer takes the session row FOR SHARE first.
- M20 (ADR-022): every comanda write goes through the phone's outbox and `apply_op`; "irreversible states win" (a closed table accepts nothing, `session_closed` is a conflict). Owner and kitchen writes stay online-only. M20 §3.4 proposed a `close_table` op kind for M21.
- M11/M15: `app.business_date(tenant, instant)` with the tenant cut-off (default 02:00, project Q18), DST-safe.

## Decision
- **One SQL computation of the bill** (`app.session_bill_json`), used by the preview, the split and the close: non-voided lines at `round(qty × unit_price, 2)` (half portions at 0,5 × price), plus the session's frozen coperto total; every amount is `numeric` and splits are done in integer cents, the remainder cents going one each to the first parts, so the parts always add up to the total. The browser only formats the numbers it is given.
- **`close_table` is online-only and final.** It is not an outbox op kind (this replaces M20 §3.4's proposed `close_table` kind). It takes the session FOR UPDATE, so it waits for every line writer, refuses while unsent (draft) lines exist, and refuses when the bill changed since the waiter's preview (`billToken`). It records receipt type, receipt number (optional, then `missing_receipt`), payment type, the frozen total and the **business date of the closing instant**. After it, every later write on the session (online or replayed from a phone) is a `session_closed` conflict, as M20 already decides.
- **`day_close` is append-only**: each entry of the register total is a new row; the latest row of a business date is the one in force. Only owner and admin can write it (procedure role check and no INSERT grant). The app-vs-register report is computed live on every read.

## Alternatives
- **Queue the close offline like the other comanda writes (M20 §3.4)** — pros: one write path; a waiter can close in a dead spot. Cons: the receipt is printed at the register (which is online by nature), a queued close could replay after a colleague's later dish and freeze the wrong total, and an offline phone cannot know other phones' queues. Why not: kept as M21 variant V6 (Q135).
- **Compute the bill in TypeScript** — pros: easy to unit test. Cons: two implementations (preview vs frozen total) and floating point in JS. Why not: CLAUDE.md "no data logic in React" and "money is numeric".
- **Store no total, recompute at report time** — pros: nothing stored. Cons: the closed bill could drift if a guard were ever relaxed. Why not: the total at close is the figure matched against the receipt, so it is frozen like costs at sale; lines of a closed session cannot change anyway.
- **One mutable `day_close` row per date** — Why not: append-only keeps who entered which figure and when, at no cost.
- **Count a table on the business date it was opened** — Why not as default: the receipt is printed at close and lands in that day's register total; kept as variant V1 (Q128).

## Consequences
- Good: the preview, the split and the stored total cannot disagree; splits are exact to the cent; a stale preview cannot be closed; waiters see prices only; the variance is available as soon as the register total is saved.
- Bad / accepted trade-offs: no close in a dead spot; dishes still queued on another phone when a table is closed are refused (shown on that phone and counted in the end-of-day view); a receipt number cannot be corrected after close in M21 (Q132 → V4); payment types are a fixed list.
- What would make us revisit this: founder answers to Q128 (business date of a table), Q129 (unsent dishes at close), Q132 (receipt correction), Q133 (who enters the register total), Q135 (offline close); a weekly variance above the PRD's threshold during the supervised run.
