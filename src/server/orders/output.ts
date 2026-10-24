import { z } from "zod";
import { UNAVAILABLE_REASONS } from "@/server/menu/output";
import { TABLE_STATUS_VALUES } from "@/server/tables/output";
import { COURSES } from "./constants";

// Strict output schemas of the order endpoints (M18 plan §3.1.9, §3.4). The services parse every database reply here,
// so a key that is not declared (a cost that slipped into an RPC reply) makes the parse throw: a 500, never a leak.
// `unitPrice` is the sale price, VAT included, frozen when the line was added; there is no VAT, cost, margin, GP,
// food cost or recipe key anywhere. The shapes are snapshot-tested.

const course = z.enum(COURSES);

export const LINE_STATES = ["draft", "fired", "voided"] as const;

/** One order line as order_view and the write procedures render it. Timestamps keep the database's text. */
export const orderLine = z.strictObject({
  id: z.uuid(),
  menuItemId: z.uuid(),
  name: z.string(),
  course,
  qty: z.number(),
  segue: z.boolean(),
  note: z.string().nullable(),
  isShared: z.boolean(),
  unitPrice: z.number(),
  state: z.enum(LINE_STATES),
  clientUpdatedAt: z.string(),
  updatedAt: z.string(),
  updatedBy: z.strictObject({ id: z.uuid(), displayName: z.string() }),
});

const orderSession = z.strictObject({
  id: z.uuid(),
  tableId: z.uuid(),
  tableName: z.string(),
  covers: z.number().int(),
  status: z.enum(TABLE_STATUS_VALUES),
  billRequested: z.boolean(),
  closed: z.boolean(),
});

export const orderViewOutput = z.strictObject({
  session: orderSession,
  lines: z.array(orderLine),
});

/** What a write says about the dish's stock, so the screen needs no second read. */
const itemStock = z.strictObject({
  id: z.uuid(),
  available: z.boolean(),
  /** Why the dish is not available, as the database says it (null when it is available). */
  unavailableReason: z.enum(UNAVAILABLE_REASONS).nullable(),
  portionsLeft: z.number().nullable(),
  lowStock: z.boolean(),
});

export const addLineOutput = z.strictObject({
  created: z.boolean(),
  line: orderLine,
  item: itemStock,
});

export const lineWriteOutput = z.strictObject({ changed: z.boolean(), line: orderLine });

export const CONFLICT_REASONS = ["stale", "fired", "voided", "session_closed"] as const;

/** A `conflict`: why, and the line as it is now. It is a result of the database, never a DETAIL (logs carry codes only). */
export const conflictDetails = z.strictObject({
  reason: z.enum(CONFLICT_REASONS),
  line: orderLine,
});

/** The DETAIL of an `item_unavailable`. */
export const itemUnavailableDetails = z.strictObject({
  menuItemId: z.uuid(),
  reason: z.enum(UNAVAILABLE_REASONS),
  portionsLeft: z.number().nullable(),
});

/** What the edit and remove procedures return: the written line, or a conflict as a result (never a raised error). */
export const lineWriteResult = z.union([
  lineWriteOutput,
  z.strictObject({ conflict: conflictDetails }),
]);

export type OrderLine = z.infer<typeof orderLine>;
export type OrderView = z.infer<typeof orderViewOutput>;
export type AddLineOutput = z.infer<typeof addLineOutput>;
export type LineWriteOutput = z.infer<typeof lineWriteOutput>;
export type ConflictDetails = z.infer<typeof conflictDetails>;
export type ItemUnavailableDetails = z.infer<typeof itemUnavailableDetails>;
export type ItemStock = z.infer<typeof itemStock>;
