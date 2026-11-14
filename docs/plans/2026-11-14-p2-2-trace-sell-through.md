# Tech plan: Osteria Digitalization · P2-2 Trace and sell-through (C3 first half, C12, C14-V2)

- **Client slug / internal:** `osteria-dei-rossi` (internal planning document, English; every screen string below is Italian first, English second).
  - **Client facts used:** none. No venue name, supplier, dish, price or lot code from the real venue appears in code, seed or fixtures.
  - **Fixtures** follow the M21–P2-1 conventions: tenants "Osteria Demo A/B"; users "Titolare Demo", "Admin Demo", "Chef Demo",
    "Cameriere Demo"; suppliers "Fornitore Demo 1/2"; ingredients "Farina Demo", "Pomodoro Demo"; batch recipe "Ragù Demo"; plates
    "Lasagne Demo", "Tagliatelle Demo"; lot codes `L-DEMO-0001`… Dates in pgTAP and in Vitest fixtures that read the clock are in 1998
    (no-date-bombs guard, builder hand-off §5; pgTAP 351 uses 1998).
- **Repo and branch:** repo `osteria-dei-rossi-app`, branch `feat/p2-2-trace-sell-through` from `main` `e5eade0`.
  Newest migration on `main`: `20261202100000_admin_mfa_always.sql`.
- **Name:** P2-2 (Phase 2 scope `docs/plans/2026-11-11-phase2-scope.md`, Part 3; candidates C3 first half (project M31 part 1), C12 (project M38),
  C14-V2 (reservations plan §5b V2)). Founder decisions D1 (order) and D9 (reservations V2 = counts only; V1 stays "no") of 2026-11-11 are
  built in as given. No date is promised by this plan.
- **Context: confirmed pre-go-live queue (lead, founder decisions 2026-11-14):** CB11 (brand logo files) → **P2-2 (this plan)** → P2-7 XML
  e-invoice upload → SP0 SaaS spike → P2-4 alert rules → P2-5 accountant file → small fixes → code freeze around 19 December. Labels and
  scanning (P2-3) are not in this queue. The "code freeze" date is the lead's planning date, not a promise of this plan.
- **Numbering** (re-check every number against `main` and every remote branch before the PR is marked ready):
  - **Migrations:** `20261203100000`–`20261203100500`. If anything newer than `20261202100000` reaches `main` first, renumber after it.
  - **pgTAP:** `352`–`359`; variants of this plan use `360`+.
  - **ADR:** **ADR-043** (provisional; the newest in `docs/adr` is ADR-042). Written in step S20 after `git ls-remote` checks the open branches
    (including `docs/local-producers-plan`, which may also claim a number).
  - **IDs:** decisions **D-P1…D-P13**; steps **S1–S20**; variants **V1–V7**; acceptance tests **AT-P1…AT-P12**; questions **Q-P1…Q-P13**;
    origin hooks **H1–H7**.
- **Author:** architect · **Date:** 2026-11-14
- **Sources:** `CLAUDE.md`; `docs/handoff/builder.md`; `docs/plans/2026-11-11-phase2-scope.md` (Part 2 C3, C12, C14-V2, C19; Part 3 P2-2; D1, D9);
  `docs/prd.md` (4.1 Phase 2 bullet; "Traceability and labelling"); `docs/plans/2026-10-21-project-plan.md` (§3.6, §5a M31/M38 rows);
  `docs/plans/2026-11-08-reservations.md` (§3.6, §5b V2); `docs/plans/2026-10-31-m23-push-forecast.md`; `docs/plans/2026-11-12-p2-1-totp.md`
  (format); ADR-002, ADR-003, ADR-006, ADR-010, ADR-011, ADR-013, ADR-014, ADR-018, ADR-019, ADR-026, ADR-033, ADR-035, ADR-037; the merged SQL
  and TS listed in §2; the official sources in §8. **Where merged code and a plan differ, the code wins.**

---

## 0. Summary for the founder (plain language)

**What you get**

1. **"Where did it come from, where did it go" (Tracciabilità).** A new screen in the Cucina menu.
   - Type a supplier lot code (for example from a recall letter), or pick an ingredient, a supplier and some dates. The app lists the
     deliveries that match.
   - Open one delivery and you see, on one page: which batches the kitchen made with it (with date, time and lot of each batch), which
     dishes were served from those batches, on which day and at what times, what was thrown away, and how much is still in stock.
   - Open a batch and you see the other way: which deliveries and suppliers went into it.
   - Pick a day and a dish (for example after a customer complaint) and you see which batches and deliveries that dish came from.
   - When the app does not know something (a delivery entered without a lot code, or a batch made when the stock said zero), the screen
     says so plainly. It never guesses.
2. **Typing the lot code when an invoice is checked is encouraged, never forced.** On the invoice check screen, every stock line without a
   lot code gets a small "Lotto mancante" mark, and before you approve, the app tells you how many lines have no lot code. You can still
   approve. The Tracciabilità screen shows how many deliveries of the last 30 days have a lot code, per supplier.
3. **"Com'è andata" on the Da spingere page.** For each dish you pushed yesterday (or any past day): how many plates sold while it was
   pushed, and for the batches that were close to their use-by when you pushed: how many portions were there, how many were sold, how
   many were thrown away and how many were left. The owner and admin also see the day price, if you set one.
4. **The chef sees booked covers.** On the production screen, next to the forecast, the chef sees for the chosen day how many
   reservations and covers are booked per service (Pranzo, Cena), counting only confirmed bookings. **Never names, phone numbers or
   e-mails.** The database itself gives the chef numbers only.

**What changes for you at receiving:** nothing is mandatory. You are reminded to copy the lot code from the packaging into the invoice
line before approving. Once an invoice is approved, its lot codes cannot be added later in this version (the stock record never
changes; this is the one question we ask you, §7).

**Local producers and origin (your idea of 2026-11-14):** not built now. The network of local producers gets its own plan. This step only
makes sure the trace can later show the producer, the place of origin and a protected name (DOP, IGP, DOCG, IGT) of what you bought.
Electronic invoices (next step, P2-7) have no standard box for lot or origin, so suppliers will mostly still need to be asked or the
lot typed (§3.13).

**What it does not do:** no label printer, no QR codes and no scanning (labels come later, after go-live). No photos of lot labels. No new
device, no new outside service, no new cost. No file for the inspector yet. No guest names next to tables in a trace. Waiters see none of
this, except the booked covers they already see today.

**Who sees what:** owner and admin see everything here; the chef sees the trace and the push results without prices and without invoice
numbers, and booked covers as numbers only; waiters see no trace and no push results.

**What we will ask outside people (one question each, with our proposed answer):** the HACCP consultant, the data-protection adviser and
the chef (§7.1). Nothing for the accountant in this step.

---

## Flags for the lead (read first)

1. **No new table.** P2-2 is read-only reporting over ledgers that exist (`raw_lot`, `stock_movement`, `batch_input`, `batch_movement`,
   `order_line`, `menu_push`, `reservation`). `app.demo_purge_tables()` (ADR-018) and the tenant export/erasure lists (ADR-040) are
   **unchanged on purpose**, asserted in S8. Only variant V1 adds a table, and it adds it to the purge list in the same step.
2. **Lot capture cannot be fixed after approval** in the default build: `raw_lot` is append-only and copies `invoice_line.lot_code` at
   approval (`20261023110600_approve_invoice_variance.sql`). The nudge is therefore placed **before** approval. A late lot note is V1
   (Q-P3, the one founder question).
3. **No pinned procedure is touched.** `approve_invoice`, `produce_batch`, `split_batch`, `discard_batch`, `fire_course`, `void_line`,
   `push_menu_item`, `app.push_list_json`, `app.reservations_day_json` keep their md5 pins (S8). Only V2 would re-pin `approve_invoice`.
4. **Trace output carries no money for any role** (smallest safe design; costs stay in the cost screens). Sell-through carries one money
   key, `pushPrice`, for owner and admin only, as the push list already does.
5. **Origin (founder 2026-11-14):** nothing is stored for origin in P2-2. The one cheap thing built now is the purchase line identity in the
   owner/admin forward trace (`lot.purchase`, D-P13), which a recall letter needs today and which is the anchor where origin attaches later.
   The recommended model (producer and designation on `supplier_item`, a frozen origin snapshot per lot) and seven named hooks are in §3.13.
6. **One PR** (M-size, read-only). If review asks for a split: SQL + server (S1–S12, S18) then UI + e2e + docs (S13–S17, S19–S20).

---

## 1. Goal and scope

- **Goal:** the owner, admin and chef can follow a supplier lot forward to batches and served plates and back again; the owner learns
  how pushed dishes actually sold; the chef sees booked covers as counts; lot codes are encouraged at receiving; the trace is shaped so
  origin can be added later without rework.
