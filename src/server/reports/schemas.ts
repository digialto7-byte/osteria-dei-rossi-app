import { z } from "zod";
import { PERIODS } from "./constants";

// Strict inputs of the report endpoints (M22 plan §3.5). The SQL stays the authority (range, future dates, period rules); the schemas only
// turn the obvious mistakes into a 400 before any RPC.

/** `?period=day|week|month|custom&date=` (the anchor) or `&from=&to=` (custom only). The default anchor, yesterday's business date, is the SQL's. */
export const periodQuery = z
  .strictObject({
    period: z.enum(PERIODS).default("day"),
    date: z.iso.date().optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  })
  .refine(
    (q) =>
      q.period === "custom"
        ? q.from !== undefined && q.to !== undefined
        : q.from === undefined && q.to === undefined,
    "custom_needs_from_to",
  );

/** `?count=<uuid>`: the closing monthly count; absent means the latest closed one. */
export const avtQuery = z.strictObject({ count: z.uuid().optional() });

/** `?week=<any date of the ISO week>`; absent means the current week. */
export const unmappedQuery = z.strictObject({ week: z.iso.date().optional() });

export type PeriodQuery = z.infer<typeof periodQuery>;
export type AvtQuery = z.infer<typeof avtQuery>;
export type UnmappedQuery = z.infer<typeof unmappedQuery>;
