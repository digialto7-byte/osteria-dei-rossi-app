import { z } from "zod";
import { OPENING_REVERSAL_REASONS } from "./constants";

// Strict output schemas of /api/stock/opening/* (plan 2026-11-18 §3.4-§3.6). The routes are owner/admin only, so money keys are
// allowed here; an undeclared key makes the parse throw (a 500, never a leak).

const baseUnit = z.enum(["kg", "l", "pz"]);
const isoDate = z.iso.date();
const instant = z.string();

const draftLine = z.strictObject({
  id: z.uuid(),
  ingredientId: z.uuid(),
  ingredientName: z.string(),
  baseUnit,
  qty: z.number(),
  unitCostEur: z.number(),
  valueEur: z.number(),
  updatedAt: instant,
  updatedByName: z.string(),
});

export const draftResponse = z.strictObject({
  today: isoDate,
  maxLines: z.number().int(),
  booked: z.boolean(),
  locations: z.array(
    z.strictObject({
      locationId: z.uuid(),
      name: z.string(),
      countedOn: isoDate.nullable(),
      countOpen: z.boolean(),
      firstReceiptOn: isoDate.nullable(),
      bookable: z.boolean(),
      lines: z.array(draftLine),
      lineCount: z.number().int(),
      totalValueEur: z.number(),
    }),
  ),
  lineCount: z.number().int(),
  totalValueEur: z.number(),
});

export const draftPutResponse = z.strictObject({
  lines: z.array(draftLine.extend({ locationId: z.uuid() })),
});

export const removedResponse = z.strictObject({ removed: z.number().int() });

export const confirmResponse = z.strictObject({
  openingId: z.uuid(),
  locationId: z.uuid(),
  effectiveOn: isoDate,
  lineCount: z.number().int(),
  totalValueEur: z.number(),
  changed: z.boolean(),
});

export const historyOperation = z.strictObject({
  openingId: z.uuid(),
  effectiveOn: isoDate,
  createdAt: instant,
  byName: z.string(),
  lineCount: z.number().int(),
  totalValueEur: z.number(),
  reversed: z
    .strictObject({
      at: instant,
      byName: z.string().nullable(),
      reasonCode: z.enum(OPENING_REVERSAL_REASONS).nullable(),
    })
    .nullable(),
  correctable: z.boolean(),
  lines: z.array(
    z.strictObject({
      movementId: z.uuid(),
      ingredientId: z.uuid(),
      name: z.string(),
      baseUnit,
      qty: z.number(),
      unitCostEur: z.number(),
      valueEur: z.number(),
    }),
  ),
});

export const historyResponse = z.strictObject({
  location: z.strictObject({ id: z.uuid(), name: z.string() }),
  countedOn: isoDate.nullable(),
  countOpen: z.boolean(),
  operations: z.array(historyOperation),
});

export const reverseResponse = z.strictObject({
  openingId: z.uuid(),
  reversalOperationId: z.uuid(),
  restoredLineIds: z.array(z.uuid()),
});

export const summaryResponse = z.strictObject({
  booked: z.boolean(),
  draftLines: z.number().int(),
});

export type DraftResponse = z.infer<typeof draftResponse>;
export type HistoryResponse = z.infer<typeof historyResponse>;
export type HistoryOperation = z.infer<typeof historyOperation>;
export type SummaryResponse = z.infer<typeof summaryResponse>;
