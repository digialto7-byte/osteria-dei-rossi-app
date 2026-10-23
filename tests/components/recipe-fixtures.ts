import type { RecipeDetail, RecipeSummary } from "@/server/recipes/detail";

// Fake recipes for the component tests (names carry "(demo)"; nothing comes from the client's files).
export const SUMMARY: RecipeSummary = {
  key: "cc000000-0000-4000-8000-0000000000cc",
  name: "Spezzatino (demo)",
  type: "batch",
  version: 3,
  validFrom: "2026-10-23T10:00:00+00:00",
  isActive: true,
  allergens: { list: [], status: "confirmed", unconfirmedIngredients: [] },
};

export const BATCH: RecipeDetail = {
  ...SUMMARY,
  isCurrent: true,
  outputQty: 6,
  outputUnit: "kg",
  portionsPerBatch: 30,
  portionSize: 0.2,
  shelfLifeHours: 72,
  prepTimeMin: 180,
  minPortions: 5,
  targetPortions: 30,
  lines: [
    {
      position: 1,
      target: { kind: "ingredient", id: "1a", name: "Manzo muscolo (demo)" },
      qty: 5,
      unit: "kg",
      yieldFactor: 1,
      warnings: [],
    },
  ],
  versions: [
    { version: 3, validFrom: "2026-10-23T10:00:00+00:00" },
    { version: 2, validFrom: "2026-10-22T10:00:00+00:00" },
    { version: 1, validFrom: "2026-10-21T10:00:00+00:00" },
  ],
  canEditPrice: false,
  canDeactivate: true,
};

export const PLATE: RecipeDetail = {
  ...BATCH,
  key: "dd000000-0000-4000-8000-0000000000dd",
  name: "Spezzatino con polenta (demo)",
  type: "plate",
  version: 1,
  outputQty: null,
  outputUnit: null,
  portionsPerBatch: null,
  portionSize: null,
  shelfLifeHours: null,
  prepTimeMin: null,
  minPortions: null,
  targetPortions: null,
  allergens: {
    list: ["glutine"],
    status: "da_confermare",
    unconfirmedIngredients: [{ id: "2b", name: "Farina di mais (demo)" }],
  },
  lines: [
    {
      position: 1,
      target: { kind: "recipe", id: "cc", name: "Spezzatino (demo)", type: "batch" },
      qty: 1,
      unit: "porz",
      yieldFactor: 1,
      warnings: [],
    },
    {
      position: 2,
      target: { kind: "recipe", id: "ee", name: "Polenta (demo)", type: "sub" },
      qty: 0.2,
      unit: "kg",
      yieldFactor: 1.5,
      warnings: ["yield_above_one"],
    },
  ],
  versions: [{ version: 1, validFrom: "2026-10-23T10:00:00+00:00" }],
  canEditPrice: true,
  pricing: { salePrice: 12, targetGpPct: 70 },
};
