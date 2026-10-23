import type { LotItem, StockItem, StockOperation } from "@/server/stock/types";

// Fake data only ("(demo)" names, invented lots and quantities).
export const ING = "1a000000-0000-4000-8000-00000000001a";
export const CELLA = "10000000-0000-4000-8000-0000000000a1";
export const FREEZER = "10000000-0000-4000-8000-0000000000a2";
export const LOT_ID = "10700000-0000-4000-8000-0000000000a1";
export const LOT2_ID = "10700000-0000-4000-8000-0000000000a2";
export const MOVE_ID = "0e000000-0000-4000-8000-0000000000e1";
export const OP_ID = "0f000000-0000-4000-8000-0000000000a1";

export const ITEM: StockItem = {
  ingredientId: ING,
  name: "Manzo muscolo (demo)",
  baseUnit: "kg",
  isActive: true,
  onHandQty: 12.3,
  negative: false,
  locations: [
    { locationId: CELLA, name: "Cella (demo)", onHandQty: 10, unlottedQty: 0, negative: false },
    {
      locationId: FREEZER,
      name: "Freezer (demo)",
      onHandQty: 2.3,
      unlottedQty: 0,
      negative: false,
    },
  ],
};

export const LOT: LotItem = {
  rawLotId: LOT_ID,
  lotCode: "L-001",
  locationId: CELLA,
  locationName: "Cella (demo)",
  expiry: "2026-10-28",
  expiryState: "ok",
  receivedOn: "2026-10-20",
  supplierName: "Fornitore Demo Srl",
  qtyReceived: 5,
  onHandQty: 2,
  fefoRank: 1,
};

export const LOT2: LotItem = {
  ...LOT,
  rawLotId: LOT2_ID,
  lotCode: "L-002",
  locationId: FREEZER,
  locationName: "Freezer (demo)",
  expiry: null,
  expiryState: "none",
  onHandQty: 3,
  qtyReceived: 3,
};

export const OPERATION: StockOperation = {
  operationId: OP_ID,
  handleId: MOVE_ID,
  type: "waste",
  refType: "manual",
  reasonCode: "spoilage",
  isReversal: false,
  reversedByOperationId: null,
  reversible: true,
  qty: -1.5,
  unit: "kg",
  lines: [
    {
      movementId: MOVE_ID,
      locationId: CELLA,
      locationName: "Cella (demo)",
      rawLotId: LOT_ID,
      lotCode: "L-001",
      qty: -1.5,
    },
  ],
  effectiveOn: "2026-10-23",
  createdAt: "2026-10-23T08:12:00.000000+00:00",
  byName: "Titolare Demo",
  byMe: false,
};

export const LOCATIONS = [
  { id: CELLA, name: "Cella (demo)" },
  { id: FREEZER, name: "Freezer (demo)" },
];
