// Keeps the SQL unit conversion (migration 20261022140300, app.base_factor, pgTAP 033) in step
// with the TypeScript conversion (src/lib/units/convert.ts, toIngredientBase). The vector rows
// are read from the pgTAP test itself, so the same cases run on both sides; if one side changes
// alone, this test fails. A SQL null ("not convertible") must be a UnitError in TypeScript.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BASE_UNITS,
  LINE_UNITS,
  MEASURE_UNITS,
  toIngredientBase,
  UnitError,
  type BaseUnit,
  type MeasureUnit,
  type PackSpec,
  type QuantityUnit,
} from "@/lib/units";

const pgtap = readFileSync(
  new URL("../../supabase/tests/database/033_approval_helpers.test.sql", import.meta.url),
  "utf8",
);

/** Splits on commas outside single quotes. */
function splitFields(row: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of row) {
    if (char === "'") quoted = !quoted;
    if (char === "," && !quoted) {
      fields.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current.trim());
  return fields;
}

/** The rows between `-- begin vectors: <name>` and `-- end vectors: <name>`, as raw fields. */
function vectorRows(name: string): string[][] {
  const match = new RegExp(`-- begin vectors: ${name}\\n([\\s\\S]*?)-- end vectors: ${name}`).exec(
    pgtap,
  );
  if (!match) throw new Error(`vector block "${name}" not found in the pgTAP test`);
  const rows = match[1]!
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("('"))
    .map((line) => splitFields(line.replace(/^\(/, "").replace(/\)[,;]?$/, "")));
  if (rows.length === 0) throw new Error(`vector block "${name}" has no rows`);
  return rows;
}

const text = (field: string): string | null =>
  field === "null" ? null : field.replace(/^'/, "").replace(/'$/, "");
const num = (field: string): number | null => (field === "null" ? null : Number(field));

function member<T extends string>(list: readonly T[], value: string | null): T {
  if (value === null || !(list as readonly string[]).includes(value)) {
    throw new Error(`unexpected unit "${value}" in a vector`);
  }
  return value as T;
}

/** What TypeScript gives for the same inputs, or null where SQL gives null (UnitError). */
function tsBaseQty(
  qty: number,
  unit: string,
  base: string,
  packCount: number | null,
  packQty: number | null,
  packUnit: string | null,
): number | null {
  const pack: PackSpec | undefined =
    packCount === null || packQty === null || packUnit === null
      ? undefined
      : { count: packCount, size: packQty, unit: member<MeasureUnit>(MEASURE_UNITS, packUnit) };
  try {
    return toIngredientBase(
      qty,
      member<QuantityUnit>(LINE_UNITS, unit),
      member<BaseUnit>(BASE_UNITS, base),
      pack,
    ).qty;
  } catch (error) {
    if (error instanceof UnitError) return null;
    throw error;
  }
}

describe("SQL base_factor and TypeScript toIngredientBase agree (pgTAP 033 factor vectors)", () => {
  const rows = vectorRows("base_factor");

  it("reads the vectors", () => {
    expect(rows.length).toBeGreaterThanOrEqual(10);
    for (const row of rows) expect(row).toHaveLength(7);
  });

  // A null unit cannot be expressed in TypeScript (the type forbids it); the callers check for it
  // first, so only the SQL side has that row.
  it.each(rows.filter((row) => text(row[1]!) !== null).map((row) => [text(row[0]!), row] as const))(
    "%s",
    (_name, row) => {
      const [, unit, base, packCount, packQty, packUnit, expected] = row as [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ];
      // One line unit converts to exactly the factor (the factors in the vectors have at most
      // four decimals, the precision of a base quantity).
      expect(
        tsBaseQty(1, text(unit)!, text(base)!, num(packCount), num(packQty), text(packUnit)),
      ).toBe(num(expected));
    },
  );
});

describe("SQL and TypeScript base quantities agree (pgTAP 033 quantity vectors)", () => {
  const rows = vectorRows("base_qty");

  it("reads the vectors", () => {
    expect(rows.length).toBeGreaterThanOrEqual(10);
    for (const row of rows) expect(row).toHaveLength(8);
  });

  it.each(rows.map((row) => [text(row[0]!), row] as const))("%s", (_name, row) => {
    const [, qty, unit, base, packCount, packQty, packUnit, expected] = row as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    expect(
      tsBaseQty(num(qty)!, text(unit)!, text(base)!, num(packCount), num(packQty), text(packUnit)),
    ).toBe(num(expected));
  });
});
