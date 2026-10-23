import { t } from "@/lib/i18n";

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, string | number>[];
}

export type ApiResult<T> =
  { ok: true; status: number; data: T } | { ok: false; status: number; error: ApiErrorBody };

interface Options {
  method?: "GET" | "POST" | "PATCH" | "PUT";
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
  if (response.ok) return { ok: true, status: response.status, data: json as T };
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
      headers:
        body === undefined
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
