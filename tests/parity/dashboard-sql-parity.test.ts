// Keeps the constants of src/server/dashboard in step with the SQL of the owner dashboard (plan §5 step 7). If one side
// changes alone, this test fails.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DASHBOARD_ALERT_CAP,
  DASHBOARD_LIST_CAP,
  DASHBOARD_WORST_PLATES,
  DUE_SOON_DAYS,
} from "@/server/dashboard/constants";
import { TODAY_ALERT_CAP } from "@/server/today/constants";

const read = (name: string) =>
  readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");
const cost = read("20261108100000_dashboard_cost_helpers.sql");
const stock = read("20261108100100_dashboard_stock_helpers.sql");

// `create function app.<name>() returns integer ... select <n>`
function constant(sql: string, name: string): number {
  const pattern = new RegExp(
    `function app\\.${name}\\(\\)\\s+returns integer[\\s\\S]*?(?:as\\s+\\$\\$\\s*select\\s+|return\\s+)(\\d+)`,
    "i",
  );
  const m = pattern.exec(sql);
  if (!m) throw new Error(`${name}: not found in the migration`);
  return Number(m[1]);
}

describe("dashboard constants match the migrations", () => {
  it("DASHBOARD_WORST_PLATES is app.dashboard_worst_plates()", () => {
    expect(DASHBOARD_WORST_PLATES).toBe(constant(cost, "dashboard_worst_plates"));
    expect(DASHBOARD_WORST_PLATES).toBe(5);
  });
  it("DASHBOARD_LIST_CAP is app.dashboard_list_cap()", () => {
    expect(DASHBOARD_LIST_CAP).toBe(constant(stock, "dashboard_list_cap"));
    expect(DASHBOARD_LIST_CAP).toBe(5);
  });
  it("DUE_SOON_DAYS is app.payable_due_soon_days()", () => {
    expect(DUE_SOON_DAYS).toBe(constant(stock, "payable_due_soon_days"));
    expect(DUE_SOON_DAYS).toBe(7);
  });
  it("DASHBOARD_ALERT_CAP is app.dashboard_alert_cap() and TODAY_ALERT_CAP", () => {
    expect(DASHBOARD_ALERT_CAP).toBe(constant(stock, "dashboard_alert_cap"));
    expect(DASHBOARD_ALERT_CAP).toBe(TODAY_ALERT_CAP);
    expect(DASHBOARD_ALERT_CAP).toBe(50);
  });
});