- **In scope:**
  - forward trace (raw lot → raw outflows → batches, including split children → plates served, voids, waste → on hand);
  - backward trace (batch → its root's raw lots → supplier and invoice; served plate → batches and direct raw lots → supplier);
  - lot search (lot code prefix, or ingredient / supplier / received date range) and a lot-capture rate;
  - lot capture **encouraged** at invoice review (per-line mark, pre-approval count); approval never blocked;
  - push sell-through per pushed item for a business day (default yesterday);
  - reservations V2: confirmed reservations and covers per service for a business day, for owner, admin, waiter and chef, counts only;
  - screens, nav entry, links from the batch and ingredient-stock pages;
  - RLS / role enforcement in Postgres for every new read;
  - the origin data design (§3.13), documented only, plus the purchase-line identity in the owner/admin trace.
- **Out of scope:**
  - labels, QR codes, scan-to-act, decant labels, HACCP registers (lot register, non-conformity log, secondary labelling): **P2-3** (C2, C4);
  - the local-producers network, producer sign-up, supplier discovery, suggestions and producer offers (separate plan, branch
    `docs/local-producers-plan`), and every origin column or table (hooks H1–H7 in §3.13);
  - XML e-invoice parsing (**P2-7**); this plan only records which FatturaPA fields could feed lot and origin (§3.13.3);
  - lot photos at receiving (Q-P4);
  - a CSV / print file of a trace (Q-P9 → V5);
  - any change to how stock, batches or orders are written; any new ledger; any guest data in a trace (Q-P10);
  - raw-ingredient ("lot") pushes measured by stock left (M23 Q165 keeps raw items out of push reports; Q-P12);
  - a "usual sales" comparison for pushes (Q-P5 → V3);
  - waiters accepting reservations (reservations V1 stays "no", D9).

## 2. Current state (`main` `e5eade0`, newest migration `20261202100000`)

| What exists | Where | How P2-2 uses it |
|---|---|---|
| `raw_lot` (one per received invoice line; `lot_code` nullable 1–64, `expiry`, `received_on` = invoice date, `supplier_id`, `invoice_line_id`); append-only; RLS owner/admin/chef | `20261022140100_stock_ledger.sql` | The lot. Every receipt has a `raw_lot` row **even without a lot code**, so a delivery is traceable by supplier + invoice + date when the code is missing |
| `invoice_line` (`raw_description`, `supplier_code`, `supplier_item_id`, `lot_code`, `expiry`); `supplier_item` (`supplier_code`, `description_hash`, pack, `last_price`; mutable; RLS owner/admin only, it holds a price) | `20261022120000_invoice_extraction.sql`, `20261021130200_supplier.sql` | The purchase line behind a lot (D-P13); the anchor for origin later (§3.13) |
| `stock_movement` (signed qty, `raw_lot_id`, `ref_type`/`ref_id`, `reverses_id`, `unit_cost`); RLS owner/admin only | same; shapes `20261026100100`; void rows `20261106100300` | Raw outflows per lot: `consumption` ref `batch` (production), ref `order_line` (plates with direct raw ingredients), `waste`, `transfer`, `count`; reversals by `reverses_id` (ref `order_void` for voids) |
| `batch_input` (one row per production consumption slice; `raw_lot_id` null = unlotted shortfall, ADR-011); indexes by batch and by lot | `20261028100000_batch_tables.sql` | Lot ↔ batch link. Its own comment: "The forward and backward trace of M31 reads these" |
| `batch` (`lot_code`, `produced_at`, `use_by`, `split_from_batch_id`), `batch_movement` (portion ledger: `produce`, `consume` ref `order_line`, its reversal ref `order_void`, `waste` refs `batch_discard`/`staff_meal`/`order_void`, `count` ref `batch_adjust`, `split`); RLS owner/admin/chef; `batch_cost` owner/admin | `20261028100000`, `20261106100000_fire_core.sql`, `20261029100300_batch_split.sql` | Batch → plate link (`consume` rows of a line). A split child has **no** `batch_input`; its raw lots are its root's |
| `order_line` (`fired_at`, `voided_at`, `menu_item_id`, `table_session_id`, `qty`, weight columns); RLS owner/admin only; `app.order_line_portions(qty, weight_g, portion_weight_g)` | `20261101100000_order_core.sql`, `20261130100000_weight_core.sql` | Plates served; a weighed line counts its portion fraction (P2-0b D-7) |
| `table_session.table_name` (snapshot), `business_date` | `20261031100000_menu_tables_core.sql` | Table label on a traced plate (no guest data) |
| `menu_push` (append-only start/stop, `push_until`, `push_price`, `batch_keys` snapshot); `app.menu_push_periods`; `app.push_default_until`; `app.require_push_reader` (owner/admin/chef) | `20261114100000_menu_push_core.sql`, `20261114100300_push_list.sql` | Push periods for sell-through; ADR-026 names M38 as its reader |
| `app.discards_vs_push_json` (weekly discards vs pushes, owner/admin) | `20261114100500_discards_vs_push.sql` | Same period/overlap rule reused; not changed |
| `app.business_date(tenant, at)` (02:00 cut-off, DST-safe), `app.kpi_cutoff_end(tenant, date)`, `public.business_date_of(at)`, `app.use_by_state(use_by, now)` | `20261029100100`, `20261112100100`, `20261117100100`, `20261028100100` | Business days, push-day window, "due soon" at push start |
| `reservation` (`status`, `business_date`, `service_key`, `party`); `reservation_contact` (name/phone/e-mail); chef 0 rows by RLS; `app.reservations_day_json` (owner/admin/waiter; counts include pending); `app.service_labels`, `app.service_windows`, `app.service_periods_at` | `20261124100000`, `20261124100600_reservation_reads.sql`, `20261120100200_service_assign.sql` | V2 covers read; the day view stays as it is |
| Invoice review read assembled in TS (`lot_code`, `expiry`, `is_stock` per line; lots of an approved invoice) | `src/server/invoices/review.ts`, `review-types.ts`; screens `src/app/(owner)/fatture/[id]/revisione/{review-line,line-editor,approval-panel}.tsx` | Per-line `lotMissing` and a summary count for the nudge |
| Role gate in Postgres: `app.role()`/`app.tenant_id()` return null for a gated owner/admin at `aal1` (P2-1); admin always gated (`20261202100000`) | `20261201100000_mfa_gate.sql` | Every new function calls a `require_*` helper first, so pgTAP 341's coverage scan holds |
| Demo purge list | `20261124100100_demo_purge_tables_resv.sql` (latest) | Unchanged (no new table) |
| Screens: `/spingere`, `/produzione` (forecast panel), `/produzione/[id]`, `/magazzino/[ingredientId]`, nav model | `src/app/(owner)/…`, `src/lib/nav/nav-model.ts` | Extended |
| e2e helpers: `e2e/helpers/business-date.ts` (`businessDateOf`), `seed-invoice.ts`, `seed-push.ts`, `seed-order.ts`, `reservations.ts` | `e2e/helpers/` | Seeds for S19 |

## 3. Design

### 3.1 Decisions

| # | Decision | Why |
|---|---|---|
| D-P1 | **Read-only over the ledgers; no new table, column or stored balance.** Every figure is folded from movements at read time | Invariants (ADR-002); smallest design; purge and export lists untouched |
| D-P2 | **Lot identity = `raw_lot.id`**, not the code. A search by code returns the matching `raw_lot` rows; a delivery without a code is still found by ingredient/supplier/date and shown "Lotto fornitore non registrato" | Codes are free text and may repeat across suppliers; the row is the fact |
| D-P3 | **Gaps are shown, never guessed.** Unlotted inputs (`batch_input.raw_lot_id` null) appear as "Senza lotto (scorta mancante al momento della produzione)". The forward trace adds a count of batches of the same ingredient with unlotted inputs since the lot's receipt, labelled "Da verificare a mano" | Phase 2 scope C3 risk; ADR-011 |
| D-P4 | **Net of reversals.** A consumption or consume reversed by `reverses_id` is not counted as used/sold; a plate fired then voided is listed under "Annullati dopo l'invio" with its waste, not as served | ADR-019 void semantics |
| D-P5 | **Split children belong to their root.** `app.batch_family` walks `split_from_batch_id` downward (forward) and upward (backward), depth ≤ 50 (guard → P0001 `trace_depth_exceeded`) | A split child has no `batch_input` (M15) |
| D-P6 | **Business dates everywhere:** plates are grouped by `app.business_date(tenant, movement.created_at)`; times shown in Europe/Rome. Receipts use `received_on` (the invoice date, M5) as today | ADR-033; same rule as reports |
| D-P7 | **No money in any trace reply, for any role.** Owner/admin get the invoice id, number and date (they read `invoice`); the chef gets no `invoice` key (chef has no `invoice` RLS read) | Smallest exposure; matches RLS |
| D-P8 | **Sell-through definition** (§3.4): per push period clipped to the business day; plates sold = fired, not voided, lines of the item fired inside the window, in portions (`app.order_line_portions`); at-risk stock = batches of the push's `batch_keys` that were "due soon" (`app.use_by_state`) at the window start, with their split children | PRD 4.1; C12 risk "define sold the same way"; ADR-026 |
| D-P9 | **Covers for the chef come from a definer function returning counts only**; the chef keeps 0 rows from every reservation table | D9; reservations plan V2.1 |
| D-P10 | **Chef covers count confirmed bookings only** (`accepted`, `arrived`, `seated`), as reservations plan V2.1 says; pending requests are not counted (Q-P7 → V4) | As specified in V2.1 |
| D-P11 | **Lot nudge in the server reply, shown by the UI.** `lotMissing` per line and `summary.stockLinesWithoutLot` are computed in `src/server/invoices/review.ts`; React only renders them | "Every screen reads `/api/*` JSON; no data logic in React" |
| D-P12 | **Bounded replies.** Constants (SQL with TS twins, parity test): `TRACE_MAX_LOTS` 50, `TRACE_MAX_BATCHES` 200, `TRACE_MAX_PLATE_GROUPS` 400, `TRACE_MAX_LINES` 200, `TRACE_MAX_RANGE_DAYS` 366, `TRACE_SPLIT_DEPTH` 50; every list carries `truncated` | Phone/4G payloads; no unbounded query |
| D-P13 | **Purchase-line identity in the owner/admin trace** (founder 2026-11-14, origin): `lot.purchase = {supplierItemId|null, supplierCode|null, description}` read from the lot's `invoice_line`; absent for the chef (`supplier_item` and `invoice` are owner/admin data). No origin field is added (§3.13) | A recall letter names the supplier's product code and description, so it is used now; it is also the join where producer, origin and designation attach later (H1–H3) |

### 3.2 Data model and migrations

No table, column, view or trigger is created or altered. Six migrations add functions and indexes only.

| File | Adds | Notes |
|---|---|---|
| `supabase/migrations/20261203100000_trace_core.sql` | `app.require_trace_reader()` (owner, admin, chef; 42501 otherwise); `app.lot_code_norm(text)` immutable (`upper`, strip whitespace); `app.trace_constants()`; `app.batch_family(p_tenant uuid, p_roots uuid[], p_until timestamptz)` → `(batch_id, root_id, depth)` (split children created before `p_until`, recursive, depth guard); `app.batch_root(p_tenant, p_batch)` → root id; **indexes** `raw_lot_lot_code_norm_idx on raw_lot (tenant_id, app.lot_code_norm(lot_code) text_pattern_ops) where lot_code is not null`; `raw_lot_received_idx on raw_lot (tenant_id, received_on desc, id)`; `raw_lot_supplier_idx on raw_lot (tenant_id, supplier_id, received_on desc)`; `batch_split_from_idx on batch (tenant_id, split_from_batch_id) where split_from_batch_id is not null` | Plain `create index` inside the migration, as `20261108100200` (one venue; rerun `concurrently` by hand on a large tenant). Existing indexes reused: `batch_input_lot_idx`, `batch_input_batch_idx`, `stock_movement_lot_idx`, `stock_movement_ref_idx`, `batch_movement_batch_idx`, `batch_movement_ref_idx`, `order_line_fired_idx`, `menu_push_time_idx`, `reservation_day_idx` |
| `…20261203100100_trace_lot_search.sql` | `app.trace_lot_search_json(p_tenant, p_role, p_q, p_ingredient, p_supplier, p_from, p_to, p_now)`, `public.trace_lot_search(p_q text, p_ingredient uuid, p_supplier uuid, p_from date, p_to date)`; `app.lot_capture_json(p_tenant, p_from, p_to, p_now)`, `public.lot_capture(p_from date, p_to date)` | Definers, empty `search_path`, `require_trace_reader()` first, tenant from `app.tenant_id()`, executable by `authenticated` only |
| `…20261203100200_trace_forward.sql` | `app.trace_lot_json(p_tenant, p_role, p_lot)`, `public.trace_lot(p_lot uuid)` | Forward trace (§3.3.1), including `lot.purchase` for owner/admin (D-P13) |
| `…20261203100300_trace_backward.sql` | `app.trace_batch_json`, `public.trace_batch(p_batch uuid)`; `app.trace_line_json`, `public.trace_order_line(p_line uuid)`; `app.trace_line_search_json(…, p_now)`, `public.trace_line_search(p_date date, p_menu_item uuid default null)` | Backward traces (§3.3.2–3.3.3) |
| `…20261203100400_push_sell_through.sql` | `app.push_sell_through_json(p_tenant, p_role, p_date, p_now)`, `public.push_sell_through(p_date date default null)` | `require_push_reader()` first (owner, admin, chef) |
| `…20261203100500_reservation_covers.sql` | `app.require_covers_reader()` (owner, admin, waiter, chef); `app.reservations_covers_json(p_tenant, p_date, p_now)`; `public.reservations_covers(p_date date default null)` | Counts only (§3.5) |

Invariant check for this list:
- balances derived only from ledgers: every quantity is a `sum()` over `stock_movement` / `batch_movement` at read time;
- ledgers append-only: no write anywhere; every new function is `stable`; S7 asserts none of them contains `insert`, `update`, `delete` (prosrc scan);
- procedures single transactions: no procedure added or changed;
- costs frozen: no cost read or written (trace) or only the frozen `push_price` passed through (sell-through);
- every table `tenant_id` + RLS: no table added; every function filters by the caller's tenant;
- ADR-018: no operational table added, so `purge_demo_data` already covers every row these functions read (S8).

### 3.3 Trace semantics

All three traces take the tenant from `app.tenant_id()`. An id that is unknown **or belongs to another tenant** gives the same P0002
`not_found` (no tenant enumeration).

#### 3.3.1 Forward: `trace_lot(p_lot)`

```
{ lot: { lotId, ingredient:{id,name}, supplier:{id,name}, lotCode|null, expiry|null, receivedOn, qtyReceived, unit,
         location:{id,name},
         invoice?:{id, number|null, date},                                    -- owner/admin only
         purchase?:{supplierItemId|null, supplierCode|null, description} },   -- owner/admin only (D-P13)
  raw: { received, intoBatches, intoPlates, wasted, counted, onHand, unit },  -- base unit, net of reversals; transfers net to 0
  batches: [ { batchId, lotCode, recipeName, producedAt, useBy, qtyFromLot, portionsInitial,
               splitFrom:{batchId,lotCode}|null, state,
               portions:{ sold, wasted, staffMeal, counted, remaining } } ], batchesTruncated,
  plates: [ { businessDate, menuItemId, name, lines, portions, firstAt, lastAt, via:"batch"|"direct" } ], platesTruncated,
  voided: { lines, portions },
  gaps: { lotCodeMissing: bool, unlottedSameIngredientBatches: int } }
```

- `batches`: every batch with a `batch_input` row of this lot, plus their split children (`app.batch_family`, D-P5); a child shows
  `qtyFromLot` null and `splitFrom`.
- `plates`: `batch_movement` type `consume`, ref `order_line`, on the family, **not reversed** (no row with `reverses_id` = its id), joined
  to `order_line` and `menu_item`; plus `stock_movement` type `consumption`, ref `order_line`, on this lot, not reversed (`via:"direct"`);
  grouped by business date of the movement and menu item; ordered by business date, then name.
- `voided`: consumes that were reversed by a void (ref `order_void`), counted once.
- `gaps.unlottedSameIngredientBatches`: batches whose `batch_input` has `raw_lot_id` null for the same ingredient, produced from the
  lot's `received_on` on (D-P3).
- `purchase`: `invoice_line.supplier_item_id`, `invoice_line.supplier_code`, `invoice_line.raw_description` of the lot's invoice line (the
  line as it was approved; `supplier_item` itself is mutable and is not read for this).

