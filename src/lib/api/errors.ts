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
  | "internal";

/** An expected failure with a status and a message safe to show to the user. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function errorResponse(status: number, code: ErrorCode, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}
