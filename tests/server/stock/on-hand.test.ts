import { describe, expect, it } from "vitest";
import { groupStockItems } from "@/server/stock/on-hand";
import type { StockOnHandRow } from "@/server/stock/types";

const ING_A = "1a000000-0000-4000-8000-00000000001a";
const ING_B = "1b000000-0000-4000-8000-00000000001b";
const CELLA = "10000000-0000-4000-8000-0000000000a1";
const FREEZER = "10000000-0000-4000-8000-0000000000a2";

const row = (over: Partial<StockOnHandRow>): StockOnHandRow => ({
  ingredient_id: ING_A,
  ingredient_name: "Manzo muscolo (demo)",
  base_unit: "kg",
  is_active: true,
  location_id: CELLA,
  location_name: "Cella (demo)",
  on_hand_qty: 10,
  unlotted_qty: 0,
  ...over,
});

describe("groupStockItems", () => {
  it("groups rows of two ingredients x two locations into two items, in the order SQL returned them", () => {
    const items = groupStockItems([
      row({ on_hand_qty: 10 }),
      row({ location_id: FREEZER, location_name: "Freezer (demo)", on_hand_qty: 2.3 }),
      row({
        ingredient_id: ING_B,
        ingredient_name: "Uova (demo)",
        base_unit: "pz",
        on_hand_qty: 12,
      }),
      row({
        ingredient_id: ING_B,
        ingredient_name: "Uova (demo)",
        base_unit: "pz",
        location_id: FREEZER,
        location_name: "Freezer (demo)",
        on_hand_qty: 6,
      }),
    ]);
    expect(items.map((item) => item.name)).toEqual(["Manzo muscolo (demo)", "Uova (demo)"]);
    expect(items[0]).toEqual({
      ingredientId: ING_A,
      name: "Manzo muscolo (demo)",
      baseUnit: "kg",
      isActive: true,
      onHandQty: 12.3,
      negative: false,
      locations: [
        { locationId: CELLA, name: "Cella (demo)", onHandQty: 10, unlottedQty: 0, negative: false },
        {
          locationId: FREEZER,
          name: "Freezer (demo)",
          onHandQty: 2.3,
          unlottedQty: 0,
          negative: false,
        },
      ],
    });
    expect(items[1]?.onHandQty).toBe(18);
  });

  it("the total is not polluted by float noise (0,1 + 0,2 is 0,3)", () => {
    const [item] = groupStockItems([
      row({ on_hand_qty: 0.1 }),
      row({ location_id: FREEZER, location_name: "Freezer (demo)", on_hand_qty: 0.2 }),
    ]);
    expect(item?.onHandQty).toBe(0.3);
  });

  it("negative is true only where the SQL quantity is below zero", () => {
    const [item] = groupStockItems([
      row({ on_hand_qty: 0 }),
      row({
        location_id: FREEZER,
        location_name: "Freezer (demo)",
        on_hand_qty: -1,
        unlotted_qty: -1,
      }),
    ]);
    expect(item?.locations.map((l) => l.negative)).toEqual([false, true]);
    expect(item?.negative).toBe(true);
    expect(groupStockItems([row({ on_hand_qty: 0 })])[0]?.negative).toBe(false);
    expect(
      groupStockItems([row({ on_hand_qty: 3, unlotted_qty: -1 })])[0]?.locations[0]?.negative,
    ).toBe(false);
  });

  it("an empty answer is no item", () => {
    expect(groupStockItems([])).toEqual([]);
  });
});
