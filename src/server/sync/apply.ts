import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api/errors";
import { t } from "@/lib/i18n";
import type { SyncKind } from "./constants";
import { syncOutput, type OpResult, type SyncOutput } from "./output";
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

type Called = { reply: unknown } | { failure: "user_mismatch" | "unavailable" };

async function callApplyOp(supabase: SupabaseClient, op: OpEnvelope): Promise<Called> {
  try {
    const { data, error } = await supabase.rpc("apply_op", { p_op: op });
    if (!error) return { reply: data };
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

/** Applies 1 to 20 ops in order. Throws a 503 when the very first op could not be tried at all. */
export async function applyOps(
  supabase: SupabaseClient,
  ops: readonly OpEnvelope[],
): Promise<SyncOutput> {
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

  return syncOutput.parse({ results, stopped, serverTime: new Date().toISOString() });
}
