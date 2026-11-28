"use client";

import { useId, useState } from "react";
import { Button, ErrorAlert, Muted, linkClass } from "@/components/ui";
import { consoleApi } from "@/lib/console/console-api";
import { enterVenueMessage, safeVenueUrl } from "@/lib/console/enter-venue";
import { t } from "@/lib/i18n";

type Step =
  | { kind: "idle" }
  | { kind: "asking" }
  | { kind: "busy" }
  | { kind: "opened"; url: string }
  | { kind: "failed"; message: string };

/**
 * «Entra nel locale» (SP3 step 19, plan §3.7; Q-P15). Only where DigiAlto already has an admin row (`attached`); elsewhere the button is disabled and says why.
 * A tap asks first, with the §3.7 text; confirming posts …/open (the platform audit row) and opens the venue app's chooser in a new tab without an opener. The
 * link stays on screen in case the browser blocked the tab. The console session is not changed: the app host is a separate sign-in.
 */
export function EnterVenue({
  tenantId,
  attached,
  describedBy,
}: {
  tenantId: string;
  attached: boolean;
  /** The id of a sentence already on screen that says why the button is disabled (the detail's Salute); without it the button shows its own. */
  describedBy?: string;
}) {
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const noteId = useId();

  async function enter() {
    if (step.kind === "busy") return;
    setStep({ kind: "busy" });
    const result = await consoleApi<{ url: string }>(
      `/api/platform/tenants/${encodeURIComponent(tenantId)}/open`,
      { method: "POST", body: {} },
    );
    if (!result.ok) {
      if (!result.leaving) setStep({ kind: "failed", message: enterVenueMessage(result) });
      return;
    }
    const url = safeVenueUrl(result.data.url);
    if (url === null) {
      setStep({ kind: "failed", message: t("console.enter.error") });
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
    setStep({ kind: "opened", url });
  }

  if (!attached) {
    return (
      <div className="flex flex-col gap-2">
        <div>
          <Button variant="secondary" disabled aria-describedby={describedBy ?? noteId}>
            {t("console.enter.button")}
          </Button>
        </div>
        {describedBy === undefined && (
          <Muted>
            <span id={noteId}>{t("console.detail.health.notAttached")}</span>
          </Muted>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {step.kind === "idle" || step.kind === "opened" || step.kind === "failed" ? (
        <div>
          <Button variant="secondary" onClick={() => setStep({ kind: "asking" })}>
            {t("console.enter.button")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p>{t("console.enter.confirm")}</p>
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() => void enter()}
              aria-disabled={step.kind === "busy" ? true : undefined}
            >
              {t("console.enter.go")}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setStep({ kind: "idle" })}
              disabled={step.kind === "busy"}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      )}
      {step.kind === "opened" && (
        <a href={step.url} target="_blank" rel="noopener noreferrer" className={linkClass}>
          {t("console.enter.link")}
        </a>
      )}
      <ErrorAlert message={step.kind === "failed" ? step.message : null} />
    </div>
  );
}