#### 3.3.2 Backward from a batch: `trace_batch(p_batch)`

```
{ batch: { batchId, lotCode, recipeName, recipeVersion, producedAt, useBy, portionsInitial, state,
           splitFrom:{batchId,lotCode}|null, root:{batchId,lotCode} },
  inputs: [ { ingredient:{id,name}, qty, unit, inherited: bool,
              lot: { lotId, lotCode|null, expiry|null, receivedOn, supplier:{id,name}, invoice?:{id, number|null, date} } | null } ],
  portions: { sold, wasted, staffMeal, counted, splitOut, remaining },
  plates: [ …as in 3.3.1, via always "batch" ], platesTruncated }
```

- `inputs` are the **root's** `batch_input` rows (`inherited: true` for a split child); `lot: null` is the unlotted shortfall slice.
- `portions` and `plates` are this batch only (not its children); `splitOut` is the net of its `split` movements.

#### 3.3.3 Backward from a served plate: `trace_line_search(p_date, p_menu_item)` and `trace_order_line(p_line)`

- `trace_line_search`: fired lines whose fire time falls in business day `p_date` (window `[kpi_cutoff_end(D−1), kpi_cutoff_end(D))`),
  optionally of one menu item: `{ businessDate, lines:[{lineId, menuItemName, tableName, firedAt, portions, weightG|null, state}], truncated }`.
  `p_date` in the future → P0001 `date_in_future`.
- `trace_order_line`: `{ line:{lineId, menuItemName, tableName, businessDate, firedAt|null, state, portions, weightG|null},
  batches:[{batchId, lotCode, recipeName, producedAt, portions, reversed}], rawDirect:[{ingredient, qty, unit, lot|null}],
  lots:[distinct lots reached through the batches' root inputs and the direct rows, each with supplier and (owner/admin) invoice]}`.
  A draft line answers with empty lists.
- **No guest data**: the reply has `tableName` and times only; no join to `reservation` or `reservation_contact` (Q-P10).

#### 3.3.4 Lot search and capture rate

