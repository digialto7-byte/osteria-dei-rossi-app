# Tech plan: Osteria Digitalization · P2-0b Sell by weight (C17)

- **Client slug / internal:** `osteria-dei-rossi` (internal planning document, English).
  - **Client facts used:** none. Which dishes are sold by weight, their prices per etto and their reference portion weights are **not**
    approved client facts. `docs/client/menu-draft.md` is a DRAFT; the live menu of §1.x is a source, not an approved fact. They stay
    questions (Q-W9 to Q-W11). The owner enters them in the app; no migration or seed carries them.
  - **Fixtures** follow the M21–M25c and reservations conventions:
    - tenants "Osteria Demo A/B";
    - users "Titolare Demo", "Admin Demo", "Chef Demo", "Cameriere Demo";
    - tables "Tavolo 1–5 (demo)";
    - weighted demo items "Bistecca a peso (demo)" and "Funghi fritti a peso (demo)", with fake prices and fake reference weights.
- **Repo and branch:**
  - repo `osteria-dei-rossi-app`, worktree `/home/user/osteria-p20w`, branch `feat/p2-0b-sell-by-weight` from `main` `b473e9f`;
  - newest migration on `main`: `20261128100600_affected_recipe_keys_bfs.sql`.
- **Name:** P2-0b. The lead pulled C17 (Phase 2 scope, step P2-6) forward. The target in the brief is go-live on 12 January. This plan
  promises no date.
- **Status:** approved by the lead on 2026-11-11 (plan committed at `0ad4f05`). The lead's notes of the same day are folded in:
  - §3.1 "Lead decisions": L-1 to L-5;
  - D-11, the unit-price display rule, with its step B11 and AT-W11;
  - the maximum weight as a tenant setting (P-4);
  - Q-W1 to Q-W8 marked "default, the lead relays to the founder".
