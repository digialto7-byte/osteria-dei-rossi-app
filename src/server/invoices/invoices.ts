import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import type { TenantSession } from "@/lib/api/with-api";
import { venueYear } from "@/lib/time/venue-date";
import {
  INVOICE_BUCKET,
  MAX_INVOICE_LIST_ROWS,
  MAX_UPLOADS_PER_HOUR,
  SIGNED_URL_TTL_SECONDS,
} from "@/server/invoices/constants";
import {
  FILE_TOO_LARGE_MESSAGE,
  checkInvoiceFile,
  sanitiseFilename,
  unsupportedFileType,
} from "@/server/invoices/file-check";
import { mapDbError, type DbError } from "@/server/master/db-errors";

const HOUR_MS = 3_600_000;
const FILE_PART = "file";

/** What the upload endpoint returns. The storage path is never part of it. */
export interface UploadedInvoice {
  id: string;
  status: string;
  source: string;
  fileMime: string;
  fileSizeBytes: number;
  originalFilename: string | null;
  createdAt: string;
}

interface UploadedInvoiceRow {
  id: string;
  status: string;
  source: string;
  file_mime: string;
  file_size_bytes: number;
  original_filename: string | null;
  created_at: string;
}

const UPLOAD_COLUMNS =
  "id, status, source, file_mime, file_size_bytes, original_filename, created_at";

export function toUploadedInvoice(row: UploadedInvoiceRow): UploadedInvoice {
  return {
    id: row.id,
    status: row.status,
    source: row.source,
    fileMime: row.file_mime,
    fileSizeBytes: row.file_size_bytes,
    originalFilename: row.original_filename,
    createdAt: row.created_at,
  };
}

export interface UploadedFile {
  bytes: Uint8Array;
  declaredMime: string;
  filename: string;
}

const badUpload = (message: string) => new ApiError(400, "invalid_request", message);

/** Reads the multipart body: exactly one part, named `file`, holding a file. */
export async function readUploadedFile(request: Request): Promise<UploadedFile> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw badUpload("La richiesta non è un modulo valido.");
  }
  const entries = [...form.entries()];
  if (entries.some(([name]) => name !== FILE_PART) || entries.length > 1) {
    throw badUpload("Invia un solo campo: file.");
  }
  const part = entries[0]?.[1];
  if (!(part instanceof File)) throw badUpload("Manca il file da caricare.");
  return {
    bytes: new Uint8Array(await part.arrayBuffer()),
    declaredMime: part.type,
    filename: part.name,
  };
}

function unwrap(result: { data: unknown; error: DbError | null }): unknown {
  if (result.error) throw mapDbError(result.error);
  return result.data;
}

/**
 * A refused Storage upload as an API error. storage-js puts the body's statusCode (else its code,
 * e.g. "InvalidJWT") in `statusCode`, and the HTTP status (often 400) in `status`: a numeric
 * statusCode wins, then the HTTP status. Anything unrecognised is 502.
 */
function storageUploadError(error: { status?: unknown; statusCode?: unknown }): ApiError {
  const fromBody = Number(error.statusCode);
  const status = Number.isFinite(fromBody) ? fromBody : Number(error.status);
  if (status === 401) {
    return new ApiError(401, "unauthenticated", "Sessione scaduta. Accedi di nuovo.");
  }
  if (status === 403) {
    return new ApiError(403, "forbidden", "Non hai i permessi per caricare fatture.");
  }
  if (status === 413) return new ApiError(413, "payload_too_large", FILE_TOO_LARGE_MESSAGE);
  if (status === 415) return unsupportedFileType();
  return new ApiError(502, "upstream_error", "Archiviazione non disponibile. Riprova tra poco.");
}

/**
 * Validates and stores an uploaded invoice document, running as the signed-in user (Storage and
 * table RLS both apply). Order: hourly limit, file check, Storage upload, row insert. The object
 * goes first so a failed upload never leaves a row pointing at nothing.
 */
