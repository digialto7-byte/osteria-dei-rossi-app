import type { SupabaseClient } from "@supabase/supabase-js";
import { getPayableDetail } from "./detail";
import { mapPayableDbError } from "./errors";
import type { PatchPayableBody } from "./schemas";
import type { PayableDetail } from "./types";

/**
 * One call of public.set_payable_status (it checks the role, the transition and the paid date, and
 * writes the audit row), then the payable re-read through payable_detail so the screen shows what
 * the database now holds. `changed` is false for a repeated request (a double tap).
 */
export async function setPayableStatus(
  supabase: SupabaseClient,
  id: string,
  body: PatchPayableBody,
): Promise<{ payable: PayableDetail["payable"]; changed: boolean }> {
  const { data, error } = await supabase.rpc("set_payable_status", {
    p_payable: id,
    p_status: body.status,
    p_paid_on: body.paidOn ?? null,
    p_reason: body.reason ?? null,
    p_reversal: body.reversal ?? false,
  });
  if (error) throw mapPayableDbError(error);
  const detail = await getPayableDetail(supabase, id);
  return { payable: detail.payable, changed: (data as { changed: boolean }).changed };
}
