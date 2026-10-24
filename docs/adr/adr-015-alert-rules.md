# ADR-015 — Reorder, prep, purchase and expiry rules: recipe settings on the stable key, the projection and delivery calendar in SQL with an explicit clock, chef-safe payloads

- **Status:** proposed
- **Date:** 2026-10-24
- **Decided by:** architect.
  - The decision stays within ADR-002 (derived balances, append-only ledgers), ADR-003 (RLS, roles in Postgres), ADR-006 (one alert pipeline, dedup per item per day), ADR-007 (immutable recipe versions), ADR-011 (raw stock ledger) and ADR-013 (batches, use-by in elapsed hours).
  - It applies the founder's decisions in force: Q16 = project V6 (the chef never sees €) and M6 2026-10-23 (alerts in the app only, the owner the recipient, the chef sees kitchen alerts, admin none).
  - The M16 plan `docs/plans/2026-10-24-m16-alert-rules.md` §7 Q60–Q66 are open, with their defaults in force.

## Context
- **PRD 2.4:**
  - per ingredient: min, target, lead time, delivery weekdays, cut-off; per batch recipe: min and target portions, prep time;
  - the prep alert from the stew example;
  - a purchase suggestion when raw stock is short;
  - a purchase alert from projected stock: on hand − forecast over lead time + days to the next delivery window, with the MVP forecast the trailing 14-day weekday average;
  - an expiry alert within 1 day of use-by;
  - dedup, one per item per day.
- **Project plan:**
  - §3.9: hourly `run_alert_rules()` in SQL;
  - §3.6: invariants;
  - §5a.2 M16: AT1–AT7, including a DST run on 2026-10-25 and a Monday-afternoon fixture "by Tue 11:00 for Thu delivery".
- **What exists:**
  - M1 created the ingredient and supplier columns.
  - M7 put `min_portions`, `target_portions` and `prep_time_min` on **immutable recipe versions**.
  - M6 provides `app.run_alert_rules(p_at)` with a replaceable `app.alert_rules_body`, which M9 filled.
  - M12 provides the chef payload allow-list in `app.raise_alert`: keys with typed suffixes; strings that are only ids, dates, instants or codes.
  - M12 provides the stock ledger; M14 provides batches and `app.batch_requirements`.

## Decision
- **Recipe rule settings live on `recipe_key`** (`rule_min_portions`, `rule_target_portions`, `rule_prep_time_min`), not on versions.
  - The effective value is `coalesce(key setting, current version's value)`. Changing a threshold therefore never creates a recipe version.
  - All settings, for ingredients, suppliers and recipes, are written only by audited definer procedures (owner, admin). The direct column grants are revoked.
- **The rules are SQL functions with an explicit clock `p_at`**, called from the existing body, one isolated block per tenant and rule. The M9 blocks are kept verbatim and the wrapper is not replaced.
  - The business date is the Rome calendar date.
  - The order deadline is `(delivery date − lead time) + cut-off`, converted from local time through `Europe/Rome`. The next window is the first deadline not yet passed.
  - Horizon = lead time + days to that window = delivery date − today.
  - Forecast = Σ over the horizon days of each weekday's average of its two occurrences in the 14 complete days before today, from consumption rows (reversals on their original's date).
  - Projected = usable on hand (expired lots excluded) − forecast. Below the minimum → order up to the target, rounded up to whole preferred packs.
- **Every M16 alert is non-cost, and its payload passes the chef allow-list by construction.** The payloads are flat ids, quantities, dates, UTC instants and codes. Names and lot codes are resolved when the alert is shown, on the reader's session.
  - Audience: prep, raw short and expiry go to owner and chef; purchase goes to the owner only (a registry default, Q60).

## Alternatives
- **A new recipe version for each threshold change.** Pros: one place for every recipe field. Cons: versions are the cost and label history (ADR-007, ADR-008), and a stock setting would churn them. Rejected.
- **A separate `recipe_stock_rule` table.** Pros: its own `updated_by`. Cons: one more RLS table and fixture rows in the role scans, for three integers already audited through `audit_event`. Rejected for now; revisit with M27 (rules per location or period).
- **Rules in a TypeScript cron route.** Pros: easier string formatting. Cons: needs the secret key and pg_net, duplicates the SQL guards and dedup, and goes against plan §3.9. Rejected.
- **A flat 14-day average × horizon days.** Pros: simpler. Cons: ignores the weekday pattern the PRD asks for. Rejected; it equals the chosen formula for whole weeks.
- **Payloads with names, owner-only kitchen alerts.** Pros: simpler rendering. Cons: the chef needs prep and expiry alerts (PRD 2.4, plan §3.10), and the M12 allow-list forbids free text for chef audiences. Rejected.

## Consequences
- **Good:**
  - The stew and Macelleria examples are exact, hand-checkable test vectors.
  - DST is handled by dates and the zone database, never by adding intervals.
  - The chef can never receive a € figure from these rules (registry flag, allow-list, RLS).
  - Thresholds change without touching recipe history.
- **Bad / accepted trade-offs:**
  - A recipe threshold can live in two places (key and version). The key wins, and the screen shows which one applies.
  - Replacing `alert_rules_body` means re-pinning its md5 in `089`, `098` and `119`.
  - The first alert of a day stands, even if its deadline passes that day.
  - Purchase alerts repeat daily until stock arrives (no order record; Q65).
  - Ingredients with incomplete supplier settings get no purchase alert, only a "Da completare" badge (Q66).
- **What would make us revisit this:**
  - the full rules engine (M27);
  - the demand model replacing `app.weekday_consumption` (M32);
  - rules per storage place;
  - the founder answering Q60–Q66 differently (variants V1–V7 of the M16 plan);
  - a delivery channel other than in-app.
