import { z } from "zod";
import { menuItemOutput } from "@/server/menu/output";

// Strict output schemas of the push endpoints (M23 plan §3.4). Each reply is parsed with the schema of the caller's role before it is sent, so a key
// the SQL adds without this file knowing it (a cost reaching the chef, a push price on a chef plate, covers in the chef forecast) fails the parse and
// the route answers 500 instead of passing it on. The database computed every quantity, hour, sum, average, gap and order.

const count = z.number().int();
const isoDate = z.iso.date();
const instant = z.iso.datetime();
const eur = z.number();

const plateBase = {
  menuItemId: z.uuid(),
  name: z.string().max(80),
  pushed: z.boolean(),
  pushUntil: instant.nullable(),
};
const rowBase = {
  kind: z.enum(["batch", "lot"]),
  id: z.uuid(),
  name: z.string().max(120),
  lotCode: z.string().max(64).nullable(),
  madeOn: isoDate,
  useByAt: instant,
  expiryDate: isoDate.nullable(),
  hoursToUseBy: z.number().min(0),
  quantity: z.number().positive(),
  unit: z.string().max(8),
  batchRecipes: z.array(z.strictObject({ recipeKey: z.uuid(), name: z.string().max(120) })),
};
const listBase = {
  asOf: instant,
  businessDate: isoDate,
  expired: z.strictObject({ batches: count, lots: count }),
  unresolvedRecipes: count,
};

const chefPushRow = z.strictObject({ ...rowBase, plates: z.array(z.strictObject(plateBase)) });

export const chefPushListOutput = z.strictObject({
  role: z.literal("chef"),
  ...listBase,
  rows: z.array(chefPushRow),
  totals: z.strictObject({ count }),
});

/** Owner and admin: the cost at risk (null when unknown, never zero) and the push price of each plate. */
export const managerPushRow = z.strictObject({
  ...rowBase,
  costAtRiskEur: eur.nullable(),
  plates: z.array(z.strictObject({ ...plateBase, pushPrice: eur.nullable() })),
});

export const managerPushListOutput = z.strictObject({
  role: z.enum(["owner", "admin"]),
  ...listBase,
  rows: z.array(managerPushRow),
  totals: z.strictObject({ count, costAtRiskEur: eur, unvaluedCount: count }),
});

export const pushListOutput = z.discriminatedUnion("role", [
  managerPushListOutput,
  chefPushListOutput,
]);
export type PushListOutput = z.infer<typeof pushListOutput>;
export type PushListRow = PushListOutput["rows"][number];

const forecastBase = {
  date: isoDate,
  today: isoDate,
  tomorrow: isoDate,
  weekday: z.number().int().min(1).max(7),
  sourceDates: z.array(isoDate),
  weeksUsed: z.number().int().min(0),
  batches: z.array(
    z.strictObject({
      recipeKey: z.uuid(),
      name: z.string().max(120),
      expectedPortions: z.number().nullable(),
      onHandPortions: z.number(),
      gap: z.number().nullable(),
    }),
  ),
  plates: z.array(
    z.strictObject({ menuItemId: z.uuid(), name: z.string().max(80), expectedPlates: z.number() }),
  ),
};

export const chefForecastOutput = z.strictObject({ role: z.literal("chef"), ...forecastBase });

/** Owner and admin add the expected covers (a KPI the chef does not see, Q163). */
export const managerForecastOutput = z.strictObject({
  role: z.enum(["owner", "admin"]),
  ...forecastBase,
  covers: z.strictObject({ expected: z.number().nullable() }),
});

export const forecastOutput = z.discriminatedUnion("role", [
  managerForecastOutput,
  chefForecastOutput,
]);
export type ForecastOutput = z.infer<typeof forecastOutput>;

const discardTotals = {
  batchesDiscarded: count,
  batchesPushed: count,
  portionsDiscarded: z.number(),
  portionsPushed: z.number(),
  valueEur: eur,
  unvaluedCount: count,
};
export const discardsOutput = z.strictObject({
  weekFrom: isoDate,
  weekTo: isoDate,
  rows: z.array(
    z.strictObject({
      recipeKey: z.uuid(),
      name: z.string().max(120),
      shelfLifeHours: z.number().int().positive(),
      ...discardTotals,
    }),
  ),
  totals: z.strictObject(discardTotals),
});
export type DiscardsOutput = z.infer<typeof discardsOutput>;

/** POST /api/menu/:id/push: the item as the owner manages it (the M17 shape) and whether anything changed. */
export const pushResultOutput = z.strictObject({ changed: z.boolean(), item: menuItemOutput });
