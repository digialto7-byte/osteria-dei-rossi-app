import { warningNoteClass } from "@/components/ui";
import { t } from "@/lib/i18n";
import type { Held } from "@/lib/sync/sendable";

/**
 * Operations queued by someone else on this phone wait for that person (M20 plan §3.1.9, AT8): "Ci sono 3 operazioni di Cameriere
 * Demo non ancora inviate. Accedi come Cameriere Demo su questo telefono per inviarle." One line per person, in an alert.
 */
export function HeldOpsBanner({ held }: { held: Held[] }) {
  if (held.length === 0) return null;
  return (
    <div
      role="alert"
      data-slot="held-ops-banner"
      className={`${warningNoteClass} flex flex-col gap-1`}
    >
      {held.map((entry) => (
        <p key={entry.user.id} data-user-id={entry.user.id}>
          {t(entry.count === 1 ? "sync.held.one" : "sync.held.other", {
            count: entry.count,
            name: entry.user.displayName,
          })}
        </p>
      ))}
    </div>
  );
}
