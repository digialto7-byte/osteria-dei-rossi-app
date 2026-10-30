import { z } from "zod";
import type { ErrorDetails } from "@/lib/api/errors";
import { ApiError } from "@/lib/api/errors";
import { t } from "@/lib/i18n";
import type { DbError } from "@/server/master/db-errors";
import { mapOrderDbError } from "@/server/orders/errors";
import {
  addLineOutput,
  conflictDetails,
  fireOutput,
  lineWriteOutput,
} from "@/server/orders/output";
import { alreadyOpenSessionId, mapTablesDbError } from "@/server/tables/errors";
import { openTableOutput } from "@/server/tables/output";
import type { SyncKind } from "./constants";
import { SYNC_CONFLICT_CODES } from "./constants";
import { opResult, storedResult, type OpResult, type StoredResult } from "./output";

// Turns what public.apply_op returned for one op into the strict, waiter-safe result of POST /api/sync (M20 plan §3.5). The
// database reply is parsed with the existing strict output of each kind, so a cost key throws (a 500) and never reaches the phone.
// Refusals go through the existing order/table error mappings (Italian messages); a code nobody knows becomes `rejected_unknown`
// so the queue never blocks on it.

const stored = z.object({
  status: z.enum(["applied", "conflict", "rejected"]),
  receivedAt: z.string(),
  result: z.unknown(),
});
const fresh = stored.extend({ opId: z.uuid(), stop: z.boolean() });
const duplicate = z.object({
  opId: z.uuid(),
  status: z.literal("duplicate"),
  stop: z.boolean(),
  stored,
});
const rawReply = z.union([duplicate, fresh]);

const rejection = z.object({
  sqlstate: z.string(),
  message: z.string(),
  detail: z.unknown().nullable().optional(),
});

const REPLY_OF = {
  open_table: openTableOutput,
  add_line: addLineOutput,
  edit_line: lineWriteOutput,
  remove_line: lineWriteOutput,
  fire: fireOutput,
  void_line: lineWriteOutput,
} satisfies Record<SyncKind, z.ZodType>;

const CONFLICT_WRAPPER = z.object({ conflict: conflictDetails });

function dbErrorOf(kind: SyncKind, raw: z.infer<typeof rejection>): DbError {
  return {
    code: raw.sqlstate,
    message: raw.message,
    details: raw.detail === null || raw.detail === undefined ? null : JSON.stringify(raw.detail),
  };
}

function errorOf(kind: SyncKind, raw: z.infer<typeof rejection>) {
  const db = dbErrorOf(kind, raw);
  const mapped = kind === "open_table" ? mapTablesDbError(db) : mapOrderDbError(db);
  if (mapped instanceof ApiError) {
    return {
      httpStatus: mapped.status,
      code: mapped.code as string,
      message: mapped.message,
      ...(mapped.details ? { details: mapped.details satisfies ErrorDetails } : {}),
    };
  }
  return { httpStatus: 422, code: "rejected_unknown", message: t("syncError.rejected_unknown") };
}

/** The result of one decided op, without the op id and kind. */
function storedOf(kind: SyncKind, s: z.infer<typeof stored>): StoredResult {
  if (s.status === "applied") {
    return storedResult.parse({
      status: "applied",
      receivedAt: s.receivedAt,
      reply: REPLY_OF[kind].parse(s.result),
    });
  }
  if (s.status === "conflict") {
    const wrapped = CONFLICT_WRAPPER.safeParse(s.result);
    if (wrapped.success) {
      return storedResult.parse({
        status: "conflict",
        receivedAt: s.receivedAt,
        conflict: wrapped.data.conflict,
      });
    }
    const raised = rejection.parse(s.result);
    const reason = SYNC_CONFLICT_CODES.find((code) => code === raised.message);
    if (!reason) throw new Error("Unexpected conflict reply");
    const sessionId =
      reason === "table_already_open"
        ? alreadyOpenSessionId(raised.detail == null ? null : JSON.stringify(raised.detail))
        : undefined;
    return storedResult.parse({
      status: "conflict",
      receivedAt: s.receivedAt,
      conflict: sessionId ? { reason, sessionId } : { reason },
    });
  }
  return storedResult.parse({
    status: "rejected",
    receivedAt: s.receivedAt,
    error: errorOf(kind, rejection.parse(s.result)),
  });
}

/**
 * One apply_op reply -> the result for the phone, plus whether the batch stops after it (the database's `stop` flag: an
 * `open_table` or `add_line` that did not apply, so its session or line does not exist). Throws on anything malformed.
 */
export function toOpResult(kind: SyncKind, raw: unknown): { result: OpResult; stop: boolean } {
  const reply = rawReply.parse(raw);
  if ("stored" in reply) {
    return {
      result: opResult.parse({
        opId: reply.opId,
        kind,
        status: "duplicate",
        stored: storedOf(kind, reply.stored),
      }),
      stop: reply.stop,
    };
  }
  return {
    result: opResult.parse({ opId: reply.opId, kind, ...storedOf(kind, reply) }),
    stop: reply.stop,
  };
}
