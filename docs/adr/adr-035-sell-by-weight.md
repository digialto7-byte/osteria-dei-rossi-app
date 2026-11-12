# ADR-035: Sell by weight stores the rounded line price in `unit_price` with `qty = 1`, the per-etto price and the reference portion on the line, and shows the price per 100 g wherever a unit price appears

- **Status:** proposed
- **Date:** 2026-11-12
- **Decided by:** founder (the price per etto, weight at ordering, no re-weigh: 2026-11-11), the lead (L-1 to L-5), architect (the rest), in `docs/plans/2026-11-11-p2-0b-sell-by-weight.md`. The founder accepts it with the plan.

## Context

- A few dishes of the venue are sold by weight, at a price per 100 g (per etto). Until now every line was `qty` portions at a frozen
  `unit_price` (ADR-016, ADR-017), and ADR-016 listed per-etto items under "what would make us revisit this".
- The bill, `close_table`, the day close and the KPIs all use `round(qty × unit_price, 2)`; stock and cost follow the movement ledgers
  (ADR-002, ADR-003); waiters never see costs.
- The accountant has not yet answered how a weighted line is rounded or keyed into the RCH register (plan Q-W12, Q-W13).

## Decision

- **D-2 The price is per 100 g, entered, stored and shown as the same number.** `menu_item_price.price` holds the per-etto price when
  `price_unit = 'etto'`. The line price is `price per 100 g × grams ÷ 100`, computed in SQL.
- **D-4 One rounding, in SQL, half-up to the cent.** `app.weight_line_price(numeric, integer)` is `round(price × grams / 100, 2)`, and
  PostgreSQL's `round(numeric, int)` breaks ties away from zero, which is half-up for prices of zero or more. It is the only place a
  weighted price is rounded. The result is stored once, in `order_line.unit_price`, with `qty = 1`, so the bill, the splits, the close,
  the day close and the KPIs stay byte-identical.
- **L-1 The terms are frozen on the line at add (ADR-017).** The price per 100 g (the push price while a push runs) and the reference
  portion are copied to `order_line`. The weight is editable while the line is a draft and the line price follows it; from fire on the
  guard makes both final.
- **L-2 `qty = 1` with the line total in `unit_price` is the shape**, together with the display rule below.
- **L-3 The numbers of Q-W1 to Q-W8 proceed on their defaults**, each marked "default, the lead relays to the founder": 50 g minimum,
  10 g step, a confirmation from 3 times the reference portion, grams typed with a live kilogram readout, a stock hint in kilograms,
  shared lines allowed, a push price also per etto, one weighted line per piece.
- **L-4 The line-price formula is checked by the trigger `order_line_weight_price`, not by a CHECK.** It runs on insert and when the
  weight, the price or the per-etto price is written, so a later change of the rounding rule cannot make an old fired line impossible
  to void.
- **L-5 The maximum weight per line is a tenant setting, not a literal.** See P-4.
- **P-1 The reference portion weight lives on the menu price (terms) row** (`menu_item_price.portion_weight_g`), with the unit, and is
  copied to the line. A change writes a new terms row from now on, so a past report does not move (Q-W15, decided by the lead).
- **P-2 A missing reference weight blocks the flag.** Switching to weight, or clearing the weight while the price is per etto, is
  refused with `portion_weight_missing`; the app could not work out how much stock a weighted plate uses.
- **P-3 "Sold by weight" is derived, not stored**: it is the unit of the price row in force. A switch needs a new price in the same
  request (`price_required`), so the history says row by row what each number meant. While a push runs a unit switch is refused
  (`push_active`), because a push price is in the unit it was started in. The founder expects dishes to rarely or never switch, so
  there is no switching UI beyond that refusal.
- **P-4 Bounds.** The minimum (50 g) and the step (10 g) are fixed in code and in SQL, with a parity test. The maximum is
  `sale_settings.weight_max_g` (500 to 10 000 g, a multiple of 10, null for the default of 3 000 g), written by owner and admin through
  `set_weight_settings`, audited, and sent to the waiter as the top-level `weightMaxG` of the menu so the sheet validates offline with
  the same number. A changed maximum applies to new writes only. The UI asks "Confermi 1.200 g?" from 3 times the reference portion.
