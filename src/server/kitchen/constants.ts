/** The kitchen screen reads the list this often while it is visible (M19 plan §3.1.9; instant updates are variant V2). */
export const KITCHEN_POLL_MS = 5_000;
/** The stale banner shows when the last successful read is older than this, by the screen's own clock (§3.1.10). */
export const KITCHEN_STALE_MS = 60_000;
/** Mirrors the cap of app.kitchen_ticket_rows: the newest 200 tickets, with `truncated`. */
export const KITCHEN_MAX_TICKETS = 200;
/** Ignore a second tap on one dish row for this long after its last change, so a double tap never undoes the first (M19b §3.1.3). */
export const KITCHEN_TAP_GUARD_MS = 600;
/** How long "Annulla" stays after a comanda closes (M19b §3.1.13). */
export const KITCHEN_UNDO_MS = 8_000;
/** The write bodies are tiny; anything larger is refused before it is read (413). */
export const MAX_KITCHEN_BODY_BYTES = 512;
/** Mirrors the pattern of app.kitchen_ticket_key: the UTC instant of a comanda with exactly six decimals (parity test). */
export const FIRED_AT_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$/;
