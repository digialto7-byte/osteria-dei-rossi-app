// Extraction constants (M3 plan §3), each named once. Later steps add the rest of the table.

// Lives in src/lib/env (which next.config.ts loads with relative imports only); re-exported here.
export { MIN_CRON_SECRET_CHARS } from "@/lib/env";

/** Attempts per invoice before it ends in `extraction_failed` (plan §3.7). */
export const MAX_EXTRACTION_ATTEMPTS = 3;
/** Wait after the 1st and 2nd failed attempt; the 3rd failure is final. */
export const EXTRACTION_BACKOFF_SECONDS = [60, 300] as const;
/** SDK request timeout; stays below the route's duration limit. */
export const EXTRACTION_TIMEOUT_MS = 90_000;
/** `maxDuration` of the extract route (the route needs a literal; a test pins it to this). */
export const EXTRACT_MAX_DURATION_S = 120;
/** Longer than the route's duration, so a live run is never reclaimed. Mirrors `app.extraction_due()`. */
export const EXTRACTION_LEASE_SECONDS = 180;
/** 401/403 from the provider is a configuration fault: it does not burn an attempt. */
export const PROVIDER_AUTH_BACKOFF_SECONDS = 900;
/**
 * Output ceiling per call: holds the header and MAX_EXTRACTED_LINES lines at the estimates below
 * (tests/server/extraction/budget.test.ts). It is a ceiling, not a price: only generated tokens
 * are billed. Time is the tighter limit: EXTRACTION_TIMEOUT_MS bounds every call. On a fast model
 * a very long invoice that a 16 000 ceiling ended at once as "too long" can now run into the
 * timeout instead, which is retried (up to MAX_EXTRACTION_ATTEMPTS calls). The model in
 * EXTRACTION_MODEL_ID must allow at least this many output tokens, or every call is rejected.
 * The estimates are not measured yet; the extraction log records outputTokens and durationMs.
 */
export const EXTRACTION_MAX_TOKENS = 36_000;
export const MAX_EXTRACTED_LINES = 200;
/** JSON (keys, numbers, nulls) runs at about 3 characters per token. An estimate, not measured. */
export const EST_CHARS_PER_OUTPUT_TOKEN = 3;
/**
 * Per line, pretty-printed, every field filled and a 60-character description (about 166).
 * An AT8 line (codes, lot and expiry null) is about 105 compact.
 */
export const EST_OUTPUT_TOKENS_PER_LINE = 170;
/** The header fields and their confidences. */
export const EST_HEADER_OUTPUT_TOKENS = 500;
export const MAX_DESCRIPTION_CHARS = 500;
/** Totals gate, in ten-thousandths of a euro (integer maths): 500 = 0.05 EUR (PRD 1.2). */
export const TOTAL_TOLERANCE_TEN_THOUSANDTHS = 500;
/** qty x unit_price against the line amount. */
export const LINE_AMOUNT_TOLERANCE_TEN_THOUSANDTHS = 500;
/** A field below this confidence is flagged `low_confidence`. */
export const LOW_CONFIDENCE_THRESHOLD = 0.8;
/** A field that fails a deterministic check is capped at this confidence. */
export const FAILED_CHECK_CONFIDENCE = 0.3;
/** Italian statutory VAT rates; the tenant's own list is plan Q20. */
export const ALLOWED_VAT_RATES = [0, 4, 5, 10, 22] as const;
