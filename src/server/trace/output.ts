import { z } from "zod";

// Strict output schemas of the trace endpoints (P2-2 plan §3.3, §3.7), written against the SQL as built (migrations 20261203100100 to 100300).
// Each reply is parsed with the schema of the caller's role before it is sent: the owner's and admin's carry the invoice (and the purchase line on
// a lot), the chef's cannot, so a key the SQL adds without this file knowing it fails the parse and the route answers 500. No schema has a money key.
// The database computed every quantity, date, order and cap; nothing here does arithmetic.

const count = z.number().int();
const isoDate = z.iso.date();
const instant = z.iso.datetime();
const idName = z.strictObject({ id: z.uuid(), name: z.string().max(200) });
const code = z.string().max(64).nullable();

/** Owner and admin only (D-P7): the invoice as printed. */
const invoice = z.strictObject({
  id: z.uuid(),
  number: z.string().max(64).nullable(),
  date: isoDate,
});

// ---- lot search and capture rate --------------------------------------------------------------------------------------------------------------

export const traceLotSearchOutput = z.strictObject({
  lots: z.array(
    z.strictObject({
      lotId: z.uuid(),
      ingredient: idName,
      supplier: idName,
      lotCode: code,
      expiry: isoDate.nullable(),
      receivedOn: isoDate,
      qtyReceived: z.number(),
      unit: z.string().max(8),
      onHand: z.number(),
    }),
  ),
  truncated: z.boolean(),
});

export const lotCaptureOutput = z.strictObject({
  from: isoDate,
  to: isoDate,
  lots: count,
  withLotCode: count,
  bySupplier: z.array(
    z.strictObject({
      supplierId: z.uuid(),
      name: z.string().max(200),
      lots: count,
      withLotCode: count,
    }),
  ),
});

// ---- shared pieces ---------------------------------------------------------------------------------------------------------------------------

const plate = z.strictObject({
  businessDate: isoDate,
  menuItemId: z.uuid(),
  name: z.string().max(200),
  lines: count,
  portions: z.number(),
  firstAt: instant,
  lastAt: instant,
  via: z.enum(["batch", "direct"]),
});
const batchState = z.enum(["fresh", "open", "finished", "discarded"]);
const batchRef = z.strictObject({ batchId: z.uuid(), lotCode: code });

const lotRefBase = {
  lotId: z.uuid(),
  lotCode: code,
  expiry: isoDate.nullable(),
  receivedOn: isoDate,
  supplier: idName,
};
const lotRefChef = z.strictObject(lotRefBase);
const lotRefManager = z.strictObject({ ...lotRefBase, invoice });

const unlotted = <T extends z.ZodType>(lot: T) => lot.nullable();

// ---- forward trace of a lot ------------------------------------------------------------------------------------------------------------------

const lotBlockBase = {
  lotId: z.uuid(),
  ingredient: idName,
  supplier: idName,
  lotCode: code,
  expiry: isoDate.nullable(),
  receivedOn: isoDate,
  qtyReceived: z.number(),
  unit: z.string().max(8),
  location: idName,
};
/** D-P13: the lot's invoice line as it was approved. */
const purchase = z.strictObject({
  supplierItemId: z.uuid().nullable(),
  supplierCode: z.string().max(64).nullable(),
  description: z.string().max(1000),
});

const forwardBase = {
  raw: z.strictObject({
    received: z.number(),
    intoBatches: z.number(),
    intoPlates: z.number(),
    wasted: z.number(),
    counted: z.number(),
    onHand: z.number(),
    unit: z.string().max(8),
  }),
  batches: z.array(
    z.strictObject({
      batchId: z.uuid(),
      lotCode: code,
      recipeName: z.string().max(200),
      producedAt: instant,
      useBy: instant,
      qtyFromLot: z.number().nullable(),
      portionsInitial: z.number(),
      splitFrom: batchRef.nullable(),
      state: batchState,
      portions: z.strictObject({
        sold: z.number(),
        wasted: z.number(),
        staffMeal: z.number(),
        counted: z.number(),
        remaining: z.number(),
      }),
    }),
  ),
  batchesTruncated: z.boolean(),
  plates: z.array(plate),
  platesTruncated: z.boolean(),
  voided: z.strictObject({ lines: count, portions: z.number() }),
  gaps: z.strictObject({ lotCodeMissing: z.boolean(), unlottedSameIngredientBatches: count }),
};

