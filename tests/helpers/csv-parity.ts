import { expect } from "vitest";
import type { AnyExportTable, ExportRole } from "@/server/exports/types";

/**
 * AT1 in one place (M24 plan §5 step 7 and 12): the CSV, read back as records (header first), equals the JSON the same query gave. The header is the
 * table's columns for the role; the row count is the table's rows of the JSON; every cell parses back to the typed value of the row: a number to
 * EXACTLY the JSON number (T2: no cent rounding), a date to the JSON date, a boolean to sì/no, a text to the JSON string (with the one leading
 * apostrophe the formula escape adds), a null to an empty cell. Returns the number of data rows.
 */
export function expectCsvMatchesJson(
  csv: string[][],
  table: AnyExportTable,
  role: ExportRole,
  json: unknown,
  label: string,
): number {
  const columns = table.columns(role);
  expect(csv[0], `${label} header`).toEqual(columns.map((c) => c.header));
  const rows = table.rows(json);
  expect(csv.length - 1, `${label} rows`).toBe(rows.length);
  rows.forEach((row, r) => {
    columns.forEach((column, c) => {
      const typed = column.cell(row);
      const written = csv[r + 1]![c]!;
      const where = `${label} row ${r} ${column.header}`;
      if (typed.value === null) return expect(written, where).toBe("");
      switch (typed.kind) {
        case "number":
          expect(Number(written.replace(",", ".")), where).toBe(typed.value);
          break;
        case "date": {
          const [d, m, y] = written.split("/");
          expect(`${y}-${m}-${d}`, where).toBe(typed.value);
          break;
        }
        case "bool":
          expect(written, where).toBe(typed.value ? "sì" : "no");
          break;
        case "instant":
          expect(written, where).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
          break;
        case "text":
          expect(written, where).toBe(
            /^[=+\-@\t\r]/.test(typed.value) ? `'${typed.value}` : typed.value,
          );
          break;
      }
    });
  });
  return rows.length;
}

export const pick = (json: unknown, ...path: string[]): unknown =>
  path.reduce((o, k) => (o as Record<string, unknown>)[k], json);
const len = (json: unknown, ...path: string[]) => (pick(json, ...path) as unknown[]).length;

/** The JSON row count each export must have, independent of the registry's own `rows`. */
export function expectedRowCount(slug: string, json: unknown): number {
  switch (slug) {
    case "kpis":
      return 54;
    case "forecast":
      return len(json, "batches");
    case "forecast-plates":
      return len(json, "plates");
    case "waste-costs":
      return (pick(json, "reasons") as { lines: unknown[]; batchLines: unknown[] }[]).reduce(
        (n, r) => n + r.lines.length + r.batchLines.length,
        0,
      );
    case "count-variance":
      return len(json, "variance", "lines");
    case "reconciliation":
      return len(json, "items");
    default:
      return len(json, "rows");
  }
}
