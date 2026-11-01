// Fixtures of the M24 export tests (plan docs/plans/2026-10-31-m24-exports.md §3.8): one reply per service, valid against the existing strict schemas,
// holding the edge cases the exports must survive (formula-leading names, a separator and a quote in a name, negatives, 4-decimal amounts, nulls).
// Built on the M22/M23 helpers. Every name and number is a fake fixture value.
import { DISCARDS, FORECAST_OWNER, PUSH_LIST_OWNER } from "../helpers/push-data";
import {
  ITEMS_ADMIN,
  ITEMS_OWNER,
  ITEM_SPEZZATINO,
  AVT,
  KPI_REPORT,
  UNMAPPED,
} from "../helpers/report-data";

export { KPI_REPORT };

const ITEM_FORMULA = {
  menuItemId: "11000000-0000-4000-8000-0000000000f1",
  name: "=1+1 (demo)",
  course: "bevande",
  plates: 2,
  mixPct: 10,
  revenueNetEur: 38.0002,
  costedPlates: 0,
  costedRevenueNetEur: 0,
  foodCostEur: null,
  foodCostPct: null,
  foodMarginPerPlateEur: null,
  status: "unmapped" as const,
};
const ITEM_QUOTED = {
  ...ITEM_SPEZZATINO,
  menuItemId: "11000000-0000-4000-8000-0000000000f2",
  name: 'Il "Rosso" (demo); riserva',
  foodMarginPerPlateEur: -3.5,
};

/** Items with the formula, quote and null edge cases, for both roles. */
export const ITEMS_ADMIN_EDGE = {
  ...ITEMS_ADMIN,
  rows: [ITEM_SPEZZATINO, ITEM_FORMULA, ITEM_QUOTED],
};
export const ITEMS_OWNER_EDGE = {
  ...ITEMS_OWNER,
  rows: [
    ITEMS_OWNER.rows[0]!,
    {
      ...ITEM_FORMULA,
      fixedCostPerPlateEur: null,
      grossMarginPerPlateEur: null,
      contributionEur: null,
      fixedCostReason: "no_sales" as const,
    },
    {
      ...ITEM_QUOTED,
      fixedCostPerPlateEur: 5,
      grossMarginPerPlateEur: -8.5,
      contributionEur: -17,
      fixedCostReason: null,
    },
  ],
};

/** Unmapped items with a formula-leading name. */
export const UNMAPPED_EDGE = {
  ...UNMAPPED,
  rows: [
    {
      menuItemId: "11000000-0000-4000-8000-0000000000f1",
      name: "=1+1 (demo)",
      plates: 2,
      revenueGrossEur: 6.5,
      lastSoldOn: "2026-11-04",
    },
    UNMAPPED.rows[1]!,
  ],
};

/** AVT with an ingredient whose name starts with "-", a negative variance and a 4-decimal amount. */
export const AVT_EDGE = {
  ...AVT,
  rows: [
    {
      ingredientId: "1e000000-0000-4000-8000-0000000000f1",
      name: "-Burro (demo)",
      baseUnit: "kg",
      actualQty: 4.5,
      theoreticalQty: 5,
      wasteQty: 0,
      varianceQty: -0.5,
      unitCostEur: 7.6,
      varianceEur: -3.8,
    },
    {
      ...AVT.rows[0]!,
      varianceEur: 38.0002,
    },
    AVT.rows[1]!,
  ],
};

// ---- M23 tables (step 5) ----

export { DISCARDS, FORECAST_OWNER, PUSH_LIST_OWNER };

const PLATE_STEW = "11000000-0000-4000-8000-000000000001";
const PLATE_RAGU = "11000000-0000-4000-8000-000000000002";

/**
 * A push list with the plan's edge cases: two plates in API order (the second one pushed with a price), two batch recipes, a null cost at risk,
 * an empty plate list, a winter instant (19:00Z -> 20:00 CET) and a summer one (22:00Z -> 00:00 CEST the next day), a lot with an expiry date.
 */
export const PUSH_LIST_EDGE = {
  ...PUSH_LIST_OWNER,
  rows: [
    {
      kind: "batch" as const,
      id: "ba000000-0000-4000-8000-0000000000a1",
      name: "Spezzatino (demo)",
      lotCode: "261101-LOT-1",
      madeOn: "2026-11-02",
      useByAt: "2026-11-04T19:00:00Z",
      expiryDate: null,
      hoursToUseBy: 10,
      quantity: 14,
      unit: "porz",
      batchRecipes: [],
      costAtRiskEur: 38.0002,
      plates: [
        {
          menuItemId: PLATE_STEW,
          name: "Spezzatino con polenta (demo)",
          pushed: true,
          pushUntil: "2026-11-05T01:00:00Z",
          pushPrice: 12,
        },
        {
          menuItemId: PLATE_RAGU,
          name: "Tagliatelle al ragù (demo)",
          pushed: false,
          pushUntil: null,
          pushPrice: null,
        },
      ],
    },
    {
      kind: "lot" as const,
      id: "1e000000-0000-4000-8000-0000000000a2",
      name: "Manzo (demo)",
      lotCode: null,
      madeOn: "2026-10-20",
      useByAt: "2026-10-24T22:00:00Z",
      expiryDate: "2026-10-25",
      hoursToUseBy: 0,
      quantity: 3.2,
      unit: "kg",
      batchRecipes: [
        { recipeKey: "ec000000-0000-4000-8000-0000000000e1", name: "Spezzatino (demo)" },
        { recipeKey: "ec000000-0000-4000-8000-0000000000e3", name: "Ragù (demo)" },
      ],
      costAtRiskEur: null,
      plates: [],
    },
  ],
};

/** A forecast with a null expected portion and gap, and two plates. */
export const FORECAST_EDGE = {
  ...FORECAST_OWNER,
  batches: [
    ...FORECAST_OWNER.batches,
    {
      recipeKey: "ec000000-0000-4000-8000-0000000000e3",
      name: "Ragù (demo)",
      expectedPortions: null,
      onHandPortions: 6,
      gap: null,
    },
  ],
  plates: [
    ...FORECAST_OWNER.plates,
    { menuItemId: PLATE_RAGU, name: "=Tagliatelle (demo)", expectedPlates: 11.5 },
  ],
};
