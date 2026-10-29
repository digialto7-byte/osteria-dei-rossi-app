// The address of the comanda (M20 plan §3.6.4). It is ONE static page, /tavoli/comanda, with the session id in ?s=: the service worker can
// serve that page for a session that was opened with no connection (a dynamic /tavoli/<id> page was never cached for a new id).
// /tavoli/<id> still works: it redirects here.

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const COMANDA_PATH = "/tavoli/comanda";

export const comandaHref = (sessionId: string): string => `${COMANDA_PATH}?s=${sessionId}`;

/** The session id in `?s=`, or null when it is missing, repeated or not a uuid. */
export function comandaSessionId(params: URLSearchParams | null): string | null {
  if (!params) return null;
  const all = params.getAll("s");
  return all.length === 1 && SESSION_ID.test(all[0]!) ? all[0]! : null;
}
