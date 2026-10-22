/** Private Storage bucket for invoice documents (created by a migration). */
export const INVOICE_BUCKET = "invoices";

/**
 * 4 MiB. A Vercel Function rejects request bodies over 4.5 MB, so this plus the multipart
 * overhead must stay below it. Pinned to the bucket's file_size_limit in the migration.
 */
export const MAX_UPLOAD_BYTES = 4_194_304;
export const MULTIPART_OVERHEAD_BYTES = 16_384;

export const SIGNED_URL_TTL_SECONDS = 300;
export const MAX_UPLOADS_PER_HOUR = 60;
export const MAX_INVOICE_LIST_ROWS = 100;
export const MAX_FILENAME_CHARS = 200;

export type InvoiceFileKind = "pdf" | "jpg" | "png";

export const KIND_MIME: Record<InvoiceFileKind, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  png: "image/png",
};

/** File name extensions (lower case, no dot) accepted for each kind. */
export const KIND_EXTENSIONS: Record<InvoiceFileKind, readonly string[]> = {
  pdf: ["pdf"],
  jpg: ["jpg", "jpeg"],
  png: ["png"],
};
