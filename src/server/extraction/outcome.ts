import type { Message } from "@anthropic-ai/sdk/resources/messages/messages";
import { APIConnectionTimeoutError, APIError } from "@anthropic-ai/sdk";
import { InvoiceExtraction } from "@/server/extraction/schema";

export type FailureCode =
  | "provider_timeout"
  | "provider_unavailable"
  | "provider_rate_limited"
  | "provider_auth"
  | "provider_rejected"
  | "refused"
  | "output_truncated"
  | "schema_invalid";

export interface Failure {
  ok: false;
  code: FailureCode;
  /** Worth another attempt after a backoff. */
  retryable: boolean;
  /** Configuration fault (401/403): give the attempt back and wait long, do not burn it. */
  release: boolean;
}

const failure = (code: FailureCode, retryable: boolean, release = false): Failure => ({
  ok: false,
  code,
  retryable,
  release,
});

/** Maps whatever the SDK call threw. Total: an unknown error counts as the provider being down. */
export function classifyError(error: unknown): Failure {
  if (error instanceof APIConnectionTimeoutError) return failure("provider_timeout", true);
  if (error instanceof APIError) {
    const status = error.status;
    if (status === undefined) return failure("provider_unavailable", true);
    if (status === 401 || status === 403) return failure("provider_auth", false, true);
    if (status === 429) return failure("provider_rate_limited", true);
    if (status >= 500) return failure("provider_unavailable", true);
    return failure("provider_rejected", false);
  }
  return failure("provider_unavailable", true);
}

/** Maps a returned message to validated data, or to a failure. Raw output is never kept. */
export function classifyResponse(
  message: Pick<Message, "stop_reason" | "content">,
): { ok: true; data: InvoiceExtraction } | Failure {
  if (message.stop_reason === "refusal") return failure("refused", false);
  if (message.stop_reason === "max_tokens") return failure("output_truncated", false);
  const block = message.content.find((item) => item.type === "text");
  if (!block || block.type !== "text") return failure("schema_invalid", false);
  let raw: unknown;
  try {
    raw = JSON.parse(block.text);
  } catch {
    return failure("schema_invalid", false);
  }
  const parsed = InvoiceExtraction.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  // More lines than the schema takes: the invoice is too long, which is what output_truncated
  // tells the owner (schema_invalid would read as a faulty answer). Zod reports only the length
  // once the cap is exceeded, so faults inside the lines are not seen then; header faults are.
  const tooLong = parsed.error.issues.every(
    (issue) => issue.code === "too_big" && issue.path.length === 1 && issue.path[0] === "lines",
  );
  return failure(tooLong ? "output_truncated" : "schema_invalid", false);
}

const MAX_REASON_CHARS = 300;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object";

/** The request id the SDK attached to an error (header), else the one in the error body. */
export function requestIdOf(error: unknown): string | null {
  if (!(error instanceof APIError)) return null;
  if (error.requestID) return error.requestID;
  const fromBody = isRecord(error.error) ? error.error.request_id : null;
  return typeof fromBody === "string" ? fromBody : null;
}

/**
 * Why the API refused a request (HTTP 4xx): the `type` and `message` of its error body, which it
 * generates itself and which hold no invoice content. Nothing of the request is read. Null for
 * anything else (5xx, network, timeouts).
 */
export function apiErrorReasonOf(
  error: unknown,
): { type: string | null; message: string | null } | null {
  if (!(error instanceof APIError)) return null;
  if (error.status === undefined || error.status < 400 || error.status >= 500) return null;
  const inner = isRecord(error.error) && isRecord(error.error.error) ? error.error.error : null;
  const type = typeof inner?.type === "string" ? inner.type : (error.type ?? null);
  const message = typeof inner?.message === "string" ? inner.message : null;
  return { type, message: message === null ? null : message.slice(0, MAX_REASON_CHARS) };
}
