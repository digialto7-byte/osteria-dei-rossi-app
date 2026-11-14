// The caps of the trace reads (P2-2 plan D-P12). Each mirrors a key of app.trace_constants() in migration 20261203100000;
// tests/parity/trace-constants.test.ts keeps them in step. The SQL stays the authority.

/** Most lots a search answers (`truncated` says when there are more). */
export const TRACE_MAX_LOTS = 50;
/** Most batches in a forward trace. */
export const TRACE_MAX_BATCHES = 200;
/** Most plate groups (business day and dish) in a trace. */
export const TRACE_MAX_PLATE_GROUPS = 400;
/** Most lines in a served-plate search. */
export const TRACE_MAX_LINES = 200;
/** Longest date range of a search or of the capture rate, in days. */
export const TRACE_MAX_RANGE_DAYS = 366;
/** Deepest split chain the family walk follows. */
export const TRACE_SPLIT_DEPTH = 50;
