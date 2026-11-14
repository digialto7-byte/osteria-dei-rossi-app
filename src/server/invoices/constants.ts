/** Private Storage bucket for invoice documents (created by a migration). */
export const INVOICE_BUCKET = "invoices";

export { MAX_UPLOAD_BYTES } from "@/lib/invoices/limits";
export const MULTIPART_OVERHEAD_BYTES = 16_384;

export const SIGNED_URL_TTL_SECONDS = 300;
export const MAX_UPLOADS_PER_HOUR = 60;
export const MAX_INVOICE_LIST_ROWS = 100;
export const MAX_FILENAME_CHARS = 200;

/** Documents the AI reads (pdf, photos) and the FatturaPA files read by our own parser (xml, p7m). */
export type InvoiceFileKind = "pdf" | "jpg" | "png" | "xml" | "p7m";
export type ExtractableKind = "pdf" | "jpg" | "png";

/** The canonical type stored in Storage and on the row; the bucket and the invoice constraints accept exactly these. */
export const KIND_MIME: Record<InvoiceFileKind, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  png: "image/png",
  xml: "application/xml",
  p7m: "application/pkcs7-mime",
};

/**
 * Declared (browser) types accepted per kind, lower case. Documents must declare the canonical type.
 * E-invoice files come from file pickers on phones and Windows, which send these or nothing at all;
 * the bytes decide the kind and the stored type is always the canonical one.
 */
export const KIND_DECLARED_MIME: Record<InvoiceFileKind, readonly string[]> = {
  pdf: ["application/pdf"],
  jpg: ["image/jpeg"],
  png: ["image/png"],
  xml: ["application/xml", "text/xml", "application/octet-stream", ""],
  p7m: ["application/pkcs7-mime", "application/x-pkcs7-mime", "application/octet-stream", ""],
};

export const FATTURA_KINDS: readonly InvoiceFileKind[] = ["xml", "p7m"];

/** File name extensions (lower case, no dot) accepted for each kind. */
export const KIND_EXTENSIONS: Record<InvoiceFileKind, readonly string[]> = {
  pdf: ["pdf"],
  jpg: ["jpg", "jpeg"],
  png: ["png"],
  xml: ["xml"],
  p7m: ["p7m"],
};

/** How often the invoice list and page read again while an invoice is received or being read (extraction runs in the background). */
export const INVOICE_REFRESH_MS = 4_000;
