import { ApiError } from "@/lib/api/errors";

/** The shape of a PostgREST / Postgres error as supabase-js returns it. */
export interface DbError {
  code?: string;
  message: string;
  details?: string | null;
}

// Raised by public.import_* with the file line in DETAIL (see the master_import migration).
const IMPORT_ERRORS = new Set(["ambiguous_match", "base_unit_conflict"]);
const IMPORT_INVALID_MESSAGE = "Il file contiene righe non valide.";

// Constraint names from the M1 migrations. The database message is never sent to the client.
const UNIQUE_BY_CONSTRAINT: [RegExp, ApiError][] = [
  [
    /supplier_tenant_vat_uq/,
    new ApiError(409, "duplicate_vat_number", "Esiste già un fornitore con questa partita IVA."),
  ],
  [
    /(location|ingredient)_name_uq/,
    new ApiError(409, "duplicate_name", "Esiste già un elemento con questo nome."),
  ],
  [
    /supplier_item_code_uq/,
    new ApiError(
      409,
      "duplicate_supplier_code",
      "Questo codice articolo esiste già per il fornitore.",
    ),
  ],
  [
    /supplier_item_preferred_uq/,
    new ApiError(
      409,
      "preferred_conflict",
      "C'è già un articolo preferito per questo ingrediente.",
    ),
  ],
];

const CHECK_BY_CONSTRAINT: [RegExp, ApiError][] = [
  [/supplier_vat_number_ck/, new ApiError(422, "invalid_vat_number", "Partita IVA non valida.")],
  [
    /supplier_item_pack_(qty|count)_check/,
    new ApiError(422, "invalid_pack", "La confezione deve avere quantità maggiori di zero."),
  ],
];

function byConstraint(table: [RegExp, ApiError][], message: string): ApiError | undefined {
  return table.find(([pattern]) => pattern.test(message))?.[1];
}

/**
 * Turns an expected database error into an ApiError with a safe Italian message. Anything
 * unexpected becomes a plain Error naming only the SQLSTATE, for the 500 handler and Sentry.
 */
export function mapDbError(error: DbError): ApiError | Error {
  if (error.code === "P0001" && IMPORT_ERRORS.has(error.message)) {
    return new ApiError(422, "import_invalid", IMPORT_INVALID_MESSAGE, [
      { row: Number(error.details ?? 0), field: "nome", code: error.message },
    ]);
  }
  switch (error.code) {
    case "23505":
      return (
        byConstraint(UNIQUE_BY_CONSTRAINT, error.message) ??
        new ApiError(409, "conflict", "L'elemento esiste già.")
      );
    case "23514":
      return (
        byConstraint(CHECK_BY_CONSTRAINT, error.message) ??
        new ApiError(422, "invalid_request", "Valori non validi.")
      );
    case "23503":
      return new ApiError(
        422,
        "invalid_reference",
        "Il fornitore o l'ingrediente indicato non esiste.",
      );
    case "22023":
      return new ApiError(
        422,
        "incompatible_units",
        "L'unità della confezione non è compatibile con quella dell'ingrediente.",
      );
    case "42501":
      return new ApiError(403, "forbidden", "Operazione non consentita per il tuo ruolo.");
    case "P0002":
      return new ApiError(404, "not_found", "Risorsa non trovata.");
    default:
      return new Error(`Unexpected database error ${error.code ?? "(no code)"}`);
  }
}
