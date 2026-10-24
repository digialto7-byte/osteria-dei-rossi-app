# Tech plan — Osteria Digitalization · M18 Order entry (courses, modifiers, availability, low-stock hint, push pin)

- **Client slug / internal:** `osteria-dei-rossi`.
  - The approved client facts in `docs/client-facts.md` are the trading name, the brand colours and the fonts. M18 needs no other client fact.
  - **The drafts in `docs/client/` are not used** in any fixture, seed or UI text. That includes the menu, the prices and "Consigliato dall'Oste".
  - Every fixture is fake:
    - tenants "Osteria Demo A/B"; users "Titolare Demo", "Admin Demo", "Chef Demo", "Cameriere Demo", "Cameriere Due Demo";
    - locations "Cella (demo)" and "Dispensa (demo)" (two on purpose: lesson 1);
    - tables "Tavolo 1 (demo)" … "Tavolo 5 (demo)";
    - batch recipes "Spezzatino (demo)" and "Ragù (demo)";
    - menu items:
      - "Spezzatino con polenta (demo)" 14,00 €, secondi, mapped to a plate that uses 1 porz of the stew batch;
      - "Tagliatelle al ragù (demo)" 11,00 €, primi, 1 porz of the ragù batch;
      - "Bruschetta (demo)" 5,00 €, antipasti, unmapped;
      - "Zuppa del giorno (demo)" 9,00 €, primi, unmapped;
      - "Tiramisù (demo)" 6,00 €, dolci, unmapped;
      - "Acqua (demo)" 2,00 €, bevande, unmapped.
    - All prices are invented.
- **Repo and branch:** `osteria-dei-rossi-app`, worktree `/home/user/osteria-m18`, branch `feat/m18-order-entry`.
  - The branch is **stacked on `feat/m17-menu-tables` at `c0f8cff`**; `main` is `0bf2dad` (M0–M9, M11–M16).
  - One draft PR, based on the M17 branch until M17 merges, then rebased onto `main`.
- **Numbering:** migrations `20261101100000`–`20261101100900`; pgTAP `160`–`169`; ADR-017; questions from Q75; e2e `e2e/order-entry.spec.ts`.
  - Variants V1–V7 belong to this plan. The project plan's variants are written "project V2", "project V6".
- **Shared check constraints:** M18 adds **no** audit entity type, audit action or alert kind.
  - `audit_event_*_check` and `app.alert_kind` are not touched, so `tests/config/check-constraint-union.test.ts` is unaffected.
- **Author:** architect · **Date:** 2026-10-24
- **ADR:** `docs/adr/adr-017-order-entry.md` (proposed). It records:
  - client-generated line ids;
  - last write wins per line with a `conflict` reply;
  - idempotent replays without `applied_op`;
  - the price frozen at entry;
  - the availability check under shared batch locks.
- **Sources:**
  - `docs/prd.md`: 3.1 bullet 3, 3.2 (all bullets), 3.5, Module 3 acceptance, NFR Performance / Offline / Accessibility, Data model `order_line`;
  - project plan: §3.3 (orders rows), §3.5.1 (`order_line`, `menu_item`), §3.5.2 (`order_line_cost`, `applied_op`), §3.5.3 (`menu_availability()`), §3.6, §3.8, §3.11.2 with project V6, §5a.3 M18 (AT1–AT7) plus M19, M20, M21, M23, §5b project V2, §7 Q7, Q14;
  - M17 plan §3 and ADR-016;
  - plans M11, M14, M15, M16; ADR-002, -005, -013, -014;
  - the merged SQL in §2. **Where merged SQL and a plan differ, the SQL wins.** For M17, whose SQL does not exist yet, the plan is used until it lands; see §2.2.

> **Flags for the founder (read first)**
> - **The price is fixed when the waiter adds the dish**, including a "push" price (ADR-017). If the push ends before the course is sent, the guest still pays the price the waiter quoted (Q79 → V5).
> - **A dish is blocked only when its batch is at 0 portions.** With 1 portion left the waiter can still order 2; the kitchen then records a shortage at firing (M19). Lines that are entered but not yet sent do **not** reserve portions (Q76 → V2, Q78 → V4).
> - **"Ne restano 3"** appears when 3 portions or fewer are left (Q77 → V3).
> - **Two waiters editing one line:** the later edit wins. The other waiter sees a warning with the current line (PRD 3.1).
> - **The 300 ms check (AT7) needs the M18 migrations on staging.** Staging only receives migrations from `main` (`deploy-staging.yml`). So AT7 runs once, by hand, after the merge, with your approval of the `staging` environment (Q81). It reports numbers and promises none.
> - **No new dependency, provider, scheduled job or alert.** There is no new secret, unless the preview deployment is password-protected (Q81 → V6).
> - Q75–Q81 and project Q7 (§7) have **defaults in force for this build**. They go in the PR body.

## 1. Goal and scope

