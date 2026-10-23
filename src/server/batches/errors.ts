import { ApiError, type ErrorCode, type ErrorDetail } from "@/lib/api/errors";
import { t, type MessageKey } from "@/lib/i18n";
import type { DbError } from "@/server/master/db-errors";

type Coded = Extract<
  ErrorCode,
  | "recipe_version_stale"
  | "lot_empty"
  | "recipe_not_batch"
  | "recipe_inactive"
  | "recipe_not_producible"
  | "output_invalid"
  | "portions_invalid"
  | "shelf_life_invalid"
  | "inputs_invalid"
  | "input_duplicate"
  | "input_not_in_recipe"
  | "input_missing"
  | "inputs_empty"
  | "unit_mismatch"
  | "qty_invalid"
  | "ingredient_not_stock"
  | "location_required"
  | "no_location"
  | "location_not_found"
>;

// The P0001 messages of the batch functions (M14 plan §3.4): code -> HTTP status.
const PROCEDURE_ERRORS: Record<Coded, number> = {
  recipe_version_stale: 409,
  lot_empty: 409,
  recipe_not_batch: 422,
  recipe_inactive: 422,
  recipe_not_producible: 422,
  output_invalid: 422,
  portions_invalid: 422,
  shelf_life_invalid: 422,
  inputs_invalid: 422,
  input_duplicate: 422,
  input_not_in_recipe: 422,
  input_missing: 422,
  inputs_empty: 422,
  unit_mismatch: 422,
  qty_invalid: 422,
  ingredient_not_stock: 422,
  location_required: 422,
  no_location: 422,
  location_not_found: 422,
};

// The codes the stock functions raise too keep the text of the stock screens.
const STOCK_TEXT = new Set<Coded>([
  "lot_empty",
  "unit_mismatch",
  "qty_invalid",
  "ingredient_not_stock",
  "location_required",
  "no_location",
  "location_not_found",
]);

// P0002 messages: what was not found. Always a 404 not_found; the text only names the kind of record.
const NOT_FOUND: Record<string, MessageKey> = {
  recipe_not_found: "batchError.recipe_not_found",
  batch_not_found: "batchError.batch_not_found",
  ingredient_not_found: "stockError.ingredient_not_found",
  lot_not_found: "stockError.lot_not_found",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The input errors name the ingredient in the Postgres DETAIL as `[{"ingredientId": "..."}]`. Only the ids of that
 * exact shape go on to the client; anything else in the detail is dropped.
 */
function ingredientDetails(raw: string | null | undefined): ErrorDetail[] | undefined {
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  const details = parsed.flatMap((entry): ErrorDetail[] => {
    const id = (entry as { ingredientId?: unknown } | null)?.ingredientId;
    return typeof id === "string" && UUID.test(id) ? [{ ingredientId: id }] : [];
  });
  return details.length > 0 ? details : undefined;
}

/**
 * Turns a database error from the batch functions into an ApiError with a safe Italian message. The database
 * message is never sent. Anything unexpected is a plain Error that names only the SQLSTATE (no quantity, name or
 * id), for the 500 handler and Sentry.
 */
export function mapBatchDbError(error: DbError): ApiError | Error {
  switch (error.code) {
    case "42501":
      return new ApiError(403, "forbidden", "Operazione non consentita per il tuo ruolo.");
    case "P0002": {
      // ingredient_not_found and lot_not_found carry the ingredient in the detail, so the form marks that row.
      const key = Object.hasOwn(NOT_FOUND, error.message)
        ? NOT_FOUND[error.message]!
        : "stockError.not_found";
      return new ApiError(404, "not_found", t(key), ingredientDetails(error.details));
    }
    case "23505":
      // Should never happen: the lot lock numbers the lot codes. The unique index is the backstop.
      if (error.message.includes("batch_lot_code_uq")) {
        return new ApiError(409, "lot_code_conflict", t("batchError.lot_code_conflict"));
      }
      break;
    case "P0001":
      if (error.message === "invalid_request") {
        return new ApiError(400, "invalid_request", "Richiesta non valida.");
      }
      if (Object.hasOwn(PROCEDURE_ERRORS, error.message)) {
        const code = error.message as Coded;
        const key = (
          STOCK_TEXT.has(code) ? `stockError.${code}` : `batchError.${code}`
        ) as MessageKey;
        return new ApiError(PROCEDURE_ERRORS[code], code, t(key), ingredientDetails(error.details));
      }
      break;
  }
  return new Error(`Unexpected database error ${error.code ?? "(no code)"}`);
}
