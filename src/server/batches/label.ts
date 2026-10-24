import type { SupabaseClient } from "@supabase/supabase-js";
import { mapBatchDbError } from "./errors";
import { batchLabel } from "./output";
import type { BatchLabel } from "./types";

/** GET /api/batches/:id/label: the label text of a batch (PRD 2.2). No cost; a foreign or unknown id is a 404. */
export async function getLabel(supabase: SupabaseClient, batchId: string) {
  const { data, error } = await supabase.rpc("batch_label", { p_batch: batchId });
  if (error) throw mapBatchDbError(error);
  const l = data as BatchLabel;
  return batchLabel.parse({
    batchId: l.batchId,
    recipeName: l.recipeName,
    version: l.version,
    producedAt: l.producedAt,
    useBy: l.useBy,
    portions: l.portions,
    lotCode: l.lotCode,
    operatorInitials: l.operatorInitials,
    shelfLifeHours: l.shelfLifeHours,
    portionsRemaining: l.portionsRemaining,
    splitFrom: l.splitFrom ? { lotCode: l.splitFrom.lotCode } : null,
  });
}
