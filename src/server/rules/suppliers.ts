import type { SupabaseClient } from "@supabase/supabase-js";
import { mapRulesDbError } from "./errors";
import { supplierRulesChange, supplierRulesPatchResponse, supplierRulesResponse } from "./output";
import type { SupplierRulesBody } from "./schemas";

/** GET /api/rules/suppliers: delivery days, lead time, cut-off and the next window, as Postgres computed them. */
export async function listSupplierRules(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("rules_suppliers");
  if (error) throw mapRulesDbError(error);
  return supplierRulesResponse.parse(data);
}

/** PATCH /api/rules/suppliers: one audited procedure call, then a read for the item with its new window. */
export async function setSupplierRules(supabase: SupabaseClient, body: SupplierRulesBody) {
  const { supplierId, ...patch } = body;
  const { data, error } = await supabase.rpc("set_supplier_delivery", {
    p_supplier: supplierId,
    p_patch: patch,
  });
  if (error) throw mapRulesDbError(error);
  const change = supplierRulesChange.parse(data);
  const read = await listSupplierRules(supabase);
  return supplierRulesPatchResponse.parse({
    supplierId: change.supplierId,
    changed: change.changed,
    item: read.items.find((item) => item.supplierId === change.supplierId) ?? null,
  });
}