export const traceLotOutput = z.strictObject({
  lot: z.strictObject({ ...lotBlockBase, invoice, purchase }),
  ...forwardBase,
});
export const traceLotChefOutput = z.strictObject({
  lot: z.strictObject(lotBlockBase),
  ...forwardBase,
});

// ---- backward trace of a batch ---------------------------------------------------------------------------------------------------------------

const batchBlock = z.strictObject({
  batchId: z.uuid(),
  lotCode: code,
  recipeName: z.string().max(200),
  recipeVersion: z.number().int(),
  producedAt: instant,
  useBy: instant,
  portionsInitial: z.number(),
  state: batchState,
  splitFrom: batchRef.nullable(),
  root: batchRef,
});
const inputBase = {
  ingredient: idName,
  qty: z.number(),
  unit: z.string().max(8),
  inherited: z.boolean(),
};
const batchTail = {
  portions: z.strictObject({
    sold: z.number(),
    wasted: z.number(),
    staffMeal: z.number(),
    counted: z.number(),
    splitOut: z.number(),
    remaining: z.number(),
  }),
  plates: z.array(plate),
  platesTruncated: z.boolean(),
};

export const traceBatchOutput = z.strictObject({
  batch: batchBlock,
  inputs: z.array(z.strictObject({ ...inputBase, lot: unlotted(lotRefManager) })),
  ...batchTail,
});
export const traceBatchChefOutput = z.strictObject({
  batch: batchBlock,
  inputs: z.array(z.strictObject({ ...inputBase, lot: unlotted(lotRefChef) })),
  ...batchTail,
});

// ---- served plates ---------------------------------------------------------------------------------------------------------------------------

/** No guest data: the table's name and times only (Q-P10). `state` is the line's derived state as the order ledger reads it. */
export const traceLineSearchOutput = z.strictObject({
  businessDate: isoDate,
  lines: z.array(
    z.strictObject({
      lineId: z.uuid(),
      menuItemName: z.string().max(200),
      tableName: z.string().max(200),
      firedAt: instant,
      portions: z.number(),
      weightG: z.number().nullable(),
      state: z.string().max(32),
    }),
  ),
  truncated: z.boolean(),
});

const lineBlock = z.strictObject({
  lineId: z.uuid(),
  menuItemName: z.string().max(200),
  tableName: z.string().max(200),
  businessDate: isoDate,
  firedAt: instant.nullable(),
  state: z.string().max(32),
  portions: z.number(),
  weightG: z.number().nullable(),
});
const lineBatches = z.array(
  z.strictObject({
    batchId: z.uuid(),
    lotCode: code,
    recipeName: z.string().max(200),
    producedAt: instant,
    portions: z.number(),
    reversed: z.boolean(),
  }),
);
/** A direct raw row: ingredient, quantity and unit (no `inherited`). */
const directBase = { ingredient: idName, qty: z.number(), unit: z.string().max(8) };
const reachedLotBase = { ...lotRefBase, ingredient: idName };

export const traceOrderLineOutput = z.strictObject({
  line: lineBlock,
  batches: lineBatches,
  rawDirect: z.array(z.strictObject({ ...directBase, lot: unlotted(lotRefManager) })),
  lots: z.array(z.strictObject({ ...reachedLotBase, invoice })),
});
export const traceOrderLineChefOutput = z.strictObject({
  line: lineBlock,
  batches: lineBatches,
  rawDirect: z.array(z.strictObject({ ...directBase, lot: unlotted(lotRefChef) })),
  lots: z.array(z.strictObject(reachedLotBase)),
});

export type TraceLotSearch = z.infer<typeof traceLotSearchOutput>;
export type LotCapture = z.infer<typeof lotCaptureOutput>;
export type TraceLot = z.infer<typeof traceLotOutput>;
export type TraceLotChef = z.infer<typeof traceLotChefOutput>;
export type TraceBatch = z.infer<typeof traceBatchOutput>;
export type TraceBatchChef = z.infer<typeof traceBatchChefOutput>;
export type TraceLineSearch = z.infer<typeof traceLineSearchOutput>;
export type TraceOrderLine = z.infer<typeof traceOrderLineOutput>;
export type TraceOrderLineChef = z.infer<typeof traceOrderLineChefOutput>;
