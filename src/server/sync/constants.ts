// The offline queue's limits and lists (M20 plan §3.5, ADR-022). Shared by the server (`/api/sync`) and the phone
// (src/lib/sync, src/pwa). The lists mirror the SQL; tests/parity/sync-sql-parity.test.ts keeps them in step.

/** Mirrors app.sync_op_kinds(), in order. M21 adds `close_table` to the SQL list, the dispatcher and this list together. */
export const SYNC_KINDS = [
  "open_table",
  "add_line",
  "edit_line",
  "remove_line",
  "fire",
  "void_line",
] as const;
export type SyncKind = (typeof SYNC_KINDS)[number];

/** Mirrors app.sync_conflict_codes(): the raised P0001 messages that count as a `conflict`, not a `rejected`. */
export const SYNC_CONFLICT_CODES = ["session_closed", "table_already_open"] as const;

/** One request carries 1 to 20 ops, at most 64 KiB. */
export const MAX_SYNC_OPS = 20;
export const MAX_SYNC_BODY_BYTES = 65_536;

/** The phone's retry delay doubles from 1 s to 15 s (ADR-005), with jitter. */
export const SYNC_BACKOFF_BASE_MS = 1_000;
export const SYNC_BACKOFF_MAX_MS = 15_000;
/** Ten server replies that leave the same first op unsettled raise the "stuck" notice; the op is never dropped. */
export const SYNC_STUCK_ATTEMPTS = 10;
/** One POST /api/sync is abandoned after this long (the phone aborts it and retries; the server is idempotent). */
export const SYNC_REQUEST_TIMEOUT_MS = 8_000;
/**
 * One replayer per device: the lease is renewed per batch and must outlast ONE send: the request timeout plus 4 s for the outbox work
 * around it (marking, settling). A page that is closed releases it at once (pagehide); one that vanishes silently holds it only this long.
 */
export const SYNC_LEASE_MS = SYNC_REQUEST_TIMEOUT_MS + 4_000;
/** The clock-skew warning shows beyond this difference between the phone and the server. */
export const CLOCK_SKEW_WARN_MS = 60_000;
/** The phone keeps settled outcomes (for the notices) this long. */
export const OUTCOME_KEEP_MS = 24 * 60 * 60 * 1_000;
/** The service worker waits this long for the network before it falls back to its cache (mirrored in public/sw.js). */
export const SW_TIMEOUT_MS = 3_000;
