import { ApiError, type ErrorCode } from "@/lib/api/errors";
import { t, type MessageKey } from "@/lib/i18n";
import type { DbError } from "@/server/master/db-errors";

type Coded = Extract<
  ErrorCode,
  | "levels_invalid"
  | "ingredient_not_stock"
  | "supplier_item_inactive"
  | "lead_time_invalid"
  | "weekdays_invalid"
  | "cutoff_invalid"
  | "recipe_not_batch"
  | "portions_invalid"
  | "prep_time_invalid"
>;

// The P0001 messages of the rules procedures (M16 plan §3.4): every one is a 422 with the same code in the API.
const MESSAGE: Record<Coded, MessageKey> = {
  levels_invalid: "rulesError.levels_invalid",
  ingredient_not_stock: "stockError.ingredient_not_stock",
  supplier_item_inactive: "rulesError.supplier_item_inactive",
  lead_time_invalid: "rulesError.lead_time_invalid",
  weekdays_invalid: "rulesError.weekdays_invalid",
  cutoff_invalid: "rulesError.cutoff_invalid",
  recipe_not_batch: "batchError.recipe_not_batch",
  portions_invalid: "rulesError.portions_invalid",
  prep_time_invalid: "rulesError.prep_time_invalid",
};

// P0002 messages: what was not found. Always a 404 not_found; the text only names the kind of record.
const NOT_FOUND: Record<string, MessageKey> = {
  ingredient_not_found: "stockError.ingredient_not_found",
  supplier_item_not_found: "rulesError.supplier_item_not_found",
  supplier_not_found: "rulesError.supplier_not_found",
  recipe_not_found: "rulesError.recipe_not_found",
};

/**
 * Turns a database error from the rules functions into an ApiError with a safe Italian message. The database
 * message is never sent. Anything unexpected is a plain Error that names only the SQLSTATE, for the 500 handler.
 */
export function mapRulesDbError(error: DbError): ApiError | Error {
  switch (error.code) {
    case "42501":
      return new ApiError(403, "forbidden", "Operazione non consentita per il tuo ruolo.");
    case "22023":
      return new ApiError(400, "invalid_request", "Richiesta non valida.");
    case "P0002": {
      const key = NOT_FOUND[error.message] ?? "stockError.not_found";
      return new ApiError(404, "not_found", t(key));
    }
    case "P0001":
      if (Object.hasOwn(MESSAGE, error.message)) {
        const code = error.message as Coded;
        return new ApiError(422, code, t(MESSAGE[code]));
      }
      break;
  }
  return new Error(`Unexpected database error ${error.code ?? "(no code)"}`);
}
