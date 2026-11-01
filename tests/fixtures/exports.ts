// Fixtures of the M24 export tests (plan docs/plans/2026-10-31-m24-exports.md §3.8): one reply per service, valid against the existing strict schemas,
// holding the edge cases the exports must survive (formula-leading names, a separator and a quote in a name, negatives, 4-decimal amounts, nulls).
// Built on the M22/M23 helpers. Every name and number is a fake fixture value.
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
