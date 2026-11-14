import type { PushSellThrough, PushSellThroughChef } from "@/server/push/output";

// Fake replies of /api/reports/push-sell-through (P2-2 plan §3.4), shaped as the SQL returns them. Demo names; every date is in 1998.
export const LASAGNE_ITEM = "11000000-0000-4000-8000-0000000000a1";
export const TIRAMISU_ITEM = "11000000-0000-4000-8000-0000000000a2";
const RAGU_KEY = "ec000000-0000-4000-8000-0000000000a1";

const atRisk = {
  recipeKey: RAGU_KEY,
  name: "Ragù Demo",
  batches: 1,
  atStart: 10,
  soldDuring: 8,
  wastedDuring: 1,
  otherDuring: 0,
  leftAtEnd: 1,
  discardedAfter: 1,
  sellThroughPct: 80,
};
const lasagne = {
  menuItemId: LASAGNE_ITEM,
  name: "Lasagne Demo",
  startedAt: "1998-11-13T10:05:00.000Z",
  endedAt: "1998-11-14T01:00:00.000Z",
  ongoing: false,
  hasDayRate: true,
  plates: { lines: 14, portions: 14 },
  atRisk: [atRisk],
};
const tiramisu = {
  menuItemId: TIRAMISU_ITEM,
  name: "Tiramisù Demo",
  startedAt: "1998-11-13T17:30:00.000Z",
  endedAt: "1998-11-14T01:00:00.000Z",
  ongoing: false,
  hasDayRate: false,
  plates: { lines: 6, portions: 6 },
  atRisk: [],
};

export const SELL_OWNER: PushSellThrough = {
  businessDate: "1998-11-13",
  ongoing: false,
  summary: { pushes: 2, lines: 20, portions: 20 },
  pushes: [
    { ...lasagne, pushPrice: 12 },
    { ...tiramisu, pushPrice: null },
  ],
};
export const SELL_CHEF: PushSellThroughChef = {
  ...SELL_OWNER,
  pushes: [lasagne, tiramisu],
};
export const SELL_EMPTY: PushSellThrough = {
  businessDate: "1998-11-13",
  ongoing: false,
  summary: { pushes: 0, lines: 0, portions: 0 },
  pushes: [],
};
export const SELL_TODAY: PushSellThrough = {
  businessDate: "1998-11-14",
  ongoing: true,
  summary: { pushes: 1, lines: 3, portions: 3 },
  pushes: [
    {
      ...lasagne,
      ongoing: true,
      plates: { lines: 3, portions: 3 },
      pushPrice: null,
      atRisk: [
        {
          ...atRisk,
          otherDuring: -1,
          sellThroughPct: null,
          discardedAfter: 0,
          soldDuring: 1,
          wastedDuring: 0,
          leftAtEnd: 8,
        },
      ],
    },
  ],
};
