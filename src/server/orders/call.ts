import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api/errors";
import { t } from "@/lib/i18n";
import { mapOrderDbError } from "./errors";
import { callResult, type CallConflict } from "./output";
import type { CallBody } from "./schemas";

/**
 * POST /api/table-sessions/:id/call: "Via la n" (comanda per uscita, plan §3.6). One RPC, one transaction: it records the call once.
 * The same caller again answers `changed: false`; another caller gets a 409 `conflict` with `already_called` and the instant; when no dish
 * of that uscita is waiting the 409 says `nothing_waiting`. The reply lines are the waiter-safe order lines (a sale price, never a cost).
 */
export async function callUscita(supabase: SupabaseClient, sessionId: string, body: CallBody) {
  const { data, error } = await supabase.rpc("call_uscita", { p_session: sessionId, p_body: body });
  if (error) throw mapOrderDbError(error);
  const result = callResult.parse(data);
  if ("conflict" in result) throw callConflictError(result.conflict);
  return result;
}

/** The 409 of a call conflict: the reason, the uscita and (already_called) when it was called. */
export function callConflictError(conflict: CallConflict): ApiError {
  const message =
    conflict.reason === "already_called"
      ? t("orderError.call_already_called", { n: conflict.uscita })
      : t("orderError.call_nothing_waiting", { n: conflict.uscita });
  return new ApiError(409, "conflict", message, conflict);
}
