/** Gate 1: the app's food cost may differ from the chef's sheet by this much (percent of the sheet). */
export const COST_CHECK_TOLERANCE_PCT = 5;
/** Rows of a pasted or uploaded chef sheet; one venue's menu is far smaller. */
export const COST_CHECK_MAX_ROWS = 500;
/** Characters of a pasted CSV. */
export const MAX_COST_CHECK_CHARS = 64_000;
/** The cost check body limit in bytes (a CSV of 64 000 characters can need up to 4 bytes each). */
export const MAX_COST_CHECK_BODY_BYTES = 262_144;
/** The cost settings, their ranges and defaults live in Postgres (app.cost_settings); this is the form hint. */
export const COST_SETTING_RANGES = {
  avgCostN: { min: 1, max: 10 },
  priceVariancePct: { min: 1, max: 100 },
  saleVatPct: { min: 0, max: 30 },
} as const;
/** Typo guard mirrored from fixed_cost_period's checks (EUR per item per month). */
export const FIXED_COST_MAX = 1_000_000;
