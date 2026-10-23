import { ApiError, type ErrorCode, type ErrorDetail } from "@/lib/api/errors";
import { t } from "@/lib/i18n";
import type { DbError } from "@/server/master/db-errors";

type Coded = Extract<
  ErrorCode,
  | "recipe_name_taken"
  | "recipe_inactive"
  | "recipe_cycle"
  | "recipe_too_deep"
  | "recipe_unchanged"
  | "recipe_type_conflict"
  | "recipe_invalid"
>;

// The recipe procedures raise P0001 with the code as the message. The database text is never sent.
const PROCEDURE_ERRORS: Record<Coded, number> = {
  recipe_name_taken: 409,
  recipe_inactive: 409,
  recipe_cycle: 422,
  recipe_too_deep: 422,
  recipe_unchanged: 422,
  recipe_type_conflict: 422,
  recipe_invalid: 422,
};

const PRICE_FORBIDDEN = "recipe_price_forbidden";
const VERSION_CONFLICT = "version_conflict";

/** Parses the procedure's JSON DETAIL; nothing but strings and numbers survives. */
export function parseDetails(raw: string | null | undefined): ErrorDetail[] | undefined {
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const details = entries.flatMap((entry): ErrorDetail[] => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
    const kept = Object.entries(entry).filter(
      (pair): pair is [string, string | number] =>
        typeof pair[1] === "string" || typeof pair[1] === "number",
    );
    return kept.length > 0 ? [Object.fromEntries(kept)] : [];
  });
  return details.length > 0 ? details : undefined;
}

function versionConflict(raw: string | null | undefined): ApiError {
  const details = parseDetails(raw);
  const current = details?.[0]?.currentVersion;
  const message =
    current === undefined
      ? t("recipeError.version_conflict_generic")
      : t("recipeError.version_conflict", { n: current });
  return new ApiError(409, VERSION_CONFLICT, message, current === undefined ? undefined : details);
}

/**
 * Turns a database error from the recipe procedures into an ApiError with a safe Italian message
 * (M7 plan §3.2). The database message is never sent: it can carry names. Anything unexpected is a
 * plain Error that names only the SQLSTATE, for the 500 handler and Sentry.
 */
export function mapRecipeDbError(error: DbError): ApiError | Error {
  switch (error.code) {
    case "42501":
      return error.message === PRICE_FORBIDDEN
        ? new ApiError(403, PRICE_FORBIDDEN, t("recipeError.recipe_price_forbidden"))
        : new ApiError(403, "forbidden", "Operazione non consentita per il tuo ruolo.");
    case "P0002":
      return new ApiError(404, "not_found", "Risorsa non trovata.");
    case "23505":
      // The unique indexes are the backstop of the name and version checks.
      if (/recipe_key_name_uq/.test(error.message)) {
        return new ApiError(409, "recipe_name_taken", t("recipeError.recipe_name_taken"));
      }
      if (/recipe_key_version_uq/.test(error.message)) return versionConflict(null);
      break;
    case "P0001": {
      if (error.message === VERSION_CONFLICT) return versionConflict(error.details);
      if (Object.hasOwn(PROCEDURE_ERRORS, error.message)) {
        const code = error.message as Coded;
        return new ApiError(
          PROCEDURE_ERRORS[code],
          code,
          t(`recipeError.${code}`),
          code === "recipe_cycle" || code === "recipe_too_deep"
            ? undefined
            : parseDetails(error.details),
        );
      }
      break;
    }
  }
  return new Error(`Unexpected database error ${error.code ?? "(no code)"}`);
}
