"use client";

import { useEffect, useState } from "react";
import { Button, ErrorAlert, Heading, Muted, SuccessNote, linkClass } from "@/components/ui";
import { apiJson } from "@/lib/api/client";
import { t, tn } from "@/lib/i18n";
import { LOCALES, type Locale } from "@/lib/i18n/locale";
import { dayLabel, errorMessage } from "@/lib/reservations/public-view";
import { SLUG_PATTERN } from "@/server/reservations/constants";
import type { CancelReply, CancelViewReply } from "@/server/reservations/public/output";

type Phase =
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "view"; view: CancelViewReply }
  | { kind: "done"; already: boolean };

/**
 * The page behind the cancel link in an e-mail. It reads the booking (GET, which never writes) and shows it; only the button cancels (POST), because mail scanners
 * open links. A bad, expired or foreign link is one "not valid" text. No name, phone or e-mail is ever shown, and no table.
 */
export function CancelView({
  slug,
  token,
  locale,
}: {
  slug: string;
  token: string | null;
  locale: Locale;
}) {
  // The slug comes from the address bar: one that is not a slug is an invalid link without a request, and a valid one is encoded all the same.
  const usable = SLUG_PATTERN.test(slug) && token !== null;
  const base = `/api/public/reservations/${encodeURIComponent(slug)}/cancel`;
  const tt = (key: Parameters<typeof t>[0], values: Record<string, string | number> = {}) =>
    t(key, values, locale);
  const [phase, setPhase] = useState<Phase>(usable ? { kind: "loading" } : { kind: "invalid" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!usable || token === null) return;
    let live = true;
    void apiJson<CancelViewReply>(`${base}?t=${encodeURIComponent(token)}`).then((result) => {
      if (!live) return;
      setPhase(result.ok ? { kind: "view", view: result.data } : { kind: "invalid" });
    });
    return () => {
      live = false;
    };
  }, [base, token, usable]);

  async function cancel() {
    if (!usable || token === null || busy) return;
    setBusy(true);
    setError(null);
    const result = await apiJson<CancelReply>(base, { method: "POST", body: { token } });
    setBusy(false);
    if (result.ok) setPhase({ kind: "done", already: result.data.already });
    else if (result.error.code === "link_invalid") setPhase({ kind: "invalid" });
    else setError(errorMessage(result.error, locale));
  }

  const languageSwitch = (
    <nav aria-label={tt("publicReservation.lang.label")} className="flex gap-4 text-sm">
      {LOCALES.map((candidate) =>
        candidate === locale ? (
          <span key={candidate} aria-current="true" className="font-bold">
            {tt(`publicReservation.lang.${candidate}`)}
          </span>
        ) : (
          <a
            key={candidate}
            className={linkClass}
            href={`?t=${encodeURIComponent(token ?? "")}${candidate === "en" ? "&lang=en" : ""}`}
          >
            {tt(`publicReservation.lang.${candidate}`)}
          </a>
        ),
      )}
    </nav>
  );

  let body;
  if (phase.kind === "loading") body = <Muted>{tt("publicReservation.loading")}</Muted>;
  else if (phase.kind === "invalid")
    body = <ErrorAlert message={tt("publicReservation.cancel.invalid")} />;
  else if (phase.kind === "done") {
    body = (
      <SuccessNote role="status">
        {tt(phase.already ? "publicReservation.cancel.already" : "publicReservation.cancel.done")}
      </SuccessNote>
    );
  } else {
    const { view } = phase;
    body = (
      <div className="flex flex-col gap-4">
        <dl className="flex flex-col gap-2">
          <Row
            label={tt("publicReservation.cancel.when")}
            value={`${dayLabel(view.date, locale)}, ${view.time}`}
          />
          <Row
            label={tt("publicReservation.cancel.party")}
            value={tn("reservationMail.party", view.party, locale)}
          />
          <Row label={tt("publicReservation.cancel.service")} value={view.serviceName} />
          <Row
            label={tt("publicReservation.cancel.status")}
            value={tt(`publicReservation.status.${view.status}`)}
          />
        </dl>
        {view.canCancel ? (
          <>
            <ErrorAlert message={error} />
            <Button variant="danger" disabled={busy} onClick={cancel}>
              {busy
                ? tt("publicReservation.cancel.working")
                : tt("publicReservation.cancel.button")}
            </Button>
          </>
        ) : (
          <Muted>
            {view.status === "cancelled"
              ? tt("publicReservation.cancel.already")
              : tt("publicReservationError.cancel_status")}
          </Muted>
        )}
      </div>
    );
  }

  return (
    <div lang={locale} className="flex flex-col gap-5">
      {languageSwitch}
      <Heading>{tt("publicReservation.cancel.title")}</Heading>
      {body}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="font-bold">{value}</dd>
    </div>
  );
}
