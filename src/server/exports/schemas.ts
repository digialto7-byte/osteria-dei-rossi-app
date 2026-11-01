import { z } from "zod";

/** `[file]` of `/api/exports/[file]`: a lower-case slug with the `.csv` extension. Which slugs exist is the registry's business (404). */
export const exportParams = z.object({ file: z.string().regex(/^[a-z-]+\.csv$/) });

/** `?month=YYYY-MM`; absent means the month of yesterday's business day (the KPI function's own default anchor, Q174). */
export const monthlyPackQuery = z.strictObject({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
});
export type MonthlyPackQuery = z.infer<typeof monthlyPackQuery>;
