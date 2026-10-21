import { z } from "zod";
import { definedOnly, type ResourceSpec } from "./resource";
import { NON_EMPTY_MESSAGE, nonEmpty, trimmedText } from "./schemas";

interface LocationRow {
  id: string;
  name: string;
  is_active: boolean;
}

export interface Location {
  id: string;
  name: string;
  isActive: boolean;
}

export const locationSpec: ResourceSpec<LocationRow, Location> = {
  table: "location",
  columns: "id, name, is_active",
  toItem: (row) => ({ id: row.id, name: row.name, isActive: row.is_active }),
};

export const createLocationBody = z.object({ name: trimmedText(80) });
export const updateLocationBody = z
  .object({ name: trimmedText(80).optional(), isActive: z.boolean().optional() })
  .refine(nonEmpty, NON_EMPTY_MESSAGE);

export function locationPatch(body: z.infer<typeof updateLocationBody>) {
  return definedOnly({ name: body.name, is_active: body.isActive });
}
