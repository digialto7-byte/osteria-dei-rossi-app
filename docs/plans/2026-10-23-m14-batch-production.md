# Tech plan — Osteria Digitalization · M14 Batch production (`produce_batch`) and label text

- **Client slug / internal:** `osteria-dei-rossi`.
  - The approved client facts in `docs/client-facts.md` are the trading name, the brand colours and the fonts. M14 needs no other client fact.
  - The draft files in `docs/client/` (menu, recipes, ingredients) are not used by any fixture, seed or UI text.
  - Every fixture is fake:
    - tenants "Osteria Demo A/B";
    - users "Titolare Demo", "Admin Demo", "Chef Demo", "Cameriere Demo";
    - locations "Cella (demo)", "Dispensa (demo)";
    - ingredients and recipes suffixed "(demo)": "Manzo muscolo (demo)", "Cipolla (demo)", "Carota (demo)", "Sale grosso (demo)" (never bought, so no cost), "Acqua (demo)" (`is_stock` false); recipes "Spezzatino (demo)" (batch), "Soffritto (demo)" (sub), "Brodo (demo)" (batch), "Spezzatino di manzo (demo)" (batch, for the lot-code prefix case);
    - supplier "Fornitore Demo Srl";
    - invented lot codes, expiries and prices.
- **Repo and branch:** `osteria-dei-rossi-app`, worktree `/home/user/osteria-m14`, branch `feat/m14-batch-production` from the M12 branch head `79b15d9` (M0–M9 merged; M12 in merge review), one draft PR.
- **Parallel work and numbering (no collisions):**
  - M11 uses migrations `20261025*`, pgTAP `080`–`089` and `100`–`101`, ADR-010. M12 uses `20261026*`, pgTAP `090`–`098`, ADR-011. M13 runs in parallel with pgTAP `110`–`119` and ADR-012.
  - **M14 uses migrations `20261028100000`–`20261028100400`, pgTAP `120`–`128` (`129` kept free for V2), ADR-013.**
  - Expected merge conflicts, whichever merges second (keep both sides):
    - `src/app/(owner)/owner-nav.tsx`, `src/lib/nav/is-current.ts`, `src/app/page.tsx` (home links);
    - the i18n catalogues `src/lib/i18n/messages/{it,en,keys}.ts` and `src/lib/api/errors.ts` (`ErrorCode` union);
    - `docs/design/ui-foundation.md` §8;
    - `scripts/test-db-races.sh` (new cases appended at the end) and `supabase/tests-native/races_fixture.sql`;
    - the fixture blocks of pgTAP `004` and `059` (M13's `count_session` and M14's batch tables both add rows there).
  - **If M12 changes in its merge review**, this branch rebases on the merged M12 before step 3 starts: step 3 calls `app.post_stock_outflow` and `app.lock_ingredient_stock` with the signatures in §2.
  - Open-question numbers: the project plan uses Q1–Q29 and the M9 plan continued the series to Q32 (M12 numbered its questions Q1–Q8 inside its own plan). M13 (parallel) takes Q33–Q39, so M14 continues from **Q40**.
  - **Variant IDs:** V1–V9 below are this plan's. The project plan's variant on chef visibility is always written "project V6" here.
- **Author:** architect · **Date:** 2026-10-23
- **ADR:** `docs/adr/adr-013-batch-production.md` (proposed): the worked ledger (batch row + portion ledger, cost split out), production through the M12 engine with one lock order, lot codes, use-by as elapsed hours, sub-recipes expanded to raw at production.
- **Sources:**
  - `docs/prd.md`: Goal 2; Users ("Chef … registers batches, prints labels"); 2.2 bullets 1–3 and the label bullet; Scope "Batch register (produce, label …)"; Traceability "Batch lot: auto-generated … Batch → raw lots link is stored at production", "Labels … contents"; Module 2 acceptance "producing a batch reduces raw stock by the confirmed quantities and creates N portions within one transaction"; Risks "Recipes are approximate" and "Shelf life values set wrong" (editable per batch);
  - project plan `docs/plans/2026-10-21-project-plan.md`:
    - §3.3 (batches row), §3.4 flow 3, §3.5.1 (`batch`, `batch_input`, `batch_movement`), §3.5.2 (`batch_cost`), §3.5.3 (`v_batch_portions`, `produce_batch`);
    - §3.6 rules 1–8, §3.11.2 (role matrix) with the project's §5b V6;
    - §5 (M14 row) and §5a.2 M14 (AT1–AT7), plus M15, M16, M19 as later callers;
    - §7 Q14, Q16, Q19;
  - ADR-002, ADR-003, ADR-007, ADR-008, ADR-011;
  - the M7 plan (§3.1 line rules; §6 "For M14": proposals divide by the yield, batch inputs come only from raw lots, **the chef can NOT read `batch_cost`**);
  - the M8 plan §3.8 (freezing contract for M14: actual inputs × `app.ingredient_unit_costs(…, produced_at)`, an incomplete flag, never 0);
  - the M12 plan §3.9 (contract for M14) and the M12 code listed in §2. **Where the SQL and a plan differ, the SQL wins.**

> **Flags for the founder (read first)**
> - **The chef never sees € (Q16 = project V6, decided 2026-10-23), so the chef cannot read the frozen batch cost.** The M14 acceptance test 7 in the project plan still says "chef can read `batch_cost` (base plan)". That sentence was written before your decision, and your decision replaces it (the M7 plan recorded this for M14). M14 builds and tests "owner and admin read the batch cost; the chef and the waiter read none of it". See §3.1.10.
> - **Production records what really went in.** The app proposes the raw quantities scaled to the actual output. The chef confirms or corrects them, and the ledger records the confirmed figures (5,3 kg, not the proposed 5,1667 kg).
> - **Production never fails for lack of recorded stock.** If the app shows less than what was used, the shortfall is recorded "senza lotto" and the M12 "Scorta negativa" alert goes to you and the chef. Q47 asks whether you would rather have a confirmation step.
> - **Portions are rounded down to a whole portion, and the chef can change them** (project Q19 default). Q43 asks whether the chef may go above the computed number.
> - **Use-by is "produced at + shelf life in real hours".** A 72-hour stew made on Friday 26 March 2027 at 20:00 is due on Monday 29 March at 21:00, because the clocks go forward that Sunday. Q40 asks whether you want the same clock time instead.
> - **Label text only**, shown on screen to copy by hand onto the label. No printing, no QR (M28, M29).
> - **No new paid service, no new dependency, no new secret, no new alert kind, no scheduled job.** Four new tables (already planned in the project plan) and one view.
> - Open questions Q40–Q47 (§7) and the project's Q19 have their **defaults in force for this build**. They go in the PR body.

## 1. Goal and scope

- **Goal:** a worked batch becomes first-class stock. The chef picks a batch recipe, enters the actual output and confirms the actual raw inputs. One transaction then consumes the raw lots (FEFO), records the batch with its lot code, portions, use-by and the link to every raw lot, freezes its cost, and the label text is shown.
- **In scope:**
  - Tables `batch`, `batch_input`, `batch_movement`, `batch_cost` and the view `v_batch_portions` (plan §3.5.1–§3.5.3), with RLS, append-only triggers and two insert guards.
  - The requirement engine `app.batch_requirements`: the raw ingredients of one batch of a recipe version, with sub-recipes expanded and yield applied.
  - `public.batch_proposal(...)`: raw inputs scaled to an actual output, rounded to 4 decimals, with the FEFO lots and on-hand per location of each input (quantities only).
  - `public.produce_batch(...)`: one transaction = consumption movements through the M12 engine (`ref_type 'batch'`) + `batch` + one `batch_input` per movement + `batch_cost` + the `produce` movement of N portions. Deterministic stock locks; a race-safe lot-code sequence.
  - Portions = actual output ÷ (recipe output ÷ portions per batch), rounded down (project Q19 default), editable by the chef. Shelf life from the recipe, editable per batch. Use-by = produced at + shelf life.
  - Lot code `YYMMDD-<recipe>-<seq>` per tenant, Rome calendar day and recipe code.
  - Read functions `public.batch_list`, `public.batch_label` (quantities, no €) and `public.batch_costs` (owner/admin €).
  - API: `GET /api/batches/proposal`, `POST /api/batches`, `GET /api/batches`, `GET /api/batches/:id/label`.
  - Screens (Italian, phone first at 360 px): `/produzione` (batch list), `/produzione/nuova` (production flow), `/produzione/[id]/etichetta` (label text), a "Produzione" nav tab, and the word "Produzione" for batch consumption in the M12 stock history.
  - Race cases in `scripts/test-db-races.sh`, the real-stack integration suite, Playwright at 360 px.
- **Out of scope:**
  - Split, discard, adjust, reprint, the states `open`, `finished`, `discarded`, staff meals and the batch waste € report (M15). M14 only creates `fresh` batches.
  - Firing and depletion of portions (M19); availability for waiters (M18).
  - Prep and expiry alerts on batches (M16).
  - Label rendering, printing, QR, scan-to-act (M28, M29, M30); trace screens (M31). The `batch_input` link the trace needs is stored now.
  - Batches inside batches (M7 Q4 default "no").
  - Correcting a production. A wrong batch is corrected in M15 (adjust, discard). M14 movements cannot be reversed through `reverse_movement` (M12 §3.1.6).

## 2. Current state (worktree `/home/user/osteria-m14` on `79b15d9`)

- **Recipes (M7):**
  - `supabase/migrations/20261023100200_recipe_tables.sql`:
    - `recipe_key (id, tenant_id, type batch|plate|sub, current_version, name_norm, is_active)`;
    - `recipe`, one immutable row per version: `version`, `valid_from`, `name`, `output_qty numeric(12,4)`, `output_unit base_unit`, `portions_per_batch int 1–10000`, `shelf_life_hours int 1–8760`, `prep_time_min`, `min_portions`, `target_portions`. A batch version must have `output_qty`, `portions_per_batch`, `shelf_life_hours` (trigger `app.recipe_type_fields`);
    - `recipe_line (recipe_id, position, ingredient_id | sub_recipe_key, qty, unit recipe_unit, yield_factor 0 < y ≤ 10)`;
    - `recipe_price` (plates only);
    - SELECT for owner, admin and chef; none for the waiter.
  - `20261023100300_recipe_versions.sql`: a batch line holds an ingredient or a **sub-recipe** (never a batch or a plate); a sub's lines hold ingredients and subs; the unit must match the dimension of the ingredient or of the sub's output. `app.lock_recipe_graph(tenant)`. Nesting ≤ 12 levels (`app.assert_recipe_acyclic`, de-duplicated in `20261023100800`).
  - `GET /api/recipes?type=batch` (`src/server/recipes/list.ts`) lists the active batch recipes for owner, admin and chef.
- **Cost engine (M8, `20261023110100`, `20261023110200`):**
  - `app.ingredient_unit_costs(p_tenant, p_ids, p_at)`: the basis in force at `p_at` (prices with `effective_on` ≤ the Rome date of `p_at`); `unit_cost` null when never bought (never 0).
  - `app.recipe_unit_factor(unit)` (g, ml → 0,001; else 1) and `app.recipe_in_force(tenant, key, p_at)`.
  - `app.require_cost_reader()` (owner, admin).
  - pgTAP `059` calls every public function named `cost|margin|price` as the chef (expects 42501) and asserts the list is exactly M8's plus `raw_waste_costs`. Its fixture has one row in every public table.
- **Raw stock (M12, `20261026100000`–`20261026100900`):**
  - `stock_movement_type` = `receipt, consumption, waste, transfer, count`. A `consumption` row has `qty < 0` (unless it is a reversal), `ref_type ~ '^[a-z_]{1,40}$'` and a non-null `ref_id`; `unit_cost` may be null. Unique `(tenant_id, id)` (`stock_movement_tenant_id_id_uq`).
  - `app.lock_ingredient_stock(p_tenant uuid, p_ids uuid[])`: one `pg_advisory_xact_lock(hashtext('ingredient_stock'), hashtext(tenant || ingredient))` per distinct id, **in id order**; re-entrant.
  - `app.stock_qty_base(p_tenant, p_ingredient, p_qty, p_unit) returns numeric`: P0002 `ingredient_not_found`; P0001 `ingredient_not_stock`, `unit_mismatch`, `qty_invalid` (≤ 0 or > 100 000 after conversion); rounds to 4 dp.
  - `app.fefo_buckets(tenant, ingredient, location)`, `app.location_on_hand(...)`, `app.expiry_state(expiry, today)`.
  - `app.post_stock_outflow(p_tenant uuid, p_user uuid, p_ingredient uuid, p_location uuid, p_qty numeric, p_type stock_movement_type, p_reason text, p_lot uuid, p_ref_type text, p_ref_id uuid, p_at timestamptz, p_cost_at timestamptz, p_caller text) returns table (movement_id uuid, raw_lot_id uuid, qty numeric)`:
    - takes the stock lock;
    - takes the override lot first (P0002 `lot_not_found`, P0001 `lot_empty`), then FEFO, then one unlotted shortfall row;
    - `unit_cost` from `app.ingredient_unit_costs(..., p_cost_at)` on every row; `effective_on` = the Rome date of `p_at`;
    - the contained `negative_stock` alert (one per ingredient per Rome day, payload quantities and ids only, caller recorded).
  - `public.reverse_movement` refuses any operation whose `ref_type` is not `manual` or `transfer` (`movement_not_reversible`), so batch rows are already protected.
  - `public.stock_movements` returns `refType` per operation; `src/lib/stock/stock-view.ts` `movementTypeWord(type, isReversal)` words the history.
  - `app.resolve_location(p_tenant, p_location)` (M5): the given active location, else the only active one; P0001 `location_not_found`, `no_location`, `location_required`.
  - `app.venue_date(p_at, p_tz)` = calendar date in the tenant zone (no cut-off).
