// Constants of the service periods (M25c plan §3.4). Mirrors 20261120100000_service_core.sql and 20261120100300_service_settings.sql
// (tests/parity/services-constants.test.ts). The SQL stays the authority; these only turn the obvious mistakes into a 400 before any RPC.

/** At most this many services in a version (app.service_max_periods()). */
export const SERVICE_MAX_PERIODS = 6;
/** A service name is 1 to this many characters, trimmed. */
export const SERVICE_NAME_MAX = 30;
/** A stable service key: it survives a rename. */
export const SERVICE_KEY = /^[a-z][a-z0-9_]{1,31}$/;
/** The wall time a service starts, HH:MM, 00:00 to 23:59. */
export const SERVICE_START = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
/** Six periods of the longest allowed size fit well inside this. */
export const MAX_SERVICES_BODY_BYTES = 2048;
/** The DETAIL reasons of a P0001 service_periods_invalid (codes only). */
export const SERVICE_PERIOD_REASONS = [
  "count",
  "name",
  "start",
  "key",
  "key_unknown",
  "key_twice",
  "name_twice",
  "start_twice",
] as const;
export type ServicePeriodReason = (typeof SERVICE_PERIOD_REASONS)[number];
