import { z } from "zod";
import { avtOutput, kpiReportOutput } from "@/server/reports/output";
import { wasteCostsResponse } from "@/server/stock/output";

const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/**
 * GET /api/exports/monthly-pack (plan §3.4): the KPI, waste and AVT replies of one month, composed by the server. Strict, so a key the services do
 * not declare can never ride along. `variance` is a state, not a number: React only chooses what to print.
 */
export const monthlyPackOutput = z.strictObject({
  month: MONTH,
  from: z.iso.date(),
  to: z.iso.date(),
  final: z.boolean(),
  previousMonth: MONTH,
  nextMonth: MONTH.nullable(),
  kpis: kpiReportOutput,
  waste: wasteCostsResponse,
  variance: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("ok"), avt: avtOutput }),
    z.strictObject({ state: z.literal("noCount") }),
    z.strictObject({ state: z.literal("noOpening") }),
  ]),
});

export type MonthlyPack = z.infer<typeof monthlyPackOutput>;
