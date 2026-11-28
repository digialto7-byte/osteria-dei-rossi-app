import type { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import type { ApiContext } from "@/lib/api/with-api";
import { t } from "@/lib/i18n";

// SP3 step 17 (docs/plans/2026-11-15-sp3-console.md §3.4.1, §3.4.5): one call to a console function, its answer parsed with the src/lib/platform/api.ts schema.
// Every console function runs app.require_console() first, so Postgres decides who passes; this only turns its answers into the codes the screens know.
// An unexpected error is reported by its SQLSTATE only (a message could name a venue).

/** The route's own client, as withApi hands it over (no Supabase package is imported under src/server/platform, by the console guard). */
export type PlatformDb = ApiContext<{ platform: true }, undefined>["supabase"];

type DbError = { code?: string; message?: string };

/** The database's answer as the API error the console knows; anything else is an internal error carrying the SQLSTATE only. */
export function platformError(fn: string, error: DbError): Error {
  const message = error.message ?? "";
  if (error.code === "42501") return new ApiError(403, "forbidden", "Operazione non consentita.");
  if (error.code === "P0001" && message === "mfa_required") {
    return new ApiError(403, "mfa_required", t("authError.mfa_required"));
  }
  if (error.code === "P0001" && message === "mfa_factor_required") {
    return new ApiError(
      403,
      "mfa_factor_required",
      "Attiva il codice di verifica per entrare nella console.",
    );
  }
  if (error.code === "P0002" && message === "tenant_not_found") {
    return new ApiError(404, "tenant_not_found", "Locale non trovato.");
  }
  if (error.code === "P0002" && message === "notice_not_found") {
    return new ApiError(404, "notice_not_found", "Avviso non trovato.");
  }
  if (error.code === "22023") return new ApiError(400, "invalid_request", "Richiesta non valida.");
  return new Error(`${fn} failed: ${error.code ?? "no code"}`);
}

/** Calls one console function and parses its reply strictly: an unknown key (a cost, an address) is a 500, never passed on. */
export async function callPlatform<T>(
  supabase: PlatformDb,
  fn: string,
  args: Record<string, unknown> | undefined,
  schema: z.ZodType<T>,
): Promise<T> {
  const { data, error } =
    args === undefined ? await supabase.rpc(fn) : await supabase.rpc(fn, args);
  if (error) throw platformError(fn, error);
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new Error(`${fn} returned an unexpected shape`);
  return parsed.data;
}
