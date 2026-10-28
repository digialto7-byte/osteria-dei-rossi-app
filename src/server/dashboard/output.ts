import { z } from "zod";
import { todaySchema } from "@/server/today/types";
import { COMING_SOON_KEYS } from "./sql-schema";

// What GET /api/dashboard returns (plan §3.3). Strict, and parsed again before it is sent, so a key the service did not
// build on purpose cannot leave the server. The admin schema has no owner-only tile.

const count = z.number().int().nonnegative();
const pct = z.number().min(-1000).max(1000);
const eur = z.number().nonnegative();
const href = z.string().regex(/^\/[a-z0-9/-]*$/);
const isoDate = z.iso.date();
const tileBase = { href };

/** The AlertItem of src/server/alerts/list.ts. No person's name is returned here, so `byName` is always null. */
export const alertItemSchema = z.strictObject({
  id: z.uuid(),
  kind: z.string(),
  severity: z.enum(["info", "warning", "critical"]),
  entityType: z.string(),
  entityId: z.string().nullable(),
  businessDate: isoDate,
  createdAt: z.iso.datetime(),
  title: z.string(),
  body: z.string(),
  href: href.nullable(),
  acknowledged: z.strictObject({ at: z.iso.datetime(), byName: z.null() }).nullable(),
});
export type DashboardAlertItem = z.infer<typeof alertItemSchema>;

const plateRow = z.strictObject({
  recipeKey: z.uuid(),
  name: z.string().max(200),
  gpPct: pct,
  targetGpPct: pct.nullable(),
  gapPct: pct.nullable(),
  status: z.enum(["below_target", "ok"]),
});
const listOf = <T extends z.ZodType>(row: T) =>
  z.strictObject({ count, items: z.array(row).max(5) });
const belowMinRow = z.strictObject({
  ingredientId: z.uuid(),
  name: z.string(),
  onHandQty: z.number(),
  minQty: z.number(),
  unit: z.string(),
  href,
});
const lotRow = z.strictObject({
  rawLotId: z.uuid(),
  ingredientId: z.uuid(),
  ingredientName: z.string(),
  lotCode: z.string(),
  expiry: isoDate,
  state: z.enum(["expired", "due_soon"]),
  qty: z.number(),
  unit: z.string(),
  href,
});
const batchRow = z.strictObject({
  batchId: z.uuid(),
  recipeName: z.string(),
  lotCode: z.string(),
  useBy: z.iso.datetime(),
  state: z.enum(["expired", "due_soon"]),
  portions: z.number().int(),
  href,
});

export const dashboardBase = {
  asOf: z.iso.datetime(),
  today: todaySchema,
  tiles: z.strictObject({
    foodCost: z.strictObject({
      ...tileBase,
      overallPct: pct.nullable(),
      platesCounted: count,
      platesIncomplete: count,
    }),
    plates: z.strictObject({
      ...tileBase,
      worst: z.array(plateRow).max(5),
      incomplete: z
        .array(z.strictObject({ recipeKey: z.uuid(), name: z.string().max(200) }))
        .max(5),
      incompleteCount: count,
    }),
    payables: z.strictObject({
      ...tileBase,
      dueSoonDays: z.literal(7),
      overdue: z.strictObject({ count, amountEur: eur }),
      dueSoon: z.strictObject({ count, amountEur: eur }),
      items: z
        .array(
          z.strictObject({
            id: z.uuid(),
            supplierName: z.string(),
            invoiceNumber: z.string().nullable(),
            amountEur: eur,
            dueDate: isoDate,
            daysToDue: z.number().int(),
            overdue: z.boolean(),
            href,
          }),
        )
        .max(5),
    }),
    stockAtRisk: z.strictObject({
      ...tileBase,
      belowMin: listOf(belowMinRow),
      expiringLots: listOf(lotRow),
      expiringBatches: listOf(batchRow),
    }),
    waste: z.strictObject({
      ...tileBase,
      from: isoDate,
      to: isoDate,
      valueEur: eur,
      rawValueEur: eur,
      batchValueEur: eur,
      unvaluedCount: count,
      reasons: z.array(z.strictObject({ reasonCode: z.string(), valueEur: eur })),
    }),
  }),
  comingSoon: z.array(z.enum(COMING_SOON_KEYS)),
};

export const adminDashboardSchema = z.strictObject({ role: z.literal("admin"), ...dashboardBase });
export const ownerDashboardSchema = z.strictObject({
  role: z.literal("owner"),
  ...dashboardBase,
  tiles: dashboardBase.tiles.extend({
    priceVariance: z.strictObject({
      ...tileBase,
      count,
      items: z.array(alertItemSchema).max(3),
    }),
    todayLists: z.strictObject({
      ...tileBase,
      businessDate: isoDate,
      prepCount: count,
      prep: z.array(alertItemSchema).max(10),
      purchaseCount: count,
      purchase: z.array(alertItemSchema).max(10),
    }),
    fixedCosts: z.strictObject({
      ...tileBase,
      periodMonth: isoDate.nullable(),
      monthlyTotalEur: eur.nullable(),
      perPlateEur: eur.nullable(),
      reason: z.enum(["no_fixed_costs", "no_sales"]).nullable(),
    }),
  }),
});
export const dashboardOutput = z.discriminatedUnion("role", [
  ownerDashboardSchema,
  adminDashboardSchema,
]);

export type DashboardOutput = z.infer<typeof dashboardOutput>;
export type OwnerDashboard = z.infer<typeof ownerDashboardSchema>;
export type AdminDashboard = z.infer<typeof adminDashboardSchema>;
