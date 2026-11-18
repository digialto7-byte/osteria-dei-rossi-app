# Tech plan: Costì / Osteria Digitalization · Avvio magazzino (opening stock)

- **Status:** draft for the lead · **Author:** architect · **Date:** 2026-11-18
- **Repo and branch:** `osteria-dei-rossi-app`. This plan is on `docs/opening-stock-plan` (from `main` `372c8ffa`). The build is one
  `/feature` run on `feat/opening-stock` from `main`, delivered as **five PRs** (§5). Each PR stays a draft until `code-reviewer` passes.
- **Founder need (2026-11-18, via the lead):** a venue that starts on the app already has stock. Owners enter opening quantities per
  ingredient × location with a unit cost, so stock and food cost are right from day one.
- **Screen spec:** `docs/ux/avvio-magazzino.md` on `main` `8f31eebb` (205 lines), cited as **"spec"**. This plan follows the merged version,
  not the draft of PR #196. The merged spec books **one location per call** (spec §2 step 3, §7.2), groups the draft by location (§3.1),
  and puts the rows of a reversed operation **back into the draft** (§5, §7.6, §7.8). This session had no shell, so `origin/main` could not
  be merged into the worktree. The spec was read from the copy the coordinator saved, and it is cited by its path on main.
- **Lead rulings applied:** the approved design (the six points of the brief); O1 (no lots and no expiry alerts for carico stock); O2
  (opening allowed per location only until that location's first closed count); O3 (the opening cost is used only while no invoice price
  exists, never averaged); O4 (AVT unchanged, plus a runbook line); O5 (base units only).
- **Client facts used:** none. Every fixture is fake: "Osteria Demo A", "Osteria Demo B", "Dispensa (demo)", "Frigo 1 (demo)",
  "Farina 00 (demo)", "Mozzarella (demo)", "Fornitore X (demo)", users on `example.test`. Quantities and prices are invented.
- **Inputs read:**
  - this repo's `CLAUDE.md` (rule 6 invariants);
  - the SP1 plan (`docs/plans/2026-11-15-sp01-tenant-config.md`) and the P2-4 plan (`docs/plans/2026-11-18-p2-4-alert-rules.md`) for format
    and pin practice;
  - ADR-033;
  - every migration cited in §2;
  - pgTAP `056`, `080`, `090`, `094`, `096`, `114`, `119`, `128`, `139`, `194`, `222`, `229`, `240`, `280`, `290`, `327`, `342`, `359`, `362`;
  - `src/server/stock/*`, `src/server/costing/*`, `src/server/today/*`, `src/lib/nav/today-actions.ts`, `src/lib/api/offline-cache.ts`,
    `tests/config/*-preserves.test.ts`.
- **How main was read:** with file tools only, so no `git log`. The newest migration on `main` is
  `20261206200400_tenant_locale_settings.sql` (SP1). The newest pgTAP is `396_sp1_preserves.test.sql`. P2-4 (ratified, not built) reserves
  `20261206210000`–`210900` and pgTAP `397`–`406`. **Where the brief and the code differ, the code wins.** §9 lists every difference.
- **ID scheme:**
  - steps **0–25**, in PRs **PR1–PR5**;
  - variants **V1–V7**; open questions **Q1–Q15**; risks **R1–R11**;
  - acceptance tests **AT1–AT9** (§1);
  - **G** = the golden test of purchases, AVT, payables, reconciliation and invoiced costs;
  - **X** = the cross-tenant suite on Demo A/B;
  - unverified technical assumptions **T1–T2** (§6), each proved in a named step.

---

## 0. Summary

A venue's stock on day one becomes a dated, costed, reversible **opening operation** per location. It is a new ledger movement type, not
an invoice, a lot or a count.

1. **[MIGRATION] Movement type `opening`.** It is added in its own migration. Its shape CHECK: `qty > 0`, `unit_cost` not null and ≥ 0,
   `raw_lot_id` null, no reason, `ref_type 'opening'`, and `reverses_id` only on mirror rows (`ref_type 'reversal'`, `qty < 0`). Reversal
   rows go through the existing mirror guard.
2. **[MIGRATION] Append-only `public.stock_opening`** (one row per booked operation) and a **deletable draft table
   `public.opening_draft_line`** (drafts are not ledger). Both have `tenant_id` and RLS for owner and admin. Both join the demo purge list.
3. **[MIGRATION] `public.post_opening_stock(location, effective_on, request_id, lines)`.** It books one location in one transaction:
   - it goes through the new `app.require_opening_writer()` (owner and admin; chef and waiter get 42501);
   - the lines are strict, in the base unit, with the cost in EUR per base unit net of VAT;
   - only `is_stock` ingredients of the tenant; one line per ingredient; at most 200 lines;
   - the lines must **equal the location's draft**, which the procedure then deletes;
   - one `opening` movement per line, with the cost frozen;
   - one audit row, `stock.opening_posted`, holding counts and the total value only;
   - idempotent on `request_id` (a double tap).
4. **Cut-off (O2).** Allowed for a location only while it has **no closed `count_session`**. It is **also refused while a count is open** at
   that location, because a count snapshots the expected quantity and would book the carico twice (§9 item 3). The same rule applies to
   draft writes, additions and reversals. Raised as P0001 codes and pinned in pgTAP.
5. **Effective date.** The owner chooses it. It must not be after today's business date, not after the location's first receipt (the
   invoice date of its earliest `receipt` movement), and not more than 366 days back.
   - It is stored in `stock_movement.effective_on` and in `stock_opening.effective_on`; `created_at` stays the posting instant.
   - **The reconciliation reads opening rows by `effective_on`**, like receipts, and folds them into its `openingQty` (step 11). Every
     other report keeps ADR-033's `created_at` rule.
   - **Why:** the carico is a dated statement ("this was the stock on 1 Dec"), exactly why receipts keep the invoice date. ADR-033 names
     "a writer that must record a back-dated movement" as its revisit trigger (`adr-033:22`).
6. **Correction by reversal.** The new `public.reverse_opening_stock(opening, reason)` reverses a **whole operation**:
   - mirror rows with the same `unit_cost` and the negated qty, dated with the original's date;
   - the reason is audited;
   - the same rows go **back into the draft**, as spec §5 asks;
   - the cut-off applies, so a reversal is refused after the location's first count (recommended default, Q5).
   - **`public.reverse_movement` is not changed**: it has no reason parameter and is open to the chef. The lead's literal design is
     **V1** (Q2).
7. **[MIGRATION] Cost fallback.** `app.ingredient_unit_costs` uses the `unit_cost` of the latest non-reversed opening movement in force,
   **only when the ingredient has no `price_history` row in force**. The first invoice price then wins outright, with no blending.
   - Recipe costing, the outflow cost stamp, count adjustments, the sale freeze and the AVT valuation inherit it.
   - `costSource` (`invoice | opening | null`) is derived server-side for the cost APIs.
   - G proves that the costs of invoiced ingredients do not change.
8. **API** under `/api/stock/opening/*`: `GET` the draft, `PUT` and `DELETE` draft lines, `POST` confirm, `GET` history, `POST` reverse.
   Strict Zod, owner and admin, roles enforced in Postgres, never offline-cacheable.
9. **Runbook (§3.12):** "do a count right after the carico" (O4: the AVT needs an opening count).

**Eight migrations, `20261206220000`–`20261206220700`, for the lead to ratify (Q1).** `220800`–`220900` stay free for review fixes. §5
marks each one **[MIGRATION]**. pgTAP numbers are **407–416**.
- The range sorts after P2-4's `2026120621*` and before SP2's reserved `20261207100000`.
- No guard claims `2026120622*`: `sp1-preserves.test.ts:80` claims `20261206200*`, `ds-bq2-preserves.test.ts:21` claims `2026120610*`,
  and P2-4's planned `p24-preserves` claims `2026120621*`.
- **Merge order:** P2-4's migrations before ours, ours before SP2. Otherwise **V6**.

**Draft-store recommendation: keep it, and keep it small** (one table and four procedures, §3.4). The spec needs a draft shared between
devices (§2 step 2, §7.8) and restored from a reversal (§5). A browser-only draft can do neither. The alternative is **V5**; the lead
decides (Q8).

**Flags for the lead (read first)**
1. **Reversal path (deviation from brief item 3).** `public.reverse_movement(uuid)` cannot carry what an opening reversal needs:
   - a reason (spec §5);
   - owner/admin only (it uses `require_stock_writer`, which admits the chef: `20261026100400_stock_core.sql:27–36`, called at
     `20261026100500_stock_procedures.sql:191`);
   - the cut-off;
   - the draft restore.

   The plan therefore adds `reverse_opening_stock` and leaves `reverse_movement` byte-for-byte unchanged. It already refuses
   `ref_type 'opening'` (`:202`), so no reverse pin moves. **V1** is the literal "reverse_movement learns opening".
2. **Open count = refused** (new, from the code, §9 item 3). Without it, an opening posted while a count is open is counted twice.
3. **Reconciliation needs a change** (§9 item 2). Today an `opening` row would land in `otherQty` ("Altri movimenti") on the **posting**
   day (`20261127100000_raw_stock_business_date.sql:54–55, 58, 61`). Step 11 folds it into `openingQty` by `effective_on`. **V4** is a
   separate column instead.
4. **AVT is safe only because of O2** (§9 item 1). The AVT's "actual" is minus the sum of **every type except receipt and transfer**
   (`20261112100400_avt_report.sql:54`), so an opening row inside an AVT window would read as stock appearing. The cut-off keeps every
   opening row and every opening reversal before the location's first closed count, and every AVT window starts after a closed monthly
   count, so none can fall inside. Step 7 asserts it and G pins it.
5. **Duplicate ingredient per operation.** The brief says "no duplicates". The spec offers "Riga separata" (two rows, two prices; §3.4).
   The base plan refuses duplicates in the draft and in the post, and the screen offers "Somma" only. **V2** allows them (Q3).
6. **Daily counts close the window too.** O2 says "first closed count". `count_session.type` is `daily | monthly`
   (`20261027100000_count_tables.sql:15`), and a daily count lists only critical ingredients. **V3** limits the cut-off to monthly counts
   (Q4).

---

## 1. Goal and scope

**Goal:** the owner, or DigiAlto as admin, enters what the venue holds on its first day: where it is and what it cost. Balances,
recipe costs and the reconciliation are then right from that day. Mistakes are corrected by reversal until the location's first count.

**In scope**
- Movement type `opening`, its shape CHECK, and the reconciliation fold.
- `public.stock_opening` (append-only) and `public.opening_draft_line` (draft), with RLS, the purge list and audit actions.
- Procedures:
  - `post_opening_stock`;
  - `opening_draft`, `opening_draft_put`, `opening_draft_remove`, `opening_draft_clear`;
  - `opening_history`, `opening_stock_summary`;
  - `reverse_opening_stock`.
- The cost fallback in `app.ingredient_unit_costs`; `costSource` in `GET /api/costs/ingredients` and in the recipe cost lines.
- `/api/stock/opening/*` routes; the `opening` word in the Magazzino history; the Home step "Carica il magazzino iniziale".
- The screen `/magazzino/avvio` (phone and laptop, paste preview, confirm, correct). UI-only; Builder 2 may own PR5.
- G, X, race cases, Playwright, ADR-048 (number to confirm, Q11), a dated note in ADR-033, and the runbook lines of §3.12.

**Out of scope**
- Lots, lot codes and use-by dates on carico stock; expiry alerts for it (O1). `raw_lot` is untouched.
- Units other than the base unit in SQL (O5). The screen converts g→kg and ml→l before sending (spec §3.4).
- Any change to purchases, payables, AVT quantities, `approve_invoice`, `post_stock_outflow`, the count procedures and
  `public.reverse_movement` (V1 changes the last).
- A per-location cost. Costs stay per ingredient and tenant-wide (§3.7).
- Ingredient creation: the screen reuses `POST /api/ingredients` (owner, admin; `src/app/api/ingredients/route.ts:15–16`) and the
  existing allergen flag.

