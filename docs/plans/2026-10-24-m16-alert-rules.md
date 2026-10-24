# Tech plan — Osteria Digitalization · M16 Reorder, prep, purchase and expiry rules (hourly)

- **Client slug / internal:** `osteria-dei-rossi`.
  - The approved client facts in `docs/client-facts.md` are the trading name, the brand colours and the fonts. M16 needs no other client fact.
  - The drafts in `docs/client/` are not used by any fixture, seed or UI text.
  - Every fixture is fake:
    - tenants "Osteria Demo A/B"; users "Titolare Demo", "Admin Demo", "Chef Demo", "Cameriere Demo";
    - location "Cella (demo)";
    - ingredients "Manzo muscolo (demo)", "Cipolla (demo)", "Carota (demo)", "Acqua (demo)" (`is_stock` false);
    - recipes "Spezzatino (demo)" (batch) and "Soffritto (demo)" (sub), as in M14 §3.8;
    - supplier "Macelleria X (demo)"; invented lot codes, packs and quantities.
- **Repo and branch:** `osteria-dei-rossi-app`, worktree `/home/user/osteria-m16`, branch `feat/m16-alert-rules` from `main` `80e6809` (M0–M9 and M11–M14 merged), one draft PR.
- **Parallel work and numbering (no collisions):**
  - **M16 uses migrations `20261030100000`–`20261030100900`, pgTAP `140`–`149`, ADR-015, questions from Q60, e2e `e2e/alert-rules.spec.ts`.**
  - M15 (batch adjust/discard/split, staff meals, waste report) uses `20261029*`, pgTAP `130`–`139`, ADR-014.
  - Expected merge conflicts, whichever merges second (keep both sides):
    - `src/lib/i18n/messages/{it,en,keys}.ts` and `src/lib/api/errors.ts` (`ErrorCode` union);
    - `src/app/(owner)/owner-nav.tsx`, `src/lib/nav/is-current.ts`, `src/app/page.tsx` (home links), `docs/design/ui-foundation.md` §8;
    - `src/server/alerts/{kinds,templates,names}.ts` and `src/server/alerts/list.ts` (`alertHref`), if M15 adds an alert kind;
    - `scripts/test-db-races.sh` (cases appended at the end) and `supabase/tests-native/races_fixture.sql`;
    - pgTAP `004` and `059` fixture blocks: M15 adds `staff_meal_rule` rows; **M16 adds no public table**, so it touches neither.
  - **The alert kinds are not a check constraint.** In the merged SQL they are rows of the registry table `app.alert_kind` (`20261022150100_alert.sql`). A milestone adds its kinds with `insert into app.alert_kind`. Two milestones inserting different kinds never lose each other's rows, so there is nothing to union there.
  - **The shared check constraints that are re-created are `public.audit_event`'s `audit_event_entity_type_check` and `audit_event_action_check`** (plus `app.job_run`'s `job_run_job_check`, which M16 does not touch). They lost M11's values once and were repaired by `20261027100800_audit_checks_with_staff.sql`.
    - M16 re-creates both audit checks (step 1). **The migration includes every value of every earlier migration**, found by sweeping all files in `supabase/migrations/`, including `20261029*` if M15 has merged first.
    - M16's timestamp `20261030…` sorts after M15's `20261029…`, so M16's re-creation runs last whatever the merge order. **If M15 adds audit values and merges first, M16 must rebase and add them to its lists before merging.** If M16 merges first, M15 must not re-create the checks without M16's values. The new guard `tests/config/check-constraint-union.test.ts` (step 1) fails CI in both cases.
  - **Variant IDs:** V1–V7 below belong to this plan. The project plan's chef variant is always written "project V6".
- **Author:** architect · **Date:** 2026-10-24
- **ADR:** `docs/adr/adr-015-alert-rules.md` (proposed). It records:
  - per-recipe rule settings on the stable `recipe_key`, outside the immutable versions;
  - the projection formula and the delivery calendar in SQL, with an explicit clock;
  - chef-safe payloads, with names resolved when the alert is shown.
- **Sources:**
  - `docs/prd.md`: Goal 3; 2.4 (all bullets, the stew and Macelleria examples); Module 2 acceptance ("the stew example … produces the prep alert within the hourly rules run"); Testing NFR ("the stew example is a test case");
  - project plan: §3.3 (rules/alerts row), §3.4 flow 5, §3.5.1 (supplier, supplier_item, ingredient, recipe, alert), §3.6, §3.9 (alert-rules row), §3.10, §3.11.2 with project V6, §5 (M16 row), §5a.2 M16 (AT1–AT7), §7 Q14, Q16;
  - plans M6, M9, M12, M13, M14; ADR-002, ADR-003, ADR-006, ADR-007, ADR-011, ADR-013;
  - the SQL listed in §2. **Where the SQL and a plan differ, the SQL wins.**

> **Flags for the founder (read first)**
> - **Alerts stay in the app (your M6 decision of 2026-10-23).** No email or Telegram is added. You see every alert; the chef sees the kitchen ones (prep, raw short for a prep, expiry). Purchase orders go to you only (Q60).
> - **The chef never sees €** (Q16 = project V6). No M16 alert or settings screen carries a price.
> - **The alert text differs slightly from the plan's wording.** Alerts the chef can read may hold only ids, quantities, dates and codes (the M12 guard), so the plan's payload `{recipe: stew, needed_kg: 5.0, on_hand_kg: 12.3}` is stored as `{recipe_key, ingredient_id, needed_qty: 5.0, on_hand_qty: 12.3, unit: "kg", …}`. Names are looked up when the alert is shown. The message reads exactly as in the PRD.
> - **Changing a recipe's minimum or target portions does not create a new recipe version.** These settings belong to the recipe itself (ADR-015). The recipe screen still shows the version's values as the starting point.
> - **No new dependency, secret, provider, scheduled job or public table.** The existing hourly job `alert-rules` runs the new rules.
> - Q60–Q66 (§7) have their **defaults in force for this build**. They go in the PR body.

## 1. Goal and scope

- **Goal:** each hour, raise the prep, purchase and expiry alerts early enough to act on (PRD Goal 3), from settings that the owner can edit and the chef can read.
- **In scope:**
  - Settings, readable by owner, admin and chef, writable by owner and admin, each change audited:
    - per ingredient: min, target, preferred supplier item; the critical flag through M13's existing endpoint;
    - per supplier: lead time, delivery weekdays, order cut-off;
    - per batch recipe: min and target portions, prep time.
  - APIs `GET/PATCH /api/rules/{ingredients,suppliers,recipes}`.
  - Four rules inside the existing hourly `app.run_alert_rules()`:
    - prep alert;
    - purchase suggestion when raw stock is short for a prep;
    - purchase alert from projected stock;
    - expiry alerts for raw lots and batches.
  - Five alert kinds, with Italian and English messages.
  - A service-role wrapper `public.alert_rules_run(p_at)`, used by the integration and e2e suites.
  - Screens `/riordino`, `/riordino/ingredienti`, `/riordino/fornitori`, `/riordino/ricette` (phone first at 360 px, Italian), and a "Riordino" tab.