- **Alerts:** the kind `negative_stock` (owner, chef; quantity-only payload) exists. The kind lists in pgTAP `044`/`072` and `tests/integration/alerts.int.ts` are **not touched by M14** (no new kind).
- **Tests and tools:**
  - pgTAP `001` (RLS and `tenant_id` everywhere), `004` (waiter-readable column scan, one fixture row per public table), `059` (chef € scan, same fixture rule);
  - `scripts/test-db-races.sh` (helpers `two_sessions_as`, `parked`, `s2_blocked`, `s2_advisory`, `no_deadlock`, `fresh_db`, `check`) and `supabase/tests-native/races_fixture.sql` (tenant A, owner, admin, chef, the stew batch key `ec..e01` with 5 kg of Manzo `1a..1a`);
  - `tests/integration/helpers/{stack,invoices,stock-model}.ts` (`approveWithLots`); `e2e/helpers/{session,seed-invoice,tap}.ts`.
- **TS:** `withApi` (`src/lib/api/with-api.ts`); `ApiError`, `ErrorCode`, `ErrorDetail` (`src/lib/api/errors.ts`); `src/lib/time/{format,venue-date}.ts` (`VENUE_TIME_ZONE = "Europe/Rome"`, `formatDateTime`, `formatCalendarDate`, `venueDate`); `src/lib/units/format.ts` (`formatQty`); `src/lib/money/format.ts` (`formatEuro`); `src/components/ui.tsx`; house style `docs/design/ui-foundation.md` §6 and §8.
- **Missing today:** no batch table, view or procedure; no `/api/batches*` route; no production screen; no lot-code generator.

## 3. Design

### 3.1 Decisions

1. **Two layers, one transaction (PRD acceptance; plan §3.6 rules 1–3).**
   - `public.produce_batch` is one SQL function call, so one transaction. Its writes, in order:
     - (a) the consumption movements for every input, through `app.post_stock_outflow`;
     - (b) the `batch` row;
     - (c) one `batch_input` row per consumption movement;
     - (d) the `batch_cost` row;
     - (e) the `produce` movement in `batch_movement`.
   - Any error at any point (a `lot_empty` on the third input, a constraint, an injected fault) rolls back all of it, including any `negative_stock` alert raised during (a).
   - The batch id is generated first (`gen_random_uuid()`) and used as the `ref_id` of the consumption rows. So (a) is written before (b), and the AT3 fault point "after the consumption movements" exists (step 4).
   - **Portions remaining are never stored.** `v_batch_portions` = Σ `batch_movement.portions` per batch. `batch.portions_initial` is the produced figure (a fact of production, like `raw_lot.qty_received`) and equals the `produce` movement by construction. M13's invariant check reads it ("every batch has a produce movement equal to portions_initial").
2. **The worked ledger (`batch_movement`).**
   - The types `produce, consume, count, waste, split` (PRD data model) are all created now, so M15/M19 never need `ALTER TYPE … ADD VALUE`.
   - **M14 writes and allows only `produce`.** A check constraint `batch_movement_m14_ck` requires `type::text = 'produce'`; M15/M19 replace it with their shapes.
   - `produce` shape: `portions > 0`, `reason_code` null, `ref_type 'batch'`, `ref_id = batch_id`, `reverses_id` null; at most one per batch (partial unique index).
   - `portions numeric(12,4)` (signed), so M19 can deplete 0,5 (PRD 2.2). `portions_initial` is a whole number.
   - Append-only and no-truncate triggers (`app.append_only`). No INSERT/UPDATE/DELETE grant for any API role.
3. **The batch row.**
   - The plan's columns plus what production needs (§3.2). `state` starts `fresh`.
   - The row is immutable except `state`, which only M15's procedures change (trigger `app.batch_guard`; no API role has UPDATE).
   - The recipe version is pinned: `recipe_id` (the version row), `recipe_key`, `recipe_version`. A composite foreign key `(tenant_id, recipe_key, recipe_version)` → `recipe`, and an insert guard checks that `recipe_id` is that same version of a `batch` key.
   - `portions_computed` (the rounded-down figure) is stored beside `portions_initial` (the confirmed one), so an edit by the chef stays visible.
4. **Requirements (the proposal and the validation share one function).**
   - `app.batch_requirements(p_tenant, p_recipe_id, p_at)` returns, per raw ingredient, the raw quantity for **one** batch of that version, in the ingredient's base unit, unrounded:
     - an ingredient line contributes `qty × recipe_unit_factor(unit) ÷ yield_factor` (M7: `qty` is net, raw = qty ÷ yield);
     - a sub-recipe line contributes its sub's requirements × `(qty × recipe_unit_factor(unit) ÷ yield_factor) ÷ sub.output_qty` (same dimension, checked by M7), with the sub's version **in force at `p_at`** (`app.recipe_in_force`);
     - the same ingredient reached through several lines or paths is summed.
   - **No path enumeration** (the M7/M8 lesson on diamond graphs): a loop of at most 13 rounds. Each round holds one row per key with the summed factor of every path of that length, expands it one level and adds its ingredient lines. Rows per round ≤ the number of distinct keys.
   - A sub with no version in force or a depth over 12 → P0001 `recipe_not_producible` (422), with the reason in the detail (`sub_not_in_force`, `graph_too_deep`).
   - Assumption A1: sub-recipes are made fresh inside the batch, so their raw ingredients are consumed at production.
5. **Proposal scaling (AT2).**
   - Proposed raw qty per ingredient = `round(req × actual_output ÷ recipe.output_qty, 4)`: multiply first, divide once, round once per ingredient (half away from zero, as Postgres `round(numeric, 4)`). Stew: 5 × 6,2 ÷ 6 = 5,16666… → **5,1667 kg**.
   - **Portions (project Q19 default):** `portions_computed = floor(actual_output × portions_per_batch ÷ output_qty)`. 6,2 × 30 ÷ 6 = **31**; 6,19 → 30. It is computed with numerics, never through a rounded portion size. `portionSize = round(output_qty ÷ portions_per_batch, 4)` is returned for display only ("0,2 kg a porzione"). Q19 → V9.
   - Non-stock ingredients (`is_stock` false, e.g. water) are listed with `isStock: false` and their proposed quantity. They are never consumed and are refused as inputs (`ingredient_not_stock`). Assumption A4.
6. **Confirmed inputs (AT1).**
   - The chef sends one entry per stock ingredient of the requirements: `qty ≥ 0` in `kg|g|l|ml|pz`, an optional `locationId` and an optional override `lotId`. `qty 0` means "not used": no movement, no lock.
   - Rules, all checked **before any lock or write**:
     - every stock ingredient of the requirements appears exactly once (`input_missing`, `input_duplicate`);
     - nothing outside it (`input_not_in_recipe`; Q42 → V3);
     - at least one `qty > 0` (`inputs_empty`);
     - each `qty > 0` is converted with M12's `app.stock_qty_base` (4 dp; `unit_mismatch`, `qty_invalid`, `ingredient_not_stock`);
     - each location is resolved with `app.resolve_location`.
     - Errors name the ingredient in the detail (`[{"ingredientId": …}]`).
   - **One location per input** (Q45 → V6). **An override lot means "start from this lot, then FEFO"**, exactly M12's engine (Q46 → V7).
   - Each input with `qty > 0` is one `app.post_stock_outflow(..., 'consumption', null, lot, 'batch', batch_id, produced_at, produced_at, 'produce_batch')` call, in ingredient-id order. The confirmed quantity is what is consumed: 5,3 kg, not the proposal.
   - **No refusal for lack of stock** (plan §3.6 rule 8, M12 contract). A shortfall is one unlotted row; its `batch_input` row has `raw_lot_id` null; the engine raises the contained `negative_stock` alert with caller `produce_batch`. Q47 → V8.
