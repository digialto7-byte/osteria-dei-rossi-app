import { warningNoteClass } from "@/components/ui";
import { t } from "@/lib/i18n";

/**
 * Shown at the top of the kitchen screen when the last successful read is more than a minute old (PRD: "stale banner after
 * 60 s without a heartbeat"). It is an alert, in words; the list stays visible underneath. The page decides `stale` from
 * its own clock (kitchen-view.ts isStale), so a phone/server clock skew cannot trigger it.
 */
export function StaleBanner({ stale }: { stale: boolean }) {
  if (!stale) return null;
  return (
    <p role="alert" className={warningNoteClass}>
      {t("kitchen.stale")}
    </p>
  );
}
