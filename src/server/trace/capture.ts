import type { SupabaseClient } from "@supabase/supabase-js";
import { failRead, parseRead } from "./errors";
import { lotCaptureOutput } from "./output";
import type { TraceCaptureQuery } from "./schemas";

/** GET /api/trace/capture: how many deliveries of the range carry a lot code, per supplier. */
export async function getLotCapture(supabase: SupabaseClient, query: TraceCaptureQuery) {
  const { data, error } = await supabase.rpc("lot_capture", {
    p_from: query.from ?? null,
    p_to: query.to ?? null,
  });
  if (error) failRead("lot_capture", error);
  return parseRead("lot_capture", lotCaptureOutput, data);
}
