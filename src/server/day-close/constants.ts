// Constants of the end-of-day screen (M21 plan §3.5). Mirrors 20261110100300_day_close.sql (tests/parity/close-sql-parity.test.ts).

/** The register total travels as a decimal string: 0 to 9 999 999,99 with at most two decimals (enter_day_close). */
export const REGISTER_TOTAL = /^[0-9]{1,7}(\.[0-9]{1,2})?$/;
/** A business date from this many days back up to today's is accepted (app.day_close_range_ok). */
export const DAY_CLOSE_MAX_DAYS_BACK = 62;
/** A day-close body is a date and a short string. */
export const MAX_DAY_CLOSE_BODY_BYTES = 1024;
