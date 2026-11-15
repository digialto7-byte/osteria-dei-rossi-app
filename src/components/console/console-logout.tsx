"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { consoleLogout, isConsoleDown } from "@/lib/console/console-api";
import { t } from "@/lib/i18n";

const BAND_BUTTON =
  "inline-flex min-h-tap min-w-tap items-center justify-center rounded-lg border-[1.5px] border-band-ink px-3 text-base font-bold text-band-ink focus-visible:outline-band-ink";

/**
 * "Esci" on the console: POST /api/platform/logout, then /login. It never leaves on a failed logout: the failure is shown, so the
 * person does not walk away thinking the session ended. `tone="band"` is the look for the header band, `"plain"` for a page.
 */
export function ConsoleLogout({ tone }: { tone: "band" | "plain" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function logout() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const failure = await consoleLogout();
    if (failure === null) return;
    setBusy(false);
    setError(isConsoleDown(failure) ? t("console.unavailable") : failure.error.message);
  }

  return (
    <div
      className={tone === "band" ? "flex items-center gap-3" : "flex flex-col items-start gap-2"}
    >
      {tone === "band" ? (
        <button type="button" onClick={() => void logout()} disabled={busy} className={BAND_BUTTON}>
          {t("home.logout")}
        </button>
      ) : (
        <Button variant="secondary" disabled={busy} onClick={() => void logout()}>
          {t("home.logout")}
        </Button>
      )}
      {error && (
        <p
          role="alert"
          className={tone === "band" ? "text-sm text-band-ink" : "text-sm text-danger"}
        >
          {error}
        </p>
      )}
    </div>
  );
}
