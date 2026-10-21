import { safeNextPath } from "@/lib/api/safe-next";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const LINK_ERROR_PATH = "/login?errore=link";

/**
 * Magic-link landing: exchanges the PKCE code for a session cookie, then redirects to `next` only
 * if it is a same-origin relative path (plan §3.11.3, M0 acceptance test 12). Only PKCE codes are
 * accepted: a bare token_hash link is not bound to the browser that asked for it, so a crafted
 * link could sign a victim into someone else's account (login CSRF).
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  let ok = false;
  if (code) {
    const supabase = await createSupabaseServerClient();
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  }

  const target = ok ? safeNextPath(url.searchParams.get("next")) : LINK_ERROR_PATH;
  return Response.redirect(new URL(target, url.origin), 303);
}
