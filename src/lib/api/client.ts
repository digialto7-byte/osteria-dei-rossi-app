import { t } from "@/lib/i18n";

/** Per-item problems of an error, e.g. one invalid row of an import. */
export type ErrorDetailList = Record<string, string | number>[];

export interface ApiErrorBody {
  code: string;
  message: string;
  /**
   * A list of per-item problems, or (a few codes) an object the screen acts on, e.g. `{ reason, line }` for an
   * order conflict. Read it through `detailList` or `detailObject`; never assume the shape.
   */
  details?: unknown;
}

/** The details as a list of per-item problems, or undefined when the error carries none. */
export function detailList(details: unknown): ErrorDetailList | undefined {
  return Array.isArray(details) ? (details as ErrorDetailList) : undefined;
}

/** The details as an object of the shape `schema` accepts, or undefined. */
export function detailObject<T>(
  details: unknown,
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
): T | undefined {
  if (details === null || typeof details !== "object" || Array.isArray(details)) return undefined;
  const parsed = schema.safeParse(details);
  return parsed.success ? parsed.data : undefined;
}

export type ApiResult<T> =
  | {
      ok: true;
      status: number;
      data: T;
      /** Set when the service worker answered from its stored copy (M20): the instant it was stored. */
      cachedAt?: string;
    }
  | { ok: false; status: number; error: ApiErrorBody };

interface Options {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
}

const NO_CONTENT = 204;
const PIN_PAGE = "/pin";

/** A staff PIN session ended (cut-off, revoked device, reset): back to the PIN screen, once. */
function leaveEndedSession() {
  const location = typeof window === "undefined" ? undefined : window.location;
  if (location && location.pathname !== PIN_PAGE) location.assign(PIN_PAGE);
}

/** Sends the request and reads the JSON reply. Never throws: failures come back as results. */
async function send<T>(
  path: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetchImpl(path, init);
  } catch {
    return { ok: false, status: 0, error: { code: "network", message: t("common.networkError") } };
  }
  if (response.status === NO_CONTENT) return { ok: true, status: NO_CONTENT, data: undefined as T };

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return {
      ok: false,
      status: response.status,
      error: { code: "bad_response", message: t("common.genericError") },
    };
  }
  if (response.ok) {
    const cachedAt = response.headers?.get?.("x-offline-cached-at") ?? null;
    return {
      ok: true,
      status: response.status,
      data: json as T,
      ...(cachedAt ? { cachedAt } : {}),
    };
  }
  const error = (json as { error?: ApiErrorBody }).error;
  if (response.status === 401 && error?.code === "session_ended") leaveEndedSession();
  return {
    ok: false,
    status: response.status,
    error: error ?? { code: "bad_response", message: t("common.genericError") },
  };
}

/**
 * The way screens talk to the server (plan §3.2: UI reads /api/* JSON). Writes always send
 * JSON, which the API requires as its CSRF guard. Never throws: failures come back as results.
 */
export function apiJson<T>(
  path: string,
  { method = "GET", body }: Options = {},
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResult<T>> {
  return send<T>(
    path,
    {
      method,
      // Every write declares JSON, with or without a body: the API refuses a write without it (CSRF
      // guard), and a body-less DELETE (revoke a device) is a write too.
      headers:
        method === "GET" && body === undefined
          ? { accept: "application/json" }
          : { accept: "application/json", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    fetchImpl,
  );
}

/**
 * Uploads a file as multipart/form-data (the one route family that is not JSON, e.g. invoices).
 * No content-type header is set: the browser adds it with the multipart boundary. The server
 * checks the request origin instead. Same result contract as apiJson.
 */
export function apiUpload<T>(
  path: string,
  body: FormData,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResult<T>> {
  return send<T>(
    path,
    { method: "POST", headers: { accept: "application/json" }, body },
    fetchImpl,
  );
}
