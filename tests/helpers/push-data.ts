// Fake replies of the M23 functions (docs/plans/2026-10-31-m23-push-forecast.md §3.8), shaped as the SQL returns them. Fake data only.
const STEW_ITEM = "11000000-0000-4000-8000-000000000001";
const RAGU_ITEM = "11000000-0000-4000-8000-000000000002";
const STEW_KEY = "ec000000-0000-4000-8000-0000000000e1";

const plate = (id: string, name: string, pushed = false, pushUntil: string | null = null) => ({
  menuItemId: id,
  name,
  pushed,
  pushUntil,
});

const rowsBase = {
  b1: {
    kind: "batch" as const,
    id: "ba000000-0000-4000-8000-000000000001",
    name: "Spezzatino",
    lotCode: "261101-LOT-1",
    madeOn: "2026-11-02",
    useByAt: "2026-11-04T19:00:00Z",
    expiryDate: null,
    hoursToUseBy: 10,
    quantity: 14,
    unit: "porz",
    batchRecipes: [],
    plates: [plate(STEW_ITEM, "Spezzatino con polenta")],
  },
  b2: {
    kind: "batch" as const,
    id: "ba000000-0000-4000-8000-000000000002",
    name: "Ragù (demo)",
    lotCode: "261101-LOT-2",
    madeOn: "2026-11-02",
    useByAt: "2026-11-04T13:00:00Z",
    expiryDate: null,
    hoursToUseBy: 4,
    quantity: 6,
    unit: "porz",
    batchRecipes: [],
    plates: [plate(RAGU_ITEM, "Tagliatelle al ragù (demo)")],
  },
  l1: {
    kind: "lot" as const,
    id: "1e000000-0000-4000-8000-000000000001",
    name: "Manzo (demo)",
    lotCode: "LM-1",
    madeOn: "2026-11-02",
    useByAt: "2026-11-05T23:00:00Z",
    expiryDate: "2026-11-05",
    hoursToUseBy: 38,
    quantity: 3.2,
    unit: "kg",
    batchRecipes: [{ recipeKey: STEW_KEY, name: "Spezzatino" }],
    plates: [],
  },
};

const withMoney = (row: (typeof rowsBase)[keyof typeof rowsBase], cost: number | null) => ({
  ...row,
  plates: row.plates.map((p) => ({ ...p, pushPrice: null as number | null })),
  costAtRiskEur: cost,
});

export const PUSH_LIST_OWNER = {
  role: "owner" as const,
  asOf: "2026-11-04T09:00:00Z",
  businessDate: "2026-11-04",
  rows: [
    withMoney(rowsBase.b2, null),
    withMoney(rowsBase.b1, 38.0002),
    withMoney(rowsBase.l1, 38.4),
  ],
  expired: { batches: 1, lots: 1 },
  unresolvedRecipes: 0,
  totals: { count: 3, costAtRiskEur: 76.4002, unvaluedCount: 1 },
};

export const PUSH_LIST_CHEF = {
  role: "chef" as const,
  asOf: "2026-11-04T09:00:00Z",
  businessDate: "2026-11-04",
  rows: [rowsBase.b2, rowsBase.b1, rowsBase.l1],
  expired: { batches: 1, lots: 1 },
  unresolvedRecipes: 0,
  totals: { count: 3 },
};

const forecastBase = {
  date: "2026-11-05",
  today: "2026-11-05",
  tomorrow: "2026-11-06",
  weekday: 4,
  sourceDates: ["2026-10-29", "2026-10-22", "2026-10-15", "2026-10-08"],
  weeksUsed: 4,
  batches: [
    { recipeKey: STEW_KEY, name: "Spezzatino", expectedPortions: 22, onHandPortions: 14, gap: 8 },
  ],
  plates: [{ menuItemId: STEW_ITEM, name: "Spezzatino con polenta", expectedPlates: 22 }],
};

export const FORECAST_OWNER = {
  role: "owner" as const,
  ...forecastBase,
  covers: { expected: 31 as number | null },
};
export const FORECAST_CHEF = { role: "chef" as const, ...forecastBase };

export const DISCARDS = {
  weekFrom: "2026-11-02",
  weekTo: "2026-11-08",
  rows: [
    {
      recipeKey: "ec000000-0000-4000-8000-0000000000e3",
      name: "Ragù (demo)",
      shelfLifeHours: 72,
      batchesDiscarded: 1,
      batchesPushed: 0,
      portionsDiscarded: 5,
      portionsPushed: 0,
      valueEur: 7.5,
      unvaluedCount: 0,
    },
    {
      recipeKey: STEW_KEY,
      name: "Spezzatino",
      shelfLifeHours: 48,
      batchesDiscarded: 1,
      batchesPushed: 1,
      portionsDiscarded: 3,
      portionsPushed: 3,
      valueEur: 8.1429,
      unvaluedCount: 0,
    },
  ],
  totals: {
    batchesDiscarded: 2,
    batchesPushed: 1,
    portionsDiscarded: 8,
    portionsPushed: 3,
    valueEur: 15.6429,
    unvaluedCount: 0,
  },
};

export const PUSH_RESULT = {
  changed: true,
  item: {
    id: STEW_ITEM,
    name: "Spezzatino con polenta",
    category: "Secondi",
    course: "secondi" as const,
    position: 0,
    recipeKey: "ec000000-0000-4000-8000-0000000000e2",
    recipeName: "Spezzatino con polenta",
    recipeActive: true,
    unmapped: false,
    price: 14,
    vatRate: 10,
    priceUnit: "portion" as const,
    portionWeightG: null,
    priceValidFrom: "2026-10-01T00:00:00+00:00",
    available: true,
    active: true,
    pushUntil: "2026-11-05T01:00:00+00:00",
    pushPrice: 12,
  },
};

// push_sell_through (P2-2 plan §3.4), as the SQL returns it: no `role` key, the push price for owner and admin only. Dates in 1998.
const SELL_ATRISK = {
  recipeKey: "ec000000-0000-4000-8000-0000000000e2",
  name: "Ragù Demo",
  batches: 2,
  atStart: 10,
  soldDuring: 8,
  wastedDuring: 1,
  otherDuring: 0,
  leftAtEnd: 1,
  discardedAfter: 1,
  sellThroughPct: 80,
};
const sellCard = {
  menuItemId: "11000000-0000-4000-8000-000000000002",
  name: "Lasagne Demo",
  startedAt: "1998-11-13T10:00:00Z",
  endedAt: "1998-11-14T01:00:00Z",
  ongoing: false,
  hasDayRate: true,
  plates: { lines: 14, portions: 14.4 },
  atRisk: [SELL_ATRISK],
};
const sellBase = {
  businessDate: "1998-11-13",
  ongoing: false,
  summary: { pushes: 1, lines: 14, portions: 14.4 },
};
export const SELL_THROUGH_OWNER = { ...sellBase, pushes: [{ ...sellCard, pushPrice: 12 }] };
export const SELL_THROUGH_CHEF = { ...sellBase, pushes: [sellCard] };
export const SELL_THROUGH_EMPTY = {
  ...sellBase,
  pushes: [],
  summary: { pushes: 0, lines: 0, portions: 0 },
};
export const SELL_THROUGH_ATRISK = SELL_ATRISK;
