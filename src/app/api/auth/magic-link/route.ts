import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { safeNextPath } from "@/lib/api/safe-next";
import { withApi } from "@/lib/api/with-api";

const MAX_EMAIL_LENGTH = 254;
const MAX_NEXT_LENGTH = 512;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR = 500;
// What Supabase Auth answers for an address without an account while signup is off.
const UNKNOWN_ADDRESS_CODES = new Set(["otp_disabled", "signup_disabled", "user_not_found"]);

const body = z.object({
  email: z.email().max(MAX_EMAIL_LENGTH),
  next: z.string().max(MAX_NEXT_LENGTH).optional(),
});

export const POST = withApi({ public: true, body }, async ({ request, supabase, body }) => {
  const callback = new URL("/api/auth/callback", request.url);
  callback.searchParams.set("next", safeNextPath(body.next));

  // Signup is off: unknown addresses get no email. The answer is the same either way, so the
  // endpoint does not reveal which addresses have accounts.
  const { error } = await supabase.auth.signInWithOtp({
    email: body.email,
    options: { shouldCreateUser: false, emailRedirectTo: callback.toString() },
  });

  if (error?.status === HTTP_TOO_MANY_REQUESTS) {
    throw new ApiError(429, "rate_limited", "Troppi tentativi. Riprova tra qualche minuto.");
  }
  if (error && (error.status ?? HTTP_SERVER_ERROR) >= HTTP_SERVER_ERROR) {
    throw new ApiError(502, "upstream_error", "Invio non riuscito. Riprova tra poco.");
  }
  if (error && !UNKNOWN_ADDRESS_CODES.has(error.code ?? "")) {
    // Still 202 for the caller (no account enumeration), but an unexpected rejection must be
    // visible to us. Status and code only: never the address.
    console.warn(
      `magic-link: auth rejected the request (${error.status} ${error.code ?? "no code"})`,
    );
  }
  return Response.json({ status: "sent" }, { status: 202 });
});
