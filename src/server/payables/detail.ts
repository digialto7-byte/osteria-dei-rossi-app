import type { SupabaseClient } from "@supabase/supabase-js";
import { mapPayableDbError } from "./errors";
import type { PayableDetail } from "./types";

export async function getPayableDetail(
  supabase: SupabaseClient,
  id: string,
): Promise<PayableDetail> {
  const { data, error } = await supabase.rpc("payable_detail", { p_payable: id });
  if (error) throw mapPayableDbError(error);
  return data as PayableDetail;
}
