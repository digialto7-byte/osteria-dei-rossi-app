// Extraction constants (M3 plan §3), each named once. Later steps add the rest of the table.

/** Shortest CRON_SECRET accepted (`openssl rand -hex 32` gives 64). */
export const MIN_CRON_SECRET_CHARS = 32;

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
/** Room for MAX_EXTRACTED_LINES lines. */
export const EXTRACTION_MAX_TOKENS = 16_000;
export const MAX_EXTRACTED_LINES = 200;
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
