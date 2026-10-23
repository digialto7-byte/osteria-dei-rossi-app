import { z } from "zod";

// Strict output schemas of the batch endpoints (M14 plan §3.4). The services build their answers field by field and
// parse them here, so a column that is not declared (a cost that slipped into an RPC reply, say) can never reach the
// JSON: an undeclared key makes the parse throw (a 500, never a leak). Only batchItemWithCost, which the list builds
// for the owner and the admin, has euro keys; the chef reads the other shapes (founder Q16 = project V6).

const baseUnit = z.enum(["kg", "l", "pz"]);
const inputUnit = z.enum(["kg", "g", "l", "ml", "pz"]);

const proposalLot = z.strictObject({
  rawLotId: z.uuid().nullable(),
  lotCode: z.string().nullable(),
  locationId: z.uuid(),
  expiry: z.string().nullable(),
  expiryState: z.enum(["none", "expired", "due_soon", "ok"]).nullable(),
  onHandQty: z.number(),
  fefoRank: z.number().int().nullable(),
});

const proposalInput = z.strictObject({
  ingredientId: z.uuid(),
  name: z.string(),
  baseUnit,
  isStock: z.boolean(),
  proposedQty: z.number(),
  units: z.array(inputUnit),
  suggestedLocationId: z.uuid().nullable(),
  onHand: z.array(z.strictObject({ locationId: z.uuid(), onHandQty: z.number() })),
  lots: z.array(proposalLot),
});

export const batchProposal = z.strictObject({
  recipe: z.strictObject({
    key: z.uuid(),
    id: z.uuid(),
    version: z.number().int(),
    name: z.string(),
    outputQty: z.number(),
    outputUnit: baseUnit,
    portionsPerBatch: z.number().int(),
    shelfLifeHours: z.number().int(),
    portionSize: z.number(),
  }),
  outputQty: z.number(),
  portionsComputed: z.number().int(),
  shelfLifeHours: z.number().int(),
  useByPreview: z.string(),
  today: z.string(),
  locations: z.array(z.strictObject({ id: z.uuid(), name: z.string() })),
  suggestedLocationId: z.uuid().nullable(),
  inputs: z.array(proposalInput),
});

export const produceResult = z.strictObject({
  batchId: z.uuid(),
  lotCode: z.string(),
  recipe: z.strictObject({
    key: z.uuid(),
    id: z.uuid(),
    version: z.number().int(),
    name: z.string(),
  }),
  producedAt: z.string(),
  useBy: z.string(),
  outputQty: z.number(),
  outputUnit: baseUnit,
  portionsComputed: z.number().int(),
  portions: z.number().int(),
  shelfLifeHours: z.number().int(),
  locationId: z.uuid(),
  inputs: z.array(
    z.strictObject({
      ingredientId: z.uuid(),
      locationId: z.uuid(),
      qty: z.number(),
      movements: z.array(
        z.strictObject({ id: z.uuid(), rawLotId: z.uuid().nullable(), qty: z.number() }),
      ),
    }),
  ),
  negatives: z.array(
    z.strictObject({ ingredientId: z.uuid(), locationId: z.uuid(), onHandQty: z.number() }),
  ),
});

export const batchItem = z.strictObject({
  batchId: z.uuid(),
  lotCode: z.string(),
  recipeKey: z.uuid(),
  recipeName: z.string(),
  version: z.number().int(),
  producedAt: z.string(),
  useBy: z.string(),
  useByState: z.enum(["expired", "due_soon", "ok"]),
  shelfLifeHours: z.number().int(),
  outputQty: z.number(),
  outputUnit: baseUnit,
  portionsComputed: z.number().int(),
  portionsInitial: z.number().int(),
  portionsRemaining: z.number(),
  state: z.enum(["fresh", "open", "finished", "discarded"]),
  locationId: z.uuid(),
  locationName: z.string(),
  byInitials: z.string(),
  byMe: z.boolean(),
});

/** The frozen cost, in EUR: null, never 0, when an input had no price (ADR-008). */
export const batchItemWithCost = batchItem.extend({
  cost: z.strictObject({
    totalEur: z.number().nullable(),
    perPortionEur: z.number().nullable(),
    incomplete: z.boolean(),
  }),
});

export const batchListResponse = z.strictObject({
  items: z.array(batchItem),
  nextCursor: z.string().nullable(),
});

export const batchListWithCostResponse = z.strictObject({
  items: z.array(batchItemWithCost),
  nextCursor: z.string().nullable(),
});

export const batchLabel = z.strictObject({
  batchId: z.uuid(),
  recipeName: z.string(),
  version: z.number().int(),
  producedAt: z.string(),
  useBy: z.string(),
  portions: z.number().int(),
  lotCode: z.string(),
  operatorInitials: z.string(),
  shelfLifeHours: z.number().int(),
});
