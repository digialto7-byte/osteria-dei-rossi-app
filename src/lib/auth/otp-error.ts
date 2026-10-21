// How the magic-link route reads a Supabase Auth signInWithOtp error. Kept apart from the route
// so an E2E test can check the codes real Supabase Auth returns (e2e/magic-link-unknown.spec.ts).

export type OtpOutcome = "sent" | "unknown_address" | "rate_limited" | "upstream" | "unexpected";

export interface OtpError {
  status?: number;
  code?: string;
}

const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR = 500;
// What Supabase Auth answers for an address without an account while signup is off.
const UNKNOWN_ADDRESS_CODES = new Set(["otp_disabled", "signup_disabled", "user_not_found"]);

export function classifyOtpError(error: OtpError | null): OtpOutcome {
  if (!error) return "sent";
  if (error.status === HTTP_TOO_MANY_REQUESTS) return "rate_limited";
  if ((error.status ?? HTTP_SERVER_ERROR) >= HTTP_SERVER_ERROR) return "upstream";
  if (UNKNOWN_ADDRESS_CODES.has(error.code ?? "")) return "unknown_address";
  return "unexpected";
}
