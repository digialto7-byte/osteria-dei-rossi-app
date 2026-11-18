"use client";

import { t } from "@/lib/i18n";
import { useHydrated } from "./use-hydrated";

/**
 * The "session expired" line of a sign-in screen, as a status note a screen reader announces. A live region that
 * already holds its text when the page arrives is often not announced, so the region is in the server render empty
 * and the text goes in once React has hydrated. It keeps the look of `Muted`.
 */
export function SessionExpiredNote() {
  const hydrated = useHydrated();
  return (
    <p role="status" className="text-ink-muted">
      {hydrated ? t("login.sessionExpired") : null}
    </p>
  );
}
