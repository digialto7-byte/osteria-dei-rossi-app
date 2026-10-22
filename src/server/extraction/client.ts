import Anthropic from "@anthropic-ai/sdk";
import type { Message } from "@anthropic-ai/sdk/resources/messages/messages";
import type { ExtractionEnv } from "@/lib/env";
import { EXTRACTION_MAX_TOKENS, EXTRACTION_TIMEOUT_MS } from "@/server/extraction/constants";
import { SYSTEM_PROMPT, USER_INSTRUCTION } from "@/server/extraction/prompt";
import { toWireSchema } from "@/server/extraction/schema";
import { KIND_MIME, type InvoiceFileKind } from "@/server/invoices/constants";

export type ExtractionClient = Anthropic;

/**
 * maxRetries is 0 on purpose: our own attempts (with persisted backoff) replace the SDK's
 * automatic retries, so `attempts` counts every call and one invocation stays within its limit.
 */
export function createExtractionClient(
  env: Pick<ExtractionEnv, "anthropicApiKey">,
  fetchImpl?: typeof fetch,
  timeoutMs: number = EXTRACTION_TIMEOUT_MS,
): ExtractionClient {
  return new Anthropic({
    apiKey: env.anthropicApiKey,
    maxRetries: 0,
    timeout: timeoutMs,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
}

export interface ExtractionFile {
  bytes: Uint8Array;
  kind: InvoiceFileKind;
}

function documentBlock({ bytes, kind }: ExtractionFile) {
  const data = Buffer.from(bytes).toString("base64");
  if (kind === "pdf") {
    return {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data },
    } as const;
  }
  const media_type = KIND_MIME[kind] as "image/jpeg" | "image/png";
  return { type: "image", source: { type: "base64", media_type, data } } as const;
}

/** One Messages call: no tools, no sampling parameters, the document in the user message. */
export function requestExtraction(
  client: ExtractionClient,
  modelId: string,
  file: ExtractionFile,
): Promise<Message> {
  return client.messages.create({
    model: modelId,
    max_tokens: EXTRACTION_MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [documentBlock(file), { type: "text", text: USER_INSTRUCTION }],
      },
    ],
    output_config: { format: { type: "json_schema", schema: toWireSchema() } },
  });
}
