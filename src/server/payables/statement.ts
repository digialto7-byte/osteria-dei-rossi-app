import type { SupabaseClient } from "@supabase/supabase-js";
import { mapPayableDbError } from "./errors";
import type { SupplierStatement } from "./types";

/** The unpaid invoices of one supplier with their frozen credits (M9 plan §3.1.8). */
export async function getSupplierStatement(
  supabase: SupabaseClient,
  supplierId: string,
): Promise<SupplierStatement> {
  const { data, error } = await supabase.rpc("supplier_statement", { p_supplier: supplierId });
  if (error) throw mapPayableDbError(error);
  return data as SupplierStatement;
}
