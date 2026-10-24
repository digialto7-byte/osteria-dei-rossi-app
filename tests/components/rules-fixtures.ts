import type {
  IngredientRulesItem,
  RecipeRulesItem,
  SupplierRulesItem,
} from "@/server/rules/output";

// Fake data only ("(demo)" names, invented quantities).
export const BEEF = "1a000000-0000-4000-8000-00000000001a";
export const SUPPLIER = "5a000000-0000-4000-8000-000000000001";
export const PACK = "5e000000-0000-4000-8000-000000000001";
export const STEW = "4b000000-0000-4000-8000-000000000001";

export const WINDOW = { deliveryDate: "2026-11-05", orderByAt: "2026-11-03T10:00:00Z" };

export const INGREDIENT: IngredientRulesItem = {
  ingredientId: BEEF,
  name: "Manzo muscolo (demo)",
  baseUnit: "kg",
  isCritical: false,
  minLevel: 5,
  targetLevel: 12,
  onHandQty: 9,
  preferred: {
    supplierItemId: PACK,
    supplierId: SUPPLIER,
    supplierName: "Macelleria X (demo)",
    packQty: 5,
    packLabel: "5 kg",
  },
  nextWindow: WINDOW,
  status: "ok",
  reasons: [],
};

export const CHOICES = [
  {
    supplierItemId: PACK,
    ingredientId: BEEF,
    supplierId: SUPPLIER,
    supplierName: "Macelleria X (demo)",
    packQty: 5,
    packLabel: "5 kg",
  },
  {
    supplierItemId: "5e000000-0000-4000-8000-000000000002",
    ingredientId: "1a000000-0000-4000-8000-00000000002b",
    supplierId: SUPPLIER,
    supplierName: "Macelleria X (demo)",
    packQty: 1,
    packLabel: "1 kg",
  },
];

export const SUPPLIER_ITEM: SupplierRulesItem = {
  supplierId: SUPPLIER,
  name: "Macelleria X (demo)",
  leadTimeDays: 2,
  deliveryWeekdays: [1, 4],
  orderCutoffTime: "11:00",
  nextWindow: WINDOW,
};

export const RECIPE: RecipeRulesItem = {
  recipeKey: STEW,
  name: "Spezzatino (demo)",
  version: 3,
  portionsPerBatch: 30,
  minPortions: 5,
  targetPortions: 30,
  prepTimeMin: 180,
  sources: { min: "rule", target: "version", prep: "version" },
  remainingPortions: 4,
};
