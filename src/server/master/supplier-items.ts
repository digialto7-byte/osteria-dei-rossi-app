import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import {
  MEASURE_UNITS,
  toBase,
  toIngredientBase,
  UnitError,
  type BaseUnit,
  type MeasureUnit,
  type PackSpec,
} from "@/lib/units";
import { mapDbError } from "./db-errors";
import { definedOnly, getRow, insertRow, updateRow, type ResourceSpec } from "./resource";
import { NON_EMPTY_MESSAGE, nonEmpty, trimmedText } from "./schemas";

interface SupplierItemRow {
  id: string;
  supplier_id: string;
  ingredient_id: string;
  supplier_code: string | null;
  pack_count: number;
  pack_qty: number;
  pack_unit: MeasureUnit;
  pack_label: string | null;
  is_preferred: boolean;
  is_active: boolean;
}

/** A supplier's article. No price in M1: last_price is written by invoice approval (M5). */
export interface SupplierItem {
  id: string;
  supplierId: string;
  ingredientId: string;
  supplierCode: string | null;
  packCount: number;
  packQty: number;
  packUnit: MeasureUnit;
  packLabel: string | null;
  /** One pack in the base unit, e.g. a cassa of 6 × 1 kg is 6 (kg). */
  baseQtyPerPack: number;
  baseUnit: BaseUnit;
  isPreferred: boolean;
  isActive: boolean;
}

function packOf(row: Pick<SupplierItemRow, "pack_count" | "pack_qty" | "pack_unit">): PackSpec {
  return { count: Number(row.pack_count), size: Number(row.pack_qty), unit: row.pack_unit };
}

export const supplierItemSpec: ResourceSpec<SupplierItemRow, SupplierItem> = {
  table: "supplier_item",
  columns:
    "id, supplier_id, ingredient_id, supplier_code, pack_count, pack_qty, pack_unit, pack_label, is_preferred, is_active",
  orderBy: "supplier_code",
  toItem: (row) => {
    const perPack = toBase(1, "conf", packOf(row));
    return {
      id: row.id,
      supplierId: row.supplier_id,
      ingredientId: row.ingredient_id,
      supplierCode: row.supplier_code,
      packCount: Number(row.pack_count),
      packQty: Number(row.pack_qty),
      packUnit: row.pack_unit,
      packLabel: row.pack_label,
      baseQtyPerPack: perPack.qty,
      baseUnit: perPack.unit,
      isPreferred: row.is_preferred,
      isActive: row.is_active,
    };
  },
};

const packFields = {
  supplierCode: trimmedText(64),
  packCount: z.number().finite(),
  packQty: z.number().finite(),
  packUnit: z.enum(MEASURE_UNITS),
  packLabel: z.string().trim().max(30).nullable(),
  isPreferred: z.boolean(),
};

export const createSupplierItemBody = z.object({
  supplierId: z.uuid(),
  ingredientId: z.uuid(),
  supplierCode: packFields.supplierCode,
  packCount: packFields.packCount.optional(),
  packQty: packFields.packQty,
  packUnit: packFields.packUnit,
  packLabel: packFields.packLabel.optional(),
  isPreferred: packFields.isPreferred.optional(),
});

export const updateSupplierItemBody = z
  .object({
    supplierCode: packFields.supplierCode.optional(),
    packCount: packFields.packCount.optional(),
    packQty: packFields.packQty.optional(),
    packUnit: packFields.packUnit.optional(),
    packLabel: packFields.packLabel.optional(),
    isPreferred: packFields.isPreferred.optional(),
    isActive: z.boolean().optional(),
  })
  .refine(nonEmpty, NON_EMPTY_MESSAGE);

export const listFilters = z.object({
  supplierId: z.uuid().optional(),
  ingredientId: z.uuid().optional(),
});

const DEFAULT_PACK_COUNT = 1;

