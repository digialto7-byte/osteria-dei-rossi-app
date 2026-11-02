import { safeNextPath } from "@/lib/api/safe-next";
import type { PasswordStatus } from "@/server/auth/schemas";

// Presentation helpers for /password and the Oggi link (M25a). Pure: the API says how the person signed in
// and whether the last sign-in is recent; these only choose words and where to go next.

/** The label of the Oggi link: set a first password after a link sign-in, else change it. */
export function passwordLinkKey(
  method: PasswordStatus["signInMethod"],
): "home.setPassword" | "home.changePassword" {
  return method === "link" ? "home.setPassword" : "home.changePassword";
}

export function passwordIntroKey(
  method: PasswordStatus["signInMethod"],
): "password.introSet" | "password.introChange" {
  return method === "link" ? "password.introSet" : "password.introChange";
}

/** Where `?dopo=` points, made safe; null when the page was opened without one. */
export function afterPasswordPath(dopo: string | null): string | null {
  return dopo ? safeNextPath(dopo) : null;
}
