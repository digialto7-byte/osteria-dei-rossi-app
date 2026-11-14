// Fake replies of the P2-2 trace functions (docs/plans/2026-11-14-p2-2-trace-sell-through.md section 3.3), shaped as the SQL returns them. Fake data only.
const id = (n: number) => `7a000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const IDS = {
  lot: id(1),
  batch: id(2),
  child: id(3),
  line: id(4),
  ingredient: id(5),
  supplier: id(6),
  invoice: id(7),
  supplierItem: id(8),
  menuItem: id(9),
  location: id(10),
  recipeKey: id(11),
};

const invoice = { id: IDS.invoice, number: "FT-DEMO-1", date: "1998-11-02" };
const lotBlock = {
  lotId: IDS.lot,
  ingredient: { id: IDS.ingredient, name: "Farina Demo" },
  supplier: { id: IDS.supplier, name: "Fornitore Demo 1" },
  lotCode: "L-DEMO-0001",
  expiry: "1998-12-20",
  receivedOn: "1998-11-02",
  qtyReceived: 25000,
  unit: "g",
  location: { id: IDS.location, name: "Magazzino Demo" },
};
const purchase = {
  supplierItemId: IDS.supplierItem,
  supplierCode: "FD-1",
  description: "Farina 00",
};

const plate = {
  businessDate: "1998-11-13",
  menuItemId: IDS.menuItem,
  name: "Lasagne Demo",
  lines: 2,
  portions: 2.4,
  firstAt: "1998-11-13T11:40:00Z",
  lastAt: "1998-11-13T12:10:00Z",
  via: "batch" as const,
};
const batchRow = {
  batchId: IDS.batch,
  lotCode: "B-DEMO-1",
  recipeName: "Ragù Demo",
  producedAt: "1998-11-12T09:00:00Z",
  useBy: "1998-11-15T09:00:00Z",
  qtyFromLot: 5000,
  portionsInitial: 20,
  splitFrom: null,
  state: "open" as const,
  portions: { sold: 8, wasted: 1, staffMeal: 1, counted: 0, remaining: 8 },
};

export const TRACE_LOT_OWNER = {
  lot: { ...lotBlock, invoice, purchase },
  raw: {
    received: 25000,
    intoBatches: 5000,
    intoPlates: 0,
    wasted: 0,
    counted: 0,
    onHand: 20000,
    unit: "g",
  },
  batches: [
    batchRow,
    {
      ...batchRow,
      batchId: IDS.child,
      lotCode: "B-DEMO-1-1",
      qtyFromLot: null,
      splitFrom: { batchId: IDS.batch, lotCode: "B-DEMO-1" },
    },
  ],
  batchesTruncated: false,
  plates: [plate, { ...plate, name: "Tagliatelle Demo", via: "direct" as const }],
  platesTruncated: false,
  voided: { lines: 1, portions: 1 },
  gaps: { lotCodeMissing: false, unlottedSameIngredientBatches: 0 },
};
export const TRACE_LOT_CHEF = { ...TRACE_LOT_OWNER, lot: lotBlock };

const inputLot = {
  lotId: IDS.lot,
  lotCode: null,
  expiry: null,
  receivedOn: "1998-11-02",
  supplier: { id: IDS.supplier, name: "Fornitore Demo 1" },
};
const input = {
  ingredient: { id: IDS.ingredient, name: "Farina Demo" },
  qty: 5000,
  unit: "g",
  inherited: true,
};
const batchBlock = {
  batchId: IDS.child,
  lotCode: "B-DEMO-1-1",
  recipeName: "Ragù Demo",
  recipeVersion: 2,
  producedAt: "1998-11-12T09:00:00Z",
  useBy: "1998-11-15T09:00:00Z",
  portionsInitial: 4,
  state: "fresh" as const,
  splitFrom: { batchId: IDS.batch, lotCode: "B-DEMO-1" },
  root: { batchId: IDS.batch, lotCode: "B-DEMO-1" },
};
const portions = { sold: 1, wasted: 0, staffMeal: 0, counted: 0, splitOut: 4, remaining: 3 };
export const TRACE_BATCH_OWNER = {
  batch: batchBlock,
  inputs: [
    { ...input, lot: { ...inputLot, invoice } },
    { ...input, lot: null },
  ],
  portions,
  plates: [{ ...plate, via: "batch" as const }],
  platesTruncated: false,
};
export const TRACE_BATCH_CHEF = {
  ...TRACE_BATCH_OWNER,
  inputs: [
    { ...input, lot: inputLot },
    { ...input, lot: null },
  ],
};

export const TRACE_LINES = {
  businessDate: "1998-11-13",
  lines: [
    {
      lineId: IDS.line,
      menuItemName: "Lasagne Demo",
      tableName: "T1",
      firedAt: "1998-11-13T11:40:00Z",
      portions: 1.4,
      weightG: 350,
      state: "fired",
    },
  ],
  truncated: false,
};

const lineBlock = {
  lineId: IDS.line,
  menuItemName: "Lasagne Demo",
  tableName: "T1",
  businessDate: "1998-11-13",
  firedAt: "1998-11-13T11:40:00Z",
  state: "fired",
  portions: 1,
  weightG: null,
};
const lineLot = {
  lotId: IDS.lot,
  lotCode: "L-DEMO-0001",
  expiry: null,
  receivedOn: "1998-11-02",
  ingredient: { id: IDS.ingredient, name: "Farina Demo" },
  supplier: { id: IDS.supplier, name: "Fornitore Demo 1" },
};
export const TRACE_ORDER_LINE_OWNER = {
  line: lineBlock,
  batches: [
    {
      batchId: IDS.batch,
      lotCode: "B-DEMO-1",
      recipeName: "Ragù Demo",
      producedAt: "1998-11-12T09:00:00Z",
      portions: 1,
      reversed: false,
    },
  ],
  rawDirect: [
    {
      ingredient: { id: IDS.ingredient, name: "Farina Demo" },
      qty: 100,
      unit: "g",
      lot: {
        lotId: IDS.lot,
        lotCode: null,
        expiry: null,
        receivedOn: "1998-11-02",
        supplier: { id: IDS.supplier, name: "Fornitore Demo 1" },
        invoice,
      },
    },
  ],
  lots: [{ ...lineLot, invoice }],
};
const { invoice: _invoice, ...rawLotNoInvoice } = TRACE_ORDER_LINE_OWNER.rawDirect[0]!.lot;
export const TRACE_ORDER_LINE_CHEF = {
  ...TRACE_ORDER_LINE_OWNER,
  rawDirect: [{ ...TRACE_ORDER_LINE_OWNER.rawDirect[0]!, lot: rawLotNoInvoice }],
  lots: [lineLot],
};

export const TRACE_LOT_SEARCH = {
  lots: [
    {
      lotId: IDS.lot,
      ingredient: { id: IDS.ingredient, name: "Farina Demo" },
      supplier: { id: IDS.supplier, name: "Fornitore Demo 1" },
      lotCode: "L-DEMO-0001",
      expiry: null,
      receivedOn: "1998-11-02",
      qtyReceived: 25000,
      unit: "g",
      onHand: 20000,
    },
  ],
  truncated: false,
};

export const LOT_CAPTURE = {
  from: "1998-10-16",
  to: "1998-11-14",
  lots: 3,
  withLotCode: 2,
  bySupplier: [{ supplierId: IDS.supplier, name: "Fornitore Demo 1", lots: 3, withLotCode: 2 }],
};
