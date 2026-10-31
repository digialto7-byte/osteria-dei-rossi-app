# Tech plan — Osteria Digitalization · M23 Push list, push-today, MVP forecast, discards vs push

- **Client slug / internal:** `osteria-dei-rossi`.
  - Approved client facts in `docs/client-facts.md`: trading name, brand colours and fonts. **M23 uses none of them** beyond the existing tokens.
  - **No client figure is used.** Every limit that would be a client fact (the price limits of a push, how long a push lasts, how far ahead the list looks, how the forecast averages) is an open question with a default (§7). Each default is either a PRD rule, an existing setting (the cut-off), or a named constant that a variant changes.
  - **The drafts in `docs/client/` are not used.** Fixtures follow the M22 conventions: tenants "Osteria Demo A/B/C"; users "Titolare Demo", "Admin Demo", "Chef Demo", "Cameriere Demo". The dish names "Spezzatino" (batch) and "Spezzatino con polenta" (plate) come from the PRD's own example line (4.1) and the M7 stew fixture. "Ragù (demo)" (batch), "Tagliatelle al ragù (demo)" (plate), "Manzo (demo)" and "Parmigiano (demo)" (ingredients) are fake. Every number is a fake fixture value.
- **Repo and branch:** `osteria-dei-rossi-app`, worktree `/home/user/osteria-m23`, branch `feat/m23-push-forecast`, from the M22 branch head `4f77afb`. That head contains `main` `b5f528c` (M0–M21, M19b) plus M22 (PR #41, not merged).
  - **M22 is assumed to merge first.** M23 calls M22 objects (`app.kpi_sales_lines`, `app.kpi_session_rows`, `app.kpi_cutoff_end`, `app.dashboard_summary_at`) and cannot merge before it. If M22 changes in review, this branch is rebased on `main` after it merges.
- **Numbering:**
  - migrations `20261114100000`–`20261114100600`, with `…100700`–`…100900` kept for review fixes and `20261115100000`+ for variants. M22's plan reserves `20261113100000`–`…100500` for its variants V1–V6, so M23 starts on the next day. All sort after the latest pending migration (`20261112100800`);
  - pgTAP `248`–`256` (M22 owns `231`–`241` and reserves `242`–`247` for its variants; M23 variants use `257`+);
  - ADR-026 (`docs/adr/adr-026-push-state-and-history.md`, proposed);
  - questions from **Q156** (M22 ended at Q155); variants V1–V7 belong to this plan ("project V6" names the project plan's chef variant, in force);
  - e2e `e2e/push-forecast.spec.ts`.
- **Shared check constraints:** no audit entity type, audit action, alert kind or `job_run` job is added. `tests/config/check-constraint-union.test.ts` is unaffected. The one new check list (`menu_push.action`) belongs to the new table.
- **Author:** architect · **Date:** 2026-10-31
- **Sources:**
  - `docs/prd.md`:
    - Goal 4 ("a daily push list of plates near end of shelf life");
    - 2.4 expiry alert ("feeds the push list");
    - 3.2 "Push suggestions";
    - 4.1 bullets 1–2 (bullet 3 is Phase 2, M38);
    - 4.4 MVP bullet;
    - Module 4 acceptance ("the push list only shows items with remaining quantity above zero");
    - Risk "Shelf life values set wrong";
    - Gate 4 ("owner uses the push list … without prompting").
  - Project plan:
    - §3.3: the menu/tables row (`POST /api/menu/:id/push`) and the reports row (`push-list`, `forecast`, `discards-vs-push`; the chef may read push-list and forecast);
    - §3.5.1 (`menu_item` push fields), §3.6, §3.11.2 (role matrix), §5b project V6 (in force);
    - §5 row M23 and §5a M23 (AT1–AT7); Appendix A rows 2.4, 3.2, 4.1, 4.4.
  - Earlier plans and ADRs:
    - the M22 plan and ADR-025 (`kpi_sales_lines`, `kpi_session_rows`, `kpi_cutoff_end`, `dashboard_summary_at`, the `comingSoon` `pushList` slot, the fixed-instant twin rule);
    - the owner dashboard plan and ADR-021;
    - M15 (discard movements), M16 (expiry rule);
    - M17/ADR-016 (menu, `menu_item.push_*`), M18/ADR-017 (pinned items, frozen push price);
    - M19/ADR-019 (batch depletion), M21/ADR-023 (business date of a sale).
  - The merged SQL and TS listed in §2. **Where merged code and a plan differ, the code wins.**

> **Flags for the founder (read first)**
> - **Oggi gets a "Da spingere oggi" tile at the top.** It lists the dishes and ingredients whose use-by is within a day, soonest first. Each line gives the portions or quantity left, the cost at risk and the plates that use them. Example: "Spezzatino, prodotto lun, da consumare entro mer 20:00, 14 porzioni, 38,00 € a rischio → spingi Spezzatino con polenta". A new screen, "Da spingere", shows the whole list. The chef sees it too, without euro figures.
> - **One tap pushes a plate until the end of today's service** (your cut-off, 02:00 by default). Waiters see it first on their menu with a star. You may give it a temporary price; **by default it must be lower than or equal to the menu price**. A push never changes your menu prices or their history (Q156, Q157).
> - **Only you and the admin can push by default** (Q158).
> - **The list uses the same "within a day" window as the PRD's expiry alert.** Stock already past its use-by is never offered as a push. It shows as a count "da scartare" with a link (Q159, Q160).
> - **The forecast is the average of the same weekday over the last four weeks**, on the Produzione screen: "Di solito il giovedì escono 22 porzioni di Spezzatino; ne hai 14". **Weeks when you were closed are left out of the average** (Q162). The chef sees portions and plates, not covers, because covers are a KPI only you and the admin see (Q163).
> - **A weekly "Scarti e spinte" view in Report** lists, per batch recipe, how many batches were thrown away and how many of those had been pushed. Raw ingredients are not in it (Q165).
> - **No new provider, dependency, secret, scheduled job or paid service.**
> - Q156–Q168 have **defaults in force for this build**. They go in the PR body.

## 1. Goal and scope

- **Goal:** each morning the owner sees what is about to expire, what it is worth, and which plates use it. One tap pins a plate on the waiters' menu, at a temporary price if wanted. The chef sees, next to today's portions, what the same weekday usually sells. Every week the owner sees whether discarded batches had been pushed, to spot shelf lives set wrong.
- **In scope**
  - **Push state and history (ADR-026):**
    - `public.menu_push`, an append-only log (one row per start or stop of a push);
    - `public.push_menu_item(p_item, p_body)`: owner and admin; start (with an optional temporary price) or stop. One transaction writes `menu_item.push_until`/`push_price` and the log row;
    - `POST /api/menu/:id/push`.
  - **Push list:** `public.push_list()` and `GET /api/reports/push-list` (owner, admin, chef; the chef's rows carry no euro and no price).
  - **MVP forecast:** `public.forecast(p_date)` and `GET /api/reports/forecast` (owner, admin, chef; the chef's reply has no covers).
  - **Discards vs push:** `public.discards_vs_push(p_week)` and `GET /api/reports/discards-vs-push` (owner, admin).
  - **Dashboard:** `dashboard_summary` gains `pushList`; `comingSoon` becomes `[]` (the M22 slot is filled).
  - **Screens:** the "Da spingere oggi" tile on Oggi; `/spingere` (list + push sheet); the forecast panel on `/produzione`; the "Scarti e spinte" view in `/report`.
  - **Tests:** pgTAP `248`–`256`, one race case, Vitest, an integration suite, Playwright.
- **Out of scope**
  - push sell-through (M38, PRD 4.1 Phase 2 bullet);
  - the demand model, prep list and order guide (M32, M33);
  - any change to the waiter menu, `add_order_line`, firing, voids, closing or the KPI rollup. The waiter menu already pins pushed items with their push price (M18 AT4); M23 only gives it a writer;
  - the label and QR flow (M28, M30);
  - raw-ingredient waste in the discards report (Q165 → V7);
  - a scheduled job that "ends" pushes: the end is an instant, and every reader already compares it with `now()` (M18).

## 2. Current state (M22 head `4f77afb`)

### 2.1 Reused as they are

| Object (file) | State | M23 uses it how |
|---|---|---|
| `menu_item.push_until`, `push_price`, `menu_item_push_ck` (`20261031100000`) | Present; never written by a procedure ("written by M23 only") | The current push state, written by `push_menu_item` |
| `public.menu_list()` (`20261101100200`) | Waiter/owner/admin menu; `pinned` = active items with `push_until > now`; `pushed`, `pushPrice` per item; no cost key (pgTAP `153`, `162`) | Unchanged. AT4 and AT6 are proved through it |
| `public.add_order_line` (`20261101100300`) | Freezes `unit_price` = `push_price` while pushed (`price_source = 'push'`), else the menu price in force | Unchanged. The temporary price reaches the bill through it |
| `app.menu_items_json`, `app.menu_keys_ok`, `app.menu_price`, `app.require_menu_writer` (owner, admin), `app.menu_item_price_at` (`20261031100100`, `…100200`) | Owner item shape (includes `pushUntil`, `pushPrice`); key and price parsing; the menu price in force | The reply and parsing of `push_menu_item`; the price limit of Q156 |
| `app.plate_batch_needs(tenant, keys)` (`20261101100100`) | Batch keys (portions per plate) of the **current** version of each plate key | Push-list "plates that use them"; the batch-key snapshot of a push |
| `app.plate_raw_needs(tenant, recipe_id)` (`20261106100100`) | Raw needs of one plate version, sub-recipes expanded, batches skipped; raises P0001 `recipe_not_producible` on a broken graph | Plates that use a raw lot's ingredient |
| `app.batch_requirements(tenant, recipe_id, at)` (`20261028100100`) | Raw needs of one batch version (M22 T1) | Batch recipes that use a raw lot's ingredient |
| `app.live_batch_remaining(tenant, keys, at)` (`20261101100600`) | Live portions per batch key (fresh/open, `use_by > at`, negatives as 0) | Forecast "you have N" |
| `public.v_batch_portions`, `app.batch_remaining` | Portions per batch, derived from `batch_movement` | Push list "only quantity > 0" |
| `batch`, `batch_cost.unit_cost_frozen` (`20261028100000`) | `produced_at`, `use_by`, `shelf_life_hours`, `lot_code`, `recipe_key`; frozen cost per portion (null when incomplete). Indexes: `batch_produced_idx`, `batch_recipe_idx`, `batch_live_idx (tenant_id, recipe_key, use_by)`; **none on `(tenant_id, use_by)`** | Push-list rows and cost at risk; discards € |
| `raw_lot` (`expiry date`, `received_on`, `lot_code`; `raw_lot_expiry_idx`), `stock_movement` receipt rows with `unit_cost` (`20261022140100`, `20261022140500`, `20261108100200`) | Lot balance = Σ movements of the lot | Push-list lot rows; cost at risk = qty × receipt `unit_cost` |
| `app.use_by_state(use_by, now)`, `app.expiry_state(expiry, today)`, `app.local_instant(date, time, tz)` (`20261028100100`, `20261026100400`, `20261025100100`) | The PRD 2.4 "within 1 day" rule: `due_soon` / `expired` / `ok` (`none` for a lot without expiry) | The push-list window (Q159 default) |
| `discard_batch` (`20261029100200`) | One `batch_movement` of type `waste`, `ref_type = 'batch_discard'`, `effective_on` = venue date | "Discarded" in the weekly report. A void after firing writes `ref_type = 'order_void'` (`20261106100300`) and is **not** a discard |
| `public.waste_costs` (`20261029100600`), `batch_movement_effective_idx` (`20261108100200`) | Dates waste by `effective_on` | Same dating in the weekly report |
| `app.kpi_sales_lines`, `app.kpi_session_rows` (`20261112100000`) | Lines and sessions of closed tables by `closed_business_date`, voided lines excluded | Forecast plates and covers |
| `app.kpi_cutoff_end(tenant, date)` (`20261112100100`), `app.business_date` (`20261029100100`) | The end of a business day, DST-safe (M22 §3.4) | `push_until` of "push today" |
| `app.require_day_closer()` (M21) | Owner, admin | The discards report gate, as M22's reports |
| `app.dashboard_summary_at(tenant, role, now)` (`20261112100600`) | The dashboard body; `comingSoon = ["pushList"]` | Replaced in step 6 (verbatim + `pushList`, `comingSoon = []`) |
| `app.demo_purge_tables()` (`20261112100700`) | Delete-ordered list | `menu_push` added before `menu_item_price` (step 1) |
| `src/server/dashboard/*`, `src/components/dashboard/*`, `src/lib/dashboard/dashboard-view.ts`, `src/server/reports/*`, `src/lib/reports/report-view.ts`, `src/app/(owner)/report/*`, `src/app/(owner)/produzione/*`, `src/server/menu/*`, `src/lib/money/{format,parse}.ts`, `src/lib/time/format.ts` (`formatWeekday`, `formatWeekdayTime`), `withApi`, `src/lib/nav/nav-model.ts` | House code | Extended |

### 2.2 Missing

- No writer for the push columns, no push history, no push list, no forecast, no discards report.
- `src/server/menu/schemas.ts` line 13: "the push keys (pushUntil, pushPrice) are unknown keys here: M23 owns them". `PATCH /api/menu/:id` keeps refusing them; M23 adds its own route.

## 3. Design

### 3.1 Decisions

1. **Push state = the existing columns; push history = `menu_push` (ADR-026).** `push_menu_item` is the only writer of both, in one transaction, under the `menu_item` row lock.
   - **Start** `{ "pushed": true, "pushPrice": 12.5 | null }`:
     - the item must exist (P0002 `menu_item_not_found`) and be active (P0001 `menu_item_inactive`);
     - `pushPrice`, when given, follows Q156's default: `> 0`, at most 2 decimals, and `≤` the menu price in force (`app.menu_item_price_at`). Otherwise P0001 `push_price_invalid` or `push_price_above_menu`;
     - `push_until` = `app.push_default_until(tenant, now)` = `app.kpi_cutoff_end(tenant, app.business_date(tenant, now))`: the end of the current business day (Q157);
     - the log row stores `push_until`, `push_price` and `batch_keys` = the batch keys of `app.plate_batch_needs` for the item's `recipe_key` (empty for an unmapped item).
   - **Stop** `{ "pushed": false }`: clears both columns and writes a `stop` row.
   - **Idempotent:** a start identical to the state in force (same price, same `push_until`, still pushed), or a stop of an item that is not pushed, writes nothing and returns the item.
   - **Re-push:** a start while pushed with a different price writes a new start row and replaces the columns.
2. **The push-list window is the PRD expiry window (Q159).**
   - A **batch** is listed when its portions left (`v_batch_portions`) are `> 0` and `app.use_by_state(use_by, now) = 'due_soon'` (use-by after now and within 24 h).
   - A **raw lot** is listed when its balance (Σ `stock_movement.qty` of the lot, every location) is `> 0`, `app.expiry_state(expiry, business_date(now)) = 'due_soon'` (expiring today or tomorrow) **and** its use-by instant is after now.
     - The lot's use-by instant (`useByAt`) is the local midnight that ends its expiry date: `app.local_instant(expiry + 1, '00:00', tz)`.
     - Between that midnight and the cut-off, the lot is already expired: it is counted under `expired`, not listed.
   - **Only quantity > 0** (AT1). A batch at 0 or below and a lot at 0 kg or below are absent. A lot without expiry is never listed.
   - **Expired stock is never a push candidate (Q160).** It is counted (`expired: {batches, lots}`), with links to `/produzione` and `/magazzino`.
   - **Order (AT3):** `hoursToUseBy` ascending, then name `collate "C"`, then id. `hoursToUseBy` = `round(extract(epoch from useByAt − now) / 3600, 1)`, in elapsed seconds, so it is right across DST.
3. **Row content** (PRD 4.1):
   - `kind` (`batch` | `lot`), `id`, `name` (the current version name of the recipe key, or the ingredient name), `lotCode`;
   - `madeOn`: the venue date of `produced_at` for a batch, `received_on` for a lot;
   - `useByAt` (ISO UTC), `expiryDate` (lots only, else null), `hoursToUseBy`;
   - `quantity` and `unit` (`porz` for a batch, the base unit for a lot);
   - **owner and admin only:** `costAtRiskEur` = `round(portions × batch_cost.unit_cost_frozen, 4)` for a batch, `round(qty × receipt unit_cost, 4)` for a lot. Null when the cost is unknown (incomplete batch cost, unpriced receipt). **Unknown is never zero** (M8 rule);
   - `plates`: the active menu items whose plate (current version) uses the batch key (`app.plate_batch_needs`) or the lot's ingredient (`app.plate_raw_needs`). Each is `{menuItemId, name, pushed, pushUntil}`, plus `pushPrice` for owner and admin;
   - `batchRecipes` (lots only; `[]` for a batch): the active batch recipes whose current version needs the ingredient (`app.batch_requirements`), as `{recipeKey, name}`. For beef, which reaches plates only through the stew, this says "used in Spezzatino";
   - a plate or batch recipe whose graph raises P0001 is skipped and counted in `unresolvedRecipes`, so the list never fails because of one broken recipe.
4. **Forecast (PRD 4.4; Q162–Q164).**
   - **Date D:** default today's business date; allowed from today to today + 6 (P0001 `date_out_of_range` otherwise). The reply carries `today` and `tomorrow` (business dates), so the screen never computes a date.
   - **Source dates:** D − 7, D − 14, D − 21, D − 28. All are before today, so each one is a past business date.
   - **Open days:** the source dates with at least one closed table (`kpi_session_rows`). `weeksUsed` = their count (0–4). The divisor is `weeksUsed` (Q162). With `weeksUsed = 0`, every expected value is null ("Non ci sono ancora vendite di questo giorno").
   - **Covers** (owner and admin only, Q163): `round(Σ covers ÷ weeksUsed, 2)`.
   - **Plates per menu item:** `round(Σ qty of mapped lines (kpi_sales_lines) ÷ weeksUsed, 2)`; only items with a value > 0; plates desc, then name.
   - **Portions per batch recipe:** `app.forecast_portion_lines(tenant, dates)` returns, per sold line of a closed table, `qty × recipe_line.qty ÷ recipe_line.yield_factor` for each batch line of **the plate version that was sold** (`order_line_cost.recipe_id`). It uses the same filters as `kpi_sales_lines`. Then `expectedPortions = round(Σ ÷ weeksUsed, 2)`.
   - **On hand:** `onHandPortions` = `app.live_batch_remaining(tenant, keys, now)`. It is "now", even when D is tomorrow (the screen says "ora").
   - **Gap:** `gap = expectedPortions − onHandPortions` (null when expected is null). Rows: active batch keys with expected > 0 or on hand > 0, ordered by gap desc nulls last, then name.
   - **Not snapshotted.** Four business dates are read live; nothing is stored.
5. **Discards vs push (weekly; Q165–Q167).**
   - **Week:** the ISO week of `p_week` (any date in it; default the week of today's business date; a later date → `date_in_future`), as M22's unmapped report.
   - **A discarded batch** has at least one `batch_movement` of type `waste` with `ref_type = 'batch_discard'`, `effective_on` in the week, and no reversal (no row with `reverses_id` = its id). Its portions are the sum of those rows.
   - **Pushed (Q167):** a `start` row of `menu_push` whose `batch_keys` contain the batch's `recipe_key`, and whose effective period `[created_at, effective_end)` overlaps `[batch.produced_at, the batch's first discard in the week)`. `effective_end` = the earlier of `push_until` and the next row of the same item (`lead()`).
   - **Rows per batch recipe key:** `name`, `shelfLifeHours` (current version, so the owner sees what to correct), `batchesDiscarded`, `batchesPushed`, `portionsDiscarded`, `portionsPushed` (portions of the pushed batches), `valueEur` (Σ portions × `unit_cost_frozen`, known costs only), `unvaluedCount`. Ordered by `batchesDiscarded` desc, `portionsDiscarded` desc, name, key.
   - `totals` with the same keys. Owner and admin only (cost-bearing).
6. **Roles (project V6 in force):**
   - push list: owner and admin (all keys); chef (no `costAtRiskEur`, no `pushPrice`, no cost totals); waiter 42501 / 403;
   - forecast: owner and admin (all keys); chef (no `covers`); waiter 42501 / 403;
   - discards vs push: owner and admin; chef and waiter 42501 / 403;
   - push and stop: owner and admin (`app.require_menu_writer`, Q158);
   - `menu_push` SELECT: owner and admin (RLS); no write grant;
   - the waiter menu is unchanged: push marker and push price, no cost or risk key (AT6).
7. **Fixed-instant twins (M22 rule).** Each public function checks the role **first**, then calls an `app.*` twin with `(app.tenant_id(), app.role(), …, now)`:
   - `app.push_menu_item_at(tenant, user, item, body, now)` (it also writes `menu_push.created_at = now`);
   - `app.push_list_json(tenant, role, now)`;
   - `app.forecast_json(tenant, role, date, now)`;
   - `app.discards_vs_push_json(tenant, week, now)`.

   pgTAP calls the twins with a fixed `p_now`. The role argument only shapes the output; it never grants access.
8. **Dashboard.** `app.dashboard_summary_at` gains `pushList: {count, expired: {batches, lots}, items}`. `items` holds the first `app.dashboard_list_cap()` rows of `push_list_json`, with the owner/admin keys (both roles see € on the dashboard). `comingSoon` = `[]`, which the M22 SQL schema already accepts. Still one RPC per load.
9. **No data logic in React.** SQL computes every quantity, hour, sum, average, gap, date, flag and order. `src/lib/push/push-view.ts` and `src/lib/reports/report-view.ts` only format and pick labels.
10. **Personal data.** `menu_push.created_by` is the staff member who pushed (an id, as in every ledger row). No reply carries a staff or guest name. Nothing leaves Supabase (EU). Logs carry codes only.
11. **Implicit defaults, each tested with ≥ 2 candidates:** two tenants; batch vs lot; due soon vs expired vs outside the window; quantity > 0 vs 0 vs negative; known vs unknown cost; owner vs admin vs chef key sets; a push with and without a price; start vs stop vs repeat; a normal night vs both DST nights; four open weeks vs three; a pushed vs a not-pushed discarded batch; a discard in vs out of the week; a batch discard vs a void waste.

### 3.2 Data model and SQL

**Common rules (as M22):** every function is `security definer` with `set search_path = ''`; public functions take the tenant from `app.tenant_id()`; every `app.*` function is revoked from all API roles; every public function gets `revoke all … from public, anon, service_role; grant execute … to authenticated`.

**`20261114100000_menu_push_core.sql`** (step 1)
- `public.menu_push`:
  - `id uuid pk`, `tenant_id uuid not null`, `menu_item_id uuid not null` (FK `(tenant_id, menu_item_id) → menu_item`);
  - `action text not null check (action in ('start', 'stop'))`;
  - `push_until timestamptz`, `push_price numeric(12,2) check (push_price > 0 and push_price <= 10000)`;
  - `batch_keys uuid[] not null default '{}'`;
  - `created_at timestamptz not null default clock_timestamp()`, `created_by uuid not null` (FK `(tenant_id, created_by) → app_user`);
  - `constraint menu_push_shape_ck check ((action = 'start' and push_until is not null) or (action = 'stop' and push_until is null and push_price is null and batch_keys = '{}'))`;
  - indexes `menu_push_item_idx (tenant_id, menu_item_id, created_at, id)` and `menu_push_time_idx (tenant_id, created_at)`;
  - append-only: `app.append_only` on update/delete and `app.append_only_truncate`, both honouring `app.demo_purge_allows`;
  - RLS on; policy `menu_push_select` for owner and admin; `revoke all … from anon, authenticated, service_role; grant select … to authenticated, service_role`.
- `app.menu_push_periods(p_tenant, p_from timestamptz, p_to timestamptz) returns table (menu_item_id, started_at, effective_end, push_price, batch_keys)`: start rows, with `effective_end = least(push_until, lead(created_at) over (partition by menu_item_id order by created_at, id))`, overlapping `[p_from, p_to)`.
- `app.push_default_until(p_tenant, p_at) returns timestamptz` = `app.kpi_cutoff_end(p_tenant, app.business_date(p_tenant, p_at))`.

**`20261114100100_demo_purge_tables_m23.sql`** (step 1; as M22 learned, the list must exist from the moment the table does): `app.demo_purge_tables()` as in `20261112100700`, with `'menu_push'` immediately before `'menu_item_price'` (it points at `menu_item` and `app_user`).

**`20261114100200_push_menu_item.sql`** (step 2)
- `app.push_menu_item_at(p_tenant, p_user, p_item, p_body jsonb, p_now) returns jsonb` (decision 1):
  - keys checked with `app.menu_keys_ok(p_body, array['pushed','pushPrice'], array['pushed'])`;
  - `pushPrice` parsed with `app.menu_price` (2 decimals, range), then the Q156 rules;
  - `pushed = false` with a `pushPrice` → 22023 `invalid_request`;
  - `select … for update` on the item;
  - returns `{item: app.menu_items_json(...)->0, changed: boolean}`.
- `public.push_menu_item(p_item uuid, p_body jsonb) returns jsonb`: `app.require_menu_writer()` first, then the twin with `clock_timestamp()`.

**`20261114100300_push_list.sql`** (step 3)
- `create index batch_use_by_idx on public.batch (tenant_id, use_by)`. No index serves a use-by range across recipe keys today: `batch_live_idx` leads with `recipe_key`, and `dashboard_stock_at_risk` scans the tenant's batches. It is a plain `create index`, as in `20261108100200` (with its runbook note on `concurrently` for a large tenant). Lots use the existing `raw_lot_expiry_idx`.
- `app.require_push_reader()`: owner, admin, chef; 42501 otherwise.
- `app.push_list_window(p_tenant, p_now) returns table (kind, id, name, lot_code, made_on, use_by_at, expiry_date, hours_to_use_by, quantity, unit, unit_cost)` (decision 2). The batch and lot balances are read only for the candidates (use-by in `(now, now + 24 h]`, expiry `≤ today + 1`), as `app.expiry_rule` and `app.dashboard_stock_at_risk` do.
- `app.push_list_expired(p_tenant, p_now) returns table (batches integer, lots integer)`.
- `app.push_item_plates(p_tenant, p_batch_keys uuid[], p_ingredients uuid[])` and `app.push_lot_batch_recipes(p_tenant, p_ingredients uuid[])` (decision 3). Each recipe is resolved in its own `begin … exception when sqlstate 'P0001'` block, which counts `unresolvedRecipes`.
- `app.push_list_json(p_tenant, p_role, p_now) returns jsonb`: `{role, asOf, businessDate, rows, expired: {batches, lots}, unresolvedRecipes, totals: {count, costAtRiskEur?, unvaluedCount?}}`. The cost keys and `pushPrice` exist only when `p_role in ('owner','admin')`.
- `public.push_list() returns jsonb`: `app.require_push_reader()` first.

**`20261114100400_forecast.sql`** (step 4)
- Constants: `app.forecast_weeks()` = 4 (PRD), `app.forecast_days_ahead()` = 6.
- `app.forecast_portion_lines(p_tenant, p_dates date[]) returns table (business_date, batch_key, portions)` (decision 4).
- `app.forecast_json(p_tenant, p_role, p_date, p_now) returns jsonb`: `{role, date, today, tomorrow, weekday, sourceDates, weeksUsed, covers?: {expected}, batches: [{recipeKey, name, expectedPortions, onHandPortions, gap}], plates: [{menuItemId, name, expectedPlates}]}`. `covers` only for owner and admin.
- `public.forecast(p_date date) returns jsonb`: `app.require_push_reader()` first.

**`20261114100500_discards_vs_push.sql`** (step 5)
- `app.discards_vs_push_json(p_tenant, p_week, p_now)` (decision 5) and `public.discards_vs_push(p_week date)`: `app.require_day_closer()` (owner, admin) first. The reply is `{weekFrom, weekTo, rows, totals}`.

**`20261114100600_dashboard_push_list.sql`** (step 6)
- `create or replace function app.dashboard_summary_at(...)`: the merged body of `20261112100600` verbatim, plus `pushList` (decision 8) and `comingSoon = '[]'`. `public.dashboard_summary()` is not touched.

**Not replaced** (`255` md5-pins them): `public.menu_list`, `public.add_order_line`, `public.update_menu_item`, `app.menu_item_availability`, `app.plate_batch_needs`, `app.plate_raw_needs`, `app.live_batch_remaining`, `public.discard_batch`, `public.waste_costs`, `app.expiry_rule`, `app.kpi_sales_lines`, `app.kpi_session_rows`, `app.kpi_cutoff_end`, `app.rollup_daily_kpi`, `public.fire_course`, `public.void_line`.

### 3.3 Sequence of calls

1. **Morning, owner:** `GET /api/dashboard` → `dashboard_summary()` → `pushList` (top 5) → the tile. "Apri la lista" → `/spingere` → `GET /api/reports/push-list` → `push_list()`.
2. **Push:** tap "Spingi oggi" on a plate chip → a sheet with an optional "Prezzo del giorno" → `POST /api/menu/:id/push {"pushed":true,"pushPrice":12}` → `push_menu_item()` → refetch of the list.
3. **Waiter:** `GET /api/menu` (unchanged, M18) → the pinned strip shows the plate first with its push price; `add_order_line` freezes that price on the line.
4. **End:** at the cut-off `push_until` passes, and every reader drops the pin. Or the owner taps "Togli" → `{"pushed":false}`.
5. **Chef:** `/produzione` → `GET /api/reports/forecast?date=…` → the forecast panel; `/spingere` read-only.
6. **Weekly:** `/report?vista=scarti` → `GET /api/reports/discards-vs-push?week=…`.

### 3.4 API (Zod 4; `withApi`; strict query/body → 400; `{"error":{"code","message"}}`; `Cache-Control: no-store`; `Server-Timing`)

```ts
// src/server/push/constants.ts — twins of the SQL constants; tests/parity/push-sql-parity.test.ts reads the migrations
export const FORECAST_WEEKS = 4;            // = app.forecast_weeks() (PRD 4.4)
export const FORECAST_DAYS_AHEAD = 6;       // = app.forecast_days_ahead()
export const PUSH_LIST_WINDOW_HOURS = 24;   // = app.use_by_state's 24 h (PRD 2.4); V4 changes it
export const PUSH_BODY_MAX_BYTES = 256;
// src/server/push/schemas.ts
// `price2` = the 2-decimal euro refinement src/server/menu/schemas.ts already applies to `price` (reused, not re-written; T5)
export const pushBody = z.discriminatedUnion("pushed", [
  z.strictObject({ pushed: z.literal(true), pushPrice: price2.positive().max(10000).nullable().default(null) }),
  z.strictObject({ pushed: z.literal(false) }),
]);
export const pushListQuery = z.strictObject({});
export const forecastQuery = z.strictObject({ date: z.iso.date().optional() });
export const discardsQuery = z.strictObject({ week: z.iso.date().optional() });
// src/server/push/output.ts — strict, one schema per role where keys differ; snapshot-tested
const plateBase = { menuItemId: z.uuid(), name: z.string().max(80), pushed: z.boolean(), pushUntil: z.iso.datetime().nullable() };
const rowBase = { kind: z.enum(["batch", "lot"]), id: z.uuid(), name: z.string().max(120), lotCode: z.string().max(64).nullable(),
  madeOn: z.iso.date(), useByAt: z.iso.datetime(), expiryDate: z.iso.date().nullable(), hoursToUseBy: z.number().min(0),
  quantity: z.number().positive(), unit: z.string().max(8),
  batchRecipes: z.array(z.strictObject({ recipeKey: z.uuid(), name: z.string().max(120) })) };
export const chefPushListOutput = z.strictObject({ role: z.literal("chef"), asOf: z.iso.datetime(), businessDate: z.iso.date(),
  rows: z.array(z.strictObject({ ...rowBase, plates: z.array(z.strictObject(plateBase)) })),
  expired: z.strictObject({ batches: z.number().int(), lots: z.number().int() }), unresolvedRecipes: z.number().int(),
  totals: z.strictObject({ count: z.number().int() }) });
// managerPushListOutput: role "owner" | "admin"; rows add costAtRiskEur: z.number().nullable();
//   plates add pushPrice: z.number().nullable(); totals add costAtRiskEur: z.number(), unvaluedCount: z.number().int()
export const pushListOutput = z.discriminatedUnion("role", [managerPushListOutput, chefPushListOutput]);
// forecastOutput: chef without `covers`; owner/admin with covers: { expected: number | null }
// discardsOutput: the keys of §3.2, strict
```

| Endpoint | Roles | Query / body | Success | Errors |
|---|---|---|---|---|
| `POST /api/menu/:id/push` | owner, admin | `pushBody` (JSON, ≤ 256 B) | 200 `{item, changed}` (the M17 owner item shape) | 400; 401; **403 chef, waiter (before any RPC)**; 404 `menu_item_not_found` (also another tenant's id, and a non-uuid id without an RPC); 409 `menu_item_inactive`; 413; 415; 422 `push_price_invalid`, `push_price_above_menu` |
| `GET /api/reports/push-list` | owner, admin, chef | `pushListQuery` | 200 `pushListOutput` | 400; 401; 403 waiter |
| `GET /api/reports/forecast` | owner, admin, chef | `forecastQuery` | 200 `forecastOutput` | 400; 401; 403 waiter; 422 `date_out_of_range` |
| `GET /api/reports/discards-vs-push` | owner, admin | `discardsQuery` | 200 `discardsOutput` | 400; 401; 403 chef, waiter; 422 `date_in_future` |
| `GET /api/dashboard` (changed) | owner, admin | none | 200, with `pushList` and `comingSoon: []` | unchanged |

- **Files:** `src/server/push/{constants,schemas,output,errors,push,list,forecast,discards}.ts`; `src/app/api/menu/[id]/push/route.ts`; `src/app/api/reports/{push-list,forecast,discards-vs-push}/route.ts`; `src/server/dashboard/{sql-schema,output,render}.ts` (changed).
- **Errors:** `ErrorCode` gains `menu_item_inactive`, `push_price_invalid`, `push_price_above_menu`, `date_out_of_range`.
- **Parsing:** each SQL reply is parsed with the strict schema of the caller's role. A chef reply carrying `costAtRiskEur` or `pushPrice`, or a chef forecast carrying `covers`, gives 500 `report_unavailable` and never reaches the JSON (the M22 rule).

### 3.5 Screens (Italian first, English second; 360 px first; targets ≥ 44 px; every value from `/api/*`)

**Oggi (`/`): the "Da spingere oggi" tile** (`src/components/dashboard/push-list-tile.tsx`), first in `tileOrder` for owner and admin, before "Ieri".
- Up to 5 lines, each the PRD sentence built by `pushLine(row, role, locale)`:
  - a batch, owner/admin: "Spezzatino, prodotto lun, da consumare entro mer 20:00, 14 porzioni, 38,00 € a rischio → spingi Spezzatino con polenta";
  - a lot: "Manzo (demo), arrivato lun, scade gio, 3,2 kg, 38,40 € a rischio → usato in Spezzatino";
  - unknown cost: "costo non noto" instead of the amount;
  - a pushed plate gets "★ in evidenza".
- "Altri N" when `count > 5`; "N scaduti da scartare" when `expired` > 0; the link "Apri la lista" → `/spingere`.
- Empty: "Niente in scadenza entro domani."
- The "In arrivo" tile disappears (`comingSoon` is empty).

**`/spingere` (owner, admin, chef)**: `src/app/(owner)/spingere/{page,push-row,push-sheet}.tsx`; nav "Da spingere" in the group `oggi` (`canReadPushList`: owner, admin, chef).
- One card per row (`data-push-row-id`): the sentence, the hours left as a `Badge` ("tra 4 h", `warning`; "tra 30 min" under one hour), and one chip per plate.
- **Owner and admin:** each chip has "Spingi oggi" or, when pushed, "In evidenza fino alle 02:00 · 12,00 €" with "Togli".
  - "Spingi oggi" opens `push-sheet.tsx`: the plate name, the menu price, an optional "Prezzo del giorno" input (parsed by `src/lib/money/parse.ts`), and "Conferma".
  - A 422 is shown in Italian ("Il prezzo del giorno non può superare il prezzo del menu (14,00 €).").
- **Chef:** the same cards without € and without buttons, with the hint "Chiedi al titolare di metterlo in evidenza".
- Footer: "2 preparazioni e 1 lotto scaduti: da scartare", with links. With `unresolvedRecipes > 0`: "Alcune ricette non sono complete: i piatti collegati potrebbero mancare."

**`/produzione` forecast panel** (`src/app/(owner)/produzione/forecast-panel.tsx`; chef, owner, admin)
- Chips "Oggi · Domani" (`?previsione=`), whose dates come from the reply's `today` and `tomorrow`. The API accepts up to six days ahead.
- Heading "Previsione per giovedì 5 novembre · media delle ultime 4 settimane" ("di 3 settimane" when `weeksUsed < 4`).
- One line per batch recipe: "Di solito il giovedì escono 22 porzioni di Spezzatino; ne hai 14", with a `Badge` "ne mancano 8" when `gap > 0`.
- Owner/admin only: "Coperti attesi: 31".
- A collapsible "Piatti" list: "Spezzatino con polenta · 22".
- Empty (`weeksUsed = 0`): "Non ci sono ancora vendite di questo giorno."

**`/report` "Scarti e spinte" view** (`src/app/(owner)/report/discards-panel.tsx`, `?vista=scarti`; owner, admin)
- The ISO week picker of "Non mappati".
- Rows such as "Spezzatino · durata 48 h · 1 lotto scartato, 1 era in evidenza · 3 porzioni · 8,14 €"; the totals.
- Empty: "Nessuna preparazione scartata in questa settimana."

**Waiter menu:** unchanged (M18): the pushed plate first with its star and push price; no cost or risk field.

### 3.6 Who calls what (§3.11.2, with project V6 in force)

| Object | owner | admin | chef | waiter | DB enforcement |
|---|---|---|---|---|---|
| `push_menu_item` | ✓ | ✓ | 42501 | 42501 | `app.require_menu_writer()` first |
| `push_list` | ✓ (€, prices) | ✓ (€, prices) | ✓ (no €, no price) | 42501 | `app.require_push_reader()` first; keys by role in SQL |
| `forecast` | ✓ (covers) | ✓ (covers) | ✓ (no covers) | 42501 | as above |
| `discards_vs_push` | ✓ | ✓ | 42501 | 42501 | `app.require_day_closer()` first |
| `dashboard_summary` (`pushList`) | ✓ | ✓ | 42501 | 42501 | unchanged gate |
| `menu_push` SELECT | ✓ | ✓ | 0 rows | 0 rows | RLS |
| `menu_push` INSERT/UPDATE/DELETE | — | — | — | — | no grant, no policy; append-only |
| every `app.*` function of §3.2 | — | — | — | — | revoked from every API role |

No new public function name matches `cost|margin|price`, so the `059` list stays at 13.

### 3.7 Secrets and configuration

| Name | Public? | Where it lives | Used by M23 |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public by design (existing) | Vercel env | The session client of every route |
| `SUPABASE_SECRET_KEY` | **private** (existing) | Vercel env (server-only); local `.env` (gitignored); GitHub `staging` environment secret | **Not used by M23 `src/` code.** Used only by the integration and e2e helpers to seed fixtures (existing pattern) |
| `CRON_SECRET`, Vault values, `PIN_PEPPER`, `ANTHROPIC_API_KEY`, `EXTRACTION_MODEL_ID`, `RESEND_API_KEY` | existing | Vercel env / Supabase Vault | **Not touched.** M23 adds no job and no provider |
| Account logins (Vercel, Supabase, GitHub) | private | The account owner's password manager, with MFA (project Q26); never in the repo or in DigiAlto-Ops | Humans only |

### 3.8 Fixtures (pgTAP; tenant A; cut-off 02:00; "now" through the twins)

**Push list (`250`), now N = Wed 2026-11-04 10:00 CET (09:00Z), business date 2026-11-04:**

| Id | What | Use-by / expiry | Left | Cost | Expected |
|---|---|---|---|---|---|
| B1 | batch "Spezzatino", produced Mon 2026-11-02 20:00 CET, 48 h | Wed 2026-11-04 20:00 CET (19:00Z) | 31 produced − 17 sold = **14** | `unit_cost_frozen` 2.7143 | listed, **10.0 h**, at risk **38.0002** ("38,00 €") |
| B2 | batch "Ragù (demo)" | 2026-11-04 14:00 CET (13:00Z) | 6 | incomplete (null) | listed, **4.0 h**, `costAtRiskEur` null, `unvaluedCount` 1 |
| B3 | batch "Spezzatino", all sold | 2026-11-04 18:00 CET | **0** | 2.70 | **absent (AT1)** |
| B4 | batch "Ragù (demo)" | 2026-11-04 08:00 CET (past) | 3 | 1.50 | absent; `expired.batches` 1 |
| B5 | batch "Spezzatino" | 2026-11-05 12:00 CET (26 h) | 30 | 2.70 | absent (outside 24 h) |
| L1 | lot "Manzo (demo)", received Mon 2026-11-02 | expiry 2026-11-05 → `useByAt` 2026-11-05 23:00Z | 3.2 kg | receipt 12.00 | listed, **38.0 h**, **38.4000** |
| L2 | lot "Parmigiano (demo)" | expiry 2026-11-04 → 2026-11-04 23:00Z | 0.5 kg | receipt 20.00 | listed, **14.0 h**, **10.0000** |
| L3 | lot "Parmigiano (demo)", fully consumed | 2026-11-04 | **0 kg** | 20.00 | **absent (AT1)** |
| L4 | lot "Manzo (demo)" | 2026-11-03 (yesterday) | 1 kg | 12.00 | absent; `expired.lots` 1 |
| L5 | lot without expiry | — | 5 kg | 12.00 | absent |

- **Order (AT3):** B2 (4.0), B1 (10.0), L2 (14.0), L1 (38.0).
- **Plates:** "Spezzatino con polenta" (1 portion of Spezzatino + polenta) on B1; "Tagliatelle al ragù (demo)" (1 portion of Ragù + Parmigiano) on B2 and L2. L1 has no plate and `batchRecipes` = ["Spezzatino"]. An inactive menu item mapped to the stew plate is not listed.
- **Totals (owner):** count 4, `costAtRiskEur` 86.4002, `unvaluedCount` 1.
- **Tenant B** has a due-soon batch; none of its ids appear in A's reply.

**Forecast (`251`), D = Thu 2026-11-05, now = 2026-11-05 10:00 CET:**
- Source dates 2026-10-29, 10-22, 10-15, 10-08 (the window crosses the 2026-10-25 DST change).
- "Spezzatino con polenta" plates sold on closed tables: 20, 24, 21, 23 → **22.00**. Covers 30, 34, 28, 32 → **31.00**.
- One live stew batch with **14** portions (produced Wed 2026-11-04 18:00, 48 h) → `onHandPortions` 14, `gap` 8.
- Edges: a table closed Fri 2026-10-30 at 00:40 local (business date 10-29) is counted; a Wednesday 10-28 sale is not; a voided line on 10-22 is not; an open table on 10-15 is not.
- **Tenant C**, the same data without any session on 10-15 → `weeksUsed` 3, stew (20 + 24 + 23) ÷ 3 = **22.33**.

**Discards vs push (`252`), week 2026-11-02…08:**
- S1, a "Spezzatino" batch produced Mon 11-02 20:00, cost 2.7143; 3 portions discarded Wed 11-04 21:00 (`batch_discard`). "Spezzatino con polenta" pushed Wed 11-04 10:05 until 2026-11-05 01:00Z → **pushed**.
- R1, a "Ragù (demo)" batch, cost 1.50; 5 portions discarded Tue 11-03 22:00; never pushed.
- **Rows:** Ragù (1 batch, 0 pushed, 5 portions, 0 pushed portions, 7.5000), then Spezzatino (1, 1, 3, 3, 8.1429). Totals: batches 2, pushed 1, portions 8, pushed portions 3, value 15.6429.
- Edges: a stew discard on Mon 11-09 → the next week; a void-after-fire waste (`order_void`) → not a discard; S2, produced after a push was stopped → not pushed; a push of a plate that does not use the batch → not pushed; a batch discarded twice in the week → one batch, portions summed.

## 4. Alternatives considered

- **Temporary price as a `menu_item_price` row:** rejected (ADR-026). It turns a discount into a menu price change and needs a job to restore it.
- **Push history in `audit_event` only:** rejected (ADR-026). The weekly report would parse free-form JSON, and the shared audit check lists would widen.
- **A push-list horizon of N hours chosen by us:** rejected as the default. The PRD defines "within 1 day" for the expiry alert that "feeds the push list". A different horizon is the client's call (Q159 → V4).
- **Expired stock on the push list with a push button:** rejected. Selling past the use-by is a food-safety problem; M18 already greys a plate whose batches are all expired.
- **Forecast from `batch_movement` consumption:** rejected. Consumption is dated by the calendar date of the fire, not the business date, and a void after firing reverses it. The sold lines of closed tables (`kpi_sales_lines`) match the KPI reports.
- **Forecast always divided by 4:** kept as V5 (Q162). By default, a closed week would pull the average down with no sales behind it.
- **Snapshotting the forecast nightly:** rejected. It reads four dates live; storing them gains nothing.
- **A Realtime or per-minute refresh of the push list:** rejected. The list changes slowly. The dashboard refreshes on focus (60 s floor), and `/spingere` on open and after each push.
- **A pg_cron job to clear expired pushes:** rejected. Every reader already compares `push_until` with `now()` (M18); a job would add state to keep consistent.
- **"Pushed" from `order_line.price_source = 'push'`:** rejected. A push without a temporary price leaves `price_source = 'menu'`, so those pushes would be missed.

## 5. Build plan (test first: each step's named test is written and seen failing, then the code; one commit per step; `tdd-guide` follows the order)

| # | Step (one commit) | Files | Test that proves it (written first, must fail first) |
|---|---|---|---|
| 1 | Migration: `menu_push`, `app.menu_push_periods`, `app.push_default_until`; purge list. Pins and lists updated on purpose | `supabase/migrations/20261114100000_menu_push_core.sql`, `supabase/migrations/20261114100100_demo_purge_tables_m23.sql`, `supabase/tests/database/248_menu_push_core.test.sql`. On purpose: `207_dashboard_preserves.test.sql` and `214_m20_preserves.test.sql` (public table lists + `menu_push`); every preserve test that pins the purge list (`grep -l demo_purge_tables supabase/tests/database`: at least `222`, `229`, `240`), each filter extended by `menu_push`. Fixtures in `004_waiter_cost_columns.test.sql` and `059_cost_roles_v6.test.sql` (one row; assertions unchanged) | **`248`.** **Shape:** a `start` without `push_until` → 23514 `menu_push_shape_ck`; a `stop` with a price → 23514; `push_price` 0 → 23514; another tenant's item → 23503. **Append-only:** UPDATE/DELETE/TRUNCATE → `append_only`. **RLS:** owner A and admin A read A's rows; chef A and waiter A read 0; owner B reads 0. **Privileges:** `authenticated` insert/update/delete false; `service_role` select true. **Periods:** a start at 10:00 until 02:00, stopped at 15:00 → `effective_end` 15:00; a start at 10:00 and another at 12:00 → the first ends at 12:00; a start whose `push_until` passed → ends at `push_until`; a period outside `[from, to)` is absent. **`push_default_until`:** at 2026-11-04 10:00 CET → 2026-11-05 01:00Z; at 2026-11-05 01:30 CET (before the cut-off) → 2026-11-05 01:00Z; **autumn DST** at 2026-10-24 22:00 CEST → 2026-10-25 00:00Z (the first 02:00); **spring DST** at 2027-03-27 21:00 CET → 2027-03-28 01:00Z (03:00 CEST). **Purge:** `menu_push` comes immediately before `menu_item_price`; `purge_demo_data` on a demo tenant holding `menu_push` rows removes them and leaves the other tenants' rows; `194` green (every tenant table listed once). `004`, `059`, `193`, `207`, `214`, `222`, `229`, `240` green |
| 2 | Migration: `push_menu_item` | `supabase/migrations/20261114100200_push_menu_item.sql`, `supabase/tests/database/249_push_menu_item.test.sql` | **AT4 (SQL)**, via `app.push_menu_item_at` as owner A. **Start with a price:** "Spezzatino con polenta" (menu 14.00) with `{"pushed":true,"pushPrice":12}` at N → `menu_item.push_until` 2026-11-05 01:00Z and `push_price` 12.00; one `start` row with the same values, `created_at` = N and `batch_keys` = [stew key]; reply `changed` true and `item.pushPrice` 12. **Waiter menu:** pushed at the real `now()` through `public.push_menu_item` with owner claims, then `public.menu_list()` as waiter A → `pinned[0].id` = the item, `pushed` true, `pushPrice` 12; `add_order_line` on it → `unit_price` 12.00, `price_source` `push`. **After `push_until`:** pushed through the twin at a fixed past instant (so `push_until` has passed) → `menu_list()` shows it not pinned, `pushed` false, `pushPrice` null, and `add_order_line` charges 14.00 (`menu`). **Rules (Q156):** 14.00 accepted; 14.01 → `push_price_above_menu`; 0 and −1 → `push_price_invalid`; 12.345 → `push_price_invalid`; no price → `push_price` null (pinned without a price). **Idempotent:** the same start twice → one row, `changed` false; a new price → a second row; stop → columns null and one `stop` row; stop again → no row. **Guards:** an inactive item → `menu_item_inactive`; another tenant's id → P0002; an unknown key `{"until":…}` → 22023; `{"pushed":false,"pushPrice":1}` → 22023. **Price history untouched:** the `menu_item_price` row count and md5 are unchanged by every case. **Unmapped item** (a drink) → pushed, `batch_keys` = `{}`. **Consistency:** after every case, while pushed, the newest `start` row's `push_until`/`push_price` equal the columns. **Roles:** chef and waiter → 42501 through `public.push_menu_item`, no row written |
| 3 | Migration: push list (with `batch_use_by_idx`) | `supabase/migrations/20261114100300_push_list.sql`, `supabase/tests/database/250_push_list.test.sql` | Through `app.push_list_json(A, role, N)` on the §3.8 fixture. **AT1:** B3 (0 portions) and L3 (0 kg) are absent; a batch at −1 portion is absent. **AT2 (data):** the B1 row is `{kind batch, name "Spezzatino", madeOn 2026-11-02, useByAt 2026-11-04T19:00:00Z, hoursToUseBy 10.0, quantity 14, unit "porz", costAtRiskEur 38.0002, plates [{name "Spezzatino con polenta", pushed false}]}`. **AT3:** ids in the order B2, B1, L2, L1; a tie on hours → name `collate "C"`, then id. **Window:** B4 and L4 absent, `expired` = `{batches 1, lots 1}`; B5 and L5 absent. **Lots:** L1 `hoursToUseBy` 38.0, `madeOn` 2026-11-02, `expiryDate` 2026-11-05, `batchRecipes` [Spezzatino], `plates` []; L2 has the plate "Tagliatelle al ragù (demo)"; a lot transferred between two locations is one row with the summed quantity. **Lot boundary:** at 2026-11-05 00:30 CET (business date still 11-04), L2 is absent and counted as expired. **DST:** a batch with use-by 2026-10-25 03:00 CET seen at 2026-10-24 22:00 CEST → 6.0 h; a lot expiring 2026-10-24 → `useByAt` 2026-10-24T22:00:00Z (CEST midnight); one expiring 2026-10-25 → 2026-10-25T23:00:00Z (CET midnight); one expiring 2027-03-28 → 2027-03-28T22:00:00Z. **Cost:** B2 null, `unvaluedCount` 1; totals 86.4002. **Pushed flag:** after a push of "Spezzatino con polenta", B1's plate has `pushed` true and `pushPrice` 12 (owner). **Roles:** the chef reply has no `costAtRiskEur`, no `pushPrice` and no `totals.costAtRiskEur` (one assertion each), and a recursive key walk finds no `/cost\|price\|eur/i`; the admin reply equals the owner's. **Broken recipes:** a plate whose sub-recipe has no version in force is skipped from B2's and L2's `plates`, and a batch recipe using Manzo whose sub-recipe has no version in force is skipped from L1's `batchRecipes` (the SQLSTATE each raises is asserted to be P0001); `unresolvedRecipes` 2, and the list still answers. **Index:** `batch_use_by_idx` exists on `(tenant_id, use_by)`. **Tenancy:** no tenant B id in A's reply. `public.push_list()` with real claims answers for owner, admin and chef |
| 4 | Migration: forecast | `supabase/migrations/20261114100400_forecast.sql`, `supabase/tests/database/251_forecast.test.sql` | **AT5**, via `app.forecast_json(A, 'chef', '2026-11-05', <Thu 10:00>)`: `sourceDates` [10-29, 10-22, 10-15, 10-08], `weeksUsed` 4, `today` 2026-11-05, `tomorrow` 2026-11-06; the Spezzatino batch row `{expectedPortions 22.00, onHandPortions 14, gap 8.00}`; the plate row "Spezzatino con polenta" 22.00. **Edges** of §3.8: the 00:40 Friday close counts; the Wednesday sale, the voided line and the open table do not. **Version sold:** a plate whose current version uses 2 portions, sold in the window while its earlier version used 1 → portions follow the version sold (1 per plate). **Parity:** on the fixture, Σ `forecast_portion_lines` portions = Σ mapped `kpi_sales_lines` qty of the stew plate. **Divisor (Q162):** tenant C → `weeksUsed` 3, 22.33. **No history:** a tenant with no sales → `weeksUsed` 0, every expected value null, `onHandPortions` still filled. **Dates:** null → today's business date; today + 6 accepted; today + 7 and yesterday → `date_out_of_range`. **Roles:** the owner reply has `covers.expected` 31.00; the chef reply has no `covers` key; waiter → 42501 via `public.forecast`. **Tenancy:** tenant B's sales are not counted |
| 5 | Migration: discards vs push | `supabase/migrations/20261114100500_discards_vs_push.sql`, `supabase/tests/database/252_discards_vs_push.test.sql` | **AT7**, via `app.discards_vs_push_json(A, '2026-11-04', <2026-11-09 09:00>)`: `weekFrom` 2026-11-02, `weekTo` 2026-11-08; rows Ragù `{batchesDiscarded 1, batchesPushed 0, portionsDiscarded 5, portionsPushed 0, valueEur 7.5000}`, then Spezzatino `{1, 1, 3, 3, 8.1429, shelfLifeHours 48}`; totals `{2, 1, 8, 3, 15.6429}`. **Edges** of §3.8: next-week discard, `order_void` waste, push stopped before production, push of another plate, two discards of one batch. **Unknown cost:** a discarded batch with an incomplete cost → excluded from `valueEur`, `unvaluedCount` 1. **Reversal:** a discard row that has a reversing row is not counted. **Week:** null → the week of `p_now`'s business date; a later date → `date_in_future`; a discard on Sunday 2026-11-08 at 23:30 local is in the week (dated by `effective_on`, as `waste_costs`). **Roles:** chef and waiter → 42501 via `public.discards_vs_push` |
| 6 | Migration: dashboard `pushList`; `203`/`204`/`238` updated on purpose | `supabase/migrations/20261114100600_dashboard_push_list.sql`, `supabase/tests/database/253_dashboard_push_list.test.sql`, `203_dashboard_owner.test.sql`, `204_dashboard_roles.test.sql`, `238_dashboard_kpis.test.sql` (key lists + `pushList`; `comingSoon` = `[]`; every other assertion unchanged) | **`253`**, via `app.dashboard_summary_at(A, role, N)`: `pushList.count` 4, `expired` `{1, 1}`, and `items` equal to the 4 rows of `push_list_json(A, 'owner', N)` (equal JSON). With three more due-soon batches added in the test, `items` has `app.dashboard_list_cap()` = 5 rows and `count` 7. The owner's and the admin's `pushList` are equal. `comingSoon` = `[]`. The rest of the document is unchanged: the reply minus `pushList` and `comingSoon` equals the reply of the M22 body, captured in the test before the migration. `public.dashboard_summary()` with real claims still answers |
| 7 | pgTAP role and tenancy matrix | `supabase/tests/database/254_push_roles.test.sql` | **The §3.6 matrix:** each cell (owner, admin, chef, waiter, no claims) for `push_menu_item`, `push_list`, `forecast` and `discards_vs_push`. **AT6 (SQL):** with an item pushed at 12.00, `menu_list()` as waiter has `pinned[0].pushed` true and `pushPrice` 12; a recursive key walk of the whole reply finds no `/cost\|risk\|margin\|eur/i` key; the item key set is still exactly the eleven keys of `153`. `has_function_privilege('anon', …)` is false for the four public functions; no API role executes any `app.*` of §3.2; each has `prosecdef` true and `proconfig` = `{search_path=""}`. **Tenancy:** a recursive scan of owner A's replies finds none of tenant B's uuids, and B's none of A's. The `059` list is still 13 |
| 8 | Preservation guard | `supabase/tests/database/255_m23_preserves.test.sql` | The md5 of every function in §3.2 "Not replaced" equals its value on `4f77afb` (written in the test). The `app.alert_kind` rows and both `audit_event` check definitions are identical. PR grep: `grep -lE "create or replace function (public\.(menu_list\|add_order_line\|update_menu_item\|discard_batch\|waste_costs\|fire_course\|void_line)\|app\.(menu_item_availability\|plate_batch_needs\|plate_raw_needs\|kpi_sales_lines\|kpi_cutoff_end\|expiry_rule))" supabase/migrations/20261114*` returns nothing |
| 9 | pgTAP performance net | `supabase/tests/database/256_push_perf.test.sql` | Under `statement_timeout = '5s'`, `analyze`d: 400 batches (60 due soon), 2,000 lots (100 due soon), 60 menu items, 25 batch recipes, 28 days × 60 closed sessions × 8 lines, 500 `menu_push` rows. `push_list_json`, `forecast_json`, `discards_vs_push_json` and `dashboard_summary_at` all answer. `explain (format json)` of `app.push_list_window`'s batch read mentions `batch_use_by_idx` and its lot read `raw_lot_expiry_idx`; neither has a `Seq Scan` on `batch_movement` or `stock_movement`. The discards read mentions `batch_movement_effective_idx`. A regression net, not a latency claim |
| 10 | Race case | `scripts/test-db-races.sh` (one case appended; header updated) | CI job `db-races`: the existing cases are unchanged, and `no_deadlock` holds in all. **`push-twice`:** two `push_menu_item` calls on one item in two sessions, the first parked after its row lock. With the same body → the second waits, then writes nothing (`changed` false); one `start` row. With different prices → two rows, and the columns equal the later one |
| 11 | TS domain: constants, schemas, outputs (snapshots), errors, view helpers, i18n, parity; dashboard schemas extended | `src/server/push/{constants,schemas,output,errors}.ts`, `src/server/dashboard/{sql-schema,output,render}.ts`, `src/lib/push/push-view.ts`, `src/lib/reports/report-view.ts`, `src/lib/dashboard/dashboard-view.ts`, `src/lib/api/errors.ts`, `src/lib/i18n/messages/{it,en,keys}.ts`, `tests/server/push/{schemas,output,errors}.test.ts` + `__snapshots__`, `tests/server/dashboard/{sql-schema,output,render}.test.ts` and `tests/fixtures/dashboard-sql.ts` (snapshots and fixture updated on purpose), `tests/lib/dashboard/dashboard-view.test.ts`, `tests/lib/push/push-view.test.ts`, `tests/parity/push-sql-parity.test.ts` | **`schemas.test.ts`:** `{pushed:true}` → `pushPrice` null; `pushPrice` 12.345 → error; 0 → error; `{pushed:false, pushPrice:1}` → error; an extra key → error; `forecast?date=2026-13-01` → error; any push-list query key → error. **`output.test.ts`:** `toJSONSchema` snapshots of the four outputs; a chef push list with `costAtRiskEur` fails; a chef plate with `pushPrice` fails; a chef forecast with `covers` fails. **Dashboard:** the `pushList` tile schema; `comingSoon: []` accepted. **`errors.test.ts`:** `push_price_*` and `date_out_of_range` → 422; `menu_item_inactive` → 409; Italian messages. **AT2 (rendering):** `pushLine(B1 row, "owner", "it")` = "Spezzatino, prodotto lun, da consumare entro mer 20:00, 14 porzioni, 38,00 € a rischio → spingi Spezzatino con polenta"; the same in `en` = "Spezzatino, made Mon, use by Wed 20:00, 14 portions, €38.00 at risk → push Spezzatino con polenta"; `pushLine(B1 row, "chef", "it")` contains no "€" and no "a rischio"; a null cost → "costo non noto"; the L1 row → "Manzo (demo), arrivato lun, scade gio, 3,2 kg, 38,40 € a rischio → usato in Spezzatino". **AT5 (rendering):** `forecastLine({date "2026-11-05", name "stew", expected 22, onHand 14}, "en")` = "Thu usually sells 22 stew, you have 14"; Italian "Di solito il giovedì escono 22 porzioni di stew; ne hai 14"; `expected` 22.33 → "22,3"; null → the empty text. `hoursBadge(0.5)` "tra 30 min", `hoursBadge(4)` "tra 4 h". **Parity:** `FORECAST_WEEKS`, `FORECAST_DAYS_AHEAD` and `PUSH_LIST_WINDOW_HOURS` equal the SQL (read from the migration text) |
| 12 | API routes and services | `src/server/push/{push,list,forecast,discards}.ts`, `src/app/api/menu/[id]/push/route.ts`, `src/app/api/reports/{push-list,forecast,discards-vs-push}/route.ts`, `tests/app/api/{menu-push,reports-push-list,reports-forecast,reports-discards}.test.ts`, `tests/app/api/dashboard.test.ts` (updated on purpose: `comingSoon` `[]`, `pushList` present) | With a fake session client. **Roles before any RPC (spy: 0 calls):** chef and waiter → 403 on push; waiter → 403 on push-list and forecast; chef and waiter → 403 on discards. Owner, admin and chef (where allowed) → exactly one `rpc` with the parsed params. **Push:** `text/plain` → 415; more than 256 B → 413; `{pushed:"yes"}` → 400 without an RPC; P0002 → 404; `push_price_above_menu` → 422; a non-uuid `:id` → 404 without an RPC. **Role schemas:** a chef reply carrying `costAtRiskEur` → 500 `report_unavailable`, with the key absent from the body. `?foo=1` on push-list → 400. **Dashboard:** still exactly one RPC per `GET`; `pushList` present for owner and admin. Every route sends `Cache-Control: no-store` and `Server-Timing` |
| 13 | Real-stack integration suite | `tests/integration/push-forecast.int.ts`, `tests/integration/helpers/push.ts` (reuses `helpers/closing.ts` and the M14/M15 batch helpers through their APIs; a second tenant), `tests/integration/reports.int.ts` (the `comingSoon` assertion updated on purpose to `[]`) | The server clock cannot be moved, so the helper produces a batch whose shelf life ends within 24 h of now, and a lot expiring tomorrow. **AT1:** a batch fully sold through the order APIs and a lot fully consumed are absent from `GET /api/reports/push-list`. **AT2:** the produced batch's row has its name, portions and `costAtRiskEur` = portions × the frozen cost returned by `GET /api/batches/:id` (owner). **AT4:** the owner's `POST /api/menu/:id/push {"pushed":true,"pushPrice":4.5}` → the waiter's `GET /api/menu` has the item first in `pinned` with `pushPrice` 4.5; a waiter line on it is charged 4.5; `{"pushed":false}` → no longer pinned. **AT6:** the waiter's `GET /api/menu` reply has no cost or risk key (recursive walk). **AT7:** a batch discarded through `POST /api/batches/:id/discard` after a push of its plate → `GET /api/reports/discards-vs-push` lists it with `batchesPushed` 1. **Forecast:** `GET /api/reports/forecast` for the chef answers, without `covers`. **Roles:** chef and waiter (PIN) → 403 on push; waiter → 403 on the three reports. **Tenancy:** owner B's push list has none of A's ids; owner B pushing A's item → 404 |
| 14 | Dashboard tile | `src/components/dashboard/push-list-tile.tsx`, `src/components/dashboard/{dashboard-tiles,coming-soon-tile}.tsx`, `src/lib/dashboard/dashboard-view.ts`, `tests/components/{dashboard-tiles,home-dashboard}.test.ts` (extended on purpose) | **`renderToStaticMarkup`:** the tile renders the B1 sentence with `/38,00\s+€/`; "★ in evidenza" on a pushed plate; "Altri 2" at `count` 7; "1 scaduto da scartare" when `expired` adds up to 1; exactly one link, "Apri la lista" → `/spingere`; the empty text at `count` 0. `tileOrder("owner")` and `tileOrder("admin")` start with the push tile, then "Ieri". With `comingSoon: []` no "In arrivo" tile is rendered. No component computes a value; amounts go only through `formatEuro` |
| 15 | `/spingere` page, push sheet and nav | `src/app/(owner)/spingere/{page,push-row,push-sheet}.tsx`, `src/lib/push/push-access.ts`, `src/lib/nav/nav-model.ts`, `docs/design/ui-foundation.md` (§8 line for M23), `tests/components/{push-page,push-row,push-sheet}.test.ts`, `tests/lib/nav/nav-model.test.ts` | With a fake `apiJson`. **Page:** one `GET /api/reports/push-list` on mount; rows by `data-push-row-id`, in API order. **Owner:** "Spingi oggi" opens the sheet; "Conferma" with "12,50" posts `{"pushed":true,"pushPrice":12.5}` once, then refetches; an empty price posts `pushPrice` null; a 422 shows the Italian message in an `aria-live` region; "Togli" posts `{"pushed":false}`. **Chef payload:** no button, no "€", the hint text. The expired footer and the `unresolvedRecipes` note. **Nav:** "Da spingere" for owner, admin and chef, not for the waiter. Every button ≥ 44 px (class check) |
| 16 | Forecast panel on `/produzione` | `src/app/(owner)/produzione/forecast-panel.tsx`, `src/app/(owner)/produzione/page.tsx`, `tests/components/forecast-panel.test.ts` | **AT5 (UI):** with the §3.8 reply, the panel shows "Di solito il giovedì escono 22 porzioni di Spezzatino; ne hai 14" and the `Badge` "ne mancano 8"; "Coperti attesi: 31" only for an owner payload; "di 3 settimane" when `weeksUsed` is 3; the empty text at 0. "Domani" requests `?date=` with the reply's `tomorrow` value (no date arithmetic in the component) |
| 17 | `/report` "Scarti e spinte" view | `src/app/(owner)/report/{page,discards-panel}.tsx`, `tests/components/{report-page,discards-panel}.test.ts` | **AT7 (UI):** `?vista=scarti` requests exactly `GET /api/reports/discards-vs-push?week=…`; rows "Ragù (demo) · … 1 lotto scartato, 0 in evidenza · 5 porzioni · 7,50 €" and "Spezzatino · durata 48 h · 1 lotto scartato, 1 era in evidenza · 3 porzioni · 8,14 €"; the totals; the empty text. The segmented control gains "Scarti e spinte" (owner, admin) |
| 18 | Playwright | `e2e/push-forecast.spec.ts`, `e2e/helpers/seed-push.ts`, `e2e/dashboard.spec.ts` (the "In arrivo" assertions replaced on purpose) | **Phone (owner):** the seeded due-soon batch appears in Oggi's "Da spingere oggi"; "Apri la lista" → `/spingere`; push its plate at "4,50". A **waiter context** then opens the order screen: the plate is the first button of the pinned strip (`[data-pinned]`) with "4,50 €", and no text matches `/rischio\|costo/`. "Togli" → after a reload the strip no longer shows it. A batch fully sold by the seed is not on the list (AT1). **Chef:** `/spingere` shows the row with no "€" and no button; `/produzione` shows the forecast panel. **Waiter:** `page.request.get("/api/reports/push-list")` → 403. `expectPhoneFriendly` passes in light and dark on `/spingere` and on the forecast panel |

**Acceptance tests → proof**

| AT (project plan §5a M23) | Proved in (step) | Command |
|---|---|---|
| 1 A batch with 0 portions and a lot with 0 kg are absent from the push list | `250` (3); integration (13); `push-forecast.spec.ts` (18) | `npx supabase test db`; `npm run test:integration`; `npx playwright test` |
| 2 The PRD example line is rendered from a fixture, Italian too | `250` (3: the row data); `push-view.test.ts` (11: the it and en sentences); `dashboard-tiles.test.ts` (14); integration (13) | `npx supabase test db`; `npm test`; `npm run test:integration` |
| 3 Sorted by hours to use-by ascending | `250` (3, including the DST hours case) | `npx supabase test db` |
| 4 Push with a temporary price → the waiter menu shows the item first with `push_price`; after `push_until` it is no longer pinned | `249` (2); race `push-twice` (10); integration (13); `push-forecast.spec.ts` (18) | all of the above; `scripts/test-db-races.sh` |
| 5 Four past Thursdays averaging 22 stew, 14 portions on hand → "Thu usually sells 22 stew, you have 14" | `251` (4: the numbers); `push-view.test.ts` (11: the sentence); `forecast-panel.test.ts` (16) | `npx supabase test db`; `npm test` |
| 6 The waiter menu shows the push marker but no cost-at-risk field | `254` (7); the unchanged key sets of `153`/`162`; integration (13); `push-forecast.spec.ts` (18) | `npx supabase test db`; `npm run test:integration`; `npx playwright test` |
| 7 A fixture week with 2 discarded batches, one of them pushed, is reported per recipe | `252` (5); integration (13); `discards-panel.test.ts` (17) | `npx supabase test db`; `npm run test:integration`; `npm test` |
| Invariants: ledgers append-only, `menu_push` append-only, balances derived, `tenant_id` + RLS, roles in Postgres, the chef sees no €, waiters no cost, no data logic in React, the secret key not in `src/`, other procedures untouched | `248` (1); `254` (7); `255` (8); components (14–17); the existing `tests/lint/admin-client-import.test.ts` | `npx supabase test db`; `npm test`; `npm run lint` |

**CI implications:**
- **pgTAP:** `248`–`256` run in the `supabase` job and in `scripts/test-db-native.sh`. `004` and `059` gain fixture rows. `203`, `204`, `207`, `214`, `222`, `229`, `238` and `240` change named assertions on purpose (steps 1, 6).
- **Other jobs:** one race case; new and updated Vitest snapshots; `tests/integration/reports.int.ts` and `e2e/dashboard.spec.ts` updated on purpose; no new workflow; no new CI secret; coverage ≥ 80 % on new TS.

### 5b. Variants

**V1: any temporary price, above the menu price too** · Trigger: Q156 answered "the push price may be any price" · Replaces steps: the Q156 rule of 2 and its cases in `249`, 11 and 15

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V1.1 | `app.push_menu_item_at`: `pushPrice` only needs `> 0`, 2 decimals and `≤ 10000`; `push_price_above_menu` is no longer raised (the code stays in the TS enum, unused). The sheet's hint no longer mentions the menu price | `supabase/migrations/20261115100000_push_price_any.sql`, `supabase/tests/database/257_push_price_any.test.sql`, `src/lib/i18n/messages/{it,en}.ts`, `tests/lib/push/push-view.test.ts` | Menu 14.00: a push at 16.00 → accepted, `push_price` 16.00; 0 → `push_price_invalid`; 10000.01 → `push_price_invalid`. The hint text no longer contains "prezzo del menu" (i18n test) |

**V2: push until tomorrow's close** · Trigger: Q157 answered "I also want to push for two days" · Replaces steps: the `push_until` rule of 2, the body schema of 11 and the sheet of 15

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V2.1 | The body gains `until: "today" \| "tomorrow"` (default `today`); `tomorrow` → `app.kpi_cutoff_end(tenant, business_date + 1)` | `supabase/migrations/20261115100100_push_until_tomorrow.sql`, `supabase/tests/database/258_push_until_tomorrow.test.sql`, `src/server/push/schemas.ts`, `tests/server/push/schemas.test.ts` | At 2026-11-04 10:00 CET: `today` → 2026-11-05 01:00Z, `tomorrow` → 2026-11-06 01:00Z; `tomorrow` at 2027-03-26 21:00 CET → 2027-03-28 01:00Z (03:00 CEST, DST); `"week"` → 400 (Zod) and 22023 (SQL) |
| V2.2 | The sheet offers "Solo oggi · Anche domani" | `src/app/(owner)/spingere/push-sheet.tsx`, `tests/components/push-sheet.test.ts` | Choosing "Anche domani" posts `until: "tomorrow"`; the default posts no `until` |

**V3: the chef may push, without a price** · Trigger: Q158 answered "the chef can push too" · Replaces steps: the push role gate of 2 and 12, the chef cells of `254`, and the chef view of 15

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V3.1 | `public.push_menu_item` gate: owner, admin, chef. A chef body with a non-null `pushPrice` → 42501 `push_price_owner_only`; a chef stop is allowed | `supabase/migrations/20261115100200_chef_push.sql`, `supabase/tests/database/259_chef_push.test.sql` | Chef `{pushed:true}` → pushed, `push_price` null; chef with `pushPrice` 12 → 42501, no row; chef stop → a `stop` row; waiter still 42501 |
| V3.2 | Route roles owner, admin, chef; the chef card shows "Spingi oggi" without the price field | `src/app/api/menu/[id]/push/route.ts`, `src/app/(owner)/spingere/push-row.tsx`, `tests/app/api/menu-push.test.ts`, `tests/components/push-row.test.ts` | Chef → one RPC; chef with `pushPrice` → 403 before the RPC; the chef sheet has no price input |

**V4: a wider push-list window** · Trigger: Q159 answered with a horizon of N hours · Replaces steps: the window of decision 2 in 3, its window cases in `250`, and `PUSH_LIST_WINDOW_HOURS` in 11

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V4.1 | `app.push_list_horizon_hours()` = N. Batches are listed when `now < use_by ≤ now + N h`; lots when `expiry ≤ business_date + ceil(N ÷ 24)` and `useByAt > now`. The expired rules are unchanged | `supabase/migrations/20261115100300_push_list_horizon.sql`, `supabase/tests/database/260_push_list_horizon.test.sql`, `src/server/push/constants.ts`, `tests/parity/push-sql-parity.test.ts` | With N = 48 (a test value only): B5 (26 h) is listed, after L2; a batch at 49 h is absent; a lot expiring in 2 days is listed, in 3 days absent; the parity test equals N |

**V5: forecast always divided by four weeks** · Trigger: Q162 answered "divide by 4 even when we were closed" · Replaces steps: the divisor of decision 4 in 4, and its tenant C case in `251`

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V5.1 | Divisor = `app.forecast_weeks()` (4) once at least one source date has sales; `weeksUsed` is still reported | `supabase/migrations/20261115100400_forecast_divide_by_four.sql`, `supabase/tests/database/261_forecast_divide_by_four.test.sql` | Tenant C: (20 + 24 + 23) ÷ 4 = **16.75**; tenant A unchanged at 22.00; no sales at all → null |

**V6: the chef sees expected covers** · Trigger: Q163 answered "the chef may see expected covers" · Replaces steps: the chef shape of the forecast in 4, 11 and 16

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V6.1 | `app.forecast_json` adds `covers` for the chef too; the chef output schema gains it; the panel shows "Coperti attesi" to the chef | `supabase/migrations/20261115100500_forecast_covers_chef.sql`, `supabase/tests/database/262_forecast_covers_chef.test.sql`, `src/server/push/output.ts`, `tests/server/push/output.test.ts`, `tests/components/forecast-panel.test.ts` | The chef reply has `covers.expected` 31.00; the snapshot is updated on purpose; a recursive walk still finds no € key in the chef reply; the panel shows "Coperti attesi: 31" for a chef payload |

**V7: raw-ingredient waste in the weekly report** · Trigger: Q165 answered "include raw ingredients thrown away" · Replaces steps: none (adds to 5, 11 and 17)

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V7.1 | `discards_vs_push_json` adds `rawRows`: per ingredient, the `stock_movement` waste rows with a lot (`raw_lot_id` not null) and reason `expired` or `spoilage` in the week, with lots, quantity and `valueEur` (qty × `unit_cost`). `pushed` = a push period of a plate whose current version needs the ingredient overlapped `[lot received_on, first waste)` | `supabase/migrations/20261115100600_discards_raw.sql`, `supabase/tests/database/263_discards_raw.test.sql`, `src/server/push/output.ts`, `tests/server/push/output.test.ts` | Fixture: Parmigiano 0.5 kg wasted as `expired` on 11-05, after "Tagliatelle al ragù (demo)" was pushed → one raw row, `pushed` true, 10.00; a `breakage` waste → absent; a void waste (`order_void`) → absent |
| V7.2 | The "Scarti e spinte" view shows a second list, "Ingredienti" | `src/app/(owner)/report/discards-panel.tsx`, `tests/components/discards-panel.test.ts` | The Parmigiano row renders "0,5 kg · 10,00 €"; without `rawRows` there is no second list |

## 6. Risks and mitigations

- **Security and privacy**
  - *Definer functions bypass RLS.* Mitigations (steps 1–7, `254`): the role check first; an empty `search_path`; the tenant from `app.tenant_id()`, with every statement filtered by it; `app.*` twins with no API grant, whose role argument only shapes the output.
  - *€ or prices reaching the chef, costs reaching the waiter.* Mitigations:
    - role-shaped JSON built in SQL (`250`, `251`);
    - a strict per-role parse that turns a stray key into a 500 (11, 12);
    - 403 before any RPC (12), and 42501 in SQL (`254`);
    - `menu_push` RLS for owner and admin only (`248`);
    - the waiter menu function untouched and md5-pinned (`255`).
  - *IDOR:* another tenant's item id → P0002/404 (`249`, 13); replies are scanned for the other tenant's uuids (`254`).
  - *Input validation:* strict Zod (body ≤ 256 B, JSON only, a uuid path parameter, a 2-decimal price), plus the SQL checks (`menu_keys_ok`, `menu_price`, the date ranges).
  - *CSRF:* the push is a JSON-only `POST` through `withApi` (SameSite cookies, `Content-Type` check).
  - *Personal data:* `menu_push.created_by` is a staff id, as in every ledger; no reply carries a name; nothing leaves Supabase EU (GDPR; project Q13/Q14 unchanged). Its retention follows the business records (project Q14).
- **Food safety:** expired stock is never offered as a push (decision 2, `250`). A push lasts at most until the cut-off, and M18 already greys a plate whose batches are all expired (unchanged).
- **Correctness**
  - *Columns and log drifting apart:* a single writer, one transaction, a row lock, the consistency assertion in `249`, and the race case `push-twice` (10).
  - *A push price above a lowered menu price:* if the owner lowers the menu price during a push, the push price stays until the push ends (A3).
  - *Lots between midnight and the cut-off:* treated as expired (decision 2), tested at the boundary in `250`.
  - *Forecast after a recipe change:* portions follow the version sold (`251`), so a recipe change does not rewrite the past.
  - *Discards dated by calendar date while sales use the business date:* the report follows `waste_costs` (M15); a discard at 00:30 belongs to the new calendar day (A5).
  - *Broken recipe graphs:* skipped and counted, never failing the list (`250`).
- **Unverified (proved in the named step)**
  - **T1:** `app.batch_requirements` raises P0001 (as `app.plate_raw_needs` does, read in `20261106100100`) for a broken graph, so the per-recipe exception block catches it. Source for `batch_requirements`: the M22 plan only, not its body. Proved by the broken batch recipe case of `250` (3), which asserts the SQLSTATE. If it raises another SQLSTATE, the block catches that code too, and the step records it.
  - **T2:** `app.local_instant(date, '00:00', tz)` returns the local midnight on both DST days. Source: its use in M22 §3.4 with other times. Proved by the three DST lot cases of `250` (3).
  - **T3:** `app.dashboard_summary_at`'s body can be copied verbatim from `20261112100600` once PR #41 merges. If review changes it, step 6 copies the merged version. Proved by the before/after comparison in `253` (6).
  - **T4:** `app.require_day_closer()` is owner/admin only, as M22 uses it. Proved by `254` (7).
  - **T5:** `src/server/menu/schemas.ts` exposes its 2-decimal price refinement for reuse. If it is not exported, step 11 exports it without changing its behaviour, and the existing `tests/server/menu/schemas.test.ts` stays green in step 11's run.
- **Performance and cost:** no figure promised. The push list reads only candidates (indexed use-by and expiry); the forecast reads four business dates; the weekly report reads one week of movements and pushes. `256` is a regression net. No new provider, job or paid service.
- **Dependencies:** none added.
- **Plan changes to record in DigiAlto-Ops `clients/osteria-dei-rossi/context.md`:**
  - §3.5.1: `menu_item.is_pushed` is not a column; "pushed" is `push_until > now` (M17/M18 as built). M23 adds `public.menu_push` (ADR-026);
  - §3.3: `POST /api/menu/:id/push` is owner/admin; the chef reads push-list (no €) and forecast (no covers); discards-vs-push is owner/admin;
  - §3.11.2: no change; the chef stays without € (project V6).

## 7. Open questions for the founder (defaults in force for this build)

**Already decided and applied:** project Q16 = V6 (the chef sees no €); the project Q18 default cut-off of 02:00; M22 Q145–Q155 answered; M21 Q128 (a table counts on the evening it is closed).

**Still open from earlier plans:** project Q4 (fixed costs; not used here); project Q13 and Q14 (GDPR roles and retention, which also cover `menu_push`).

**New:**
- **Q156 What temporary price may a push carry?**
  - **Default:** any price above 0,00 € and not above the plate's menu price, in cents. We set no discount level: you type the price each time.
  - **Alternative:** any price, even above the menu price (→ V1).
- **Q157 How long does "push today" last?**
  - **Default:** until the end of today's service, i.e. your cut-off (02:00 by default; 03:00 on the night the clocks go forward). You can remove it earlier with one tap.
  - **Alternative:** also "until tomorrow's close" (→ V2).
- **Q158 Who may push a plate?**
  - **Default:** you and the admin, as for every menu change. The chef sees the list and asks.
  - **Alternative:** the chef too, without changing the price (→ V3).
- **Q159 How far ahead does the push list look?**
  - **Default:** the PRD's expiry rule: prepared dishes whose use-by is within 24 hours, and raw lots expiring today or tomorrow.
  - **Alternative:** a longer horizon of N hours, chosen by you (→ V4).
- **Q160 Expired stock.**
  - **Default:** never offered as a push; shown as "N scaduti da scartare", with links to Produzione and Magazzino. Please confirm.
- **Q161 How is the "cost at risk" of a raw lot valued?**
  - **Default:** the quantity left × the price paid for that lot (its invoice line). A dish batch uses the cost frozen when it was made. When a cost is not known, the line says "costo non noto" and the total says how many are missing.
  - A different basis (for example the current average price) is a re-plan.
- **Q162 Forecast: what if you were closed on one of the four weekdays?**
  - **Default:** that week is left out, and the average is over the weeks you were open ("media di 3 settimane").
  - **Alternative:** always divide by four (→ V5).
- **Q163 May the chef see expected covers?**
  - **Default:** no. Covers are a KPI only you and the admin see (role table, project §3.11.2). The chef sees portions and plates.
  - **Alternative:** yes (→ V6).
- **Q164 Which days can the forecast show?**
  - **Default:** today and tomorrow on the screen; the API accepts up to six days ahead. Please confirm.
- **Q165 Should thrown-away raw ingredients be in the weekly "discards vs push" report?**
  - **Default:** no. The PRD links this report to shelf lives set wrong, which are the chef's recipe values, so it covers prepared dishes only. Raw waste is already in the waste € report (M15/M22).
  - **Alternative:** add raw ingredients (→ V7).
- **Q166 Which week does the report open on?**
  - **Default:** the current week, as "Non mappati"; you pick last week with the week picker. Please confirm.
- **Q167 When does a discarded batch count as "pushed"?**
  - **Default:** if a plate that uses it was pushed at any moment between when the batch was made and when it was first thrown away. Please confirm; a different rule is a re-plan.
- **Q168 Gate 4: how do we show that you use the push list unprompted?**
  - **Default:** no new counter. The evidence is the pushes recorded in the app (who and when, from `menu_push`) plus the weekly opens of Oggi (M22), where the list sits on top.
  - Counting opens of the "Da spingere" screen would be a separate small change, planned if you want it.

**Assumptions (please confirm; a different answer means a re-plan, not a variant):**
- **A1:** "push today" is per plate (menu item), as the PRD says. Drinks and dishes without a recipe can be pushed too; they just never appear on the list.
- **A2:** the forecast counts the plates of closed tables by the evening they were closed (M21 rule), the same figures as the KPI report.
- **A3:** if you change a plate's menu price during a push, the push price stays until the push ends.
- **A4:** the list's "plates that use them" are the dishes on the menu today (active items, current recipe versions).
- **A5:** discards are dated by the day they were entered, as in the waste report.

**Technical, resolved inside the build:** T1–T5 (§6).

## 8. Manual steps for the founder

- None are needed to build, test or merge M23. The migrations reach staging through the existing deploy job after merge (and after PR #41).
- After merge, DigiAlto checks on staging that a push from `/spingere` pins the plate on a waiter device, and that the pin is gone after the cut-off.
- **Gate 4 evidence (supervised run):** with your approval, DigiAlto reads the pushes in the Supabase SQL editor with `select created_at, action, push_price from public.menu_push order by created_at`. The query is written in the PR description and in `clients/osteria-dei-rossi/context.md` in DigiAlto-Ops.
- Answer Q156–Q168 when convenient. A different answer to Q156–Q159, Q162, Q163 or Q165 triggers its variant as a follow-up PR.

## 9. Sources

- Worktree `/home/user/osteria-m23` (M22 head `4f77afb`):
  - `CLAUDE.md`, `docs/prd.md` (4.1, 4.4, 2.4, 3.2, Risks, Gates), `docs/plans/2026-10-21-project-plan.md` (§3.3, §3.5, §3.11.2, §5 M23, §5a M23, §5b V6), `docs/plans/2026-10-31-m22-kpi-reporting.md`, `docs/adr/adr-025-kpi-rollup.md`;
  - migrations `20261022140100`, `20261022140500`, `20261023110000`, `20261026100400`, `20261028100000`, `20261028100100`, `20261029100200`, `20261029100600`, `20261030100700`, `20261031100000`, `20261031100100`, `20261031100200`, `20261101100000`, `20261101100100`, `20261101100300`, `20261101100600`, `20261106100100`, `20261106100300`, `20261107100000`, `20261108100100`, `20261108100200`, `20261112100000`, `20261112100200`, `20261112100700`, `20261112100800`;
  - `src/server/dashboard/constants.ts`, `src/app/api/reports/kpis/route.ts`, `src/lib/money/format.ts`, `src/lib/time/format.ts`, `src/lib/nav/nav-model.ts`; the push assertions of pgTAP `150`, `153`, `162`, `163`, of `tests/integration/order-entry.int.ts`, and the `comingSoon` assertions listed by `grep comingSoon`.
- No web source was needed: M23 adds no library and uses only Postgres and Next.js features already in the codebase.
