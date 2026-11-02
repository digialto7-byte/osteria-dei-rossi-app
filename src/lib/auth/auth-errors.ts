// How the password, code and password-change routes read a Supabase Auth error (M25a step 5). Auth errors can
// carry an address in their message, so routes log only what `toLogSafe` returns.

interface AuthErrorLike {
  status?: number;
  code?: string;
}

function parts(error: unknown): AuthErrorLike {
  if (typeof error !== "object" || error === null) return {};
  const { status, code } = error as AuthErrorLike;
  return {
    ...(typeof status === "number" ? { status } : {}),
    ...(typeof code === "string" ? { code } : {}),
  };
}

const TOO_MANY_REQUESTS = 429;

export type SignInOutcome = "invalid" | "rate_limited" | "upstream";
export type VerifyOutcome = "code_invalid" | "rate_limited" | "upstream";
export type UpdateOutcome = "weak" | "same" | "rate_limited" | "upstream";

export function classifySignIn(error: unknown): SignInOutcome {
  const { status, code } = parts(error);
  if (status === TOO_MANY_REQUESTS) return "rate_limited";
  if (code === "invalid_credentials") return "invalid";
  return "upstream";
}

export function classifyVerify(error: unknown): VerifyOutcome {
  const { status, code } = parts(error);
  if (status === TOO_MANY_REQUESTS) return "rate_limited";
  if (code === "otp_expired" || status === 400) return "code_invalid";
  return "upstream";
}

export function classifyUpdate(error: unknown): UpdateOutcome {
  const { status, code } = parts(error);
  if (status === TOO_MANY_REQUESTS) return "rate_limited";
  if (code === "weak_password") return "weak";
  if (code === "same_password") return "same";
  return "upstream";
}

/** The only parts of an Auth error that may be logged. */
export function toLogSafe(error: unknown): AuthErrorLike {
  return parts(error);
}
