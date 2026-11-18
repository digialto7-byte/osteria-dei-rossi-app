import { describe, expect, it } from "vitest";
import {
  confirmResponse,
  draftPutResponse,
  draftResponse,
  historyResponse,
  removedResponse,
  reverseResponse,
  summaryResponse,
} from "@/server/opening/output";

// Opening stock step 13: the strict output schemas of /api/stock/opening/* (plan §3.4, §3.5, §3.6). An undeclared key
// makes the parse throw (a 500, never a leak).
const LOC = "10000000-0000-4000-8000-0000000000a1";
const ING = "1a000000-0000-4000-8000-000000000001";
const LINE = {
  id: "0d000000-0000-4000-8000-000000000001",
  ingredientId: ING,
  ingredientName: "Farina 00 (demo)",
  baseUnit: "kg",
  qty: 25,
  unitCostEur: 0.8,
  valueEur: 20,
  updatedAt: "2026-12-01T10:00:00+00:00",
  updatedByName: "Titolare Demo",
};
const DRAFT = {
  today: "2026-12-01",
  maxLines: 200,
  booked: false,
  locations: [
    {
      locationId: LOC,
      name: "Dispensa (demo)",
      countedOn: null,
      countOpen: false,
      firstReceiptOn: null,
      bookable: true,
      lines: [LINE],
      lineCount: 1,
      totalValueEur: 20,
    },
  ],
  lineCount: 1,
  totalValueEur: 20,
};
const OP = {
  openingId: "0e000000-0000-4000-8000-000000000001",
  effectiveOn: "2026-12-01",
  createdAt: "2026-12-01T10:00:00+00:00",
  byName: "Titolare Demo",
  lineCount: 1,
  totalValueEur: 20,
  reversed: null,
  correctable: true,
  lines: [
    {
      movementId: "0a000000-0000-4000-8000-000000000001",
      ingredientId: ING,
      name: "Farina 00 (demo)",
      baseUnit: "kg",
      qty: 25,
      unitCostEur: 0.8,
      valueEur: 20,
    },
  ],
};

describe("opening output schemas", () => {
  it("accept the shapes of the SQL procedures", () => {
    expect(draftResponse.parse(DRAFT)).toEqual(DRAFT);
    expect(draftPutResponse.parse({ lines: [{ ...LINE, locationId: LOC }] }).lines).toHaveLength(1);
    expect(removedResponse.parse({ removed: 2 })).toEqual({ removed: 2 });
    expect(
      confirmResponse.parse({
        openingId: OP.openingId,
        locationId: LOC,
        effectiveOn: "2026-12-01",
        lineCount: 1,
        totalValueEur: 20,
        changed: true,
      }).changed,
    ).toBe(true);
    const history = {
      location: { id: LOC, name: "Dispensa (demo)" },
      countedOn: null,
      countOpen: false,
      operations: [
        OP,
        {
          ...OP,
          reversed: { at: OP.createdAt, byName: "Admin Demo", reasonCode: "cost_wrong" },
          correctable: false,
        },
      ],
    };
    expect(historyResponse.parse(history).operations).toHaveLength(2);
    expect(
      reverseResponse.parse({
        openingId: OP.openingId,
        reversalOperationId: OP.openingId,
        restoredLineIds: [LINE.id],
      }).restoredLineIds,
    ).toEqual([LINE.id]);
    expect(summaryResponse.parse({ booked: true, draftLines: 0 })).toEqual({
      booked: true,
      draftLines: 0,
    });
  });

  it("refuse an undeclared key at every level", () => {
    expect(draftResponse.safeParse({ ...DRAFT, tenantId: LOC }).success).toBe(false);
    expect(
      draftResponse.safeParse({
        ...DRAFT,
        locations: [{ ...DRAFT.locations[0], lines: [{ ...LINE, createdBy: LOC }] }],
      }).success,
    ).toBe(false);
    expect(
      summaryResponse.safeParse({ booked: true, draftLines: 0, totalValueEur: 1 }).success,
    ).toBe(false);
    expect(
      historyResponse.safeParse({
        location: { id: LOC, name: "x" },
        countedOn: null,
        countOpen: false,
        operations: [{ ...OP, requestId: LOC }],
      }).success,
    ).toBe(false);
  });

  it("refuse an unknown reason code in a reversed operation", () => {
    const bad = { ...OP, reversed: { at: OP.createdAt, byName: "x", reasonCode: "foo" } };
    expect(
      historyResponse.safeParse({
        location: { id: LOC, name: "x" },
        countedOn: null,
        countOpen: false,
        operations: [bad],
      }).success,
    ).toBe(false);
  });
});
