export type ErrorCode =
  | "invalid_request"
  | "invalid_json"
  | "unsupported_media_type"
  | "unauthenticated"
  | "no_tenant"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "upstream_error"
  | "internal"
  | "conflict"
  | "duplicate_vat_number"
  | "duplicate_name"
  | "duplicate_supplier_code"
  | "preferred_conflict"
  | "invalid_vat_number"
  | "invalid_pack"
  | "incompatible_units"
  | "invalid_reference"
  | "import_invalid"
  | "payload_too_large"
  | "unsupported_file_type"
  | "encrypted_pdf";

/** A per-item problem attached to an error, e.g. one invalid row of an import. */
export type ErrorDetail = Record<string, string | number>;

/** An expected failure with a status and a message safe to show to the user. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: ErrorDetail[],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function errorResponse(
  status: number,
  code: ErrorCode,
  message: string,
  details?: ErrorDetail[],
): Response {
  return Response.json(
    { error: details ? { code, message, details } : { code, message } },
    { status },
  );
}
