import type { SupabaseClient } from "@supabase/supabase-js";
import { mapOpeningDbError } from "./errors";
import { draftPutResponse, draftResponse, removedResponse } from "./output";
import type { DraftPutBody } from "./schemas";

// The draft of the opening stock (plan 2026-11-18 §3.4): one RPC per call; the procedures check roles, tenant, cut-off and bounds.

/** GET /api/stock/opening/draft: the state of the screen. */
export async function getOpeningDraft(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("opening_draft", {});
  if (error) throw mapOpeningDbError(error);
  return draftResponse.parse(data);
}

/** PUT /api/stock/opening/draft/lines: upserts 1..200 lines by their client ids. */
export async function putOpeningDraftLines(supabase: SupabaseClient, body: DraftPutBody) {
  const { data, error } = await supabase.rpc("opening_draft_put", { p_lines: body.lines });
  if (error) throw mapOpeningDbError(error);
  return draftPutResponse.parse(data);
}

/** DELETE /api/stock/opening/draft/lines/:id: removing an unknown id is not an error. */
export async function removeOpeningDraftLine(supabase: SupabaseClient, id: string) {
  const { data, error } = await supabase.rpc("opening_draft_remove", { p_ids: [id] });
  if (error) throw mapOpeningDbError(error);
  return removedResponse.parse(data);
}

/** DELETE /api/stock/opening/draft?locationId=: "Svuota la bozza". */
export async function clearOpeningDraft(supabase: SupabaseClient, locationId: string) {
  const { data, error } = await supabase.rpc("opening_draft_clear", { p_location: locationId });
  if (error) throw mapOpeningDbError(error);
  return removedResponse.parse(data);
}
