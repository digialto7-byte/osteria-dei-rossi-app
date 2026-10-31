# Tech plan — Osteria Digitalization · M22 KPI reporting, AVT, unmapped items, owner dashboard

- **Client slug / internal:** `osteria-dei-rossi`.
  - Approved client facts in `docs/client-facts.md`: trading name, brand colours and fonts. **M22 uses none of them** beyond the existing tokens.
  - **No client figure is used.** GP targets, fixed costs, VAT rates, coperto and cut-off are settings the owner enters (M8, M17, M11) or open questions. Every number in this plan is a fake fixture value.
  - **The drafts in `docs/client/` are not used.** Fixtures reuse the M21 set: tenants "Osteria Demo A/B"; users "Titolare Demo", "Admin Demo", "Chef Demo", "Cameriere Demo"; tables "Tavolo 1–4 (demo)"; items "Spezzatino con polenta (demo)" 14,00 €, "Tagliatelle al ragù (demo)" 12,50 €, "Acqua (demo)" 3,00 € (unmapped), "Vino rosso (demo)" 40,25 € (unmapped); ingredients "Manzo (demo)", "Parmigiano (demo)"; location "Cella (demo)".
- **Repo and branch:** `osteria-dei-rossi-app`, worktree `/home/user/osteria-m22`, branch `feat/m22-kpi-reporting`, from `main` `0c73030` (M0–M21 except M10, owner dashboard, UX flows).
  - **Independent of M19b (PR #40, not merged).** No M22 object reads `kitchen_event` or any M19b function.
  - **Expected text conflict:** whichever of M19b and M22 merges second re-applies the other's line in three places: the pinned public-table lists of pgTAP `207` and `214`, and `222` line 8 (purge list "minus …"). This is a list union, not a design conflict.
- **Numbering:**
  - migrations `20261112100000`–`20261112100700`, with `…100800`–`…100900` kept for review fixes and `20261113100000`+ for variants. All of these sort after `main`'s latest (`20261110100400`) and after PR #40's range (`20261111100000`–`…100900`);
  - pgTAP `231`–`241` (M19b owns `223`–`230`; variants use `242`+);
  - ADR-025 (`docs/adr/adr-025-kpi-rollup.md`, proposed). ADR-024 belongs to PR #40;
  - questions from **Q145** (M19b ended at Q144); variants V1–V6 belong to this plan ("project V6" names the project plan's chef variant);
  - e2e `e2e/reports.spec.ts`, `e2e/perf/dashboard-4g.spec.ts`; workflow `.github/workflows/perf-dashboard-4g.yml`.
- **Shared check constraints:** no audit entity type, audit action or alert kind is added. `app.job_run`'s `job_run_job_check` is widened by `kpi-rollup` (step 1). `tests/config/check-constraint-union.test.ts` is unaffected.
- **Author:** architect · **Date:** 2026-10-31
- **Sources:**
  - `docs/prd.md`:
    - Goal 4;
    - 1.4: fixed-cost allocation and "cost in force on the day of sale";
    - 2.3: unmapped items;
    - Feature 1 (AVT) and Feature 3 (GP target on the dashboard);
    - 4.2: the KPI table;
    - the Module 4 acceptance and the success metrics.
  - Project plan:
    - §3.3 (reports row), §3.4 flow 6, §3.5.3 (`v_daily_kpi`, `rollup_daily_kpi`), §3.6, §3.9 (kpi-rollup), §3.11.2;
    - §5 row M22, §5a M22 (AT1–AT9), §5b project V6, §7 Q16–Q18, Appendix A.
  - Earlier plans and ADRs:
    - the owner dashboard plan `2026-10-28-owner-dashboard.md` and ADR-021;
    - the M21 plan §3.4 (its contract for M22) and ADR-023;
    - the M13 plan (counts, reconciliation);
    - the M8 plan and ADR-008 (cost engine);
    - the M19 plan and ADR-019 (frozen line cost).
  - The merged SQL and TS in §2. **Where merged code and a plan differ, the code wins.**

> **Flags for the founder (read first)**
> - **"Ieri" on Oggi.** Your dashboard gets an "Ieri" tile with yesterday evening's covers, net revenue, average spend per cover, average ticket and food cost %. Each figure sits next to the same weekday of the week before. A new "Report" screen holds the detail: ranges, plates, actual vs theoretical and unmapped items.
> - **Yesterday's sales figures are frozen once a night.** A scheduled job stores them about 15 minutes after the cut-off (02:15 with your 02:00 default). After that they never change. Until then the tile shows the same numbers marked "Provvisorio".
> - **On the night the clocks go forward (28 March 2027), "final by 03:00" cannot be met.** That night 02:00 does not exist, so the cut-off itself falls at 03:00. The figures are final at about 03:15 (Q145).
> - **Food cost % only counts the plates whose cost is known.** Drinks and dishes without a recipe are left out of that percentage, and so is the coperto. Their revenue is shown apart. The PRD can also be read as "divide by all revenue" (Q146 → V1).
> - **Purchases, waste and the register difference stay live.** An invoice dated last week and approved today still changes last week's purchases (Q154).
> - **Actual vs theoretical compares two monthly counts of the same storage area.** It works fully with one storage area, which is what the venue has today (A1).
> - **Dashboard opens are counted for you only** (the owner): a number per week, with no times and no admin counts (Q150, Q151).
> - **No new provider, dependency, secret or paid service.** There is one new scheduled job inside Supabase.
> - Q145–Q155 have **defaults in force for this build**. They go in the PR body.

## 1. Goal and scope

- **Goal:** the owner opens Oggi in the morning and sees how yesterday went: covers, net revenue, spend and food cost %, against a week before. These figures are final and never change after the night's cut-off. A "Report" screen answers the PRD 4.2 questions for any range. It also shows what disappeared beyond the recipes, and what is sold without a recipe.
- **In scope**
  - **Rollup (ADR-025):**
    - `public.daily_kpi`: one immutable row per tenant and business date, holding that date's **sales facts**;
    - `app.rollup_daily_kpi()`, run by pg_cron every 15 minutes. It finalises each business date once its cut-off plus a 10-minute grace has passed, and it is idempotent;
    - recorded in `app.job_run` and watched by `app.job_health_checks`.
  - **One line-level source** (`app.kpi_sales_lines`), used by the rollup, the live fallback, the items report and the dashboard. This is why the dashboard food cost % equals the item report to the cent (AT2).
  - **`app.plates_sold`**: M8 left it as a stub that returns 0, for M19/M21 to replace; neither did. M22 replaces it, so the fixed cost per plate starts to work once sales exist.
  - **Reports (owner, admin):**
    - `GET /api/reports/kpis`: day, week, month or custom range, with comparison and deltas. It covers every PRD 4.2 row except the per-item rows and AVT:
      - covers, net revenue, average spend per cover, average ticket, plates, food cost %;
      - purchases, waste € by reason, app vs register;
      - covers per hour and per weekday.
    - `GET /api/reports/items`: plates by item, mix %, net revenue, food cost, food cost % and food margin per plate. The owner also gets fixed cost per plate, gross margin per plate and contribution;
    - `GET /api/reports/avt`: counted consumption minus recipe consumption, by ingredient, in €, between two closed monthly counts;
    - `GET /api/reports/unmapped-items`: items sold without a recipe in an ISO week.
  - **Dashboard:**
    - `dashboard_summary()` gains the `yesterday` block;
    - `comingSoon` loses covers, revenue and average spend, and keeps one slot, `pushList`, for M23;
    - opens are counted through `POST /api/dashboard/opens`: owner only, a count per ISO week (AT9).
  - **Screens:** the "Ieri" tile on Oggi, and `/report` (owner, admin) with four views.
  - **Gate evidence (AT7):** a Playwright load-time measurement under Lighthouse's "Slow 4G" network profile, run against staging from a manual workflow. It reports numbers and promises none.
  - **Tests:** pgTAP `231`–`241`, two race cases, Vitest, an integration suite, Playwright.
- **Out of scope**
  - menu engineering (M34);
  - the push list content (M23; only its slot is reserved);
  - exports and the monthly pack (M24);
  - a weekly e-mail of unmapped items (A2);
  - any change to the costing, firing, closing or counting procedures. Only five functions are replaced (§3.2): `app.plates_sold` (a stub), `app.tenant_has_operational_data`, `app.job_health_checks`, `app.demo_purge_tables` and `public.dashboard_summary`;
  - the chef. Project V6 is in force (Q16), so the chef gets no M22 endpoint;
  - **`GET /api/reports/gp-below-target`** (project §3.3) is not built:
    - the dashboard's "Margini dei piatti" tile already ranks plates below their GP target (owner dashboard plan, decision 5);
    - `/costi` lists every plate with its status;
    - this is recorded as a plan change (§6).
  - **`GET /api/reports/waste`** (project §3.3) is not built: `GET /api/stock/waste-costs` (M15) already serves it, and the KPI report embeds its figures;
  - stock-outs per week (an Appendix A success-metric row, not in §5a M22): Q152 → V6.

## 2. Current state (`main` `0c73030`)

### 2.1 Reused as they are

| Object (file) | State on `main` | M22 uses it how |
|---|---|---|
| `table_session` (`20261031100000`, `20261110100000`) | `covers`, `opened_at`, frozen `coperto_total`, `coperto_vat_rate`, `closed_at`, `closed_business_date` (business date of the close, Q128), frozen `total`, index `table_session_closed_day_idx (tenant_id, closed_business_date) where closed_at is not null` | Sales of a business date are the closed sessions with `closed_business_date = D` (**M21 §3.4 contract**) |
| `order_line` (`20261101100000`) | `qty numeric(4,1)` (0,5 steps), VAT-inclusive `unit_price numeric(12,2)`, `vat_rate`, generated `state` (`draft`/`fired`/`voided`), `menu_item_id`, `course` | Non-voided lines of closed sessions. A closed session has no drafts (M21 `unsent_lines`) |
| `order_line_cost` (`20261106100000`) | Frozen at fire: `recipe_id` (null = unmapped), `total_cost` (null = incomplete), `incomplete`. Owner/admin RLS | Food cost of plates sold (PRD "cost in force on the day of sale"). A line voided after firing keeps its cost row but is **excluded**: it is not sold, and its cost is waste |
| `app.business_date(tenant, instant)` (`20261029100100`); `app.business_day_cutoff`, `app.local_instant`, `app.next_cutoff` (`20261025100100`) | DST rule: the first instant at or after the wall time; a missing time is the instant of the jump | Finality of a date (§3.4) |
| `app.fixed_cost_at(tenant, date)` (`20261023110300`) | Monthly total ÷ `app.plates_sold(date − 30, date − 1)`; reason `no_fixed_costs` / `no_sales` | Owner-only fixed cost per plate of each business date |
| `app.plates_sold` (`20261023110300`) | **Stub, `return 0`**, pinned by `179` | Replaced in step 1 (§3.1.9) |
| `public.waste_costs(from, to)` (`20261029100600`) | Owner/admin; raw + batch waste €, `unvaluedCount`, by reason | Embedded in the KPI report as it is |
| `app.app_vs_register_json` (`20261110100300`) | Live per date: app total, latest `day_close`, difference | Not called per date. The range report reads the same two sources with the same rules (§3.2) |
| `count_session`, `count_line` (`20261027100000`); `close_count` (`20261027100200`) | `type` daily/monthly, `status`, `location_id`, `closed_at = now()` of the close transaction; count movements carry `ref_type = 'count_session'` | AVT boundaries (§3.1.6) |
| `stock_movement` | Types `receipt`, `consumption`, `waste`, `transfer`, `count`; `unit_cost`; `effective_on`. Batch inputs carry `ref_type = 'batch'`; plate raw at fire carries `ref_type = 'order_line'` | Purchases (receipts) and AVT actual consumption |
| `app.batch_requirements(tenant, recipe_id, at)` (`20261028100100`) | Raw per one batch of a batch version, sub-recipes expanded at `at` | AVT theoretical consumption of batches (T1) |
| `app.ingredient_unit_costs(tenant, ids, at)` (`20261023110100`) | Cost on the ingredient's basis, in force at an instant; null = unknown | AVT valuation |
| `public.dashboard_summary()` (`20261108100300`) | Owner/admin JSON; `comingSoon: ["covers","revenue","averageSpend"]`; key sets pinned by `203`/`204` | Replaced in step 7 |
| `src/server/dashboard/{constants,sql-schema,output,render,summary}.ts`, `src/components/use-dashboard.ts`, `src/components/dashboard/*`, `src/components/charts/{bar-table,meter}.tsx`, `src/lib/charts/scale.ts`, `src/lib/dashboard/dashboard-view.ts` | Owner dashboard (ADR-021) | Extended (steps 12, 15) |
| `src/lib/money/format.ts`, `src/lib/time/format.ts`, `withApi`, `src/lib/api/errors.ts`, `src/lib/nav/nav-model.ts` | House helpers | Reused |
| `scripts/lib/perf-dashboard.ts` (`provisionOwner`, `measure`, `renderReport`), `scripts/lib/perf-order-entry.ts` (`nearestRank`, `summarize`), `.github/workflows/perf-order-entry.yml` (staging guard pattern) | Perf tooling | AT7 (step 18) |
| `app.job_run`, `app.job_run_begin/end`, `app.job_health_checks` (`20261027101300`); `job_run_job_check` = `{extract, alert-rules, auth-purge, ledger-invariants}` | Cron health | Widened (step 1) and replaced (step 2) |
| `app.tenant_has_operational_data` (`20261105100000`) | True if the tenant has any row in a `demo_purge_tables()` table, except users, audit, alerts, sessions and devices | Replaced in step 1 (§3.1.10) |

### 2.2 Missing

- No `daily_kpi`, no rollup, no KPI, items, AVT or unmapped endpoint, no `/report` screen, no opens count.
- **`v_daily_kpi` (project §3.5.3) is not built as a materialized view**, because materialized views have no RLS (ADR-025).

## 3. Design

### 3.1 Decisions

1. **Sales facts are snapshotted once per business date; everything else stays live** (ADR-025).
   - `public.daily_kpi` holds one row per (tenant, business date), with the sales aggregates of §3.3 rows 1–9 and 14.
   - After the cut-off, no write can change those aggregates. A closed session is final (M21), and a later close gets a later `closed_business_date`.
   - **Purchases, waste, AVT and app vs register are not snapshotted.** Each of them can legitimately change after the night:
     - an invoice dated in the past is approved later;
     - waste is entered late;
     - the register total is entered or corrected the next morning.

     They are computed live from their ledgers on every read (Q154).
2. **One line-level source.**
   - `app.kpi_sales_lines(p_tenant, p_from date, p_to date)` returns one row per non-voided line of the sessions closed in `[from, to]`, by `closed_business_date`. Each row has:
     - `business_date, session_id, menu_item_id, item_name, course, qty`;
     - `gross = round(qty × unit_price, 2)` and `net = round(gross / (1 + vat_rate / 100), 4)`;
     - `mapped` (`order_line_cost.recipe_id is not null`) and `costed` (mapped and `total_cost is not null`);
     - `food_cost` (`total_cost` when costed, else null).
   - The coperto is per session: `coperto_net = round(coperto_total / (1 + coperto_vat_rate / 100), 4)`.
   - The rollup, the live fallback, the items report and the dashboard all sum these exact values. Postgres `numeric` addition is exact, so the totals agree to the last digit whatever the grouping (AT2).
3. **Food cost % (Q146 default):** `Σ food_cost of costed lines ÷ Σ net of costed lines × 100`, rounded to 2 decimals from the unrounded sums.
   - Excluded from both sums, and reported apart:
     - unmapped items (drinks) and lines with an incomplete cost, as `uncostedRevenueNetEur`;
     - the coperto, as `copertoNetEur`.
   - `costedSharePct` = costed net ÷ item net × 100.
   - Null when no line is costed. **Unknown is never zero** (M8 rule).
4. **Finality** (§3.4). A business date D is final once `p_at ≥ cutoff_end(D) + app.kpi_finalise_grace()` (10 minutes).
   - `cutoff_end(D)` = `app.next_cutoff(app.local_instant(D, cutoff, tz), tz, cutoff)`: the first cut-off strictly after the start of D's business day, the instant at which `app.business_date` turns to D + 1.
   - The grace covers one race: a `close_table` that read `clock_timestamp()` just before the cut-off and commits just after the rollup's snapshot (§6).
   - Readers use the stored row when it exists (`final: true`). Otherwise they compute the same aggregates live, with `final: false` (today, or after a missed run).
5. **Which dates get a row.**
   - The rollup inserts a row for every date from the tenant's first `closed_business_date` (or the day after its last stored row) up to the last final date. Days with no sales get a zero row.
   - A tenant that has never closed a table gets no row, so `tenant_has_operational_data` stays false and a demo can still be started (§3.1.10).
   - `generate_series` over `date` values gives exactly one row per date, by construction and by the primary key. This holds on DST nights too (AT3).
6. **AVT, between two closed monthly counts of one location** (PRD Feature 1, 2.1; AT4).
   - **Window:**
     - C is the closing count, a closed `monthly` session. O is the opening count: the previous closed `monthly` session of the same location, by `closed_at`, then id.
     - The window's movements are the location's `stock_movement` rows with `created_at > O.closed_at` and `created_at ≤ C.closed_at`.
     - Count rows are chosen by reference instead: C's rows are in, O's rows are out.
   - **Actual (counted) consumption** per ingredient I = −Σ `qty` of the window's movements of every type except `receipt` and `transfer`.
     - This equals `counted(O) + receipts + transfers in − transfers out − counted(C)`, because each count adjustment brings the ledger to the counted quantity.
     - Recorded waste is part of it, and is also shown as its own column, `wasteQty` (Q149 → V4).
   - **Recipe (theoretical) consumption** per I, in two parts:
     - (a) **Batches** produced in the window whose input movements are at the location: `app.batch_requirements(batch.recipe_id, batch.produced_at) × batch.output_qty ÷ recipe.output_qty`. This is what the recipe says for the output actually made; the chef's confirmed inputs are in "actual".
     - (b) **Plate raw** booked at fire (`consumption` with `ref_type = 'order_line'`), for lines fired in the window and not voided, net of their reversals. Fire books the recipe quantity, so this is recipe consumption.
   - **Listed ingredients:** only stock ingredients (`is_stock`) with a counted quantity in both O and C. The others are counted in `notCountedCount`.
   - **Valuation:**
     - `varianceQty = actualQty − theoreticalQty`. A positive value means more disappeared than the recipes say;
     - `varianceEur = round(varianceQty × unit_cost(I, C.closed_at), 4)`, with the cost from `app.ingredient_unit_costs`;
     - null when the cost is unknown, and then counted in `unvaluedCount`.
   - **More than one active location:** the report sets `locationsActive`, and the screen shows "Con più ubicazioni il confronto è indicativo" (A1).
7. **Comparison and deltas (Q148 default; AT6).**
   - **Periods:** `day` (D); `week` (the ISO week containing D, Monday–Sunday); `month` (the calendar month of D); `custom` (`from`–`to`, at most 366 days).
   - **Comparison:** `day` → D − 7 (same weekday); `week` → previous ISO week; `month` → previous calendar month; `custom` → the same number of days immediately before.
   - Every numeric KPI has `delta: {abs, pct}`. `pct = round(abs ÷ previous × 100, 1)`, null when the previous value is 0 or null.
   - `to` may not be after today's business date (`date_in_future`). Today is included live, with `final: false`.
8. **Roles** (§3.7): owner and admin read every M22 report; the chef (project V6) and the waiter get 42501 / 403.
   - **Fixed-cost-derived keys are owner-only** (Q107): fixed cost per plate, gross margin per plate and contribution exist only in the owner's item rows.
   - pgTAP proves the admin key set exactly.
9. **`app.plates_sold` (the M8 stub) is replaced** by Σ `qty` of the `app.kpi_sales_lines` rows with `mapped` in `[from, to]`.
   - "Plates" are lines whose item has a recipe (M8's comment says "plate lines"; A3), so drinks carry no fixed cost.
   - From this step on, the owner's `fixed_cost_status`, `plate_costs` and the dashboard's `fixedCosts` show a per-plate figure once 30 days of sales exist. This is the M8 design coming into force, not a new behaviour.
   - `179`'s pin is updated on purpose.
10. **Demo data compatibility.**
    - `daily_kpi` and `dashboard_open` join `app.demo_purge_tables()`, before `app_user` (`194`, `193`).
    - `app.tenant_has_operational_data` skips `dashboard_open`: an owner who opened Oggi before a demo must still be able to start it.
    - `daily_kpi` needs no skip: it exists only after a closed table (decision 5).
11. **Dashboard opens (AT9; Q150, Q151).**
    - **Table:** `public.dashboard_open (tenant_id, app_user_id, iso_week date, opens integer)`, primary key `(tenant_id, app_user_id, iso_week)`. `iso_week` is the Monday of the venue date's ISO week (Europe/Rome).
    - **Write:** only through `public.record_dashboard_open()`, owner only, as `insert … on conflict do update set opens = opens + 1`.
    - **When:** the page posts once per mount of Oggi, after the first successful load. Focus refreshes are not counted.
    - **Count only:** no timestamp, no device, no admin rows.
    - **Read:** owner and admin, through RLS. DigiAlto reads the Gate 4 evidence with a documented query (§8).
12. **No data logic in React.**
    - SQL computes every sum, ratio, delta, range and status.
    - `src/lib/reports/report-view.ts` only formats ("1.234,50 €", "29,82 %", "+162,1 %", with U+2212 for minus), labels and picks empty states.
13. **Personal data.**
    - The reports carry business data only: item, ingredient and location names, and amounts.
    - No staff or guest names: the range report does not carry M21's `enteredBy` or `missingReceipts` lists.
    - `dashboard_open` is personal data (the owner's usage), minimised to a weekly count. Its retention is Q151 → V5.
    - Nothing leaves Supabase (EU). Logs carry codes and SQLSTATEs only.
14. **Implicit defaults, each tested with ≥ 2 candidates:**
    - two tenants; two business dates (D and D − 7);
    - a closed session vs an open one vs one closed on D + 1;
    - a fired line vs one voided after fire;
    - mapped vs unmapped vs incomplete-cost items; VAT 10 % vs 22 %; coperto vs none;
    - a normal night vs both DST nights; cut-off 02:00 vs `"00:30"`; grace − 1 s vs + 0 s;
    - AVT: an ingredient with a loss vs one without; costed vs unpriced;
    - owner vs admin key sets; two ISO weeks for opens.

### 3.2 Data model and SQL

**Common rules:**
- every function is `security definer` with `set search_path = ''`;
- public functions take the tenant from the caller's `app.tenant_id()`;
- every `app.*` function is revoked from all API roles;
- every public function gets `revoke all … from public, anon, service_role; grant execute … to authenticated`.

**Fixed-instant rule** (the M21 `app.close_session_at` pattern):
- Every public M22 function is a thin wrapper. It checks the role **first**, then calls an `app.*` twin with `(app.tenant_id(), app.role(), …, now())`.
- The twins are `app.kpi_report_json`, `app.kpi_items_json`, `app.unmapped_items_json` and `app.dashboard_summary_at`.
- pgTAP calls the twins as the migration owner with a fixed `p_now`. The fixtures are dated 2026-11-04 and 2027-03-28, which would otherwise hit `date_in_future` or "yesterday" relative to the real clock.
- The role argument only selects the owner-only keys. It never grants access, since only the wrapper is executable by an API role.
- `avt_report` does not depend on "now".

**`20261112100000_kpi_core.sql`** (step 1)
- `public.daily_kpi`:
  - `tenant_id uuid not null references tenant` and `business_date date not null`, primary key `(tenant_id, business_date)`;
  - `tables integer`, `covers integer`, `revenue_gross numeric`, `items_net numeric`, `coperto_net numeric`, `plates numeric`, `costed_net numeric`, `food_cost numeric`, `uncosted_net numeric`, `unmapped_plates numeric`, `incomplete_plates numeric`. All are `not null` and `>= 0`; the `numeric` columns have no typmod, so nothing is rounded before summing;
  - `covers_by_hour integer[] not null check (cardinality(covers_by_hour) = 24)`: element h + 1 holds the covers of local hour h of `opened_at`;
  - `finalised_at timestamptz not null default clock_timestamp()`, `job_run_id bigint`;
  - append-only: `app.append_only` on update/delete and `app.append_only_truncate`, both honouring `app.demo_purge_allows`;
  - RLS on, with policy `daily_kpi_select` for owner and admin;
  - `revoke all … from anon, authenticated, service_role; grant select … to authenticated, service_role`. No write grant.
- `public.dashboard_open`:
  - `tenant_id`, `app_user_id`, `iso_week date check (extract(isodow from iso_week) = 1)`, `opens integer not null check (opens >= 1)`, `created_at`, `updated_at`;
  - FK `(tenant_id, app_user_id) → app_user`;
  - RLS select for owner and admin. No write grant: writes go only through the definer.
  - Not append-only: it is a counter, not a ledger.
- `app.kpi_sales_lines(p_tenant, p_from, p_to)` (decision 2), and `app.kpi_session_rows(p_tenant, p_from, p_to)`, which returns per session `business_date, covers, opened_local_hour, total, coperto_net`.
- `app.kpi_day_row(p_tenant, p_date) returns public.daily_kpi`: the live aggregate of one date. `finalised_at` is null and nothing is inserted.
- `create or replace function app.plates_sold(p_tenant, p_from, p_to)` (decision 9): same signature, `stable`, definer.
- `create or replace function app.tenant_has_operational_data(uuid)`: verbatim, plus `'dashboard_open'` in the skip list.
- `job_run_job_check` re-created as the current list plus `'kpi-rollup'`.

**`20261112100100_kpi_rollup.sql`** (step 2)
- `app.kpi_finalise_grace() returns interval` (immutable, `'10 minutes'`), and `app.kpi_rollup_max_days()` (immutable, 400).
- `app.kpi_cutoff_end(p_tenant, p_date) returns timestamptz` (decision 4).
- `app.kpi_last_final_date(p_tenant, p_at) returns date`: the greatest D with `p_at ≥ kpi_cutoff_end(D) + grace`.
- `app.rollup_daily_kpi(p_at timestamptz default now()) returns integer` (the rows inserted):
  - `job_run_begin('kpi-rollup')`, then `pg_advisory_xact_lock(hashtextextended('kpi-rollup', 0))`;
  - each tenant runs in its own `begin … exception` block;
  - the dates run from `coalesce(max(daily_kpi.business_date) + 1, min(closed_business_date))` to `kpi_last_final_date`, at most `app.kpi_rollup_max_days()` per run. Gaps before the last stored row are filled too (`not exists`);
  - each date is written as `insert … select (app.kpi_day_row(...)).* … on conflict do nothing`;
  - a failed tenant is skipped with `raise warning` (SQLSTATE only), and the run ends with `ok = false`, `error_code = 'rollup_failed'`.
- `select cron.schedule('kpi-rollup', '*/15 * * * *', $job$select app.rollup_daily_kpi()$job$);` is SQL only: no pg_net, no `CRON_SECRET`.
- `create or replace function app.job_health_checks(...)`: verbatim from `20261027101300`, with two additions:
  - `kpi-rollup` is stale when it has had no successful run in the last 60 minutes (own-history rule);
  - `'kpi-rollup'` joins the `job_unscheduled` list.

**`20261112100200_kpi_report.sql`** (step 3)
- `app.kpi_period(p_tenant, p_period text, p_date date, p_from date, p_to date, p_now timestamptz) returns table (from_d, to_d, cmp_from, cmp_to)` (decision 7).
  - Errors: P0001 `range_invalid`, `range_too_long`, `date_in_future`; 22023 for an unknown period.
  - `p_date` null means yesterday's business date.
- `app.kpi_range_agg(p_tenant, p_from, p_to) returns jsonb`: the stored rows plus `kpi_day_row` for the missing dates, with `final`, `daysFinal` and `days`.
- `app.kpi_purchases(p_tenant, p_from, p_to)`: Σ `round(qty × unit_cost, 4)` of the `receipt` movements (and their reversals) with `effective_on` in range, plus `unvaluedCount` for a null `unit_cost`.
- `app.kpi_register_range(p_tenant, p_from, p_to)`:
  - app total = Σ `table_session.total` by `closed_business_date`;
  - register = the latest `day_close` of each date (the M21 rule);
  - `difference {amount, pct}`, with pct of the register total, 1 decimal, null at 0;
  - `datesWithoutRegister`: dates with app sales and no register entry.
- `app.kpi_report_json(p_tenant, p_role, p_period, p_date, p_from, p_to, p_now)` and the wrapper `public.kpi_report(p_period text, p_date date, p_from date, p_to date) returns jsonb`.
  - The wrapper checks the role (owner, admin) **first**.
  - The reply is `{period, current, previous, delta}`. `delta` has one entry per key of `DELTA_KEYS` (§3.5).
  - Each block has:
    - `{from, to, final, daysFinal, days}`;
    - `covers, tables, revenueGrossEur, revenueNetEur, copertoNetEur, avgSpendPerCoverEur, avgTicketEur`;
    - `plates, foodCostEur, foodCostPct, costedRevenueNetEur, uncostedRevenueNetEur, costedSharePct`;
    - `coversByHour[24], coversByWeekday[7]`;
    - `purchasesEur, purchasesUnvaluedCount`;
    - `waste: {valueEur, unvaluedCount, reasons}`, from `public.waste_costs`, which re-checks the role;
    - `appVsRegister: {appTotalEur, registerTotalEur, difference, datesWithoutRegister}`.

**`20261112100300_kpi_items.sql`** (step 4)
- `app.kpi_items_json(p_tenant, p_role, …, p_now)` and the wrapper `public.kpi_items(p_period, p_date, p_from, p_to) returns jsonb`. The reply is `{role, period, from, to, final, rows, totals}`.
- **Row:** `menuItemId, name, course, plates, mixPct, revenueNetEur, costedPlates, costedRevenueNetEur, foodCostEur, foodCostPct, foodMarginPerPlateEur, status`, with `status` one of `costed`, `partial`, `incomplete`, `unmapped`.
- **Owner only:** `fixedCostPerPlateEur`, `grossMarginPerPlateEur`, `contributionEur`, `fixedCostReason`.
  - Fixed cost per plate = Σ over the costed lines of `qty × fixed_cost_at(business_date).per_plate`, ÷ `costedPlates`.
  - Gross margin per plate = food margin per plate − fixed cost per plate.
  - Contribution = gross margin per plate × plates (PRD).
  - All three are null when any date lacks a per-plate figure; `fixedCostReason` then says why.
- **Order:** plates desc, then name `collate "C"`, then id.
- **`totals`** `{plates, revenueNetEur, costedRevenueNetEur, foodCostEur, foodCostPct}` equals the same period's `kpi_report.current` (AT2).

**`20261112100400_avt_report.sql`** (step 5)
- `app.avt_rows(p_tenant, p_open uuid, p_close uuid)` (decision 6).
- `public.avt_report(p_count uuid) returns jsonb`:
  - checks the role first; `p_count` null means the latest closed monthly count of the tenant;
  - errors: P0002 `count_not_found`; P0001 `avt_count_not_monthly`, `avt_count_not_closed`, `avt_no_opening_count`.
- The reply is:
  - `count: {id, closedAt, locationName}` and `openingCount: {id, closedAt}`;
  - `locationsActive`;
  - `rows: [{ingredientId, name, baseUnit, actualQty, theoreticalQty, wasteQty, varianceQty, unitCostEur, varianceEur}]`, ordered by `abs(varianceEur)` desc nulls last, then name;
  - `totals: {varianceEur, lossEur, gainEur, unvaluedCount, notCountedCount}`;
  - `availableCounts: [{id, closedAt, locationName}]`, at most 12, newest first.

**`20261112100500_unmapped_items.sql`** (step 6)
- `app.unmapped_items_json(p_tenant, p_week, p_now)` and the wrapper `public.unmapped_items(p_week date) returns jsonb`.
  - `p_week` is any date of the ISO week; null means the week of the current business date; a future date is refused.
- The reply is `{weekFrom, weekTo, rows: [{menuItemId, name, plates, revenueGrossEur, lastSoldOn}], totals: {plates, revenueGrossEur}}`.
- The rows come from the lines of the sessions closed in the week whose frozen `order_line_cost.recipe_id` is null (unmapped **at sale**). They are ordered by plates desc, then name.

**`20261112100600_dashboard_kpis.sql`** (step 7)
- `app.dashboard_summary_at(p_tenant, p_role, p_now)` holds the merged body of `dashboard_summary`, with two changes:
  - `comingSoon` = `["pushList"]`;
  - a new key **`yesterday`**, for both roles: `{businessDate, final, covers, tables, revenueNetEur, avgSpendPerCoverEur, avgTicketEur, foodCostPct, costedSharePct, compare: {businessDate, covers, revenueNetEur, avgSpendPerCoverEur, avgTicketEur, foodCostPct}, delta: {covers, revenueNetEur, avgSpendPerCoverEur, avgTicketEur, foodCostPct}}`. "Yesterday" is `app.business_date(tenant, p_now) − 1`, built with `app.kpi_range_agg`, so it equals `kpi_report('day', D)`.
- `create or replace function public.dashboard_summary()` keeps its role gate (unchanged), then calls `app.dashboard_summary_at(app.tenant_id(), role, now())`.
- `public.record_dashboard_open() returns jsonb`:
  - owner only (42501 otherwise);
  - upserts on `(tenant, user, monday of app.venue_date(now(), tz))`;
  - replies `{isoWeek, opens}`. Its twin `app.record_dashboard_open_at(p_tenant, p_user, p_now)` is the one pgTAP calls.

**`20261112100700_demo_purge_tables_m22.sql`** (step 9): `app.demo_purge_tables()` as merged, with `'daily_kpi'` and `'dashboard_open'` added before `'app_user'`.

**Not replaced** (`240` md5-pins them):
- tables and bills: `close_table`, `app.close_session_at`, `app.session_bill_json`, `app.app_vs_register_json`;
- firing and costing: `fire_course`, `void_line`, `app.freeze_line_cost`, `app.plate_cost_rows`, `app.fixed_cost_at`;
- stock and counts: `public.waste_costs`, `public.count_variance`, `public.count_variance_costs`, `public.stock_reconciliation`, `app.batch_requirements`;
- time and checks: `app.business_date`, `app.next_cutoff`, `app.local_instant`, `app.ledger_checks_body`, `public.today_counts`.

### 3.3 KPI definitions (PRD 4.2 → field → source)

| # | PRD KPI | Field(s) | Definition here | Stored in `daily_kpi`? |
|---|---|---|---|---|
| 1 | Covers | `covers` | Σ `covers` of the sessions closed on D | yes |
| 2 | Revenue (net of VAT) | `revenueNetEur` (+ `revenueGrossEur`) | Σ line `net` + Σ `coperto_net` (decision 2); gross = Σ `table_session.total` | yes (`items_net`, `coperto_net`, `revenue_gross`) |
| 3 | Average spend per cover | `avgSpendPerCoverEur` | net revenue ÷ covers; null at 0 covers | derived from 1 and 2 |
| 4 | Average ticket | `avgTicketEur` | net revenue ÷ tables; null at 0 tables | derived (`tables`) |
| 5 | Plates sold by item | items `plates` | Σ `qty` per menu item (0,5 = half) | the total `plates`, yes; per item, live |
| 6 | Mix % | items `mixPct` | item plates ÷ total plates × 100, all items (Q147 → V2) | live |
| 7 | Food cost % | `foodCostPct` | decision 3 | yes (`food_cost`, `costed_net`, `uncosted_net`) |
| 8 | Gross margin per plate | items `foodMarginPerPlateEur`; owner `grossMarginPerPlateEur` | (costed net − food cost) ÷ costed plates; for the owner, minus the fixed cost per plate | live |
| 9 | Contribution by item | owner `contributionEur` | gross margin per plate × plates | live |
| 10 | Purchases | `purchasesEur` | receipts at cost, by `effective_on` (§3.2) | **no** (live) |
| 11 | Waste € by reason | `waste` | `public.waste_costs(from, to)` | **no** (live) |
| 12 | Actual vs theoretical | the AVT endpoint | decision 6 | **no** (on demand, per count) |
| 13 | App vs register | `appVsRegister` | `kpi_register_range` (§3.2) | **no** (live) |
| 14 | Covers per hour / per weekday | `coversByHour[24]`, `coversByWeekday[7]` (Mon–Sun) | local hour of `opened_at` (Europe/Rome); ISO weekday of `closed_business_date` | yes (`covers_by_hour`); the weekday is derived per date |

- **Amounts in JSON keep the internal precision:** € to 4 decimals. Project §3.5 says money is "numeric(12,4) internally and rounded to cents only for display". This lets a client or a test add up the item rows and get the total to the cent (AT2).
- **Percentages** are rounded to 2 decimals, and delta percentages to 1, always from unrounded sums.
- The browser only formats ("119,13 €").

### 3.4 Finality and DST (AT3)

Cut-off 02:00 (Q18 default). Every row follows M11's rule, and `232` asserts each one.

| Business date D | `cutoff_end(D)` (UTC) | Local | Final from (grace + 10 min) | First `*/15` run that finalises (UTC / local) |
|---|---|---|---|---|
| 2026-11-04 (normal) | 2026-11-05 01:00Z | 02:00 CET | 01:10Z | 01:15Z / 02:15 CET |
| 2026-10-24 (autumn: 02:00 occurs twice) | 2026-10-25 00:00Z (the first 02:00, CEST) | 02:00 CEST | 00:10Z | 00:15Z / 02:15 CEST |
| 2026-10-25 | 2026-10-26 01:00Z | 02:00 CET | 01:10Z | 01:15Z / 02:15 CET |
| 2027-03-27 (spring: 02:00 does not exist) | 2027-03-28 01:00Z (the jump) | 03:00 CEST | 01:10Z | 01:15Z / **03:15 CEST** (Q145) |
| 2027-03-28 | 2027-03-29 00:00Z | 02:00 CEST | 00:10Z | 00:15Z / 02:15 CEST |

- **Autumn night.** The runs at 00:15Z, 00:30Z, … 01:45Z, including the second 02:xx CET, find 2026-10-24 already stored and insert nothing. 2026-10-25 waits until 2026-10-26. **Exactly one row each.**
- **Earlier cut-off.** With a cut-off of `"00:30"`, D = 2026-11-04 is final from 2026-11-04 23:40Z.

### 3.5 API (Zod 4; `withApi`; strict query → 400; `{"error":{"code","message"}}`; `Cache-Control: no-store`; `Server-Timing` as on the dashboard)

```ts
// src/server/reports/constants.ts
export const PERIODS = ["day", "week", "month", "custom"] as const;       // = app.kpi_period
export const MAX_RANGE_DAYS = 366;                                          // = app.kpi_period
export const KPI_FINALISE_GRACE_MIN = 10;                                   // = app.kpi_finalise_grace()
export const AVT_AVAILABLE_COUNTS = 12;
export const DELTA_KEYS = ["covers", "tables", "revenueGrossEur", "revenueNetEur", "avgSpendPerCoverEur",
  "avgTicketEur", "plates", "foodCostEur", "foodCostPct", "purchasesEur", "wasteEur", "appTotalEur"] as const;
// src/server/reports/schemas.ts
export const periodQuery = z.strictObject({
  period: z.enum(PERIODS).default("day"),
  date: z.iso.date().optional(),                 // anchor for day/week/month; default = yesterday's business date (SQL)
  from: z.iso.date().optional(), to: z.iso.date().optional(),
}).refine((q) => (q.period === "custom") === (q.from !== undefined && q.to !== undefined), "custom_needs_from_to");
export const avtQuery = z.strictObject({ count: z.uuid().optional() });
export const unmappedQuery = z.strictObject({ week: z.iso.date().optional() });
// src/server/reports/output.ts — strict, one schema per role where keys differ; snapshot-tested
const eur = z.number(); const pct = z.number().min(-100000).max(100000);
const kpiBlock = z.strictObject({ from: z.iso.date(), to: z.iso.date(), final: z.boolean(),
  daysFinal: z.number().int(), days: z.number().int(), covers: z.number().int(), tables: z.number().int(),
  revenueGrossEur: eur, revenueNetEur: eur, copertoNetEur: eur, avgSpendPerCoverEur: eur.nullable(),
  avgTicketEur: eur.nullable(), plates: z.number(), foodCostEur: eur, foodCostPct: pct.nullable(),
  costedRevenueNetEur: eur, uncostedRevenueNetEur: eur, costedSharePct: pct.nullable(),
  coversByHour: z.array(z.number().int()).length(24), coversByWeekday: z.array(z.number().int()).length(7),
  purchasesEur: eur, purchasesUnvaluedCount: z.number().int(),
  waste: z.strictObject({ valueEur: eur, unvaluedCount: z.number().int(),
    reasons: z.array(z.strictObject({ reasonCode: z.string(), valueEur: eur })) }),
  appVsRegister: z.strictObject({ appTotalEur: eur, registerTotalEur: eur.nullable(),
    difference: z.strictObject({ amount: eur, pct: pct.nullable() }).nullable(),
    datesWithoutRegister: z.array(z.iso.date()) }) });
const delta = z.strictObject({ abs: z.number(), pct: pct.nullable() }).nullable();
export const kpiReportOutput = z.strictObject({ period: z.enum(PERIODS), current: kpiBlock, previous: kpiBlock,
  delta: z.strictObject(Object.fromEntries(DELTA_KEYS.map((k) => [k, delta]))) });
const itemBase = { menuItemId: z.uuid(), name: z.string().max(200), course: z.string(), plates: z.number(),
  mixPct: pct, revenueNetEur: eur, costedPlates: z.number(), costedRevenueNetEur: eur, foodCostEur: eur.nullable(),
  foodCostPct: pct.nullable(), foodMarginPerPlateEur: eur.nullable(),
  status: z.enum(["costed", "partial", "incomplete", "unmapped"]) };
const itemsCommon = { period: z.enum(PERIODS), from: z.iso.date(), to: z.iso.date(), final: z.boolean(),
  totals: z.strictObject({ plates: z.number(), revenueNetEur: eur, costedRevenueNetEur: eur, foodCostEur: eur,
    foodCostPct: pct.nullable() }) };
export const adminItemsOutput = z.strictObject({ role: z.literal("admin"), ...itemsCommon,
  rows: z.array(z.strictObject(itemBase)) });
export const ownerItemsOutput = z.strictObject({ role: z.literal("owner"), ...itemsCommon,
  rows: z.array(z.strictObject({ ...itemBase, fixedCostPerPlateEur: eur.nullable(),
    grossMarginPerPlateEur: eur.nullable(), contributionEur: eur.nullable(),
    fixedCostReason: z.enum(["no_fixed_costs", "no_sales"]).nullable() })) });
export const itemsOutput = z.discriminatedUnion("role", [ownerItemsOutput, adminItemsOutput]);
// avtOutput, unmappedOutput: the keys of §3.2, strict
```

| Endpoint | Roles | Query / body | Success | Errors |
|---|---|---|---|---|
| `GET /api/reports/kpis` | owner, admin | `periodQuery` | 200 `kpiReportOutput` | 400; 401; **403 chef, waiter (before any RPC)**; 422 `range_invalid`, `range_too_long`, `date_in_future` |
| `GET /api/reports/items` | owner, admin | `periodQuery` | 200 `itemsOutput` | as above |
| `GET /api/reports/avt` | owner, admin | `avtQuery` | 200 `avtOutput` | 400; 401; 403; 404 `count_not_found`; 422 `avt_count_not_monthly`, `avt_count_not_closed`, `avt_no_opening_count` |
| `GET /api/reports/unmapped-items` | owner, admin | `unmappedQuery` | 200 `unmappedOutput` | 400; 401; 403; 422 `date_in_future` |
| `GET /api/dashboard` (changed) | owner, admin | none | 200, with `tiles.yesterday` and `comingSoon: ["pushList"]` | unchanged |
| `POST /api/dashboard/opens` | **owner** | `{}` (JSON, ≤ 64 B) | 200 `{isoWeek, opens}` | 401; 403 admin, chef, waiter (before any RPC); 413; 415 |

- **Files:**
  - `src/server/reports/{constants,schemas,output,errors,kpis,items,avt,unmapped}.ts`;
  - `src/app/api/reports/{kpis,items,avt,unmapped-items}/route.ts`;
  - `src/app/api/dashboard/opens/route.ts`;
  - `src/server/dashboard/{sql-schema,output,summary}.ts` (changed) and `opens.ts` (new).
- **Errors:** `ErrorCode` gains `range_invalid`, `range_too_long`, `date_in_future`, `avt_count_not_monthly`, `avt_count_not_closed`, `avt_no_opening_count` and `report_unavailable`.
- **Parsing:** each SQL reply is parsed with the strict schema of the caller's role before it is sent. An unexpected key, such as an admin `fixedCostPerPlateEur` or an injected `unit_cost`, gives 500 `report_unavailable` ("Il report non è disponibile. Riprova tra poco.") and never reaches the JSON.

### 3.6 Screens (Italian first, English second; 360 px first; targets ≥ 44 px; every value from `/api/*`; charts per ADR-021)

**Oggi (`/`), owner and admin: the "Ieri" tile** (`src/components/dashboard/yesterday-tile.tsx`). It comes first in `tileOrder`, after the to-dos.
- **Title:** "Ieri · mercoledì 4 novembre" (the business date, in Europe/Rome), with a `Badge` "Provvisorio" (`warning`) when `final` is false.
- **Five figures**, each with its comparison and delta:
  - "Coperti 5 · mercoledì scorso 2 · +3";
  - "Incasso netto 119,13 € · +162,1 %";
  - "Spesa media per coperto 23,83 €";
  - "Scontrino medio 59,56 €";
  - "Food cost 29,82 %", with the hint "sui piatti con costo noto (71,59 € di 119,13 €)".

  The delta words "in più" / "in meno" are printed; colour is never the only signal.
- **Link:** "Apri report" → `/report`.
- **Empty** (`covers = 0` on a final day): "Nessun tavolo chiuso ieri."
- **"In arrivo" tile:** now only "Da spingere oggi" with "Disponibile a breve" (no digit, no link).
- **Opens:** `use-dashboard.ts` calls `POST /api/dashboard/opens` once per mount, after the first successful load, and only when `role = owner`.
  - A failure is ignored (logged by code).
  - Focus refreshes do not post.

**`/report` (owner, admin)**
- **Files:** `src/app/(owner)/report/{page,period-picker,kpi-panel,items-panel,avt-panel,unmapped-panel}.tsx`; helpers in `src/lib/reports/report-view.ts`.
- **Layout:**
  - a segmented control "Andamento · Piatti · Scostamenti · Non mappati" (`?vista=`);
  - a period picker "Giorno · Settimana · Mese · Periodo" with a date input (`?periodo=&data=&dal=&al=`).
- **Andamento:**
  - pairs "Questo periodo / Periodo di confronto", with deltas, for every KPI in §3.3 rows 1–4, 7, 10, 11 and 13;
  - "Coperti per ora" and "Coperti per giorno della settimana" as `BarTable`s, with 24 and 7 rows. On the phone, hours with 0 covers are hidden;
  - "Provvisorio: 1 giorno su 7 non ancora chiuso" when `daysFinal < days`;
  - under app vs register, the dates without a register total ("Totale cassa non inserito: 28 ott").
- **Piatti:**
  - one row per item, with `data-menu-item-id`: plates, "Mix 27,78 %", net revenue, food cost %, "Margine per piatto 8,53 €";
  - for the owner only: "Costi fissi 5,00 €", "Margine lordo 3,53 €", "Contributo 8,82 €";
  - a `Badge` "Senza ricetta" (unmapped), "Costo incompleto" or "Costo parziale";
  - a totals row that repeats the period's food cost %.
- **Scostamenti:**
  - a count picker built from `availableCounts`: "Inventario mensile del 30/11 · Cella (demo)";
  - rows such as "Manzo (demo) · consumato 5,8 kg · da ricetta 5,0 kg · scarti registrati 0,2 kg · differenza +0,8 kg · 9,60 €";
  - totals "Perdita 9,60 € · Guadagno 0,00 € · 1 ingrediente senza prezzo · 2 non contati";
  - empty states: no monthly count yet → "Serve un inventario mensile chiuso.", with a link to `/magazzino/inventari`; only one count → "Serve un secondo inventario mensile per confrontare.";
  - with more than one location: "Con più ubicazioni il confronto è indicativo."
- **Non mappati:**
  - an ISO week picker, "Settimana dal 02/11 all'08/11";
  - rows such as "Vino rosso (demo) · 1 · 40,25 € · ultimo 4 nov", with the link "Collega una ricetta" → `/menu`;
  - empty: "Tutti i piatti venduti hanno una ricetta."
- **Nav:** "Report" in the group `gestione` (`canReadReports`: owner, admin). A chef or waiter on `/report` sees "I report sono riservati al titolare."

### 3.7 Who calls what (§3.11.2, with project V6 in force)

| Object | owner | admin | chef | waiter | DB enforcement |
|---|---|---|---|---|---|
| `kpi_report`, `kpi_items`, `avt_report`, `unmapped_items` | ✓ (items with fixed-cost keys) | ✓ (no fixed-cost key) | 42501 | 42501 | `app.require_day_closer()` (owner, admin; M21), checked first |
| `dashboard_summary` (`yesterday`) | ✓ | ✓ | 42501 | 42501 | unchanged gate |
| `record_dashboard_open` | ✓ | 42501 | 42501 | 42501 | owner check first |
| `daily_kpi`, `dashboard_open` SELECT | ✓ | ✓ | 0 rows | 0 rows | RLS |
| `daily_kpi`, `dashboard_open` INSERT/UPDATE/DELETE | — | — | — | — | no grant, no policy; `daily_kpi` is append-only |
| `app.rollup_daily_kpi`, every `app.kpi_*`, `app.avt_rows`, `app.*_json`, `app.*_at` | — | — | — | — | revoked from every API role; pg_cron runs as the job's owner |

No new public function name matches `cost|margin|price`, so the `059` list stays at 13.

### 3.8 Secrets and configuration

| Name | Public? | Where it lives | Used by M22 |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public by design (existing) | Vercel env; GitHub `staging` environment secrets `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | The session client of every route; the AT7 run |
| `SUPABASE_SECRET_KEY` | **private** (existing) | Vercel env (server-only); local `.env` (gitignored); GitHub `staging` environment secret | **Not used by M22 `src/` code.** Used by the integration and e2e helpers, and by `scripts/perf/dashboard-4g.ts` to provision the fake perf owner on staging (the `scripts/` exception) |
| `STAGING_APP_HOST` | not secret | GitHub `staging` environment variable (existing) | The AT7 host guard |
| `CRON_SECRET`, Vault values, `PIN_PEPPER`, `ANTHROPIC_API_KEY`, `EXTRACTION_MODEL_ID`, `RESEND_API_KEY` | existing | Vercel env / Supabase Vault | **Not touched.** `kpi-rollup` is SQL-only inside Postgres and needs no secret |
| Account logins (Vercel, Supabase, GitHub) | private | The account owner's password manager, with MFA (project Q26); never in the repo or in DigiAlto-Ops | Humans only; the founder approves the `staging` environment run |

### 3.9 Tests convention and the fixture

- **Conventions, as in M21:**
  - claims via `set_config('request.jwt.claims', …)`;
  - fixtures that no procedure can write are inserted as the migration owner inside the rolled-back test: closed sessions at fixed instants (through `app.close_session_at`), `order_line_cost` rows, count sessions and movements;
  - fixed "now" through the `app.*` twins (§3.2);
  - rows are found by id, never by position;
  - two of everything (§3.1.14).
- **Fixture day D = 2026-11-04 (a Wednesday), tenant A, cut-off 02:00:**

| Session | Opened (local) | Closed | Covers | Lines (gross; VAT) | Coperto | Total |
|---|---|---|---|---|---|---|
| T1 | 20:10 | 23:10 | 3 | 2 × Spezzatino 28,00 (10 %); 0,5 × Spezzatino 7,00; 1,5 × Tagliatelle 18,75; 1 × Vino 40,25 (22 %); 1 × Tagliatelle **voided after fire** | 3 × 2,00 (10 %) | 100,00 |
| T2 | 21:30 | 00:40 (calendar D + 1; business date D) | 2 | 2 × Tagliatelle 25,00; 2 × Acqua 6,00 (10 %) | 2 × 2,00 | 35,00 |
| T3 | 23:50 | 02:20 (business date D + 1) | 2 | 1 × Tagliatelle | — | excluded |
| T4 | 22:00 | open | 4 | 1 × Spezzatino (fired) | — | excluded |

- **Frozen costs:** Spezzatino 4,20 € per plate; Tagliatelle 3,10 € per plate (the voided line also has a 3,10 row). Vino and Acqua are unmapped (`recipe_id` null).
- **Expected values for D:**
  - covers **5**, tables **2**, gross **135,00**;
  - net of the lines: 25,4545 + 6,3636 + 17,0455 + 32,9918 + 22,7273 + 5,4545 = **110,0372**;
  - net of the coperto: 5,4545 + 3,6364 = **9,0909**;
  - net revenue **119,1281** (shown "119,13 €");
  - average spend **23,8256** (shown 23,83); average ticket **59,5641** (shown 59,56);
  - plates **9**: Spezzatino 2,5, Tagliatelle 3,5, Vino 1, Acqua 2. Mix 27,78 / 38,89 / 11,11 / 22,22;
  - food cost 10,50 + 10,85 = **21,35**; costed net 31,8181 + 39,7728 = **71,5909**; **food cost % 29,82**;
  - uncosted net **38,4463**; costed share **65,06** (71,5909 ÷ 110,0372);
  - food margin per plate: Spezzatino **8,5272** (shown 8,53), Tagliatelle **8,2637** (shown 8,26);
  - covers by hour: 20 → 3, 21 → 2. By weekday: `[0,0,5,0,0,0,0]` (Mon–Sun).
- **Comparison day D − 7 (2026-10-28):** one session, 2 covers, 4 × Tagliatelle 50,00, so net 45,4545.
  - Deltas: covers +3 (+150,0 %); net revenue +73,6736 (+162,1 %).
- **Fixed costs (owner):** month total 300,00; the mapped plates in the 30 days before D are 60 (4 on D − 7, 56 on D − 3), so **5,00** per plate.
  - Spezzatino: gross margin **3,5272** (shown 3,53), contribution **8,8181** (shown 8,82).
- **Purchases on D:** receipts of 20 kg Manzo × 12,00 and 5 l olio × 8,00 = **280,00**. A receipt on D − 1 is excluded.
- **Waste on D:** 1 kg Manzo "avariato" at 12,00 = **12,00**.
- **Register:**
  - D has 130,00 entered, so the difference is **+5,00 (+3,8 %)**;
  - D − 7 has app sales and no entry, so `previous.appVsRegister.datesWithoutRegister` = `["2026-10-28"]`.
- **AVT (location Cella):**
  - O is a monthly count closed on 2026-11-01 (Manzo counted 10 kg). C is a monthly count closed on 2026-11-30 (Manzo counted 24,2 kg).
  - Between them: a receipt of 20 kg; one stew batch whose recipe needs 5,0 kg Manzo for the output made (the chef confirmed 5,3 kg); waste of 0,2 kg. The ledger therefore shows 24,5 kg before C, and C posts −0,3.
  - Manzo: actual **5,8**, theoretical **5,0**, waste 0,2, variance **+0,8 kg**. With a unit cost at C of 12,00 €, that is **9,60 €**.
  - Parmigiano, a plate ingredient booked at fire for 0,4 kg, is counted 2,0 in O and 1,6 in C. Actual 0,4 = theoretical 0,4, so the variance is 0.
  - An unpriced counted ingredient gets `varianceEur` null and `unvaluedCount` 1.
  - An ingredient counted only in C gives `notCountedCount` 1.
- **Unmapped (ISO week 2026-11-02…08):**
  - Vino, 1 plate, 40,25; Acqua, 2 plates, 6,00;
  - an unmapped item sold on 2026-11-09 is absent;
  - an item mapped today but unmapped when it was fired is present.
- **Tenant B:** one closed session of 999,00 on D. None of B's ids or figures may appear in A's replies.

### 3.10 Performance (no figure promised)

- **Dashboard:** it reads one stored `daily_kpi` row for yesterday and one for D − 7 (primary-key lookups), plus the existing tiles, so there is still **one RPC** per load. The opens post is a separate request fired after render, off the load path.
- **KPI report:** over a range it reads the stored rows (at most two 366-day primary-key ranges) and computes only the non-final dates live.
- **Items and unmapped:** they read `table_session_closed_day_idx`, then `order_line_session_idx`.
- **CI net `241`:** a 5 s statement limit on 400 days × 60 closed sessions × 8 lines, covering:
  - a first rollup backfill of 400 dates;
  - `kpi_report` over a custom range of 366 days;
  - `kpi_items` over 366 days;
  - `dashboard_summary()`.

  It is a regression net, not a latency claim.
- **AT7 (the PRD's "under 2 s on a phone over 4G"):** measured and reported, not asserted (step 18). It is gated at M25.

## 4. Alternatives considered

- **`v_daily_kpi` as a materialized view (project §3.5.3):** rejected (ADR-025).
  - Materialized views have no RLS in Postgres, so a per-tenant owner/admin read would need a definer wrapper anyway.
  - `REFRESH` recomputes every tenant and every date, so it cannot "finalise" one business date.
  - A refresh after a backdated change would silently rewrite figures the owner already trusted.
- **No snapshot at all, everything live:** rejected as the default (ADR-025).
  - It is smaller, but it cannot meet AT3 as written ("the rollup run… a re-run changes nothing… one row per business date").
  - It gives no frozen morning figure.
  - Range reports over a year would re-aggregate every line on each read.

  The live path is kept as the **fallback** for non-final dates, so the two always agree.
- **Snapshot purchases, waste and app vs register too:** rejected. Invoices are dated in the past, and waste and register totals are entered late, so a frozen figure would be wrong and could not be fixed (Q154).
- **A per-item snapshot (`daily_item_kpi`):** rejected for the MVP. Per-item aggregation over a range is cheap with the closed-day index, and a second table would have to be kept consistent.
- **Finalise at the cut-off, without a grace:** rejected. A close that reads `clock_timestamp()` at 01:59:59.9 and commits after the rollup's snapshot would be missing from a "final" row forever (§6).
- **Rollup as a Vercel cron or a pg_net route:** rejected. The rollup is pure SQL, so pg_cron runs it inside Postgres with no secret and no HTTP hop (project §3.9 already says SQL).
- **AVT over a date range with interpolated stock:** rejected. Only counted quantities are facts (PRD: "what the monthly count says disappeared").
- **AVT theoretical from the batch's actual inputs:** rejected. It would hide over-use at production, which is exactly what the report must show (project risk "approximate recipes").
- **One row per dashboard open, with a timestamp:** rejected (data minimisation). A weekly counter answers the metric "5+ per week".
- **Count opens inside `GET /api/dashboard`:** rejected. Focus refreshes would inflate the count, and the read function would become a write.
- **A separate `gp-below-target` endpoint and list:** rejected. The dashboard's plates tile and `/costi` already show it (§1).

## 5. Build plan (test first: each step's named test is written and seen failing, then the code; one commit per step; `tdd-guide` follows the order)

| # | Step (one commit) | Files | Test that proves it (written first, must fail first) |
|---|---|---|---|
| 1 | Migration: `daily_kpi`, `dashboard_open`, the line and session sources, `kpi_day_row`; `plates_sold` and `tenant_has_operational_data` replaced; the `job_run` list widened. Pins and lists updated on purpose | `supabase/migrations/20261112100000_kpi_core.sql`, `supabase/tests/database/231_kpi_core.test.sql`. On purpose: `179_m19_preserves.test.sql` (the `plates_sold` pin moves to the M22 md5, with a comment); `207_dashboard_preserves.test.sql` and `214_m20_preserves.test.sql` (public table lists + `daily_kpi`, `dashboard_open`); the md5 pin of `tenant_has_operational_data`, wherever `grep -l tenant_has_operational_data supabase/tests` finds one. Fixtures in `004_waiter_cost_columns.test.sql` and `059_cost_roles_v6.test.sql` (one row in each new table; assertions unchanged) | **`231`.** **`kpi_day_row(A, D)`** equals §3.9: covers 5, tables 2, revenue_gross 135.00, items_net 110.0372, coperto_net 9.0909, plates 9, costed_net 71.5909, food_cost 21.3500, uncosted_net 38.4463, unmapped_plates 3, incomplete_plates 0, `covers_by_hour[21] = 3` and `[22] = 2` (1-based; hours 20 and 21), every other element 0. **Exclusions:** the Tagliatelle voided after fire is in no sum (its cost row exists); T3 (closed D + 1) and T4 (open) are absent; tenant B is absent. **Lines:** `kpi_sales_lines` gives Vino a net of 32.9918; a 0,5 line has gross 7.00; a line with an incomplete cost row has `costed` false and `food_cost` null, and is counted in `incomplete_plates`. **`plates_sold(A, D−30, D−1)`** = 60 (unmapped drinks are not counted); `fixed_cost_at(A, D)` → per_plate 5.00, reason null; with no sales → reason `no_sales` (M8 behaviour kept). **Tables:** a duplicate `(tenant, date)` → 23505; negative covers → 23514; UPDATE/DELETE/TRUNCATE of `daily_kpi` → `append_only`; a `dashboard_open.iso_week` on a Tuesday → 23514. **RLS:** owner A and admin A read A's rows; chef A and waiter A read 0 rows; owner B reads 0 rows. **Privileges:** `authenticated` insert/update/delete false on both tables; `service_role` select true. **Demo rule:** a tenant with only a `dashboard_open` row → `tenant_has_operational_data` false; with a `daily_kpi` row → true. `job_run_begin('kpi-rollup')` is accepted. `001`, `004`, `059`, `179`, `194`, `207` and `214` are green |
| 2 | Migration: rollup, cron job, job health | `supabase/migrations/20261112100100_kpi_rollup.sql`, `supabase/tests/database/232_kpi_rollup.test.sql`, `supabase/tests/database/233_kpi_job_health.test.sql` | **`232` (AT3; every instant via `app.rollup_daily_kpi(p_at)`).** **Normal night:** at 2026-11-05 01:09:59Z there is no row for D; at 01:10:00Z there is one, equal column by column to `kpi_day_row(A, D)`, with `finalised_at` set; the 01:15Z run is at 02:15 local, before 03:00. **Re-run:** a second call at 01:30Z returns 0, and the md5 of `daily_kpi`'s rows is unchanged. **Autumn night:** at 2026-10-25 00:10Z the row for 2026-10-24 exists; runs at 00:30Z, 01:00Z, 01:15Z and 01:45Z insert nothing; 2026-10-25 is absent until 2026-10-26 01:10Z; there is then exactly one row each for 10-24 and 10-25. **Spring night:** at 2027-03-28 01:09Z there is no row for 2027-03-27; at 01:10Z it exists (`at time zone 'Europe/Rome'` gives 03:10); 2027-03-28 is final from 2027-03-29 00:10Z; one row each. **Cut-off `"00:30"`:** D is final from 2026-11-04 23:40Z. **Coverage:** a tenant with no closed session gets no row; days without sales between two days with sales get zero rows; a gap deleted inside the test is filled; with 450 pending dates, 400 are inserted and the rest on the next run. **Isolation:** a test-only trigger that makes tenant B's insert fail → A's rows are inserted, B gets none, and the `job_run` row has `ok = false`, `error_code = 'rollup_failed'`; without the fault, `ok = true` and `items` = the rows inserted. **Schedule:** `cron.job` has `kpi-rollup`, `*/15 * * * *`, active, command `select app.rollup_daily_kpi()`. No API role can execute `app.rollup_daily_kpi`. **`233`:** `job_health_checks` reports `job_stale` for `kpi-rollup` when its last successful run is 61 min old (and an earlier finished run exists); none at 59 min; none on a database where it never finished. `job_unscheduled` lists `kpi-rollup` after `cron.unschedule('kpi-rollup')`. Every case of `117` still passes |
| 3 | Migration: period resolution, range aggregate, purchases, register range, `public.kpi_report` | `supabase/migrations/20261112100200_kpi_report.sql`, `supabase/tests/database/234_kpi_report.test.sql` | **AT1** (every KPI row except the per-item rows and AVT), through `app.kpi_report_json(A, 'owner', 'day', D, null, null, <D + 1 09:00 local>)`. `current` = §3.9: covers 5, tables 2, revenueGrossEur 135.0000, revenueNetEur 119.1281, copertoNetEur 9.0909, avgSpendPerCoverEur 23.8256, avgTicketEur 59.5641, plates 9, foodCostEur 21.3500, foodCostPct 29.82, costedRevenueNetEur 71.5909, uncostedRevenueNetEur 38.4463, costedSharePct 65.06, coversByHour (hour 20 → 3, 21 → 2), coversByWeekday `[0,0,5,0,0,0,0]`, purchasesEur 280.0000, waste.valueEur 12.00 with the reason `avariato`, appVsRegister `{appTotalEur 135.00, registerTotalEur 130.00, difference {5.00, 3.8}, datesWithoutRegister []}`. **AT6:** `previous` is D − 7, with covers 2, revenueNetEur 45.4545 and `datesWithoutRegister` `["2026-10-28"]`; `delta.covers` = `{3, 150.0}`; `delta.revenueNetEur` = `{73.6736, 162.1}`; a KPI whose previous value is 0 → `pct` null. **Periods:** `week` on D → 2026-11-02…08 vs 2026-10-26…11-01 (the week starting the Monday after the autumn change); `month` on 2027-03-15 → 03-01…31 vs 2027-02-01…28; `custom` 2026-11-01…07 → 2026-10-25…31; 367 days → `range_too_long`; from > to → `range_invalid`; the day after `p_now`'s business date → `date_in_future`; `'year'` → 22023; `p_date` null → D (yesterday of `p_now`). **Finality:** before the rollup, `final` is false and the values equal those after it (the same JSON minus `final` and `daysFinal`); a week containing `p_now`'s business date → `daysFinal < days`. **Purchases (two paths):** `purchasesEur` equals Σ `qty × unit_price` of the fixture invoices' approved stock lines; a receipt with a null `unit_cost` → `purchasesUnvaluedCount` 1. **Waste:** equals `public.waste_costs(D, D)` as the owner. **Register range:** two entries on D → the latest counts. **Wrapper:** `public.kpi_report` as owner A with real claims answers for a past date range of the same fixture, shifted to dates before today. **Tenancy:** owner B's report on D shows 999.00 and none of A's figures |
| 4 | Migration: `public.kpi_items` | `supabase/migrations/20261112100300_kpi_items.sql`, `supabase/tests/database/235_kpi_items.test.sql` | **AT1 (per-item rows)**, via `app.kpi_items_json` as owner: Tagliatelle plates 3.5, mixPct 38.89, revenueNetEur 39.7728, foodCostEur 10.85, foodMarginPerPlateEur 8.2637; Spezzatino 2.5, 27.78, 31.8181, 10.50, 8.5272, `fixedCostPerPlateEur` 5.0000, `grossMarginPerPlateEur` 3.5272, `contributionEur` 8.8181; Vino and Acqua `status` `unmapped`, `foodCostEur` null, mix 11.11 / 22.22. Rows are ordered by plates desc: Tagliatelle, Spezzatino, Acqua, Vino. **Partial:** on a second fixture day, a Tagliatelle line with an incomplete cost → status `partial`, `costedPlates` < `plates`. **AT2 (SQL):** `totals.foodCostPct` = `kpi_report_json('day', D).current.foodCostPct` = 29.82; Σ rows `foodCostEur` = `totals.foodCostEur`; Σ rows `costedRevenueNetEur` = `totals.costedRevenueNetEur`; `round(Σ foodCostEur ÷ Σ costedRevenueNetEur × 100, 2)` over the rows = 29.82. The same equalities hold for `week` and for a 31-day custom range. **Owner vs admin:** as admin, the row key set equals `itemBase` exactly; `fixedCostPerPlateEur`, `grossMarginPerPlateEur`, `contributionEur` and `fixedCostReason` are absent (one assertion each); a recursive key walk finds no `/fixed\|rent\|labour\|utilit\|gross\|contribution/i`. **No fixed costs:** an owner with no `fixed_cost_period` → the three owner figures are null, with `fixedCostReason` `no_fixed_costs` |
| 5 | Migration: AVT | `supabase/migrations/20261112100400_avt_report.sql`, `supabase/tests/database/236_avt_report.test.sql` | **AT4:** `avt_report(C)` as owner. Manzo: `actualQty` 5.8, `theoreticalQty` 5.0, `wasteQty` 0.2, `varianceQty` 0.8, `unitCostEur` 12.00, `varianceEur` 9.6000. Parmigiano variance 0 (theoretical from the fire rows, 0.4 = actual 0.4). The raw of a line voided after fire is not theoretical. The unpriced ingredient → `varianceEur` null and `totals.unvaluedCount` 1. The ingredient counted only in C → `notCountedCount` 1. A non-stock ingredient is absent. `totals.lossEur` 9.6000. **Window:** O's own count rows are excluded and C's included (a count row of O at `O.closed_at` is not counted; a consumption 1 µs after `O.closed_at` is counted). A batch produced before `O.closed_at` is not theoretical. A batch at another location is not theoretical for Cella. A transfer out is not actual consumption. **Defaults and errors:** `avt_report(null)` = the latest closed monthly count; a daily count → `avt_count_not_monthly`; an open monthly count → `avt_count_not_closed`; the first monthly count → `avt_no_opening_count`; tenant B's count → P0002 `count_not_found`. `availableCounts` is newest first, at most 12, monthly and closed only. `locationsActive` is 1, then 2 after a second location is activated |
| 6 | Migration: unmapped items | `supabase/migrations/20261112100500_unmapped_items.sql`, `supabase/tests/database/237_unmapped_items.test.sql` | **AT5**, via `app.unmapped_items_json`. Week of D → 2026-11-02…08, rows Acqua (2, 6.00) then Vino (1, 40.25). The item mapped today but fired unmapped is listed. Mapped items are absent; the 2026-11-09 sale is absent; a voided unmapped line is absent. `null` → the week of `p_now`'s business date; a date after it → `date_in_future`. **Business date at the week edge (autumn change):** tables closed on Sunday 2026-10-25 at 23:30 and on Monday 2026-10-26 at 00:30 local both have business date 2026-10-25, so both are in the week 2026-10-19…25; a table closed on Monday at 02:30 has business date 2026-10-26 and is in the week 2026-10-26…11-01 |
| 7 | Migration: dashboard `yesterday`, `comingSoon`, `record_dashboard_open`; `203`/`204` updated on purpose | `supabase/migrations/20261112100600_dashboard_kpis.sql`, `supabase/tests/database/238_dashboard_kpis.test.sql`, `203_dashboard_owner.test.sql`, `204_dashboard_roles.test.sql` (key lists + `yesterday`; `comingSoon` = `["pushList"]`; every other assertion unchanged) | **`238` AT2 (dashboard)**, with `app.dashboard_summary_at(A, role, <D + 1 at 09:00 local>)`: `yesterday.foodCostPct` = 29.82 = `kpi_items_json('day', D).totals.foodCostPct`; covers, net revenue, average spend and average ticket equal `kpi_report_json('day', D).current`; `compare.businessDate` = D − 7, with its values; `final` is false before the rollup and true after, with identical values. The owner's and the admin's `yesterday` blocks are equal. `public.dashboard_summary()` with real claims still answers, and its `yesterday.businessDate` = today's business date − 1. **AT9 (SQL)**, via `app.record_dashboard_open_at`: the owner twice in the week of D → one row with `opens` 2. At 2026-10-25 22:59Z (Sunday 23:59 CET) and 23:01Z (Monday 00:01 CET) → rows for `iso_week` 2026-10-19 and 2026-10-26. `public.record_dashboard_open()` as admin, chef or waiter → 42501 and no row; as owner A with real claims → a row of the current week. Tenant B's owner writes B's row only. A `dashboard_summary()` call leaves `dashboard_open` unchanged |
| 8 | pgTAP role and tenancy matrix (AT8) | `supabase/tests/database/239_kpi_roles.test.sql` | **AT8 (project V6 in force):** waiter A and chef A → 42501 on `kpi_report`, `kpi_items`, `avt_report`, `unmapped_items`, `record_dashboard_open` and `dashboard_summary`; no claims → 42501. Owner and admin are allowed (the admin gets 42501 on `record_dashboard_open` only). `has_function_privilege('anon', …)` is false for the six public functions; no API role executes any `app.kpi_*`, `app.avt_rows`, `app.*_json`, `app.*_at` or `app.rollup_daily_kpi`; each has `prosecdef` true and `proconfig` = `{search_path=""}`. **Tenancy:** a recursive scan of each of owner A's replies finds none of tenant B's uuids, and B's replies none of A's. The `059` list of cost-named public functions is still 13 |
| 9 | Migration: purge list; preservation guard | `supabase/migrations/20261112100700_demo_purge_tables_m22.sql`, `supabase/tests/database/240_m22_preserves.test.sql`, `222_m21_preserves.test.sql` (on purpose, its line 8 filter also excludes the two new tables) | `194` green: every tenant table is listed once. `193` purges a demo tenant holding `daily_kpi` and `dashboard_open` rows, and leaves R1/R2's. **`240`:** both new tables come before `app_user`; the merged list minus them equals `main`'s; the md5 of every function in §3.2 "Not replaced" is unchanged (the values on `main` `0c73030`, written in the test); the `app.alert_kind` rows and both `audit_event` check definitions are identical. PR grep: `grep -lE "create or replace function (public\.(close_table\|fire_course\|void_line\|waste_costs)\|app\.(plate_cost_rows\|fixed_cost_at\|business_date\|ledger_checks_body))" supabase/migrations/20261112*` returns nothing |
| 10 | pgTAP performance net | `supabase/tests/database/241_kpi_perf.test.sql` | Under `statement_timeout = '5s'`, on 400 days × 60 closed sessions × 8 lines, `analyze`d: a first `rollup_daily_kpi` answers and inserts 400 rows; `kpi_report_json` with a 366-day custom range answers; `kpi_items_json` over 366 days answers; `dashboard_summary_at` answers. `explain (format json)` of the `kpi_sales_lines` range read mentions `table_session_closed_day_idx` and has no `Seq Scan` on `order_line` |
| 11 | Race cases | `scripts/test-db-races.sh` (two cases appended; header updated) | CI job `db-races`: the existing cases are unchanged, and `no_deadlock` holds in all. **`rollup-twice`:** two `rollup_daily_kpi` calls in two sessions, the first parked after its advisory lock → the second waits, then inserts 0; one row per date. **`open-twice`:** two concurrent `record_dashboard_open()` calls for one owner → `opens` 2, one row |
| 12 | TS domain: constants, schemas, outputs (snapshots), errors, view helpers, i18n, parity; dashboard schemas extended | `src/server/reports/{constants,schemas,output,errors}.ts`, `src/server/dashboard/{sql-schema,output}.ts`, `src/lib/reports/report-view.ts`, `src/lib/dashboard/dashboard-view.ts`, `src/lib/api/errors.ts`, `src/lib/i18n/messages/{it,en,keys}.ts`, `tests/server/reports/{schemas,output,errors}.test.ts` + `__snapshots__`, `tests/server/dashboard/{sql-schema,output}.test.ts` (snapshots updated on purpose), `tests/lib/reports/report-view.test.ts`, `tests/parity/reports-sql-parity.test.ts` | **`schemas.test.ts`:** `period=custom` without `to` → error; `date=2026-13-01` → error; an extra key → error; the default period is `day`. **`output.test.ts`:** `toJSONSchema` snapshots of `kpiReportOutput`, `itemsOutput`, `avtOutput` and `unmappedOutput`; an admin item row with `fixedCostPerPlateEur` fails; an injected `unit_cost` fails. **Dashboard:** the `yesterday` tile schema; the `comingSoon` enum is exactly `["pushList"]`; a walk of the admin schema still finds no fixed-cost key. **`errors.test.ts`:** `range_too_long`, `date_in_future` and `avt_*` → 422; `count_not_found` → 404; Italian messages. **`report-view.test.ts`:** `formatDelta(3, 150)` "+3 (+150,0 %)"; `formatDelta(-2.5, null)` with U+2212 and no %; `hourRows` hides zeros; `weekdayLabel(0)` "lun"; `businessDayTitle("2026-11-04")` "mercoledì 4 novembre"; `yesterdayHint(71.5909, 119.1281)` "sui piatti con costo noto (71,59 € di 119,13 €)"; every empty text of §3.6. **Parity:** `PERIODS`, `MAX_RANGE_DAYS`, `KPI_FINALISE_GRACE_MIN` and `AVT_AVAILABLE_COUNTS` equal the SQL (read from the migration text) |
| 13 | API routes and services | `src/server/reports/{kpis,items,avt,unmapped}.ts`, `src/server/dashboard/{summary,opens}.ts`, `src/app/api/reports/{kpis,items,avt,unmapped-items}/route.ts`, `src/app/api/dashboard/opens/route.ts`, `tests/app/api/{reports-kpis,reports-items,reports-avt,reports-unmapped,dashboard-opens,dashboard}.test.ts` | With a fake session client. **AT8 (API):** chef and waiter → 403 on all five report and opens routes, **before any RPC** (spy: 0 calls); admin → 403 on `POST /api/dashboard/opens`; owner and admin → exactly one `rpc` with the parsed params; `?period=custom&from=2026-11-01` → 400 without an RPC; P0001 `range_too_long` → 422; P0002 → 404. **Role schemas:** an admin reply carrying `fixedCostPerPlateEur` → 500 `report_unavailable`, with the key absent from the body; an owner reply validates. **Opens:** a `{}` JSON body → one `rpc("record_dashboard_open")`; `text/plain` → 415; more than 64 B → 413. **Dashboard:** still exactly one RPC per `GET`; `tiles.yesterday` is present for owner and admin. Every route sends `Cache-Control: no-store` and `Server-Timing` |
| 14 | Real-stack integration suite | `tests/integration/reports.int.ts`, `tests/integration/helpers/reports.ts`. The helper reuses `tests/integration/helpers/closing.ts` (menu, two tables closed via the M21 APIs, an unmapped drink), adds a pair of monthly counts via the M13 APIs, and a second tenant | The server clock cannot be moved, so the sales land on today's business date. **AT2:** `GET /api/reports/kpis?period=day&date=<today>` gives `current.foodCostPct`. It equals `GET /api/reports/items` (same query) `totals.foodCostPct`. It also equals the percentage the test computes from the item rows, summed in integer ten-thousandths (`Math.round(x × 10000)`); the cent totals match too. `final` is false. **AT1 (live):** covers, net revenue, plates and food cost equal the values the helper computed by hand for its seed. **AT4:** `GET /api/reports/avt` (latest count) gives the helper's ingredient variance in €, with one batch over-using its input and one count loss. **AT5:** `GET /api/reports/unmapped-items` lists the drink. **AT9:** the owner posts `POST /api/dashboard/opens` twice → `opens` 2. **AT8:** chef and waiter (PIN) → 403 on each report route. **Tenancy:** owner B sees none of A's item ids |
| 15 | Dashboard UI: "Ieri" tile, "In arrivo" slot, opens post | `src/components/dashboard/{yesterday-tile,coming-soon-tile}.tsx`, `src/components/use-dashboard.ts`, `src/app/(owner)/page.tsx`, `tests/components/{dashboard-tiles,home-dashboard,use-dashboard}.test.ts` (extended on purpose) | **`renderToStaticMarkup`:** the "Ieri" tile renders "Coperti 5", `/119,13\s+€/`, `/29,82\s+%/`, "mercoledì scorso", "+162,1 %" and the hint; the `Badge` "Provvisorio" appears only when `final` is false; the empty text appears at 0 covers; there is exactly one link, "Apri report" → `/report`. The coming-soon tile shows only "Da spingere oggi", with no digit and no link. `tileOrder("owner")` and `tileOrder("admin")` put "Ieri" first. **AT9 (client)**, in jsdom with a mocked `fetch`: an owner mount → one `GET /api/dashboard`, then one `POST /api/dashboard/opens`; a focus refresh → a second `GET` and no second `POST`; an admin mount → no `POST`; a failed `POST` leaves the page rendered with no error alert |
| 16 | `/report` screen and nav | `src/app/(owner)/report/{page,period-picker,kpi-panel,items-panel,avt-panel,unmapped-panel}.tsx`, `src/lib/nav/nav-model.ts`, `docs/design/ui-foundation.md` (§8 line for M22), `tests/components/{report-page,kpi-panel,items-panel,avt-panel,unmapped-panel}.test.ts`, `tests/lib/nav/nav-model.test.ts` | With a fake `apiJson`. **Page:** reads `?vista=` and the period params, and requests exactly one endpoint per view. **KPI panel:** both periods and the deltas; the two `BarTable`s (only the non-zero hours on the phone, and 7 weekday rows); "Provvisorio: 1 giorno su 7 non ancora chiuso"; "Totale cassa non inserito". **Items panel:** rows by `data-menu-item-id`; the "Senza ricetta" badge; no owner-only column for an admin payload. **AVT panel:** the count picker, the Manzo row text, every empty state, the multi-location note. **Unmapped panel:** the rows and the empty text. No component computes a € value; amounts go only through `formatEuro`. **Nav:** "Report" for owner and admin, not for chef or waiter |
| 17 | Playwright | `e2e/reports.spec.ts`, `e2e/helpers/seed-reports.ts`, `e2e/dashboard.spec.ts` (the "In arrivo" assertions updated on purpose) | **`reports.spec.ts` (phone):** the owner closes two seeded tables through the API helpers, then opens `/`: the "Ieri" tile is present (empty or provisional for yesterday), and the `POST /api/dashboard/opens` request is seen once. `/report?periodo=giorno&data=<today>` → covers and food cost % match the API. "Piatti" lists the seeded items by `data-menu-item-id`, with the drink marked "Senza ricetta". "Non mappati" lists the drink. "Scostamenti" shows the seeded variance row. `expectPhoneFriendly` passes in light and dark on each view. **Admin:** no "Costi fissi" column. **Chef and waiter:** `/report` shows the reserved message, and `page.request.get("/api/reports/kpis")` → 403 |
| 18 | AT7 gate evidence: a 4G load-time measurement that reports numbers and never fails on one | `e2e/perf/dashboard-4g.spec.ts`, `scripts/lib/perf-4g.ts`, `scripts/perf/dashboard-4g.ts`, `playwright.config.ts` (a `perf-4g` project matching only `e2e/perf/`, excluded from the default projects), `tests/config/playwright-projects.test.ts` (updated on purpose), `tests/scripts/perf-4g.test.ts`, `.github/workflows/perf-dashboard-4g.yml`, `tests/config/perf-workflow.test.ts` (extended) | **Unit (fakes):** `assertStagingTarget` refuses any host but `STAGING_APP_HOST`, and any Supabase project but the staging ref, before a request. The CDP parameters equal `SLOW_4G = { latency: 150, downloadThroughput: 1.6 Mbps in bytes/s, uploadThroughput: 750 Kbps in bytes/s }` (Lighthouse "Slow 4G", T3). `renderReport` prints p50, p95 and max of 20 cold loads (a new context each) and 20 warm loads, plus the sentence "Misurato su staging con rete simulata Slow 4G (Chromium), non da un telefono reale". The exit code is 0 whatever the numbers, and no email, cookie or key is in the output. **Config:** the default projects do not match `e2e/perf/`. The workflow test checks `workflow_dispatch` only, `if: github.ref == 'refs/heads/main'`, `environment: staging`, `persist-credentials: false`, secrets only in the run step, and the host and project guards copied from `perf-order-entry.yml`. **Measure:** from navigation start until `[data-tile="yesterday"]` is visible (`performance.now()` at `load` and at the tile's first paint, via `page.evaluate`) |

**Acceptance tests → proof**

| AT (project plan §5a M22) | Proved in (step) | Command |
|---|---|---|
| 1 One fixture day, a hand-computed value for every PRD 4.2 row | `231` (1); `234` (3: covers, revenue, averages, plates, food cost %, purchases, waste, app vs register, covers per hour and weekday); `235` (4: per-item plates, mix, margin, contribution); `236` (5: AVT); integration (14, live) | `npx supabase test db`; `npm run test:integration` |
| 2 Dashboard food cost % = Σ item recipe cost ÷ Σ revenue from `/api/reports/items`, exact to the cent | `235` (4, SQL equalities); `238` (7, dashboard = items); route tests (13); integration (14, from the JSON) | as AT1; `npm test` |
| 3 The rollup after the cut-off finalises yesterday before 03:00; a re-run changes nothing; one row per date on 2026-10-25 and 2027-03-28 | `232` (2: every instant of §3.4, the re-run md5, both DST nights; the spring-night deadline per Q145); race `rollup-twice` (11) | `npx supabase test db`; `scripts/test-db-races.sh` |
| 4 AVT for a fixture ingredient, in €, equals the hand value | `236` (5); integration (14) | as AT1 |
| 5 The unmapped report lists the sold items without a recipe for the ISO week | `237` (6); integration (14); `reports.spec.ts` (17) | as AT1; `npx playwright test` |
| 6 The same-period comparison returns both periods and the deltas | `234` (3); `kpi-panel.test.ts` (16) | `npx supabase test db`; `npm test` |
| 7 Dashboard load time under throttled 4G, measured and reported (gate evidence) | Step 18 (`perf-4g.test.ts`, the workflow test). The staging run's job summary goes into the PR, or into the M25 gate notes if the run happens after merge (Q153) | `npm test`; the manual `perf-dashboard-4g.yml` |
| 8 Waiter → 403; the chef sees only what §3.11.2 allows (project V6: no M22 endpoint) | `239` (8); route tests (13); integration (14); `reports.spec.ts` (17) | `npx supabase test db`; `npm test`; `npm run test:integration`; `npx playwright test` |
| 9 Opening the dashboard increments that user's weekly count (count only) | `238` (7); race `open-twice` (11); route test (13); integration (14); component test (15); `reports.spec.ts` (17) | all of the above |
| Invariants: nothing updated or deleted in ledgers; `daily_kpi` append-only; `tenant_id` + RLS; roles in Postgres; no data logic in React; the secret key not in `src/`; the other procedures untouched | `231` (1); `239` (8); `240` (9); components (15, 16); the existing `tests/lint/admin-client-import.test.ts` | `npx supabase test db`; `npm test`; `npm run lint` |

**CI implications:**
- **pgTAP:**
  - `231`–`241` run in the `supabase` job and in `scripts/test-db-native.sh`. The native shim must provide `cron.schedule`/`cron.job`; it already does for `017`.
  - `004` and `059` gain fixture rows.
  - `179`, `203`, `204`, `207`, `214` and `222` change named assertions on purpose (steps 1, 7, 9).
- **Other jobs:**
  - two race cases;
  - new and updated Vitest snapshots;
  - a new manual workflow (not run on push);
  - no new CI secret;
  - coverage ≥ 80 % on new TS.

### 5b. Variants

**V1: food cost % over all item revenue** · Trigger: Q146 answered "divide by all sales, drinks included" · Replaces steps: the `foodCostPct` formula in 3, 4 and 7, and its expected value in `234`, `235`, `238`, 14 and 15

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V1.1 | `foodCostPct` = Σ food_cost ÷ `items_net` × 100 (the coperto still excluded), in `app.kpi_range_agg`, the `kpi_items` totals and the dashboard. `costedSharePct` is kept. The hint becomes "su tutto l'incasso dei piatti e bevande" | `supabase/migrations/20261113100000_food_cost_all_items.sql`, `supabase/tests/database/242_food_cost_all_items.test.sql`, `src/lib/i18n/messages/{it,en}.ts`, `tests/lib/reports/report-view.test.ts` | Fixture D: 21.35 ÷ 110.0372 → **19.40**; the dashboard equals the items totals, 19.40; a day with only unmapped sales → 0.00 (not null); the view's hint text changes |

**V2: mix % within each course** · Trigger: Q147 answered "mix inside each category (drinks with drinks)" · Replaces steps: the `mixPct` rule of 4, and its values in `235` and 16

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V2.1 | `mixPct` = item plates ÷ the plates of the same `course` × 100; the items panel groups by course | `supabase/migrations/20261113100100_mix_by_course.sql`, `supabase/tests/database/243_mix_by_course.test.sql`, `src/app/(owner)/report/items-panel.tsx`, `tests/components/items-panel.test.ts` | Fixture D, with Spezzatino in secondi, Tagliatelle in primi, and Vino and Acqua in bevande: Spezzatino 100.00, Tagliatelle 100.00, Vino 33.33, Acqua 66.67. The panel shows the course headings |

**V3: compare with the same period last year** · Trigger: Q148 answered "compare with last year" · Replaces steps: the comparison rule of `app.kpi_period` in 3 and the dashboard's `compare` in 7, with their cases in `234` and `238`

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V3.1 | `day` → D − 364 (same weekday); `week` → the same ISO week number of the previous ISO year (week 53 → week 52); `month` → the same month last year; `custom` → the dates − 1 year (29 Feb → 28 Feb) | `supabase/migrations/20261113100200_compare_last_year.sql`, `supabase/tests/database/244_compare_last_year.test.sql`, `src/lib/i18n/messages/{it,en}.ts`, `tests/lib/reports/report-view.test.ts` | D 2026-11-04 → 2025-11-05 (both Wednesdays); week 2026-W45 → 2025-W45; a custom range on 2028-02-29 → 2027-02-28. The dashboard label becomes "stesso giorno dell'anno scorso" (i18n test) |

**V4: AVT shows the unexplained loss (recorded waste removed)** · Trigger: Q149 answered "take recorded waste out of the difference" · Replaces steps: the `varianceQty` rule of 5, and its values in `236`, 14 and 16

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V4.1 | `varianceQty = actualQty − wasteQty − theoreticalQty`; the panel says "differenza non spiegata" | `supabase/migrations/20261113100300_avt_unexplained.sql`, `supabase/tests/database/245_avt_unexplained.test.sql`, `src/app/(owner)/report/avt-panel.tsx`, `tests/components/avt-panel.test.ts` | Manzo: 5.8 − 0.2 − 5.0 = 0.6 kg → **7.20 €**; Parmigiano 0; the panel's label text |

**V5: purge old dashboard-open counts** · Trigger: Q151 answered with a retention period of N weeks · Replaces steps: none (adds to 2 and 9)

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V5.1 | `app.rollup_daily_kpi` ends by deleting the `dashboard_open` rows with `iso_week < monday(today) − N weeks`. The delete is guarded by a transaction-local setting that only this function sets (the M11 purge pattern). `app.dashboard_open_retention_weeks()` = N | `supabase/migrations/20261113100400_dashboard_open_retention.sql`, `supabase/tests/database/246_dashboard_open_retention.test.sql` | With N = 26: a row of week −27 is deleted and week −26 is kept; a direct DELETE as the migration owner without the setting is refused; the purge is counted in `job_run.items` |

**V6: stock-outs per week in the KPI report** · Trigger: Q152 answered "yes, show stock-outs at go-live" · Replaces steps: none (adds to 3, 12 and 16)

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V6.1 | The `kpi_report` blocks gain `stockOuts` = the count of `negative_stock` alerts with a `business_date` in range (owner and admin; quantities only) | `supabase/migrations/20261113100500_kpi_stock_outs.sql`, `supabase/tests/database/247_kpi_stock_outs.test.sql`, `src/server/reports/{constants,output}.ts`, `tests/server/reports/output.test.ts` | Two `negative_stock` alerts on D and one on D − 7 → `current.stockOuts` 2, `delta.stockOuts` `{1, 100.0}`; the snapshot is updated on purpose |
| V6.2 | The Andamento panel shows "Esauriti durante il servizio: 2" | `src/app/(owner)/report/kpi-panel.tsx`, `tests/components/kpi-panel.test.ts` | The line renders with the count; without the key it is not rendered |

## 6. Risks and mitigations

- **Security and privacy**
  - *Definer functions bypass RLS.* Mitigations (steps 1–7, `239`):
    - the role check comes first;
    - the `search_path` is empty;
    - the tenant comes from `app.tenant_id()`, and every statement filters by it;
    - the `app.*` twins have no API grant, and their role argument only shapes the output.
  - *Fixed costs reaching the admin, or € reaching the chef or the waiter.* Mitigations:
    - the owner-only keys are built only for the owner, in SQL (`235`);
    - a strict per-role parse turns a stray key into a 500 (12, 13);
    - 403 before any RPC (13), and 42501 in SQL (`239`);
    - RLS on both new tables (`231`).
  - *IDOR:* a foreign count id gives P0002/404 (`236`); every reply is scanned for the other tenant's uuids (`239`).
  - *Input validation:*
    - strict Zod, plus the SQL date, period and range checks (a 366-day cap, no future dates);
    - uuid params;
    - for opens, a JSON-only body of at most 64 bytes (the `withApi` CSRF rules).
  - *Personal data:*
    - the opens counter records the owner's usage, minimised to a weekly count with no timestamp (decision 11); its retention is Q151 → V5;
    - no M22 reply carries a staff or guest name;
    - logs carry codes only;
    - everything stays in Supabase EU (GDPR; project Q13 roles unchanged).
- **Correctness**
  - *A close that commits just after the cut-off rollup:* covered by the 10-minute grace (decision 4; boundary cases in `232`). Accepted residual: a transaction open for more than 10 minutes, which the API's statement timeouts make unreachable.
  - *A stored row that is wrong (a bug):* rows are immutable, so the fix is a reviewed migration. The live fallback and the equality tests (`232`: row = `kpi_day_row`) make drift visible in CI. Accepted for the MVP.
  - *The dashboard and the items report disagreeing:* prevented by one line source and exact `numeric` sums (decision 2). AT2 is asserted in SQL, in the API and in integration.
  - *The spring-forward night misses 03:00:* impossible to avoid with a 02:00 cut-off (§3.4); Q145.
  - *M21 V1 (count tables on their opening date), if ever adopted:* finality would then also have to wait for open sessions. This is recorded so that V1's author re-plans the rollup.
  - *`plates_sold` going live changes the fixed-cost statuses on `/costi`:* this is what M8 intended, and only the owner sees it. `179` is re-pinned on purpose; `058` and `158` stay green, since their fixtures have no sales.
  - *New rows blocking a demo start:* `dashboard_open` is skipped, and `daily_kpi` rows exist only after real closes (`231`).
- **Unverified (proved in the named step)**
  - **T1:** `app.batch_requirements` returns the raw needs of one batch **version**, with its sub-recipes at `produced_at`, in base units. Scaling by `output_qty ÷ recipe.output_qty` then gives the recipe consumption of the output made.
    - Source: the function's comment, not a run.
    - Proved by `236` (5). If the code behaves otherwise, AVT follows the code, and the step is re-planned with the architect.
  - **T2:** `close_count` writes its count movements with `created_at` equal to the session's `closed_at`. Both are `now()` of one transaction (read in `20261027100200`, lines 255 and 306). The window rule selects count rows by reference anyway. Proved by `236`.
  - **T3:** Chromium network throttling via the DevTools Protocol method `Network.emulateNetworkConditions`, with Lighthouse's "Slow 4G" values: 150 ms latency, 1.6 Mbps down, 750 Kbps up.
    - Sources: <https://github.com/GoogleChrome/lighthouse/blob/main/docs/throttling.md>; CDP <https://chromedevtools.github.io/devtools-protocol/tot/Network/#method-emulateNetworkConditions>.
    - No CPU slowdown is applied, because this session did not verify Lighthouse's documented mobile CPU multiplier. Q153 asks whether to add one.
    - Proved by the unit test of step 18 (the parameters) and by the first staging run.
  - **T4:** a `cron.schedule` inside a migration is applied on the hosted project, as it was for `auth-purge` and `extract` (the existing pattern). Proved by `232` locally, and checked on staging after merge with `job_run_latest('kpi-rollup')`.
- **Performance and cost:** see §3.10. The one new pg_cron job runs every 15 minutes, doing indexed reads and at most a handful of inserts per tenant per night. No new provider or paid service. No latency figure is promised; AT7 is a measurement.
- **Dependencies:** none added.
- **Plan changes to record in DigiAlto-Ops `clients/osteria-dei-rossi/context.md`:**
  - §3.5.3: the materialized view `v_daily_kpi` becomes the `public.daily_kpi` table with RLS, written by `app.rollup_daily_kpi()` (ADR-025). Only sales facts are snapshotted;
  - §3.3, reports row: the `gp-below-target` and `waste` endpoints are not built (the dashboard tile, `/costi` and `/api/stock/waste-costs` cover them). `kpis`, `items`, `avt` and `unmapped-items` are built, and `POST /api/dashboard/opens` is added;
  - §3.9: `kpi-rollup` finalises 10 minutes after the cut-off. On the spring-forward night that is 03:10 local (Q145);
  - §5a M22 AT7: measured on staging after merge, not on a PR preview (Q153);
  - M8: `app.plates_sold` is implemented in M22 (it was planned for M19/M21).

## 7. Open questions for the founder (defaults in force for this build)

**Founder answers (2026-10-31, through the lead):** the plan is approved, and every default stands.
- Q146: the denominator is the revenue of dishes with a known cost.
- Q148: compare with the previous period.
- Q149: AVT includes recorded waste, shown beside it.
- Q154: confirmed. Sales KPIs are frozen nightly in `daily_kpi`; purchases, waste and the register difference stay live.
- Q145, Q147, Q150–Q153, Q155 and A1–A5: the defaults.

No variant (V1–V6) is triggered. The questions below are kept as they were asked.

**Already decided and applied:**
- project Q16 = V6: the chef sees no €, and gets no M22 endpoint;
- project Q18 default: the cut-off is 02:00 (in force since M11);
- Q107: the admin sees no fixed-cost figure;
- Q128: a table counts on the evening it is closed.

**Still open from earlier plans:**
- project Q4: the fixed cost figures (the fixture's 300,00 € is invented);
- project Q13 and Q14: GDPR roles and retention;
- M21 Q130: whether fatture are in the register comparison. The range report follows M21's rule.

**New:**
- **Q145 "Yesterday's KPIs are final by 03:00" on the night the clocks go forward.**
  - **Default:** the figures are final about 15 minutes after the cut-off every night (02:15). On 28 March 2027 the cut-off itself falls at 03:00, because 02:00 does not exist, so they are final at about 03:15.
  - Meeting 03:00 that night too would need an earlier cut-off, which is a setting you can change (project Q18). No other build is planned.
- **Q146 Food cost %: which revenue do we divide by?**
  - **Default:** only the revenue of dishes whose cost is known. Drinks, dishes without a recipe and the coperto are shown apart, with their share.
  - **Alternative:** all dish and drink revenue, a literal reading of the PRD (→ V1). On the test day this gives 19,40 % instead of 29,82 %.
- **Q147 Mix %: a share of what?**
  - **Default:** each item's share of everything sold, drinks included (the PRD's wording).
  - **Alternative:** a share within its category, so drinks are compared with drinks (→ V2).
- **Q148 What is "the same period" for comparisons?**
  - **Default:**
    - a day against the same weekday a week before;
    - a week against the previous week;
    - a month against the previous month;
    - a custom range against the same number of days just before.
  - **Alternative:** the same period last year (→ V3). Until the app has a year of data, that comparison is empty.
- **Q149 Actual vs theoretical: is recorded waste part of the difference?**
  - **Default:** yes, as the PRD defines it ("what the count says disappeared minus what recipes say"). Recorded waste is shown next to it.
  - **Alternative:** take recorded waste out and show only the unexplained part (→ V4).
- **Q150 What counts as "opening the dashboard"?**
  - **Default:** each time **you** (the owner) load Oggi, counted per week. Automatic refreshes and the admin's visits are not counted.
  - Counting the admin too would be a one-line role change, not a variant.
- **Q151 How long do we keep the weekly open counts?**
  - **Default:** no automatic deletion in M22; they follow the general retention decision (project Q14).
  - **Alternative:** delete the counts older than N weeks, with N chosen by you (→ V5; the tests use 26).
- **Q152 Stock-outs during service, per week.** The project plan's success-metric table puts this in M22, but the M22 specification does not.
  - **Default:** not shown in M22. DigiAlto reads it during the supervised run.
  - **Alternative:** a "sold out during service" count in the report (→ V6).
- **Q153 Where and how is "under 2 seconds on a phone over 4G" measured?**
  - **Default:** you start a run from GitHub against **staging** after this milestone merges, as for the order-entry timing.
    - It uses a Chromium browser with Lighthouse's "Slow 4G" network profile, and no CPU slowdown.
    - The report gives the numbers with no pass or fail, and is used at the go-live gate (M25).
  - A run on each PR's preview would need its own database per preview: that is a re-plan, not a variant.
  - If you want a CPU slowdown added, it is a parameter.
- **Q154 Which figures stay live after the night?**
  - **Default:** purchases (by invoice date), waste and the register difference are always computed fresh. A late invoice or a corrected register total therefore changes past days; sales figures never do.
  - Please confirm.
- **Q155 The weekly unmapped-items report.**
  - **Default:** a screen you can open for any week, with no e-mail.
  - If you want it e-mailed every Monday, that is a later change, made with the alert digest.

**Assumptions (please confirm; a different answer means a re-plan, not a variant):**
- **A1:** the venue counts one storage area, and actual vs theoretical compares two monthly counts of that area. With several areas the report still works, but it marks the comparison as indicative.
- **A2:** an on-screen weekly report satisfies the PRD's "weekly unmapped items report" (Q155).
- **A3:** "plates sold" for fixed costs means dishes with a recipe, so drinks carry no fixed cost (M8's "plate lines").
- **A4:** menu prices and the coperto include VAT (M17 A1). Net revenue divides each line by its own VAT rate, and the coperto by its own rate.
- **A5:** food cost uses the cost frozen when the dish was sent to the kitchen (M19). A dish voided after sending is not sold: its cost shows in waste, not in food cost.

**Technical, resolved inside the build:** T1–T4 (§6).

## 8. Manual steps for the founder

- None are needed to build, test or merge M22. The migrations, including the `kpi-rollup` schedule, reach staging through the existing deploy job after merge.
- After merge, DigiAlto checks on staging that the first `kpi-rollup` runs are recorded (`job_run_latest('kpi-rollup')`).
- **AT7:** start "Dashboard 4G timing" from the GitHub Actions tab on `main`, and approve the `staging` environment. Account logins stay in your password manager (project Q26).
- **Gate 4 evidence (supervised run):** with your approval, DigiAlto reads the weekly opens in the Supabase SQL editor with `select iso_week, opens from public.dashboard_open where app_user_id = <owner id> order by iso_week`. The query is written in the M22 PR description and in `clients/osteria-dei-rossi/context.md` in DigiAlto-Ops (the app repo has no runbook yet).
- Answer Q145–Q155 when convenient. A different answer to Q146–Q149, Q151 or Q152 triggers its variant as a follow-up PR.

## 9. Sources

- Worktree `/home/user/osteria-m22` (`main` `0c73030`):
  - `CLAUDE.md`, `docs/prd.md`, `docs/plans/2026-10-21-project-plan.md`, and the owner dashboard and M21 plans;
  - ADR-021 and ADR-023;
  - migrations `20261023110100`, `20261023110300`, `20261025100100`, `20261027100000`, `20261027100200`, `20261027100300`, `20261027100400`, `20261027101300`, `20261028100100`, `20261029100100`, `20261105100000`, `20261106100000`, `20261106100100`, `20261108100300`, `20261110100300`;
  - pgTAP `059`, `179`, `207`, `214`, `222`;
  - `.github/workflows/perf-order-entry.yml` and `scripts/lib/perf-dashboard.ts`.
- The M19b plan `docs/plans/2026-10-31-m19b-kitchen-done.md`, read from `/home/user/osteria-m19b`, for its numbering: migrations `20261111…`, pgTAP `223`–`230`, ADR-024, Q136–Q144.
- Lighthouse throttling presets: <https://github.com/GoogleChrome/lighthouse/blob/main/docs/throttling.md> (T3).
- Chrome DevTools Protocol, `Network.emulateNetworkConditions`: <https://chromedevtools.github.io/devtools-protocol/tot/Network/#method-emulateNetworkConditions> (T3).
- PostgreSQL materialized views (no row security; `REFRESH` recomputes the whole view), not re-read in this session:
  - <https://www.postgresql.org/docs/current/rules-materializedviews.html>;
  - <https://www.postgresql.org/docs/current/sql-refreshmaterializedview.html>;
  - row security: <https://www.postgresql.org/docs/current/ddl-rowsecurity.html> (ADR-025).
- pg_cron: <https://github.com/citusdata/pg_cron> (schedules in UTC; T4).