/** Validates a pack against the ingredient's base unit, with the same rules as the database. */
function checkPack(pack: PackSpec, ingredientBaseUnit: BaseUnit): void {
  try {
    toIngredientBase(1, "conf", ingredientBaseUnit, pack);
  } catch (error) {
    if (!(error instanceof UnitError)) throw error;
    if (error.code === "incompatible_units") {
      throw new ApiError(
        422,
        "incompatible_units",
        "L'unità della confezione non è compatibile con quella dell'ingrediente.",
      );
    }
    throw new ApiError(422, "invalid_pack", "La confezione deve avere quantità maggiori di zero.");
  }
}

function checkPositive(...values: (number | undefined)[]): void {
  if (values.some((value) => value !== undefined && !(value > 0))) {
    throw new ApiError(422, "invalid_pack", "La confezione deve avere quantità maggiori di zero.");
  }
}

async function ingredientBaseUnit(
  supabase: SupabaseClient,
  ingredientId: string,
): Promise<BaseUnit> {
  const { data, error } = await supabase
    .from("ingredient")
    .select("base_unit")
    .eq("id", ingredientId)
    .maybeSingle();
  if (error) throw mapDbError(error);
  if (!data) throw new ApiError(422, "invalid_reference", "L'ingrediente indicato non esiste.");
  return (data as { base_unit: BaseUnit }).base_unit;
}

async function makePreferred(supabase: SupabaseClient, itemId: string): Promise<void> {
  const { error } = await supabase.rpc("set_preferred_supplier_item", { item_id: itemId });
  if (error) throw mapDbError(error);
}

export async function createSupplierItem(
  supabase: SupabaseClient,
  body: z.infer<typeof createSupplierItemBody>,
): Promise<SupplierItem> {
  const pack: PackSpec = {
    count: body.packCount ?? DEFAULT_PACK_COUNT,
    size: body.packQty,
    unit: body.packUnit,
  };
  checkPositive(pack.count, pack.size);
  checkPack(pack, await ingredientBaseUnit(supabase, body.ingredientId));

  const created = await insertRow(
    supabase,
    supplierItemSpec,
    definedOnly({
      supplier_id: body.supplierId,
      ingredient_id: body.ingredientId,
      supplier_code: body.supplierCode,
      pack_count: body.packCount,
      pack_qty: body.packQty,
      pack_unit: body.packUnit,
      pack_label: body.packLabel,
    }),
  );
  if (!body.isPreferred) return created;
  await makePreferred(supabase, created.id);
  return { ...created, isPreferred: true };
}

export async function updateSupplierItem(
  supabase: SupabaseClient,
  id: string,
  body: z.infer<typeof updateSupplierItemBody>,
): Promise<SupplierItem> {
  checkPositive(body.packCount, body.packQty);
  const changesPack = [body.packCount, body.packQty, body.packUnit].some((v) => v !== undefined);
  if (changesPack) {
    const current = await getRow(supabase, supplierItemSpec, id);
    checkPack(
      {
        count: body.packCount ?? current.packCount,
        size: body.packQty ?? current.packQty,
        unit: body.packUnit ?? current.packUnit,
      },
      await ingredientBaseUnit(supabase, current.ingredientId),
    );
  }

  const columns = definedOnly({
    supplier_code: body.supplierCode,
    pack_count: body.packCount,
    pack_qty: body.packQty,
    pack_unit: body.packUnit,
    pack_label: body.packLabel,
    is_active: body.isActive,
    // Becoming preferred goes through the RPC, which also clears the previous preferred item.
    is_preferred: body.isPreferred === false ? false : undefined,
  });
  const updated =
    Object.keys(columns).length > 0
      ? await updateRow(supabase, supplierItemSpec, id, columns)
      : await getRow(supabase, supplierItemSpec, id);
  if (body.isPreferred !== true) return updated;
  await makePreferred(supabase, id);
  return { ...updated, isPreferred: true };
}
