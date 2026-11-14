import type {
  LotCapture,
  TraceBatch,
  TraceLineSearch,
  TraceLot,
  TraceLotSearch,
  TraceOrderLine,
} from "@/server/trace/output";

// Fixture replies of the trace endpoints, in the shapes src/server/trace/output.ts parses. Demo names; every date is in 1998.
export const U = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const LOT_ID = U(1);
export const BATCH_ID = U(2);
export const CHILD_ID = U(3);
export const LINE_ID = U(4);
export const INVOICE_ID = U(5);
export const SUPPLIER_1 = U(6);
export const SUPPLIER_2 = U(7);
export const FARINA = U(8);
export const MENU_LASAGNE = U(9);

const supplier = { id: SUPPLIER_1, name: "Fornitore Demo 1" };
const ingredient = { id: FARINA, name: "Farina Demo" };
const invoice = { id: INVOICE_ID, number: "418", date: "1998-11-13" };

const plate = {
  businessDate: "1998-11-14",
  menuItemId: MENU_LASAGNE,
  name: "Lasagne Demo",
  lines: 14,
  portions: 14,
  firstAt: "1998-11-14T11:40:00.000Z",
  lastAt: "1998-11-14T13:55:00.000Z",
  via: "batch" as const,
};

const forward = {
  raw: {
    received: 25,
    intoBatches: 18,
    intoPlates: 2,
    wasted: 0.5,
    counted: -0.5,
    onHand: 4,
    unit: "kg",
  },
  batches: [
    {
      batchId: BATCH_ID,
      lotCode: "P-1114-02",
      recipeName: "Ragù Demo",
      producedAt: "1998-11-14T08:40:00.000Z",
      useBy: "1998-11-17T08:40:00.000Z",
      qtyFromLot: 6,
      portionsInitial: 40,
      splitFrom: null,
      state: "open" as const,
      portions: { sold: 31, wasted: 2, staffMeal: 0, counted: 0, remaining: 7 },
    },
    {
      batchId: CHILD_ID,
      lotCode: "P-1114-02-B",
      recipeName: "Ragù Demo",
      producedAt: "1998-11-14T08:40:00.000Z",
      useBy: "1998-11-17T08:40:00.000Z",
      qtyFromLot: null,
      portionsInitial: 4,
      splitFrom: { batchId: BATCH_ID, lotCode: "P-1114-02" },
      state: "fresh" as const,
      portions: { sold: 0, wasted: 0, staffMeal: 0, counted: 0, remaining: 4 },
    },
  ],
  batchesTruncated: false,
  plates: [plate, { ...plate, name: "Pane Demo", lines: 3, portions: 3, via: "direct" as const }],
  platesTruncated: false,
  voided: { lines: 2, portions: 2 },
  gaps: { lotCodeMissing: false, unlottedSameIngredientBatches: 0 },
};

const lotBlock = {
  lotId: LOT_ID,
  ingredient,
  supplier,
  lotCode: "L-2311-A",
  expiry: "1998-11-20",
  receivedOn: "1998-11-13",
  qtyReceived: 25,
  unit: "kg",
  location: { id: U(10), name: "Magazzino" },
};

export const LOT_OWNER: TraceLot = {
  lot: {
    ...lotBlock,
    invoice,
    purchase: { supplierItemId: U(11), supplierCode: "FD-00", description: "Farina 00 25kg" },
  },
  ...forward,
};
export const LOT_CHEF = { lot: lotBlock, ...forward };
export const LOT_GAPS: TraceLot = {
  ...LOT_OWNER,
  lot: { ...LOT_OWNER.lot, lotCode: null },
  batches: [],
  plates: [],
  voided: { lines: 0, portions: 0 },
  gaps: { lotCodeMissing: true, unlottedSameIngredientBatches: 2 },
};

