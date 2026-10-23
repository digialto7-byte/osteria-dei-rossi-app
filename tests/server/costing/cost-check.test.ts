import { describe, expect, it } from "vitest";
import { compareCostCheck, type AppPlate, type SheetRow } from "@/server/costing/cost-check";

const KEY = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const APP: AppPlate[] = [
  { recipeKey: KEY(1), name: "Tagliata (demo)", foodCostEur: 10.6 },
  { recipeKey: KEY(2), name: "Brasato (demo)", foodCostEur: 10.4 },
  { recipeKey: KEY(3), name: "Ragù (demo)", foodCostEur: 9.4 },
  { recipeKey: KEY(4), name: "Arrosto (demo)", foodCostEur: 10.5 },
  { recipeKey: KEY(5), name: "Zuppa (demo)", foodCostEur: null },
];
const row = (n: number, name: string, sheetEur: number): SheetRow => ({ row: n, name, sheetEur });

describe("compareCostCheck (AT9)", () => {
  const sheet = [
    row(2, "Tagliata (demo)", 10),
    row(3, "Brasato (demo)", 10),
    row(4, "Ragù (demo)", 10),
    row(5, "Arrosto (demo)", 10),
  ];

  it("lists +6 % and -6 %, not +4 %, and not exactly +5 %", () => {
    const result = compareCostCheck(sheet, APP);
    expect(result.tolerancePct).toBe(5);
    expect(result.compared).toBe(4);
    expect(result.withinTolerance).toBe(2);
    expect(result.listed).toEqual([
      {
        row: 2,
        name: "Tagliata (demo)",
        recipeKey: KEY(1),
        appEur: 10.6,
        sheetEur: 10,
        diffPct: 6,
      },
      { row: 4, name: "Ragù (demo)", recipeKey: KEY(3), appEur: 9.4, sheetEur: 10, diffPct: -6 },
    ]);
    expect(result.unmatched).toEqual([]);
    expect(result.duplicates).toEqual([]);
    expect(result.incomplete).toEqual([]);
    expect(result.invalid).toEqual([]);
  });

  it("reports an unknown name as unmatched with its row, never guessing", () => {
    const result = compareCostCheck([row(7, "Piatto fantasma (demo)", 8)], APP);
    expect(result.unmatched).toEqual([{ row: 7, name: "Piatto fantasma (demo)" }]);
    expect(result.compared).toBe(0);
  });

  it("reports every row of a name that appears twice as a duplicate and compares neither", () => {
    const result = compareCostCheck(
      [row(2, "Tagliata (demo)", 10), row(3, "tagliata (DEMO)", 12), row(4, "Brasato (demo)", 10)],
      APP,
    );
    expect(result.duplicates).toEqual([
      { row: 2, name: "Tagliata (demo)" },
      { row: 3, name: "tagliata (DEMO)" },
    ]);
    expect(result.compared).toBe(1);
  });

  it("reports an incomplete plate with its key instead of comparing", () => {
    const result = compareCostCheck([row(2, "Zuppa (demo)", 5)], APP);
    expect(result.incomplete).toEqual([{ row: 2, name: "Zuppa (demo)", recipeKey: KEY(5) }]);
    expect(result.compared).toBe(0);
    expect(result.listed).toEqual([]);
  });

  it("reports a sheet value of 0 as invalid_value, not as a division", () => {
    const result = compareCostCheck([row(2, "Tagliata (demo)", 0)], APP);
    expect(result.invalid).toEqual([{ row: 2, code: "invalid_value" }]);
    expect(result.compared).toBe(0);
  });

  it("matches ignoring case, accents-as-typed spacing and double spaces like the M7 rule", () => {
    const result = compareCostCheck([row(2, "  TAGLIATA   (demo) ", 10)], APP);
    expect(result.compared).toBe(1);
    expect(result.listed[0]?.recipeKey).toBe(KEY(1));
  });

  it("does not treat a different accent as the same name", () => {
    const result = compareCostCheck([row(2, "Ragu (demo)", 10)], APP);
    expect(result.unmatched).toEqual([{ row: 2, name: "Ragu (demo)" }]);
  });

  it("an empty sheet compares nothing", () => {
    const result = compareCostCheck([], APP);
    expect(result).toMatchObject({ compared: 0, withinTolerance: 0, listed: [] });
  });

  it("is not fooled by floating point at the tolerance edge", () => {
    const plates: AppPlate[] = [{ recipeKey: KEY(1), name: "Edge", foodCostEur: 1.05 }];
    expect(compareCostCheck([row(2, "Edge", 1)], plates).listed).toEqual([]);
    const above: AppPlate[] = [{ recipeKey: KEY(1), name: "Edge", foodCostEur: 1.0501 }];
    expect(compareCostCheck([row(2, "Edge", 1)], above).listed).toHaveLength(1);
  });
});