- `trace_lot_search`: at least one of `p_q`, `p_ingredient`, `p_supplier` (else 22023 `query_invalid`). `p_q` normalised by
  `app.lot_code_norm`, length 1–64, matched as a **prefix** (`like norm || '%'` with `%`, `_` and `\` escaped; Q-P13). Without `p_q`, the date
  range applies: default `to` = business today, `from` = `to − 29`; `from > to` → 22023; `to` after today → P0001 `date_in_future`; range over
  `TRACE_MAX_RANGE_DAYS` → P0001 `range_too_long`. With `p_q`, dates apply only when given. Newest `received_on` first, then id; at most
  `TRACE_MAX_LOTS`. Each row: `{lotId, ingredient, supplier, lotCode|null, expiry|null, receivedOn, qtyReceived, unit, onHand}`.
- `lot_capture(p_from, p_to)`: over `raw_lot.received_on` in the range (same defaults and bounds):
  `{from, to, lots, withLotCode, bySupplier:[{supplierId, name, lots, withLotCode}]}`, suppliers ordered by missing codes desc, then name.

### 3.4 Push sell-through: `push_sell_through(p_date)`

- **Day:** `p_date` null → yesterday's business date (`app.business_date(now) − 1`); a date after today → P0001 `date_in_future`; today is
  allowed (figures so far, `ongoing: true`). Day window `[ds, de)` = `[app.kpi_cutoff_end(t, D−1), app.kpi_cutoff_end(t, D))` (DST-safe).
- **Periods:** `app.menu_push_periods(t, ds, least(de, now))`; each period's window `w = [greatest(started_at, ds), least(effective_end, de, now))`;
  empty windows are dropped. A push that spans two days appears on both, clipped.
- **Per period:**
  - `menuItemId`, `name` (current), `startedAt`, `endedAt` (ISO UTC), `ongoing`, `withDayPrice` (bool), `pushPrice` (**owner/admin only**);
  - `plates: { lines, portions }` = fired, not voided order lines of the item with `fired_at` in `w`, portions by `app.order_line_portions`;
  - `atRisk: [ { recipeKey, name, batches, atStart, soldDuring, wastedDuring, otherDuring, leftAtEnd, discardedAfter, sellThroughPct } ]` for
    each key of `batch_keys` with at least one batch that was **due soon at `w.start`** (`app.use_by_state(use_by, w.start) = 'due_soon'`,
    produced before `w.start`, portions at `w.start` > 0), together with its split children created inside `w`:
    - `atStart` = Σ portions of those batches from movements created up to `w.start`;
    - `soldDuring` = −Σ `consume` ref `order_line` created in `w` and never reversed (any plate, not only the pushed one; the screen says so);
    - `wastedDuring` = −Σ `waste` refs `batch_discard` and `order_void` created in `w`;
    - `leftAtEnd` = Σ portions from movements created before `w.end`;
    - `otherDuring` = `leftAtEnd − atStart + soldDuring + wastedDuring` (counts, staff meals, voids not yet settled: shown as "altro");
    - `discardedAfter` = −Σ `waste` ref `batch_discard` created from `w.end` to now;
    - `sellThroughPct` = `round(100 × soldDuring / atStart)` when `atStart > 0`, else null (computed once, in SQL);
  - an empty `atRisk` renders "Nessun lotto in scadenza all'avvio della spinta" (a push for a raw lot, or nothing due).
- **Totals:** `{ pushes, lines, portions }` only; portions at risk are not summed across pushes (two pushed plates can share one batch).
- **Roles:** owner, admin, chef (`app.require_push_reader`); waiter 42501. The role shaping the reply is the session's.

### 3.5 Reservations V2: `reservations_covers(p_date)`

- Roles: owner, admin, waiter, chef (`app.require_covers_reader`); null role (signed out, gated owner/admin at `aal1`) → 42501.
- `p_date` null → business today; allowed `today … today + app.forecast_days_ahead()` (6), else P0001 `date_out_of_range` (matches the
  forecast panel's day picker).
- Reply exactly `{ businessDate, services: [ { key, name, reservations, covers } ] }`: services in the order of the current service windows
  (as `reservations_day_json`), plus any other service key that has bookings that day; counts over `status in ('accepted','arrived','seated')`
  (D-P10). No other key. `reservations_day_json` is not changed (its counts still include pending for owner/admin/waiter).
- The chef's RLS on `reservation`, `reservation_contact`, `reservation_table`, `reservation_event`, `reservation_email` stays 0 rows (S6 asserts).

### 3.6 Lot capture at receiving (encouraged, not forced)

- **Server** (`src/server/invoices/review.ts`, `review-types.ts`, the strict reply schema): each review line gains
  `lotMissing: boolean` = `isStock && lotCode === null && !superseded`; the summary gains `stockLinesWithoutLot: number`. Approved
  invoices: computed from the posted lots (`raw_lot.lot_code` null).
- **Screens:** `review-line.tsx` shows a chip "Lotto mancante"; `line-editor.tsx` shows under the Lotto field the hint "Copia il lotto
  dall'etichetta della confezione, se c'è."; `approval-panel.tsx` shows, when the count is above 0, "3 righe di magazzino senza lotto.
  Puoi aggiungerlo ora; dopo l'approvazione non si potrà più." with "Mostra la prima" (scrolls to the first marked line) and the existing
  "Approva" button unchanged (still enabled).
- **No SQL change**: `update_invoice_line` already accepts `lot_code` and `expiry`; `approve_invoice` already copies them.
- **Capture rate**: `lot_capture` (§3.3.4), shown on `/tracciabilita`.

### 3.7 API routes (`withApi`, Zod 4, `Cache-Control: no-store`, strict reply schemas per role)

| Route | Roles (403 before any RPC otherwise) | Query / params (Zod) | Reply | Errors |
|---|---|---|---|---|
| `GET /api/trace/lots` | owner, admin, chef | `q` `z.string().trim().min(1).max(64)` optional; `ingredientId`, `supplierId` `z.uuid()` optional; `from`, `to` `z.iso.date()` optional; refine: one of q/ingredientId/supplierId | `traceLotSearchOutput` | 400 invalid; 422 `date_in_future`, `range_too_long`; 401; 403 |
| `GET /api/trace/capture` | owner, admin, chef | `from`, `to` optional dates | `lotCaptureOutput` | 400; 422 |
| `GET /api/trace/lots/[id]` | owner, admin, chef | `id` `z.uuid()` (malformed → 404 without RPC) | `traceLotOutput` (owner/admin, with `invoice` and `purchase`) or `traceLotChefOutput` (neither) | 404 `not_found` |
| `GET /api/trace/batches/[id]` | owner, admin, chef | `id` uuid | `traceBatchOutput` / chef variant | 404; 422 `trace_depth_exceeded` |
| `GET /api/trace/lines` | owner, admin, chef | `date` `z.iso.date()` required; `menuItemId` uuid optional | `traceLineSearchOutput` | 400; 422 `date_in_future` |
| `GET /api/trace/lines/[id]` | owner, admin, chef | `id` uuid | `traceOrderLineOutput` / chef variant | 404 |
| `GET /api/reports/push-sell-through` | owner, admin, chef | `date` optional | `pushSellThroughOutput` (owner/admin) / `pushSellThroughChefOutput` (no `pushPrice`) | 400; 422 `date_in_future` |
| `GET /api/reservations/covers` | owner, admin, waiter, chef | `date` optional | `reservationsCoversOutput` (exact keys) | 400; 422 `date_out_of_range` |
| `GET /api/invoices/[id]/review` (changed reply) | as today (owner, admin) | as today | + `lines[].lotMissing`, `summary.stockLinesWithoutLot` | as today |

- Files: `src/server/trace/{constants,schemas,output,errors,lots,capture,forward,batch,lines}.ts`; `src/server/push/sell-through.ts`
  (+ `schemas.ts`, `output.ts`); `src/server/reservations/covers.ts` (+ `schemas.ts`, `output.ts`); routes under `src/app/api/trace/…`,
  `src/app/api/reports/push-sell-through/route.ts`, `src/app/api/reservations/covers/route.ts`.
- Error mapping: P0002 → 404; 22023 → 400; P0001 listed codes → 422; 42501 → 403; `mfa_required` as today (P2-1). A reply that fails its
  strict schema → 500 (reported by code only).
- Not offline-cached: `OFFLINE_CACHE_PATHS` unchanged (asserted).

### 3.8 Screens (Italian first; 360 px first; targets ≥ 44 px; amounts `1.234,50 €`; dates and times Europe/Rome; every value from `/api/*`)

- **Nav:** `/tracciabilita` "Tracciabilità" in group `cucina`, `canTrace` = owner, admin, chef (`src/lib/nav/nav-model.ts`).
- **`/tracciabilita`** (`src/app/(owner)/tracciabilita/{page,lot-search,lot-results,line-search,capture-card}.tsx`):
  - tabs "Da un lotto" (code field "Codice lotto", or Ingrediente + Fornitore + "Dal"/"Al") and "Da un piatto servito" (Giorno + optional Piatto);
  - lot rows: "Farina Demo · Fornitore Demo 1 · consegna 13 nov · lotto L-DEMO-0001 · scad. 20 nov" or "Lotto fornitore non registrato";
  - capture card: "Lotti registrati negli ultimi 30 giorni: 18 su 25 consegne", per supplier on tap.
- **`/tracciabilita/lotto/[id]`**: header card (owner/admin also "Articolo: <codice fornitore> · <descrizione in fattura>" from `purchase`);
  sections "Lotti di produzione" (each row links to the batch trace), "Piatti serviti" (per day: "13 nov · Lasagne Demo · 14 piatti (14 porz.) ·
  12:40–14:55"), "Annullati dopo l'invio", "Scarti", "Ancora in magazzino"; gap banner "Alcuni dati mancano: …" when `gaps` is set.
  Owner/admin: invoice link "Fattura n. … del …" to `/fatture/[id]`.
- **`/tracciabilita/produzione/[id]`**: "Da dove viene" (ingredient → lot → supplier; "Senza lotto" rows; "ereditato dal lotto padre …" for a
  split child), "Dove è andato" (portions and plates).
- **`/tracciabilita/piatto/[lineId]`**: the plate, its batches, its direct raw lots, the distinct lots.
- **Links:** `/produzione/[id]` gets "Tracciabilità"; `/magazzino/[ingredientId]` lot rows get "Traccia".
- **`/spingere`**: section "Com'è andata" (`src/app/(owner)/spingere/sell-through-panel.tsx`): day stepper "‹ Ieri ›" (no step past today;
  "Oggi (in corso)"); one card per push: "Lasagne Demo · in evidenza 11:05–02:00 · 14 piatti venduti"; per at-risk batch key: "Ragù Demo:
  10 porzioni in scadenza all'avvio → 8 vendute (80%), 1 scartata, 1 rimasta; scartate dopo: 1"; the footnote "Le porzioni vendute
  includono altri piatti con lo stesso preparato." Owner/admin: "Prezzo del giorno 12,00 €".
- **`/produzione`** forecast panel: a line "Prenotati (confermati): Pranzo 12 coperti · 4 prenotazioni — Cena 30 coperti · 9 prenotazioni"
  (`src/app/(owner)/produzione/booked-covers.tsx`) for the panel's selected day; "Nessuna prenotazione confermata" when all zero.
- **Invoice review**: §3.6.

### 3.9 RLS / role matrix

Owner and admin rows assume the P2-1 gate is satisfied (`aal2` when required); a gated owner/admin at `aal1` gets null from `app.role()`,
so every function below raises 42501 and every RLS read returns 0 rows. **Platform admin:** there is no platform role in Postgres on `main`;
per ADR-037 (FD29) DigiAlto's platform account holds `admin` in a tenant and is MFA-gated (`20261202100000`), so it is the admin column.
`anon` and `service_role` get no execute grant on any new function.

| Object / field | owner | admin | chef | waiter | Enforcement (Postgres) |
|---|---|---|---|---|---|
| `trace_lot_search`, `lot_capture` | ✓ | ✓ | ✓ | 42501 | `app.require_trace_reader()` first |
| `trace_lot`, `trace_batch`, `trace_order_line`, `trace_line_search` | ✓ | ✓ | ✓ | 42501 | same |
| — `invoice` key (id, number, date) in trace replies | ✓ | ✓ | absent | — | built only when role in owner/admin (session role, not a parameter) |
| — `purchase` key (supplier item id, supplier code, invoice description) in `trace_lot` | ✓ | ✓ | absent | — | same (D-P13; `supplier_item` and `invoice_line` are owner/admin data) |
| — any cost/price/€ key in trace replies | absent | absent | absent | — | none built; S7 money-key scan |
| — guest name/phone/e-mail in trace replies | absent | absent | absent | — | no join to reservation tables; S7 key scan |
| `push_sell_through` | ✓ | ✓ | ✓ | 42501 | `app.require_push_reader()` |
| — `pushPrice` | ✓ | ✓ | absent | — | built only for owner/admin |
| `reservations_covers` (counts only) | ✓ | ✓ | ✓ | ✓ | `app.require_covers_reader()`; reply keys exactly the five of §3.5 |
| `reservation`, `reservation_contact`, `reservation_table`, `reservation_event`, `reservation_email` (tables) | RLS as today | as today | **0 rows** | as today | unchanged policies (S6 asserts) |
| `raw_lot`, `batch`, `batch_input`, `batch_movement` (tables) | read | read | read | 0 rows | unchanged |
| `stock_movement`, `order_line`, `order_line_cost`, `batch_cost`, `invoice`, `invoice_line`, `supplier_item`, `menu_push` (tables) | read | read | 0 rows | 0 rows | unchanged; the chef reaches the needed facts only through the definers above |
| Review reply `lotMissing`, `stockLinesWithoutLot` | ✓ | ✓ | — | — | review route roles unchanged (owner/admin) |
| Routes | as rows above | | | | `withApi` roles → 403 before any RPC; Postgres repeats the check |

### 3.10 Security and privacy

- **Auth:** every route through `withApi` with explicit roles; every SQL function a definer with an empty `search_path`, role helper first,
  tenant from the session; executable by `authenticated` only. pgTAP 341's gate-coverage scan must stay green (each new function reaches
  `app.role()`).
- **IDOR:** ids are looked up with `tenant_id = app.tenant_id()`; another tenant's id → the same 404 as an unknown id.
- **Input:** Zod on every query param (uuid, ISO date, `q` ≤ 64); SQL repeats the bounds; the `like` pattern escapes `%`, `_`, `\`; no
  dynamic SQL.
- **Costs:** no cost in trace replies; `pushPrice` only owner/admin; the chef and waiter replies are parsed by strict schemas that forbid extra
  keys; S7 runs `app.payload_money_keys` over every key of every chef reply. pgTAP `waiter_cost_columns` (M0 AT10) is unchanged and green.
- **Personal data:** covers are counts; the trace shows table names (not personal) and times; no join to reservation data. No new personal data
  is stored. A supplier that is a sole trader appears by its business name, as in every existing supplier screen (project Q13 unchanged).
  **Logs:** routes report error codes only (`reportError` spy test); never the reply, the lot code `q`, ids or table names; Sentry scrubbing
  unchanged.
- **Rate limiting:** authenticated staff reads with bounded result sets (D-P12); no new limiter.
- **Secrets:** none new. Application secrets stay in Vercel env, database secrets in Supabase Vault, account logins in the owners' password
  manager (Q26). No route uses the Supabase secret key (`tests/guards/admin-client-importers.test.ts` and `privileged-importers.test.ts`
  green unchanged). No provider, no API key.
- **CSP:** no new origin, no inline script; pages use the existing nonce policy (ADR-028).

### 3.11 Performance (phone on 4G)

- One RPC per screen; replies aggregated (plates per business day and dish, not per line) and capped (D-P12), so the payload stays small
  regardless of how long a lot was used.
- Index paths: lot search → `raw_lot_lot_code_norm_idx` / `raw_lot_received_idx` / `raw_lot_supplier_idx`; lot → batches
  `batch_input_lot_idx`; family walk `batch_split_from_idx`; batch → plates `batch_movement_batch_idx` then `order_line` by primary key;
  direct plates `stock_movement_lot_idx`; line → movements `batch_movement_ref_idx`, `stock_movement_ref_idx`; sell-through day
  `menu_push_time_idx` and `order_line_fired_idx`; covers `reservation_day_idx`.
- S7 is the perf net in the pgTAP 241 convention: a seeded large fixture (one lot feeding 300 batches and 20 000 fired lines; 60 days of
  pushes) must answer every new function under `statement_timeout = '5s'`, and `EXPLAIN` of the lot search and the forward trace must name
  the indexes above. No response-time number is promised; the `perf-4g` Playwright project records the trace page timing as information only.

### 3.12 Sequences

1. **Recall:** `/tracciabilita` → `GET /api/trace/lots?q=L-DEMO` → `trace_lot_search` → tap a row → `GET /api/trace/lots/:id` → `trace_lot`
   → tap a batch → `GET /api/trace/batches/:id` → `trace_batch`.
2. **Complaint:** "Da un piatto servito" → `GET /api/trace/lines?date=…&menuItemId=…` → `trace_line_search` → tap a line →
   `GET /api/trace/lines/:id` → `trace_order_line`.
3. **Push review:** `/spingere` → `GET /api/reports/push-list` (as today) and `GET /api/reports/push-sell-through` (yesterday) in parallel.
4. **Chef prep:** `/produzione` forecast panel day D → `GET /api/reports/forecast?date=D` (as today) and `GET /api/reservations/covers?date=D`
   in parallel.
5. **Receiving:** `/fatture/:id/revisione` → `GET /api/invoices/:id/review` (now with `lotMissing`) → owner types the lot →
   `PATCH /api/invoices/:id/lines/:lineId` (as today) → approval panel shows the remaining count → "Approva" (as today).

### 3.13 Future: local producers and origin (founder 2026-11-14; design only, nothing stored in P2-2)

The founder wants, later, a network where local food and drink producers sign up and reach Costì venues (owners discover new suppliers,
smart suggestions, perhaps producer offers, local traceability; examples given: Cinta Senese, Chianti Classico). **That network is a
separate plan (branch `docs/local-producers-plan`) and is not planned here.** This section only fixes where origin data belongs, so the
P2-2 trace can carry it later without rework.

#### 3.13.1 Which entity holds what (recommendation)

| Datum | Recommended home | Why not the others |
|---|---|---|
| **Protected designation** (DOP/PDO, IGP/PGI, STG/TSG, wine DOCG/DOC/IGT) and its registered name | **`supplier_item`** (the product as a supplier sells it), with an optional reference to the official EU register entry | Not `ingredient`: the venue's "Vino rosso" or "Prosciutto" may be bought both with and without a designation, and one recipe ingredient can be fed by both. Not `supplier`: a wholesaler sells many products, only some designated. The designation is a property of the product sold |
| **Producer** (the farm, winery or maker) | **`supplier_item`** as the default producer; the lot snapshot (below) records the producer actually received | Not `supplier`: the supplier is often a distributor, not the producer. When the supplier *is* the producer (a local farm), a flag on `supplier` ("is producer") links the two; that flag belongs to the producer-network plan |
| **Place of origin** (area, municipality, region, country) | Default on **`supplier_item`**; the actual value per delivery in the **lot snapshot** | Origin of meat, fish or produce can change from delivery to delivery for the same article, so only the lot can say what was actually received |
| **What was actually received** (producer, origin, designation at that moment) | A **frozen, append-only origin snapshot per `raw_lot`** written in the approval transaction (like costs frozen at production and sale) | `supplier_item` is mutable (its `last_price` and pack change), so reading it at trace time would rewrite history; `raw_lot` itself is append-only and cannot gain columns' values after insert. A side table keyed by `raw_lot_id` keeps both rules |

Consequences: the trace's lot block (D-P13 `purchase`) is the join point; later the forward and backward traces add an `origin` object
read from the lot snapshot, and the plate view can say "Lasagne Demo ← Ragù Demo ← <designated product>" without any change to batches or
orders (origin flows through `batch_input` → `raw_lot` like the lot code does).

#### 3.13.2 Built in P2-2 (cheap and used now)

- `lot.purchase` in the owner/admin forward trace (D-P13): the supplier's article code and the invoice line description, used today to
  match a recall letter, and the anchor for H1–H3.
- Nothing else: no column, no table, no reserved null keys in the replies (strict schemas would only have to be relaxed later anyway).

#### 3.13.3 What the P2-7 XML e-invoice upload can fill (FatturaPA, checked against the official specification)

Checked in **Allegato A – Specifiche tecniche, versione 1.9.1** (Agenzia delle Entrate), §2.2.10.1 *DettaglioLinee* (pages 90–94):

- The line block holds `NumeroLinea`, `TipoCessionePrestazione`, `CodiceArticolo` (**0..N**, each `CodiceTipo` alphanumeric ≤ 35 and
  `CodiceValore` ≤ 35), `Descrizione` (≤ 1000), `Quantita`, `UnitaMisura`, `DataInizioPeriodo`, `DataFinePeriodo`, `PrezzoUnitario`,
  `ScontoMaggiorazione`, `PrezzoTotale`, `AliquotaIVA`, `Ritenuta`, `Natura`, `RiferimentoAmministrazione` and `AltriDatiGestionali` (**0..N**,
  each `TipoDato` ≤ 10, `RiferimentoTesto` ≤ 60, `RiferimentoNumero`, `RiferimentoData` YYYY-MM-DD).
- **There is no dedicated field for lot, expiry, origin, producer or designation.** The specification's own example of `CodiceTipo` values
  are classification schemes such as TARIC, CPV, EAN, SSC (and a mandatory "CARB" label for fuel), not lots.
- Therefore, for P2-7:
  - **Lot and expiry** can be read only when a supplier writes them in `AltriDatiGestionali` (e.g. a `TipoDato` such as "LOTTO" with the code
    in `RiferimentoTesto`, and a "SCADENZA" with `RiferimentoData`) or in `CodiceArticolo`. The labels are **not standardised**, so P2-7 should
    map them per supplier from configured labels and treat everything else as not present; it should not parse lots out of `Descrizione`
    deterministically (free text). Real sample XML files (project Q1) decide which suppliers do this.
  - **Product identity:** `CodiceArticolo` with an EAN (or the supplier's own code) maps the line to `supplier_item` more reliably than the
    description hash; this is what later lets origin defaults on `supplier_item` apply automatically.
  - **Producer, origin and designation:** not carried by any structured field; at most mentioned in `Descrizione`. P2-7 should **not** try to
    fill them. They come from the supplier item set-up (owner, or later the producer network).
  - The supplier (`CedentePrestatore`) is the seller, which is the producer only for direct-from-farm purchases.
- This is a P2-7 planning input, not a P2-2 step.

#### 3.13.4 Named hooks (not built; each to be planned in the producer-network plan or P2-7)

| # | Hook | Where it plugs in |
|---|---|---|
| H1 | `supplier_item` origin defaults: producer reference, place of origin, designation type and registered name, optional EU register reference | M1 master data; owner/admin setting; RLS as `supplier_item` |
| H2 | `raw_lot_origin` append-only snapshot (producer, origin, designation) written inside `approve_invoice` from the line and its `supplier_item` | Re-pins `approve_invoice` (single transaction); joins the purge list (ADR-018) and the export list (ADR-040) in the same step |
| H3 | `origin` object in `trace_lot`, `trace_batch`, `trace_order_line` (all roles that can trace; no money) | The P2-2 functions, replaced on purpose |
| H4 | P2-7: per-supplier mapping of `AltriDatiGestionali` / `CodiceArticolo` labels to `invoice_line.lot_code` and `expiry` | P2-7 parser; the review screen shows them as "dal file XML" so the nudge of §3.6 disappears for those lines |
| H5 | P2-7: `CodiceArticolo` (EAN or supplier code) used to map lines to `supplier_item` | P2-7 auto-mapping (M4 rules) |
| H6 | `supplier.is_producer` and a producer identity shared across tenants | Producer-network plan only; it is the first cross-tenant entity and needs its own ADR (tenant isolation, ADR-003) and data-protection review (sole-trader producers) |
| H7 | Designation names validated against the official EU register (eAmbrosia) instead of free text | Producer-network plan; no external call from P2-2 |

### 3.14 Questions to outside parties: method (founder rule 2026-11-14)

Before asking, official sources are read and fact-checked; each party gets **one** question with our recommended answer, so they can reply
"yes" or correct it. No questionnaires, no chains. Facts used for the questions in §7.1:
- **Traceability duty (for the HACCP consultant's question):** Regulation (EC) No 178/2002, Art. 18, requires food business operators to
  identify the businesses that supplied them ("one step back") and the businesses they supplied, except final consumers; going further is
  generally contractual practice. Implementing Regulation (EU) No 931/2011 adds information duties for food of animal origin between
  businesses. Read through secondary sources and EUR-Lex excerpts (EUR-Lex itself was not reachable from this session); **the consultant
  confirms, this plan states no law.** The app already records the supplier, invoice and date of every delivery; the lot code and the
  plate-level trace go beyond the one-step duty.
- **Reservations data (for the data-protection adviser's question):** reservations plan §3.9 (purposes, retention, recipients). P2-2 adds no
  personal data and no new recipient: the chef receives counts only.

## 4. Alternatives considered

- **A materialised trace table (lot → batch → line) filled by the write procedures:** rejected. It would change `produce_batch`,
  `fire_course`, `void_line` and `split_batch` (pinned, single-transaction procedures), add a table to the purge and export lists, and
  duplicate links the ledgers already hold (`batch_input`, `batch_movement` ref `order_line`).
- **Views with `security_invoker` instead of definer functions:** rejected. The chef must not read `order_line` or `stock_movement` rows
  (they carry prices/costs), yet the trace needs facts from them; a definer with a fixed, cost-free shape is the house pattern (M12 stock reads,
  M19 kitchen reads).
- **Making the lot code mandatory at approval:** rejected as the default (scope says "encouraged"; real invoices may not print one); kept as
  V2 for categories the HACCP consultant names.
- **Allowing a lot code to be edited on `raw_lot` after approval:** rejected: `raw_lot` is append-only (ADR-002). An append-only note is V1.
- **Origin columns now (on `ingredient` or `supplier`):** rejected. Wrong entity (§3.13.1), nothing reads them in P2-2, and the producer
  network will decide the shared producer identity; adding them now would mean a migration and a purge-list change to undo later.
- **Parsing lot and origin out of the invoice description in P2-7:** rejected for P2-7 by recommendation: free text is not deterministic,
  and P2-7 is deterministic by decision (C19).
- **Sell-through as "plates sold vs. the usual weekday" only:** rejected as the default. It needs four weeks of history to mean anything and does
  not say whether the at-risk batch was saved, which is what the push is for; kept as V3.
- **Sell-through counting only lines at the push price (`price_source = 'push'`):** rejected: a push without a day price leaves
  `price_source = 'menu'`, so those sales would disappear.
- **Showing the chef the full reservation day with names hidden in the UI:** rejected: names would still reach the phone; roles are enforced in
  Postgres (D9, CLAUDE.md rule 6).
- **Lot search by substring (trigram):** rejected for now: needs `pg_trgm` and its index; recall letters give the full code, so a prefix
  ignoring spaces and case is enough (Q-P13).
- **New dependency:** none.

## 5. Build plan (test first: each step's named test is written and seen failing, then the code; one commit per step)

### Shared lists changed on purpose

| List | Change | Step |
|---|---|---|
| `tests/config/p2-2-preserves.test.ts` **new** | the `20261203*` files in step order; created tables **none**; altered tables **none**; replaced functions **none**; the new functions of §3.2 | S1 (grown each step) |
| `tests/config/{m25a,m25,m25b,m25c,p2-0b,p2-1,…}-preserves.test.ts` (`AFTER_MAIN` / allowed-migration lists) | the `20261203*` names allowed | S1–S6 |
| pgTAP files pinning the list of `public` functions (found with `grep -ln "push_list\b" supabase/tests/database`, e.g. 229) | the eight new public functions added | S2–S6 |
| `src/lib/nav/nav-model.ts`, `tests/lib/nav/nav-model.test.ts`, `e2e/app-shell.spec.ts` route lists | `/tracciabilita` for owner, admin, chef | S13 |
| i18n `src/lib/i18n/messages/{it,en}.ts` | new keys; key parity test green | S13–S17 |
| Review reply schema (`src/server/invoices/review-types.ts`) | two fields added | S12 |
| **Unchanged on purpose** (md5 in 359): `public.approve_invoice`, `public.produce_batch`, `public.split_batch`, `public.discard_batch`, `public.adjust_batch`, `public.fire_course`, `public.void_line`, `public.push_menu_item`, `app.push_list_json`, `app.menu_push_periods`, `app.discards_vs_push_json`, `app.forecast_json`, `app.reservations_day_json`, `app.kpi_sales_lines`, `app.order_line_portions`, `app.demo_purge_tables`, `app.tenant_has_operational_data`, `app.payload_money_keys`, `app.tenant_id`, `app.role`, `app.app_user_id`; `cron.job` names; the alert registry; `OFFLINE_CACHE_PATHS` | — | S8 |

### Steps

| # | Step (one commit) | Files | Test that proves it (written first, must fail first) |
|---|---|---|---|
| S1 | **Trace core: gate, lot-code normaliser, family walk, constants, indexes** | `supabase/migrations/20261203100000_trace_core.sql`; `supabase/tests/database/352_trace_core.test.sql`; `tests/config/p2-2-preserves.test.ts`; the earlier preserves files | **Gate:** `app.require_trace_reader()` passes for owner, admin, chef; 42501 for waiter, a signed-out session and an admin at `aal1` (P2-1 claims). **Normaliser:** `' l-demo 0001 '` → `'L-DEMO0001'`; null → null; immutable. **Family:** root R split into C1 then C1 into C2 → `batch_family(R)` = {R, C1, C2} with depths 0,1,2; `p_until` before C2's creation excludes C2; `batch_root(C2)` = R; another tenant's batch never appears; a forged 51-deep chain (inserted as the test owner) → P0001 `trace_depth_exceeded`. **Indexes** exist with the exact definitions. **Constants** equal §3.1 D-P12. **Preserves:** only `20261203*` files after `20261202100000`; no `create table`, `alter table`, `create trigger`, `create or replace` of an existing function in them |
| S2 | **Lot search and capture rate** | `…20261203100100_trace_lot_search.sql`; `supabase/tests/database/353_trace_lot_search.test.sql` | Fixture (tenant A, `p_now` 1998-11-14 12:00 Rome): lots `L-DEMO-0001` (Farina, Fornitore 1, 1998-11-02), `l-demo 0002` (Farina, Fornitore 2), a Farina lot without code, B's `L-DEMO-0001`. `q='l-demo-000'` → A's two coded lots, newest first, never B's; `q='L-DEMO-0001'` → one; `q='%'` and `q='_'` → nothing (escaped); `q` of 65 chars → 22023; no filter → 22023 `query_invalid`; `ingredient` = Farina, default range → all three (the uncoded one with `lotCode` null); `to` = tomorrow → `date_in_future`; 367-day range → `range_too_long`; 51 matching lots → 50 and `truncated` true. `onHand` equals the ledger fold (a consumption and its reversal net to 0). **Capture:** 3 lots, 2 with code; `bySupplier` ordered by missing desc. **Roles:** waiter → 42501; chef → ok. **Keys:** no reply key matches the money-key rule |
| S3 | **Forward trace** | `…20261203100200_trace_forward.sql`; `supabase/tests/database/354_trace_forward.test.sql` | **Recall fixture** (all through the real procedures as the fixture users: `approve_invoice`, `produce_batch`, `split_batch`, `discard_batch`, `fire_course`, `void_line`, staff meal): lot X of Farina feeds batch B1 (Ragù) and batch B2; B1 is split into C1; plates Lasagne fired from B1 on business day D (12:40, 13:10) and from C1 on D+1 at 01:30 (**business day D**, cut-off 02:00) and at 19:00 D+1; one Lasagne line voided after fire; one Tagliatelle plate consumes lot X directly (raw line). `trace_lot(X)` → `batches` = B1, B2, C1 (C1 with `splitFrom` B1, `qtyFromLot` null); `plates` = D Lasagne lines from B1 and C1 (the voided one excluded, the 01:30 plate grouped on D); D+1 Lasagne 1; D Tagliatelle `via:"direct"`; `voided` = 1 line; `raw.intoBatches` = Σ batch_input qty; a reversed stock consumption is not counted; a transfer moves nothing in `raw`; `portions` per batch add up to `portionsInitial` (sold + wasted + staffMeal + counted + split + remaining). **Weight line:** a 350 g Lasagne line with reference 250 g → portions 1.4 in its group. **Gaps:** lot X without code → `lotCodeMissing`; a later Farina batch produced on a negative balance → `unlottedSameIngredientBatches` 1. **DST:** a plate fired 1998-03-29 01:30 Rome (the spring change night) groups on business day 1998-03-28; one fired 1998-10-25 01:30 (autumn) groups on 1998-10-24. **Purchase (D-P13):** owner reply has `lot.purchase` = the invoice line's supplier item id, supplier code and description *as approved*; after the test owner changes the `supplier_item`'s pack, `purchase` is unchanged. **Roles/keys:** owner reply has `lot.invoice {id, number, date}`; chef reply has no `invoice` and no `purchase` key anywhere (recursive scan); waiter → 42501; B's lot id and an unknown id → the same P0002 `not_found`. **Caps:** 401 plate groups → 400 and `platesTruncated` |
| S4 | **Backward traces and line search** | `…20261203100300_trace_backward.sql`; `supabase/tests/database/355_trace_backward.test.sql` | On the S3 fixture: `trace_batch(C1)` → `root` B1, `inputs` = B1's inputs with `inherited:true`, each with lot, supplier, (owner) invoice; a batch produced partly from unlotted stock → one input with `lot:null`; `portions.splitOut` on B1 = −(C1's portions). `trace_line_search(D)` → the D lines (the 01:30 D+1 line included, the 19:00 D+1 line not), `tableName` from the session snapshot; with `p_menu_item` = Tagliatelle → one line; tomorrow → `date_in_future`. `trace_order_line(lasagne line)` → its batch, `lots` = lot X with supplier; the voided line → `state` voided and `batches[].reversed` true; the Tagliatelle line → `rawDirect` lot X; a draft line → empty lists. **Privacy:** a seated reservation with a fixture guest exists on the traced table; no key of any reply matches `/phone\|email\|guest\|contact/i` and no value equals the guest's name, phone or e-mail. **Roles/tenancy** as S3 |
| S5 | **Push sell-through** | `…20261203100400_push_sell_through.sql`; `supabase/tests/database/356_push_sell_through.test.sql` | Fixture (business day D = 1998-11-13, `p_now` D+1 10:00): Ragù batch R1 (use-by D 23:00 → due soon at push start 11:00), R2 (use-by D+3, not due); Lasagne pushed 11:00 until end of day with a day price; 8 Lasagne portions sold from R1 during the push (one more voided after fire), 1 R1 portion discarded during the push, a staff meal of 1, R1 split into R1c at 15:00 (R1c sells 1); 1 portion of R1c discarded the next morning. Reply for D: one push; `plates.lines` excludes the voided line; `atRisk` has only Ragù with `atStart` = R1's portions at 11:00 (R2 excluded), `soldDuring` 9 (8 + R1c's 1), `wastedDuring` 1 + the void's waste, `otherDuring` = −1 (staff meal), `leftAtEnd` matches the fold, `discardedAfter` 1, `sellThroughPct` = round(100·9/atStart). A push **stopped** at 13:00 ends its window there; a push started D−1 with `push_until` in D is clipped to `[ds, …)`; a push with empty `batch_keys` → `atRisk` []. `p_date` null → D (yesterday); today → `ongoing` true and window end = `p_now`; tomorrow → `date_in_future`. **DST:** D = 1998-03-28 → window end = `kpi_cutoff_end(1998-03-28)`, and a line at 1998-03-29 01:59 Rome (CEST) counts in D. **Weight:** a weighed Lasagne line counts its fraction in `plates.portions`. **Roles:** owner/admin have `pushPrice`; chef has none (recursive key scan) but has `withDayPrice`; waiter → 42501 |
| S6 | **Reservations V2 covers** | `…20261203100500_reservation_covers.sql`; `supabase/tests/database/357_reservation_covers.test.sql` | Fixture day D (1998): Pranzo: accepted 2, arrived 4, pending 6, declined 3; Cena: seated 5, no_show 2, cancelled 4; a booking under a retired service key `brunch` (accepted 2). `reservations_covers(D)` → `[{pranzo, Pranzo, 2, 6}, {cena, Cena, 1, 5}, {brunch, brunch, 1, 2}]` in window order then the extra key; parity: for every service, `covers` equals the sum of `party` over accepted/arrived/seated rows of `reservations_day_json` on the same fixture. Reply keys exactly `businessDate, services, key, name, reservations, covers` (recursive); no value equals any fixture guest name, phone or e-mail. `p_date` null → today; today+6 ok; today+7 and yesterday → `date_out_of_range`. **Roles:** owner, admin, waiter, chef → ok; gated admin at `aal1` → 42501; **the chef still reads 0 rows** from `reservation`, `reservation_contact`, `reservation_table`, `reservation_event`, `reservation_email`; tenant B's bookings never counted |
| S7 | **Role matrix, key scans and perf net** | `supabase/tests/database/358_p22_roles_perf.test.sql` | **Matrix:** the eight new public functions × {owner, admin, chef, waiter, PIN waiter, admin at `aal1`, owner B} → exactly §3.9 (42501 vs ok; B gets `not_found` or zero counts). **Grants:** each is `prosecdef`, `search_path=''`, executable by `authenticated` only (not `anon`, not `service_role`). **Read-only:** no new function's `prosrc` contains `insert`, `update`, `delete`, `truncate` (word match). **Money keys:** every key of every chef reply (S3–S6 fixtures) fails `app.payload_money_keys`; trace replies for owner too. **Waiter cost columns** (M0 AT10) unchanged. **Perf:** seeded large fixture (1 lot → 300 batches → 20 000 fired lines; 60 days of pushes; 2 000 reservations) — every function answers under `statement_timeout = '5s'`; `EXPLAIN (format json)` of `trace_lot_search` (by code) and `trace_lot` names `raw_lot_lot_code_norm_idx` and `batch_input_lot_idx` |
| S8 | **SQL preserves and invariants** | `supabase/tests/database/359_p22_preserves.test.sql` | md5 of `pg_get_functiondef` of every "unchanged on purpose" function equals its value on the rebased `main` (written into the test); the set of `public` tables and their columns equals `main`'s (no new table, no origin column); `app.demo_purge_tables()` unchanged; pgTAP 194 and 196 green unchanged; `cron.job` names and the alert registry unchanged; no new trigger |
| S9 | **Trace server and routes** | `src/server/trace/{constants,schemas,output,errors,lots,capture,forward,batch,lines}.ts`; `src/app/api/trace/lots/route.ts`; `src/app/api/trace/lots/[id]/route.ts`; `src/app/api/trace/capture/route.ts`; `src/app/api/trace/batches/[id]/route.ts`; `src/app/api/trace/lines/route.ts`; `src/app/api/trace/lines/[id]/route.ts`; `tests/app/api/trace.test.ts`; `tests/parity/trace-constants.test.ts` | **Parity:** TS caps equal the SQL constants (read from the migration text). **Routes:** waiter → 403 with 0 RPCs; signed out → 401; malformed uuid → 404 with 0 RPCs; `q` 65 chars → 400 with 0 RPCs; no filter → 400; P0002 → 404; `date_in_future`/`range_too_long`/`trace_depth_exceeded` → 422; owner reply with `invoice` and `purchase` passes the owner schema; a chef reply containing `invoice` or `purchase` → 500 (strict chef schema); `Cache-Control: no-store`. **Hygiene:** `reportError` spy sees codes only, never `q`, ids or table names; `OFFLINE_CACHE_PATHS` equality |
| S10 | **Sell-through server and route** | `src/server/push/{sell-through,schemas,output}.ts`; `src/app/api/reports/push-sell-through/route.ts`; `tests/app/api/push-sell-through.test.ts` | Waiter → 403, 0 RPCs; `date=2026-13-01` → 400; chef reply with `pushPrice` → 500; owner reply parsed; `date_in_future` → 422; no-store |
| S11 | **Covers server and route** | `src/server/reservations/{covers,schemas,output}.ts`; `src/app/api/reservations/covers/route.ts`; `tests/app/api/reservations-covers.test.ts` | Chef → 200 with counts only; waiter → 200; a reply with an extra key (e.g. `names`) → 500; `date_out_of_range` → 422; malformed date → 400 with 0 RPCs |
| S12 | **Lot fields in the review reply** | `src/server/invoices/{review,review-types}.ts`; `tests/server/invoices/review-lot.test.ts` | A stock line without lot → `lotMissing` true; with lot → false; a non-stock line → false; a superseded (split) parent → false; `summary.stockLinesWithoutLot` = 2 on a 4-line fixture; an approved invoice computes from the posted lots; existing review tests green (snapshots updated on purpose) |
| S13 | **Nav and `/tracciabilita` pages** | `src/lib/nav/nav-model.ts`; `src/app/(owner)/tracciabilita/{page,lot-search,lot-results,line-search,capture-card}.tsx`; `src/app/(owner)/tracciabilita/lotto/[id]/page.tsx`; `src/app/(owner)/tracciabilita/produzione/[id]/page.tsx`; `src/app/(owner)/tracciabilita/piatto/[lineId]/page.tsx`; `src/lib/trace/trace-view.ts`; `src/lib/i18n/messages/{it,en}.ts`; `tests/lib/nav/nav-model.test.ts`; `tests/components/trace-pages.test.ts`; `tests/lib/trace/trace-view.test.ts` | Nav: entry for owner, admin, chef; absent for waiter; `currentSection("chef","/tracciabilita/lotto/x")` = Cucina; back-link guard green. Pages render fixture replies: "Lotto fornitore non registrato" for null code; gap banner when `gaps` set; "Senza lotto" input row; "ereditato da …" for a split child; owner fixture shows "Articolo: …" from `purchase`, chef fixture shows neither it nor an invoice link; quantities "1,5 kg", portions "12 porz.", dates "13 nov, 12:40" (Europe/Rome; fixture dates in 1998); the search form sends exactly the typed filters; a 422 shows its message in `aria-live`. `trace-view.ts` only formats (no arithmetic on reply numbers). Targets ≥ 44 px |
| S14 | **Links from batch and ingredient-stock pages** | `src/app/(owner)/produzione/[id]/batch-facts.tsx`; `src/app/(owner)/magazzino/[ingredientId]/page.tsx` (lot rows); `tests/components/trace-links.test.ts` | "Tracciabilità" on a batch links `/tracciabilita/produzione/<id>`; each lot row has "Traccia" → `/tracciabilita/lotto/<id>`; hidden for roles without `canTrace` |
| S15 | **"Com'è andata" on `/spingere`** | `src/app/(owner)/spingere/{page,sell-through-panel}.tsx`; `src/lib/push/sell-through-view.ts`; `tests/components/sell-through-panel.test.ts` | Default request has no `date` (server picks yesterday); "‹" sends the previous date, "›" disabled on today; owner fixture renders "Prezzo del giorno 12,00 €"; chef fixture renders none; "80%" comes from `sellThroughPct` (no division in the component); empty `atRisk` → the "Nessun lotto in scadenza…" text; footnote present; the two reads of the page run in parallel |
| S16 | **Booked covers on `/produzione`** | `src/app/(owner)/produzione/{forecast-panel,booked-covers}.tsx`; `tests/components/booked-covers.test.ts` | The covers request uses the panel's selected date; renders "Pranzo 12 coperti · 4 prenotazioni"; all zero → "Nessuna prenotazione confermata"; a 403 or error hides the line without breaking the forecast panel; no name/phone/email anywhere in the rendered DOM of the fixture |
| S17 | **Lot nudge in invoice review** | `src/app/(owner)/fatture/[id]/revisione/{review-line,line-editor,approval-panel}.tsx`; `tests/components/review-lot-nudge.test.ts` | Chip "Lotto mancante" iff `lotMissing`; hint text under Lotto; approval panel shows "2 righe di magazzino senza lotto…" when the count > 0, nothing when 0; "Approva" stays enabled in both cases; "Mostra la prima" focuses the first marked line |
| S18 | **Integration on the real stack** | `tests/integration/trace-sell-through.int.ts`; `tests/integration/helpers/trace.ts` | Dates from `GET /api/tables` `businessDate`. Owner A: approve an invoice with one coded and one uncoded stock line (review reply counts 1 missing before approval; approval succeeds); produce a batch from the coded lot; push a plate; a PIN waiter adds and fires two lines, voids one. `GET /api/trace/lots?q=…` finds the lot; `GET /api/trace/lots/:id` lists the batch, one plate group with 1 line and (owner) `purchase`; `GET /api/trace/batches/:id` lists the lot with the invoice for the owner, without it for the chef; `GET /api/reports/push-sell-through?date=<today>` shows 1 line and `ongoing` true; chef `GET /api/reservations/covers` returns counts after a staff reservation is accepted; waiter → 403 on every trace route; owner B → 404 on A's ids. Skips without the stack; throws in CI when settings are missing (existing rule) |
| S19 | **Playwright** | `e2e/trace.spec.ts`; `e2e/push-sell-through.spec.ts`; `e2e/booked-covers.spec.ts`; `e2e/helpers/trace.ts` | `phone` project. **Seeding:** every seed that a business-date default later reads uses `businessDateOf(ownerPage)` (`e2e/helpers/business-date.ts`), never the calendar date; each spec reads `businessDateOf` again at the end and asserts it is unchanged ("the run crossed the 02:00 cut-off", as `e2e/simulation/service.spec.ts`). **trace:** seeded invoice (via `seed-invoice.ts`) shows "Lotto mancante" on review; approval works without the lot; after a batch and a fired plate, `/tracciabilita` → code search → lot page lists the batch and "1 piatto"; chef sees no "Fattura" link and no "Articolo"; waiter `page.request.get("/api/trace/lots?q=x")` → 403. **push-sell-through:** owner pushes a plate via the existing sheet, a waiter fires one line, `/spingere` "Com'è andata" → "Oggi (in corso)" shows "1 piatto venduto". **booked-covers:** a staff reservation for today accepted by the owner; the chef's `/produzione` shows "1 prenotazione"; `page.content()` has no guest name. `expectPhoneFriendly` on `/tracciabilita`, the three trace detail pages, `/spingere`, `/produzione` |
| S20 | **ADR, owner guide, plan pointers** | `docs/adr/adr-043-trace-and-sell-through-reads.md` (number re-checked with `git ls-remote`); `docs/guides/tracciabilita.md` (Italian: how to find a lot, what "Lotto fornitore non registrato" and "Senza lotto" mean, how to read "Com'è andata", what the chef sees; states no legal rule); `docs/plans/2026-10-21-project-plan.md` (§5a M31 and M38 rows: one line each "part delivered by P2-2, see `docs/plans/2026-11-14-p2-2-trace-sell-through.md`"); `docs/plans/2026-11-08-reservations.md` (§5b V2: "built in P2-2") | `npm run format:check` green; the guide test (`tests/config/owner-guide.test.ts`, if it lists guides) extended; code review confirms the ADR records D-P1–D-P13, the origin entity choice of §3.13.1 with hooks H1–H7, and the §4 rejections |

### Acceptance tests (AT-P, §5a style)

| # | Requirement → proof | Step(s) | Command |
|---|---|---|---|
| AT-P1 | Fixture recall of one supplier lot lists every batch (including split children) and every plate served from it, grouped by business day with first and last times; voided plates shown apart; reversed movements not counted | S3, S18, S19 | `npx supabase test db`; `npm test`; `npx playwright test` |
| AT-P2 | Backward trace of a batch lists its raw lots and suppliers (a split child inherits its root's), and shows unlotted inputs as "Senza lotto" | S4, S13 | as above |
| AT-P3 | Backward trace of a served plate (found by day and dish) lists its batches, direct raw lots and suppliers, with table name and time and no guest data | S4, S13 | as above |
| AT-P4 | Lot search by code prefix (case and spaces ignored) and by ingredient/supplier/dates; uncoded deliveries still found; capture rate per supplier; owner sees the purchase line (code and description as approved) | S2, S3, S13 | as above |
| AT-P5 | Receiving: stock lines without a lot are marked and counted before approval; approval is never blocked | S12, S17, S18, S19 | as above |
| AT-P6 | Fixture shows the sell-through % per pushed item and the plates sold during the push, for yesterday by default and for any past day; DST-safe day window | S5, S10, S15, S19 | as above |
| AT-P7 | The chef sees confirmed reservations and covers per service for today … today+6, counts only; the chef still reads 0 rows from every reservation table | S6, S11, S16, S19 | as above |
| AT-P8 | Waiters get 403 / 42501 on every trace and sell-through read; chef replies hold no € key, no invoice key and no purchase key; owner/admin at `aal1` when gated get 42501 | S7, S9, S10, S11 | as above |
| AT-P9 | Cross-tenant ids answer exactly like unknown ids (404) | S3, S4, S9, S18 | as above |
| AT-P10 | No table, column, trigger or pinned procedure changed (no origin column); purge and export lists unchanged; every existing suite green | S1, S8 | all |
| AT-P11 | Plates fired between 00:00 and 02:00 count on the previous business day in every reply; e2e seeds use the business date | S3, S4, S5, S19 | as above |
| AT-P12 | New pages are phone-friendly (no horizontal scroll at 360 px, targets ≥ 44 px) and no log line carries row data | S9, S13, S19 | `npm test`; `npx playwright test` |

**CI implications:** pgTAP `352`–`359`; one integration suite; three e2e specs (no TOTP code steps); coverage ≥ 80 % on new TS. No new dependency.

**Before the PR is marked ready:** merge `main`; re-check the newest migration and renumber; recompute md5 pins in 359; re-check pgTAP and ADR
numbers (`git ls-remote`, including `docs/local-producers-plan`); list every re-pin and changed snapshot in the PR body.

### 5b. Variants

**V1 — Late lot note after approval** · Trigger: Q-P3 (founder) answered "yes, let us add the lot after approving" · Replaces steps: none (adds V1.1–V1.3)

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V1.1 | Table `public.raw_lot_note` (append-only: `tenant_id`, `raw_lot_id`, `lot_code` 1–64, `expiry`, `created_at`, `created_by`; RLS select owner/admin/chef; no write grant), procedure `public.add_raw_lot_note(p_lot, p_body)` (owner/admin; one transaction; audit event `raw_lot.note_added`); **`app.demo_purge_tables()` gains `raw_lot_note` before `raw_lot`**; the ADR-040 export list gains it | `supabase/migrations/<ts>_raw_lot_note.sql`; `supabase/tests/database/360_raw_lot_note.test.sql`; pgTAP 194/196 lists | Update/delete/truncate refused; chef and waiter → 42501 on the procedure; B's lot → `not_found`; a purge of a demo tenant removes the notes and keeps B's; the original `raw_lot.lot_code` never changes |
| V1.2 | Search, forward trace and capture rate read the latest note as `lotCode` with `lotCodeSource: "note"` | the S2/S3 migrations' functions replaced in `<ts>_raw_lot_note_reads.sql`; `supabase/tests/database/361_raw_lot_note_reads.test.sql` | A noted lot is found by its note code; capture counts it; `lotCodeSource` is `invoice` or `note` |
| V1.3 | "Aggiungi lotto" on `/tracciabilita/lotto/[id]` (owner/admin) | `src/app/api/trace/lots/[id]/note/route.ts`; `src/app/(owner)/tracciabilita/lotto/[id]/note-form.tsx`; `tests/app/api/trace-note.test.ts`; `tests/components/note-form.test.ts` | Chef → 403 with 0 RPCs; body `{lotCode, expiry?}` strict; the form shows the noted code with "aggiunto dopo" |

**V2 — Lot required for flagged ingredients** · Trigger: Q-P2 (HACCP consultant) names product categories that need the lot recorded · Replaces steps: S17's "Approva stays enabled" assertion for flagged lines only

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V2.1 | `ingredient.lot_required boolean not null default false` (owner/admin setter, audited); `approve_invoice` replaced to refuse P0001 `lot_required_missing` (DETAIL: line count) when a flagged stock line has no lot; re-pinned on purpose | `supabase/migrations/<ts>_lot_required.sql`; `supabase/tests/database/362_lot_required.test.sql`; the pgTAP files pinning `approve_invoice` | Flagged line without lot → refused, nothing posted (single transaction); with lot → approved; unflagged lines unchanged; every existing approval test green |
| V2.2 | Ingredient setting "Lotto obbligatorio" and review message | `src/app/(owner)/anagrafiche/ingredienti/…`; `src/server/invoices/approval.ts`; `tests/app/api/invoice-approve-lot.test.ts`; `tests/components/review-lot-required.test.ts` | 422 `lot_required_missing` shows "Manca il lotto su 1 riga obbligatoria"; "Approva" disabled only while a flagged line lacks a lot |

**V3 — "Di solito" comparison for pushes** · Trigger: Q-P5 (lead) answered "yes" · Replaces steps: none (extends S5, S15)

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V3.1 | `push_sell_through` gains `plates.usual` = average lines/portions of the item in the same local clock window on the same weekday of the previous `app.forecast_weeks()` weeks with at least one closed table (null when none) | `supabase/migrations/<ts>_push_sell_through_usual.sql`; `supabase/tests/database/363_push_sell_through_usual.test.sql` | Four prior weeks 2, 4, 0 (no closed table that day → excluded), 6 → usual 4; a DST week keeps the local window; no history → null |
| V3.2 | Card shows "di solito 4" | `src/app/(owner)/spingere/sell-through-panel.tsx`; `tests/components/sell-through-panel.test.ts` | Renders the value; null → nothing |

**V4 — Pending requests in the chef's covers** · Trigger: Q-P7 (chef) answered "show unconfirmed requests too" · Replaces steps: the exact-keys assertion of S6 and S11

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V4.1 | Each service gains `pendingReservations`, `pendingCovers` | `supabase/migrations/<ts>_covers_pending.sql`; `supabase/tests/database/364_covers_pending.test.sql` | S6 fixture → Pranzo pending 1 / 6; still no name/phone/email |
| V4.2 | Schema and line "+ 6 da confermare" | `src/server/reservations/output.ts`; `src/app/(owner)/produzione/booked-covers.tsx`; `tests/app/api/reservations-covers.test.ts`; `tests/components/booked-covers.test.ts` | Strict schema with the two keys; rendered text |

**V5 — Trace file for an inspector (CSV)** · Trigger: Q-P9 (lead) answered "yes, in P2-2" · Replaces steps: none (adds V5.1)

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V5.1 | Export file `tracciabilita-lotto` built from the `trace_lot` JSON service (ADR-027 pattern: no second query path), owner/admin only, "Scarica CSV" on the lot page | `src/server/exports/registry.ts`; `src/server/exports/…`; `tests/server/exports/trace-lot-export.test.ts`; `tests/guards/exports-reuse.test.ts` | CSV rows equal the JSON plates and batches; chef → 403; the reuse guard passes; no cost column |

**V6 — Sell-through for owner and admin only** · Trigger: Q-P6 (lead) answered "the chef should not see it" · Replaces steps: the chef cases of S5, S10, S15

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V6.1 | `push_sell_through` gates on `app.require_day_closer()` (owner, admin) instead of `require_push_reader()`; route roles owner/admin; the panel renders only when the page's role allows | the S5 migration (before merge) or `<ts>_sell_through_owner_only.sql`; `supabase/tests/database/356_push_sell_through.test.sql`; `tests/app/api/push-sell-through.test.ts`; `tests/components/sell-through-panel.test.ts` | Chef → 42501 / 403 with 0 RPCs; the chef's `/spingere` has no "Com'è andata" |

**V7 — Trace for owner and admin only** · Trigger: Q-P1 (lead) answered "only owner and admin" · Replaces steps: the chef cases of S1–S4, S9, S13, S19

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V7.1 | `app.require_trace_reader()` = owner, admin; trace routes owner/admin; nav `canTrace` owner/admin | the S1 migration (before merge); `352_trace_core.test.sql`; `tests/app/api/trace.test.ts`; `tests/lib/nav/nav-model.test.ts` | Chef → 42501 / 403 with 0 RPCs; no nav entry for the chef; the batch page hides the link for the chef |

## 6. Risks and mitigations

- **Lots lost at approval (process):** an owner who approves without typing the lot loses it for good (append-only). Mitigation: the
  pre-approval count and chip (S12, S17), the capture rate (S2), the guide (S20); V1 if the founder wants a late note; later H4 fills lots
  from XML files where suppliers send them.
- **A trace that looks complete but is not:** unlotted shortfall, negative stock and uncoded deliveries. Mitigation: D-P3 gaps shown in the
  reply and the banner; the guide says the trace is only as good as the lots entered. The app makes no legal claim about recall duties; the
  venue's HACCP consultant confirms (§7.1).
- **Expectation that e-invoices will bring lots and origin:** FatturaPA has no field for them (§3.13.3). Mitigation: stated in the founder
  summary and in the P2-7 planning input; real sample files decide per supplier.
- **Origin added in the wrong place later:** mitigated by the entity decision in §3.13.1, recorded in ADR-043 for the producer-network plan.
- **Sell-through misread:** "sold" includes the at-risk batch used by other plates. Mitigation: footnote on the card; definition in the
  guide and ADR-043.
- **Double counting across pushes:** two pushed plates sharing one batch each show the same batch. Mitigation: no cross-push portion totals
  (§3.4).
- **Small-count re-identification in covers:** "1 prenotazione · 2 coperti" tells the chef that one party of two is booked, nothing more;
  names never leave Postgres. Put to the data-protection adviser as part of the one question in §7.1.
- **Recall with guest contact:** the owner might want to contact guests who ate a recalled dish; P2-2 never links traces to bookings
  (Q-P10); reservation contacts are deleted after `retention_days` anyway.
- **Performance on long-lived lots:** bounded, aggregated replies and index paths; S7 perf net. If a real tenant exceeds the caps, the
  `truncated` flag tells the user, and V5 (a file) would carry the full list if asked for.
- **Queue pressure:** P2-2 sits before P2-7, SP0, P2-4 and P2-5 in a queue ending at the code freeze. Mitigation: no pinned procedure is
  touched, one PR, and the UI half can be split out (Flag 6) if review time runs short.
- **Security:** waiter access, chef cost leak and cross-tenant reads are each pinned in Postgres (S7) and at the route (S9–S11). No secret,
  provider or dependency added.
- **Merge order with open branches:** `#88` (brand, CB11) and `#89` (e2e seeds) touch e2e helpers and i18n; merge `main` before marking ready
  and re-run the preserves tests.
- **Dependencies:** none new (no package, no licence, no provider).

**Explicitly out of scope (repeated for the reviewer):** labels, QR, scanning, decant labels, printers, HACCP registers (P2-3: C2, C4); the
local-producers network and every origin column/table (separate plan; hooks H1–H7); XML parsing (P2-7); lot photos; trace CSV (V5 only on
request); raw-lot push sell-through; push "usual" baseline (V3 only on request); waiters accepting reservations (V1 of the reservations plan
stays "no"); any change to write procedures.

## 7. Open questions (founder rule 2026-11-14: one question per outside party, each with our recommended answer)

### 7.1 Outside parties — one question each

| # | Party | The one question (with our recommended answer) | If the answer differs |
|---|---|---|---|
| Q-P2 | **HACCP consultant** | "The app will record, for every delivery, the supplier, invoice and date, plus the supplier's lot code whenever the invoice prints it or staff type it (encouraged, not forced), and can show which batches and dishes used it. We propose to keep this alongside your paper records, with no product category where the lot code is mandatory. Is there any category for which your manuale di autocontrollo needs the lot code always recorded?" Recommended: **no category; encouraged only** (EU Reg. 178/2002 Art. 18 asks for the supplier "one step back", which the app already records; §3.14) | Named categories → V2 |
| Q-P10 | **Data-protection adviser** (with DPA-1) | "In this step the chef sees only counts of confirmed reservations per service (no names or contacts), and the trace links a dish to a table name and time, never to a guest. We consider that no change to the reservation processing record or DPA-1 is needed, and that linking traces to guests for recalls should not be built. Do you agree?" Recommended: **yes, no change; no guest link** | A requested change is recorded by the lead in DigiAlto-Ops; a guest link would need its own plan |
| Q-P7 | **Chef** | "On the Produzione screen, next to the forecast, you will see for the chosen day how many confirmed bookings and covers there are per service. Do you also want unconfirmed requests shown, as a separate number?" Recommended: **confirmed only** | "Yes" → V4 |
| — | **Accountant** | No question in P2-2 (no money, VAT or fiscal data changes). The FatturaPA findings of §3.13.3 are a P2-7 planning input; P2-7 decides whether its single accountant question needs them | — |

### 7.2 Founder — one question

| # | Question | Recommended default | If not default |
|---|---|---|---|
| Q-P3 | "When an invoice is approved without the lot code, do you want to be able to add the lot afterwards (for example the chef reads it on the packaging the next day)?" | **No for now**: the lot is added before approval, with the reminder on the invoice screen; we revisit once the capture rate on /tracciabilita shows how often lots are missed | V1 |

### 7.3 Internal / lead questions (each with the default in force)

| # | Question | Default | Variant if not default |
|---|---|---|---|
| Q-P1 | Who may use Tracciabilità? | Owner, admin and chef (no prices, invoice or purchase line for the chef) | V7 |
| Q-P4 | Photo of the packaging label at receiving? | No in P2-2 (Free-plan file storage and backups, ADR-034, Q-F1); a "yes" gets its own plan | — (separate plan) |
| Q-P5 | "Di solito" comparison for pushes? | No (needs weeks of sales) | V3 |
| Q-P6 | Chef sees "Com'è andata"? | Yes, without prices (the chef already reads the push list) | V6 |
| Q-P8 | Where the chef sees covers | Production screen, chosen day today … +6 | — (another place is a small follow-up) |
| Q-P9 | Trace file (CSV) for an inspector now? | No; with the HACCP lot register (P2-3) | V5 |
| Q-P11 | "Com'è andata" opens on yesterday; a push measured only inside its business day (to 02:00) | Yes | — |
| Q-P12 | Raw-ingredient pushes measured by stock left? | No (M23 Q165); plates sold still shown | — (later candidate) |
| Q-P13 | Lot search by prefix or substring? | Prefix, ignoring spaces and capitals | — (substring needs `pg_trgm`) |

This plan states no law. Every legal point above is the HACCP consultant's or the data-protection adviser's to confirm.

## 8. Sources

- Repo documents and migrations listed under "Sources" in the header and in §2 (read on 2026-11-14 from worktree `/home/user/osteria-p22`).
- `/home/user/digialto-ops/clients/osteria-dei-rossi/context.md` (Phase 2 order; chef reads lots only and never sees costs), read-only.
- Agenzia delle Entrate, *Allegato A – Specifiche tecniche, versione 1.9.1*, §2.2.10.1 DettaglioLinee, pp. 90–94 (read 2026-11-14):
  <https://www.agenziaentrate.gov.it/portale/documents/d/guest/allegato-a-specifiche-tecniche-vers-1-9-1>
- FatturaPA format specification v1.2 (older, AltriDatiGestionali structure): <https://www.fatturapa.gov.it/export/documenti/Specifiche_tecniche_del_formato_FatturaPA_v1.2.pdf>
- Agenzia delle Entrate, *Guida alla compilazione delle fatture elettroniche* v1.9 (several AltriDatiGestionali blocks per line):
  <https://www.agenziaentrate.gov.it/portale/documents/20143/451259/Guida_compilazione-FE-Esterometro-V_1.9_2024-03-05.pdf>
- EU register of geographical indications (eAmbrosia), European Commission: <https://ec.europa.eu/agriculture/eambrosia/geographical-indications-register/>;
  overview <https://agriculture.ec.europa.eu/farming/geographical-indications-and-quality-schemes/geographical-indications-registers_en>
- Reg. (EC) 178/2002 Art. 18 and Implementing Reg. (EU) 931/2011, read through secondary and excerpt sources (EUR-Lex was not reachable from
  this session; to be re-read on EUR-Lex before the consultant question is sent): <https://www.legislation.gov.uk/eur/2002/178/article/18>,
  <https://eur-lex.europa.eu/eli/reg_impl/2011/931/oj/eng>, <https://www.fsai.ie/business-advice/starting-a-food-business/traceability/traceability>,
  <https://www.gov.uk/government/publications/food-traceability-for-businesses/food-traceability-for-businesses>

---

## Lead decisions

### Lead decisions 2026-11-14 (founder decisions relayed by the lead)

| # | Decision | Effect on this plan |
|---|---|---|
| LD-1 | **Local producers and origin.** A future network where local food and drink producers sign up and reach Costì venues (discovery of new suppliers, smart suggestions, possibly producer offers, local traceability; examples: Cinta Senese, Chianti Classico) is a **separate later plan** (branch `docs/local-producers-plan`), not planned here. P2-2 only designs the trace data so it can carry origin later | §3.13 (entity choice, FatturaPA check, hooks H1–H7); D-P13 is the only build item; ADR-043 records the entity choice |
| LD-2 | **Questions to outside parties** (accountant, chef, HACCP consultant, legal/data protection): research official sources first, fact-check, propose a recommended default, and ask **one** thoughtful question per party where possible; never a questionnaire or a chain of follow-ups | §3.14 and §7 regrouped by party: HACCP consultant Q-P2, data-protection adviser Q-P10, chef Q-P7, founder Q-P3, accountant none; internal questions keep their defaults |
| LD-3 | **Confirmed pre-go-live queue:** CB11 → P2-2 → P2-7 XML e-invoice upload → SP0 SaaS spike → P2-4 alert rules → P2-5 accountant file → small fixes → code freeze around 19 December | Header "Context"; risks ("queue pressure") |

### Further lead decisions

> _Empty. The lead fills this after reading the plan; entries here override the text above._

| # | Decision | Date | Effect on steps / variants |
|---|---|---|---|
| | | | |
