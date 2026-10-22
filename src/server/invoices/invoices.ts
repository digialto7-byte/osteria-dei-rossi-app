import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api/errors";
import type { TenantSession } from "@/lib/api/with-api";
import { venueYear } from "@/lib/time/venue-date";
import { INVOICE_BUCKET, MAX_UPLOADS_PER_HOUR } from "@/server/invoices/constants";
import { checkInvoiceFile, sanitiseFilename } from "@/server/invoices/file-check";
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
  if (stored.error) {
    throw new ApiError(502, "upstream_error", "Archiviazione non disponibile. Riprova tra poco.");
  }

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
