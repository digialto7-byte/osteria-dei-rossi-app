import { COURSES, type Course } from "@/server/menu/constants";

export { COURSES };
export type { Course };

/** Largest body of an order write: a line is a handful of short keys, so 2 KiB is generous (plan §3.4). */
export const MAX_ORDER_BODY_BYTES = 2048;
/** Mirrors order_line_qty_ck (20261101100000_order_core.sql): half portions, 0.5 to 99. */
export const MIN_QTY = 0.5;
export const MAX_QTY = 99;
/** Mirrors order_line_note_ck. */
export const NOTE_MAX = 140;
/** Mirrors app.client_clock_tolerance(): a phone this far ahead of the server cannot send edits. */
export const CLIENT_CLOCK_TOLERANCE_S = 120;
/** Mirrors app.low_stock_hint_portions(): "Ne restano N" shows at this many portions or fewer. */
export const LOW_STOCK_HINT_PORTIONS = 3;
/** The order screen refetches the menu and the lines this often while the page is visible (plan §3.5). */
export const ORDER_REFRESH_MS = 15_000;

/** Mirrors the array bound of public.fire_course: one call sends 1 to 50 lines (M19 plan §3.1.1). */
export const MAX_FIRE_LINES = 50;
/** 50 uuids plus the JSON around them. */
export const MAX_FIRE_BODY_BYTES = 4096;
/** Mirrors app.order_void_reason_codes(), in order (pinned by tests/parity/fire-sql-parity.test.ts). */
export const VOID_REASONS = [
  "order_error",
  "customer_changed",
  "kitchen_error",
  "returned",
  "comp",
  "breakage",
  // Comanda per uscita (M4): a held dish voided before its call. It is accepted only on a held line (the database says held / uscita_called
  // otherwise); the void dialog of PR2 still offers the six reasons of today (src/lib/orders/fire-view.ts).
  "not_prepared",
] as const;
export type VoidReason = (typeof VOID_REASONS)[number];

// P2-0b sell by weight (plan §3.1 P-4). The numbers mirror the SQL constants of 20261130100000_weight_core.sql (pinned by
// tests/parity/weight-constants.test.ts). There is no constant for the largest weight of a line: the tenant's setting is
// the maximum, so the schemas check the type, the minimum and the step, and the database judges the maximum.
/** Mirrors app.weight_min_g(): the smallest weight of a weighted line, in grams. */
export const WEIGHT_MIN_G = 50;
/** Mirrors app.weight_step_g(): weights go in steps of 10 g. */
export const WEIGHT_STEP_G = 10;
/** Mirrors app.default_weight_max_g(): the maximum of a tenant that has not set one. */
export const DEFAULT_WEIGHT_MAX_G = 3000;
/** Mirrors app.weight_max_setting_bounds() and the sale_settings CHECK: the range owner/admin may set the maximum in. */
export const WEIGHT_MAX_SETTING_MIN_G = 500;
export const WEIGHT_MAX_SETTING_MAX_G = 10_000;
/** Mirrors the menu_item_price.portion_weight_g CHECK: the reference portion of a weighted dish, in grams. */
export const PORTION_WEIGHT_MIN_G = 10;
export const PORTION_WEIGHT_MAX_G = 3000;
/** UI only (plan P-4): a weight of at least this many reference portions asks for a confirmation. Not in SQL. */
export const WEIGHT_CONFIRM_FACTOR = 3;

// Comanda per uscita (docs/plans/2026-11-18-comanda-uscite.md §3.1, §3.3). The numbers mirror order_line_uscita_ck, uscita_call_uscita_ck
// and uscita_call_cause_ck of 20261206220000_uscita_core.sql (pinned by tests/parity/uscite-sql-parity.test.ts).
/** The uscite of a line: 0 ("Subito", drinks) to 9. */
export const USCITA_MIN = 0;
export const USCITA_MAX = 9;
/** A sent line of this uscita or later is held until its uscita is called. */
export const HELD_FROM = 2;
/** Mirrors app.uscita_default: drinks go at once (0, "Subito"), everything else with the 1st (1). */
export function uscitaDefault(course: Course): number {
  return course === "bevande" ? 0 : 1;
}
/** Why a call row exists: "Via la n", a fire without hold (every op of an old bundle), the M5 placement of open sessions. */
export const USCITA_CALL_CAUSES = ["call", "fire_now", "migration"] as const;
export type UscitaCallCause = (typeof USCITA_CALL_CAUSES)[number];
/** The largest call body: {"uscita": 9}. */
export const MAX_CALL_BODY_BYTES = 1024;
