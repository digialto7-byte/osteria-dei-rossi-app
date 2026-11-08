"use client";

import { Button, Card, ErrorAlert } from "@/components/ui";
import { useFocusIntoView } from "@/components/use-focus-into-view";
import { t } from "@/lib/i18n";
import { rowTitle, type RowView } from "@/lib/reservations/day-view";

/** "Cancella dati cliente": a confirmation first, because the name, phone and e-mail cannot come back (the booking itself stays, for the statistics). */
export function EraseSheet({
  row,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  row: RowView;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const heading = useFocusIntoView<HTMLHeadingElement>();
  return (
    <Card role="group" aria-label={t("reservations.erase.title")} className="flex flex-col gap-3">
      <h2
        ref={heading}
        tabIndex={-1}
        className="font-display text-[1.5rem] leading-tight font-semibold [overflow-wrap:anywhere]"
      >
        {t("reservations.erase.title")}
      </h2>
      <p className="[overflow-wrap:anywhere]">{rowTitle(row)}</p>
      <p>{t("reservations.erase.text")}</p>
      <div aria-live="polite">
        <ErrorAlert message={error} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="danger" onClick={onConfirm} disabled={busy}>
          {t("reservations.erase.confirm")}
        </Button>
        <Button variant="quiet" onClick={onCancel} disabled={busy}>
          {t("common.cancel")}
        </Button>
      </div>
    </Card>
  );
}
