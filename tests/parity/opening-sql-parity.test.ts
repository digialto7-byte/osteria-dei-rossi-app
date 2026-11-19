// Keeps the opening-stock TS constants (src/server/opening/constants.ts) in step with the SQL of plan 2026-11-18 step 6 and
// step 9: the 200-line bound, the qty and cost bounds and their 4 decimals, the 366-day window, and the reversal reasons.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  OPENING_COST_MAX,
  OPENING_DATE_MAX_DAYS_BACK,
  OPENING_DECIMALS,
  OPENING_MAX_LINES,
  OPENING_QTY_MAX,
  OPENING_REVERSAL_REASONS,
} from "@/server/opening/constants";

const read = (file: string) =>
  readFileSync(new URL(`../../supabase/migrations/${file}`, import.meta.url), "utf8");
const draft = read("20261206210300_stock_opening_draft.sql");
const reverse = read("20261206210500_reverse_opening_stock.sql");
const found = (sql: string, name: string, pattern: RegExp) => {
  const match = pattern.exec(sql);
  if (!match) throw new Error(`${name}: not found in the migration`);
  return match;
};

describe("opening constants match the migrations", () => {
  it("app.opening_max_lines() is OPENING_MAX_LINES", () => {
    const m = found(
      draft,
      "max lines",
      /function app\.opening_max_lines\(\)[^$]*\$\$ select (\d+) \$\$/,
    );
    expect(Number(m[1])).toBe(OPENING_MAX_LINES);
  });

  it("the line parser bounds qty and cost as the TS schema does, at 4 decimals", () => {
    const qty = found(draft, "qty bound", /qty > 0 and qty <= (\d+) and qty = round\(qty, (\d)\)/);
    expect(Number(qty[1])).toBe(OPENING_QTY_MAX);
    expect(Number(qty[2])).toBe(OPENING_DECIMALS);
    const cost = found(
      draft,
      "cost bound",
      /unit_cost >= 0 and unit_cost <= (\d+) and unit_cost = round\(unit_cost, (\d)\)/,
    );
    expect(Number(cost[1])).toBe(OPENING_COST_MAX);
    expect(Number(cost[2])).toBe(OPENING_DECIMALS);
  });

  it("the date window is 366 days back", () => {
    const m = found(draft, "date window", /p_date < v_today - (\d+)/);
    expect(Number(m[1])).toBe(OPENING_DATE_MAX_DAYS_BACK);
  });

  it("app.opening_reversal_reasons() lists exactly OPENING_REVERSAL_REASONS, in order", () => {
    const m = found(reverse, "reasons", /select array\[([^\]]*)\]::text\[\]/);
    expect([...m[1]!.matchAll(/'(\w+)'/g)].map((x) => x[1])).toEqual([...OPENING_REVERSAL_REASONS]);
  });
});
