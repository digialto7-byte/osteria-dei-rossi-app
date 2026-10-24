import type { SupabaseClient } from "@supabase/supabase-js";
import type { TimeCursor } from "@/server/counts/schemas";
import { AUDIT_PAGE_SIZE } from "./constants";
import { mapAuditDbError } from "./errors";
import { auditResponse } from "./output";
import type { AuditEntry } from "./types";

interface AuditRpc {
  from: string;
  to: string;
  entries: AuditEntry[];
  nextCursor: { at: string; id: string } | null;
}

/**
 * GET /api/audit: the activity log, newest first, for owner and admin only (the route refuses the others before
 * this runs; public.audit_log refuses them again with 42501). Without dates the database applies the Rome month so
 * far. No `before`, `after`, free text or cost is returned.
 */
export async function getAuditLog(
  supabase: SupabaseClient,
  query: { from: string | null; to: string | null; kind: string; before: TimeCursor | null },
) {
  const { data, error } = await supabase.rpc("audit_log", {
    p_from: query.from,
    p_to: query.to,
    p_kind: query.kind,
    p_before_at: query.before?.at ?? null,
    p_before_id: query.before?.id ?? null,
    p_limit: AUDIT_PAGE_SIZE,
  });
  if (error) throw mapAuditDbError(error);
  const result = data as AuditRpc;
  return auditResponse.parse({
    from: result.from,
    to: result.to,
    entries: result.entries.map((e) => ({
      id: e.id,
      at: e.at,
      byName: e.byName ?? null,
      kind: e.kind,
      action: e.action,
      ingredientId: e.ingredientId,
      ingredientName: e.ingredientName,
      qty: e.qty,
      unit: e.unit,
      reasonCode: e.reasonCode,
      locationNames: e.locationNames,
      entityType: e.entityType,
      entityId: e.entityId,
      entityLabel: e.entityLabel,
    })),
    nextCursor: result.nextCursor ? `${result.nextCursor.at}_${result.nextCursor.id}` : null,
  });
}
