import { z } from "zod";

// Shapes only (a wrong shape is a 400 from withApi). Ranges are checked in Postgres, which answers
// 422 settings_invalid / fixed_cost_invalid with a field and a code per problem.
export const costBasisBody = z.strictObject({ basis: z.enum(["moving_average", "last_price"]) });

export const settingsPatchBody = z.strictObject({
  avgCostN: z.number().optional(),
  priceVariancePct: z.number().optional(),
  saleVatPct: z.number().optional(),
});

/** `month` is YYYY-MM from year 0001 (there is no year 0); the database wants the first day. */
export const fixedCostBody = z.strictObject({
  month: z.string().regex(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/),
  rentEur: z.number(),
  labourEur: z.number(),
  utilitiesEur: z.number(),
});

export const costCheckBody = z.discriminatedUnion("format", [
  z.strictObject({ format: z.literal("csv"), csv: z.string() }),
  z.strictObject({
    format: z.literal("json"),
    plates: z.array(z.strictObject({ name: z.string(), foodCostEur: z.number() })),
  }),
]);
export type CostCheckBody = z.infer<typeof costCheckBody>;