export async function storeInvoiceUpload(
  supabase: SupabaseClient,
  session: Pick<TenantSession, "tenantId">,
  file: UploadedFile,
  now: Date,
): Promise<UploadedInvoice> {
  const since = new Date(now.getTime() - HOUR_MS).toISOString();
  const recent = await supabase
    .from("invoice")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);
  if (recent.error) throw mapDbError(recent.error);
  if ((recent.count ?? 0) >= MAX_UPLOADS_PER_HOUR) {
    throw new ApiError(
      429,
      "rate_limited",
      "Troppi caricamenti nell'ultima ora. Riprova tra poco.",
    );
  }

  const checked = checkInvoiceFile(file);
  const id = randomUUID();
  const path = `${session.tenantId}/${venueYear(now)}/${id}.${checked.ext}`;

  const stored = await supabase.storage
    .from(INVOICE_BUCKET)
    .upload(path, file.bytes, { contentType: checked.mime, upsert: false });
  if (stored.error) throw storageUploadError(stored.error);

  const inserted = await supabase
    .from("invoice")
    .insert({
      id,
      file_path: path,
      file_mime: checked.mime,
      file_size_bytes: checked.sizeBytes,
      original_filename: sanitiseFilename(file.filename),
    })
    .select(UPLOAD_COLUMNS)
    .single();
  if (inserted.error) {
    // The object stays in the tenant's private folder (inert). Only the id and SQLSTATE are
    // reported: no file name, no bytes. withApi sends this to Sentry and answers 500.
    throw new Error(
      `Invoice row insert failed after upload: invoice ${id}, SQLSTATE ${inserted.error.code ?? "(none)"}`,
    );
  }
  return toUploadedInvoice(unwrap(inserted) as UploadedInvoiceRow);
}

export const INVOICE_STATUSES = [
  "received",
  "extracting",
  "extraction_failed",
  "review",
  "approved",
  "rejected",
  "duplicate",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** An invoice as the list and detail endpoints show it. No storage path, ever. */
export interface InvoiceItem {
  id: string;
  status: InvoiceStatus;
  source: string;
  originalFilename: string | null;
  fileMime: string;
  fileSizeBytes: number;
  supplierVat: string | null;
  number: string | null;
  invoiceDate: string | null;
  duplicateOf: string | null;
  /** Same name, number and date as another invoice, but no VAT number to be sure (founder rule). */
  duplicateWarningOf: string | null;
  supplierName: string | null;
  dueDate: string | null;
  netTotal: number | null;
  vatTotal: number | null;
  grossTotal: number | null;
  /** Σ line amounts + VAT − gross, in euros; null when a total is missing. */
  totalsDiff: number | null;
  gateFlags: string[];
  extractionError: string | null;
  attempts: number;
  extractedAt: string | null;
  createdAt: string;
}

export interface InvoiceRow {
  id: string;
  status: InvoiceStatus;
  source: string;
  original_filename: string | null;
  file_mime: string;
  file_size_bytes: number;
  supplier_vat: string | null;
  number_raw: string | null;
  invoice_date: string | null;
  duplicate_of: string | null;
  duplicate_warning_of: string | null;
  supplier_name: string | null;
  due_date: string | null;
  net_total: number | null;
  vat_total: number | null;
  gross_total: number | null;
  totals_diff: number | null;
  gate_flags: string[];
  extraction_error: string | null;
  attempts: number;
  extracted_at: string | null;
  created_at: string;
}

// Explicit column list: file_path, extraction_json, field_confidence and claim_token are
// deliberately not in it (storage path, raw model output and the lease id stay on the server).
export const INVOICE_COLUMNS =
  "id, status, source, original_filename, file_mime, file_size_bytes, supplier_vat, supplier_name, number_raw, invoice_date, due_date, net_total, vat_total, gross_total, totals_diff, gate_flags, extraction_error, attempts, extracted_at, duplicate_of, duplicate_warning_of, created_at";

export function toInvoiceItem(row: InvoiceRow): InvoiceItem {
  return {
    id: row.id,
    status: row.status,
    source: row.source,
    originalFilename: row.original_filename,
    fileMime: row.file_mime,
    fileSizeBytes: row.file_size_bytes,
    supplierVat: row.supplier_vat,
    number: row.number_raw,
    invoiceDate: row.invoice_date,
    duplicateOf: row.duplicate_of,
    duplicateWarningOf: row.duplicate_warning_of,
    supplierName: row.supplier_name,
    dueDate: row.due_date,
    netTotal: row.net_total,
    vatTotal: row.vat_total,
    grossTotal: row.gross_total,
    totalsDiff: row.totals_diff,
    gateFlags: row.gate_flags ?? [],
    extractionError: row.extraction_error,
    attempts: row.attempts,
    extractedAt: row.extracted_at,
    createdAt: row.created_at,
  };
}

/** `?status=` one of the lifecycle states; `?before=` an ISO instant (cursor on created_at). */
export const listInvoicesQuery = z.object({
  status: z.enum(INVOICE_STATUSES).optional(),
  before: z.iso.datetime({ offset: true }).optional(),
});
export type ListInvoicesQuery = z.infer<typeof listInvoicesQuery>;

/** Parses the list filters from a URL; anything invalid is a 400. */
export function parseListInvoicesQuery(url: URL): ListInvoicesQuery {
  const parsed = listInvoicesQuery.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))];
    throw new ApiError(400, "invalid_request", `Filtri non validi: ${fields.join(", ")}`);
  }
  return parsed.data;
}

