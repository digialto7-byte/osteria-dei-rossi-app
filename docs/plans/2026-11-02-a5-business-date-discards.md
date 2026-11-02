# Plan: founder decision A5, batch movements are dated by business day

- **Branch:** `fix/a5-business-date-discards` (worktree `/home/user/osteria-a5`), off `main` 0f1df68.
- **Decision (A5):** batch discards, and any other batch movement still dated by calendar day, count on the BUSINESS day (cut-off from tenant settings, 02:00 by default; `app.business_date`, `app.kpi_cutoff_end`).
- **Numbering:** migrations from `20261117100000`, below M25b `20261118…` and M25c `20261120…`; pgTAP `257`.

## 1. Findings

### 1.1 Writers: every batch movement is dated by the calendar day

All of them use `app.venue_date(instant, tenant time zone)`, which is `(instant at time zone tz)::date`: no cut-off. Between 00:00 and the cut-off it returns the day AFTER the business day.

| Writer (newest definition) | Migration | Movement | Instant used |
|---|---|---|---|
| `public.discard_batch` | `20261029100200` | `waste`, `batch_discard` | `now()` |
| `public.adjust_batch` | `20261029100200` | `count`, `batch_adjust` | `now()` |
| `public.split_batch` | `20261029100300` | `split` x2 (also the child's lot date and lot code) | transaction time |
| `app.produce_batch_core` | `20261028100500` (replaces `…100200`) | `produce` (also lot date and lot code) | `p_at` |
| `app.confirm_staff_meal_core` | `20261029100400` | `waste`, `staff_meal` (its `staff_meal_confirmation` row already uses `app.business_date`) | `now()` |
| `app.deplete_line_batches` | `20261106100700` (replaces `20261106100100`) | `consume`, `order_line` (called by `fire_course` and by the M19/M20 offline replay with the client time) | `p_at` |
| `public.void_line` | `20261106100300` | `consume` reversal + `waste`, `order_void` | `clock_timestamp()` |

`fire_locked_batches_only` only changes lock order; its dated insert is `deplete_line_batches` above. No other function inserts into `batch_movement` (grep of all migrations).

### 1.2 Readers that group batch movements by date

Only two read the date. Everything else (`batch_remaining`, push list, availability, expiry rule, invariants, `batch_list`) sums over all rows and has no date.

| Reader | Migration | How it dates |
|---|---|---|
| `public.waste_costs` (batch side: `bl` lines and `unvaluedCount`) | `20261029100600` | `m.effective_on between p_from and p_to` |
| `app.discards_vs_push_json` (M23) | `20261114100500` | `m.effective_on between v_from and v_to` |

Indirect users, which need no change because they call those two: `dashboard_summary_at` / `dashboard_kpis_at` / `dashboard_push_list_at` (week waste tile), `app.kpi_report_json` (waste block, M22), the M24 exports (`waste-costs` table, `discards-vs-push` table) and the monthly pack. AVT and the stock reconciliation read `stock_movement` only; the unvalued-operations part of `raw_waste_costs` is raw stock.

### 1.3 Raw stock: calendar-dated too (question for the lead)

`stock_movement.effective_on` is also written with `app.venue_date` (`app.post_stock_outflow`, `approve_invoice`, counts, transfers, `void_line`'s raw half, staff meals' raw half) and is read by `raw_waste_costs`, `raw_waste_unvalued`, `stock_reconciliation`, `app.kpi_purchases`, the rules helpers (consumption in the last 14 days). A5 names batch movements, so **raw stock is NOT changed here**. Consequence to know about: `waste_costs` adds a raw part (calendar-dated) and a batch part (business-dated), so a 01:30 raw waste and a 01:30 batch discard land on different days in the same report. Also unchanged: the lot code `YYMMDD` of a batch and its `lot_date` (a printed label date, not a movement date).

## 2. Option choice

- **(a) Write the business date into new rows only.** Old rows keep the calendar date. Effect: every discard, staff-meal waste or void waste written between 00:00 and the cut-off before the fix stays one day late (and a week late on Monday 00:00-02:00). Closing-time discards are exactly that window, so staging rows are likely hit. Fixing them needs an UPDATE, which the ledger forbids.
- **(b) Readers derive the business date from `created_at`.** Chosen. Old and new rows behave the same, no backfill, no UPDATE, the writers do not change.
  - Why `created_at` is right: for every row a reader dates (discard, staff meal, void waste) the movement's `created_at` is the instant of the event (all three use `now()` or `clock_timestamp()`). The only rows where the dated instant differs from `created_at` are offline `consume` replays (client time `p_at`); no reader dates `consume` rows, and the risk is listed below.
  - Index and performance: a business day is an instant range. The readers compute it once, `[app.business_day_start(from), app.kpi_cutoff_end(to))`, and filter `created_at` with it, so no per-row function call. New index `batch_movement_created_idx (tenant_id, created_at)`. `batch_movement_effective_idx` (dashboard indexes migration) stays: it is merged and pinned by pgTAP 202, and the stored calendar `effective_on` stays valid as the venue date of the write; it is just no longer what the reports group by. Cost: one more index on an append-only table (cheap writes, small table), none on reads.

## 3. Changes

New migration `20261117100000_batch_movement_business_date.sql`:
- `app.business_day_start(tenant, date)` = `app.kpi_cutoff_end(tenant, date - 1)`: the instant business day D begins. DST-safe because both come from M11's helpers.
- `batch_movement_created_idx`.
- `create or replace public.waste_costs` and `app.discards_vs_push_json`: same signature, grants and role checks; only the date filter changes.
- Comment on `batch_movement.effective_on`: calendar date of the write; reports use `created_at` through the business-day range.

No writer changes. No existing migration is edited. No ledger row is updated.

## 4. Tests (pgTAP `257_business_date_discards.test.sql`, written first)

- Helpers: `app.business_date` at 01:30 / 02:30 / exactly 02:00; `business_day_start` and `kpi_cutoff_end` agree on both DST nights (2027-03-28 spring, 2026-10-25 autumn; Europe/Rome); closed to API roles.
- Discard at 01:30 Monday counts on Sunday in `waste_costs` (day range and week range) and in `discards_vs_push` for Sunday's ISO week; at 02:30 it counts on Monday; the KPI report waste block and `dashboard_summary_at` follow.
- Both DST nights: a discard in the 00:00-cut-off window of the night counts on the previous business day; just after counts on the new one.
- Existing row: a row stored before the fix, with the calendar `effective_on` (the next day), counts by `created_at`, with no UPDATE; the `effective_on` column of that row is untouched.
- Tenant custom cut-off (e.g. 04:00) is honoured; another tenant's rows never leak.
- Role gates unchanged (waiter refused).
- Existing tests that set `effective_on` as a stand-in for "the date of a waste movement" (136, 252, 256 and others found by the suite) are changed to set `created_at`, with the reason in a comment. Pins in 207, 240 and 255 (md5 of `waste_costs`) and the function-list pins that see the new `app` helpers (214/222/229 as the run shows) are updated on purpose, with comments. 256's index assertion moves to `batch_movement_created_idx`.
- Integration: remove the Monday 00:00-02:00 caveat and logic from `push-forecast.int.ts`; remove `sundayNight` and the business day -1..+1 waste read from `exports.int.ts`.

## 5. Risks

- A future reader that dates `consume` rows (offline replays carry the client time in `effective_on`, but `created_at` is the replay time) must not use `created_at`. Documented on the column comment.
- Mixed reports: raw part calendar, batch part business (1.3). Needs a founder answer before raw stock is changed.
- `batch_movement_effective_idx` is now unused by reports; dropping it is a separate decision.
- A tenant that changes its cut-off re-dates its history on the next read (also true of every other `business_date` use today).

## 6. Review fixes (second pass)

- **Dashboard week.** `app.dashboard_week` (waste tile of `dashboard_summary_at`, `dashboard_kpis`, `dashboard_push_list`; it has no other user) is now the ISO week of `app.business_date`, in `20261117100100_dashboard_week_business_date.sql`. The alert and Oggi lists keep `app.alert_business_date` (calendar, Q109) because they do not call it. `record_dashboard_open` keeps the calendar week (it counts opens, not waste).
- **Default waste range.** The web tier has no copy of the tenant cut-off, so `getWasteCosts` asks the new `public.business_date_of(p_at)` (any signed-in staff role, one date) when `to` is missing; `from` is the 1st of that business month.
- **Consequence for raw stock (open question, unchanged).** Raw waste is calendar-dated, so between 00:00 and the cut-off a raw waste is outside the default range and the tile week until 02:00. It is in the next report. Suites that need raw and batch waste together read an explicit yesterday-to-calendar-today range.
- **Cleanups.** `app.movement_business_date` was removed (no production caller; the migration is this branch's own and unmerged). The replaced functions' revokes and grants are restated.
