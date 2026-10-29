"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { MeState } from "@/components/use-me";
import { newSessionId } from "@/lib/tables/session-id";
import { EMPTY_VIEW, type SyncView } from "@/lib/sync/view";
import { openOutbox } from "./outbox";
import type { Queue } from "./queue";
import { registerServiceWorker } from "./register";
import { createSyncRuntime, type SyncRuntime } from "./runtime";
import { sendOps } from "./send";
import { canSync } from "./sync-runner";

// The hooks of the offline queue (M20 plan §3.6.2). One runtime per tab, opened the first time a table operator is known: the
// outbox, the replay engine, the queue and the runner. Screens read `useSyncView()` and write through `queue`; they hold no queue logic.

let runtime: SyncRuntime | null = null;
let starting: Promise<SyncRuntime> | null = null;
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of [...listeners]) listener();
};

/** The tab's runtime, opened on first use. */
export function getSyncRuntime(): Promise<SyncRuntime> {
  starting ??= (async () => {
    const outbox = await openOutbox();
    const created = await createSyncRuntime({
      outbox,
      send: (ops) => sendOps(ops),
      now: () => Date.now(),
      random: Math.random,
      newOpId: newSessionId,
      holder: newSessionId(),
      env: { win: window, doc: document },
    });
    runtime = created;
    created.subscribe(notify);
    notify();
    return created;
  })();
  return starting;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const getSnapshot = (): SyncView => runtime?.getSnapshot() ?? EMPTY_VIEW;
const getServerSnapshot = (): SyncView => EMPTY_VIEW;

/** What is waiting, held, offline or unseen on this phone. Empty (not ready) until the runtime is open. */
export function useSyncView(): SyncView {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** "Ho capito": marks outcomes seen, so their notices go (and the badge count drops). */
export async function markNoticesSeen(opIds: string[]): Promise<void> {
  await (await getSyncRuntime()).outbox.markSeen(opIds);
}

/** The queue: every method waits for the runtime, so a screen can call it at once. */
export const queue: Queue = {
  queueOpenTable: async (input) => (await getSyncRuntime()).queue.queueOpenTable(input),
  queueAdd: async (input) => (await getSyncRuntime()).queue.queueAdd(input),
  queueEdit: async (input) => (await getSyncRuntime()).queue.queueEdit(input),
  queueRemove: async (input) => (await getSyncRuntime()).queue.queueRemove(input),
  queueFire: async (input) => (await getSyncRuntime()).queue.queueFire(input),
  queueVoid: async (input) => (await getSyncRuntime()).queue.queueVoid(input),
  discardQueuedAdd: async (input) => (await getSyncRuntime()).queue.discardQueuedAdd(input),
};

/**
 * Called by the app shell once /api/me has answered: registers the service worker and, for owner, admin and waiter, starts the runtime
 * and tells it who is signed in. A 401 tells it nobody is (the queue stays, held for whoever queued it). The chef gets no runtime.
 */
export function useSyncBoot(state: MeState): void {
  const me = state.status === "ok" ? state.me : null;
  const userId = me?.user.id;
  const displayName = me?.user.displayName;
  const role = me?.user.role;
  const status = state.status;
  useEffect(() => {
    if (status === "ok" && userId && displayName && role) {
      void registerServiceWorker();
      if (canSync(role)) {
        void getSyncRuntime().then((rt) => rt.setMe({ id: userId, displayName, role }));
      }
    } else if (status === "signedOut" && runtime) {
      void runtime.setMe(null);
    }
  }, [status, userId, displayName, role]);
}
