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
  return parsed.success ? { ok: true, data: parsed.data } : failure("schema_invalid", false);
}

/** The request id the SDK attached to an error, if any. */
export function requestIdOf(error: unknown): string | null {
  return error instanceof APIError ? (error.requestID ?? null) : null;
}
