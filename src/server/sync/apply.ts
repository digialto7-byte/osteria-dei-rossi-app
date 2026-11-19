import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api/errors";
import { t } from "@/lib/i18n";
import type { SyncKind, SyncVersion } from "./constants";
import { syncOutput, type OpResult, type SyncOutput } from "./output";
import { syncOutputV1, type SyncOutputV1 } from "./output-v1";
import { toOpResult } from "./results";
import { PAYLOADS, type OpEnvelope } from "./schemas";

// POST /api/sync (M20 plan §3.1.6, §3.5): the ops go to public.apply_op one RPC (one transaction) per op, in order. The database
// decides conflicts and refusals; this loop only decides when to stop:
//   user_mismatch  apply_op refused the op because it names another user;
//   unavailable    the RPC failed for infrastructure reasons (nothing of that op was stored: the phone retries it later);
//   dead_entity    an open_table or add_line did not apply, so its session or line does not exist and later ops may name it.
// Other conflicts and refusals do not stop the batch.

/** Kinds whose failure leaves a session or line that later ops may name. */
const CREATES: readonly SyncKind[] = ["open_table", "add_line"];

function rejectedWithoutRpc(op: OpEnvelope): OpResult {
  return {
    opId: op.opId,
    kind: op.kind,
    status: "rejected",
    receivedAt: null,
    error: { httpStatus: 400, code: "invalid_request", message: t("syncError.invalid_request") },
  };
}

type Called =
  | { reply: unknown }
  | { failure: "user_mismatch" | "unavailable" }
  | { refused: "op_id_reused" | "invalid_request" };

/** Refusals the database will give again for the same op: they are the op's own result, not an outage (a retry would loop forever). */
function refusalOf(op: OpEnvelope, kind: "op_id_reused" | "invalid_request"): OpResult {
  return {
    opId: op.opId,
    kind: op.kind,
    status: "rejected",
    receivedAt: null,
    error:
      kind === "op_id_reused"
        ? { httpStatus: 409, code: "op_id_reused", message: t("syncError.op_id_reused") }
        : { httpStatus: 400, code: "invalid_request", message: t("syncError.invalid_request") },
  };
}

async function callApplyOp(supabase: SupabaseClient, op: OpEnvelope): Promise<Called> {
  try {
    const { data, error } = await supabase.rpc("apply_op", { p_op: op });
    if (!error) return { reply: data };
    if (error.code === "P0001" && error.message === "op_id_reused")
      return { refused: "op_id_reused" };
    if (error.code === "22023") return { refused: "invalid_request" };
    return {
      failure:
        error.code === "42501" && error.message === "user_mismatch"
          ? "user_mismatch"
          : "unavailable",
    };
  } catch {
    return { failure: "unavailable" };
  }
}

/** The conflict reasons a version-1 bundle does not know: it shows its generic "changed by someone else" notice and refetches. */
const V1_STALE = new Set(["held", "uscita_called", "already_called", "nothing_waiting"]);

function withoutUscita(line: unknown): unknown {
  if (!line || typeof line !== "object") return line;
  const { uscita: _uscita, ...rest } = line as Record<string, unknown>;
  return rest;
}

function downReply(reply: Record<string, unknown>): Record<string, unknown> {
  const r = { ...reply };
  if ("line" in r) r.line = withoutUscita(r.line);
  if (Array.isArray(r.lines)) r.lines = r.lines.map(withoutUscita);
  delete r.held;
  return r;
}

function downStored<T extends Record<string, unknown>>(stored: T): T {
  if (stored.status === "applied") {
    return { ...stored, reply: downReply(stored.reply as Record<string, unknown>) };
  }
  if (stored.status === "conflict") {
    const c = { ...(stored.conflict as Record<string, unknown>) };
    if (V1_STALE.has(String(c.reason))) c.reason = "stale";
    delete c.uscita;
    delete c.calledAt;
    if ("line" in c) c.line = withoutUscita(c.line);
    return { ...stored, conflict: c };
  }
  return stored;
}

/**
 * Comanda per uscita (plan §3.12 "Versions"): today's results in the shape a version-1 bundle parses (src/server/sync/output-v1.ts): lines
 * lose uscita, a fire reply loses held, and the conflict reasons it does not know become stale.
 */
export function downShape(output: SyncOutput): SyncOutputV1 {
  return syncOutputV1.parse({
    ...output,
    results: output.results.map((r) =>
      r.status === "duplicate"
        ? { ...r, stored: downStored(r.stored as Record<string, unknown>) }
        : downStored(r as unknown as Record<string, unknown>),
    ),
  });
}

/**
 * Applies 1 to 20 ops in order. Throws a 503 when the very first op could not be tried at all. A version-1 request (an old bundle) gets
 * its results down-shaped, and cannot send call_uscita (400 before any RPC).
 */
export async function applyOps(
  supabase: SupabaseClient,
  ops: readonly OpEnvelope[],
  version: SyncVersion = 2,
): Promise<SyncOutput | SyncOutputV1> {
  if (version === 1 && ops.some((op) => op.kind === "call_uscita")) {
    throw new ApiError(400, "invalid_request", t("syncError.invalid_request"));
  }
  const results: OpResult[] = [];
  let stopped: SyncOutput["stopped"] = null;

  for (const op of ops) {
    if (!PAYLOADS[op.kind].safeParse(op.payload).success) {
      results.push(rejectedWithoutRpc(op));
      if (CREATES.includes(op.kind)) {
        stopped = { opId: op.opId, reason: "dead_entity" };
        break;
      }
      continue;
    }
    const called = await callApplyOp(supabase, op);
    if ("refused" in called) {
      results.push(refusalOf(op, called.refused));
      if (CREATES.includes(op.kind)) {
        stopped = { opId: op.opId, reason: "dead_entity" };
        break;
      }
      continue;
    }
    if ("failure" in called) {
      if (called.failure === "unavailable" && results.length === 0) {
        throw new ApiError(503, "sync_unavailable", t("syncError.sync_unavailable"));
      }
      stopped = { opId: op.opId, reason: called.failure };
      break;
    }
    // A reply that does not parse (a cost key, a shape nobody knows) throws: the route answers 500 and nothing leaks.
    const { result, stop } = toOpResult(op.kind, called.reply);
    results.push(result);
    if (stop) {
      stopped = { opId: op.opId, reason: "dead_entity" };
      break;
    }
  }

  const output = syncOutput.parse({ results, stopped, serverTime: new Date().toISOString() });
  return version === 1 ? downShape(output) : output;
}
