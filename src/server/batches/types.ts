import type { BaseUnit, ExpiryState } from "@/server/stock/types";

export type UseByState = "expired" | "due_soon" | "ok";
export type BatchState = "fresh" | "open" | "finished" | "discarded";

export interface ProposalLot {
  rawLotId: string | null;
  lotCode: string | null;
  locationId: string;
  expiry: string | null;
  expiryState: ExpiryState | null;
  onHandQty: number;
  fefoRank: number | null;
}

export interface ProposalInput {
  ingredientId: string;
  name: string;
  baseUnit: BaseUnit;
  isStock: boolean;
  proposedQty: number;
  units: Array<"kg" | "g" | "l" | "ml" | "pz">;
  suggestedLocationId: string | null;
  onHand: Array<{ locationId: string; onHandQty: number }>;
  lots: ProposalLot[];
}

/** The answer of public.batch_proposal: quantities only. */
export interface BatchProposal {
  recipe: {
    key: string;
    id: string;
    version: number;
    name: string;
    outputQty: number;
    outputUnit: BaseUnit;
    portionsPerBatch: number;
    shelfLifeHours: number;
    portionSize: number;
  };
  outputQty: number;
  portionsComputed: number;
  shelfLifeHours: number;
  useByPreview: string;
  today: string;
  locations: Array<{ id: string; name: string }>;
  suggestedLocationId: string | null;
  inputs: ProposalInput[];
}

/** The answer of public.produce_batch: no cost key. */
export interface ProduceResult {
  batchId: string;
  lotCode: string;
  recipe: { key: string; id: string; version: number; name: string };
  producedAt: string;
  useBy: string;
  outputQty: number;
  outputUnit: BaseUnit;
  portionsComputed: number;
  portions: number;
  shelfLifeHours: number;
  locationId: string;
  inputs: Array<{
    ingredientId: string;
    locationId: string;
    qty: number;
    movements: Array<{ id: string; rawLotId: string | null; qty: number }>;
  }>;
  negatives: Array<{ ingredientId: string; locationId: string; onHandQty: number }>;
}

/** One batch of public.batch_list. */
export interface BatchItem {
  batchId: string;
  lotCode: string;
  recipeKey: string;
  recipeName: string;
  version: number;
  producedAt: string;
  useBy: string;
  useByState: UseByState;
  shelfLifeHours: number;
  outputQty: number;
  outputUnit: BaseUnit;
  portionsComputed: number;
  portionsInitial: number;
  portionsRemaining: number;
  state: BatchState;
  locationId: string;
  locationName: string;
  byInitials: string;
  byMe: boolean;
}

export interface BatchListResult {
  items: BatchItem[];
  nextCursor: { producedAt: string; id: string } | null;
}

/** The frozen cost of a batch, in EUR (owner and admin only); null when an input had no price. */
export interface BatchCost {
  totalEur: number | null;
  perPortionEur: number | null;
  incomplete: boolean;
}

/** A row of public.batch_costs(), as the RPC returns it. */
export interface BatchCostRow {
  batch_id: string;
  total_cost_eur: number | null;
  unit_cost_eur: number | null;
  incomplete: boolean;
  missing_ingredient_ids: string[];
}

/** The answer of public.batch_label. */
export interface BatchLabel {
  batchId: string;
  recipeName: string;
  version: number;
  producedAt: string;
  useBy: string;
  portions: number;
  lotCode: string;
  operatorInitials: string;
  shelfLifeHours: number;
}
