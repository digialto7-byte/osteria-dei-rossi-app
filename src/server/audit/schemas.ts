import { z } from "zod";
import { parseQuery, readCursor, type TimeCursor } from "@/server/counts/schemas";

export const AUDIT_KINDS = ["all", "stock", "events"] as const;

const auditQuery = z.strictObject({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  kind: z.enum(AUDIT_KINDS).optional(),
  before: z.string().max(80).optional(),
});

/** `?from`, `?to` (ISO dates; the service applies the Rome month by default), `?kind=all|stock|events`, `?before=`. */
export function parseAuditQuery(url: URL): {
  from: string | null;
  to: string | null;
  kind: (typeof AUDIT_KINDS)[number];
  before: TimeCursor | null;
} {
  const query = parseQuery(auditQuery, url);
  return {
    from: query.from ?? null,
    to: query.to ?? null,
    kind: query.kind ?? "all",
    before: readCursor(query.before),
  };
}
