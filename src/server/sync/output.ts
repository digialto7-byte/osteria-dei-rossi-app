import { z } from "zod";
import {
  addLineOutput,
  CONFLICT_REASONS,
  fireOutput,
  lineWriteOutput,
  orderLine,
} from "@/server/orders/output";
import { openTableOutput } from "@/server/tables/output";
import { SYNC_KINDS } from "./constants";

// Strict output of POST /api/sync (M20 plan §3.5). Every `applied` reply is one of the existing strict order/table outputs, so a
// key that is not declared (a cost that slipped into an RPC reply) fails the parse: a 500, never a leak. There is no cost, margin,
// VAT or recipe key anywhere. The shape is snapshot-tested.

const opError = z.strictObject({
  httpStatus: z.number().int(),
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});

export const SYNC_CONFLICT_REASONS = [...CONFLICT_REASONS, "table_already_open"] as const;

const syncConflict = z.strictObject({
  reason: z.enum(SYNC_CONFLICT_REASONS),
  line: orderLine.optional(),
  sessionId: z.uuid().optional(),
});

const appliedReply = z.union([openTableOutput, addLineOutput, lineWriteOutput, fireOutput]);

const applied = z.strictObject({
  status: z.literal("applied"),
  receivedAt: z.string(),
  reply: appliedReply,
});
const conflict = z.strictObject({
  status: z.literal("conflict"),
  receivedAt: z.string(),
  conflict: syncConflict,
});
// null when the op was refused before any RPC (its payload did not match its kind).
const rejected = z.strictObject({
  status: z.literal("rejected"),
  receivedAt: z.string().nullable(),
  error: opError,
});

/** What the database stored for a decided op, without the op id and kind (a `duplicate` wraps it). */
export const storedResult = z.discriminatedUnion("status", [applied, conflict, rejected]);

const head = { opId: z.uuid(), kind: z.enum(SYNC_KINDS) };

export const opResult = z.discriminatedUnion("status", [
  applied.extend(head),
  conflict.extend(head),
  rejected.extend(head),
  z.strictObject({ ...head, status: z.literal("duplicate"), stored: storedResult }),
]);

export const STOP_REASONS = ["dead_entity", "unavailable", "user_mismatch"] as const;

export const syncOutput = z.strictObject({
  results: z.array(opResult),
  stopped: z.strictObject({ opId: z.uuid(), reason: z.enum(STOP_REASONS) }).nullable(),
  serverTime: z.string(),
});

export type OpResult = z.infer<typeof opResult>;
export type OpError = z.infer<typeof opError>;
export type SyncConflict = z.infer<typeof syncConflict>;
export type StoredResult = z.infer<typeof storedResult>;
export type SyncOutput = z.infer<typeof syncOutput>;
export type StopReason = (typeof STOP_REASONS)[number];
