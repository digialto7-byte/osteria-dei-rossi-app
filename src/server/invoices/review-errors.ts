import { ApiError, type ErrorCode } from "@/lib/api/errors";
import { mapDbError, type DbError } from "@/server/master/db-errors";

// The review procedures raise P0001 with the code as the message. The database text is never sent.
const PROCEDURE_ERRORS: Record<string, [status: number, code: ErrorCode, message: string]> = {
  invalid_request: [400, "invalid_request", "Richiesta non valida."],
  range_too_long: [400, "invalid_request", "Il periodo può durare al massimo 366 giorni."],
  invoice_not_in_review: [
    409,
    "invoice_not_in_review",
    "La fattura non è più in revisione: ricarica la pagina.",
  ],
  line_split: [
    409,
    "line_split",
    "La riga è divisa: modifica le sue parti o annulla la divisione.",
  ],
  not_split: [409, "not_split", "La riga non è divisa."],
  not_flagged: [409, "not_flagged", "La fattura non è segnalata come doppione."],
  not_failed: [409, "not_failed", "La lettura di questa fattura non è fallita."],
  cost_centre_required: [
    422,
    "cost_centre_required",
    "Una riga non a magazzino richiede un centro di costo.",
  ],
  credit_qty_exceeds_qty: [
    422,
    "credit_qty_exceeds_qty",
    "La quantità resa non può superare la quantità della riga.",
  ],
  supplier_required: [
    422,
    "supplier_required",
    "Collega prima il fornitore: gli abbinamenti sono per fornitore.",
  ],
  pack_required: [
    422,
    "pack_required",
    "Indica la confezione: l'unità della riga non basta a calcolare la quantità.",
  ],
  non_stock_has_ingredient: [
    422,
    "non_stock_has_ingredient",
    "Una riga non a magazzino non può avere un ingrediente.",
  ],
  split_child_locked: [
    422,
    "split_child_locked",
    "Quantità e importi di una parte sono fissati dalla divisione.",
  ],
  not_mapped: [422, "not_mapped", "Abbina prima la riga a un ingrediente."],
  split_sum_mismatch: [
    422,
    "split_sum_mismatch",
    "Le parti devono sommare esattamente la quantità e l'importo della riga.",
  ],
  split_credit_conflict: [
    422,
    "split_credit_conflict",
    "Una riga con una quantità resa non si può dividere.",
  ],
  split_child_cannot_split: [422, "split_child_cannot_split", "Una parte non si può dividere."],
};

const fromProcedure = ([status, code, message]: [number, ErrorCode, string]) =>
  new ApiError(status, code, message);

/** The ApiError for one of the procedures' codes, for rules the API checks before the call. */
export function procedureError(code: keyof typeof PROCEDURE_ERRORS): ApiError {
  return fromProcedure(PROCEDURE_ERRORS[code]!);
}

/**
 * Turns a database error from the review procedures into an ApiError with an Italian message.
 * Shared cases (privilege, not found, units, unique names) go through `mapDbError`; anything
 * unexpected becomes a plain Error naming only the SQLSTATE, for the 500 handler and Sentry.
 */
export function mapReviewError(error: DbError): ApiError | Error {
  if (error.code === "P0001") {
    const known = PROCEDURE_ERRORS[error.message];
    return known
      ? fromProcedure(known)
      : new Error(`Unexpected database error ${error.code ?? "(no code)"}`);
  }
  if (error.code === "23514") {
    if (/invoice_line_credit_qty_ck/.test(error.message))
      return procedureError("credit_qty_exceeds_qty");
    if (/invoice_line_non_stock_ck/.test(error.message))
      return procedureError("cost_centre_required");
    if (/invoice_line_unit_ck/.test(error.message)) {
      return new ApiError(422, "invalid_request", "Unità non valida.");
    }
    if (/invoice_totals_ck/.test(error.message)) {
      return new ApiError(422, "invalid_request", "Gli importi indicati non sono validi.");
    }
  }
  if (error.code === "22007" || error.code === "22008") {
    return new ApiError(422, "invalid_request", "Data non valida.");
  }
  if (error.code === "23503") {
    return new ApiError(
      422,
      "invalid_reference",
      "L'ingrediente, il centro di costo o il fornitore indicato non esiste.",
    );
  }
  return mapDbError(error);
}
