// Keeps the limits of the M18 TypeScript (src/server/orders) in step with the checks and constants of the migrations
// 20261101100000_order_core.sql and 20261101100100_order_helpers.sql. If one side changes alone, this test fails.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COURSES as MENU_COURSES } from "@/server/menu/constants";
import {
  CLIENT_CLOCK_TOLERANCE_S,
  COURSES,
  LOW_STOCK_HINT_PORTIONS,
  MAX_QTY,
  MIN_QTY,
  NOTE_MAX,
} from "@/server/orders/constants";

const read = (name: string) =>
  readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");
const core = read("20261101100000_order_core.sql");
const helpers = read("20261101100100_order_helpers.sql");
const add = read("20261101100300_add_order_line.sql");
const found = (name: string, text: string, pattern: RegExp) => {
  const match = pattern.exec(text);
  if (!match) throw new Error(`${name}: not found in the migration`);
  return match;
};

describe("limits match the migrations", () => {
  it("MIN_QTY and MAX_QTY are the bounds of order_line_qty_ck", () => {
    const m = found("qty", core, /order_line_qty_ck check \(qty >= ([\d.]+) and qty <= (\d+) and/);
    expect(MIN_QTY).toBe(Number(m[1]));
    expect(MAX_QTY).toBe(Number(m[2]));
  });

  it("the qty grid is the half portion", () => {
    expect(core).toContain("qty * 2 = trunc(qty * 2)");
    expect(add).toContain("v * 2 <> trunc(v * 2)");
  });

  it("NOTE_MAX is the length bound of order_line_note_ck and of the parser", () => {
    const m = found("note", core, /char_length\(note\) between 1 and (\d+)/);
    expect(NOTE_MAX).toBe(Number(m[1]));
    expect(found("parser", add, /char_length\(v\) > (\d+)/)[1]).toBe(String(NOTE_MAX));
  });

  it("CLIENT_CLOCK_TOLERANCE_S is the clock tolerance", () => {
    const m = found("tolerance", helpers, /select interval '(\d+) seconds'/);
    expect(CLIENT_CLOCK_TOLERANCE_S).toBe(Number(m[1]));
  });

  it("LOW_STOCK_HINT_PORTIONS is the hint threshold", () => {
    const m = found(
      "hint",
      helpers,
      /low_stock_hint_portions\(\) returns numeric[\s\S]*?select (\d+)::numeric/,
    );
    expect(LOW_STOCK_HINT_PORTIONS).toBe(Number(m[1]));
  });

  it("the courses are the order course type, in service order", () => {
    expect(COURSES).toEqual(MENU_COURSES);
    const sql = read("20261031100000_menu_tables_core.sql");
    const m = found("course", sql, /create type public\.course as enum \(([^)]*)\)/);
    expect([...m[1]!.matchAll(/'(\w+)'/g)].map((x) => x[1])).toEqual([...COURSES]);
  });
});
