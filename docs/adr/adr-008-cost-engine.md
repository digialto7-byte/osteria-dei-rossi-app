# ADR-008 — Food cost derived on read at an explicit instant, frozen only by copying, unknown never zero

- **Status:** proposed
- **Date:** 2026-10-23 · **Decided by:** founder (pending approval of the M8 plan `docs/plans/2026-10-23-m08-food-cost.md`; its open questions Q1–Q11 have defaults in force)

## Context
- PRD 1.4: ingredient cost basis = moving average of the last N purchases (N = 3) or last price, per ingredient; recipe cost = Σ (qty × unit cost ÷ yield) + sub-recipes per quantity used; batch cost ÷ portions; plate = portions + plating; "Recipes are versioned; a price change does not rewrite history. Reports use the cost in force on the day of sale." PRD acceptance: "approving an invoice updates the moving average and every recipe cost within 5 seconds".
- Project invariants (CLAUDE.md, ADR-002): balances are derived from ledgers, never stored; ledgers are append-only; costs are frozen at production (M14 `batch_cost`) and at sale (M19 `order_line_cost`); roles are enforced in Postgres.
- Ledger facts from M5: `price_history` has one append-only row per received stock invoice line, `unit_price` in € per ingredient base unit net of VAT, dated by the invoice date (`effective_on`, then `seq`). A partial credit does not change the unit price; a fully credited line writes no row.
- Recipe facts from M7 (ADR-007): immutable versions under a stable key, `valid_from` server time, lines reference sub-recipes by key, `qty` is net usable, depth cap 12, the graph walks visit distinct recipes (migration `20261023100800`).
- Founder decision Q16 = V6 (2026-10-23): the chef sees percentages (food cost %, GP%), the menu price and the target GP%, never a € cost or € margin. Owner is the only alert recipient.

## Decision
- **Nothing cost-related is stored as a running value.** Ingredient unit cost, recipe cost and plate outputs are computed on read by `SECURITY DEFINER` SQL functions from `price_history`, `ingredient_cost_basis`, the recipe versions, `recipe_price`, `fixed_cost_period` and tenant settings, **at an explicit instant** (`p_at`; null = now). Prices count when `effective_on` ≤ the instant's Europe/Rome date; the recipe version counts when `valid_from` ≤ the instant; the basis setting counts when its `valid_from` ≤ the instant.
- **Frozen costs are copies.** M14 and M19 call the same functions with the production or firing instant inside their own transaction and store the result in `batch_cost` / `order_line_cost`; nothing ever recomputes a frozen copy.
- **Unknown is never zero.** An ingredient with no purchase in force has no cost; every recipe above it is `incomplete` with the missing ingredient ids, and its cost and percentages are null.
- **The cost basis setting is an append-only history** (`ingredient_cost_basis`), not a mutable column, so a cost "as of" a past date uses the basis then in force.
- **Cost reads are owner/admin only, in Postgres.** Every € function checks the role first; the chef has one separate function returning percentages and a status only.

## Alternatives
- **Materialised cost table refreshed by `approve_invoice`** — pros: cheap reads — cons: a stored balance (breaks the invariant), must be refreshed on every recipe version, basis change and setting change, and history needs a second table — why not: invariant; derived reads already meet the 5 s acceptance immediately.
- **Store the moving average on the ingredient at approval** — pros: one lookup — cons: drifts when an older invoice is approved late or N changes; cannot answer "as of" a date — why not: same as above.
- **Recompute frozen costs from history when reporting** — pros: no M14/M19 tables — cons: a late-approved invoice would silently change last month's food cost % — why not: PRD "a price change does not rewrite history".
- **Treat unknown cost as 0** — pros: every plate shows a number — cons: an unpriced ingredient makes a plate look cheaper; Gate 1 comparisons become meaningless — why not: correctness.
- **Chef reads € through the same functions, filtered in JSON** — pros: one code path — cons: a forgotten filter leaks € — why not: Q16 = V6 must be enforced in Postgres.

## Consequences
- Good:
  - an approval is visible in every cost read as soon as it commits (no refresh job);
  - any past date can be costed with the version, prices and basis then in force;
  - M14 and M19 reuse one engine and freeze by copying;
  - unpriced ingredients are visible (owner screen lists them) instead of hidden.
- Bad / accepted trade-offs:
  - every read walks the recipe graph (bounded by the depth cap and the distinct-node walk; a performance test pins it);
  - a late-approved invoice changes `recipe_cost_at` for past dates (the theoretical history), while frozen costs stay;
  - `avg_cost_n` and the sale VAT rate are tenant settings without history: changing them changes past theoretical costs (not frozen ones);
  - the chef can derive a € figure from the public menu price and the food cost %; the founder accepted this with V6.
- What would make us revisit this:
  - measured read times on real data that approach the 8 s statement limit of the `authenticated` role;
  - a requirement to report "what we believed on date X" (bitemporal history) rather than "what was true on date X";
  - more than one venue per tenant with different settings.
