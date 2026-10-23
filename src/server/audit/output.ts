import { z } from "zod";

// Strict output schema of GET /api/audit (M13 plan §3.4). The service builds each entry field by field and parses it
// here: `before`, `after`, a free-text reason or any cost can never reach the JSON.
const entry = z.strictObject({
  id: z.uuid(),
  at: z.string(),
  byName: z.string().nullable(),
  kind: z.enum(["stock", "event"]),
  action: z.string(),
  ingredientId: z.uuid().optional(),
  ingredientName: z.string().optional(),
  qty: z.number().optional(),
  unit: z.enum(["kg", "l", "pz"]).optional(),
  reasonCode: z.string().optional(),
  locationNames: z.array(z.string()).optional(),
  entityType: z.string().optional(),
  entityId: z.uuid().optional(),
  entityLabel: z.string().optional(),
});

export const auditResponse = z.strictObject({
  from: z.string(),
  to: z.string(),
  entries: z.array(entry),
  nextCursor: z.string().nullable(),
});
