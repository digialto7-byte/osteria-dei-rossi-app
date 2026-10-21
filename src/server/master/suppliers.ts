import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { isValidItVat, normaliseItVat } from "@/lib/vat/it-vat";
import { definedOnly, type ResourceSpec } from "./resource";
import { NON_EMPTY_MESSAGE, nonEmpty, trimmedText } from "./schemas";

interface SupplierRow {
  id: string;
  name: string;
  vat_number: string | null;
  payment_terms_days: number | null;
  is_active: boolean;
}

export interface Supplier {
  id: string;
  name: string;
  vatNumber: string | null;
  paymentTermsDays: number | null;
  isActive: boolean;
}

export const supplierSpec: ResourceSpec<SupplierRow, Supplier> = {
  table: "supplier",
  columns: "id, name, vat_number, payment_terms_days, is_active",
  toItem: (row) => ({
    id: row.id,
    name: row.name,
    vatNumber: row.vat_number,
    paymentTermsDays: row.payment_terms_days,
    isActive: row.is_active,
  }),
};

const vatNumber = z.string().max(20).nullable().optional();
const paymentTermsDays = z.number().int().min(0).max(365).nullable().optional();

export const createSupplierBody = z.object({ name: trimmedText(200), vatNumber, paymentTermsDays });
export const updateSupplierBody = z
  .object({
    name: trimmedText(200).optional(),
    vatNumber,
    paymentTermsDays,
    isActive: z.boolean().optional(),
  })
  .refine(nonEmpty, NON_EMPTY_MESSAGE);

/** Normalises a VAT number and rejects a bad one with 422 before anything is written. */
export function checkedVatNumber(raw: string | null | undefined): string | null | undefined {
  if (raw === undefined || raw === null) return raw;
  const vat = normaliseItVat(raw);
  if (!isValidItVat(vat)) {
    throw new ApiError(
      422,
      "invalid_vat_number",
      "Partita IVA non valida: IT seguito da 11 cifre corrette.",
    );
  }
  return vat;
}

type SupplierFields = Partial<z.infer<typeof updateSupplierBody>>;

export function supplierColumns(body: SupplierFields) {
  return definedOnly({
    name: body.name,
    vat_number: checkedVatNumber(body.vatNumber),
    payment_terms_days: body.paymentTermsDays,
    is_active: body.isActive,
  });
}
