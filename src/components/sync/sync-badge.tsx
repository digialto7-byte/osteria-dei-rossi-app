import { badgeParts } from "@/lib/sync/badge";
import type { SyncView } from "@/lib/sync/view";

/**
 * The pending-operations badge (M20 plan §3.6.5): "In coda · 3" (named "3 operazioni in attesa di invio"), and beside it the state in
 * words ("Offline", "Invio…", "Nuovo tentativo tra 15 s") in a polite live region. Hidden when nothing is waiting, held or unseen.
 * A tap opens the notices panel. It takes the snapshot and the clock; the words are made by src/lib/sync/badge.ts.
 */
export function SyncBadge({
  view,
  now,
  expanded,
  onToggle,
}: {
  view: SyncView;
  now: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const parts = badgeParts(view, now);
  if (!parts) return null;
  return (
    <div data-slot="sync-badge" className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <button
        type="button"
        aria-label={parts.aria}
        aria-expanded={expanded}
        onClick={onToggle}
        className="inline-flex min-h-tap items-center rounded-full border-[1.5px] border-warning bg-warning-bg px-4 text-base font-bold text-warning"
      >
        {parts.label}
      </button>
      <span role="status" aria-live="polite" className="text-sm text-ink-muted">
        {parts.stateWord}
      </span>
    </div>
  );
}
