import { z } from "zod";

// Strict inputs of the trace endpoints (P2-2 plan §3.7). The SQL stays the authority (range, future dates, lengths); the schemas turn the obvious
// mistakes into a 400 before any RPC. A malformed `[id]` is a 404 in withApi (idParams), also before any RPC.

/** `?q=` and/or `?ingredientId=` and/or `?supplierId=` (at least one), with an optional `from`/`to` range. */
export const traceLotsQuery = z
  .strictObject({
    q: z.string().trim().min(1).max(64).optional(),
    ingredientId: z.uuid().optional(),
    supplierId: z.uuid().optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  })
  .refine((v) => v.q !== undefined || v.ingredientId !== undefined || v.supplierId !== undefined, {
    message: "a code, an ingredient or a supplier is needed",
  });

/** `?from=&to=`, both optional (the SQL defaults to the last 30 days). */
export const traceCaptureQuery = z.strictObject({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

/** `?date=` (required) and an optional `menuItemId`. */
export const traceLinesQuery = z.strictObject({
  date: z.iso.date(),
  menuItemId: z.uuid().optional(),
});

export type TraceLotsQuery = z.infer<typeof traceLotsQuery>;
export type TraceCaptureQuery = z.infer<typeof traceCaptureQuery>;
export type TraceLinesQuery = z.infer<typeof traceLinesQuery>;
