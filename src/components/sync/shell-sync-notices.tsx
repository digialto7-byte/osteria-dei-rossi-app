import { warningNoteClass } from "@/components/ui";
import { t, tn } from "@/lib/i18n";
import { skewNotice } from "@/lib/sync/skew";
import type { SyncView } from "@/lib/sync/view";

/**
 * The notices that belong to the whole phone, not to a table (M20 plan §3.6.5): signed out with operations waiting, an operation that
 * will not go, a wrong clock, and a browser that cannot keep the queue across a reload. Each is a plain sentence; the person is told
 * what to do, and nothing is dropped.
 */
export function ShellSyncNotices({ view }: { view: SyncView }) {
  const skew = skewNotice(view.skewMs);
  const signedOut = view.state === "signedOut" && view.pending > 0;
  if (!signedOut && !view.stuck && !skew && !view.memoryOnly) return null;
  return (
    <div data-slot="shell-sync-notices" className="flex flex-col gap-2">
      {signedOut && (
        <p role="alert" data-notice="signed-out" className={warningNoteClass}>
          {tn("sync.signedOut", view.pending)}
        </p>
      )}
      {view.stuck && (
        <p role="alert" data-notice="stuck" className={warningNoteClass}>
          {t("sync.stuck")}
        </p>
      )}
      {skew && (
        <p role="status" data-notice="skew" className={warningNoteClass}>
          {skew}
        </p>
      )}
      {view.memoryOnly && (
        <p role="alert" data-notice="memory-only" className={warningNoteClass}>
          {t("sync.memoryOnly")}
        </p>
      )}
    </div>
  );
}