const batchBlock = {
  batchId: CHILD_ID,
  lotCode: "P-1114-02-B",
  recipeName: "Ragù Demo",
  recipeVersion: 1,
  producedAt: "1998-11-14T08:40:00.000Z",
  useBy: "1998-11-17T08:40:00.000Z",
  portionsInitial: 4,
  state: "open" as const,
  splitFrom: { batchId: BATCH_ID, lotCode: "P-1114-02" },
  root: { batchId: BATCH_ID, lotCode: "P-1114-02" },
};
const portions = { sold: 1, wasted: 0, staffMeal: 1, counted: 0, splitOut: 0, remaining: 2 };
const lotRef = {
  lotId: LOT_ID,
  lotCode: "L-2311-A",
  expiry: "1998-11-20",
  receivedOn: "1998-11-13",
  supplier,
};
export const BATCH_OWNER: TraceBatch = {
  batch: batchBlock,
  inputs: [
    { ingredient, qty: 6, unit: "kg", inherited: true, lot: { ...lotRef, invoice } },
    {
      ingredient: { id: U(12), name: "Pomodoro Demo" },
      qty: 2,
      unit: "kg",
      inherited: true,
      lot: null,
    },
  ],
  portions,
  plates: [plate],
  platesTruncated: false,
};
export const BATCH_CHEF = {
  ...BATCH_OWNER,
  inputs: [{ ...BATCH_OWNER.inputs[0]!, lot: lotRef }, BATCH_OWNER.inputs[1]!],
};
export const BATCH_ROOT: TraceBatch = {
  ...BATCH_OWNER,
  batch: { ...batchBlock, batchId: BATCH_ID, lotCode: "P-1114-02", splitFrom: null },
  inputs: [{ ...BATCH_OWNER.inputs[0]!, inherited: false }],
};

const lineBlock = {
  lineId: LINE_ID,
  menuItemName: "Lasagne Demo",
  tableName: "Tavolo 7",
  businessDate: "1998-11-14",
  firedAt: "1998-11-14T20:14:00.000Z",
  state: "served",
  portions: 1,
  weightG: null,
};
export const LINE_OWNER: TraceOrderLine = {
  line: lineBlock,
  batches: [
    {
      batchId: BATCH_ID,
      lotCode: "P-1114-02",
      recipeName: "Ragù Demo",
      producedAt: "1998-11-14T08:40:00.000Z",
      portions: 1,
      reversed: false,
    },
  ],
  rawDirect: [
    {
      ingredient: { id: U(13), name: "Pane Demo" },
      qty: 0.2,
      unit: "kg",
      lot: { ...lotRef, invoice },
    },
  ],
  lots: [{ ...lotRef, ingredient, invoice }],
};
export const LINE_CHEF = {
  ...LINE_OWNER,
  rawDirect: [{ ...LINE_OWNER.rawDirect[0]!, lot: lotRef }],
  lots: [{ ...lotRef, ingredient }],
};
export const LINE_DRAFT: TraceOrderLine = {
  line: { ...lineBlock, firedAt: null, state: "draft" },
  batches: [],
  rawDirect: [],
  lots: [],
};

export const LOT_SEARCH: TraceLotSearch = {
  lots: [
    {
      lotId: LOT_ID,
      ingredient,
      supplier,
      lotCode: "L-2311-A",
      expiry: "1998-11-20",
      receivedOn: "1998-11-13",
      qtyReceived: 25,
      unit: "kg",
      onHand: 4,
    },
    {
      lotId: U(14),
      ingredient,
      supplier: { id: SUPPLIER_2, name: "Fornitore Demo 2" },
      lotCode: null,
      expiry: null,
      receivedOn: "1998-11-09",
      qtyReceived: 10,
      unit: "kg",
      onHand: 0,
    },
  ],
  truncated: false,
};
export const CAPTURE: LotCapture = {
  from: "1998-10-16",
  to: "1998-11-14",
  lots: 25,
  withLotCode: 18,
  bySupplier: [
    { supplierId: SUPPLIER_2, name: "Fornitore Demo 2", lots: 9, withLotCode: 3 },
    { supplierId: SUPPLIER_1, name: "Fornitore Demo 1", lots: 16, withLotCode: 15 },
  ],
};
export const LINE_SEARCH: TraceLineSearch = {
  businessDate: "1998-11-13",
  lines: [
    {
      lineId: LINE_ID,
      menuItemName: "Lasagne Demo",
      tableName: "Tavolo 7",
      firedAt: "1998-11-13T20:14:00.000Z",
      portions: 1,
      weightG: null,
      state: "served",
    },
    {
      lineId: U(15),
      menuItemName: "Pane Demo",
      tableName: "Tavolo 2",
      firedAt: "1998-11-13T20:30:00.000Z",
      portions: 1,
      weightG: null,
      state: "voided",
    },
  ],
  truncated: false,
};
