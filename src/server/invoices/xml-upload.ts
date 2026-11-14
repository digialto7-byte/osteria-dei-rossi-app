import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api/errors";
import type { TenantSession } from "@/lib/api/with-api";
import { reportError } from "@/lib/observability/report";
import { venueYear } from "@/lib/time/venue-date";
import { unwrapP7m } from "@/server/fatturapa/cms";
import { FatturaError } from "@/server/fatturapa/errors";
import { mapFattura, type MappedFile } from "@/server/fatturapa/map";
import { XmlImportPayload } from "@/server/fatturapa/schema";
import { readFatturaXml } from "@/server/fatturapa/xml";
import { INVOICE_BUCKET, MAX_UPLOADS_PER_HOUR } from "@/server/invoices/constants";
import { checkInvoiceFile, sanitiseFilename } from "@/server/invoices/file-check";
import {
  UPLOAD_COLUMNS,
  rateLimited,
  recentUploadCount,
  storageUploadError,
  toUploadedInvoice,
  unwrap,
  type UploadedFile,
  type UploadedInvoice,
  type UploadedInvoiceRow,
} from "@/server/invoices/invoices";
import { mapReviewError } from "@/server/invoices/review-errors";
import { fatturaToApiError } from "@/server/invoices/xml-errors";
import type { DbError } from "@/server/master/db-errors";

/** One invoice made from one body of the file, as the upload answers. */
export interface XmlUploadedInvoice {
  id: string;
  status: string;
  bodyIndex: number;
  bodyCount: number;
  number: string;
  invoiceDate: string;
  supplierName: string;
  grossTotal: number;
  duplicateOf: string | null;
}

export interface XmlUploadResult {
  invoice: UploadedInvoice;
  invoices: XmlUploadedInvoice[];
}

interface PrecheckReply {
  alreadyUploaded: { id: string; bodyIndex: number; status: string }[];
  buyer: "match" | "mismatch";
  issuedByTenant: boolean;
}