- **Out of scope:**
  - Configurable rules engine (M27); demand-model forecast (M32); the push list report (M23 reads M16's expiry data, §3.9).
  - Email, Telegram or push delivery (M6 decision; project V1, M26).
  - Purchase orders: the app does not record "ordered" (Q65 → V5).

## 2. Current state (worktree on `80e6809`)

- **Alerts (M6, M8, M9, M12):**
  - `20261022150100_alert.sql`:
    - registry `app.alert_kind (kind, cost_bearing, default_severity, default_audience ⊆ {owner,chef} ∋ owner)`;
    - `public.alert` with the dedup index `alert_dedup_uq (tenant_id, kind, entity_type, entity_id, business_date) nulls not distinct`;
    - append-only except a set-once ack;
    - RLS: owner reads all; chef reads rows with `chef ∈ audience_roles` and not cost-bearing; admin and waiter read none.
  - `app.raise_alert` (last replaced in `20261026100200_chef_payload_allowlist.sql`):
    - cost guards, then the chef allow-list `app.chef_payload_allowed` as its last guard;
    - the allow-list rule: every key ends in `_id|_key|_qty|_count|_hours|_days|_date|_at` or is `unit`; every string is a uuid, a date, an ISO instant or a code `^[a-z][a-z0-9_]{0,39}$` (`20261026100900`);
    - the business date is `app.alert_business_date` = the Rome **calendar** date of `p_at`, with no cut-off.
  - `app.try_raise_alert(…, p_caller)` (`20261023110400`): absorbs the guard codes into `app.alert_refusal` and returns the id, also when the alert already existed.
  - `app.run_alert_rules(p_at timestamptz default now())`: a fixed wrapper (job_run, savepoint, `rule_failed`) around the replaceable `app.alert_rules_body(p_at)`.
    - Pinned by md5 in `075` and `089`. It is scheduled by `cron.schedule('alert-rules', '0 * * * *', …)` (`20261022150400`).
  - `app.alert_rules_body` = M9's version (`20261024100300`): one loop over tenants, with two isolated blocks (`payable_reminder_rule`, `payables_digest_rule`) whose failures go to `record_alert_refusal(…, 'rule_failed', sqlstate)`.
    - **Pinned by md5 `0cfd0da5…` in `089`, `098` and `119`.** `089` says: "a later migration that replaces alert_rules_body … fails here: re-pin it on purpose".
  - TS: `src/server/alerts/{kinds,templates,names,render,list}.ts`.
    - A new kind = registry row + template + both texts in one commit; `tests/integration/alerts.int.ts` checks parity.
    - `names.ts` resolves `ingredient` and `location` names on the reader's session.
    - `GET /api/alerts` is for owner and chef.
- **Jobs (M13):** `app.job_health_checks` watches `alert-rules` (stale after 3 h, failed runs, unscheduled) and `alert_refusal` rows. Jobs are managed only with the `cron.*` functions; `supabase/tests-native/platform_shim.sql` provides them in plain Postgres. **M16 adds no job and changes no schedule.**
- **Master data (M1):**
  - `supplier.lead_time_days smallint 0–365`, `delivery_weekdays smallint[] ⊆ 1..7` (ISO, 1 = Monday, default `{}`), `order_cutoff_time time`;
  - `supplier_item (pack_count, pack_qty, pack_unit, is_preferred, is_active, last_price)`:
    - unique preferred active item per ingredient;
    - owner/admin only, because of `last_price`;
  - `ingredient.min_level`, `target_level numeric(12,4)` (check target ≥ min), `is_critical`.
  - `authenticated` still has column INSERT/UPDATE grants on these reorder columns (owner/admin through RLS). No `src/` code uses them.
  - `public.set_preferred_supplier_item(item_id)` is SECURITY INVOKER and does not filter by tenant. It is safe only under RLS, so a definer must not call it.
- **Critical flag (M13):** `public.set_ingredient_critical` (owner, admin, chef; audited `ingredient.critical_changed`) and `GET/PATCH /api/counts/critical`.
- **Recipes (M7):** `recipe_key (type, current_version, name_norm, is_active)`; immutable `recipe` versions carrying `prep_time_min`, `min_portions`, `target_portions` (batch only, trigger `recipe_type_fields`); `v_recipe_current`. The recipe form writes these per version.
- **Raw stock (M12):**
  - `stock_movement`:
    - types `receipt, consumption, waste, transfer, count`;
    - a consumption has `qty < 0`, and its reversal has the same type with `qty > 0` and `reverses_id`;
    - `effective_on` = the Rome date of the operation; indexes `(tenant_id, ingredient_id, location_id)`, `(tenant_id, raw_lot_id)`, `(tenant_id, ref_type, ref_id)`.
  - `raw_lot.expiry date`; `app.expiry_state(expiry, today)` returns `due_soon` when expiry ≤ today + 1. `app.base_factor('conf', base, pack_count, pack_qty, pack_unit)`; `app.venue_date`.
- **Batches (M14):**
  - `batch (recipe_key, recipe_id, lot_code, use_by, state)`, `v_batch_portions (batch_id, portions_remaining)`;
  - `app.use_by_state(use_by, now)` returns `due_soon` within 24 h;
  - `app.batch_requirements(tenant, recipe_id, p_at)` gives the raw quantities per batch, sub-recipes expanded;
  - `batch_movement_m14_ck` allows only `produce` rows until M15 replaces it.
- **Audit checks:** the latest definitions are in `20261027100800_audit_checks_with_staff.sql`:
  - entity types: `invoice, ingredient, recipe, tenant, payable, app_user, venue_device, device_enrolment, count_session`;
  - actions: the 21 values listed there.
- **Missing today:** no rule for prep, purchase or expiry; no rules screens or APIs; no recipe-level settings outside versions.

## 3. Design

### 3.1 Decisions

1. **Where the settings live.**
   - Ingredient and supplier settings stay in their M1 columns.
   - Per-recipe settings go on `recipe_key`, as three nullable columns: `rule_min_portions`, `rule_target_portions`, `rule_prep_time_min`.
     - A recipe version is immutable, and a new version for a stock setting would churn the cost history (ADR-007, ADR-008).
     - The **effective** value of each field is `coalesce(recipe_key.rule_x, current version.x)`. A value set on the screen wins; otherwise the version's value applies, so imports and the recipe form keep working.
     - `rule_min_portions = 0` switches the prep rule off for that recipe.
   - The M7 trigger `recipe_key_guard` checks only identity fields, so these columns are updatable by definer procedures. No API role gets a grant on them.
   - **Writes go through definer procedures only, each writing an `audit_event`.** M16 revokes the direct column INSERT/UPDATE grants on `ingredient (min_level, target_level)` and `supplier (lead_time_days, delivery_weekdays, order_cutoff_time)`, so a change cannot bypass the audit.
2. **The clock.** Every rule function takes `p_at timestamptz` and never calls `now()`.
   - `today = app.alert_business_date(tenant, p_at)`, the Rome calendar date (M6).
   - Tests pass a fixed `p_at`. The cron job uses the default `now()`.
   - The rules read the ledgers as they are at run time. `p_at` sets the clock: dates, delivery windows, use-by comparisons and the business date.
3. **Usable on hand** (`app.usable_on_hand(p_tenant, p_today)`; one set-based query per tenant, every location).
   - Per ingredient: Σ `stock_movement.qty`, **minus** the positive balance of each lot whose `expiry < p_today`.
   - The unlotted bucket counts, even when negative, because it is a real shortfall.
   - Expired stock cannot be cooked, so it never makes a prep look possible.
4. **Prep rule** (`app.prep_rule(p_tenant, p_at)`; PRD stew example; AT1, AT2). It runs for each active `batch` key with an effective min > 0.
   - `remaining` = Σ `greatest(portions_remaining, 0)` over its batches with `use_by > p_at`. An expired batch is not available.
   - When `remaining < min`:
     - `reqs` = `app.batch_requirements(tenant, current version id, p_at)` restricted to `is_stock` ingredients, with `needed = round(qty_per_batch, 4)`.
     - `have` = usable on hand (decision 3).
     - `batches_possible = floor(min over reqs of greatest(have, 0) / needed)`.
     - `batches_wanted = greatest(1, ceil((coalesce(target, min) − remaining) / portions_per_batch))`.
     - The **binding ingredient** is the one with the lowest `have / needed`, ties broken by id.
     - `batches_possible ≥ 1` → **`prep_due`** with `batches_count = least(wanted, possible)` and the binding ingredient's `needed_qty = needed × batches_count`.
     - Otherwise → **`prep_raw_short`** (the PRD's "purchase suggestion instead"), naming the binding ingredient, how many ingredients are short (`short_count`), and, when its preferred supplier is configured, that supplier's next order deadline and delivery date (decision 6).
   - A recipe with no stock ingredient gives `prep_due` with the ingredient fields null.
   - A recipe that `batch_requirements` refuses (`recipe_not_producible`) is skipped and recorded in `alert_refusal` (caller `prep_rules`, code `recipe_not_producible`). The other recipes go on.
   - **Stew:** remaining 4 < min 5, target 30, 30 portions per batch → wanted 1. Beef needs 5,0 and has 12,3 → possible 2 → `prep_due`, needed 5,0, on hand 12,3 (AT1). With beef 3,0 → possible 0 → `prep_raw_short` (AT2). In one run, a recipe gets exactly one of the two.
5. **Trailing-14-day weekday average** (`app.weekday_consumption(p_tenant, p_today)`; AT7).
   - Window: the 14 complete Rome dates `p_today − 14 … p_today − 1`. Today is partial, so it is excluded. The window holds each ISO weekday exactly twice.
   - Daily consumption of an ingredient on a date d = −Σ `qty` of its `consumption` rows, each reversal counted on its **original's** `effective_on` (`coalesce(orig.effective_on, m.effective_on)` through `reverses_id`). This covers manual, production (`ref_type 'batch'`), M15 staff meals and, later, M19 plate depletion.
   - Waste, counts, transfers and receipts are excluded (Q62).
   - `avg(ingredient, w) = (c(d₁) + c(d₂)) / 2` over the two dates of weekday w. A date without movements counts as 0, and the divisor is always 2 (Q63).
6. **Next delivery window and order-by deadline** (`app.next_delivery_window(p_at, p_tz, p_weekdays, p_cutoff, p_lead) returns (delivery_date date, order_by_at timestamptz)`, immutable).
   - Candidates: `D = today + k`, `k = 0 … p_lead + 7`, with `isodow(D) ∈ p_weekdays`.
   - For each candidate: `order_date = D − p_lead`. `order_by_at = (order_date + p_cutoff)::timestamp at time zone p_tz`. A null cut-off means "any time that day": `(order_date + 1)::timestamp at time zone p_tz`, i.e. local midnight.
   - The result is the first D with `p_at ≤ order_by_at`. With no weekday, or a null lead time, there is no window.
   - **Fixture (AT3).** Clock Monday 2026-11-02 15:00 Rome (`14:00Z`); supplier Mon/Thu (`{1,4}`), cut-off 11:00, lead time 2 days:
     - Monday 2 November: order by Saturday 31 October 11:00, already passed;
     - **Thursday 5 November: order by Tuesday 3 November 11:00 (`10:00Z`)**, the window.
   - "Lead time + days to the next delivery window" = `(order_date − today) + lead` = `delivery_date − today` = **horizon days** (3 in the fixture).
   - The local time is converted through the zone database. A cut-off that falls in the autumn repeated hour takes the standard-time reading, and one in the spring gap takes the pre-transition offset ([PostgreSQL: handling of invalid or ambiguous timestamps](https://www.postgresql.org/docs/14/datetime-invalid-input.html)). Assumption T1, proved in step 2.
7. **Purchase rule** (`app.purchase_rule(p_tenant, p_at)`; PRD Macelleria example; AT3). It runs for each active, stock ingredient with `min_level` set, whose preferred active supplier item belongs to an active supplier with a window (decision 6).
   - `forecast = Σ_{k=0}^{horizon−1} avg(ingredient, isodow(today + k))`, rounded to 4 dp.
   - `projected = usable_on_hand − forecast`.
   - **`projected < min_level` → `purchase_due`.**
     - `target = coalesce(target_level, min_level)`.
     - `pack = app.base_factor('conf', base_unit, pack_count, pack_qty, pack_unit)` (in base units).
     - `packs = ceil((target − projected) / pack)`.
     - `order_qty = round(packs × pack, 4)`.
   - **Fixture:**
     - beef averages Mon 2,0, Tue 3,0, Wed 2,0 → forecast 7,0;
     - on hand 9,0 → projected 2,0 < min 5,0;
     - target 12,0, so 10,0 kg are needed; with a 5 kg pack that is 2 packs = **10 kg**;
     - message: "Order 10 kg Manzo muscolo (demo) from Macelleria X (demo) by Tue 11:00 for Thu delivery".
   - An ingredient whose settings are incomplete (no preferred item, supplier without weekdays or lead time) gets **no purchase alert**. The settings screen marks it "Da completare" with the reason (Q66).
8. **Expiry rule** (`app.expiry_rule(p_tenant, p_at)`; AT5; "kitchen audience").
   - **Raw lot:** Σ `qty` of the lot > 0 and `app.expiry_state(expiry, today) ∈ {due_soon, expired}` → `raw_lot_expiring` (entity the lot).
   - **Batch:** `portions_remaining > 0` and `app.use_by_state(use_by, p_at) ∈ {due_soon, expired}` → `batch_expiring` (entity the batch).
   - Severity: `expired` → critical, `due_soon` → warning. Expired stock keeps alerting once a day until it is used or discarded (Q64).
   - Fixture: use-by in 20 h with 6 portions → an alert; the same batch with 0 portions → none.
9. **Dedup (AT4).**
   - The M6 key `(tenant, kind, entity, business_date)` gives one alert per item per Rome day. Entities: `recipe_key` for prep, `ingredient` for purchase, `raw_lot` and `batch` for expiry.
   - Each rule first checks whether today's alert exists (the M9 pattern), and if so skips building the payload. `job_run.items` therefore counts only new rows.
   - Two overlapping runs (cron plus a manual run) are serialised by `ON CONFLICT DO NOTHING` (race case in step 11).
   - Accepted limit: the first alert of the day stands. A deadline that passes later that day is not re-announced; the next day's run computes the next window.
10. **DST (AT6).**
    - Dates come from `app.alert_business_date` and `effective_on`.
    - Deadlines are local date + time converted through `Europe/Rome`.
    - Use-by comparisons are elapsed time (M14).
    - Nothing adds `interval 'n days'` to a timestamptz. A run at any hour of 25 October 2026 (25 hours long) gives the same set of alerts as a normal Sunday with the same data.
11. **Isolation.**
    - `app.alert_rules_body` keeps M9's two blocks **verbatim** and adds three, in the same tenant loop, each in its own `BEGIN … EXCEPTION` with `record_alert_refusal(…, '<caller>', 'rule_failed', sqlstate)`. The callers are `prep_rules`, `purchase_rules` and `expiry_rules`.
    - Alerts go through `app.try_raise_alert` with the same caller names.
    - A failing rule of one tenant rolls back only that block.
12. **Payloads are chef-safe by construction (§3.3).**
    - All five kinds are `cost_bearing = false` and every payload passes `app.chef_payload_allowed`: flat keys, ids, quantities, ISO dates and instants, and codes.
    - Instants are written `YYYY-MM-DDTHH:MM:SSZ` (`to_char(… at time zone 'UTC', …)`), whatever the session zone.
    - Names (recipe, ingredient, supplier, lot codes) are looked up when the alert is shown, on the reader's session (RLS applies; `names.ts` gains four tables).
    - Purchase alerts are owner-only by audience, not because of their content (Q60).
13. **Roles** (§3.11.2, project V6; SQL wins: admin reads no alerts, per the M6 decision).

    | Object / action | owner | admin | chef | waiter | DB enforcement | API |
    |---|---|---|---|---|---|---|
    | `rules_ingredients`, `rules_suppliers`, `rules_recipes` | ✓ | ✓ | ✓ (no €, no supplier-item list) | 42501 | `app.require_rules_reader()` first | `withApi({roles: owner, admin, chef})` |
    | `set_ingredient_rules`, `set_supplier_delivery`, `set_recipe_rules` | ✓ | ✓ | 42501 | 42501 | `app.require_rules_writer()` first | `withApi({roles: owner, admin})` |
    | critical flag | ✓ | ✓ | ✓ | 42501 | M13 `set_ingredient_critical` (unchanged) | M13 `PATCH /api/counts/critical` |
    | M16 alerts | all | none | prep, raw short, expiry | none | M6 RLS + registry audience | `GET /api/alerts` (M6) |
    | `alert_rules_run` | — | — | — | — | `service_role` only | none (tests and scripts) |

    - Every public function is `security definer`, `set search_path = ''`. It checks the role **first**, takes the tenant from `app.tenant_id()` and the user from `app.app_user_id()`, filters every query by tenant, and is executable by `authenticated` only.
    - Every `app.*` helper is revoked from all API roles.
    - The preferred item is set inline, filtered by tenant. It never calls the invoker `set_preferred_supplier_item` (§2).
14. **Performance of the hourly run.**
    - Per tenant, each rule is a handful of set-based statements: one consumption aggregate over 14 days, one on-hand aggregate, one lot or batch scan.
    - `batch_requirements` is called only for recipes below their minimum. There are no per-ingredient loops over the ledger.
    - New partial index `stock_movement_consumption_idx (tenant_id, effective_on) where type = 'consumption'`.
    - Step 9 has a regression guard (a timing bound on a synthetic fixture). It is not a promise about production speed.
15. **Personal data.**
    - The settings carry no personal data. Audit rows hold the user id, as every audit row does. Supplier names are business data.
    - Alerts hold ids and quantities. Logs carry SQLSTATEs and kinds only.
    - No processor is added, and nothing leaves Supabase (EU). Retention follows the alerts and the audit trail (project Q14).

### 3.2 Data model and procedures

**`20261030100000_rules_settings.sql`** (step 1)
- `alter table public.recipe_key add column rule_min_portions int check (rule_min_portions between 0 and 10000), add column rule_target_portions int check (… between 0 and 10000), add column rule_prep_time_min int check (… between 0 and 1440)`, plus `recipe_key_rule_portions_ck` (target ≥ min when both are set). No grant.
- `revoke insert (min_level, target_level), update (min_level, target_level) on public.ingredient from authenticated`; `revoke insert (lead_time_days, delivery_weekdays, order_cutoff_time), update (lead_time_days, delivery_weekdays, order_cutoff_time) on public.supplier from authenticated`.
- `create index stock_movement_consumption_idx on public.stock_movement (tenant_id, effective_on) where type = 'consumption'`.
- Re-create `audit_event_entity_type_check` (**every earlier value** + `supplier`) and `audit_event_action_check` (**every earlier value**, i.e. the 21 of `20261027100800` plus any added since, + `ingredient.rules_changed`, `supplier.delivery_changed`, `recipe.rules_changed`).

**`20261030100100_rules_helpers.sql`** (step 2). Schema `app`, `search_path = ''`, revoked from every API role.
- `app.iso_utc(timestamptz) returns text` (immutable).
- `app.next_delivery_window(p_at timestamptz, p_tz text, p_weekdays smallint[], p_cutoff time, p_lead smallint) returns table (delivery_date date, order_by_at timestamptz)` (immutable; §3.1.6).
- `app.usable_on_hand(p_tenant uuid, p_today date) returns table (ingredient_id uuid, on_hand_qty numeric)` (stable, definer; §3.1.3).
- `app.weekday_consumption(p_tenant uuid, p_today date) returns table (ingredient_id uuid, isodow int, avg_qty numeric)` (stable, definer; §3.1.5; rows only where avg ≠ 0).
- `app.forecast_qty(p_avgs jsonb, p_today date, p_days int) returns numeric` (immutable; Σ over the horizon, rounded to 4 dp).
- `app.supplier_window(p_tenant uuid, p_supplier uuid, p_at timestamptz)` (stable, definer): the window of a supplier with the tenant's zone, or no row.
- `app.recipe_rules(p_tenant uuid) returns table (recipe_key uuid, recipe_id uuid, version int, portions_per_batch int, min_portions int, target_portions int, prep_time_min int, min_source text, target_source text, prep_source text)` (stable, definer). Effective values per §3.1.1; each source is `rule`, `version` or null.

**`20261030100200_rules_settings_procedures.sql`** (step 3). Public, definer, volatile, role check first.
- `app.require_rules_reader()` (owner, admin, chef), `app.require_rules_writer()` (owner, admin); 42501 otherwise.
- `public.set_ingredient_rules(p_ingredient uuid, p_patch jsonb) returns jsonb`.
  - Patch keys ⊆ `{minLevel, targetLevel, preferredSupplierItemId}` (number ≥ 0, ≤ 100 000, ≤ 4 dp, or null; uuid or null). An unknown key or a wrong type → `invalid_request`.
  - Errors: `ingredient_not_found` (P0002); `ingredient_not_stock`; `levels_invalid` (target < min after the patch); `supplier_item_not_found` (P0002; another ingredient's or tenant's item); `supplier_item_inactive`.
  - The ingredient row is locked `for update`. The preferred item is set by unsetting the others **of this tenant and ingredient** and then setting it.
  - One `audit_event` `ingredient.rules_changed` with before and after (the levels and the item id). An unchanged value → `changed: false`, nothing written.
- `public.set_supplier_delivery(p_supplier uuid, p_patch jsonb) returns jsonb`.
  - Keys ⊆ `{leadTimeDays (0–365 int or null), deliveryWeekdays (distinct ints 1–7, ≤ 7), orderCutoffTime ("HH:MM" 00:00–23:59 or null)}`.
  - Weekdays are stored sorted. Errors: `supplier_not_found`, `lead_time_invalid`, `weekdays_invalid`, `cutoff_invalid`.
  - Audit `supplier.delivery_changed`.
- `public.set_recipe_rules(p_recipe_key uuid, p_patch jsonb) returns jsonb`.
  - Keys ⊆ `{minPortions, targetPortions, prepTimeMin}` (int or null = "use the version's").
  - Errors: `recipe_not_found`; `recipe_not_batch`; `portions_invalid` (range, or target < effective min); `prep_time_invalid`.
  - Audit `recipe.rules_changed` (entity `recipe`, id = key).

**`20261030100300_rules_reads.sql`** (step 4). Public, definer, stable, `require_rules_reader()` first.
- `public.rules_ingredients(p_at timestamptz default null) returns jsonb`. `p_at` is accepted only from owner and admin, for previews; the chef's calls use `now()`. It returns:

  ```
  {today, items: [{ingredientId, name, baseUnit, isCritical, minLevel, targetLevel, onHandQty,
    preferred: {supplierItemId, supplierId, packQty, packLabel} | null,
    nextWindow: {deliveryDate, orderByAt} | null,
    status: "ok" | "incomplete" | "off",
    reasons: ["no_preferred_item" | "supplier_no_weekdays" | "supplier_no_lead_time" | "supplier_inactive"]}],
   supplierItems?: [{supplierItemId, ingredientId, supplierId, packQty, packLabel}]}
  ```

  - `supplierItems` is present for owner and admin only. **No `last_price` and no cost key, for any role.**
  - `status: "off"` means no `min_level`. Only active stock ingredients are listed, ordered by name (`collate "C"`).
- `public.rules_suppliers() returns jsonb`: `{items: [{supplierId, name, leadTimeDays, deliveryWeekdays, orderCutoffTime, nextWindow | null}]}`, active suppliers.
- `public.rules_recipes() returns jsonb`: `{items: [{recipeKey, name, version, portionsPerBatch, minPortions, targetPortions, prepTimeMin, sources: {min, target, prep}, remainingPortions}]}`, active batch keys.

**`20261030100400_rule_alert_kinds.sql`** (step 5)

| kind | cost_bearing | default severity | default audience | entity |
|---|---|---|---|---|
| `prep_due` | false | warning | `{owner,chef}` | `recipe_key` |
| `prep_raw_short` | false | warning | `{owner,chef}` | `recipe_key` |
| `purchase_due` | false | warning | `{owner}` | `ingredient` |
| `raw_lot_expiring` | false | warning (critical when expired) | `{owner,chef}` | `raw_lot` |
| `batch_expiring` | false | warning (critical when expired) | `{owner,chef}` | `batch` |

**`20261030100500_prep_rule.sql`**, **`…100600_purchase_rule.sql`**, **`…100700_expiry_rule.sql`** (steps 6–8): `app.prep_rule`, `app.purchase_rule`, `app.expiry_rule`, each `(p_tenant uuid, p_at timestamptz) returns integer` (new alerts). Definer, volatile, revoked from all API roles.

**`20261030100800_alert_rules_body_m16.sql`** (step 9)
- `create or replace function app.alert_rules_body(p_at)`: M9's text, verbatim, plus three blocks (§3.1.11). `app.run_alert_rules` is **not** replaced.
- `public.alert_rules_run(p_at timestamptz default now()) returns jsonb`. It calls `app.run_alert_rules(p_at)` and returns `{ok, items}` from `job_run_latest('alert-rules')`. Execute is granted to `service_role` only, as `ledger_invariants_run`.

`20261030100900` is kept free for review fixes.

### 3.3 Payloads and messages

All keys pass the M12 allow-list. In the TS templates, `{recipe}`, `{ingredient}`, `{supplier}` and `{lot}` are resolved names; a missing one shows the M12 neutral word.

| kind | payload (strict) |
|---|---|
| `prep_due` | `recipe_key, recipe_id, remaining_portions_qty, min_portions_count, target_portions_count (nullable), batches_count, prep_hours (nullable), ingredient_id (nullable), needed_qty (nullable), on_hand_qty (nullable), unit (nullable)` |
| `prep_raw_short` | `recipe_key, recipe_id, remaining_portions_qty, min_portions_count, ingredient_id, needed_qty, on_hand_qty, unit, short_count, supplier_id (nullable), order_by_at (nullable), delivery_date (nullable)` |
| `purchase_due` | `ingredient_id, supplier_id, supplier_item_id, order_qty, packs_count, pack_qty, unit, order_by_at, delivery_date, horizon_days, on_hand_qty, forecast_qty, projected_qty, min_qty, target_qty` |
| `raw_lot_expiring` | `raw_lot_id, ingredient_id, remaining_qty, unit, expiry_date, state_key` (`due_soon` / `expired`) |
| `batch_expiring` | `batch_id, recipe_key, remaining_portions_qty, use_by_at, state_key` |

Messages (title / body; it first, en second). `prep_hours` = `prep_time_min / 60` (2 dp).
- **`prep_due`:**
  - title "Da preparare oggi: {recipe}" / "Prepare today: {recipe}".
  - body it "Prepara {recipe} oggi, {needed} di {ingredient} disponibili ({onHand} in giacenza). Restano {remaining} porzioni, minimo {min}.";
  - body en "Prepare {recipe} today, {needed} {ingredient} available ({onHand} on hand). {remaining} portions left, minimum {min}."
  - When `batches_count > 1`: + "Per arrivare a {target} porzioni: {batches} lotti." / "To reach {target} portions: {batches} batches."
  - When there is a prep time: + "Preparazione: {hours} h." / "Prep time: {hours} h."
  - With no stock ingredient: "Prepara {recipe} oggi. Restano …".
  - **AT1 (en):** "Prepare Spezzatino (demo) today, 5.0 kg Manzo muscolo (demo) available (12.3 kg on hand). 4 portions left, minimum 5." The en catalogue writes "5.0", the it catalogue "5,0".
- **`prep_raw_short`:**
  - title "Manca materia prima per {recipe}" / "Raw stock short for {recipe}".
  - body it "Restano {remaining} porzioni (minimo {min}). Per un lotto servono {needed} di {ingredient}, in giacenza {onHand}.";
  - body en "{remaining} portions left (minimum {min}). One batch needs {needed} {ingredient}, {onHand} on hand."
  - When `short_count > 1`: + "Mancano anche altri {n} ingredienti." / "{n} more ingredients are short."
  - With a supplier: + "Ordina da {supplier} entro {orderBy} per la consegna di {delivery}." / "Order from {supplier} by {orderBy} for {delivery} delivery."
- **`purchase_due`:**
  - title it "Ordina {qty} di {ingredient} da {supplier} entro {orderBy} per la consegna di {delivery}"; en "Order {qty} {ingredient} from {supplier} by {orderBy} for {delivery} delivery".
  - body it "{packs} confezioni da {pack}. Consegna {deliveryDate}. Giacenza {onHand}, consumo previsto {forecast} in {days} giorni, scorta prevista {projected} (minimo {min}, obiettivo {target})." (en equivalent).
  - **AT3 (en title):** "Order 10 kg Manzo muscolo (demo) from Macelleria X (demo) by Tue 11:00 for Thu delivery". Italian: "… entro mar 11:00 per la consegna di gio".
- **`raw_lot_expiring`:**
  - title "In scadenza: {ingredient}" or "Scaduto: {ingredient}" / "Expiring: …" or "Expired: …".
  - body "Lotto {lot}: {qty} rimasti, scadenza {expiryDate}." / "Lot {lot}: {qty} left, expiry {expiryDate}."
- **`batch_expiring`:**
  - title "Da consumare entro {useBy}: {recipe}" or "Scaduto: {recipe}" / "Use by {useBy}: {recipe}" or "Expired: {recipe}".
  - body "Lotto {lot}: {portions} porzioni rimaste." / "Lot {lot}: {portions} portions left."
- **New formatters** in `AlertFormatters`:
  - `measuredQty` (at least 1 decimal: "5,0 kg", the PRD stew wording), used for measured and needed quantities;
  - `weekdayTime(iso)` (Europe/Rome short weekday and HH:MM: "mar 11:00" / "Tue 11:00");
  - `weekday(isoDate)` ("gio" / "Thu").
  - Order quantities use the existing `qty` (pack multiples: "10 kg").
- **`alertHref`** (M9 function in `list.ts`): `prep_due`, `prep_raw_short` → `/produzione/nuova`; `purchase_due` → `/riordino/ingredienti`; `raw_lot_expiring` → `/magazzino`; `batch_expiring` → `/produzione`.
- **`names.ts`** gains the tables `recipe` (from `v_recipe_current`, `recipe_key → name`), `supplier` (`name`), `raw_lot` (`lot_code`), `batch` (`lot_code`), each `{source, idColumn, labelColumn}`. It still runs one query per table, on the reader's session.

### 3.4 API

All routes:
- use `withApi` with the user-session client;
- take strict Zod bodies (unknown key → 400), with `application/json` on writes (else 415) and a 4 KiB body limit (`MAX_RULES_BODY_BYTES`);
- return errors as `{"error":{"code","message","details?"}}`;
- answer 400 `invalid_request` for a malformed id in the body (strict Zod, before any RPC), as built; 404 is for a well-formed id the tenant does not own (the RPC's P0002).

| Endpoint | Roles | Body | Success | Errors |
|---|---|---|---|---|
| `GET /api/rules/ingredients` | owner, admin, chef | — | 200 (§3.2 shape, camelCase) | 401; 403 waiter before any RPC |
| `PATCH /api/rules/ingredients` | owner, admin | `{ingredientId, minLevel?, targetLevel?, preferredSupplierItemId?}` (at least one field) | 200 `{ingredientId, changed, item}` | 400; 401; 403 chef/waiter before any RPC; 404 `ingredient_not_found`, `supplier_item_not_found`; 413; 415; 422 `levels_invalid`, `ingredient_not_stock`, `supplier_item_inactive` |
| `GET /api/rules/suppliers` | owner, admin, chef | — | 200 | 401; 403 |
| `PATCH /api/rules/suppliers` | owner, admin | `{supplierId, leadTimeDays?, deliveryWeekdays?, orderCutoffTime?}` | 200 | 400; 401; 403; 404 `supplier_not_found`; 413; 415; 422 `lead_time_invalid`, `weekdays_invalid`, `cutoff_invalid` |
| `GET /api/rules/recipes` | owner, admin, chef | — | 200 | 401; 403 |
| `PATCH /api/rules/recipes` | owner, admin | `{recipeKey, minPortions?, targetPortions?, prepTimeMin?}` | 200 | 400; 401; 403; 404 `recipe_not_found`; 413; 415; 422 `recipe_not_batch`, `portions_invalid`, `prep_time_invalid` |

- `GET /api/alerts` and `POST /api/alerts/:id/ack` are unchanged (M6). They render the new kinds through the templates.
- Services: `src/server/rules/{constants,schemas,output,errors,ingredients,suppliers,recipes}.ts`. Output schemas are strict, and the chef's ingredient shape has no `supplierItems`.
- Error map: 42501 → 403, P0002 → 404, P0001 codes → 422 per the table, anything else → 500 with the SQLSTATE only.

### 3.5 Screens (house style `docs/design/ui-foundation.md` §6/§8; 360 px first; every screen reads `/api/*`; nothing computed in React)

- **`/riordino`** (`src/app/(owner)/riordino/page.tsx`): `Heading` "Riordino e preparazione" and three link cards with a server count each: "Ingredienti (3 da completare)", "Fornitori", "Ricette".
  - A waiter (403) sees one `ErrorAlert`: "Il riordino non è disponibile per il tuo ruolo."
- **`/riordino/ingredienti`** (`page.tsx`, `ingredient-rule-card.tsx`): one bordered card per ingredient.
  - Name in bold; a `.num` line "In giacenza 9 kg".
  - `Field` "Minimo" and "Obiettivo" (`inputmode="decimal"`, unit suffix).
  - `Field` "Fornitore preferito" (a `Select` of `supplierItems`: "Macelleria X (demo) · confezione 5 kg").
  - The "Conteggio giornaliero" switch, wired to M13's `PATCH /api/counts/critical`.
  - One `secondary` button "Salva".
  - A `Badge`: "Da completare" (warning) with the reason in words ("Fornitore senza giorni di consegna"); "Non attivo" when there is no minimum.
  - A muted line from `nextWindow`: "Prossimo ordine entro mar 03/11, 11:00 · consegna gio 05/11".
  - **Chef:** the same values as text and the critical switch only. No `Field` for the levels or the supplier.
- **`/riordino/fornitori`** (`page.tsx`, `supplier-rule-card.tsx`):
  - `Field` "Giorni di anticipo" (`inputmode="numeric"`);
  - seven checkboxes "Lun … Dom" in one wrapping row (44 px tap targets);
  - `Field` "Ordine entro le" (`type="time"`);
  - "Salva"; the `nextWindow` line. Chef: text only.
- **`/riordino/ricette`** (`page.tsx`, `recipe-rule-card.tsx`):
  - `Field` "Porzioni minime", "Porzioni obiettivo", "Tempo di preparazione (min)", each with a muted hint "dalla ricetta v3" when the source is `version`;
  - "Restano 4 porzioni"; "Salva". Chef: text only.
- Errors in an `ErrorAlert` above the card's button, in Italian ("L'obiettivo non può essere inferiore al minimo.", "Indica i giorni di consegna da lunedì a domenica.", "Orario non valido (HH:MM).").
- **Navigation:** `OwnerNav` gains "Riordino" (`/riordino`) for owner, admin and chef (`canReadRules`), hidden for the waiter and while the role is unknown. `isCurrent` marks it on `/riordino` and below; the home page gets the same link.
- Pure helpers in `src/lib/rules/rules-view.ts`: `canReadRules`, `canEditRules`, `reasonWord`, `weekdayLabels`, `nextWindowLine`, `sourceHint`.

### 3.6 Flows

1. **Settings:** `/riordino/fornitori` → `PATCH /api/rules/suppliers` → `set_supplier_delivery` → audit → 200 → refetch `GET /api/rules/suppliers` (new `nextWindow`).
2. **Hourly:** pg_cron `alert-rules` → `app.run_alert_rules()` → `job_run_begin` → `alert_rules_body(now())`. For each tenant, five isolated blocks run in order: payables (M9), digest (M9), prep, purchase, expiry. Each block raises through `try_raise_alert` → dedup index. Then `job_run_end(items)`.
3. **Reading:** owner or chef `/avvisi` → `GET /api/alerts` → RLS rows → `collectNameRefs` → `loadNames` (six tables) → `renderAlert` (it/en) → `href`.
4. **Tests:** pgTAP calls `app.run_alert_rules('<fixed instant>')`. Integration and e2e call `rpc('alert_rules_run', {p_at})` with the local stack's secret key.

### 3.7 Secrets and configuration

| Name | Public? | Where it lives | Used by M16 |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public by design (existing) | Vercel env | the session client of every M16 route |
| `SUPABASE_SECRET_KEY` | **private** (existing) | Vercel env, server-only; locally `.env` (gitignored) | **not used by M16 `src/` code**; integration and e2e helpers read the local stack's key to call `alert_rules_run` |
| `CRON_SECRET`, Vault values, `ANTHROPIC_API_KEY`, `EXTRACTION_MODEL_ID` | existing | Vercel env / Supabase Vault | not touched (the rules job is SQL-only and calls no route) |
| Account logins (Vercel, Supabase, GitHub) | private | the account owner's password manager with MFA; never in the repo or DigiAlto-Ops | humans |

No new secret, third-party key or provider.

### 3.8 Fixtures (fake only; `tests/fixtures/alert-rules/`, shared by pgTAP comments, integration and e2e)

- **Stew (AT1/AT2):**
  - M14's "Spezzatino (demo)": 6 kg, 30 portions, 72 h; beef 5 kg, Soffritto 0,5 kg, water 1 l.
  - Rule settings: min 5, target 30, prep 180 min.
  - One batch with 4 portions remaining, use-by in 2 days.
  - Stock: beef 12,3 kg (AT1) or 3,0 kg (AT2); onion 2 kg; carrot 2 kg.
- **Macelleria (AT3/AT7):**
  - Supplier "Macelleria X (demo)": `{1,4}`, 11:00, lead 2. Preferred item: 1 × 5 kg beef.
  - Beef min 5,0, target 12,0. Receipts are chosen so that on hand is **9,0 after every fixture movement**, including the noise below. Clock `2026-11-02T14:00:00Z`.
  - Consumption (kg) on 19/10–01/11: Mon 2,0 / 2,0; Tue 2,5 / 3,5; Wed 1,0 / 3,0; Thu 1,0 / 1,0; Fri 2,0 / 4,0; Sat 0 / 6,0; Sun 0 / 0.
  - Noise that must be ignored: waste −0,5 on 21/10; consumption −4,0 on 18/10 (outside the window); −1,0 on 02/11 (today); −1,0 on 28/10 reversed by +1,0 on 30/10, which counts on 28/10.
  - **Hand-computed averages:** Mon 2,0; Tue 3,0; Wed 2,0; Thu 1,0; Fri 3,0; Sat 3,0; Sun 0. Horizon Mon–Wed → forecast **7,0**.
- **Expiry (AT5):** a stew batch with use-by `p_at + 20 h` and 6 portions; a second copy with 0 portions; a raw lot "L-EXP" of onion 1 kg, expiry today + 1.
- **DST (AT6):** the three fixtures above, placed relative to D = 2026-10-25 and to D = 2026-11-01 (a normal Sunday).

### 3.9 Contracts for later milestones

- **M19:** plate depletion as `consumption` rows enters the forecast automatically. Batch depletion lowers `v_batch_portions` and can trigger `prep_due`.
- **M23 push list:** reads `batch_expiring` and `raw_lot_expiring` (or the same SQL predicates: `app.use_by_state`, `app.expiry_state`) for its daily list.
- **M27 rules engine:** must keep the dedup key and the chef allow-list. It replaces `alert_rules_body` only after re-pinning `148`/`149`.
- **M32 demand model:** replaces `app.weekday_consumption` behind the same signature.

## 4. Alternatives considered

- **A new recipe version when the minimum or target changes:** rejected. A stock setting is not a recipe change, and every version churns the cost and label history (ADR-007).
- **A new table `recipe_stock_rule`:** rejected for M16. Three nullable columns on `recipe_key` do the same job without a new RLS table and without new fixture rows in `001`, `004` and `059`. Revisit if rules become per location or per period (M27).
- **Rules in TypeScript (a cron route reading the ledgers):** rejected. The plan puts `run_alert_rules()` in SQL (§3.9), dedup and the guards are in SQL, and a route would need the secret key and pg_net for no gain.
- **Forecast = flat 14-day daily average × horizon days:** rejected. The PRD asks for a weekday average, and a Monday–Wednesday horizon weighted by Friday and Saturday sales over-orders. The weekday sum equals the flat formula whenever the horizon is a multiple of 7.
- **Including today's partial consumption in the window:** rejected. It would make the average depend on the hour of the run, so three runs on one day could disagree (AT4).
- **Counting waste as consumption:** rejected for the base plan. Waste is irregular and is analysed in M15's report. Q62 → V3.
- **A raw-lot shelf-life rule from the receipt date when the lot has no expiry:** rejected (M5 Q1: no expiry is invented).
- **One `expiry` kind with two entity types:** rejected. The two payloads differ, and the strict TS templates need one schema per kind.
- **An all-ingredients array in the prep payload:** rejected. The chef allow-list requires flat keys with typed suffixes, and the binding ingredient is what the cook needs to know.
- **Re-creating `app.run_alert_rules`:** rejected (M6 contract). Only the body is replaced, with M9's blocks verbatim.
- **A purchase alert for ingredients without supplier settings ("order today"):** rejected for the base plan. An invented deadline is worse than a visible "Da completare". Q66 → V7.

## 5. Build plan (test first; one commit per step; `tdd-guide` follows the order)

**Conventions** (as M12–M14):
- pgTAP sets claims with `set_config('request.jwt.claims', …)`. Fixtures (lots, movements with explicit `effective_on`, batches) are inserted as the migration owner.
- Rule functions are called with a fixed `p_at`. Errors are asserted as `SQLSTATE message`.

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| 1 | Migration: recipe-key rule columns, revoked direct reorder grants, consumption index, audit checks as the **union of every earlier value** plus M16's; union guard over all migrations | `supabase/migrations/20261030100000_rules_settings.sql`, `supabase/tests/database/140_rules_settings.test.sql`, `tests/config/check-constraint-union.test.ts` | `140`: the three columns exist with their bounds (−1, 10001, 1441 → 23514; target < min → 23514); `authenticated` has no INSERT/UPDATE privilege on `ingredient.min_level`, `target_level`, `supplier.lead_time_days`, `delivery_weekdays`, `order_cutoff_time`, and still has UPDATE on `ingredient.name` and `supplier.name` (M1 untouched); the partial index exists; **every value of `20261027100800`'s two lists is still accepted** (one insert per value, as the owner, inside the test), plus `supplier` and the three new actions; M13's `ingredient.critical_changed` is among them. `check-constraint-union.test.ts`: reads every file of `supabase/migrations/` in order; for each of `audit_event_entity_type_check`, `audit_event_action_check`, `job_run_job_check` the **last** definition contains every value of every earlier definition; it fails on a synthetic list missing one value (fixture strings in the test). `001` green |
| 2 | Migration: helpers (delivery window, usable on hand, weekday consumption, forecast, supplier window, effective recipe rules) | `supabase/migrations/20261030100100_rules_helpers.sql`, `supabase/tests/database/141_rules_helpers.test.sql` | `141`. **AT3 window:** (`2026-11-02T14:00Z`, Rome, `{1,4}`, 11:00, 2) → `2026-11-05`, `2026-11-03T10:00Z`; at `2026-11-03T10:00Z` (exactly the deadline) → same; at `10:00:01Z` → `2026-11-09`, `2026-11-07T10:00Z`; lead 0, `{1}`, 11:00 at Monday 09:00 Rome → today, today 11:00; null cut-off → `order_date + 1` 00:00 Rome; `{}` or null lead → no row. **DST:** (`2026-10-24T08:00Z`, `{2}`, 11:00, 2) → `2026-10-27`, order by `2026-10-25T10:00Z` (CET, not `09:00Z`); cut-off 02:30 on 2026-10-25 → `01:30Z` (standard-time reading) and on 2027-03-28 → `01:30Z` (pre-transition offset) (T1); each repeated under `set local timezone` `UTC` and `America/New_York` with equal results. **AT7:** the Macelleria fixture → averages Mon 2,0, Tue 3,0, Wed 2,0, Thu 1,0, Fri 3,0, Sat 3,0, Sun absent (0); the waste row, the 18/10 and 02/11 rows do not count; the reversal posted on 30/10 counts on 28/10, so the −1/+1 pair nets to 0 there and Wed stays (1,0 + 3,0) / 2; `forecast_qty(avgs, 2026-11-02, 3)` = **7,0**; horizon 7 from a Monday = Σ of all seven. **Usable on hand:** 9,0 for the fixture; a lot with expiry yesterday and 2 kg is excluded; an unlotted −1 counts; another tenant's movements are ignored. **`recipe_rules`:** version min 4 and no rule → 4 `version`; rule 5 → 5 `rule`; rule 0 → 0 `rule`. `iso_utc` gives `…Z` under any session zone. No API role can execute any function of this migration |
| 3 | Migration: settings procedures with audit | `supabase/migrations/20261030100200_rules_settings_procedures.sql`, `supabase/tests/database/142_rules_settings_procedures.test.sql` | `142`. Owner A: `set_ingredient_rules(beef, {"minLevel":5,"targetLevel":12,"preferredSupplierItemId":<item>})` → levels set, the item preferred and the previous preferred item of beef unset, one `ingredient.rules_changed` audit with before/after; the same patch again → `changed:false`, no audit; target 4 with min 5 → `levels_invalid`; 4.12345 → `invalid_request`; an item of another ingredient or of tenant B → P0002 `supplier_item_not_found`; an inactive item → `supplier_item_inactive`; water → `ingredient_not_stock`; unknown key → `invalid_request`. **Tenant-filtered preferred switch:** tenant B's preferred item for its own beef is unchanged after A's call. `set_supplier_delivery`: `{"deliveryWeekdays":[4,1],"orderCutoffTime":"11:00","leadTimeDays":2}` → stored `{1,4}`, 11:00, 2, audit `supplier.delivery_changed`; `[0]`, `[8]`, `[1,1]` → `weekdays_invalid`; `"24:00"`, `"11:0"` → `cutoff_invalid`; 366 → `lead_time_invalid`. `set_recipe_rules`: stew `{"minPortions":5,"targetPortions":30,"prepTimeMin":180}` → `recipe_key` columns, audit `recipe.rules_changed`, **no new recipe version** (`current_version` and the `recipe` row count unchanged); a plate key → `recipe_not_batch`; target 4 with min 5 → `portions_invalid`; null → falls back to the version's value. **Roles:** admin A allowed; chef A and waiter A → 42501 from all three, nothing written; no claims → 42501; `anon`, `service_role` cannot execute |
| 4 | Migration: rules reads | `supabase/migrations/20261030100300_rules_reads.sql`, `supabase/tests/database/143_rules_reads.test.sql` | `143`. `rules_ingredients` (owner, Macelleria fixture, `p_at` AT3 clock) → beef `onHandQty 9`, `preferred.packQty 5`, `nextWindow {2026-11-05, 2026-11-03T10:00:00Z}`, `status ok`; an ingredient without a preferred item → `incomplete` with `no_preferred_item`; supplier without weekdays → `supplier_no_weekdays`; no min → `off`; `supplierItems` present for owner and admin, **absent for the chef**, and the chef's `p_at` is ignored (uses now); no key at any depth matches `/eur\|cost\|price\|last_price\|margin\|amount\|total/i` for any role. `rules_suppliers` → `{1,4}`, `"11:00"`, 2, next window. `rules_recipes` → stew min 5 `rule`, target 30 `rule`, prep 180, `remainingPortions 4`; a plate key is not listed. Waiter A → 42501 from all three; owner B sees none of A's rows |
| 5 | Alert kinds, templates, names and texts (one commit: the M6 rule) | `supabase/migrations/20261030100400_rule_alert_kinds.sql`, `supabase/tests/database/144_rule_alert_kinds.test.sql`, `src/server/alerts/{kinds,templates,names}.ts`, `src/lib/i18n/messages/{it,en,keys}.ts`, `tests/server/alerts/{templates,names,render,chef-payload}.test.ts` | `144`: the five rows with the §3.2 flags and audiences; `raise_alert` accepts one sample payload per kind (the §3.3 shapes with fixture ids) for its default audience, and `app.chef_payload_allowed` is true for each; a `prep_due` sample with an extra `recipe_name` key → `alert_payload_not_allowed`; a `purchase_due` sample with a `{chef}` audience passes the guards (its content is chef-safe; who receives it is the registry default). `templates.test.ts`: **AT1** the `prep_due` sample with names → en body starts "Prepare Spezzatino (demo) today, 5.0 kg Manzo muscolo (demo) available (12.3 kg on hand)." and it body "Prepara Spezzatino (demo) oggi, 5,0 kg di Manzo muscolo (demo) disponibili (12,3 kg in giacenza)."; batches 2 → the batches sentence; **AT2** `prep_raw_short` en/it texts with and without supplier; **AT3** `purchase_due` en title exactly "Order 10 kg Manzo muscolo (demo) from Macelleria X (demo) by Tue 11:00 for Thu delivery" and it "Ordina 10 kg di Manzo muscolo (demo) da Macelleria X (demo) entro mar 11:00 per la consegna di gio" (instant `2026-11-03T10:00:00Z`); **AT5** `batch_expiring` and `raw_lot_expiring` titles for `due_soon` and `expired`; **AT6** `weekdayTime` across DST (`2026-10-25T10:00:00Z` → "dom 11:00"); a strict schema rejects an unknown key → fallback; `moneyFields` empty for all five. `names.test.ts`: refs collected for `recipe_key`, `supplier_id`, `raw_lot_id`, `batch_id`; one query per table with the right columns (`v_recipe_current recipe_key,name`, `raw_lot id,lot_code`); a failed read leaves the neutral word. `chef-payload.test.ts`: the five samples pass the TS mirror, the same vectors as `144`. `render.test.ts`: a `<script>` name is returned as text |
| 6 | Migration: prep rule | `supabase/migrations/20261030100500_prep_rule.sql`, `supabase/tests/database/145_prep_rule.test.sql` | `145` (`app.prep_rule(A, p_at)`). **AT1:** stew fixture, beef 12,3 → one `prep_due` alert, entity `recipe_key` stew, audience `{owner,chef}`, payload `remaining_portions_qty 4, min_portions_count 5, target_portions_count 30, batches_count 1, prep_hours 3, ingredient_id beef, needed_qty 5.0, on_hand_qty 12.3, unit kg`; no `prep_raw_short`. **AT2:** beef 3,0 → one `prep_raw_short` (`needed_qty 5.0`, `on_hand_qty 3.0`, `short_count 1`, supplier fields null) and **no** `prep_due`; with the Macelleria supplier preferred for beef → `supplier_id`, `order_by_at`, `delivery_date` from `next_delivery_window`. **Edges:** remaining 5 → nothing; an expired batch with 10 portions does not count (remaining 4 → alert); a batch at −2 portions counts as 0; target 70 with beef 12,3 → `batches_count 2`, `needed_qty 10.0`; beef 7 with target 70 → `batches_count 1`; onion the binding ingredient when it has 0,4 kg (ratio below beef) → `ingredient_id` onion; a beef lot expired yesterday with 10 kg is not usable; rule min 0 → nothing; an inactive key → nothing; a sub whose only version is not in force → no alert, one `alert_refusal` (`prep_rules`, `recipe_not_producible`), and the other recipe still alerts. Returns the number of new alerts |
| 7 | Migration: purchase rule | `supabase/migrations/20261030100600_purchase_rule.sql`, `supabase/tests/database/146_purchase_rule.test.sql` | `146` (`app.purchase_rule(A, '2026-11-02T14:00Z')`). **AT3:** Macelleria fixture → one `purchase_due`, entity beef, audience `{owner}`, payload `order_qty 10, packs_count 2, pack_qty 5, unit kg, order_by_at "2026-11-03T10:00:00Z", delivery_date "2026-11-05", horizon_days 3, on_hand_qty 9, forecast_qty 7, projected_qty 2, min_qty 5, target_qty 12`. **AT7 in use:** `forecast_qty` 7 equals the hand-computed Mon + Tue + Wed averages. **Edges:** on hand 12,1 (projected 5,1 ≥ 5) → none; projected exactly 5 → none (strict <); target null → up to min (3 → 1 pack = 5 kg); pack `conf` 6 × 1 kg → 2 packs = 12 kg for a need of 10; pack in g (`5000 g`) → same as 5 kg; no preferred item, supplier without weekdays, null lead, inactive supplier → none; an ingredient without `min_level` → none; `is_stock` false → none; tenant B's identical data raises B's own alert only. No key matches the money pattern |
| 8 | Migration: expiry rule | `supabase/migrations/20261030100700_expiry_rule.sql`, `supabase/tests/database/147_expiry_rule.test.sql` | `147`. **AT5:** batch use-by `p_at + 20 h`, 6 portions → one `batch_expiring` (`state_key due_soon`, severity warning, audience `{owner,chef}`, `use_by_at` in `…Z`); the same batch at 0 portions → none (inside the rolled-back test transaction, `alter table batch_movement drop constraint if exists batch_movement_m14_ck` and a `waste` −6 row inserted as the owner; once M15's shapes are merged the drop is a no-op and the row is a valid M15 waste); use-by `p_at + 25 h` → none; use-by passed with 2 portions → `expired`, critical. Raw lot `L-EXP` 1 kg, expiry today + 1 → `raw_lot_expiring` `due_soon`; expiry today + 2 → none; lot fully consumed (Σ 0) → none; expired with 0,5 kg → `expired`, critical; a lot without expiry → none. No string value besides ids, dates, instants and codes (allow-list true) |
| 9 | Migration: `alert_rules_body` (M9 blocks verbatim + three) and `alert_rules_run`; deliberate re-pin of the body hash | `supabase/migrations/20261030100800_alert_rules_body_m16.sql`, `supabase/tests/database/148_rules_runs.test.sql`, `supabase/tests/database/{089_m11_preserved,098_m12_preserves_alerts,119_m13_preserves}.test.sql` (the `alert_rules_body` md5 becomes M16's value, each with a comment "re-pinned by M16, 20261030100800"; every other assertion unchanged) | `148`. **AT4:** runs at `2026-11-02T07:00Z`, `08:00Z`, `09:00Z` on the combined fixture (stew AT1, Macelleria, expiry) → exactly one alert per (kind, entity) for 2026-11-02; `job_run.items` = n, 0, 0; a fourth run at `2026-11-02T23:30Z` (00:30 Rome on 3 Nov) → a new set dated 2026-11-03. **AT6:** the fixture placed at D = 2026-10-25, runs at `2026-10-25T00:30Z` and `01:30Z` (both 02:30 local, before and after the change) and `22:30Z` (23:30 local) → all dated 2026-10-25, one per item; the same fixture at D = 2026-11-01, runs at `00:30Z` and `22:30Z` → the same multiset of `(kind, payload minus ids, with every date and instant shifted −7 days)` as the DST day; `order_by_at` local time 11:00 in both. **Isolation:** with `app.purchase_rule` replaced by a raising stub inside the test → prep and expiry alerts of the same run still commit, one `alert_refusal` (`purchase_rules`, `rule_failed`, `P0001`), no message text stored; M9's payable reminders still raised in the same run (an `open` payable due in 7 days). **Body text:** contains `app.payable_reminder_rule(` and `app.payables_digest_rule(` before the three M16 calls; `app.run_alert_rules` md5 still `ff878123…` (`075` unchanged). **Wrapper:** `alert_rules_run` as `service_role` → `{ok: true, items: n}`; `authenticated` and `anon` cannot execute. **Performance guard:** 200 ingredients with min levels and a supplier, 15 days × 5 consumption rows each, 40 batch recipes below min → one run finishes within 2 s (`clock_timestamp()` delta; a regression bound for CI, not a production promise). `046`, `073`, `075` green unchanged; `089`, `098`, `119` green with the new pin |
| 10 | Guard: M16 preserves the alert pipeline and the M12/M14 engines | `supabase/tests/database/149_m16_preserves.test.sql` | `149`: exactly one definition each of `app.raise_alert`, `app.try_raise_alert`, `app.run_alert_rules`, `app.alert_rules_body`, `app.batch_requirements`, `app.post_stock_outflow`, `app.chef_payload_allowed`; the md5 of `raise_alert`, `try_raise_alert`, `run_alert_rules` and `post_stock_outflow` equal the values pinned in `119`/`128`; `batch_requirements` and `chef_payload_allowed` are pinned here by md5 computed on `80e6809`; the `alert-rules` cron row unchanged (`0 * * * * \| select app.run_alert_rules()`), and no new cron job (`cron.job` names unchanged); every M16 kind is `cost_bearing false`. PR grep: `grep -lE "create or replace function (app\.raise_alert\|app\.try_raise_alert\|app\.run_alert_rules\|app\.chef_payload_allowed\|app\.post_stock_outflow\|app\.batch_requirements)" supabase/migrations/20261030*` returns nothing |
| 11 | Two-session race case | `scripts/test-db-races.sh` (one case appended), `supabase/tests-native/races_fixture.sql` (unchanged; the case inserts its fixture in its database copy) | CI job `db-races`, existing cases unchanged. **`rules-concurrent-runs`:** s1 runs `app.run_alert_rules('$D')` and parks before commit; s2 runs the same → s2 blocks on the dedup index (`s2_blocked` 1); after the gate both commit; one alert per item; s2's `job_run.items` = 0; `no_deadlock` holds |
| 12 | Rules domain in TS: constants, schemas, outputs, errors, view helpers, i18n | `src/server/rules/{constants,schemas,output,errors}.ts`, `src/lib/rules/rules-view.ts`, `src/lib/api/errors.ts`, `src/lib/i18n/messages/{it,en,keys}.ts`, `tests/server/rules/{schemas,output,errors}.test.ts`, `tests/lib/rules/rules-view.test.ts` | `schemas.test.ts`: strict bodies (unknown key → 400; empty patch → 400); `minLevel` 5 decimals rejected; `deliveryWeekdays` `[0]`, `[8]`, duplicates rejected; `orderCutoffTime` `^([01]\d\|2[0-3]):[0-5]\d$`; uuids. `output.test.ts`: the chef ingredient schema has no `supplierItems`; no output schema declares a key matching the money pattern (shape walk). `errors.test.ts`: every §3.4 code → status and Italian message; unknown SQLSTATE → 500 with no text. `rules-view.test.ts`: `canReadRules` owner/admin/chef true, waiter/unknown false; `canEditRules` owner/admin only; `nextWindowLine({deliveryDate: "2026-11-05", orderByAt: "2026-11-03T10:00:00Z"})` → "Prossimo ordine entro mar 03/11, 11:00 · consegna gio 05/11"; the DST instant `2026-10-25T10:00:00Z` → "dom 25/10, 11:00"; `reasonWord` for the four reasons; `sourceHint("version", 3)` → "dalla ricetta v3" |
| 13 | API routes and alert links | `src/server/rules/{ingredients,suppliers,recipes}.ts`, `src/app/api/rules/{ingredients,suppliers,recipes}/route.ts`, `src/server/alerts/list.ts` (`alertHref`), `tests/app/api/rules/{ingredients,suppliers,recipes}.test.ts`, `tests/server/alerts/list.test.ts` | Fake session client. Each route: GET owner/admin/chef → 200 with one RPC; waiter → 403 **before any RPC**; no session → 401; PATCH owner/admin → RPC once with `{p_…, p_patch}` (camelCase keys passed through); chef → 403 before any RPC; `text/plain` → 415; > 4 KiB → 413; malformed id in the body → 400 `invalid_request` without RPC (as built; a well-formed foreign id → 404 from the RPC); `levels_invalid` → 422; P0002 → 404; an injected `last_price` in the fake reply does not reach the JSON (strict output). `list.test.ts`: `alertHref` for the five kinds (§3.3); existing payable links unchanged |
| 14 | Real-stack integration suite | `tests/integration/alert-rules.int.ts`, `tests/integration/helpers/alert-rules.ts` (`seedRulesFixture` through the owner's APIs and `approveWithLots`; consumption through M12's API, so history is today only), `tests/integration/alerts.int.ts` (kind parity list gains the five kinds: a deliberate extension) | **AT1:** owner PATCHes stew rules (min 5, target 30); the chef produces a stew batch through `POST /api/batches` with `portions: 4` (M14 accepts the chef's count); beef on hand 12,3 kg after approvals; `rpc('alert_rules_run')` → chef `GET /api/alerts` lists "Da preparare oggi: Spezzatino (demo)" with the AT1 Italian body; `?locale=en` → the English body. **AT2:** beef 3,0 → the chef sees "Manca materia prima per Spezzatino (demo)" and no prep alert. **AT3 (no history):** Macelleria via `PATCH /api/rules/suppliers`, beef min 5 / target 12 / preferred 5 kg pack via `PATCH /api/rules/ingredients`, on hand 2 kg, `p_at` the next Monday 15:00 Rome → owner sees "Ordina 10 kg di Manzo muscolo (demo) da Macelleria X (demo) entro mar 11:00 per la consegna di gio"; the chef does **not** see it. **AT4:** three `alert_rules_run` calls → the owner's list has one row per item. **Roles:** chef `PATCH /api/rules/*` → 403; chef `from('recipe_key').update(...)` → permission error; owner `from('ingredient').update({min_level: 1})` → permission error (grant revoked). **Tenancy:** owner B's rules lists contain none of A's rows |
| 15 | Settings screens, navigation, UI note | `src/app/(owner)/riordino/{page,ingredient-rule-card,supplier-rule-card,recipe-rule-card}.tsx`, `src/app/(owner)/riordino/{ingredienti,fornitori,ricette}/page.tsx`, `src/app/(owner)/owner-nav.tsx`, `src/lib/nav/is-current.ts`, `src/app/page.tsx`, `docs/design/ui-foundation.md` (§8 line for M16), `tests/components/{ingredient-rule-card,supplier-rule-card,recipe-rule-card,riordino-page,owner-nav}.test.ts`, `tests/lib/nav/is-current.test.ts` | `renderToStaticMarkup` with fixture props. `ingredient-rule-card`: owner → "Minimo", "Obiettivo" (`inputmode="decimal"`, suffix kg), "Fornitore preferito" select from `supplierItems`, one "Salva"; `incomplete` → "Da completare" + reason words; chef → values as text, no level or supplier `input`/`select`, the "Conteggio giornaliero" switch present; markup has no `€`. `supplier-rule-card`: seven checkboxes "Lun"…"Dom" with Mon and Thu checked for `{1,4}`; `type="time"` value 11:00; the `nextWindow` line from the server (an inconsistent fixture is shown as given: no date arithmetic). `recipe-rule-card`: hints "dalla ricetta v3" only for `version` sources; "Restano 4 porzioni". `riordino-page`: three cards with counts; a 403 renders one `ErrorAlert` "Il riordino non è disponibile per il tuo ruolo.". `owner-nav`: "Riordino" for owner, admin, chef; hidden for waiter and unknown; existing tabs unchanged. `is-current`: `/riordino`, `/riordino/fornitori` current; no cross-match |
| 16 | Playwright at 360 px and 1280 px | `e2e/alert-rules.spec.ts`, `e2e/helpers/seed-rules.ts` (secret-key helper calling `alert_rules_run`; next Monday 15:00 Rome computed with `Intl` in Europe/Rome), `e2e/helpers/{seed-invoice,seed-recipe}.ts` (unchanged) | **360 × 740.** Owner: `/riordino/fornitori` → "Macelleria X (demo)" Lun + Gio, 11:00, 2 giorni → "Salva" → the next-window line appears; `/riordino/ingredienti` → beef min 5, target 12, preferred "Macelleria X (demo) · confezione 5 kg" → "Salva" → status no longer "Da completare"; `/riordino/ricette` → stew min 5, target 30 → hint gone. Seed: beef 12,3 kg on hand, a stew batch of 4 portions produced by the chef. Rules run → **chef** `/avvisi` shows "Da preparare oggi: Spezzatino (demo)" and the body "Prepara Spezzatino (demo) oggi, 5,0 kg di Manzo muscolo (demo) disponibili (12,3 kg in giacenza)…" (**AT1 UI**); one tap on the existing M6 acknowledge button marks it done. Owner, after on hand drops to 2 kg via M12 waste and a run at the Monday clock, sees the purchase title "Ordina 10 kg di Manzo muscolo (demo) da Macelleria X (demo) entro mar 11:00 per la consegna di gio" (**AT3 UI**, no history); the chef's list does not contain it. Chef `/riordino/ingredienti` has no level input and no `€`. Waiter: no "Riordino" tab; `/riordino` shows "Il riordino non è disponibile per il tuo ruolo.". `expectPhoneFriendly` on the four screens, light and dark, owner and chef. **1280 × 800:** content stays in the page column |

**Acceptance tests → proof**

| AT (plan §5a.2 M16) | Files (step) | Command |
|---|---|---|
| 1 Stew 4 < 5, beef 12,3 ≥ 5,0 → one prep alert, payload and en/it text | `145` (6), `144` and `templates.test.ts` (5), `148` combined runs (9), `alert-rules.int.ts` (14), `alert-rules.spec.ts` (16) | `npx supabase test db`; `npm test`; `npm run test:integration`; `npx playwright test` |
| 2 Beef 3,0 → purchase suggestion instead of the prep alert | `145` (6), `templates.test.ts` (5), `alert-rules.int.ts` (14) | as AT1 |
| 3 Macelleria X (demo), Mon/Thu, 11:00, Monday afternoon → "Order 10 kg … by Tue 11:00 for Thu delivery" | `141` window and forecast (2), `146` (7), `templates.test.ts` (5), `alert-rules.int.ts` (14, no history), `alert-rules.spec.ts` (16, no history) | as AT1 |
| 4 Three hourly runs on one day → one alert per item | `148` (9), race `rules-concurrent-runs` (11), `alert-rules.int.ts` (14) | `npx supabase test db`; `scripts/test-db-races.sh`; `npm run test:integration` |
| 5 Batch use-by in 20 h with 6 portions → alert; 0 portions → none | `147` (8), `templates.test.ts` (5) | `npx supabase test db`; `npm test` |
| 6 Run on 2026-10-25 (DST end) = normal day | `141` DST window and session-zone cases (2), `148` (9), `templates.test.ts` `weekdayTime` (5), `rules-view.test.ts` (12) | `npx supabase test db`; `npm test` |
| 7 Trailing-14-day weekday average = hand-computed value | `141` (2), `146` forecast 7,0 (7) | `npx supabase test db` |
| Roles: chef reads rules and kitchen alerts, never €; waiter nothing; writes owner/admin | `142`, `143` (3, 4), `144` (5), `146` audience (7), route tests (13), `alert-rules.int.ts` (14), component tests (15), e2e (16) | all of the above |
| Invariants: balances derived, ledgers untouched, `tenant_id` + RLS, roles in Postgres, no data logic in React, secret key not in `src/`, no model ID | `001` green, `140` (1), `149` (10), component tests (15), the existing lint test `admin-client-import.test.ts` | `npx supabase test db`; `npm test`; `npm run lint` |

**CI implications:**
- pgTAP `140`–`149` run in the existing `supabase` job and in `scripts/test-db-native.sh`. No shim change: no new cron call, net or Vault use.
- `089`, `098` and `119` are re-pinned deliberately, with the reason in each comment and in the PR body. `075` and `046` are unchanged. `alerts.int.ts` gains the five kinds.
- One race case and one config test are added. No new CI secret. Coverage ≥ 80 % on new TS.

### 5b. Variants

**V1 — Purchase alerts also reach the chef** · Trigger: Q60 answered "the chef orders from suppliers" · Replaces steps: the `purchase_due` audience of 5 and 7, and the chef assertion of 14 and 16

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V1.1 | `update app.alert_kind set default_audience = '{owner,chef}' where kind = 'purchase_due'` | `supabase/migrations/<ts>_purchase_chef.sql`, `144_rule_alert_kinds.test.sql`, `146_purchase_rule.test.sql` | The AT3 alert has audience `{owner,chef}`; chef claims read it through RLS; the payload passes the allow-list unchanged |
| V1.2 | Chef sees the purchase alert in the app | `tests/integration/alert-rules.int.ts`, `e2e/alert-rules.spec.ts` | Chef `GET /api/alerts` lists the AT3 title with the supplier name (the chef reads `supplier`); no `€` on the chef's page |

**V2 — The chef edits recipe prep rules** · Trigger: Q61 answered "the chef sets minimum and target portions" · Replaces steps: the writer role of `set_recipe_rules` in 3, the PATCH role of `/api/rules/recipes` in 13, the chef read-only recipe card of 15

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V2.1 | `app.require_recipe_rules_writer()` (owner, admin, chef), used by `set_recipe_rules` only | `supabase/migrations/<ts>_chef_recipe_rules.sql`, `142_rules_settings_procedures.test.sql` | Chef A sets stew min 6 → stored and audited with the chef's id; the chef still gets 42501 on ingredient and supplier settings; waiter → 42501 |
| V2.2 | Route and card allow the chef | `src/app/api/rules/recipes/route.ts`, `src/lib/rules/rules-view.ts`, `tests/app/api/rules/recipes.test.ts`, `tests/components/recipe-rule-card.test.ts` | Chef PATCH → 200; the chef's recipe card has the three fields; ingredient and supplier cards stay read-only |

**V3 — Waste counts in the forecast** · Trigger: Q62 answered "count waste as consumption" · Replaces steps: the consumption filter of 2 and its AT7 vector

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V3.1 | `app.weekday_consumption` includes `waste` rows (and their reversals) | `supabase/migrations/<ts>_forecast_with_waste.sql`, `141_rules_helpers.test.sql`, `146_purchase_rule.test.sql` | With the 21/10 waste of 0,5 kg: Wed = (1,5 + 3,0) / 2 = 2,25; forecast 7,25; projected 1,75; the order is still 2 packs = 10 kg |

**V4 — Average only over the days with history** · Trigger: Q63 answered "for a new ingredient, average the days we actually have" · Replaces steps: the fixed divisor 2 of 2

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V4.1 | Divisor per weekday = the number of its dates in the window on or after the ingredient's first receipt (1 or 2); no such date → no forecast row | `supabase/migrations/<ts>_forecast_history_days.sql`, `141_rules_helpers.test.sql` | First receipt on 27/10 (Tuesday): Mon has no date on or after it → no row; Tue = c(27/10) / 1 = 3,5; Wed = c(28/10) / 1 = 3,0; with the first receipt before 19/10 every divisor is 2 and the AT7 values are unchanged |

**V5 — "Ordinato" silences a purchase alert until the delivery** · Trigger: Q65 answered "we want to mark an order as placed" · Replaces steps: none (adds to 7, 13, 15)

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V5.1 | Table `purchase_mark (tenant_id, ingredient_id, delivery_date, created_at, created_by)` with RLS (owner, admin) and fixture rows in `001`/`004`/`059`; `public.mark_ordered(p_alert uuid)` (owner, admin) records the alert's ingredient and delivery date and acknowledges the alert; `app.purchase_rule` skips an ingredient with a mark whose `delivery_date ≥ today` | `supabase/migrations/<ts>_purchase_mark.sql`, `supabase/tests/database/<n>_purchase_mark.test.sql` (number from the next free block), `146_purchase_rule.test.sql` | After `mark_ordered`, runs on the next two days raise no `purchase_due` for beef; the day after the delivery date the rule fires again if still short; chef and waiter → 42501 |
| V5.2 | `POST /api/alerts/:id/ordered` and an "Ordinato" button on purchase alerts | `src/app/api/alerts/[id]/ordered/route.ts`, `src/app/(owner)/avvisi/alert-row.tsx`, `tests/app/api/alerts/ordered.test.ts`, `tests/components/alert-row.test.ts` | Owner → 200 and the row shows as done; chef → 403 before any RPC; the button appears on `purchase_due` only |

**V6 — Expiry alerts only before the date, not after** · Trigger: Q64 answered "once expired, stop alerting" · Replaces steps: the `expired` cases of 8

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V6.1 | `app.expiry_rule` keeps only `due_soon` | `supabase/migrations/<ts>_expiry_due_soon_only.sql`, `147_expiry_rule.test.sql` | An expired lot with 0,5 kg and a batch past use-by with 2 portions → no alert; the `due_soon` cases are unchanged |

**V7 — Purchase alert without full supplier settings** · Trigger: Q66 answered "warn me even if the supplier days are missing" · Replaces steps: the "incomplete → none" rule of 7

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V7.1 | Incomplete ingredients use a horizon of `RULES_FALLBACK_HORIZON_DAYS` (1) and raise `purchase_due` with `supplier_id`, `supplier_item_id`, `order_by_at`, `delivery_date` null (template variant "Ordina {qty} di {ingredient}: imposta il fornitore") | `supabase/migrations/<ts>_purchase_incomplete.sql`, `146_purchase_rule.test.sql`, `src/server/alerts/templates.ts`, `tests/server/alerts/templates.test.ts` | No preferred item, on hand 2, min 5, target 12, forecast 0 → `order_qty` 10 in base units (no pack rounding), supplier fields null; the it/en texts render without a supplier |

## 6. Risks and mitigations

- **Security / privacy**
  - *Definer functions bypass RLS:* every public M16 function checks the role first, has an empty `search_path`, takes the tenant from `app.tenant_id()`, and filters every statement by tenant. The `app.*` rule functions have no API grant (steps 2–9). The preferred-item switch is tenant-filtered inline, not delegated to the invoker M1 function (step 3 checks tenant B's item is untouched).
  - *€ reaching the chef or the waiter:*
    - every kind is non-cost and every payload passes the allow-list (steps 5–8);
    - the reads never select `last_price` and pass a key scan (step 4); the chef's ingredient output has no supplier-item list (steps 4, 12);
    - the component and e2e checks scan for `€` (steps 15, 16).
  - *Audit bypass:* the direct column grants on reorder fields are revoked, so changes happen only through the audited procedures (steps 1, 14).
  - *Input validation:* strict Zod plus strict SQL patch parsing (unknown keys refused, bounds, 4 dp, weekday set, HH:MM), and a 4 KiB body limit. Names are rendered as text (escaping test in step 5).
  - *IDOR:* foreign ids → 404 from the tenant-filtered lookups; malformed body ids → 400 `invalid_request` before any RPC (steps 3, 13).
  - *CSRF:* writes require `application/json` (`withApi`).
  - *Personal data:* nothing new is collected. Audit rows carry user ids as before. Logs carry SQLSTATEs and kinds only. No processor is added; retention follows project Q14.
- **Correctness**
  - *Purchase horizon and same-day reversals:* the horizon counts today's full weekday average (a slight over-order, as part of today may already be consumed), and a reversal counts on its original's date, so a same-day reversal shifts that weekday's average. Accepted for the MVP (see §7, Q67).
  - *Expiry scan cost:* the hourly expiry rule scans all historical lots and batches. Fine at one venue; bounding the scan to positive balances is a later optimisation.
  - *Losing shared check values (the M11/M13 incident):* the union rule in step 1, the config test over all migrations, and the merge rule in the header.
  - *Breaking M9's reminders while replacing the body:* M9's blocks are kept verbatim; `148` proves payable reminders in the same run; the re-pins are explicit in three files.
  - *Wrong deadline across DST:* the deadline is local date + time through the zone database; session-zone independence and the gap and overlap cases are tested (step 2, T1).
  - *Noise:* one alert per item per day (dedup). Purchase alerts repeat daily until stock arrives, because the app does not record orders (Q65 → V5).
  - *Stale first alert of the day:* accepted (§3.1.9); the alert shows the deadline it was computed for.
  - *Silent gaps from incomplete settings:* "Da completare" with reasons and counts on `/riordino` (steps 4, 15); Q66 → V7.
  - *Forecast quality:* the MVP average is crude by design (PRD); M32 replaces it behind the same function (§3.9).
  - *A failing rule:* contained per tenant and rule, recorded in `alert_refusal`, and surfaced by M13's nightly job-health check.
- **Unverified (proved in the named step):**
  - **T1** Converting a local timestamp to Europe/Rome takes the standard-time reading in the autumn overlap and the pre-transition offset in the spring gap ([PostgreSQL docs, B.2](https://www.postgresql.org/docs/14/datetime-invalid-input.html)). Proved in `141` (step 2).
  - **T2** Two concurrent runs serialise on the dedup index and neither fails (`ON CONFLICT DO NOTHING` waits for the other's commit, as M6 relies on). Proved by `rules-concurrent-runs` (step 11).
- **Performance / cost:** set-based statements per tenant, one new partial index, and a CI timing guard (step 9). No figure is promised. No provider or running cost; the job already exists.
- **Dependencies:** none added.
- **Plan changes to record in DigiAlto-Ops `clients/osteria-dei-rossi/context.md`:**
  - §3.5.1 `recipe`: per-recipe rule settings live on `recipe_key` (`rule_min_portions`, `rule_target_portions`, `rule_prep_time_min`), so changing them creates no new version (ADR-015);
  - §5a.2 M16 AT1: the payload is stored as `{recipe_key, ingredient_id, needed_qty, on_hand_qty, unit, …}` (chef allow-list); the text is unchanged;
  - §3.3: PATCH bodies name the item (`ingredientId`, `supplierId`, `recipeKey`);
  - §3.10: five new kinds;
  - §3.11.2: admin reads no alerts (M6 founder decision), as already in force.

## 7. Open questions for the founder (defaults in force for this build)

**Already decided and applied:** Q16 = project V6 (the chef never sees €); M6 2026-10-23 (alerts in the app only; you are the recipient; the chef sees kitchen alerts; admin sees none).

- **Q60 Who receives purchase alerts ("Ordina 10 kg …")?**
  - **Default:** you only. The chef sees the "raw stock short for a prep" alert.
  - **Alternative:** you and the chef (→ V1).
- **Q61 Who sets the minimum and target portions of a batch recipe?**
  - **Default:** you (and DigiAlto support). The chef reads them.
  - **Alternative:** the chef too (→ V2).
- **Q62 Does waste count as consumption in the forecast?**
  - **Default:** no. Only what is used (production, dishes, manual use).
  - **Alternative:** yes (→ V3).
- **Q63 A new ingredient with less than two weeks of history.**
  - **Default:** the missing days count as zero (it may order a little late in the first two weeks).
  - **Alternative:** average only the days since the first delivery (→ V4).
- **Q64 Expired stock still in the cold room.**
  - **Default:** one alert a day until it is used or thrown away.
  - **Alternative:** alert only in the last day before the date (→ V6).
- **Q65 Marking an order as placed.**
  - **Default:** not available. The purchase alert comes back each day until the invoice is approved.
  - **Alternative:** an "Ordinato" button that silences it until the delivery day (→ V5).
- **Q66 An ingredient with a minimum but no preferred supplier or no delivery days.**
  - **Default:** no purchase alert. It shows "Da completare" on the Riordino screen.
  - **Alternative:** an alert without a deadline (→ V7).

- **Q67 Purchase forecast: today's full average, and same-day reversals.**
  - **Default:** accept for the MVP. The horizon counts today's whole weekday average (a slight over-order), and a reversal made the same day shifts that weekday's average.
  - **Alternative:** count only the rest of today, and date reversals by their own day (a re-plan of §3.1.5).

**Assumptions (confirm; a different answer means a re-plan, not a variant):**
- **A1:** the minimum and target are for the whole venue (all storage places together), not per storage place.
- **A2:** a delivery arrives in the morning of the delivery day, before use, so the forecast covers the days from today up to the day before the delivery.
- **A3:** a supplier's lead time, days and cut-off are the same for every ingredient bought from it.
- **A4:** "today" for alerts is the calendar day in Italy (midnight to midnight), as M6 already does, not the business day with the late-night cut-off.

**Technical, resolved inside the build:** T1, T2 (§6).

## 8. Manual steps for the founder

- None are needed to build, test or merge M16. Migrations reach staging through the existing CI deploy job, and the hourly job already exists.
- Before alerts are useful with real data, enter the supplier delivery days and the ingredient minimums (project Q2: no real data until you say so).
- Answer Q60–Q66 when convenient. Each different answer triggers the named variant as a follow-up PR.

## 9. Sources

- Worktree `/home/user/osteria-m16` on `80e6809`: the files in §2; `docs/prd.md`; the project plan; the M6, M9, M12, M13 and M14 plans; ADR-002, ADR-003, ADR-006, ADR-007, ADR-011, ADR-013; `docs/client-facts.md`; `docs/design/ui-foundation.md`.
- PostgreSQL documentation (core features; no dependency): handling of invalid or ambiguous timestamps, <https://www.postgresql.org/docs/14/datetime-invalid-input.html> (T1).
