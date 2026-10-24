# Tech plan — Osteria Digitalization · M15 Batch actions, waste reporting, staff meals

- **Client slug / internal:** `osteria-dei-rossi`.
  - M15 needs no client fact. The approved facts in `docs/client-facts.md` are not used by any fixture, seed or UI text, and neither are the drafts in `docs/client/`.
  - Every fixture is fake:
    - tenants "Osteria Demo A/B"; users "Titolare Demo", "Admin Demo", "Chef Demo", "Cameriere Demo";
    - locations "Cella (demo)", "Congelatore (demo)";
    - ingredients "Manzo muscolo (demo)", "Cipolla (demo)", "Carota (demo)", "Pane (demo)", "Sale grosso (demo)" (never bought);
    - recipes "Ragù (demo)" (batch), "Brodo (demo)" (batch, incomplete cost), and M14's "Spezzatino (demo)";
    - supplier "Fornitore Demo Srl"; lot codes, expiries and prices are invented.
- **Repo and branch:** `osteria-dei-rossi-app`, worktree `/home/user/osteria-m15`, branch `feat/m15-batch-actions` from `main` `80e6809` (M0–M9 and M11–M14 merged). One draft PR.
- **Parallel work and numbering (no collisions with M16):**
  - **M15 uses migrations `20261029100000`–`20261029100700`** (`…100800`–`…100900` are kept free for review fixes), **pgTAP `130`–`139`, ADR-014, open questions Q48–Q53** (M16 starts at Q60). The E2E spec is `e2e/batch-actions.spec.ts`.
  - Variant IDs V1–V6 belong to this plan. Variants of other plans are written with their plan ("M14 V2", "project V6").
  - **Expected merge conflicts with M16, whichever merges second.** In every case keep both sides:
    - `src/lib/i18n/messages/{it,en,keys}.ts`, which both add keys;
    - `src/lib/api/errors.ts`, where both add to the `ErrorCode` union;
    - nav: M15 adds **no** tab and does not edit `src/app/(owner)/owner-nav.tsx` or `src/app/page.tsx`. Only `tests/lib/nav/is-current.test.ts` gains cases, which can collide if M16 adds a tab;
    - `scripts/test-db-races.sh` and `supabase/tests-native/races_fixture.sql`, where new cases are appended at the end;
    - the fixture blocks of pgTAP `004` and `059`, and the list of cost-named functions in `059`;
    - **`audit_event_entity_type_check` / `audit_event_action_check`.** If M16 re-creates them too, the second branch must re-create them with the **union** of both lists. This is the M11/M13 lesson; see `20261027100800_audit_checks_with_staff.sql`;
    - `app.ledger_checks_body`, only if M16 also replaces it: keep every check from both sides;
    - `app.business_date`: if M16 adds its own business-date helper, keep one definition (same formula, §3.1.8);
    - `docs/design/ui-foundation.md` §8.
- **Author:** architect · **Date:** 2026-10-24
- **ADR:** `docs/adr/adr-014-batch-actions.md` (proposed). It records three decisions:
  - a split is a new batch joined to its parent by a pair of `split` movements;
  - `batch.state` is written only by the procedures, from the ledger, and checked every night;
  - batch waste is valued at read time from the frozen `batch_cost`, so the ledger holds no €.
- **Sources:**
  - `docs/prd.md` 2.2 "Manual actions on a batch", 2.5 bullets 1–2, Traceability "reprinted on split";
  - project plan `docs/plans/2026-10-21-project-plan.md`:
    - §3.3, the "batches" API row;
    - §3.5.1 `batch` and `batch_movement`, §3.5.2 `staff_meal_rule`, §3.5.3;
    - §3.6 rules 1–8;
    - §3.11.2 together with project V6;
    - §5a M15, AT1–AT6;
  - the M14 plan, §3.9 "Contract … M15";
  - ADR-002, ADR-003, ADR-008, ADR-011, ADR-012, ADR-013.
  - **Where a plan and the merged SQL differ, the SQL wins.**

> **Flags for the founder (read first)**
> - **Splitting creates a new lot with its own label.** The frozen part of "Ragù" made on 23/10 and split on 24/10 gets the code `241024-RAGUDE-1`. Its label shows "Diviso da 261023-RAGUDE-1" and the original production time.
> - **"Scartato" vs "Finito".** A batch emptied by a discard is shown as *Scartato*. A batch emptied any other way (count, split, staff meal, later sales) is shown as *Finito*.
> - **A staff meal is confirmed once per business day per rule.** The business day changes at the cut-off (02:00 by default), so a meal confirmed at 01:00 counts for the previous day. A second confirmation is refused.
> - **A staff meal is recorded as waste with the reason "Pasto personale"**, using the reason list you approved in the PRD. It therefore appears in the waste € report.
> - **The chef never sees €** (Q16 = project V6). The chef sees discards in portions. The waste € report stays for you and admin.
> - **No new paid service, dependency, secret, alert kind or scheduled job.** There are two new tables: `staff_meal_rule` (from the project plan) and `staff_meal_confirmation`, which enforces "once per day".
> - Q48–Q53 (§7) have defaults that are in force for this build.

## 1. Goal and scope

- **Goal:** with one or two taps, the kitchen keeps the worked layer true. It can count, discard, split and reprint a batch, and confirm the daily staff meal. The owner sees all waste in € by reason, raw and batch together.
- **In scope:**
  - The batch movement shapes `count`, `waste` and `split`, which replace M14's `produce`-only check, and the batch waste reason list.
  - The procedures `public.adjust_batch`, `public.discard_batch` and `public.split_batch`. Each is a single transaction with row locks, and sets the batch state.
  - Reprinting = reading the label text of any batch, split batches included. The label read is extended with the remaining portions and the parent lot.
  - The tables `staff_meal_rule` and `staff_meal_confirmation`, and the procedures `public.staff_meal_rules`, `public.set_staff_meal_rule` and `public.confirm_staff_meal`.
  - `public.batch_detail` (detail, history, action defaults) and `public.waste_costs`, which combines raw and batch waste in € by reason.
  - Three batch checks wired into the nightly invariant check (M13).
  - API: `GET /api/batches/:id`, `POST /api/batches/:id/{adjust,discard,split}`, `GET /api/batches/:id/label` (now readable for any batch), `GET/POST /api/staff-meals`, `POST /api/staff-meals/:id/confirm`. `GET /api/stock/waste-costs` now returns the combined report.
  - Screens, in Italian, phone first at 360 px:
    - `/produzione/[id]` (batch, actions, history);
    - `/produzione/personale` (staff meals);
    - the extended `/magazzino/sprechi`;
    - the split line on the label page;
    - an "Apri" link on each batch row.
  - Race cases, the integration suite and Playwright.
- **Out of scope:**
  - Depleting portions from orders (`consume`, M19). M15 does not allow the `consume` shape.
  - Expiry and prep alerts (M16).
  - QR labels and printing (M28, M29), scan-to-act (M30), trace screens (M31).
  - Reversing batch movements and staff meals (Q51 → V4). Batch actions in the M13 audit page (Q53 → V6).

## 2. Current state (worktree `/home/user/osteria-m15` on `80e6809`)

- **M14 batch layer:**
  - `supabase/migrations/20261028100000_batch_tables.sql`:
    - `batch` (with `state public.batch_state` = `fresh, open, finished, discarded`, default `fresh`; `split_from_batch_id` with a composite FK; `batch_use_by_ck` = elapsed hours; `batch_lot_code_ck`; unique `(tenant_id, lot_code)`);
    - `batch_input`;
    - `batch_movement`: `type` among `produce, consume, count, waste, split`; signed `portions numeric(12,4) <> 0`; `reason_code`; `ref_type ~ '^[a-z_]{1,40}$'`; `ref_id`; `reverses_id`; `effective_on`; **`batch_movement_m14_ck` allows `produce` only**; partial unique index `batch_movement_produce_uq`;
    - `batch_cost` (`unit_cost_frozen`, `incomplete`, `missing_ingredient_ids`, `cost_at`);
    - the view `v_batch_portions`;
    - `app.batch_guard`: on update, every column except `state` must stay the same;
    - append-only triggers;
    - RLS: owner, admin and chef read batches; `batch_cost` is owner/admin only.
  - `20261028100100_batch_helpers.sql`: `app.lot_recipe_code` ("Ragù (demo)" → `RAGUDE`), `app.batch_use_by`, `app.use_by_state`, `app.initials`.
  - `20261028100200_batch_core.sql` together with `20261028100500_batch_review_r1.sql`:
    - `app.require_batch_writer/reader()`;
    - `app.lock_batch_lot(tenant, date, code)` (key from `to_char(date,'YYYYMMDD')`);
    - `app.next_lot_seq` (volatile);
    - `app.produce_batch_core` (lock order: stock locks, then the lot lock; `unit_cost_frozen = round(round(total,4)/portions,4)`).
  - `20261028100400_batch_reads.sql`: `batch_list`, `batch_label` (its keys are pinned by pgTAP `126`), `batch_costs`.
  - TS:
    - `src/server/batches/{constants,types,schemas,output,errors,proposal,produce,list,label}.ts`;
    - `src/app/api/batches/{route.ts,proposal/route.ts,[id]/label/route.ts}`;
    - `src/app/(owner)/produzione/{page,batch-row,negatives}.tsx`, `nuova/*`, `[id]/etichetta/{page,label-text}.tsx`;
    - `src/lib/batches/batch-view.ts`.
- **M12 raw ledger:**
  - `20261026100100_stock_movement_shapes.sql`: `app.stock_reason_codes()`, the 8 PRD codes (`spoilage, expired, over_production, plating_error, staff_meal, comp, breakage, count_correction`), and the shape checks. A `waste` row needs a reason. TS mirror: `src/server/stock/reasons.ts`.
  - `20261026100400_stock_core.sql`:
    - `app.lock_ingredient_stock(tenant, ids[])`, in id order and re-entrant;
    - `app.stock_qty_base`, `app.resolve_location`, `app.location_on_hand`;
    - `app.post_stock_outflow(tenant, user, ingredient, location, qty, type, reason, lot, ref_type, ref_id, at, cost_at, caller)` (FEFO, shortfall row, contained `negative_stock` alert).
  - `20261026100500_stock_procedures.sql`: `post_waste`. `reverse_movement` refuses any `ref_type` other than `manual`/`transfer`.
  - `20261026100800_waste_unvalued_operations.sql`: `public.raw_waste_costs(p_from, p_to)` (owner/admin; reasons → lines; `unvaluedCount`). It is served by `GET /api/stock/waste-costs` (`src/server/stock/waste-costs.ts`, the route `src/app/api/stock/waste-costs/route.ts`) and shown on `src/app/(owner)/magazzino/sprechi/{page,waste-costs}.tsx`.
- **M13:** `20261027100700_ledger_invariants.sql`:
  - `app.ledger_checks_body(tenant, at)` is **one SQL statement**, which pgTAP `117` checks. Later milestones replace it and keep every check;
  - `app.run_ledger_invariants` raises one `ledger_drift` alert per tenant per day.
  - **None of the batch checks is wired yet**, including the M14 contract's "produce = portions_initial".
  - `20261027100800_audit_checks_with_staff.sql` holds the current audit entity and action lists.
