import { z } from "zod";
import type { ResourceSpec } from "./resource";
import { trimmedText } from "./schemas";

interface CostCentreRow {
  id: string;
  name: string;
  is_active: boolean;
}

/** Where a non-stock invoice line is booked, e.g. "Pulizie" or "Gas". Owner and admin only. */
export interface CostCentre {
  id: string;
  name: string;
  isActive: boolean;
}

export const costCentreSpec: ResourceSpec<CostCentreRow, CostCentre> = {
  table: "cost_centre",
  columns: "id, name, is_active",
  toItem: (row) => ({ id: row.id, name: row.name, isActive: row.is_active }),
};

/** M4 only creates centres (the owner adds them on the fly); editing and deactivating come later. */
export const createCostCentreBody = z.object({ name: trimmedText(60) });
