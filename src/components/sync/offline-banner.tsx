import { warningNoteClass } from "@/components/ui";
import { t } from "@/lib/i18n";
import { formatTime } from "@/lib/time/format";

/**
 * Shown on the comanda and the table list while the last read came from the phone's copy or a send failed for want of a connection
 * (M20 plan §3.6.5): orders stay on the phone and the kitchen does not see them yet. `cachedAt` is the worker's `x-offline-cached-at`
 * (an ISO instant) and adds "Dati delle 20:31" in venue time.
 */
export function OfflineBanner({ cachedAt }: { cachedAt: string | null }) {
  const at = cachedAt ? new Date(cachedAt) : null;
  const known = at !== null && !Number.isNaN(at.getTime());
  return (
    <div
      role="status"
      data-slot="offline-banner"
      className={`${warningNoteClass} flex flex-col gap-1`}
    >
      <p>{t("sync.offline.text")}</p>
      {known && <p className="text-sm">{t("sync.offline.dataAt", { time: formatTime(at) })}</p>}
    </div>
  );
}
