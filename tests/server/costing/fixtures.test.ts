import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsvRecords } from "@/lib/csv/parse";
import { recipeRowsFromCsv } from "@/server/recipes/import-template";

// The costing fixtures are shared by the integration suite and Playwright, neither of which can
// run offline: this keeps their shape honest where `npm test` runs.
const fixture = (name: string) =>
  readFileSync(join(__dirname, "../../fixtures/costing", name), "utf8");

describe("costing fixtures", () => {
  it("the recipes file parses without errors to the nine recipes of plan §3.10 and the cost-check plates", () => {
    const mapped = recipeRowsFromCsv(fixture("ricette-costi-demo.csv"));
    expect(mapped.errors).toEqual([]);
    expect(mapped.rows.map((row) => row.name)).toEqual([
      "Manzo pulito (demo)",
      "Polenta (demo)",
      "Spezzatino (demo)",
      "Spezzatino con polenta (demo)",
      "Spezzatino al vino (demo)",
      "Polenta e sale (demo)",
      "Tagliata (demo)",
      "Brasato (demo)",
      "Ragù (demo)",
      "Arrosto (demo)",
    ]);
    const pulito = mapped.rows[0]!;
    expect(pulito.lines[0]).toMatchObject({ qty: 1, unit: "kg", yieldFactor: 0.82 });
    const vino = mapped.rows.find((row) => row.name === "Spezzatino al vino (demo)")!;
    expect(vino).toMatchObject({ salePrice: 12, targetGpPct: 85 });
  });

  it("every ingredient a recipe names is in the ingredients file", () => {
    const names = new Set(
      parseCsvRecords(fixture("ingredienti-costi-demo.csv"))
        .slice(1)
        .map((r) => r.cells[0]),
    );
    const used = recipeRowsFromCsv(fixture("ricette-costi-demo.csv")).rows.flatMap((row) =>
      row.lines.flatMap((line) => (line.ingredient ? [line.ingredient] : [])),
    );
    for (const name of used) expect(names.has(name), name).toBe(true);
  });

  it("the cost-check plates cost 10,60, 10,40, 9,40 and 10,50 at 10 euro per kg", () => {
    const rows = recipeRowsFromCsv(fixture("ricette-costi-demo.csv")).rows;
    const cost = (name: string) =>
      Math.round(rows.find((r) => r.name === name)!.lines[0]!.qty * 10 * 100) / 100;
    expect(
      ["Tagliata (demo)", "Brasato (demo)", "Ragù (demo)", "Arrosto (demo)"].map(cost),
    ).toEqual([10.6, 10.4, 9.4, 10.5]);
  });
});
