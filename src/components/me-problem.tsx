"use client";

import type { RefObject } from "react";
import { Button, ErrorAlert, linkClass } from "@/components/ui";
import type { MeState } from "@/components/use-me";
import { t } from "@/lib/i18n";

/**
 * What a screen shows when /api/me gave no user: the sign-in link for a 401, the "no venue" notice for a 403,
 * and for an error (network, 5xx) a notice with "Riprova", so the screen never claims "signed out" or shows a bare heading.
 */
/**
 * "Riprova" turns the notice into the loading state, so the button disappears. Focus moves first (target made
 * focusable with tabindex -1), so keyboard and screen-reader focus does not fall back to the body. The target is
 * explicit: the `focusRef` a page passes (its heading), else the heading inside the same `main` as the button, else
 * that `main` itself, which the shell keeps while a page swaps between its loading and loaded branches. The document is
 * never searched, so another region's heading is not taken.
 */
function retryWithFocus(button: HTMLElement, target: HTMLElement | null, retry: () => void): void {
  const main = button.closest<HTMLElement>("main");
  const focusable = target ?? main?.querySelector<HTMLElement>("h1") ?? main;
  if (focusable) {
    focusable.tabIndex = -1;
    focusable.focus();
  }
  retry();
}

export function MeProblem({
  status,
  retry,
  focusRef,
}: {
  status: Exclude<MeState["status"], "ok" | "loading">;
  retry: () => void;
  /** The element that gets focus on "Riprova" (normally the page heading); optional. */
  focusRef?: RefObject<HTMLElement | null>;
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
        <Button
          variant="secondary"
          onClick={(event) => retryWithFocus(event.currentTarget, focusRef?.current ?? null, retry)}
        >
          {t("common.retry")}
        </Button>
      </div>
    </>
  );
}