- **M11:** `20261025100100_business_day_cutoff.sql`: `app.business_day_cutoff(tenant)` (default 02:00), `app.local_instant`, `app.next_cutoff(at, tz, cutoff)`. **There is no business-date function yet.** `app.venue_date(at, tz)` (M5) is the calendar date.
- **M8:** `app.require_cost_reader()`. pgTAP `059` calls every public function whose name matches `cost|margin|price` as the chef and expects 42501. Its list is currently `batch_costs, …, raw_waste_costs, …`.
- **Tests and tools:**
  - pgTAP `001`, `004`, `059`, `117`, `120`–`129`;
  - `scripts/test-db-races.sh` (helpers `two_sessions_as`, `parked`, `s2_blocked`, `s2_advisory`, `no_deadlock`, `check`, `bt_setup`, `bt_produce`);
  - `tests/integration/helpers/{stack,invoices,batches}.ts`; `e2e/helpers/{session,seed-invoice,seed-recipe,tap}.ts`.
- **Missing today:**
  - no way to change a batch after production;
  - no staff meals;
  - batch waste is not in the € report;
  - no batch detail screen.

## 3. Design

### 3.1 Decisions

1. **Movement shapes and signs.** `batch_movement_m14_ck` is replaced by `batch_movement_shape_ck`. All shapes have `reverses_id is null`; M15 writes no reversal (Q51 → V4).

   | type | portions | reason_code | ref_type | ref_id | written by |
   |---|---|---|---|---|---|
   | `produce` | > 0 | null | `batch` | = batch_id | M14 (unchanged) |
   | `count` | ≠ 0 (counted − expected) | null | `batch_adjust` | operation id | `adjust_batch` |
   | `waste` | < 0 | one of `app.batch_waste_reason_codes()` | `batch_discard` or `staff_meal` (`staff_meal` ⇒ reason `staff_meal`) | operation id / confirmation id | `discard_batch`, `confirm_staff_meal` |
   | `split` | < 0 on the parent (ref_id ≠ batch_id); > 0 on the child (ref_id = batch_id) | null | `batch_split` | the child's id | `split_batch` |
   | `consume` | — | — | — | — | **refused until M19** |

   - **Batch waste reasons:** M12's list minus `count_correction`. A count is an adjustment, not a discard. That leaves seven: `spoilage, expired, over_production, plating_error, staff_meal, comp, breakage`. The function `app.batch_waste_reason_codes()` is immutable, like M12's `stock_reason_codes()`. It is pinned to `src/server/batches/reasons.ts`.
   - Every movement has `effective_on` = `app.venue_date(now(), tz)`, the calendar date, as in M12/M14. Staff meals are dated the same way. Only their once-per-day key uses the business date (rule 8).
2. **Adjust = one count movement of the delta (AT3).**
   - `adjust_batch(batch, counted)`:
     - takes the batch row lock;
     - `expected` = `v_batch_portions`;
     - `delta = counted − expected`;
     - writes one `count` row when delta ≠ 0, and nothing when delta = 0 (as M13 posts only where actual ≠ expected).
   - `counted` is 0 to 10 000 with at most 4 decimals. Fractional values are allowed because M19 will deplete 0,5.
   - An adjust is allowed in any state. A count above 0 reopens a finished or discarded batch, because the food was found.
3. **Discard = waste valued at the frozen portion cost (AT2).**
   - `discard_batch(batch, portions, reason)`: `0 < portions ≤ remaining` (else 409 `portions_insufficient`) and a valid reason (else 422 `reason_invalid`). It writes one `waste` row of `−portions`.
   - **No € is written on the batch ledger.** The chef reads `batch_movement` (ADR-003, Q16).
   - The value is `portions × batch_cost.unit_cost_frozen`, computed by the owner/admin-only report (§3.1.9). `batch_cost` is append-only, so the value is frozen.
   - When the cost is incomplete, the discard is "not valued" and counted in `unvaluedCount`. It is never shown as 0.
4. **Split = a new batch in one transaction (AT1).**
   - `split_batch(batch, portions, location, hoursFromNow)`.
   - **Portions:** `portions` is a whole number, 1 ≤ portions ≤ floor(remaining) (else `portions_insufficient` / `portions_invalid`). Splitting all of it is allowed, and the parent becomes `finished`.
   - **Expiry:** a batch past its use-by cannot be split (409 `batch_expired`; Q48 → V1).
   - **The child row** copies `recipe_key`, `recipe_id`, `recipe_version`, **`produced_at` and `produced_by`** from the parent. The food was made then, by that person: the label and FEFO stay true, and a split of a split keeps the root's production time. It also has:
     - `split_from_batch_id` = parent;
     - `created_by` = the person splitting;
     - `location_id` = `app.resolve_location(p_location)`, e.g. the freezer;
     - `portions_initial = portions_computed = portions`;
     - `output_qty = greatest(round(parent.output_qty × portions ÷ parent.portions_initial, 4), 0.0001)`;
     - `state 'fresh'`.
   - **Use-by:**
     - `shelf_life_hours = floor(epoch(now() + hoursFromNow h − produced_at) ÷ 3600)`;
     - `use_by = app.batch_use_by(produced_at, shelf_life_hours)`.
     - M14's `batch_use_by_ck` (elapsed hours) therefore holds unchanged. The new use-by is **never later** than asked and at most 59 min earlier (assumption A2). It is refused when the result is outside 1–8 760 h or `use_by ≤ now()` (`shelf_life_invalid`).
   - **New lot code:** the M14 scheme on the split's Rome calendar day, `to_char(venue_date(now()),'YYMMDD') || '-' || lot_recipe_code(recipe name) || '-' || seq`. The parent's own code `RAGUDE` is used and numbered through `app.lock_batch_lot` and `app.next_lot_seq`, so a split and a production of the same recipe on the same day never collide. The parent lot is linked by `split_from_batch_id` and printed on the label.
   - **Frozen cost copied per portion:** child `batch_cost` = parent's `unit_cost_frozen`, `total_cost = round(unit × portions, 4)`, the same `incomplete`, `missing_ingredient_ids` and `cost_at`. Nothing is recomputed (ADR-008).
   - **The pair of movements:**
     - parent `split −portions`;
     - child `split +portions`;
     - both `ref_type 'batch_split'`, `ref_id` = the child id.
     - Σ portions over the two batches is unchanged by construction, and checked every night (§3.1.10).
   - The child has no `batch_input`. M31 traces through `split_from_batch_id` to the parent's inputs.
   - **Write order inside the one transaction:**
     1. parent row lock;
     2. remaining;
     3. lot lock;
     4. sequence;
     5. child `batch`;
     6. child `batch_cost`;
     7. the two movements;
     8. parent state.
5. **States (AT4) — written only by procedures, from the ledger.**

   | State | Meaning | Reached when |
   |---|---|---|
   | `fresh` | created, untouched | `produce` (M14) or the child of a split |
   | `open` | remaining > 0 after any later movement | the first adjust, discard, split-out or staff meal that leaves > 0; an adjust above 0 on `finished`/`discarded`; later M19 `consume` |
   | `finished` | remaining ≤ 0, not by a discard | adjust to 0, split of everything, a staff meal taking the last portions; later M19 |
   | `discarded` | remaining ≤ 0 reached by `discard_batch` | a discard of the remaining portions |

   - `app.batch_settle_state(p_tenant, p_batch, p_cause)` runs after each write, in the same transaction:
     - remaining ≤ 0 → `discarded` if the cause is `discard`, else `finished`;
     - otherwise `open`;
     - it updates the row only when the state changes. `batch_guard` already allows `state` alone to change.
   - Discard, split and staff meals need remaining > 0, so they are refused on finished/discarded batches through `portions_insufficient`.
   - **The state is not a stored balance.** It is checked against the ledger every night (§3.1.10). M19 must call the same helper (contract §3.9).
6. **Reprint = reading the label text.**
   - `GET /api/batches/:id/label` already works for any batch id of the tenant, children included.
   - `batch_label` is extended (`create or replace`) with:
     - `portionsRemaining`, which the reprinted label prints (M14 assumption A3);
     - `splitFrom: {lotCode} | null`.
   - It keeps every M14 key. `producedAt` of a child is the parent's (rule 4), and `operatorInitials` are the producer's.
   - Nothing is written. There is no printing (M28).
7. **Staff meals (PRD 2.5 bullet 2; AT5).**
   - **`staff_meal_rule`** is configuration:
     - columns: `id`, `tenant_id`, **exactly one of** `recipe_key` (a `batch` key) and `ingredient_id` (`is_stock`), `default_count numeric(12,4) > 0 ≤ 1000`, `location_id` (ingredients only, optional), `is_active`, `created_*`, `updated_*`;
     - `default_count` is portions for a recipe and base units for an ingredient (converted with `app.stock_qty_base` when saved);
     - **one row per target ever** (unique `(tenant_id, recipe_key)` and `(tenant_id, ingredient_id)`). Saving again updates the row, and deactivating sets `is_active` false. There is no DELETE;
     - each change writes one `audit_event` (`staff_meal_rule.created|updated`);
     - at most 50 rules per tenant.
   - **`staff_meal_confirmation`** is append-only:
     - columns: `id`, `tenant_id`, `rule_id`, `business_date`, `count` (as confirmed), `created_*`;
     - **unique `(tenant_id, rule_id, business_date)`**.
   - **`confirm_staff_meal(rule, count?)`:**
     - checks the role and the rule (active, else 409 `staff_meal_rule_inactive`);
     - `business_date = app.business_date(tenant, now())`. A pre-check gives a clear P0001 `staff_meal_already_confirmed`;
     - **inserts the confirmation first**. A concurrent second call waits on the unique index, then fails with 23505, which is mapped to the same 409 (T1);
     - then writes the consumption:
       - **recipe rule:** locks the recipe's `fresh`/`open` batches with `use_by > now()` (expired batches are excluded, assumption A3) in id order, `for update`. It reads the remaining portions in a new statement and takes `count` from them FEFO by `(use_by, produced_at, id)`, as `waste` rows (`staff_meal`, ref `staff_meal`/confirmation id), settling each batch's state. If less than `count` is available → 409 `portions_insufficient` and nothing is written (Q50 → V3);
       - **ingredient rule:** one `app.post_stock_outflow(…, 'waste', 'staff_meal', null, 'staff_meal', confirmation_id, now(), null, 'confirm_staff_meal')` at the rule's location (or `resolve_location`). This is M12's engine, so a shortfall is recorded and alerted and never refused (rule 8). It is valued at the basis in force now.
     - `count` defaults to `default_count`. A different count for today is allowed (0 < count ≤ 1000).
   - **Once per day per rule** (Q49 → V2). A rule stays one-tap: no per-person data (§3.1.13).
8. **Business date.**
   - `app.business_date(p_tenant, p_at) = (app.next_cutoff(p_at, tz, app.business_day_cutoff(p_tenant)) at time zone tz)::date − 1`. It reuses M11's DST-safe helpers:
     - 23:00 → the same day; 01:30 → the previous day; 02:00 exactly → the same day.
     - It is tested on 2026-10-25 and 2027-03-28.
   - The screen gets `businessDate` from the server. React computes no dates.
