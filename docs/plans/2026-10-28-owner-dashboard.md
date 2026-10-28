# Tech plan: Osteria Digitalization · Owner dashboard on Oggi (part of M22, pulled forward)

- **Client slug / internal:** `osteria-dei-rossi`.
  - Client facts used: none beyond `docs/client-facts.md` (trading name, colours, fonts), which the existing tokens already carry.
  - **The drafts in `docs/client/` are not used.** Every fixture is fake: tenants "Osteria Demo A/B", plates "Tagliatelle (fixture)" and the others in §5, suppliers "Fornitore Uno (demo)", "Fornitore Due (demo)", and invented amounts. The repo is public.
- **Repo and branch:** `osteria-dei-rossi-app`, worktree `/home/user/osteria-dash`, branch `feat/owner-dashboard`, from `main` `23021b0` (M0–M18, demo data, UX P0 merged).
  - **Merge order (founder answer Q106): UX PR B (`feat/ux-p1-flows`) merges first.** This branch is rebased onto `main` after PR B lands. Until then it is stacked on `feat/ux-p1-flows` and its draft PR is based on that branch (§2.2).
- **Numbering:** migrations `20261108100000`–`20261108100900` (100000–100300 used, the rest kept for review fixes and variants); pgTAP `200`–`209` (200–207 used, 208 under V4, 209 for review fixes); ADR-021; questions from Q106; e2e `e2e/dashboard.spec.ts`.
  - Checked free on 2026-10-28:
    - `main`: pgTAP up to 169 and 190–197, migrations up to `20261105100600`;
    - `feat/m19-firing`: pgTAP 170–179, migrations `20261106100000`–`100700`, ADR-019;
    - `feat/ux-p1-flows`: pgTAP 180, migration `20261107100000`.
    - ADR-020 is the app shell; 021 is free.
- **Shared check constraints:** this plan adds **no** audit entity type, audit action or alert kind.
  - `audit_event_*_check` and `app.alert_kind` are untouched, so `tests/config/check-constraint-union.test.ts` is unaffected.
  - `207` pins this (§5 step 6).
- **No new table.** `app.demo_purge_tables()` and pgTAP `194` (purge completeness) are unaffected; `207` asserts the public table list did not grow. Only V4 adds a table, and it carries its own purge step.
- **Author:** architect · **Date:** 2026-10-28
- **ADR:** `docs/adr/adr-021-dashboard-charts.md` (proposed): hand-written inline SVG with a text/table alternative, no chart library.
- **Sources:**
  - `docs/prd.md`: Goal 4, 4.1, 4.2, Feature 3 "GP% target… owner dashboard", Module 4 acceptance, NFR performance, success metric "dashboard opens";
  - project plan §3.3, §3.5, §3.6, §3.9, §3.11.2, §5a.3 M22, §5b V6, §7 Q16–Q18;
  - `docs/plans/2026-10-28-ux-flows.md` (§3.1.4, §3.2, §3.3, P1-1, B1–B3) and the PR B code in `/home/user/osteria-ux1`;
  - ADR-020; `docs/design/ui-foundation.md`;
  - the merged SQL in §2. **Where merged SQL and a plan differ, the SQL wins.**

> **Founder answers, 2026-10-28 (recorded here and in ADR-021)**
> - **Q106 Placement:** the owner's Oggi (`/`) **is** the dashboard. To-dos and next actions (PR B's block) at the top, then the tiles. No separate "Cruscotto" section. PR B merges first.
> - **Q107 Admin:** lands on the same dashboard, with **no fixed-cost keys** and no tile derived from fixed costs. pgTAP proves the admin payload omits them. (The founder left this to DigiAlto; the DigiAlto lead decided.)
> - **Q108 Chef:** no dashboard. The chef keeps PR B's action-list Oggi and `/api/today`.
> - **Q109 Waste window:** the current ISO week, Monday to Sunday, in Europe/Rome.
> - **Q110 Worst five plates:** ranked by how far GP % is below its target. Plates with an incomplete cost are listed separately as "costo incompleto" and are not ranked.
>
> **Still open, defaults in force for this build:** Q111–Q116 (§7).

## 1. Goal and scope

- **Goal:** the owner opens Oggi in the morning and sees, on one phone screen:
  - what needs doing today;
  - what is losing money.

  Only figures that real data supports today are shown. Each tile leads to the screen that acts on it, and on the laptop the same tiles form a grid.
- **In scope**
  - One SQL function `public.dashboard_summary()` (SECURITY DEFINER, §3.1) for owner and admin, returning one JSON document per call.
    - It embeds PR B's `today_counts()`, so the owner's Oggi needs **one** API round trip.
  - `GET /api/dashboard` (owner, admin; chef and waiter get 403 before any query).
  - Metrics:
    - food cost % overall;
    - GP % by plate, worst five first;
    - price-variance alerts;
    - payables overdue or due within 7 days;
    - stock at risk: below minimum, expiring lots, expiring batches;
    - waste € this ISO week;
    - open alerts, and today's prep and purchase list;
    - for the owner only, the fixed-cost status.
  - Placeholders reading "available after go-live of orders/bills" for covers, revenue and average spend. They carry no number.
  - Oggi page for owner and admin: PR B's to-do and first-steps block, then the tiles. Two SVG chart components (ADR-021).
  - Indexes for the dashboard's reads, a pgTAP plan check, and a p95 measurement script. The script reports and promises nothing.
- **Out of scope**
  - Everything in M22 that needs sales (M19–M21):
    - covers, revenue, average spend and ticket, plates by item, mix %;
    - sales-weighted food cost %, contribution, AVT, app vs register;
    - `v_daily_kpi`, `rollup_daily_kpi`, period comparisons, the unmapped-items report.
  - The dashboard-opens count (M22 AT9; Q114 → V4).
  - The push list and its slot (M23); exports (M24).
  - Any change to who reads alerts: UX plan Q4 is still open (§7 A2).
  - Any change to the nav model: Oggi is already `/` (ADR-020).

## 2. Current state

### 2.1 Merged on `main` (`23021b0`), read for this plan

| Source | What exists (file) | What the dashboard takes from it |
|---|---|---|
| M8 cost engine | `app.plate_cost_rows(p_tenant, p_keys, p_date, p_include_fixed)` (`20261023110300`, replaced by `20261031100700` to use the menu price). Per plate: `food_cost`, `sale_price_ex_vat`, `food_cost_pct`, `gp_pct`, `target_gp_pct`, `status` (`incomplete`, `below_target`, `fixed_cost_unallocated`, `ok`), `reasons`. With `p_include_fixed = false` it never reads `fixed_cost_period`. Closed to API roles | Food cost % overall and the plate ranking, with `p_include_fixed = false` for **both** roles |
| M8 fixed costs | `fixed_cost_period` (RLS owner only), `app.fixed_cost_at`, `public.fixed_cost_status()` (owner only, `app.require_fixed_cost_reader`) | The owner's `fixedCosts` key, by calling `public.fixed_cost_status()` |
| M8 settings | `app.cost_settings(p_tenant)`: `price_variance_pct`, `sale_vat_pct`, `avg_cost_n` (no € value) | Nothing directly (the plate rows already use it) |
| M8 price variance | Alert kind `price_variance` (`cost_bearing` true), raised in `approve_invoice` | Owner tile, read from `alert` |
| M9 payables | `payable (amount numeric(12,2), due_date, status)`; `payable_list` (`overdue` = not paid and due before the venue date). Reminder window: `app.payable_reminder_rule` uses `due_date <= today + 7` inline | Overdue and due-soon counts, totals and the first rows |
| M12 stock and lots | `app.expiry_state(expiry, today)` (`expired`; `due_soon` = within 1 day; `ok`; `none`). `stock_lots` uses the **venue date**. `app.usable_on_hand(p_tenant, p_today)` | Expiring lots; below-minimum uses usable stock |
| M14/M15 batches | `app.use_by_state(use_by, now)`; `v_batch_portions`; `public.waste_costs(p_from, p_to)` (owner/admin; raw + batch waste in €, `unvaluedCount`, by reason) | Expiring batches; waste € of the week, by calling `public.waste_costs` as it is |
| M16 rules | `rules_ingredients` checks the minimum against usable stock at `app.alert_business_date`. `prep_rule`, `purchase_rule` and `expiry_rule` raise `prep_due`, `prep_raw_short`, `purchase_due`, `raw_lot_expiring` and `batch_expiring` once per business date | Below minimum (same date rule as `/riordino/ingredienti`); today's prep and purchase list from today's alerts |
| M6 alerts | `alert` RLS: **the owner reads all; the chef reads kitchen rows that are not cost-bearing; the admin and the waiter read nothing** (`20261022150100`). TS: `src/server/alerts/list.ts` (`toAlertItem`, `alertHref`, `ALERT_COLUMNS`); `names.ts` (`loadNames`, one read per table); `ALERT_LIST_PAGE_SIZE` = 50 | Open count, price-variance rows and today's lists, owner only. Rendered by `toAlertItem`, with names supplied by the SQL (§3.1.6) |
| Shell and Oggi (UX P0) | `src/lib/nav/nav-model.ts` (Oggi → `/` for owner, admin, chef); `src/lib/nav/today-actions.ts`; `src/components/page-main.tsx` (`data-layout="wide"` widens `main` to `max-w-6xl` on `lg`) | Placement: no nav change |
| Tests infra | `e2e/helpers/session.ts`: `signInWithMagicLink(page, email, landing)` and the one-pass `expectPhoneFriendly` (measures `main button`, inputs, selects and `nav a`, **not** `main a`). `scripts/lib/perf-order-entry.ts` exports `nearestRank`, `summarize`, `parseServerTiming`, `assertTarget`. `src/server/orders/timing.ts`. `scripts/demo/seed-demo.ts` (demo week, plan `2026-10-24-demo-data.md` §3.3) | Reused as they are |

### 2.2 PR B (`feat/ux-p1-flows`, building in parallel; read in `/home/user/osteria-ux1`)

| Name | Shape relied on | Used by (step) |
|---|---|---|
| `public.today_counts()` (`20261107100000`) | SECURITY INVOKER, `search_path = ''`. Owner/admin: `{batchesUseBy, countOpen, invoicesToReview, payablesOverdue, payablesUnpaid, setup:{8 booleans}}`. Chef: the first two keys. Waiter: 42501. Every query filters `tenant_id = app.tenant_id()` explicitly | 4 |
| `app.payable_is_overdue(status, due_date, today)` | The shared overdue predicate (`payable_item` calls it) | 2 |
| `app.use_by_is_pending(use_by, now)` | `use_by_state in ('expired','due_soon')` | 2 |
| `src/server/today/summary.ts` `todaySummary()`; `types.ts` (`todaySchema`, `managerCountsSchema`, `TodaySummary`); `constants.ts` (`TODAY_ALERT_CAP` = 50) | Cards and setup steps, built from the counts and a capped open-alert read | 7 |
| `src/server/alerts/list.ts` exports `visibleTo` | — | 7 |
| `src/app/(owner)/page.tsx` + `src/components/use-today.ts` | Oggi with action badges and "Primi passi" | 12 |

