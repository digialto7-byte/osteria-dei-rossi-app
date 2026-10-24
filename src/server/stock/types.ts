import type { StockReasonCode } from "./reasons";

export type StockMovementType = "receipt" | "consumption" | "waste" | "transfer" | "count";
export type BaseUnit = "kg" | "l" | "pz";
export type ExpiryState = "none" | "expired" | "due_soon" | "ok";

/** One location of an ingredient in GET /api/stock. Quantities are JSON numbers with 4 decimals. */
export interface StockLocationQty {
  locationId: string;
  name: string;
  onHandQty: number;
  unlottedQty: number;
  negative: boolean;
}

export interface StockItem {
  ingredientId: string;
  name: string;
  baseUnit: BaseUnit;
  isActive: boolean;
  onHandQty: number;
  negative: boolean;
  locations: StockLocationQty[];
}

/** A row of public.stock_on_hand(), as the RPC returns it. */
export interface StockOnHandRow {
  ingredient_id: string;
  ingredient_name: string;
  base_unit: BaseUnit;
  is_active: boolean;
  location_id: string;
  location_name: string;
  on_hand_qty: number;
  unlotted_qty: number;
}

export interface LotItem {
  rawLotId: string | null;
  lotCode: string | null;
  locationId: string;
  locationName: string;
  expiry: string | null;
  expiryState: ExpiryState | null;
  receivedOn: string | null;
  supplierName: string | null;
  qtyReceived: number | null;
  onHandQty: number;
  fefoRank: number | null;
}

/** A row of public.stock_lots(), as the RPC returns it. */
export interface StockLotRow {
  raw_lot_id: string | null;
  lot_code: string | null;
  location_id: string;
  location_name: string;
  expiry: string | null;
  expiry_state: ExpiryState | null;
  received_on: string | null;
  supplier_name: string | null;
  qty_received: number | null;
  on_hand_qty: number;
  fefo_rank: number | null;
}

export interface StockOperationLine {
  movementId: string;
  locationId: string;
  locationName: string;
  rawLotId: string | null;
  lotCode: string | null;
  qty: number;
}

/** An operation of the history: the rows of one call, as public.stock_movements returns them. */
export interface StockOperation {
  operationId: string;
  handleId: string;
  type: StockMovementType;
  refType: string;
  reasonCode: StockReasonCode | null;
  isReversal: boolean;
  reversedByOperationId: string | null;
  reversible: boolean;
  qty: number;
  unit: BaseUnit;
  lines: StockOperationLine[];
  effectiveOn: string;
  createdAt: string;
  byName: string | null;
  byMe: boolean;
}

export interface StockMovementsResult {
  operations: StockOperation[];
  nextCursor: string | null;
}

export interface MovementLine {
  id: string;
  rawLotId: string | null;
  locationId: string;
  qty: number;
}

export interface OutflowResult {
  operationId: string;
  movements: MovementLine[];
  onHandQty: number;
  negative: boolean;
}

export interface TransferResult {
  operationId: string;
  movements: MovementLine[];
  fromOnHandQty: number;
  toOnHandQty: number;
}

export interface ReverseResult {
  operationId: string;
  reversedOperationId: string;
  movements: MovementLine[];
}

export interface WasteCostLine {
  ingredientId: string;
  ingredientName: string;
  baseUnit: BaseUnit;
  qty: number;
  valueEur: number | null;
}

export interface WasteCostBatchLine {
  recipeKey: string;
  recipeName: string;
  portions: number;
  valueEur: number | null;
}

export interface WasteCostReason {
  reasonCode: StockReasonCode;
  valueEur: number;
  rawValueEur: number;
  batchValueEur: number;
  lines: WasteCostLine[];
  batchLines: WasteCostBatchLine[];
}

export interface WasteCosts {
  from: string;
  to: string;
  valueEur: number;
  rawValueEur: number;
  batchValueEur: number;
  unvaluedCount: number;
  reasons: WasteCostReason[];
}
