// Opening stock (carico iniziale): the bounds of docs/plans/2026-11-18-opening-stock.md (Q7). The SQL twins are app.opening_max_lines(),
// app.opening_line_values, app.opening_check_date and app.opening_reversal_reasons(); tests/parity/opening-sql-parity.test.ts keeps them equal.

/** Lines per location in the draft, and per confirm. */
export const OPENING_MAX_LINES = 200;
/** Base units per line, as app.stock_qty_base. */
export const OPENING_QTY_MAX = 100_000;
/** EUR per base unit, net of VAT. */
export const OPENING_COST_MAX = 100_000;
/** Decimals of qty and unit cost; more is refused, never rounded. */
export const OPENING_DECIMALS = 4;
/** How far back the "Data del carico" may go, in days before today's business date. */
export const OPENING_DATE_MAX_DAYS_BACK = 366;
/** The reason codes of a correction (spec §5). */
export const OPENING_REVERSAL_REASONS = [
  "qty_wrong",
  "cost_wrong",
  "ingredient_wrong",
  "location_wrong",
] as const;
export type OpeningReversalReason = (typeof OPENING_REVERSAL_REASONS)[number];
/** Request bodies: 200 lines fit well within it. */
export const MAX_OPENING_BODY_BYTES = 64 * 1024;
