import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppRole } from "@/lib/api/with-api";
import { failRead, parseRead } from "./errors";
import { traceBatchChefOutput, traceBatchOutput } from "./output";

/** GET /api/trace/batches/:id: the backward trace of a batch (a split child shows its root's inputs). */
export async function getBatchTrace(supabase: SupabaseClient, role: AppRole, id: string) {
  const { data, error } = await supabase.rpc("trace_batch", { p_batch: id });
  if (error) failRead("trace_batch", error);
  return parseRead("trace_batch", role === "chef" ? traceBatchChefOutput : traceBatchOutput, data);
}
