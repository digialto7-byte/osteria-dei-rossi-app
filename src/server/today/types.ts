import { z } from "zod";

// What GET /api/today returns (UX plan 3.3). Counts and yes/no only: no key carries money, a name or an id.

export const CARD_KEYS = [
  "alerts",
  "invoicesToReview",
  "payablesOverdue",
  "payablesUnpaid",
  "batchesUseBy",
  "countOpen",
] as const;
export type CardKey = (typeof CARD_KEYS)[number];

export const SETUP_KEYS = [
  "locations",
  "suppliers",
  "ingredients",
  "invoice",
  "staff",
  "device",
  "tables",
  "menu",
] as const;
export type SetupKey = (typeof SETUP_KEYS)[number];

const href = z.string().regex(/^\/[a-z/-]*$/);

export const todayCardSchema = z.strictObject({
  key: z.enum(CARD_KEYS),
  count: z.number().int().nonnegative(),
  /** True when the count stopped at a cap (alerts only). */
  more: z.boolean(),
  href,
});
export const setupStepSchema = z.strictObject({
  key: z.enum(SETUP_KEYS),
  done: z.boolean(),
  href,
});
/** `setup` is null for the chef, who does not set the venue up. */
export const todaySchema = z.strictObject({
  cards: z.array(todayCardSchema),
  setup: z.array(setupStepSchema).nullable(),
});

export type TodayCard = z.infer<typeof todayCardSchema>;
export type SetupStep = z.infer<typeof setupStepSchema>;
export type TodaySummary = z.infer<typeof todaySchema>;

/** public.today_counts(): the owner and admin get every key, the chef only the first two. */
const countsBase = {
  batchesUseBy: z.number().int().nonnegative(),
  countOpen: z.boolean(),
};
export const chefCountsSchema = z.strictObject(countsBase);
export type ChefCounts = z.infer<typeof chefCountsSchema>;
export const managerCountsSchema = z.strictObject({
  ...countsBase,
  invoicesToReview: z.number().int().nonnegative(),
  payablesOverdue: z.number().int().nonnegative(),
  payablesUnpaid: z.number().int().nonnegative(),
  setup: z.strictObject({
    hasLocations: z.boolean(),
    hasSuppliers: z.boolean(),
    hasIngredients: z.boolean(),
    hasApprovedInvoice: z.boolean(),
    hasStaff: z.boolean(),
    hasDevice: z.boolean(),
    hasTables: z.boolean(),
    hasMenuItems: z.boolean(),
  }),
});
export type ManagerCounts = z.infer<typeof managerCountsSchema>;
