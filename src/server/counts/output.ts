import { z } from "zod";

// Strict output schemas of the count endpoints (M13 plan §3.4). The services build their answers field by field and
// parse them here, so a column that is not declared (a cost that slipped into an RPC reply, say) can never reach the
// JSON: the mapping drops it, and an undeclared key would make the parse throw (a 500, never a leak). None of the
// quantity endpoints declares an EUR, cost, price, margin, value or amount key; the route tests scan for that.

const baseUnit = z.enum(["kg", "l", "pz"]);
const person = z.strictObject({ name: z.string().nullable(), me: z.boolean() });

export const countSession = z.strictObject({
  id: z.uuid(),
  type: z.enum(["daily", "monthly"]),
  status: z.enum(["open", "closed", "cancelled"]),
  location: z.strictObject({ id: z.uuid(), name: z.string() }),
  startedAt: z.string(),
  startedBy: person,
  closedAt: z.string().nullable(),
  closedBy: person.nullable(),
  cancelledAt: z.string().nullable(),
  linesTotal: z.number().int(),
  linesCounted: z.number().int(),
  linesWithDifference: z.number().int(),
});

export const countLine = z.strictObject({
  ingredientId: z.uuid(),
  name: z.string(),
  baseUnit,
  position: z.number().int(),
  expectedNowQty: z.number(),
  expectedQty: z.number().nullable(),
  countedQty: z.number().nullable(),
  differenceQty: z.number().nullable(),
  enteredAt: z.string().nullable(),
});

export const countSessionDetail = countSession.extend({
  resumed: z.boolean().optional(),
  today: z.string(),
  invoicesAwaitingApproval: z.number().int(),
  lines: z.array(countLine),
});

export const countSessionsResponse = z.strictObject({
  sessions: z.array(countSession),
  nextCursor: z.string().nullable(),
});

export const countLineEntry = z.strictObject({
  ingredientId: z.uuid(),
  expectedQty: z.number().nullable(),
  countedQty: z.number().nullable(),
  differenceQty: z.number().nullable(),
  enteredAt: z.string().nullable(),
});

export const countLinesResponse = z.strictObject({ lines: z.array(countLineEntry) });

export const closeResponse = z.strictObject({
  sessionId: z.uuid(),
  closedAt: z.string(),
  linesCounted: z.number().int(),
  linesSkipped: z.number().int(),
  linesWithDifference: z.number().int(),
  lines: z.array(z.strictObject({ ingredientId: z.uuid(), differenceQty: z.number() })),
});

export const cancelResponse = z.strictObject({
  sessionId: z.uuid(),
  status: z.literal("cancelled"),
  cancelledAt: z.string(),
});

export const criticalListResponse = z.strictObject({
  items: z.array(
    z.strictObject({
      ingredientId: z.uuid(),
      name: z.string(),
      baseUnit,
      isCritical: z.boolean(),
    }),
  ),
  criticalCount: z.number().int(),
});

export const criticalChangeResponse = z.strictObject({
  ingredientId: z.uuid(),
  isCritical: z.boolean(),
  changed: z.boolean(),
});

const varianceLine = z.strictObject({
  ingredientId: z.uuid(),
  name: z.string(),
  baseUnit,
  expectedQty: z.number(),
  countedQty: z.number(),
  differenceQty: z.number(),
  postedQty: z.number(),
});

export const varianceResponse = z.strictObject({
  session: countSession,
  linesSkipped: z.number().int(),
  lines: z.array(varianceLine),
});

// The one count answer with euro values (GET /api/reports/variance-costs, owner and admin). A value is null, never 0,
// when a posted row has no cost (ADR-008).
export const varianceCostsResponse = z.strictObject({
  sessionId: z.uuid(),
  valueEur: z.number(),
  lossEur: z.number(),
  gainEur: z.number(),
  unvaluedCount: z.number().int(),
  lines: z.array(z.strictObject({ ingredientId: z.uuid(), valueEur: z.number().nullable() })),
});

export const reconciliationResponse = z.strictObject({
  from: z.string(),
  to: z.string(),
  location: z.strictObject({ id: z.uuid(), name: z.string() }),
  items: z.array(
    z.strictObject({
      ingredientId: z.uuid(),
      name: z.string(),
      baseUnit,
      openingQty: z.number(),
      receiptsQty: z.number(),
      consumptionQty: z.number(),
      wasteQty: z.number(),
      transfersInQty: z.number(),
      transfersOutQty: z.number(),
      countAdjustmentsQty: z.number(),
      otherQty: z.number(),
      closingQty: z.number(),
      balanced: z.boolean(),
      countedQty: z.number().nullable(),
      countedAt: z.string().nullable(),
      countSessionId: z.uuid().nullable(),
      afterCountQty: z.number().nullable(),
      matchesCount: z.boolean().nullable(),
    }),
  ),
});
