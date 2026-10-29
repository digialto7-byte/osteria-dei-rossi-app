import { deriveView, EMPTY_VIEW, type SyncView } from "@/lib/sync/view";
import { createReplayer, type Replayer, type SendResult } from "@/lib/sync/replay";
import type { LastUser, QueuedBy } from "@/lib/sync/types";
import type { OpEnvelope } from "@/server/sync/schemas";
import type { Outbox } from "./outbox";
import { createQueue, type Queue } from "./queue";
import { startSyncRunner } from "./sync-runner";

// The glue of the offline queue on one tab (M20 plan §3.6.2): the outbox, the replay engine, the queue and the runner, and a cached
// snapshot for the screens (useSyncExternalStore needs the same object until something changes). Every input is injected.

export interface SyncRuntime {
  outbox: Outbox;
  replayer: Replayer;
  queue: Queue;
  getSnapshot(): SyncView;
  subscribe(listener: () => void): () => void;
  /** The person signed in on this tab (null: signed out for sure). Remembered on the phone for when there is no connection. */
  setMe(user: LastUser | null): Promise<void>;
  /** Reads the outbox again and publishes a new snapshot. */
  refresh(): Promise<void>;
  stop(): void;
}

export interface RuntimeDeps {
  outbox: Outbox;
  send: (ops: OpEnvelope[]) => Promise<SendResult>;
  now: () => number;
  random: () => number;
  newOpId: () => string;
  /** This tab's name in the replay lease. */
  holder: string;
  /** The browser, to start the runner; absent in tests that drive the engine by hand. */
  env?: {
    win: Parameters<typeof startSyncRunner>[0]["win"];
    doc: Parameters<typeof startSyncRunner>[0]["doc"];
  };
}

export async function createSyncRuntime(deps: RuntimeDeps): Promise<SyncRuntime> {
  const { outbox } = deps;
  let current: LastUser | null = null;
  let remembered: LastUser | null = await outbox.getLastUser();
  let snapshot: SyncView = EMPTY_VIEW;
  const listeners = new Set<() => void>();
  let runner: ReturnType<typeof startSyncRunner> | null = null;
  let stopped = false;

  const meUser = (): LastUser | null => current ?? remembered;
  const asQueuedBy = (user: LastUser | null): QueuedBy | null =>
    user ? { id: user.id, displayName: user.displayName } : null;

  const replayer = createReplayer({
    store: outbox,
    send: deps.send,
    me: async () => meUser(),
    now: deps.now,
    random: deps.random,
    newOpId: deps.newOpId,
    holder: deps.holder,
  });
  const queue = createQueue({
    outbox,
    me: async () => asQueuedBy(meUser()),
    now: () => new Date(deps.now()),
    newOpId: deps.newOpId,
    onQueued: () => runner?.trigger(),
  });

  async function refresh(): Promise<void> {
    if (stopped) return;
    const [ops, outcomes] = await Promise.all([outbox.pending(), outbox.outcomes()]);
    snapshot = deriveView({
      ops,
      outcomes,
      replay: replayer.getState(),
      memoryOnly: outbox.memoryOnly,
      me: meUser()?.id ?? null,
    });
    for (const listener of [...listeners]) listener();
  }

  const stopOutbox = outbox.subscribe(() => void refresh());
  const stopReplayer = replayer.subscribe(() => void refresh());
  await outbox.pruneOutcomes(deps.now());
  await refresh();

  if (deps.env) {
    runner = startSyncRunner({
      win: deps.env.win,
      doc: deps.env.doc,
      replayer,
      pendingCount: async () => (await outbox.pending()).length,
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    });
  }

  return {
    outbox,
    replayer,
    queue,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async setMe(user) {
      const before = meUser()?.id ?? null;
      current = user;
      if (user) {
        remembered = user;
        await outbox.setLastUser(user);
      } else {
        // Signed out for sure: nobody is the last user. The queue stays (it is held for whoever queued it).
        remembered = null;
        await outbox.clearLastUser();
      }
      // A different person means the server's earlier refusals (user_mismatch) no longer apply.
      if ((user?.id ?? null) !== before) replayer.resetUserHolds();
      await refresh();
      if (user) runner?.trigger();
    },
    refresh,
    stop() {
      stopped = true;
      stopOutbox();
      stopReplayer();
      runner?.stop();
      listeners.clear();
    },
  };
}
