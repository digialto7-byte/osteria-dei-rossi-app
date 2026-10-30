import { deriveView, EMPTY_VIEW, type SyncView } from "@/lib/sync/view";
import { tablesChanged } from "@/lib/sync/tables-refresh";
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
  /** Logout, PIN login, purge: nobody is signed in on this tab any more (the queue stays, held for whoever queued it). */
  clearUser(): Promise<void>;
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
  /** Reads /api/tables through the worker so its copy has the tables just opened; debounced, after an open_table was applied; returning `false` (or throwing) means the read failed and it is tried again at the next run. */
  refreshTables?: () => unknown;
  /** The browser, to start the runner; absent in tests that drive the engine by hand. */
  env?: {
    win: Parameters<typeof startSyncRunner>[0]["win"];
    doc: Parameters<typeof startSyncRunner>[0]["doc"];
  };
}

const TABLES_REFRESH_DEBOUNCE_MS = 500;

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

  // An applied open_table makes the worker's copy of the table list stale: refresh it once, a moment later, however many were opened.
  // At most ONE refresh is pending. If its read fails (offline, a refusal) it stays pending and is tried again the next time the replay
  // is idle again, i.e. its next run; it is dropped when the person changes (a read under the next person's cookies could end the session).
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshPending = false;
  const scheduleTablesRefresh = () => {
    if (!deps.refreshTables || !refreshPending || refreshTimer !== null || stopped) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      if (stopped || !refreshPending) return;
      void (async () => {
        let done = false;
        try {
          done = (await deps.refreshTables?.()) !== false;
        } catch {
          done = false;
        }
        if (done) refreshPending = false;
      })();
    }, TABLES_REFRESH_DEBOUNCE_MS);
  };
  const cancelTablesRefresh = () => {
    refreshPending = false;
    if (refreshTimer !== null) clearTimeout(refreshTimer);
    refreshTimer = null;
  };

  const replayer = createReplayer({
    onSettled: (settled) => {
      if (tablesChanged(settled)) {
        refreshPending = true;
        scheduleTablesRefresh();
      }
    },
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
  const stopReplayer = replayer.subscribe(() => {
    void refresh();
    // A refresh that failed is tried again when the replay is idle again (a run that ended well, or had nothing to send).
    if (refreshPending && replayer.getState().state === "idle") scheduleTablesRefresh();
  });
  await outbox.pruneOutcomes(deps.now());
  await refresh();

  // The runner starts when the current user is known (setMe), never from the user remembered on the phone: that one may be the
  // person who just logged out, and their operations must not be tried under the next login.
  function startRunner() {
    if (runner || stopped || !deps.env) return;
    runner = startSyncRunner({
      win: deps.env.win,
      doc: deps.env.doc,
      replayer,
      pendingCount: async () => (await outbox.pending()).length,
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    });
  }

  // Leaving a page must not make the next one wait for the lease: release the record at once (the send in progress still completes, and a
  // second sender is harmless, the server answers a repeated op as a duplicate). Best effort: a page that vanishes keeps it only for the
  // short lease. Done whether or not the runner has started.
  const releaseLease = () => void outbox.releaseLease(deps.holder).catch(() => undefined);
  const onPageHide = () => releaseLease();
  const onVisibility = () => {
    if (deps.env?.doc.visibilityState === "hidden") releaseLease();
  };
  deps.env?.win.addEventListener("pagehide", onPageHide);
  deps.env?.doc.addEventListener("visibilitychange", onVisibility);

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
      if ((user?.id ?? null) !== before) {
        replayer.resetUserHolds();
        cancelTablesRefresh(); // queued for the person who left
      }
      await refresh();
      if (user) {
        startRunner();
        runner?.trigger();
      }
    },
    async clearUser() {
      const before = meUser()?.id ?? null;
      current = null;
      remembered = null;
      await outbox.clearLastUser();
      if (before !== null) replayer.resetUserHolds();
      cancelTablesRefresh();
      await refresh();
    },
    refresh,
    stop() {
      stopped = true;
      cancelTablesRefresh();
      deps.env?.win.removeEventListener("pagehide", onPageHide);
      deps.env?.doc.removeEventListener("visibilitychange", onVisibility);
      stopOutbox();
      stopReplayer();
      runner?.stop();
      listeners.clear();
    },
  };
}