- **Re-check rule.** After rebasing onto PR B's merge, grep each name above. If a shape differs, this plan follows PR B's SQL and the table is corrected in the same commit.
- **Precondition:** this plan's migrations sort after PR B's (`20261107…` < `20261108…`).
- `207` md5-pins `today_counts`, `payable_is_overdue` and `use_by_is_pending` **as merged**, so a later edit to them is a visible, deliberate change.

### 2.3 How the two APIs coexist

| | `GET /api/today` (PR B) | `GET /api/dashboard` (this plan) |
|---|---|---|
| Roles | owner, admin, chef | owner, admin |
| Who calls it | the chef's Oggi | the owner's and admin's Oggi |
| SQL | `today_counts()` + a capped alert read in TS (2 queries) | `dashboard_summary()`, which calls `today_counts()` and computes the same capped alert count (1 query) |
| `today` block | `TodaySummary` | **the same `TodaySummary`**, built by the same pure function `buildTodaySummary` (step 7) |

- `/api/today` stays, and its behaviour does not change. The owner's and admin's page simply stops calling it.
- **Why fold the counts in, rather than make two calls:**
  - the owner gets one round trip (Q106);
  - the to-do counts and the tiles come from one snapshot, so they cannot disagree mid-render.
- **Drift guard:**
  - `205` asserts `dashboard_summary()->'today'` equals `today_counts()` for the same user (owner, admin, two tenants);
  - the integration suite asserts that the two endpoints' `today` blocks are equal, for the owner and for the admin (step 13).

## 3. Design

### 3.1 Decisions

1. **One SECURITY DEFINER function, not INVOKER.** `public.dashboard_summary() returns jsonb`.
   - **Why DEFINER:**
     - it must call `app.plate_cost_rows`, `app.usable_on_hand` and `app.expiry_state`, and read alert payloads with names. These helpers are revoked from every API role on purpose;
     - they take `p_tenant` as a parameter. Granting them to `authenticated` so that an INVOKER function could call them would let any user pass another tenant's id (IDOR).
     - PR B could stay INVOKER because it only counts rows that RLS already filters.
   - **Rules (as for every definer function in the project):**
     - checks the role **first** (`owner` or `admin`, else 42501 before any read);
     - `set search_path = ''`, with every name schema-qualified;
     - takes the tenant from `app.tenant_id()`, never from a parameter, and every statement filters by it;
     - has no parameters, so there is no input to validate; it is `stable`;
     - `revoke all … from public, anon, service_role; grant execute … to authenticated`;
     - every `app.dashboard_*` helper is revoked from all API roles.
   - **Calls into existing public functions.** Each re-checks the role, which passes for owner and admin:
     - `public.today_counts()`;
     - `public.waste_costs(from, to)`;
     - for the owner only, `public.fixed_cost_status()`.

     The M12/M15 waste logic and the M8 fixed-cost logic therefore exist once.
   - **`today_counts()` inside a definer.** It is INVOKER, so when a definer calls it, it runs with the definer's rights and RLS may not filter.
     - It filters every query by `app.tenant_id()` itself.
     - `205` proves its result is identical to a direct call, and the two-tenant cases in `204` prove nothing leaks (T1).
2. **What the admin gets (Q107).**
   - The admin payload has **no** `fixedCosts` key.
   - The plate rows are computed with `p_include_fixed = false` for both roles, so no plate key carries a fixed, full or net figure for anyone.
   - Following the alert RLS (the admin reads no alert), the admin payload also omits `alertsOpen`, `priceVariance`, `todayLists` and `names`. PR B's admin `today` has no alerts card either.
   - If UX Q4 gives the admin alerts, that is a re-plan (§7 A2).
   - **Proof (`204`):**
     - the admin's top-level key set equals the admin list **exactly**;
     - a recursive key scan finds nothing matching `/fixed|rent|labour|utilit|fullCost|netMargin|perPlate/i`;
     - the owner's payload in the same test has `fixedCosts`.
3. **Chef (Q108):** `dashboard_summary()` raises 42501, and `GET /api/dashboard` returns 403 before any RPC. The chef's Oggi is unchanged (PR B). There is no reduced chef variant.
4. **Food cost % overall (Q111 default, V1).** No sales exist yet, so the PRD's sales-weighted figure (Σ cost of plates sold ÷ revenue) cannot be computed. The tile shows the **menu figure**:
   - Σ `food_cost` ÷ Σ `sale_price_ex_vat` × 100, over active plates whose status is not `incomplete`;
   - each plate counted once, rounded to 2 decimals from the unrounded sums.

   Display:
   - labelled "Food cost medio del menu", with the hint "Media dei piatti attivi, non pesata sulle vendite.";
   - `null` (not 0) when no plate is complete;
   - `platesCounted` and `platesIncomplete` say what the figure is built on.

   M22 replaces it with the sales-weighted KPI after M21; the tile keeps its key.
5. **Worst five plates (Q110).** From the same rows (`p_include_fixed = false`):
   - **Ranked:** plates whose status is not `incomplete`.
     - `gapPct = gp_pct − target_gp_pct`, computed on unrounded values.
     - Order: plates with a target first, by `gapPct` ascending. Then plates without a target, by `gp_pct` ascending (Q112 default, V2). Ties go by `name collate "C"`, then `recipe_key`.
     - The first `DASHBOARD_WORST_PLATES` = 5 are returned.
   - **Not ranked:** plates with status `incomplete`, listed by name under "Costo incompleto" (first 5 plus a count), with no percentage.
   - `status` here is `below_target` or `ok`, never `fixed_cost_unallocated`, since fixed costs are not included.
   - The tile shows GP % only; `/costi` remains the place for full costs.
6. **Alerts on the dashboard (owner only), in the same round trip.**
   - **`alertsOpen`** `{count, more}`: the tenant's open alerts (`acknowledged_at is null`), newest first. They are counted up to `app.dashboard_alert_cap()` = 50, reading one more row to set `more`.
     - This is PR B's `countAlerts` for the owner, whose `visibleTo` keeps every row.
     - Parity with `TODAY_ALERT_CAP` is tested (step 7).
   - **`priceVariance`** `{count, items}`: open `price_variance` alerts, the exact count and the newest 3 rows.
   - **`todayLists`** `{businessDate, prep, purchase}`: alerts whose `business_date = app.alert_business_date(tenant, now())`.
     - prep: kinds `prep_due` and `prep_raw_short`; purchase: kind `purchase_due`.
     - Acknowledged alerts stay in the list, flagged (Q113 default, V3).
     - The first 10 of each list, plus counts.
   - **Alert rows are returned raw:** `id, kind, severity, entity_type, entity_id, business_date, created_at, payload, cost_bearing, acknowledged_at`.
     - The service renders them with the existing `toAlertItem` (per-locale templates, `alertHref`), so the dashboard text equals `/avvisi`.
   - **Names in the same call:** `names` = `{ingredient, location, recipe, supplier, raw_lot, batch}`, each `{id: label}`.
     - `app.dashboard_alert_names` builds it from every uuid-valued top-level payload field of the returned rows.
     - It looks them up, tenant-filtered, in the six sources `names.ts` uses (`v_recipe_current` for recipes).
     - Over-fetching a name is harmless (owner only, own tenant). It replaces `loadNames`' up to six extra reads.
