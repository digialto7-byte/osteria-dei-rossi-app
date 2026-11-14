import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppRole } from "@/lib/api/with-api";
import { failRead, parseRead } from "./errors";
import { traceLotChefOutput, traceLotOutput } from "./output";

/** GET /api/trace/lots/:id: the forward trace. The strict schema is the CALLER's role's: only owner and admin may carry `invoice` and `purchase`. */
export async function getLotTrace(supabase: SupabaseClient, role: AppRole, id: string) {
  const { data, error } = await supabase.rpc("trace_lot", { p_lot: id });
  if (error) failRead("trace_lot", error);
  return parseRead("trace_lot", role === "chef" ? traceLotChefOutput : traceLotOutput, data);
}
