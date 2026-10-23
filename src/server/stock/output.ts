import { z } from "zod";
import { STOCK_REASON_CODES } from "./reasons";

// Strict output schemas of the stock endpoints (M12 plan §3.4). The services build their answers field by field and
// parse them here, so a column that is not declared (a cost that slipped into an RPC reply, say) can never reach the
// JSON: it is dropped by the mapping, and an undeclared key would make the parse throw (a 500, never a leak).
// The quantity endpoints declare no EUR, cost, price, margin, value or amount key; pgTAP and the route tests scan
// for that.

const baseUnit = z.enum(["kg", "l", "pz"]);
const movementType = z.enum(["receipt", "consumption", "waste", "transfer", "count"]);

const stockLocation = z.strictObject({
  locationId: z.uuid(),
  name: z.string(),
  onHandQty: z.number(),
  unlottedQty: z.number(),
  negative: z.boolean(),
});

export const stockResponse = z.strictObject({
  asOf: z.string(),
  items: z.array(
    z.strictObject({
      ingredientId: z.uuid(),
      name: z.string(),
      baseUnit,
      isActive: z.boolean(),
      onHandQty: z.number(),
      negative: z.boolean(),
      locations: z.array(stockLocation),
    }),
  ),
});

export const lotItem = z.strictObject({
  rawLotId: z.uuid().nullable(),
  lotCode: z.string().nullable(),
  locationId: z.uuid(),
  locationName: z.string(),
  expiry: z.string().nullable(),
  expiryState: z.enum(["none", "expired", "due_soon", "ok"]).nullable(),
  receivedOn: z.string().nullable(),
  supplierName: z.string().nullable(),
  qtyReceived: z.number().nullable(),
  onHandQty: z.number(),
  fefoRank: z.number().int().nullable(),
});

export const lotsResponse = z.strictObject({
  ingredient: z.strictObject({ id: z.uuid(), name: z.string(), baseUnit }),
  today: z.string(),
  units: z.array(z.enum(["kg", "g", "l", "ml", "pz"])),
  locations: z.array(z.strictObject({ id: z.uuid(), name: z.string() })),
  lots: z.array(lotItem),
});

export const stockOperation = z.strictObject({
  operationId: z.uuid(),
  handleId: z.uuid(),
  type: movementType,
  refType: z.string(),
  reasonCode: z.enum(STOCK_REASON_CODES).nullable(),
  isReversal: z.boolean(),
  reversedByOperationId: z.uuid().nullable(),
  reversible: z.boolean(),
  qty: z.number(),
  unit: baseUnit,
  lines: z.array(
    z.strictObject({
      movementId: z.uuid(),
      locationId: z.uuid(),
      locationName: z.string(),
      rawLotId: z.uuid().nullable(),
      lotCode: z.string().nullable(),
      qty: z.number(),
    }),
  ),
  effectiveOn: z.string(),
  createdAt: z.string(),
  byName: z.string().nullable(),
  byMe: z.boolean(),
});

export const movementsResponse = z.strictObject({
  operations: z.array(stockOperation),
  nextCursor: z.string().nullable(),
});

const movementLine = z.strictObject({
  id: z.uuid(),
  rawLotId: z.uuid().nullable(),
  locationId: z.uuid(),
  qty: z.number(),
});

export const outflowResponse = z.strictObject({
  operationId: z.uuid(),
  movements: z.array(movementLine),
  onHandQty: z.number(),
  negative: z.boolean(),
});

export const transferResponse = z.strictObject({
  operationId: z.uuid(),
  movements: z.array(movementLine),
  fromOnHandQty: z.number(),
  toOnHandQty: z.number(),
});

export const reverseResponse = z.strictObject({
  operationId: z.uuid(),
  reversedOperationId: z.uuid(),
  movements: z.array(movementLine),
});
