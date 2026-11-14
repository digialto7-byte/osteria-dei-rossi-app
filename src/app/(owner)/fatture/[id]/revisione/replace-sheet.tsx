"use client";

import { Button, ErrorAlert } from "@/components/ui";
import { t } from "@/lib/i18n";

/**
 * "Usare il file XML?": the second tap of "Usa il file XML al posto del PDF", drawn in place (not a modal, so there is no focus
 * trap on a phone). It says what the tap does: the photo or PDF copy is rejected and kept in the archive, and the mappings already
 * saved for the supplier apply to the XML lines when code or description match. Display only; the caller sends the request.
 */
export function ReplaceSheet({
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="group"
      aria-label={t("review.xml.sheetTitle")}
      className="flex w-full flex-col gap-3 rounded-lg border border-rule bg-surface p-3 text-ink"
    >
      <h3 className="font-bold">{t("review.xml.sheetTitle")}</h3>
      <p>{t("review.xml.sheetBody")}</p>
      <p>{t("review.xml.sheetMappings")}</p>
      <ErrorAlert message={error} />
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} aria-busy={busy} onClick={onConfirm}>
          {busy ? t("review.xml.saving") : t("review.xml.sheetConfirm")}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}
