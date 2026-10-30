// Keeps the constants of the M21 TypeScript (src/server/bill, src/server/day-close) in step with the SQL of the migrations
// 20261110100000_close_core.sql, 20261110100100_bill.sql and 20261110100300_day_close.sql.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MAX_SPLIT_GROUPS,
  MAX_SPLIT_IDS,
  MAX_SPLIT_PARTS,
  MIN_SPLIT_PARTS,
  PAYMENT_TYPES,
  RECEIPT_NUMBER,
  RECEIPT_TYPES,
} from "@/server/bill/constants";
import { DAY_CLOSE_MAX_DAYS_BACK, REGISTER_TOTAL } from "@/server/day-close/constants";

const read = (name: string) =>
  readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");
const core = read("20261110100000_close_core.sql");
const bill = read("20261110100100_bill.sql");
const day = read("20261110100300_day_close.sql");
const found = (name: string, text: string, pattern: RegExp) => {
  const match = pattern.exec(text);
  if (!match) throw new Error(`${name}: not found in the migration`);
  return match;
};
const words = (list: string) => [...list.matchAll(/'(\w+)'/g)].map((x) => x[1]);

describe("limits match the migrations", () => {
  it("RECEIPT_TYPES are app.receipt_types(), in order", () => {
    const m = found(
      "receipt types",
      core,
      /receipt_types\(\) returns text\[\][\s\S]*?select array\[([^\]]*)\]/,
    );
    expect(words(m[1]!)).toEqual([...RECEIPT_TYPES]);
  });

  it("PAYMENT_TYPES are app.payment_type_codes(), in order", () => {
    const m = found(
      "payment types",
      core,
      /payment_type_codes\(\) returns text\[\][\s\S]*?select array\[([^\]]*)\]/,
    );
    expect(words(m[1]!)).toEqual([...PAYMENT_TYPES]);
  });

  it("RECEIPT_NUMBER is the check on table_session.receipt_number and the one close_table applies", () => {
    const check = found("check", core, /receipt_number ~ '([^']+)'/);
    expect(RECEIPT_NUMBER.source).toBe(check[1]!.replace(/\\\//g, "/"));
    expect(read("20261110100200_close_table.sql")).toContain(`v_number !~ '${check[1]}'`);
  });

  it("MAX_SPLIT_PARTS and MIN_SPLIT_PARTS bound a split by covers (and split_cents)", () => {
    const m = found("parts", bill, /menu_int\(p_split -> 'parts', (\d+), (\d+), 'parts_invalid'\)/);
    expect([Number(m[1]), Number(m[2])]).toEqual([MIN_SPLIT_PARTS, MAX_SPLIT_PARTS]);
    expect(Number(found("split_cents", bill, /p_parts > (\d+)/)[1])).toBe(MAX_SPLIT_PARTS);
  });

  it("MAX_SPLIT_GROUPS and MAX_SPLIT_IDS bound a split by items", () => {
    const g = found(
      "groups",
      bill,
      /jsonb_array_length\(p_split -> 'groups'\) not between (\d+) and (\d+)/,
    );
    expect(Number(g[2])).toBe(MAX_SPLIT_GROUPS);
    expect(Number(g[1])).toBe(2);
    expect(Number(found("ids", bill, /v_ids > (\d+)/)[1])).toBe(MAX_SPLIT_IDS);
  });

  it("REGISTER_TOTAL is the pattern enter_day_close applies", () => {
    const m = found("register total", day, /'registerTotal'\) !~ '([^']+)'/);
    expect(REGISTER_TOTAL.source).toBe(m[1]);
  });

  it("DAY_CLOSE_MAX_DAYS_BACK is the range of day_close_range_ok", () => {
    expect(Number(found("days", day, /p_date < v_today - (\d+)/)[1])).toBe(DAY_CLOSE_MAX_DAYS_BACK);
  });
});
