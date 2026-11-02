import { ApiError } from "@/lib/api/errors";
import { t } from "@/lib/i18n";
import { AUTH_CALL_TIMEOUT_MS } from "@/server/staff-auth/constants";

/**
 * Runs one Supabase Auth call with the 10 s limit of the PIN flow. A timeout or a thrown error (network) becomes
 * 502 `upstream_error`; a result, including an Auth error value, is returned for the caller to classify.
 */
export async function callAuth<T>(call: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("auth timeout")), AUTH_CALL_TIMEOUT_MS);
  });
  try {
    return await Promise.race([Promise.resolve(call), timeout]);
  } catch {
    throw new ApiError(502, "upstream_error", t("authError.upstream_error"));
  } finally {
    clearTimeout(timer);
  }
}