9. **Waste € report, raw + batch (AT6).**
   - `public.waste_costs(p_from, p_to)` (owner/admin, `require_cost_reader` first):
     - it calls the unchanged `public.raw_waste_costs` for the raw side, so the M12 logic is not duplicated;
     - it adds the batch side: `waste` rows with `effective_on` in the range, grouped by reason and recipe, `valueEur = round(Σ(−portions × unit_cost_frozen), 4)`, null when any batch in the line has an incomplete cost.
   - The result has the same top-level keys as the raw report, extended:
     ```
     {from, to, valueEur, rawValueEur, batchValueEur, unvaluedCount,
      reasons: [{reasonCode, valueEur, rawValueEur, batchValueEur,
                 lines: [raw lines as M12],
                 batchLines: [{recipeKey, recipeName, portions, valueEur|null}]}]}
     ```
   - `unvaluedCount` = the raw unvalued operations + the distinct batch waste operations `(ref_type, ref_id)` in the range that touch a batch with an incomplete cost.
   - Reasons are ordered by `valueEur desc, reasonCode`.
   - `GET /api/stock/waste-costs` now calls `waste_costs`. **The chef sees portions on the batch screen and no €.** The route stays owner/admin only.
10. **Nightly invariant check, kept small.** `app.ledger_checks_body` is replaced (`create or replace`, still **one statement**, every M13 check kept) with three new checks:
    - `batch_origin`: a batch without exactly one origin movement equal to `portions_initial`. The origin is `produce` when `split_from_batch_id` is null, else the inbound `split` with `ref_id = id`. This wires the M14 contract.
    - `split_unbalanced`: a `batch_split` operation that does not have exactly two rows summing to 0, one of them on the batch whose `split_from_batch_id` is the other's.
    - `batch_state`: `state in (finished, discarded)` ≠ (remaining ≤ 0), or `fresh` with any movement besides its origin.
    - **"Portions never negative" is not a nightly check.** M15's procedures refuse to go below 0, but M19 firing may (rule 8, alerted by M19), so a nightly check would report false drift.
11. **Roles (plan §3.11.2 with project V6; M12 Q1).**

    | Object / action | owner | admin | chef | waiter | DB | API |
    |---|---|---|---|---|---|---|
    | `adjust_batch`, `discard_batch`, `split_batch`, `confirm_staff_meal`, `set_staff_meal_rule` | ✓ | ✓ | ✓ | 42501 | `app.require_batch_writer()` first | `withApi({roles: owner, admin, chef})` |
    | `batch_detail`, `batch_label`, `staff_meal_rules` (quantities) | ✓ | ✓ | ✓ | 42501 | `app.require_batch_reader()` first | same |
    | `waste_costs` (€) | ✓ | ✓ | 42501 | 42501 | `app.require_cost_reader()` first | `withApi({roles: owner, admin})` |
    | SELECT `staff_meal_rule`, `staff_meal_confirmation` | rows | rows | rows | 0 rows | RLS | — |
    | INSERT/UPDATE/DELETE on the batch and staff-meal tables | 42501 | 42501 | 42501 | 42501 | no grant; append-only/guard triggers | — |

    - Every public function is `security definer` with `set search_path = ''`. Each one:
      - checks the role **first**;
      - takes the tenant from `app.tenant_id()` and the user from `app.app_user_id()`, never from a parameter;
      - filters every query by tenant;
      - is executable by `authenticated` only.
    - `app.*` helpers are revoked from all API roles. A foreign or unknown id → P0002 → 404.
12. **Concurrency and lock order.**
    - **Global order** (extends M14): recipe graph → ingredient cost locks → **ingredient stock locks (id order) → batch row locks (`select … for update`, id order) → batch lot lock**.

      | Procedure | Locks it takes |
      |---|---|
      | `adjust_batch`, `discard_batch` | one batch row |
      | `split_batch` | parent row, then the lot lock |
      | `confirm_staff_meal`, recipe rule | the candidate batch rows in id order |
      | `confirm_staff_meal`, ingredient rule | one stock lock (inside the engine) |
      | `produce_batch` | stock locks, then the lot lock (unchanged) |

      Every procedure is consistent with that order, so none can deadlock with another.
    - **Read after lock.** The remaining portions are read in a statement **after** the row lock. Under READ COMMITTED it sees what the previous holder committed (T2). Two discards of 6 out of 10: the second waits, then gets `portions_insufficient`.
    - The confirmation row is inserted before any lock. A waiting second confirmation therefore holds nothing.
13. **Personal data and retention.**
    - Movements and confirmations carry staff ids (`created_by`) like every ledger. Screens show initials only.
    - **A staff meal records no names of who ate**, only the count and who confirmed it.
    - No free text is stored. Retention follows the ledgers (project Q14). There is no new processor, and nothing leaves Supabase (EU).
14. **Wording in the M12 stock history.** `movementTypeWord` maps `waste` with `refType 'staff_meal'` to "Pasto personale" ("Staff meal"). That row is not reversible: `reverse_movement` already refuses `ref_type` ≠ `manual`/`transfer`.

### 3.2 Data model and procedures

**`20261029100000_batch_action_tables.sql`** (step 1)
- `app.batch_waste_reason_codes()` (immutable; the seven codes of §3.1.1).
- `alter table public.batch_movement drop constraint batch_movement_m14_ck, add constraint batch_movement_shape_ck check (…§3.1.1…)`. The existing `produce` rows satisfy it.
- `public.staff_meal_rule`:
  - columns: `id uuid pk`, `tenant_id`, `recipe_key uuid`, `ingredient_id uuid`, `default_count numeric(12,4) not null check (default_count > 0 and default_count <= 1000)`, `location_id uuid`, `is_active boolean not null default true`, `created_at`, `created_by`, `updated_at`, `updated_by`;
  - checks: `check (num_nonnulls(recipe_key, ingredient_id) = 1)`, `check (location_id is null or ingredient_id is not null)`;
  - unique `(tenant_id, recipe_key)`, `(tenant_id, ingredient_id)`, `(tenant_id, id)`;
  - composite FKs to `recipe_key`, `ingredient`, `location`, `app_user`;
  - trigger `app.staff_meal_rule_guard` (insert/update): the key's type is `batch` and the ingredient `is_stock` (else `staff_meal_target_invalid`); `tenant_id`, `recipe_key`, `ingredient_id` and `created_*` never change; DELETE → `append_only`.
- `public.staff_meal_confirmation`:
  - columns: `id`, `tenant_id`, `rule_id`, `business_date date not null`, `count numeric(12,4) not null check (count > 0 and count <= 1000)`, `created_at`, `created_by`;
  - unique `staff_meal_confirmation_day_uq (tenant_id, rule_id, business_date)`; FK `(tenant_id, rule_id)`;
  - append-only and no-truncate triggers.
- RLS on both tables: SELECT `to authenticated` for owner, admin and chef of the tenant. Grants: select only; no INSERT/UPDATE/DELETE for any API role.
- Audit checks re-created with every current value plus entity `staff_meal_rule` and the actions `staff_meal_rule.created`, `staff_meal_rule.updated`.

**`20261029100100_batch_action_helpers.sql`** (step 2). All in `app`, `search_path = ''`, revoked from API roles.
- `app.business_date(p_tenant uuid, p_at timestamptz) returns date` (§3.1.8).
- `app.lock_batch_rows(p_tenant uuid, p_ids uuid[])`: `perform 1 from public.batch where tenant_id = p_tenant and id = any(p_ids) order by id for update`. Unknown id → P0002 `batch_not_found` when a single id is asked for.
- `app.batch_remaining(p_tenant uuid, p_batch uuid) returns numeric` (volatile, so it reads a fresh snapshot after the lock): Σ `batch_movement.portions`.
- `app.batch_settle_state(p_tenant uuid, p_batch uuid, p_cause text) returns public.batch_state` (§3.1.5).

**`20261029100200_batch_adjust_discard.sql`** (step 3). Public, definer, `require_batch_writer()` first.
- `public.adjust_batch(p_batch uuid, p_counted numeric) returns jsonb` → `{batchId, movementId|null, delta, portionsRemaining, state}`. Errors: P0002 `batch_not_found`; P0001 `count_invalid` (< 0, > 10 000, > 4 dp).
- `public.discard_batch(p_batch uuid, p_portions numeric, p_reason text) returns jsonb` → `{batchId, movementId, portions, reasonCode, portionsRemaining, state}`. Errors: `batch_not_found`, `portions_invalid` (≤ 0, > 4 dp), `reason_invalid`, `portions_insufficient`.

**`20261029100300_batch_split.sql`** (step 4)
- `public.split_batch(p_batch uuid, p_portions integer, p_hours_from_now integer, p_location uuid default null) returns jsonb` → `{batchId, newBatchId, lotCode, portions, producedAt, useBy, shelfLifeHours, locationId, portionsRemaining, state}`. Errors: `batch_not_found`, `portions_invalid`, `portions_insufficient`, `batch_expired`, `shelf_life_invalid`, the location codes, and 23505 `batch_lot_code_uq` → 409 `lot_code_conflict` (backstop).

**`20261029100400_staff_meals.sql`** (step 5)
- `public.set_staff_meal_rule(p_recipe_key uuid, p_ingredient_id uuid, p_default_count numeric, p_unit text default null, p_location uuid default null, p_is_active boolean default true) returns jsonb`:
  - an upsert by target;
  - audited;
  - `staff_meal_target_invalid` when there is not exactly one target, the key is not batch or not found, or the ingredient is not stock;
  - `count_invalid`; `unit_mismatch` from `stock_qty_base`; `rules_limit` beyond 50.
- `public.confirm_staff_meal(p_rule uuid, p_count numeric default null) returns jsonb` → `{confirmationId, ruleId, businessDate, count, movements: [{batchId|ingredientId, portions|qty}], negatives: [...]}`. Errors: P0002 `staff_meal_rule_not_found`; P0001 `staff_meal_rule_inactive`, `staff_meal_already_confirmed`, `count_invalid`, `portions_insufficient`; 23505 `staff_meal_confirmation_day_uq` → 409 `staff_meal_already_confirmed`.

**`20261029100500_batch_action_reads.sql`** (step 6). Public, definer, stable.
- `public.batch_detail(p_batch uuid) returns jsonb`:
  - the M14 `batch_list` item fields;
  - `splitFrom: {batchId, lotCode}|null`, `splits: [{batchId, lotCode, portions, locationName}]`;
  - `createdByInitials`, `createdAt`;
  - `movements` (newest first, ≤ 100): `[{id, type, portions, reasonCode, refType, at, byInitials, byMe}]`;
  - `defaults: {hoursLeft|null}` = `floor((use_by − now)/1 h)` when > 0;
  - `can: {adjust, discard, split}` (remaining > 0; split also needs use_by > now).
  - No cost key.
