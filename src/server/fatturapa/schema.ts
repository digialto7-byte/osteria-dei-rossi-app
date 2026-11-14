/**
 * Zod 4 schemas: the field patterns of the FatturaPA schema (Allegato A, Appendix 2, XSD 1.2.3) and
 * the strict shape of the import payload, which mirrors the checks of import_xml_invoices in SQL.
 * Amounts are decimal strings, never numbers.
 */
import { z } from "zod";
import {
  XML_DOCUMENT_TYPES,
  XML_FORMATS,
  XML_MAX_BODIES,
  XML_MAX_LINES,
  XML_NATURES,
  XML_NOTES,
} from "@/server/fatturapa/constants";
import { MAX_UPLOAD_BYTES } from "@/lib/invoices/limits";

// Field patterns of the source file --------------------------------------------------------------------------------

export const amount2 = z.string().regex(/^-?[0-9]{1,11}\.[0-9]{2}$/);
export const amount8 = z.string().regex(/^-?[0-9]{1,11}\.[0-9]{2,8}$/);
export const quantity = z.string().regex(/^[0-9]{1,12}\.[0-9]{2,8}$/);
export const rate = z
  .string()
  .regex(/^[0-9]{1,3}\.[0-9]{2}$/)
  .refine((value) => Number(value) <= 100);
export const natura = z.enum(XML_NATURES);
export const lineNumber = z
  .string()
  .regex(/^[0-9]{1,4}$/)
  .refine((v) => Number(v) >= 1);
export const dayCount = z.string().regex(/^[0-9]{1,3}$/);
export const currency = z.string().regex(/^[A-Z]{3}$/);
export const countryCode = z.string().regex(/^[A-Z]{2}$/);
export const vatCode = z.string().min(1).max(28);
export const fiscalCode = z.string().regex(/^[A-Z0-9]{11,16}$/);
export const documentTypeCode = z.string().regex(/^TD[0-9]{2}$/);
export const lineKind = z.enum(["SC", "PR", "AB", "AC"]);
export const discountType = z.enum(["SC", "MG"]);
export const chargeability = z.enum(["I", "D"]);
export const shortText = (max: number) => z.string().min(1).max(max);
/** The document number: at most 20 characters, at least one digit (check 00425). */
export const documentNumber = z
  .string()
  .min(1)
  .max(20)
  .refine((value) => /[0-9]/.test(value));

/** A calendar date YYYY-MM-DD, on or after 1970-01-01. */
export function isCalendarDate(value: string): boolean {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1970) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}
export const isoDate = z.string().refine(isCalendarDate);

// The import payload ---------------------------------------------------------------------------------------------------

const money = z.string().regex(/^[0-9]{1,8}(\.[0-9]{1,4})?$/);
const signedMoney = z.string().regex(/^-?[0-9]{1,8}(\.[0-9]{1,4})?$/);
const nullable = <T extends z.ZodType>(schema: T) => schema.nullable();

const payloadLine = z.strictObject({
  rawDescription: z.string().min(1),
  supplierCode: nullable(z.string().min(1).max(64)),
  qty: money,
  unitRaw: nullable(z.string().min(1).max(20)),
  unitPrice: nullable(money),
  lineAmount: money,
  vatRate: money,
  vatNature: nullable(natura),
  xmlDetails: nullable(z.record(z.string(), z.unknown())),
});

const payloadSummary = z.strictObject({
  vatRate: money,
  vatNature: nullable(natura),
  taxable: money,
  tax: money,
  rounding: nullable(signedMoney),
  accessoryCosts: nullable(money),
  vatChargeability: nullable(z.enum(["I", "D"])),
  legalReference: nullable(z.string().min(1).max(100)),
});

const payloadInvoice = z.strictObject({
  id: z.uuid(),
  filePath: z.string(),
  fileMime: z.enum(["application/xml", "application/pkcs7-mime"]),
  fileSizeBytes: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
  originalFilename: nullable(z.string().min(1).max(200)),
  bodyIndex: z.number().int().min(1).max(XML_MAX_BODIES),
  documentType: z.enum(XML_DOCUMENT_TYPES),
  notes: z.array(z.enum(XML_NOTES)),
  header: z.strictObject({
    supplierVat: z.string().regex(/^[A-Z]{2}[0-9A-Z]{2,12}$/),
    supplierName: z.string().min(1).max(200),
    numberRaw: z.string().min(1).max(64),
    invoiceDate: isoDate,
    dueDate: nullable(isoDate),
    netTotal: money,
    vatTotal: money,
    grossTotal: money,
  }),
  lines: z.array(payloadLine).max(XML_MAX_LINES),
  vatSummary: z.array(payloadSummary).min(1).max(XML_MAX_LINES),
});

/** The argument of import_xml_invoices. Strict: an unknown key is refused here as it is in SQL. */
export const XmlImportPayload = z
  .strictObject({
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    format: z.enum(XML_FORMATS),
    bodyCount: z.number().int().min(1).max(XML_MAX_BODIES),
    buyer: z.strictObject({ vat: nullable(z.string()), cf: nullable(z.string()) }),
    invoices: z.array(payloadInvoice).min(1).max(XML_MAX_BODIES),
  })
  .superRefine((payload, ctx) => {
    if (payload.bodyCount !== payload.invoices.length) {
      ctx.addIssue({ code: "custom", message: "bodyCount differs from the number of bodies" });
    }
    payload.invoices.forEach((invoice, index) => {
      if (invoice.bodyIndex !== index + 1)
        ctx.addIssue({ code: "custom", message: "bodyIndex out of order" });
      const extension = invoice.fileMime === "application/xml" ? "xml" : "p7m";
      const path = new RegExp(`^[0-9a-f-]{36}/[0-9]{4}/${invoice.id}\\.${extension}$`);
      if (!path.test(invoice.filePath))
        ctx.addIssue({ code: "custom", message: "filePath does not fit id and type" });
    });
    if (new Set(payload.invoices.map((invoice) => invoice.id)).size !== payload.invoices.length) {
      ctx.addIssue({ code: "custom", message: "duplicate invoice id" });
    }
  });
export type XmlImportPayload = z.infer<typeof XmlImportPayload>;
