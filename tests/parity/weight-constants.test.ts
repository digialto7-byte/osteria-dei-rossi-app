// Keeps the weight limits of the TypeScript (src/server/orders/constants.ts) in step with the SQL constants of P2-0b
// (20261130100000_weight_core.sql). The SQL stays the authority; if one side changes alone, this test fails.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_WEIGHT_MAX_G,
  PORTION_WEIGHT_MAX_G,
  PORTION_WEIGHT_MIN_G,
  WEIGHT_CONFIRM_FACTOR,
  WEIGHT_MAX_SETTING_MAX_G,
  WEIGHT_MAX_SETTING_MIN_G,
  WEIGHT_MIN_G,
  WEIGHT_STEP_G,
} from "@/server/orders/constants";

const core = readFileSync(
  new URL("../../supabase/migrations/20261130100000_weight_core.sql", import.meta.url),
  "utf8",
);
const found = (name: string, pattern: RegExp) => {
  const match = pattern.exec(core);
  if (!match) throw new Error(`${name}: not found in the migration`);
  return match;
};
const constant = (fn: string) =>
  Number(
    found(
      fn,
      new RegExp(`function app\\.${fn}\\(\\) returns integer[^;]*?select (\\d+) \\$\\$`),
    )[1],
  );

describe("weight limits match the migration", () => {
  it("WEIGHT_MIN_G, WEIGHT_STEP_G and DEFAULT_WEIGHT_MAX_G are the app constants", () => {
    expect(WEIGHT_MIN_G).toBe(constant("weight_min_g"));
    expect(WEIGHT_STEP_G).toBe(constant("weight_step_g"));
    expect(DEFAULT_WEIGHT_MAX_G).toBe(constant("default_weight_max_g"));
  });

  it("the setting range is the bounds function and the sale_settings CHECK", () => {
    const check = found("sale_settings check", /weight_max_g between (\d+) and (\d+) and/);
    expect(WEIGHT_MAX_SETTING_MIN_G).toBe(Number(check[1]));
    expect(WEIGHT_MAX_SETTING_MAX_G).toBe(Number(check[2]));
    const fn = found(
      "bounds function",
      /function app\.weight_max_setting_bounds\(\)[\s\S]*?select (\d+), (\d+)/,
    );
    expect(WEIGHT_MAX_SETTING_MIN_G).toBe(Number(fn[1]));
    expect(WEIGHT_MAX_SETTING_MAX_G).toBe(Number(fn[2]));
  });

  it("the reference portion weight is the menu_item CHECK", () => {
    const m = found(
      "portion check",
      /portion_weight_g integer check \(portion_weight_g between (\d+) and (\d+)\)/,
    );
    expect(PORTION_WEIGHT_MIN_G).toBe(Number(m[1]));
    expect(PORTION_WEIGHT_MAX_G).toBe(Number(m[2]));
  });

  it("the default maximum, the setting range and the step are consistent", () => {
    expect(DEFAULT_WEIGHT_MAX_G).toBeGreaterThanOrEqual(WEIGHT_MAX_SETTING_MIN_G);
    expect(DEFAULT_WEIGHT_MAX_G).toBeLessThanOrEqual(WEIGHT_MAX_SETTING_MAX_G);
    expect(DEFAULT_WEIGHT_MAX_G % WEIGHT_STEP_G).toBe(0);
    expect(WEIGHT_MAX_SETTING_MIN_G % WEIGHT_STEP_G).toBe(0);
  });

  it("WEIGHT_CONFIRM_FACTOR is a UI rule only: no SQL function carries it", () => {
    expect(WEIGHT_CONFIRM_FACTOR).toBe(3);
    expect(core).not.toMatch(/confirm/i);
  });

  it("no TS constant fixes a maximum weight per line", () => {
    const src = readFileSync(
      new URL("../../src/server/orders/constants.ts", import.meta.url),
      "utf8",
    );
    expect(src).not.toMatch(/export const \w*MAX_WEIGHT\w*\b/);
    expect(src).not.toMatch(/export const WEIGHT_MAX_G\b/);
  });
});
