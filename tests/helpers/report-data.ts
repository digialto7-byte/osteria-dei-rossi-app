// Fake payloads of the M22 report functions, shaped like the SQL replies of supabase/tests/database 234-238 (the day of plan §3.9: 2026-11-04,
// "Osteria Demo A"). Numbers are the hand-computed ones; nothing here is real client data.

const HOURS = Array.from({ length: 24 }, (_, h) => (h === 20 ? 3 : h === 21 ? 2 : 0));

export const KPI_BLOCK = {
  from: "2026-11-04",
  to: "2026-11-04",
  final: true,
  daysFinal: 1,
  days: 1,
  covers: 5,
  tables: 2,
  revenueGrossEur: 135,
  revenueNetEur: 119.1281,
  copertoNetEur: 9.0909,
  avgSpendPerCoverEur: 23.8256,
  avgTicketEur: 59.5641,
  plates: 9,
  foodCostEur: 21.35,
  foodCostPct: 29.82,
  costedRevenueNetEur: 71.5909,
  uncostedRevenueNetEur: 38.4463,
  costedSharePct: 65.06,
  coversByHour: HOURS,
  coversByWeekday: [0, 0, 5, 0, 0, 0, 0],
  purchasesEur: 280,
  purchasesUnvaluedCount: 0,
  waste: { valueEur: 12, unvaluedCount: 0, reasons: [{ reasonCode: "spoilage", valueEur: 12 }] },
  appVsRegister: {
    appTotalEur: 135,
    registerTotalEur: 130,
    difference: { amount: 5, pct: 3.8 },
    datesWithoutRegister: [] as string[],
  },
};

export const KPI_PREVIOUS = {
  ...KPI_BLOCK,
  from: "2026-10-28",
  to: "2026-10-28",
  covers: 2,
  tables: 1,
  revenueGrossEur: 50,
  revenueNetEur: 45.4545,
  copertoNetEur: 0,
  avgSpendPerCoverEur: 22.7273,
  avgTicketEur: 45.4545,
  plates: 4,
  foodCostEur: 12.4,
  foodCostPct: 27.28,
  costedRevenueNetEur: 45.4545,
  uncostedRevenueNetEur: 0,
  costedSharePct: 100,
  coversByHour: Array.from({ length: 24 }, (_, h) => (h === 18 ? 2 : 0)),
  coversByWeekday: [0, 0, 2, 0, 0, 0, 0],
  purchasesEur: 0,
  waste: { valueEur: 0, unvaluedCount: 0, reasons: [] },
  appVsRegister: {
    appTotalEur: 50,
    registerTotalEur: null,
    difference: null,
    datesWithoutRegister: ["2026-10-28"],
  },
};

const delta = (abs: number, pct: number | null) => ({ abs, pct });
export const KPI_REPORT = {
  period: "day" as const,
  current: KPI_BLOCK,
  previous: KPI_PREVIOUS,
  delta: {
    covers: delta(3, 150),
    tables: delta(1, 100),
    revenueGrossEur: delta(85, 170),
    revenueNetEur: delta(73.6736, 162.1),
    avgSpendPerCoverEur: delta(1.0983, 4.8),
    avgTicketEur: delta(14.1096, 31),
    plates: delta(5, 125),
    foodCostEur: delta(8.95, 72.2),
    foodCostPct: delta(2.54, 9.3),
    purchasesEur: delta(280, null),
    wasteEur: delta(12, null),
    appTotalEur: delta(85, 170),
  },
};

