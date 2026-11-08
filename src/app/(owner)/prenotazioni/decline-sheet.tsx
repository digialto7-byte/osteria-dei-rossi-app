"use client";

import { Button, Card, ErrorAlert } from "@/components/ui";
import { useFocusIntoView } from "@/components/use-focus-into-view";
import { t } from "@/lib/i18n";
import { rowTitle, type RowView } from "@/lib/reservations/day-view";
import { DECLINE_REASONS, type DeclineReason } from "@/server/reservations/constants";

/** "Rifiuta": one tap on the reason declines. Declining an accepted booking tells the customer too (the declined e-mail). */
export function DeclineSheet({
  row,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  row: RowView;
  busy: boolean;
  error: string | null;
  onSubmit: (reason: DeclineReason) => void;
  onCancel: () => void;
}) {
  const heading = useFocusIntoView<HTMLHeadingElement>();
  return (
    <Card role="group" aria-label={t("reservations.decline.title")} className="flex flex-col gap-3">
      <h2
        ref={heading}
        tabIndex={-1}
        className="font-display text-[1.5rem] leading-tight font-semibold [overflow-wrap:anywhere]"
      >
        {t("reservations.decline.title")}
      </h2>
      <p className="[overflow-wrap:anywhere]">{rowTitle(row)}</p>
      <div className="flex flex-wrap gap-2">
        {DECLINE_REASONS.map((reason) => (
          <Button key={reason} variant="danger" disabled={busy} onClick={() => onSubmit(reason)}>
            {t(`reservations.decline.${reason}`)}
          </Button>
        ))}
      </div>
      <div aria-live="polite">
        <ErrorAlert message={error} />
      </div>
      <Button variant="quiet" onClick={onCancel} disabled={busy} className="self-start">
        {t("common.cancel")}
      </Button>
    </Card>
  );
}
