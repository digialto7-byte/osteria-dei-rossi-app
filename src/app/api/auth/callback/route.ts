import type { EmailOtpType } from "@supabase/supabase-js";
import { safeNextPath } from "@/lib/api/safe-next";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const LINK_ERROR_PATH = "/login?errore=link";
const ACCEPTED_OTP_TYPES: readonly EmailOtpType[] = ["magiclink", "email"];

function isAcceptedOtpType(type: string | null): type is EmailOtpType {
  return (ACCEPTED_OTP_TYPES as readonly (string | null)[]).includes(type);
}

/**
 * Magic-link landing: turns the link into a session cookie, then redirects to `next` only if it
 * is a same-origin relative path (plan §3.11.3, M0 acceptance test 12).
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");

  const supabase = await createSupabaseServerClient();
  let ok = false;
  if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  } else if (tokenHash && isAcceptedOtpType(type)) {
    ok = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type })).error;
  }

  const target = ok ? safeNextPath(url.searchParams.get("next")) : LINK_ERROR_PATH;
  return Response.redirect(new URL(target, url.origin), 303);
}
