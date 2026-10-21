import { t } from "@/lib/i18n";

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, string | number>[];
}

export type ApiResult<T> =
  { ok: true; status: number; data: T } | { ok: false; status: number; error: ApiErrorBody };

interface Options {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
}

const NO_CONTENT = 204;

/**
 * The only way screens talk to the server (plan §3.2: UI reads /api/* JSON). Writes always send
 * JSON, which the API requires as its CSRF guard. Never throws: failures come back as results.
 */
export async function apiJson<T>(
  path: string,
  { method = "GET", body }: Options = {},
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetchImpl(path, {
      method,
      headers:
        body === undefined
          ? { accept: "application/json" }
          : { accept: "application/json", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
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
  return {
    ok: false,
    status: response.status,
    error: error ?? { code: "bad_response", message: t("common.genericError") },
  };
}