- **Goal:** a waiter enters a table's order faster than on the paper pad: dishes by course, with notes, half portions and shared plates. Items with no stock are greyed out and refused. The waiter sees "Ne restano 3" and the pushed dishes first. Two waiters on one table never silently lose an edit.
- **In scope:**
  - `order_line`:
    - client-generated `uuid` id;
    - course, quantity (0.5 steps), `segue`, note, shared flag;
    - the frozen sale price and VAT rate;
    - `client_updated_at`, plus server `created_*`/`updated_*`;
    - derived `state` (draft / fired / voided) and the M19 columns `fired_*`, `voided_*`, `void_reason`.
  - Procedures, all single-transaction:
    - `add_order_line`;
    - `update_order_line` (edit and move);
    - `remove_order_line` (delete before fire = void with reason `entry_removed`);
    - the read `order_view`.
  - Availability:
    - `app.menu_item_availability()` (the plan's `menu_availability()`: portions left per menu item);
    - `GET /api/menu` gains `available` (stock + manual), `unavailableReason`, `portionsLeft`, `lowStock` and a `pinned` list of pushed items;
    - 409 `item_unavailable` on add.
  - Last write wins per line, with a 409 `conflict` reply carrying the current line. Replays are idempotent (same request twice → applied once).
  - Screen `/tavoli/[sessionId]` ("Comanda"): phone-first, course tabs, 44 px targets, Italian.
  - WebKit + Chromium phone e2e. The AT7 measurement script and its manual workflow.
- **Out of scope:**
  - `fire_course`, `void_line` after firing, depletion, `order_line_cost`, kitchen tickets, the replaced `app.session_fired_lines` (M19);
  - service worker, outbox, `/api/sync`, `applied_op` (M20); bill and close (M21);
  - setting push fields (M23 `POST /api/menu/:id/push`);
  - moving lines between tables and merging tables (M17 A4);
  - allergen display (project Q21);
  - realtime updates (15 s polling, as M17).

## 2. Current state

### 2.1 Merged on `main` (`0bf2dad`), read for this plan

- **Tenancy, roles, staff (M0, M11):**
  - `app.tenant_id()`, `app.role()` (live `app_user` row), `app.app_user_id()`.
  - Staff sign in by PIN. `withApi` (`src/lib/api/with-api.ts`) calls `staff_session_active` on **every** PIN-session request: one extra database round trip before the route's own RPC (relevant to AT7, §3.9).
  - Malformed route ids → 404 `not_found` (`readParams`). Strict Zod bodies → 400 `invalid_request`. JSON-only writes → 415.
  - `src/lib/api/client.ts` `ApiErrorBody.details` is typed `Record<string, string | number>[]`. M18 needs an object (the current line) there (step 11).
- **Batches (M14, M15):**
  - `batch (recipe_key, state batch_state {fresh, open, finished, discarded}, use_by, …)`, indexes `batch_produced_idx`, `batch_recipe_idx (tenant_id, recipe_key, produced_at desc)`.
  - `batch_movement` (signed fractional `portions`, append-only), `batch_movement_batch_idx (tenant_id, batch_id)`.
  - `v_batch_portions (tenant_id, batch_id, portions_remaining)`: `security_invoker`. Owner/admin/chef policies; select granted to `authenticated`, `service_role`; **the waiter reads no batch row**.
  - `app.lock_batch_rows` (FOR UPDATE, id order); `app.batch_remaining` (volatile, read after the lock, M15 T2); `app.batch_settle_state` (the state follows the ledger: remaining > 0 → `open`).
  - **Lock order** (`20261029100100`): stock locks → batch rows → batch lot. `adjust_batch`, `discard_batch` and `split_batch` take the batch row FOR UPDATE.
  - `app.remaining_portions(tenant, at)` (M16, `20261030100300`) sums all of a tenant's batches with `use_by > at` through the view. It is correct but tenant-wide. M18 does not reuse it on the hot path (§3.9) and does not change it.
- **Recipes (M7):**
  - `recipe_key (type, current_version, is_active)`; immutable `recipe`; `recipe_line (sub_recipe_key, qty, unit, yield_factor)` with the unique `recipe_line_position_uq (tenant_id, recipe_id, position)`.
  - `20261023100300` enforces two rules: **a batch is used only by plates, and always in `porz`**. Subs never use batches. So a plate's batch needs are exactly its version's top-level lines whose sub-recipe key is of type `batch`.
  - No `service_role` grant (lesson 2: never read `recipe`/`recipe_key` with the secret key).
- **Role scans:**
  - `004`: waiter-readable columns must not match `cost|margin|unit_price|total_cost|price_history|gp_pct|last_price`.
  - `059`: chef/waiter-readable columns must not match `cost|margin|price|prezz|gp_pct|_eur$|amount|total|importo`. The cost-named public functions are an exact list of 13.
  - Both need a fixture row in every public table.
- **Tests infra:**
  - `scripts/test-db-races.sh` (`two_sessions_as`, `s2_blocked`, `no_deadlock`, `parked`, `race.gate`); its M15 cases show the batch row-lock pattern.
  - `062_recipe_cost_perf.test.sql`: a 5 s statement-limit pattern for big fixtures.
  - Integration helpers `tests/integration/helpers/{stack,sql,cookie-jar,batches}.ts` (`seedStewRecipe`, `seedRaguRecipe`, `seedRaguBatch` go through the API).
  - e2e helpers `createOwner`, `createStaff`, `signInWithMagicLink`, `expectPhoneFriendly`, `seedStewRecipe`, `seedRaguRecipe`.
  - `playwright.config.ts` has **one** project, `phone` (Chromium, Pixel 7 at 360 × 740). CI installs Chromium only (`ci.yml` line 98).
- **Hosting:** `vercel.json` `regions: ["fra1"]`. `t1-staging.yml` is the pattern for a manual, reviewer-gated staging job: environment `staging`, secrets `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, a project-ref guard.
- **Missing:** every M18 table, procedure, endpoint and screen.

### 2.2 M17 names this plan relies on (from the M17 plan §3; re-check each when M17's SQL lands)

| Kind | Name and shape relied on | Used by (step) |
|---|---|---|
| Type | `public.course` = `antipasti, primi, secondi, dolci, bevande`, in that order | 1, 3, 6, 11 |
| Table | `menu_item (id, tenant_id, name, category, course_default, recipe_key null, position, is_available, is_active, push_until, push_price)` with a unique `(tenant_id, id)` for composite FKs | 1–6 |
| Helper | `app.menu_item_price_at(p_tenant uuid, p_items uuid[], p_at timestamptz) → (menu_item_id, price, vat_rate, valid_from)` | 4 |
| Table | `table_session (id, tenant_id, dining_table_id, table_name, covers, opened_at, opened_by, bill_requested_at, closed_at)` with a unique `(tenant_id, id)`; `closed_at is null` = open | 1, 4–6 |
| Trigger | `app.table_session_guard` (M18 never updates a session; it only locks it FOR SHARE) | 4, 5 |
| Role check | `app.require_table_operator()` (owner, admin, waiter; 42501 otherwise), reused for every M18 procedure | 4–6 |
| Role check | `app.require_service_reader()` (owner, admin, waiter), kept by the replaced `menu_list` | 3 |
| Status | `app.session_statuses(p_tenant, p_session_ids) → (table_session_id, status)` | 6 |
| Stub | `app.session_fired_lines(uuid, uuid[])` returning no rows. **M18 does not touch it** (M19 replaces it). `169` pins it | 9 |
| Read | `public.menu_list() returns jsonb` → `{categories:[{name, items:[{id,name,category,course,price,available,pushed,pushPrice}]}]}`; `pushed = push_until > now()` | 3 |
| pgTAP | `153_menu_reads.test.sql` asserts the exact waiter item key set. **M18 changes that assertion on purpose** (M17 §3.3 allows it) | 3 |
| Error codes | `session_not_found` (P0002), `session_closed` (409) | 4, 5, 11 |
| TS | `src/server/menu/output.ts` `serviceMenuOutput` + its snapshot; `src/server/tables/*`; `src/lib/tables/table-view.ts`; `src/app/(owner)/tavoli/session-panel.tsx`; `e2e/helpers/seed-menu-tables.ts`; `004`/`059` fixture rows for M17's tables | 11–16 |

- **Re-check rule.** When M17's SQL lands, rebase onto it and grep each name above. If a name or signature differs, M18 follows M17's SQL and this table is corrected in the same commit.
  - One exception: if `menu_item` or `table_session` lacks a unique `(tenant_id, id)`, step 1 adds it, because the composite FK needs it. `160` asserts the FK exists.
- **Precondition:** M18's migrations sort after M17's (`20261031…` < `20261101…`).

## 3. Design

### 3.1 Decisions

1. **`order_line` shape (ADR-017).** One mutable row per line, guarded by a trigger. Columns:
   - `id uuid primary key`, **generated by the client** (`crypto.randomUUID()`, required in the body; M20 references offline-created lines). `tenant_id not null default app.tenant_id()`.
   - `table_session_id`, `menu_item_id`: composite FKs to `(tenant_id, id)` of `table_session` and `menu_item`.
   - `course public.course not null`.
   - `qty numeric(4,1) not null`, check `qty >= 0.5 and qty <= 99 and qty * 2 = trunc(qty * 2)`. Half portion = 0.5 (PRD 3.2); 1.5 is legal.
   - `segue boolean not null default false`; `note text null` (trimmed, 1–140 characters, no control characters; empty → null); `is_shared boolean not null default false`.
   - `unit_price numeric(12,2) not null check (≥ 0)`, `vat_rate numeric(5,2) not null`, `price_source text check in ('menu','push')`. Frozen at entry (decision 6).
   - `client_updated_at timestamptz not null`: the last applied write's client instant. `created_at`, `created_by`, `updated_at`, `updated_by`: server instants and users, the "receipt time" of project §6.
   - M19 columns, null in M18:
     - `fired_at`, `fired_by` (both or neither);
     - `voided_at`, `voided_by`, `void_reason` (all three or none; `void_reason ~ '^[a-z_]{1,40}$'`).
   - `state text generated always as (case when voided_at is not null then 'voided' when fired_at is not null then 'fired' else 'draft' end) stored`. Derived, never written. A line fired and then voided is `voided` with `fired_at` kept, so M17's "courses sent" still counts it.
   - Not here: `unit_cost_at_sale`. It goes in M19's `order_line_cost`, which waiters cannot read.
   - Guard `app.order_line_guard` (before update):
     - `id`, `tenant_id`, `table_session_id`, `menu_item_id`, the three price columns and `created_*` never change;
     - a voided line never changes;
     - a fired line may change only by being voided (M19);
     - `fired_at` and `voided_at` are set once and never cleared.
   - Triggers: no DELETE, no TRUNCATE (`app.append_only`, `app.append_only_truncate`).
   - Indexes: `order_line_session_idx (tenant_id, table_session_id, created_at, id)`, and `batch_live_idx on batch (tenant_id, recipe_key, use_by) where state in ('fresh','open')` (§3.9).
   - RLS: one select policy for owner and admin. **No waiter or chef policy** (`unit_price` would trip `004`/`059`); waiters read through definer functions, as in M17.
   - Grants: `revoke all … from anon, authenticated, service_role; grant select … to authenticated, service_role` (lesson 2, pinned in `160`).
2. **Add, edit, move, delete before fire.**
   - **Add** = `add_order_line(p_session, p_body)`.
     - Body keys: `lineId`, `menuItemId`, `clientUpdatedAt` (required); `qty` (default 1), `course` (default: the item's `course_default`), `segue` (false), `note` (null), `isShared` (false).
     - Defaults are tested with ≥ 2 candidates (§3.1.12).
   - **Edit** = `update_order_line(p_line, p_patch)`.
     - Patch keys ⊆ `{qty, course, segue, note, isShared}`, at least one, plus a required `clientUpdatedAt`.
     - **Move** between courses is an edit of `course`. Changing the dish is remove + add: the price belongs to the dish.
   - **Delete before fire** = `remove_order_line(p_line, p_body {clientUpdatedAt})`. Nothing is deleted (project §3.6 rule 5). The draft line is voided: `voided_at/by`, `void_reason = 'entry_removed'`, no stock effect. It is the M19 "void before fire" without a reason prompt. Removed lines are left out of `order_view`.
   - Edits and removal are refused on non-draft lines. Fired lines are voided only by M19's `void_line`.
   - Any waiter, the owner or the admin may change any line of an open session of the tenant (M17 "several waiters"). Each write records `updated_by`.
   - Quantity increases re-check availability (decision 5); decreases, moves and notes never do.
3. **Last write wins per line (PRD 3.1; ADR-005; AT5).** Every write carries `clientUpdatedAt` (ISO 8601 with offset). The server locks the line FOR UPDATE, then decides in this order:
   1. **Irreversible states win** over any timestamp:
      - a voided line → `conflict` `voided`;
      - a fired line → `conflict` `fired`;
      - a closed session → `conflict` `session_closed`.
   2. `clientUpdatedAt < line.client_updated_at` → `conflict` `stale`.
   3. `clientUpdatedAt = line.client_updated_at`:
      - same fields and `updated_by` = caller → replay: `200 {changed: false}`, nothing written;
      - otherwise → `conflict` `stale`.
   4. Otherwise → apply. `client_updated_at = clientUpdatedAt`, `updated_at = now()`, `updated_by` = caller. `changed` says whether a field differed.
   - **The `conflict` reply:** 409 `{"error":{"code":"conflict","message","details":{"reason","line"}}}`. `line` is the current line as `order_view` renders it, including who changed it and when. The screen replaces its copy and shows a warning naming the dish and the colleague.
   - **Clock bound:** `clientUpdatedAt > now() + CLIENT_CLOCK_TOLERANCE` (120 s) → 422 `client_time_invalid` ("Controlla data e ora del telefono."). A phone set far ahead could otherwise win every race. There is no lower bound: M20 replays old ops (Q80).
4. **Idempotency for M20 replays (same op twice → applied once).** This is natural idempotency by entity id, needing no M18 table. M20 adds `applied_op` on top for op-level results.
   - add: a second request with the same `lineId`:
     - same tenant, session and menu item → `200 {created: false, line, item}`. Nothing is re-checked (no availability, no price) and nothing is written.
     - any other session or item, or another tenant (PK collision) → 409 `line_id_conflict` (no detail when another tenant's).
   - Two concurrent adds with one `lineId`: the second waits on the PK index. Its `unique_violation` is caught and answered as the replay (race `add-same-line`).
   - edit: the equal-timestamp replay rule of decision 3.3.
   - remove: a replay finds the line voided `entry_removed` by the caller with that `clientUpdatedAt` → `200 {changed: false}`. Any other voided line → `conflict` `voided`.
5. **Availability = `app.menu_item_availability(p_tenant uuid, p_items uuid[] /* null = all */, p_at timestamptz)`.** It returns `(menu_item_id, available boolean, reason text, portions_left numeric, low_stock boolean)`. It is the project plan's `menu_availability()` and the waiter's only view of stock: quantities, no cost.
   - **Batch needs per plate:**
     - `app.plate_batch_needs(p_tenant, p_recipe_keys uuid[]) → (recipe_key, batch_key, need)`;
     - `need = recipe_line.qty / yield_factor` (in `porz`), from the plate key's **current version**, over lines whose sub-recipe key is of type `batch`.
     - M19 must deplete with the same function (contract §3.3).
   - **Remaining per batch key:** Σ `greatest(v_batch_portions.portions_remaining, 0)` over the key's batches with `state in ('fresh','open')` and `use_by > p_at`. "Unexpired fresh or open" per M15; a negative balance counts as 0.
   - **Portions left per item:** `min` over its needs of `floor(2 × remaining / need) / 2`, i.e. in half portions.
     - `null` when the item is **unmapped** or its plate uses no batch: **always available**, no stock limit (M17 §3.3; PRD blocks by batch only, raw stock is never checked).
     - A plate whose batch key has no live batch → 0.
   - **Reason** (first match): `inactive` (`is_active` false), `manual` (`is_available` false, the owner's "esaurito"), `no_portions` (`portions_left = 0`), else null. `available = reason is null`.
   - **Low-stock hint:** `low_stock = portions_left > 0 and portions_left ≤ app.low_stock_hint_portions()`, a constant **3** (PRD example; Q77 → V3). The UI renders "Ne restano 3" from `portionsLeft` when `lowStock`; it does no arithmetic.
   - **Drafts reserve nothing.** Depletion happens at firing (PRD 2.3), so unsent lines do not lower `portions_left` (Q76 → V2). Only 0 blocks: ordering 2 with 1 left is accepted (Q78 → V4).
   - **On add:** if the item has batch needs, `app.lock_live_batches(p_tenant, p_batch_keys)` takes **FOR SHARE** on the live batch rows (id order). Availability is then computed in a new statement.
     - `discard_batch`, `adjust_batch`, `split_batch` (M15) and M19's firing take those rows FOR UPDATE, so an add and a stock drop serialise.
     - Adds do not block each other (shared locks).
     - Not available → P0001 `item_unavailable`, detail `{menuItemId, reason, portionsLeft}`. Nothing is written (AT1).
6. **Price captured at entry, not at fire (ADR-017; Q79 → V5).**
   - At add: pushed now (`push_until > now()` and `push_price` not null) → `unit_price = push_price`, `price_source = 'push'`. Otherwise the price in force from `app.menu_item_price_at(…, now())`, source `menu`.
   - `vat_rate` is always the item's rate in force (a push changes the price, not the tax).
   - Edits never re-price.
   - Why: the invariant is "frozen at sale" (project §3.6.4), and the sale is agreed when the waiter takes the order.
     - A push price shown and quoted at the table must hold even if `push_until` passes before the course is sent.
     - An offline replay (M20) must not change the price.
     - M21's bill reads the line, not the menu.
   - The **cost** stays frozen at fire (M19 `order_line_cost`), because that is when stock is consumed.
7. **Pushed items pinned first (AT4).**
   - `menu_list()` gains `pinned: [item]`: active items pushed now, ordered by position, name (`collate "C"`), id. Each has `pushed: true` and `pushPrice`.
   - Pinned items **also stay in their category** (so a waiter browsing "Secondi" still finds them). The screen renders the pinned strip first.
   - Expired pushes are absent by construction (`push_until > now()`), as M17 `153` already proves for `pushed`. A pushed item at 0 portions stays pinned but greyed.
8. **`segue` (PRD 3.2; Q75 → V1).** A per-line flag meaning "a seguire": the dish follows the others of its course and the kitchen waits for the call.
   - It is shown on the line ("Segue") and, from M19, on the ticket.
   - In M18 it has no effect on firing; M19 decides how `fire_course` treats it.
9. **Waiter-facing payloads carry no cost keys.**
   - Item key set: `{id, name, category, course, price, available, unavailableReason, portionsLeft, lowStock, pushed, pushPrice}`.
   - Line key set: `{id, menuItemId, name, course, qty, segue, note, isShared, unitPrice, state, clientUpdatedAt, updatedAt, updatedBy:{id, displayName}}`.
   - Session: `{id, tableId, tableName, covers, status, billRequested, closed}`.
   - `unitPrice` is a sale price, VAT included; the waiter quotes it. No `vat`, `cost`, `margin`, `gp`, `food`, `recipe` or `*_eur` key.
   - Pinned by recursive key scans in `162`, `166`, by strict Zod outputs that drop injected keys (step 12), and by committed `z.toJSONSchema` snapshots (step 11).
10. **Who calls what (§3.11.2, project V6).**

    | Object / action | owner | admin | chef | waiter | DB enforcement | API |
    |---|---|---|---|---|---|---|
    | `order_line` direct SELECT | ✓ | ✓ | 0 rows | 0 rows | RLS policy owner, admin | none |
    | `menu_list()` (with availability) | ✓ | ✓ | 42501 | ✓ | `app.require_service_reader()` (M17) | `GET /api/menu` |
    | `order_view`, `add_order_line`, `update_order_line`, `remove_order_line` | ✓ | ✓ | 42501 | ✓ | `app.require_table_operator()` (M17) | §3.4 |

    - Every public function is `security definer`, `set search_path = ''`. It checks the role **first**, takes the tenant from `app.tenant_id()` and the user from `app.app_user_id()`, filters every statement by tenant, and is executable by `authenticated` only.
    - Every `app.*` helper is revoked from all API roles.
    - No new public function name matches `cost|margin|price` (the `059` list stays at 13; `169` checks).
    - The chef gets 403 (kitchen tickets are M19).
11. **Lock order (no deadlocks).**
    - M18 writes take: `table_session` FOR SHARE → `order_line` FOR UPDATE (edit, remove) → live `batch` rows FOR SHARE (add, quantity increase), in id order.
    - Discard/adjust/split take only batch rows, and M18 takes no stock lock, so no cycle exists.
    - FOR SHARE on the session blocks M21's closing update until the line commits, so a line never lands on a session closed mid-write.
    - Contract for M19 and M21 (§3.3): keep session → lines → batches.
12. **Implicit defaults (lesson 1).** Each is tested with ≥ 2 candidates:
    - the course default (secondi item vs primi item, no `course` in the body);
    - the price in force (two history rows + a future row);
    - push vs menu price (pushed item vs one whose push expired a minute ago);
    - the live batches summed (two live batches of one key + one expired, one `finished`, one `discarded`);
    - the binding batch need (a plate with two batch lines → the minimum);
    - the session shown (M17);
    - integration fixtures with two locations;
    - two tenants with different availability.
13. **Personal data.**
    - Lines carry staff ids and display names (`updated_by`), shown to colleagues: an operational need, as in M17.
    - **The free-text note may receive guest data** (e.g. a guest's name with an allergy, which would be health data). The field hint says "Solo indicazioni per la cucina, niente nomi dei clienti" and the note is capped at 140 characters. Notes are kept with the sale; retention follows project Q14.
    - No processor; nothing leaves Supabase (EU). Logs carry codes and SQLSTATEs only, never the note.

### 3.2 Data model and procedures

**`20261101100000_order_core.sql`** (step 1)
- `public.order_line` per §3.1.1. Constraint names:
  - `order_line_qty_ck`, `order_line_note_ck`, `order_line_price_ck`, `order_line_fired_ck`, `order_line_voided_ck`, `order_line_void_reason_ck`;
  - FKs `order_line_session_fkey`, `order_line_menu_item_fkey`, `order_line_{created,updated,fired,voided}_by_fkey` → `app_user (tenant_id, id)`.
- The `(tenant_id, id)` uniques on `menu_item`/`table_session` only if M17 lacks them (§2.2).
- `app.order_line_guard()` + triggers; no-delete, no-truncate.
- `order_line_session_idx`, `batch_live_idx`.
- RLS, policy `order_line_select`, grants per §3.1.1.

**`20261101100100_order_helpers.sql`** (step 2). Schema `app`, `search_path = ''`, revoked from every API role.
- `app.low_stock_hint_portions() returns numeric` (immutable, 3).
- `app.plate_batch_needs(p_tenant uuid, p_recipe_keys uuid[]) returns table (recipe_key uuid, batch_key uuid, need numeric)` (stable).
- `app.menu_item_availability(p_tenant uuid, p_items uuid[], p_at timestamptz) returns table (menu_item_id uuid, available boolean, reason text, portions_left numeric, low_stock boolean)`.
  - **Volatile** (as `app.batch_remaining`), so a call after a lock sees committed rows.
  - Set-based: needs → live batches through `batch_live_idx` → `left join lateral (select portions_remaining from public.v_batch_portions v where v.tenant_id = p_tenant and v.batch_id = b.id)`. The batch-id qual sits on the view's grouping column, so it is pushed below the aggregate and uses `batch_movement_batch_idx` (T1).
- `app.lock_live_batches(p_tenant uuid, p_batch_keys uuid[]) returns integer` (the number of rows locked): `select 1 from public.batch where tenant_id = p_tenant and recipe_key = any(p_batch_keys) and state in ('fresh','open') and use_by > now() order by id for share`.
- `app.order_line_json(p_line public.order_line) returns jsonb`: the line shape of §3.1.9, with the menu item's current name and the editor's display name.
- `app.parse_client_time(p_value jsonb) returns timestamptz`: ISO with offset; `client_time_invalid` beyond the tolerance.

**`20261101100200_menu_list_availability.sql`** (step 3)
- `create or replace function public.menu_list()`: same signature, role check and ordering as M17, plus the item keys of §3.1.9 and the top-level `pinned`.
- One call of `app.menu_item_availability(v_tenant, null, now())`, joined by id.
- **`available` now combines manual and stock.** The manual-only meaning of M17 is replaced on purpose; the snapshot changes in step 11.

**`20261101100300_add_order_line.sql`** (step 4) — `public.add_order_line(p_session uuid, p_body jsonb) returns jsonb`. Order of operations:
1. Role, tenant, user.
2. Parse the body: unknown key or wrong type → `invalid_request`; `qty_invalid`, `note_invalid`, `course_invalid`, `client_time_invalid` (422).
3. Replay lookup by `lineId` (decision 4).
4. Lock the session FOR SHARE: missing or other tenant → P0002 `session_not_found`; closed → `session_closed`.
5. Read the menu item: missing or other tenant → P0002 `menu_item_not_found`.
6. Needs → `lock_live_batches` → availability (new statement): `item_unavailable` when not available.
7. Price (decision 6).
8. Insert. `unique_violation` on the PK → step 3's replay answer.
- Returns `{created, line, item: {id, available, portionsLeft, lowStock}}`.

**`20261101100400_edit_order_line.sql`** (step 5)
- `public.update_order_line(p_line uuid, p_patch jsonb) returns jsonb`. Order of operations:
  1. Role.
  2. Parse.
  3. Find the line's session (tenant-filtered; P0002 `line_not_found`).
  4. Session FOR SHARE.
  5. Line FOR UPDATE.
  6. Decision 3.
  7. A quantity increase on a stock-limited item → batch locks + `item_unavailable`.
  8. Update.
  - Returns `{changed, line}`.
- `public.remove_order_line(p_line uuid, p_body jsonb) returns jsonb`: the same steps 1–6, then void with `entry_removed`. Returns `{changed, line}`.
- Conflicts are not raised: both functions return `{conflict: {reason, line}}` as a normal result (nothing has been written), because a raised DETAIL would put the free-text note and the editor's display name into the Postgres logs (§3.1.13: logs carry codes only). The service maps the result to 409 `conflict` with `details` `{reason, line}`.

**`20261101100500_order_view.sql`** (step 6) — `public.order_view(p_session uuid) returns jsonb`:
- `{session: {id, tableId, tableName, covers, status, billRequested, closed}, lines: [...]}`.
- Lines exclude voided-before-fire ones and are ordered by course (enum order), `created_at`, `id`.
- Status comes from `app.session_statuses`. One set-based query.

`20261101100600`–`20261101100900` are kept free for review fixes.

### 3.3 Contracts for later milestones

- **M19:**
  - `fire_course` sets `fired_at/by` on draft lines (the guard allows it once) and depletes `qty × need` per batch key from `app.plate_batch_needs`, FEFO. It writes `order_line_cost` and replaces `app.session_fired_lines` (M17 §3.1.6), then re-pins it in `169`.
  - `void_line` after firing sets `voided_*` with its reason codes (the format check admits them).
  - Lock order: session → lines → batches FOR UPDATE.
  - Edits to fired lines are already `conflict` `fired` in M18.
  - Kitchen tickets show `segue` and `note`.
- **M20:**
  - Op payloads are the M18 bodies: `add_line {sessionId, lineId, …}`, `edit_line {lineId, clientUpdatedAt, …}`, `remove_line {lineId, clientUpdatedAt}`. `op.client_ts` = `clientUpdatedAt`.
  - M18's idempotency (decision 4) makes a replay without `applied_op` safe. `applied_op` adds the stored result.
  - A `conflict` result carries `line` for the warning (M20 AT4–5).
  - `GET /api/menu` stays role-independent.
- **M21:** bill lines = non-voided lines, `qty × unit_price` at `vat_rate`. `close_table` takes the session FOR UPDATE (it waits for in-flight M18 writes).
- **M22:**
  - plates by item use `qty` (half = 0.5) and revenue net of VAT uses the per-line `vat_rate`;
  - batch stock-outs come from the batch ledger and M19 alerts, because M18 records no "refused" events (§4).
- **M23:** writes `push_until`/`push_price`; `pinned` and the frozen `push` price follow by construction.

### 3.4 API

All routes:
- use `withApi` with the user-session client and `roles: ["owner","admin","waiter"]` (chef → 403 before any RPC);
- take strict Zod bodies (400 `invalid_request`), JSON content type (415), `MAX_ORDER_BODY_BYTES` = 2 KiB (413);
- validate ids with a uuid schema (malformed → 404 `not_found`, the `withApi` rule);
- return `{"error":{"code","message","details?"}}`;
- add a `Server-Timing` header (`auth;dur=…, rpc;dur=…, total;dur=…`) for AT7.

| Endpoint | Body | Success | Errors |
|---|---|---|---|
| `GET /api/menu` (M17, shape extended) | — | 200 `{pinned, categories}` | 401; 403 chef |
| `GET /api/table-sessions/:id/lines` | — | 200 `order_view` | 401; 403; 404 `session_not_found` |
| `POST /api/table-sessions/:id/lines` | `{lineId, menuItemId, clientUpdatedAt, qty?, course?, segue?, note?, isShared?}` | **201** new / **200** replay `{created, line, item}` | 400; 403; 404 `session_not_found`, `menu_item_not_found`; 409 `item_unavailable` (details `{menuItemId, reason, portionsLeft}`), `session_closed`, `line_id_conflict`; 413; 415; 422 `qty_invalid`, `note_invalid`, `course_invalid`, `client_time_invalid` |
| `PATCH /api/order-lines/:id` | `{clientUpdatedAt, qty?, course?, segue?, note?, isShared?}` (≥ 1 field) | 200 `{changed, line}` | 400; 403; 404 `line_not_found`; **409 `conflict`** (details `{reason: stale\|fired\|voided\|session_closed, line}`), `item_unavailable`; 413; 415; 422 as above |
| `POST /api/order-lines/:id/remove` | `{clientUpdatedAt}` | 200 `{changed, line}` | 400; 403; 404; 409 `conflict`; 413; 415; 422 `client_time_invalid` |

- **Path change from project §3.3:** `POST /api/tables/:id/lines` becomes `/api/table-sessions/:id/lines`. A table may already have a newer session, and session ids are client-generated (M20).
- Services: `src/server/orders/{constants,schemas,output,errors,timing,view,add,edit,remove}.ts`.
- Error map:
  - 42501 → 403; P0002 → 404;
  - P0001 `item_unavailable`, `session_closed`, `line_id_conflict` → 409 (`item_unavailable` with `details` parsed from the SQL detail through a strict schema); a `conflict` result of `update_order_line` / `remove_order_line` → 409 `conflict` with `details` `{reason, line}` (strict schema);
  - the 422 codes → 422;
  - anything else → 500 with the SQLSTATE only.

### 3.5 Screen `/tavoli/[sessionId]` "Comanda"

House style `docs/design/ui-foundation.md` §6/§8. Rules: 360 px first; every target ≥ 44 px; one thumb; every value comes from `/api/*`; no arithmetic in React.

- Files: `src/app/(owner)/tavoli/[sessionId]/{page,course-tabs,pinned-strip,menu-section,menu-item-button,order-sheet,line-row,line-editor}.tsx`. Pure helpers live in `src/lib/orders/{order-view,line-form}.ts`.
- **Header:** link "← Tavoli"; `Heading` with the table name; `.num` "4 coperti"; the M17 status badge.
- **Course tabs** (sticky top, `role="tablist"`, one `role="tab"` per course with `aria-selected`, each ≥ 44 px): "Antipasti", "Primi", "Secondi", "Dolci", "Bevande", each with its line count ("Primi · 2"). The selected tab is where new dishes go.
- **Pinned strip "Da proporre"** (first, when `pinned` is not empty): a ★ marker plus the word "Da proporre" (never colour alone), the name, and `.num` push price "12,00 €".
- **Menu:**
  - Under the selected tab, the items whose `course` equals the tab come first, grouped by category in API order; then a collapsed "Altri piatti" with the rest.
  - The filter is `itemsForCourse()` in `order-view.ts` (a field match, unit-tested).
  - Each item is a full-width button (`data-menu-item-id`) with accessible name "Aggiungi {name}". It shows the price, the hint "Ne restano 3" (`lowStock`), or greyed "Esaurito" with `aria-disabled` (`available` false). Tapping adds qty 1 to the selected course.
- **Order sheet** (sticky bottom bar "Comanda · 7 righe", tap to expand):
  - lines grouped by course (`data-line-id`): "2 × Spezzatino con polenta (demo)", with badges "½", "Da dividere", "Segue" and the note in muted text;
  - a pending line shows "Invio…" until the reply.
- **Line editor** (tap a draft line):
  - quantity "−"/"+" (whole portions, min 1) and a "Mezza porzione" toggle (qty 0.5);
  - `Select` "Portata" (the move);
  - toggles "Segue" and "Piatto condiviso" (`aria-pressed`);
  - `Field` "Nota" (`maxLength` 140, hint per §3.1.13, sent on blur);
  - "Rimuovi" (danger) and "Fatto".
  - Each change sends one PATCH with `clientUpdatedAt = new Date().toISOString()`. Fired lines (M19) render locked.
- **Errors** (`ErrorAlert`, Italian):
  - `item_unavailable`: "Spezzatino con polenta (demo) è esaurito." + menu refetch;
  - `conflict`: "Questa riga è stata cambiata da Cameriere Due Demo alle 20:31: ecco la versione attuale.", and the line is replaced with `details.line`;
  - `session_closed`: "Il tavolo è stato chiuso.";
  - `client_time_invalid`: "Controlla data e ora del telefono.";
  - chef 403: "La comanda non è disponibile per il tuo ruolo."
- **Refresh:** menu and lines refetch every `ORDER_REFRESH_MS` (15 s) while visible and after each write. `latestOnly()` (existing) drops slow old replies.
- **Entry:** M17's session panel gains a primary "Prendi la comanda" link. `isCurrent` marks "Tavoli" on `/tavoli/<id>`.

### 3.6 Flows

1. **Open:** `GET /api/menu` ∥ `GET /api/table-sessions/S/lines` → `menu_list`, `order_view`.
2. **Add:**
   - tap → `POST …/S/lines {lineId: randomUUID(), menuItemId, course: tab, clientUpdatedAt}` → `add_order_line` (session FOR SHARE → item → batch rows FOR SHARE → availability → price → insert);
   - 201 → the line is confirmed, the item's hint is updated from `item`;
   - a retry after a timeout reuses the same `lineId` → 200 `created: false`.
3. **Edit or move:** `PATCH /api/order-lines/L {course: "secondi", clientUpdatedAt}` → line FOR UPDATE → LWW → 200.
4. **Two waiters:** A's PATCH (t2) commits. B's PATCH (t1 < t2) waits on the row lock, then answers 409 `conflict` `stale` with A's line, and B's screen shows the warning (AT5).
5. **Stock drops during an add:** the chef's discard holds the batch row. The waiter's add waits on FOR SHARE, then sees 0 → 409 `item_unavailable`, and the menu refetches (race `add-vs-discard`).

### 3.7 Secrets and configuration

| Name | Public? | Where it lives | Used by M18 |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public by design (existing) | Vercel env; GitHub `staging` environment for the AT7 job | the session client of every M18 route; the AT7 script's sign-in |
| `SUPABASE_SECRET_KEY` | **private** (existing) | Vercel env (server-only); GitHub `staging` environment secret; locally `.env` (gitignored) | **not used by M18 `src/` code**; used by integration/e2e helpers (local stack) and by `scripts/perf/order-entry.ts` (fake perf tenant and staff on staging; `scripts/` is the allowed place) |
| `PIN_PEPPER`, `CRON_SECRET`, Vault values, `ANTHROPIC_API_KEY`, `EXTRACTION_MODEL_ID` | existing | Vercel env / Supabase Vault | not touched |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | private | GitHub `staging` environment secret | **only under V6** |
| Account logins (Vercel, Supabase, GitHub) | private | the account owner's password manager with MFA (project Q26); never in the repo or DigiAlto-Ops | humans; the founder approves the `staging` environment run |

### 3.8 Tests convention

- pgTAP sets claims with `set_config('request.jwt.claims', …)`.
- Fixtures that no M18 procedure can write are inserted as the migration owner inside the rolled-back test: fired lines, push columns, batches in each state.
- Errors are asserted as `SQLSTATE message`.
- **Rows and items are found by id, never by index (lesson 4).**
- Defaults use ≥ 2 candidates (lesson 1).
- Integration and e2e create recipes, batches and menu items through the APIs. The secret key only creates staff and counts `order_line` rows (select granted to `service_role`); it never reads `recipe`/`recipe_key` (lesson 3).
- Playwright:
  - finds selects with `getByRole("combobox", { name: /^Portata/ })` (labels wrap controls, so the accessible name includes the value: lesson 5);
  - finds menu items and lines by `data-menu-item-id`/`data-line-id`;
  - scopes "no cost" checks to the waiter page ("Costo", "Margine", "Food cost") and the "no €" check to the chef's 403 element.

### 3.9 Performance plan (NFR "order entry actions under 300 ms on 4G"; AT7 reports, promises nothing)

- **Calls per action:**
  - one RPC per action (add, edit, move, remove) and one per read;
  - the screen's first load is two parallel GETs;
  - no per-line loop, no follow-up read after a write: the write returns the line and the item's availability.
- **Fixed overhead:** `withApi`'s `staff_session_active` RPC for PIN sessions (§2.1) and `auth.getClaims()`. Both are measured separately through `Server-Timing` (`auth`, `rpc`), so AT7 shows where time goes. Folding the session check into the order procedures is a possible follow-up, chosen only if AT7 shows `auth` dominating.
- **Indexes:**
  - `order_line_session_idx` (view, M19 counts);
  - `order_line` PK (edits);
  - `batch_live_idx` (availability reads only live batches; history does not slow it);
  - `batch_movement_batch_idx` (per-batch sums);
  - `recipe_line_position_uq` (needs by `recipe_id`).
- **Locks are short and narrow:** FOR SHARE on one session and on a dish's live batches. Adds of different tables never wait (race `adds-no-wait`).
- **Region:** functions in `fra1` (`vercel.json`). The Supabase region of staging must be EU-Central to match (Q81 asks).
- **Guard in CI:** `168` runs `menu_list`, `add_order_line` and `order_view` under a 5 s statement limit on 50 menu items, 2 000 historical batches (finished/discarded/expired) and 200 lines. This is a regression net, not a latency claim.
- **AT7 measurement:**
  - `scripts/perf/order-entry.ts` is started by `.github/workflows/perf-order-entry.yml` (`workflow_dispatch` on `main`, environment `staging`, input `base_url`).
  - It creates or reuses the fake tenant "Osteria Demo Perf" (owner, waiter, menu, one table) with the secret key and fake data only.
  - It signs the waiter in, then runs 100 iterations each of add, edit, move, remove, `GET /api/menu` and `GET …/lines`, sequentially, from the GitHub runner.
  - It writes p50/p95/max of wall time and of each `Server-Timing` part to the job summary.
  - It never fails on a number. The report states that the runner is not a phone on 4G; the Gate 3 device check covers that.

## 4. Alternatives considered

- **Price captured at fire:** rejected (ADR-017; kept as V5). A push ending between order and fire would change the price quoted at the table. Offline replays would re-price.
- **Optimistic locking (version numbers, reject stale):** rejected. It contradicts PRD "no locking" and ADR-005; waiters would be rejected on every overlap.
- **LWW by server arrival time only:** rejected. A slow 4G request from the earlier edit would overwrite the later one. M20's queued ops need client time; the server time is recorded beside it.
- **A stored `status`/`state` column written by procedures:** rejected in favour of the generated `state`. It cannot drift from `fired_at`/`voided_at`.
- **Hard delete of draft lines:** rejected (project §3.6 rule 5). Removal is a void with `entry_removed`, kept for M22's "removed before fire" counts.
- **An `audit_event` per line edit:** rejected. It doubles writes on the hottest path. The line holds who and when, and M20's `applied_op` holds op results.
- **An `order_unavailable_event` table for refused adds:** rejected. Greyed items are rarely tapped, so it would undercount stock-outs; M22 derives them from the batch ledger.
- **Reusing `app.remaining_portions` (M16):** rejected for the hot path. It aggregates every batch of the tenant; `batch_live_idx` + per-batch sums stay flat as history grows. M16 is unchanged.
- **A separate `GET /api/menu/availability`:** rejected. One menu read keeps one RPC and one cached shape for M20; the menu is small.
- **Advisory lock per batch key or `serializable` for the add check:** rejected. Row locks FOR SHARE match M15's FOR UPDATE, and adds do not serialise each other.
- **Waiter RLS policy on `order_line`:** rejected (as M17). `unit_price` trips `004`/`059`, and every future column would need vetting.
- **Optimistic lines without a server reply (M20 style) in M18:** rejected for now. The line shows "Invio…" until confirmed; the full optimistic outbox is M20's.

## 5. Build plan (test first; one commit per step; `tdd-guide` follows the order)

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| 1 | Migration: `order_line`, generated state, guard, indexes (`order_line_session_idx`, `batch_live_idx`), RLS, grants (select to `service_role`); role-scan fixtures | `supabase/migrations/20261101100000_order_core.sql`, `supabase/tests/database/160_order_core.test.sql`, `supabase/tests/database/{004_waiter_cost_columns,059_cost_roles_v6}.test.sql` (one `order_line` fixture row each; assertions unchanged) | `160`. **Bounds → 23514:** qty 0, 0.4, 0.7, 99.5; note '' and 141 characters; `unit_price` −0.01; `fired_at` without `fired_by`; `voided_at` without reason; reason `'Bad Reason'`. qty 0.5, 1.5, 99 accepted. **State:** draft → `draft`; `fired_at` set → `fired`; fired then voided → `voided` with `fired_at` kept; `state` cannot be written (428C9). **Guard:** changes to `menu_item_id`, `table_session_id`, `unit_price`, `vat_rate`, `price_source`, `created_by` → `order_line_immutable`; qty/course/note change on a draft accepted; any change to a voided line refused; a fired line: qty change refused, voiding accepted; clearing `fired_at` refused. DELETE and TRUNCATE → `append_only`. **FKs:** a session of tenant B with a line of tenant A → 23503; `order_line_session_fkey` exists. **RLS:** owner/admin A read A's lines; chef A, waiter A read 0; owner B reads 0 of A's. **Privileges:** `authenticated` has no INSERT/UPDATE/DELETE; `has_table_privilege('service_role','public.order_line','select')` true, insert/update/delete false (lesson 2). `batch_live_idx` is partial on `state in ('fresh','open')`. `001`, `004`, `059` green |
| 2 | Migration: helpers (needs, availability, live-batch lock, line JSON, client time, hint constant) | `supabase/migrations/20261101100100_order_helpers.sql`, `supabase/tests/database/161_order_helpers.test.sql` | `161`. **Needs:** stew plate v1 (1 porz stew); v2 (1 porz stew + 0.5 porz ragù, yield 1) → v2's two rows (current version); a plate with raw lines only → no row. **Availability (≥ 2 candidates):** stew key with batch S1 fresh 2, S2 open 1.5, S3 expired 5, S4 `finished` (balance 0), S5 `discarded` (balance 0) → stew item (plate v1) `portions_left` 3.5, `low_stock` false (3.5 > 3); after a −0.5 movement on S2 → 3, `low_stock` true; with plate v2 and ragù at 0.5 left → `min(3, floor(2 × 0.5 / 0.5) / 2 = 1)` = 1; a negative S1 balance (−1) counts 0; all batches gone → 0, reason `no_portions`, available false; unmapped item → `portions_left` null, available true; `is_available` false → `manual` (even with portions); inactive → `inactive`; `p_items` null lists all items, two ids → two rows; tenant B's items never appear. `low_stock_hint_portions()` = 3. **Lock:** `lock_live_batches(A, {stew})` returns 2 (S1, S2 only: not the expired, finished or discarded ones); tenant B's key → 0 (the cross-session effect is proved by the races of step 10). **Client time:** now − 1 h ok; now + 60 s ok; now + 121 s → `client_time_invalid`; '2026-11-01' (no time) and 'x' → `invalid_request`. **Line JSON:** key set exactly §3.1.9's; `updatedBy.displayName` "Cameriere Due Demo" after B's edit. No API role can execute any `app.*` function of this migration |
| 3 | Migration: `menu_list` with availability and `pinned` | `supabase/migrations/20261101100200_menu_list_availability.sql`, `supabase/tests/database/162_menu_availability.test.sql`, `supabase/tests/database/153_menu_reads.test.sql` (item key-set assertion updated on purpose to the new set; every other assertion unchanged) | `162`. **AT1 (menu):** stew batches all at 0 → stew item `available` false, `unavailableReason` `no_portions`, `portionsLeft` 0. **AT2:** 3 portions → `portionsLeft` 3, `lowStock` true; 4 → `lowStock` false. Unmapped "Acqua (demo)" → `portionsLeft` null, available. **AT4:** item P1 `push_until` now + 2 h, `push_price` 12, position 5; item P2 pushed, position 0; item P3 push expired 1 min ago → `pinned` = [P2, P1] (checked by id), each `pushed` true with `pushPrice`; P3 absent from `pinned`, `pushed` false; P1 still in its category. A pushed item at 0 portions is in `pinned` with `available` false. **Key scan (waiter):** item keys exactly the set of §3.1.9; recursive scan finds no key matching `/cost\|margin\|gp\|food\|eur$\|recipe\|vat/i`. Chef → 42501. `153` green with its updated key set |
| 4 | Migration: `add_order_line` | `supabase/migrations/20261101100300_add_order_line.sql`, `supabase/tests/database/163_add_order_line.test.sql` | `163`. **AT1:** waiter A adds stew when its batches have 0 portions → P0001 `item_unavailable`, detail `{menuItemId, reason: no_portions, portionsLeft: 0}`, 0 rows. Manual "esaurito" → reason `manual`; inactive → `inactive`. **AT3:** qty 0.5 → stored 0.5; `isShared` true stored; qty 0.3 → `qty_invalid`. **Defaults (≥ 2):** no `course` → stew (secondi) `secondi`, tagliatelle (primi) `primi`; explicit `course: "primi"` on stew → `primi`; no qty → 1. **Price (≥ 2):** price rows 12,00 at 10:00, 14,00 at 11:00, 16,00 at now + 1 h → `unit_price` 14, `vat_rate` per the 11:00 row, `price_source` `menu`; pushed item (push 12, item 14) → 12, `push`, `vat_rate` = the item's; push expired → 14, `menu`. **Price frozen:** a later price row and the push ending leave the line at its price. **Idempotency:** same body twice → `created: true` then `created: false`, one row; the replay after the item went to 0 → still `created: false` (no recheck); same `lineId` on another session → `line_id_conflict`; a tenant-B line id reused by tenant A → `line_id_conflict` with no detail. **Session:** closed (inserted as owner) → `session_closed`; tenant B's session → P0002 `session_not_found`; tenant B's item → P0002 `menu_item_not_found`. Note '  senza cipolla  ' → 'senza cipolla'; '' → null; 141 characters → `note_invalid`; a control character → `note_invalid`. Unknown key → `invalid_request`. `created_by`/`updated_by` = caller; `client_updated_at` = body value. Roles: owner, admin allowed; chef → 42501, nothing written |
| 5 | Migration: `update_order_line`, `remove_order_line` | `supabase/migrations/20261101100400_edit_order_line.sql`, `supabase/tests/database/164_update_order_line.test.sql`, `supabase/tests/database/165_remove_order_line.test.sql` | `164`. **AT3:** move primi → secondi with t2 > t1 → `changed: true`, course persisted, `updated_by` = caller, `updated_at` advanced. **AT5:** waiter A edits L at t2 (note "ben cotto"); waiter B edits L at t1 < t2 (qty 2) → P0001 `conflict`, detail `{reason: stale, line}` with note "ben cotto", qty 1, `updatedBy` A; nothing changed. Reverse order (B t1 first, then A t2) → both applied; final = B's qty plus A's note (each write sets only its own fields). **Replay:** A's t2 edit again → `changed: false`, no write (`updated_at` unchanged); a different patch at t2 → `conflict` `stale`; same fields at t2 by B → `conflict` `stale`. **Irreversible:** fired line (owner fixture) edited with t3 > all → `conflict` `fired`; voided → `voided`; session closed → `session_closed`; each detail carries the current line. **Availability on qty increase:** stew at 0 portions: qty 1 → 2 → `item_unavailable`; 2 → 1 accepted; course change accepted. `{}`, missing `clientUpdatedAt`, unknown key → `invalid_request`; tenant B's line → P0002 `line_not_found`; chef → 42501. `165`. Remove at t2 → `state` voided, `void_reason` `entry_removed`, `voided_by` caller, no `batch_movement` row; replay → `changed: false`; remove at t1 < last edit t2 → `conflict` `stale` (line still draft); a later edit after removal → `conflict` `voided`; a fired line → `conflict` `fired`; chef → 42501 |
| 6 | Migration: `order_view` | `supabase/migrations/20261101100500_order_view.sql`, `supabase/tests/database/166_order_view.test.sql` | `166`. Lines (found by id) ordered by course enum then creation; the removed line absent; a fired-then-voided line present with `state` voided; `session.status` `open` (stub) and `bill_requested` after the flag (M17 hook); `closed` true for a closed session. Key sets exactly §3.1.9; recursive scan finds no `/cost\|margin\|gp\|food\|eur$\|recipe\|vat/i` key; `unitPrice` present. Waiter direct `select` on `order_line` → 0 rows. Chef → 42501; tenant B → P0002 |
| 7 | pgTAP role and tenancy matrix | `supabase/tests/database/167_order_roles.test.sql` | For each of `menu_list`, `order_view`, `add_order_line`, `update_order_line`, `remove_order_line`: owner, admin, waiter A allowed; chef A → 42501 and nothing written; no claims → 42501; tenant B owner/waiter → P0002 on A's ids and A's rows unchanged. `has_function_privilege('anon', …, 'execute')` false for all; `service_role` cannot execute any `app.*` M18 helper |
| 8 | pgTAP performance net | `supabase/tests/database/168_order_perf.test.sql` | 50 items (25 mapped), 2 000 historical batches (finished, discarded, expired) + 10 live, 200 lines on 20 sessions; under `statement_timeout = '5s'` as waiter: `menu_list()` answers with 50 items; `add_order_line` answers; `order_view` answers with 10 lines; `explain (format json)` of the availability query for one item mentions `batch_live_idx` (T1) |
| 9 | Guard: M18 preserves what it must not touch | `supabase/tests/database/169_m18_preserves.test.sql` | md5 of `app.session_fired_lines`, `app.session_statuses`, `app.table_status`, `public.open_table`, `public.update_table_session` (computed after rebasing on M17's SQL and written in the test), and of `app.remaining_portions`, `app.batch_remaining`, `app.batch_settle_state`, `public.discard_batch`, `public.produce_batch`, `app.business_date`, `app.alert_rules_body` (values on `main`) unchanged; `app.session_fired_lines` still returns no row (comment: "M19 replaces this on purpose and re-pins here"); the cost-named public functions are still the 13 of `059`; `app.alert_kind` count and both audit check definitions unchanged. PR grep: `grep -lE "create or replace function (app\.session_fired_lines\|app\.remaining_portions\|public\.discard_batch\|public\.produce_batch)" supabase/migrations/20261101*` returns nothing |
| 10 | Race cases | `scripts/test-db-races.sh` (six cases appended; header comment lists them) | CI job `db-races`, existing cases unchanged. **`edit-later-first`:** s1 (waiter A) edits L at t2 and parks; s2 (waiter B) edits L at t1 → `s2_blocked` 1; after the gate s2 fails with `conflict` naming `stale`; L has A's fields. **`edit-earlier-first`:** s1 edits at t1 and parks; s2 at t2 → blocked, then applied; L has s2's fields. **`add-vs-discard`:** s1 (chef) `discard_batch` of the stew's only batch (all 3 portions) and parks; s2 (waiter) adds stew → blocked on the batch row; then `item_unavailable`; 0 lines. **`add-then-discard`:** s1 (waiter) adds stew and parks holding FOR SHARE; s2 (chef) discards 3 → blocked; then commits; the line exists, the batch is `discarded`. **`add-same-line`:** both add with one `lineId` → s2 blocked on the PK, then `created: false`; one row. **`adds-no-wait`:** two waiters add stew on two sessions → `s2_blocked` 0, two rows. `no_deadlock` holds in all six. Each case inserts its own fixture (M17 tables, menu items, batches) in its database copy |
| 11 | Orders domain in TS: constants, schemas, outputs (snapshots), errors, view helpers, line form, i18n, client details type, parity | `src/server/orders/{constants,schemas,output,errors}.ts`, `src/server/menu/output.ts` (`serviceMenuOutput` extended), `src/lib/orders/{order-view,line-form}.ts`, `src/lib/api/client.ts` (`details?: unknown`, parsed per code by callers), `src/lib/api/errors.ts`, `src/lib/i18n/messages/{it,en,keys}.ts`, `tests/server/orders/{schemas,output,errors}.test.ts`, `tests/server/orders/__snapshots__/*`, `tests/server/menu/output.test.ts` + snapshot (updated on purpose), `tests/lib/orders/{order-view,line-form}.test.ts`, `tests/lib/api/client.test.ts`, `tests/parity/orders-sql-parity.test.ts` | `schemas.test.ts`: strict bodies; `lineId`/`menuItemId` uuid; `qty` 0.5 ok, 0.3 / 0 / 99.5 rejected; `note` ≤ 140; `clientUpdatedAt` ISO with offset required; PATCH needs ≥ 1 field; `course` enum of five. **`output.test.ts`:** `z.toJSONSchema` of `orderViewOutput`, `addLineOutput`, `lineWriteOutput`, `conflictDetails`, `itemUnavailableDetails` each `toMatchSnapshot()`; the extended `serviceMenuOutput` snapshot diff shows only the new keys and `pinned`; a walk of every waiter schema finds no `/cost\|margin\|gp\|food\|eur$\|recipe\|vat/i` property. `errors.test.ts`: every §3.4 code → status + Italian message; `conflict` details parsed strictly (an extra key in the SQL detail dropped); unknown SQLSTATE → 500 without text. `order-view.test.ts`: `itemsForCourse` with items of two courses → the tab's first, the rest in "Altri piatti" (by id); `hintFor({lowStock: true, portionsLeft: 3})` "Ne restano 3", `(2.5)` "Ne restano 2,5", `lowStock` false → null; `lineLabel(2, "Spezzatino…")` "2 × Spezzatino…", `(0.5)` "½ Spezzatino…"; `conflictMessage` "… cambiata da Cameriere Due Demo alle 20:31 …" for `2026-11-02T19:31:00Z` (Europe/Rome); `courseCounts`. `line-form.test.ts`: `nextQty` stepper (min 1, no 0), half toggle ↔ 0.5, `patchFor` sends only changed fields plus `clientUpdatedAt`. `client.test.ts`: object `details` kept. `orders-sql-parity.test.ts`: `MAX_QTY`, `NOTE_MAX`, `CLIENT_CLOCK_TOLERANCE_S`, `LOW_STOCK_HINT_PORTIONS` equal the SQL values |
| 12 | API routes + `Server-Timing` | `src/server/orders/{timing,view,add,edit,remove}.ts`, `src/app/api/table-sessions/[id]/lines/route.ts`, `src/app/api/order-lines/[id]/route.ts`, `src/app/api/order-lines/[id]/remove/route.ts`, `tests/app/api/{session-lines,order-line,order-line-remove}.test.ts`, `tests/server/orders/timing.test.ts` | Fake session client. Waiter/owner/admin → one RPC with `{p_…}`; chef → 403 **before any RPC**; no session → 401; `text/plain` → 415; > 2 KiB → 413; malformed id → 404 without RPC. `created: true` → 201, `false` → 200. P0001 `item_unavailable` → 409 with `details.menuItemId`; `conflict` → 409 with `details.line`; P0002 → 404; `qty_invalid` → 422. **An injected `unit_cost`/`margin_eur` key in the fake RPC reply is dropped and never reaches the JSON.** `Server-Timing` contains `auth`, `rpc`, `total` with numeric `dur` (fake clock) |
| 13 | Real-stack integration suite | `tests/integration/order-entry.int.ts`, `tests/integration/helpers/orders.ts` (`seedOrderTenant`: two locations, owner, two waiters, chef; stew and ragù recipes and batches via the API with `seedStewRecipe`/`seedRaguRecipe`/`seedRaguBatch`; menu items and table via M17 APIs; push columns via `runSql` on the local DB, asserted local) | **AT1:** discard the ragù batch to 0 via `POST /api/batches/:id/discard` → `GET /api/menu` tagliatelle (by id) `available: false`; `POST …/lines` → 409 `item_unavailable`. **AT2:** stew batch of 3 portions → `portionsLeft: 3`, `lowStock: true`. **AT3:** add qty 0.5 shared → `GET …/lines` shows 0.5 and `isShared`; PATCH course secondi → persisted on re-read. **AT4:** pushed item first in `pinned` with `pushPrice`. **AT5:** waiter A PATCH t2, waiter B PATCH t1 → B 409 `conflict` with `details.line` equal to A's; the other order (B t1 first, then A t2) → both 200, and the re-read line has A's (t2) fields. **Idempotency:** same POST twice → 201 then 200, secret-key count of the line id = 1; `Promise.all` of the same POST → one 201, one 200, count 1; same PATCH twice → `changed` true then false. **Roles:** chef → 403 on all three routes; waiter `from('order_line').select()` → 0 rows. **Lesson 1:** a second location added between calls changes nothing. Tenant B: 404 on A's session and line |
| 14 | Components | `src/app/(owner)/tavoli/[sessionId]/{course-tabs,pinned-strip,menu-section,menu-item-button,order-sheet,line-row,line-editor}.tsx`, `tests/components/{course-tabs,pinned-strip,menu-item-button,order-sheet,line-row,line-editor}.test.ts` | `renderToStaticMarkup` with fixture props. Tabs: `role="tablist"`, five `role="tab"`, `aria-selected` on the current, counts "Primi · 2". Pinned strip: "Da proporre", ★ plus text, push price "12,00 €"; absent when `pinned` empty. Item button: accessible name "Aggiungi Spezzatino con polenta (demo)", `data-menu-item-id`, "Ne restano 3" only with `lowStock`, "Esaurito" + `aria-disabled="true"` when unavailable; a `<script>` name rendered as text. Line row: `data-line-id`, "2 × …", "½", "Da dividere", "Segue", note text; "Invio…" when pending; a fired line has no edit button. Editor: `Select` "Portata" with five options pre-selected, "Mezza porzione" and "Piatto condiviso" with `aria-pressed`, "Nota" `maxlength="140"` and the privacy hint, "Rimuovi". No number computed in components (labels come from `order-view.ts`). Every control carries the `min-h-tap` class |
| 15 | Page `/tavoli/[sessionId]`, entry link, nav, UI note | `src/app/(owner)/tavoli/[sessionId]/page.tsx`, `src/app/(owner)/tavoli/session-panel.tsx`, `src/lib/nav/is-current.ts`, `docs/design/ui-foundation.md` (§8 line for M18), `tests/components/{order-page,session-panel}.test.ts`, `tests/lib/nav/is-current.test.ts` | Page with fixture API results: header "Tavolo 1 (demo)", "4 coperti"; a 409 `conflict` renders the warning naming "Cameriere Due Demo" and the line shows `details.line`'s values; `item_unavailable` renders "… è esaurito."; chef 403 renders "La comanda non è disponibile per il tuo ruolo."; waiter markup contains no "Costo", "Margine", "GP", "Food cost". Session panel: "Prendi la comanda" links to `/tavoli/<id>`. `isCurrent`: `/tavoli/<uuid>` marks "Tavoli" |
| 16 | Playwright: WebKit project, CI, scripted service | `playwright.config.ts` (project `phone-webkit`: `devices["iPhone 13"]` with viewport 360 × 740, `testMatch: /order-entry\.spec\.ts/`; `phone` unchanged), `.github/workflows/ci.yml` (`npx playwright install --with-deps chromium webkit`), `e2e/order-entry.spec.ts`, `e2e/helpers/seed-order.ts`, `tests/config/playwright-projects.test.ts` | Config test: projects `phone` and `phone-webkit`; WebKit matches only `order-entry.spec.ts`. **AT6 (both projects):** waiter opens T1 with 4 covers; the ragù batch is at 0, so "Tagliatelle al ragù (demo)" shows "Esaurito" and tapping it adds nothing (**AT1 UI**); the script enters antipasti (2 "Bruschetta (demo)"), primi (2 "Zuppa del giorno (demo)"), secondi (4 "Spezzatino con polenta (demo)": one "Mezza porzione", one "Piatto condiviso", one note "senza cipolla"); moves one line to dolci via `getByRole("combobox", { name: /^Portata/ })`; the sheet shows the lines by `data-line-id`; elapsed time logged (not asserted; the 90 s check is human, Gate 3). `expectPhoneFriendly` on the page with the sheet open and the editor open (≥ 44 px, no overflow), light and dark. **AT2/AT4 UI:** "Ne restano 3" on the stew; the pushed item is the first menu button in `main` (by `data-menu-item-id`). **AT5 UI:** two waiter contexts; B's PATCH is held with `page.route` while A edits the same line; B's request released → B sees the conflict warning naming "Cameriere Demo". Chef: `/tavoli/<id>` shows the 403 message and **that element** contains no `€` |
| 17 | AT7 measurement script and manual workflow | `scripts/perf/order-entry.ts`, `scripts/lib/perf-order-entry.ts` (setup, run, stats, report), `tests/scripts/perf-order-entry.test.ts`, `.github/workflows/perf-order-entry.yml`, `tests/config/perf-workflow.test.ts` | `perf-order-entry.test.ts` (fakes, no network): p50/p95 by nearest rank on [1..100] → 50/95; `Server-Timing` parsing of `auth;dur=12.5, rpc;dur=40` → {auth: 12.5, rpc: 40}; the target guard refuses a Supabase URL whose host is not `<STAGING_PROJECT_REF>.supabase.co` and a `base_url` that is not `https://`; setup is idempotent (second run reuses "Osteria Demo Perf"); the report contains every endpoint's p50/p95/max and the sentence "Misurato da un runner GitHub, non da un telefono in 4G"; exit code 0 regardless of numbers. `perf-workflow.test.ts`: `workflow_dispatch` only, `if: github.ref == 'refs/heads/main'`, `environment: staging`, `persist-credentials: false`, secrets only in the run step |

**Acceptance tests → proof**

| AT (plan §5a.3 M18) | Files (step) | Command |
|---|---|---|
| 1 Empty mapped batch → 409 `item_unavailable`; menu marks it unavailable | `161` (2), `162` (3), `163` (4), race `add-vs-discard` (10), route tests (12), `order-entry.int.ts` (13), `menu-item-button.test.ts` (14), `order-entry.spec.ts` (16) | `npx supabase test db`; `scripts/test-db-races.sh`; `npm test`; `npm run test:integration`; `npx playwright test` |
| 2 3 portions left → `portionsLeft: 3` (the AT's `portions_left`, camelCase per house style) and hint rendered | `161` (2), `162` (3), `order-view.test.ts` (11), integration (13), `menu-item-button.test.ts` (14), e2e (16) | as AT1 without races |
| 3 Half portion 0.5 and shared flag stored; move primi → secondi persists | `160` (1), `163` (4), `164` (5), integration (13), e2e (16) | as AT2 |
| 4 Pushed items first, with marker and `pushPrice` | `162` (3), `163` push price (4), integration (13), `pinned-strip.test.ts` (14), e2e (16) | as AT2 |
| 5 Two edits to one line: later `clientUpdatedAt` wins; the earlier caller gets `conflict` with the current state | `164` (5), races `edit-later-first`, `edit-earlier-first` (10), `errors.test.ts` (11), route tests (12), integration (13), page test (15), e2e (16) | as AT1 |
| 6 Playwright WebKit + Chromium mobile: 4-cover, 3-course table by script; all targets ≥ 44 px | `order-entry.spec.ts`, `playwright.config.ts` (16) | `npx playwright test` |
| 7 Preview-deploy p95 reported against 300 ms (no number promised) | `perf-order-entry.ts` + workflow (17), `168` net (8) | `perf-order-entry.yml` by hand on `main` after merge (Q81); report pasted into the PR / DigiAlto-Ops context |
| Roles: waiter never sees costs; chef never €; tenancy | `160` (1), `162` (3), `166` (6), `167` (7), `169` (9), route tests (12), integration (13), components (14–15), e2e (16) | all of the above |
| Invariants: prices frozen at sale, nothing deleted, single transactions, `tenant_id` + RLS, no data logic in React, secret key not in `src/` | `160` guard (1), `163`–`165` (4–5), `169` (9), components (14–15), existing `tests/lint/admin-client-import.test.ts` | `npx supabase test db`; `npm test`; `npm run lint` |

**CI implications:**
- pgTAP `160`–`169` run in the `supabase` job and in `scripts/test-db-native.sh` (no shim change).
- `004`, `059` gain a fixture row; `153` changes its key-set assertion on purpose.
- Six race cases. WebKit is installed in the `supabase` job and runs only `order-entry.spec.ts`.
- New Vitest snapshots; the `serviceMenuOutput` snapshot is updated on purpose.
- No new CI secret. Coverage ≥ 80 % on new TS.

### 5b. Variants

**V1 — "Segue" as a separator on the order, not a flag on a line** · Trigger: Q75 answered "segue is a line on the comanda between dishes, not a mark on one dish" · Replaces steps: the `segue` column of 1, the `segue` key of 4–6, 11, 14

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V1.1 | `order_line.kind text not null default 'dish' check (kind in ('dish','segue'))`; a `segue` row has no menu item, qty, price or note (check); `add_order_line` accepts `{lineId, kind: "segue", course, clientUpdatedAt}`; `order_view` returns it in place; `segue` boolean dropped | `supabase/migrations/<ts>_segue_separator.sql`, `supabase/tests/database/<n>_segue_separator.test.sql` (next free block) | A separator between two primi stays between them in `order_view` (by id); a separator with `menuItemId` → `invalid_request`; it can be moved and removed like a line; no price on it; availability never checked |
| V1.2 | "Segue" button in the sheet inserts a separator in the selected course; schemas and snapshots updated on purpose | `src/server/orders/{schemas,output}.ts`, `src/app/(owner)/tavoli/[sessionId]/order-sheet.tsx`, `tests/server/orders/output.test.ts`, `tests/components/order-sheet.test.ts`, `e2e/order-entry.spec.ts` | The sheet renders "— Segue —" between the lines; the editor has no "Segue" toggle; e2e inserts one separator |

**V2 — Unsent lines reserve portions** · Trigger: Q76 answered "count dishes already ordered but not sent" · Replaces steps: the `portions_left` formula of 2, the lock mode of 4–5, the AT1/AT2 numbers of 3, 13

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V2.1 | `menu_item_availability` subtracts Σ `qty × need` of draft lines on open sessions; `lock_live_batches` takes FOR UPDATE on the live batch rows so two adds of one dish serialise | `supabase/migrations/<ts>_reserve_portions.sql`, `161`, `162`, `163` | 3 portions and two draft stew lines (qty 1 each) → `portionsLeft` 1; a third add accepted, a fourth → `item_unavailable`; a removed draft frees its portion; a line on a closed session reserves nothing |
| V2.2 | Race `adds-same-dish-reserve` replaces `adds-no-wait` for one dish | `scripts/test-db-races.sh` | 1 portion left: s1 adds and parks; s2 blocked; then `item_unavailable`; adds of different dishes still `s2_blocked` 0 |

**V3 — Low-stock threshold set by the owner** · Trigger: Q77 answered "we want to choose the number" · Replaces steps: the constant of 2 and its parity case in 11

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V3.1 | `sale_settings.low_stock_hint_portions smallint not null default 3 check (between 1 and 99)` (M17 table); `app.low_stock_hint_portions(p_tenant)`; `set_sale_settings` accepts `lowStockHintPortions` (audited `sale_settings.changed`) | `supabase/migrations/<ts>_low_stock_setting.sql`, `supabase/tests/database/<n>_low_stock_setting.test.sql` | Tenant A 5, tenant B default 3: 4 portions → A `lowStock` true, B false; 0 and 100 → `invalid_request`; the change writes one audit row |
| V3.2 | Field "Avviso scorte basse (porzioni)" on "Tavoli · impostazioni" | `src/app/(owner)/tavoli/impostazioni/coperto-card.tsx`, `src/server/tables/schemas.ts`, `tests/components/coperto-card.test.ts`, `tests/parity/orders-sql-parity.test.ts` | Field pre-filled 3; saving 5 sends `lowStockHintPortions: 5`; the parity test checks the bounds instead of the constant |

**V4 — An order may not exceed the portions left** · Trigger: Q78 answered "with 1 left, the waiter must not be able to order 2" · Replaces steps: the "only 0 blocks" cases of 4 and 5

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V4.1 | `add_order_line` and qty increases refuse `qty > portions_left` with `item_unavailable` reason `not_enough` and `portionsLeft` | `supabase/migrations/<ts>_qty_cap.sql`, `163`, `164` | 1 left: qty 1 accepted, qty 2 → `not_enough` with `portionsLeft: 1`; 0.5 left: qty 0.5 accepted; unmapped items never capped |
| V4.2 | Message "Ne resta solo 1." and the "+" stepper disabled at `portionsLeft` | `src/lib/orders/order-view.ts`, `src/lib/orders/line-form.ts`, `src/server/orders/errors.ts`, `tests/lib/orders/{order-view,line-form}.test.ts`, `tests/server/orders/errors.test.ts`, `tests/components/line-editor.test.ts` | `not_enough` → 409 with the Italian message; `nextQty(1, +1, portionsLeft 1)` stays 1; the editor's "+" has `disabled` at the cap |

**V5 — Price taken when the course is sent** · Trigger: Q79 answered "the price must be the one in force when the dish goes to the kitchen" · Replaces steps: the price capture of 4; the price columns' immutability of 1; the frozen-price cases of 4

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V5.1 | `unit_price`, `vat_rate`, `price_source` nullable on drafts; the guard allows them once, at the same update that sets `fired_at` (M19 writes them); `order_view` shows the current menu or push price for drafts as `unitPrice` with `priceFinal: false` | `supabase/migrations/<ts>_price_at_fire.sql`, `160`, `163`, `166`, `src/server/orders/output.ts`, `tests/server/orders/output.test.ts` | A draft has null price columns; `order_view` shows today's price, `priceFinal` false; a fixture fire sets them once and a second change is refused; the push ending before the fire changes a draft's shown price |

**V6 — The preview deployment is password-protected** · Trigger: Q81 answered "the preview/staging app has Vercel deployment protection" · Replaces steps: the request headers of 17

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V6.1 | The script sends `x-vercel-protection-bypass` from `VERCEL_AUTOMATION_BYPASS_SECRET` (a `staging` environment secret, run step only) | `scripts/lib/perf-order-entry.ts`, `.github/workflows/perf-order-entry.yml`, `tests/scripts/perf-order-entry.test.ts`, `tests/config/perf-workflow.test.ts` | With the variable set, every fake request carries the header; without it the script stops with "manca VERCEL_AUTOMATION_BYPASS_SECRET" before any request; the secret never appears in the report; the workflow passes it to the run step only |

**V7 — No half portions or shared plates (project V2)** · Trigger: project Q7 answered "neither exists" · Replaces steps: the 0.5 and `is_shared` cases of 1, 4, 11, 14, 16 (project V2 adapted to M18's files)

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V7.1 | Order bodies reject non-whole `qty` and `isShared: true` with 422 `modifier_not_offered` (SQL and Zod) | `supabase/migrations/<ts>_no_half_shared.sql`, `163`, `164`, `src/server/orders/{schemas,errors}.ts`, `tests/server/orders/{schemas,errors}.test.ts` | qty 0.5 → `modifier_not_offered`; `isShared: true` → same; qty 2 accepted |
| V7.2 | The editor shows only quantity, course, "Segue" and note | `src/app/(owner)/tavoli/[sessionId]/line-editor.tsx`, `tests/components/line-editor.test.ts`, `e2e/order-entry.spec.ts` | No "Mezza porzione" or "Piatto condiviso" control rendered; the e2e script runs without them |

## 6. Risks and mitigations

- **Security / privacy**
  - *Definer functions bypass RLS:* role check first, empty `search_path`, tenant from `app.tenant_id()`, every statement tenant-filtered, helpers without API grants (steps 2–7, `167`).
  - *Costs reaching the waiter:*
    - no waiter/chef policy on `order_line` (`160`);
    - fixed key sets and recursive scans (`162`, `166`);
    - strict outputs that drop injected keys (12) and committed JSON-schema snapshots (11);
    - no new cost-named function (`169`);
    - `order_line_cost` stays M19's separate table.
  - *€ reaching the chef (project V6):* chef 403/42501 on every M18 read and write (7, 12, 13, 16).
  - *IDOR:* foreign session, line or item ids → P0002/404. A client-chosen `lineId` colliding with another tenant's row gets `line_id_conflict` without detail. Malformed ids → 404 before any RPC.
  - *Input validation:* strict Zod + strict SQL parsing (unknown keys, qty grid, note length and control characters, ISO time with tolerance), 2 KiB bodies, JSON content type (CSRF via `withApi`). Names and notes are rendered as text (React escaping; `<script>` case in 14).
  - *Personal data in notes:* hint text, 140-character cap, codes-only logs (§3.1.13). Flagged to the founder for the GDPR register (project Q13/Q14).
  - *Clock abuse in LWW:* the server rejects client times beyond +120 s. Irreversible states win regardless of time. Every loss is visible as a `conflict`.
- **Correctness**
  - *Lost edits between waiters:* row lock + LWW + `conflict` reply with the current line (5, 10, 13, 16).
  - *Ordering a dish that just ran out:* FOR SHARE on live batches serialises with M15 discards and M19 firing (`add-vs-discard`, `add-then-discard`). A batch produced during the add is not seen until the next request (accepted: the waiter retries).
  - *Double lines from retries:* client `lineId` + replay answer + PK race handling (`add-same-line`, integration `Promise.all`).
  - *Breaking M17:* `menu_list` is replaced with the same signature and order, and `153` is updated on purpose. M17's status functions and stub are md5-pinned in `169`. §2.2 lists every relied-on name for the re-check after M17's SQL lands.
  - *Shared fixtures:* `004`/`059` rows are added in step 1 with the table. Race cases build their own fixtures.
- **Unverified (proved in the named step):**
  - **T1:** the batch-id qual in the lateral subquery over `v_batch_portions` is pushed below the view's `group by`, so the sum reads `batch_movement_batch_idx`, and `batch_live_idx` is chosen for live batches. Proved by the `explain` check and the 5 s net in `168` (step 8). PostgreSQL docs: <https://www.postgresql.org/docs/current/queries-table-expressions.html#QUERIES-LATERAL>.
  - **T2:** FOR SHARE conflicts with FOR UPDATE and FOR NO KEY UPDATE but not with another FOR SHARE (<https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS>). Proved by `add-vs-discard`, `add-then-discard`, `adds-no-wait` (step 10).
  - **T3:** a `generated always … stored` column over `fired_at`/`voided_at` updates when those columns change (<https://www.postgresql.org/docs/current/ddl-generated-columns.html>). Proved in `160` (step 1).
  - **T4:** Playwright's WebKit runs the magic-link sign-in and `page.route` holding of a request as Chromium does (<https://playwright.dev/docs/api/class-route>). Proved by step 16 in the `phone-webkit` project.
- **Performance / cost**
  - §3.9 covers this: one RPC per action, narrow indexes, `Server-Timing`, the `168` net, and AT7 as a report. **No latency figure is promised.**
  - The PIN-session check is a known extra round trip, measured separately.
  - No provider or running cost. WebKit adds CI time to the `supabase` job (one spec).
- **Dependencies:** none added. Playwright WebKit is a browser of the existing `@playwright/test` (Apache-2.0), installed in CI. Zod 4 `z.toJSONSchema` is already used (<https://zod.dev/json-schema>).
- **Plan changes to record in DigiAlto-Ops `clients/osteria-dei-rossi/context.md`:**
  - §3.3: `POST /api/tables/:id/lines` → `/api/table-sessions/:id/lines`; `GET /api/table-sessions/:id/lines`; `POST /api/order-lines/:id/remove`;
  - §3.5.1 `order_line`:
    - adds `vat_rate`, `price_source`, `fired_by`, `voided_by` and a generated `state`;
    - `unit_price` is frozen at entry (ADR-017);
    - delete before fire = void `entry_removed`;
  - §3.5.3: `menu_availability()` is `app.menu_item_availability`, exposed through `GET /api/menu` (no separate endpoint);
  - success metric "stock-outs < 2/week": M22 derives them from the batch ledger and M19 alerts, not from M18 events;
  - AT7 runs after merge (staging gets migrations from `main` only).

## 7. Open questions for the founder (defaults in force for this build)

**Already decided and applied:** Q16 = project V6 (the chef never sees €).

**Still open from the project plan:**
- **Project Q7 — Do half portions and shared plates exist?**
  - **Default:** yes. "Mezza porzione" (counts as 0.5 and is charged at half price in M21) and "Piatto condiviso".
  - **Alternative:** neither (→ V7, project V2).
- **Project Q14 — retention:** order notes and lines follow the sales records. Confirm the period with the accountant.

**New:**
- **Q75 What is "segue" on your comanda?**
  - **Default:** a mark on a dish, "this one follows, wait for the call".
  - **Alternative:** a separator line between groups of dishes (→ V1).
- **Q76 Should dishes already ordered but not yet sent count against the portions left?**
  - **Default:** no. Stock drops when the course is sent (PRD), and "Ne restano 3" counts the kitchen's portions.
  - **Alternative:** yes (→ V2).
- **Q77 When should "Ne restano N" appear?**
  - **Default:** at 3 portions or fewer, the same for every dish.
  - **Alternative:** you set the number (→ V3).
- **Q78 With 1 portion left, may a waiter order 2?**
  - **Default:** yes. Only 0 blocks; the kitchen sees the shortage.
  - **Alternative:** no (→ V4).
- **Q79 Which price does the guest pay if a "push" price ends before the dish is sent?**
  - **Default:** the price when the waiter took the order.
  - **Alternative:** the price when the course is sent (→ V5).
- **Q80 Phone clock tolerance.**
  - **Default:** a phone more than 2 minutes ahead of the server cannot send edits and is told to fix its date and time.
  - A different number is a constant change (`CLIENT_CLOCK_TOLERANCE_S` and its parity test), not a variant.
- **Q81 The AT7 timing run.**
  - **Default:** after the merge, you approve one manual run of `perf-order-entry.yml` on `main` against the staging app URL you give us. It uses fake data in a tenant "Osteria Demo Perf" on staging.
  - Please confirm:
    - the URL;
    - that the staging Supabase project is in the EU-Central region (Vercel functions run in `fra1`);
    - whether the deployment is password-protected (→ V6).
  - Results are reported, not promised.

**Assumptions (confirm; a different answer means a re-plan, not a variant):**
- **A1:** a line belongs to one table session. Moving lines between tables is not needed in the MVP (M17 A4).
- **A2:** any waiter on shift may edit or remove any unsent line of any open table (M17 "several waiters").
- **A3:** the push price is VAT-inclusive, at the dish's VAT rate.

**Technical, resolved inside the build:** T1–T4 (§6).

## 8. Manual steps for the founder

- None are needed to build, test or merge M18. Migrations reach staging through the existing CI deploy job after merge.
- After merge: answer Q81 and approve the `perf-order-entry.yml` run (AT7). The report goes in the PR thread and in DigiAlto-Ops.
- Answer Q75–Q80 and project Q7 when convenient. Each different answer triggers the named variant as a follow-up PR.

## 9. Sources

- Worktree `/home/user/osteria-m18`:
  - the files in §2; `docs/prd.md`; the project plan;
  - the M11, M14, M15, M16 and M17 plans; ADR-002, -005, -013, -014, -016;
  - `docs/client-facts.md`; `docs/design/ui-foundation.md`; `playwright.config.ts`; `.github/workflows/{ci,deploy-staging,t1-staging}.yml`.
- PostgreSQL row locks: <https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS> (T2).
- PostgreSQL LATERAL subqueries: <https://www.postgresql.org/docs/current/queries-table-expressions.html#QUERIES-LATERAL> (T1).
- PostgreSQL generated columns: <https://www.postgresql.org/docs/current/ddl-generated-columns.html> (T3).
- Playwright clock and route APIs: <https://playwright.dev/python/docs/clock>, <https://playwright.dev/docs/api/class-route> (T4).
- Zod 4 JSON Schema: <https://zod.dev/json-schema>.
- `Server-Timing` header: <https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Server-Timing>.
