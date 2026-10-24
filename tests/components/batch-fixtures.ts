import type { BatchProposal, ProposalInput } from "@/server/batches/types";

export const KEY = "ec000000-0000-4000-8000-0000000000e1";
export const RECIPE = "ed000000-0000-4000-8000-0000000000d1";
export const BEEF = "1a000000-0000-4000-8000-00000000001a";
export const WATER = "1e000000-0000-4000-8000-00000000001e";
export const CELLA = "10000000-0000-4000-8000-0000000000a1";
export const DISPENSA = "10000000-0000-4000-8000-0000000000a2";
export const LOT_D2 = "10700000-0000-4000-8000-0000000000a1";
export const LOT_D5 = "10700000-0000-4000-8000-0000000000a2";
export const LOT_DISP = "10700000-0000-4000-8000-0000000000a3";

export const BEEF_INPUT: ProposalInput = {
  ingredientId: BEEF,
  name: "Manzo muscolo (demo)",
  baseUnit: "kg",
  isStock: true,
  proposedQty: 5.1667,
  units: ["kg", "g"],
  suggestedLocationId: CELLA,
  onHand: [{ locationId: CELLA, onHandQty: 6 }],
  lots: [
    {
      rawLotId: LOT_D2,
      lotCode: "L-D2",
      locationId: CELLA,
      expiry: "2026-10-25",
      expiryState: "ok",
      onHandQty: 3,
      fefoRank: 1,
    },
    {
      rawLotId: LOT_D5,
      lotCode: "L-D5",
      locationId: CELLA,
      expiry: "2026-10-28",
      expiryState: "ok",
      onHandQty: 3,
      fefoRank: 2,
    },
    {
      rawLotId: LOT_DISP,
      lotCode: "L-DISP",
      locationId: DISPENSA,
      expiry: null,
      expiryState: "none",
      onHandQty: 1,
      fefoRank: 1,
    },
    {
      rawLotId: null,
      lotCode: null,
      locationId: CELLA,
      expiry: null,
      expiryState: null,
      onHandQty: -1,
      fefoRank: null,
    },
  ],
};

export const WATER_INPUT: ProposalInput = {
  ingredientId: WATER,
  name: "Acqua (demo)",
  baseUnit: "l",
  isStock: false,
  proposedQty: 1.0333,
  units: [],
  suggestedLocationId: null,
  onHand: [],
  lots: [],
};

export const PROPOSAL: BatchProposal = {
  recipe: {
    key: KEY,
    id: RECIPE,
    version: 1,
    name: "Spezzatino (demo)",
    outputQty: 6,
    outputUnit: "kg",
    portionsPerBatch: 30,
    shelfLifeHours: 72,
    portionSize: 0.2,
  },
  outputQty: 6.2,
  portionsComputed: 31,
  shelfLifeHours: 72,
  useByPreview: "2026-10-26T09:12:00+00:00",
  today: "2026-10-23",
  locations: [{ id: CELLA, name: "Cella (demo)" }],
  suggestedLocationId: CELLA,
  inputs: [BEEF_INPUT, WATER_INPUT],
};

export const TWO_LOCATIONS = [
  { id: CELLA, name: "Cella (demo)" },
  { id: DISPENSA, name: "Dispensa (demo)" },
];

export const BATCH_ID = "ba000000-0000-4000-8000-0000000000b1";

// 12:12 in Rome (CEST) on 23/10/2026; 72 elapsed hours later it is 11:12 on 26/10/2026 (CET).
export const BATCH_ITEM: import("@/server/batches/types").BatchItem = {
  batchId: BATCH_ID,
  lotCode: "261023-SPEZZA-1",
  recipeKey: KEY,
  recipeName: "Spezzatino (demo)",
  version: 1,
  producedAt: "2026-10-23T10:12:00+00:00",
  useBy: "2026-10-26T10:12:00+00:00",
  useByState: "ok",
  shelfLifeHours: 72,
  outputQty: 6.2,
  outputUnit: "kg",
  portionsComputed: 31,
  portionsInitial: 31,
  portionsRemaining: 31,
  state: "fresh",
  locationId: CELLA,
  locationName: "Cella (demo)",
  byInitials: "CD",
  byMe: false,
};
