import { z } from "zod";
import { COURSES, MAX_FIRE_LINES, MAX_QTY, MIN_QTY, NOTE_MAX, VOID_REASONS } from "./constants";

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

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** Trimmed, at most 140 characters, no control characters; blank or null clears the note (the database stores null). */
export const note = z
  .string()
  .refine((value) => value.trim().length <= NOTE_MAX, { message: "too long" })
  .refine((value) => !CONTROL.test(value), { message: "control characters" })
  .nullable();

const course = z.enum(COURSES);

export const addLineBody = z.strictObject({
  lineId: z.uuid(),
  menuItemId: z.uuid(),
  clientUpdatedAt,
  qty: qty.optional(),
  course: course.optional(),
  segue: z.boolean().optional(),
  note: note.optional(),
  isShared: z.boolean().optional(),
});

const EDITABLE = ["qty", "course", "segue", "note", "isShared"] as const;

export const updateLineBody = z
  .strictObject({
    clientUpdatedAt,
    qty: qty.optional(),
    course: course.optional(),
    segue: z.boolean().optional(),
    note: note.optional(),
    isShared: z.boolean().optional(),
  })
  .refine((body) => EDITABLE.some((key) => body[key] !== undefined), {
    message: "nothing to change",
  });

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
});

/** `entry_removed` is M18's internal reason for "Rimuovi" and is not accepted here. */
export const voidBody = z.strictObject({ reason: z.enum(VOID_REASONS), clientUpdatedAt });

export type FireBody = z.infer<typeof fireBody>;
export type VoidBody = z.infer<typeof voidBody>;