**Acceptance tests (this plan's own)**
- **AT1 Booking.** The owner books Dispensa with 3 lines. Results:
  - one `stock_opening` row and 3 `opening` movements (unlotted, frozen unit cost, `effective_on` = the chosen date, `ref_type 'opening'`);
  - Dispensa's draft is empty, and other locations' drafts are untouched;
  - one `stock.opening_posted` audit row with `{lines: 3, total_value_eur}`;
  - the balances include the quantities.
- **AT2 Roles.** Chef and waiter get 42501 from SQL on every new procedure and 403 from every route, before any RPC. Admin may do
  everything the owner may.
- **AT3 Cut-off.** For a location with a closed count, or with an open count: post, draft write, addition and reversal are refused with
  `opening_location_counted` / `opening_count_open`. Another location of the same tenant is still allowed.
- **AT4 Date.** Refused: a date after today's business date, after the location's first receipt date, or more than 366 days back. The
  first receipt's own date is allowed.
- **AT5 Reversal.** One call mirrors every row of the operation (same null lot, same unit cost, negated qty, the original's
  `effective_on`). The rows return to the draft. The reason is audited. A second reversal → `already_reversed`. The rebooked operation
  gives the corrected balances.
- **AT6 Cost.**
  - Before any invoice, the ingredient costs the carico's unit cost (`costSource 'opening'`).
  - After its first approved invoice, it costs the invoice price exactly (`'invoice'`), with no blending in the moving average.
  - Frozen sale costs and batch costs from before do not change.
- **AT7 Unchanged.** G: purchases, AVT, payables, reconciliation without openings, and the costs of invoiced ingredients equal their
  values on `main`.
- **AT8 Tenancy.** B can neither read nor write A's openings, drafts or history. B's carico never changes A's costs.
- **AT9 Idempotency and races.** A double tap books once. Two devices confirming the same draft book once. A confirm racing `count_close`
  never books after the count's snapshot.

---

## 2. Current state (what exists today)

Line numbers are on the worktree at `372c8ffa`.

### 2.1 Ledger and lots

| What | Where (file:line) | Fact that matters |
|---|---|---|
| Movement type | `20261022140100_stock_ledger.sql:10`; `20261026100000_stock_movement_types.sql:6–9` | `receipt, consumption, waste, transfer, count`. The values were added in their own file because a value added inside a transaction cannot be used before commit; the CHECKs compare `type::text` (`:2–4`) |
| Ledger table | `20261022140100:50–81` | `qty <> 0`; `unit_cost numeric(12,4) check (>= 0)`, "EUR per base unit, frozen" (`:58–59`); `effective_on date not null` (`:65`); `created_at` default `now()` |
| Receipt shape | same file `:69–72` | receipt ⇒ `qty > 0`, lot, `ref_type 'invoice_line'`, `ref_id`, `unit_cost` not null, `reverses_id` null |
| Other shapes | `20261026100100_stock_movement_shapes.sql:17–35` | outflow sign (`:18–21`); reason only on waste (`:23–25`); every non-receipt has `ref_type ~ '^[a-z_]{1,40}$'` and `ref_id` (`:27–29`); transfer (`:31–33`); count with `ref_type in (count_session, reversal)` (`:34–35`) |
| Mirror guard | same file `:41–70` | a row with `reverses_id` must mirror its original (ingredient, location, lot, type, reason, `unit_cost`, `-qty`), and the original must not be a reversal; one reversal per row (`stock_movement_reverses_uq`, `20261022140100:83–84`) |
| Append-only | `20261022140100:112–117` | no UPDATE, DELETE or TRUNCATE |
| Who reads | `20261022140100:102–104` | `stock_movement` is readable by owner and admin only; `v_stock_on_hand` is a security-invoker view (`:122–127`) |
| Lots | `20261022140100:14–43` | `raw_lot.invoice_line_id uuid not null` (`:20`), `unique (tenant_id, invoice_line_id)` (`:33`): only an invoice creates a lot. Stock outside lots is the unlotted bucket (`raw_lot_id` null; `20261026100400_stock_core.sql:6–9`) |
| Stock is per location | `20261026100400:128–137` (`app.location_on_hand`) | sum of one ingredient's movements at one location |
| Stock lock | `20261026100400:43–56` | `app.lock_ingredient_stock(tenant, ids[])`, transaction advisory locks in id order. Global order: recipe graph → cost locks → stock locks (`:11–13`) |
| Roles | `20261026100400:16–36` | `require_stock_reader` and `require_stock_writer` = owner, admin, **chef** |
| Reversal | `20261026100500_stock_procedures.sql:167–263` | whole operation by `(ref_type, ref_id)`; refuses `receipt`, `count` and any `ref_type` other than `manual` and `transfer` (`:202`); mirrors are dated **today** (`:240–241`); `ref_type 'reversal'` with a fresh `ref_id` (`:248–251`); no reason, no audit |
| History read | `20261026100600_stock_reads.sql:95–189` | operations by `(ref_type, ref_id)`; `reversible` = `type not in (receipt, count) and ref_type in (manual, transfer)` (`:151`), so an opening shows as not reversible from Magazzino; no cost key; the chef reads it |

### 2.2 Cost

| What | Where | Fact |
|---|---|---|
| No cost on the ingredient | `20261021130100_location_ingredient.sql:18–38` | `is_stock`, `is_active`, levels; no price column |
| Ingredient creation | `src/app/api/ingredients/route.ts:15–22` | `POST`, owner and admin, plain insert behind RLS; plus `import_ingredients` (`20261021130300_master_import.sql`) |
| Prices come from invoices | `20261023110600_approve_invoice_variance.sql:283–323` | per received stock line: a `raw_lot` and a `receipt` movement with `unit_cost` (`:286–300`), a `price_history` row (`:304–310`), `supplier_item.last_price` (`:314–323`) |
| Cost engine | `20261023110100_ingredient_cost.sql:25–75` | `app.ingredient_unit_costs(tenant, ids, at)`: the basis (`moving_average` default or `last_price`, `:47–54`) over `price_history` rows in force (`effective_on <= venue date of at`, `:60–65`). With no row, `avg` is null, so **`unit_cost` is null** (`:43–44`). One md5 pin (pgTAP `128:243`) |
| Public reader | same file `:82–109` | `public.ingredient_costs(date)`, owner and admin (`require_cost_reader`, `20261023110000_cost_settings.sql:11–20`); returns `purchases_used` |
| Downstream: outflows | `20261026100400:172–215` | `post_stock_outflow` stamps the basis cost read once (`:215`), null without a purchase (`:172–173`) |
| Downstream: counts | `20261027100200_count_procedures.sql:287–299` | `count_close` reads `ingredient_unit_costs(…, null)` for its `count` rows; `app.post_count_adjustment` stores it, "null when unknown" (`20261027100100_count_core.sql:53–55`) |
| Downstream: recipes | `20261023110800_cost_review_fixes.sql:69–77`; `20261023110200_recipe_cost.sql:272–278` | `recipe_costs` and `recipe_cost_lines` mark lines incomplete on a null cost |
| Downstream: sale freeze | `20261130100300_weight_fire.sql:158–239` | stock ingredients take the cost from their `consumption` rows (`:197–202`), non-stock ones from `ingredient_unit_costs` (`:217–222`); incomplete when null (`:228–229`) |
| Downstream: AVT value | `20261112100400_avt_report.sql:71–74, 86` | `ingredient_unit_costs` at the closing count; `varianceEur` null when the cost is null |
| TS cost services | `src/server/costing/ingredients.ts:26–52`; `src/server/costing/recipe-cost.ts:39–69` | camelCase mappers over `ingredient_costs` and `recipe_cost_at` |

### 2.3 Counts and reports

| What | Where | Fact |
|---|---|---|
| Count session | `20261027100000_count_tables.sql:11–39` | `type in (daily, monthly)` (`:15`); `status in (open, closed, cancelled)` (`:16`); `closed_at`; one open session per location (`:38–39`) |
| Expected is a snapshot | `20261027101200_count_procedures_fixes.sql:140, 150–154` | `count_record_lines` takes the stock locks, then stores `expected_qty = location_on_hand` at entry time |
| Close posts counted − expected | `20261027100200_count_procedures.sql:240–318` | locks the session `for update` (`:264–266`), then the stock locks (`:285`), posts `counted − expected` (`:295–299`), audits `count_session.closed`. "A count is never reversed" (`:239`) |
| Reconciliation | `20261127100000_raw_stock_business_date.sql:14–98` | non-receipt rows by the business day of `created_at`, receipts by `effective_on` (`:58, :61`); a type it does not know goes to `otherQty` (`:54–55`); `openingQty` = everything before the period (`:47`). md5 pin `240:51` |
| AVT | `20261112100400_avt_report.sql:21–89` | window `created_at` in `(O.closed_at, C.closed_at]` between two closed monthly counts of the location (`:43–51`); actual = minus the sum of **every type except receipt and transfer** (`:54`) |
| KPI purchases | `20261112100200_kpi_report.sql:132–142` | `type = 'receipt'` by `effective_on` only |
| Payables | `20261024100100_payable_reads.sql:131, 205, 262`; `20261118100000_payable_list_range.sql:10` | read `public.payable`; never read `stock_movement` |
| Weekday consumption | `20261127100000:116–134` | `type = 'consumption'` only |
| Ledger date rule | `docs/adr/adr-033-ledger-business-date.md:12, 22`; column comment `20261127100000:158–159` | reports use the business day of `created_at`; receipts excepted. Revisit "a writer that must record a back-dated … movement" |
| Business date | `20261029100100_batch_action_helpers.sql:11` | `app.business_date(tenant, at)` (cut-off from tenant settings) |
| Location resolver | `20261022140400_approval_lines.sql:86–113` | given an id: an active location of the tenant, else `location_not_found`; null: the only active one, else `location_required` |

### 2.4 Audit, purge, TS, screens

| What | Where | Fact |
|---|---|---|
| Audit action CHECK | `20261204100300_import_xml_invoices.sql:29–47` (latest) | the union of all actions; pinned by `080:201–217` (sorted list) and `342:64` (count 44); `tests/config/check-constraint-union.test.ts` |
| Audit entity CHECK | `20261124100200_reservation_settings.sql:21–24` (latest) | pinned by `080:195–200` |
| Audit readers | `20261027100100_count_core.sql:148–157` | `require_audit_reader` = owner and admin, so money in `after` is allowed |
| Purge list | `20261204100200_invoice_vat_summary.sql:58` (latest `app.demo_purge_tables`) | 59 names. Completeness `194:8–17`; exclusion pins `222:8`, `229:8`, `240:10`; counts `280:175`, `290:252`, `359:95`, `362:132`; md5 `327:115`, `359:84, :94` |
| TS movement enum | `src/server/stock/output.ts:11` | strict `z.enum([receipt, consumption, waste, transfer, count])`: an `opening` row would make `GET /api/stock/movements` fail (500) |
| History word | `src/lib/stock/stock-view.ts:54`; `tests/lib/stock/stock-view.test.ts:42–78` | `movementTypeWord` |
| Reverse route | `src/app/api/stock/movements/[id]/reverse/route.ts:6–15` | owner, admin, chef → `reverse_movement` |
| Offline cache | `src/lib/api/offline-cache.ts:8–13` | four paths only; nothing under `/api/stock` |
| Home "Primi passi" | `src/lib/nav/today-actions.ts:115–122, 178–185`; `src/server/today/types.ts:15–24, 63–72` | six static steps; done-state keys from `public.today_counts()` via `/api/today` |
| Runbook | `docs/runbook.md` | no stock-onboarding section today |
| Newest files | migrations `20261206200400`; pgTAP `396`; P2-4 reserves `2026120621*`, `397–406`; SP2 `20261207100000` | **this plan: `2026120622*`, pgTAP `407–416`** |

---

## 3. Design

### 3.1 The movement type **[MIGRATIONS 1–2, steps 3–4]**

**M1 `20261206220000_stock_movement_opening_type.sql`**: only `alter type public.stock_movement_type add value 'opening';`. It is in its own
file for the reason M12 recorded (`20261026100000:2–4`). The enum order becomes `receipt,consumption,waste,transfer,count,opening`.

**M2 `20261206220100_stock_movement_opening_shape.sql`**: one CHECK, comparing `type::text` as M12 does:

```
constraint stock_movement_opening_ck check (
  (type::text <> 'opening' and coalesce(ref_type, '') <> 'opening')
  or (type::text = 'opening' and raw_lot_id is null and reason_code is null
      and unit_cost is not null and unit_cost >= 0
      and ((reverses_id is null and ref_type = 'opening' and qty > 0)
           or (reverses_id is not null and ref_type = 'reversal' and qty < 0))))
```

- The first branch also stops any other type from borrowing `ref_type 'opening'`.
- `reason_code is null` repeats `stock_movement_reason_ck`; `ref_id not null` comes from `stock_movement_ref_ck`.
- A mirror row must also pass `app.stock_movement_reversal_guard`: same ingredient, location, null lot, type, null reason and **equal
  `unit_cost`**; `qty = -original`.
- `unit_cost >= 0` allows a typed `0,00 €` (spec §3.4, "Merce senza costo"). Null is impossible: no silent default.
- Nothing else in `stock_movement` changes. Existing CHECKs, indexes and triggers stay as they are.

### 3.2 Data model **[MIGRATION 3, step 5]**

`20261206220200_stock_opening_tables.sql`

**`public.stock_opening`**: one row per booked operation. Its id is the `ref_id` of the operation's movements.
```
id            uuid primary key default gen_random_uuid()
tenant_id     uuid not null references public.tenant (id)
location_id   uuid not null
effective_on  date not null            -- the "Data del carico"
request_id    uuid not null            -- idempotency key of the confirm (a double tap)
line_count    integer not null check (line_count between 1 and 200)
created_at    timestamptz not null default now()
created_by    uuid not null
constraint stock_opening_tenant_id_id_uq unique (tenant_id, id)
constraint stock_opening_request_uq unique (tenant_id, request_id)
constraint stock_opening_location_fk foreign key (tenant_id, location_id) references public.location (tenant_id, id)
constraint stock_opening_created_by_fk foreign key (tenant_id, created_by) references public.app_user (tenant_id, id)
index stock_opening_location_idx (tenant_id, location_id, created_at desc)
```
- **Append-only:** the triggers `stock_opening_append_only` (`app.append_only`) and `stock_opening_no_truncate`
  (`app.append_only_truncate`), as on the ledger.
- The column is named `effective_on` (the brief said `effective_date`) so it matches `stock_movement`.
- The reversed state is **not stored**. It is derived from the ledger: a row of the operation has a mirror.
- The brief's columns (tenant, location, effective date, created_by, created_at) are all present. `request_id` and `line_count` are added
  for idempotency and history.

**`public.opening_draft_line`**: the draft. It is **not ledger**: rows are updated and deleted freely.
```
id            uuid primary key            -- generated by the client, so a PUT is an idempotent upsert
tenant_id     uuid not null references public.tenant (id)
location_id   uuid not null
ingredient_id uuid not null
qty           numeric(12,4) not null check (qty > 0 and qty <= 100000)
unit_cost     numeric(12,4) not null check (unit_cost >= 0 and unit_cost <= 100000)
created_at, updated_at  timestamptz not null default now()
created_by, updated_by  uuid not null
constraint opening_draft_line_tenant_id_id_uq unique (tenant_id, id)
constraint opening_draft_line_ingredient_uq unique (tenant_id, location_id, ingredient_id)   -- flag 5; dropped in V2
FKs (tenant_id, location_id) → location; (tenant_id, ingredient_id) → ingredient; (tenant_id, created_by|updated_by) → app_user
```

**RLS and grants (both tables):**
- RLS on. One select policy each: `tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin')`.
- `revoke all … from anon, authenticated`; `grant select … to authenticated`; no insert, update, delete or truncate grant to any API role,
  `service_role` included. Rows are written only by the definer procedures of §3.3–§3.6.

**Audit CHECKs:** re-created as the **union** of every value on main, plus:
- entity `stock_opening`;
- actions `stock.opening_posted` and `stock.opening_reversed`.

The re-creation follows `20261204100300:29–47`; `check-constraint-union.test.ts` must stay green.

**Purge list:** `app.demo_purge_tables()` is re-created with `'opening_draft_line', 'stock_opening'` placed **immediately after `'raw_lot'`**,
before `price_history`. Both point at locations, ingredients and users, which are deleted later; nothing points at them. This is
operational data:
- `app.tenant_has_operational_data` reads the list and is not replaced;
- a tenant with a carico counts as having data, which is right.

### 3.3 Helpers and the cut-off **[MIGRATION 4, step 6]**

All functions are definers with `search_path = ''`, owned by the migration owner, and start with `revoke all … from public, anon,
authenticated, service_role`. No new public name matches `cost|margin|price|service` (the naming pin, pgTAP `286`).

| Function | Kind | Body |
|---|---|---|
| `app.require_opening_writer()` | new, stable | `app.role()` in (`owner`, `admin`), else 42501 "permission denied: opening stock needs owner or admin". Goes through `app.role()`, so #79's `aal` gate and FD31 apply. The chef is excluded because the carico sets costs |
| `app.opening_max_lines()` | new, immutable | `200` (Q7) |
| `app.opening_location_state(p_tenant uuid, p_location uuid)` returns `(counted_at timestamptz, count_open boolean, first_receipt_on date)` | new, stable | `counted_at` = `min(closed_at)` of `count_session` rows of the location with `status = 'closed'` (any type; V3 limits it to monthly); `count_open` = a session with `status = 'open'` exists; `first_receipt_on` = `min(effective_on)` of `stock_movement` rows with `type = 'receipt'` at the location |
| `app.opening_check_bookable(p_tenant, p_location)` | new | `raise 'opening_location_counted' using errcode = 'P0001', detail = <business date of counted_at>` when `counted_at` is not null; `raise 'opening_count_open'` (P0001) when `count_open` |
| `app.opening_check_date(p_tenant, p_location, p_date)` | new | null → 22023; `p_date > app.business_date(p_tenant, now())` → P0001 `opening_date_in_future`; `p_date < business_date − 366` → P0001 `opening_date_too_old`; `p_date > first_receipt_on` → P0001 `opening_date_after_receipt` with `detail = first_receipt_on`. The first receipt's own date is allowed (Q10) |
| `app.opening_line_values(p_line jsonb)` | new, immutable | validates one line object: exactly the keys `id`, `ingredientId`, `qty`, `unitCostEur` (draft writes also need `locationId`); JSON types string/number; `qty` > 0, ≤ 100000, at most 4 decimals → else P0001 `opening_qty_invalid`; `unitCostEur` ≥ 0, ≤ 100000, at most 4 decimals → else P0001 `opening_cost_invalid`. A missing key, a wrong type or a bad uuid → 22023. **More than 4 decimals is refused, never rounded** (no silent change) |

"Approved count" is defined from the tables: **a `count_session` of that location with `status = 'closed'`**. `count_close` is the only
writer of that status (`20261027100200:305–307`). A cancelled session does not count. Pinned in `411` and `412`.

### 3.4 The draft store **[MIGRATION 4, step 6]**

The smallest version that meets spec §7.8: one table (§3.2), one read and three writes, all owner/admin through
`require_opening_writer`.

| Procedure | Does |
|---|---|
| `public.opening_draft() returns jsonb` | The state of the screen: `{today, maxLines, booked, locations: [{locationId, name, countedOn, countOpen, firstReceiptOn, bookable, lines: [{id, ingredientId, ingredientName, baseUnit, qty, unitCostEur, valueEur, updatedAt, updatedByName}], lineCount, totalValueEur}], lineCount, totalValueEur}`. It lists every **active** location, plus any inactive one that still has draft rows. Lines are newest first. `valueEur = round(qty × unit_cost, 2)`; totals are sums of the rounded values. `booked` = the tenant has at least one opening operation with no mirror |
| `public.opening_draft_put(p_lines jsonb) returns jsonb` | Upserts 1–200 lines `{id, locationId, ingredientId, qty, unitCostEur}`:<br>• each location is checked with `resolve_location` and `opening_check_bookable` (a counted location cannot be drafted, spec §3.4);<br>• each ingredient must belong to the tenant (`ingredient_not_found` P0002) and be `is_stock` (`ingredient_not_stock` P0001);<br>• an `id` already used by another location or ingredient changes in place;<br>• the unique index → P0001 `opening_line_duplicate` with `detail` = the ingredient id;<br>• more than 200 lines at one location after the write → P0001 `opening_draft_full`.<br>Returns `{lines: [...]}` in the shape of `opening_draft` |
| `public.opening_draft_remove(p_ids uuid[]) returns jsonb` | Deletes 1–200 ids of the tenant; returns `{removed}`. Unknown ids are not an error (removing is idempotent) |
| `public.opening_draft_clear(p_location uuid) returns jsonb` | "Svuota la bozza" (spec §5): deletes the location's draft lines; returns `{removed}` |

- **Shared between devices:** the rows are on the server and keyed by tenant. The phone and the laptop read the same `opening_draft()`.
- **Concurrency:** the last write wins per row (`updated_at`, `updatedByName` shown). The confirm is protected separately: it books only
  lines that equal what the confirming screen showed (§3.5 step 5).
- **Retention:** a draft lives until it is confirmed, cleared or purged. It holds no personal data beyond user ids (§3.10).
- **Why not overkill:** the spec needs a draft shared by devices (§2 step 2) and restored after a reversal (§5). Browser storage can do
  neither, and the fixed cost is one table and four small procedures. V5 records the alternative.

### 3.5 `public.post_opening_stock` **[MIGRATION 5, step 7]**

`public.post_opening_stock(p_location uuid, p_effective_on date, p_request_id uuid, p_lines jsonb) returns jsonb`. One call is one
transaction:

1. `app.require_opening_writer()` first. Then `v_tenant := app.tenant_id()` and `v_user := app.app_user_id()`. The tenant is never taken
   from the body.
2. Shape:
   - any null argument → 22023;
   - `p_lines` must be an array of 1..`opening_max_lines()` objects, each passing `app.opening_line_values`;
   - a repeated line `id` → 22023;
   - a repeated `ingredientId` → P0001 `opening_line_duplicate` (flag 5; V2).
3. **Replay:** if a `stock_opening` row with `(v_tenant, p_request_id)` exists:
   - at the same location, return its answer with `changed: false` and write nothing;
   - at another location → P0001 `opening_request_reused`.
4. `v_loc := app.resolve_location(v_tenant, p_location)`: an active location of the tenant.
5. **Lock and match the draft:** `select … from opening_draft_line where tenant and location order by id for update`. The multiset
   `{id, ingredient_id, qty, unit_cost}` must equal `p_lines` exactly, else P0001 `opening_draft_changed`. Effects:
   - the books hold exactly what the owner saw;
   - a stale screen, or a second device that changed the draft, cannot book unseen lines;
   - the brief's "confirm = one post_opening_stock that clears the draft" holds.
6. Check every ingredient: of the tenant (P0002 `ingredient_not_found`), `is_stock` (P0001 `ingredient_not_stock`).
7. `app.lock_ingredient_stock(v_tenant, <ingredient ids>)`. Lock order: draft rows, then stock locks. No count procedure locks draft
   rows, and this procedure never locks `count_session` rows, so no lock cycle exists (R6).
8. **After the locks, in new statements:** `app.opening_check_bookable` (O2 and the open-count rule), then
   `app.opening_check_date(v_tenant, v_loc, p_effective_on)`.
9. Insert the `stock_opening` row: `line_count = cardinality`, `created_by = v_user`.
10. Insert one movement per line, in line order: `type 'opening'`, `raw_lot_id null`, `location_id v_loc`, `qty`, `unit_cost = unitCostEur`
    (**frozen**), `ref_type 'opening'`, `ref_id` = the opening id, `effective_on = p_effective_on`, `created_by = v_user`. `created_at` is
    left at `now()`, as ADR-033 requires of writers.
11. Delete the matched draft rows.
12. One `audit_event`: entity `stock_opening`, id = the opening id, action `stock.opening_posted`,
    `after = {lines: <n>, total_value_eur: <sum of round(qty × unit_cost, 2)>}`. Counts and the total only: no names, no per-line values.
13. Return `{openingId, locationId, effectiveOn, lineCount, totalValueEur, changed: true}`.

**Why the cut-off also refuses an open count.**
- `count_record_lines` stores `expected_qty` when a line is entered (`fixes.sql:152–154`), and `count_close` books
  `counted − expected` (`count_procedures.sql:295–299`).
- Example: a carico of 25 kg posted between the entry and the close, with 25 kg counted against an expected 0, gives +25 kg twice.
- With the stock locks taken **before** the check:
  - a count entry on the same ingredients either waits for this commit and then snapshots the carico, or commits first and makes this
    call refuse;
  - a `count_close` needs an open session, which this check already refuses;
  - a count that is started **and** closed inside this transaction, on ingredients the carico does not touch, can finish first. That is
    harmless: those ingredients' balances are not affected (R5).

**Other reads of the same tables, for the screens** (same migration as `post_opening_stock`):
- `public.opening_history(p_location uuid) returns jsonb`: `{location: {id, name}, countedOn, countOpen, operations: [{openingId,
  effectiveOn, createdAt, byName, lineCount, totalValueEur, reversed: {at, byName, reasonCode} | null, correctable, lines: [{movementId,
  ingredientId, name, baseUnit, qty, unitCostEur, valueEur}]}]}`, newest first.
  - `reversed` comes from the mirror rows and the `stock.opening_reversed` audit row (the reason lives only there).
  - `correctable` = not reversed, not counted and no open count.
  - At most 50 operations (Q7).
- `public.opening_stock_summary() returns jsonb`: `{booked: boolean, draftLines: integer}`, for `/api/today`. Owner and admin. No money.

### 3.6 Correction: `public.reverse_opening_stock` **[MIGRATION 6, step 9]**

`public.reverse_opening_stock(p_opening uuid, p_reason text) returns jsonb`, one transaction:

1. `app.require_opening_writer()`.
2. `p_reason` must be in `app.opening_reversal_reasons()` = `{qty_wrong, cost_wrong, ingredient_wrong, location_wrong}` (spec §5;
   immutable), else P0001 `opening_reason_invalid`. A null reason → 22023.
3. `select … from stock_opening where tenant and id for update`; not found → P0002 `opening_not_found`.
4. `app.lock_ingredient_stock` on the operation's ingredients. Then `opening_check_bookable`: after the first closed count, or during an
   open count → refused (recommended default, Q5).
5. Any row of the operation already mirrored → P0001 `already_reversed`. The same code and the same unique-violation backstop as
   `reverse_movement` (`:205–223, :256–259`).
6. The location's draft must be empty, else P0001 `opening_draft_not_empty` (Q9). The screen says "Conferma o svuota la bozza di
   Dispensa prima di correggere" (da approvare).
7. One mirror row per original, in id order: same ingredient, location, null lot, `type 'opening'`, `unit_cost` equal, `qty` negated,
   `ref_type 'reversal'`, `ref_id` = a fresh uuid, `reverses_id` = the original. **`effective_on` = the original's**: the correction
   restates the carico on its own date (Q6), so the reconciliation of the carico's period nets to the corrected figure. The mirror guard
   checks the rest.
8. Restore the draft: one `opening_draft_line` per original row (new ids, same ingredient, qty and unit cost, `updated_by` = the caller).
9. One `audit_event` with entity `stock_opening`, action `stock.opening_reversed`,
   `after = {reason_code, lines, total_value_eur}`.
10. Return `{openingId, reversalOperationId, restoredLineIds}`.

`public.reverse_movement` is **not re-created**. It already refuses `ref_type 'opening'` with `movement_not_reversible` (`:202`), so the
generic Magazzino path cannot reverse a carico without a reason. `stock_movements` reports `reversible: false` for it (`stock_reads.sql:151`).
V1 is the alternative.

### 3.7 The cost fallback **[MIGRATION 7, step 10]**

`20261206220600_ingredient_cost_opening_fallback.sql` re-creates `app.ingredient_unit_costs` with the **same signature and return
columns** (`create or replace`; grants restated). The body of `20261023110100:25–75` stays as it is, with one more lateral:

```
left join lateral (
  select m.unit_cost as opening_cost
    from public.stock_movement m
   where m.tenant_id = p_tenant and m.ingredient_id = i.id and m.type::text = 'opening'
     and m.reverses_id is null
     and (v_date is null or m.effective_on <= v_date)
     and not exists (select 1 from public.stock_movement x where x.tenant_id = p_tenant and x.reverses_id = m.id)
   order by m.effective_on desc, m.created_at desc, m.id desc
   limit 1) op on true
```

and `unit_cost := case when w.used > 0 then <the basis value, as today> else op.opening_cost end`. (`left join lateral … on true` keeps
the ingredients with no opening row, with a null `opening_cost`; `414` asserts they keep a null cost.)

- **"In force":** an opening row counts when its `effective_on` ≤ the Rome date of `p_at`, the same rule as `price_history`. A reversed row
  never counts, even for an as-of date before its reversal; frozen costs are stored rows and never recomputed (R8).
- **Hand-over:** from the first `price_history` row in force, `used > 0` and the opening cost is ignored entirely. `avg_cost`,
  `last_cost`, `max_cost`, `purchases_used` and `last_purchase_on` describe purchases only: they stay null or 0 under the fallback. The
  opening price never enters the moving average (O3).
- **Tenant-wide:** the cost is per ingredient, not per location. If two locations' carichi give the same ingredient different costs, the
  latest by `effective_on`, then `created_at`, wins (Q13).
- **Inheritance**, with no change to the callers:
  - `post_stock_outflow` stamps the opening cost on consumption, waste and batch inputs;
  - `count_close` values `count` rows;
  - `recipe_costs` and `recipe_cost_lines` price recipes;
  - `freeze_line_cost` freezes sales (through the consumption rows);
  - `avt_rows` values the variance;
  - `public.ingredient_costs` lists the cost.
  - Non-stock ingredients can never have an opening row, so they are unaffected.
- **The source label (spec §7.7)** is derived, with no signature change: `costSource = null` when `unit_cost` is null; `'invoice'` when
  `purchases_used > 0`; otherwise `'opening'`.
  - After this migration, a non-null cost with zero purchases can only come from an opening row. `414` pins that invariant.
  - `src/server/costing/ingredients.ts` adds `costSource` to each ingredient.
  - `src/server/costing/recipe-cost.ts` makes one extra call to `ingredient_costs(p_date)` (same date) and adds `costSource` to each
    ingredient line. Server-side, not in React (step 16).

### 3.8 The reconciliation **[MIGRATION 8, step 11]**

`20261206220700_reconciliation_opening.sql` re-creates `public.stock_reconciliation` from `20261127100000:14–98` with two changes in the
`z` subquery:
- `before_period := case when type = 'receipt' then effective_on < p_from when type = 'opening' then true else created_at < v_lo end`;
- the row filter: `case when type in ('receipt', 'opening') then effective_on <= p_to else created_at < v_hi end`.

Effects:
- An opening dated on or before `p_to` is part of **`openingQty`** ("this is the stock the venue started with"; spec §4), never
  `receiptsQty` and never `otherQty`.
- Its mirror rows carry the original's date (§3.6), so they fold the same way.
- `balanced` still holds by construction.
- The JSON keys are unchanged, so the TS schema (`src/server/counts/output.ts:136`), the CSV export and the screen need no change.

The comment on `stock_movement.effective_on` is updated: "Receipt and opening: the date the reports read".

V4 adds a separate column instead.

### 3.9 API

All routes use `withApi({ roles: ["owner", "admin"], … })`:
- JSON only (415 otherwise);
- strict Zod bodies (an unknown key → 400);
- body limit 64 KiB (`MAX_OPENING_BODY_BYTES`; 200 lines fit), 413 above it;
- not on `OFFLINE_CACHE_PATHS`;
- the money keys are allowed because the routes are owner/admin only; the cost guard's role table gains them and asserts 403 for chef
  and waiter before any RPC.

| Method and path | Body / query | RPC | Answer |
|---|---|---|---|
| `GET /api/stock/opening/draft` | — | `opening_draft` | 200, the §3.4 state |
| `PUT /api/stock/opening/draft/lines` | `{lines: [{id, locationId, ingredientId, qty, unitCostEur}]}` (1–200) | `opening_draft_put` | 200 `{lines}` |
| `DELETE /api/stock/opening/draft/lines/:id` | — | `opening_draft_remove([id])` | 200 `{removed}` |
| `DELETE /api/stock/opening/draft?locationId=` | — | `opening_draft_clear` | 200 `{removed}` |
| `POST /api/stock/opening/confirm` | `{locationId, effectiveOn (YYYY-MM-DD), requestId, lines: [{id, ingredientId, qty, unitCostEur}]}` | `post_opening_stock` | 201 `{openingId, locationId, effectiveOn, lineCount, totalValueEur, changed}`; 200 on a replay (`changed: false`) |
| `GET /api/stock/opening/history?locationId=` | — | `opening_history` | 200 |
| `POST /api/stock/opening/:id/reverse` | `{reason}` | `reverse_opening_stock` | 201 `{openingId, reversalOperationId, restoredLineIds}` |

**Error map** (`src/server/opening/errors.ts`):
- 42501 → 403; `mfa_required` → 403; 22023 → 400;
- P0002 (`ingredient_not_found`, `opening_not_found`) → 404;
- **409** (state): `opening_draft_changed`, `opening_location_counted`, `opening_count_open`, `opening_draft_not_empty`, `already_reversed`,
  `opening_request_reused`;
- **422** (input): `opening_qty_invalid`, `opening_cost_invalid`, `opening_line_duplicate`, `opening_draft_full`,
  `opening_date_in_future`, `opening_date_too_old`, `opening_date_after_receipt`, `opening_reason_invalid`, `ingredient_not_stock`,
  `location_not_found`;
- for `opening_date_after_receipt` and `opening_location_counted`, the SQL `detail` date is passed as `details.date`, so the screen can say
  "(3 dic)";
- anything else → 500 with the SQLSTATE only.

Each code has an Italian message (da approvare). The new codes join `ErrorCode` (`src/lib/api/errors.ts`).

**Strict output schemas** are in `src/server/opening/output.ts`. The existing ones change too:
- `GET /api/stock/movements` gains `opening` in `movementType` (`src/server/stock/output.ts:11`);
- `movementTypeWord("opening")` = "Carico iniziale" (en "Opening stock"); its reversal reads "Annullamento", as today.

### 3.10 Security, privacy, RLS, secrets

- **Tenant boundary:**
  - both tables carry `tenant_id`, composite FKs and owner/admin select policies;
  - every procedure takes the tenant from `app.tenant_id()`, never from the body;
  - every lookup filters by the tenant;
  - X (step 2, extended in 5–7 and 9–11) proves that B reads 0 of A's rows and cannot post, draft, reverse or read history at A's
    locations (B gets `location_not_found`; ids of another tenant look like unknown ids).
- **Roles in Postgres:**
  - `require_opening_writer` = owner or admin, through `app.role()`, so #79's `aal` gate and FD31 apply;
  - chef and waiter get 42501 from every procedure, and their routes return 403 before any RPC;
  - no table write grant to any role.
- **Waiters never see costs:** nothing new is on the waiter's or the chef's paths. `stock_movements` (which the chef reads) has no cost
  key, and the chef sees "Carico iniziale" rows as quantities only (spec §6).
- **Ledger invariants:**
  - `stock_movement` and `stock_opening` stay append-only, and a correction is a mirror;
  - `post_opening_stock` and `reverse_opening_stock` are single transactions;
  - costs are frozen on the rows;
  - the draft is the only deletable store, and it is not ledger.
- **Input validation:** strict Zod, and SQL repeats every check because Data API callers bypass Zod. More than 4 decimals is refused,
  never rounded. Arrays are bounded at 200. No free text is stored: the reason is a code.
- **Audit:** one row per booking and one per reversal, owner/admin readable (`require_audit_reader`); counts, totals and a reason code
  only. DigiAlto acting as admin is recorded as that user (SP4 shows it as DigiAlto).
- **Personal data:** none added. `created_by` and `updated_by` are user ids, and history shows display names, as the stock history does
  today. Retention follows the ledger (project Q13/Q14). Abandoned drafts hold no personal data beyond ids, and a tenant purge deletes
  them.
- **Secrets:** none new. No `src/` code added here uses the Supabase secret key (it stays in `SUPABASE_SECRET_KEY`, in the Vercel
  environment and locally in the gitignored `.env`, used by the integration and e2e helpers only). No third-party provider, API key or
  login is involved.
- **SP6 later:** the volatile public procedures are `authenticated`-executable, so SP6's write-gate test will require
  `app.require_writable()` in them. Nothing is needed now.

### 3.11 Pins that move

Each moved pin is commented "re-pinned on purpose by opening stock (step N; was <old>)". The builder confirms each line on main.

| File:line (main) | What | Step |
|---|---|---|
| `090_stock_movement_shapes.test.sql:78–80` | enum labels → `…,count,opening` | 3 |
| `128_m14_preserves.test.sql:284–285`; `139_m15_preserves.test.sql:98–99` | "stock_movement_type is unchanged" → the six labels | 3 |
| `080_staff_auth_tables.test.sql:195–200` (entities), `:201–217` (actions) | add `stock_opening`; add `stock.opening_posted`, `stock.opening_reversed` | 5 |
| `342_mfa_self.test.sql:64` | action count 44 → 46 | 5 |
| `194_demo_purge_tables_complete.test.sql` | unchanged and green (both tables are in the list, not exempt) | 5 |
| `222:8`, `229:8`, `240:10` | the purge-list exclusion lists gain `opening_draft_line`, `stock_opening` | 5 |
| `280:175`, `290:252`, `359:95`, `362:132` | purge-list count 59 → 61 | 5 |
| `327:115`; `359:84, :94` | `demo_purge_tables` md5 (builder computes) | 5 |
| `365_p27_roles_preserves` table / trigger / policy counts | +2 / +2 / +2 | 5 |
| `286_m25c_preserves:51–52`; `207` t16, `214` t14, `229` t27, `296` t25 | public table lists gain both tables | 5 |
| `359_p22_preserves` `p27_objs` | a **separate** `insert into p27_objs values …;`, placed after P2-4's (or after SP1's if P2-4 is not merged): the two tables, the CHECK `stock_movement_opening_ck`, the triggers, the `app_fn` and `public_fn` names of §3.3–§3.6 | 4, 5, 6, 7, 9 |
| `327:125–128`, `346:64–68`, `229:72–73` | public catalogue md5/counts: the left-outs gain `opening_draft`, `opening_draft_put`, `opening_draft_remove`, `opening_draft_clear`, `post_opening_stock`, `opening_history`, `opening_stock_summary`, `reverse_opening_stock` | 6, 7, 9 |
| `128_m14_preserves.test.sql:243` | `ingredient_unit_costs` md5 `c33bfb73…` (the one-definition count at `:229` stays 7) | 10 |
| `240_m22_preserves.test.sql:51` | `stock_reconciliation` md5 `794e8991…` | 11 |
| `tests/config/m25-preserves.test.ts:28`, `m25a-preserves.test.ts:34`, `ux-quick-wins-preserves.test.ts:18`; `m25b-preserves.test.ts` `ALLOWED_NEW_MIGRATIONS` | newest migration / allowed list | every migration step |
| `src/server/stock/output.ts:11`; `tests/lib/stock/stock-view.test.ts` | `opening` in the strict enum; new word cases | 12 |
| `tests/guards/waiter-weight-no-cost.test.ts` role table | the seven opening routes as owner/admin-only | 14, 15 |
| `tests/config/m25b-preserves.test.ts` page list | one new page `/magazzino/avvio` | 21 |

