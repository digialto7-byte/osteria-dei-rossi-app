import { describe, expect, it } from "vitest";
import { wasteCostsResponse } from "@/server/stock/output";

const ING = "1a000000-0000-4000-8000-00000000001a";
const KEY = "ec000000-0000-4000-8000-0000000000e1";

const REPORT = {
  from: "2026-10-01",
  to: "2026-10-24",
  valueEur: 12.2,
  rawValueEur: 2.2,
  batchValueEur: 10,
  unvaluedCount: 1,
  reasons: [
    {
      reasonCode: "spoilage",
      valueEur: 6.5,
      rawValueEur: 0.5,
      batchValueEur: 6,
      lines: [
        {
          ingredientId: ING,
          ingredientName: "Cipolla (demo)",
          baseUnit: "kg",
          qty: 0.5,
          valueEur: 0.5,
        },
      ],
      batchLines: [{ recipeKey: KEY, recipeName: "Ragù (demo)", portions: 3, valueEur: 6 }],
    },
    {
      reasonCode: "over_production",
      valueEur: 0,
      rawValueEur: 0,
      batchValueEur: 0,
      lines: [],
      batchLines: [{ recipeKey: KEY, recipeName: "Brodo (demo)", portions: 1, valueEur: null }],
    },
  ],
};

describe("wasteCostsResponse (raw and batch waste, M15)", () => {
  it("accepts the combined report, a batch line without a value included", () => {
    expect(wasteCostsResponse.parse(REPORT)).toEqual(REPORT);
  });

  it("requires the batch keys: rawValueEur, batchValueEur and batchLines", () => {
    const { rawValueEur: _r, ...withoutRaw } = REPORT;
    expect(() => wasteCostsResponse.parse(withoutRaw)).toThrow();
    const { batchValueEur: _b, ...withoutBatch } = REPORT;
    expect(() => wasteCostsResponse.parse(withoutBatch)).toThrow();
    expect(() =>
      wasteCostsResponse.parse({
        ...REPORT,
        reasons: [{ ...REPORT.reasons[0], batchLines: undefined }],
      }),
    ).toThrow();
  });

  it("stays strict at every depth", () => {
    expect(() => wasteCostsResponse.parse({ ...REPORT, extra: 1 })).toThrow();
    expect(() =>
      wasteCostsResponse.parse({
        ...REPORT,
        reasons: [
          {
            ...REPORT.reasons[0],
            batchLines: [{ ...REPORT.reasons[0]!.batchLines[0], unit_cost: 2 }],
          },
        ],
      }),
    ).toThrow();
  });
});