- **Numbering** (re-check every number below against `main` before each PR is marked ready):
  - **Migrations:** `20261130100000`–`20261130100400` (PR 1). PR 2 adds none.
    - P2-0 PR A adds `20261129100000` first.
    - If anything newer than `20261130*` reaches `main` first, renumber after it. `supabase db push` refuses an unapplied migration that
      sorts before an applied one (#50).
  - **pgTAP:** `320`–`327`. `310`–`316` stay free for the reservations variants. Variants of this plan use `330`+.
  - **ADR:** ADR-035, the next free number in this worktree. Re-check it against P2-0 PR A.
  - **IDs:**
    - questions **Q-W1…Q-W14**;
    - variants **V1–V5**;
    - steps **A1–A9** (PR 1) and **B1–B11** (PR 2);
    - acceptance tests **AT-W1…AT-W11**;
    - lead decisions **L-1…L-5**.
  - **e2e:** `e2e/sell-by-weight.spec.ts`.
- **Author:** architect · **Date:** 2026-11-11
- **Sources:**
  - `CLAUDE.md`;
  - `docs/plans/2026-11-11-phase2-scope.md` (C17, OQ-2, OQ-3, Part 3);
  - ADR-016, ADR-017, ADR-019, ADR-022, ADR-023, ADR-025, ADR-027;
  - the M17–M24 plans;
  - the merged SQL and TS listed in §2.

  **Where merged code and a plan differ, the code wins.**

> **Flags for the founder (read first)**
> - **Your decisions of 2026-11-11 are built in as given** (§3.1, D-1 to D-10). Nothing here re-opens them.
> - **The price is per etto (100 g)**, entered and shown as "5,50 € / etto". The line price is price per etto × grams ÷ 100, computed
>   in the database. It is rounded once, to the cent, half-up, until the accountant says otherwise (Q-W12).
> - **Everywhere a price "per unit" appears, a weighed dish shows its price per etto and the weight**, never the line total as if it
>   were a unit price (D-11).
> - **Nothing changes for any existing dish.** A dish becomes "a peso" only when you or the admin switch it on in Menu and enter its
>   price per etto **and its reference portion weight**. Without the reference weight the switch is refused, because the app could
>   not work out how much stock a weighed plate uses.
> - **The heaviest weight one line may carry is a setting** you or the admin can change (3 000 g until changed). The lowest is 50 g,
>   in steps of 10 g.
> - **The numbers we chose for you** (Q-W1 to Q-W8: limits, the "Confermi?" check, grams vs kg, …) are defaults the lead will
>   relay to you. Saying no to any of them is a small, planned change (variants V2–V4).
> - **We need from the chef, through you:**
>   - which dishes are sold by weight;
>   - for each one, how many grams count as "one portion" of its recipe;
>   - whether those grams are raw or cooked (Q-W10).
> - **We need from the accountant:**
>   - the rounding rule (Q-W12);
>   - how the cashier keys a weighed dish into the RCH register so that the receipt matches the app (Q-W13).
> - **If this is not live by go-live**, the placeholder portions of OQ-2 apply until it is (variant V5). Rows recorded as placeholders
>   are never rewritten.

## 1. Goal and scope

- **Goal:**
  - A waiter rings up "fiorentina 1,2 kg" or "porcini fritti 250 g" in a few taps.
  - The bill charges price per etto × weight.
  - The kitchen sees the weight.
  - Stock goes down by weight ÷ the reference portion weight, FEFO.
  - The cost is frozen at fire as the same fraction.
  - Reports count one plate per line and also show the weight.
- **In scope**
  - **Menu:** the unit of each price row (`portion` or `etto`) and the item's reference portion weight. Owner/admin only, audited.
  - **Sale settings:** the maximum weight per line (`sale_settings.weight_max_g`). Owner/admin only, audited.
  - **Order line:** a required weight in grams for weighted items. The per-etto price and the reference weight are frozen on the line
    at entry. The line price is computed in SQL and stored as the line's `unit_price`, with `qty` = 1.
  - **Procedures:**
    - `add_order_line` and `update_order_line` take `weightG`;
    - `fire_course`, `freeze_line_cost`, the nightly invariant check and the forecast's portion lines use the line's portion fraction;
    - `void_line` is unchanged: it mirrors whatever was booked.
  - **Reads:**
    - menu (`priceUnit`, `portionWeightG`, `weightLeftG`, top-level `weightMaxG`);
    - order lines and bill lines (`weightG`, `pricePer100g`);
    - kitchen tickets (`weightG`);
    - KPI items (`weightG`, `avgWeightG`) and the items export (`peso_venduto_g`, `peso_medio_g`);
    - the owner's plate cost reads (`priceUnit`, `pricePer100g`, `portionWeightG`).
  - **Offline:** `add_line` and `edit_line` ops may carry `weightG`. Ops without it replay exactly as today.
  - **Screens (PR 2):**
    - Menu settings: "Venduto a peso";
    - the "Peso massimo per riga" setting;
    - comanda: a weight sheet and the line shows the weight;
    - kitchen: "Fiorentina 1,2 kg";
    - bill;
    - items report and export;
    - the unit-price surfaces of D-11.
  - Fake demo data only.
- **Out of scope**
  - **A kitchen re-weigh or correction flow** (founder: no re-weigh). Edit and void follow the normal line rules.
  - **A Bluetooth scale** (PRD Phase 3, Android only).
  - **Weight in the daily KPI totals:** grams of different dishes do not add up to anything meaningful. Weight appears per item only.
  - **Push sell-through (C12, P2-2):** not built yet. When it is, it counts 1 per line and carries the weight (rule in §3.1 D-9).
  - **Any change to:**
    - `void_line`, `remove_order_line`, `order_view`, `close_table` / `app.close_session_at`;
    - `app.app_vs_register_json`, `enter_day_close`;
    - `app.split_cents`, `app.bill_split_items`;
    - the daily KPI rollup, the M25c service split, `apply_op_dispatch`, `open_table`;
    - `set_sale_settings`, `sale_settings_read`.
  - **Rewriting rows recorded under the OQ-2 placeholder** (append-only).

### 1.x Reference cases: the live menu (lead, 2026-11-11)

The founder gave the live menu, https://menu.osteriadeirossi.it/, now a DigiAlto-Ops source
(`knowledge/clients/osteria-dei-rossi/sources/menu-live-2026-11-11.md`, Italian and English). It supersedes
`docs/client/menu-draft.md` as the reference for which dishes are sold by weight; the draft is not rewritten. The live menu shows
three dishes priced per 100 g, and these are the cases the UI and tests model:

| Dish (live menu) | Price shown |
|---|---|
| Bistecca alla Fiorentina | 9 € / 100 g |
| Bistecca Fritta | 12 € / 100 g |
| Costata del Vamosh | 7 € / 100 g |

The founder's own example also includes porcini fritti by weight (250 g), which is not on the live menu; the lead has asked the
founder about it. These are a source, not approved client facts: **seed and fixtures use fake demo dishes and prices only** (B8),
and real dishes, prices per 100 g, reference weights and allergens are entered by the owner or chef in the app, or imported after
they confirm them (Q-W9 to Q-W11).

## 2. Current state (`main` `b473e9f`, newest migration `20261128100600`)

### 2.1 What exists and how this plan uses it

| Object (file) | State today | Sell by weight |
|---|---|---|
| `public.order_line` (`20261101100000_order_core.sql`) | `qty numeric(4,1)` in half steps 0.5–99; `unit_price numeric(12,2)` and `vat_rate` frozen at **entry** (ADR-017, M18 Q79); `state` generated; owner/admin select policy only; guard `app.order_line_guard` | + `weight_g`, `price_per_100g`, `portion_weight_g`; a weighted line has `qty = 1` and `unit_price` = the line price |
| `app.order_line_guard` (same file) | identity, price and creation facts immutable; a fired line may only be voided | replaced: a **draft** weighted line may change `weight_g` and `unit_price` together; `price_per_100g` and `portion_weight_g` never change |
| `public.add_order_line`, `public.update_order_line` (`20261101100300`, `…100400`) | role → shape → replay → session FOR SHARE → batch FOR SHARE → availability → price frozen (push price if pushed) | replaced: `weightG` parsed and required for weighted items; the line price computed by the one rounding function |
| `app.order_line_json` (`20261101100100`) | waiter-safe line shape (`unitPrice`, no cost) | + `weightG`, `pricePer100g` |
| `app.menu_item_availability` | portions left in half portions; blocks only at 0 left | **unchanged**; the menu read derives `weightLeftG` from it |
| `public.menu_list` (`20261101100200`) | waiter menu, `price`, `pushPrice`, availability | replaced: items + `priceUnit`, `portionWeightG`, `weightLeftG`; top level + `weightMaxG` |
| `public.menu_item`, `public.menu_item_price` (`20261031100000`) | mutable item; append-only price history `(price, vat_rate, valid_from)`; owner/admin RLS | + `menu_item_price.price_unit` (`portion` default, or `etto`); + `menu_item_price.portion_weight_g` (review fix, Q-W15: versioned with the terms row; nothing is added to `menu_item`) |
| `public.sale_settings` (`20261031100000`), `public.set_sale_settings`, `public.sale_settings_read`, `app.coperto_settings` (`20261031100400`, `20261031100100`) | one row per tenant, owner/admin only; holds the coperto; a row may exist with a null coperto (`coperto_settings` filters `coperto_amount is not null`); audit action `sale_settings.changed` | + `weight_max_g` (null = the app default). `set_sale_settings` / `sale_settings_read` **unchanged**: they write and read the coperto columns only. Two new definers read and write the weight setting |
| `public.create_menu_item`, `public.update_menu_item`, `app.menu_items_json` (`20261031100200`) | `app.require_menu_writer()` = owner/admin; a price or VAT change inserts a price row; audit | replaced: + `priceUnit`, `portionWeightG` |
| `app.menu_item_price_at` (`20261031100100`) | `(menu_item_id, price, vat_rate)` in force | **unchanged** (pinned in 169, 255); a new sibling `app.menu_item_sale_terms_at` adds the unit |
| `app.plate_cost_rows` (`20261031100700`) | the margin per plate uses the menu price in force; read by `public.plate_costs`, `public.plate_breakdown`, `public.plate_margins_pct`, `public.recipe_cost_at`, the dashboard cost helpers and the price-variance payload | replaced: for an `etto` price the plate price is the price of the reference portion |
| `public.plate_costs` (`20261023110700`), `public.plate_breakdown` (`20261107100200`) | owner/admin plate cost list and breakdown, with `salePrice` | replaced: + `priceUnit`, `pricePer100g`, `portionWeightG` per plate (D-11) |
| `public.fire_course` (`20261106100700`), `app.freeze_line_cost` (`20261106100100`) | depletes `round(qty × need, 4)` per batch key and per raw ingredient; cost from the movements, plus `qty × need × cost` for non-stock ingredients; `unit_cost_at_sale = total / qty` | replaced: `qty` → `app.order_line_portions(...)` in those expressions only |
| `public.void_line` (`20261106100300`) | mirrors each consume / consumption row: a reversal and a waste row | **unchanged**: it mirrors the fractional rows as they are |
| `app.ledger_checks_body` (`20261106100500`) | nightly `fire_depletion`: originals sum to `round(l.qty × need, 4)` | replaced: the same check with the portion fraction; every other check verbatim (pgTAP 117 counts semicolons) |
| `app.forecast_portion_lines` (`20261114100400`) | `l.qty × recipe qty / yield` | replaced with the portion fraction |
| `app.session_bill_json` (`20261110100100`) | lines at `round(qty × unit_price, 2)`, integer-cent splits, `billToken` md5 over id/state/qty/unit_price | replaced: line JSON + `weightG`, `pricePer100g`; the token also hashes `weight_g`. **Arithmetic unchanged** |
| `app.kpi_sales_lines`, `app.kpi_items_json` (`20261112100000`, `…100300`) | THE line source; gross `round(qty × unit_price, 2)`; plates = Σ qty | `kpi_sales_lines` + a `weight_g` column (drop and create, ACL restated); `kpi_items_json` rows + `weightG`, `avgWeightG`. **Plates and money unchanged** (qty = 1) |
| `app.kitchen_ticket_rows` (`20261111100200`) | lines `{id, name, qty, note, isShared, voided, voidReason, done}` | + `weightG` |
| `app.apply_op_check_payload` (`20261109100100`) | allowed payload keys per op kind | replaced: `weightG` optional on `add_line` and `edit_line`. `apply_op_dispatch` is **unchanged** (it already passes the payload through) |
| `src/lib/sync/ops.ts`, `src/server/sync/schemas.ts` | op builders (the outbox label carries the menu `unitPrice`) and the strict op schema | `weightG` optional; the label of a weighted line carries `pricePer100g` and `weightG` |
| `src/lib/money/format.ts` (`formatEuro`) | the one euro formatter | + `formatPricePerEtto`, built on it |
| `src/server/exports/tables/items.ts`, `…/unmapped.ts` | items CSV (per-plate figures) and unmapped CSV (plates, gross) from the report services (ADR-027); **no unit-price column** in any export | items + `peso_venduto_g`, `peso_medio_g` at the end of the base columns; unmapped unchanged (asserted: no unit-price column) |
| `scripts/lib/demo/fixture.ts` | 3 fake menu items | + 2 fake weighted items |

### 2.2 What this plan relies on (checked in the code)

- **One rounding place already exists for every downstream sum.**
  - The bill (`session_bill_json`), `close_table` (the frozen `total`), the day close (Σ `table_session.total`) and the KPIs all use
    `round(qty × unit_price, 2)`.
  - A weighted line stores the rounded line price in `unit_price` with `qty = 1`. So **none of those formulas changes**, and the one
    new rounding is `app.weight_line_price` (§3.1 D-4).
- **Cost already follows the movements.**
  - `freeze_line_cost` sums the line's consume rows × the batch's frozen unit cost, plus its consumption rows × their unit cost.
  - Fractional depletion therefore gives a fractional cost with no new formula. Only the non-stock term (`v_qty × need × cost`) and
    the "needed but not booked" filter read `qty` directly.
- **Availability today blocks only at 0 portions left.** Quantity is never compared with stock: a shortage is booked and alerted at
  fire. A weighted line follows the same rule.
- **`sale_settings` can hold a row with no coperto.**
  - `app.coperto_settings` reads only rows with `coperto_amount is not null`.
  - `set_sale_settings` updates only the coperto columns.
  - So a weight column there does not disturb the coperto, `open_table` or pgTAP 154.
- **Missing (checked):**
  - `grep -rn "weight" supabase/migrations src/server` finds no order or menu weight concept;
  - M17 Q71 default was "no sale by weight";
  - ADR-016 lists per-etto items under "what would make us revisit this".

## 3. Design

### 3.1 Decisions

**Founder decisions, 2026-11-11 (DECIDED, binding):**
- **D-1 Few dishes.** Each menu item can be sold by weight, with a price per weight unit. Owner/admin set it on the menu item.
- **D-2 Price unit: per 100 g (per etto).** DECIDED by the founder (2026-11-11, through the lead):
  - owner/admin enter the price per 100 g;
  - the menu and order screens show "5,50 € / etto";
  - line price = price per 100 g × grams ÷ 100, in SQL;
  - **storage is per 100 g as well:** `menu_item_price.price` holds the per-etto price when `price_unit = 'etto'`, so the number typed,
    stored and shown is the same, with no conversion.
- **D-3 Weight at ordering, no re-weigh.**
  - The waiter types the requested weight. It is a required number for a weighted item, and it is what is charged.
  - There is no kitchen correction. Edit and void follow the normal rules: a draft can be edited or removed; a fired line can only be
    voided.
- **D-4 Line price.**
  - `app.weight_line_price(p_price_per_100g numeric, p_grams integer) = round(p_price_per_100g * p_grams / 100, 2)`.
  - PostgreSQL's `round(numeric, int)` breaks ties away from zero (<https://www.postgresql.org/docs/current/functions-math.html>).
    For the non-negative prices here that is **half-up to the cent**, the founder's default until the accountant answers (Q-W12).
  - This function is the **only** place a weighted price is rounded. The line price is stored once in `order_line.unit_price`.
  - A trigger enforces it (L-4).
  - **Freezing** is confirmed by the lead (L-1).
- **D-5 Waiter view.** The waiter sees the per-etto price, the weight and the line price, and never a cost (§3.6).
- **D-6 Kitchen ticket.** It shows the weight in Italian number format: "Fiorentina 1,2 kg", "Porcini fritti 250 g". There is no
  price on the kitchen ticket.
- **D-7 Depletion.**
  - Portions = `weight_g ÷ portion_weight_g`, unrounded.
  - Each batch key and raw ingredient takes `round(portions × need, 4)`, FEFO, through the unchanged M19 helpers.
  - The cost is frozen at fire from those movements, so it is the same fraction.
- **D-8 Reports.**
  - Plates and mix count **1 per line**, because `qty = 1`.
  - The items report and the items export also carry the weight sold and the average weight per plate.
  - The bill and the day-close totals use the line price.
- **D-9 Push sell-through (future C12).** A weighted line counts 1 and carries its weight, like the KPIs. This is recorded here for
  the P2-2 planner. No code in this plan.
- **D-10 Offline.** The op schema carries `weightG`. Queued ops without it must still replay. That is low priority, but nothing may
  break.

**Lead decisions, 2026-11-11 (on approving this plan):**
- **L-1 Freezing confirmed as planned.**
  - The price per 100 g (or the push price while a push runs) is frozen on the line at add (ADR-017).
  - The weight is editable while the line is a draft, and the line price follows it.
  - From fire on, the guard makes the weight and the line price final.
- **L-2 `qty = 1` with the line price in `unit_price` is confirmed**, together with the display rule D-11.
- **L-3 Q-W1 to Q-W8 proceed on their defaults.** Each is marked "default, the lead relays to the founder" (§7).
- **L-4 Trigger, not CHECK, for the line-price formula** (agreed).
  - `order_line_weight_price` checks `unit_price = app.weight_line_price(price_per_100g, weight_g)` on insert, and whenever `weight_g`,
    `unit_price` or `price_per_100g` is written on a weighted line.
  - A CHECK would be re-evaluated on every update of the row, including the void of a fired line. A later change of the rounding rule
    (V1) would then make old fired lines impossible to void.
  - With the trigger, a line is checked only when its price inputs are written, so each line keeps the price it was sold at.
- **L-5 The upper weight bound is a setting, not a literal.**
  - The lower bound (50 g) and the step (10 g) stay as planned.
  - Where the setting lives is proposal P-4.

**D-11 The unit-price display rule (lead, L-2).** A weighted line stores the line total in `unit_price` with `qty = 1`. So every surface
that shows a "unit price" must, for a weighted line or dish:
- show the **price per 100 g and the weight** ("1,2 kg × 9,00 € / 100 g");
- show the line total only as the line's **amount** ("Importo 108,00 €");
- **never** show it as a unit price (no "1 × 108,00 €", no "108,00 € cad.").

The replies keep `unitPrice` for shape stability. Screens read `pricePer100g` and `weightG` for the unit, and `unitPrice` / `amount`
only as the amount.

Surfaces found in the code, each covered by step B11 unless named otherwise:

| Surface | Data source | What a weighted line or dish shows |
|---|---|---|
| Comanda line row and line editor | `GET /api/table-sessions/:id/lines`, add/update replies (`order_line_json`) | "1,2 kg · 9,00 € / 100 g", amount 108,00 €; no qty stepper |
| Offline outbox list (queued line) | `src/lib/sync/ops.ts` label (today `unitPrice` = the menu price, which is per 100 g for a weighted dish) | "1,2 kg · 9,00 € / 100 g", no amount until synced (B4) |
| Menu tile and pinned strip (waiter) | `GET /api/menu` `price`, `pushPrice` | "9,00 € / 100 g" and push "8,00 € / 100 g"; never a bare "9,00 €" |
| Menu settings card and push sheet (owner/admin) | `GET /api/menu/items` `price`, `pushPrice` | as above |
| Bill sheet and close sheet | bill lines `unitPrice`, `amount` | "1,2 kg × 9,00 € / 100 g" and "108,00 €"; never "1 × 108,00 €" |
| Kitchen ticket | `kitchen_ticket_rows` | weight only, **no price at all** (D-6) |
| Items report (KPI item view) and items export | `kpi_items_json`; `items.csv` | no unit-price column exists or is added. The "per piatto" figures of a weighted dish are per line, so the row also shows the average weight per plate ("media 1,23 kg"; `avgWeightG`, CSV `peso_medio_g`) and the weight sold (`peso_venduto_g`) |
| Unmapped items report and export | `unmapped_items`; `unmapped.csv` | plates and gross only; no unit-price column (asserted) |
| Plate costs and plate breakdown (`/costi`, owner/admin) | `public.plate_costs`, `public.plate_breakdown` (`salePrice` = the reference portion's price) | "Porzione di riferimento 400 g a 9,00 € / 100 g = 36,00 €", never "36,00 €" alone as if it were a menu price |

**Architect proposals (each with an open question where a number or a fact is involved):**
- **P-1 Where the reference portion weight lives: on the menu price (terms) row, frozen on the line at entry.**
  - `menu_item_price.portion_weight_g` (integer grams, 10 to 3 000) is set by owner/admin next to the price and the unit; the three are the
    terms of one row (ADR-016). **Review fix (Q-W15, decided by the lead, 2026-11-11):** it is not a column of `menu_item`. A change of the
    reference weight or of the unit writes a new terms row effective from now, exactly as a price change does. `app.menu_item_sale_terms_at(item, t)`
    returns the price, the unit and the reference weight valid at `t`, so a report for a past day (plate costs and breakdown, GP %) does not
    move when today's weight changes. The table refuses an `etto` row without a weight (`menu_item_price_etto_weight_ck`). `menu_list` and
    the manage item read the current terms.
  - `add_order_line` copies the weight valid at that moment (the same source) to `order_line.portion_weight_g`. So a later change on the menu never changes:
    - what an already-entered line depletes;
    - its frozen cost;
    - the nightly `fire_depletion` check of old lines.
  - The recipe-version alternative is rejected in §4.
- **P-2 Missing reference weight blocks the flag.**
  - `create_menu_item` / `update_menu_item` refuse a price row with `price_unit = 'etto'` while its resulting `portion_weight_g`
    is null: P0001 `portion_weight_missing`, 422 at the API.
  - They refuse clearing `portion_weight_g` while the price in force is per etto: same code (pgTAP 329; the table check is the second line
    of defence), so `no_sale_price` can never appear retroactively for a past day.
  - This holds for unmapped weighted items too, so the rule stays one rule.
- **P-3 "Sold by weight" is derived, not stored.**
  - The flag is the unit of the price row in force (`price_unit = 'etto'`). There is no separate boolean.
  - Switching a dish to or from weight **requires a new price in the same request** (`price_required` otherwise). The price history
    therefore says, row by row, what each number meant. A toggle can never reinterpret an old price.
  - The price history stays append-only (ADR-016).
- **P-4 Weight entry bounds, step and the maximum-weight setting (L-5).**
  - **Fixed in code:** the minimum (50 g) and the step (10 g), as immutable constants `app.weight_min_g()` and `app.weight_step_g()`,
    with TS twins and a parity test (Q-W1).
  - **The maximum is a tenant-level setting**, `sale_settings.weight_max_g`:
    - integer grams, 500–10 000, a multiple of 10;
    - null means the app default `app.default_weight_max_g()` = 3 000 g (Q-W1);
    - read by `app.weight_max_g(p_tenant)`;
    - written by owner/admin through `public.set_weight_settings`, audited as `sale_settings.changed` with `weight_max_g` before/after;
    - read by owner/admin through `public.weight_settings`;
    - sent to the waiter as the top-level `weightMaxG` of `menu_list`, so the sheet validates offline with the same number.
  - **Why tenant-level in `sale_settings`.** It is the owner/admin table for sale rules (the coperto), already in the demo purge list
    and in pgTAP 004's fixture, with an existing audit action. The waiter receives only the number, through the menu read. Rejected
    alternatives are in §4.
  - **Why new procedures instead of extending `set_sale_settings`.** Its two coperto keys are required, so adding an optional key
    would change an M17 contract, and changing the maximum would force re-sending the coperto.
  - **A changed maximum applies to new writes only.**
    - Stored lines are never re-validated.
    - A draft above a lowered maximum keeps its weight until it is edited.
    - A queued offline op is validated against the maximum in force when it replays (`weight_invalid` → stored `rejected`).
  - **UI soft confirmation:** a weight of at least 3 × the reference portion asks "Confermi 1.500 g?" before sending. 150 g typed as
    1 500 g for a 200 g portion is caught (Q-W2).
  - **The field takes grams** (`inputmode="numeric"`, integer) with a live readout "= 1,2 kg" (Q-W3). The readout is formatting
    only, never arithmetic on money.
- **P-5 Stock hint for weighted dishes.**
  - `menu_list` adds `weightLeftG = portionsLeft × portionWeightG` (integer, floor) for weighted items, otherwise null. The comanda
    shows "Restano circa 1,4 kg" instead of "Ne restano 2,5" (Q-W4).
  - Low stock stays "≤ 3 portions" (`app.low_stock_hint_portions`, M18 Q77), unchanged.
  - Sold out still means 0 portions left, or the owner's "esaurito".
- **P-6 Line shape of a weighted line.**
  - `qty = 1` always. A body `qty` other than 1 → `qty_invalid`.
  - Two fiorentine of 1,2 kg each are two lines (Q-W8).
  - "Shared" (`isShared`) works as for any line (Q-W5).
- **P-7 Push.** A pushed weighted dish's `push_price` is per etto, like its menu price (Q-W6). `push_menu_item` is unchanged. Its
  existing push-vs-menu checks compare like with like (the menu price in force is per etto for a weighted dish, so `push_price_above_menu`
  compares per-etto figures; pgTAP 328). **Review fix:** a push price is in the unit it was started in, so `update_menu_item` refuses a
  `priceUnit` switch (portion to etto or back) while a push is in force: P0001 `push_active`, 422, "Ferma la spinta prima di cambiare
  l'unità di prezzo." A push that has ended does not block it.

### 3.2 Data model (migration `20261130100000_weight_core.sql`, step A1)

```sql
-- menu
-- the unit and the reference portion weight are terms of the price row (ADR-016; review fix, Q-W15); nothing is added to menu_item
alter table public.menu_item_price
  add column price_unit text not null default 'portion' check (price_unit in ('portion', 'etto')),
  add column portion_weight_g integer check (portion_weight_g between 10 and 3000),
  add constraint menu_item_price_etto_weight_ck check (price_unit = 'portion' or portion_weight_g is not null);
--   existing rows read 'portion' (ADD COLUMN with a constant default rewrites nothing and fires no UPDATE trigger,
--   so the append-only guard is not involved)

-- the maximum weight per line (P-4): null = the app default
alter table public.sale_settings
  add column weight_max_g integer check (weight_max_g between 500 and 10000 and weight_max_g % 10 = 0);

-- order line
alter table public.order_line
  add column weight_g integer,
  add column price_per_100g numeric(12, 2),
  add column portion_weight_g integer,
  add constraint order_line_weight_set_ck check (num_nonnulls(weight_g, price_per_100g, portion_weight_g) in (0, 3)),
  add constraint order_line_weight_ck check (
    weight_g is null
    or (qty = 1 and weight_g between 1 and 20000 and portion_weight_g between 1 and 20000 and price_per_100g >= 0));

-- the line price of a weighted line, checked on insert and whenever the weight or the price is written (D-4, L-4)
create trigger order_line_weight_price before insert or update of weight_g, unit_price, price_per_100g on public.order_line
  for each row when (new.weight_g is not null) execute function app.order_line_weight_price();
```

- **Helpers** (schema `app`, empty `search_path`, no API grant):
  - `app.weight_line_price(numeric, integer) returns numeric`: immutable, the one rounding (D-4).
  - `app.order_line_weight_price()`: trigger function. It raises P0001 `order_line_price_mismatch` unless
    `new.unit_price = app.weight_line_price(new.price_per_100g, new.weight_g)`.
  - `app.order_line_portions(p_qty numeric, p_weight_g integer, p_portion_g integer) returns numeric`: immutable. It returns
    `p_qty` when `p_weight_g` is null, otherwise `p_weight_g::numeric / p_portion_g` (unrounded).
  - **Constants:**
    - `app.weight_min_g()` = 50, `app.weight_step_g()` = 10, `app.default_weight_max_g()` = 3000 (all immutable);
    - `app.weight_max_setting_bounds()` = `(500, 10000)` (immutable; the same numbers as the `sale_settings` CHECK).
  - `app.weight_max_g(p_tenant uuid) returns integer`: stable definer. It returns
    `coalesce((select weight_max_g from public.sale_settings where tenant_id = p_tenant), app.default_weight_max_g())`.
- **Bounds:** the CHECK's 1–20 000 on `order_line` is a backstop only. The entry bounds are enforced by the parser
  (`app.order_weight`, A3) against the constants and the tenant's maximum, so a changed setting or default needs no table change.
- **`app.order_line_guard` replaced.** Every rule kept, plus:
  - `price_per_100g` and `portion_weight_g` are immutable like `unit_price`;
  - `unit_price` may change only when `old.fired_at is null and old.weight_g is not null and new.weight_g is distinct from old.weight_g`;
  - after fire `weight_g` is in the "fired lines change only by void" list.
- **RLS and grants:** unchanged.
  - `order_line`, `menu_item`, `menu_item_price` and `sale_settings` keep their owner/admin-only select policies and no write grant for
    any API role.
  - Waiters and the chef read through definer functions only.
- **No new table**, so the demo purge list and the pgTAP table lists do not change.

### 3.3 Procedures and reads

| Function | Migration (step) | Change |
|---|---|---|
| `app.menu_item_sale_terms_at(tenant, items[], at)` **new** | `20261130100100_weight_menu.sql` (A2) | `menu_item_price_at` + `price_unit` + `portion_weight_g`; same "newest row not after `at`" rule |
| `public.weight_settings()` **new** | A2 | owner/admin (`app.require_menu_writer`): `{weightMaxG, defaultWeightMaxG, minWeightG, stepG, settingMinG, settingMaxG}`; waiter and chef → 42501 |
| `public.set_weight_settings(p_body jsonb)` **new** | A2 | owner/admin; body `{weightMaxG: int \| null}` (required key; null = back to the default); 500–10 000, multiple of 10, else P0001 `weight_max_invalid`; tenant row lock as `set_sale_settings`; inserts a `sale_settings` row with a null coperto when none exists; an identical value → `changed:false`, no audit; else one `sale_settings.changed` audit with `weight_max_g` before/after |
| `public.create_menu_item`, `public.update_menu_item`, `app.menu_items_json` | A2 | body keys `priceUnit` (`portion`\|`etto`), `portionWeightG` (integer 10–3000 or null); P-2 and P-3 rules; the audit `after` adds `price_unit`, `portion_weight_g`; the manage JSON adds `priceUnit`, `portionWeightG` |
| `public.menu_list` | A2 | items + `priceUnit`, `portionWeightG` (null for portion items), `weightLeftG`; top level + `weightMaxG` |
| `app.plate_cost_rows` | A2 | for an `etto` price in force: sale price = `app.weight_line_price(price, portion_weight_g)`, i.e. the reference portion's price; everything else verbatim |
| `public.plate_costs`, `public.plate_breakdown` | A2 | **`plate_costs`** returns each plate row + the output columns `price_unit`, `price_per_100g`, `portion_weight_g` (null for portion dishes, `price_unit` null for an unmapped plate), read with `app.menu_item_sale_terms_at` for the mapping active item (D-11). Output columns cannot change with create or replace, so it is **dropped (no cascade) and created again** with the same arguments, owner, security definer, empty `search_path` and grants; pgTAP 321 pins them and checks nothing depends on it. **`plate_breakdown`** (lead's decision, A2): the keys go **only inside the owner/admin `money` block**: `salePriceEur` (new: the block held only `salePriceExVatEur`), `priceUnit`, `pricePer100g`, `portionWeightG`. The chef's reply is unchanged (pgTAP 181 scans it for any price key). Everything else verbatim |
| `app.order_weight(p_val jsonb, p_tenant uuid) returns integer` **new** | `20261130100200_weight_order_entry.sql` (A3) | a JSON integer ≥ `app.weight_min_g()`, ≤ `app.weight_max_g(p_tenant)`, on the step, else P0001 `weight_invalid`; a non-number is 22023 |
| `public.add_order_line` | A3 | allowed keys + `weightG`. After the menu item is read, `app.menu_item_sale_terms_at` gives the unit: `etto` without `weightG` → P0001 `weight_required`; `portion` with `weightG` → P0001 `weight_not_allowed`; `etto` with a `qty` other than 1 → `qty_invalid`. Price per 100 g = push price while pushed, else the menu price; `unit_price = app.weight_line_price(...)`. Everything else (replay first, locks, availability, error codes) is unchanged |
| `public.update_order_line` | A3 | patch keys + `weightG` (draft weighted lines only; `weight_not_allowed` on a portion line; `qty` on a weighted line → `qty_invalid`). A weight increase re-checks availability as a qty increase does. `v_same` includes the weight. The new `unit_price` comes from the same function |
| `app.order_line_json` | A3 | + `weightG`, `pricePer100g` (null for portion lines) |
| `app.apply_op_check_payload` | A3 | `add_line` and `edit_line` allow `weightG` (optional). The other kinds are unchanged |
| `public.fire_course` | `20261130100300_weight_fire.sql` (A4) | in the three places `x.qty * need` appears: `app.order_line_portions(x.qty, x.weight_g, x.portion_weight_g) * need`. Nothing else |
| `app.freeze_line_cost` | A4 | reads `qty, weight_g, portion_weight_g`; the non-stock cost and the "needed but no row" filter use the portions; `unit_cost_at_sale = total / qty` (= the line's cost for a weighted line, comparable to its `unit_price`) |
| `app.ledger_checks_body` | A4 | `fire_depletion` compares with `round(app.order_line_portions(l.qty, l.weight_g, l.portion_weight_g) * n.need, 4)`; every other check verbatim; still one statement |
| `app.forecast_portion_lines` | A4 | the portion fraction instead of `l.qty` |
| `app.session_bill_json` | `20261130100400_weight_reads.sql` (A5) | line JSON + `weightG`, `pricePer100g`; the token string adds `coalesce(weight_g::text, '-')`. Amounts, splits and totals are byte-identical |
| `app.kitchen_ticket_rows` | A5 | line JSON + `weightG` |
| `app.kpi_sales_lines` | A5 | drop and create with one more output column, `weight_g`; ACL restated; the money and qty columns unchanged |
| `app.kpi_items_json` | A5 | rows + `weightG` (Σ weight of the item's lines) and `avgWeightG` (`round(Σ weight ÷ count of weighted lines)`, integer grams), both null when the item has no weighted line; totals unchanged |

- **Every replaced function:** same signature (except `kpi_sales_lines`' output), security definer where it was, empty `search_path`,
  revokes restated.
- **Transactions:** `fire_course` and `add` / `update_order_line` stay single transactions with the weight path inside them. The lock
  order is unchanged: session → lines → stock → batches.

### 3.4 API (PR 1, step A8)

| Route | Body / reply change | New error mapping |
|---|---|---|
| `POST /api/table-sessions/[id]/lines` | body + `weightG?: int`; reply line + `weightG`, `pricePer100g` | `weight_required`, `weight_invalid`, `weight_not_allowed` → 422 with it/en messages |
| `PATCH /api/order-lines/[id]` | patch + `weightG?` | same |
| `GET /api/menu`, `GET /api/table-sessions/[id]/lines` (both offline-cached) | menu items + `priceUnit`, `portionWeightG`, `weightLeftG`, top level + `weightMaxG`; lines + `weightG`, `pricePer100g` | none |
| `GET/POST /api/menu/items`, `PATCH /api/menu/[id]` (owner/admin) | + `priceUnit`, `portionWeightG` | `portion_weight_missing`, `price_required`, `price_unit_invalid`, `portion_weight_invalid` → 422 |
| `GET /api/settings/weight`, `PUT /api/settings/weight` **new** (owner/admin; `src/app/api/settings/weight/route.ts`) | GET → `weight_settings()`; PUT `{weightMaxG: int \| null}` → `set_weight_settings` | `weight_max_invalid` → 422; waiter/chef → 403 with 0 RPCs |
| `GET /api/table-sessions/[id]/bill`, `…/bill/split`, `…/close` | bill lines + `weightG`, `pricePer100g` | none |
| `GET /api/kitchen/tickets` | lines + `weightG` | none |
| `GET /api/reports/items`, `GET /api/exports/items` | rows + `weightG`, `avgWeightG`; CSV + `peso_venduto_g`, `peso_medio_g` | none |
| `GET /api/costs/plates` and the plate breakdown route (the existing `/costi` routes) | rows + `priceUnit`, `pricePer100g`, `portionWeightG` | none |
| `POST /api/sync` | op payloads accept `weightG` | stored outcomes as today (`rejected weight_required`, …) |

- **Output schemas:** every output schema stays strict (an unknown key → 500), and gains the new keys explicitly.
- **Waiter schemas:** none of them may hold a key matching `/cost|margin|food|gp|vat|recipe/i` (step B7 guard).
- **Route paths:** the `/costi` route paths are the existing ones; A8 locates them with `grep -rln "plate_costs\|plate_breakdown" src/`.
  No route is added for them.

### 3.5 Screens (PR 2; Italian first, English second; 360 px first; targets ≥ 44 px; every value from `/api/*`)

- **Menu settings** (`/menu`, `menu-item-form.tsx`):
  - a "Venduto a peso" switch;
  - when on, "Prezzo per etto (100 g)" and "Porzione di riferimento (g)", with the help text "i grammi che corrispondono a una porzione
    della ricetta";
  - switching sends `{priceUnit, price, portionWeightG}` together;
  - a 422 `portion_weight_missing` shows its message in `aria-live`.
- **Sale settings** (`/tavoli/impostazioni`, new `weight-card.tsx` next to `coperto-card.tsx`):
  - "Peso massimo per riga" in grams, with "predefinito 3.000 g" and a "Ripristina" button that sends `null`;
  - a 422 `weight_max_invalid` shows its message in `aria-live`.
- **Comanda** (`menu-item-button.tsx`, new `weight-sheet.tsx`, `line-editor.tsx`, `line-row.tsx`):
  - tapping a weighted dish opens a bottom sheet with one numeric field "Peso (g)" (autofocus, `inputmode="numeric"`, `step` 10) and
    a live "= 1,2 kg";
  - "Aggiungi" stays disabled until the value is between 50 g and the menu's `weightMaxG`, on the step;
  - at ≥ 3 × `portionWeightG` a confirm "Confermi 1.500 g?" appears;
  - the line row shows "Fiorentina · 1,2 kg · 9,00 € / 100 g" and "Importo 108,00 €" from the reply (D-11);
  - a line queued offline shows the weight and "9,00 € / 100 g", and its amount only once synced (no price arithmetic in the browser);
  - the menu tile shows "9,00 € / 100 g" and "Restano circa 1,4 kg".
- **Kitchen** (`kitchen-line.tsx`): "Fiorentina 1,2 kg" where a portion line shows "2× Tagliatelle". No price.
- **Bill** (`bill-sheet.tsx`, `close-sheet.tsx`): "Fiorentina 1,2 kg × 9,00 € / 100 g · 108,00 €".
- **Items report:** "Peso venduto" ("12,4 kg") and "media per piatto 1,23 kg" on weighted rows only.
- **Plate costs** (`/costi`, plate list and breakdown): on weighted dishes, "Porzione di riferimento 400 g a 9,00 € / 100 g".
- **Formatting:**
  - `src/lib/format/weight.ts`:
    - below 1 000 g → "250 g";
    - otherwise kg with up to three decimals and trailing zeros dropped → "1,2 kg", "1,25 kg";
    - Intl `it-IT` / `en-GB`.
  - `formatPricePerEtto` in `src/lib/money/format.ts`, built on `formatEuro`.

### 3.6 Security and privacy

- **Roles in Postgres.**
  - Flag, price and reference weight are written only by `create_menu_item` / `update_menu_item`, and the maximum weight only by
    `set_weight_settings`. All three are gated by `app.require_menu_writer()` (owner, admin).
  - Waiter and chef → 42501 before parsing.
  - `menu_item_price`, `menu_item` and `sale_settings` keep no write grant for any API role.
  - pgTAP 321 proves both points.
- **Waiters never see costs.**
  - The new waiter keys (`priceUnit`, `portionWeightG`, `weightLeftG`, `weightMaxG`, `weightG`, `pricePer100g`) are sale facts and
    quantities.
  - `order_line_cost` stays owner/admin-only.
  - **Guards:**
    - pgTAP 326 scans every waiter reply recursively (menu, lines, add/update reply, bill, sync reply) for a weighted fixture;
    - TS guard B7 does the same on the four offline-cached routes and asserts the offline-cache allowlist is unchanged;
    - pgTAP 004's fixture gains a weighted item, price row and line, plus `weight_max_g` on its `sale_settings` row, so a cost-named
      waiter-readable column would still fail it.
- **Chef:** the kitchen ticket gains `weightG` only, no money key, which pgTAP 059's chef regex checks.
- **Input validation:**
  - Zod strict bodies (integer, bounds, step) and the SQL parser, which stays the authority;
  - unknown keys → 400 / 22023.
- **Tenant:** always from `app.tenant_id()`, never from a body. Cross-tenant ids → `menu_item_not_found` / `line_not_found`.
- **Audit:**
  - menu changes write `menu_item.updated` with `price_unit` and `portion_weight_g` before/after;
  - the setting writes `sale_settings.changed` with `weight_max_g` before/after;
  - no new action or entity type, so the audit checks are unchanged.
- **Secrets:** none added, none touched.
  - The app's existing secrets stay where they are: Vercel environment variables; database-side secrets in Supabase Vault; CI
    secrets in GitHub environments.
  - The Supabase secret key is not used by any route this plan touches.
  - No third-party provider is involved.
- **Personal data / GDPR:** none added. Weights and prices are not personal data. `created_by` / `updated_by` on lines exist today.
  The venue is in the EU: data stays in the existing EU-region Supabase.

### 3.7 Sequence (add → fire → bill)

1. `add_order_line(session, {lineId, menuItemId, clientUpdatedAt, weightG: 1200})`:
   1. role;
   2. keys;
   3. replay check;
   4. session FOR SHARE;
   5. the item and its sale terms (`etto`, 5,50, `portion_weight_g` 400);
   6. `app.order_weight` against 50 g, the step and `app.weight_max_g(tenant)`;
   7. batch locks FOR SHARE;
   8. availability (0 left → `item_unavailable`);
   9. insert `qty 1, weight_g 1200, price_per_100g 5.50, portion_weight_g 400, unit_price 66.00` (the trigger checks it).
2. `fire_course` locks as today. Portions = 1200 / 400 = 3. Batches take `round(3 × need, 4)` FEFO, raw stock takes
   `round(3 × need, 4)`, and `freeze_line_cost` sums those rows.
3. `session_bill_json`: amount `round(1 × 66.00, 2)`, splits in cents, as today. `close_table` freezes the total. The day close sums
   the frozen totals.

## 4. Alternatives considered

- **Store the price per kg or per etto on the line and compute `price × weight` in every reader.** Rejected. The bill, the token, the
  splits, `kpi_sales_lines` and the exports would each need the formula. That means several rounding places and several re-pinned
  money functions. Storing the rounded line price in `unit_price` with `qty = 1` leaves every money reader byte-identical. The cost
  is the display rule D-11, which B11 enforces.
- **`qty` = the portion fraction (e.g. 3) instead of 1.** Rejected.
  - The founder decided plates count 1 per line.
  - The half-step CHECK would break.
  - The bill amount would be `qty × unit_price` with a per-portion price that is not what the menu says.
- **The line-price formula as a CHECK constraint.** Rejected (L-4). A CHECK is re-evaluated on every update of the row, including the
  void of a fired line, so changing the rounding rule later (V1) would make old fired lines unvoidable. The trigger checks only when
  the weight or the price is written.
- **The maximum weight as an app-level value** (a constant, or an environment variable). Rejected (L-5).
  - A constant needs a migration and a deploy to change.
  - An environment variable is invisible to SQL without a Vault copy, and is the same for every tenant.
  - The owner cannot change either.
- **The maximum weight per menu item.** Rejected for now. It is more settings than the founder asked for, and the confirm at
  3 × the reference portion already catches dish-specific typos. It remains possible later as a nullable column.
- **The maximum weight in `tenant.settings` (JSON).** Rejected. That row is read by every member, the chef included, and has no
  sale-rule writer or audit action. `sale_settings` already has both.
- **Extending `set_sale_settings` with an optional `weightMaxG`.** Rejected. Its coperto keys are required (an M17 contract, pgTAP
  154), so changing the maximum would force re-sending the coperto, or the contract would change.
- **The reference portion weight on the recipe version (immutable).** Rejected for now.
  - `app.recipe_type_fields` forbids plate output fields.
  - It would need `create_recipe_version`, the import and their M7 pins changed.
  - The founder placed the setting on the menu item.
  - Freezing the value on the line gives the same "it cannot change under a sold line" guarantee.
- **A `sold_by_weight` boolean on `menu_item` with unit-less price rows.** Rejected. Switching it would silently reinterpret every
  past price row, and margins "as of a date" would use the wrong unit.
- **Change `app.menu_item_price_at` to return the unit.** Rejected. It is pinned (169, 255) and used by seven callers. A sibling
  function touches only the callers that need the unit.
- **A separate `order_line_weight` table.** Rejected. Every reader (bill, kitchen, KPI, fire, invariant check) would need a join for
  a field that belongs to the line.
- **`unitPrice` null (or per 100 g) on weighted lines in the replies.** Rejected.
  - It would change the M18/M21 shapes and the outbox label for every client.
  - The bill already has `amount`, and adding `pricePer100g` gives screens what D-11 needs without breaking a reader.
- **A price preview computed in the browser.** Rejected: `CLAUDE.md` says no data logic in React. The server reply carries the line
  price; an offline-queued line shows the per-etto price and the weight only.
- **One PR.** Rejected (§5, "PR split").
- **Re-weigh at the pass.** Not built (founder D-3).

## 5. Build plan (test first: each step's named test is written and seen failing, then the code; one commit per step)

### PR split

- **PR 1, `feat/p2-0b-sell-by-weight` (this branch): SQL, the server layer and the integration test (A1–A9).**
  - It ships "dark": no item can be weighted without a price row of unit `etto`, and no screen offers one yet. Every existing
    behaviour stays byte-identical, which the re-pinned md5 pins and the green M17–M24 suites prove.
  - It has to carry the TS output schemas, because the strict schemas turn the new reply keys into a 500 otherwise.
- **PR 2, `feat/p2-0b-sell-by-weight-ui` (branched from the merged PR 1): screens, offline builders, exports, unit-price surfaces,
  demo data, e2e, ADR and runbook (B1–B11).**
- **Why two:**
  - PR 1 holds every pinned-procedure change and the money pgTAP. Landing it first gives it the longest time on staging before
    go-live.
  - PR 2 is UI and can be reviewed on its own.
  - Each diff stays reviewable.
  - If PR 2 slips past go-live, PR 1 is harmless on `main` and V5 (the OQ-2 placeholder) covers service.
- **Why not three:** splitting PR 1 further (menu vs order vs fire) would merge intermediate states that are each consistent but
  untested end to end. The A6 money test needs all of A1–A5.

### Shared lists changed on purpose

| List | Change | Step |
|---|---|---|
| pgTAP md5 pins: `app.order_line_guard` (179, 214, 229) | re-pinned to A1 | A1 |
| `public.menu_list` (179, 255), `public.update_menu_item` (255), `app.menu_items_json` (255; a gap in the first list, added by the lead), `app.plate_cost_rows` (159, 207, 240); `public.plate_costs`, `public.plate_breakdown` wherever pinned (found with `grep -ln "plate_costs\|plate_breakdown" supabase/tests/database/*preserv*`) | re-pinned to A2 | A2 |
| `public.add_order_line` (179, 214, 222, 255), `public.update_order_line` (179, 214, 222), `app.order_line_json` (179, 214, 229) | re-pinned to A3 | A3 |
| `public.fire_course` (214, 222, 229, 240, 255), `app.freeze_line_cost` (240), `app.ledger_checks_body` (196, 222, 229, 240; a gap in the first list, added by the lead: 196, 229 and 240 pin it too) | re-pinned to A4 | A4 |
| `app.session_bill_json` (240), `app.kitchen_ticket_rows` (229), `app.kpi_sales_lines` (255, 286), `app.kpi_items_json` (286) | re-pinned to A5 | A5 |
| `public.update_menu_item` (255 by `prosrc`, 327 by function definition): the `push_active` check, then the reference weight written to the terms row; `app.menu_items_json` (255, 327), `public.create_menu_item` (327), `app.menu_item_sale_terms_at` (327): the reference weight read from or written to the price row | re-pinned on purpose by the review fix (second re-pin of each; the only ones in the fix: the rounding and test-label fixes change no function) | review fix |
| pgTAP fixtures 004, 320, 323, 324 and `scripts/test-db-races.sh` | the reference weight moves from the `menu_item` insert to the `menu_item_price` insert; 320's weight checks move to the price row; 321's history counts gain the row a weight change now writes; `tests/config/p2-0b-preserves.test.ts` no longer lists `menu_item` as altered | review fix |
| **Unchanged on purpose** (asserted in 327): `public.void_line`, `public.remove_order_line`, `public.order_view`, `public.open_table`, `public.close_table`, `app.close_session_at`, `app.app_vs_register_json`, `public.enter_day_close`, `app.split_cents`, `app.bill_split_items`, `app.rollup_daily_kpi`, `app.kpi_day_row`, `app.kpi_session_rows`, `app.plates_sold`, `app.menu_item_price_at`, `app.menu_item_availability`, `app.apply_op_dispatch`, `public.apply_op`, `app.deplete_line_batches`, `app.post_plate_raw_outflow`, `app.lock_fire_batches`, `public.set_sale_settings`, `public.sale_settings_read`, `app.coperto_settings`, `public.plate_margins_pct`, `public.recipe_cost_at` | — | A7 |
| **Shape pins extended on purpose** (lead, A2): exact key-set tests keep their exact form with the new keys. Top level of `menu_list` + `weightMaxG` (153, 162); waiter item + `priceUnit`, `portionWeightG`, `weightLeftG`, now fourteen keys (153, 162 twice, 254); manage item + `priceUnit`, `portionWeightG`, now eighteen (153); the owner `money` block of `plate_breakdown` (181) | extended | A2 |
| **Shape pins extended on purpose, A5** (same exact-key kind as A2 and A3): the bill line gains `weightG`, `pricePer100g` (216); the kitchen line gains `weightG`, now nine keys (175, 225); the items row gains `weightG`, `avgWeightG` (235) | extended | A5 |
| **Shape pins extended on purpose, A8** (same exact-key kind): the TS twins of the shapes above and the committed JSON Schema snapshots gain only the new keys: order line fifteen keys (`tests/server/orders/output.test.ts`), waiter menu item fourteen and the top-level `weightMaxG`, manage item eighteen, bill line, kitchen line, items row, push reply item (`push_menu_item` is unchanged but returns `menu_items_json`), `plate_costs` rows and the owner `money` block of the plate breakdown; the plate-costs route test lists the three new keys. The recipe-cost route's plate has no weight keys (its SQL is unchanged). The sync payload and API tests gain weight cases. Snapshots changed by additions only | extended | A8 |
| **A8 deviations from §3.4:** (1) `priceUnit` and `portionWeightG` are type-checked only in the menu bodies, so `price_unit_invalid` and `portion_weight_invalid` reach the database and come back 422, as §3.4 lists; (2) on `POST /api/sync` a wrong key (`weight`) is a per-op `rejected invalid_request` without an RPC (the M20 rule for any bad payload), not a 400 for the whole batch; (3) the weight setting route lives in `src/server/menu/weight-settings.ts` and answers PUT with `{changed, weightMaxG}`; (4) `pendingLine` and the offline overlay give `weightG: null, pricePer100g: null` (the screens that queue a weighted line are PR 2, B3/B4) | as built | A8 |
| **A9 as built:** written and type-checked, not run (it needs the Supabase stack, which this machine does not have; it skips without it and throws in CI when the settings are missing). The end of the day is read through `GET /api/reports/app-vs-register` (there is no `GET /api/day-close`; the route is POST only), as the M21 suite does | as built | A9 |
| **Bill token, A5 (deviation from §3.3):** the token string adds `':' \|\| weight_g` for a weighted line only, not `coalesce(weight_g::text, '-')` on every line, so a session without weighted lines keeps its M21 token exactly (the plan asks for both; only the conditional form satisfies both) | as built | A5 |
| **Shape pins extended on purpose, A3**: the order line JSON gains `weightG` and `pricePer100g`, so the exact thirteen-key sets become fifteen (161, 163, 166, 172) | extended | A3 |
| pgTAP `229` (md5 of the other public function names) | `weight_settings` and `set_weight_settings` added to its `not in` list | A2 |
| `tests/config/m25a-preserves.test.ts`, `tests/config/m25-preserves.test.ts` (`LAST_MIGRATION`), `tests/config/m25b-preserves.test.ts` (`ALLOWED_NEW_MIGRATIONS`) | the `20261130*` names allowed on purpose, moved forward with each migration step | A1–A5 |
| `tests/config/p2-0b-preserves.test.ts` **new** | the `20261130*` files, the replaced-function list, exactly two new public functions (`weight_settings`, `set_weight_settings`), the protected list above, `alter table` only on `menu_item_price`, `sale_settings`, `order_line` (`ALTERED_TABLES` no longer lists `menu_item`, review fix) | A1 (grown each step) |
| pgTAP 004 fixture (M0 waiter columns) | a weighted price row carrying `portion_weight_g` (the weight is on the price row, not the item; review fix), a weighted line, `weight_max_g` on the `sale_settings` row | A1 |
| `tests/config/no-new-deps.test.ts`, `tests/lint/offline-cache-allowlist.test.ts`, audit checks, alert registry, `app.demo_purge_tables()`, `cron.job` | unchanged on purpose | A7, B7 |
| Items CSV snapshot (`tests/server/exports/items.test.ts`) | `peso_venduto_g`, `peso_medio_g` appended to the base columns | B6 |

### PR 1: SQL and server (`feat/p2-0b-sell-by-weight`)

| # | Step (one commit) | Files | Test that proves it (written first, must fail first) |
|---|---|---|---|
| A1 | **Weight core: columns, helpers, the weight setting column, price trigger, guard** | `supabase/migrations/20261130100000_weight_core.sql`; `supabase/tests/database/320_weight_core.test.sql`; pgTAP 004 (fixture), 179, 214, 229 (guard re-pin); `tests/config/p2-0b-preserves.test.ts`; `tests/config/{m25a,m25,m25b}-preserves.test.ts` | **Rounding vectors** of `app.weight_line_price`: 5,50 × 1 200 g = 66,00; 9,00 × 1 200 = 108,00; 4,25 × 1 230 = 52,28 (52,275 → up); 3,35 × 250 = 8,38 (8,375 → up); 2,99 × 50 = 1,50 (1,495 → up); **ties whose rounded cent is odd, added by the review fix** (the ties above round to an even cent either way and cannot tell half-up from half-even): 1,05 × 50 = 0,53; 4,25 × 1 210 = 51,43; 3,35 × 150 = 5,03 (half-even would give 0,52 / 51,42 / 5,02); 7,77 × 3 000 = 233,10; 0 × 500 = 0,00. `app.order_line_portions(2, null, null)` = 2; `(1, 1200, 400)` = 3; `(1, 1000, 300)` = 3.3333… (unrounded). **Constants:** `weight_min_g` 50, `weight_step_g` 10, `default_weight_max_g` 3000, setting bounds (500, 10000). **`app.weight_max_g`:** no `sale_settings` row → 3000; a row with a null coperto and `weight_max_g` 4000 → 4000; `app.coperto_settings` for that tenant → zero rows (the coperto stays unset); tenant B unaffected. **`sale_settings` CHECK:** 490, 10 010 and 1 005 refused. **Checks:** a weighted row with `qty 2` → `order_line_weight_ck`; two of the three weight columns set → `order_line_weight_set_ck`; `menu_item.portion_weight_g` 9 and 3 001 refused. **Price trigger (L-4):** inserting `unit_price` 66,01 for 5,50 × 1 200 → `order_line_price_mismatch`; 66,00 → ok; a weight change without the matching price → `order_line_price_mismatch`; voiding a fired weighted line (only `voided_*` written) does not fire the price check. **Guard:** on a draft weighted line, `weight_g` 1200 → 1300 with `unit_price` 71,50 is allowed; `unit_price` alone → `order_line_immutable`; `price_per_100g` or `portion_weight_g` changed → `order_line_immutable`; on a fired weighted line any weight change → `order_line_fired`; on a **portion** line `unit_price` still → `order_line_immutable` (M18 cases re-run green). **Back-fill:** existing `menu_item_price` rows read `portion`; existing `sale_settings` rows have `weight_max_g` null; no `order_line` row changed (a count of rows with any weight column set = 0 after the migration on the M18 fixture). **Append-only:** `menu_item_price` update/delete still raise. **Pins:** `app.order_line_guard` re-pinned in 179, 214, 229 with a comment "re-pinned on purpose by P2-0b A1". **`p2-0b-preserves.test.ts`:** the `20261130*` files are exactly the steps so far, sort after `20261129100000`, create no table, alter only the four listed tables, and replace only the listed functions; `m25a`/`m25`/`m25b` allow the new names |
| A2 | **Menu terms, flag rules, the weight setting, menu read, plate margins and plate cost reads** | `…20261130100100_weight_menu.sql`; `supabase/tests/database/321_weight_menu.test.sql`; pgTAP 159, 179, 207, 229 (names), 240, 255 and the `plate_costs` / `plate_breakdown` pins (re-pins) | **Create:** `{priceUnit:"etto", price:5.5, portionWeightG:400}` → one price row `etto`, `menu_items_json` has `priceUnit:"etto", portionWeightG:400`; `priceUnit:"etto"` without `portionWeightG` → `portion_weight_missing`. **Update:** `{priceUnit:"etto"}` without `price` → `price_required`; `{priceUnit:"etto", price:5.5}` on an item without a weight → `portion_weight_missing`; with `portionWeightG` in the same patch → ok, one new price row, one audit row whose `after` has `price_unit` and `portion_weight_g`; `{portionWeightG:null}` while `etto` → `portion_weight_missing`; back to `{priceUnit:"portion", price:14}` → ok, history keeps both rows in order. `priceUnit:"kg"` → `price_unit_invalid`; `portionWeightG` 9 / 3 001 / 400.5 → `portion_weight_invalid`. **Weight setting:** `set_weight_settings({weightMaxG:4000})` on a tenant without a `sale_settings` row → a row with a null coperto and 4000, one `sale_settings.changed` audit with `weight_max_g` before null / after 4000; the same value again → `changed:false`, no audit; `null` → back to the default, `weight_settings().weightMaxG` = 3000; 490 / 10 010 / 1 005 / `"4000"` → `weight_max_invalid` (22023 for the string); `{}` or an extra key → 22023; then `set_sale_settings` with a coperto keeps `weight_max_g` 4000, and `open_table` freezes the coperto as before (pgTAP 154 re-runs green). **Roles:** waiter and chef → 42501 before parsing on `create/update_menu_item`, `weight_settings` and `set_weight_settings`; owner B cannot touch A's item (`menu_item_not_found`) or A's setting; a direct `insert into public.menu_item_price` or `update public.sale_settings` as owner → 42501. **`menu_list`:** a weighted item → `priceUnit:"etto"`, `price:5.5`, `portionWeightG:400`; with 3,5 portions left → `weightLeftG:1400`; with none mapped → `weightLeftG:null`; a portion item → `priceUnit:"portion"`, `portionWeightG:null`, `weightLeftG:null`; a pushed weighted item shows `pushPrice` per etto; top-level `weightMaxG` 3000, then 4000 after the setting. **`app.menu_item_sale_terms_at`:** the unit in force at an instant follows the history (before the switch `portion`, after `etto`). **`plate_cost_rows`:** a plate mapped by an `etto` item at 5,50 / 400 g gets `sale_price` 22,00 and its GP % from that; a portion item's row is byte-identical to before (snapshot of the M17 case). **`plate_costs` / `plate_breakdown`:** the weighted plate's row has `priceUnit:"etto"`, `pricePer100g:5.5`, `portionWeightG:400`, `salePrice:22`; a portion plate's row = the previous shape + the three keys null; the chef's `plate_margins_pct` is unchanged (md5 in 327). Re-pins of `menu_list`, `update_menu_item`, `plate_cost_rows`, `plate_costs`, `plate_breakdown`; 229's list gains the two new public functions. **Review fix, Q-W15:** the reference weight is a term of the price row, so a weight-only change writes a new terms row (321's counts after the weight-only change are 3 and, after the later switches, 5; the history is `portion:14,etto:3.35,etto:3.35,portion:14`). **Review fix, `push_active`:** `update_menu_item` refuses a unit switch while a push is in force (P0001 `push_active`, 422). **Tests added by the review fix:** `328_weight_push_unit.test.sql` (step A2/A3: a switch is refused while a push runs in both directions and nothing changes, works after the push stops and the next add uses the new unit's price, other edits are as before; a push on a weighted dish is per etto and compared with the per-etto menu price) and `329_weight_terms_history.test.sql` (step A2: yesterday's `plate_costs` / `plate_breakdown` do not move after a weight change or a unit switch, today's use the new terms, clearing the weight on a weighted item is refused, the table check refuses an etto row without a weight, the menu reads return the current terms). Re-pins of `create_menu_item`, `menu_items_json` and `menu_item_sale_terms_at` by the fix |
| A3 | **Order entry with weight, offline payload keys** | `…20261130100200_weight_order_entry.sql`; `supabase/tests/database/322_weight_order_entry.test.sql`; pgTAP 179, 214, 222, 229, 255 (re-pins); `scripts/test-db-races.sh` (case `weight_edit_vs_fire`) | **Add:** `weightG:1200` on the `etto` item → `qty 1, weightG 1200, pricePer100g 5.5, unitPrice 66` (reply and row), `portion_weight_g` 400 copied; no `weightG` → `weight_required`; `weightG` on a portion item → `weight_not_allowed`; `qty:2` with a weight → `qty_invalid`; 40 / 3 010 / 1 205 / 1200.5 → `weight_invalid`, `"1200"` → 22023. **The maximum follows the setting:** with the default, 3 000 ok and 3 010 → `weight_invalid`; after `set_weight_settings({weightMaxG:4000})`, 4 000 ok and 4 010 refused; after lowering it to 1 000, an existing 1 200 g draft keeps its weight and accepts a note edit, a weight edit to 1 100 → `weight_invalid`, and tenant B still accepts 3 000. While a push at 4,50 runs → `pricePer100g 4.5, unitPrice 54`, `price_source 'push'`; sold out (0 portions) → `item_unavailable` as today; a replay with the same `lineId` → `created:false` and nothing written. **Freeze at add (L-1):** after the owner changes the price to 6,00 and the reference weight to 500 g, the line keeps 5,50 and 400. **Update:** `weightG:1300` on the draft → `unitPrice 71.5`, `changed:true`; the same weight and caller at the same stamp → `changed:false`; a weight increase with 0 portions left → `item_unavailable`; a decrease never checks stock; `qty` on a weighted line → `qty_invalid`; `weightG` on a portion line → `weight_not_allowed`; on a fired line → `{conflict:{reason:"fired"}}`. **Remove** and **void** of a weighted draft behave as M18/M19 (no movement). **`apply_op`:** an `add_line` op with `weightG` → applied; an **M20-shape op without `weightG`** for a portion item → applied byte-identically to today (the M20 fixtures of pgTAP 210–214 re-run green); the same op for a weighted item → stored `rejected` `weight_required` with `stop:true`; an op above a maximum lowered since it was queued → stored `rejected` `weight_invalid`; an `edit_line` with `weightG` → applied; an unknown key (`weight`) → 22023 and nothing stored. **Waiter JSON:** `order_line_json` keys = the M18 set + `weightG`, `pricePer100g`. **Race `weight_edit_vs_fire`:** an edit of the weight and a fire of the same line at once → either the fire sees the new weight (and depletes it) or the edit gets `conflict fired`; never both, never a deadlock. Re-pins of `add_order_line`, `update_order_line`, `order_line_json` |
| A4 | **Fire, frozen cost, invariant check, forecast** | `…20261130100300_weight_fire.sql`; `supabase/tests/database/323_weight_fire.test.sql`; pgTAP 214, 222, 229, 240, 255 (re-pins); pgTAP 117 (still green) | **Fixture:** a plate with one batch key (need 1 portion per plate), one raw stock ingredient (0,4 kg per plate) and one non-stock ingredient (salt); two batches of the key, the first expiring earlier with 2 portions left. **Fire** a 1 200 g line on a 400 g reference (portions 3): consume rows −2 on the first batch and −1 on the second (FEFO); raw consumption −1,2 kg; `order_line_cost.total_cost` = 3 × the plate's per-portion cost (exact fixture values), `unit_cost_at_sale` = `total_cost` (qty 1). A 1 000 g line on 300 g: the batch takes `round(3.3333… × 1, 4)` = 3.3333 and `fire_depletion` stays empty. Shortage: 5 portions needed, 3 left → booked below zero and `negative_stock` raised with `short_portions_qty` 2, as for portions. A portion line fires exactly as before (the M19 cases of pgTAP 170–179 re-run green). **Void** after fire (unchanged `void_line`): one reversal and one waste row per consume row, of the same fractional portions; the cost row stays; `fire_depletion` empty. **`app.ledger_checks_body`:** an extra consume row for a fired weighted line, inserted by the test as the migration owner, is reported by `fire_depletion`; every earlier check of 117 / 129 still fires on its own fixture; still one statement. **`forecast_portion_lines`:** a closed weighted line of 1 200 g / 400 g contributes 3 portions to its batch key; the 251 cases stay green. Re-pins of `fire_course`, `freeze_line_cost`, `ledger_checks_body` |
| A5 | **Reads: bill, kitchen, KPI lines and items** | `…20261130100400_weight_reads.sql`; `supabase/tests/database/324_weight_reads.test.sql`; pgTAP 229, 240, 255, 286 (re-pins) | **Bill:** a weighted line → `{qty:1, weightG:1200, pricePer100g:5.5, unitPrice:66, amount:66}`; a portion line's JSON = the M21 shape + `weightG:null, pricePer100g:null`; changing a draft's weight from 1 200 to 1 210 g changes `billToken` (even where the cents would not change, e.g. 0,01 €/etto); a session without weighted lines gets the **same** `billToken` as before the migration (the M21 token vectors of 216 re-run green). **Kitchen:** the weighted line has `weightG:1200` and no price key; no key matches the chef regex of 059. **KPI:** `kpi_sales_lines` returns `weight_g` 1200 for the weighted line, null for others, and the same `qty`/`gross`/`net` as before for portion lines; `kpi_items_json` row of the weighted item with lines of 1 230 g and 1 220 g → `plates:2`, `weightG:2450`, `avgWeightG:1225`, `mixPct` from plates; a portion item's `weightG` and `avgWeightG` null; no unit-price key in any row; totals have no `weightG`. Re-pins of `session_bill_json`, `kitchen_ticket_rows`, `kpi_sales_lines`, `kpi_items_json`; `app.rollup_daily_kpi`, `kpi_day_row`, `plates_sold` untouched (md5) |
| A6 | **Money adds up (end to end in SQL)** and **no cost to waiters** | `supabase/tests/database/325_weight_money.test.sql`, `supabase/tests/database/326_weight_waiter_no_cost.test.sql` | **325 fixture (five lines after the review fix):** Tavolo 1 (demo), 4 covers, coperto 2,00. Lines: bistecca 1 230 g at 4,25 = 52,28; funghi 250 g at 3,35 = 8,38; tagliatelle × 1 at 14,00; tagliatelle × 0,5 = 7,00; **tagliata 1 210 g at 4,25 = 51,43 (51,425, an odd cent that half-even would round to 51,42)**. **Preview** subtotal 133,09, total 141,09. **Split by covers (4):** 35,28 + 35,27 + 35,27 + 35,27 = 141,09. **Split by items:** two groups of 2 covers, the funghi shared → the parts add up to 141,09 exactly. Fire everything; `close_table` with the preview's token → `table_session.total` 141,09. `app_vs_register_json` for the date → `app.total` 141,09; a register total of 141,09 → difference 0. `app.rollup_daily_kpi` → `revenue_gross` 141,09, `plates` 4,5 (1 + 1 + 1 + 0,5 + 1), `items_net` 120,9909 = Σ `round(gross / 1.10, 4)` of the five lines. `kpi_items_json` totals equal the stored day. **Rounding happens once:** no figure differs from Σ of the stored `unit_price × qty` by even a cent (asserted for each). **326, as the waiter of tenant A:** `menu_list`, `order_view`, `add_order_line` and `update_order_line` replies, `session_bill` (plain and both splits), and `apply_op` replies for a weighted line: a recursive key scan (`jsonb_path_query(…, 'strict $.**')` keys) finds no key matching `cost\|margin\|food\|gp\|vat\|recipe`; the chef calling `menu_list` / `order_view` → 42501; `order_line_cost`, `menu_item_price` and `sale_settings` read as the waiter → 0 rows |
| A7 | **SQL preserves** | `supabase/tests/database/327_p20b_preserves.test.sql` | The md5 of `pg_get_functiondef` of every "unchanged on purpose" function in the shared-lists table equals its value on the rebased `main` (written into the test). The re-pinned functions equal their A1–A5 values. `app.demo_purge_tables()`, `cron.job` names, the alert registry (count and md5), both audit checks and `app.sync_op_kinds()` are unchanged. The only new `public` functions are `weight_settings` and `set_weight_settings` (catalogue diff against the `main` list), each a definer with an empty `search_path`, executable by `authenticated` only. No `public` table has a new write grant for `anon`, `authenticated` or `service_role` |
| A8 | **Server layer: constants, schemas, outputs, errors, the weight setting route** | `src/server/orders/{constants,schemas,output,errors}.ts`, `src/server/menu/{schemas,output,errors}.ts`, `src/server/menu/weight-settings.ts`, `src/app/api/settings/weight/route.ts`, `src/server/sync/schemas.ts`, `src/server/bill/output.ts`, `src/server/kitchen/output.ts`, `src/server/reports/output.ts`, the `/costi` output schemas (located with `grep -rln "plate_costs\|plate_breakdown" src/server`), `src/lib/i18n/messages/{it,en}.ts`; `tests/parity/weight-constants.test.ts`, `tests/app/api/order-line.test.ts`, `tests/app/api/menu.test.ts`, `tests/app/api/menu-items.test.ts`, `tests/app/api/settings-weight.test.ts`, `tests/app/api/sync.test.ts`, `tests/app/api/bill.test.ts`, `tests/app/api/kitchen-tickets.test.ts`, `tests/app/api/reports-items.test.ts`, `tests/app/api/plate-costs.test.ts` | **Parity:** `WEIGHT_MIN_G` 50, `WEIGHT_STEP_G` 10, `DEFAULT_WEIGHT_MAX_G` 3000, `WEIGHT_MAX_SETTING_MIN_G` 500, `WEIGHT_MAX_SETTING_MAX_G` 10000, `PORTION_WEIGHT_MIN_G` 10, `PORTION_WEIGHT_MAX_G` 3000 equal the SQL constants read from the migration text. `WEIGHT_CONFIRM_FACTOR` 3 is UI only and asserted as such. No TS constant names a fixed maximum per line: the add/edit schemas check only the type, the minimum and the step, and leave the maximum to SQL. **Bodies:** `weightG` 1205 / 49 / `"1200"` → 400 with 0 RPCs; `weightG` with `qty` → 400; `weightG` 9 000 passes Zod and is judged by SQL. **Weight setting route:** waiter and chef → 403 with 0 RPCs; signed out → 401; PUT `{weightMaxG:4000}` → 200 with the reply; `{weightMaxG:"4000"}` or an extra key → 400 without an RPC; P0001 `weight_max_invalid` → 422 with it/en messages. **Errors:** `weight_required`, `weight_invalid`, `weight_not_allowed`, `portion_weight_missing`, `price_required`, `price_unit_invalid`, `portion_weight_invalid`, `push_active` (review fix: "Ferma la spinta prima di cambiare l'unità di prezzo."), `weight_max_invalid` → 422 with it/en messages (key parity). **Outputs:** each strict schema accepts the new keys (menu top-level `weightMaxG`, items `avgWeightG`, plate costs `priceUnit`/`pricePer100g`/`portionWeightG`) and rejects an extra `unit_cost` (500); the waiter menu and lines schemas contain no cost-like key (a schema-shape scan). **Sync:** an M20 op fixture **without** `weightG` parses unchanged; one with `weightG` parses; `weight` (wrong name) → 400. Snapshots updated on purpose |
| A9 | **Integration (real stack)** | `tests/integration/sell-by-weight.int.ts`, `tests/integration/helpers/menu.ts` (fake weighted items) | The owner of A creates "Bistecca a peso (demo)" (`etto`, 4,25, 400 g, mapped to a demo plate) through `POST /api/menu/items`. The waiter (PIN) adds 1 230 g through `POST /api/table-sessions/:id/lines` → 52,28 and fires through `/fire`. `GET /api/kitchen/tickets` as the chef shows `weightG:1230` and no € key. `GET /bill` → total as in A6. Closing through `helpers/closing.ts` works, and `GET /api/day-close` shows the total. The owner sets `PUT /api/settings/weight {weightMaxG:4000}`; `GET /api/menu` as the waiter shows `weightMaxG:4000`, and a 3 500 g add is accepted. A `POST /api/sync` batch with one old-shape op (no `weightG`, portion item) and one new op (`weightG`) → both applied. A waiter `PATCH /api/menu/:id` or `PUT /api/settings/weight` → 403 with 0 RPCs. Owner B sees none of A's lines and still has `weightMaxG` 3000 |

### PR 2: screens, offline, exports, unit-price surfaces, demo, e2e, docs (`feat/p2-0b-sell-by-weight-ui`, after PR 1 merges)

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| B1 | **Weight and per-etto formatting** | `src/lib/format/weight.ts`, `src/lib/money/format.ts` (`formatPricePerEtto` next to the existing `formatEuro`), `tests/lib/format/weight.test.ts`, `tests/lib/money/format.test.ts` | `formatWeight(250)` "250 g"; `1000` "1 kg"; `1200` "1,2 kg"; `1250` "1,25 kg"; `1210` "1,21 kg"; `3000` "3 kg"; en-GB "1.2 kg". `formatPricePerEtto(9)` "9,00 € / 100 g" (built on `formatEuro`), en "€9.00 / 100 g". Both are pure formatters: the tests feed reply values and assert only strings; neither module multiplies or divides a price (code-review checklist item) |
| B2 | **Menu settings "Venduto a peso" and the "Peso massimo per riga" card** | `src/app/(owner)/menu/menu-item-form.tsx`, `src/app/(owner)/menu/menu-item-card.tsx`, `src/lib/menu/menu-form.ts`, `src/app/(owner)/tavoli/impostazioni/weight-card.tsx`, `src/app/(owner)/tavoli/impostazioni/page.tsx`, `tests/components/menu-item-form.test.ts`, `tests/components/weight-card.test.ts` | **Menu form:** the switch reveals "Prezzo per etto (100 g)" and "Porzione di riferimento (g)". Saving sends exactly `{priceUnit:"etto", price, portionWeightG}`. Switching off sends `{priceUnit:"portion", price}`. A 422 `portion_weight_missing` puts its message in `aria-live` and keeps the form. The card shows "9,00 € / 100 g · porzione 400 g". **Weight card:** it shows the value from `GET /api/settings/weight` ("3.000 g, predefinito"). Saving 4000 sends `{weightMaxG:4000}`. "Ripristina" sends `{weightMaxG:null}`. A 422 `weight_max_invalid` puts its message in `aria-live`. The field accepts 500–10 000 in steps of 10 (from the reply's `settingMinG`, `settingMaxG`, `stepG`). The page makes its reads in parallel. Targets ≥ 44 px. Both pages stay owner/admin only (existing nav and route guards unchanged) |
| B3 | **Comanda: weight sheet and weighted lines** | `src/app/(owner)/tavoli/comanda/{menu-item-button,weight-sheet,line-editor,line-row,menu-section,pinned-strip}.tsx`, `src/lib/orders/line-form.ts`, `src/lib/orders/order-view.ts`, `src/lib/i18n/messages/{it,en}.ts`, `tests/components/order-page.test.ts`, `tests/lib/orders/line-form.test.ts` | Tapping a `priceUnit:"etto"` item opens the sheet (focus on the field, `inputmode="numeric"`), never adds directly; a portion item still adds in one tap. With the menu's `weightMaxG` 3000, "Aggiungi" is disabled for 40, 3 010 and 1 205 and enabled for 1 200 and 3 000; with a fixture `weightMaxG` 4000, 3 500 is enabled. The readout shows "= 1,2 kg". At 1 200 with `portionWeightG` 400 the confirm "Confermi 1.200 g?" appears; at 1 190 it does not. The body sent is `{lineId, menuItemId, clientUpdatedAt, weightG:1200}` with no `qty`. The row shows "1,2 kg · 9,00 € / 100 g" and "Importo" with the reply's `unitPrice`. Editing a draft opens the sheet with its weight; the patch is `{weightG, clientUpdatedAt}`; the qty stepper is hidden on weighted lines. The tile shows "9,00 € / 100 g" and "Restano circa 1,4 kg" from `weightLeftG`. A 422 `weight_required` shows "Inserisci il peso". `line-form.ts` does no price arithmetic (the unit test feeds a reply and checks the formatter is called with `unitPrice` only) |
| B4 | **Offline op builders carry the weight** | `src/lib/sync/ops.ts`, `src/lib/sync/types.ts`, `tests/lib/sync/ops.test.ts`, `tests/lib/sync/replay-compat.test.ts` | `addLineDraft({…, weightG:1200})` → payload has `weightG:1200` and no `qty`; the label has `weightG` and `pricePer100g`, and **no** `unitPrice` and no computed total (D-11). `editLineDraft` with a weight change → `{lineId, weightG}`; an unchanged weight → `null` (nothing queued). **Compat:** an outbox entry serialized by the M20 build (JSON fixture captured from the current tests) deserializes, renders its label and is sent with a byte-identical payload; its `payload_hash` input string is unchanged |
| B5 | **Kitchen and bill show the weight** | `src/app/(owner)/cucina/kitchen-line.tsx`, `src/lib/kitchen/kitchen-view.ts`, `src/app/(owner)/tavoli/comanda/{bill-sheet,close-sheet}.tsx`, `src/lib/bill/bill-view.ts`, `tests/components/kitchen-line.test.ts`, `tests/components/bill-sheet.test.ts` | Kitchen: a `weightG:1200` line renders "Fiorentina 1,2 kg" with no "1×"; a portion line still "2× Tagliatelle"; no € anywhere in the kitchen DOM (text scan). Bill: "Bistecca a peso (demo) 1,23 kg × 4,25 € / 100 g" and "52,28 €"; the split and total come from the reply unchanged |
| B6 | **Items report and export** | the items report table component under `src/app/(owner)/` (located at build time with `grep -rl "foodMarginPerPlateEur" src/app`), `src/server/exports/tables/items.ts`, `tests/server/exports/items.test.ts`, `tests/components/items-report.test.ts` | The CSV has `peso_venduto_g` and `peso_medio_g` as the last base columns (before the owner-only columns): `2450` and `1225` for the weighted item, empty for others. The snapshot changes only by those columns. The report shows "Peso venduto 2,45 kg" and "media per piatto 1,23 kg" only on rows with `weightG`. `tests/guards/exports-reuse.test.ts` stays green (the export still calls the report service) |
| B7 | **Guard: no cost in waiter payloads or the offline cache** | `tests/guards/waiter-weight-no-cost.test.ts` | For the four offline-cached routes (`/api/me`, `/api/menu`, `/api/tables`, `/api/table-sessions/:id/lines`) and `POST /api/sync`, with weighted fixtures replied by a mocked RPC: the response JSON has no key, at any depth, matching `/cost\|margin\|food\|gp\|vat\|recipe/i`; the strict schema rejects an injected `unitCost` (500). `OFFLINE_CACHE_PATHS` and `OFFLINE_CACHE_ROLES` are unchanged (equality). `tests/lint/offline-cache-allowlist.test.ts` stays green unchanged |
| B8 | **Fake demo data** | `scripts/lib/demo/fixture.ts`, `scripts/lib/demo/seed.ts`, `tests/scripts/demo/fixture.test.ts` | The fixture has "Bistecca a peso (demo)" (`etto`, 4,25, `portionWeightG` 400, mapped to a new demo plate "Bistecca (demo)" using a fake "Manzo (demo)" ingredient) and "Funghi fritti a peso (demo)" (`etto`, 3,35, 200 g, unmapped). Every name ends "(demo)"; no value comes from `docs/client/` or from the live menu of §1.x. The seed creates them through `create_menu_item` (spy on the RPC body). The purge test stays green (no new table) |
| B9 | **Playwright** | `e2e/sell-by-weight.spec.ts`, `e2e/helpers/menu.ts` | `phone` project. The owner switches a demo dish to "a peso" (4,25 / 100 g, 400 g). The waiter opens Tavolo 2 (demo), taps it, types 1230, sees "= 1,23 kg", adds, and sees "1,23 kg · 4,25 € / 100 g" and 52,28 €. They send the course; the kitchen context shows "1,23 kg". The bill split by 2 covers shows two parts adding up to the total. They close with a receipt number. As the waiter, `page.request.get("/api/menu")` has no cost key. `expectPhoneFriendly` on the comanda with the sheet open |
| B10 | **ADR and runbook** | `docs/adr/adr-035-sell-by-weight.md` (number re-checked), `docs/guides/vendita-a-peso.md` (Italian: switch a dish to weight, what the reference portion means, the "Peso massimo per riga" setting, what happens to stock and cost, how to correct a wrong weight before and after sending) | `npm run format:check` green on the two files. The code-review checklist confirms the ADR records D-2, D-4, D-11, L-1 to L-5, P-1 to P-4 and the rejected alternatives of §4, and that the guide states no legal or fiscal rule |
| B11 | **Unit-price surfaces (D-11)** | `tests/guards/weight-unit-price-surfaces.test.ts`, `src/app/(owner)/costi/*` (plate list and breakdown rows, located with `grep -rl "salePrice" src/app`), `src/app/(owner)/menu/*` (push sheet), `tests/components/plate-costs.test.ts` | **Render test:** each surface in the D-11 table is rendered with a weighted fixture whose line total is 108,00 and whose price is 9,00 / 100 g at 1 200 g: comanda line row and line editor, outbox list, menu tile and pinned strip, menu settings card and push sheet, bill sheet and close sheet, kitchen line, items report row, plate costs row and breakdown. Each must contain "9,00 € / 100 g" (or "/ etto") and, where a line is shown, "1,2 kg". None may contain "1 × 108,00", "1× 108,00", "108,00 € cad" or "108,00 € / " (a regex over the text). The kitchen line contains no "€" at all. **Exports:** the header row of every CSV in `src/server/exports/registry.ts` contains no `prezzo_unitario`, `unit_price` or `prezzo_per` column. `items.csv` has `peso_venduto_g` and `peso_medio_g`, and `unmapped.csv` is unchanged (snapshot). **Plate costs:** a weighted plate shows "Porzione di riferimento 400 g a 9,00 € / 100 g = 36,00 €"; a portion plate is unchanged (snapshot) |

### Acceptance tests (AT-W, §5a style)

| # | Requirement → proof | Step(s) | Command |
|---|---|---|---|
| AT-W1 | Owner/admin switch a dish to weight with a price per etto and a reference portion weight; without the weight the switch is refused; waiter and chef cannot do it | A2, A8, B2 | `npx supabase test db`; `npm test` |
| AT-W2 | The waiter must enter a weight for a weighted dish: at least 50 g, in steps of 10 g, at most the tenant's "Peso massimo per riga" (default 3 000 g, changeable by owner/admin only); a weight ≥ 3 × the reference asks for confirmation | A1, A2, A3, A8, A9, B2, B3 | as above |
| AT-W3 | Line price = price per etto × grams ÷ 100, rounded once to the cent, half-up, in SQL; the price frozen at add, the weight editable while a draft, the line price final at fire; enforced by a trigger, not a CHECK | A1, A3, A6 | `npx supabase test db` |
| AT-W4 | Bill, covers split, items split, close and day close add up exactly to the cent with weighted lines | A6 | `npx supabase test db` |
| AT-W5 | Firing depletes weight ÷ reference portions, FEFO; the cost is frozen as the same fraction; a void moves the same fraction to waste; the nightly check stays clean | A4 | `npx supabase test db` |
| AT-W6 | The kitchen ticket shows "Fiorentina 1,2 kg" and no money | A5, B5, B9, B11 | `npx supabase test db`; `npm test`; `npx playwright test` |
| AT-W7 | KPIs, mix and the items export count one plate per weighted line and carry the weight sold and the average weight | A5, A6, B6 | as above |
| AT-W8 | No cost reaches a waiter payload or the offline cache | A6 (326), B7, pgTAP 004 | as above |
| AT-W9 | Offline ops with `weightG` apply; queued ops without it replay as before | A3, A8, A9, B4 | as above |
| AT-W10 | Every existing M17–M24 test stays green; every pinned function changed is re-pinned on purpose and listed | A1–A7 | `npm test`; `npx supabase test db`; `npx playwright test` |
| AT-W11 | Wherever a unit price appears (comanda, outbox, menu, push, bill, close, items report, exports, plate costs), a weighted line or dish shows its price per 100 g and its weight, never the line total as a unit price | A2, A5, A8, B3, B4, B5, B6, B11 | `npm test`; `npx playwright test` |

**CI implications:**
- pgTAP `320`–`327`;
- one new race case (`weight_edit_vs_fire`);
- one integration suite;
- one e2e spec on `phone`.

Coverage ≥ 80 % on new TS. No new dependency (`no-new-deps` unchanged).

**Before each PR is marked ready:**
- rebase on `main`, re-check the newest migration and renumber if needed;
- recompute the md5 pins on the rebased tree;
- re-check the ADR and pgTAP numbers;
- list the re-pins in the PR body.

### 5b. Variants

**V1: A different rounding rule** · Trigger: the accountant answers Q-W12 with anything but "to the cent, half-up, per line" · Replaces
steps: A1's body of `app.weight_line_price` and its vectors, and A6's expected figures

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V1.1 | `app.weight_line_price` is replaced with the accountant's rule (e.g. down to the cent, or to 0,10 €). It stays the only rounding place, and the price trigger keeps calling it. Fired lines keep the price they were sold at: the trigger checks only inserts and weight or price writes, so a later void is unaffected (L-4). A draft written under the old rule would be repriced on its next weight edit but not on a note edit. So the migration refuses to run while any weighted **draft** line exists (P0001 `weighted_drafts_open`), and it is applied between services. No row is updated | `supabase/migrations/<ts>_weight_rounding.sql`, `supabase/tests/database/330_weight_rounding.test.sql`, pgTAP 325 (expected figures), 327 (re-pin) | The accountant's vectors (written into the test once given). With an open weighted draft the migration body raises `weighted_drafts_open`; without one it applies. A fired weighted line priced under the old rule can still be voided afterwards. 325's split and day-close sums still add up exactly |

**V2: Weight typed in kg** · Trigger: Q-W3 answered "the waiter types kilograms (1,2)" · Replaces steps: B3's field and readout
(the API still takes integer grams)

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V2.1 | The sheet takes "1,2" (decimal comma, `inputmode="decimal"`) and converts it to grams by **string** parsing (no float multiply): "1,2" → 1200, "0,25" → 250; more than 3 decimals are refused | `src/lib/orders/weight-input.ts`, `src/app/(owner)/tavoli/comanda/weight-sheet.tsx`, `tests/lib/orders/weight-input.test.ts` | "1,2" → 1200; "1,23" → 1230; "0,05" → 50; "1,2345" → invalid; "1.2" (en) → 1200; the body still sends `weightG` integer |

**V3: A different minimum, step, default maximum, setting range or confirmation factor** · Trigger: Q-W1 or Q-W2 answered with other
numbers. The maximum itself needs no variant: owner/admin change it in the app. · Replaces steps: the constants of A1 and A8, and
the bounds cases of A1, A2, A3 and B3

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V3.1 | `app.weight_min_g`, `app.weight_step_g`, `app.default_weight_max_g` and/or `app.weight_max_setting_bounds` replaced with the new numbers. The `sale_settings` CHECK is re-created if the setting range changes, after checking that no stored value falls outside it. TS twins are changed | `supabase/migrations/<ts>_weight_bounds.sql`, `src/server/orders/constants.ts`, `supabase/tests/database/331_weight_bounds.test.sql`, `tests/parity/weight-constants.test.ts` | The new minimum and step are accepted at the edges and refused one step beyond. A tenant without a setting gets the new default. A stored setting outside a new range makes the migration raise `weight_max_out_of_range` instead of silently changing it. Parity green |
| V3.2 | The UI confirmation factor changed | `src/server/orders/constants.ts`, `tests/components/order-page.test.ts` | The confirm appears at the new factor and not one step below |

**V4: Stock hint in portions for weighted dishes** · Trigger: Q-W4 answered "show portions, not kilograms" · Replaces steps: B3's
tile hint (A2's `weightLeftG` stays, unused)

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V4.1 | The tile shows "Ne restano 3,5 porzioni" for weighted dishes too | `src/app/(owner)/tavoli/comanda/menu-item-button.tsx`, `tests/components/order-page.test.ts` | A weighted item with `portionsLeft` 3.5 shows "3,5 porzioni"; no kg text |

**V5: Not live at go-live (OQ-2 placeholder period)** · Trigger: PR 2 is not merged and deployed before go-live · Replaces steps:
none. It adds a runbook and a switch-over check for after go-live.

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V5.1 | Runbook: until P2-0b is live, per-etto dishes are ordinary items at a placeholder portion and price agreed with the chef (OQ-2). At switch-over, the owner deactivates each placeholder item and creates the weighted item, or switches the same item to weight with a new price row. Past rows stay as recorded (append-only), and reports before and after differ for those dishes | `docs/guides/vendita-a-peso.md` (section "Dal segnaposto alla vendita a peso") | `npm run format:check`; code review confirms that no step rewrites or deletes a past row |
| V5.2 | A pgTAP case proving the switch-over leaves history intact: a placeholder item with closed sales is switched to `etto` with a new price; the earlier lines, their costs and the stored `daily_kpi` rows are byte-identical, and new lines are weighted | `supabase/tests/database/332_weight_switch_over.test.sql` | md5 of the earlier `order_line`, `order_line_cost` and `daily_kpi` rows before and after the switch are equal; a new add requires `weightG` |

## 6. Risks and mitigations

| Risk | Mitigation |
|---|---|
| **Wrong reference portion weight** (e.g. cooked vs raw) makes every weighted fire deplete and cost the wrong fraction | Required before the switch (P-2). Shown on the menu card next to the recipe name. Frozen per line, so a correction affects only new lines. `negative_stock` alerts and the count variance surface a drift. The raw/cooked basis is Q-W10 for the chef |
| **Typing errors** (1 500 g for 150 g) | SQL bounds; a UI confirm at ≥ 3 × the reference. A draft can be edited; after fire it is voided and re-entered (normal rules) |
| **A line total read as a unit price** (`unit_price` holds the line total for weighted lines) | The display rule D-11, `pricePer100g` in every reply that has `unitPrice`, and the B11 render test over every surface found. The outbox label stops carrying `unitPrice` for weighted lines (B4) |
| **The maximum weight set too low or too high** | Owner/admin only, audited. Bounded to 500–10 000 g. "Ripristina" returns to the default. Stored lines are never re-validated, and a queued op that exceeds a lowered maximum is stored `rejected` with a clear message |
| **Bill does not match the RCH receipt** (rounding, or how the cashier keys it) | One rounding function (V1 changes it in one place); Q-W12 and Q-W13 with the accountant; the bill shows weight × price per 100 g so the cashier can key the same amount |
| **Regression in pinned core procedures** (`fire_course`, `add`/`update_order_line`, bill, KPI source) | Every change is a minimal edit (weight branch or portion expression). Every M17–M24 suite re-runs unchanged. Every pin is re-pinned on purpose and listed (§5 shared lists). 327 pins what must not change. A6 proves the money end to end |
| **`ledger_checks_body` replacement drops a check** | It is copied verbatim except one expression. pgTAP 117 (one statement) and the existing per-check fixtures re-run |
| **A weight row in `sale_settings` disturbs the coperto** | `app.coperto_settings` filters null coperto; `set_sale_settings` updates the coperto columns only. A1 and A2 test both directions; pgTAP 154 re-runs |
| **Old phones (JS cached before the deploy) add a weighted dish without a weight** | The server refuses it with `weight_required` (stored `rejected`, `stop:true`), and the phone shows the message. Runbook: switch dishes to weight only after the deploy, when the service worker has updated. Portion dishes are unaffected |
| **Price unit switched mid-service** | Drafts keep their frozen terms. A portion draft can never gain a weight (`weight_not_allowed`), and a weighted draft keeps its per-etto price. The switch needs a new price (P-3), so history is never reinterpreted |
| **Weight edit racing a fire** | Same locks as a qty edit (line FOR UPDATE). Race case `weight_edit_vs_fire` |
| **Cost leak to waiters through new keys or the offline cache** | Only sale facts and quantities are added. pgTAP 326, pgTAP 004 fixture, TS guard B7, strict output schemas |
| **Rebase collision with P2-0 PR A** (migration names, pins, preserves lists, ADR number) | Re-check checklist before each PR is ready (§5). The `20261130*` timestamps leave room after `20261129100000` |
| **Placeholder period distorts history for those dishes** (OQ-2) | Accepted: append-only, nothing rewritten. V5.2 proves it. Reports label nothing retroactively |
| **Chef or accountant answers arrive late** | The code needs no client fact. The owner enters dishes, prices and weights in the app. The defaults let PR 1 and PR 2 merge, and V1–V4 cover the answers that change behaviour |

## 7. Open questions (each with the default in force for this build)

**Founder.** Q-W1 to Q-W8 proceed on their defaults (L-3). Each is a **default, which the lead relays to the founder**; a different
answer triggers the variant named.

| # | Question | Default in force | Status | Variant if answered otherwise |
|---|---|---|---|---|
| Q-W1 | Weight limits for one line | minimum 50 g and step 10 g (fixed in code); maximum a tenant setting, "Peso massimo per riga", default 3 000 g, changeable by owner/admin between 500 and 10 000 g (L-5, P-4) | default, the lead relays to the founder | V3 (minimum, step, default or setting range); the maximum itself is changed in the app |
| Q-W2 | When to ask "Confermi?" | at ≥ 3 × the dish's reference portion weight | default, the lead relays to the founder | V3.2 |
| Q-W3 | Does the waiter type grams (1200) or kilograms (1,2)? | grams, with a live "= 1,2 kg" readout | default, the lead relays to the founder | V2 |
| Q-W4 | Stock hint for a weighted dish: kilograms or portions? | "Restano circa 1,4 kg"; low stock still at ≤ 3 portions | default, the lead relays to the founder | V4 |
| Q-W5 | May a weighted line be marked "condiviso" (shared for the split by items)? | yes, as any line | default, the lead relays to the founder | none (the default needs no code; "no" would only hide the toggle on weighted lines) |
| Q-W6 | Is a push price for a weighted dish also per 100 g? | yes | default, the lead relays to the founder | none |
| Q-W7 | Should P2-0b go live before go-live, so the OQ-2 placeholder is skipped? | yes if PR 2 is merged and deployed before go-live; otherwise V5 | default, the lead relays to the founder | V5 |
| Q-W8 | One weighted line per piece (two fiorentine = two lines)? | yes | default, the lead relays to the founder | none |

**Chef (through the founder).** These stay open questions.

| # | Question | Default in force |
|---|---|---|
| Q-W9 | Which dishes are sold by weight? (The live menu of §1.x shows three; porcini fritti is being asked by the lead) | none switched on; the owner switches them in the app |
| Q-W10 | For each, how many grams make "one portion" of its recipe, and is that **raw** (as weighed before cooking) or **cooked** weight? It must be the same basis the waiter types | none set (the switch is refused without it); the guide recommends the basis the customer orders in (raw weight as on the menu) |
| Q-W11 | Price per 100 g of each weighted dish (with the founder) | none; the owner enters it |

**Accountant (through the founder).** These stay open questions.

| # | Question | Default in force | Variant |
|---|---|---|---|
| Q-W12 | Rounding of a weighted line price: per line, to the cent, half-up? | yes: `round(price per 100 g × grams ÷ 100, 2)`, ties away from zero (= half-up for prices ≥ 0) | V1 |
| Q-W13 | How does the cashier key a weighted dish into the RCH register so the receipt matches the app? | the cashier keys the line amount shown on the app bill; the app does not talk to the register | none (process only) |
| Q-W14 | Must the receipt or the app bill show the weight and the price per 100 g? | the app bill shows "1,2 kg × 9,00 € / 100 g"; the fiscal receipt is outside the app | none |

**Lead.**

| # | Question | Default in force | Variant |
|---|---|---|---|
| Q-W15 (lead) | Past-day plate prices used the current reference weight (`menu_item_sale_terms_at` read the price and the unit as of the instant but the weight as of today) | **Decided by the lead, 2026-11-11: versioned with the terms row.** The reference weight and the unit sit on the menu price row; a change writes a new row from now; past reports do not move (pgTAP 329) | none (closed) |

**Hardening, for the lead to decide (not blocking).**

| # | Question | Default in force | Variant |
|---|---|---|---|
| Stale-client push after a unit switch | A second device still showing an old form can push 4,00 on an item that was just switched to per portion at 14,00, and the server accepts it: the push start is checked against the menu price in force (4,00 is not above 14,00), so a per-etto figure is taken as a per-portion price. `push_active` closes the opposite case (a switch under a running push), not this one | accepted as is for PR 1 | PR 2: the push request carries the expected unit (`priceUnit`), and `push_menu_item` refuses on a mismatch with the unit in force (a new 422 code, e.g. `price_unit_changed`), the form reloading the item |

## 8. Sources

- PostgreSQL documentation, mathematical functions (`round(numeric, integer)`: ties away from zero):
  <https://www.postgresql.org/docs/current/functions-math.html>
- Repo:
  - `CLAUDE.md`;
  - `docs/plans/2026-11-11-phase2-scope.md` (C17, OQ-2, OQ-3, Part 3);
  - the M17, M18, M19, M20, M21, M22, M23 and M24 plans in `docs/plans/`;
  - ADR-016, ADR-017, ADR-019, ADR-022, ADR-023, ADR-025, ADR-027;
  - the migrations and files named in §2.1, including `20261031100400_dining_tables_coperto.sql` (`set_sale_settings`) and
    `20261023110700_cost_pct_precision.sql` (`plate_costs`);
  - pgTAP 004, 117, 154, 159, 169, 179, 207, 214, 216, 222, 229, 240, 251, 255, 286, 296, 301;
  - `tests/config/*-preserves.test.ts`, `tests/lint/offline-cache-allowlist.test.ts`;
  - `src/lib/money/format.ts`, `src/server/exports/tables/*.ts`, `scripts/lib/demo/fixture.ts`.
- §1.x: the live menu source named there (lead, 2026-11-11).