**Must pass unchanged:**
- pgTAP `056` (cost engine, invoiced cases), `057`, `094`, `096`, `097`, `114`, `117`, `119` (incl. `reverse_movement` `86315a44…`),
  `128` (other pins), `139:80` (`reverse_movement`), `179` (`post_stock_outflow`), `236` (AVT), `259`, `260`, `389`, `390` (its catalogue
  loop covers the new tables), `396`;
- `tests/integration/counts.int.ts` (`otherQty` 0), `tests/config/check-constraint-union.test.ts`,
  `tests/lint/offline-cache-allowlist.test.ts`.

**Any other failing pin is a stop: report it to the lead; do not re-pin it silently.**

### 3.12 Runbook lines (step 19)

`docs/runbook.md` gains a section "Avvio magazzino (carico iniziale)":
- **Count right after the carico (O4).** Once a location's carico is confirmed, do a **monthly count** of that location the same day.
  The AVT report needs an opening count to compare against, and the count also closes that location's carico window: after it, stock
  comes in only by invoice or count.
- **Corrections:** before that count, use "Correggi il carico di …" on the screen (whole location, with a reason; the rows come back to
  the draft). After it, correct quantities with a count, and costs with the next invoice.
- **No lots, no use-by:** carico stock gets no expiry alerts; the venue checks those dates by hand until invoices arrive.
- **Onboarding by DigiAlto:** DigiAlto enters the carico as admin only with the owner's agreement; every booking and reversal is in the
  activity log.
