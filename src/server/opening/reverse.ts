import type { SupabaseClient } from "@supabase/supabase-js";
import { mapOpeningDbError } from "./errors";
import { reverseResponse } from "./output";
import type { ReverseBody } from "./schemas";

/** POST /api/stock/opening/:id/reverse: the whole operation, with a reason; its rows go back into the draft (plan 2026-11-18 §3.6). */
export async function reverseOpening(
  supabase: SupabaseClient,
  openingId: string,
  body: ReverseBody,
) {
  const { data, error } = await supabase.rpc("reverse_opening_stock", {
    p_opening: openingId,
    p_reason: body.reason,
  });
  if (error) throw mapOpeningDbError(error);
  return reverseResponse.parse(data);
}