- `public.batch_label(p_batch uuid)` (`create or replace`): the M14 keys plus `portionsRemaining` and `splitFrom`.
- `public.staff_meal_rules() returns jsonb` → `{businessDate, rules: [{ruleId, kind: recipe|ingredient, targetId, name, unit ('porzioni' or the base unit), defaultCount, locationId, isActive, available (portions in unexpired fresh/open batches; null for ingredients), today: {confirmationId, count, at, byInitials}|null}]}`.

**`20261029100600_waste_costs.sql`** (step 7): `public.waste_costs(p_from date, p_to date) returns jsonb` (§3.1.9). The range rules are M12's (`range_invalid`, `range_too_long` > 366 days).

**`20261029100700_batch_invariants.sql`** (step 8): `create or replace function app.ledger_checks_body`, the M13 body plus the three CTEs of §3.1.10, still one statement.

### 3.3 Constants

| Name | Value | Where |
|---|---|---|
| `BATCH_COUNT_MAX` | 10 000 portions, 4 dp | `adjust_batch`, `discard_batch`, `src/server/batches/constants.ts` |
| `SPLIT_HOURS_MAX` | 8 760 (total from production) | `split_batch`; M14 `SHELF_LIFE_HOURS_MAX` |
| `STAFF_MEAL_COUNT_MAX` | 1 000 | rule and confirmation checks |
| `STAFF_MEAL_RULES_MAX` | 50 per tenant | `set_staff_meal_rule` |
| `BATCH_HISTORY_LIMIT` | 100 | `batch_detail` |
| `MAX_ACTION_BODY_BYTES` | 2 048 | `withApi` limit of every M15 POST |
| batch reasons | the 7 codes of §3.1.1 | `app.batch_waste_reason_codes()`, `src/server/batches/reasons.ts` |

### 3.4 API

All routes:
- use `withApi` with the user-session client;
- take strict Zod bodies and queries (unknown key → 400);
- require `application/json` on writes (415 otherwise);
- answer 404 for a malformed path id before any RPC;
- return errors as `{"error":{"code","message","details?"}}`.

**No M15 response except `GET /api/stock/waste-costs` carries a € value or a cost-like key.**

| Endpoint | Roles | Body / query | Success | Errors |
|---|---|---|---|---|
| `GET /api/batches/:id` | owner, admin, chef | — | 200 `BatchDetail` | 401; 403; 404 `batch_not_found` |
| `POST /api/batches/:id/adjust` | owner, admin, chef | `{counted}` | 200 `AdjustResult` | 400; 401; 403; 404; 413; 415; 422 `count_invalid` |
| `POST /api/batches/:id/discard` | owner, admin, chef | `{portions, reason}` | 201 `DiscardResult` | as above + 409 `portions_insufficient`; 422 `portions_invalid`, `reason_invalid` |
| `POST /api/batches/:id/split` | owner, admin, chef | `{portions, hoursFromNow, locationId?}` | 201 `SplitResult` | as above + 409 `portions_insufficient`, `batch_expired`, `lot_code_conflict`; 422 `portions_invalid`, `shelf_life_invalid`, `location_not_found`, `location_required`, `no_location` |
| `GET /api/batches/:id/label` | owner, admin, chef | — | 200 `BatchLabel` (+ `portionsRemaining`, `splitFrom`) | unchanged (M14) |
| `GET /api/staff-meals` | owner, admin, chef | — | 200 `StaffMealRules` | 401; 403 |
| `POST /api/staff-meals` | owner, admin, chef | `{recipeKey, defaultCount, isActive?}` or `{ingredientId, defaultCount, unit, locationId?, isActive?}` | 200 updated / 201 created `StaffMealRule` | 400; 403; 409 `rules_limit`; 422 `staff_meal_target_invalid`, `count_invalid`, `unit_mismatch`, location codes |
| `POST /api/staff-meals/:id/confirm` | owner, admin, chef | `{count?}` | 201 `StaffMealConfirmation` | 403; 404 `staff_meal_rule_not_found`; 409 `staff_meal_already_confirmed`, `staff_meal_rule_inactive`, `portions_insufficient`; 422 `count_invalid` |
| `GET /api/stock/waste-costs` | owner, admin | `?from&to` (unchanged) | 200 `WasteCosts` (§3.1.9) | unchanged (M12) |

- **Zod** (`src/server/batches/schemas.ts`, `src/server/staff-meals/schemas.ts`, all `.strict()`):
  - `qty4` (from M14) for `counted` (`.nonnegative()`), `portions` (discard) and `count`/`defaultCount` (≤ 1000);
  - `split.portions` = `z.number().int().min(1).max(10000)`; `hoursFromNow` = `int 1..8760`;
  - `reason: z.enum(BATCH_WASTE_REASONS)`;
  - the rule body is a `z.union` of two strict objects, so both targets or neither → 400.
- **Services:**
  - `src/server/batches/{detail,actions}.ts`;
  - `src/server/staff-meals/{constants,types,schemas,output,errors,rules,confirm}.ts`;
  - `src/server/stock/waste-costs.ts` calls `waste_costs`.
- **Error mapping:** `mapBatchDbError` and a new `mapStaffMealDbError` gain the codes above. The two 23505 constraint names are mapped explicitly. Anything else → 500 with only the SQLSTATE.

### 3.5 Screens (house style `docs/design/ui-foundation.md` §6/§8; 360 px first; every screen reads `/api/*` only; nothing is computed in React)

- **`/produzione`** (changed `batch-row.tsx`, `page.tsx`):
  - a state `Badge` (`open` → neutral "Aperto", `finished` → "Finito", `discarded` → "Scartato"; none for `fresh`);
  - a text link "Apri" to `/produzione/[id]`;
  - a `secondary` link "Pasti del personale" under the heading. The primary "Nuova produzione" is unchanged.
- **`/produzione/[id]`** (`page.tsx`, `batch-facts.tsx`, `action-panel.tsx`, `movement-row.tsx`):
  - `Heading` with the recipe name;
  - the lot code (`.num`); "Rimaste 6 di 10 porzioni"; use-by with its M14 badge; the location; "Diviso da 261023-RAGUDE-1" (a link) when split; "Parti divise: 241024-RAGUDE-1 · 4 porzioni · Congelatore (demo)";
  - three `secondary` buttons "Conta", "Scarta", "Dividi" (shown per `can`). Each opens one inline form with **one** primary button:
    - **Conta:** `Field` "Porzioni contate" (`inputmode="decimal"`), hint "Attese: 6". → "Registra conteggio". Success note "Conteggio registrato: −1 porzione."
    - **Scarta:** `Field` "Porzioni da scartare" (`inputmode="decimal"`) with a text button "Tutte (6)"; `Field` `Select` "Motivo" (the seven Italian reason words from the stock catalogue). → "Registra scarto".
    - **Dividi:** `Field` "Porzioni da spostare" (`inputmode="numeric"`); `Field` "Ubicazione" (`Select`, only with ≥ 2 locations); `Field` "Conservazione da adesso (ore)", prefilled with `defaults.hoursLeft`, hint "Per il congelatore indica la nuova durata." → "Dividi lotto". On 201 → `/produzione/[newId]/etichetta?diviso=1`.
  - Errors appear in an `ErrorAlert` in Italian: `portions_insufficient` "Non ci sono abbastanza porzioni in questo lotto."; `batch_expired` "Il lotto è scaduto: non si può dividere."; `reason_invalid`; `count_invalid`.
  - "Storico": a `LedgerList` of movements ("Scarto · Avariato · −3 porzioni · CD · 24/10/2026 12:10"; "Divisione · −4"; "Conteggio · −1"; "Pasto personale · −2").
  - A link "Ristampa etichetta" to `/produzione/[id]/etichetta`.
  - No `€` anywhere.
- **`/produzione/[id]/etichetta`** (changed `label-text.tsx`, `page.tsx`):
  - "Porzioni: {portionsRemaining}";
  - a 7th line "Diviso da: 261023-RAGUDE-1" when `splitFrom` is set;
  - with `?diviso=1`, the note "Lotto diviso: nuovo lotto 241024-RAGUDE-1.".
