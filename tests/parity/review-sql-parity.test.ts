// Keeps the SQL review rules (migration 20261022130200, pgTAP 021) in step with the TypeScript
// rules of the extraction (src/server/extraction/checks.ts). The vector rows are read from the
// pgTAP test itself, so the same cases run on both sides; the constants are read from the
// migration. If one side changes alone, this test fails.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runChecks, totalsGate } from "@/server/extraction/checks";
import {
  ALLOWED_VAT_RATES,
  LINE_AMOUNT_TOLERANCE_TEN_THOUSANDTHS,
  TOTAL_TOLERANCE_TEN_THOUSANDTHS,
} from "@/server/extraction/constants";
import { validExtraction } from "../helpers/extraction-data";

const read = (relative: string) =>
  readFileSync(new URL(`../../supabase/${relative}`, import.meta.url), "utf8");
const pgtap = read("tests/database/021_review_helpers.test.sql");
const migration = read("migrations/20261022130200_review_helpers.sql");

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

const unquote = (field: string) => field.replace(/^'/, "").replace(/'$/, "");
const num = (field: string): number | null => (field === "null" ? null : Number(field));

describe("SQL and TypeScript line checks agree (pgTAP 021 vectors)", () => {
  const rows = vectorRows("line_checks");

  it("reads the vectors", () => {
    expect(rows.length).toBeGreaterThanOrEqual(10);
    for (const row of rows) expect(row).toHaveLength(6);
  });

  it.each(rows.map((row) => [unquote(row[0]!), row] as const))("%s", (_name, row) => {
    const [, qty, unitPrice, lineAmount, vatRate, expected] = row as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const base = validExtraction();
    const input = {
      ...base,
      lines: [
        {
          ...base.lines[0],
          qty: num(qty)!,
          unit_price: num(unitPrice),
          line_amount: num(lineAmount)!,
          vat_rate: num(vatRate),
        },
        base.lines[1],
      ] as typeof base.lines,
    };
    const wanted = unquote(expected)
      .replace(/^\{|\}$/g, "")
      .split(",")
      .filter((check) => check !== "");
    expect(runChecks(input).lineChecks[0]).toEqual(wanted);
  });
});

describe("SQL and TypeScript totals gate agree (pgTAP 021 vectors)", () => {
  const rows = vectorRows("totals_gate");

  it("reads the vectors", () => {
    expect(rows.length).toBeGreaterThanOrEqual(10);
    for (const row of rows) expect(row).toHaveLength(6);
  });

  it.each(rows.map((row) => [unquote(row[0]!), row] as const))("%s", (_name, row) => {
    const [, amounts, vatTotal, grossTotal, flagged, diff] = row as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const lines = unquote(amounts)
      .split(" ")
      .filter((amount) => amount !== "")
      .map((amount) => ({ line_amount: Number(amount) }));
    const gate = totalsGate(lines, num(vatTotal), num(grossTotal));
    expect(gate.flagged).toBe(flagged === "true");
    const wantedDiff = num(diff);
    if (wantedDiff === null) expect(gate.diff).toBeNull();
    else expect(gate.diff).toBeCloseTo(wantedDiff, 8);
  });
});

describe("SQL constants equal the TypeScript constants", () => {
  const constant = (name: string, pattern: string) => {
    const match = new RegExp(`app\\.${name}\\(\\)[^$]*\\$\\$\\s*select ${pattern}`).exec(migration);
    if (!match) throw new Error(`app.${name}() not found in the migration`);
    return match[1]!;
  };

  it("allowed VAT rates", () => {
    const sql = constant("allowed_vat_rates", "array\\[([^\\]]+)\\]")
      .split(",")
      .map((rate) => Number(rate.trim()));
    expect(sql).toEqual([...ALLOWED_VAT_RATES]);
  });

  it("totals tolerance", () => {
    expect(Number(constant("total_tolerance_ten_thousandths", "(\\d+)"))).toBe(
      TOTAL_TOLERANCE_TEN_THOUSANDTHS,
    );
  });

  it("line amount tolerance", () => {
    expect(Number(constant("line_amount_tolerance_ten_thousandths", "(\\d+)"))).toBe(
      LINE_AMOUNT_TOLERANCE_TEN_THOUSANDTHS,
    );
  });
});
