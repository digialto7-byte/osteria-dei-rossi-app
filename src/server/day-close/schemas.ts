import { z } from "zod";
import { REGISTER_TOTAL } from "./constants";

// Strict inputs of the end-of-day endpoints (M21 plan §3.5). The register total is a decimal STRING so the value stays exact from the
// keyboard to numeric; a JSON number is refused.

const isoDate = z.iso.date();

export const dayCloseBody = z.strictObject({
  businessDate: isoDate.optional(),
  registerTotal: z.string().regex(REGISTER_TOTAL),
});

export const reportQuery = z.strictObject({ date: isoDate.optional() });

export type DayCloseBody = z.infer<typeof dayCloseBody>;
export type ReportQuery = z.infer<typeof reportQuery>;
