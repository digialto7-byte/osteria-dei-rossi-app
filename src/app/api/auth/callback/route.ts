import { safeNextPath } from "@/lib/api/safe-next";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { afterFirstFactor } from "@/server/auth/redirect";

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

  let target = LINK_ERROR_PATH;
  if (code) {
    const supabase = await createSupabaseServerClient();
    if (!(await supabase.auth.exchangeCodeForSession(code)).error) {
      // P2-1: the link is a first factor like the password; an owner or admin may still owe the code (it cannot bypass it, AT-T4).
      const { data } = await supabase.auth.getClaims();
      const claims = (data?.claims ?? {}) as {
        tenant_id?: string;
        app_role?: string;
        aal?: string;
      };
      target = await afterFirstFactor(supabase, claims, safeNextPath(url.searchParams.get("next")));
    }
  }
  return Response.redirect(new URL(target, url.origin), 303);
}
