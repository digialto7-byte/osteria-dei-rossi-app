import { safeNextPath } from "@/lib/api/safe-next";
import { APP_ROLES, type AppRole } from "@/lib/api/with-api";
import { landingFor } from "@/lib/nav/nav-model";

/** Where a person goes after signing in (plan §3.1.1): a real `next`, else the role's landing page. */
export function redirectAfterSignIn(
  claims: { tenant_id?: string; app_role?: string },
  next?: string,
): string {
  const safe = safeNextPath(next);
  if (safe !== "/") return safe;
  if (!claims.tenant_id) return "/";
  const role = claims.app_role as AppRole;
  return (APP_ROLES as readonly string[]).includes(role) ? landingFor(role) : "/";
}

/** After a code sign-in, owner and admin are offered /password first (plan §3.1.2). */
export function redirectAfterCodeSignIn(
  claims: { tenant_id?: string; app_role?: string },
  next?: string,
): string {
  const safe = safeNextPath(next);
  const offersPassword =
    Boolean(claims.tenant_id) && ["owner", "admin"].includes(claims.app_role ?? "");
  if (!offersPassword || safe === "/password" || safe.startsWith("/password?")) {
    return redirectAfterSignIn(claims, next);
  }
  return `/password?dopo=${encodeURIComponent(safe)}`;
}
