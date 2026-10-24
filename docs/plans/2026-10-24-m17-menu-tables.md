# Tech plan — Osteria Digitalization · M17 Menu items and tables (status, covers, coperto)

- **Client slug / internal:** `osteria-dei-rossi`.
  - The approved client facts in `docs/client-facts.md` are the trading name, the brand colours and the fonts. M17 needs no other client fact.
  - **The drafts in `docs/client/` (menu, prices, coperto, per-etto items) are not used** by any fixture, seed or UI text. They only inform open questions Q71 and project Q5.
  - Every fixture is fake:
    - tenants "Osteria Demo A/B"; users "Titolare Demo", "Admin Demo", "Chef Demo", "Cameriere Demo", "Cameriere Due Demo";
    - locations "Cella (demo)" and "Dispensa (demo)" (two, on purpose: lesson 1);
    - tables "Tavolo 1 (demo)" … "Tavolo 5 (demo)";
    - plate recipe "Spezzatino con polenta (demo)" (M14 §3.8 stew), menu items "Spezzatino con polenta (demo)" 14,00 € (mapped) and "Acqua (demo)" 2,00 € (unmapped);
    - coperto 1,50 € per person, VAT 10 % (tenant A); no coperto (tenant B). All prices are invented.
- **Repo and branch:** `osteria-dei-rossi-app`, worktree `/home/user/osteria-m17`, branch `feat/m17-menu-tables` from `main` (= `origin/main` after M16's merge; M0–M9 and M11–M16 merged, M10 deferred), one draft PR.
- **Numbering:** migrations `20261031100000`–`20261031100900`, pgTAP `150`–`159`, ADR-016, questions from Q68, e2e `e2e/menu-tables.spec.ts`. Variants V1–V6 belong to this plan; the project plan's chef variant is written "project V6".
- **Shared check constraints:** M17 re-creates `audit_event_entity_type_check` and `audit_event_action_check` (step 1).
  - The new lists are **the union of every value of every earlier migration** (latest: `20261030100000_rules_settings.sql`, 11 entity types and 26 actions) plus M17's.
  - `tests/config/check-constraint-union.test.ts` fails CI otherwise.
  - A later milestone that re-creates them must keep M17's values.
  - The alert kinds are registry rows (`app.alert_kind`); **M17 adds no kind**.
- **Author:** architect · **Date:** 2026-10-24
- **ADR:** `docs/adr/adr-016-menu-and-tables.md` (proposed). It records:
  - the price history;
  - coperto outside tenant settings, frozen at opening;
  - one open session per table;
  - the derived status and how M19 plugs in;
  - definer-only reads for waiters.
- **Sources:**
  - `docs/prd.md` 3.1 bullets 1–3, Data model `menu_item` and `table_session`, Scope "Orders: tables…";
  - project plan §3.3 (menu/tables, orders rows), §3.5.1 (tenant settings, menu_item, table_session, order_line), §3.6, §3.8, §3.11.2 with project V6, §5 (M17 row), §5a.3 M17 (AT1–AT5) and M18–M23, §7 Q5, Q14, Q20;
  - plans M7, M8 (§3.8 contract for M17), M11, M14, M15, M16; ADR-002, -003, -005, -007, -008;
  - the SQL in §2. **Where the SQL and a plan differ, the SQL wins.**

> **Flags for the founder (read first)**
> - **Table names come from you.** You type them on the new screen "Tavoli · impostazioni" (project Q5). The code ships no real names.
> - **Coperto is off until you set it** on the same screen. When it is set, it is fixed on each table when the table is opened: covers × amount. Changing it later does not change tables already opened.
> - **The menu price is the price the waiter sells at.** For a dish with a recipe it also replaces the recipe's price in the margin screens (Q74). A price change keeps the old price in a history, so past margins stay right.
> - **The chef does not see the menu or the tables in M17.** The kitchen gets its ticket list in M19 (Q70).
> - **No new dependency, secret, provider, scheduled job or alert.**
> - Q68–Q74 (§7) have **defaults in force for this build**. They go in the PR body.

## 1. Goal and scope

- **Goal:** the waiter sees the venue's tables with their live status and opens one with its covers; the owner manages the menu items (price, VAT, recipe mapping) and the table names, so that M18 can take orders against them.
- **In scope:**
  - `menu_item` + `menu_item_price` (history):
    - category, default course, nullable `recipe_key` (null = `unmapped`), price, VAT rate, position, availability, active;
    - push columns for M23 (`push_until`, `push_price`), read-only in M17.
  - `dining_table` (names, order, active) and `sale_settings` (coperto per person and its VAT rate).
  - `table_session`:
    - open with covers; client-generated id; coperto frozen at opening;
    - covers change; "conto richiesto" flag;
    - several waiters on one table.
  - Derived status: free, open, courses sent, bill requested, closed. "Courses sent" comes from a stub that M19 replaces.
  - `app.plate_cost_rows` uses the menu price and VAT for mapped plates (M8 §3.8 contract).
  - APIs (§3.4); screens `/tavoli` (waiter, owner, admin), `/tavoli/impostazioni` and `/menu` (owner, admin); "Tavoli" and "Menu" tabs.
- **Out of scope:**
  - order lines, courses on lines, `menu_availability()` from stock, push pin in the menu UI (M18);
  - firing and kitchen tickets (M19); offline queue (M20); bill, close, receipt, day close (M21);
  - `POST /api/menu/:id/push` and push list (M23); allergen matrix (project Q21); floor plan (PRD: grid only);
  - seed data in `supabase/seed.sql` (unchanged).

## 2. Current state (worktree on `main` after M16)

- **Tenancy and roles (M0, M11):**
  - `app.tenant_id()`, `app.role()`, `app.app_user_id()` read the live `app_user` row.
  - `tenant.settings jsonb` is readable by **every** member (`tenant_select`); `20261023110000_cost_settings.sql` says: "Tenant settings hold no euro value".
  - **There is no `coperto_amount` anywhere** (grep of `supabase/`, `src/`).
  - Staff sign in by PIN (M11). Waiters exist as `app_user.role = 'waiter'`. Waiter screens are not built yet; `/` shows them a greeting only.
- **Settings (M8):** `app.cost_settings(tenant)` gives `sale_vat_pct` (default 10, range 0–30), `app.setting_number`; `GET/PATCH /api/settings` (owner, admin) edits the three cost settings; `app.allowed_vat_rates()` = `{0,4,5,10,22}` (`20261022130200`).
- **Recipes (M7):**
  - `recipe_key (type batch|plate|sub, current_version, name_norm, is_active)`; immutable `recipe`;
  - `recipe_price (recipe_id, sale_price, target_gp_pct)` per plate version, chef-readable; `v_recipe_current`.
  - RLS: owner, admin, chef; **no grant to `service_role`** (lesson 2: never read with the secret key).
  - `GET /api/recipes?type=plate&active=true` lists plates for owner/admin/chef.
- **Costs (M8):**
  - `app.plate_cost_rows(p_tenant, p_keys, p_date, p_include_fixed)` takes the price from `recipe_price` and the scalar `sale_vat_pct`. It is used by `plate_costs`, `plate_margins_pct`, `recipe_cost_at`, `app.price_variance_payload`. It is **not md5-pinned** (`058` checks its privileges only).
  - `app.plates_sold` is a stub replaced by M19/M21: the precedent for M17's fired-lines stub.
- **Batches (M14, M15):** `batch`, `batch_movement`, `v_batch_portions (batch_id, portions_remaining)` (owner/admin/chef; select granted to `service_role`); `app.business_date(tenant, at)` (cut-off, DST-safe, `20261029100100`).
- **Audit:** the last definitions of both checks are in `20261030100000_rules_settings.sql`.
  - **`030_audit_event.test.sql` line 44 uses `'menu_item'` as its example of an unknown entity type.** It must change when M17 adds that type (step 1).
  - `src/lib/counts/count-view.ts` `AUDIT_ACTIONS` + `audit.action.*` words; `tests/lib/counts/count-view.test.ts` requires a word for each.
  - `public.audit_log` labels known entity types and returns null for others.
- **Role scans:**
  - `004`: waiter-readable columns must not match `cost|margin|unit_price|total_cost|price_history|gp_pct|last_price`.
  - `059`: chef/waiter-readable columns must not match `cost|margin|price|prezz|gp_pct|_eur$|amount|total|importo`, except chef `recipe_price.sale_price/target_gp_pct`. The public functions named `cost|margin|price` are an exact list of 13 that must 42501 for chef and waiter.
  - **Both need a fixture row in every public table.**
- **UI:**
  - the `(owner)` route group (used by every role), `OwnerNav` with role-gated tabs, `src/lib/nav/is-current.ts`;
  - `src/components/ui.tsx` (`Field` wraps its control in a `<label>`, `Select`, `TextInput`, `Button`, `Badge`, `Card`, `ErrorAlert`, `Heading`, `Muted`, `LedgerList`);
  - helpers `formatEuro` (`1.234,50 €`), `formatTime` (Europe/Rome), `parseDecimal`; `expectPhoneFriendly` (44 px, no overflow).
- **Tests infra:** `scripts/test-db-races.sh` (`two_sessions_as`, `s2_blocked`, `no_deadlock`); integration helpers `tests/integration/helpers/{stack,sql}.ts`; e2e `createOwner`, `createStaff`, `signInWithMagicLink`, `seedStewRecipe`.
- **Missing:** every M17 table, procedure, endpoint and screen.

## 3. Design

### 3.1 Decisions

1. **Menu item shape (mutable row + price history; ADR-016).**
   - `menu_item` fields:
     - `name` (1–80), `name_norm` (generated `app.normalise_name(name)`), `category` (1–40, free text typed by the owner);
     - `course_default public.course`; `recipe_key uuid null`; `position int 0–9999`;
     - `is_available` (manual "esaurito"), `is_active` (deactivation instead of delete);
     - `push_until timestamptz null`, `push_price numeric(12,2) null`.
   - **`unmapped` = `recipe_key is null`.** It is accepted (PRD 2.3; AT5) and flagged in the owner list. M22 reports it weekly.
   - A mapping must be an **active `plate`** key of the tenant. A key deactivated later keeps the mapping and is shown "Ricetta disattivata".
   - At most one active item per recipe key (partial unique index; Q69 → V2) and one active item per name.
   - **Price and VAT rate** live in `menu_item_price (price numeric(12,2) 0–10 000, VAT included; vat_rate ∈ app.allowed_vat_rates(); valid_from)`, append-only.
     - Create inserts the first row. A patch that changes price or VAT inserts a new row with `valid_from = greatest(clock_timestamp(), last + 1 µs)`, the M8 pattern.
     - The current price is the newest row with `valid_from ≤ now()`.
   - **`course public.course` enum** = `antipasti, primi, secondi, dolci, bevande` (PRD 3.2, in service order). M18 reuses it for `order_line.course`. "Segue" is a marker, not a course (M18).
   - **Push (M23):** pushed now ⇔ `push_until > now()`. The PRD's `is_pushed` boolean is not stored (it would go stale). `push_price` requires `push_until`. M17 has no writer for them; M23's `POST /api/menu/:id/push` writes them.
   - Every create and update writes one `audit_event` (`menu_item.created`, `menu_item.updated` with before/after of the changed fields, price and VAT included, so `/registro` shows them). A patch that changes nothing writes nothing.
2. **Coperto (ADR-016).**
   - `sale_settings` (one row per tenant; absent = no coperto): `coperto_amount numeric(12,2) (0, 100]`, `coperto_vat_rate ∈ allowed`; both set or both null. Owner/admin read and write; audited `sale_settings.changed`.
   - **At opening** `open_table` copies both into `table_session.coperto_amount` (per person) and `coperto_vat_rate`.
   - `coperto_total numeric(12,2) generated always as (covers * coperto_amount) stored` is null when unset ("none", AT3).
   - A covers change recomputes the total from the **frozen** per-person amount. A settings change never touches existing sessions.
   - M21 reads `coperto_total` and `coperto_vat_rate` for the bill.
3. **Tables.**
   - `dining_table (name 1–40, name_norm, position, is_active)`; unique active name.
   - The real names are entered by the owner (project Q5).
   - Deactivating a table with an open session → 409 `table_open`.
   - A rename applies to new sessions only: `table_session.table_name` is a snapshot (PRD field) for tickets and bills.
4. **Table session.**
   - `id uuid` from the client (M20; required in the API body).
   - Columns: `dining_table_id`, `table_name`, `covers smallint 1–99` (`MAX_TABLE_COVERS`; Q72 → V5), `opened_at`, `opened_by` (the PRD's `waiter_id`; owner and admin may open too), `business_date` (= `app.business_date(tenant, opened_at)`, M15 cut-off);
   - coperto columns (decision 2); `bill_requested_at/by`; `closed_at`, `closed_by` (written by M21's `close_table`; null in M17); `created_*`, `updated_*`.
   - Partial unique index `table_session_open_uq (tenant_id, dining_table_id) where closed_at is null`.
   - Guard trigger `app.table_session_guard`: identity, table, name snapshot, opening facts, business date and coperto columns never change; a closed session never changes. M21 replaces the guard to allow its closing columns.
   - **Several waiters:** no owner of a session. Any waiter, owner or admin of the tenant may change covers or the bill flag of any open session. The list shows the **opener** as "waiter". M18 records who edits each line (`order_line.updated_by`).
5. **`open_table` concurrency (AT2).**
   - Order of operations: role check → tenant → `select … from dining_table where tenant_id and id for update`.
     - missing → P0002 `table_not_found`; inactive → `table_inactive`.
   - Then the session with `p_session`:
     - it exists for this table and is open → return it with `created: false` (idempotent replay, 200);
     - it exists for another table, or for another tenant (PK collision) → `session_id_conflict` (409, no detail);
     - it exists and is closed → `session_closed` (409).
   - Then any open session of the table → `table_already_open` (409, details = the open session's public fields).
   - Otherwise insert. A `unique_violation` on `table_session_open_uq` (only reachable without the lock) maps to `table_already_open`.
   - Opens of different tables never wait for each other. Proven by the race cases (step 10).
6. **Derived status (AT1).**
   - `app.table_status(p_has_session boolean, p_closed_at timestamptz, p_bill_requested_at timestamptz, p_fired_lines integer) returns text`, immutable:
     - no session → `free`; `closed_at` set → `closed`; bill requested → `bill_requested`; `p_fired_lines > 0` → `courses_sent`; else `open`.
   - **The session shown for a table:**
     - its open session;
     - else its latest session (by `opened_at`, `id`) with `business_date` = today's business date, which is closed → `closed` (Q68 → V1);
     - else none → `free`. A closed table can be opened again at once.
   - **"Courses sent" before M19 exists:** `app.session_fired_lines(p_tenant uuid, p_session_ids uuid[]) returns table (table_session_id uuid, fired_lines integer)`. M17 ships it **returning no rows**.
     - `app.session_statuses(p_tenant, p_session_ids)` joins it and calls `app.table_status`.
     - **M18** creates `order_line` and does not touch either function.
     - **M19**, in the migration that adds `fired_at` writes, runs `create or replace function app.session_fired_lines` with the same signature: `select l.table_session_id, count(*)::int from public.order_line l where l.tenant_id = p_tenant and l.table_session_id = any(p_session_ids) and l.fired_at is not null group by 1`. A fired line that is later voided still counts, because the course was sent. M19 then re-pins it in `159`.
7. **Who reads what (§3.11.2, project V6; ADR-016).**

   | Object / action | owner | admin | chef | waiter | DB enforcement | API |
   |---|---|---|---|---|---|---|
   | `menu_item`, `menu_item_price`, `dining_table`, `table_session`, `sale_settings` direct SELECT | ✓ | ✓ | 0 rows | 0 rows | RLS policies name owner, admin only | none |
   | `menu_list()` (service menu) | ✓ | ✓ | 42501 | ✓ | `app.require_service_reader()` | `GET /api/menu` |
   | `tables_list()` | ✓ | ✓ | 42501 | ✓ | same | `GET /api/tables` |
   | `open_table`, `update_table_session` | ✓ | ✓ | 42501 | ✓ | `app.require_table_operator()` | `POST /api/tables/:id/open`, `PATCH /api/table-sessions/:id` |
   | `menu_items_manage`, `create_menu_item`, `update_menu_item`, `dining_tables_manage`, `create_dining_table`, `update_dining_table`, `sale_settings_read`, `set_sale_settings` | ✓ | ✓ | 42501 | 42501 | `app.require_menu_writer()` | `/api/menu/items`, `PATCH /api/menu/:id`, `/api/dining-tables*`, `/api/settings/coperto` |

   - Every public function is `security definer`, `set search_path = ''`. It checks the role **first**, takes the tenant from `app.tenant_id()` and the user from `app.app_user_id()`, filters every statement by tenant, and is executable by `authenticated` only. Every `app.*` helper is revoked from all API roles.
   - **Naming rule:** no new public function name matches `cost|margin|price` (the `059` exact list stays at 13; `159` checks).
   - **Prices are sale prices, not costs:** the waiter's menu and tables payloads carry `price`, `pushPrice` and `coperto`. They never carry a cost, margin, GP, food-cost or recipe key. This is pinned by key scans (`153`, `157`) and JSON-schema snapshots (step 11).
   - The chef gets 403 (Q70 → V3).
8. **Margins use the menu price (M8 §3.8 contract; Q74 → V6).**
   - `app.plate_cost_rows` is re-created with the same signature and output. For each plate key, price and VAT come from the active menu item mapping it, at the row in force at `coalesce(v_at, now())`. Otherwise the function falls back to `recipe_price.sale_price` and `sale_vat_pct`, as today.
   - `vat_pct` becomes per row. `058`, `061`, `063` stay green unchanged (their fixtures have no menu item).
9. **Implicit defaults (lesson 1).** M17 resolves no location. Every default it resolves is tested with ≥ 2 candidates:
   - the price in force (several history rows, one in the future);
   - the session shown for a table (closed + open, two closed);
   - the waiter shown (opener vs a second waiter who edits);
   - the recipe name (two versions);
   - the coperto and the default VAT rate offered by the forms (two tenants with different settings: A 1,50 € / 10 % and `sale_vat_pct` 10; B none and `sale_vat_pct` 22);
   - integration fixtures with **two locations**, to show nothing depends on one.
   - The procedures take no implicit VAT rate: `vatRate` is required in the bodies. The forms are pre-filled from `defaults.vatRate` (the caller tenant's `sale_vat_pct` when it is an allowed rate, else null).
10. **Time and dates.**
    - `opened_at` is a server instant. `business_date` comes from M15's helper (DST cases in `155`).
    - The UI shows "aperto alle 20:15" (Europe/Rome). When the business date is not today, the server sets `openedToday: false` and the UI shows the date too.
11. **Personal data.**
    - No guest data: covers are a count.
    - Staff user ids (`opened_by`, `bill_requested_by`, `updated_by`, audit rows) and display names, shown to colleagues on the tables list (an operational need, already visible in the app).
    - No processor; nothing leaves Supabase (EU). Retention follows project Q14.

### 3.2 Data model and procedures

**`20261031100000_menu_tables_core.sql`** (step 1)
- `create type public.course as enum ('antipasti','primi','secondi','dolci','bevande')`.
- Tables: `menu_item`, `menu_item_price`, `dining_table`, `table_session`, `sale_settings`.
  - Each has `id`, `tenant_id not null default app.tenant_id()`, `created_at`, `created_by` (+ `updated_at`, `updated_by` on the mutable ones), and composite FKs `(tenant_id, …)` to `recipe_key`, `menu_item`, `dining_table`, `app_user`. Checks per §3.1.
  - Indexes:
    - `menu_item_name_uq (tenant_id, name_norm) where is_active`; `menu_item_recipe_uq (tenant_id, recipe_key) where is_active and recipe_key is not null`;
    - `menu_item_price_idx (tenant_id, menu_item_id, valid_from desc)`;
    - `dining_table_name_uq (tenant_id, name_norm) where is_active`;
    - `table_session_open_uq`, `table_session_day_idx (tenant_id, business_date, dining_table_id)`;
    - `sale_settings_tenant_uq (tenant_id)`.
- Triggers:
  - `menu_item_price` append-only (`app.append_only`, `app.append_only_truncate`);
  - no-delete and no-truncate on the other four;
  - `app.menu_item_guard` (id, tenant, created_* immutable);
  - `app.table_session_guard` (§3.1.4); `app.dining_table_guard`.
- RLS on all five: one `select` policy, `tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner','admin')`.
- `revoke all … from anon, authenticated, service_role; grant select … to authenticated, service_role` (lesson 2). No INSERT/UPDATE/DELETE grant for any API role.
- Audit checks re-created:
  - entity types: every earlier value + `menu_item`, `dining_table`, `table_session`, `sale_settings`;
  - actions: every earlier value + `menu_item.created`, `menu_item.updated`, `dining_table.created`, `dining_table.updated`, `table_session.covers_changed`, `sale_settings.changed`.

**`20261031100100_menu_tables_helpers.sql`** (step 2). Schema `app`, `search_path = ''`, revoked from every API role.
- `app.require_service_reader()` (owner, admin, waiter), `app.require_table_operator()` (owner, admin, waiter), `app.require_menu_writer()` (owner, admin): 42501 otherwise.
- `app.table_status(boolean, timestamptz, timestamptz, integer) returns text` (immutable).
- `app.session_fired_lines(uuid, uuid[])` (stub, no rows); `app.session_statuses(p_tenant uuid, p_session_ids uuid[]) returns table (table_session_id uuid, status text)`.
- `app.menu_item_price_at(p_tenant uuid, p_items uuid[], p_at timestamptz) returns table (menu_item_id uuid, price numeric, vat_rate numeric, valid_from timestamptz)`.
- `app.coperto_settings(p_tenant uuid) returns table (amount numeric, vat_rate numeric)` (zero rows when unset).
- `app.default_vat_rate(p_tenant uuid) returns numeric`: `sale_vat_pct` if allowed, else null.

**`20261031100200_menu_procedures.sql`** (step 3)
- `public.create_menu_item(p_body jsonb) returns jsonb`.
  - Keys: `name`, `category`, `course`, `recipeKey` (uuid or null), `price` (≥ 0, ≤ 10 000, 2 dp), `vatRate` (allowed), optional `position` (default 0), `available` (default true). Unknown key or wrong type → `invalid_request`.
  - Errors:
    - `menu_item_name_taken` (409); `recipe_already_on_menu` (409);
    - `recipe_not_found` (P0002, includes other tenants); `recipe_not_plate`, `recipe_inactive`;
    - `price_invalid`, `vat_rate_invalid`, `position_invalid`, `name_invalid`, `category_invalid` (422).
  - Inserts the item and its first price row. Audit `menu_item.created`.
- `public.update_menu_item(p_item uuid, p_patch jsonb) returns jsonb`.
  - Keys ⊆ `{name, category, course, recipeKey, price, vatRate, position, available, active}`; at least one; push keys are unknown keys.
  - Locks the row `for update`. Price/VAT change → new history row; others → row update. One audit `menu_item.updated` (changed fields only); nothing changed → `{changed: false}` and no write.
  - Reactivation re-checks the name and the mapping uniqueness. `menu_item_not_found` (P0002).

**`20261031100300_menu_reads.sql`** (step 4)
- `public.menu_list() returns jsonb` (`require_service_reader`):
  ```
  {categories: [{name, items: [{id, name, category, course, price, available, pushed, pushPrice}]}]}
  ```
  - Active items only. `pushed = push_until > now()`; `pushPrice` = `push_price` when pushed, else null.
  - Categories are ordered by min(position), then name (`collate "C"`); items by position, name, id.
- `public.menu_items_manage() returns jsonb` (`require_menu_writer`):
  ```
  {defaults: {vatRate}, vatRates: [0,4,5,10,22], courses: [...], categories: [names],
   items: [{id, name, category, course, position, recipeKey, recipeName, recipeActive, unmapped, price, vatRate,
            priceValidFrom, available, active, pushUntil, pushPrice}]}
  ```
  - All items, active first. `recipeName` from `v_recipe_current` (definer, tenant-filtered).
  - No cost, margin or GP key (owner costs stay on `/costi`).

**`20261031100400_dining_tables_coperto.sql`** (step 5)
- `public.create_dining_table(p_body jsonb)`: `{name, position?}`, audit `dining_table.created`.
- `public.update_dining_table(p_table uuid, p_patch jsonb)`: `{name?, position?, active?}`.
  - Errors: `table_name_taken` (409), `table_open` (409 on deactivation), `table_not_found`, `name_invalid`, `position_invalid`.
  - Audit `dining_table.updated`.
- `public.dining_tables_manage() returns jsonb`: `{tables: [{id, name, position, active, open}]}`.
- `public.sale_settings_read() returns jsonb`: `{coperto: {amount, vatRate} | null, defaults: {vatRate}, vatRates}`.
- `public.set_sale_settings(p_patch jsonb) returns jsonb`.
  - `{copertoAmount: number (0,100], 2 dp | null, copertoVatRate: allowed | null}`; both null clears the coperto; one null → `coperto_invalid`.
  - Upsert under `for no key update` of the tenant row. Audit `sale_settings.changed` (before/after); nothing changed → no write.

**`20261031100500_table_sessions.sql`** (step 6)
- `public.open_table(p_table uuid, p_session uuid, p_covers integer) returns jsonb` (§3.1.5). It returns:
  ```
  {created, session: {id, tableId, tableName, covers, openedAt, businessDate, waiter: {id, displayName},
                      billRequested, coperto: {perPerson, vatRate, total} | null}}
  ```
  - Errors: `covers_invalid` (422), `table_inactive` (422), `table_already_open`, `session_id_conflict`, `session_closed` (409), `table_not_found` (P0002).
- `public.update_table_session(p_session uuid, p_patch jsonb) returns jsonb`.
  - Keys ⊆ `{covers, billRequested}`; locks the session row.
  - Closed → `session_closed`; not found or other tenant → `session_not_found` (P0002).
  - `covers` change → audit `table_session.covers_changed` (before/after covers and `coperto_total`).
  - `billRequested` sets or clears `bill_requested_at/by` (no audit; the columns record who and when).
  - Returns the session shape above plus `status`.

**`20261031100600_tables_read.sql`** (step 7)
- `public.tables_list() returns jsonb` (`require_service_reader`):
  ```
  {businessDate, tables: [{id, name, position, status,
    session: null | {id, covers, openedAt, openedToday, waiter: {id, displayName}, billRequested, coperto}}]}
  ```
  - Active tables, ordered by position, name (`collate "C"`), id. The session per §3.1.6; status from `app.session_statuses`.
  - One set-based query; no per-table loop.

**`20261031100700_plate_cost_menu_price.sql`** (step 8): `create or replace function app.plate_cost_rows(…)` per §3.1.8, same signature and output columns, same `security definer`, `search_path`, revokes.

`20261031100800`–`20261031100900` are kept free for review fixes.

### 3.3 Contracts for later milestones

- **M18 (order entry):**
  - `order_line.menu_item_id` → `menu_item (tenant_id, id)`; `course public.course` defaulting to `course_default`.
  - At add time, `unit_price` = `push_price` when pushed, else the current `menu_item_price.price`. The line also **stores the VAT rate in force** (needed by M21's bill and M22's revenue net of VAT).
  - `menu_availability()` combines `is_available` with portions: item → `recipe_key` → current plate version → `recipe_line.sub_recipe_key` of type batch → `v_batch_portions`. Unmapped items have no stock limit.
  - Lines are accepted only on an open session (closed → conflict, §3.8 of the project plan).
  - New `order_line` columns must not let `004`/`059` see `unit_price` through a waiter policy: waiter reads go through definer functions, as here.
  - The waiter menu shape may gain `portionsLeft` (M18 AT2); the snapshot is updated on purpose.
- **M19:** replaces `app.session_fired_lines` (§3.1.6) and re-pins it in `159`. Kitchen tickets read `table_session.table_name`, through a definer read or a new chef policy that exposes no `coperto_*` column.
- **M20:** the op `open_table {tableId, sessionId, covers}` is idempotent by `sessionId`. A 409 `table_already_open` carries the current session (the conflict warning). `GET /api/menu` and `GET /api/tables` are role-independent shapes, so a shared device's cache never holds another role's data.
- **M21:**
  - `close_table` sets `closed_at`, `closed_by` and its receipt columns, and replaces `app.table_session_guard` to allow them.
  - The bill's coperto line = `coperto_total` at `coperto_vat_rate` (none when null).
  - The business date of a sale is M21's rule (AT4 "closed at 00:40"). M17's `business_date` is the opening's.
- **M22:** unmapped items = `menu_item.recipe_key is null` among sold lines.
- **M23:**
  - `push_menu_item` writes `push_until` and `push_price` (audited `menu_item.updated`, a new action value only if M23 needs one).
  - `menu_list` already derives `pushed` and `pushPrice`; "after `push_until` no longer pinned" holds by construction (`153`).

### 3.4 API

All routes:
- use `withApi` with the user-session client;
- take strict Zod bodies (unknown key → 400), `application/json` on writes (else 415), `MAX_MENU_BODY_BYTES` = 4 KiB (413);
- validate ids with a uuid schema (malformed → 400 `invalid_request` before any RPC);
- return errors as `{"error":{"code","message","details?"}}`.

| Endpoint | Roles | Body | Success | Errors |
|---|---|---|---|---|
| `GET /api/menu` | owner, admin, waiter | — | 200 service menu | 401; 403 chef |
| `GET /api/menu/items` | owner, admin | — | 200 manage shape | 401; 403 |
| `POST /api/menu/items` | owner, admin | `{name, category, course, recipeKey, price, vatRate, position?, available?}` | 201 `{item}` | 400; 403; 404 `recipe_not_found`; 409 `menu_item_name_taken`, `recipe_already_on_menu`; 413; 415; 422 `recipe_not_plate`, `recipe_inactive`, `price_invalid`, `vat_rate_invalid` |
| `PATCH /api/menu/:id` | owner, admin | any of the keys above + `active` | 200 `{changed, item}` | as POST + 404 `menu_item_not_found` |
| `GET /api/dining-tables` | owner, admin | — | 200 | 401; 403 |
| `POST /api/dining-tables` | owner, admin | `{name, position?}` | 201 | 400; 403; 409 `table_name_taken`; 413; 415; 422 |
| `PATCH /api/dining-tables/:id` | owner, admin | `{name?, position?, active?}` | 200 | + 404; 409 `table_open` |
| `GET /api/settings/coperto` | owner, admin | — | 200 | 401; 403 |
| `PATCH /api/settings/coperto` | owner, admin | `{copertoAmount, copertoVatRate}` (both keys, null to clear) | 200 | 400; 403; 413; 415; 422 `coperto_invalid`, `vat_rate_invalid` |
| `GET /api/tables` | owner, admin, waiter | — | 200 tables list | 401; 403 chef |
| `POST /api/tables/:id/open` | owner, admin, waiter | `{sessionId, covers}` | **201** new / **200** replay `{created, session}` | 400; 403; 404 `table_not_found`; **409 `table_already_open`** (details: the open session), `session_id_conflict`, `session_closed`; 413; 415; 422 `covers_invalid`, `table_inactive` |
| `PATCH /api/table-sessions/:id` | owner, admin, waiter | `{covers?, billRequested?}` (≥ 1 key) | 200 `{session}` | 400; 403; 404 `session_not_found`; 409 `session_closed`; 413; 415; 422 `covers_invalid` |

- Services: `src/server/menu/{constants,schemas,output,errors,service-menu,manage}.ts`, `src/server/tables/{constants,schemas,output,errors,list,open,session,config,coperto}.ts`.
- Output schemas are strict. The waiter shapes (`serviceMenuOutput`, `tablesListOutput`, `openTableOutput`, `sessionOutput`) are the ones snapshot-tested.
- Error map: 42501 → 403, P0002 → 404, the P0001 codes → 409 or 422 per the table, anything else → 500 with the SQLSTATE only.

### 3.5 Screens (house style `docs/design/ui-foundation.md` §6/§8; 360 px first; 44 px targets; every screen reads `/api/*`; nothing computed in React)

- **`/tavoli`** (`src/app/(owner)/tavoli/{page,table-tile,open-table-dialog,session-panel}.tsx`; owner, admin, waiter):
  - `Heading` "Tavoli"; a two-column grid at 360 px (three from 640 px) of tiles, `data-table-id` on each.
  - Each tile: the name in bold; a `Badge` "Libero" / "Aperto" / "Portate inviate" / "Conto richiesto" / "Chiuso"; for a session, `.num` "4 coperti", "Cameriere Demo · 20:15" (date added when `openedToday` is false).
  - Tapping a free or closed tile opens the dialog:
    - `Field` "Coperti" (`inputmode="numeric"`) with "−" and "+" buttons (44 px), range 1–99;
    - primary "Apri tavolo". The page generates `crypto.randomUUID()` as `sessionId` and keeps it for a retry.
  - Tapping an open tile shows the panel:
    - the covers line and "Modifica coperti";
    - the coperto line "Coperto 6,00 €" when set (a sale charge, shown to the waiter as it will be on the bill);
    - a toggle button "Conto richiesto" (`aria-pressed`).
  - A 409 shows `ErrorAlert` "Il tavolo è già aperto da Cameriere Demo." and refreshes the list.
  - The list refetches every `TABLES_REFRESH_MS` (15 s) while the page is visible, and after each write.
  - Chef (403): one `ErrorAlert` "I tavoli non sono disponibili per il tuo ruolo.".
- **`/tavoli/impostazioni`** (`page`, `dining-table-row`, `coperto-card`; owner, admin):
  - "Nuovo tavolo" (`Field` "Nome", "Ordine"); one row per table with "Rinomina", order, "Attivo" switch;
  - `ErrorAlert` for `table_open` "Chiudi prima il tavolo aperto.".
  - Card "Coperto": `Field` "Coperto a persona (€)" (`inputmode="decimal"`, empty = nessun coperto), `Field` "Aliquota IVA del coperto" (`Select` of `vatRates`, pre-filled from `defaults.vatRate`), "Salva".
  - Muted note "Si applica ai tavoli aperti da ora in poi.".
- **`/menu`** (`page`, `menu-item-card`, `menu-item-form`; owner, admin):
  - Grouped by category. Each card: the name, `.num` "14,00 € · IVA 10 %", the course word ("Secondi");
  - badges "Senza ricetta" (warning, `unmapped`), "Ricetta disattivata", "Non disponibile", "Non attivo"; "Modifica".
  - "Nuovo piatto" form:
    - `Field` "Nome", "Categoria" (`TextInput` + `datalist` of `categories`), "Portata" (`Select` of `courses`);
    - "Ricetta" (`Select`: "Nessuna ricetta" + `GET /api/recipes?type=plate&active=true`);
    - "Prezzo (IVA inclusa)" (`inputmode="decimal"`, `parseDecimal`), "Aliquota IVA" (`Select`, pre-filled), "Ordine", "Disponibile" checkbox; "Attivo" in edit only.
  - Errors in Italian: "Esiste già un piatto con questo nome.", "Questa ricetta è già nel menu.", "Scegli una ricetta di tipo piatto.", "Prezzo non valido.", "Aliquota IVA non ammessa.".
  - Waiter and chef (403): `ErrorAlert` "Il menu non è modificabile con il tuo ruolo.".
- **Navigation:** `OwnerNav` gains "Tavoli" (`/tavoli`; owner, admin, waiter: `canUseTables`) and "Menu" (`/menu`; owner, admin: `canEditMenu`), hidden while the role is unknown. `isCurrent` marks `/tavoli` on `/tavoli/impostazioni` too. The home page gets both links; `/tavoli` shows an "Impostazioni" link for owner and admin.
- **Pure helpers:**
  - `src/lib/tables/table-view.ts`: `canUseTables`, `canConfigureTables`, `statusWord`, `statusTone`, `coversLine`, `openedLine`, `copertoLine`, `nextCovers`;
  - `src/lib/menu/menu-view.ts`: `canEditMenu`, `courseWord`, `badgesFor`, `priceLine`;
  - `src/lib/menu/menu-form.ts`: form state ↔ body, `parseDecimal`.

### 3.6 Flows

1. **Owner setup:** `/tavoli/impostazioni` → `POST /api/dining-tables` → `create_dining_table` → audit. `PATCH /api/settings/coperto` → `set_sale_settings` → audit. `/menu` → `GET /api/recipes?type=plate` + `GET /api/menu/items` → `POST /api/menu/items` → `create_menu_item` (item + price row + audit).
2. **Opening:** waiter `/tavoli` → `GET /api/tables` → `tables_list` → tap → `POST /api/tables/T/open {sessionId, covers}` → `open_table` (lock table → checks → insert with frozen coperto and business date) → 201 → refetch.
3. **Concurrent opening:** the second waiter's call waits on the table row lock → 409 `table_already_open` with the first session → `ErrorAlert` + refetch.
4. **During service:** `PATCH /api/table-sessions/S {billRequested: true}` → status `bill_requested`. M18 adds lines; M19 fires (status `courses_sent` through the replaced stub); M21 closes (`closed`).
5. **Tests:** pgTAP calls the functions with claims. Integration and e2e use the APIs. The secret key only creates staff (existing helper) and reads `table_session` / `menu_item_price` row counts (select granted to `service_role`), never `recipe` or `recipe_key`.

### 3.7 Secrets and configuration

| Name | Public? | Where it lives | Used by M17 |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public by design (existing) | Vercel env | the session client of every M17 route |
| `SUPABASE_SECRET_KEY` | **private** (existing) | Vercel env, server-only; locally `.env` (gitignored) | **not used by M17 `src/` code**; integration and e2e helpers use the local stack's key to create staff and count rows |
| `PIN_PEPPER`, `CRON_SECRET`, Vault values, `ANTHROPIC_API_KEY`, `EXTRACTION_MODEL_ID` | existing | Vercel env / Supabase Vault | not touched |
| Account logins (Vercel, Supabase, GitHub) | private | the account owner's password manager with MFA (project Q26); never in the repo or DigiAlto-Ops | humans |

No new secret, third-party key or provider.

## 4. Alternatives considered

- **Versioned (immutable) menu items:** rejected (ADR-016). Only the price needs history; order lines reference one stable row.
- **Mutable `menu_item.price` with history only in `audit_event`:** rejected. Margins "as of a date" would parse audit JSON or silently use today's price.
- **Menu price taken from `recipe_price` for mapped plates:** rejected. A price change would force a recipe version, and unmapped items need a price anyway.
- **`settings.coperto_amount` in `tenant.settings`:** rejected. The chef reads the tenant row (Q16 = V6, the M8 rule).
- **Coperto as an order line:** rejected. It would enter the kitchen and firing flows, and a covers change would edit lines.
- **A stored `status` column:** rejected. It duplicates session and order-line facts and drifts when M19 fires or voids.
- **"Courses sent" by an `order_line` table created now:** rejected. M18 owns its shape; a stub with a fixed signature (the M8 `plates_sold` precedent) is enough to define and test the derivation.
- **Advisory locks or `serializable` for opening:** rejected. A row lock on `dining_table` plus a partial unique index is simpler and is proven by the race cases.
- **Waiter RLS policies on the new tables:** rejected. Price-named columns would become waiter-readable (`059`), and every later column would need vetting.
- **A role-shaped `GET /api/menu`:** rejected. A shared device's service-worker cache (M20) could serve one role's shape to another; one shape for all readers, management data on `/api/menu/items`.
- **A `table_session_waiter` join table for "several waiters":** rejected for M17. No ownership is enforced, and M18's `updated_by` per line records who did what.

## 5. Build plan (test first; one commit per step; `tdd-guide` follows the order)

**Conventions** (as M14–M16):
- pgTAP sets claims with `set_config('request.jwt.claims', …)`. Fixtures that no procedure can write yet (a closed session, push columns, a replaced stub) are inserted or replaced as the migration owner inside the rolled-back test.
- Errors are asserted as `SQLSTATE message`.
- **Lists are sorted by name, so every test finds rows by id, never by index (lesson 4).**
- Implicit defaults use ≥ 2 candidates (§3.1.9, lesson 1).

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| 1 | Migration: course type, five tables, guards, RLS, grants (select to `service_role`), audit checks as the **union of every earlier value** + M17's; role-scan fixtures | `supabase/migrations/20261031100000_menu_tables_core.sql`, `supabase/tests/database/150_menu_tables_core.test.sql`, `supabase/tests/database/{004_waiter_cost_columns,059_cost_roles_v6}.test.sql` (one fixture row per new table; assertions unchanged), `supabase/tests/database/030_audit_event.test.sql` (the unknown-type example `'menu_item'` becomes `'not_an_entity'`; same assertion) | `150`: `enum_range(null::public.course)` = the five values in order; bounds → 23514 (name 81 chars, category '', position 10000, covers 0 and 100, price −0,01 and 10 000,01, VAT 12, coperto 0 and 100,01, `push_price` without `push_until`, coperto amount without VAT); `name_norm` = `app.normalise_name`; **two active items with the same name → 23505, an inactive duplicate is accepted; two active items on one recipe key → 23505; two open sessions of one table → 23505, an open and a closed one are accepted**; `coperto_total` = 6,00 for 4 × 1,50 and null when unset; `menu_item_price` UPDATE/DELETE/TRUNCATE → `append_only`; DELETE on the other four → `append_only`; `table_session_guard`: `opened_by`, `table_name`, `coperto_amount`, `business_date` changes → `table_session_immutable`, `covers` and `bill_requested_at` changes are accepted, any change after `closed_at` is set → refused. **RLS:** owner and admin A read A's rows of all five; chef A and waiter A read 0 rows of each; owner B reads 0 of A's. **Privileges:** `authenticated` has no INSERT/UPDATE/DELETE on any of the five; `has_table_privilege('service_role', t, 'select')` true and `insert, update, delete` false for each (lesson 2 pin). **Audit:** one insert per value of `20261030100000`'s two lists succeeds, plus the four new entity types and six new actions; `not_an_entity` → 23514. `001` green (RLS, tenant_id, policy, no delete, anon); `004`, `059` green with the new fixture rows; `030` green; `check-constraint-union.test.ts` green |
| 2 | Migration: helpers (role checks, status derivation, fired-lines stub, statuses, price in force, coperto, default VAT) | `supabase/migrations/20261031100100_menu_tables_helpers.sql`, `supabase/tests/database/151_menu_tables_helpers.test.sql` | `151`. **AT1 derivation table** (`app.table_status`): (false, –, –, –) → `free`; (true, null, null, 0) → `open`; (true, null, null, null) → `open`; (true, null, null, 2) → `courses_sent`; (true, null, t, 2) → `bill_requested`; (true, null, t, 0) → `bill_requested`; (true, t, t, 3) → `closed`; (true, t, null, 0) → `closed`. **Stub and plug-in:** `app.session_fired_lines` returns no row → `session_statuses` gives `open` for an open session; after `create or replace` of the stub inside the test (returns 1 for session S) → S `courses_sent`, another open session still `open`, a bill-requested S → `bill_requested`, a closed S → `closed`. **Price in force (≥ 2 candidates):** rows at 10:00 (12,00/10) and 11:00 (14,00/22) and a future one at now + 1 h → at 10:30 → 12,00/10; at now → 14,00/22; before 10:00 → no row; two items in one call → one row each. `coperto_settings`: A → 1,50/10, B → no row. `default_vat_rate`: A (`sale_vat_pct` 10) → 10; B (22) → 22; a tenant with 12 → null. Role checks: owner, admin, waiter pass `require_service_reader` and `require_table_operator`, chef → 42501; `require_menu_writer` owner/admin only; no claims → 42501. No API role can execute any function of this migration |
| 3 | Migration: menu procedures | `supabase/migrations/20261031100200_menu_procedures.sql`, `supabase/tests/database/152_menu_procedures.test.sql` | `152`. **AT5:** owner A `create_menu_item({"name":"Acqua (demo)","category":"Bevande","course":"bevande","recipeKey":null,"price":2,"vatRate":10})` → item with `recipe_key` null, one price row, audit `menu_item.created`; `menu_items_manage` lists it with `unmapped: true`. A plate key → mapped (`unmapped: false`). A batch key → `recipe_not_plate`; tenant B's plate key → P0002 `recipe_not_found`; an inactive plate key → `recipe_inactive`; a second active item on the same key → `recipe_already_on_menu`; same name (different case and spaces) → `menu_item_name_taken`; price 14,005 → `price_invalid`; VAT 12 → `vat_rate_invalid`; `pushUntil` key → `invalid_request`; missing `vatRate` → `invalid_request` (no implicit VAT). **Update:** price 14 → 15 → a second price row, the first unchanged, one audit with before `{price: 14}` / after `{price: 15}`; the same patch again → `changed: false`, no row, no audit; a rename + course change → row updated, one audit; `active: false` then a new item with the same name → accepted; reactivating the first → `menu_item_name_taken`. **Roles:** admin A allowed; chef A and waiter A → 42501, nothing written; tenant B owner → P0002 on A's item |
| 4 | Migration: menu reads | `supabase/migrations/20261031100300_menu_reads.sql`, `supabase/tests/database/153_menu_reads.test.sql` | `153`. **AT4 (waiter):** waiter A direct `select` on `menu_item` and `menu_item_price` → 0 rows; `menu_list()` as waiter → active items only (an inactive item absent), grouped by category in min-position order; items found by id; each item's key set is exactly `{id,name,category,course,price,available,pushed,pushPrice}`; a recursive key scan finds no key matching `/cost\|margin\|gp\|food\|eur$\|recipe\|vat/i`; `price` = the latest row (two rows present). **Push (M23 contract):** `push_until` = now + 2 h, `push_price` 12 → `pushed: true`, `pushPrice: 12`; `push_until` = now − 1 min → `pushed: false`, `pushPrice: null`. Chef → 42501. **Manage:** owner A → `defaults.vatRate` 10 and owner B → 22 (two tenants); `vatRates` = `{0,4,5,10,22}`; a mapped item's `recipeName` is the current version's name after a second version is created; `recipeActive` false after M7's deactivation; waiter → 42501; owner B sees none of A's items |
| 5 | Migration: dining tables and coperto settings | `supabase/migrations/20261031100400_dining_tables_coperto.sql`, `supabase/tests/database/154_dining_tables_coperto.test.sql` | `154`. Create "Tavolo 1 (demo)" → audit `dining_table.created`; " tavolo 1 (DEMO) " → `table_name_taken`; rename and reorder → one audit with before/after; deactivate a table with an open session (inserted as owner) → `table_open`; deactivate a free one → accepted, absent from `tables_list` later (157). `set_sale_settings({"copertoAmount":1.5,"copertoVatRate":10})` → row, audit `sale_settings.changed`; again → no write; `{"copertoAmount":null,"copertoVatRate":null}` → coperto cleared (`sale_settings_read().coperto` null); `{"copertoAmount":1.5,"copertoVatRate":null}` → `coperto_invalid`; 0 and 100,01 → `coperto_invalid`; VAT 12 → `vat_rate_invalid`. `sale_settings_read` A vs B differ (lesson 1). Chef and waiter → 42501 on all six functions |
| 6 | Migration: `open_table`, `update_table_session` | `supabase/migrations/20261031100500_table_sessions.sql`, `supabase/tests/database/155_open_table.test.sql`, `supabase/tests/database/156_table_session_update.test.sql` | `155`. **Open:** waiter A opens T1 with session S1, 4 covers → `created: true`, `table_name` snapshot, `opened_by` = waiter, `business_date` = `app.business_date(A, opened_at)`. **AT2:** S2 on T1 → P0001 `table_already_open` with detail `{sessionId: S1, covers: 4, …}`; S1 on T1 again → `created: false`, still one row (replay); S1 on T2 → `session_id_conflict`; a closed session's id on its table → `session_closed`; an inactive table → `table_inactive`; tenant B's table → P0002; covers 0, 100 → `covers_invalid`. **AT3:** tenant A (1,50/10) → `coperto {perPerson 1.5, vatRate 10, total 6}`; tenant B (none) → `coperto: null`, `coperto_total` null; settings changed to 2,00 after opening → S1 still 1,50. **Business date (≥ 2 instants, DST):** opened at 2026-11-03T00:30Z (01:30 Rome, before the 02:00 cut-off) → 2026-11-02; at 2026-10-25T00:30Z (02:30 CEST, DST night) → 2026-10-24; at 2026-10-25T02:30Z (03:30 CET) → 2026-10-25. Admin and owner can open; chef → 42501. `156`. Waiter **B** sets covers 4 → 5 on waiter A's S1 → `coperto_total` 7,50 (frozen 1,50), audit `table_session.covers_changed`, `opened_by` still A (several waiters); `billRequested: true` → `bill_requested_at/by` = B, status `bill_requested`; `false` → cleared, status `open`; a closed session → `session_closed`; tenant B → P0002 `session_not_found`; `{}` and an unknown key → `invalid_request`; chef → 42501 |
| 7 | Migration: `tables_list` | `supabase/migrations/20261031100600_tables_read.sql`, `supabase/tests/database/157_tables_list.test.sql` | `157`. **AT1 end to end** (tables found by id): T1 no session → `free`, `session` null; T2 open → `open` with covers, `openedAt`, `openedToday` true, `waiter.displayName` "Cameriere Demo"; T3 open with the stub replaced to return 2 → `courses_sent`; T4 bill requested → `bill_requested`; T5 a session closed earlier today → `closed`; T6 a session closed yesterday → `free`. **Several sessions per table:** T5 with an earlier closed and a later open session → `open` with the open one; T6 with two closed sessions today → `closed` showing the later one. An open session from yesterday → `open`, `openedToday` false. An inactive table is absent. Order: position then name (ties by name). Waiter key scan: no key matching `/cost\|margin\|gp\|food\|eur$\|recipe/i`; `coperto` present for A, null for B. Chef → 42501; owner B sees none of A's tables |
| 8 | Migration: `plate_cost_rows` takes the menu price and VAT for mapped plates | `supabase/migrations/20261031100700_plate_cost_menu_price.sql`, `supabase/tests/database/158_plate_cost_menu_price.test.sql` | `158`. Plate P with `recipe_price` 12 and `sale_vat_pct` 10, no menu item → `plate_costs()` `sale_price_eur` 12, `vat_pct` 10 (unchanged path). An active item on P at 14,00/22 → `sale_price_eur` 14, `vat_pct` 22, `sale_price_ex_vat_eur` = 14 / 1,22 (4 dp), `gp_pct` recomputed; the chef's `plate_margins_pct` GP equals the owner's. **History:** price 16 from today → `plate_costs(yesterday)` 14, `plate_costs()` 16. The item deactivated → back to 12/10. An unmapped item does not affect any plate. `058`, `061`, `063` green unchanged; signature and output columns identical (`pg_get_function_result` equals the value captured before the step) |
| 9 | Guard: M17 preserves the pipelines it must not touch | `supabase/tests/database/159_m17_preserves.test.sql` | `159`: md5 of `app.raise_alert`, `app.try_raise_alert`, `app.run_alert_rules`, `app.alert_rules_body`, `public.approve_invoice`, `public.produce_batch`, `app.business_date`, `app.recipe_costs` equal the values on `main` before M17 (`alert_rules_body` = `2ac38ab6…` as `089` pins it; the others computed at the start of the build and written in the test); `app.alert_kind` row count unchanged; `cron.job` names unchanged; **the public functions named `cost\|margin\|price` are still the 13 of `059`**; `app.session_fired_lines(uuid, uuid[])` exists, returns no row, is not executable by any API role (comment: "M19 replaces this on purpose and re-pins here"). PR grep: `grep -lE "create or replace function (app\.raise_alert\|app\.run_alert_rules\|app\.alert_rules_body\|public\.approve_invoice\|public\.produce_batch)" supabase/migrations/20261031*` returns nothing |
| 10 | Race cases for concurrent opening | `scripts/test-db-races.sh` (three cases appended), `supabase/tests-native/races_fixture.sql` (unchanged; each case inserts its fixture in its database copy) | CI job `db-races`, existing cases unchanged. **`open-same-table`:** s1 (waiter A) `open_table(T, S1, 4)` and parks before commit; s2 (waiter B) `open_table(T, S2, 2)` → `s2_blocked` 1; after the gate s2 fails with `table_already_open`; one open session (S1). **`open-same-session`:** s2 sends `(T, S1, 4)` → blocked, then `created: false`; one row. **`open-two-tables`:** T1 and T2 at once → `s2_blocked` 0, both open. `no_deadlock` holds in all three |
| 11 | Menu and tables domain in TS: constants, schemas, outputs, errors, view helpers, form helpers, i18n, audit words | `src/server/menu/{constants,schemas,output,errors}.ts`, `src/server/tables/{constants,schemas,output,errors}.ts`, `src/lib/{menu/menu-view,menu/menu-form,tables/table-view}.ts`, `src/lib/api/errors.ts`, `src/lib/counts/count-view.ts` (`AUDIT_ACTIONS` + six actions), `src/lib/i18n/messages/{it,en,keys}.ts`, `tests/server/menu/{schemas,output,errors}.test.ts`, `tests/server/tables/{schemas,output,errors}.test.ts`, `tests/server/{menu,tables}/__snapshots__/*`, `tests/lib/{menu/menu-view,menu/menu-form,tables/table-view}.test.ts`, `tests/lib/counts/count-view.test.ts` (list extended on purpose), `tests/parity/tables-sql-parity.test.ts` | `schemas.test.ts`: strict bodies (unknown key → error; empty PATCH → error; `vatRate` required on POST); `price` 2 dp, 0–10 000; `covers` int 1–99; uuids. **`output.test.ts`: `z.toJSONSchema(serviceMenuOutput, {io: "output"})`, `tablesListOutput`, `openTableOutput`, `sessionOutput` each `toMatchSnapshot()`; a walk of every schema finds no property matching `/cost\|margin\|gp\|food\|eur$\|recipe/i` (AT4); the manage schema has no cost key either.** `errors.test.ts`: every §3.4 code → status + Italian message; unknown SQLSTATE → 500 without text. `table-view.test.ts`: `statusWord` for the five statuses (it/en); `canUseTables` owner/admin/waiter true, chef/unknown false; `coversLine(1)` "1 coperto", `(4)` "4 coperti"; `openedLine` "Cameriere Demo · 20:15" for `2026-11-02T19:15:00Z` and "Cameriere Demo · 25/10 01:30" when `openedToday` false and `2026-10-24T23:30:00Z`; `copertoLine({total: 6})` "Coperto 6,00 €", null → null; `nextCovers` clamps to 1–99. `menu-view.test.ts`: `badgesFor` (unmapped → "Senza ricetta", inactive recipe, unavailable, inactive); `priceLine(1234.5, 10)` "1.234,50 € · IVA 10 %"; `courseWord`. `menu-form.test.ts`: "14,00" → 14; "14,005" → error; "" → error; recipe "Nessuna ricetta" → `recipeKey: null`. `count-view.test.ts`: the six actions have it/en words. `tables-sql-parity.test.ts`: `MAX_TABLE_COVERS` and `MAX_COPERTO_EUR` equal the bounds in `20261031100000_menu_tables_core.sql` |
| 12 | API routes | `src/server/menu/{service-menu,manage}.ts`, `src/server/tables/{list,open,session,config,coperto}.ts`, `src/app/api/menu/route.ts`, `src/app/api/menu/items/route.ts`, `src/app/api/menu/[id]/route.ts`, `src/app/api/tables/route.ts`, `src/app/api/tables/[id]/open/route.ts`, `src/app/api/table-sessions/[id]/route.ts`, `src/app/api/dining-tables/route.ts`, `src/app/api/dining-tables/[id]/route.ts`, `src/app/api/settings/coperto/route.ts`, `tests/app/api/{menu,menu-items,menu-item,tables,table-open,table-session,dining-tables,dining-table,settings-coperto}.test.ts` | Fake session client. Each GET: allowed roles → 200 with one RPC; chef (and waiter on manage routes) → 403 **before any RPC**; no session → 401. Each write: RPC once with `{p_…}`; `text/plain` → 415; > 4 KiB → 413; malformed id → 400 without RPC. `POST /api/tables/:id/open`: `created: true` → 201, `created: false` → 200; P0001 `table_already_open` → 409 with `details.session`; `covers_invalid` → 422. `POST /api/menu/items` → 201; `recipe_already_on_menu` → 409; P0002 → 404. **An injected `unit_cost` / `margin_eur` key in the fake RPC reply is dropped by the strict output and never reaches the JSON** (menu and tables) |
| 13 | Real-stack integration suite | `tests/integration/menu-tables.int.ts`, `tests/integration/helpers/menu-tables.ts` (`seedMenuTablesTenant`: two locations, owner, two waiters, a chef; the plate recipe through `POST /api/recipes`, keys from its responses; no secret-key read of `recipe`/`recipe_key`) | **AT5:** `POST /api/menu/items` "Acqua (demo)" with `recipeKey: null` → 201; `GET /api/menu/items` → the item (by id) `unmapped: true`. **AT4:** waiter `GET /api/menu` → body validates against `serviceMenuOutput`; a deep key scan finds no cost or margin key; waiter `from('menu_item').select()` on the session client → 0 rows. **AT2:** waiter A opens T1 → 201; waiter B opens T1 with a new id → 409 `table_already_open` naming waiter A; **two concurrent `POST …/open` with different ids (`Promise.all`) → exactly one 201 and one 409**, and the secret-key count of open `table_session` rows for T1 = 1 (select granted to `service_role`); the same request replayed → 200 `created: false`. **AT3:** tenant A coperto 1,50/10 → open with 4 → `coperto.total` 6; tenant B (none) → `coperto: null`. **AT1 via API:** after `PATCH /api/table-sessions/S {billRequested: true}` by waiter B, `GET /api/tables` shows T1 `bill_requested` with waiter A as opener; T2 `free`. **Lesson 1:** the tenant has two locations, and nothing changes when a second location is added between calls. **Roles:** chef → 403 on `/api/menu`, `/api/tables`, `POST …/open`; waiter → 403 on `/api/menu/items`, `/api/dining-tables`, `/api/settings/coperto`. **Margins:** owner `GET /api/costs/plates` shows the menu price for the mapped plate after `POST /api/menu/items` (step 8 on the real stack). Tenancy: owner B lists none of A's tables or items |
| 14 | Screen `/menu` | `src/app/(owner)/menu/{page,menu-item-card,menu-item-form}.tsx`, `tests/components/{menu-page,menu-item-card,menu-item-form}.test.ts` | `renderToStaticMarkup` with fixture props. Card: name, "14,00 € · IVA 10 %", "Secondi", badge "Senza ricetta" only when `unmapped`; "Ricetta disattivata" when `recipeActive` false; a `<script>` name is rendered as text. Form: `Field`s "Nome", "Categoria" with a `datalist` of categories, "Portata" `select` of five options, "Ricetta" `select` whose first option is "Nessuna ricetta", "Prezzo (IVA inclusa)" `inputmode="decimal"`, "Aliquota IVA" pre-selected from `defaults.vatRate`; edit mode adds "Attivo". Page: categories in API order; a 403 renders one `ErrorAlert` "Il menu non è modificabile con il tuo ruolo."; no number is computed in the component (the price string comes from `priceLine`) |
| 15 | Screen `/tavoli/impostazioni` | `src/app/(owner)/tavoli/impostazioni/{page,dining-table-row,coperto-card}.tsx`, `tests/components/{dining-tables-page,dining-table-row,coperto-card}.test.ts` | Rows in API order with "Rinomina" and an "Attivo" switch; `table_open` → "Chiudi prima il tavolo aperto."; coperto card: empty amount field when `coperto` null, "1,50" when set; VAT `select` from `vatRates` pre-selected from `coperto.vatRate` or `defaults.vatRate`; note "Si applica ai tavoli aperti da ora in poi."; 403 → one `ErrorAlert` |
| 16 | Screen `/tavoli`, navigation, home links, UI note | `src/app/(owner)/tavoli/{page,table-tile,open-table-dialog,session-panel}.tsx`, `src/app/(owner)/owner-nav.tsx`, `src/lib/nav/is-current.ts`, `src/app/page.tsx`, `docs/design/ui-foundation.md` (§8 line for M17), `tests/components/{tables-page,table-tile,open-table-dialog,session-panel,owner-nav}.test.ts`, `tests/lib/nav/is-current.test.ts` | Tile: `data-table-id`, name, the status badge word for each of the five statuses, "4 coperti", "Cameriere Demo · 20:15"; free tile has no covers line. Dialog: "Coperti" input `inputmode="numeric"` with "−"/"+" buttons, "Apri tavolo"; the `sessionId` passed to the submit handler is stable across a retry (same value on the second call). Panel: "Conto richiesto" button with `aria-pressed` from `billRequested`; "Coperto 6,00 €" only when `coperto` is set. Page: a 409 renders "Il tavolo è già aperto da Cameriere Demo."; chef 403 renders "I tavoli non sono disponibili per il tuo ruolo."; markup of the waiter fixture contains no "Costo", "Margine", "GP", "Food cost". `owner-nav`: "Tavoli" for owner, admin, waiter; "Menu" for owner, admin; both hidden for chef and unknown; existing tabs unchanged. `is-current`: `/tavoli/impostazioni` marks "Tavoli"; `/menu` does not mark `/margini` |
| 17 | Playwright at 360 px and 1280 px | `e2e/menu-tables.spec.ts`, `e2e/helpers/seed-menu-tables.ts` (staff via `createStaff`; the plate recipe through the owner's API), `e2e/helpers/{session,seed-recipe}.ts` (unchanged) | **360 × 740.** Owner: `/tavoli/impostazioni` → "Tavolo 1 (demo)", "Tavolo 2 (demo)" → coperto "1,50", VAT via `getByRole("combobox", { name: /^Aliquota IVA/ })` → "Salva". `/menu` → "Nuovo piatto" "Acqua (demo)", "Bevande", Portata via `getByRole("combobox", { name: /^Portata/ })`, Ricetta "Nessuna ricetta", "2,00" → the card (located by `data-menu-item-id` from the POST response) shows "Senza ricetta" (**AT5 UI**); "Spezzatino con polenta (demo)" mapped, "14,00" → no badge. Waiter A (second context): `/tavoli` → tile `[data-table-id=T1]` "Libero" → 4 covers → "Apri tavolo" → "Aperto", "4 coperti", "Cameriere Demo", panel "Coperto 6,00 €" (**AT3 UI**). Waiter B (third context) → T1 shows "Aperto"; a direct `POST /api/tables/T1/open` with a new id from B's page → 409 (**AT2**); B taps "Conto richiesto" → after refresh A sees "Conto richiesto" (**AT1 UI**, several waiters). Waiter pages contain no "Costo", "Margine", "Food cost"; the waiter has no "Menu" tab. Chef: no "Tavoli" or "Menu" tab; `/tavoli` shows the 403 message and **that page** contains no `€`. `expectPhoneFriendly` on `/tavoli`, `/tavoli/impostazioni`, `/menu`, light and dark. **1280 × 800:** the grid has three columns and stays in the page column |

**Acceptance tests → proof**

| AT (plan §5a.3 M17) | Files (step) | Command |
|---|---|---|
| 1 Status derivation table (no lines → open; any fired → courses sent; bill requested; closed) | `151` derivation table + stub plug-in (2), `157` end to end (7), `table-view.test.ts` words (11), `menu-tables.int.ts` (13), `menu-tables.spec.ts` (17) | `npx supabase test db`; `npm test`; `npm run test:integration`; `npx playwright test` |
| 2 Opening an already open table → 409 | `155` (6), race cases `open-same-table`, `open-same-session` (10), route test `table-open.test.ts` (12), `menu-tables.int.ts` concurrent opens (13), `menu-tables.spec.ts` (17) | `npx supabase test db`; `scripts/test-db-races.sh`; `npm test`; `npm run test:integration`; `npx playwright test` |
| 3 Coperto = covers × amount when configured; none when unset | `150` generated column (1), `151` `coperto_settings` (2), `154` settings (5), `155` and `156` frozen amount and covers change (6), `menu-tables.int.ts` two tenants (13), `menu-tables.spec.ts` (17) | as AT2 without races |
| 4 `GET /api/menu` schema has no cost or margin keys; pgTAP for waiter on menu_item reads | `153` (4), `output.test.ts` snapshots and key walk (11), route tests (12), `menu-tables.int.ts` (13) | `npx supabase test db`; `npm test`; `npm run test:integration` |
| 5 Menu item without a recipe accepted and flagged `unmapped` | `152` (3), `153` manage (4), `menu-view.test.ts` (11), `menu-tables.int.ts` (13), `menu-item-card.test.ts` (14), `menu-tables.spec.ts` (17) | as AT1 |
| Roles: waiter never sees costs or margins; chef never €; writes owner/admin | `150` RLS (1), `152`–`157` role cases (3–7), `159` function list (9), route tests (12), integration (13), component tests (14–16), e2e (17) | all of the above |
| Invariants: nothing deleted, price history append-only, `tenant_id` + RLS, roles in Postgres, procedures single transactions, no data logic in React, secret key not in `src/` | `001`, `150` (1), `159` (9), component tests (14–16), existing `tests/lint/admin-client-import.test.ts` | `npx supabase test db`; `npm test`; `npm run lint` |

**CI implications:**
- pgTAP `150`–`159` run in the existing `supabase` job and in `scripts/test-db-native.sh` (no shim change: no cron, net or Vault use).
- `004`, `059` gain fixture rows; `030` changes one example value. All three keep their assertions.
- Three race cases are added. New Vitest snapshots are committed. No new CI secret. Coverage ≥ 80 % on new TS.

### 5b. Variants

**V1 — A closed table shows as free** · Trigger: Q68 answered "after closing, show the table as free" · Replaces steps: the closed-session lookup of 7 and its T5/T6 cases, and the `closed` tile case of 16

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V1.1 | `tables_list` shows only the open session; otherwise `free` | `supabase/migrations/<ts>_tables_closed_free.sql`, `157_tables_list.test.sql` | T5 (closed earlier today) → `free`, `session` null; T6 (two closed today) → `free`; T2–T4 unchanged; `app.table_status` still returns `closed` for a closed session (M21 reads it) |
| V1.2 | The tables output never carries the closed state | `src/server/tables/output.ts`, `tests/server/tables/output.test.ts` (snapshot updated on purpose), `tests/components/table-tile.test.ts` | `tablesListOutput` rejects `status: "closed"` (strict enum without it); the tile test's five-status case becomes four, and "Chiuso" never appears in the tile markup |

**V2 — Several menu items per recipe** · Trigger: Q69 answered "the same dish is sold at two prices (e.g. lunch and dinner)" · Replaces steps: the `menu_item_recipe_uq` index of 1, the `recipe_already_on_menu` case of 3, the menu-price source of 8

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V2.1 | Drop `menu_item_recipe_uq`; remove `recipe_already_on_menu` | `supabase/migrations/<ts>_menu_items_per_recipe.sql`, `150_menu_tables_core.test.sql`, `152_menu_procedures.test.sql`, `src/server/menu/errors.ts`, `tests/server/menu/errors.test.ts` | Two active items on one plate key are accepted; the error code is gone from the map |
| V2.2 | `plate_cost_rows` uses the menu price only when exactly one active item maps the plate, else `recipe_price` | `supabase/migrations/<ts>_plate_cost_several_items.sql`, `158_plate_cost_menu_price.test.sql` | One item → its price; two items (14 and 18) → `recipe_price` 12 and `sale_vat_pct`; back to one → its price |

**V3 — The chef sees a kitchen menu and marks dishes sold out** · Trigger: Q70 answered "the chef must see the menu and mark dishes 'esaurito'" · Replaces steps: the chef 403 on `GET /api/menu` (12, 13), the owner/admin-only `available` key of 3

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V3.1 | `public.kitchen_menu()` (owner, admin, chef): `{items: [{id, name, category, course, available}]}`, no price key; `public.set_menu_item_available(p_item uuid, p_available boolean)` (owner, admin, chef), audited `menu_item.updated` | `supabase/migrations/<ts>_kitchen_menu.sql`, `supabase/tests/database/<n>_kitchen_menu.test.sql` (number from the next free block) | Chef reads names and availability; a key scan finds no `price`; the chef sets `available false` → `menu_list` shows it unavailable, one audit with the chef's id; waiter → 42501 on both; chef still 42501 on `update_menu_item` |
| V3.2 | `GET /api/menu/kitchen`, `POST /api/menu/:id/availability`, chef screen `/menu/cucina` with one switch per dish, "Menu" tab for the chef pointing there | `src/app/api/menu/kitchen/route.ts`, `src/app/api/menu/[id]/availability/route.ts`, `src/app/(owner)/menu/cucina/page.tsx`, `src/app/(owner)/owner-nav.tsx`, `tests/app/api/{menu-kitchen,menu-availability}.test.ts`, `tests/components/{kitchen-menu-page,owner-nav}.test.ts`, `e2e/menu-tables.spec.ts` | Chef → 200 and the switch flips; waiter → 403 before any RPC; the chef's page contains no `€` (e2e, scoped to that page) |

**V4 — Dishes sold by weight (per etto)** · Trigger: Q71 answered "some dishes are priced per 100 g" · Replaces steps: none (adds a column to 1, a key to 3 and 4, a field to 14; M18 then takes a weight on the line)

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V4.1 | `menu_item.sale_unit text not null default 'portion' check (sale_unit in ('portion','per_100g'))`; `saleUnit` accepted by `create_menu_item`/`update_menu_item` and returned by both reads | `supabase/migrations/<ts>_menu_sale_unit.sql`, `supabase/tests/database/<n>_menu_sale_unit.test.sql` | A `per_100g` item is stored and listed with `saleUnit`; `'kg'` → `invalid_request`; existing items read `portion`; a `per_100g` item mapped to a plate → accepted |
| V4.2 | TS schemas and outputs (snapshots updated on purpose); "Unità di vendita" select; price line "3,00 €/etto" | `src/server/menu/{schemas,output}.ts`, `src/lib/menu/menu-view.ts`, `src/app/(owner)/menu/menu-item-form.tsx`, `tests/server/menu/output.test.ts`, `tests/lib/menu/menu-view.test.ts`, `tests/components/menu-item-form.test.ts` | `priceLine(3, 10, "per_100g")` → "3,00 €/etto · IVA 10 %"; the form sends `saleUnit`; the snapshot diff shows only `saleUnit` |

**V5 — Tables without covers (counter or takeaway)** · Trigger: Q72 answered "we open tables with 0 covers" · Replaces steps: the covers range 1–99 of 1, 6, 11 and 16

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V5.1 | `covers` check 0–99; `open_table` and `update_table_session` accept 0 | `supabase/migrations/<ts>_zero_covers.sql`, `155_open_table.test.sql`, `156_table_session_update.test.sql` | Open with 0 → `coperto_total` 0,00 with the coperto set, null without; −1 → `covers_invalid` |
| V5.2 | Zod `covers` min 0; the dialog's "−" reaches 0; `coversLine(0)` "nessun coperto" | `src/server/tables/schemas.ts`, `src/lib/tables/table-view.ts`, `tests/server/tables/schemas.test.ts`, `tests/lib/tables/table-view.test.ts`, `tests/components/open-table-dialog.test.ts`, `tests/parity/tables-sql-parity.test.ts` | 0 accepted, −1 rejected; `nextCovers(1, -1)` → 0; parity holds with the new bound |

**V6 — Margins keep the recipe price** · Trigger: Q74 answered "margins must use the price on the recipe, not the menu" · Replaces steps: 8 (not built) and the margins check of 13

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V6.1 | No `plate_cost_rows` replacement; `158` asserts the recipe price stays in force | `supabase/tests/database/158_plate_cost_menu_price.test.sql`, `tests/integration/menu-tables.int.ts` | With an active item at 14,00/22 on plate P, `plate_costs()` still shows 12 and `vat_pct` 10; the integration margins check expects 12 |

## 6. Risks and mitigations

- **Security / privacy**
  - *Definer functions bypass RLS:* every public M17 function checks the role first, has an empty `search_path`, takes the tenant from `app.tenant_id()`, and filters every statement by tenant; helpers have no API grant (steps 2–7, `159`).
  - *Costs or margins reaching the waiter:*
    - no waiter or chef RLS policy on the new tables (`150`);
    - fixed key sets and recursive key scans (`153`, `157`); strict output schemas that drop injected keys (step 12); committed JSON-schema snapshots (step 11);
    - no new public cost-named function (`159`).
  - *€ reaching the chef (project V6):* the chef gets 403 on every M17 read (steps 2, 12, 13, 17). The coperto stays out of the chef-readable `tenant.settings` (ADR-016).
  - *IDOR:* foreign ids → 404 from tenant-filtered lookups. A client-chosen session id that collides with another tenant's row gets `session_id_conflict` with no detail. Malformed ids → 400 before any RPC.
  - *Input validation:* strict Zod plus strict SQL patch parsing (unknown keys, bounds, 2 dp prices, allowed VAT list, covers 1–99), 4 KiB bodies, JSON content type (CSRF, `withApi`). Names and categories are rendered as text (React escaping; the `<script>` name case in step 14).
  - *Audit bypass:* no API role can write the tables directly; every change goes through an audited procedure (steps 1, 3, 5, 6).
  - *Personal data:* staff ids and display names only (§3.1.11). No guest data, no processor, logs carry SQLSTATEs and codes only. Retention follows project Q14.
- **Correctness**
  - *Double opening under load:* row lock + partial unique index + idempotent replay, proven by three race cases and a real-stack concurrent test (steps 6, 10, 13).
  - *Coperto drift:* frozen per-person amount on the session; generated total; settings changes never rewrite sessions (`155`, `156`).
  - *Losing shared audit values* (the M11/M13 incident): union rule, `150` inserts every earlier value, the config test.
  - *Breaking the role scans:* `004`/`059` fixture rows added in the same commit as the tables; the `030` example value changes on purpose with the reason in the commit body.
  - *Changing margins unexpectedly:* step 8 keeps the old path when no menu item maps a plate (`058`, `061`, `063` unchanged). The change is flagged to the founder (Q74 → V6).
  - *M19 forgetting the stub:* `159` pins the stub's empty result; M19's replacement must re-pin it on purpose.
  - *Stale list for a second waiter:* 15 s refresh plus refetch after each write; the 409 names who opened the table. Realtime is not needed for the PRD flow.
- **Unverified (proved in the named step):**
  - **T1** A `generated always … stored` column over `covers * coperto_amount` updates when `covers` changes through the guarded update (PostgreSQL generated columns, <https://www.postgresql.org/docs/current/ddl-generated-columns.html>). Proved in `150` and `156` (steps 1, 6).
  - **T2** The second `open_table` waits on the `for update` row lock and then sees the committed session under read committed. Proved by `open-same-table` (step 10).
- **Performance / cost:** one set-based query per list read, indexed by tenant and table; no loop per table; no figure promised. No provider or running cost.
- **Dependencies:** none added (Zod 4 `z.toJSONSchema` is already used in `tests/server/batches/output.test.ts`; <https://zod.dev/json-schema>).
- **Plan changes to record in DigiAlto-Ops `clients/osteria-dei-rossi/context.md`:**
  - §3.5.1 `tenant`: `coperto_amount`, `coperto_vat_rate` live in the new owner/admin table `sale_settings`, not in `settings` (ADR-016);
  - §3.5.1 `menu_item`: price and VAT in the append-only `menu_item_price`; `is_pushed` derived from `push_until`; `recipe_key` nullable (`unmapped`); `course` enum;
  - §3.5.1 `table_session`: `opened_by` (the PRD's `waiter_id`), `business_date` and the coperto columns added in M17 (plan said M21 for `business_date`); `coperto_total` is generated; added tables `dining_table`, `menu_item_price`, `sale_settings`;
  - §3.3: management routes `/api/menu/items`, `/api/dining-tables`, `/api/table-sessions/:id`, `/api/settings/coperto` (plan listed only the service routes);
  - §3.11.2: in M17 the chef reads no menu or table data (plan: R), pending Q70;
  - M8 §3.8 contract fulfilled: menu price and VAT feed `plate_cost_rows` for mapped plates.

## 7. Open questions for the founder (defaults in force for this build)

**Already decided and applied:** Q16 = project V6 (the chef never sees €).

**Still open from the project plan:**
- **Project Q5 — table names, typical covers, coperto amount, staff count.**
  - **Default:** you type the names on "Tavoli · impostazioni"; covers 1–99; no coperto until you set it there.
  - Nothing in the code depends on the real values.

**New:**
- **Q68 What does a table show after it is closed?**
  - **Default:** "Chiuso" for the rest of the service day; it can be opened again at once.
  - **Alternative:** it shows "Libero" straight away (→ V1).
- **Q69 Can the same dish appear twice on the menu at different prices (e.g. lunch and dinner)?**
  - **Default:** no, one menu item per recipe.
  - **Alternative:** yes (→ V2).
- **Q70 Should the chef see the menu and mark dishes "esaurito"?**
  - **Default:** no. You and DigiAlto support do it, and stock-based availability arrives in M18.
  - **Alternative:** yes, on a kitchen screen without prices (→ V3).
- **Q71 Are some dishes sold by weight (price per 100 g)?**
  - **Default:** not in M17; every item is priced per portion or piece.
  - **Alternative:** yes, a sale unit "per etto" (→ V4).
- **Q72 Do you ever open a table with no covers (counter, takeaway)?**
  - **Default:** no, 1–99.
  - **Alternative:** yes, 0 allowed (→ V5).
- **Q73 Coperto VAT rate.**
  - **Default:** pre-filled from your sale VAT setting (10 % until you or the accountant change it; project Q3/Q20); you can choose another allowed rate.
  - Confirm with the accountant. This is a setting, so no variant.
- **Q74 Which price should margins use for a dish with a recipe?**
  - **Default:** the menu price (what the waiter sells at); the recipe price only for dishes not on the menu.
  - **Alternative:** keep the recipe price (→ V6).

**Assumptions (confirm; a different answer means a re-plan, not a variant):**
- **A1:** menu prices and the coperto are VAT included (as recipe prices, M7 Q3).
- **A2:** one dining room, one grid of tables, no rooms or floor plan (PRD).
- **A3:** the coperto is per person per table, not per order or per course.
- **A4:** merging or moving tables is not needed in the MVP.

**Technical, resolved inside the build:** T1, T2 (§6).

## 8. Manual steps for the founder

- None are needed to build, test or merge M17. Migrations reach staging through the existing CI deploy job.
- Before service use: enter the real table names and the coperto (if any) on "Tavoli · impostazioni", and the menu items on "Menu" (project Q2: no real data until you say so).
- Answer Q68–Q74 when convenient. Each different answer triggers the named variant as a follow-up PR.

## 9. Sources

- Worktree `/home/user/osteria-m17`:
  - the files in §2; `docs/prd.md`; the project plan; the M7, M8, M11, M14, M15, M16 plans;
  - ADR-002, -003, -005, -007, -008, -015; `docs/client-facts.md`; `docs/design/ui-foundation.md`.
- PostgreSQL documentation, generated columns: <https://www.postgresql.org/docs/current/ddl-generated-columns.html> (T1).
- Zod 4 JSON Schema: <https://zod.dev/json-schema> (already a dependency; used for the snapshot tests).
