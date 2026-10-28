import { ApiError, type ErrorDetail } from "@/lib/api/errors";
import { t } from "@/lib/i18n";
import type { DbError } from "@/server/master/db-errors";
import { parseDetails } from "@/server/recipes/errors";

// The SQL names fields in snake_case; the API speaks camelCase (and *Eur for money).
const API_FIELD: Record<string, string> = {
  avg_cost_n: "avgCostN",
  price_variance_pct: "priceVariancePct",
  sale_vat_pct: "saleVatPct",
  rent: "rentEur",
  labour: "labourEur",
  utilities: "utilitiesEur",
};

function apiDetails(raw: string | null | undefined): ErrorDetail[] | undefined {
  return parseDetails(raw)?.map((detail) => {
    const field = detail.field;
    return typeof field === "string" ? { ...detail, field: API_FIELD[field] ?? field } : detail;
  });
}

/**
 * Turns a database error from the cost functions into an ApiError with a safe Italian message
 * (M8 plan §3.6). The database message is never sent. Anything unexpected is a plain Error that
 * names only the SQLSTATE, for the 500 handler and Sentry.
 */
export function mapCostDbError(error: DbError): ApiError | Error {
  switch (error.code) {
    case "42501":
      return new ApiError(403, "forbidden", "Operazione non consentita per il tuo ruolo.");
    case "P0002":
      return error.message === "recipe_not_in_force"
        ? new ApiError(404, "recipe_not_in_force", t("costError.recipe_not_in_force"))
        : new ApiError(404, "not_found", "Risorsa non trovata.");
    case "P0001":
      switch (error.message) {
        case "date_in_future":
          return new ApiError(422, "date_in_future", t("costError.date_in_future"));
        case "settings_invalid": {
          const details = apiDetails(error.details);
          const field = details?.[0]?.field;
          return new ApiError(
            422,
            "settings_invalid",
            typeof field === "string" && field !== ""
              ? t("costError.settings_invalid", { field })
              : t("costError.settings_invalid_generic"),
            details,
          );
        }
        case "fixed_cost_invalid":
          return new ApiError(
            422,
            "fixed_cost_invalid",
            t("costError.fixed_cost_invalid"),
            apiDetails(error.details),
          );
        case "recipe_not_plate":
          return new ApiError(422, "recipe_not_plate", t("costError.recipe_not_plate"));
        case "basis_invalid":
          return new ApiError(400, "invalid_request", "Base di costo non valida.");
      }
      break;
  }
  return new Error(`Unexpected database error ${error.code ?? "(no code)"}`);
}

interface QueryResult {
  data: unknown;
  error: DbError | null;
}

/** The data of a PostgREST result, or the mapped error thrown. */
export function unwrapCost<T>(result: QueryResult): T {
  if (result.error) throw mapCostDbError(result.error);
  return result.data as T;
}