- **Costs are IVA esclusa**, per base unit (kg, l, pz), like invoice prices.

---

## 4. Alternatives considered

- **A `receipt` without an invoice, with a source flag** (spec §7.1 option). `stock_movement_receipt_ck` requires a lot,
  `ref_type 'invoice_line'` and a `ref_id`, and a lot requires an invoice line. Purchases (`kpi_purchases`), the reconciliation's
  `receiptsQty` and the history word all read `receipt` as "bought". Rejected: the carico would be a purchase everywhere unless every
  reader learned the flag.
- **Count rows as the carico** (a "count" at a location with no prior stock). Counts are not reversible (`count_procedures.sql:239`),
  carry the **basis** cost (null without an invoice), and the AVT treats them as adjustments. They also close the very window O2 defines.
  Rejected.
- **A cost column on the ingredient.** It gives two price sources with no date and no audit trail, and the question of blending (O3)
  would come back. Rejected: the cost lives on the dated, reversible ledger row.
- **A pseudo-invoice** ("Fornitore: Carico iniziale"). It creates payables, VAT lines, a supplier and lots. Rejected (also O1).
- **`raw_lot` for opening stock**, to get lots. `invoice_line_id` is `not null unique` (`stock_ledger.sql:20, :33`), and O1 says no lots.
  Rejected.