export async function listInvoices(
  supabase: SupabaseClient,
  filters: ListInvoicesQuery = {},
): Promise<InvoiceItem[]> {
  let query = supabase.from("invoice").select(INVOICE_COLUMNS);
  if (filters.status) query = query.eq("status", filters.status);
  // The cursor is passed on as received: re-formatting through Date would drop microseconds
  // and make the same row appear on two pages.
  if (filters.before) query = query.lt("created_at", filters.before);
  const rows = unwrap(
    await query.order("created_at", { ascending: false }).limit(MAX_INVOICE_LIST_ROWS),
  ) as InvoiceRow[];
  return rows.map(toInvoiceItem);
}

export async function getInvoice(supabase: SupabaseClient, id: string): Promise<InvoiceItem> {
  const row = unwrap(
    await supabase.from("invoice").select(INVOICE_COLUMNS).eq("id", id).maybeSingle(),
  ) as InvoiceRow | null;
  // RLS hides other tenants' rows and every row from chef and waiter: all read as missing.
  if (!row) throw new ApiError(404, "not_found", "Risorsa non trovata.");
  return toInvoiceItem(row);
}

export interface InvoiceFileUrl {
  url: string;
  expiresAt: string;
}

/**
 * A short-lived signed URL for the stored document. The row is read through RLS first, so an
 * invoice the caller cannot see is a 404 and Storage is never asked. The TTL parameter exists for
 * the real-stack test; the route always uses the default. The URL is a bearer link: never log it.
 */
export async function createInvoiceFileUrl(
  supabase: SupabaseClient,
  id: string,
  ttlSeconds: number = SIGNED_URL_TTL_SECONDS,
  now: Date = new Date(),
): Promise<InvoiceFileUrl> {
  const row = unwrap(
    await supabase.from("invoice").select("file_path").eq("id", id).maybeSingle(),
  ) as { file_path: string } | null;
  if (!row) throw new ApiError(404, "not_found", "Risorsa non trovata.");

  const signed = await supabase.storage
    .from(INVOICE_BUCKET)
    .createSignedUrl(row.file_path, ttlSeconds);
  if (signed.error || !signed.data?.signedUrl) {
    throw new ApiError(502, "upstream_error", "Documento non disponibile. Riprova tra poco.");
  }
  return {
    url: signed.data.signedUrl,
    expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
  };
}
