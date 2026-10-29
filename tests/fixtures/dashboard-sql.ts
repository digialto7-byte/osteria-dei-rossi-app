// What public.dashboard_summary() returns (supabase/migrations/20261108100300_dashboard_summary.sql), for the plan's
// fixture (docs/plans/2026-10-28-owner-dashboard.md §5). Fake data only.

const id = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const ING_1 = id("11000000", 1);
export const SUP_1 = id("5a000000", 1);
export const RECIPE_1 = id("ec000000", 1);

export const COUNTS = {
  invoicesToReview: 2,
  payablesOverdue: 2,
  payablesUnpaid: 4,
  batchesUseBy: 2,
  countOpen: true,
  setup: {
    hasLocations: true,
    hasSuppliers: true,
    hasIngredients: true,
    hasApprovedInvoice: true,
    hasStaff: false,
    hasDevice: false,
    hasTables: true,
    hasMenuItems: false,
  },
};

export const purchaseDueAlert = (acknowledgedAt: string | null = null) => ({
  id: id("a1000000", 1),
  kind: "purchase_due",
  severity: "warning",
  entityType: "ingredient",
  entityId: ING_1,
  businessDate: "2026-11-09",
  createdAt: "2026-11-09T05:00:00.000Z",
  payload: {
    ingredient_id: ING_1,
    supplier_id: SUP_1,
    supplier_item_id: id("51000000", 1),
    order_qty: 10,
    packs_count: 2,
    pack_qty: 5,
    unit: "kg",
    order_by_at: "2026-11-09T09:00:00+00:00",
    delivery_date: "2026-11-11",
    horizon_days: 3,
    on_hand_qty: 2,
    forecast_qty: 4,
    projected_qty: -2,
    min_qty: 3,
    target_qty: 8,
  },
  costBearing: false,
  acknowledgedAt,
});

export const priceVarianceAlert = () => ({
  id: id("a1000000", 2),
  kind: "price_variance",
  severity: "warning",
  entityType: "ingredient",
  entityId: ING_1,
  businessDate: "2026-11-09",
  createdAt: "2026-11-09T06:00:00.000Z",
  payload: {
    ingredient_id: ING_1,
    ingredient_name: "Farina (fixture)",
    unit: "kg",
    invoice_id: id("e1000000", 1),
    invoice_number: "F-1",
    supplier_id: SUP_1,
    supplier_name: "Fornitore Uno (demo)",
    new_price_eur: 5,
    baseline_eur: 4,
    change_pct: 25,
    threshold_pct: 10,
    purchases_in_baseline: 3,
    recipes_count: 0,
    recipes_listed: 0,
    recipes: [],
  },
  costBearing: true,
  acknowledgedAt: null,
});

const common = () => ({
  asOf: "2026-11-09T07:12:03.120Z",
  today: structuredClone(COUNTS),
  foodCost: { overallPct: 28.28, platesCounted: 6, platesIncomplete: 1 },
  plates: {
    worst: [
      {
        recipeKey: RECIPE_1,
        name: "Tagliatelle (fixture)",
        gpPct: 60,
        targetGpPct: 70,
        gapPct: -10,
        status: "below_target",
      },
      {
        recipeKey: id("ec000000", 4),
        name: "Gnocchi (fixture)",
        gpPct: 80,
        targetGpPct: null,
        gapPct: null,
        status: "ok",
      },
    ],
    incomplete: [{ recipeKey: id("ec000000", 7), name: "Ossobuco (fixture)" }],
    incompleteCount: 1,
  },
  payables: {
    dueSoonDays: 7,
    overdue: { count: 2, amountEur: 150.5 },
    dueSoon: { count: 2, amountEur: 245 },
    items: [
      {
        id: id("90000000", 1),
        supplierName: "Fornitore Uno (demo)",
        invoiceNumber: "F-1",
        amountEur: 120,
        dueDate: "2026-11-04",
        daysToDue: -5,
        overdue: true,
      },
      {
        id: id("90000000", 3),
        supplierName: "Fornitore Due (demo)",
        invoiceNumber: null,
        amountEur: 45,
        dueDate: "2026-11-09",
        daysToDue: 0,
        overdue: false,
      },
    ],
  },
  stockAtRisk: {
    belowMin: {
      count: 2,
      items: [
        { ingredientId: ING_1, name: "Farina (fixture)", onHandQty: 2, minQty: 3, unit: "kg" },
      ],
    },
    expiringLots: {
      count: 2,
      items: [
        {
          rawLotId: id("1e000000", 2),
          ingredientId: ING_1,
          ingredientName: "Farina (fixture)",
          lotCode: "L-02",
          expiry: "2026-11-08",
          state: "expired",
          qty: 3,
          unit: "kg",
        },
      ],
    },
    expiringBatches: {
      count: 2,
      items: [
        {
          batchId: id("ba000000", 1),
          recipeName: "Ragù (fixture)",
          lotCode: "261109-RAGU-1",
          useBy: "2026-11-09T19:00:00.000Z",
          state: "due_soon",
          portions: 4,
        },
      ],
    },
  },
  waste: {
    from: "2026-11-09",
    to: "2026-11-15",
    valueEur: 12,
    rawValueEur: 6,
    batchValueEur: 6,
    unvaluedCount: 1,
    reasons: [
      { reasonCode: "expired", valueEur: 6 },
      { reasonCode: "spoilage", valueEur: 6 },
    ],
  },
  comingSoon: ["covers", "revenue", "averageSpend"],
});

export const ownerSql = () => ({
  role: "owner",
  ...common(),
  alertsOpen: { count: 7, more: false },
  priceVariance: { count: 2, items: [priceVarianceAlert()] },
  todayLists: {
    businessDate: "2026-11-09",
    prepCount: 0,
    prep: [],
    purchaseCount: 1,
    purchase: [purchaseDueAlert()],
  },
  names: {
    ingredient: { [ING_1]: "Farina (fixture)" },
    location: {},
    recipe: {},
    supplier: { [SUP_1]: "Fornitore Uno (demo)" },
    raw_lot: {},
    batch: {},
  },
  fixedCosts: {
    periodMonth: "2026-11-01",
    monthlyTotalEur: 3000,
    platesSold: 0,
    perPlateEur: null,
    reason: "no_sales",
  },
});

export const adminSql = () => ({ role: "admin", ...common() });