- **`/produzione/personale`** (`page.tsx`, `rule-row.tsx`, `rule-form.tsx`):
  - `Heading` "Pasti del personale", then "Giornata del 24/10/2026" (the server's `businessDate`);
  - one row per active rule: "Ragù (demo) · 2 porzioni" (or "Pane (demo) · 0,5 kg"), "Disponibili: 6", and a 44 px button "Conferma pasto di oggi". The page has no other primary button, so each row's confirm button is the row's primary action;
  - after a confirm, the row shows "Confermato alle 12:10 · CD" and no button. `staff_meal_already_confirmed` → "Già confermato per oggi.";
  - an optional `Field` "Quantità di oggi" behind a text button "Cambia quantità";
  - a bordered section "Regole": "Aggiungi regola" opens `rule-form.tsx`:
    - `Select` "Tipo" (Preparazione / Ingrediente);
    - `Select` of the target (from `GET /api/recipes?type=batch` or `GET /api/ingredients`);
    - "Quantità" with the unit `Select` (ingredients);
    - "Ubicazione";
    - the `secondary` submit "Salva regola".
  - Each rule row has a text button "Disattiva" / "Riattiva".
  - No `€` anywhere.
- **`/magazzino/sprechi`** (changed `waste-costs.tsx`):
  - the total;
  - per reason, the reason word and total, then two lines "Magazzino 0,50 €" and "Preparazioni 6,00 €";
  - batch lines "Ragù (demo) · 3 porzioni · 6,00 €", or "non valorizzato" when null;
  - the M12 `unvaluedCount` hint, now covering batch discards too.
- **Wording helpers** (pure):
  - in `src/lib/batches/batch-view.ts`: `stateBadge(state)`, `movementLine(m, locale)`, `labelLines` (extended), `canAct(role)`;
  - `src/lib/staff-meals/staff-meal-view.ts`: `ruleLine(rule, locale)`, `confirmedLine(today, locale)`.
  - Every string has an English entry.

### 3.6 Flows

1. **Adjust:** "Registra conteggio" → `POST /api/batches/:id/adjust` → `adjust_batch` → row lock → remaining → `count` row → settle state → 200 → reload the detail.
2. **Discard:** → `discard_batch` → row lock → remaining check → `waste` row → settle state → 201.
3. **Split:** → `split_batch` → parent row lock → remaining and expiry check → lot lock → seq → child `batch` → child `batch_cost` → two `split` rows → settle parent → 201 → label of the child.
4. **Staff meal:** `/produzione/personale` → `GET /api/staff-meals` → "Conferma" → `POST /api/staff-meals/:id/confirm` → `confirm_staff_meal` → insert confirmation (unique per business date) → batch rows lock + FEFO `waste` rows, or the M12 engine → 201.
5. **Waste report:** `/magazzino/sprechi` → `GET /api/stock/waste-costs` → `waste_costs` → `raw_waste_costs` + batch waste valued at `unit_cost_frozen`.
6. **Night:** `run_ledger_invariants` → `ledger_checks_body` with the batch checks → `ledger_drift` if any.

### 3.7 Secrets and configuration

| Name | Where it lives | Used by M15 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (public by design) | Vercel env | the session client of every M15 route |
| `SUPABASE_SECRET_KEY` (private) | Vercel env, server only | **not used by M15 code**; only the existing integration fixture helper reads the local stack's key |
| `CRON_SECRET`, Vault values, `ANTHROPIC_API_KEY`, `EXTRACTION_MODEL_ID`, `PIN_PEPPER` | Vercel env / Supabase Vault (existing) | not touched |
| Account logins (Vercel, Supabase, GitHub) | the account owner's password manager with MFA | humans only |

There is no new secret, third-party key or provider.

### 3.8 Fixtures (fake; `tests/fixtures/batches/` extended)

- **Locations:** tenant A, "Cella (demo)" and "Congelatore (demo)".
- **Prices:** beef 10,00 €/kg; onion 1,00; carrot 1,00; "Pane (demo)" kg 3,00. Salt is never bought.
- **"Ragù (demo)"** (batch): output 2 kg, 10 portions, 48 h; beef 2 kg. A batch R1 at 2 kg with beef 2 → **10 portions, total 20,0000 €, 2,0000 € per portion**, lot `{D}-RAGUDE-1`.
- **"Brodo (demo)"** (M14 fixture): incomplete cost (salt).
- **Hand-computed AT6 fixture, all in one Rome month:**

  | Event | Kind | Value |
  |---|---|---|
  | raw onion waste 0,5 kg | `spoilage` | **0,50 €** |
  | raw carrot waste 0,2 kg | `expired` | **0,20 €** |
  | R1 discard 3 portions | `spoilage` | 3 × 2,0000 = **6,00 €** |
  | staff meal rule Ragù, 2 portions, confirmed | `staff_meal` on R1 | **4,00 €** |
  | staff meal rule Pane, 0,5 kg, confirmed | raw `staff_meal` | **1,50 €** |
  | a Brodo batch, discard 1 portion | `over_production` | not valued, `unvaluedCount` 1 |

  - Expected: `spoilage` 6,50 (raw 0,50 + batch 6,00); `staff_meal` 5,50 (raw 1,50 + batch 4,00); `expired` 0,20; `over_production` batch line null.
  - Totals: `valueEur` **12,20**, `rawValueEur` 2,20, `batchValueEur` 10,00, `unvaluedCount` **1**.
- **Split fixture:** R2, a second Ragù batch of 10 made at `T0` → split 4 to Congelatore at `T0 + 2 h` with `hoursFromNow 2160` → child `shelf_life_hours 2162`, `use_by = T0 + 2162 h`, lot `{D}-RAGUDE-3` (R1 = -1, R2 = -2).
- **Tenant B:** one location, one batch recipe and one batch (isolation).

### 3.9 Contract for M19, M23, M31

- **M19:**
  - writes `consume` by replacing `batch_movement_shape_ck` with one more shape (`portions < 0`, reason null, `ref_type 'order_line'`);
  - calls `app.batch_settle_state(…, 'consume')` after its writes;
  - takes batch row locks in id order **after** any stock locks;
  - excludes `finished`/`discarded` batches from FEFO, but writes negatives per rule 8.
- **M23** ("discards vs push"): batch discards = `batch_movement` `waste` with `ref_type 'batch_discard'`; `discarded` state.
- **M31:** a child batch traces to its raw lots through `split_from_batch_id` (recursively) → `batch_input`.

## 4. Alternatives considered

- **Split as two movements on one batch, with a "sub-lot" column but no new row:** rejected. The child needs its own location, use-by, label and FEFO position, and M14 already reserved `split_from_batch_id` for a new row.
- **Child lot code = parent code + suffix (`261023-RAGUDE-1-S1`):** rejected. It breaks `batch_lot_code_ck` and the `^[A-Z0-9]{1,6}$` code check, and hides the day the new lot was made. The M14 scheme with `split_from_batch_id` and the label line gives the same trace.
- **Child `produced_at` = the split time:** rejected. The label would show a false production time, and FEFO would rank frozen food as younger. Keeping the parent's `produced_at` and counting shelf life from it keeps M14's elapsed-hours check unchanged. The cost is a use-by rounded down to the hour (A2).
- **A `unit_cost` column on `batch_movement` for waste €:** rejected. The chef reads `batch_movement` (ADR-003, Q16), and the frozen cost is already immutable in `batch_cost`. Valuing at read is exact.
- **State derived only on read (no column writes):** rejected. M14 already exposes `state` from the column, and M16/M19/M23 filter on it. Writing it only in the same transaction as the movement, checked nightly, keeps one rule in one SQL helper.
- **Extending `raw_waste_costs` in place:** rejected. Its M12 tests pin it. `waste_costs` wraps it, so the raw logic exists once.
- **Once-per-day via a unique index on movements:** not possible. A staff meal writes several rows across two ledgers. A small confirmation table with one unique key is the simplest correct guard.
- **An advisory lock per rule per day instead of the unique index:** rejected. The index is the guard and needs no extra lock class (T1).
- **Recording which staff ate:** rejected (data minimisation, GDPR). The PRD asks for a count only.
- **A new nav tab "Personale":** rejected. It is one link from Produzione, which avoids a nav conflict with M16 and keeps the tab bar short at 360 px.

## 5. Build plan (test first; one commit per step)

**Test conventions** (as M14):
- pgTAP sets claims with `set_config('request.jwt.claims', …)`. Fixtures are inserted as the migration owner, and batches through `app.produce_batch_core` with a fixed `p_at`. Errors are asserted with the `pg_temp.err` pattern.
- Time in pgTAP: the test captures `now()` (constant inside the transaction) and produces batches at `p_at = now() − interval`.

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| 1 | Migration: shape check, batch reasons, staff-meal tables, RLS, grants, audit checks; fixture rows | `supabase/migrations/20261029100000_batch_action_tables.sql`; `supabase/tests/database/130_batch_action_tables.test.sql`; `004_waiter_cost_columns.test.sql` and `059_cost_roles_v6.test.sql` (fixture rows for `staff_meal_rule`, `staff_meal_confirmation`: deliberate extensions); `120_batch_tables.test.sql` (its four expected-error patterns name `batch_movement_shape_ck` instead of `batch_movement_m14_ck`; the same cases stay refused) | `130`. **Shapes** (direct inserts as the owner): `count` −1 / +2 with ref `batch_adjust` → ok; `count` with a reason → 23514; `waste` −3 `spoilage` `batch_discard` → ok; `waste` +3 → 23514; `waste` `count_correction` → 23514; `waste` ref `staff_meal` with reason `spoilage` → 23514; `split` −4 with ref_id ≠ batch → ok, +4 with ref_id = batch → ok, −4 with ref_id = batch → 23514; `consume` → 23514; any `reverses_id` → 23514; M14 `produce` rows still valid. `app.batch_waste_reason_codes()` = the seven codes, in order. **Staff tables:** both targets or none → 23514; a `sub` recipe key or a non-stock ingredient → `staff_meal_target_invalid`; a second rule for the same recipe → 23505; UPDATE of `recipe_key` → refused; DELETE → `append_only`; confirmation UPDATE/DELETE/TRUNCATE → `append_only`; two confirmations same rule same date → 23505 `staff_meal_confirmation_day_uq`. **RLS:** chef A reads both tables; waiter A 0 rows; owner B none of A's; `authenticated` has no INSERT/UPDATE/DELETE. **Audit:** `staff_meal_rule.updated` accepted, and every action of `20261027100800` still accepted. `001`, `004`, `059`, `120` green |
| 2 | Migration: helpers (business date, row locks, remaining, settle state) | `supabase/migrations/20261029100100_batch_action_helpers.sql`, `supabase/tests/database/131_batch_action_helpers.test.sql` | `131`. **`business_date`** (cut-off 02:00, Rome): 2026-10-24T21:00Z (23:00) → 2026-10-24; 2026-10-24T23:30Z (01:30 on 25) → 2026-10-24; **DST end** 2026-10-25T00:30Z (02:30 CEST, before the change) → 2026-10-25; 2026-10-25T01:30Z (02:30 CET, after) → 2026-10-25; **DST start** 2027-03-28T00:30Z (01:30 CET) → 2027-03-27; 2027-03-28T01:00Z (03:00 CEST) → 2027-03-28; a tenant cut-off `04:00` moves 03:00 to the previous day; each repeated under session time zones `Europe/Rome` and `America/New_York` with the same result. **`batch_settle_state`:** remaining 10 → 6 (`count`) → `open`; → 0 by `count` → `finished`; → 0 by `discard` → `discarded`; `discarded` + count 2 → `open`; no update when the state is unchanged (`xmin` unchanged). **`lock_batch_rows`:** an unknown id → P0002 `batch_not_found`; `pg_locks` shows a row lock. **`batch_remaining`** is volatile (catalogue). No API role can execute any function of this migration |
| 3 | Migration: `adjust_batch`, `discard_batch` | `supabase/migrations/20261029100200_batch_adjust_discard.sql`, `supabase/tests/database/132_batch_adjust_discard.test.sql` | `132` (chef A). **AT3:** R (6 remaining after a discard of 4) → `adjust_batch(R, 5)` → one `count` row **−1**, `ref_type 'batch_adjust'`, `delta −1`, `portionsRemaining 5`, `state open`; `adjust_batch(R, 5)` again → `movementId null`, no row; counted 5.5 → +0.5; counted −1, 10001, 1.23456 → `count_invalid`. **AT4 (adjust):** adjust to 0 → `finished`; then adjust to 2 → `open`. **AT2 (movement):** fresh R1 (10) → `discard_batch(R1, 3, 'spoilage')` → one `waste` row −3, `reason_code 'spoilage'`, `ref_type 'batch_discard'`, `portionsRemaining 7`, `state open`; `count_correction` and `'foo'` → `reason_invalid`; 8 when 7 remain → `portions_insufficient`, nothing written; 0 or 1.23456 → `portions_invalid`. **AT4 (discard):** discard 7 → `discarded`; then discard 1 → `portions_insufficient`. **Tenancy:** owner B with R1 → P0002. **Waiter:** 42501, nothing written. **Return keys:** no key matches `/eur\|cost\|price\|value\|amount/i` |
| 4 | Migration: `split_batch` (one transaction) | `supabase/migrations/20261029100300_batch_split.sql`, `supabase/tests/database/133_batch_split.test.sql` | `133`. **AT1:** R2 (10, produced `T0`) split 4, `hoursFromNow 2160`, Congelatore, at `T0+2h` → parent `split −4`, child `split +4`, both `ref_type 'batch_split'`, `ref_id` = child; parent remaining **6**, child **4**, Σ over both = **10**; child `split_from_batch_id` = R2, `produced_at` = R2's `T0`, `produced_by` = R2's producer, `created_by` = the splitting user, `location` Congelatore, `portions_initial 4`, `output_qty 0.8`, `shelf_life_hours 2162`, `use_by = T0 + 2162 h` (= split + 2160 h), `state fresh`; parent `state open`. **Rounding:** split at `T0+2h30m` → `shelf_life_hours 2162`, `use_by` = split + 2159,5 h (never later than asked). **Lot:** child lot `{D}-RAGUDE-3` after R1 `-1` and R2 `-2`; a split on the next Rome day → `{D+1}-RAGUDE-1`; a production of Ragù after the split → `-4`. **Cost copy:** child `batch_cost` `unit_cost_frozen 2.0000`, `total_cost 8.0000`, `incomplete false`, `cost_at` = R2's; a Brodo child → `incomplete true`, nulls, the same `missing_ingredient_ids`. **AT4 (split):** split all 6 of R2 → parent `finished`. **Refusals (nothing written):** 7 of 6 → `portions_insufficient`; 0 → `portions_invalid`; a batch with `use_by ≤ now` → `batch_expired`; `hoursFromNow` 0 → `shelf_life_invalid`; a total over 8 760 → `shelf_life_invalid`. **Fault injection:** a test-only `before insert` trigger raising `fault_injected` on, in turn, `batch_cost` and `batch_movement` → afterwards no child batch, no split row, parent state and remaining unchanged. **Lock order (source check):** in `split_batch`, `app.lock_batch_rows(` before `app.lock_batch_lot(`, and no `app.lock_ingredient_stock(` |
| 5 | Migration: staff-meal procedures | `supabase/migrations/20261029100400_staff_meals.sql`, `supabase/tests/database/134_staff_meals.test.sql` | `134`. **Rules:** chef sets Ragù 2 → created, one `audit_event` `staff_meal_rule.created`; set again 3 → same id, `updated`; Pane `500 g` → `default_count 0.5`; `ml` on Pane → `unit_mismatch`; both targets → `staff_meal_target_invalid`; 51st rule → `rules_limit`; waiter → 42501. **AT5 (recipe):** R1 (7, use_by tomorrow) and R3 (5, use_by later), rule Ragù 2 → confirm → one confirmation (`business_date` = `app.business_date(tenant, now())`) and one `waste` row −2 on R1 (FEFO by use_by), reason `staff_meal`, `ref_type 'staff_meal'`, `ref_id` = confirmation; a second confirm the same business date → P0001 `staff_meal_already_confirmed`, nothing written; on a fresh fixture with count 8 → R1 −7 (→ `finished`, AT4) and R3 −1; an expired batch is skipped; available 3 < 4 → `portions_insufficient`, **no confirmation row**. **AT5 (ingredient):** Pane rule 0,5 → one raw `waste` row `staff_meal`, `ref_type 'staff_meal'`, `unit_cost` = basis now (3,00); with no Pane stock → an unlotted row and one `negative_stock` alert (M12 engine), result `negatives` non-empty. **Business date:** a confirmation at 01:30 Rome counts for the previous day: a second one at 01:45 → refused, one at 02:05 → accepted. **Inactive rule** → `staff_meal_rule_inactive`. **Override count** 0 → `count_invalid`. **Fault injection:** a trigger on `batch_movement` failing on the second slice → no confirmation, no slice. **Tenancy:** owner B with A's rule → P0002 `staff_meal_rule_not_found` |
| 6 | Migration: reads `batch_detail`, `batch_label` (extended), `staff_meal_rules` | `supabase/migrations/20261029100500_batch_action_reads.sql`, `supabase/tests/database/135_batch_action_reads.test.sql`, `supabase/tests/database/126_batch_reads.test.sql` (the exact label key list gains `portionsRemaining` and `splitFrom`: a deliberate extension) | `135`. **detail:** R2 after the split → `portionsRemaining 6`, `splits` = [{child lot, 4, Congelatore}], `can.split true`; child → `splitFrom.lotCode` = R2's, `createdByInitials` of the splitter, `producedAt` = R2's; `movements` newest first with type, reason, initials, `byMe`; `defaults.hoursLeft` = floor of the hours to use-by; an expired batch → `can.split false`, `hoursLeft null`; finished batch → `can.discard false`; no cost key at any depth; P0002 for B. **Reprint label** (child, split fixture): `portions 4`, `portionsRemaining 4`, `splitFrom.lotCode` = R2's, `producedAt` = R2's, `operatorInitials` = the producer's; R2 → `portionsRemaining 6`, `splitFrom null`. **staff_meal_rules:** `businessDate`; Ragù `available` = Σ unexpired fresh/open remaining; `today` null before and set after a confirmation (initials, count); inactive rules listed with `isActive false`; no cost key at any depth; waiter → 42501. `126` green |
| 7 | Migration: `waste_costs`; `059` list | `supabase/migrations/20261029100600_waste_costs.sql`, `supabase/tests/database/136_waste_costs.test.sql`, `supabase/tests/database/059_cost_roles_v6.test.sql` (the cost-named function list gains `waste_costs`: a deliberate extension) | `136` (**AT6**, the §3.8 fixture): `valueEur 12.2000`, `rawValueEur 2.2000`, `batchValueEur 10.0000`; `spoilage` 6.5000 (raw 0.5000, batch 6.0000, batch line Ragù 3 portions 6.0000); `staff_meal` 5.5000 (raw 1.5000, batch 4.0000); `expired` 0.2000; `over_production` batch line `valueEur null`; `unvaluedCount 1`; order by value desc. **AT2 (€):** the R1 discard line = 3 × `unit_cost_frozen` 2.0000 = 6.0000; after a new beef price, the value is unchanged. **Raw side unchanged:** `waste_costs(...) -> reasons -> lines` equals `raw_waste_costs(...)` lines for every reason. **Range:** a discard dated outside the range is excluded; `range_invalid`, `range_too_long`. **Roles:** chef, waiter → 42501; admin ok. `059` and `095` green |
| 8 | Migration: batch invariants in the nightly check | `supabase/migrations/20261029100700_batch_invariants.sql`, `supabase/tests/database/137_batch_invariants.test.sql` | `137`. Clean fixture (produce, discard, adjust, split, staff meal) → no finding. Seeded as superuser with the triggers disabled in the test: a batch whose `produce` ≠ `portions_initial` → `batch_origin:1`; a child without its inbound split → `batch_origin:1`; a split operation with one row only, or +4/−3 → `split_unbalanced:1`; a batch with remaining 0 and `state open` → `batch_state:1`; `fresh` with a discard → `batch_state:1`; one `ledger_drift` alert listing them. **Source check:** the body is still one statement and starts with `return query`. `117` runs **unchanged** and green |
| 9 | Role catalogue and preservation guard | `supabase/tests/database/138_batch_action_roles.test.sql`, `supabase/tests/database/139_m15_preserves.test.sql` | `138`. **Waiter A:** 42501 from the eight new public functions and `batch_label`; 0 rows from the staff tables. **Chef A:** all except `waste_costs` (42501). **Admin, owner:** all. **No claims:** 42501. **anon / service_role:** no EXECUTE. `139`: exactly one definition each of `app.post_stock_outflow`, `app.lock_ingredient_stock`, `app.lock_batch_lot`, `app.next_lot_seq`, `app.produce_batch_core`, `public.produce_batch`, `public.raw_waste_costs`, `public.reverse_movement`; `reverse_movement` on a raw staff-meal row → `movement_not_reversible`; `122`–`125`, `127`–`129` run **unchanged**. PR grep: no `create or replace function` of those names in `supabase/migrations/20261029*` |
| 10 | Two-session race cases | `scripts/test-db-races.sh` (header and four cases, reusing `bt_setup`/`bt_produce`), `supabase/tests-native/races_fixture.sql` (unchanged unless an id is shared) | CI job `db-races`; existing cases unchanged and green. **`discard-same-batch`:** batch of 10; s1 (chef) discards 6 and parks; s2 (owner) discards 6 → `s2_blocked` 1, not advisory (a row lock); after the gate s1 commits, s2 fails `portions_insufficient`; remaining 4. **`split-vs-discard`:** s1 splits 4 and parks; s2 discards 8 → blocked; then `portions_insufficient`; remaining parent 6, child 4. **`split-lot-seq`:** s1 splits a Ragù batch and parks after the lot lock; s2 produces Ragù the same day → `s2_advisory` 1; two distinct lot codes, consecutive seqs; `no_deadlock`. **`staff-meal-twice`:** s1 confirms the Ragù rule and parks; s2 confirms the same rule → blocked on the unique index; afterwards s2 failed with 23505 `staff_meal_confirmation_day_uq`, exactly one confirmation and one set of slices (T1) |
| 11 | TS domain: constants, reasons, schemas, outputs, errors, view helpers, i18n | `src/server/batches/{constants,reasons,schemas,output,errors,types}.ts`, `src/server/staff-meals/{constants,types,schemas,output,errors}.ts`, `src/server/stock/output.ts` (`wasteCostsResponse` extended), `src/lib/batches/batch-view.ts`, `src/lib/staff-meals/staff-meal-view.ts`, `src/lib/api/errors.ts`, `src/lib/i18n/messages/{it,en,keys}.ts`, `tests/server/batches/{schemas,output,errors,reasons}.test.ts`, `tests/server/staff-meals/{schemas,output,errors}.test.ts`, `tests/server/stock/output.test.ts`, `tests/lib/batches/batch-view.test.ts`, `tests/lib/staff-meals/staff-meal-view.test.ts` | `reasons.test.ts`: the TS list equals the seven SQL codes (literal, as M12). `schemas.test.ts`: strict bodies; `counted` 0 allowed, −1 and 5 dp refused; split `portions` 1.5 refused; `hoursFromNow` 8761 refused; reason enum; the rule union refuses both targets and neither. `output.test.ts`: `batchDetail`, `adjustResult`, `discardResult`, `splitResult`, `staffMealRules`, `staffMealConfirmation` declare no key matching `/eur\|cost\|price\|margin\|value\|amount/i` (Zod walk); `wasteCosts` has `rawValueEur`, `batchValueEur`, `batchLines`. `errors.test.ts`: each code of §3.4 → status and Italian text; both 23505 names mapped; unknown → 500 with SQLSTATE only. `batch-view.test.ts`: `stateBadge` for four states; `movementLine` for count −1, waste spoilage −3, split −4/+4, staff meal −2, in it and en; `labelLines` with `splitFrom` → 7th line "Diviso da: …" and "Porzioni: 4" from `portionsRemaining`. `staff-meal-view.test.ts`: "Ragù (demo) · 2 porzioni", "Pane (demo) · 0,5 kg", "Confermato alle 12:10 · CD" (Europe/Rome) |
| 12 | API: batch detail and actions | `src/server/batches/{detail,actions}.ts`, `src/app/api/batches/[id]/route.ts`, `src/app/api/batches/[id]/{adjust,discard,split}/route.ts`, `tests/app/api/batches/{detail,adjust,discard,split}.test.ts` | Fake session client. Each route: owner, admin, chef → success status (200/200/201/201); waiter → 403 **before any RPC**; no session → 401; malformed id → 404 without an RPC; on the POSTs `text/plain` → 415, a body > 2 KiB → 413, an extra key → 400; the RPC is called once with the exact params (`{p_batch, p_counted: 5}`, `{p_batch, p_portions: 3, p_reason: 'spoilage'}`, `{p_batch, p_portions: 4, p_hours_from_now: 2160, p_location: null}`); `portions_insufficient`, `batch_expired` → 409; `reason_invalid` → 422; an injected `unit_cost` in the fake reply does not reach the JSON (strict output) |
| 13 | API: staff meals | `src/server/staff-meals/{rules,confirm}.ts`, `src/app/api/staff-meals/route.ts`, `src/app/api/staff-meals/[id]/confirm/route.ts`, `tests/app/api/staff-meals/{rules,confirm}.test.ts` | `GET`: chef → 200, one RPC `staff_meal_rules`; waiter → 403 before any RPC. `POST`: the recipe body → `set_staff_meal_rule` with `{p_recipe_key, p_ingredient_id: null, p_default_count: 2, p_unit: null, p_location: null, p_is_active: true}`; created → 201, updated → 200; `staff_meal_target_invalid` → 422. Confirm: `{}` → `{p_rule, p_count: null}` → 201; `staff_meal_already_confirmed` (P0001 and 23505) → 409; `portions_insufficient` → 409; P0002 → 404 |
| 14 | API: combined waste report | `src/server/stock/waste-costs.ts`, `tests/app/api/stock/waste-costs.test.ts` (the expected RPC name becomes `waste_costs` and the fixture gains the batch keys: a deliberate change) | Owner → RPC `waste_costs` once with the M12 default range (the Rome month so far, with an injected clock); the reply is mapped with `batchLines`; chef and waiter → 403 before any RPC; a strict-schema failure on an unknown key → 500 |
| 15 | Real-stack integration suite | `tests/integration/batch-actions.int.ts`, `tests/integration/helpers/batches.ts` (`seedRaguBatch`) | **AT1:** chef `POST /api/batches/:id/split` → 201; secret-key read: Σ `v_batch_portions` over parent and child = 10; child lot linked. **AT2:** discard 3 → 201; owner `GET /api/stock/waste-costs` → batch `spoilage` 6.0. **AT3:** adjust 5 with 6 expected → `delta −1`. **AT4:** adjust 0 → `state finished` in `GET /api/batches/:id`. **AT5:** two `POST /api/staff-meals/:id/confirm` → 201 then 409; concurrent `Promise.all` from chef and owner → one 201, one 409. **AT6:** the §3.8 fixture through the APIs → `valueEur 12.2`. **Q16:** the chef's JSON from every M15 route contains no `€` and no cost-pattern key; chef `GET /api/stock/waste-costs` → 403. **Tenancy:** owner B → 404 for A's batch and rule |
| 16 | Batch detail screen and list row | `src/app/(owner)/produzione/[id]/{page,batch-facts,action-panel,movement-row}.tsx`, `src/app/(owner)/produzione/{page,batch-row}.tsx`, `tests/components/{batch-facts,action-panel,movement-row,batch-row}.test.ts`, `tests/lib/nav/is-current.test.ts` | `renderToStaticMarkup`. `batch-facts`: "Rimaste 6 di 10 porzioni", "Diviso da …" link, split children line, badge words. `action-panel`: buttons per `can`; each form has exactly one primary button; "Porzioni contate" `inputmode="decimal"` with "Attese: 6"; "Tutte (6)"; the reason select lists exactly the seven Italian words; "Conservazione da adesso (ore)" prefilled with `hoursLeft`; the `ErrorAlert` texts for `portions_insufficient` and `batch_expired`; no `€` in the markup. `movement-row`: the four kinds worded; a `<script>` name is escaped. `batch-row`: the "Apri" link and the state badge. `is-current`: `/produzione/x` and `/produzione/personale` mark "Produzione" |
| 17 | Staff-meal screen | `src/app/(owner)/produzione/personale/{page,rule-row,rule-form}.tsx`, `tests/components/{rule-row,rule-form}.test.ts` | `rule-row`: "Conferma pasto di oggi" (44 px) when `today` is null; "Confermato alle 12:10 · CD" and no button otherwise; "Disponibili: 6" for recipes, none for ingredients; "Già confermato per oggi." on 409; no `€` in the markup. `rule-form`: type select; target select from props; unit select only for ingredients; `secondary` submit; `aria-invalid` and the message on the field named by a 422 |
| 18 | Waste report and label screens; UI note | `src/app/(owner)/magazzino/sprechi/waste-costs.tsx`, `src/app/(owner)/produzione/[id]/etichetta/{page,label-text}.tsx`, `src/lib/stock/stock-view.ts`, `docs/design/ui-foundation.md` (§8 line for M15), `tests/components/{waste-costs,label-text,operation-row}.test.ts`, `tests/lib/stock/stock-view.test.ts` | `waste-costs`: per reason "Magazzino 0,50 €" and "Preparazioni 6,00 €"; batch line "Ragù (demo) · 3 porzioni · 6,00 €"; null → "non valorizzato", never "0,00 €"; total "12,20 €". `label-text`: the 7th line "Diviso da: 261023-RAGUDE-1" and "Porzioni: 4"; no 7th line without `splitFrom`; `?diviso=1` note. `stock-view`: `waste` + `refType 'staff_meal'` → "Pasto personale", no "Annulla" |
| 19 | Playwright at 360 px and 1280 px | `e2e/batch-actions.spec.ts`, `e2e/helpers/seed-recipe.ts` (adds "Ragù (demo)") | **360 × 740.** The owner seeds the beef lot and the Ragù recipe; the chef produces R1 (10) through the M14 flow. **Chef:** `/produzione` → "Apri" → "Scarta" 3 "Avariato" → "Rimaste 7 di 10" (**AT2 UI**); "Conta" 6 → "Conteggio registrato: −1 porzione." (**AT3 UI**); "Dividi" 4, Congelatore, 2160 → the child label "Diviso da: {R1 lot}", "Porzioni: 4"; back on R1 "Rimaste 2" (**AT1 UI**); `/produzione/personale` → add rule Ragù 2 → "Conferma pasto di oggi" → "Confermato alle …"; R1 shows "Finito" (**AT4/AT5 UI**); a reload shows no confirm button; the chef's pages contain no `€`. **Owner:** `/magazzino/sprechi` shows "Avariato" with "Preparazioni 6,00 €" and "Pasto personale" with "Preparazioni 4,00 €" (**AT6 UI**). **Waiter:** `/produzione/personale` and `/produzione/{id}` show the M14 forbidden message. `expectPhoneFriendly` on the three new/changed screens, light and dark, with a form open. **1280 × 800:** content stays in the page column |

**Acceptance tests → proof**

| AT (plan §5a M15) | Files (step) | Command |
|---|---|---|
| 1 Split 4 of 10 → 6 and 4, new use_by, linked lot, Σ unchanged | `133` (4), `135` (6), `137` split check (8), races `split-vs-discard`, `split-lot-seq` (10), `split.test.ts` (12), `batch-actions.int.ts` (15), `label-text.test.ts` (18), `batch-actions.spec.ts` (19) | `npx supabase test db`; `npm test`; `npm run test:integration`; `npx playwright test`; `scripts/test-db-races.sh` |
| 2 Discard 3 → waste valued at the frozen portion cost, with reason | movement and reason `132` (3); € `136` (7); `discard.test.ts` (12); `batch-actions.int.ts` (15); `waste-costs.test.ts` component (18); e2e (19) | as AT1 |
| 3 Adjust to 5 when 6 expected → count −1 | `132` (3), `adjust.test.ts` (12), `batch-actions.int.ts` (15), e2e (19) | as AT1 |
| 4 Portions at 0 → `finished` | `131` (2), `132` adjust and discard (3), `133` split-all (4), `134` staff meal (5), `137` state check (8), `batch-actions.int.ts` (15), e2e (19) | as AT1 |
| 5 Staff meal once; second confirm same business date → 409 | `130` unique (1), `131` business date (2), `134` (5), race `staff-meal-twice` (10), `confirm.test.ts` (13), `batch-actions.int.ts` sequential and concurrent (15), `rule-row.test.ts` (17), e2e (19) | as AT1 |
| 6 Waste € report sums raw and batch by reason = hand totals | `136` (7), `waste-costs.test.ts` API (14), `batch-actions.int.ts` (15), `waste-costs.test.ts` component (18), e2e (19) | as AT1 |
| Q16 = project V6: chef sees no € | `059` (1, 7), `138` (9), output key scans (11), route tests (12–14), `batch-actions.int.ts` (15), components (16, 17), e2e (19) | as AT1 |
| Invariants: derived balances, append-only, single transaction, RLS, roles in Postgres, no data logic in React, secret key unused | `001`, `004`, `059`, `117` green; `130` (1); fault injection `133`, `134` (4, 5); `137` (8); `139` (9); component tests (16–18); lint `admin-client-import.test.ts` | as AT1 plus `npm run lint` |

**CI implications:**
- pgTAP `130`–`139` run in the existing job and in `scripts/test-db-native.sh`. Advisory and row locks are core Postgres, so no shim change is needed.
- Four race cases join `db-races`.
- Deliberate edits to existing tests: `004`/`059` (fixture rows, the function list), `120` (constraint name), `126` (label keys), `tests/app/api/stock/waste-costs.test.ts` (RPC name). `117`, `122`–`125`, `127`–`129` and `095` are unchanged.
- No new CI secret. Coverage ≥ 80 % on new TS.

### 5b. Variants

**V1 — Splitting a batch past its use-by** · Trigger: Q48 answered "allow it" · Replaces steps: the `batch_expired` rule of 4 and `can.split` of 6

| # | Step | Files | Test that proves it |
|---|---|---|---|
| V1.1 | `split_batch` drops `batch_expired`; `batch_detail.can.split` = remaining > 0 | `supabase/migrations/<ts>_split_expired.sql`, `133_batch_split.test.sql`, `135_batch_action_reads.test.sql` | A batch with `use_by` 1 h ago splits 2 portions with `hoursFromNow 24` → child `use_by` ≤ now + 24 h; `can.split` true for it |
| V1.2 | UI shows a `warning` note "Lotto scaduto" above the split form | `src/app/(owner)/produzione/[id]/action-panel.tsx`, `tests/components/action-panel.test.ts` | The note renders when `useByState = expired` and the form still submits |

**V2 — Two staff meals a day (lunch and dinner)** · Trigger: Q49 answered "twice a day" · Replaces steps: the unique key of 1 and the confirm rule of 5, 13, 17

| # | Step | Files | Test that proves it |
|---|---|---|---|
| V2.1 | `staff_meal_confirmation.slot text check (slot in ('pranzo','cena'))`, unique `(tenant_id, rule_id, business_date, slot)`; `confirm_staff_meal(p_rule, p_slot, p_count)` | `supabase/migrations/<ts>_staff_meal_slots.sql`, `134_staff_meals.test.sql`, `130_batch_action_tables.test.sql` | Lunch then dinner the same day → 2 confirmations; lunch twice → 409; slot null → `slot_invalid` |
| V2.2 | API body `{slot}`; two buttons "Pranzo" / "Cena" per rule | `src/server/staff-meals/schemas.ts`, `src/app/(owner)/produzione/personale/rule-row.tsx`, `tests/server/staff-meals/schemas.test.ts`, `tests/components/rule-row.test.ts`, `e2e/batch-actions.spec.ts` | Strict enum; each button hides after its own confirmation; e2e: lunch and dinner both recorded |

**V3 — Staff meal recorded even when portions are short** · Trigger: Q50 answered "record it anyway" · Replaces steps: the `portions_insufficient` rule of the recipe path in 5

| # | Step | Files | Test that proves it |
|---|---|---|---|
| V3.1 | The shortfall goes as a `waste` slice on the newest unexpired batch of the recipe (portions below 0, state `finished`); no batch at all → still `portions_insufficient`; the nightly `batch_state` check accepts it (remaining < 0 ⇒ finished) | `supabase/migrations/<ts>_staff_meal_shortfall.sql`, `134_staff_meals.test.sql`, `137_batch_invariants.test.sql` | Available 3, count 4 → slices −3 and −1, one batch at −1 `finished`; no finding at night; no batch → 409 |
| V3.2 | The result's `negatives` names the batch; the row shows "Porzioni negative: fai un conteggio" | `src/app/(owner)/produzione/personale/rule-row.tsx`, `tests/components/rule-row.test.ts` | The note renders from the response |

**V4 — Undo a discard or staff meal the same day** · Trigger: Q51 answered "yes, an Annulla button" · Replaces steps: none (adds to 1, 3, 5, 12, 16; the base behaviour stays)

| # | Step | Files | Test that proves it |
|---|---|---|---|
| V4.1 | The shape check allows a reversal (`reverses_id` set, the opposite sign, the same type, reason and ref); `public.reverse_batch_operation(p_ref_type, p_ref_id)` mirrors every batch row of a `batch_discard` or `staff_meal` operation (and the raw rows of a staff meal) on the same business day only, else `reversal_too_late`; once only (`batch_movement_reverses_uq`); settle state; a reversed staff meal frees its day through a row in a new append-only `staff_meal_reversal` table, read by the confirm pre-check and the unique key moved to a partial index over unreversed confirmations | `supabase/migrations/<ts>_batch_reversal.sql`, `supabase/tests/database/<n>_batch_reversal.test.sql` | Discard 3 then reverse → remaining restored, two rows, the report nets to 0; a second reverse → `already_reversed`; next day → `reversal_too_late`; a reversed staff meal can be confirmed again |
| V4.2 | `POST /api/batches/operations/:refType/:refId/reverse` and an "Annulla" text button in the history for today's discards and staff meals | `src/app/api/batches/operations/[refType]/[refId]/reverse/route.ts`, `src/app/(owner)/produzione/[id]/movement-row.tsx`, `tests/app/api/batches/reverse.test.ts`, `tests/components/movement-row.test.ts` | Waiter 403; the button only on today's rows of those two kinds |

**V5 — Only owner and admin set staff-meal rules** · Trigger: Q52 answered "the chef only confirms" · Replaces steps: the rule-writer role of 5, 13, 17

| # | Step | Files | Test that proves it |
|---|---|---|---|
| V5.1 | `set_staff_meal_rule` checks a new `app.require_staff_meal_admin()` (owner, admin) instead of `require_batch_writer()` | `supabase/migrations/<ts>_staff_meal_rule_owner.sql`, `134_staff_meals.test.sql`, `138_batch_action_roles.test.sql` | Chef → 42501 on set, still allowed to confirm |
| V5.2 | `POST /api/staff-meals` roles owner, admin; the "Regole" section hidden for the chef | `src/app/api/staff-meals/route.ts`, `src/app/(owner)/produzione/personale/page.tsx`, `tests/app/api/staff-meals/rules.test.ts`, `tests/components/rule-form.test.ts` | Chef → 403 before any RPC; the section absent for the chef |

**V6 — Batch actions in the audit page** · Trigger: Q53 answered "yes" · Replaces steps: none (adds to M13's `audit_log`)

| # | Step | Files | Test that proves it |
|---|---|---|---|
| V6.1 | `public.audit_log` (create or replace, the M13 body kept) adds a `batch` source: one entry per batch operation (`batch_adjust`, `batch_discard`, `batch_split`, `staff_meal`) with user, time, lot code and portions, no € | `supabase/migrations/<ts>_audit_log_batches.sql`, `supabase/tests/database/<n>_audit_log_batches.test.sql` | The fixture's discard, adjust, split and staff meal appear once each with the right user and time; M13's audit cases unchanged |
| V6.2 | The audit screen words the four kinds | `src/lib/audit/*`, `tests/lib/audit/*.test.ts` | Italian and English words for each kind |

## 6. Risks and mitigations

- **Security / privacy**
  - *Definer functions bypass RLS.* Every M15 public function:
    - checks the role first;
    - has an empty `search_path`;
    - takes the tenant from `app.tenant_id()` and filters by it;
    - is granted to `authenticated` only;
    - returns P0002 for foreign ids (steps 3–7, 9).
    - Composite FKs stop cross-tenant rows (step 1).
  - *€ reaching the chef or the waiter.* € leave the database only through `waste_costs` (owner/admin, in `059`'s list). There are key scans on every other output (steps 3, 6, 11, 12, 15) and `€` scans in the chef's screens (steps 16, 17, 19). `004`/`059` cover the new tables (step 1).
  - *Input injection.* Strict Zod plus SQL range checks; bodies ≤ 2 KiB; names rendered as text (escaping test in 16).
  - *CSRF.* JSON-only writes (`withApi`).
  - *Personal data.* Staff ids on rows, initials on screens, no record of who ate, no free text. Logs carry SQLSTATEs only. Retention follows the ledgers (project Q14).
- **Correctness**
  - *Lost update on a batch.* A row lock, then a fresh read (T2). Proved by `discard-same-batch` and `split-vs-discard` (step 10).
  - *Double staff meal.* The pre-check plus the unique index (T1). Proved by `staff-meal-twice` (10) and the integration concurrency case (15).
  - *Deadlocks.* One global lock order (§3.1.12); source check in `133` (step 4); `no_deadlock` in `split-lot-seq` (step 10).
  - *Partial split or staff meal.* One function call; fault injection in `133`/`134` (steps 4, 5).
  - *State drift.* One helper writes it; a nightly check (step 8); M19 is bound by the contract (§3.9).
  - *DST on the business date.* Vectors on both change days, independent of the session time zone (step 2).
  - *Use-by of a split.* Rounded down to the hour since production, never later than asked (A2; step 4).
  - *Known limit:* a wrong discard or staff meal cannot be undone in M15. It is corrected with "Conta" (batch) or a count (raw). See V4.
  - *Known limit:* the raw staff-meal row is valued at the basis now, and the batch one at the batch's frozen cost. Both follow ADR-008.
- **Unverified (proved in the named step):**
  - **T1:** a second INSERT on a unique key held by an uncommitted transaction waits, then raises 23505 when the first commits ([Index Uniqueness Checks](https://www.postgresql.org/docs/current/index-unique-checks.html)). Proved by `staff-meal-twice` (step 10).
  - **T2:** after `SELECT … FOR UPDATE`, a new statement under READ COMMITTED sees the rows the previous lock holder committed ([explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html), [READ COMMITTED](https://www.postgresql.org/docs/current/transaction-iso.html#XACT-READ-COMMITTED)). Proved by `discard-same-batch` (step 10).
- **Performance / cost:** one venue; each action touches a single row or a few rows, plus indexed sums. No figure is promised, and there is no running cost.
- **Dependencies:** none added.
- **Plan changes to record in DigiAlto-Ops `clients/osteria-dei-rossi/context.md`:**
  - API: `GET /api/batches/:id` is added; `GET /api/stock/waste-costs` now returns raw and batch waste.
  - §3.5.2: `staff_meal_confirmation` is added; `staff_meal_rule` gains `location_id`, `is_active` and `updated_*`.
  - §3.5.1 `batch_movement`: the M15 shapes (§3.1.1); batch reasons = the PRD list minus `count_correction`.
  - `batch.state` is set only by `app.batch_settle_state` and checked nightly. A split child keeps the parent's `produced_at`.
  - Global lock order: stock → batch rows → batch lot.
  - The nightly check gains `batch_origin`, `split_unbalanced` and `batch_state`. ADR-014 is added.

## 7. Open questions for the founder (defaults in force for this build)

**Already decided and applied:**
- Q16 = project V6: the chef never sees €. The waste € report is for you and admin; the chef sees discards in portions.
- M12 Q1: admin (DigiAlto support) may record actions like the owner and the chef, and each row names its author.

- **Q48 Splitting a batch that is past its use-by.**
  - **Default in force:** refused ("Il lotto è scaduto: non si può dividere"). Food past its date should be discarded, not frozen.
  - **Alternative:** allowed, with a warning (→ V1).
- **Q49 How many staff meals per day for the same dish?**
  - **Default in force:** one confirmation per rule per business day (the PRD's "recurring daily entry").
  - **Alternative:** lunch and dinner separately (→ V2).
- **Q50 Confirming a staff meal when the app shows fewer portions than needed.**
  - **Default in force:** refused, and nothing is recorded. The chef first records the production or a count. For a raw ingredient (e.g. bread) it is always recorded, as in Magazzino.
  - **Alternative:** recorded anyway, leaving the batch negative (→ V3).
- **Q51 Undoing a discard or a staff meal entered by mistake.**
  - **Default in force:** no "Annulla" in this milestone. The chef corrects with "Conta" on the batch, which records a count.
  - **Alternative:** an "Annulla" button for the same day (→ V4).
- **Q52 Who may set up staff-meal rules?**
  - **Default in force:** you, admin and the chef. Every change is recorded with who made it.
  - **Alternative:** only you and admin; the chef just confirms (→ V5).
- **Q53 Batch actions in the audit page (Registro).**
  - **Default in force:** not in M15. Each batch has its own history with who and when.
  - **Alternative:** add them to the Registro page too (→ V6).

**Assumptions (confirm; a different answer means a re-plan, not a variant):**
- **A1:** the batch discard reasons are the PRD list minus "count correction" (a count is "Conta").
- **A2:** the use-by of a split part is counted from the original production and rounded down to the whole hour, so it is never later than the chef asked.
- **A3:** staff meals never take portions from a batch past its use-by.
- **A4:** a staff meal counts on the business day (cut-off 02:00 by default, the M11 setting).
- **A5:** "Scartato" means the batch was emptied by a discard. "Finito" means it was emptied any other way.

**Linked project questions:** Q14 (retention of the ledgers, now including staff-meal confirmations).

**Technical, resolved inside the build:** T1, T2 (§6).

## 8. Manual steps for the founder

- None are needed to build, test or merge M15.
- Answer Q48–Q53 when convenient. Each different answer triggers the named variant as a follow-up PR.

## 9. Sources

- Worktree `/home/user/osteria-m15` on `80e6809`: the migrations and files listed in §2; `docs/prd.md` 2.2, 2.5; the project plan §3.5, §3.6, §3.11.2, §5a M15; the M14 plan §3.9; pgTAP `059`, `117`, `120`, `126`; `scripts/test-db-races.sh`.
- PostgreSQL documentation (core features, no dependency):
  - index uniqueness checks: <https://www.postgresql.org/docs/current/index-unique-checks.html>;
  - explicit locking (row locks): <https://www.postgresql.org/docs/current/explicit-locking.html>;
  - READ COMMITTED: <https://www.postgresql.org/docs/current/transaction-iso.html#XACT-READ-COMMITTED>.
