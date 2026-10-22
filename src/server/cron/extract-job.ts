import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api/errors";
import { readExtractionEnv, type ExtractionEnv } from "@/lib/env";
import { reportError } from "@/lib/observability/report";
import type { ExtractionClient } from "@/server/extraction/client";
import type { CheckedExtraction } from "@/server/extraction/checks";
import {
  EXTRACTION_BACKOFF_SECONDS,
  EXTRACTION_LEASE_SECONDS,
  MAX_EXTRACTION_ATTEMPTS,
  PROVIDER_AUTH_BACKOFF_SECONDS,
} from "@/server/extraction/constants";
import { extractInvoice } from "@/server/extraction/extract";
import { INVOICE_BUCKET } from "@/server/invoices/constants";
import { checkInvoiceFile } from "@/server/invoices/file-check";

export interface ExtractionJobDeps {
  /** The secret-key client; this module is only reachable from the cron route. */
  admin: SupabaseClient;
  makeClient: (env: ExtractionEnv) => ExtractionClient;
  readEnv?: () => ExtractionEnv;
  now: () => number;
}

export type ExtractionJobResult = { claimed: null } | { claimed: string; status: string };

interface ClaimedInvoice {
  id: string;
  tenant_id: string;
  file_path: string;
  file_mime: string;
  claim_token: string;
}

type Local = "file_mismatch" | "storage_unavailable" | "store_failed" | "provider_auth";

/** The jsonb extraction_complete stores (see the migration for the shape). */
function buildResult(checked: CheckedExtraction) {
  const { data } = checked;
  return {
    header: {
      supplier_vat: data.supplier_vat,
      supplier_name: data.supplier_name,
      number_raw: data.invoice_number,
      invoice_date: data.invoice_date,
      due_date: data.due_date,
      payment_terms: data.payment_terms,
      net_total: data.net_total,
      vat_total: data.vat_total,
      gross_total: data.gross_total,
    },
    lines: data.lines.map(({ confidence, ...line }, index) => ({
      raw_description: line.description,
      supplier_code: line.supplier_code,
      qty: line.qty,
      unit_raw: line.unit,
      unit_price: line.unit_price,
      line_amount: line.line_amount,
      vat_rate: line.vat_rate,
      lot_code: line.lot_code,
      expiry: line.expiry,
      field_confidence: confidence,
      checks: checked.lineChecks[index] ?? [],
      extracted: line,
    })),
    gate_flags: checked.gateFlags,
    totals_diff: checked.totalsDiff,
    field_confidence: data.confidence,
    extraction_json: data,
  };
}

/**
 * Takes one invoice from the queue and drives it to review, duplicate or a failure state. The
 * stored document is untrusted: it is re-checked from its bytes and only ever sent to the model
 * as a content block. Logs and Sentry get ids, codes and timings, never content.
 */
export async function runExtractionJob(deps: ExtractionJobDeps): Promise<ExtractionJobResult> {
  const { admin } = deps;
  // First, so a missing key or model ID fails before any invoice is touched.
  const env = (deps.readEnv ?? readExtractionEnv)();

  const claim = await admin.rpc("extraction_claim", {
    p_lease_seconds: EXTRACTION_LEASE_SECONDS,
    p_max_attempts: MAX_EXTRACTION_ATTEMPTS,
  });
  if (claim.error) throw new Error(`extraction_claim failed (${claim.error.code ?? "no code"})`);
  const rows = (claim.data ?? []) as ClaimedInvoice[];
  const invoice = rows[0];
  if (!invoice) return { claimed: null };

  const status = async (
    rpc: "extraction_fail" | "extraction_release",
    args: Record<string, unknown>,
  ): Promise<string> => {
    const { data, error } = await admin.rpc(rpc, {
      p_invoice: invoice.id,
      p_claim_token: invoice.claim_token,
      ...args,
    });
    if (error) throw new Error(`${rpc} failed for ${invoice.id} (${error.code ?? "no code"})`);
    return String(data);
  };
  const fail = async (code: string, retryable: boolean) => ({
    claimed: invoice.id,
    status: await status("extraction_fail", {
      p_code: code,
      p_retryable: retryable,
      p_backoff_seconds: [...EXTRACTION_BACKOFF_SECONDS],
      p_max_attempts: MAX_EXTRACTION_ATTEMPTS,
    }),
  });
  const failLocal = (code: Local, retryable: boolean) => fail(code, retryable);

  // Defence in depth on top of the path check constraint: stay inside the tenant's folder.
  if (!invoice.file_path.startsWith(`${invoice.tenant_id}/`)) {
    return failLocal("file_mismatch", false);
  }

  const download = await admin.storage.from(INVOICE_BUCKET).download(invoice.file_path);
  if (download.error || !download.data) return failLocal("storage_unavailable", true);
  const bytes = new Uint8Array(await download.data.arrayBuffer());

  let kind;
  try {
    kind = checkInvoiceFile({
      bytes,
      declaredMime: invoice.file_mime,
      filename: invoice.file_path,
    }).kind;
  } catch (error) {
    if (error instanceof ApiError) return failLocal("file_mismatch", false);
    throw error;
  }

  // The tenant's own VAT number, so that the buyer's number is not stored as the supplier's.
  const tenant = await admin
    .from("tenant")
    .select("vat_number")
    .eq("id", invoice.tenant_id)
    .single();
  // A transient database error: give the claim back for a retry before any paid call.
  if (tenant.error) return failLocal("storage_unavailable", true);
  const tenantVat = (tenant.data as { vat_number: string | null } | null)?.vat_number ?? null;

  const outcome = await extractInvoice(
    { bytes, kind },
    { client: deps.makeClient(env), modelId: env.modelId, now: deps.now, tenantVat },
  );

  if (!outcome.ok) {
    if (outcome.release) {
      reportError(new Error(`extraction provider_auth for invoice ${invoice.id}`));
      return {
        claimed: invoice.id,
        status: await status("extraction_release", {
          p_code: outcome.code,
          p_backoff_seconds: PROVIDER_AUTH_BACKOFF_SECONDS,
        }),
      };
    }
    return fail(outcome.code, outcome.retryable);
  }

  const stored = await admin.rpc("extraction_complete", {
    p_invoice: invoice.id,
    p_claim_token: invoice.claim_token,
    p_result: buildResult(outcome.result),
    p_model: env.modelId,
  });
  if (stored.error) {
    // Ids and SQLSTATE only: the message of a DB error can quote extracted content.
    reportError(
      new Error(`extraction_complete failed for ${invoice.id} (${stored.error.code ?? "no code"})`),
    );
    // The call is paid for, so keep the result chance alive: retry through the normal backoff,
    // unless the database rejected the data itself (SQLSTATE class 22 data exception or 23
    // constraint violation), which a retry cannot fix.
    const code = stored.error.code ?? "";
    return failLocal("store_failed", !code.startsWith("22") && !code.startsWith("23"));
  }
  return { claimed: invoice.id, status: String(stored.data) };
}
