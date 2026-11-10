import { t } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/locale";
import type { PublicPage } from "@/server/reservations/public/output";

/**
 * The short notice and the full one in a `<details>` (GDPR art. 13). The controller is the venue; its name, VAT number and privacy contact come from the page's
 * own reply (the owner's settings), never from this file. The text is a DigiAlto draft until the client approves it (plan Q-R12).
 */
export function PrivacyNotice({
  privacy,
  locale,
}: {
  privacy: PublicPage["privacy"];
  locale: Locale;
}) {
  const vat = privacy.controllerVat
    ? t("publicReservation.privacy.vat", { vat: privacy.controllerVat }, locale)
    : "";
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-ink-muted">{t("publicReservation.privacy.short", {}, locale)}</p>
      <details className="rounded-lg border border-rule-strong px-3 py-2 text-sm">
        <summary className="min-h-tap cursor-pointer py-2 font-bold text-accent-ink">
          {t("publicReservation.privacy.open", {}, locale)}
        </summary>
        <div className="flex flex-col gap-2 pb-2 leading-snug">
          <p>
            {t(
              "publicReservation.privacy.controller",
              {
                name: privacy.controllerName ?? "-",
                vat,
                email: privacy.contactEmail ?? "-",
              },
              locale,
            )}
          </p>
          <p>{t("publicReservation.privacy.purpose", {}, locale)}</p>
          <p>{t("publicReservation.privacy.abuse", {}, locale)}</p>
          <p>{t("publicReservation.privacy.recipients", {}, locale)}</p>
          <p>{t("publicReservation.privacy.retention", {}, locale)}</p>
          <p>{t("publicReservation.privacy.rights", {}, locale)}</p>
          <p>{t("publicReservation.privacy.necessary", {}, locale)}</p>
        </div>
      </details>
    </div>
  );
}