7. **Lot code `YYMMDD-<recipe>-<seq>` (AT4).**
   - `YYMMDD` = `to_char(app.venue_date(produced_at, tenant.timezone), 'YYMMDD')`: the Rome **calendar** day, not the business day with cut-off (assumption A2). A batch at 00:30 on 25 October 2026 gets `261025`.
   - `<recipe>` = `app.lot_recipe_code(recipe.name)`: Italian accented letters folded (`àáèéìíòóùú` → `aeiou`, with `translate`, no extension), upper case, only `A–Z0–9` kept, the first 6 characters; empty → `RIC`. "Spezzatino (demo)" → `SPEZZA`. Q41 → V2.
   - `<seq>` = 1 + the highest `lot_seq` among the tenant's batches with the same `lot_date` and `lot_recipe_code`.
     - The counter is keyed by the **printed code**. Two recipes whose names share the first 6 characters ("Spezzatino (demo)" and "Spezzatino di manzo (demo)") get `-1` and `-2`, never two identical lot codes.
     - For recipes with distinct codes this is exactly "per recipe per day".
   - **Race safety:**
     - `app.lock_batch_lot(tenant, lot_date, code)` = `pg_advisory_xact_lock(hashtext('batch_lot'), hashtext(tenant || date || code))`, taken **after** the stock locks;
     - then the `max + 1` read, in a new statement (READ COMMITTED sees the previous holder's committed batch);
     - backstop: unique `(tenant_id, lot_code)`. A 23505 there maps to 409 `lot_code_conflict`. It should never happen; race case `produce-lot-seq` proves it (step 9).
   - A check constraint ties `lot_code = to_char(lot_date,'YYMMDD') || '-' || lot_recipe_code || '-' || lot_seq`.
8. **Use-by (AT6).**
   - `use_by = produced_at + make_interval(hours => shelf_life_hours)`: **elapsed hours**, whatever the session time zone.
   - Never `interval 'n days'`: Postgres adds a days field as calendar days in the session time zone, which shifts by an hour across DST ([PostgreSQL date/time operators](https://www.postgresql.org/docs/current/functions-datetime.html)). Unverified detail T1, proved in step 2.
   - Example: produced 2027-03-26T19:00Z (20:00 CET), 72 h → 2027-03-29T19:00Z, shown "29/03/2027, 21:00" in Europe/Rome. Q40 → V1.
   - `shelf_life_hours` = the recipe's, or the chef's value for this batch (PRD "from recipe, overridable"), 1–8 760, stored on the batch.
   - `produced_at` = the server clock of the call (`now()`, the transaction start). Q44 → V5.
9. **Frozen cost (AT5; M8 §3.8; ADR-008).**
   - `batch_cost.total_cost` = `round(Σ(−qty × unit_cost), 4)` over the batch's consumption rows. The engine read their `unit_cost` with `p_cost_at = produced_at`.
   - `unit_cost_frozen` = `round(total_cost ÷ portions_initial, 4)` (per portion; M15 discards and M19 firing use it).
   - Any row with a null `unit_cost` makes the cost **incomplete**: `total_cost` and `unit_cost_frozen` null, `incomplete` true, `missing_ingredient_ids` listed. Never 0.
   - Nothing recomputes it. The row is append-only, so a later price change does not move it (AT5).
   - This is the cost of the **actual** inputs, so it can differ from M8's theoretical recipe cost. The owner sees each on its own screen.
10. **Roles (plan §3.11.2 read with project V6; Q16 = project V6 decided; M12 Q1 decided).**
    - The project matrix gives the chef "R" on `batch_cost` in the base plan, and §5a.2 M14 AT7 repeats it.
    - The founder chose project V6 on 2026-10-23 ("percentages only"). Project step V6.1 removes the chef's read of `batch_cost`; the M7 plan §6 recorded "For M14: the chef can NOT read `batch_cost`"; the M12 rule is "the chef never sees €".
    - **Reconciled: the decision wins. AT7's chef part is tested as "the chef reads 0 rows of `batch_cost` and gets 42501 from `batch_costs`".** No question is reopened; §7 lists it as decided.
    - Admin writes like the owner and the chef, for the same reason as M12 Q1 (decided): DigiAlto support may record operations on request, and each row names its author.

    | Object / action | owner | admin | chef | waiter | DB enforcement | API |
    |---|---|---|---|---|---|---|
    | `batch_proposal`, `produce_batch` | ✓ | ✓ | ✓ | 42501 | `app.require_batch_writer()` first | `withApi({roles: owner, admin, chef})` |
    | `batch_list`, `batch_label` (no €) | ✓ | ✓ | ✓ | 42501 | `app.require_batch_reader()` first | same |
    | `batch_costs` (€) | ✓ | ✓ | 42501 | 42501 | `app.require_cost_reader()` (M8) first | called by `GET /api/batches` for owner/admin only |
    | SELECT `batch`, `batch_input`, `batch_movement`, `v_batch_portions` | rows | rows | rows | 0 rows | RLS | — |
    | SELECT `batch_cost` | rows | rows | **0 rows** (Q16 = project V6) | 0 rows | RLS | — |
    | INSERT/UPDATE/DELETE/TRUNCATE on the four tables | 42501 | 42501 | 42501 | 42501 | no grant; append-only triggers; `batch_guard` | — |

    - Every public function is `security definer` with `set search_path = ''`. It checks the role **first**, takes the tenant from `app.tenant_id()` and the user from `app.app_user_id()`, filters every query by tenant, and is executable by `authenticated` only (revoked from `public`, `anon`, `service_role`). Every `app.*` helper is revoked from all API roles.
11. **Concurrency and lock order.**
    - `produce_batch` takes, in this order:
      1. `app.lock_ingredient_stock(tenant, ids)` **once, with every input ingredient with `qty > 0`**, before any balance is read. The M12 helper sorts and de-duplicates, so the order is the ingredient id order whatever the JSON order. This is deadlock-free between productions, and with M12/M13 writers that follow the same rule;
      2. the engine's own per-ingredient lock call (re-entrant, adds nothing);
      3. `app.lock_batch_lot(...)`, last.
    - **Global lock order** (extends M12 §3.1.11): recipe graph (shared) → ingredient cost locks → ingredient stock locks (id order) → batch lot lock. `produce_batch` takes neither of the first two:
      - recipe rows are immutable and the batch pins the version id; the requirement expansion is one statement (one snapshot), with sub versions in force at `produced_at`;
      - an approval committing a new price during a production is either seen or not by the single cost read. Both are a valid "basis in force when the cost was read".
    - Two productions on the same raw lot: the second waits, then consumes what is left (race `produce-same-lot`).
    - Two productions of the same recipe on the same day with disjoint inputs: the second waits on the lot lock and gets `-2` (race `produce-lot-seq`).
12. **Reads.**
    - Batches have no € column, so `batch`, `batch_input`, `batch_movement` and `v_batch_portions` are readable through RLS by owner, admin and chef. The API still reads through definer functions (role check first, one round trip, names joined), as in M12.
    - `useByState` is computed in SQL by `app.use_by_state(use_by, now())`: `expired` (use_by ≤ now), `due_soon` (≤ now + 24 h, PRD 2.4 "within 1 day of use-by"), else `ok`. React never compares dates.
    - Operator initials (label, PRD) are derived on read from `app_user.display_name` (`app.initials`: the first letter of up to 3 words, upper case). No name is stored on the batch.
13. **Label text (PRD 2.2, Traceability "Labels").**
    - Fields: recipe name (of the pinned version), produced date and time, use-by date and time (both Europe/Rome), portions at production, lot code, operator initials.
    - QR, PNG and printing are M28/M29. The text is shown on screen for copying onto the label by hand.
    - Assumption A3: the label shows the portions at production.
14. **Personal data and retention.** Batches carry `produced_by` and `created_by` (staff ids), as every ledger does. The label and the list show initials only. No free text is stored on a batch. Retention follows the ledgers (project Q14). No new processor.
15. **Stock history wording.** M12's history shows batch consumption as an operation with `refType 'batch'`. `movementTypeWord` gains that case: "Produzione" (en "Production") instead of "Consumo". The row stays non-reversible (M12 rule, unchanged).

### 3.2 Data model and procedures

**`20261028100000_batch_tables.sql`** (step 1)
- `create type public.batch_state as enum ('fresh', 'open', 'finished', 'discarded')`; `create type public.batch_movement_type as enum ('produce', 'consume', 'count', 'waste', 'split')`.
- `public.batch`:
  - `id uuid pk default gen_random_uuid()`, `tenant_id uuid not null → tenant`;
  - `recipe_key uuid not null`, `recipe_id uuid not null`, `recipe_version int not null`;
  - `lot_code text not null`, `lot_date date not null`, `lot_recipe_code text not null check (lot_recipe_code ~ '^[A-Z0-9]{1,6}$')`, `lot_seq int not null check (lot_seq between 1 and 9999)`;
  - `produced_at timestamptz not null`, `produced_by uuid not null`;
  - `output_qty numeric(12,4) not null check (output_qty > 0 and output_qty <= 100000)`, `output_unit public.base_unit not null`;
  - `portions_computed int not null check (portions_computed between 0 and 10000)`, `portions_initial int not null check (portions_initial between 1 and 10000)`;
  - `shelf_life_hours int not null check (shelf_life_hours between 1 and 8760)`, `use_by timestamptz not null`;
  - `batch_use_by_ck check (extract(epoch from use_by - produced_at) = shelf_life_hours * 3600)` (elapsed seconds, so the check never depends on the session time zone);
  - `state public.batch_state not null default 'fresh'`, `location_id uuid not null`, `split_from_batch_id uuid` (M15; null in M14);
  - `created_at timestamptz not null default now()`, `created_by uuid not null`.
  - Constraints:
    - unique `(tenant_id, id)`; unique `batch_lot_code_uq (tenant_id, lot_code)`; `batch_lot_code_ck` (§3.1.7);
    - foreign keys `(tenant_id, recipe_key, recipe_version)` → `recipe (tenant_id, recipe_key, version)`, `(tenant_id, recipe_id)` → `recipe`, `(tenant_id, location_id)` → `location`, `(tenant_id, produced_by)` and `(tenant_id, created_by)` → `app_user`, `(tenant_id, split_from_batch_id)` → `batch`;
    - indexes `(tenant_id, produced_at desc, id)` and `(tenant_id, recipe_key, produced_at desc)`.
  - Trigger `app.batch_guard()` (`before insert or update`):
    - on insert, `recipe_id` must be the version `recipe_version` of `recipe_key`, and the key's type `batch`; else P0001 `batch_recipe_mismatch`;
    - on update, every column except `state` must be unchanged; else `batch_immutable`.
  - `before delete` → `app.append_only()`; a no-truncate trigger.
- `public.batch_input`:
  - `id`, `tenant_id`, `batch_id uuid not null`, `ingredient_id uuid not null`, `location_id uuid not null`, `raw_lot_id uuid` (null = the shortfall slice, M12 contract), `qty numeric(12,4) not null check (qty > 0)` (base units), `stock_movement_id uuid not null`, `created_at`, `created_by`.
  - Unique `(stock_movement_id)`. Foreign keys `(tenant_id, batch_id)` → `batch`, `(tenant_id, ingredient_id)` → `ingredient`, `(tenant_id, location_id)` → `location`, `(tenant_id, raw_lot_id)` → `raw_lot`, `(tenant_id, stock_movement_id)` → `stock_movement`, and the users. Indexes `(tenant_id, batch_id)` and `(tenant_id, raw_lot_id)` (M31 forward trace).
  - Trigger `app.batch_input_guard()` (`before insert`): the referenced movement must have `type 'consumption'`, `ref_type 'batch'`, `ref_id = batch_id`, the same ingredient, location and lot (`is not distinct from`), and `qty = −new.qty`; else P0001 `batch_input_mismatch`. Defence in depth, like M12's reversal guard.
  - Append-only and no-truncate triggers.
- `public.batch_movement`:
  - `id`, `tenant_id`, `batch_id`, `type public.batch_movement_type not null`, `portions numeric(12,4) not null check (portions <> 0)`, `reason_code text`, `ref_type text not null check (ref_type ~ '^[a-z_]{1,40}$')`, `ref_id uuid not null`, `reverses_id uuid`, `effective_on date not null`, `created_at`, `created_by`.
  - `batch_movement_m14_ck`: `type::text = 'produce' and portions > 0 and reason_code is null and reverses_id is null and ref_type = 'batch' and ref_id = batch_id` (replaced by M15/M19).
  - Unique partial index `batch_movement_produce_uq (batch_id) where type = 'produce'`; unique `batch_movement_reverses_uq (reverses_id)`; foreign keys `(tenant_id, batch_id)` → `batch` and `(tenant_id, reverses_id)` → itself; index `(tenant_id, batch_id)`.
  - Append-only and no-truncate triggers.
- `public.batch_cost`:
  - `batch_id uuid primary key`, `tenant_id`, `total_cost numeric(12,4) check (total_cost >= 0)`, `unit_cost_frozen numeric(12,4) check (unit_cost_frozen >= 0)`, `incomplete boolean not null`, `missing_ingredient_ids uuid[] not null default '{}'`, `cost_at timestamptz not null`, `created_at`, `created_by`.
  - `batch_cost_complete_ck`: `incomplete = (total_cost is null) and (total_cost is null) = (unit_cost_frozen is null) and incomplete = (cardinality(missing_ingredient_ids) > 0)`.
  - Foreign key `(tenant_id, batch_id)` → `batch`. Append-only and no-truncate triggers.
- `public.v_batch_portions` (`security_invoker`): `tenant_id, batch_id, portions_remaining = Σ portions`, grouped from `batch_movement`.
- RLS on the four tables. SELECT policies `to authenticated`:
  - `batch`, `batch_input`, `batch_movement`: `tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner','admin','chef')`;
  - `batch_cost`: `… in ('owner','admin')`.
- Grants: `revoke all … from anon, authenticated, service_role`; `grant select … to authenticated` on the four tables and the view; `service_role` gets select (integration reads, as M12's `stock_movement`).

**`20261028100100_batch_helpers.sql`** (step 2). Schema `app`, `search_path = ''`, revoked from every API role.
- `app.lot_recipe_code(p_name text) returns text` (immutable) (§3.1.7).
- `app.batch_use_by(p_produced_at timestamptz, p_hours int) returns timestamptz` (immutable): `p_produced_at + make_interval(hours => p_hours)`.
- `app.use_by_state(p_use_by timestamptz, p_now timestamptz) returns text` (immutable) (§3.1.12).
- `app.batch_portions(p_output numeric, p_recipe_output numeric, p_ppb int) returns int` (immutable): `floor(p_output * p_ppb / p_recipe_output)::int`.
- `app.initials(p_name text) returns text` (immutable).
- `app.batch_requirements(p_tenant uuid, p_recipe_id uuid, p_at timestamptz) returns table (ingredient_id uuid, qty_per_batch numeric)` (stable, definer) (§3.1.4). P0002 `recipe_not_found`; P0001 `recipe_not_producible` (detail `sub_not_in_force` or `graph_too_deep`).

**`20261028100200_batch_core.sql`** (step 3). Schema `app`; definer where it reads RLS tables; `search_path = ''`; revoked from every API role.
- `app.require_batch_writer()`, `app.require_batch_reader()`: role ∈ owner, admin, chef, else 42501. Kept apart from the stock helpers, so a change of who produces cannot silently change who records waste.
- `app.lock_batch_lot(p_tenant uuid, p_date date, p_code text)` (§3.1.7).
- `app.next_lot_seq(p_tenant uuid, p_date date, p_code text) returns int`.
- `app.produce_batch_core(p_tenant uuid, p_user uuid, p_recipe_id uuid, p_output_qty numeric, p_inputs jsonb, p_portions int, p_shelf_life_hours int, p_location uuid, p_at timestamptz) returns jsonb`. Steps:
  1. **Recipe:** the version row of the tenant (P0002 `recipe_not_found`); its key type `batch` (`recipe_not_batch`); the key active (`recipe_inactive`); `version = current_version` (`recipe_version_stale`, 409).
  2. **Output:** `p_output_qty` > 0, ≤ 100 000, at most 4 decimals (`output_invalid`).
  3. **Shelf life:** null → the recipe's; else 1–8 760 (`shelf_life_invalid`).
  4. **Portions:** `v_computed = app.batch_portions(...)`. `p_portions` null → `v_computed`, and then `v_computed = 0` → `portions_invalid` (the chef must enter a number). Else 1–10 000 (`portions_invalid`).
  5. **Batch location:** `app.resolve_location(p_tenant, p_location)`.
  6. **Inputs:** `jsonb_typeof = 'array'`, 1–100 elements, each an object with exactly the keys `ingredientId`, `qty`, `unit` and optionally `locationId`, `lotId` (else `inputs_invalid`). Then the rules of §3.1.6, against `app.batch_requirements(p_tenant, p_recipe_id, p_at)` filtered to `is_stock` ingredients. Errors carry `detail = '[{"ingredientId":"…"}]'`.
  7. `v_batch := gen_random_uuid()`.
  8. `app.lock_ingredient_stock(p_tenant, <ids with qty > 0>)`.
  9. For each input with qty > 0, in ingredient-id order: `app.post_stock_outflow(p_tenant, p_user, ingredient, location, qty, 'consumption', null, lot, 'batch', v_batch, p_at, p_at, 'produce_batch')`; collect the rows.
  10. `v_date := app.venue_date(p_at, tenant.timezone)`; `v_code := app.lot_recipe_code(recipe.name)`; `app.lock_batch_lot(p_tenant, v_date, v_code)`; `v_seq := app.next_lot_seq(...)`.
  11. Insert `batch` (`use_by = app.batch_use_by(p_at, shelf life)`, `state 'fresh'`).
  12. Insert one `batch_input` per collected row (`qty = −row.qty`).
  13. Insert `batch_cost` from the `unit_cost` of the batch's rows (one `select` over `stock_movement` by `ref_type 'batch', ref_id v_batch`).
  14. Insert the `produce` movement (`portions = portions_initial`, `effective_on = v_date`).
  15. Return:

      ```
      {batchId, lotCode, recipe: {key, id, version, name}, producedAt, useBy, outputQty, outputUnit,
       portionsComputed, portions, shelfLifeHours, locationId,
       inputs: [{ingredientId, locationId, qty, movements: [{id, rawLotId, qty}]}],
       negatives: [{ingredientId, locationId, onHandQty}]}
      ```

      `negatives` = the (ingredient, location) pairs whose `app.location_on_hand` is < 0 after the writes. **No cost key.**

**`20261028100300_batch_procedures.sql`** (step 5). Public, definer, `search_path = ''`, role check first, execute to `authenticated` only.
- `public.batch_proposal(p_recipe_key uuid, p_output_qty numeric default null, p_shelf_life_hours int default null) returns jsonb` (stable):
  - `app.require_batch_writer()`; the key's current version (P0002 `recipe_not_found`; `recipe_not_batch`; `recipe_inactive`);
  - `p_output_qty` null → the recipe's output; validated as core step 2; shelf life as core step 3;
  - returns (quantities only):

    ```
    {recipe: {key, id, version, name, outputQty, outputUnit, portionsPerBatch, shelfLifeHours, portionSize},
     outputQty, portionsComputed, shelfLifeHours, useByPreview, today,
     locations: [{id, name}], suggestedLocationId,
     inputs: [{ingredientId, name, baseUnit, isStock, proposedQty, units, suggestedLocationId,
               onHand: [{locationId, onHandQty}],
               lots: [{rawLotId, lotCode, locationId, expiry, expiryState, onHandQty, fefoRank}]}]}
    ```

  - `useByPreview = app.batch_use_by(now(), shelf life)`;
  - `inputs` ordered by name (`collate "C"`);
  - `units` = M12's `UNITS_FOR_BASE` list, in SQL (`kg → {kg,g}`, `l → {l,ml}`, `pz → {pz}`);
  - `lots` = the positive buckets per active location in FEFO order (`app.fefo_buckets`), plus the unlotted bucket when it is non-zero;
  - an input's `suggestedLocationId` = the active location of its first FEFO bucket across locations (expiry, received_on, lot id); else `app.resolve_location(tenant, null)` if it succeeds; else null;
  - the top-level `suggestedLocationId` (where the batch is stored) = the only active location, else null.
- `public.produce_batch(p_recipe_id uuid, p_output_qty numeric, p_inputs jsonb, p_portions int default null, p_shelf_life_hours int default null, p_location uuid default null) returns jsonb` (volatile): `app.require_batch_writer()`, then `app.produce_batch_core(app.tenant_id(), app.app_user_id(), …, now())`. This is the project plan's `produce_batch(recipe_id, output_qty, inputs jsonb)` with three optional parameters added.

**`20261028100400_batch_reads.sql`** (step 6). Public, definer, stable, `search_path = ''`, execute to `authenticated` only.
- `public.batch_list(p_recipe_key uuid default null, p_before_at timestamptz default null, p_before_id uuid default null, p_limit int default 50) returns jsonb`:
  - `require_batch_reader`; `p_limit` 1–100 (else `invalid_request`); newest first by `(produced_at, id)`;
  - returns `{items: [{batchId, lotCode, recipeKey, recipeName, version, producedAt, useBy, useByState, shelfLifeHours, outputQty, outputUnit, portionsComputed, portionsInitial, portionsRemaining, state, locationId, locationName, byInitials, byMe}], nextCursor}`. **No cost key.**
- `public.batch_label(p_batch uuid) returns jsonb`: `require_batch_reader`; P0002 `batch_not_found` (foreign or unknown); returns `{batchId, recipeName, version, producedAt, useBy, portions, lotCode, operatorInitials, shelfLifeHours}`.
- `public.batch_costs(p_batch_ids uuid[]) returns table (batch_id uuid, total_cost_eur numeric, unit_cost_eur numeric, incomplete boolean, missing_ingredient_ids uuid[])`:
  - `app.require_cost_reader()` first; at most 100 ids (`too_many_ids`); only the tenant's batches; values rounded to 4 dp;
  - its name contains `cost`, so `059` covers it (the list is extended in step 6).

### 3.3 Constants

| Name | Value | Where / why |
|---|---|---|
| `BATCH_OUTPUT_MAX` | 100 000 (recipe output unit) | `produce_batch_core`, `src/server/batches/constants.ts`; the bound of `recipe.output_qty` |
| `BATCH_PORTIONS_MAX` | 10 000 | the bound of `recipe.portions_per_batch` |
| `SHELF_LIFE_HOURS_MAX` | 8 760 | the bound of `recipe.shelf_life_hours` |
| `BATCH_INPUTS_MAX` | 100 | `inputs_invalid`; matches the 100 recipe line positions |
| `LOT_RECIPE_CODE_LEN` | 6 | `app.lot_recipe_code` |
| `LOT_SEQ_MAX` | 9 999 per code per day | `batch.lot_seq` check |
| `USE_BY_SOON_HOURS` | 24 | `app.use_by_state`; PRD 2.4 |
| `BATCH_LIST_PAGE_SIZE` | 50 (max 100) | `batch_list`, `constants.ts` |
| `BATCH_COSTS_MAX_IDS` | 100 | `batch_costs` |
| `MAX_BATCH_BODY_BYTES` | 16 384 | `withApi` body limit of `POST /api/batches` |
| batch lot lock class | `hashtext('batch_lot')` | `app.lock_batch_lot` |
| qty decimals | 4 | proposal, inputs (M12 `stock_qty_base`), output |

### 3.4 API

All routes:
- use `withApi` with the user-session client (RLS and definer checks apply);
- take strict Zod queries and bodies (an unknown key or parameter → 400);
- require `application/json` on writes (else 415);
- return errors as `{"error":{"code","message","details?"}}`;
- answer 404 for a malformed path id before any RPC.

**No batch response carries a € value or a cost-like key for the chef.** € appear only in the `cost` object of `GET /api/batches`, for owner and admin.

| Endpoint | Roles | Query / body | Success | Errors |
|---|---|---|---|---|
| `GET /api/batches/proposal` | owner, admin, chef | `?recipeKey=<uuid>` (required) `&outputQty=<decimal>` `&shelfLifeHours=<int>` | 200 `BatchProposal` (§3.2) | 400; 401; 403 waiter **before any RPC**; 404 `recipe_not_found`; 422 `recipe_not_batch`, `recipe_inactive`, `recipe_not_producible`, `output_invalid`, `shelf_life_invalid` |
| `POST /api/batches` | owner, admin, chef | `ProduceBody` | 201 `ProduceResult` (§3.2, core step 15) | 400; 401; 403; 404 `recipe_not_found`, `ingredient_not_found`, `lot_not_found`; 409 `recipe_version_stale`, `lot_empty`, `lot_code_conflict`; 413; 415; 422 `recipe_not_batch`, `recipe_inactive`, `recipe_not_producible`, `output_invalid`, `portions_invalid`, `shelf_life_invalid`, `inputs_invalid`, `input_duplicate`, `input_not_in_recipe`, `input_missing`, `inputs_empty`, `unit_mismatch`, `qty_invalid`, `ingredient_not_stock`, `location_required`, `no_location`, `location_not_found` (input errors carry `details: [{ingredientId}]`) |
| `GET /api/batches` | owner, admin, chef | `?recipeKey=<uuid>` `&before=<ISO>_<uuid>` | 200 `{items: [BatchItem], nextCursor}`; owner/admin items also carry `cost` | 400 (bad cursor too); 401; 403 |
| `GET /api/batches/:id/label` | owner, admin, chef | — | 200 `BatchLabel` | 401; 403; 404 `batch_not_found` (malformed id too) |

- **Zod shapes** (inputs in `src/server/batches/schemas.ts`, outputs in `output.ts`, all `.strict()`):
  - `qty4 = z.number().positive().max(100000)` refined to at most 4 decimals; `qty4OrZero` the same with `.nonnegative()`.
  - `proposalQuery = z.strictObject({recipeKey: z.uuid(), outputQty: z.coerce.number() → qty4, optional, shelfLifeHours: z.coerce.number().int().min(1).max(8760).optional()})`.
  - `produceBody = z.strictObject({recipeId: z.uuid(), outputQty: qty4, portions: z.number().int().min(1).max(10000).optional(), shelfLifeHours: z.number().int().min(1).max(8760).optional(), locationId: z.uuid().optional(), inputs: z.array(z.strictObject({ingredientId: z.uuid(), qty: qty4OrZero, unit: z.enum(['kg','g','l','ml','pz']), locationId: z.uuid().optional(), lotId: z.uuid().optional()})).min(1).max(100)})`. Duplicates and the recipe set are checked in SQL only (one source of truth).
  - `listQuery = z.strictObject({recipeKey: z.uuid().optional(), before: cursor.optional()})`, cursor `^<ISO instant>_<uuid>$`.
  - Outputs: `batchProposal`, `produceResult`, `batchItem` (no cost), `batchItemWithCost = batchItem.extend({cost: z.strictObject({totalEur: z.number().nullable(), perPortionEur: z.number().nullable(), incomplete: z.boolean()})})`, `batchListResponse` (chef), `batchListWithCostResponse` (owner/admin), `batchLabel`. Quantities and money are JSON numbers with 4 decimals.
- **Services:** `src/server/batches/{constants,types,schemas,output,errors,proposal,produce,list,label}.ts`. `list.ts` calls `batch_list`; then, only when `session.role` is owner or admin, it calls `batch_costs(ids)` and merges by id. The chef path never calls it.
- **Error mapping** (`errors.ts`):
  - 42501 → 403; P0002 → 404;
  - the P0001 codes → 409 or 422 per the table; the M12 codes reuse M12's messages;
  - 23505 on `batch_lot_code_uq` → 409 `lot_code_conflict`;
  - anything else → 500, reported with the SQLSTATE only.
  - `src/lib/api/errors.ts` `ErrorCode` gains the new codes.

### 3.5 Screens (house style `docs/design/ui-foundation.md` §6 and §8 "kitchen screens"; phone first at 360 px; every screen reads `/api/*` only; nothing is computed in React)

- **`/produzione`** (`src/app/(owner)/produzione/{page,batch-row}.tsx`; owner, admin, chef):
  - `Heading` "Produzione" and the **one primary** `Button` "Nuova produzione" (a link to `/produzione/nuova`).
  - A `LedgerList`, one row per batch, newest first:
    - the recipe name in bold, the lot code in `.num` ("261023-SPEZZA-1");
    - a `.num` line "Prodotto il 23/10/2026, 10:12 · da consumare entro il 26/10/2026, 10:12";
    - a `.num` line "31 porzioni · rimaste 31"; when `portionsInitial ≠ portionsComputed`, a muted "(calcolate 30)";
    - a `Badge` from `useByState`: `expired` → `danger` "Scaduto", `due_soon` → `warning` "In scadenza", `ok` → none;
    - meta "· CD", or "· tu" for the reader's own batch;
    - for owner and admin only: "Costo 53,52 € · 1,73 € a porzione", or "Costo incompleto: manca il prezzo di un ingrediente" (never "0,00 €");
    - a text link "Etichetta" to `/produzione/[id]/etichetta`.
  - "Mostra altri" (`secondary`) when `nextCursor` is set. Empty state: "Nessuna produzione registrata."
  - A waiter (403) sees one `ErrorAlert`: "La produzione non è disponibile per il tuo ruolo."
- **`/produzione/nuova`** (`page.tsx`, `production-form.tsx`, `input-row.tsx`): one page in four bordered sections, each enabled once the previous one is filled.
  1. **"Ricetta":** a `Field` `Select` of the active batch recipes (`GET /api/recipes?type=batch`).
  2. **"Quantità prodotta":** `Field` "Quantità prodotta" (`inputmode="decimal"`, prefilled with the recipe output) with the unit as a suffix ("kg"); a `secondary` `Button` "Calcola" → `GET /api/batches/proposal`.
  3. **"Ingredienti usati":** one bordered block per input (`input-row.tsx`), in the server's order:
     - the name in bold; "Proposto 5,1667 kg"; "In giacenza: Cella (demo) 6 kg";
     - `Field` "Usato" (`inputmode="decimal"`, prefilled with the proposal, 0 allowed) and `Field` "Unità" (`Select` of `units`);
     - `Field` "Ubicazione" (`Select`, prefilled with `suggestedLocationId`), only when there are two or more `locations`;
     - `Field` "Lotto" (`Select`): "Primo in scadenza (consigliato)" by default, then the lots at the chosen location with their expiry word ("L-D2 · scade il 25/10/2026 · 3 kg");
     - for `isStock: false`: the muted line "Non a magazzino: non viene scaricato", and no fields.
  4. **"Lotto prodotto":**
     - `Field` "Porzioni" (`inputmode="numeric"`, prefilled with `portionsComputed`) with the hint "Calcolate: 31 (0,2 kg a porzione, arrotondate per difetto)";
     - `Field` "Conservazione (ore)" (prefilled; on change the proposal is fetched again for `useByPreview`);
     - the line "Da consumare entro il 26/10/2026, 10:12 (indicativo)";
     - `Field` "Ubicazione del lotto", only when there are two or more locations.
  - The **one primary** `Button` "Registra produzione" (44 px). On 201 → `/produzione/[id]/etichetta?nuovo=1`.
  - Errors appear in an `ErrorAlert` above the button, in Italian; the input named in `details` gets `aria-invalid` and its message:
    - `recipe_version_stale`: "La ricetta è stata modificata: ricalcola la proposta.";
    - `lot_empty`: "Il lotto scelto è vuoto in questa ubicazione.";
    - `input_missing` and `input_not_in_recipe`: "Gli ingredienti non corrispondono alla ricetta: ricalcola la proposta.";
    - `inputs_empty`: "Indica almeno un ingrediente usato.";
    - `portions_invalid`: "Indica un numero di porzioni da 1 a 10.000.";
    - `unit_mismatch`: "Unità non compatibile con l'ingrediente.".
- **`/produzione/[id]/etichetta`** (`page.tsx`, `label-text.tsx`):
  - With `?nuovo=1`: a `SuccessNote role="status"` "Produzione registrata: lotto 261023-SPEZZA-1.". If the POST response (kept in the page state) listed `negatives`, a `warning` note per item: "Manzo muscolo (demo) in Cella (demo) è ora negativo: −0,3 kg. Fai un conteggio o approva la fattura mancante." (values from the response).
  - `Heading` "Etichetta", then a bordered block (`label-text.tsx`; a narrow column like a 62 mm label; Figtree; black on white in both themes) with six lines:
    - "Spezzatino (demo)"
    - "Prodotto: 23/10/2026 10:12"
    - "Da consumare entro: 26/10/2026 10:12"
    - "Porzioni: 31"
    - "Lotto: 261023-SPEZZA-1"
    - "Operatore: CD"
  - A muted note: "Testo da riportare sull'etichetta. La stampa arriverà con la stampante (fase 2)."
  - A link "Torna alla produzione".
- **Wording helpers** (pure, `src/lib/batches/batch-view.ts`): `labelLines(label, locale)` (uses `formatDateTime` in Europe/Rome, without its comma on the label), `useByBadge(state)`, `canProduce(role)`, `canReadBatchCosts(role)`, `portionsHint(...)`. Every string has an English entry.
- **Navigation:**
  - `OwnerNav` gains "Produzione" (`/produzione`) for owner, admin and chef (`canProduce`), hidden for the waiter and while the role is unknown;
  - `isCurrent` marks it on `/produzione` and below; the home card gets the same link;
  - the M12 history (`operation-row.tsx`) shows "Produzione" for `refType 'batch'` (§3.1.15).

### 3.6 Flows

1. **Proposal:** `/produzione/nuova` → `GET /api/recipes?type=batch` → pick → `GET /api/batches/proposal?recipeKey&outputQty` → `batch_proposal` → `app.batch_requirements` → the form is prefilled.
2. **Produce:** "Registra produzione" → `POST /api/batches` → `produce_batch` → validation → stock locks (id order) → the engine per input (FEFO, shortfall, contained alert) → lot lock → sequence → `batch` → `batch_input` → `batch_cost` → `produce` movement → commit → 201 → label page.
3. **List:** `/produzione` → `GET /api/batches` → `batch_list` (+ `batch_costs` for owner/admin).
4. **Label:** `/produzione/[id]/etichetta` → `GET /api/batches/:id/label` → `batch_label`.
5. **Stock side:** `/magazzino/[ingredientId]` shows the consumption as "Produzione", through the unchanged M12 reads.

### 3.7 Secrets and configuration

| Name | Public? | Where it lives | Used by M14 |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public by design (existing) | Vercel env | session client of every M14 route (RLS and role checks apply) |
| `SUPABASE_SECRET_KEY` | **private** (existing) | Vercel env, server-only | **not used by M14 code**; only the existing integration fixture helper reads the local stack's key |
| `CRON_SECRET`, Vault values, `ANTHROPIC_API_KEY`, `EXTRACTION_MODEL_ID` | existing | Vercel env / Supabase Vault | not touched |
| Account logins (Vercel, Supabase, GitHub) | private | the account owner's password manager with MFA; never in the repo or DigiAlto-Ops | humans |

No new secret, third-party key or provider. Nothing leaves Supabase (EU).

### 3.8 Fixtures (fake only; `tests/fixtures/batches/` shared by pgTAP comments, integration and e2e)

- Tenant A, location "Cella (demo)" (and "Dispensa (demo)" in the multi-location cases).
- Ingredients: "Manzo muscolo (demo)" kg, "Cipolla (demo)" kg, "Carota (demo)" kg, "Sale grosso (demo)" kg (never bought), "Acqua (demo)" l (`is_stock` false).
- Prices: beef 10,00 €/kg ×3 (basis 10); onion 1,00 ×3; carrot 1,00 ×3.
- Lots at Cella: beef `L-D2` 3 kg (expiry D+2) and `L-D5` 3 kg (D+5); onion `L-CIP` 2 kg; carrot `L-CAR` 2 kg.
- Recipes:
  - "Soffritto (demo)" (sub): output 1 kg; onion 0,6 kg, carrot 0,4 kg.
  - "Spezzatino (demo)" (batch) v1: output 6 kg, 30 portions, 72 h; beef 5 kg (yield 1), Soffritto 0,5 kg, water 1 l.
  - "Brodo (demo)" (batch): output 5 l, 20 portions, 48 h; onion 0,2 kg, salt 30 g (no price, so an incomplete cost).
  - "Spezzatino di manzo (demo)" (batch): output 3 kg, 15 portions, 72 h; beef 2,5 kg (same lot code `SPEZZA`).
- Expected stew at 6,2 kg: beef **5,1667**, onion 0,31, carrot 0,2067, water 1,0333 (non-stock); portions **31**.
- AT1/AT5 confirmed inputs: beef 5,3, onion 0,31, carrot 0,2067 → total **53,5167 €**; per portion (31) **1,7263 €**.
- Tenant B: one location, one ingredient, one batch recipe (isolation cases).
- Race fixture: each case builds its own recipe, ingredients and lots inside its database copy.

### 3.9 Contract for M13, M15, M16, M19, M31

- **M13** (`check_ledger_invariants`):
  - every `batch` has exactly one `produce` movement equal to `portions_initial`;
  - every `batch_input` mirrors its movement (also enforced by `batch_input_guard`);
  - every consumption row with `ref_type 'batch'` has a `batch` with that id;
  - the reconciliation identity counts these rows as `consumption`.
- **M15:**
  - replaces `batch_movement_m14_ck` with the shapes of `consume`, `count`, `waste`, `split` and reversals;
  - changes `state` only through its procedures (the guard allows only `state`);
  - values discards at `batch_cost.unit_cost_frozen`;
  - a split creates a batch with `split_from_batch_id` and a new lot code through `app.lock_batch_lot` + `app.next_lot_seq` (lock order: any stock locks before the lot lock).
- **M16:** batch expiry state from `app.use_by_state`; remaining portions from `v_batch_portions`.
- **M19:** depletes portions FEFO by `use_by` with `batch_movement` type `consume`; order cost from `batch_cost.unit_cost_frozen`; batch negatives use `negative_stock` with `entity_type 'batch'` (M12 contract).
- **M31:** forward trace through `batch_input (tenant_id, raw_lot_id)`; backward trace through `batch_input` → `raw_lot` → supplier.

## 4. Alternatives considered

- **Insert `batch` first, then consume:** rejected for the test seam only. Writing the consumptions first, with a pre-generated id, makes "a fault after the consumption movements" a real point to inject at (AT3). Atomicity is the same either way.
- **A separate counter table for lot sequences (`UPDATE … RETURNING`):** rejected. It is mutable state beside the ledgers, needs its own RLS and fixture rows, and adds nothing that an advisory lock, `max + 1` and a unique index do not give.
- **A Postgres `SEQUENCE` per recipe:** rejected. Sequences are not transactional (a rolled-back production would burn a number) and are not per day.
- **A sequence keyed by `recipe_key` with the code derived from the name:** rejected. Two recipes sharing a 6-character prefix would print the same lot code on the same day. Keying by the printed code is "per recipe" whenever codes differ and never duplicates.
- **`use_by = produced_at + interval 'N days'` or wall-clock arithmetic:** rejected for the base plan. Shelf life is stored in hours, and food-safety time is elapsed time. Kept as V1.
- **Recomputing the batch cost from the recipe (M8 `recipe_cost_at`) at read time:** rejected by ADR-008 and the PRD ("a batch made before a price increase keeps its old cost"), and because the actual inputs differ from the recipe.
- **Cost columns on `batch` with a chef-hiding view:** rejected by ADR-003 (split table) and Q16 = project V6.
- **Explicit quantities per lot from the chef:** rejected for the base plan (more taps; M12's "start from this lot" covers the common case). V7.
- **Refusing production when recorded stock is short:** rejected by plan §3.6 rule 8 (the food was cooked; refusing would hide the error). V8 adds a confirmation instead.
- **Expanding sub-recipes in TypeScript:** rejected. `produce_batch` must validate the inputs inside its transaction, and M8 set the rule "one SQL engine" (M8 §4).
- **A path-enumerating recursive CTE for the expansion:** rejected after M7's measurement (W^L rows on diamond graphs). Per-round aggregation is polynomial.
- **Reading batches only through RLS views (no definer reads):** possible, because batches carry no €. Rejected for consistency with M12 (role check first, names joined, one round trip, a waiter gets 42501 rather than empty lists), and because the label needs the producer's initials, which the chef cannot read from `app_user` directly.
- **Taking the recipe-graph lock in `produce_batch`:** rejected (§3.1.11). The batch pins an immutable version and the expansion is one snapshot; the lock would serialise every production with every recipe save for no gain in correctness.

## 5. Build plan (test first; one commit per step; `tdd-guide` follows the order)

**Test conventions** (as M12):
- pgTAP sets claims with `set_config('request.jwt.claims', …)`. Fixtures (lots, receipts, prices, recipes) are inserted as the migration owner, as `031` and `093` do.
- Core cases call `app.*` functions as the migration owner with an explicit tenant, user and `p_at`. Public functions are called under owner, admin, chef or waiter claims.
- "D" = `app.venue_date(now(), 'Europe/Rome')`. Errors are asserted as `SQLSTATE message` (the `pg_temp.err` pattern of `044`).

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| 1 | Migration: batch types, tables, view, guards, append-only triggers, RLS, grants; fixture rows for the new tables in `004` and `059` | `supabase/migrations/20261028100000_batch_tables.sql`, `supabase/tests/database/120_batch_tables.test.sql`, `supabase/tests/database/004_waiter_cost_columns.test.sql` and `059_cost_roles_v6.test.sql` (fixture rows for `batch`, `batch_input`, `batch_movement`, `batch_cost`; `059`'s "chef reads no row of any cost table" list gains `batch_cost`: deliberate extensions, not weakened tests) | `120`. **Enums:** `batch_state` = `fresh, open, finished, discarded`; `batch_movement_type` = `produce, consume, count, waste, split`. **Shapes** (direct inserts as the owner): a `consume` movement → 23514 (`batch_movement_m14_ck`); `produce` with `portions` 0 or −1 → 23514; a second `produce` for the same batch → 23505; `ref_id` ≠ batch → 23514; a `lot_code` not matching date, code and seq → 23514; two batches with the same lot code → 23505; `use_by` ≠ `produced_at` + 72 h → 23514; `portions_initial` 0 → 23514; an incomplete `batch_cost` with a total → 23514. **`batch_guard`:** a `recipe_id` of another key, or of a `sub` key → `batch_recipe_mismatch`; `update batch set state = 'open'` (owner) → allowed; `update batch set portions_initial = 30` → `batch_immutable`; DELETE → `append_only`. **`batch_input_guard`:** a row whose movement has another lot, ingredient, location or `ref_id`, or `qty ≠ −row.qty` → `batch_input_mismatch`; a mirror row → accepted. UPDATE/DELETE/TRUNCATE on `batch_input`, `batch_movement`, `batch_cost` → `append_only`. **RLS:** chef A reads the batch, input and movement rows and `v_batch_portions` (31); chef A reads **0** `batch_cost` rows (Q16 = project V6); admin A and owner A read `batch_cost`; waiter A reads 0 rows of all of them; owner B reads none of A's. **Grants:** `authenticated` has no INSERT/UPDATE/DELETE on the four tables. `001`, `004`, `059` green |
| 2 | Migration: helpers (lot code, use-by, use-by state, portions, initials, requirement expansion) | `supabase/migrations/20261028100100_batch_helpers.sql`, `supabase/tests/database/121_batch_helpers.test.sql` | `121`. **`lot_recipe_code`:** "Spezzatino (demo)" → `SPEZZA`; "Ragù" → `RAGU`; "Caffè è" → `CAFFEE`; "(*)" → `RIC`; "Brodo (demo)" → `BRODOD`. **AT6 `batch_use_by`:** (`2027-03-26T19:00Z`, 72) → `2027-03-29T19:00Z`, and `to_char(… at time zone 'Europe/Rome', 'DD/MM/YYYY HH24:MI')` = `29/03/2027 21:00`; (`2027-03-27T23:30Z`, 24) → `2027-03-28T23:30Z` (Rome `29/03/2027 01:30`); (`2026-10-24T22:30Z`, 24) → `2026-10-25T22:30Z` (Rome `25/10/2026 23:30`); each repeated under `set local timezone = 'Europe/Rome'` and `'America/New_York'` with the same result (T1). **`use_by_state`:** use_by = now → `expired`; now + 23 h → `due_soon`; now + 24 h → `due_soon`; now + 25 h → `ok`. **AT2 `batch_portions`:** (6.2, 6, 30) → 31; (6.19, 6, 30) → 30; (0.1, 6, 30) → 0. **`initials`:** "Chef Demo" → `CD`; "anna maria rossi bianchi" → `AMR`; "" → `?`. **AT2 `batch_requirements`:** stew v1 → beef 5, onion 0.3 and carrot 0.2 (through the sub: 0.5 ÷ 1 × 0.6 and × 0.4), water 1; `round(5 × 6.2 ÷ 6, 4)` = **5.1667**; a line of `500 g` → 0.5; yield 0.82 on 5 kg → 6.0975609…; the same ingredient direct and through a sub → summed; a diamond (batch → subs S1 and S2 → both use S3 with 1 kg onion) → onion counted twice, one row; a chain of 13 nested subs → P0001 `recipe_not_producible` detail `graph_too_deep`; a sub whose only version has `valid_from` after `p_at` → `recipe_not_producible` detail `sub_not_in_force`; a 12 × 12 ladder completes with one row per ingredient (no path explosion; runtime asserted < 2 s with `clock_timestamp()`). No API role can execute any function of this migration |
| 3 | Migration: batch core (role helpers, lot lock, sequence, `produce_batch_core`) with the AT5 cost cases | `supabase/migrations/20261028100200_batch_core.sql`, `supabase/tests/database/122_batch_core.test.sql`, `supabase/tests/database/124_batch_cost.test.sql` | `122` (core as the migration owner, tenant A, chef user, fixed `p_at`). **AT1:** stew v1, output 6.2, inputs beef 5.3, onion 0.31, carrot 0.2067 → beef rows `L-D2 −3` and `L-D5 −2.3` (Σ −5.3, not −5.1667), `ref_type 'batch'`, `ref_id` = the batch id; one `batch` (`portions_computed 31`, `portions_initial 31`, `state fresh`, `recipe_version 1`); four `batch_input` rows, **one per movement** (beef 2, onion 1, carrot 1), each mirroring its movement's lot and quantity; `v_batch_portions` = 31; one `produce` movement +31 with `effective_on` = the Rome date of `p_at`. **Override:** beef `lotId L-D5` → `L-D5 −3`, `L-D2 −2.3`. **qty 0:** carrot 0 → no carrot movement or input, and `pg_locks` of the test's own transaction holds no advisory lock with the carrot's stock key (`hashtext(tenant \|\| carrot)`) while it holds the beef and onion ones. **Validation (nothing written in each case):** `input_missing` (carrot absent), `input_duplicate`, `input_not_in_recipe` (salt in the stew), `inputs_empty` (all 0), water as an input → `ingredient_not_stock`, `ml` on beef → `unit_mismatch`, a `sub` recipe id → `recipe_not_batch`, an inactive key → `recipe_inactive`, version 1 after version 2 exists → `recipe_version_stale`, output 0, 100001 or 1.23456 → `output_invalid`, portions 0 or 10001 → `portions_invalid`, shelf life 0 → `shelf_life_invalid`, 101 inputs or a non-object element → `inputs_invalid`; each input error's detail names the ingredient. **Portions:** `p_portions` 30 → `portions_initial 30`, `portions_computed 31`; output 0.1 without `p_portions` → `portions_invalid`. **Shelf life:** override 48 → `use_by` = `p_at` + 48 h. **AT4:** two productions of the stew on the same Rome day → `…-SPEZZA-1`, `…-SPEZZA-2`; "Spezzatino di manzo (demo)" the same day → `-3` (shared printed code); the next Rome day → `-1`. **AT6:** `p_at 2027-03-27T23:30Z` (00:30 on 28 March in Rome) → `lot_date 2027-03-28`, lot `270328-SPEZZA-1`, `use_by 2027-03-30T23:30Z` (72 elapsed hours; Rome `31/03/2027 01:30`); `p_at 2027-03-26T19:00Z` → `use_by 2027-03-29T19:00Z` (Rome 21:00); `p_at 2026-10-24T22:30Z` → lot `261025-…`. **Shortfall:** beef 7 with 6 kg on hand → `L-D2 −3`, `L-D5 −3`, unlotted −1; its `batch_input` row has `raw_lot_id` null; one `negative_stock` alert (entity beef, audience `{owner,chef}`); with `negative_stock` deleted from `app.alert_kind` inside the test, the batch still commits and one `app.alert_refusal` row names the caller `produce_batch`; the result lists `negatives: [{beef, Cella, −1}]`. **Lock order (source checks, the `076` technique):** in `app.produce_batch_core`, `app.lock_ingredient_stock(` appears once and before the first `app.post_stock_outflow(`, and `app.lock_batch_lot(` after the last `app.post_stock_outflow(`. **Return shape:** keys exactly as §3.2 core step 15; no key matches `/eur\|cost\|price\|value\|amount/i`. `124` (**AT5**): the AT1 batch → `batch_cost.total_cost 53.5167`, `unit_cost_frozen 1.7263`, `incomplete false`, `cost_at` = `p_at`; a fourth beef purchase at 20,00 inserted and `set_ingredient_cost_basis(last_price)` (owner claims) → the row is identical (`to_jsonb` before and after), and a **new** batch freezes the new basis; "Brodo (demo)" (salt never bought) → `total_cost` null, `unit_cost_frozen` null, `incomplete` true, `missing_ingredient_ids` = {salt}; a shortfall row's cost is included at the same basis; `p_cost_at` = `p_at`: a price with `effective_on` D+1 is not used for a batch at D |
| 4 | AT3 fault injection (one transaction) | `supabase/tests/database/123_batch_atomic.test.sql` | `123`. A test-only `before insert` trigger raising `fault_injected` on, in turn: `batch` (right after the consumption movements), `batch_input`, `batch_cost`, `batch_movement`. For each: `produce_batch` (chef claims) raises `fault_injected`; afterwards there is **no** `stock_movement` with `ref_type 'batch'`, no `batch`, `batch_input`, `batch_cost` or `batch_movement` row; the lot buckets equal their values before the call; and no `negative_stock` alert from the call (a shortfall input is included, so an alert would have been raised). **Mid-way engine error:** inputs beef 5.3 (consumed first, by id order) and onion with an override lot that is empty → `lot_empty`, and no beef row remains. The trigger is dropped at the end of each case |
| 5 | Migration: public `batch_proposal`, `produce_batch` | `supabase/migrations/20261028100300_batch_procedures.sql`, `supabase/tests/database/125_batch_procedures.test.sql` | `125` (chef A claims unless stated). **AT2 (proposal):** stew, `outputQty 6.2` → `inputs` beef `proposedQty 5.1667`, onion 0.31, carrot 0.2067, water `isStock false` 1.0333; `portionsComputed 31`, `portionSize 0.2`; default output (null) → 6 and 30; beef `lots` in the order `L-D2`, `L-D5` with `expiryState`; `suggestedLocationId` = Cella; with Dispensa active and beef only at Cella → beef suggests Cella and the batch location suggestion is null; `useByPreview` = `now()` + 72 h (±1 s). **Proposal keys:** no key matches the cost pattern at any depth; P0002 for tenant B's key. **AT1 (public):** the AT1 inputs → the §3.2 shape; `created_by` and `produced_by` = the chef; `produced_at` = the transaction time. **Admin A and owner A:** both succeed. **Waiter A:** 42501 from both, nothing written. **Tenancy:** owner B with A's recipe id → P0002. **Grants:** `anon` and `service_role` cannot execute either |
| 6 | Migration: reads `batch_list`, `batch_label`, `batch_costs`; `059` function list | `supabase/migrations/20261028100400_batch_reads.sql`, `supabase/tests/database/126_batch_reads.test.sql`, `supabase/tests/database/059_cost_roles_v6.test.sql` (the cost-named function list gains `batch_costs`, which the chef calls and gets 42501: a deliberate extension of the scan) | `126`. **list:** newest first; `portionsRemaining` = `v_batch_portions`; `useByState` from `app.use_by_state`; `byInitials` `CD`, and `byMe` true for the chef's own; `p_recipe_key` filters; `p_limit` 2 → a cursor whose next page continues without gap or repeat; `p_limit` 0 or 101 → `invalid_request`; no cost key. **label:** keys exactly `batchId, recipeName, version, producedAt, useBy, portions, lotCode, operatorInitials, shelfLifeHours`; the recipe name of the **pinned** version after a rename in version 2; A's batch for owner B → P0002 `batch_not_found`. **costs:** owner → `53.5167`, `1.7263`, false; "Brodo" → nulls and `incomplete` true; admin allowed; chef and waiter → 42501; 101 ids → `too_many_ids`; tenant B's ids → no row. **Key scan:** the JSON keys of sample `batch_list` and `batch_label` calls contain no cost-like name. `059` green with the new name |
| 7 | AT7 role catalogue | `supabase/tests/database/127_batch_roles.test.sql` | `127`. **Waiter A:** 42501 from `batch_proposal`, `produce_batch`, `batch_list`, `batch_label`, `batch_costs`; 0 rows from `batch`, `batch_input`, `batch_movement`, `batch_cost`, `v_batch_portions`. **Chef A:** proposal, produce, list and label succeed; `batch_costs` → 42501; **0 rows from `batch_cost`** (Q16 = project V6, which replaces the base-plan wording of AT7); `insert into` `batch`, `batch_input`, `batch_movement`, `batch_cost` → 42501; UPDATE/DELETE → 42501. **Admin A, owner A:** all five functions allowed; direct INSERT → 42501. **No claims:** 42501 everywhere. **anon / service_role:** no EXECUTE on the five functions |
| 8 | Guard: M14 preserves M8 and M12 | `supabase/tests/database/128_m14_preserves.test.sql` | `128`: exactly one definition each of `app.post_stock_outflow`, `app.lock_ingredient_stock`, `public.reverse_movement`, `app.raise_alert`, `app.try_raise_alert`, `public.approve_invoice` (no overload); `public.reverse_movement` on a batch consumption row → `movement_not_reversible`; the `app.alert_kind` rows are unchanged (the kind string of `044`/`072` is not edited); `075`, `076` and `098` run **unchanged**. PR grep: `grep -lE "create or replace function (app\.post_stock_outflow\|app\.lock_ingredient_stock\|public\.reverse_movement\|app\.raise_alert\|app\.try_raise_alert\|public\.approve_invoice\|app\.ingredient_unit_costs)" supabase/migrations/20261028*` returns nothing |
| 9 | Two-session race cases | `scripts/test-db-races.sh` (header comment and three cases), `supabase/tests-native/races_fixture.sql` (unchanged unless a shared id is needed; each case inserts its own recipe, ingredients and lots into its database copy) | CI job `db-races`; every existing case unchanged and green. **`produce-lot-seq`:** a recipe with beef and onion, lots of each; s1 (chef) produces with beef 1, onion 0 and parks; s2 (owner) produces with beef 0, onion 1 → `s2_blocked` 1 and `s2_advisory` 1 (the lot lock; no shared stock lock); after the gate both commit, with lot codes `…-1` (s1) and `…-2` (s2); 2 distinct lot codes. Run once during the build with `MIGRATIONS_DIR` pointing at a copy whose `app.lock_batch_lot` is a no-op → s2 fails with 23505 on `batch_lot_code_uq` (proves the case detects the race; recorded in the PR). **`produce-same-lot`:** beef has one lot of 2 kg; s1 and s2 each produce with beef 1,5 → s2 waits on the stock lock; afterwards: lot bucket 0, unlotted −1, s2's `batch_input` has two beef rows (0,5 with the lot, 1,0 without), exactly one `negative_stock` alert, lot codes `-1` and `-2`. **`produce-crossed-inputs`:** a recipe with ingredients A < B (by id); s1 sends inputs `[B, A]` and parks; s2 sends `[A, B]` → waits on an advisory lock; both commit; `no_deadlock` holds |
| 10 | Batch domain in TS: constants, types, schemas, output schemas, error map, view helpers, i18n | `src/server/batches/{constants,types,schemas,output,errors}.ts`, `src/lib/batches/batch-view.ts`, `src/lib/api/errors.ts` (`ErrorCode` gains the M14 codes), `src/lib/i18n/messages/{it,en,keys}.ts`, `tests/server/batches/{schemas,output,errors}.test.ts`, `tests/lib/batches/batch-view.test.ts` | `schemas.test.ts`: strict bodies and queries (unknown key → 400); `qty` with 5 decimals rejected; 0 allowed only in inputs; 101 inputs rejected; `unit` enum; uuids; the cursor shape. `output.test.ts`: `batchItem`, `batchProposal`, `produceResult` and `batchLabel` declare no key matching `/eur\|cost\|price\|margin\|value\|amount/i` (walks the Zod shape); `batchItemWithCost` adds exactly the `cost` object. `errors.test.ts`: every code of §3.4 → its status and Italian message; `details` passed through with `ingredientId` only; 23505 with `batch_lot_code_uq` → 409 `lot_code_conflict`; an unknown SQLSTATE → 500 with no text. `batch-view.test.ts` (**AT6 in TS**): `labelLines` for `producedAt 2027-03-26T19:00:00Z`, `useBy 2027-03-29T19:00:00Z` → "Prodotto: 26/03/2027 20:00", "Da consumare entro: 29/03/2027 21:00"; `2026-10-24T22:30:00Z` → "25/10/2026 00:30"; English lines; `useByBadge`: three states → tone and word; `canProduce`: owner, admin, chef true, waiter and unknown false; `canReadBatchCosts`: owner, admin true, chef, waiter and unknown false; `portionsHint(31, 0.2, 'kg')` → "Calcolate: 31 (0,2 kg a porzione, arrotondate per difetto)" |
| 11 | API: proposal and produce | `src/server/batches/{proposal,produce}.ts`, `src/app/api/batches/proposal/route.ts`, `src/app/api/batches/route.ts` (POST), `tests/app/api/batches/proposal.test.ts`, `tests/app/api/batches/produce.test.ts` | Fake session client. `proposal.test.ts`: owner, admin, chef → 200; waiter → 403 **before any RPC**; no session → 401; unknown parameter → 400; `?recipeKey=<k>&outputQty=6.2` → RPC `batch_proposal` once with `{p_recipe_key, p_output_qty: 6.2, p_shelf_life_hours: null}`; the reply mapped (the AT2 values 5.1667 and 31 pass through unchanged); an extra `unit_cost` field injected in the fake reply does not reach the JSON; P0002 → 404; `recipe_not_producible` → 422. `produce.test.ts`: owner, admin, chef → 201; waiter → 403 before any RPC; `text/plain` → 415; a body over 16 KiB → 413; an extra key → 400; the AT1 body → RPC `produce_batch` once with `{p_recipe_id, p_output_qty: 6.2, p_inputs: [...], p_portions: null, p_shelf_life_hours: null, p_location: null}`; `recipe_version_stale` and `lot_empty` → 409; `input_missing` with a detail → 422 with `details: [{ingredientId}]`; 23505 on `batch_lot_code_uq` → 409; the response passes the strict schema and the key scan |
| 12 | API: list and label | `src/server/batches/{list,label}.ts`, `src/app/api/batches/route.ts` (GET), `src/app/api/batches/[id]/label/route.ts`, `tests/app/api/batches/list.test.ts`, `tests/app/api/batches/label.test.ts` | `list.test.ts`: chef → 200 with **one** RPC (`batch_list`), no `cost` key in any item, and JSON with no `€` and no cost-pattern key; owner and admin → `batch_list` then `batch_costs` with the page ids, `cost` merged by id (`{totalEur: 53.5167, perPortionEur: 1.7263, incomplete: false}`; incomplete → nulls); waiter → 403 before any RPC; a bad cursor → 400. `label.test.ts`: chef → 200 with the label keys only; a malformed id → 404 without an RPC; P0002 → 404; waiter → 403 |
| 13 | Real-stack integration suite | `tests/integration/batches.int.ts`, `tests/integration/helpers/batches.ts` (`seedStewRecipe`, `seedBatchFixture`, through the owner's API and `approveWithLots`) | **AT2:** chef `GET /api/batches/proposal` → beef 5.1667, portions 31. **AT1:** chef `POST /api/batches` with beef 5.3 → 201; secret-key read: Σ `stock_movement.qty` for beef with `ref_id` = the batch id = −5.3; `v_batch_portions` = 31; the `batch_input` rows mirror the movements. **AT3:** a POST whose onion input names an empty lot → 409 `lot_empty`, and no beef movement with `ref_type 'batch'` was added (count before = after). **AT4:** two sequential POSTs → `-1`, `-2`; then two **concurrent** POSTs (`Promise.all`, chef and owner) → `{-3, -4}`, distinct, no 409. **AT5:** owner `GET /api/batches` → `cost.totalEur` 53.5167; the owner approves a beef invoice at 20,00; the same batch is still 53.5167; a new batch freezes the new basis. **AT7:** chef `from('batch_cost').select()` → 0 rows; chef `from('batch').insert(...)` → permission error; chef `GET /api/batches` has no `cost`; waiter → 403 on the four routes and 42501 on the RPCs. **Shortfall:** beef beyond stock → 201 with `negatives`, and the chef's `GET /api/alerts` lists "Scorta negativa: Manzo muscolo (demo)". **Tenancy:** owner B → 404 for A's recipe and for A's batch label; B's list is empty |
| 14 | Production screen | `src/app/(owner)/produzione/nuova/{page,production-form,input-row}.tsx`, i18n catalogues, `tests/components/{production-form,input-row}.test.ts` | `renderToStaticMarkup` with fixture props. `input-row.test.ts`: the name, "Proposto 5,1667 kg", the "In giacenza" line; "Usato" `inputmode="decimal"` prefilled with 5.1667; the unit select lists exactly `units`; the location select only with ≥ 2 locations, prefilled with `suggestedLocationId`; the lot select starts at "Primo in scadenza (consigliato)" and lists the lots at the chosen location with their expiry words; `isStock false` → "Non a magazzino: non viene scaricato" and no fields; `aria-invalid` and the message when the error `details` name this ingredient; a `<script>` name is escaped. `production-form.test.ts`: four labelled sections; "Porzioni" prefilled with 31 and the hint; one primary button "Registra produzione"; the `ErrorAlert` texts for `recipe_version_stale`, `lot_empty`, `inputs_empty`; the use-by line shows the server's `useByPreview` formatted, with no date arithmetic (a fixture with an inconsistent preview is shown as given); the markup contains no `€` |
| 15 | Batch list, label screen, navigation, stock history word, UI note | `src/app/(owner)/produzione/{page,batch-row}.tsx`, `src/app/(owner)/produzione/[id]/etichetta/{page,label-text}.tsx`, `src/app/(owner)/owner-nav.tsx`, `src/app/page.tsx`, `src/lib/nav/is-current.ts`, `src/lib/stock/stock-view.ts` (`movementTypeWord` gains `refType`), `src/app/(owner)/magazzino/[ingredientId]/operation-row.tsx`, `docs/design/ui-foundation.md` (§8 line for M14), `tests/components/{batch-row,label-text,owner-nav,operation-row}.test.ts`, `tests/lib/nav/is-current.test.ts`, `tests/lib/stock/stock-view.test.ts` | `batch-row.test.ts`: the lot code, the produced and use-by lines in Europe/Rome, "31 porzioni · rimaste 31", "(calcolate 30)" only when they differ, the badges for `expired` and `due_soon`, "· tu" vs initials; with `cost` → "Costo 53,52 € · 1,73 € a porzione"; incomplete → "Costo incompleto…" and never "0,00 €"; without `cost` (chef) → no `€` in the markup. `label-text.test.ts` (**AT6 UI**): the six lines for the DST fixture ("Da consumare entro: 29/03/2027 21:00"); a `<script>` recipe name escaped. `owner-nav.test.ts`: "Produzione" for owner, admin and chef; hidden for the waiter and an unknown role; the existing tabs unchanged. `is-current.test.ts`: current on `/produzione`, `/produzione/nuova` and `/produzione/x/etichetta`; no cross-match. `stock-view.test.ts` and `operation-row.test.ts`: `consumption` with `refType 'batch'` → "Produzione", with `refType 'manual'` → "Consumo"; batch rows show no "Annulla" (the server's `reversible` is false) |
| 16 | Playwright: production at 360 px and 1280 px | `e2e/batches.spec.ts`, `e2e/helpers/seed-recipe.ts` (the owner creates "Spezzatino (demo)" 6 kg, 30 portions, 72 h, beef 5 kg through `POST /api/recipes`), `e2e/helpers/seed-invoice.ts` (unchanged; lots through its existing `lotCode`/`expiry` options) | **360 × 740.** The owner approves into "Cella (demo)" beef lots `L-D2` 3 kg (D+2) and `L-D5` 3 kg (D+5) at 10,00 €/kg and seeds the recipe. **Chef:** "Produzione" tab present → "Nuova produzione" → recipe "Spezzatino (demo)" → "Quantità prodotta" 6,2 → "Calcola" → beef "Proposto 5,1667 kg", "Porzioni" 31 (**AT2 UI**) → "Usato" 5,3 → "Registra produzione" → the label page with "Produzione registrata: lotto {YYMMDD}-SPEZZA-1." (YYMMDD from `venueDate(new Date())`), "Porzioni: 31", "Operatore: CD"; `/magazzino/{beef}` shows a total of 0,7 kg, `L-D2` gone, `L-D5` 0,7 kg, and "Produzione" in the history (**AT1 UI**); a second production with output 1,2 and beef 1 → lot `…-2` (**AT4 UI**) and the note "…è ora negativo: −0,3 kg…"; the chef's pages contain no `€` (**Q16 UI**). **Owner:** `/produzione` shows the first batch with "Costo 53,00 € · 1,71 € a porzione"; after approving a beef invoice at 20,00 €/kg the same row still says 53,00 € (**AT5 UI**). **Waiter:** no tab; `/produzione` shows "La produzione non è disponibile per il tuo ruolo." (**AT7 UI**). `expectPhoneFriendly` on the three screens for owner and chef, light and dark, with the form fully open. **1280 × 800:** content stays within the page column |

**Acceptance tests → proof**

| AT (plan §5a.2 M14) | Files (step) | Command |
|---|---|---|
| 1 Stew → beef reduced by exactly the confirmed 5,3 kg (not the proposal) and 31 portions, in one transaction | `122` (3), `125` (5), `produce.test.ts` (11), `batches.int.ts` (13), `batches.spec.ts` (16); atomicity `123` (4) | `npx supabase test db`; `npm test`; `npm run test:integration`; `npx playwright test` |
| 2 Proposal 5,1667 kg (4 dp); portions 6,2 ÷ 0,2 = 31 | `121` (2), `125` (5), `proposal.test.ts` (11), `batches.int.ts` (13), `production-form.test.ts` (14), `batches.spec.ts` (16) | as AT1 |
| 3 Fault after the consumption movements → no batch, no movement, no batch_input | `123` fault triggers and mid-way `lot_empty` (4), `batches.int.ts` mid-way `lot_empty` (13) | `npx supabase test db`; `npm run test:integration` |
| 4 Two stew batches on one day → `…-1`, `…-2` | `122` (3), races `produce-lot-seq` with its no-op control and `produce-same-lot` (9), `batches.int.ts` sequential and concurrent (13), `batches.spec.ts` (16) | as AT1, plus `scripts/test-db-races.sh` |
| 5 A price change after production does not change `batch_cost` | `124` (3), `126` (6), `list.test.ts` (12), `batches.int.ts` (13), `batch-row.test.ts` (15), `batches.spec.ts` (16) | as AT1 |
| 6 use_by across the 2027-03-28 DST change is correct in Europe/Rome | `121` incl. session-time-zone independence (2), `122` (3), `batch-view.test.ts` (10), `label-text.test.ts` (15) | `npx supabase test db`; `npm test` |
| 7 The waiter cannot execute `produce_batch` or read `batch_cost`; the chef reads **no** `batch_cost` (Q16 = project V6 replaces "chef can read") | `120` and `004` (1), `125` grants (5), `126` and `059` (6), `127` (7), route tests (11, 12), `batches.int.ts` (13), `owner-nav.test.ts` (15), `batches.spec.ts` (16) | as AT1 |
| Q16 = project V6: the chef never sees € in M14 | `120` (1), `126` and `059` (6), `127` (7), key scans in `output.test.ts` (10) and `list.test.ts` (12), `batches.int.ts` (13), `production-form.test.ts` (14), `batch-row.test.ts` (15), `batches.spec.ts` (16) | as AT1 |
| Invariants: balances derived; append-only; single transaction; `tenant_id` + RLS; roles in Postgres; no data logic in React; secret key unused; no model ID | `001`, `004`, `059`, `031` green; `120` (1); `123` (4); `128` (8); component tests (14, 15); the existing lint test `admin-client-import.test.ts` | `npx supabase test db`; `npm test`; `npm run lint` |

**CI implications:**
- pgTAP `120`–`128` run in the existing `supabase` job and in `scripts/test-db-native.sh`. No shim change: no cron, net or Vault use, and advisory locks are core Postgres.
- Three race cases join `db-races`.
- `004` and `059` change deliberately (fixture rows, the cost-table list, the cost-function list). `044`, `060`, `072`, `075`, `076` and `098` are unchanged.
- No new CI secret and no external service. Coverage ≥ 80 % on new TS.

### 5b. Variants

**V1 — Use-by keeps the same clock time across a clock change** · Trigger: Q40 answered "a 72-hour stew made Friday at 20:00 is due Monday at 20:00 even when the clocks change" · Replaces steps: the `batch_use_by` rule of 2 and its DST vectors in 2, 3, 10 and 15; the `batch_use_by_ck` constraint of 1

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V1.1 | `app.batch_use_by(p_at, p_hours, p_tz)` = `((p_at at time zone p_tz) + make_interval(hours => p_hours)) at time zone p_tz`; `batch_use_by_ck` dropped (the elapsed time is no longer constant) and replaced by an insert check in `app.batch_guard` that `use_by` equals that function with the tenant zone | `supabase/migrations/<ts>_use_by_wall_clock.sql`, `121_batch_helpers.test.sql`, `122_batch_core.test.sql`, `120_batch_tables.test.sql` | (`2027-03-26T19:00Z`, 72, Rome) → `2027-03-29T18:00Z` (Rome 20:00); (`2026-10-24T18:00Z`, 72, Rome) → `2026-10-27T19:00Z` (Rome 20:00); the same under any session time zone; a 24 h shelf life from 2027-03-28 00:30 Rome → 2027-03-29 00:30 Rome; `120`: a `use_by` that differs from the function → `batch_use_by_mismatch` |
| V1.2 | TS label and list follow (server values only) | `tests/lib/batches/batch-view.test.ts`, `tests/components/label-text.test.ts` | The DST fixture shows "Da consumare entro: 29/03/2027 20:00" |

**V2 — A short lot code chosen per recipe** · Trigger: Q41 answered "we want our own short code per recipe (e.g. SPZ)" · Replaces steps: the `<recipe>` part of the lot code in 2 and 3 (adds a field to the recipe screens)

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V2.1 | `recipe_key.lot_prefix text` (`^[A-Z0-9]{2,6}$`, unique per tenant, null allowed); `public.set_recipe_lot_prefix(p_key, p_prefix)` (owner, admin, chef; audited); `produce_batch_core` uses `coalesce(lot_prefix, app.lot_recipe_code(name))` | `supabase/migrations/<ts>_recipe_lot_prefix.sql`, `supabase/tests/database/129_lot_prefix.test.sql` (the spare M14 number) | Prefix `SPZ` → lot `261023-SPZ-1`; a duplicate prefix → 23505 mapped to `lot_prefix_taken`; waiter → 42501; without a prefix the derived code is used; one audit event per change |
| V2.2 | API `PATCH /api/recipes/:key/lot-prefix` and a "Codice lotto" field on the recipe page | `src/app/api/recipes/[key]/lot-prefix/route.ts`, `src/app/(owner)/ricette/[key]/page.tsx`, `tests/app/api/recipes/lot-prefix.test.ts`, `tests/components/recipe-facts.test.ts` | Strict body; 409 on a taken prefix; the field shows the current code |

**V3 — Extra ingredients at production** · Trigger: Q42 answered "the chef sometimes adds an ingredient that is not in the recipe" · Replaces steps: the `input_not_in_recipe` rule of 3 and its UI in 14

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V3.1 | `batch_input.is_extra boolean not null default false`; `produce_batch_core` accepts stock ingredients outside the requirements, marked extra, consumed and costed like the others | `supabase/migrations/<ts>_batch_extra_inputs.sql`, `122_batch_core.test.sql`, `124_batch_cost.test.sql` | Salt 0,02 kg added to the stew → one consumption, `batch_input.is_extra` true, the cost includes it (incomplete if unpriced); a non-stock extra → `ingredient_not_stock` |
| V3.2 | "Aggiungi ingrediente" (`secondary`) in the form, with a picker from `GET /api/ingredients` | `src/app/(owner)/produzione/nuova/production-form.tsx`, `tests/components/production-form.test.ts`, `e2e/batches.spec.ts` | The added row has the same fields; e2e: the extra ingredient is reduced in Magazzino |

**V4 — Portions may not exceed the computed number** · Trigger: Q43 answered "the chef may lower the portions but never raise them" · Replaces steps: the portions rule of 3 and the field of 14

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V4.1 | `produce_batch_core`: `p_portions > portions_computed` → P0001 `portions_above_computed` (422) | `supabase/migrations/<ts>_portions_cap.sql`, `122_batch_core.test.sql`, `src/server/batches/errors.ts`, `tests/server/batches/errors.test.ts` | With 31 computed: 32 → refused; 30 → accepted; the error mapped to "Le porzioni non possono superare quelle calcolate (31)." |
| V4.2 | The field gets `max = portionsComputed` from the proposal | `src/app/(owner)/produzione/nuova/production-form.tsx`, `tests/components/production-form.test.ts` | The `max` attribute equals the server value |

**V5 — Production registered later with its real time** · Trigger: Q44 answered "the chef often records the batch after it is made" · Replaces steps: the `produced_at = now()` rule of 3 and 5 (adds a field to 14)

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V5.1 | `produce_batch(..., p_produced_at timestamptz default null)`: null → now; not after now; not earlier than now − `PRODUCED_AT_MAX_BACK_HOURS` (24), else P0001 `produced_at_invalid`; the cost, the lot date and the use-by come from it | `supabase/migrations/<ts>_produced_at_back.sql`, `125_batch_procedures.test.sql`, `124_batch_cost.test.sql` | 3 h ago → `produced_at`, `use_by` and lot date from it; the cost basis at that instant; 25 h ago and 1 min ahead → refused |
| V5.2 | A "Prodotto alle" field (time, default now) in section 4 | `src/server/batches/schemas.ts`, `src/app/(owner)/produzione/nuova/production-form.tsx`, `tests/server/batches/schemas.test.ts`, `tests/components/production-form.test.ts` | The schema accepts an ISO instant; the field is labelled and optional |

**V6 — One ingredient taken from two storage places** · Trigger: Q45 answered "yes, for example beef from the cold room and from the freezer in the same batch" · Replaces steps: the `input_duplicate` rule of 3 and the one-location input row of 14

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V6.1 | `input_duplicate` only for the same (ingredient, location); `input_missing` checks ingredients, not locations | `supabase/migrations/<ts>_inputs_per_location.sql`, `122_batch_core.test.sql` | Beef 3 at Cella + 2,3 at Dispensa → two outflows and one `batch_input` row per resulting movement; the same location twice → `input_duplicate` |
| V6.2 | "Aggiungi ubicazione" on an input row | `src/app/(owner)/produzione/nuova/input-row.tsx`, `tests/components/input-row.test.ts` | A second location sub-row with its own quantity and lot fields |

**V7 — Exact quantities per lot** · Trigger: Q46 answered "the chef wants to say exactly how much came from each lot" · Replaces steps: the "start from this lot, then FEFO" input rule of 3 and the lot select of 14

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V7.1 | An input may carry `lots: [{lotId, qty}]` instead of `lotId`; each lot's bucket must cover its qty (else P0001 `lot_insufficient`, 409); then one engine call per lot with that override and qty; any remainder of the input's total via FEFO | `supabase/migrations/<ts>_input_lot_quantities.sql`, `122_batch_core.test.sql`, `src/server/batches/{schemas,errors}.ts`, `tests/server/batches/{schemas,errors}.test.ts` | `L-D5` 3 + `L-D2` 2,3 → exactly those rows; `L-D5` 4 with 3 on hand → `lot_insufficient`, nothing written |
| V7.2 | Per-lot quantity fields under an input | `src/app/(owner)/produzione/nuova/input-row.tsx`, `tests/components/input-row.test.ts` | One labelled field per lot with stock |

**V8 — Confirm before recording a production with less recorded stock than used** · Trigger: Q47 answered "ask the chef to confirm when stock looks short" · Replaces steps: none (adds a parameter in 5 and a confirmation in 14; with the confirmation, production behaves as in the base plan)

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V8.1 | `produce_batch(..., p_confirm_shortfall boolean default false)`: when an input exceeds its location total and the flag is false → P0001 `insufficient_stock` (409) with `details [{ingredientId, onHandQty}]`, checked after the stock locks and before any write | `supabase/migrations/<ts>_confirm_shortfall.sql`, `125_batch_procedures.test.sql` | Beef 7 with 6 on hand, no flag → 409, nothing written; with the flag → the base-plan result with the shortfall and the alert |
| V8.2 | The 409 shows "In magazzino risulta meno di quanto hai usato." and a second tap "Registra comunque" resends with the flag | `src/server/batches/{schemas,errors}.ts`, `src/app/(owner)/produzione/nuova/production-form.tsx`, `tests/components/production-form.test.ts`, `e2e/batches.spec.ts` | The confirmation step renders; e2e: the second tap records the batch and the negative note appears |

**V9 — Portions rounded to the nearest whole portion** · Trigger: project Q19 answered "round to the nearest portion" · Replaces steps: the `batch_portions` rule of 2 and the hint wording of 10

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V9.1 | `app.batch_portions` = `round(p_output * p_ppb / p_recipe_output)` (half away from zero) | `supabase/migrations/<ts>_portions_nearest.sql`, `121_batch_helpers.test.sql`, `125_batch_procedures.test.sql` | (6.19, 6, 30) → 31; (6.09, 6, 30) → 30; (6.1, 6, 30) → 31 (30,5 rounds up) |
| V9.2 | Hint "arrotondate all'intero più vicino" | `src/lib/batches/batch-view.ts`, `tests/lib/batches/batch-view.test.ts` | The hint text matches |

## 6. Risks and mitigations

- **Security / privacy**
  - *Definer functions bypass RLS:* every public M14 function checks the role first, uses an empty `search_path`, takes the tenant from `app.tenant_id()`, filters every query by it, and is executable by `authenticated` only. The `app.*` helpers have no API grant (steps 2–7). Foreign recipes, lots and batches return P0002, never another tenant's data; composite foreign keys stop cross-tenant rows (step 1).
  - *€ reaching the chef (Q16 = project V6) or the waiter:*
    - `batch_cost` has owner/admin RLS only and is in `059`'s cost-table list (step 1);
    - `batch_costs` checks `require_cost_reader` and is in `059`'s function list (step 6);
    - the quantity functions and their API shapes have no cost key (steps 3, 5, 6, 10–12);
    - the chef's list path never calls `batch_costs` (step 12);
    - string scans for `€` in components and e2e (steps 14–16); `004` covers the waiter (step 1).
  - *Input injection:* the inputs JSON is parsed by strict Zod and again by strict SQL shape checks (unknown keys refused, 100 elements at most, 16 KiB body). Names are rendered as text (escaping tests in 14 and 15).
  - *Personal data:* staff ids on rows (as every ledger); initials only on screens and labels; no free text on a batch; logs carry SQLSTATEs and ids only (step 10). Retention follows the ledgers (project Q14). No new processor.
  - *IDOR:* malformed or foreign ids → 404, before or from the tenant-filtered lookups (steps 5, 6, 11, 12).
  - *CSRF:* writes require `application/json` (`withApi`).
- **Correctness**
  - *Partial production:* one function call; four fault points and a mid-way engine error are proved to leave nothing (step 4).
  - *Deadlocks:* all stock locks in one sorted call before any outflow, and the lot lock last (source checks in 3, race `produce-crossed-inputs` in 9). M13's `close_count` and M15's procedures must follow the global order of §3.1.11.
  - *Duplicate lot codes:* advisory lock + `max + 1` + unique index, proved with a no-op-lock control run (step 9). The counter is keyed by the printed code, so a shared 6-character prefix never duplicates.
  - *DST:* `make_interval(hours => …)` only; vectors on both 2026-10-25 and 2027-03-28, and independence from the session time zone (step 2).
  - *Stale proposal:* the batch pins the version id; a newer version → 409 and "ricalcola la proposta" (steps 3, 14).
  - *Recorded stock short at production:* recorded as a shortfall with an alert (rule 8). The lot balances stay true and the unlotted line asks for a count (M12, ADR-011).
  - **Known limit: a wrong production cannot be undone in M14.** M15 adds adjust and discard. Until then the owner corrects raw stock with M12 waste and reversals; batch consumption rows are refused by `reverse_movement` (step 8).
  - **Known limit: receipts are not serialised with production** (inherited from M12: `approve_invoice` takes no stock lock). A production during an approval may record a shortfall that the receipt then covers.
  - *A long transaction holding many stock locks:* at most 100 ingredients, one venue; the locks are transaction-scoped and released at commit.
  - *Sub-recipe versions:* resolved at `produced_at`. A sub changed seconds before production is used as it was in force then (one snapshot).
- **Unverified (checked in the named step):**
  - **T1** `timestamptz + interval` adds a days field as calendar days in the session time zone, while hours are elapsed time; `make_interval(hours => n)` has no days field ([PostgreSQL date/time operators](https://www.postgresql.org/docs/current/functions-datetime.html); the documentation's CST7CDT example contrasts `+ interval '1 day'` with `+ interval '24 hours'`). Proved by the session-time-zone cases of `121` (step 2).
  - **T2** an advisory lock + `max + 1` in a new statement under READ COMMITTED gives consecutive sequences ([advisory locks](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS), [READ COMMITTED](https://www.postgresql.org/docs/current/transaction-iso.html#XACT-READ-COMMITTED)). Proved by `produce-lot-seq` and its control run (step 9).
  - **T3** the engine's stock lock is re-entrant inside `produce_batch` (M12 T2, already proved); re-checked by `produce-same-lot` (step 9).
- **Performance / cost:** one venue; one production is one expansion (≤ 13 rounds) plus one indexed outflow per input. No figure is promised. No provider or running cost.
- **Dependencies:** none added.
- **Plan changes to record in DigiAlto-Ops `clients/osteria-dei-rossi/context.md`:**
  - §5a.2 M14 AT7: the chef part reads "the chef reads **no** `batch_cost`" (Q16 = project V6, already decided).
  - §3.5.1 `batch`: adds `recipe_key`, `recipe_id`, `lot_date`, `lot_recipe_code`, `lot_seq`, `portions_computed`, `shelf_life_hours`, `created_by`; `state` is the only mutable column (M15).
  - §3.5.1 `batch_input`: adds `ingredient_id`, `location_id`, `stock_movement_id`; `raw_lot_id` nullable (shortfall).
  - §3.5.1 `batch_movement`: adds `effective_on`; M14 allows `produce` only.
  - §3.5.2 `batch_cost`: adds `incomplete`, `missing_ingredient_ids`, `cost_at`.
  - §3.5.3: `produce_batch(recipe_id, output_qty, inputs, portions?, shelf_life_hours?, location?)`; new reads `batch_proposal`, `batch_list`, `batch_label`, `batch_costs`.
  - The global lock order gains the batch lot lock, last.
  - Contracts for M13, M15, M16, M19 and M31 (§3.9). ADR-013 added.

## 7. Open questions for the founder (defaults in force for this build)

**Already decided and applied:**
- **Q16 = project V6 (founder 2026-10-23): the chef never sees €.** The M14 acceptance test 7 in the project plan says "chef can read `batch_cost` (base plan)". It predates your decision, and your decision replaces it: owner and admin read the batch cost; the chef and the waiter do not. Not reopened.
- **M12 Q1 (founder 2026-10-23):** DigiAlto support (admin) may record stock operations like the owner and the chef. M14 applies the same rule to production.
- **Project Q19 (portion rounding) is still open, and its proposed default is in force:** rounded down to a whole portion; the chef can change the number before confirming. Rounding to the nearest portion → V9.

- **Q40 Use-by when the clocks change.** Shelf life is stored in hours.
  - **Default in force:** real elapsed hours. A 72-hour stew made on Friday 26 March 2027 at 20:00 is due on Monday 29 March at 21:00 (the clocks go forward on Sunday). In late October the same stew would be due at 19:00.
  - **Alternative:** keep the same clock time, Monday 20:00 in both cases (→ V1).
- **Q41 The recipe part of the lot code.**
  - **Default in force:** the first 6 letters of the recipe name, without accents, in capitals ("Spezzatino" → `SPEZZA`, lot `261023-SPEZZA-1`). Two recipes starting with the same 6 letters share the day's counter, so a code is never repeated.
  - **Alternative:** a short code you choose per recipe, e.g. `SPZ` (→ V2).
- **Q42 May the chef add an ingredient that is not in the recipe** when producing (for example extra salt)?
  - **Default in force:** no. Only the recipe's ingredients, each with the quantity really used (0 if not used). A lasting change goes through a new recipe version.
  - **Alternative:** yes, marked as "extra" on the batch (→ V3).
- **Q43 Portions above the computed number.**
  - **Default in force:** the chef may enter any whole number from 1 to 10.000; the computed number stays recorded beside it.
  - **Alternative:** only the computed number or fewer (→ V4).
- **Q44 Time of production.**
  - **Default in force:** the moment the chef taps "Registra produzione". It sets the lot date, the use-by and the cost date.
  - **Alternative:** the chef may enter an earlier time, up to 24 hours back (→ V5).
- **Q45 One ingredient from two storage places in the same batch** (for example beef from the cold room and from the freezer)?
  - **Default in force:** one storage place per ingredient per batch, pre-filled with where the first-expiring stock is.
  - **Alternative:** several places per ingredient (→ V6).
- **Q46 Choosing lots.**
  - **Default in force:** the app takes the first-expiring lot. The chef may say "start from this lot", and the rest follows first-expiring order (as in Magazzino).
  - **Alternative:** the chef enters the exact quantity taken from each lot (→ V7).
- **Q47 Producing with less recorded stock than used.**
  - **Default in force:** recorded anyway (the food was cooked), with the missing quantity shown "senza lotto" and one "Scorta negativa" alert to you and the chef.
  - **Alternative:** the chef confirms first with "Registra comunque" (→ V8).

**Assumptions (confirm; a different answer means a re-plan, not a variant):**
- **A1:** sub-recipes inside a batch (e.g. a soffritto) are made fresh for that batch, so their raw ingredients are consumed at production. A sub-recipe kept in stock would have to become a batch recipe (M7 Q4).
- **A2:** the lot date is the calendar date in Italy when the batch is made (a batch at 00:30 carries the new date), not the business day.
- **A3:** the label shows the portions at production. A reprint after a split or adjustment (M15) shows the new figures.
- **A4:** ingredients marked "not in stock" (e.g. water) appear in the proposal but are never deducted.
- **A5:** if a recipe is changed while the chef is filling in a production, the chef recalculates the proposal before confirming.

**Linked project questions:** Q14 (retention: do the ledgers, batches included, follow the 10-year invoice retention?).

**Technical, resolved inside the build:** T1–T3 (§6).

## 8. Manual steps for the founder

- **None are needed to build, test or merge M14.** Migrations reach staging through the existing CI deploy job.
- Before the chef produces with real data, the batch recipes must exist with output, portions and shelf life (project Q2; M7 Q7 "no real data until you say so").
- Answer Q40–Q47 (and project Q19) when convenient. Each different answer triggers the named variant as a follow-up PR.

## 9. Sources

- Worktree `/home/user/osteria-m14` on `79b15d9`: the files listed in §2; `docs/prd.md` (Goal 2, 2.2, Traceability and labelling, Module 2 acceptance, Risks); the project plan; the M7, M8 and M12 plans; ADR-002, ADR-003, ADR-007, ADR-008, ADR-011; `docs/client-facts.md`; `docs/design/ui-foundation.md`; pgTAP `004`, `059`, `093`; `scripts/test-db-races.sh`; `src/lib/time/{format,venue-date}.ts`.
- PostgreSQL documentation (core features; no dependency added):
  - date/time operators (`timestamptz + interval`, days vs hours across DST): <https://www.postgresql.org/docs/current/functions-datetime.html>. The page could not be fetched from this environment; the behaviour was confirmed through [search results quoting the documentation's CST7CDT example](https://www.postgresql.org/docs/9/functions-datetime.html) and the [design discussion that introduced it](https://postgrespro.com/list/thread-id/1662705). T1 is proved by `121`;
  - advisory lock functions: <https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS>;
  - READ COMMITTED: <https://www.postgresql.org/docs/current/transaction-iso.html#XACT-READ-COMMITTED>.
