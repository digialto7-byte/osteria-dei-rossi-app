import { z } from "zod";
import {
  COURSES,
  HELD_FROM,
  MAX_FIRE_LINES,
  MAX_QTY,
  MIN_QTY,
  NOTE_MAX,
  USCITA_MAX,
  USCITA_MIN,
  VOID_REASONS,
  WEIGHT_MIN_G,
  WEIGHT_STEP_G,
} from "./constants";

// Strict bodies of the order endpoints (M18 plan §3.4). The bounds mirror the SQL procedures, which stay the
// authority: the schema only turns the obvious mistakes into a 400 before any RPC. The price is never a body key: the
// database freezes it when the line is added.

export const idParams = z.object({ id: z.uuid() });

/** Mirrors app.parse_client_time: ISO 8601 with an offset, up to 6 fraction digits. The 120 s bound is the database's. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;
export const clientUpdatedAt = z.string().regex(INSTANT);

/** Half portions: 0.5 to 99 in steps of 0.5. */
export const qty = z
  .number()
  .min(MIN_QTY)
  .max(MAX_QTY)
  .refine((value) => value * 2 === Math.trunc(value * 2), { message: "half steps only" });

/**
 * The weight of a weighted line, in whole grams (P2-0b): an integer of at least the minimum, on the step. There is no
 * maximum here on purpose: it is the tenant's setting, and the database (app.order_weight) is the authority for it.
 */
export const weightG = z
  .number()
  .int()
  .min(WEIGHT_MIN_G)
  .refine((value) => value % WEIGHT_STEP_G === 0, { message: "steps of 10 g only" });

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** Trimmed, at most 140 characters, no control characters; blank or null clears the note (the database stores null). */
export const note = z
  .string()
  .refine((value) => value.trim().length <= NOTE_MAX, { message: "too long" })
  .refine((value) => !CONTROL.test(value), { message: "control characters" })
  .nullable();

const course = z.enum(COURSES);

/** Comanda per uscita: 0 ("Subito") to 9, an integer (app.order_uscita). */
export const uscita = z.number().int().min(USCITA_MIN).max(USCITA_MAX);
/** uscita replaces the legacy segue: a body names one or the other, never both (the database answers 22023). */
const uscitaOrSegue = (body: { uscita?: number | undefined; segue?: boolean | undefined }) =>
  body.uscita === undefined || body.segue === undefined;
const USCITA_OR_SEGUE = { message: "uscita and segue are exclusive" };

/** The fields of an add, before the weight/qty rule: the offline payload reuses them without the stamp. */
export const addLineObject = z.strictObject({
  lineId: z.uuid(),
  menuItemId: z.uuid(),
  clientUpdatedAt,
  qty: qty.optional(),
  weightG: weightG.optional(),
  course: course.optional(),
  uscita: uscita.optional(),
  segue: z.boolean().optional(),
  note: note.optional(),
  isShared: z.boolean().optional(),
});

/** A weighted line is always one piece (qty 1): the client never sends both. */
export const weightOrQty = (body: { weightG?: number | undefined; qty?: number | undefined }) =>
  body.weightG === undefined || body.qty === undefined;
const WEIGHT_OR_QTY = { message: "weight and qty are exclusive" };

export const addLineBody = addLineObject
  .refine(weightOrQty, WEIGHT_OR_QTY)
  .refine(uscitaOrSegue, USCITA_OR_SEGUE);

const EDITABLE = ["qty", "weightG", "course", "uscita", "segue", "note", "isShared"] as const;

export const updateLineBody = z
  .strictObject({
    clientUpdatedAt,
    qty: qty.optional(),
    weightG: weightG.optional(),
    course: course.optional(),
    uscita: uscita.optional(),
    segue: z.boolean().optional(),
    note: note.optional(),
    isShared: z.boolean().optional(),
  })
  .refine((body) => EDITABLE.some((key) => body[key] !== undefined), {
    message: "nothing to change",
  })
  .refine(weightOrQty, WEIGHT_OR_QTY)
  .refine(uscitaOrSegue, USCITA_OR_SEGUE);

export const removeLineBody = z.strictObject({ clientUpdatedAt });

export type AddLineBody = z.infer<typeof addLineBody>;
export type UpdateLineBody = z.infer<typeof updateLineBody>;
export type RemoveLineBody = z.infer<typeof removeLineBody>;

// M19: the client names the lines it shows, so a replay of a fire is exact (the server never computes "all drafts of the course").
export const fireBody = z.strictObject({
  lineIds: z
    .array(z.uuid())
    .min(1)
    .max(MAX_FIRE_LINES)
    .refine((ids) => new Set(ids).size === ids.length, { message: "duplicate ids" }),
  /** Comanda per uscita: keep the later uscite of this send waiting for their call (absent = false: fire and call, as an old bundle). */
  hold: z.boolean().optional(),
});

/** POST /api/table-sessions/:id/call: "Via la n", an uscita from 2 to 9 (the 1st and the drinks are never held). */
export const callBody = z.strictObject({ uscita: z.number().int().min(HELD_FROM).max(USCITA_MAX) });

/** `entry_removed` is M18's internal reason for "Rimuovi" and is not accepted here. */
export const voidBody = z.strictObject({ reason: z.enum(VOID_REASONS), clientUpdatedAt });

export type FireBody = z.infer<typeof fireBody>;
export type VoidBody = z.infer<typeof voidBody>;
export type CallBody = z.infer<typeof callBody>;
