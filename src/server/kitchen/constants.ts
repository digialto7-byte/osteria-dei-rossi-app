/** The kitchen screen reads the list this often while it is visible (M19 plan §3.1.9; instant updates are variant V2). */
export const KITCHEN_POLL_MS = 5_000;
/** The stale banner shows when the last successful read is older than this, by the screen's own clock (§3.1.10). */
export const KITCHEN_STALE_MS = 60_000;
/** Mirrors the cap of app.kitchen_ticket_rows: the newest 200 tickets, with `truncated`. */
export const KITCHEN_MAX_TICKETS = 200;
