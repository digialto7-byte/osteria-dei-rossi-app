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
