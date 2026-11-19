import { z } from "zod";
import { COURSES, VOID_REASONS } from "@/server/orders/constants";
import {
  addLineObject,
  callBody,
  clientUpdatedAt,
  fireBody,
  note,
  qty,
  uscita,
  weightG,
  weightOrQty,
} from "@/server/orders/schemas";
import { openTableBody } from "@/server/tables/schemas";
import { MAX_SYNC_OPS, SYNC_KINDS, type SyncKind } from "./constants";

// The wire format of POST /api/sync (M20 plan §3.1.2, §3.5). The payloads reuse the M17/M18/M19 schemas minus the stamp: the
// stamp of a line write is the op's `clientTs`, and a `clientUpdatedAt` inside a payload is refused. The database stays the
// authority; these schemas turn the obvious mistakes into a result before any RPC.

/** uscita replaces the legacy segue: a payload names one or the other (the database answers 22023 otherwise). */
const uscitaOrSegue = (body: { uscita?: number | undefined; segue?: boolean | undefined }) =>
  body.uscita === undefined || body.segue === undefined;

const addPayload = addLineObject
  .omit({ clientUpdatedAt: true })
  .extend({ sessionId: z.uuid() })
  .refine(weightOrQty, { message: "weight and qty are exclusive" })
  .refine(uscitaOrSegue, { message: "uscita and segue are exclusive" });

const EDITABLE = ["qty", "weightG", "course", "uscita", "segue", "note", "isShared"] as const;
const editPayload = z
  .strictObject({
    lineId: z.uuid(),
    qty: qty.optional(),
    weightG: weightG.optional(),
    course: z.enum(COURSES).optional(),
    uscita: uscita.optional(),
    segue: z.boolean().optional(),
    note: note.optional(),
    isShared: z.boolean().optional(),
  })
  .refine((body) => EDITABLE.some((key) => body[key] !== undefined), {
    message: "nothing to change",
  })
  .refine(weightOrQty, { message: "weight and qty are exclusive" })
  .refine(uscitaOrSegue, { message: "uscita and segue are exclusive" });

const removePayload = z.strictObject({ lineId: z.uuid() });
const firePayload = fireBody.extend({ sessionId: z.uuid() });
const voidPayload = z.strictObject({ lineId: z.uuid(), reason: z.enum(VOID_REASONS) });
const openPayload = openTableBody.extend({ tableId: z.uuid() });
const callPayload = callBody.extend({ sessionId: z.uuid() });

/** The payload schema of each kind. */
export const PAYLOADS = {
  open_table: openPayload,
  add_line: addPayload,
  edit_line: editPayload,
  remove_line: removePayload,
  fire: firePayload,
  void_line: voidPayload,
  call_uscita: callPayload,
} satisfies Record<SyncKind, z.ZodType>;

export const opEnvelope = z.strictObject({
  opId: z.uuid(),
  seq: z.number().int().min(1),
  kind: z.enum(SYNC_KINDS),
  clientTs: clientUpdatedAt,
  userId: z.uuid(),
  // Checked per kind, per op (PAYLOADS), so one bad payload does not fail the whole request.
  payload: z.record(z.string(), z.unknown()),
});

export const syncBody = z
  .strictObject({ ops: z.array(opEnvelope).min(1).max(MAX_SYNC_OPS) })
  .refine((body) => new Set(body.ops.map((op) => op.opId)).size === body.ops.length, {
    message: "duplicate opId",
  })
  .refine((body) => body.ops.every((op, i) => i === 0 || op.seq > body.ops[i - 1]!.seq), {
    message: "seq must increase",
  });

export type OpEnvelope = z.infer<typeof opEnvelope>;
export type SyncBody = z.infer<typeof syncBody>;
