import { z } from "zod";
import { addLineOutput, fireOutput, lineWriteOutput, orderLine } from "@/server/orders/output";
import { openTableOutput } from "@/server/tables/output";

// Version 1 of the POST /api/sync output (comanda per uscita, plan §3.12 "Versions"): the shape main answered before the feature, which an
// old bundle still running during service parses strictly in the browser (src/pwa/send.ts). Lines have no uscita, a fire reply has no held,
// the conflict reasons are today's, and there is no call reply (version 1 cannot send call_uscita). The committed JSON-Schema snapshot of
// this module is main's snapshot of syncOutput, unchanged (tests/server/sync/output.test.ts): any drift fails it.

const V1_KINDS = [
  "open_table",
  "add_line",
  "edit_line",
  "remove_line",
  "fire",
  "void_line",
] as const;
/** Main's CONFLICT_REASONS, then table_already_open: the comanda-per-uscita reasons reach version 1 as stale. */
const V1_CONFLICT_REASONS = [
  "stale",
  "fired",
  "voided",
  "session_closed",
  "table_already_open",
] as const;

const orderLineV1 = orderLine.omit({ uscita: true });
const addLineOutputV1 = addLineOutput.extend({ line: orderLineV1 });
const lineWriteOutputV1 = lineWriteOutput.extend({ line: orderLineV1 });
const fireOutputV1 = fireOutput.omit({ held: true }).extend({ lines: z.array(orderLineV1) });

const opError = z.strictObject({
  httpStatus: z.number().int(),
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});

const syncConflictV1 = z.strictObject({
  reason: z.enum(V1_CONFLICT_REASONS),
  line: orderLineV1.optional(),
  sessionId: z.uuid().optional(),
});

const appliedReplyV1 = z.union([openTableOutput, addLineOutputV1, lineWriteOutputV1, fireOutputV1]);

const applied = z.strictObject({
  status: z.literal("applied"),
  receivedAt: z.string(),
  reply: appliedReplyV1,
});
const conflict = z.strictObject({
  status: z.literal("conflict"),
  receivedAt: z.string(),
  conflict: syncConflictV1,
});
const rejected = z.strictObject({
  status: z.literal("rejected"),
  receivedAt: z.string().nullable(),
  error: opError,
});

const storedResultV1 = z.discriminatedUnion("status", [applied, conflict, rejected]);
const head = { opId: z.uuid(), kind: z.enum(V1_KINDS) };

const opResultV1 = z.discriminatedUnion("status", [
  applied.extend(head),
  conflict.extend(head),
  rejected.extend(head),
  z.strictObject({ ...head, status: z.literal("duplicate"), stored: storedResultV1 }),
]);

const STOP_REASONS = ["dead_entity", "unavailable", "user_mismatch"] as const;

export const syncOutputV1 = z.strictObject({
  results: z.array(opResultV1),
  stopped: z.strictObject({ opId: z.uuid(), reason: z.enum(STOP_REASONS) }).nullable(),
  serverTime: z.string(),
});

export type SyncOutputV1 = z.infer<typeof syncOutputV1>;