const itemBase = {
  course: "secondi",
  costedPlates: 2.5,
  status: "costed" as const,
  weightG: null,
  avgWeightG: null,
};
export const ITEM_SPEZZATINO = {
  ...itemBase,
  menuItemId: "11000000-0000-4000-8000-000000000001",
  name: "Spezzatino con polenta (demo)",
  plates: 2.5,
  mixPct: 27.78,
  revenueNetEur: 31.8181,
  costedRevenueNetEur: 31.8181,
  foodCostEur: 10.5,
  foodCostPct: 33,
  foodMarginPerPlateEur: 8.5272,
};
export const ITEM_VINO = {
  menuItemId: "11000000-0000-4000-8000-000000000004",
  name: "Vino rosso (demo)",
  course: "bevande",
  plates: 1,
  mixPct: 11.11,
  revenueNetEur: 32.9918,
  costedPlates: 0,
  costedRevenueNetEur: 0,
  foodCostEur: null,
  foodCostPct: null,
  foodMarginPerPlateEur: null,
  status: "unmapped" as const,
  weightG: null,
  avgWeightG: null,
};
const totals = {
  plates: 9,
  revenueNetEur: 110.0372,
  costedRevenueNetEur: 71.5909,
  foodCostEur: 21.35,
  foodCostPct: 29.82,
};
export const ITEMS_ADMIN = {
  role: "admin" as const,
  period: "day" as const,
  from: "2026-11-04",
  to: "2026-11-04",
  final: true,
  rows: [ITEM_SPEZZATINO, ITEM_VINO],
  totals,
};
export const ITEMS_OWNER = {
  ...ITEMS_ADMIN,
  role: "owner" as const,
  rows: [
    {
      ...ITEM_SPEZZATINO,
      fixedCostPerPlateEur: 5,
      grossMarginPerPlateEur: 3.5272,
      contributionEur: 8.8181,
      fixedCostReason: null,
    },
    {
      ...ITEM_VINO,
      fixedCostPerPlateEur: null,
      grossMarginPerPlateEur: null,
      contributionEur: null,
      fixedCostReason: null,
    },
  ],
};

export const AVT = {
  count: {
    id: "c5000000-0000-4000-8000-000000000002",
    closedAt: "2026-11-30T10:00:00+00:00",
    locationName: "Cella (demo)",
  },
  openingCount: {
    id: "c5000000-0000-4000-8000-000000000001",
    closedAt: "2026-11-01T10:00:00+00:00",
  },
  locationsActive: 1,
  rows: [
    {
      ingredientId: "1e000000-0000-4000-8000-000000000001",
      name: "Manzo (demo)",
      baseUnit: "kg",
      actualQty: 5.8,
      theoreticalQty: 5,
      wasteQty: 0.2,
      varianceQty: 0.8,
      unitCostEur: 12,
      varianceEur: 9.6,
    },
    {
      ingredientId: "1e000000-0000-4000-8000-000000000004",
      name: "Lievito (demo)",
      baseUnit: "kg",
      actualQty: 0.5,
      theoreticalQty: 0,
      wasteQty: 0,
      varianceQty: 0.5,
      unitCostEur: null,
      varianceEur: null,
    },
  ],
  totals: { varianceEur: 9.6, lossEur: 9.6, gainEur: 0, unvaluedCount: 1, notCountedCount: 2 },
  availableCounts: [
    {
      id: "c5000000-0000-4000-8000-000000000002",
      closedAt: "2026-11-30T10:00:00+00:00",
      locationName: "Cella (demo)",
    },
    {
      id: "c5000000-0000-4000-8000-000000000001",
      closedAt: "2026-11-01T10:00:00+00:00",
      locationName: "Cella (demo)",
    },
  ],
};

export const UNMAPPED = {
  weekFrom: "2026-11-02",
  weekTo: "2026-11-08",
  rows: [
    {
      menuItemId: "11000000-0000-4000-8000-000000000003",
      name: "Acqua (demo)",
      plates: 2,
      revenueGrossEur: 6,
      lastSoldOn: "2026-11-04",
    },
    {
      menuItemId: "11000000-0000-4000-8000-000000000004",
      name: "Vino rosso (demo)",
      plates: 1,
      revenueGrossEur: 40.25,
      lastSoldOn: "2026-11-04",
    },
  ],
  totals: { plates: 3, revenueGrossEur: 46.25 },
};

export const YESTERDAY = {
  businessDate: "2026-11-04",
  final: false,
  covers: 5,
  tables: 2,
  revenueNetEur: 119.1281,
  avgSpendPerCoverEur: 23.8256,
  avgTicketEur: 59.5641,
  foodCostPct: 29.82,
  costedSharePct: 65.06,
  costedRevenueNetEur: 71.5909,
  compare: {
    businessDate: "2026-10-28",
    covers: 2,
    revenueNetEur: 45.4545,
    avgSpendPerCoverEur: 22.7273,
    avgTicketEur: 45.4545,
    foodCostPct: 27.28,
  },
  delta: {
    covers: delta(3, 150),
    revenueNetEur: delta(73.6736, 162.1),
    avgSpendPerCoverEur: delta(1.0983, 4.8),
    avgTicketEur: delta(14.1096, 31),
    foodCostPct: delta(2.54, 9.3),
  },
};
