import { TODAY_ALERT_CAP } from "@/server/today/constants";

// Twins of the SQL constants (supabase/migrations/20261108100000 and 20261108100100). tests/parity/dashboard-sql-parity.test.ts
// fails if one side changes alone.

/** Plates in the "worst" ranking: app.dashboard_worst_plates(). */
export const DASHBOARD_WORST_PLATES = 5;
/** Rows shown per list on a tile: app.dashboard_list_cap(). */
export const DASHBOARD_LIST_CAP = 5;
/** Payables are "due soon" this many days ahead: app.payable_due_soon_days(), M9's reminder window. */
export const DUE_SOON_DAYS = 7;
/** Open alerts counted before the card says "more": app.dashboard_alert_cap(), the same as Oggi's. */
export const DASHBOARD_ALERT_CAP = TODAY_ALERT_CAP;

/** Price-variance rows and today-list rows the SQL returns (plan §3.1.6). */
export const DASHBOARD_PRICE_VARIANCE_ITEMS = 3;
export const DASHBOARD_TODAY_LIST_ITEMS = 10;

/** How often the page may refetch on focus. */
export const DASHBOARD_REFRESH_MS = 60_000;
