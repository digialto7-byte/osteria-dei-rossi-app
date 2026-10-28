import { z } from "zod";
import { managerCountsSchema } from "@/server/today/types";

// The document public.dashboard_summary() returns (plan §3.2). The document and its blocks are strict: a key the SQL adds
// without this file knowing it (a fixed cost reaching the admin, say) fails the parse, so the route answers 500 instead of
// passing it on. The ROWS inside the lists strip an unknown key instead (plan step 8: an injected cost key in a plate row
// is dropped from the JSON), and render.ts builds every output row from known fields only.

const count = z.number().int().nonnegative();
const eur = z.number().nonnegative();
const pct = z.number().min(-1000).max(1000);
const isoDate = z.iso.date();
const instant = z.iso.datetime();

const foodCost = z.strictObject({
  overallPct: pct.nullable(),
  platesCounted: count,
  platesIncomplete: count,
});
const plates = z.strictObject({
  worst: z
    .array(
      z.object({
        recipeKey: z.uuid(),
        name: z.string(),
        gpPct: pct,
        targetGpPct: pct.nullable(),
        gapPct: pct.nullable(),
        status: z.enum(["below_target", "ok"]),
      }),
    )
    .max(5),
  incomplete: z.array(z.object({ recipeKey: z.uuid(), name: z.string() })).max(5),
  incompleteCount: count,
});
const payables = z.strictObject({
  dueSoonDays: z.literal(7),
  overdue: z.strictObject({ count, amountEur: eur }),
  dueSoon: z.strictObject({ count, amountEur: eur }),
  items: z
    .array(
      z.object({
        id: z.uuid(),
        supplierName: z.string(),
        invoiceNumber: z.string().nullable(),
        amountEur: eur,
        dueDate: isoDate,
        daysToDue: z.number().int(),
        overdue: z.boolean(),
      }),
    )
    .max(5),
});
const listOf = <T extends z.ZodType>(row: T) =>
  z.strictObject({ count, items: z.array(row).max(5) });
const stockAtRisk = z.strictObject({
  belowMin: listOf(
    z.object({
      ingredientId: z.uuid(),
      name: z.string(),
      onHandQty: z.number(),
      minQty: z.number(),
      unit: z.string(),
    }),
  ),
  expiringLots: listOf(
    z.object({
      rawLotId: z.uuid(),
      ingredientId: z.uuid(),
      ingredientName: z.string(),
      lotCode: z.string(),
      expiry: isoDate,
      state: z.enum(["expired", "due_soon"]),
      qty: z.number(),
      unit: z.string(),
    }),
  ),
  expiringBatches: listOf(
    z.object({
      batchId: z.uuid(),
      recipeName: z.string(),
      lotCode: z.string(),
      useBy: instant,
      state: z.enum(["expired", "due_soon"]),
      portions: z.number().int(),
    }),
  ),
});
const waste = z.strictObject({
  from: isoDate,
  to: isoDate,
  valueEur: eur,
  rawValueEur: eur,
  batchValueEur: eur,
  unvaluedCount: count,
  reasons: z.array(z.object({ reasonCode: z.string(), valueEur: eur })),
});

/** One alert row as the SQL returns it; the service renders it with the existing alert templates. */
export const alertRowSchema = z.object({
  id: z.uuid(),
  kind: z.string(),
  severity: z.enum(["info", "warning", "critical"]),
  entityType: z.string(),
  entityId: z.string().nullable(),
  businessDate: isoDate,
  createdAt: instant,
  payload: z.unknown(),
  costBearing: z.boolean(),
  acknowledgedAt: instant.nullable(),
});
export type SqlAlertRow = z.infer<typeof alertRowSchema>;

const names = z.record(z.string(), z.string());
const namesDoc = z.strictObject({
  ingredient: names,
  location: names,
  recipe: names,
  supplier: names,
  raw_lot: names,
  batch: names,
});
export type SqlNames = z.infer<typeof namesDoc>;

export const COMING_SOON_KEYS = ["covers", "revenue", "averageSpend"] as const;

const base = {
  asOf: instant,
  today: managerCountsSchema,
  foodCost,
  plates,
  payables,
  stockAtRisk,
  waste,
  comingSoon: z.array(z.enum(COMING_SOON_KEYS)),
};

/** Admin: no alert key (the admin reads no alert) and no fixed-cost key (Q107). */
export const adminSqlSchema = z.strictObject({ role: z.literal("admin"), ...base });
export const ownerSqlSchema = z.strictObject({
  role: z.literal("owner"),
  ...base,
  alertsOpen: z.strictObject({ count, more: z.boolean() }),
  priceVariance: z.strictObject({ count, items: z.array(alertRowSchema).max(3) }),
  todayLists: z.strictObject({
    businessDate: isoDate,
    prepCount: count,
    prep: z.array(alertRowSchema).max(10),
    purchaseCount: count,
    purchase: z.array(alertRowSchema).max(10),
  }),
  names: namesDoc,
  fixedCosts: z.strictObject({
    periodMonth: isoDate.nullable(),
    monthlyTotalEur: eur.nullable(),
    platesSold: count.nullable(),
    perPlateEur: eur.nullable(),
    reason: z.enum(["no_fixed_costs", "no_sales"]).nullable(),
  }),
});
export const dashboardSqlSchema = z.discriminatedUnion("role", [ownerSqlSchema, adminSqlSchema]);
export type DashboardSql = z.infer<typeof dashboardSqlSchema>;
export type OwnerSql = z.infer<typeof ownerSqlSchema>;