interface ImportedRow {
  id: string;
  bodyIndex: number;
  status: string;
  duplicateOf: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Reads the file. A refusal is a FatturaError, turned into a 422. Anything else is a bug: it is rethrown as a plain
 * error with the error's name only, because a library's message may quote the file.
 */
function parseFile(bytes: Uint8Array, kind: "xml" | "p7m"): { mapped: MappedFile; sha256: string } {
  try {
    const xml = kind === "p7m" ? unwrapP7m(bytes) : bytes;
    const mapped = mapFattura(readFatturaXml(xml));
    return { mapped, sha256: createHash("sha256").update(xml).digest("hex") };
  } catch (error) {
    if (error instanceof FatturaError) throw fatturaToApiError(error);
    throw new Error(
      `E-invoice reader failed unexpectedly (${error instanceof Error ? error.name : typeof error})`,
    );
  }
}

/** The import's own refusals: P0001 codes the screen can act on; the rest is a bug reported by its code. */
function importError(error: DbError): ApiError | Error {
  if (error.code === "P0001" && error.message === "already_uploaded") {
    const invoiceId = error.details && UUID.test(error.details) ? error.details : undefined;
    return new ApiError(
      409,
      "already_uploaded",
      "Questo file è già stato caricato.",
      invoiceId ? { invoiceId } : undefined,
    );
  }
  // The payload was built by us and its objects were just uploaded: these two mean a bug, not a user error.
  if (
    error.code === "P0001" &&
    (error.message === "file_missing" || error.message === "invalid_request")
  ) {
    return new Error(`import_xml_invoices refused the payload: ${error.message}`);
  }
  return mapReviewError(error);
}

/**
 * Imports an XML or p7m e-invoice file, running as the signed-in user. Order: hourly limit, file check, parse (pure),
 * precheck, one Storage upload per body, one import call. Every refusal of the file happens before anything is stored,
 * because invoices cannot be deleted. After the uploads a failure leaves inert objects in the tenant's private folder;
 * they are reported by invoice id and status only.
 */
export async function storeXmlUpload(
  supabase: SupabaseClient,
  session: Pick<TenantSession, "tenantId">,
  file: UploadedFile,
  now: Date,
): Promise<XmlUploadResult> {
  const recent = await recentUploadCount(supabase, now);
  if (recent >= MAX_UPLOADS_PER_HOUR) throw rateLimited();

  const checked = checkInvoiceFile(file);
  if (checked.kind !== "xml" && checked.kind !== "p7m") {
    throw new Error("storeXmlUpload was given a document that is not an e-invoice file");
  }
  const { mapped, sha256 } = parseFile(file.bytes, checked.kind);
  const bodyCount = mapped.bodies.length;
  if (recent + bodyCount > MAX_UPLOADS_PER_HOUR) throw rateLimited();

  const supplierVat = mapped.bodies[0]!.header.supplierVat;
  const pre = await supabase.rpc("invoice_xml_precheck", {
    p_sha256: sha256,
    p_supplier_vat: supplierVat,
    p_buyer_vat: mapped.buyer.vat,
    p_buyer_cf: mapped.buyer.cf,
  });
  if (pre.error) throw mapReviewError(pre.error);
  const reply = pre.data as PrecheckReply;
  const first = reply.alreadyUploaded[0];
  if (first) {
    throw new ApiError(409, "already_uploaded", "Questo file è già stato caricato.", {
      invoiceId: first.id,
    });
  }
  if (reply.issuedByTenant) {
    throw new ApiError(
      422,
      "xml_issued_by_tenant",
      "Questa fattura è emessa dal locale, non da un fornitore.",
    );
  }
  if (reply.buyer !== "match") {
    throw new ApiError(
      422,
      "xml_not_addressed_to_tenant",
      "Questa fattura è intestata a un'altra partita IVA, non al locale.",
    );
  }

  // Ids and paths first, so the payload is checked against its strict schema before the first byte is stored.
  const year = venueYear(now);
  const stored = mapped.bodies.map((_, index) => {
    const id = randomUUID();
    return { id, bodyIndex: index + 1, path: `${session.tenantId}/${year}/${id}.${checked.ext}` };
  });
  const payload = XmlImportPayload.safeParse({
    sha256,
    format: mapped.format,
    bodyCount,
    buyer: mapped.buyer,
    invoices: mapped.bodies.map((body, index) => ({
      id: stored[index]!.id,
      filePath: stored[index]!.path,
      fileMime: checked.mime,
      fileSizeBytes: checked.sizeBytes,
      originalFilename: sanitiseFilename(file.filename),
      bodyIndex: index + 1,
      documentType: body.documentType,
      notes: body.notes,
      header: body.header,
      lines: body.lines,
      vatSummary: body.vatSummary,
    })),
  });
  if (!payload.success) {
    // A bug in the mapper, not a user error. Field paths only: an issue's message could quote a value.
    const paths = [...new Set(payload.error.issues.map((issue) => issue.path.join(".")))].slice(
      0,
      5,
    );
    throw new Error(`E-invoice import payload failed its own schema (${paths.join(", ")})`);
  }

  for (const [index, target] of stored.entries()) {
    const result = await supabase.storage
      .from(INVOICE_BUCKET)
      .upload(target.path, file.bytes, { contentType: checked.mime, upsert: false });
    if (result.error) {
      const failure = storageUploadError(result.error);
      if (index > 0) {
        const raw = String(result.error.statusCode ?? "");
        const upstream = /^[A-Za-z0-9_-]{1,30}$/.test(raw) ? raw : "unknown";
        const orphans = stored
          .slice(0, index)
          .map((s) => s.id)
          .join(", ");
        reportError(
          new Error(
            `E-invoice upload failed at body ${index + 1} of ${bodyCount} (storage status ${upstream}, answered ${failure.status}); objects left in storage for invoices ${orphans}`,
          ),
        );
      }
      throw failure;
    }
  }

  const imported = await supabase.rpc("import_xml_invoices", { p_payload: payload.data });
  if (imported.error) {
    // The objects stay (the bucket has no delete policy): report their ids and the code, nothing from the file.
    const sqlstate = /^[0-9A-Z]{5}$/.test(imported.error.code ?? "")
      ? imported.error.code
      : "unknown";
    const token = /^[a-z_]{1,40}$/.test(imported.error.message ?? "")
      ? ` ${imported.error.message}`
      : "";
    reportError(
      new Error(
        `E-invoice import failed after upload (${sqlstate}${sqlstate === "P0001" ? token : ""}); objects left in storage for invoices ${stored.map((s) => s.id).join(", ")}`,
      ),
    );
    throw importError(imported.error);
  }
  const rows = imported.data as ImportedRow[];

  const firstRow = unwrap(
    await supabase.from("invoice").select(UPLOAD_COLUMNS).eq("id", rows[0]!.id).single(),
  ) as UploadedInvoiceRow;
  return {
    invoice: toUploadedInvoice(firstRow),
    invoices: rows.map((row) => {
      const body = mapped.bodies[row.bodyIndex - 1]!;
      return {
        id: row.id,
        status: row.status,
        bodyIndex: row.bodyIndex,
        bodyCount,
        number: body.header.numberRaw,
        invoiceDate: body.header.invoiceDate,
        supplierName: body.header.supplierName,
        grossTotal: Number(body.header.grossTotal),
        duplicateOf: row.duplicateOf,
      };
    }),
  };
}
