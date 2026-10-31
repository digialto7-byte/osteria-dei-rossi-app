// Keeps the constants of src/server/push in step with the SQL of the push list and the forecast (M23 plan §3.4, step 11). If one side changes alone,
// this test fails.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FORECAST_DAYS_AHEAD,
  FORECAST_WEEKS,
  PUSH_LIST_WINDOW_HOURS,
  PUSH_PRICE_MAX,
} from "@/server/push/constants";

const read = (name: string) =>
  readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");
const forecast = read("20261114100400_forecast.sql");
const pushList = read("20261114100300_push_list.sql");
const batches = read("20261028100100_batch_helpers.sql");
const core = read("20261114100000_menu_push_core.sql");

// `create function app.<name>() returns integer language sql immutable set search_path = '' as $$ select <n> $$;`
function constant(sql: string, name: string): number {
  const pattern = new RegExp(
    `function app\\.${name}\\(\\)\\s+returns integer[\\s\\S]*?as \\$\\$\\s*select\\s+(\\d+)`,
    "i",
  );
  const m = pattern.exec(sql);
  if (!m) throw new Error(`${name}: not found in the migration`);
  return Number(m[1]);
}

describe("push constants match the migrations", () => {
  it("FORECAST_WEEKS is app.forecast_weeks() (PRD 4.4: four weeks)", () => {
    expect(FORECAST_WEEKS).toBe(constant(forecast, "forecast_weeks"));
    expect(FORECAST_WEEKS).toBe(4);
  });

  it("FORECAST_DAYS_AHEAD is app.forecast_days_ahead()", () => {
    expect(FORECAST_DAYS_AHEAD).toBe(constant(forecast, "forecast_days_ahead"));
    expect(FORECAST_DAYS_AHEAD).toBe(6);
  });

  it("PUSH_LIST_WINDOW_HOURS is the 24 hours of app.use_by_state and of the push list window", () => {
    const useByState = /function app\.use_by_state[\s\S]*?make_interval\(hours => (\d+)\)/i.exec(
      batches,
    );
    expect(Number(useByState?.[1])).toBe(PUSH_LIST_WINDOW_HOURS);
    const window = /b\.use_by <= p_now \+ make_interval\(hours => (\d+)\)/i.exec(pushList);
    expect(Number(window?.[1])).toBe(PUSH_LIST_WINDOW_HOURS);
    expect(PUSH_LIST_WINDOW_HOURS).toBe(24);
  });

  it("PUSH_PRICE_MAX is the bound of menu_push.push_price", () => {
    const check =
      /push_price numeric\(12, 2\) check \(push_price > 0 and push_price <= (\d+)\)/i.exec(core);
    expect(Number(check?.[1])).toBe(PUSH_PRICE_MAX);
  });
});