- **`reverse_movement` learns `opening`.** It has no reason, admits the chef and cannot restore the draft. Kept as **V1**.
- **Reports read the carico by `created_at` (ADR-033 as is).** It needs no report change. But a carico dated 1 Dec and posted on 5 Dec
  shows 1–4 Dec as negative stock, and the carico as "other" on 5 Dec. Rejected for the reconciliation; kept for every other report,
  where O2 makes it irrelevant.
- **A separate "Carico iniziale" column in the reconciliation.** Clearer, but it changes the JSON, the TS schema, the CSV export, the
  parity helper and the screen. Kept as **V4**.
- **No server draft** (localStorage plus one POST). Smaller, but it is not shared between devices and cannot take rows back after a
  reversal. Kept as **V5**.
- **Book all locations in one call.** One transaction for the whole venue; but the merged spec books per location and reports per
  location (§2 step 3), and a refusal at one location would block every other. Rejected.

---

## 5. Build plan

**Rules for every step:**
- Test first: write the named test, see it fail for the stated reason, then change the code. One commit per step.
- A test-only step names its **proof** instead: a mutation case that must fail, or the tree on which it fails.
- Every step ends with `npm run lint`, `npx tsc --noEmit`, `npm test` and `npx supabase test db` green. Migration steps also run
  `scripts/test-db-native.sh`.
- **[MIGRATION]** marks a step that adds a migration file; the lead reads it line by line.
- **[UI-only]** marks a step Builder 2 may own.
- Each migration step adds its file to `tests/config/opening-preserves.test.ts` (created in step 3). That test asserts that:
  - the `2026120622*` files are exactly the steps built so far, sorted, after every `2026120621*` file present and before
    `20261207100000`;
  - they create or replace only the objects of §3, and never `public.reverse_movement`, `app.post_stock_outflow`,
    `public.approve_invoice`, `app.kpi_purchases`, `app.avt_rows`, `public.avt_report`, `public.count_close`,
    `public.count_record_lines`, `app.freeze_line_cost` or `public.stock_movements`;
  - they contain no `update`, `delete from` or `truncate` on `stock_movement`, `stock_opening` or `raw_lot`, and no `drop … cascade`;
  - they contain no uuid literal outside comments, and no `cron.schedule`;
  - no new public name matches `cost|margin|price|service`.

**PR split and size**

| PR | Steps | What | Size |
|---|---|---|---|
| **PR1** Baseline and type | 0–4 | G, X, the enum value (M1) and its shape (M2). No behaviour change: nothing writes `opening` yet | M |
| **PR2** Tables, draft, booking | 5–8 | tables, audit and purge (M3), draft procedures (M4), `post_opening_stock`, history, summary (M5), race cases | L |
| **PR3** Correction, cost, reconciliation | 9–11 | `reverse_opening_stock` (M6), the cost fallback (M7), the reconciliation fold (M8) | M |
| **PR4** TS, API, docs | 12–19 | the stock enum and word, the opening domain, routes, `costSource`, the Home step key, integration suite, ADR and runbook | L |
| **PR5** Screen (**UI-only**, Builder 2 may own it) | 20–25 | paste helper, phone and laptop screen, confirm and correct flows, entry points, Playwright, verification | L |

PR order: PR1 → PR2 → PR3 → PR4 → PR5. PR3's step 10 depends only on M1–M2 and may merge before the rest of PR3 if the lead wants the
fallback early.

