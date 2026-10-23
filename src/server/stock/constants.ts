/** The largest quantity of one call, in base units (kg, l or pz); a typo guard. Mirrors app.stock_qty_base. */
export const STOCK_QTY_MAX = 100_000;
/** A lot expiring within this many days of today is "due soon" (PRD 2.4); the SQL is app.expiry_state. */
export const EXPIRY_SOON_DAYS = 1;
/** Operations per page of GET /api/stock/movements; mirrors the SQL default of public.stock_movements. */
export const STOCK_MOVEMENTS_PAGE_SIZE = 50;
export const STOCK_MOVEMENTS_PAGE_MAX = 100;
/** The longest range of GET /api/stock/waste-costs, in days (inclusive); mirrors public.raw_waste_costs. */
export const WASTE_RANGE_MAX_DAYS = 366;
/** A stock write is a few hundred bytes; this only stops a runaway request before it is read. */
export const MAX_STOCK_BODY_BYTES = 4096;

/** The units a chef may type per base unit of the ingredient (SQL: app.base_factor). */
export const UNITS_FOR_BASE = {
  kg: ["kg", "g"],
  l: ["l", "ml"],
  pz: ["pz"],
} as const;

export const STOCK_INPUT_UNITS = ["kg", "g", "l", "ml", "pz"] as const;
export type StockInputUnit = (typeof STOCK_INPUT_UNITS)[number];

/** Base units per one input unit; the same table as app.base_factor for these units. */
export const UNIT_FACTOR: Record<StockInputUnit, number> = {
  kg: 1,
  g: 0.001,
  l: 1,
  ml: 0.001,
  pz: 1,
};
