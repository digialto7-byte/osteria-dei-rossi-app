import type { BaseUnit } from "@/server/stock/types";

/** One entry of the activity log (public.audit_log). No `before`, `after`, free text or cost is ever returned. */
export interface AuditEntry {
  id: string;
  at: string;
  byName: string | null;
  kind: "stock" | "event";
  action: string;
  ingredientId?: string;
  ingredientName?: string;
  /** Net quantity of the operation (for a transfer: the quantity moved), in the ingredient's base unit. */
  qty?: number;
  unit?: BaseUnit;
  reasonCode?: string;
  locationNames?: string[];
  entityType?: string;
  entityId?: string;
  entityLabel?: string;
}

export interface AuditLog {
  from: string;
  to: string;
  entries: AuditEntry[];
  nextCursor: string | null;
}
