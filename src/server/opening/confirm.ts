import type { SupabaseClient } from "@supabase/supabase-js";
import { mapOpeningDbError } from "./errors";
import { confirmResponse } from "./output";
import type { ConfirmBody } from "./schemas";

/**
 * POST /api/stock/opening/confirm: books one location's draft (plan 2026-11-18 §3.5). post_opening_stock does everything in one
 * transaction and is idempotent on requestId: a replay answers `changed: false` (200), a booking `changed: true` (201).
 */
export async function confirmOpening(supabase: SupabaseClient, body: ConfirmBody) {
  const { data, error } = await supabase.rpc("post_opening_stock", {
    p_location: body.locationId,
    p_effective_on: body.effectiveOn,
    p_request_id: body.requestId,
    p_lines: body.lines,
  });
  if (error) throw mapOpeningDbError(error);
  return confirmResponse.parse(data);
}