- **Depletion and cost (D-7).** Portions are `weight ÷ reference portion`, unrounded; each batch key and raw ingredient takes
  `round(portions × need, 4)`, FEFO; the cost is frozen at fire from those movements. `void_line` is unchanged.
- **Reports (D-8).** One plate per weighted line; the items report and export add the weight sold (`peso_venduto_g`) and the average
  weight per plate (`peso_medio_g`).
- **D-11 The unit-price display rule.** Every surface that shows a "unit price" shows, for a weighted line or dish, the price per
  100 g and the weight ("1,2 kg × 9,00 € / 100 g"); the line total appears only as the line's amount ("Importo 108,00 €"), never as a
  unit price ("1 × 108,00", "108,00 € cad."). The replies keep `unitPrice` for shape stability; screens read `pricePer100g` and
  `weightG` for the unit. A line queued offline shows the weight and the price per 100 g and no amount until it has synced, because
  the browser does no price arithmetic. The kitchen ticket shows the weight and no price at all. A render test over every surface and
  a check of every export header enforce the rule.
- **Waiters never see costs.** The new waiter keys (`priceUnit`, `portionWeightG`, `weightLeftG`, `weightMaxG`, `weightG`,
  `pricePer100g`) are sale facts and quantities. A guard test scans the four offline-cached routes and the sync reply for a cost-named
  key, and the offline cache allowlist and role gate are unchanged.

## Alternatives

- **Store the price per kg or per etto on the line and compute `price × weight` in every reader.** Rejected: the bill, the token, the
  splits, the KPI source and the exports would each need the formula, several rounding places and several re-pinned money functions.
  The cost of storing the line total is the display rule D-11.
- **`qty` = the portion fraction.** Rejected: plates count one per line, the half-step CHECK would break, and the bill amount would not
  be what the menu says.
- **The line-price formula as a CHECK constraint.** Rejected (L-4): a CHECK is evaluated on every update of the row, including the void
  of a fired line.
- **The maximum weight as an app-level value** (a constant or an environment variable). Rejected (L-5): a constant needs a migration
  and a deploy, an environment variable is invisible to SQL and the same for every tenant, and the owner can change neither.
- **The maximum weight per menu item.** Rejected for now: more settings than the founder asked for, and the confirmation at 3 times
  the reference portion already catches dish-specific typos. It stays possible as a nullable column.
- **The maximum weight in `tenant.settings`.** Rejected: that row is read by every member, the chef included, and has no sale-rule
  writer or audit action.
- **Extending `set_sale_settings` with an optional `weightMaxG`.** Rejected: its coperto keys are required (an M17 contract).
- **The reference portion weight on the recipe version.** Rejected for now: recipe versions forbid plate output fields, and it would
  change `create_recipe_version`, the import and their pins. Freezing the value on the line gives the same guarantee.
- **A `sold_by_weight` boolean on `menu_item` with unit-less price rows.** Rejected: switching it would reinterpret every past price row.
- **Changing `app.menu_item_price_at` to return the unit.** Rejected: it is pinned and has seven callers; the sibling
  `app.menu_item_sale_terms_at` serves the callers that need the unit.
- **A separate `order_line_weight` table.** Rejected: every reader would need a join for a field that belongs to the line.
- **`unitPrice` null (or per 100 g) on weighted lines in the replies.** Rejected: it would change the M18 and M21 shapes for every client.
- **A price preview computed in the browser.** Rejected: no data logic in React; the server reply carries the line price.
- **A kitchen re-weigh.** Not built (founder: no re-weigh). Edit and void follow the normal line rules.

## Consequences

- Good: no money reader changed, so the bill, close and day close stay exact to the cent; a changed reference weight or price never
  moves a past line or report; one rounding place if the accountant asks for another rule (variant V1).
- Bad / accepted trade-offs:
  - `unit_price` of a weighted line is a line total, so every new surface that shows a unit price must follow D-11.
  - A wrong reference portion (raw against cooked weight, Q-W10) makes every weighted fire deplete and cost the wrong fraction until it
    is corrected; a correction affects only new lines.
  - The bill shows the weight and the price per 100 g, but how the cashier keys it into the RCH register is a process question
    (Q-W13); the app does not talk to the register.
- What would make us revisit this: the accountant's answer to Q-W12, a dish that must switch between a portion and a weight often,
  a Bluetooth scale (Phase 3), or a per-dish maximum.
