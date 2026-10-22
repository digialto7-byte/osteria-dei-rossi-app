import type { ReviewLine } from "@/server/invoices/review-types";

/** `null` is success; a string is the Italian message to show next to what failed. */
export type Outcome = Promise<string | null>;

export interface IngredientOption {
  id: string;
  name: string;
  baseUnit: ReviewLine["unit"] & string;
}

export interface CostCentreOption {
  id: string;
  name: string;
}

export interface SupplierOption {
  id: string;
  name: string;
  vatNumber: string | null;
}

/** What the line editor and the split form ask of the screen. Each call ends in a fresh review. */
export interface LineActions {
  saveLine(lineId: string, patch: Record<string, unknown>): Outcome;
  createCentre(name: string): Promise<{ id: string } | { error: string }>;
  split(lineId: string, children: { qty: number; lineAmount: number }[]): Outcome;
  unsplit(lineId: string): Outcome;
}

export interface SupplierActions {
  link(supplierId: string): Outcome;
  create(body: {
    name: string;
    vatNumber: string | null;
    paymentTermsDays: number | null;
  }): Outcome;
}

/** What the approval panel asks of the screen. Each call ends in a fresh review (or a message). */
export interface ApprovalActions {
  /** `locationId` only when the owner had to choose between several locations. */
  approve(locationId: string | null): Outcome;
  /** `reason` is already trimmed; null when the field was left empty. */
  reject(reason: string | null): Outcome;
}
