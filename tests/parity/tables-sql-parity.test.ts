// Keeps the limits of the M17 TypeScript (src/server/menu, src/server/tables) in step with the checks of the
// migration 20261031100000_menu_tables_core.sql. If one side changes alone, this test fails.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COURSES,
  MENU_CATEGORY_MAX,
  MENU_NAME_MAX,
  MENU_POSITION_MAX,
  MENU_PRICE_MAX,
  VAT_RATES,
} from "@/server/menu/constants";
import {
  MAX_COPERTO_EUR,
  MAX_TABLE_COVERS,
  TABLE_NAME_MAX,
  TABLE_POSITION_MAX,
} from "@/server/tables/constants";

const sql = readFileSync(
  new URL("../../supabase/migrations/20261031100000_menu_tables_core.sql", import.meta.url),
  "utf8",
);
const migration = (name: string, pattern: RegExp) => {
  const match = pattern.exec(sql);
  if (!match) throw new Error(`${name}: not found in the migration`);
  return match;
};

describe("limits match the migration", () => {
  it("MAX_TABLE_COVERS is the upper bound of table_session.covers", () => {
    const m = migration("covers", /covers smallint not null check \(covers between 1 and (\d+)\)/);
    expect(MAX_TABLE_COVERS).toBe(Number(m[1]));
  });

  it("MAX_COPERTO_EUR is the upper bound of the coperto amount, in both tables", () => {
    const all = [
      ...sql.matchAll(
        /coperto_amount numeric\(12, 2\) check \(coperto_amount > 0 and coperto_amount <= (\d+)\)/g,
      ),
    ];
    expect(all).toHaveLength(2);
    for (const m of all) expect(MAX_COPERTO_EUR).toBe(Number(m[1]));
  });

  it("the menu item name, category and position bounds", () => {
    expect(MENU_NAME_MAX).toBe(
      Number(
        migration(
          "name",
          /name text not null check \(char_length\(name\) between 1 and (\d+) and btrim/,
        )[1],
      ),
    );
    expect(MENU_CATEGORY_MAX).toBe(
      Number(
        migration(
          "category",
          /category text not null check \(char_length\(category\) between 1 and (\d+)/,
        )[1],
      ),
    );
    expect(MENU_POSITION_MAX).toBe(
      Number(
        migration(
          "position",
          /position integer not null default 0 check \(position between 0 and (\d+)\)/,
        )[1],
      ),
    );
  });

  it("the price ceiling and the table name and position bounds", () => {
    expect(MENU_PRICE_MAX).toBe(
      Number(
        migration(
          "price",
          /price numeric\(12, 2\) not null check \(price >= 0 and price <= (\d+)\)/,
        )[1],
      ),
    );
    const names = [
      ...sql.matchAll(/name text not null check \(char_length\(name\) between 1 and (\d+)/g),
    ].map((m) => Number(m[1]));
    expect(names).toContain(TABLE_NAME_MAX);
    const positions = [
      ...sql.matchAll(
        /position integer not null default 0 check \(position between 0 and (\d+)\)/g,
      ),
    ];
    expect(positions.map((m) => Number(m[1]))).toEqual([MENU_POSITION_MAX, TABLE_POSITION_MAX]);
  });

  it("the course list is the enum, in service order", () => {
    const m = migration("course", /create type public\.course as enum \(([^)]*)\)/);
    expect(m[1]!.split(",").map((s) => s.trim().replace(/'/g, ""))).toEqual([...COURSES]);
  });

  it("the VAT rates are the allowed list of the database", () => {
    const m = migration("vat", /app\.allowed_vat_rates\(\)/);
    expect(m).toBeTruthy();
    const rates = readFileSync(
      new URL("../../supabase/migrations/20261022130200_review_helpers.sql", import.meta.url),
      "utf8",
    );
    const list = /allowed_vat_rates\(\)[\s\S]*?array\[([^\]]*)\]/.exec(rates);
    expect(list).not.toBeNull();
    expect(list![1]!.split(",").map((s) => Number(s.trim()))).toEqual([...VAT_RATES]);
  });
});
