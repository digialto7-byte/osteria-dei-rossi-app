"use client";

import { useState } from "react";
import { useNow } from "@/components/use-now";
import { noticesFor } from "@/lib/sync/notices";
import { markNoticesSeen, useSyncView } from "@/pwa/use-outbox";
import { canSync } from "@/pwa/sync-runner";
import { HeldOpsBanner } from "./held-ops-banner";
import { ShellSyncNotices } from "./shell-sync-notices";
import { SyncBadge } from "./sync-badge";
import { SyncNotices } from "./sync-notices";

/**
 * The offline queue's status for a table operator, at the top of every screen in the shell (M20 plan §3.6.5): the badge (a tap opens the
 * notices of every table), the held-operations banner and the phone-wide notices. Owner, admin and waiter only; the chef has no queue.
 * It reads the snapshot and renders; the words are made in src/lib/sync.
 */
export function SyncStatus({ role }: { role: string | undefined }) {
  const view = useSyncView();
  const [open, setOpen] = useState(false);
  const now = useNow(view.state === "backoff" ? 1_000 : null);
  if (!canSync(role) || !view.ready) return null;
  const notices = noticesFor(view.outcomes);
  return (
    <div data-slot="sync-status" className="flex flex-col gap-3 empty:hidden">
      <SyncBadge view={view} now={now} expanded={open} onToggle={() => setOpen((v) => !v)} />
      {open && (
        <SyncNotices notices={notices} onDismiss={(notice) => void markNoticesSeen(notice.opIds)} />
      )}
      <HeldOpsBanner held={view.held} />
      <ShellSyncNotices view={view} />
    </div>
  );
}