7. **Payables "due or overdue".** Unpaid means `status <> 'paid'`, so `scheduled` and `disputed` count, as in `payable_list`'s `overdue`.
   - **Overdue:** `app.payable_is_overdue(status, due_date, today)` (PR B's shared predicate). `today` is the venue date, as `payable_list` computes it.
   - **Due soon:** not overdue, and `due_date <= today + app.payable_due_soon_days()` (7, M9's reminder window; Q115 default).
   - **Output:** `{count, amountEur}` for each, plus the first 5 rows as `{id, supplierName, invoiceNumber, amountEur, dueDate, daysToDue, overdue}`, overdue first, then by `due_date` and `id`.
   - `payable_reminder_rule` keeps its inline `7`. `207` pins its md5, and the parity test pins `DUE_SOON_DAYS = 7` in TS.
8. **Stock at risk.** Each part follows the screen it links to, so a number on the tile matches what the user finds there.
   - **Below minimum** (as `/riordino/ingredienti`):
     - active stock ingredients with a `min_level` and `coalesce(usable_on_hand, 0) < min_level`, at `app.alert_business_date(tenant, now())`;
     - rows `{ingredientId, name, onHandQty, minQty, unit}`, by name `collate "C"`.
   - **Expiring lots** (as the lots on `/magazzino`):
     - raw lots with a positive balance and `app.expiry_state(expiry, venue_date) in ('expired','due_soon')`;
     - rows `{rawLotId, ingredientId, ingredientName, lotCode, expiry, state, qty, unit}`, by expiry, then id.
   - **Expiring batches** (as `/produzione` and PR B's `batchesUseBy`):
     - batches with `app.use_by_is_pending(use_by, now())` and `portions_remaining > 0`;
     - rows `{batchId, recipeName, lotCode, useBy, state, portions}`, by `use_by`, then id.
   - Each part is `{count, items}`, with the first 5 items. Quantities only, no €: the owner's tile needs none either.
9. **Waste € this ISO week (Q109).**
   - `app.dashboard_week(p_tenant, p_at)` returns the Monday and Sunday of the ISO week that contains `app.venue_date(p_at, tenant.timezone)` (Europe/Rome for this tenant).
   - `public.waste_costs(monday, sunday)` is then called and reduced to `{from, to, valueEur, rawValueEur, batchValueEur, unvaluedCount, reasons: [{reasonCode, valueEur}]}`.
   - Raw waste movements carry the venue date as `effective_on` (`stock_core` comment, rule 6), so the week lines up with `/magazzino/sprechi` for the same range.
   - A week with only unpriced waste shows "valore non disponibile", never "0,00 €" (M12 rule).
10. **Fixed costs (owner only).** `fixedCosts` is `public.fixed_cost_status()` as it is: `{periodMonth, monthlyTotalEur, platesSold, perPlateEur, reason}`.
    - Before there are sales, `reason` is `no_sales`, and the tile says "Non ripartiti finché non ci sono vendite."
    - This is the only fixed-cost-derived content, and it is owner-only (Q107).
11. **Placeholders (no fake numbers).** `comingSoon: ["covers", "revenue", "averageSpend"]` comes from SQL.
    - M21/M22 remove a key from the list in the same migration that adds the real figure.
    - The tile shows the label and "Disponibile dopo l'avvio di comande e conti", with **no** digit, no link and no chart.
12. **No data logic in React.**
    - SQL computes sums, ranks, windows, states and day counts.
    - Pure, unit-tested helpers in `src/lib/dashboard/` and `src/lib/charts/` do number and date formatting, labels, the choice of empty state and bar geometry.
    - Components only render.
13. **Personal data.** The payload holds business data only:
    - supplier names (possibly sole traders, project Q13), amounts, ingredient and recipe names;
    - no staff names (no acknowledger name is returned) and no customer data.

    Logs carry codes and SQLSTATEs only.

### 3.2 Data model and SQL

**No new table, no new column.** Four indexes and helper functions.

**`20261108100000_dashboard_cost_helpers.sql`** (step 1). Schema `app`, `stable`, `security definer`, `search_path = ''`, revoked from all API roles.
- `app.dashboard_plates(p_tenant uuid) returns jsonb` → `{foodCost: {overallPct, platesCounted, platesIncomplete}, plates: {worst: [...], incomplete: [...], incompleteCount}}` (decisions 4–5). It makes one call of `app.plate_cost_rows(p_tenant, null, null, false)`.
- `app.dashboard_worst_plates() returns integer` (immutable, 5).

**`20261108100100_dashboard_stock_helpers.sql`** (step 2). Same rules.
- `app.dashboard_week(p_tenant uuid, p_at timestamptz) returns table (week_from date, week_to date)`.
- Constants, each `immutable` and returning `integer`:
  - `app.payable_due_soon_days()` = 7;
  - `app.dashboard_list_cap()` = 5;
  - `app.dashboard_alert_cap()` = 50.
- `app.dashboard_payables(p_tenant uuid, p_today date) returns jsonb` (decision 7).
- `app.dashboard_stock_at_risk(p_tenant uuid, p_at timestamptz) returns jsonb` (decision 8).
- `app.dashboard_alerts(p_tenant uuid, p_at timestamptz) returns jsonb` → `{alertsOpen, priceVariance, todayLists}` (decision 6).
- `app.dashboard_alert_names(p_tenant uuid, p_rows jsonb) returns jsonb` (decision 6).

**`20261108100200_dashboard_indexes.sql`** (step 3). Each index serves a dashboard read that has no index today, and all start with `tenant_id`:
- `raw_lot_expiry_idx on public.raw_lot (tenant_id, expiry) where expiry is not null`: the expiring-lots read only touches lots that expire by tomorrow, as `expiry_rule` does.
- `payable_unpaid_due_idx on public.payable (tenant_id, due_date) where status <> 'paid'`: overdue and due-soon.
- `stock_movement_effective_idx on public.stock_movement (tenant_id, effective_on)` and `batch_movement_effective_idx on public.batch_movement (tenant_id, effective_on)`: the week's waste.
  - `waste_costs` filters `type::text = 'waste'`, which a partial index on `type = 'waste'` would not match. So these two indexes are not partial, and `waste_costs` is not changed.

These are plain `create index` statements in a migration, built while the tables are still small before go-live. If a large real tenant exists when this ships, see §6.

**`20261108100300_dashboard_summary.sql`** (step 4). `public.dashboard_summary() returns jsonb`:
1. `v_role := app.role()`; anything but `owner` or `admin` → 42501 `insufficient_privilege`. `v_tenant := app.tenant_id()`; null → 42501.
2. `v_now := now()`; the venue date `v_today` from `tenant.timezone`; the week from `app.dashboard_week`.
3. Build the document below. Owner-only keys are added only when `v_role = 'owner'`.

**The exact JSON (SQL output, camelCase, amounts as JSON numbers in EUR):**

```jsonc
{
  "role": "owner",                         // "owner" | "admin"
  "asOf": "2026-11-09T07:12:03.120Z",      // now(), ISO UTC
  "today": { /* public.today_counts() verbatim (PR B) */ },
  "alertsOpen": { "count": 7, "more": false },                       // owner only
  "foodCost": { "overallPct": 28.28, "platesCounted": 6, "platesIncomplete": 1 },
  "plates": {
    "worst": [ { "recipeKey": "uuid", "name": "Tagliatelle (fixture)", "gpPct": 60.00,
                 "targetGpPct": 70.00, "gapPct": -10.00, "status": "below_target" } ],   // ≤ 5
    "incomplete": [ { "recipeKey": "uuid", "name": "Ossobuco (fixture)" } ],             // ≤ 5
    "incompleteCount": 1
  },
  "priceVariance": { "count": 2, "items": [ /* alert rows, ≤ 3 */ ] },  // owner only
  "payables": {
    "dueSoonDays": 7,
    "overdue": { "count": 2, "amountEur": 150.50 },
    "dueSoon": { "count": 2, "amountEur": 245.00 },
    "items": [ { "id": "uuid", "supplierName": "Fornitore Uno (demo)", "invoiceNumber": "F-1",
                 "amountEur": 120.00, "dueDate": "2026-11-04", "daysToDue": -5, "overdue": true } ] // ≤ 5
  },
  "stockAtRisk": {
    "belowMin": { "count": 2, "items": [ { "ingredientId": "uuid", "name": "…", "onHandQty": 2,
                                           "minQty": 3, "unit": "kg" } ] },
    "expiringLots": { "count": 2, "items": [ { "rawLotId": "uuid", "ingredientId": "uuid",
                     "ingredientName": "…", "lotCode": "L-01", "expiry": "2026-11-10",
                     "state": "due_soon", "qty": 2, "unit": "kg" } ] },
    "expiringBatches": { "count": 2, "items": [ { "batchId": "uuid", "recipeName": "…",
                     "lotCode": "RAGU-…", "useBy": "2026-11-09T19:00:00Z", "state": "due_soon",
                     "portions": 4 } ] }
  },
  "waste": { "from": "2026-11-09", "to": "2026-11-15", "valueEur": 12.00, "rawValueEur": 6.00,
             "batchValueEur": 6.00, "unvaluedCount": 1,
             "reasons": [ { "reasonCode": "caduto", "valueEur": 6.00 } ] },
  "todayLists": { "businessDate": "2026-11-09",                      // owner only
                  "prepCount": 3, "prep": [ /* alert rows, ≤ 10 */ ],
                  "purchaseCount": 2, "purchase": [ /* alert rows, ≤ 10 */ ] },
  "names": { "ingredient": { "uuid": "…" }, "location": {}, "recipe": {}, "supplier": {},
             "raw_lot": {}, "batch": {} },                           // owner only
  "fixedCosts": { "periodMonth": "2026-11-01", "monthlyTotalEur": 3000.00, "platesSold": 0,
                  "perPlateEur": null, "reason": "no_sales" },       // owner only
  "comingSoon": ["covers", "revenue", "averageSpend"]
}
```

- An alert row is `{id, kind, severity, entityType, entityId, businessDate, createdAt, payload, costBearing, acknowledgedAt}`.
- Owner top-level keys: `role, asOf, today, alertsOpen, foodCost, plates, priceVariance, payables, stockAtRisk, waste, todayLists, names, fixedCosts, comingSoon`.
- Admin top-level keys: `role, asOf, today, foodCost, plates, payables, stockAtRisk, waste, comingSoon`.
- Rounding:
  - percentages to 2 decimals;
  - € to 2 decimals for payables and fixed costs;
  - waste € as the source function rounds it (4 decimals), shown with 2.

### 3.3 API

| Endpoint | Roles | Success | Errors |
|---|---|---|---|
| `GET /api/dashboard` | owner, admin (`withApi`; chef and waiter → 403 **before any RPC**) | 200 `DashboardOutput` (below), `Cache-Control: no-store`, `Server-Timing: auth;dur=…, rpc;dur=…, total;dur=…` | 400 `invalid_request` on any query string; 401; 403; 500 `dashboard_unavailable` ("Il cruscotto non è disponibile. Riprova tra poco."), with the SQLSTATE in the log only |

- **Files:**
  - `src/app/api/dashboard/route.ts`;
  - `src/server/dashboard/{constants,sql-schema,output,render,summary}.ts`;
  - `src/server/today/summary.ts` is split (step 7): the pure `buildTodaySummary(counts, alertsCard | null, role)` is extracted, and `todaySummary` keeps its behaviour by calling it.
- **SQL parse (`sql-schema.ts`):**
  - `ownerSqlSchema` and `adminSqlSchema` are `z.strictObject`s, discriminated by `role`;
  - the `today` part reuses `managerCountsSchema` (PR B);
  - an unexpected key fails the parse → 500 `dashboard_unavailable`, so a SQL change that leaks a key to the admin cannot reach the browser.
- **Output (`output.ts`), the Zod schema the client also validates:**

```ts
const pct = z.number().min(-1000).max(1000);
const eur = z.number().nonnegative();
const href = z.string().regex(/^\/[a-z0-9/-]*$/);
const isoDate = z.iso.date();
const plateRow = z.strictObject({
  recipeKey: z.uuid(), name: z.string().max(200),
  gpPct: pct, targetGpPct: pct.nullable(), gapPct: pct.nullable(),
  status: z.enum(["below_target", "ok"]),
});
const tileBase = { href };
export const dashboardBase = {
  asOf: z.iso.datetime(),
  today: todaySchema,                                   // PR B, unchanged
  tiles: z.strictObject({
    foodCost: z.strictObject({ ...tileBase, overallPct: pct.nullable(),
      platesCounted: z.number().int().nonnegative(), platesIncomplete: z.number().int().nonnegative() }),
    plates: z.strictObject({ ...tileBase, worst: z.array(plateRow).max(5),
      incomplete: z.array(z.strictObject({ recipeKey: z.uuid(), name: z.string().max(200) })).max(5),
      incompleteCount: z.number().int().nonnegative() }),
    payables: z.strictObject({ ...tileBase, dueSoonDays: z.literal(7),
      overdue: z.strictObject({ count: z.number().int().nonnegative(), amountEur: eur }),
      dueSoon: z.strictObject({ count: z.number().int().nonnegative(), amountEur: eur }),
      items: z.array(z.strictObject({ id: z.uuid(), supplierName: z.string(), invoiceNumber: z.string().nullable(),
        amountEur: eur, dueDate: isoDate, daysToDue: z.number().int(), overdue: z.boolean(),
        href })).max(5) }),
    stockAtRisk: z.strictObject({ ...tileBase, belowMin: listOf(belowMinRow), expiringLots: listOf(lotRow),
      expiringBatches: listOf(batchRow) }),           // listOf(r) = { count, items: r[] ≤ 5 }
    waste: z.strictObject({ ...tileBase, from: isoDate, to: isoDate, valueEur: eur, rawValueEur: eur,
      batchValueEur: eur, unvaluedCount: z.number().int().nonnegative(),
      reasons: z.array(z.strictObject({ reasonCode: z.string(), valueEur: eur })) }),
  }),
  comingSoon: z.array(z.enum(["covers", "revenue", "averageSpend"])),
};
export const adminDashboardSchema = z.strictObject({ role: z.literal("admin"), ...dashboardBase });
export const ownerDashboardSchema = z.strictObject({
  role: z.literal("owner"), ...dashboardBase,
  tiles: dashboardBase.tiles.extend({
    priceVariance: z.strictObject({ ...tileBase, count: z.number().int().nonnegative(),
      items: z.array(alertItemSchema).max(3) }),
    todayLists: z.strictObject({ ...tileBase, businessDate: isoDate,
      prepCount: z.number().int().nonnegative(), prep: z.array(alertItemSchema).max(10),
      purchaseCount: z.number().int().nonnegative(), purchase: z.array(alertItemSchema).max(10) }),
    fixedCosts: z.strictObject({ ...tileBase, periodMonth: isoDate.nullable(), monthlyTotalEur: eur.nullable(),
      perPlateEur: eur.nullable(), reason: z.enum(["no_fixed_costs", "no_sales"]).nullable() }),
  }),
});
export const dashboardOutput = z.discriminatedUnion("role", [ownerDashboardSchema, adminDashboardSchema]);
```

  - `alertItemSchema` is the `AlertItem` shape of `list.ts`. `acknowledged.byName` is always `null` here, since no names of people are returned.
  - The owner's `today.cards` include the `alerts` card, built from `alertsOpen`; the admin's do not (PR B behaviour).
  - `belowMinRow`, `lotRow` and `batchRow` are the §3.2 row shapes, each with an `href`: `/riordino/ingredienti`, `/magazzino/<ingredientId>` and `/produzione/<batchId>`.
  - The output is parsed with these strict schemas before it is sent, so an injected key is dropped (step 8 test).

### 3.4 Screens and components

House style: `docs/design/ui-foundation.md` §4–§8. 360 px first, 44 px targets, Italian, `.num` on figures, a word with every colour, no icons, no images.

**`/` Oggi, owner and admin** (`src/app/(owner)/page.tsx`; the chef and waiter paths are unchanged):
1. `Heading` greeting and the account `Card` (PR B, unchanged; `data-testid="role"`).
2. **To-dos (PR B's block, unchanged):** the primary action, the action list with count badges, and "Primi passi" until done. It is fed from `dashboard.today` instead of `/api/today`.
3. `SubHeading` "Andamento", then the tile grid `div[data-testid="dashboard-tiles"]`:
   - one column under 1024 px; `lg:grid-cols-2` and `xl:grid-cols-3`, with `gap-4`;
   - the page is wrapped in `data-layout="wide"`, so `main` widens to `max-w-6xl` on `lg` (the existing mechanism).
4. Tile order:
   - owner: Da fare oggi (prep and purchase) · Margini dei piatti · Food cost medio del menu · Pagamenti · Scorte a rischio · Sprechi della settimana · Aumenti di prezzo · Costi fissi · In arrivo (placeholders);
   - admin: the same without Da fare oggi, Aumenti di prezzo and Costi fissi.

**`Tile`** (`src/components/dashboard/tile.tsx`):
- a `section` with `data-tile="<key>"`, labelled by its `h2` through `aria-labelledby`. The `h2` is Figtree bold 18 px, not Bodoni, so it may sit below 20 px;
- a `surface` sheet with a `rule` border and `rounded-card`. It is a bordered section, not a `Card`, so the page keeps its two-`Card` limit;
- the content, then **one** 44 px `linkClass` link "Apri <screen>" to the detail screen.

A tile is not one big link, because it contains lists.

| Tile | Content | Detail link | Empty state (exact text) |
|---|---|---|---|
| Da fare oggi (owner) | Two short lists, "Da preparare" and "Da ordinare": the rendered alert title, and a neutral `Badge` "Visto" if acknowledged; "e altri N" past 10 | `/avvisi` | "Niente da preparare o da ordinare oggi." |
| Margini dei piatti | `BarTable` (GP % per plate, with a target tick). Each row reads "Tagliatelle (fixture) · GP 60,00 % · obiettivo 70,00 %" with a `Badge` "Sotto obiettivo" (`danger`) or "In linea" (`success`). Then "Costo incompleto" with the names, as text | `/costi` | No plate at all: "Nessun piatto attivo." plus the link "Crea una ricetta" → `/ricette/nuova`. All plates incomplete: the ranked list is replaced by "Nessun piatto con costo completo." and the incomplete list stays |
| Food cost medio del menu | `Meter` (0–100 %) and the figure "28,28 %"; the muted hint (decision 4); "su 6 piatti · 1 con costo incompleto" | `/costi` | `overallPct` null: "Nessun piatto con costo completo." |
| Pagamenti | Two figures: "Scaduti 2 · 150,50 €" and "In scadenza entro 7 giorni 2 · 245,00 €". Up to 5 rows, each a link to `/pagamenti/<id>`: supplier, `.num` amount, and the day words from the server's `daysToDue` ("Scaduta da 5 giorni" / "Scade oggi" / "Scade tra 7 giorni") | `/pagamenti` | "Nessun pagamento scaduto o in scadenza nei prossimi 7 giorni." |
| Scorte a rischio | Three groups, each with a count: "Sotto il minimo", "Lotti in scadenza", "Preparazioni in scadenza". Rows show `.num` quantities and a `Badge` "Scaduto" (`danger`) or "In scadenza" (`warning`). No € | `/magazzino` (row links go to the specific screens) | All three zero: "Nessuna scorta a rischio." A group with zero rows is left out |
| Sprechi della settimana | "Settimana dal 09/11 al 15/11"; the total in `.num` ("12,00 €"); a `BarTable` by reason, with bars scaled to the largest reason; "1 movimento senza prezzo" when `unvaluedCount > 0` | `/magazzino/sprechi` | Total 0 and nothing unvalued: "Nessuno spreco registrato questa settimana." Only unvalued waste: "Valore non disponibile" (never "0,00 €") |
| Aumenti di prezzo (owner) | The count and the newest 3 rendered alerts | `/avvisi` | "Nessun aumento di prezzo da vedere." |
| Costi fissi (owner) | "3.000,00 € al mese (novembre 2026)", and the per-plate figure or "Non ripartiti finché non ci sono vendite." | `/costi/impostazioni` | `no_fixed_costs`: "Costi fissi non inseriti." |
| In arrivo | One row per `comingSoon` key ("Coperti", "Incasso", "Scontrino medio per coperto"), each with "Disponibile dopo l'avvio di comande e conti". Plain text: no number, no link, no chart | none | (always this text) |

- **Loading:** PR B's to-do block in its loading state, then `Muted` "Caricamento del cruscotto…". Tiles have no skeleton shapes.
- **Error:** one `ErrorAlert` "Il cruscotto non è disponibile." with a `secondary` "Riprova". PR B's static actions stay usable, as they do today when `/api/today` fails.
- **Refresh:** on mount, and on window focus at most once a minute (`DASHBOARD_REFRESH_MS` = 60 000). No polling while the page is hidden.

**Charts (ADR-021)** in `src/components/charts/`:
- **`BarTable`** (`bar-table.tsx`): a real `<table>` with a `<caption>` that states the tile's question, for example "Margine lordo per piatto, i cinque peggiori".
  - Columns: the name (`th scope="row"`), the value as text, and a bar cell.
  - The bar cell holds `<svg aria-hidden="true" focusable="false" viewBox="0 0 100 8" preserveAspectRatio="none" class="h-2 w-full">`, containing:
    - a track `rect`, `fill-sunk`, full width;
    - a value `rect` whose `width` is the helper's percentage, `fill-accent`, or `fill-danger` when the row is below target;
    - an optional target tick: a `line` at `x` = target, `stroke-ink`, `stroke-width` 1, `vector-effect="non-scaling-stroke"`.
  - The table **is** the text alternative; the SVG adds nothing a screen reader needs.
  - On a phone the bar cell wraps under the name (a CSS grid on `tr` below `sm`), so nothing scrolls sideways.
- **`Meter`** (`meter.tsx`): an `<svg aria-hidden="true">` track and value bar, beside the visible figure and hint, which carry the meaning.
- **Geometry** in pure helpers (`src/lib/charts/scale.ts`). Nothing else is computed in the components.
  - `barPct(value, max)`: clamped to 0–100, one decimal, 0 for null or negative values;
  - `tickPct(target)`: null when there is no target.
- **Tokens.** Light and dark switch through the existing CSS variables; the charts contain no theme code.

  | Utility | Light | Dark |
  |---|---|---|
  | `fill-accent` | green `#1C4130` | sage `#8CB89A` |
  | `fill-danger` | `#9A2A1D` | `#F4A694` |
  | `fill-sunk` | `#F8EFC6` | `#25241F` |
  | `stroke-ink` | `#0F0F0D` | `#FFFADF` |

  New non-text pairs (3:1) in `CONTRAST_PAIRS`:
  - `danger`/`surface`;
  - `ink`/`sunk`: it exists as a text pair and is added as a boundary pair.

  `accent`/`surface` already exists. The tests compute both themes.
- **Never colour alone:** "below target" is also the `Badge` word, and the percentage is printed.
- **Forced colours:** an `@media (forced-colors: active)` block in `globals.css` sets the value bars to `CanvasText` and the track to `Canvas` with a 1 px `CanvasText` stroke (<https://developer.mozilla.org/en-US/docs/Web/CSS/@media/forced-colors>).
- **Reduced motion:** the bars are static; tiles only take the existing `.reveal` rise.
- **Forbidden by ui-foundation §7, and asserted in step 10:** no `style` attribute, no `<image>`, no `<foreignObject>`, no `data:` URI, no icon font, no Tailwind palette colour.

**View helpers** in `src/lib/dashboard/dashboard-view.ts` (pure):
- `formatEur`: `1.234,50 €`, through `Intl` it-IT, which puts U+00A0 before "€";
- `formatPct`: "28,28 %";
- `dueWords(daysToDue, overdue)`;
- `weekLabel(from, to)`, in Europe/Rome;
- `tileEmpty(key, tile)`: which empty text applies;
- `comingSoonLabel(key)`;
- `tileOrder(role)`.

**i18n:** every string goes into `src/lib/i18n/messages/{it,en}.ts` (`dashboard.*`). `keys.ts` makes a missing English key a type error.

### 3.5 Flows

1. **Owner opens Oggi:**
   1. `useMe` (cached) → role owner → `GET /api/dashboard`;
   2. `withApi` checks the session and role, then one RPC `dashboard_summary()`;
   3. the service parses the SQL document (strict), renders the alert rows with the names, and runs `buildTodaySummary`;
   4. the output is parsed (strict) and sent as JSON;
   5. the page renders the to-dos and the tiles from that one answer.
2. **Admin:** the same, with the admin schema; no alert, price-variance, today-list or fixed-cost tile.
3. **Chef:** `useMe` → chef → `GET /api/today` (PR B), unchanged. A chef calling `/api/dashboard` directly gets 403, and no RPC runs.
4. **Waiter:** `landingFor` → `/tavoli` (P0), unchanged.

### 3.6 Secrets and configuration

| Name | Where it lives | Used here |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Vercel env (public by design); local `.env` (gitignored) | The session client of `/api/dashboard`; the perf script's sign-in |
| `SUPABASE_SECRET_KEY` | Vercel env (server-only); local `.env`; GitHub `staging` environment secret | **No `src/` code of this plan uses it.** Only `scripts/perf/dashboard.ts` uses it, to create the fake perf owner on the local stack (`scripts/` is the allowed place), plus the existing integration and e2e helpers |
| `PIN_PEPPER`, `CRON_SECRET`, `ANTHROPIC_API_KEY`, `EXTRACTION_MODEL_ID`, `RESEND_API_KEY`, Vault values | Vercel env / Supabase Vault (unchanged) | Not touched |
| Account logins (Vercel, Supabase, GitHub) | The account owner's password manager with MFA (project Q26); never in the repo or DigiAlto-Ops | Humans only. The founder approves a staging run under V5 |

No new secret, provider or paid service.

## 4. Alternatives considered

- **A separate "Cruscotto" section** under Oggi or Gestione: rejected by the founder (Q106). It would have added a sixth nav item and a second morning screen.
- **Two calls on Oggi (`/api/today` + `/api/dashboard`):** rejected. It costs two round trips on a 4G phone and gives two snapshots that can briefly disagree. Folding is cheap, because the same SQL function and the same pure builder are reused.
- **A SECURITY INVOKER dashboard function:** rejected (decision 1). It would need the `app.*` helpers that take `p_tenant` granted to `authenticated`, which opens a cross-tenant read.
- **Composing the dashboard in TypeScript from the existing endpoints** (`plate_costs`, `payable_list`, `stock_on_hand`, `batch_list`, `waste_costs`, alerts): rejected.
  - It costs 6–8 round trips per load.
  - Paginated lists give wrong totals (the UX plan's reason for `today_counts`).
  - Ranking in TS is data logic outside Postgres.
- **A materialised view or a nightly snapshot:** rejected for now. The figures must be live (an invoice approved at 09:00 changes the margins at 09:00), and `v_daily_kpi` belongs to M22, with sales.
- **Calling `public.plate_costs()` for the ranking:** rejected.
  - For the owner it includes fixed costs (status `fixed_cost_unallocated`).
  - Its output carries € columns the ranking does not need.
  - `app.plate_cost_rows(…, false)` is the exact source of `plate_margins_pct`.
- **The mean of the plates' food cost % as "overall":** kept as V1 (Q111). The ratio of sums is closer to the PRD's ratio definition.
- **A chart library (Recharts, Chart.js, ECharts):** rejected in ADR-021.
- **Whole-tile links** (the entire tile clickable): rejected. A tile holds row links, and nested interactive content is invalid HTML.
- **Rendering the alert text in SQL:** rejected. The templates live in TS, per locale (M6). The SQL sends rows plus names, so rendering stays in one place.

## 5. Build plan (test first; one commit per step; `tdd-guide` follows the order)

**Fixture used by `200`–`206`.** Tenant A is built as the migration owner inside the rolled-back test. There are two of everything, and rows are found by id, never by position.
- **Plates.** Cost settings are the defaults (`sale_vat_pct` 10). Recipe prices are used with no menu item, so the VAT is 10 %. Ingredient prices are set so that the food costs below are exact:

  | Plate | Sale (VAT incl.) | Ex VAT | Food cost | FC % | GP % | Target | Gap |
  |---|---|---|---|---|---|---|---|
  | P1 "Tagliatelle (fixture)" | 11,00 | 10,00 | 4,00 | 40 | 60 | 70 | −10 |
  | P4 "Zuppa (fixture)" | 8,80 | 8,00 | 2,40 | 30 | 70 | 80 | −10 |
  | P3 "Bruschetta (fixture)" | 5,50 | 5,00 | 2,00 | 40 | 60 | 65 | −5 |
  | P6 "Gnocchi (fixture)" | 9,90 | 9,00 | 1,80 | 20 | 80 | 75 | +5 |
  | P2 "Spezzatino (fixture)" | 22,00 | 20,00 | 5,00 | 25 | 75 | 70 | +5 |
  | P5 "Tiramisù (fixture)" | 6,60 | 6,00 | 1,20 | 20 | 80 | none | — |
  | P7 "Ossobuco (fixture)" | 15,40 | 14,00 | incomplete (an ingredient with no price) | — | — | 70 | — |
  | P8 "Vecchio piatto (fixture)" | 10,00 | — | 1,00 | — | — | — | inactive key: never listed |

  Expected:
  - `worst` = [P1, P4, P3, P6, P2]. Ties go by name `collate "C"`: "Tagliatelle" < "Zuppa", "Gnocchi" < "Spezzatino". P5 is sixth, so the limit cuts it.
  - `incomplete` = [P7].
  - `overallPct` = 16,40 ÷ 58,00 × 100 = **28.28**; `platesCounted` 6, `platesIncomplete` 1.
- **Payables** (D = venue today; two suppliers):
  - overdue 2 / **150,50**: PA due D−5, 120,00, `open`; PB due D−1, 30,50, `scheduled`;
  - due soon 2 / **245,00**: PC due D, 45,00, `disputed`; PD due D+7, 200,00, `open`;
  - out: PE due D+8, 99,00; PF due D−10, 80,00, `paid`.
- **Stock** (two locations, "Cella (demo)" and "Dispensa (demo)"):
  - I1: min 3, usable 2 → below;
  - I2: min 5, usable 5 → not below (strict);
  - I3: no min → off;
  - I4: inactive and below → excluded;
  - I5: min 4, on hand 6, of which 3 sit in lot L2 that expired at D−1 → usable 3 → below.

  **belowMin 2** (I1, I5).
- **Lots:**
  - L1 (I1): expiry D+1, 2 kg → `due_soon`;
  - L2 (I5): expiry D−1, 3 kg → `expired`;
  - L3: expiry D+2 → out;
  - L4: expiry D, balance 0 → out.

  **expiringLots 2.**
- **Batches:**
  - B1: use-by now + 12 h, 4 portions → `due_soon`;
  - B2: use-by now − 1 h, 2 portions → `expired`;
  - B3: use-by now + 30 h → out;
  - B4: use-by now + 2 h, 0 portions → out.

  **expiringBatches 2**, equal to `today_counts().batchesUseBy`.
- **Waste** (week of D, Monday M):
  - raw 1,5 kg at 4,00 on M ("avariato") = 6,00;
  - raw 10,00 on M−1 → out;
  - batch 3 portions × 2,00 frozen cost on M+6 ("caduto") = 6,00;
  - one unpriced raw waste on M+1.

  **valueEur 12,00, raw 6,00, batch 6,00, unvaluedCount 1.**
- **Alerts** (two ingredients and two suppliers in the payloads):
  - open `price_variance` ×2, acknowledged `price_variance` ×1;
  - today: `prep_due` ×2 (one acknowledged), `prep_raw_short` ×1, `purchase_due` ×2;
  - yesterday: `prep_due` ×1, open (outside today's list, still counted as open).

  Expected `alertsOpen.count` = 2 + 1 + 1 + 2 + 1 = **7**, `more` false.
- **Fixed costs:** this month 1.500 + 1.200 + 300 = **3.000,00**; no sales → `perPlateEur` null, `reason` `no_sales`.
- **Tenant B:** owner B, 1 plate, 1 overdue payable of 999,00, 1 open alert. None of B's ids may appear in A's payload, and none of A's in B's.

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| 1 | Migration: cost helpers (`dashboard_plates`, `dashboard_worst_plates`) | `supabase/migrations/20261108100000_dashboard_cost_helpers.sql`, `supabase/tests/database/200_dashboard_cost_helpers.test.sql` | `200`, on the plate fixture. **Food cost:** `overallPct` 28.28; `platesCounted` 6; `platesIncomplete` 1. **Ranking:** `worst` recipe keys equal `[P1, P4, P3, P6, P2]` (compared as an id array); each row's `gpPct`, `targetGpPct`, `gapPct` and `status` equal the table (P1 −10.00 `below_target`, P2 +5.00 `ok`); P5 absent (limit); with P2 deactivated, P5 appears **last** (null target after targeted plates); the tie order is asserted on names with `order by name collate "C"`. **Lists:** `incomplete` = [P7] with no percentage key; P8 never present. **Edges:** all plates incomplete → `overallPct` null and `worst` `[]`; no plate → `{overallPct: null, platesCounted: 0, …}`. **No fixed costs:** as the owner, with a fixed-cost row present, the result equals the result without it. `dashboard_worst_plates()` = 5. No API role can execute either function |
| 2 | Migration: week, payables, stock, alerts and names helpers; the three cap constants | `supabase/migrations/20261108100100_dashboard_stock_helpers.sql`, `supabase/tests/database/201_dashboard_stock_helpers.test.sql` | `201`. **Week (Europe/Rome, DST):** `dashboard_week(A, '2026-10-25 22:30+00')` (23:30 Sunday, CET) → 2026-10-19..2026-10-25; `'2026-10-25 23:30+00'` (00:30 Monday) → 2026-10-26..2026-11-01; `'2026-03-29 00:30+00'` (01:30 Sunday, before the spring change) → 2026-03-23..2026-03-29. **Payables:** overdue {2, 150.50}, dueSoon {2, 245.00}; item ids = [PA, PB, PC, PD] (overdue first, then due date); PE and PF absent; `daysToDue` −5, −1, 0, 7; with 6 qualifying rows, `items` has 5 and the counts say 6. **Stock:** belowMin ids = [I1, I5] by name `collate "C"`, with I5's `onHandQty` 3; expiringLots ids = [L2, L1] by expiry, states `expired`, `due_soon`; expiringBatches ids = [B2, B1] with their states; a cap of 5 with 6 rows. **Alerts:** `alertsOpen.count` 7, `more` false; with 51 open → count 50, `more` true; `priceVariance.count` 2, item ids newest first, the acknowledged one absent; `todayLists.prep` ids = today's 3 (the acknowledged one present, with `acknowledgedAt` set), yesterday's absent; `purchase` has 2. **Names:** for a `purchase_due` row, `names.ingredient[I1]` and `names.supplier[S1]` are the fixture names; a tenant-B ingredient id planted in a tenant-A payload resolves to nothing. **Constants:** `payable_due_soon_days()` 7, `dashboard_list_cap()` 5, `dashboard_alert_cap()` 50. No API role can execute any `app.dashboard_*` function |
| 3 | Migration: the four indexes | `supabase/migrations/20261108100200_dashboard_indexes.sql`, `supabase/tests/database/202_dashboard_indexes.test.sql` | `202`: `has_index` for `raw_lot_expiry_idx`, `payable_unpaid_due_idx`, `stock_movement_effective_idx` and `batch_movement_effective_idx`, with their exact column lists and the two partial predicates (`pg_get_indexdef` compared). `001`, `037` (append-only) and `194` stay green |
| 4 | Migration: `public.dashboard_summary()` | `supabase/migrations/20261108100300_dashboard_summary.sql`, `supabase/tests/database/203_dashboard_owner.test.sql`, `204_dashboard_roles.test.sql`, `205_dashboard_today_parity.test.sql` | **`203` (owner, every metric against the fixture):** the top-level key set equals the owner list exactly (§3.2); `foodCost` and `plates` as in `200`; `payables`, `stockAtRisk`, `alertsOpen`, `priceVariance`, `todayLists` and `names` as in `201`; `waste` = {from M, to M+6, 12.00, 6.00, 6.00, unvalued 1}, with `reasons` by value, then code; `fixedCosts` = {month, 3000.00, 0, null, `no_sales`}; `comingSoon` = `["covers","revenue","averageSpend"]`; `role` `owner`. **`204` (roles, admin, tenants):** admin A's key set equals the admin list **exactly**; `fixedCosts`, `alertsOpen`, `priceVariance`, `todayLists` and `names` are absent (`not (payload ? 'fixedCosts')` and so on, one assertion each); a recursive key walk finds no key matching `/fixed\|rent\|labour\|utilit\|fullCost\|netMargin\|perPlate/i`; the admin's `foodCost`, `plates`, `payables`, `stockAtRisk` and `waste` equal the owner's. Chef A, waiter A, a user of no tenant and no claims → `42501` (`throws_ok`), also while tenant A holds data for every tile. `has_function_privilege('anon', 'public.dashboard_summary()', 'execute')` is false and `authenticated` true; `prosecdef` is true; `proconfig` = `{search_path=""}`. **Two tenants:** owner B gets B's numbers (1 overdue, 999.00); a recursive scan of A's payload text finds none of B's uuids, and B's none of A's. **`205` (parity):** for owner A, admin A and owner B, `dashboard_summary()->'today'` equals `today_counts()` called directly in the same transaction; `payables.overdue.count` equals the number of `payable_list('unpaid')` items with `overdue` true; `stockAtRisk.expiringBatches.count` equals `today_counts()->'batchesUseBy'` |
| 5 | pgTAP performance net and plan check | `supabase/tests/database/206_dashboard_perf.test.sql` | **Fixture:** a demo-shaped tenant scaled up (the demo week of `2026-10-24-demo-data.md` §3.3, repeated as history): 40 plates, 300 ingredients, 20 000 stock movements over 400 days, 3 000 lots, 2 000 batches with 10 000 batch movements, 2 000 payables, 5 000 alerts; `analyze` on those tables. **Time limit:** under `set local statement_timeout = '5s'`, as owner, `dashboard_summary()` answers, with the expected counts for the few rows planted in the current week. **Plan check:** `explain (format json)` of the helper queries, run as the migration owner with the tenant as a literal, mentions `raw_lot_expiry_idx`, `payable_unpaid_due_idx` and `stock_movement_effective_idx`, and has no `Seq Scan` on `stock_movement` for the waste range (T2). This is a regression net, not a latency claim |
| 6 | Guard: what the dashboard must not change | `supabase/tests/database/207_dashboard_preserves.test.sql` | **md5 unchanged** (values written in the test after the rebase) for `public.today_counts`, `app.payable_is_overdue`, `app.use_by_is_pending` (as merged by PR B), `app.plate_cost_rows`, `public.plate_costs`, `public.plate_margins_pct`, `public.fixed_cost_status`, `public.waste_costs`, `public.raw_waste_costs`, `public.payable_list`, `public.batch_list`, `public.stock_lots`, `app.usable_on_hand`, `app.payable_reminder_rule` and `app.expiry_rule`. **No new table:** the list of `public` tables equals the list on `main`, so `app.demo_purge_tables()` needs nothing. **No new kind or check:** the `app.alert_kind` row count and both `audit_event` check definitions are unchanged. **059:** the list of cost-named public functions is unchanged (`dashboard_summary` is not cost-named). PR grep (in the PR body): `grep -lE "create or replace function (public\.(today_counts\|waste_costs\|plate_costs\|payable_list)\|app\.plate_cost_rows)" supabase/migrations/20261108*` returns nothing |
| 7 | Dashboard domain in TS (SQL schemas, output schemas, rendering, constants, parity); extract `buildTodaySummary` | `src/server/dashboard/{constants,sql-schema,output,render}.ts`, `src/server/today/summary.ts` (pure builder extracted; behaviour unchanged), `tests/server/dashboard/{sql-schema,output,render}.test.ts`, `tests/server/dashboard/__snapshots__/*`, `tests/server/today/build-today.test.ts`, `tests/parity/dashboard-sql-parity.test.ts` | **`sql-schema.test.ts`:** the fixture owner JSON parses; the admin JSON parses with the admin schema; an admin document with `fixedCosts` (or any extra key) **fails**; an owner document missing `names` fails. **`output.test.ts`:** `z.toJSONSchema` of `ownerDashboardSchema` and `adminDashboardSchema` each `toMatchSnapshot()`; a walk of the admin schema finds no property matching `/fixed\|rent\|labour\|utilit\|perPlate/i`. **`render.test.ts`:** a `purchase_due` row plus `names` gives the same `AlertItem` as `toAlertItem(row, "it", loadedNamesFromMaps)` (the title names the ingredient and the supplier, `href` is `/riordino/ingredienti`, `acknowledged.byName` is null); an unknown kind is dropped and reported; row hrefs: payable → `/pagamenti/<id>`, lot → `/magazzino/<ingredientId>`, batch → `/produzione/<batchId>`. **`build-today.test.ts`:** owner counts plus an alerts card → the alerts card first (PR B order); admin → no alerts card; the existing `tests/app/api/today/today.test.ts` passes unchanged. **Parity:** `DASHBOARD_WORST_PLATES` 5, `DASHBOARD_LIST_CAP` 5, `DUE_SOON_DAYS` 7 and `DASHBOARD_ALERT_CAP` = `TODAY_ALERT_CAP` = 50, each equal to its SQL constant (read from the migration text) |
| 8 | Service and route `GET /api/dashboard`, with `Server-Timing` | `src/server/dashboard/summary.ts`, `src/app/api/dashboard/route.ts`, `tests/app/api/dashboard.test.ts` | With a fake session client. **Calls:** owner and admin make **exactly one** `rpc("dashboard_summary")` and no `from()` call (one round trip); chef and waiter → 403 **before any RPC**; no session → 401; `?x=1` → 400 without an RPC. **Errors:** RPC 42501 → 403; any other error → 500 `dashboard_unavailable`, with no SQL text in the body; a malformed SQL document (an extra admin key) → 500. **Output:** an injected `unit_cost` key in a plate row of the fake reply is **dropped** from the JSON; the owner reply validates against `ownerDashboardSchema` and the admin reply against `adminDashboardSchema`. **Headers:** `Cache-Control: no-store`; `Server-Timing` has `auth`, `rpc` and `total`, each with a numeric `dur` (fake clock) |
| 9 | Chart geometry and tokens | `src/lib/charts/scale.ts`, `src/lib/design/tokens.ts` (`CONTRAST_PAIRS` += `danger`/`surface` and `ink`/`sunk` as boundary pairs), `src/app/globals.css` (forced-colors block), `tests/lib/charts/scale.test.ts`, `tests/lib/design/tokens.test.ts` (extended) | **Geometry:** `barPct(60, 100)` 60; `(150, 100)` 100; `(-5, 100)` 0; `(null, 100)` 0; `(3, 0)` 0; `(1, 3)` 33.3; `tickPct(70)` 70; `tickPct(null)` null. **Tokens:** the new pairs are ≥ 3:1 in both themes; CSS and `tokens.ts` stay in sync; the `@media (forced-colors: active)` block exists and names `CanvasText` |
| 10 | SVG chart components | `src/components/charts/{bar-table,meter}.tsx`, `tests/components/charts.test.ts` | `renderToStaticMarkup` with fixture rows. **`BarTable` structure:** a `<table>` with a `<caption>`; one `th scope="row"` per row; the value text in the row. **SVG:** every `<svg>` has `aria-hidden="true"` and `focusable="false"`; the value `rect` has `width="60"` for 60 % and the class `fill-accent`; a below-target row uses `fill-danger`; a target `line` at `x1="70"` appears only when a target exists. **Forbidden content:** no `style=` attribute, `<image`, `<foreignObject`, `data:`, `<i class` or palette class (`/(red\|green\|gray)-\d{3}/`) anywhere in the markup; a `<script>` plate name renders as text. **`Meter`:** an aria-hidden svg and the visible figure "28,28 %", matched with `/28,28\s+%/` (lesson: U+00A0) |
| 11 | Tiles and view helpers | `src/components/dashboard/{tile,today-lists-tile,plates-tile,food-cost-tile,payables-tile,stock-risk-tile,waste-tile,price-variance-tile,fixed-costs-tile,coming-soon-tile}.tsx`, `src/lib/dashboard/dashboard-view.ts`, i18n `it`/`en`, `tests/lib/dashboard/dashboard-view.test.ts`, `tests/components/dashboard-tiles.test.ts` | **View helpers:** `formatEur(1234.5)` matches `/^1\.234,50\s+€$/`; `formatPct(28.28)` matches `/^28,28\s+%$/`; `dueWords(-5, true)` "Scaduta da 5 giorni", `(0, false)` "Scade oggi", `(7, false)` "Scade tra 7 giorni"; `weekLabel("2026-11-09","2026-11-15")` "Settimana dal 09/11 al 15/11"; `tileOrder("owner")` and `tileOrder("admin")` equal §3.4's lists exactly; `tileEmpty` picks each empty text of §3.4. **Tiles** (`renderToStaticMarkup`, fixture props): each `section` has `data-tile`, an `h2` that labels it, and **exactly one** link to its detail screen, with `linkClass` (`min-h-tap`). **Every empty state of §3.4** renders its exact text, one case per tile: ten cases, including both plate cases and the unvalued-only waste case, which contains no "0,00". **Content:** the plates tile lists rows by `data-recipe-key` and shows "Costo incompleto" with P7 and no percentage for it; the coming-soon tile contains **no digit** (`/\d/` fails) and no `<a`; the stock tile contains no "€"; the fixed-costs tile renders "3.000,00 €" (matched with `\s+`) |
| 12 | Oggi as the dashboard for owner and admin; docs | `src/app/(owner)/page.tsx`, `src/components/use-dashboard.ts`, `docs/design/ui-foundation.md` (§8 "Owner dashboard (built)"), `tests/components/home-dashboard.test.ts`, `tests/components/use-dashboard.test.ts` | jsdom, `fetch` mocked. **Owner:** one request to `/api/dashboard` and **none** to `/api/today`; PR B's to-do block renders from `today` ("Fatture da rivedere · 2"), then `data-testid="dashboard-tiles"` with the owner's tiles in order; the page wrapper has `data-layout="wide"`. **Admin:** no "Da fare oggi", "Aumenti di prezzo" or "Costi fissi" tile. **Chef:** one request to `/api/today`, none to `/api/dashboard`, no tiles, no "€" in the markup. **Errors:** API 500 → one `ErrorAlert` "Il cruscotto non è disponibile.", and the static actions are still present; "Riprova" fetches again. **`use-dashboard`:** refetches on focus no more than once per `DASHBOARD_REFRESH_MS` (fake timers); no fetch while `document.hidden` |
| 13 | Real-stack integration | `tests/integration/dashboard.int.ts`, `tests/integration/helpers/dashboard.ts` (seeds tenant A through the existing APIs and helpers: two locations, two suppliers, invoices approved through `approve_invoice`, recipes, batches, waste, rules; `alert_rules_run` once; fixed costs through `enter_fixed_costs`; a second tenant) | **Owner:** `GET /api/dashboard` → 200 and validates `ownerDashboardSchema`; the figures equal the values the helper computed by hand for its seed (payables overdue count and amount, expiring batches, the week's waste, `overallPct`). **Admin:** 200, `adminDashboardSchema`, and `Object.keys(body.tiles)` has no `fixedCosts`, `priceVariance` or `todayLists`. **Refused:** chef → 403; waiter (PIN) → 403. **Coexistence:** the owner's `body.today` deep-equals `GET /api/today`'s body for the same owner, and the same for the admin; the alerts card count equals the number of rows `GET /api/alerts?filter=open` returns (up to the cap). **Tenancy:** owner B sees none of A's payable ids. The secret key is used only to create staff; no `recipe*` read uses it |
| 14 | Playwright at 360 and 1280 | `e2e/dashboard.spec.ts`, `e2e/helpers/seed-dashboard.ts` (reuses step 13's helper over HTTP) | **Owner at 360 × 740 (project `phone`):** `signInWithMagicLink(page, ownerEmail, "/")`; the to-do block, then the tiles; each tile found by `data-tile`, never by position; "Margini dei piatti" lists the seeded plates by `data-recipe-key`, with the below-target `Badge` word; `expectPhoneFriendly(page)` (one pass) in light and in dark (`page.emulateMedia({ colorScheme: "dark" })`); every tile link has a box height ≥ 44, measured in one `page.evaluate` because `expectPhoneFriendly` does not measure `main a`; "Apri pagamenti" lands on `/pagamenti`. **Admin:** no "Costi fissi" tile. **Chef** (signed in by PIN, not with `signInWithMagicLink`): on `/`, PR B's action list shows, `[data-testid=dashboard-tiles]` has count 0, and `body` contains no "€"; `page.request.get("/api/dashboard")` → 403. **1280 × 800** (`page.setViewportSize`): the tiles container computes to 2 or 3 grid columns (`getComputedStyle(...).gridTemplateColumns` has ≥ 2 tracks); `main` is wider than 448 px; the sidebar is visible. **Empty tenant** (a fresh owner): each tile shows its empty text from §3.4, and the coming-soon tile shows no digit |
| 15 | p95 measurement script (reports; never fails on a number) | `scripts/perf/dashboard.ts`, `scripts/lib/perf-dashboard.ts` (imports `nearestRank`, `summarize`, `parseServerTiming` and `assertTarget` from `scripts/lib/perf-order-entry.ts`), `tests/scripts/perf-dashboard.test.ts`, `package.json` (`"perf:dashboard"`) | Fakes, no network. **Target guard:** by default it accepts only `http://127.0.0.1` or `localhost` (staging only under V5), and refuses any other host before a request. **Run:** signs in a fake owner of the demo tenant created by `npm run demo`, then makes 100 sequential `GET /api/dashboard`. **Report:** p50, p95 and max of the wall time and of `auth`, `rpc` and `total`, plus the sentence "Misurato in locale sui dati di prova, non da un telefono in 4G". Exit code 0 whatever the numbers; no email, token or key in the output |

**Acceptance tests → proof**

| AT (this plan; the M22 ATs it advances in brackets) | Files (step) | Command |
|---|---|---|
| AT1 Every metric on the owner dashboard equals the hand-computed fixture: food cost %, worst five (including ties and the null-target rule), the incomplete list, price variance, payables overdue and due within 7 days, below minimum, expiring lots, expiring batches, waste of the ISO week, open alerts, today's prep and purchase lists, fixed-cost status [M22 AT1, partly] | `200`, `201` (1–2), `203` (4), integration (13), e2e (14) | `npx supabase test db`; `npm run test:integration`; `npx playwright test` |
| AT2 The admin lands on the same dashboard, with no fixed-cost key and no fixed-cost tile (Q107) | `204` (4), `sql-schema` and `output` tests (7), route test (8), `home-dashboard.test.ts` (12), integration (13), e2e (14) | as AT1, plus `npm test` |
| AT3 Chef and waiter get 403 (42501 in SQL); the chef's Oggi has no dashboard and no "€" [M22 AT8, for this endpoint] | `204` (4), route test (8), `home-dashboard.test.ts` (12), integration (13), e2e (14) | as AT2 |
| AT4 Two tenants never see each other's figures | `201`, `204` (2, 4), integration (13) | `npx supabase test db`; `npm run test:integration` |
| AT5 One round trip: one RPC per request; the owner's and admin's Oggi make one data request; `today` equals `/api/today` | route test (8), `home-dashboard.test.ts` (12), `205` (4), integration (13) | `npm test`; `npx supabase test db`; `npm run test:integration` |
| AT6 Phone first: 360 px, 44 px targets, no sideways scroll, light and dark; a laptop grid at 1280 | `dashboard-tiles.test.ts` (11), e2e (14) | `npx playwright test e2e/dashboard.spec.ts` |
| AT7 Charts: inline SVG drawn from data, aria-hidden, with a table or text alternative; tokens in both themes; forced colours; no image, icon font, inline style or library | `scale.test.ts`, `tokens.test.ts` (9), `charts.test.ts` (10), the e2e dark run (14); ADR-021 | `npm test`; `npx playwright test` |
| AT8 An empty state for every tile | `dashboard-view.test.ts`, `dashboard-tiles.test.ts` (11), the e2e empty tenant (14) | `npm test`; `npx playwright test` |
| AT9 Sales and covers are labelled placeholders with no number | `203` (`comingSoon`) (4), `dashboard-tiles.test.ts` (11), e2e (14) | as AT1 |
| AT10 Performance: a query-plan check on demo-shaped data, and a p95 report, with no number promised [M22 AT7, the 4G page-load gate, stays with M22/M25] | `206` (5), `perf-dashboard.test.ts` (15), the local run's report in the PR | `npx supabase test db`; `npm run perf:dashboard` (run by DigiAlto on the local stack after `npm run demo`) |
| Invariants: no new table, nothing deleted, procedures unchanged, roles in Postgres, no data logic in React, the secret key not in `src/` | `207` (6), components (10–12), the existing `tests/lint/admin-client-import.test.ts` | `npx supabase test db`; `npm test`; `npm run lint` |

**Performance: the target and how it is measured (no number is promised).**
- **Target:** the PRD NFR "dashboard under 2 s on a phone over 4G". It is gated at M25, with the M22 page-load test (project plan §5a M22 AT7), which needs a preview deploy and network throttling.
- **What this plan measures is what it controls:**
  - one RPC per load (route test, step 8);
  - index use on demo-shaped history (`206`);
  - the server-side p95 of `GET /api/dashboard`, from `scripts/perf/dashboard.ts`:
    - on the local stack seeded with `npm run demo`, 100 sequential requests;
    - the nearest-rank p95 of the wall time and of each `Server-Timing` part;
    - DigiAlto pastes the report into the PR. It is not a phone on 4G, and the report says so.
- Runs on staging need V5 (Q116).

**CI implications:**
- pgTAP `200`–`207` run in the `supabase` job and in `scripts/test-db-native.sh`. `206` adds a few seconds to the job (fixture generation with `generate_series`).
- New Vitest snapshots.
- No new CI workflow or secret (V5 adds one workflow).
- Coverage ≥ 80 % on new TS.

### 5b. Variants

**V1: Food cost overall as the mean of the plates' percentages** · Trigger: Q111 answered "the average of the plates' food cost %" · Replaces steps: the `overallPct` formula of 1, and its expected value in 1, 4 (`203`) and 13

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V1.1 | `overallPct` = `avg(food_cost_pct)` over complete active plates, rounded to 2; the hint becomes "Media semplice dei piatti attivi" | `supabase/migrations/20261108100400_dashboard_food_cost_mean.sql`, `200`, `203`, `src/lib/i18n/messages/{it,en}.ts`, `tests/lib/dashboard/dashboard-view.test.ts` | On the fixture: (40 + 30 + 40 + 20 + 25 + 20) ÷ 6 = **29.17**; all plates incomplete → null; the view test reads the new hint |

**V2: Plates without a GP target are not ranked** · Trigger: Q112 answered "leave out plates that have no target" · Replaces steps: the null-target ordering case of 1 and the "P5 last" case

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V2.1 | `worst` only from plates with a target; plates without one are listed under "Senza obiettivo" (names, first 5, a count) | `supabase/migrations/20261108100500_dashboard_no_target.sql`, `200`, `203`, `src/server/dashboard/{sql-schema,output}.ts`, `src/components/dashboard/plates-tile.tsx`, `tests/components/dashboard-tiles.test.ts` | With P2 deactivated, `worst` = [P1, P4, P3, P6] and P5 is in `noTarget`; the tile shows "Senza obiettivo: Tiramisù (fixture)"; the snapshots are updated on purpose |

**V3: Today's prep and purchase lists show only what is not yet seen** · Trigger: Q113 answered "hide what I have already marked as seen" · Replaces steps: the "acknowledged stays, flagged" cases of 2 and 11

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V3.1 | `todayLists` filters on `acknowledged_at is null`; the "Visto" badge is removed | `supabase/migrations/20261108100600_dashboard_today_open.sql`, `201`, `203`, `src/components/dashboard/today-lists-tile.tsx`, `tests/components/dashboard-tiles.test.ts` | `prep` has 2 rows (the acknowledged one absent) and `prepCount` 2; no "Visto" in the markup |

**V4: Count dashboard opens now** · Trigger: Q114 answered "start counting opens before M22" · Replaces steps: none (adds after 12)

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V4.1 | Table `dashboard_open (id, tenant_id, app_user_id, iso_week date, opens integer, …)`: `tenant_id` and RLS (the owner reads their own tenant; no API write); written only through `public.record_dashboard_open()` (owner, admin; one row per user and ISO week, upserted). **Added to `app.demo_purge_tables()`** in the same migration; one fixture row in `004` and `059` | `supabase/migrations/20261108100700_dashboard_opens.sql`, `supabase/tests/database/208_dashboard_opens.test.sql`, `004`, `059`, `194` | `208`: two calls in one week → one row with `opens` 2; another week → a second row; chef → 42501; tenant B sees 0 rows. `194` (purge completeness) and `001` (RLS on every table) stay green; `purge_demo_data` removes the rows |
| V4.2 | `GET /api/dashboard` calls `record_dashboard_open()` after a successful read. A failure is logged by code and never fails the page | `src/server/dashboard/summary.ts`, `tests/app/api/dashboard.test.ts` | The second RPC is made only on success; its error does not change the 200; the data still comes from one RPC |

**V5: Measure p95 on staging too** · Trigger: Q116 answered "run it on staging" · Replaces steps: the local-only target guard of 15

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V5.1 | `--target staging` requires `DASHBOARD_PERF_STAGING_OK=yes` and the exact staging host (as `scripts/lib/demo/target.ts` does). A manual workflow `.github/workflows/perf-dashboard.yml` (`workflow_dispatch` on `main`, environment `staging`, secrets only in the run step, `persist-credentials: false`) runs it against the staging demo tenant | `scripts/lib/perf-dashboard.ts`, `.github/workflows/perf-dashboard.yml`, `tests/scripts/perf-dashboard.test.ts`, `tests/config/perf-workflow.test.ts` (extended) | Without the flag, the staging URL is refused before any request; a wrong host is refused. The workflow test checks `workflow_dispatch` only, `if: github.ref == 'refs/heads/main'`, `environment: staging`, and no secret outside the run step |

## 6. Risks and mitigations

- **Security and privacy**
  - *A definer function bypasses RLS.* Mitigations (steps 1–4, `204`):
    - the role check comes first;
    - the tenant comes from `app.tenant_id()`, and every query filters by it explicitly;
    - an empty `search_path`;
    - the helpers are closed to API roles;
    - there are no parameters.

    The two-tenant uuid scan in `204` is the leak test.
  - *`today_counts()` called inside a definer (T1):*
    - it filters by tenant itself;
    - `205` proves it equals a direct call, for two tenants and both roles;
    - `207` pins its md5, so a future edit that drops a filter is caught at review.
  - *Fixed costs reaching the admin:*
    - the SQL never adds the key for the admin (`204`);
    - the strict admin SQL schema rejects it (7, 8);
    - the plate rows exclude fixed costs for everyone (1).
  - *€ reaching the chef or the waiter:* 403 before any RPC (8), 42501 in SQL (`204`), and the chef's page never calls the endpoint (12, 14).
  - *Alert names:* `names` is owner-only and tenant-filtered; a foreign id in a payload resolves to nothing (`201`).
  - *Supplier names may be personal data* (sole traders, project Q13). The owner and admin already see them on `/pagamenti`, and nothing new leaves Supabase. Logs carry codes only.
  - *Input:* the endpoint takes none; a query string is a 400.
- **Correctness**
  - *Numbers that disagree with the detail screens.* Each part reuses the predicate or the function of the screen it links to (decisions 7–9). `205` and the integration suite compare them.
  - *The "overall" food cost misread as the PRD KPI.* The label and hint say "media del menu, non pesata sulle vendite" (decision 4), and M22 replaces the figure.
  - *PR B changes before it merges.* This branch is stacked on it and re-checked after the rebase (§2.2); `207` pins PR B's functions as merged.
  - *DST and the ISO week.* The week comes from the venue date in the tenant's zone; `201` covers both 2026 clock changes.
- **Unverified (proved in the named step)**
  - **T1:** a SECURITY INVOKER function called from a SECURITY DEFINER one runs with the definer's privileges (PostgreSQL docs, <https://www.postgresql.org/docs/current/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY>). Its result equals a direct call because `today_counts` filters by tenant explicitly. Proved by `205`.
  - **T2:** with `analyze`d history at the size of `206`, the planner uses the new indexes for the week's waste and the expiring lots, and the waste range does not seq-scan `stock_movement`.
    - If it does not, the step stops and the architect revisits the index shape before step 6.
    - No number is changed to make the test pass.
  - **T3:** Tailwind v4 generates `fill-*` and `stroke-*` utilities from the theme colour variables (<https://tailwindcss.com/docs/fill>, <https://tailwindcss.com/docs/stroke>). Proved by the class assertions of step 10 and the dark e2e run of step 14.
- **Performance and cost**
  - One RPC per load. The heaviest parts are:
    - the recursive plate costs (M8, already guarded by `062`);
    - `usable_on_hand` over the whole ledger, which grows with history.

    `206` is the regression net.
  - The new indexes add a little cost to ledger writes (two per stock or batch movement). They are small and start with `tenant_id`.
  - A plain `create index` holds a write lock while it builds. Before go-live the tables are small. On a real tenant with a large ledger, the index migration would be rerun as `create index concurrently` outside a transaction (runbook note in the PR).
  - No latency figure is promised (§5). No provider or running cost.
- **Dependencies:** none added. ADR-021 rejects chart libraries. `@testing-library/react`, `jsdom` and Playwright are already used.
- **Plan changes to record in DigiAlto-Ops `clients/osteria-dei-rossi/context.md`:**
  - the owner's and the admin's Oggi is the dashboard (Q106, Q107); the chef keeps the action list (Q108);
  - M22's dashboard is partly built. The sales KPIs, `v_daily_kpi`, AVT, exports and the opens count stay in M22;
  - `GET /api/dashboard` joins project plan §3.3 (reports group), for owner and admin only.

## 7. Open questions for the founder

**Answered on 2026-10-28 (recorded and applied in this plan):**
- **Q106 Where does the dashboard live?** The owner's Oggi becomes the dashboard: to-dos at the top (UX PR B's block), tiles below. No "Cruscotto" section. PR B merges first.
- **Q107 What does the admin see?** The same dashboard, without fixed-cost keys or tiles. DigiAlto decided this on the founder's behalf. pgTAP `204` proves the omission.
- **Q108 Does the chef get a dashboard?** No. The chef keeps the action-list Oggi.
- **Q109 Which week for waste €?** The current ISO week, Monday to Sunday, Europe/Rome.
- **Q110 How are the worst five plates chosen?** By how far GP % is below the target. Plates with an incomplete cost are listed separately ("costo incompleto") and not ranked.

**Still open (defaults in force for this build):**
- **Q111 "Food cost % overall" before there are sales.**
  - **Default:** the total food cost of the active plates ÷ their total price without VAT, each plate counted once, labelled "media del menu, non pesata sulle vendite". It is replaced by the sales-weighted figure after go-live (M22).
  - **Alternative:** the simple average of the plates' food cost % (→ V1).
- **Q112 Plates that have no GP target.**
  - **Default:** ranked after the plates that have a target, lowest GP % first.
  - **Alternative:** left out of the ranking and listed as "Senza obiettivo" (→ V2).
- **Q113 Today's prep and purchase list: should items you have already marked "Ho visto" stay?**
  - **Default:** yes, with a "Visto" badge (seen is not done).
  - **Alternative:** hide them (→ V3).
- **Q114 Should we start counting dashboard opens now?** This is the PRD success metric "5+ per week", planned in M22.
  - **Default:** no, it waits for M22.
  - **Alternative:** count from now on (→ V4: one small table, removed by the demo purge).
- **Q115 "Due soon" for payables.**
  - **Default:** due within the next 7 days, the same window as the payment reminders.
  - A different number is a constant change (`DUE_SOON_DAYS` and its SQL twin, with the parity test), not a variant.
- **Q116 Where is the dashboard's speed measured?**
  - **Default:** DigiAlto runs the measurement on a local copy with the demo data and pastes the report into the PR. No GitHub minutes are spent (demo plan Q95).
  - **Alternative:** also on staging, with your approval of the `staging` environment (→ V5).
  - Either way, the report states the numbers and promises none. The "under 2 seconds on a phone over 4G" check stays at the go-live gate.

**Assumptions (a different answer means a re-plan, not a variant):**
- **A1:** "Stock at risk" means quantities only. The € value at risk belongs to the M23 push list.
- **A2:** the admin reads no alerts, as the API and RLS do today. If UX plan Q4 is answered "the admin reads alerts", the admin's dashboard gains the alert tiles in that change.
- **A3:** "Disponibile dopo l'avvio di comande e conti" is acceptable Italian for "available after go-live of orders/bills".

**Technical, resolved inside the build:** T1–T3 (§6).

## 8. Manual steps for the founder

- None are needed to build, test or merge. PR B must merge first.
- After the merge, answer Q111–Q116 when convenient. Each different answer triggers its variant as a follow-up PR.

## 9. Sources

- Worktree `/home/user/osteria-dash`:
  - the migrations and TS in §2.1;
  - `docs/prd.md`; `docs/plans/2026-10-21-project-plan.md`; `docs/plans/2026-10-24-m18-order-entry.md`; `docs/plans/2026-10-24-demo-data.md`; `docs/plans/2026-10-28-ux-flows.md`;
  - ADR-020; `docs/design/ui-foundation.md`;
  - `e2e/helpers/session.ts`; `scripts/lib/perf-order-entry.ts`.
- Worktree `/home/user/osteria-ux1` (`feat/ux-p1-flows`): `supabase/migrations/20261107100000_today_counts.sql`, `src/server/today/*`, `src/app/api/today/route.ts`, `src/app/(owner)/page.tsx`.
- Worktree `/home/user/osteria-m19` (`feat/m19-firing`): migration and pgTAP numbering, ADR-019.
- PostgreSQL `CREATE FUNCTION`, security: <https://www.postgresql.org/docs/current/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY> (T1).
- PostgreSQL partial indexes: <https://www.postgresql.org/docs/current/indexes-partial.html> (the decision on the waste indexes).
- Tailwind CSS fill and stroke utilities: <https://tailwindcss.com/docs/fill>, <https://tailwindcss.com/docs/stroke> (T3).
- MDN `forced-colors`: <https://developer.mozilla.org/en-US/docs/Web/CSS/@media/forced-colors>.
- Zod 4 JSON Schema: <https://zod.dev/json-schema>.
