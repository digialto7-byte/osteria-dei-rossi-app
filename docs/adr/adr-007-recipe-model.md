# ADR-007 — Recipes as immutable versions under a stable key, with a split price table, net-quantity lines and an explicit allergen state

- **Status:** proposed
- **Date:** 2026-10-23 · **Decided by:** founder (pending approval of the M7 plan `docs/plans/2026-10-23-m07-recipes.md`; its open questions Q1–Q7 have defaults in force)

## Context
- The PRD requires: "Recipes are versioned; a price change does not rewrite history. Reports use the cost in force on the day of sale" (1.4), and "recipes are immutable rows with a version number and a valid_from" (Integrity rules). Project invariant (CLAUDE.md): recipes are immutable versions; costs are frozen at production and at sale.
- Later milestones depend on how recipes are stored: M8 (recursive cost, `recipe_cost_at(recipe_key, date)`), M14 (`batch.recipe_version`, proposals scaled from recipe quantities), M16 (min and target portions), M17 (menu items reference `recipe_key`), M19 (depletion through plate → batch portions + raw ingredients), M28/M31 (labels, HACCP).
- The role matrix (project plan §3.11.2) gives the chef RW on recipe versions but not on `sale_price` and `target_gp_pct`; the founder decided on 2026-10-22 that the chef never sees € costs. All Supabase users share the `authenticated` database role, so column grants cannot separate the chef from the owner (ADR-003).
- PRD 1.4: recipe cost = Σ (ingredient quantity × unit cost ÷ yield factor); "1 kg beef muscle at 0.82 yield → 0.82 kg usable".
- Allergens: `ingredient.allergens` was `not null default '{}'`, so a blank read as allergen-free. The lead added (2026-10-22) an "unknown" state that recipes inherit and owner/admin confirm. The PRD notes the allergen matrix is required by EU 1169/2011.

## Decision
- **Identity and versions:** `recipe_key` is the stable identity (fixed `type`, `is_active`, and `current_version` / `name_norm` maintained only by definer procedures). `recipe` holds one append-only row per version (`version`, server-clock `valid_from`, name and content); `recipe_line` rows are append-only with their version. An edit is always a full new version; an optimistic `baseVersion` check refuses stale edits (409).
- **References:** lines point at ingredients by id and at other recipes by **key**, never by version; the reader resolves the version (current, in force on a date, or frozen in a batch).
- **Line semantics:** `qty` is the net usable quantity; raw stock needed = `qty ÷ yield_factor`; `0 < yield_factor ≤ 10`, above 1 allowed with a warning. A batch is used only by plates, in portions (`porz`); a sub-recipe is used by quantity anywhere; nothing references a plate.
- **Prices:** `sale_price` (VAT included, as on the menu) and `target_gp_pct` live in `recipe_price`, one immutable row per plate version, readable by owner and admin only. The chef's versions copy the base version's price row; a chef body naming a price field is refused (403).
- **Graph integrity:** every recipe writer takes one per-tenant advisory lock first, then the key rows in id order; a recursive CTE refuses cycles (`recipe_cycle`) inside the same transaction.
- **Allergen state:** `ingredient.allergens` is nullable (null = not stated, `'{}'` = declared none), plus `allergens_confirmed_at` / `allergens_confirmed_by` set only by a definer confirm procedure; any change of the list clears the confirmation; imports never confirm. Recipe allergens are derived on read through the current versions of sub-recipes and batches; a recipe is "da confermare" if any ingredient reached is not confirmed.

## Alternatives
- **One `recipe` table with `recipe_key` as a plain column** — pros: fewer tables, closest to the PRD list — cons: no foreign key target for sub-recipe lines and menu items, no row to lock per recipe, `type` could drift between versions — why not: integrity would rest on procedure code alone.
- **Mutable recipes with an audit trail** — pros: simple edits — cons: breaks the immutability invariant and "cost in force on the day" — why not: PRD and invariant.
- **Lines referencing sub-recipe versions** — pros: a version fully pins its tree — cons: every sub edit forces new versions of every parent — why not: M8 resolves keys at a date instead.
- **Price columns on `recipe`, chef reads through a definer function** — pros: one table — cons: every chef read becomes a function; easy to leak through a new view — why not: the split-table pattern of ADR-003 (`batch_cost`) is already the house rule.
- **Gross quantities on lines (yield applied to the output)** — pros: matches what is taken from stock — cons: contradicts the PRD formula (÷ yield on the line) and M8 AT1 — why not: PRD.
- **Allergen flag only, or nullable list only** — flag only keeps `'{}'` ambiguous for every future reader; nullable only makes any write (import, PATCH) a confirmation without name or time — why not: both leave a path where a blank or a typo reads as a safety statement.
- **Cycle check by row locks on the reachable keys, or SERIALIZABLE** — the reachable set changes while waiting; serialization failures need client retries — why not: one tenant lock is simple and cheap at this volume.

## Consequences
- Good:
  - history never changes; any past version can be shown and costed (M8) and is referenced by batches (M14);
  - the chef cannot read or set prices, enforced in Postgres;
  - cycles are impossible even under concurrent edits (race-tested);
  - no reader can mistake missing allergen data for "allergen-free"; every confirmation has a person and a time.
- Bad / accepted trade-offs:
  - every price or par-level change is a new version (more rows, all small);
  - recipe writes are serialised per tenant;
  - `recipe_key.current_version` and `name_norm` are maintained values (procedure-only, tested), not derived on read;
  - allergens of a past version are shown with today's data (a safety statement, not history);
  - owners must confirm each ingredient's allergens once, including after any import that changes them.
- What would make us revisit this:
  - the founder allowing the chef to read prices (M7 V1) or M8 settling the chef's view differently;
  - batches inside batches (M7 V4, needs M14 changes);
  - multi-venue volume making the per-tenant recipe lock a bottleneck;
  - a regulatory need to keep historical allergen declarations per version (then the summary would be frozen at confirmation time).
