import { apiJson, type ApiErrorBody } from "@/lib/api/client";
import { t } from "@/lib/i18n";

// The console's fetch wrapper. It calls apiJson (not changed) and acts on the replies that only the console knows: the session
// is not in console mode yet (409), or the staff account has no second factor (403 mfa_factor_required). The venue app never loads it.

/** The only thing the console puts in sessionStorage: "1" while a switch into console mode is under way. It stops a reload loop. */
export const SWITCH_KEY = "costi.console.switching";

export interface ConsoleEnv {
  fetchImpl: typeof fetch;
  location: Pick<Location, "pathname" | "search" | "assign" | "reload" | "replace">;
  session: Pick<Storage, "getItem" | "setItem" | "removeItem">;
}

export type ConsoleFailure = { ok: false; status: number; error: ApiErrorBody; leaving: boolean };
export type ConsoleResult<T> = { ok: true; status: number; data: T } | ConsoleFailure;

type Options = { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal };

const MODE_PATH = "/api/platform/console";
const LOGOUT_PATH = "/api/platform/logout";
const LOGIN_PAGE = "/login";
const ENROL_PAGE = "/login/attiva-codice";
const DOWN_STATUSES = [0, 500, 502, 503];

/**
 * Per-document state (window.location is one object per document): the switch in flight, and whether this document has already reported a
 * switch that did not bring console mode. Together they keep every document to one POST, so a reload cannot loop.
 */
type DocState = { flight: Promise<ConsoleFailure | null> | null; reported: boolean };
const docs = new WeakMap<object, DocState>();

function docOf(location: object): DocState {
  let doc = docs.get(location);
  if (!doc) {
    doc = { flight: null, reported: false };
    docs.set(location, doc);
  }
  return doc;
}

/**
 * The person asked again ("Riprova", a new sign-in): the next 409 in this document may POST once more. Call it from the user's action, never
 * from an automatic read. The stored key is cleared too, so a tab can never stay stuck on console_unavailable.
 */
export function resetConsoleSwitch(env: Partial<ConsoleEnv> = {}): void {
  const e = resolveEnv(env);
  docOf(e.location).reported = false;
  e.session.removeItem(SWITCH_KEY);
}

function resolveEnv(env: Partial<ConsoleEnv>): ConsoleEnv {
  return {
    fetchImpl: env.fetchImpl ?? fetch,
    location: env.location ?? window.location,
    session: env.session ?? window.sessionStorage,
  };
}

const failureOf = (
  result: { status: number; error: ApiErrorBody },
  leaving: boolean,
): ConsoleFailure => ({ ok: false, status: result.status, error: result.error, leaving });

/** Decides what a failed reply means. The pages for 401 and mfa_factor_required are full loads (the QR page's CSP is chosen per document). */
function classify(
  result: { status: number; error: ApiErrorBody },
  env: ConsoleEnv,
): ConsoleFailure {
  const { status, error } = result;
  const back = encodeURIComponent(`${env.location.pathname}${env.location.search}`);
  if (status === 403 && error.code === "mfa_factor_required") {
    env.location.assign(`${ENROL_PAGE}?next=${back}`);
    return failureOf(result, true);
  }
  if (status === 401 && error.code === "unauthenticated") {
    env.location.assign(`${LOGIN_PAGE}?next=${back}`);
    return failureOf(result, true);
  }
  // apiJson has already sent the browser away for these two.
  if (status === 403 && error.code === "mfa_required") return failureOf(result, true);
  if (status === 401 && error.code === "session_expired") return failureOf(result, true);
  return failureOf(result, false);
}

async function switchToConsole(env: ConsoleEnv): Promise<ConsoleFailure | null> {
  env.session.setItem(SWITCH_KEY, "1");
  const post = await apiJson(MODE_PATH, { method: "POST", body: {} }, env.fetchImpl);
  if (post.ok) {
    env.location.reload();
    return null;
  }
  // The switch did not happen: forget the guard so that a retry can try again.
  env.session.removeItem(SWITCH_KEY);
  return classify(post, env);
}

export async function consoleApi<T>(
  path: `/api/platform/${string}`,
  options: Options = {},
  env: Partial<ConsoleEnv> = {},
): Promise<ConsoleResult<T>> {
  const e = resolveEnv(env);
  const result = await apiJson<T>(path, options, e.fetchImpl);
  if (result.ok) {
    e.session.removeItem(SWITCH_KEY);
    return { ok: true, status: result.status, data: result.data };
  }
  if (result.status === 409 && result.error.code === "console_selection_required") {
    const doc = docOf(e.location);
    if (doc.flight === null) {
      if (doc.reported || e.session.getItem(SWITCH_KEY) === "1") {
        // A reload did not bring console mode (or this document has already said so): report it, do not loop. The stored key is cleared so a
        // new document or the person's own retry can try once more; the document's flag stops the other automatic reads from posting.
        doc.reported = true;
        e.session.removeItem(SWITCH_KEY);
        return {
          ok: false,
          status: result.status,
          error: { code: "console_unavailable", message: t("console.unavailable") },
          leaving: false,
        };
      }
      const started = switchToConsole(e);
      doc.flight = started;
      // A failed switch is over; a later call may try again. A successful one stays: the document is reloading.
      void started.then((failed) => {
        if (failed) doc.flight = null;
      });
    }
    const flight = doc.flight;
    const failed = await flight;
    return failed ?? failureOf(result, true);
  }
  return classify(result, e);
}

/** True when the console itself is not answering (network, 500, 502, 503, or an unreadable reply). */
export function isConsoleDown(f: ConsoleFailure): boolean {
  return DOWN_STATUSES.includes(f.status) || f.error.code === "bad_response";
}

/** Leaves the console. On a failure it returns it and does not navigate: the screen must not pretend the logout happened. */
export async function consoleLogout(env: Partial<ConsoleEnv> = {}): Promise<ConsoleFailure | null> {
  const e = resolveEnv(env);
  const result = await apiJson(LOGOUT_PATH, { method: "POST", body: {} }, e.fetchImpl);
  if (!result.ok) return failureOf(result, false);
  e.session.removeItem(SWITCH_KEY);
  e.location.replace(LOGIN_PAGE);
  return null;
}
