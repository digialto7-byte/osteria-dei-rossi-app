# ADR-025: Sales KPIs are frozen once per business date in a `daily_kpi` table, after the cut-off plus a grace period; ledger-based figures stay live

- **Status:** proposed
- **Date:** 2026-10-31
- **Decided by:** architect, on the M22 plan (`docs/plans/2026-10-31-m22-kpi-reporting.md`). Defaults Q145–Q155 are open.

## Context

- **PRD:**
  - Module 4 acceptance: "yesterday's KPIs are final by 03:00"; "food cost % on the dashboard matches the sum of the item-level report"; "the dashboard loads in under 2 seconds on a phone over 4G".
  - 4.2 lists the KPIs for daily, weekly, monthly and custom ranges, with comparison.
- **Project plan:**
  - §3.5.3 proposed `v_daily_kpi` as a **materialized** view;
  - §3.9 proposed `rollup_daily_kpi()` every 15 minutes, which "finalises business dates past cut-off";
  - §5a M22 AT3: "the rollup run after the cut-off finalises yesterday before 03:00 local; a re-run changes nothing. Nights of 2026-10-25 and 2027-03-28 produce exactly one row per business date".
- **M21 (ADR-023):**
  - a table counts on the business date of its close (`closed_business_date`);
  - a closed session is final, and its total and lines can no longer change;
  - `order_line_cost` is frozen at fire (M19).
- **M11/M15:** `app.business_date` with the tenant cut-off (default 02:00; DST rule: the first instant at or after the wall time, or the jump instant when the time does not exist).
- **Invariants (CLAUDE.md, ADR-002, ADR-003):**
  - every table has `tenant_id` and RLS;
  - balances are only derived from ledgers;
  - nothing is deleted, only reversed.
- **Other inputs whose figures can change after a date is over:**
  - invoices are approved later than their date (purchases are dated by the invoice);
  - waste is sometimes entered late;
  - the register total is entered or corrected the next morning (M21 `day_close` is append-only, and the latest entry wins);
  - AVT depends on monthly counts.

## Decision

- **A table, not a materialized view.**
  - `public.daily_kpi` has one row per `(tenant_id, business_date)`, with `tenant_id`, RLS (owner and admin read) and no write grant.
  - It is append-only: updates, deletes and truncates are refused, except through the demo purge (ADR-018).
  - It holds only **sales facts**: covers, tables, gross and net revenue, coperto, plates, costed net, frozen food cost, uncosted net, unmapped and incomplete plates, and covers by local hour.
- **Written only by `app.rollup_daily_kpi()`.** pg_cron runs it every 15 minutes in SQL: no HTTP hop and no secret.
  - It inserts one row per date with `on conflict do nothing`, under an advisory lock, one tenant at a time.
  - Each run is recorded in `app.job_run` and watched by `app.job_health_checks`.
  - Rows start at the tenant's first closed table, and every date after that gets a row, including days with zero sales.
- **Finality:** a date D is final once `now ≥ cutoff_end(D) + 10 minutes`. `cutoff_end(D)` is the first cut-off after the start of D's business day, computed with M11's DST-safe helpers.
  - The 10 minutes cover a table close that read the clock just before the cut-off and commits after the rollup's snapshot.
  - With the 02:00 default, yesterday is final at about 02:15.
  - On the spring-forward night (2027-03-28) the cut-off itself is 03:00 CEST, so the figures are final at about 03:15 (Q145).
- **One line-level SQL source** (`app.kpi_sales_lines`, per-line net rounded to 4 decimals, unconstrained `numeric` sums). It feeds the rollup, the live computation, the items report and the dashboard, so every reader adds the same values, and the dashboard and the item report agree to the cent.
- **Readers use the stored row when it exists, and compute the same row live otherwise**, marked `final: false`. This covers today and any missed run.
- **Figures that can legitimately change later are never snapshotted:** purchases, waste €, app vs register and AVT are computed live from their ledgers and entries on every read.

## Alternatives

- **Materialized view `v_daily_kpi` (project plan §3.5.3).**
  - Pros: declarative; a single `REFRESH`.
  - Cons:
    - Postgres materialized views do not support row-level security, so tenant isolation would need a definer wrapper anyway;
    - `REFRESH` recomputes every tenant and every date, so it cannot finalise one date, and a refresh after a backdated change rewrites figures the owner already saw.
  - Why not: it breaks "every table has RLS", and "final" would not mean final.
- **No snapshot, everything computed live.**
  - Pros: no table, no job; trivially "final" once the cut-off has passed.
  - Cons:
    - it cannot satisfy AT3 as written (a rollup run, a re-run, one row per date);
    - there is no frozen morning figure to trust;
    - every range report re-aggregates every line.
  - Why not: the acceptance wording and the trust goal. The live path is kept as the fallback.
- **Snapshot everything (purchases, waste, register too).**
  - Pros: one source for every figure.
  - Cons: late invoices, late waste and register corrections would leave frozen figures wrong forever, with no correction path.
  - Why not: correctness.
- **Per-item daily snapshot.**
  - Pros: faster item ranges.
  - Cons: a second table to keep consistent.
  - Why not: not needed at MVP volume; the closed-day index suffices.
- **Finalise exactly at the cut-off.**
  - Why not: the commit race described in the decision.
- **A Vercel cron or a pg_net route.**
  - Why not: the work is pure SQL. pg_cron inside Postgres needs no secret, and is already the pattern of `auth-purge` and `alert-rules`.

## Consequences

- **Good:**
  - the morning figures never move once final;
  - dashboard and item report agree to the cent;
  - DST nights give exactly one row per date, by construction;
  - range reports read stored rows;
  - tenant isolation follows the usual RLS rules.
- **Bad / accepted trade-offs:**
  - **"Final by 03:00" cannot be met on the spring-forward night with a 02:00 cut-off.** The figures are final at about 03:15 (Q145).
  - **A wrong stored row (a bug) can only be corrected by a reviewed migration.** CI compares stored rows with the live computation.
  - **One more scheduled job to monitor.**
  - **Purchases and waste for past days can still change, by design** (Q154).
  - **`daily_kpi` joins the demo purge list.** Rows are only written after real closed tables, so a fresh tenant can still start a demo.
- **What would make us revisit this:**
  - adopting M21 V1 (tables counted on their opening date): finality would then also have to wait for open sessions;
  - a need for corrected history (a versioned row instead of an immutable one);
  - per-item range reports becoming slow on real data (then a per-item snapshot);
  - the founder's answers to Q145 and Q154.
