import { z } from "zod";
import { UNAVAILABLE_REASONS } from "@/server/menu/output";
import { SESSION_STATUS_VALUES, sessionCoperto } from "@/server/tables/output";
import { COURSES, USCITA_MAX, USCITA_MIN } from "./constants";

// Strict output schemas of the order endpoints (M18 plan §3.1.9, §3.4). The services parse every database reply here,
// so a key that is not declared (a cost that slipped into an RPC reply) makes the parse throw: a 500, never a leak.
// `unitPrice` is the sale price, VAT included, frozen when the line was added; there is no cost, margin, GP, food
// cost or recipe key anywhere. The one VAT key is the coperto's sale VAT rate at `session.coperto.vatRate` (lead
// decision DS-BQ-2 Q-D1); the cost-key guards exempt exactly that path. The shapes are snapshot-tested.

const course = z.enum(COURSES);

export const LINE_STATES = ["draft", "fired", "voided"] as const;

/** One order line as order_view and the write procedures render it. Timestamps keep the database's text. */
export const orderLine = z.strictObject({
  id: z.uuid(),
  menuItemId: z.uuid(),
  name: z.string(),
  course,
  qty: z.number(),
  /** Comanda per uscita: 0 ("Subito") to 9; null for a line from before uscite (a closed session of today). Screens treat null as 1. */
  uscita: z.number().int().min(USCITA_MIN).max(USCITA_MAX).nullable(),
  /** Mirrors uscita >= 2 (legacy readers); kept until the Q9 cleanup. */
  segue: z.boolean(),
  note: z.string().nullable(),
  isShared: z.boolean(),
  /** For a weighted line this is the line price (qty is 1); screens show it as the amount, never as a unit price (D-11). */
  unitPrice: z.number(),
  /** Grams of a weighted line, null on a portion line (P2-0b). */
  weightG: z.number().int().nullable(),
  /** The price per 100 g frozen when the line was added, null on a portion line. */
  pricePer100g: z.number().nullable(),
  state: z.enum(LINE_STATES),
  clientUpdatedAt: z.string(),
  updatedAt: z.string(),
  updatedBy: z.strictObject({ id: z.uuid(), displayName: z.string() }),
});

/** Who opened the table: the display name only, never the staff id (data minimisation, DS-BQ-2 Q-D2). */
const orderSessionOpener = z.strictObject({ displayName: z.string() });

const orderSession = z.strictObject({
  id: z.uuid(),
  tableId: z.uuid(),
  tableName: z.string(),
  covers: z.number().int(),
  status: z.enum(SESSION_STATUS_VALUES),
  billRequested: z.boolean(),
  closed: z.boolean(),
  /** When the session was opened, as the database's text (the same value as on the tile). */
  openedAt: z.string(),
  /** Whether it was opened in today's business day. The server decides; screens do not compute it. */
  openedToday: z.boolean(),
  openedBy: orderSessionOpener,
  /** The coperto frozen at opening, as on the tile; null when the session has none. */
  coperto: sessionCoperto.nullable(),
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

/** held: a sent line whose uscita is not called accepts only not_prepared; uscita_called: not_prepared after the call (comanda per uscita). */
export const CONFLICT_REASONS = [
  "stale",
  "fired",
  "voided",
  "session_closed",
  "held",
  "uscita_called",
] as const;

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
export type OrderSessionOpener = z.infer<typeof orderSessionOpener>;
export type AddLineOutput = z.infer<typeof addLineOutput>;
export type LineWriteOutput = z.infer<typeof lineWriteOutput>;
export type ConflictDetails = z.infer<typeof conflictDetails>;
export type ItemUnavailableDetails = z.infer<typeof itemUnavailableDetails>;
export type ItemStock = z.infer<typeof itemStock>;

export const SKIP_REASONS = ["already_fired", "voided"] as const;

/** What fire_course returns: every requested line as it is now, the ids fired, and the ones skipped with the reason. */
export const fireOutput = z.strictObject({
  lines: z.array(orderLine),
  fired: z.array(z.uuid()),
  skipped: z.array(z.strictObject({ lineId: z.uuid(), reason: z.enum(SKIP_REASONS) })),
  /** Comanda per uscita: the ids this call fired that are held afterwards (waiting for "Via la n"). */
  held: z.array(z.uuid()),
});

export type FireOutput = z.infer<typeof fireOutput>;

// Comanda per uscita: the call (docs/plans/2026-11-18-comanda-uscite.md section 3.6, 3.13).
/** One call: the uscita, its instant (the database's text) and who called it (display name, no money). */
export const uscitaCall = z.strictObject({
  uscita: z.number().int().min(2).max(USCITA_MAX),
  calledAt: z.string(),
  calledBy: z.strictObject({ id: z.uuid(), displayName: z.string() }),
});

export const callOutput = z.strictObject({
  changed: z.boolean(),
  call: uscitaCall,
  lines: z.array(orderLine),
});

export const CALL_CONFLICT_REASONS = ["already_called", "nothing_waiting"] as const;

/** A call conflict, a result of the database: another waiter called first (with the instant), or nothing is waiting. */
export const callConflict = z.strictObject({
  reason: z.enum(CALL_CONFLICT_REASONS),
  uscita: z.number().int().min(2).max(USCITA_MAX),
  calledAt: z.string().optional(),
});

export const callResult = z.union([callOutput, z.strictObject({ conflict: callConflict })]);

export type UscitaCall = z.infer<typeof uscitaCall>;
export type CallOutput = z.infer<typeof callOutput>;
export type CallConflict = z.infer<typeof callConflict>;