| # | Step (one commit) | Files | Test that proves it (the first one fails first) |
|---|---|---|---|
| 0 | **Base check (no commit).** Confirm main's newest migration and pgTAP. Check that no `2026120622*` file and no pgTAP ≥ 407 exists on any branch the lead knows of. Compute on main the md5 values `416` will pin | — | All suites green; newest migration `20261206200400_tenant_locale_settings.sql` (or P2-4's last if merged); newest pgTAP `396` (or `406`) |
| 1 | **G: golden reports and costs** (characterization, before any change) | `supabase/tests/database/407_opening_golden.test.sql` | Built on `main`. **Fixture** (fake, tenant-#1-shaped, inserted as table owner): two locations; three approved invoices (receipts, price history, payables); fired sales; a batch; waste; two closed monthly counts at Dispensa. **Pins** the md5 of: `app.kpi_purchases` over the fixture month; `public.avt_report(<closing count>)` rows and totals; `public.payable_list` output; `public.stock_reconciliation` for the month at both locations; `public.ingredient_costs()` and `app.recipe_costs` for the invoiced ingredients and recipes; the `order_line_cost` and `batch_cost` rows. **Passes on main by design.** Proof: a mutation case in the same file (one receipt's qty +1) changes the purchases md5. The file stays unchanged through step 25 (AT7), except one added assertion in step 10 |
| 2 | **X: cross-tenant suite on Demo A/B** | `408_opening_cross_tenant.test.sql` | Demo A and Demo B with owners, admins and chefs on `example.test`, one location and two stock ingredients each. On main it asserts the baseline (B reads 0 of A's `stock_movement`). **Passes on main by design.** Proof: a temporary policy letting B read A makes it fail. Steps 5, 6, 7, 9, 10 and 11 add their B-against-A cases here |
| 3 | **[MIGRATION 1] Enum value `opening`** (§3.1) | `supabase/migrations/20261206220000_stock_movement_opening_type.sql`; `409_opening_movement_shape.test.sql`; `416_opening_preserves.test.sql` (new); `tests/config/opening-preserves.test.ts` (new); the step-3 rows of §3.11 | **409 first test: "the enum labels in order are receipt,consumption,waste,transfer,count,opening" (fails: five labels).** **416 first test: "`post_stock_outflow`, `reverse_movement`, `approve_invoice`, `kpi_purchases`, `avt_rows`, `avt_report`, `count_close`, `count_record_lines`, `freeze_line_cost`, `stock_movements` keep the md5 values computed in step 0"** (fails if any is edited). The Vitest preserves: the file rules of §5 |
| 4 | **[MIGRATION 2] Shape CHECK** (§3.1) | `…20261206220100_stock_movement_opening_shape.sql`; `409`; `359` (`p27_objs`) | **409 test: "an opening row with qty 2, unit_cost 0.8, ref_type opening, no lot is accepted" and "the same row with unit_cost null is refused with `stock_movement_opening_ck`" (fails: no check, so the null passes).** Then refused (23514): qty −1 without `reverses_id`; a lot set; a reason; `ref_type 'manual'`; `unit_cost −0.01`; a consumption with `ref_type 'opening'`. Accepted: `unit_cost 0`. **Mirror:** an exact mirror (−2, 0.8, `reverses_id`, `ref_type 'reversal'`) is accepted; a mirror at 0.9 → P0001 `reversal_mismatch`; a mirror with qty +2 → 23514; a second mirror → 23505 `stock_movement_reverses_uq`. UPDATE and DELETE of an opening row → `append_only` |
| 5 | **[MIGRATION 3] Tables, audit CHECKs, purge list** (§3.2) | `…20261206220200_stock_opening_tables.sql`; `410_opening_tables.test.sql`; `408` (B rows); the step-5 rows of §3.11 | **410 first test: "`public.stock_opening` exists with RLS on and a unique (tenant_id, request_id)" (fails: missing).** Then:<br>• owner and admin of A read A's rows; chef and waiter read 0; B reads 0 (X);<br>• no insert, update or delete privilege for `anon`, `authenticated` or `service_role` on either table;<br>• UPDATE, DELETE and TRUNCATE of `stock_opening` → `append_only`;<br>• the draft CHECKs refuse qty 0, qty 100000.0001 and unit_cost −1; the unique index refuses a second row for the same ingredient and location;<br>• the audit CHECKs accept the two new actions and the entity, and keep every earlier value (`080`);<br>• `app.demo_purge_tables()` lists `opening_draft_line, stock_opening` right after `raw_lot`; `194` is green; a demo purge (pgTAP `193` fixture extended by one row in each) deletes them;<br>• `tenant_has_operational_data` is true for a tenant whose only data is one `stock_opening` row |
| 6 | **[MIGRATION 4] Helpers, cut-off, draft procedures** (§3.3, §3.4) | `…20261206220300_stock_opening_draft.sql`; `411_opening_draft.test.sql`; `408`; `327`, `346`, `229` left-outs; `359` | **411 first test: "owner A's `opening_draft_put` of one Dispensa line (25 kg at 0.8) then `opening_draft()` shows that line with valueEur 20.00 under Dispensa" (fails: function missing).** Then:<br>• the same `id` again with qty 30 updates in place (one row);<br>• the same ingredient at Dispensa under another id → `opening_line_duplicate`; at Frigo 1 → accepted;<br>• qty 0, −1, 100000.0001, 1.00001 → `opening_qty_invalid`; unitCostEur −0.01 or 1.00001 → `opening_cost_invalid`; a missing key, a string qty or an extra key → 22023;<br>• a non-stock ingredient → `ingredient_not_stock`; B's ingredient → `ingredient_not_found`;<br>• 201 lines at one location → `opening_draft_full`;<br>• **cut-off:** with a `count_session` of Dispensa `closed` → `opening_location_counted` with `detail` = its business date; with one `open` → `opening_count_open`; with one `cancelled` → accepted; Frigo 1 is still accepted;<br>• `opening_draft_remove` of an unknown id → `{removed: 0}`; `opening_draft_clear(Dispensa)` removes only Dispensa's lines;<br>• chef and waiter → 42501 on all four; admin allowed; gated by #79/FD31 (owner at `aal1` under `required`, admin at `aal1`) → 42501;<br>• X: B's owner `opening_draft()` shows none of A's rows, and B's put with A's location → `location_not_found`;<br>• all four are definers with an empty `search_path`, executable by `authenticated` only; `341` green |
| 7 | **[MIGRATION 5] `post_opening_stock`, history, summary** (§3.5) | `…20261206220400_post_opening_stock.sql`; `412_post_opening_stock.test.sql`; `408`; `327`, `346`, `229`, `359` | **412 first test: "owner A books Dispensa's 3-line draft dated yesterday: one `stock_opening`, three `opening` movements with the drafted qty and unit_cost, no lot, `effective_on` yesterday, `ref_id` = the opening id; Dispensa's draft is empty; one `stock.opening_posted` row with `{lines: 3, total_value_eur}`" (fails: function missing).** Then:<br>• **AT1** the balances (`location_on_hand`) include the quantities, and Frigo 1's draft is untouched;<br>• **replay:** the same `request_id` again → the same answer with `changed: false` and no new rows; the same `request_id` at Frigo 1 → `opening_request_reused`;<br>• **draft match:** lines differing from the draft by one qty, one extra line or one missing line → `opening_draft_changed`, nothing written;<br>• a repeated ingredient → `opening_line_duplicate`; 201 lines → 22023;<br>• **AT4 date:** tomorrow's business date → `opening_date_in_future`; with a receipt dated D at Dispensa, D+1 → `opening_date_after_receipt` with `detail` D, and D itself → accepted; today − 367 → `opening_date_too_old`; a receipt at Frigo 1 only does not limit Dispensa; **business day:** at 01:30 Rome with a 02:00 cut-off, the calendar date is refused as future and the previous date is accepted;<br>• **AT3 cut-off:** after a closed count at Dispensa → `opening_location_counted`; during an open count → `opening_count_open`; Frigo 1 still accepted; an addition (a second operation) before the count → accepted;<br>• **AT2** chef and waiter → 42501 with nothing written; admin allowed, and the audit `created_by` is the admin;<br>• `opening_history(Dispensa)` lists the operation with lines and values, `reversed` null and `correctable` true; after a closed count, `correctable` is false;<br>• `opening_stock_summary()` → `{booked: true, draftLines: 0}`; the chef → 42501;<br>• **AVT order (flag 4):** after booking and then closing a monthly count, every opening row's `created_at` is before the location's first `closed_at`, and a later booking attempt is refused;<br>• X: B posting at A's location → `location_not_found`; B's history of A's location → `location_not_found` |
| 8 | **Race cases** | `scripts/test-db-races.sh` (three cases appended) | CI `db-races`, with the existing cases unchanged. <br>• **`opening-double-confirm`:** s1 confirms Dispensa (request r1) and parks before commit; s2 confirms the same lines (request r2) and blocks on the draft row locks (`s2_blocked` 1); after the gate, s1 commits and s2 gets `opening_draft_changed`; one operation; `no_deadlock`. <br>• **`opening-vs-count-close`:** a count of Dispensa is open with Farina counted; s1 runs `count_close` and parks after its stock locks; s2 confirms a carico containing Farina and blocks on the stock lock; after the gate s2 gets `opening_location_counted`, with no opening row. <br>• **`count-entry-vs-opening`:** no count is open at Dispensa. s1 confirms a carico of 25 kg Farina at Dispensa and parks after its cut-off check, holding the stock lock. s2 starts a count at Dispensa (`count_start` commits), then enters Farina (`count_record_lines`) and blocks on the stock lock. After s1 commits, s2's `expected_qty` for Farina is 25. **Proof:** in a scratch copy with the stock locks moved after the cut-off check, case 2 books the carico and fails |
| 9 | **[MIGRATION 6] `reverse_opening_stock`** (§3.6) | `…20261206220500_reverse_opening_stock.sql`; `413_reverse_opening_stock.test.sql`; `408`; `327`, `346`, `229`, `359` | **413 first test: "reversing a 3-line Dispensa opening with reason `cost_wrong` writes three mirror rows (same unit_cost, negated qty, the original's `effective_on`, `ref_type 'reversal'`, `reverses_id` set), the balances return to their prior values, the draft holds the three original lines again, and one `stock.opening_reversed` audit row has `{reason_code: 'cost_wrong', lines: 3, total_value_eur}`" (fails: function missing).** Then:<br>• **AT5** a second reversal → `already_reversed`; a reversal with a non-empty Dispensa draft → `opening_draft_not_empty`, nothing written;<br>• reason `foo` → `opening_reason_invalid`; reason null → 22023; an unknown id → `opening_not_found`;<br>• **cut-off:** after a closed count at Dispensa → `opening_location_counted`; during an open count → `opening_count_open`;<br>• rebooking the restored, edited draft gives the corrected balances;<br>• `public.reverse_movement` on an opening movement → `movement_not_reversible` (unchanged) and its md5 is unchanged (`119`, `128`, `139` green);<br>• `stock_movements` shows the operation with `reversible: false` and its reversal with `isReversal: true`;<br>• chef and waiter → 42501; X: B reversing A's opening → `opening_not_found`;<br>• the nightly `rev_bad` check (`ledger_checks_body`) reports nothing for the fixture |
| 10 | **[MIGRATION 7] Cost fallback** (§3.7) | `…20261206220600_ingredient_cost_opening_fallback.sql`; `414_opening_cost_fallback.test.sql`; `128:243`; `407` (one added assertion) | **414 first test: "an ingredient with no price_history and a Dispensa opening at 0.80 has `unit_cost` 0.80 and `purchases_used` 0 in `app.ingredient_unit_costs`" (fails: null).** Then:<br>• an ingredient with neither an invoice nor an opening keeps a null cost and its row;<br>• **hand-over (AT6):** after an approved invoice at 1.10 dated D, `unit_cost` at D is 1.10 with the moving average over that one row only (`avg_cost` 1.10, `purchases_used` 1); at D−1 it is still 0.80;<br>• with a `last_price` basis the same hand-over holds;<br>• two non-reversed openings (Dispensa 0.80 on D1, Frigo 0.90 on D2 > D1) → 0.90; after reversing the Frigo one → 0.80; after reversing both → null;<br>• an opening dated after `p_at` is not in force;<br>• **invariant:** for every ingredient of the fixture, `unit_cost is not null and purchases_used = 0` ⇔ a non-reversed opening row is in force;<br>• **inheritance:** a consumption posted by `consume_raw_fefo` after the carico carries 0.80; `count_close` stamps 0.80 on a `count` row; `recipe_costs` of a recipe using it is complete; a sale fired before the invoice keeps its frozen cost after the invoice arrives (`order_line_cost` unchanged);<br>• **G unchanged:** `407`'s cost pins for invoiced ingredients still pass; its added assertion: the AVT `unitCostEur` of an invoice-less ingredient is null without a carico and equal to its opening cost with one (Q12 records this inheritance);<br>• grants and `search_path` unchanged; one definition (`128:229` stays 7) |
| 11 | **[MIGRATION 8] Reconciliation fold** (§3.8) | `…20261206220700_reconciliation_opening.sql`; `415_opening_reconciliation.test.sql`; `240:51` | **415 first test: "a 25 kg carico at Dispensa dated 1 Dec and posted on 5 Dec is in `openingQty` of the 1–5 Dec report, `otherQty` is 0 and `balanced` is true" (fails: it lands in `otherQty`).** Then:<br>• the 20 Nov–30 Nov report does not include it; the 2–5 Dec report includes it in `openingQty`;<br>• `receiptsQty` never includes it;<br>• after a reversal and a rebooking at 24 kg, the 1–5 Dec report's `openingQty` nets to 24;<br>• a period with no opening row gives row-for-row main's output (`114`, `259` green; G's reconciliation md5 unchanged);<br>• the column comment names opening rows;<br>• X: B's report never includes A's carico |
| 12 | **Stock history knows `opening`** | `src/server/stock/output.ts`; `src/lib/stock/stock-view.ts`; `src/lib/i18n/messages/{it,en,keys}.ts`; `tests/server/stock/output.test.ts`; `tests/lib/stock/stock-view.test.ts` | **First test: "`movementsResponse` accepts an operation of type `opening`" (fails: enum).** Then: `movementTypeWord("opening", false)` = "Carico iniziale" (en "Opening stock"); its reversal = "Annullamento"; an unknown type is still refused |
| 13 | **Opening domain in TS** | `src/server/opening/{constants,schemas,output,errors}.ts`; `src/lib/opening/opening-view.ts`; `src/lib/api/errors.ts`; `src/lib/i18n/messages/{it,en,keys}.ts`; `tests/server/opening/{schemas,output,errors}.test.ts`; `tests/lib/opening/opening-view.test.ts`; `tests/parity/opening-sql-parity.test.ts` | **First test: "`confirmBody` refuses a line with unitCostEur missing" (fails: schema missing).** Then:<br>• refused: qty 0, 1.00001, 100001; cost −0.01; 201 lines; an extra key; `effectiveOn` "1/12/2026"; a non-uuid `requestId`;<br>• the output schemas refuse an undeclared key;<br>• each SQL code maps to its status (409 or 422) and Italian message; `details.date` is passed through, and the date-error text reads "La data deve essere prima della prima fattura ricevuta (3 dic)." for `opening_date_after_receipt` with date 2026-12-03 (AT4 wording);<br>• **parity:** `MAX_LINES`, the bounds and `OPENING_REVERSAL_REASONS` equal the SQL literals;<br>• view helpers (pure, `src/lib`): group by location with subtotals; totals as `1.234,50 €`; `canEditOpening(role)` true for owner and admin only; `isCorrectable(op)` |
| 14 | **Draft routes** | `src/server/opening/draft.ts`; `src/app/api/stock/opening/draft/route.ts`; `…/draft/lines/route.ts`; `…/draft/lines/[id]/route.ts`; `tests/app/api/opening-draft.test.ts`; `tests/guards/waiter-weight-no-cost.test.ts` | **First test: "an owner's PUT of one line calls `opening_draft_put` once with `p_lines` and answers 200 `{lines}`" (fails: route missing).** Then:<br>• GET by owner or admin → 200 with one RPC; chef and waiter → 403 before any RPC; no session → 401;<br>• DELETE line → `opening_draft_remove([id])`; DELETE `?locationId=` → `opening_draft_clear`; a bad uuid → 400;<br>• `text/plain` → 415; over 64 KiB → 413; an extra key → 400 with no RPC;<br>• `opening_location_counted` → 409 with `details.date`; `opening_line_duplicate` → 422;<br>• not offline-cacheable (`offline-cache-allowlist` green) |
| 15 | **Confirm, history and reverse routes** | `src/server/opening/{confirm,history,reverse}.ts`; `src/app/api/stock/opening/confirm/route.ts`; `…/history/route.ts`; `…/[id]/reverse/route.ts`; `tests/app/api/opening-confirm.test.ts`; `tests/app/api/opening-history.test.ts`; `tests/guards/waiter-weight-no-cost.test.ts` | **First test: "an owner's POST confirm calls `post_opening_stock` with `p_location`, `p_effective_on`, `p_request_id`, `p_lines` and answers 201" (fails: route missing).** Then:<br>• a replay answer (`changed: false`) → 200;<br>• `opening_draft_changed` → 409; `opening_date_after_receipt` → 422 with `details.date`;<br>• the reverse body `{reason: 'cost_wrong'}` → 201; `{reason: 'foo'}` → 400 with no RPC;<br>• history without `locationId` → 400;<br>• chef and waiter → 403 on all three; the cost guard lists them as owner/admin-only |
| 16 | **`costSource` in the cost APIs** (§3.7) | `src/server/costing/{ingredients,recipe-cost,types}.ts`; `tests/server/costing/ingredients.test.ts`; `tests/server/costing/recipe-cost.test.ts` | **First test: "an ingredient row with unit_cost 0.8 and purchases_used 0 maps to `costSource: 'opening'`" (fails: no key).** Then:<br>• `purchasesUsed` 2 → `'invoice'`; a null cost → `null`;<br>• `getRecipeCost` calls `ingredient_costs` once with the same `p_date` and puts `costSource` on each ingredient line, and `null` on sub-recipe lines;<br>• the strict outputs accept the key and refuse others;<br>• the existing cost route tests are green with the new key added to their fixtures |
| 17 | **Home step key** | `src/server/today/{types,summary}.ts`; `src/lib/nav/today-actions.ts`; `src/lib/i18n/messages/{it,en,keys}.ts`; `tests/server/today/summary.test.ts`; `tests/lib/nav/today-actions.test.ts` | **First test: "for the owner, `/api/today` setup includes `{key: 'openingStock', done: true, href: '/magazzino/avvio'}` when `opening_stock_summary` says booked" (fails: no key).** Then:<br>• `done: false` when not booked;<br>• the chef's `setup` stays null, and the summary RPC is not called for the chef;<br>• `firstSteps("owner")` gains "Carica il magazzino iniziale" after "Ingredienti";<br>• `stepStatuses` maps it |
| 18 | **Integration suite on the local stack** | `tests/integration/opening-stock.int.ts` (new) | **First test: "owner PUTs two Dispensa lines, GETs the draft, POSTs confirm, and `GET /api/stock` shows the quantities while `GET /api/costs/ingredients` shows 0,80 with `costSource 'opening'`".** This is an end-to-end check of steps 5–17, so it passes once written. **Proof:** a mutation case (confirm with a stale qty) must get 409. Then:<br>• a second confirm with the same `requestId` → 200 `changed: false`;<br>• reverse with `qty_wrong` → the draft holds the lines again; rebook → corrected balances;<br>• approve a fake invoice for Farina → `costSource 'invoice'` at the invoice price;<br>• start and close a count at Dispensa → PUT and confirm → 409 `opening_location_counted`;<br>• chef: every opening route → 403; `GET /api/stock/movements` for Farina shows "opening" without a cost key;<br>• B's owner sees none of A's data;<br>• `counts.int.ts`, `costs` and `stock` integration suites green unchanged |
| 19 | **ADR, runbook, ADR-033 note** | `docs/adr/adr-048-opening-stock.md` (status "proposed"; number = the next free one on main, Q11); `docs/adr/adr-033-ledger-business-date.md` (a dated "Note 2026-11-18": opening rows are the second exception, read by `effective_on` in the reconciliation; see ADR-048); `docs/runbook.md` (the §3.12 section) | `tests/config/runbook.test.ts` green; the runbook section contains the "count right after the carico" line (a new assertion in `runbook.test.ts`); the ADR template's fields are present; the ADR states the decision, the alternatives of §4, and when to revisit: lots on carico stock (O1), a per-location cost, a second "carico" use case |
| 20 | **[UI-only] Paste and unit helper** | `src/lib/opening/paste.ts`; `tests/lib/opening/paste.test.ts` | **First test: "`parsePaste('farina 00\t500 g\t0,80\tDispensa', ctx)` gives one row of 0.5 kg with the note '500 g → 0,5 kg'" (fails: module missing).** Then:<br>• tab or semicolon separators; Italian decimals "1.234,5";<br>• ml → l; "conf" and an unknown unit → refused with a reason;<br>• an unknown ingredient → "Ingrediente nuovo: verrà creato in kg" with the unit from the column; an unknown location → "Ubicazione sconosciuta"; a missing cost → "Costo mancante";<br>• more than 200 rows → refused;<br>• it reuses `src/lib/csv/parse.ts` (spy: called once) |
| 21 | **[UI-only] The screen, phone layout** (spec §3.1, §3.3, §8) | `src/app/(owner)/magazzino/avvio/{page,opening-form,opening-list}.tsx`; `tests/components/opening-page.test.ts`; `tests/config/m25b-preserves.test.ts` (page list) | `renderToStaticMarkup` with fixture payloads. **First test: "the page with an empty draft shows the intro, the date and location card, and 'Nessuna riga ancora.'" (fails: missing).** Then:<br>• a draft renders one group per location with "Dispensa · 24 righe · 1.610,20 €" and the total in `<strong>`;<br>• the cost field hint "IVA esclusa"; the no-expiry sentence;<br>• a counted location is not offered and shows "Dispensa è già stata contata il 15 dic…";<br>• offline → the form is disabled with its sentence;<br>• the forbidden payload → the forbidden message;<br>• the page calls only `/api/stock/opening/*` and `/api/ingredients` (fetch spy) |
| 22 | **[UI-only] Laptop grid and paste preview** (spec §3.2) | `src/app/(owner)/magazzino/avvio/{opening-grid,paste-dialog}.tsx`; `tests/components/opening-grid.test.ts` | **First test: "at ≥ 1024 px the grid renders one labelled row per draft line with Valore and a ✕ button" (fails: missing).** Then: every cell has a real `<label>`; the preview lists each row's problem and "Aggiungi 52 righe"; nothing is PUT before that button (spy) |
| 23 | **[UI-only] Confirm, correct, entry points** (spec §2, §4, §5, §8) | `src/app/(owner)/magazzino/avvio/{confirm-step,correct-step,history-list}.tsx`; `src/app/(owner)/magazzino/page.tsx` (link); `src/app/(owner)/page.tsx` (Home step via step 17); the recipe cost line component (label "Costo da carico iniziale"); `tests/components/opening-confirm.test.ts`; `tests/components/recipe-cost-lines.test.ts` | **First test: "the confirm step lists 'Dispensa (24), Frigo 1 (13)' and on a 409 for Frigo 1 shows 'Frigo 1: non caricato · …' while Dispensa shows 'caricato'" (fails: missing).** Then:<br>• one POST per location, each with its own `requestId`, reused on retry;<br>• "Correggi il carico di Dispensa" needs a reason, then posts reverse, then reloads the draft;<br>• a line with `costSource 'opening'` shows "Costo da carico iniziale"; an invoice line does not;<br>• Magazzino shows an "Avvio magazzino" link for owner and admin only |
| 24 | **[UI-only] Playwright at 360 px and 1280 px** | `e2e/opening-stock.spec.ts` (new) | Test-only commit. **Proof:** the spec fails on `main` (the page is missing). **360 × 740, owner:** Home "Carica il magazzino iniziale" → add Farina 25 kg at 0,80 € → the row shows 20,00 € → confirm → "Dispensa: caricato" → Magazzino shows 25 kg → Home step "Fatto". Correct with "Costi sbagliati" → the rows are back in the draft → edit to 0,90 → confirm → a recipe with Farina shows "Costo da carico iniziale". **Admin** does the same. The **chef** on `/magazzino/avvio` gets the forbidden message. `expectPhoneFriendly` in light and dark. **1280 × 800:** paste three rows → preview → "Aggiungi 3 righe" → the grid shows them |
| 25 | **Verification and hand-off** | the PR descriptions | Full suites green; coverage of new TS ≥ 80 %; `code-reviewer` PASS on each PR; AT1–AT9, G and X mapped to passing tests. **T1** confirmed by steps 3–4 on the local stack and on staging (`supabase db push --dry-run` lists the eight files in order, then the push applies them) |

**Acceptance tests → steps**

| Test | Steps |
|---|---|
| AT1 | 7, 18, 24 |
| AT2 | 6, 7, 9, 14, 15, 18, 24 |
| AT3 | 6, 7, 8 (race), 9, 18 |
| AT4 | 7, 13 (date messages) |
| AT5 | 9, 11, 18, 24 |
| AT6 | 10, 16, 18, 23, 24 |
| AT7 | 1 (G), kept by 3–24; 10 (G assertion); 11 |
| AT8 | 2 (X), extended in 5, 6, 7, 9, 10, 11; 18 |
| AT9 | 7 (replay, draft match), 8 (races), 18 |

**Order that keeps tenant #1 working at every commit:**
- Steps 1–2 add tests only.
- Steps 3–4 add a type nothing writes.
- Steps 5–9 add tables and procedures nobody calls yet.
- Step 10 changes costs only for ingredients that have an opening row and no invoice; there are none until someone books.
- Step 11 changes the reconciliation only where opening rows exist.
- Steps 12–25 add the API and the screen.

### 5b. Variants

**V1 — `reverse_movement` learns `opening` (the brief's literal item 3)** · Trigger: Q2 answered "one reversal procedure" · Replaces:
step 9 and the "not re-created" status of `public.reverse_movement` (§3.6, `opening-preserves`, `416`).

| # | Step | Files | Test |
|---|---|---|---|
| V1.1 | **[MIGRATION]** `public.reverse_movement` re-created from `20261026100500:173–263`. For `o.ref_type = 'opening'` it:<br>• calls `app.require_opening_writer()` (the chef → 42501);<br>• runs `opening_check_bookable`;<br>• dates the mirrors with the original's `effective_on`;<br>• writes `stock.opening_reversed` with `reason_code: null`.<br>Every other path stays verbatim. `reverse_opening_stock(p_opening, p_reason)` becomes a wrapper that validates the reason, calls `reverse_movement` on the operation's first row, then writes the reason audit and restores the draft | new migration; pins `119:29`, `128:242`, `139:80` re-pinned on purpose; `416` updated | pgTAP: the chef's `reverse_movement` on an opening row → 42501; the owner's → mirrors as in `413`; manual and transfer reversals unchanged (`094`, `096`, `097` green); the wrapper gives `413`'s results exactly |
| V1.2 | The generic reverse route keeps `roles: owner, admin, chef`; the history marks openings `reversible: false` (the screen uses the opening route) | `tests/app/api/stock-reverse.test.ts` | a chef POST on an opening movement → 403 from the SQL 42501 mapping |

**V2 — Two rows for one ingredient in one operation ("Riga separata")** · Trigger: Q3 answered "allow" · Replaces: the unique index
`opening_draft_line_ingredient_uq` (§3.2), the `opening_line_duplicate` rule (§3.4, §3.5 step 2), and the cost order of §3.7.

| # | Step | Files | Test |
|---|---|---|---|
| V2.1 | **[MIGRATION]** Drop `opening_draft_line_ingredient_uq`. Re-create `post_opening_stock` without the duplicate check. Re-create `ingredient_unit_costs` so the fallback is the **qty-weighted mean** of the rows of the latest non-reversed opening **operation** in force for the ingredient (still never blended with invoices) | new migration; `411`, `412`, `414` cases | pgTAP: two Dispensa rows of Farina (10 kg at 0.80, 30 kg at 1.20) book two movements, and the cost is 1.10; after an invoice, the invoice price only |
| V2.2 | The screen's "Riga separata" option | `opening-form.tsx`; its test | choosing it PUTs a second line for the same ingredient |

**V3 — Only a closed monthly count ends the carico window** · Trigger: Q4 answered "monthly only" · Replaces: the `counted_at`
definition in `app.opening_location_state` (§3.3). The open-count rule stays for both types (flag 2).

| # | Step | Files | Test |
|---|---|---|---|
| V3.1 | **[MIGRATION]** `opening_location_state.counted_at` = `min(closed_at)` of **monthly** closed sessions | new migration; `411`, `412` | a closed daily count at Dispensa → post accepted; a closed monthly one → `opening_location_counted`; an open daily count → `opening_count_open`; step 7's AVT-order assertion still holds (AVT windows start at monthly counts) |

**V4 — A separate "Carico iniziale" column in the reconciliation** · Trigger: Q6 answered "separate column" · Replaces: step 11's fold
into `openingQty`.

| # | Step | Files | Test |
|---|---|---|---|
| V4.1 | **[MIGRATION]** `stock_reconciliation` adds `openingLoadQty` (opening rows dated inside the period, by `effective_on`) to `balanced`; rows before the period stay in `openingQty` | new migration; `240:51` | `415`'s first case expects `openingQty` 0 and `openingLoadQty` 25 for a 1–5 Dec report |
| V4.2 | TS schema, CSV column "carico iniziale", reconciliation row | `src/server/counts/{output,reconciliation,types}.ts`; `src/server/exports/tables/reconciliation.ts`; `tests/helpers/csv-parity.ts`; `reconciliation-row.tsx` | strict output accepts the key; the CSV parity test lists it; the row shows "Carico iniziale +25 kg" |

**V5 — No server draft** · Trigger: Q8 answered "no draft table" · Replaces: `opening_draft_line` (§3.2), §3.4, step 6, the draft match
and delete of §3.5 steps 5 and 11, the restore of §3.6 step 8, and step 14.

| # | Step | Files | Test |
|---|---|---|---|
| V5.1 | **[MIGRATION]** No draft table and no draft procedures; `post_opening_stock` books `p_lines` as given; `reverse_opening_stock` returns the reversed lines in its answer | M3–M6 without the draft parts | `412` without the draft cases (a stale-screen protection no longer exists: R2 rises); `413` asserts the lines in the answer |
| V5.2 | The draft lives in `localStorage` per device, keyed by tenant and user, cleared by `forgetUser()` | `src/lib/opening/local-draft.ts`; its test | a draft survives a reload on the same device; another device sees none; `forgetUser` clears it |

**V6 — Another milestone's migrations reach `main` in the wrong order** · Trigger: a `2026120621*` file merges after ours, or a
`20261207*` or later file is on `main` before ours · Replaces: the file names of the unmerged migration steps (3–7, 9–11) and the range
rule of `opening-preserves`.

| # | Step | Files | Test |
|---|---|---|---|
| V6.1 | Rename the unmerged files to the first free slot after main's newest, keeping their order and suffixes | those files; the newest-migration pins; `opening-preserves.test.ts` | `opening-preserves`: our unmerged files sort after every file on `main`; files already merged keep their names |
| V6.2 | Recompute the counts others moved (`365`, `359` additions, catalogue left-outs, purge counts) on top of theirs | `365`, `359`, `327`, `346`, `229`, `280`, `290`, `362` | the same pgTAP files green on the merged tree; `supabase db push --dry-run` on staging lists only our files |

**V7 — The "Data del carico" is shared between devices** · Trigger: Q14 answered "store the date" · Replaces: the client-held date of
the confirm (§3.9).

| # | Step | Files | Test |
|---|---|---|---|
| V7.1 | **[MIGRATION]** `public.opening_draft_location (tenant_id, location_id, effective_on, updated_by, updated_at)`, with RLS and purge as the draft; `opening_draft_put_date(location, date)`; `opening_draft()` returns `effectiveOn` per location; `post_opening_stock` requires `p_effective_on` to equal it (`opening_draft_changed` otherwise) | new migration; `411`, `412`; purge pins +1 | pgTAP: the date put in one session is read by another; a confirm with another date → `opening_draft_changed` |
| V7.2 | `PUT /api/stock/opening/draft/date` | route and test | owner 200; chef 403 |

---

## 6. Risks and mitigations

| # | Risk | Mitigation |
|---|---|---|
| R1 | The carico becomes a back door around invoices (spec §2 option B) | O2 cut-off at the first count; owner/admin only; every booking and reversal audited; history on screen; the invoice price always wins (O3) |
| R2 | A stale screen or a second device books lines the owner did not see | the draft match in `post_opening_stock` (`opening_draft_changed`, step 7) and the double-confirm race (step 8) |
| R3 | A carico counted twice by a count in progress | the open-count refusal after the stock locks (§3.5); race cases 2 and 3 (step 8) |
| R4 | An opening row inside an AVT window distorts "actual" (§9 item 1) | O2 plus the reversal cut-off; step 7's AVT-order assertion; G (step 1) |
| R5 | A count started **and** closed during a confirm, on ingredients the carico does not touch, finishes first | accepted: the touched balances are exact; the race cases cover every overlapping order |
| R6 | Deadlock between confirm, count and reversal | one order: draft rows or the `stock_opening` row, then the stock locks in id order; no `count_session` lock taken; `no_deadlock` in step 8 |
| R7 | Owner-typed costs are wrong and drive food cost | "Costo da carico iniziale" label; correction by reversal until the first count; the first invoice replaces it; the runbook tells the venue to count right after the carico (§3.12) |
| R8 | As-of cost reads change when a carico is reversed | frozen costs (sales, batches, movements) are stored and never recomputed; only live reads change, by design |
| R9 | Merge order with P2-4 and SP2 breaks `db push` | the range sits between them; V6 |
| R10 | Rebase conflicts on shared pins (`359`, `365`, `327`, `346`, `229`, the purge pins, m25*) | a separate `p27_objs` insert; SP1's union rule (add, never overwrite), written in each PR description |
| R11 | Security: a chef or waiter books or reverses; B writes A | `require_opening_writer` (`aal`-gated); no table grants; the tenant from the token; `411`–`413`, X, route tests |

**Unverified technical assumptions (each proved in the named step):**
- **T1:** `alter type … add value` in its own migration file makes `opening` usable by the next file under `supabase db push` and
  `db reset`. M12 relied on the same rule (`20261026100000:2–4`). The PostgreSQL page (S1) could not be fetched from this session
  (`www.postgresql.org` is not in the allowed network domains). Proved in steps 3–4 on the local stack and in step 25 on staging.
- **T2:** under READ COMMITTED, a `select … for update` on draft rows that a concurrent transaction deleted returns no rows after that
  commit, so the second confirm sees an empty draft. Proved by race case 1 (step 8).

**Secrets:** none added or moved (§3.10).

---

## 7. Open questions for the lead / founder

| # | Question | Recommended default (applies unless answered) |
|---|---|---|
| Q1 | Ratify the migration range `20261206220000`–`220700` (fixes `220800`–`220900`) and pgTAP `407`–`416`; order P2-4 → opening stock → SP2 | Ratify; V6 if the order changes |
| Q2 | Correction through a new `reverse_opening_stock` (reason, owner/admin, draft restore), leaving `reverse_movement` unchanged? | Yes (flag 1); V1 for the literal design |
| Q3 | Two rows of one ingredient in one operation ("Riga separata", spec §3.4)? | No: one row per ingredient and location; "Somma" only. Founder may want V2 |
| Q4 | Does a closed **daily** count also end the carico window? | Yes, any closed count (O2 as worded); V3 for monthly only |
| Q5 | Does the O2 cut-off also block reversals after the first count? | **Yes**: after the count, stock is corrected by counting and cost by the next invoice (spec §5 "Limit"); also blocked during an open count |
| Q6 | The reconciliation folds the carico into `openingQty` by its date, and a correction is dated with the carico's date? | Yes (§3.6, §3.8); V4 for a separate column |
| Q7 | Bounds: 200 lines per location and per call; qty ≤ 100000 base units (as `stock_qty_base`); unit cost ≤ 100000 €/base unit; 4 decimals; date at most 366 days back; history ≤ 50 operations | As proposed. These are engineering limits, not client facts |
| Q8 | Keep the server draft store? | Yes (§0, §3.4); V5 otherwise. **The lead decides** |
| Q9 | Reversal while the location's draft holds rows | Refuse (`opening_draft_not_empty`); the screen asks to confirm or clear first |
| Q10 | "Not after the first approved invoice": is the invoice's own date allowed? | Yes (≤ first receipt `effective_on`, per location) |
| Q11 | ADR number | ADR-048 (SP1 took 046, P2-4 047), status "proposed"; plus a dated note in ADR-033 |
| Q12 | The AVT's EUR value for an ingredient with only a carico cost becomes a number instead of null (inheritance, step 10) | Accept: that is "food cost right from day one"; AVT quantities are unchanged |
| Q13 | The opening cost is tenant-wide: two locations at two prices → the latest wins | Accept for v1; a per-location cost would change the cost engine's contract |
| Q14 | Should the "Data del carico" be shared between devices like the rows (it is not in spec §7.8)? | No: it is chosen at confirm, defaulting to today's business date; V7 otherwise |
| Q15 | Wording: every new Italian string | Stays "(da approvare)": the copywriter drafts, the founder approves (spec Q-A5) |

### Spec §7 question → answer

The merged spec has eight items. The draft of PR #196 had six; its numbers are in the second column.

| Spec §7 (merged) | Draft §7 | Answer | Where |
|---|---|---|---|
| 1. A movement type `opening`, unlotted, cost frozen, read as opening, never a purchase | 1 | **Yes.** New enum value; the CHECK forces `raw_lot_id` null and `unit_cost` not null. The reconciliation folds it into `openingQty` by its date. Purchases read `receipt` only (`kpi_report.sql:141`), and G proves they are unchanged | §3.1, §3.8; steps 3, 4, 11, 1 |
| 2. One owner/admin `post_opening_stock(location, lines)`, one location per call, one transaction, audited | 3 (one confirm procedure) | **Yes**, plus `p_effective_on` and `p_request_id`. The lines must equal the location's draft, which it clears. One `stock.opening_posted` audit row. **Idempotent on a double tap** by `request_id` (draft §7.3) | §3.5; steps 7, 8 |
| 3. Base units only | — | **Yes.** SQL takes base-unit quantities and no unit parameter; the screen converts g→kg and ml→l in a pure helper | §3.3; steps 6, 20 |
| 4. Effective date chosen; not future; not after the first invoice receipt | 3 (date rule) | **Yes.** ≤ today's **business** date; ≤ the location's earliest `receipt.effective_on`; ≥ today − 366. Stored in `effective_on`; `created_at` = the posting. The reconciliation reads it; AVT and other reports keep `created_at` (ADR-033), which O2 makes equivalent | §0 item 5, §3.3, §3.8; steps 7, 11 |
| 5. Per location until its first approved count, for first carico and additions | (Q-A1) | **Yes.** "Approved" = a `count_session` of the location with `status = 'closed'`. **Also refused while a count is open** (double-count risk). Applies to draft writes and reversals too | §3.3, §3.5; steps 6, 7, 8, 9 |
| 6. Corrections by reversal of the whole operation, rows back into the draft | 5 (reason code and original id) | **Yes**, via `reverse_opening_stock(opening, reason)`: mirrors with `reverses_id` = each original row, the reason code in the audit, the rows restored to the draft. `reverse_movement` is unchanged (V1) | §3.6; step 9 |
| 7. Cost source: opening cost only until an invoice price; the API says the source | 4 | **Yes.** Fallback in `ingredient_unit_costs` only when no `price_history` row is in force; never averaged; `costSource` (`invoice | opening | null`) in the ingredient costs and the recipe cost lines | §3.7; steps 10, 16 |
| 8. A server-side draft, smallest form | 2 | **Yes**: `opening_draft_line` plus four procedures; the next table maps each need | §3.4; steps 5, 6, 14 |
| (draft only) Lot code and use-by on opening stock? | 6 | **No** (O1): `raw_lot_id` is null by CHECK; no expiry alerts; the screen says so | §3.1; step 4 |

### §7.8 need → endpoint/field

| §7.8 need | Endpoint / field | Step |
|---|---|---|
| Rows per location | `GET /api/stock/opening/draft` → `locations[].lines[]`, with `lineCount` and `totalValueEur` per location and overall | 6, 14 |
| Each row: ingredient | `lines[].ingredientId`, `ingredientName`, `baseUnit` | 6, 14 |
| Each row: quantity | `lines[].qty` (base unit) | 6, 14 |
| Each row: unit cost | `lines[].unitCostEur` (EUR per base unit, net of VAT), plus `valueEur` | 6, 14 |
| Edited freely | `PUT /api/stock/opening/draft/lines` (upsert by client `id`; 1–200 lines; also the paste) | 6, 14 |
| Removed freely | `DELETE /api/stock/opening/draft/lines/:id`; `DELETE /api/stock/opening/draft?locationId=` ("Svuota la bozza") | 6, 14 |
| Shared between the owner's devices | server table `opening_draft_line`, read by every session of the tenant's owner and admin; `lines[].updatedAt`, `updatedByName` | 5, 6 |
| Restorable from a reversed operation | `POST /api/stock/opening/:id/reverse` puts the operation's rows back; the answer's `restoredLineIds` | 9, 15 |
| (needed by the screen's states, §3.4 and §8) which locations can be drafted, and their dates | `locations[].bookable`, `countedOn`, `countOpen`, `firstReceiptOn`; top-level `today`, `maxLines`, `booked` | 6, 14 |

---

## 8. Sources

| ID | URL | Used for |
|---|---|---|
| S1 | https://www.postgresql.org/docs/current/sql-altertype.html | T1: a value added by `ALTER TYPE … ADD VALUE` inside a transaction cannot be used until that transaction commits. **Not fetched in this session** (the host is not in the allowed network domains); the repo already relies on it (`20261026100000:2–4`); proved by steps 3–4 |
| S2 | `docs/ux/avvio-magazzino.md` on `main` `8f31eebb` | the screen spec (merged version) |
| S3 | `docs/adr/adr-033-ledger-business-date.md` | the date rule this plan amends for opening rows |

---

## 9. Differences found between the brief, the spec and the code

1. **AVT does not read "receipts only".** Its "actual" is minus the sum of every type **except receipt and transfer**
   (`20261112100400_avt_report.sql:54`). An `opening` row inside an AVT window would read as stock appearing. The AVT is unchanged only
   because O2 (with the reversal cut-off) keeps every opening row before the location's first closed count, and every AVT window starts
   at a closed monthly count (step 7's assertion, G).
2. **The reconciliation is not in the brief and needs a change.** A type it does not know goes to `otherQty`, and non-receipt rows are
   dated by `created_at` (`20261127100000:54–55, 58, 61`). The carico would show as "Altri movimenti" on the posting day. Spec §4 wants it
   as opening stock: step 11.
3. **A count in progress would double-count a carico.** `count_record_lines` snapshots `expected_qty` (`fixes.sql:152–154`), and
   `count_close` books `counted − expected` (`count_procedures.sql:295–299`). The brief's O2 rule covers closed counts only; the plan also
   refuses while a count is open.
4. **`reverse_movement` cannot carry the spec's correction.** It has no reason, admits the chef (`stock_core.sql:27–36`) and cannot restore
   a draft. The plan adds `reverse_opening_stock`; the brief's literal item 3 is V1.
5. **Payables never read `stock_movement`** (`payable_reads.sql`, `payable_list_range.sql`), so "payables read receipts" is true only
   indirectly. There is no effect.
6. **"No duplicates" (brief) vs "Riga separata" (spec §3.4).** The base follows the brief; V2 follows the spec (Q3).
7. **The merged spec has eight §7 items**, not six, and books **one location per call**. The plan answers all eight and maps the draft's six
   (§7).
8. **Daily counts are counts too** (`count_tables.sql:15`). O2 as worded ends the window at a daily count of critical items (Q4, V3).
9. **ADR-033 lists this case as its revisit trigger** ("a writer that must record a back-dated … movement", `adr-033:22`). ADR-048 and a
   dated note in ADR-033 record the second exception.
10. **The cost is tenant-wide, the stock per location** (`ingredient_cost.sql:25–73` has no location). The brief's "latest non-reversed
    opening movement" is therefore chosen across locations (Q13).
11. **`GET /api/stock/movements` would break** on the first opening row: its strict enum lists five types (`src/server/stock/output.ts:11`).
    Step 12 fixes it before any route can book.
