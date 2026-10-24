import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  adjustResult,
  batchDetail,
  batchLabel,
  discardResult,
  splitResult,
} from "@/server/batches/output";

const ID = "ba000000-0000-4000-8000-0000000000b1";
const CHILD = "ba000000-0000-4000-8000-0000000000b2";
const KEY = "ec000000-0000-4000-8000-0000000000e1";
const CELLA = "10000000-0000-4000-8000-0000000000a1";
const MOVE = "0e000000-0000-4000-8000-0000000000e1";

function propertyNames(schema: z.ZodType): string[] {
  const names: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === "object") {
      const record = node as Record<string, unknown>;
      if (record.properties && typeof record.properties === "object") {
        names.push(...Object.keys(record.properties));
      }
      Object.values(record).forEach(walk);
    }
  };
  walk(z.toJSONSchema(schema, { io: "output" }));
  return names;
}
const COSTLY = /eur|cost|price|margin|value|amount/i;

const DETAIL = {
  batchId: ID,
  lotCode: "261023-RAGUDE-2",
  recipeKey: KEY,
  recipeName: "Ragù (demo)",
  version: 1,
  producedAt: "2026-10-23T10:00:00+00:00",
  useBy: "2026-10-25T10:00:00+00:00",
  useByState: "ok",
  shelfLifeHours: 48,
  outputQty: 2,
  outputUnit: "kg",
  portionsComputed: 10,
  portionsInitial: 10,
  portionsRemaining: 6,
  state: "open",
  locationId: CELLA,
  locationName: "Cella (demo)",
  byInitials: "CD",
  byMe: true,
  createdByInitials: "CD",
  createdAt: "2026-10-23T10:01:00+00:00",
  splitFrom: null,
  splits: [
    { batchId: CHILD, lotCode: "261024-RAGUDE-3", portions: 4, locationName: "Congelatore (demo)" },
  ],
  movements: [
    {
      id: MOVE,
      type: "split",
      portions: -4,
      reasonCode: null,
      refType: "batch_split",
      at: "2026-10-24T10:10:00+00:00",
      byInitials: "CD",
      byMe: true,
    },
    {
      id: MOVE,
      type: "waste",
      portions: -3,
      reasonCode: "spoilage",
      refType: "batch_discard",
      at: "2026-10-24T10:05:00+00:00",
      byInitials: "TD",
      byMe: false,
    },
  ],
  defaults: { hoursLeft: 24 },
  can: { adjust: true, discard: true, split: true },
};
const ADJUST = { batchId: ID, movementId: MOVE, delta: -1, portionsRemaining: 5, state: "open" };
const DISCARD = {
  batchId: ID,
  movementId: MOVE,
  portions: 3,
  reasonCode: "spoilage",
  portionsRemaining: 7,
  state: "open",
};
const SPLIT = {
  batchId: ID,
  newBatchId: CHILD,
  lotCode: "261024-RAGUDE-3",
  portions: 4,
  producedAt: "2026-10-23T10:00:00+00:00",
  useBy: "2027-01-21T12:00:00+00:00",
  shelfLifeHours: 2162,
  locationId: CELLA,
  portionsRemaining: 6,
  state: "open",
};

describe("the batch action shapes carry no cost (Q16 = project V6)", () => {
  it.each([
    ["batchDetail", batchDetail],
    ["adjustResult", adjustResult],
    ["discardResult", discardResult],
    ["splitResult", splitResult],
    ["batchLabel", batchLabel],
  ])("%s declares no key that looks like money", (_name, schema) => {
    const names = propertyNames(schema);
    expect(names.length).toBeGreaterThanOrEqual(5);
    expect(names.filter((n) => COSTLY.test(n))).toEqual([]);
  });
});

describe("batchDetail", () => {
  it("accepts the planned example and a split part with its parent", () => {
    expect(batchDetail.parse(DETAIL)).toEqual(DETAIL);
    const child = { ...DETAIL, splitFrom: { batchId: ID, lotCode: "261023-RAGUDE-2" }, splits: [] };
    expect(batchDetail.parse(child).splitFrom?.lotCode).toBe("261023-RAGUDE-2");
  });

  it("accepts an expired batch with no hours left", () => {
    const expired = {
      ...DETAIL,
      defaults: { hoursLeft: null },
      can: { adjust: true, discard: true, split: false },
    };
    expect(batchDetail.parse(expired).defaults.hoursLeft).toBeNull();
  });

  it("refuses an undeclared key at any depth, such as a unit cost that slipped in", () => {
    expect(() => batchDetail.parse({ ...DETAIL, unit_cost: 2 })).toThrow();
    expect(() =>
      batchDetail.parse({ ...DETAIL, movements: [{ ...DETAIL.movements[0], unitCost: 2 }] }),
    ).toThrow();
    expect(() => batchDetail.parse({ ...DETAIL, can: { ...DETAIL.can, sell: true } })).toThrow();
  });

  it("checks the enums: movement type, reason, state", () => {
    expect(() =>
      batchDetail.parse({ ...DETAIL, movements: [{ ...DETAIL.movements[0], type: "sale" }] }),
    ).toThrow();
    expect(() =>
      batchDetail.parse({
        ...DETAIL,
        movements: [{ ...DETAIL.movements[1], reasonCode: "count_correction" }],
      }),
    ).toThrow();
    expect(() => batchDetail.parse({ ...DETAIL, state: "gone" })).toThrow();
  });
});

describe("the action results", () => {
  it("accept the planned examples; an unchanged count has no movement", () => {
    expect(adjustResult.parse(ADJUST)).toEqual(ADJUST);
    expect(adjustResult.parse({ ...ADJUST, movementId: null, delta: 0 }).movementId).toBeNull();
    expect(discardResult.parse(DISCARD)).toEqual(DISCARD);
    expect(splitResult.parse(SPLIT)).toEqual(SPLIT);
  });

  it("refuse an undeclared key and a bad reason or state", () => {
    expect(() => adjustResult.parse({ ...ADJUST, cost: 1 })).toThrow();
    expect(() => discardResult.parse({ ...DISCARD, unit_cost: 2 })).toThrow();
    expect(() => discardResult.parse({ ...DISCARD, reasonCode: "foo" })).toThrow();
    expect(() => splitResult.parse({ ...SPLIT, state: "gone" })).toThrow();
    expect(() => splitResult.parse({ ...SPLIT, total_cost: 8 })).toThrow();
  });
});

describe("batchLabel (extended)", () => {
  const LABEL = {
    batchId: CHILD,
    recipeName: "Ragù (demo)",
    version: 1,
    producedAt: "2026-10-23T10:00:00+00:00",
    useBy: "2027-01-21T12:00:00+00:00",
    portions: 4,
    lotCode: "261024-RAGUDE-3",
    operatorInitials: "CD",
    shelfLifeHours: 2162,
    portionsRemaining: 4,
    splitFrom: { lotCode: "261023-RAGUDE-2" },
  };

  it("carries the portions still in the batch and the parent lot", () => {
    expect(batchLabel.parse(LABEL)).toEqual(LABEL);
    expect(batchLabel.parse({ ...LABEL, splitFrom: null }).splitFrom).toBeNull();
  });

  it("requires both new keys and stays strict", () => {
    const { splitFrom: _s, ...withoutSplit } = LABEL;
    expect(() => batchLabel.parse(withoutSplit)).toThrow();
    expect(() =>
      batchLabel.parse({ ...LABEL, splitFrom: { lotCode: "x", batchId: ID } }),
    ).toThrow();
  });
});
