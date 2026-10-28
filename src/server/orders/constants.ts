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
] as const;
export type VoidReason = (typeof VOID_REASONS)[number];
