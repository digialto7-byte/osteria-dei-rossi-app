import { useSyncExternalStore } from "react";
import { EMPTY_VIEW } from "@/lib/sync/view";
import { openOutbox } from "@/pwa/outbox";
import { createSyncRuntime, type SyncRuntime } from "@/pwa/runtime";
import { DEMO } from "./sync-data";

// A real runtime (memory outbox, the real queue, overlay and snapshot) behind the `@/pwa/use-outbox` hooks, for the component tests of the
// Comanda and the table list (M20 plan step 20). Nothing is sent: the replay engine is not started, `send` never resolves. Tests that need
// an outcome write it into the outbox themselves (enqueue + settle). Use it like this in a test file:
//
//   vi.mock("@/pwa/use-outbox", async () => (await import("../helpers/sync-runtime")).useOutboxMock());
//   beforeEach(async () => { await startRuntime(); });  afterEach(stopRuntime);

export const bridge: { runtime: SyncRuntime | null } = { runtime: null };

export async function startRuntime(
  me: { id: string; displayName: string; role: "owner" | "admin" | "waiter" | "chef" } = {
    ...DEMO,
    role: "waiter",
  },
): Promise<SyncRuntime> {
  const outbox = await openOutbox({ idb: null });
  const runtime = await createSyncRuntime({
    outbox,
    send: () => new Promise(() => undefined),
    now: () => Date.now(),
    random: () => 0.5,
    newOpId: () => crypto.randomUUID(),
    holder: "test",
  });
  await runtime.setMe(me);
  bridge.runtime = runtime;
  return runtime;
}

export function stopRuntime(): void {
  bridge.runtime?.stop();
  bridge.runtime?.outbox.close();
  bridge.runtime = null;
}

const runtime = () => {
  if (!bridge.runtime) throw new Error("startRuntime() was not called");
  return bridge.runtime;
};

/** The module `@/pwa/use-outbox` exports, backed by the runtime in `bridge`. */
export function useOutboxMock() {
  const subscribe = (listener: () => void) =>
    bridge.runtime ? bridge.runtime.subscribe(listener) : () => undefined;
  return {
    useSyncView: () =>
      useSyncExternalStore(
        subscribe,
        () => bridge.runtime?.getSnapshot() ?? EMPTY_VIEW,
        () => EMPTY_VIEW,
      ),
    useSyncBoot: () => undefined,
    getSyncRuntime: async () => runtime(),
    markNoticesSeen: async (ids: string[]) => runtime().outbox.markSeen(ids),
    queue: {
      queueOpenTable: (i: never) => runtime().queue.queueOpenTable(i),
      queueAdd: (i: never) => runtime().queue.queueAdd(i),
      queueEdit: (i: never) => runtime().queue.queueEdit(i),
      queueRemove: (i: never) => runtime().queue.queueRemove(i),
      queueFire: (i: never) => runtime().queue.queueFire(i),
      queueVoid: (i: never) => runtime().queue.queueVoid(i),
      removeLine: (i: never) => runtime().queue.removeLine(i),
      discardQueuedAdd: (i: never) => runtime().queue.discardQueuedAdd(i),
    },
  };
}
