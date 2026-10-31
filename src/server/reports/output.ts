import { z } from "zod";
import { DELTA_KEYS, PERIODS } from "./constants";

// Strict output schemas of the report endpoints (M22 plan §3.5). Each reply is parsed with the schema of the caller's role before it is sent, so a
// key the SQL adds without this file knowing it (a fixed cost reaching the admin, an injected unit cost) fails the parse and the route answers 500
// instead of passing it on. Amounts keep the internal precision (four decimals); the database computed every figure, including the deltas.

const eur = z.number();
const pct = z.number().min(-100000).max(100000);
const count = z.number().int();
const isoDate = z.iso.date();

const kpiBlock = z.strictObject({
  from: isoDate,
  to: isoDate,
  final: z.boolean(),
  daysFinal: count,
  days: count,
  covers: count,
  tables: count,
  revenueGrossEur: eur,
  revenueNetEur: eur,
  copertoNetEur: eur,
  avgSpendPerCoverEur: eur.nullable(),
  avgTicketEur: eur.nullable(),
  plates: z.number(),
  foodCostEur: eur,
  foodCostPct: pct.nullable(),
  costedRevenueNetEur: eur,
  uncostedRevenueNetEur: eur,
  costedSharePct: pct.nullable(),
  coversByHour: z.array(count).length(24),
  coversByWeekday: z.array(count).length(7),
  purchasesEur: eur,
  purchasesUnvaluedCount: count,
  waste: z.strictObject({
    valueEur: eur,
    unvaluedCount: count,
    reasons: z.array(z.strictObject({ reasonCode: z.string(), valueEur: eur })),
  }),
  appVsRegister: z.strictObject({
    appTotalEur: eur,
    registerTotalEur: eur.nullable(),
    difference: z.strictObject({ amount: eur, pct: pct.nullable() }).nullable(),
    datesWithoutRegister: z.array(isoDate),
  }),
});

const delta = z.strictObject({ abs: z.number(), pct: pct.nullable() }).nullable();
const deltas = z.strictObject(
  Object.fromEntries(DELTA_KEYS.map((key) => [key, delta])) as Record<
    (typeof DELTA_KEYS)[number],
    typeof delta
  >,
);

export const kpiReportOutput = z.strictObject({
  period: z.enum(PERIODS),
  current: kpiBlock,
  previous: kpiBlock,
  delta: deltas,
});

const itemBase = {
  menuItemId: z.uuid(),
  name: z.string().max(200),
  course: z.string(),
  plates: z.number(),
  mixPct: pct,
  revenueNetEur: eur,
  costedPlates: z.number(),
  costedRevenueNetEur: eur,
  foodCostEur: eur.nullable(),
  foodCostPct: pct.nullable(),
  foodMarginPerPlateEur: eur.nullable(),
  status: z.enum(["costed", "partial", "incomplete", "unmapped"]),
};
const itemsCommon = {
  period: z.enum(PERIODS),
  from: isoDate,
  to: isoDate,
  final: z.boolean(),
  totals: z.strictObject({
    plates: z.number(),
    revenueNetEur: eur,
    costedRevenueNetEur: eur,
    foodCostEur: eur,
    foodCostPct: pct.nullable(),
  }),
};

/** The admin's rows: no fixed-cost key exists (Q107). */
export const adminItemsOutput = z.strictObject({
  role: z.literal("admin"),
  ...itemsCommon,
  rows: z.array(z.strictObject(itemBase)),
});
/** The owner's rows add the fixed cost per plate, the gross margin per plate and the contribution. */
export const ownerItemsOutput = z.strictObject({
  role: z.literal("owner"),
  ...itemsCommon,
  rows: z.array(
    z.strictObject({
      ...itemBase,
      fixedCostPerPlateEur: eur.nullable(),
      grossMarginPerPlateEur: eur.nullable(),
      contributionEur: eur.nullable(),
      fixedCostReason: z.enum(["no_fixed_costs", "no_sales"]).nullable(),
    }),
  ),
});
export const itemsOutput = z.discriminatedUnion("role", [ownerItemsOutput, adminItemsOutput]);

const countRef = z.strictObject({ id: z.uuid(), closedAt: z.iso.datetime({ offset: true }) });
const countRefNamed = z.strictObject({
  id: z.uuid(),
  closedAt: z.iso.datetime({ offset: true }),
  locationName: z.string(),
});

export const avtOutput = z.strictObject({
  count: countRefNamed,
  openingCount: countRef,
  locationsActive: count,
  rows: z.array(
    z.strictObject({
      ingredientId: z.uuid(),
      name: z.string(),
      baseUnit: z.string(),
      actualQty: z.number(),
      theoreticalQty: z.number(),
      wasteQty: z.number(),
      varianceQty: z.number(),
      unitCostEur: eur.nullable(),
      varianceEur: eur.nullable(),
    }),
  ),
  totals: z.strictObject({
    varianceEur: eur,
    lossEur: eur,
    gainEur: eur,
    unvaluedCount: count,
    notCountedCount: count,
  }),
  availableCounts: z.array(countRefNamed).max(12),
});

export const unmappedOutput = z.strictObject({
  weekFrom: isoDate,
  weekTo: isoDate,
  rows: z.array(
    z.strictObject({
      menuItemId: z.uuid(),
      name: z.string(),
      plates: z.number(),
      revenueGrossEur: eur,
      lastSoldOn: isoDate,
    }),
  ),
  totals: z.strictObject({ plates: z.number(), revenueGrossEur: eur }),
});

export type KpiReport = z.infer<typeof kpiReportOutput>;
export type KpiBlock = KpiReport["current"];
export type ItemsOutput = z.infer<typeof itemsOutput>;
export type OwnerItemsOutput = z.infer<typeof ownerItemsOutput>;
export type AvtOutput = z.infer<typeof avtOutput>;
export type UnmappedOutput = z.infer<typeof unmappedOutput>;
