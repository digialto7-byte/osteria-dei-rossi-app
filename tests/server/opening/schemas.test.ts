import { describe, expect, it } from "vitest";
import { confirmBody, draftPutBody, locationQuery, reverseBody } from "@/server/opening/schemas";

// Opening stock step 13 (docs/plans/2026-11-18-opening-stock.md §3.9, §5 step 13): strict bodies. SQL repeats every check
// (app.opening_line_values), because a Data API caller skips Zod.
const LOC = "10000000-0000-4000-8000-0000000000a1";
const ING = "1a000000-0000-4000-8000-000000000001";
const line = (over: Record<string, unknown> = {}) => ({
  id: "0d000000-0000-4000-8000-000000000001",
  ingredientId: ING,
  qty: 25,
  unitCostEur: 0.8,
  ...over,
});
const confirm = (over: Record<string, unknown> = {}) => ({
  locationId: LOC,
  effectiveOn: "2026-12-01",
  requestId: "e0000000-0000-4000-8000-000000000001",
  lines: [line()],
  ...over,
});

describe("confirmBody", () => {
  it("refuses a line with unitCostEur missing", () => {
    const { unitCostEur: _omit, ...withoutCost } = line();
    expect(confirmBody.safeParse(confirm({ lines: [withoutCost] })).success).toBe(false);
  });

  it("accepts a well-formed confirm, a cost of 0 and 4 decimals", () => {
    expect(confirmBody.safeParse(confirm()).success).toBe(true);
    expect(confirmBody.safeParse(confirm({ lines: [line({ unitCostEur: 0 })] })).success).toBe(
      true,
    );
    expect(
      confirmBody.safeParse(confirm({ lines: [line({ qty: 1.2345, unitCostEur: 99999.9999 })] }))
        .success,
    ).toBe(true);
  });

  it.each([
    ["qty 0", { qty: 0 }],
    ["qty with 5 decimals", { qty: 1.00001 }],
    ["qty above 100000", { qty: 100001 }],
    ["a negative cost", { unitCostEur: -0.01 }],
    ["a cost with 5 decimals", { unitCostEur: 1.00001 }],
    ["an extra key", { note: "x" }],
    ["a string qty", { qty: "25" }],
  ])("refuses %s", (_name, over) => {
    expect(confirmBody.safeParse(confirm({ lines: [line(over)] })).success).toBe(false);
  });

  it("refuses 201 lines and an empty list", () => {
    const many = Array.from({ length: 201 }, () => line({ id: crypto.randomUUID() }));
    expect(confirmBody.safeParse(confirm({ lines: many })).success).toBe(false);
    expect(confirmBody.safeParse(confirm({ lines: [] })).success).toBe(false);
  });

  it("refuses a date that is not YYYY-MM-DD or not a calendar date, and a non-uuid requestId", () => {
    expect(confirmBody.safeParse(confirm({ effectiveOn: "1/12/2026" })).success).toBe(false);
    expect(confirmBody.safeParse(confirm({ effectiveOn: "2026-02-30" })).success).toBe(false);
    expect(confirmBody.safeParse(confirm({ requestId: "r1" })).success).toBe(false);
  });

  it("refuses an extra top-level key", () => {
    expect(confirmBody.safeParse({ ...confirm(), tenantId: LOC }).success).toBe(false);
  });
});

describe("draftPutBody", () => {
  it("needs the location on every line", () => {
    expect(draftPutBody.safeParse({ lines: [{ ...line(), locationId: LOC }] }).success).toBe(true);
    expect(draftPutBody.safeParse({ lines: [line()] }).success).toBe(false);
  });

  it("refuses more than 200 lines", () => {
    const many = Array.from({ length: 201 }, () => ({
      ...line({ id: crypto.randomUUID() }),
      locationId: LOC,
    }));
    expect(draftPutBody.safeParse({ lines: many }).success).toBe(false);
  });
});

describe("reverseBody and locationQuery", () => {
  it("takes one of the four reasons only", () => {
    for (const reason of ["qty_wrong", "cost_wrong", "ingredient_wrong", "location_wrong"]) {
      expect(reverseBody.safeParse({ reason }).success).toBe(true);
    }
    expect(reverseBody.safeParse({ reason: "foo" }).success).toBe(false);
    expect(reverseBody.safeParse({ reason: "cost_wrong", note: "x" }).success).toBe(false);
  });

  it("locationQuery needs exactly one locationId uuid", () => {
    expect(locationQuery(new URL(`http://x/?locationId=${LOC}`))).toEqual({ locationId: LOC });
    expect(() => locationQuery(new URL("http://x/"))).toThrow();
    expect(() => locationQuery(new URL("http://x/?locationId=abc"))).toThrow();
    expect(() => locationQuery(new URL(`http://x/?locationId=${LOC}&locationId=${LOC}`))).toThrow();
    expect(() => locationQuery(new URL(`http://x/?locationId=${LOC}&x=1`))).toThrow();
  });
});
