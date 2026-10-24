import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  batchItem,
  batchItemWithCost,
  batchLabel,
  batchListResponse,
  batchListWithCostResponse,
  batchProposal,
  produceResult,
} from "@/server/batches/output";

const ID = "ba000000-0000-4000-8000-0000000000b1";
const KEY = "ec000000-0000-4000-8000-0000000000e1";
const RECIPE = "ed000000-0000-4000-8000-0000000000d1";
const BEEF = "1a000000-0000-4000-8000-00000000001a";
const CELLA = "10000000-0000-4000-8000-0000000000a1";
const LOT = "10700000-0000-4000-8000-0000000000a1";
const MOVE = "0e000000-0000-4000-8000-0000000000e1";

// Every property name of a schema, at any depth, through its JSON Schema.
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

const ITEM = {
  batchId: ID,
  lotCode: "261023-SPEZZA-1",
  recipeKey: KEY,
  recipeName: "Spezzatino (demo)",
  version: 1,
  producedAt: "2026-10-23T10:00:00+00:00",
  useBy: "2026-10-26T10:00:00+00:00",
  useByState: "ok",
  shelfLifeHours: 72,
  outputQty: 6.2,
  outputUnit: "kg",
  portionsComputed: 31,
  portionsInitial: 31,
  portionsRemaining: 31,
  state: "fresh",
  locationId: CELLA,
  locationName: "Cella (demo)",
  byInitials: "CD",
  byMe: true,
};
const PROPOSAL = {
  recipe: {
    key: KEY,
    id: RECIPE,
    version: 1,
    name: "Spezzatino (demo)",
    outputQty: 6,
    outputUnit: "kg",
    portionsPerBatch: 30,
    shelfLifeHours: 72,
    portionSize: 0.2,
  },
  outputQty: 6.2,
  portionsComputed: 31,
  shelfLifeHours: 72,
  useByPreview: "2026-10-26T10:00:00+00:00",
  today: "2026-10-23",
  locations: [{ id: CELLA, name: "Cella (demo)" }],
  suggestedLocationId: CELLA,
  inputs: [
    {
      ingredientId: BEEF,
      name: "Manzo muscolo (demo)",
      baseUnit: "kg",
      isStock: true,
      proposedQty: 5.1667,
      units: ["kg", "g"],
      suggestedLocationId: CELLA,
      onHand: [{ locationId: CELLA, onHandQty: 6 }],
      lots: [
        {
          rawLotId: LOT,
          lotCode: "L-D2",
          locationId: CELLA,
          expiry: "2026-10-25",
          expiryState: "ok",
          onHandQty: 3,
          fefoRank: 1,
        },
      ],
    },
  ],
};
const RESULT = {
  batchId: ID,
  lotCode: "261023-SPEZZA-1",
  recipe: { key: KEY, id: RECIPE, version: 1, name: "Spezzatino (demo)" },
  producedAt: "2026-10-23T10:00:00+00:00",
  useBy: "2026-10-26T10:00:00+00:00",
  outputQty: 6.2,
  outputUnit: "kg",
  portionsComputed: 31,
  portions: 31,
  shelfLifeHours: 72,
  locationId: CELLA,
  inputs: [
    {
      ingredientId: BEEF,
      locationId: CELLA,
      qty: 5.3,
      movements: [{ id: MOVE, rawLotId: LOT, qty: -3 }],
    },
  ],
  negatives: [{ ingredientId: BEEF, locationId: CELLA, onHandQty: -0.3 }],
};
const LABEL = {
  batchId: ID,
  recipeName: "Spezzatino (demo)",
  version: 1,
  producedAt: "2026-10-23T10:00:00+00:00",
  useBy: "2026-10-26T10:00:00+00:00",
  portions: 31,
  lotCode: "261023-SPEZZA-1",
  operatorInitials: "CD",
  shelfLifeHours: 72,
};

describe("the quantity shapes carry no cost (Q16 = project V6)", () => {
  it.each([
    ["batchProposal", batchProposal],
    ["produceResult", produceResult],
    ["batchItem", batchItem],
    ["batchListResponse", batchListResponse],
    ["batchLabel", batchLabel],
  ])("%s declares no key that looks like money", (_name, schema) => {
    const names = propertyNames(schema);
    expect(names.length).toBeGreaterThan(5);
    expect(names.filter((n) => COSTLY.test(n))).toEqual([]);
  });

  it("batchItemWithCost adds exactly the cost object, the only place with euro keys", () => {
    const base = new Set(propertyNames(batchItem));
    const added = propertyNames(batchItemWithCost).filter((n) => !base.has(n));
    expect(added.sort()).toEqual(["cost", "incomplete", "perPortionEur", "totalEur"].sort());
    expect(Object.keys(batchItemWithCost.shape).filter((k) => !(k in batchItem.shape))).toEqual([
      "cost",
    ]);
  });
});

describe("the shapes are strict", () => {
  it("accepts the planned examples", () => {
    expect(batchProposal.parse(PROPOSAL)).toEqual(PROPOSAL);
    expect(produceResult.parse(RESULT)).toEqual(RESULT);
    expect(batchItem.parse(ITEM)).toEqual(ITEM);
    expect(batchLabel.parse(LABEL)).toEqual(LABEL);
    expect(batchListResponse.parse({ items: [ITEM], nextCursor: null }).items).toHaveLength(1);
  });

  it("refuses an undeclared key, such as a cost that slipped into an RPC reply", () => {
    expect(() => batchItem.parse({ ...ITEM, total_cost: 53.5167 })).toThrow();
    expect(() => batchLabel.parse({ ...LABEL, unit_cost: 1 })).toThrow();
    expect(() => produceResult.parse({ ...RESULT, cost: 1 })).toThrow();
    expect(() =>
      batchProposal.parse({
        ...PROPOSAL,
        inputs: [{ ...PROPOSAL.inputs[0], unit_cost: 10 }],
      }),
    ).toThrow();
    expect(() =>
      batchListResponse.parse({ items: [{ ...ITEM, cost: {} }], nextCursor: null }),
    ).toThrow();
  });

  it("the owner and admin list accepts a cost per item; incomplete is null, never 0", () => {
    const withCost = {
      ...ITEM,
      cost: { totalEur: 53.5167, perPortionEur: 1.7263, incomplete: false },
    };
    expect(
      batchListWithCostResponse.parse({ items: [withCost], nextCursor: null }).items[0],
    ).toEqual(withCost);
    const incomplete = { ...ITEM, cost: { totalEur: null, perPortionEur: null, incomplete: true } };
    expect(
      batchListWithCostResponse.parse({ items: [incomplete], nextCursor: "c" }).items[0]!.cost,
    ).toEqual({ totalEur: null, perPortionEur: null, incomplete: true });
    expect(() => batchListWithCostResponse.parse({ items: [ITEM], nextCursor: null })).toThrow();
  });

  it("checks the enums", () => {
    expect(() => batchItem.parse({ ...ITEM, useByState: "later" })).toThrow();
    expect(() => batchItem.parse({ ...ITEM, state: "gone" })).toThrow();
    expect(() => batchItem.parse({ ...ITEM, outputUnit: "g" })).toThrow();
  });
});
