import { describe, expect, it } from "vitest";
import { movementsResponse, wasteCostsResponse } from "@/server/stock/output";

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
      batchLines: [
        { recipeKey: KEY, recipeName: "Ragù (demo)", portions: 3, valueEur: 6, unvaluedCount: 0 },
      ],
    },
    {
      reasonCode: "over_production",
      valueEur: 0,
      rawValueEur: 0,
      batchValueEur: 0,
      lines: [],
      batchLines: [
        {
          recipeKey: KEY,
          recipeName: "Brodo (demo)",
          portions: 1,
          valueEur: null,
          unvaluedCount: 1,
        },
      ],
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

  it("a batch line carries its own unvaluedCount, a whole number", () => {
    const line = REPORT.reasons[0]!.batchLines[0]!;
    const { unvaluedCount: _u, ...without } = line;
    for (const batchLines of [[without], [{ ...line, unvaluedCount: 0.5 }]]) {
      expect(() =>
        wasteCostsResponse.parse({ ...REPORT, reasons: [{ ...REPORT.reasons[0], batchLines }] }),
      ).toThrow();
    }
    // A line may be valued and still hold an unvalued operation (a mix of complete and incomplete batches).
    const mixed = { ...line, valueEur: 10, unvaluedCount: 1 };
    expect(
      wasteCostsResponse.parse({
        ...REPORT,
        reasons: [{ ...REPORT.reasons[0], batchLines: [mixed] }],
      }).reasons[0]!.batchLines[0],
    ).toEqual(mixed);
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

describe("movementsResponse and the opening movement type (opening stock step 12)", () => {
  const op = (type: string) => ({
    operationId: "0e000000-0000-4000-8000-000000000001",
    handleId: "0a000000-0000-4000-8000-000000000001",
    type,
    refType: "opening",
    reasonCode: null,
    isReversal: false,
    reversedByOperationId: null,
    reversible: false,
    qty: 25,
    unit: "kg",
    lines: [
      {
        movementId: "0a000000-0000-4000-8000-000000000001",
        locationId: "10000000-0000-4000-8000-0000000000a1",
        locationName: "Dispensa (demo)",
        rawLotId: null,
        lotCode: null,
        qty: 25,
      },
    ],
    effectiveOn: "2026-12-01",
    createdAt: "2026-12-05T10:00:00Z",
    byName: "Titolare Demo",
    byMe: true,
  });

  it("accepts an operation of type opening", () => {
    expect(
      movementsResponse.safeParse({ operations: [op("opening")], nextCursor: null }).success,
    ).toBe(true);
  });

  it("still refuses an unknown type", () => {
    expect(
      movementsResponse.safeParse({ operations: [op("gift")], nextCursor: null }).success,
    ).toBe(false);
  });

  it("still refuses an undeclared key (a cost slipping in)", () => {
    expect(
      movementsResponse.safeParse({
        operations: [{ ...op("opening"), unitCostEur: 0.8 }],
        nextCursor: null,
      }).success,
    ).toBe(false);
  });
});
