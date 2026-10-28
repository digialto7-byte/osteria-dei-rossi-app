"use client";

import { Button, ErrorAlert, linkClass } from "@/components/ui";
import type { MeState } from "@/components/use-me";
import { t } from "@/lib/i18n";

/**
 * What a screen shows when /api/me gave no user: the sign-in link for a 401, the "no venue" notice for a 403,
 * and for an error (network, 5xx) a notice with "Riprova", so the screen never claims "signed out" or shows a bare heading.
 */
/**
 * "Riprova" turns the notice into the loading state, so the button disappears. Focus moves to the page heading first
 * (made focusable with tabindex -1), so keyboard and screen-reader focus does not fall back to the body.
 */
function retryWithFocus(retry: () => void): void {
  const heading =
    document.querySelector<HTMLElement>("main h1") ?? document.querySelector<HTMLElement>("h1");
  if (heading) {
    heading.tabIndex = -1;
    heading.focus();
  }
  retry();
}

export function MeProblem({
  status,
  retry,
}: {
  status: Exclude<MeState["status"], "ok" | "loading">;
  retry: () => void;
}) {
  if (status === "signedOut") {
    return (
      <p>
        {t("home.signedOut")}{" "}
        <a href="/login" className={linkClass}>
          {t("login.title")}
        </a>
      </p>
    );
  }
  if (status === "noAccess") return <ErrorAlert message={t("home.noAccess")} />;
  return (
    <>
      <ErrorAlert message={t("me.error")} />
      <div>
        <Button variant="secondary" onClick={() => retryWithFocus(retry)}>
          {t("common.retry")}
        </Button>
      </div>
    </>
  );
}
