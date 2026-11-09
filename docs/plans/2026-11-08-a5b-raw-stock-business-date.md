# Plan: A5b, raw stock is dated by business day (follow-up to A5)

- **Branch:** `fix/a5-raw-stock-business-day` (worktree `/home/user/osteria-rawstock`), off `main` 880aa0c.
- **Continues:** `docs/plans/2026-11-02-a5-business-date-discards.md` §7.4 (PR #50: must ship before go-live).
- **Decision recorded in:** `docs/adr/adr-033-ledger-business-date.md` (proposed with this plan).
- **Numbering:** migrations `20261127100000`, `20261127100100` (after main's last, `20261124100650` from reservations PR1). No range is reserved for later PRs: `supabase db push` on staging refuses an unapplied migration that sorts before an applied one (#50), so every later PR (reservations PR2, `feat/backup-invoice-files`) numbers its migrations after the newest on main when it is written, and checks that before it goes ready (lead, 2026-11-09); pgTAP `259`, `260` (free between 258 and 264).
- **Author:** architect · **Date:** 2026-11-08

## 1. Goal and scope

- **Goal:** a raw movement at 01:30 counts on the same business day as a batch movement at 01:30, so `stock_reconciliation`, AVT, `waste_costs` and the KPI report agree for the same night.
- **In scope:** the raw readers that still group by calendar date; the column comment; the unused indexes; the reconciliation route's default date; the tests and pins that change because of this.
- **Out of scope:** labels (`raw_lot.received_on`, lot codes, A5 §7.3); the alert "today" (`app.alert_business_date`, Q109, see Q-A5b-2); the monthly pack's choice of count by calendar day (Q175); the invoice approval date check; anything on the batch side (A5 is done).

## 2. Current state (grep of all migrations, newest definition of each function)

### 2.1 Writers of `stock_movement.effective_on`

Every non-receipt writer stores `app.venue_date(instant, tz)` (the calendar day) and leaves `created_at` at its default `now()`. No writer sets `created_at` or takes a client or user-chosen time (offline `apply_op` reaches `fire_course` and `void_line`, which use `clock_timestamp()`, not the envelope's `clientTs`).

| Writer (newest definition) | Migration | Rows | Instant behind `effective_on` | Change |
|---|---|---|---|---|
| `app.post_stock_outflow` (FEFO engine) | `20261026100400_stock_core.sql` | `consumption`, `waste` | `p_at` | none |
| `app.run_stock_outflow` → `public.consume_raw_fefo`, `public.post_waste` | `20261026100500_stock_procedures.sql` | `consumption`, `waste` (`manual`) | `now()` | none |
| `app.produce_batch_core` (raw inputs of a batch) | `20261028100500_batch_review_r1.sql` | `consumption` (`batch`) | `p_at` = `now()` (`produce_batch`, `20261028100300`) | none |
| `app.post_plate_raw_outflow` (from `public.fire_course`) | `20261106100100_fire_helpers.sql` (caller `20261106100700`) | `consumption` (`order_line`) | `clock_timestamp()` of the fire | none |
| `app.confirm_staff_meal_core` raw half | `20261029100400_staff_meals.sql` | `waste` (`staff_meal`) only: already business-dated by A5 §7 | `now()` | none |
| `public.void_line` raw half | `20261106100300_void_line.sql` | `consumption` reversal + `waste` (`order_void`) | `clock_timestamp()` | none |
| `public.post_transfer` | `20261026100700_transfer_location_total.sql` | `transfer` ±, two rows per slice | `now()` | none |
| `public.count_close` → `app.post_count_adjustment` | `20261027100200` / `20261027100100` | `count` (`count_session`) | `now()` (= `count_session.closed_at`) | none |
| `public.reverse_movement` | `20261026100500_stock_procedures.sql` | mirror rows (`reversal`) | `now()` | none |
| `public.approve_invoice` receipts | `20261023110600_approve_invoice_variance.sql` | `receipt` | `app.receipt_date` = the invoice date (founder M5 Q1), NOT an instant | none |

Why the writers do not change: the same as A5 option (b). Old rows cannot be corrected (§3.4), so the readers must derive the business day from `created_at` anyway; writing a business date into new rows only would give the column two meanings by row age.

### 2.2 Readers

| Reader | Migration | How it dates today | Change |
|---|---|---|---|
| `public.stock_reconciliation` | `20261027100400_stock_reconciliation.sql` | movements by `effective_on`; the period's counts by `app.venue_date(closed_at)` | **yes** (§3.1) |
| `app.weekday_consumption` (used only by `app.purchase_rule`, `20261030100600`) | `20261030100100_rules_helpers.sql` | consumption by `effective_on`, a reversal on its original's `effective_on` | **yes** (§3.2) |
| `app.avt_rows` / `public.avt_report` | `20261112100400_avt_report.sql` | already an instant window: `created_at > O.closed_at and <= C.closed_at` | none: it never read `effective_on` |
| `app.kpi_purchases` (in `app.kpi_block`) | `20261112100200_kpi_report.sql` | `type = 'receipt'` by `effective_on` (the invoice date) | none: receipts keep the invoice date (Q-A5b-1, variant V1) |
| `app.usable_on_hand` (prep, purchase and dashboard reads) | `20261030100100_rules_helpers.sql` | sums every row; `p_today` is only compared with lot `expiry` | none: no movement date (207 md5 pin stays) |
| `public.raw_waste_costs` → `public.waste_costs`, dashboard tile, `kpi_report_json` | `20261121100000`, `20261117100000` | business day via `created_at` | done in A5 |
| `public.stock_movements` (movement list) | `20261026100600_stock_reads.sql` | returns stored `effectiveOn`; no grouping; no screen shows it | none |

TypeScript: `src/server/counts/reconciliation.ts` defaults `to` to `venueDate(now)` (calendar), so between 00:00 and 02:00 the default report already reads tomorrow.

### 2.3 Ledger guard

`app.append_only()` (newest `20261105100100_demo_purge_guards.sql`) raises `append_only` on every UPDATE of `stock_movement`; only a DELETE under `purge_demo_data` (ADR-018) passes. An UPDATE of `effective_on` is refused.

## 3. Design

### 3.1 `public.stock_reconciliation` (create or replace, same signature, in `20261127100000_raw_stock_business_date.sql`)

Copy of the `20261027100400` body apart from the dates:
- `v_lo := app.business_day_start(v_tenant, p_from)`, `v_hi := app.kpi_cutoff_end(v_tenant, p_to)`, computed once (A5 technique, DST-safe M11 helpers).
- A row is **up to the period end** when `(type = 'receipt' and effective_on <= p_to) or (type <> 'receipt' and created_at < v_hi)`, and **before the period** when `(type = 'receipt' and effective_on < p_from) or (type <> 'receipt' and created_at < v_lo)`. `opening` = sum of rows before; every type column = rows up to the end and not before; `closing` = sum of rows up to the end. `balanced` still holds by construction.
- The period's counts (`cnt`): `s.closed_at >= v_lo and s.closed_at < v_hi` instead of `app.venue_date(s.closed_at, v_tz) between p_from and p_to`. Needed: a count closed at 01:45 writes its `count` rows at 01:45, so both must land on the same business day or `matchesCount` breaks.
- A reversal counts on its own `created_at` (when posted), as before.
- Unchanged: role check first (`app.require_stock_reader`), `invalid_request`, `range_invalid`, `range_too_long`, `resolve_location`, quantities only (chef reads it), SECURITY DEFINER, `search_path = ''`, grants restated.

### 3.2 `app.weekday_consumption` (create or replace, same signature, same migration)

- The 14 days `p_today - 14 .. p_today - 1` become 14 instant ranges `[app.business_day_start(t, d), app.kpi_cutoff_end(t, d))` in a CTE (28 helper calls per call, none per row).
- A consumption row counts on the business day whose range holds `coalesce(original.created_at, m.created_at)` (a reversal still counts on its original's day); the row itself must have `created_at >= business_day_start(p_today - 14)`. Divisor 2, `having sum <> 0`, return shape unchanged; closed to every API role (revokes restated).
- `p_today` is still what `app.purchase_rule` passes (`app.alert_business_date`, calendar, Q109). See Q-A5b-2 / V2.

### 3.3 Column and index comments

- `comment on column public.stock_movement.effective_on`: receipt = the invoice date, read by reports; every other type = the calendar date (venue time zone) of the write, not read by reports, which count those rows by the business day of `created_at` (`app.business_day_start`, `app.kpi_cutoff_end`).
- `comment on index public.stock_movement_effective_idx`: serves receipts by invoice date (`app.kpi_purchases`).

### 3.4 Historical rows: no backfill, no UPDATE

- Rows written before this change keep their calendar `effective_on`. The readers above ignore it for non-receipts and date by `created_at`, which every writer has always set to the event instant (§2.1). Old and new rows behave the same on the next read; nothing is written. This is how A5 handled batch movements and raw waste (A5 §2 (b), §7.1, pgTAP 257/258 "existing row" cases).
- An UPDATE is refused by `stock_movement_append_only` (§2.3) and would break the ledger invariant. A reverse-and-repost is rejected in §4.

### 3.5 Index decision (`20261127100100_drop_unused_effective_indexes.sql`)

| Index | Created in | Reader after A5b | Decision |
|---|---|---|---|
| `batch_movement_effective_idx (tenant_id, effective_on)` | `20261108100200_dashboard_indexes.sql` | none: A5 moved `waste_costs` and `discards_vs_push_json` to `batch_movement_created_idx` | **drop** |
| `stock_movement_effective_idx (tenant_id, effective_on)` | `20261108100200_dashboard_indexes.sql` | `app.kpi_purchases` (receipts by invoice date, tenant-wide) | **keep**, comment (§3.3) |
| `stock_movement_consumption_idx (tenant_id, effective_on) where type = 'consumption'` | `20261030100000_rules_settings.sql` | none once §3.2 lands; the created_at range is served by `stock_movement_tenant_at_idx` | **drop** (it is written on every fire) |
| `stock_movement_location_date_idx (tenant_id, location_id, effective_on)` | `20261027100000_count_tables.sql` | `stock_reconciliation` (location prefix, receipt branch) | keep |
| `stock_movement_tenant_at_idx (tenant_id, created_at desc, id desc)` | `20261027100000_count_tables.sql` | raw waste (A5), weekday consumption | keep |

### 3.6 Route default (`src/server/counts/reconciliation.ts`)

`getReconciliation`: when `to` is missing, ask `public.business_date_of(now)` (A5 `20261117100100`, any signed-in staff role, chef included), as `getWasteCosts` does; `from` stays the 1st of that month. Errors through `mapCountDbError`. No new endpoint, no schema change in `src/`.

### 3.7 Security and privacy

- No new public function, no grant change; replaced functions keep role check first, SECURITY DEFINER, `search_path = ''`, tenant from `app.tenant_id()`, grants restated. RLS on `stock_movement` unchanged. Waiters stay refused; the chef still gets quantities only (no cost key in `stock_reconciliation`).
- No personal data is read or written. No secret is involved: the route calls two RPCs with the user's session client; the Supabase secret key is not used.

## 4. Alternatives considered

- **Writers write the business date into `effective_on` for new rows** — rejected: old rows stay calendar-dated and cannot be updated, so readers need `created_at` anyway and the column would mean two things by row age.
- **Reverse and repost misdated rows with a corrected date** (append-only safe on paper) — rejected: doubles the ledger, the reversals and reposts get today's `created_at` (wrong under any created_at reader), they show in the movement list and AVT window, and they are a data migration on production.
- **A new stored `business_on` column filled by trigger** — rejected: cannot be filled for old rows (UPDATE refused), and it would freeze the cut-off at write time.
- **`app.business_date(created_at)` per row in the readers** — rejected: a function call per row and no index use; the instant range is computed once.
- **Move receipts to the approval business day too** — not the default (founder M5 Q1, asserted by pgTAP 258); kept as variant V1.
- **Change AVT** — rejected: it already uses instants (`created_at` between the two counts' `closed_at`), so it agrees with business-day dating by construction.

## 5. Build plan (test first; each row is one commit)

| # | Step | Files | Test that proves it |
|---|---|---|---|
| 1 | Write 259 section R (red), then `public.stock_reconciliation` per §3.1 in the new migration. Fixtures that stood in "the date of a movement" with `effective_on` get `created_at` at noon Rome of that day, with a comment (as A5 did in 206). Pin updated on purpose. Config pins name the new last migration. | `supabase/migrations/20261127100000_raw_stock_business_date.sql`; `supabase/tests/database/259_raw_stock_business_date.test.sql`; `114_stock_reconciliation.test.sql` (`pg_temp.mv`, the reversal insert); `240_m22_preserves.test.sql` (new md5 of `stock_reconciliation`, comment "A5b"); `tests/config/m25-preserves.test.ts`, `m25a-preserves.test.ts` (`LAST_MIGRATION`), `m25b-preserves.test.ts` (`ALLOWED_NEW_MIGRATIONS`) | 259 **R1** winter Sun 1998-11-08 → Mon: rows at 23:59, 01:30 (consumption, waste, transfer out), 02:00 sharp, 02:30 Rome; day 11-08 holds 23:59 and 01:30, day 11-09 holds 02:00 and 02:30; opening(11-09) = closing(11-08); `balanced` both days. **R2** count closed Mon 01:45 with its `count` row at 01:45 is the count of 11-08 (`countSessionId`, `matchesCount` true) and not of 11-09. **R3** receipts: invoice dated 11-09 posted Sun 23:00 counts on 11-09; invoice dated 11-07 posted 11-10 counts on 11-07. **R4** DST: autumn instants `1998-10-24T23:30Z` → 10-24, `1998-10-25T00:30Z` and `1998-10-26T00:30Z` → 10-25, `1998-10-26T01:00Z` → 10-26; spring `1999-03-28T00:30Z` → 03-27, `01:00Z` and `01:30Z` → 03-28. **R5** a row stored with the calendar `effective_on` (next day) counts by `created_at`, and its `effective_on` is unchanged afterwards. **R6** reversal at Mon 01:50 counts on Sunday, at 02:30 on Monday. **R7** tenant B (04:00): Mon 03:30 → 11-08, 04:30 → 11-09; tenant A unchanged; waiter `42501`, chef `ok` with no cost key, `range_invalid`, `range_too_long`, definer + empty `search_path`, only `authenticated` executes. Plus 114, 240 and `tests/config/m25*.test.ts` green. |
| 2 | Write 259 section W (red), then `app.weekday_consumption` per §3.2 in the same (unmerged) migration. Fixtures of consumption rows get `created_at`, with a comment. | `20261127100000_raw_stock_business_date.sql`; `259_…`; `141_rules_helpers.test.sql` (`pg_temp.out_`, `pg_temp.reverse_`); `146_purchase_rule.test.sql` (consumption and reversal inserts); any other suite the run shows (expected: 148) | 259 **W1** `p_today` 1998-11-16: consumption at Mon 1998-11-09 01:30 counts on isodow 7 (Sunday), at 02:30 on isodow 1. **W2** a consumption at Mon 1998-11-16 01:30 (business 11-15 = `p_today - 1`) is in the window; one at business day `p_today - 15` is out. **W3** a reversal posted on `p_today` of a consumption from business 11-10 counts on 11-10 (net zero). **W4** DST: `p_today` 1998-10-27 with consumption at `1998-10-26T00:30Z` (Mon 01:30 CET, business 10-25, isodow 7); `p_today` 1999-03-29 with consumption at `1999-03-28T00:30Z` (business 03-27, isodow 6). **W5** tenant B 04:00 honoured; no API role executes it; definer + empty `search_path`. **W6** `app.purchase_rule('…', '1998-11-16T09:00Z')` payload `forecast_qty` includes the Monday-01:30 consumption on Sundays. Plus 141, 146, 149 green. |
| 3 | Column comment (§3.3) in the same migration; writer guard. | `20261127100000_raw_stock_business_date.sql`; `259_…` | 259 **G1** no function in `app` or `public` has an `insert into public.stock_movement (…created_at…)` (prosrc regex = 0 rows): every writer leaves `created_at` at `now()`. **G2** real writers in the test transaction: `consume_raw_fefo`, `post_transfer` and `count_close` rows have `created_at = now()` and appear in `stock_reconciliation(business_date(now()), business_date(now()))`. **G3** `col_description` of `stock_movement.effective_on` names receipts and `created_at`. |
| 4 | Index migration per §3.5. Tests that pinned the dropped indexes change on purpose. | `supabase/migrations/20261127100100_drop_unused_effective_indexes.sql`; `202_dashboard_indexes.test.sql`; `252_discards_vs_push.test.sql` (line 222); `140_rules_settings.test.sql` (line 77); `206_dashboard_perf.test.sql`; `tests/config/m25*.test.ts` | 202: `stock_movement_effective_idx` exists, unchanged definition, valid; `hasnt_index` `batch_movement_effective_idx`; count assertions 4 → 3. 252: the discards read's index is `batch_movement_created_idx`. 140: `hasnt_index` `stock_movement_consumption_idx`, comment says A5b. 206: the 15-day consumption `created_at` range uses `stock_movement_tenant_at_idx` and does not seq-scan `stock_movement`; the receipt `effective_on` range uses `stock_movement_effective_idx`. Config pins green. |
| 5 | Reconciliation route default `to` via `business_date_of` (§3.6). | `src/server/counts/reconciliation.ts`; `tests/app/api/reports/counts-reports.test.ts` | Vitest: at `2026-10-31T23:30:00Z` (00:30 CET, business 31 Oct; mock `business_date_of` returns `2026-10-31`) the RPC gets `p_from 2026-10-01`, `p_to 2026-10-31` (the old "already 1 November" case changes on purpose); `business_date_of` is called with `now.toISOString()`; with `to` given it is not called; its `42501` maps to 403 through `mapCountDbError`. Coverage of the file ≥ 80%. |
| 6 | Integration: `today` and `monthStart` from `business_date_of`; the fold's opening uses the same rule as §3.1 (receipt by `effective_on`, else business date of `created_at`). | `tests/integration/counts.int.ts` | `counts.int.ts` green on the local stack, including a run between 00:00 and 02:00 Rome on the 1st of a month (no off-by-one month). |
| 7 | Acceptance: one night, every report agrees. | `supabase/tests/database/260_business_day_consistency.test.sql` | Fixtures (tenant A, Manzo at 10 €/kg, Cella): receipt invoice 1998-11-06 20 kg; monthly count O closed Sat 11-07 12:00 (20 = 20); receipt invoice 11-08 5 kg; Sun 21:00 plate consumption 1 kg; Mon 01:30 raw waste 2 kg (stored `effective_on` 11-09), plate consumption 0,5 kg, batch discard 3 portions at frozen 2,00 €; Mon 01:45 monthly count C closes, count row −0,5; Mon 02:30 raw waste 4 kg; a closed table on 11-08 (as 234). **C1** `stock_reconciliation(11-08)`: opening 20, receipts 5, consumption 1,5, waste 2, adjustments −0,5, closing 21, balanced, count C, `matchesCount` true. **C2** `(11-09)`: opening 21, waste 4, closing 17. **C3** `waste_costs(11-08)`: raw 20, batch 6, total 26; `(11-09)` raw 40. **C4** `avt_report(C)`: Manzo `wasteQty` 2 = C1's waste; `actualQty` 4 = consumption + waste − adjustments of `stock_reconciliation(11-07, 11-08)`; the 02:30 waste is out. **C5** `kpi_report_json` day 11-08 (now `1998-11-12T09:00Z`): waste 26 = C3, `purchasesEur` 50; day 11-09: waste 40, purchases 0. **C6** after `app.rollup_daily_kpi('1998-11-12T09:00Z')` day 11-08 is `final` and C5's figures are unchanged. **C7** the 01:30 rows still hold `effective_on` 1998-11-09 and the ledger row count is unchanged by the reads. |

Fixture dates are 1998-1999 only (`tests/guards/no-date-bombs.test.ts`). No existing migration is edited; `20261127100000` is built across steps 1-3 on this branch before merge.

### 5b. Variants

**V1 — Receipts count on the business day they were approved** · Trigger: Q-A5b-1 answered "no" · Replaces: the receipt branch of step 1 (R3) and the `stock_movement_effective_idx` row of step 4

| # | Step | Files | Test that proves it |
|---|---|---|---|
| V1.1 | `stock_reconciliation`: receipts use the `created_at` rule like every other type. | `20261127100000_…`; `259_…` | 259 R3 inverted: invoice dated 11-09 approved Sun 23:00 counts on 11-08; invoice 11-07 approved 11-10 counts on 11-10. |
| V1.2 | `app.kpi_purchases`: `created_at` in `[business_day_start(from), kpi_cutoff_end(to))`. | `20261127100000_…`; `234_kpi_report.test.sql` (receipt fixtures get `created_at`); `258_raw_waste_business_date.test.sql` line 156 (comment and assertion: receipts are now read by `created_at`); `286_m25c_preserves.test.sql` unchanged (`kpi_block` not replaced) | 234 `kpi_purchases` cases green with `created_at`; 260 C5 `purchasesEur` follows the approval day. |
| V1.3 | Drop `stock_movement_effective_idx` too (no reader left). | `20261127100100_…`; `202_…`; `206_…` | 202 `hasnt_index` for it; 206 receipt assertion removed. |

**V2 — The purchase rule's 14-day window ends at the business day** · Trigger: Q-A5b-2 answered "yes" · Replaces: none (adds to step 2)

| # | Step | Files | Test that proves it |
|---|---|---|---|
| V2.1 | `app.purchase_rule` (`20261030100600`) passes `app.business_date(p_tenant, p_at)` to `app.weekday_consumption`; its alert date and `usable_on_hand` keep `app.alert_business_date` (Q109). | `20261127100000_…`; `259_…`; `146_purchase_rule.test.sql` | 259: a run at Mon 01:30 averages business days up to Saturday (the running Sunday is out); a run at 02:30 includes Sunday. 146 green. |

**V3 — The reconciliation row shows the count's business date** · Trigger: Q-A5b-3 answered "yes" · Replaces: none (adds to steps 1 and 5)

| # | Step | Files | Test that proves it |
|---|---|---|---|
| V3.1 | `stock_reconciliation` items gain `countedOn` = `app.business_date(tenant, closed_at)`. | `20261127100000_…`; `259_…` | 259: the count closed Mon 01:45 has `countedOn` 1998-11-08. |
| V3.2 | `reconciliationResponse` and `Reconciliation` type gain `countedOn`; `reconciliation-row.tsx` prints it instead of `venueDate(countedAt)`; the CSV export is unchanged. | `src/server/counts/output.ts`, `src/server/counts/types.ts`, `src/server/counts/reconciliation.ts`, `src/app/(owner)/magazzino/riconciliazione/reconciliation-row.tsx` | Vitest `tests/components/reconciliation-row.test.ts` (a count at `2026-11-01T00:45:00Z` shows "31 ott") and `counts-reports.test.ts` (key passed through); `tests/server/exports/tables-stock.test.ts` snapshot unchanged. |

## 6. Risks and mitigations

- **Mixed receipt dating (default):** an invoice dated Monday can be approved at 01:30 Monday (the approval check `invoice_date > app.venue_date(now)` is calendar); its receipt lands on Monday while a 01:40 consumption lands on Sunday. `balanced` still holds; Sunday may show a dip. Tracked by Q-A5b-1 / V1.
- **`created_at` vs `clock_timestamp()`:** `fire_course` and `void_line` dated rows by `clock_timestamp()`; `created_at` is the transaction start, a few milliseconds earlier. A fire that straddles the cut-off lands on the earlier day. Accepted.
- **A future writer that sets `created_at` or takes a client time** would mis-date raw reports silently. Mitigation: 259 G1 fails the suite; the column comment says so.
- **History re-dates on read:** rows between 00:00 and 02:00 move one day back on the next read; a CSV or monthly pack exported before the deploy can differ from a re-export. `daily_kpi` stores no stock figure, so nothing stored changes. Say it in the PR description.
- **Cut-off change re-dates history** (as A5 §5).
- **Index drop:** plain `DROP INDEX` takes a short exclusive lock on the table inside the migration; both tables are small. Deploy before go-live, outside service hours.
- **Performance:** `weekday_consumption` now reads 15 business days of every movement type through `stock_movement_tenant_at_idx` and filters consumption; 206 pins "no seq scan". No figures are promised.
- **Security / privacy:** see §3.7. Dependencies: none added.

## 7. Open questions for the founder

- **Q-A5b-1.** Receipts keep the invoice date in `stock_reconciliation` and the KPI purchases (your M5 Q1 decision), while every other raw movement counts on the business day it was recorded. Keep that? **Default: yes.** "No" → V1.
- **Q-A5b-2.** The purchase alert's 14-day consumption average uses the calendar "today" of the alert rules (Q109), so a run between 00:00 and 02:00 already counts the still-open business day. Should its window end at the business day instead? **Default: no** (the hourly run after 02:00 sees the full day). "Yes" → V2.
- **Q-A5b-3.** In the reconciliation, a count closed at 01:45 Monday now belongs to Sunday's period, but the row still prints the date it was closed ("9 nov"). Print the business date ("8 nov") instead? **Default: no** (keep the real date of the count). "Yes" → V3.
