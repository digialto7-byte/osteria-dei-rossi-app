// The address of the comanda (M20 plan §3.6.4). It is ONE static page, /tavoli/comanda, with the session id in ?s=: the service worker can
// serve that page for a session that was opened with no connection (a dynamic /tavoli/<id> page was never cached for a new id).
// /tavoli/<id> still works: it redirects here.

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const COMANDA_PATH = "/tavoli/comanda";

/** The two views of the comanda page: the order, and the bill ("Conto", M21). */
export type ComandaTab = "order" | "bill";

/** `vista=conto` opens the bill tab (the table panel's "Conto e chiusura" link). */
const BILL_VIEW = "conto";

export const comandaHref = (sessionId: string, tab: ComandaTab = "order"): string =>
  tab === "bill"
    ? `${COMANDA_PATH}?s=${sessionId}&vista=${BILL_VIEW}`
    : `${COMANDA_PATH}?s=${sessionId}`;

/** The tab the address asks for: "bill" for `vista=conto`, otherwise null (nothing chosen: a closed table opens on the bill). */
export function comandaTab(params: URLSearchParams | null): ComandaTab | null {
  if (!params) return null;
  const all = params.getAll("vista");
  return all.length === 1 && all[0] === BILL_VIEW ? "bill" : null;
}

/** The session id in `?s=`, or null when it is missing, repeated or not a uuid. */
export function comandaSessionId(params: URLSearchParams | null): string | null {
  if (!params) return null;
  const all = params.getAll("s");
  return all.length === 1 && SESSION_ID.test(all[0]!) ? all[0]! : null;
}
