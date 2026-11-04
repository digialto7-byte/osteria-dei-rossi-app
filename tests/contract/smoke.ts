// Decides whether the one-call smoke contract can run, and judges its outcome. Pure: no network,
// no clock. Only variable NAMES and failure codes ever leave this module, never invoice values.
import type { ExtractionOutcome } from "@/server/extraction/extract";
import { InvoiceExtraction } from "@/server/extraction/schema";
import { MAX_MODEL_CALL_MS } from "./compare";

/** The smoke needs the two secrets and nothing else (no invoice pairs). */
export const SMOKE_REQUIRED_ENV = ["ANTHROPIC_API_KEY", "EXTRACTION_MODEL_ID"] as const;

export interface SmokePreflight {
  ready: boolean;
  missing: string[];
}

export function smokePreflight(env: Record<string, string | undefined>): SmokePreflight {
  const missing: string[] = SMOKE_REQUIRED_ENV.filter((name) => !env[name]?.trim());
  return { ready: missing.length === 0, missing };
}

/** The GitHub Actions annotation shown when the smoke is skipped. */
export function renderSmokeNotice(result: SmokePreflight): string {
  return `::notice title=Smoke contract skipped::${result.missing.join(", ")}`;
}

export interface SmokeVerdict {
  ok: boolean;
  problems: string[];
}

/**
 * Passes when the API answered (no provider_rejected or other failure), the answer fits the full
 * InvoiceExtraction schema, and the call took under the 60 s limit. Extracted values are never
 * judged: a synthetic invoice may legitimately come back with nulls.
 */
export function smokeVerdict(outcome: ExtractionOutcome): SmokeVerdict {
  const problems: string[] = [];
  if (!outcome.ok) {
    problems.push(`extraction failed: ${outcome.code}`);
  } else if (!InvoiceExtraction.safeParse(outcome.result.extractionJson).success) {
    problems.push("response does not match the InvoiceExtraction schema");
  }
  if (outcome.durationMs >= MAX_MODEL_CALL_MS) {
    problems.push(`model call took ${outcome.durationMs} ms (limit ${MAX_MODEL_CALL_MS} ms)`);
  }
  return { ok: problems.length === 0, problems };
}
