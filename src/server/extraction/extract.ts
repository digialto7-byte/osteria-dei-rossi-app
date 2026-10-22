import type { Message } from "@anthropic-ai/sdk/resources/messages/messages";
import { runChecks, type CheckedExtraction } from "@/server/extraction/checks";
import {
  requestExtraction,
  type ExtractionClient,
  type ExtractionFile,
} from "@/server/extraction/client";
import {
  classifyError,
  classifyResponse,
  requestIdOf,
  type Failure,
} from "@/server/extraction/outcome";

export interface ExtractionDeps {
  client: ExtractionClient;
  modelId: string;
  /** The tenant's own VAT number, so that the buyer is not taken for the supplier. */
  tenantVat?: string | null;
  /** Milliseconds clock, injected so tests do not depend on time. */
  now: () => number;
  /** Receives ids, codes, HTTP status and timings only (no class names: they get minified); defaults to console.warn. */
  log?: (entry: Record<string, string | number | null>) => void;
}

export interface ExtractionSuccess {
  ok: true;
  result: CheckedExtraction & { extractionJson: CheckedExtraction["data"] };
  durationMs: number;
  requestId: string | null;
}

export type ExtractionFailure = Failure & { durationMs: number; requestId: string | null };
export type ExtractionOutcome = ExtractionSuccess | ExtractionFailure;

const defaultLog = (entry: Record<string, string | number | null>) =>
  console.warn(JSON.stringify({ event: "extraction", ...entry }));

/** Calls the model once, validates the output and runs the deterministic checks. */
export async function extractInvoice(
  file: ExtractionFile,
  deps: ExtractionDeps,
): Promise<ExtractionOutcome> {
  const log = deps.log ?? defaultLog;
  const started = deps.now();
  const durationMs = () => deps.now() - started;

  let message: Message;
  try {
    message = await requestExtraction(deps.client, deps.modelId, file);
  } catch (error) {
    const classified = classifyError(error);
    const requestId = requestIdOf(error);
    const status = (error as { status?: number } | null)?.status ?? null;
    log({
      outcome: classified.code,
      status,
      requestId,
      durationMs: durationMs(),
    });
    return { ...classified, durationMs: durationMs(), requestId };
  }

  const requestId = (message as Message & { _request_id?: string | null })._request_id ?? null;
  const classified = classifyResponse(message);
  if (!classified.ok) {
    log({
      outcome: classified.code,
      stopReason: message.stop_reason,
      requestId,
      durationMs: durationMs(),
    });
    return { ...classified, durationMs: durationMs(), requestId };
  }

  const checked = runChecks(classified.data, { tenantVat: deps.tenantVat });
  log({
    outcome: "ok",
    stopReason: message.stop_reason,
    requestId,
    flags: checked.gateFlags.join(","),
    durationMs: durationMs(),
  });
  return {
    ok: true,
    result: { ...checked, extractionJson: checked.data },
    durationMs: durationMs(),
    requestId,
  };
}
