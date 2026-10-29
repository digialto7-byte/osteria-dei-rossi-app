import { newSessionId } from "@/lib/tables/session-id";
import { OUTCOME_KEEP_MS } from "@/server/sync/constants";
import type {
  DroppedReason,
  LastUser,
  OpDraft,
  OutboxOp,
  OutcomeRecord,
  Settlement,
} from "@/lib/sync/types";

// The IndexedDB outbox of the offline queue (M20 plan §3.6.1; ADR-005, ADR-022). Database `osteria-sync`, version 1:
//   outbox    keyPath opId, indexes bySeq (unique) and byUser   the ops waiting to be sent, in `seq` order
//   outcomes  keyPath opId, indexes bySeq and bySession         what became of each op, kept for the notices
//   meta      keyPath key                                       nextSeq, replayLease, lastUser
// Every multi-record change is ONE readwrite transaction (enqueue, settle, prune, pruneOutcomes), so a crash or an abort leaves
// both stores as they were. When IndexedDB is missing or cannot be opened (a private window), the same API runs in memory and
// `memoryOnly` is true: the screen then warns that closing the page loses the orders. A BroadcastChannel wakes the other tabs.

type StoreName = "outbox" | "outcomes" | "meta";

interface Tx {
  get<T>(store: StoreName, key: string): Promise<T | undefined>;
  put(store: StoreName, value: object): Promise<void>;
  delete(store: StoreName, key: string): Promise<void>;
  /** Every record of a store; outbox and outcomes come in `seq` order. */
  all<T>(store: StoreName): Promise<T[]>;
}

interface Backend {
  run<T>(stores: StoreName[], mode: IDBTransactionMode, fn: (tx: Tx) => Promise<T>): Promise<T>;
  close(): void;
}

interface MetaRecord<T = unknown> {
  key: string;
  value: T;
}

const BY_SEQ: Record<StoreName, boolean> = { outbox: true, outcomes: true, meta: false };

// ---------------------------------------------------------------------------------------------------------------------------
// IndexedDB backend

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const opening = factory.open(name, 1);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      const outbox = db.createObjectStore("outbox", { keyPath: "opId" });
      outbox.createIndex("bySeq", "seq", { unique: true });
      outbox.createIndex("byUser", "userId");
      const outcomes = db.createObjectStore("outcomes", { keyPath: "opId" });
      outcomes.createIndex("bySeq", "seq");
      outcomes.createIndex("bySession", "scope.sessionId");
      db.createObjectStore("meta", { keyPath: "key" });
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error ?? new Error("IndexedDB open failed"));
    opening.onblocked = () => reject(new Error("IndexedDB open blocked"));
  });
}

function idbBackend(db: IDBDatabase): Backend {
  db.onversionchange = () => db.close();
  return {
    async run(stores, mode, fn) {
      const tx = db.transaction(stores, mode);
      const done = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
      });
      done.catch(() => undefined);
      const api: Tx = {
        get: async <T>(store: StoreName, key: string) =>
          (await request(tx.objectStore(store).get(key))) as T | undefined,
        put: async (store, value) => {
          await request(tx.objectStore(store).put(value));
        },
        delete: async (store, key) => {
          await request(tx.objectStore(store).delete(key));
        },
        all: async <T>(store: StoreName) => {
          const source = tx.objectStore(store);
          const target = BY_SEQ[store] ? source.index("bySeq") : source;
          return (await request(target.getAll())) as T[];
        },
      };
      let result: Awaited<ReturnType<typeof fn>>;
      try {
        result = await fn(api);
      } catch (error) {
        try {
          tx.abort();
        } catch {
          // already finished or aborted
        }
        await done.catch(() => undefined);
        throw error;
      }
      await done;
      return result;
    },
    close: () => db.close(),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Memory backend: the same semantics. A transaction works on a copy and replaces the state only when it succeeds; transactions
// run one after the other.

function memoryBackend(): Backend {
  let state: Record<StoreName, Map<string, object>> = {
    outbox: new Map(),
    outcomes: new Map(),
    meta: new Map(),
  };
  let chain: Promise<unknown> = Promise.resolve();
  const keyOf = (store: StoreName) => (store === "meta" ? "key" : "opId");
  return {
    run(_stores, _mode, fn) {
      const next = chain.then(async () => {
        const work = {
          outbox: new Map(state.outbox),
          outcomes: new Map(state.outcomes),
          meta: new Map(state.meta),
        };
        const api: Tx = {
          get: async <T>(store: StoreName, key: string) => {
            const found = work[store].get(key);
            return found === undefined ? undefined : (structuredClone(found) as T);
          },
          put: async (store, value) => {
            const copy = structuredClone(value) as Record<string, unknown>;
            const key = copy[keyOf(store)] as string;
            if (store === "outbox") {
              for (const [other, existing] of work.outbox) {
                if (
                  other !== key &&
                  (existing as OutboxOp).seq === (copy as unknown as OutboxOp).seq
                ) {
                  throw new Error("Constraint: seq must be unique");
                }
              }
            }
            work[store].set(key, copy);
          },
          delete: async (store, key) => {
            work[store].delete(key);
          },
          all: async <T>(store: StoreName) => {
            const rows = [...work[store].values()].map((row) => structuredClone(row) as T);
            return BY_SEQ[store]
              ? rows.sort((x, y) => (x as { seq: number }).seq - (y as { seq: number }).seq)
              : rows;
          },
        };
        const result = await fn(api);
        state = work;
        return result;
      });
      chain = next.catch(() => undefined);
      return next;
    },
    close: () => undefined,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// The outbox

export interface PruneRewrite {
  /** The op id being replaced; the new op keeps its seq. */
  replaces: string;
  op: OutboxOp;
}

export interface PruneDrop {
  opId: string;
  reason: DroppedReason;
  settledAt: number;
}

export interface Outbox {
  /** True when IndexedDB was not available: the queue lives in memory and is lost with the page. */
  readonly memoryOnly: boolean;
  enqueue(draft: OpDraft): Promise<OutboxOp>;
  /** The waiting ops in `seq` order. */
  pending(): Promise<OutboxOp[]>;
  outcomes(): Promise<OutcomeRecord[]>;
  markAttempt(opId: string, now: number): Promise<void>;
  /** Stamps the first time each named op was put in a request (before the request goes out); an earlier stamp stays. */
  markSent(opIds: string[], now: number): Promise<void>;
  /** Moves each named op from the outbox to the outcomes, in one transaction. A result for an op that is gone is ignored. */
  settle(settlements: Settlement[]): Promise<void>;
  /**
   * Rewrites, drops and silent discards in one transaction (plan §3.1.8). A drop leaves a `dropped` outcome (a notice); a discard
   * leaves nothing (the person threw the op away themselves).
   */
  prune(change: {
    rewrites: PruneRewrite[];
    drops: PruneDrop[];
    discards?: string[];
  }): Promise<void>;
  /** Deletes ops that were never sent, with no outcome ("Scarta"). */
  discard(opIds: string[]): Promise<void>;
  markSeen(opIds: string[]): Promise<void>;
  /** Deletes outcomes that are seen or older than `keepMs`; returns how many. */
  pruneOutcomes(now: number, keepMs?: number): Promise<number>;
  /** One replayer per device: true when `holder` now holds the lease (or already did). */
  acquireLease(holder: string, now: number, ms: number): Promise<boolean>;
  releaseLease(holder: string): Promise<void>;
  getLastUser(): Promise<LastUser | null>;
  setLastUser(user: LastUser): Promise<void>;
  /** Signed out for sure (a 401): nobody is the "last user" any more. */
  clearLastUser(): Promise<void>;
  /** Calls `listener` after any change made here or in another tab. Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
  close(): void;
}

export interface OpenOptions {
  name?: string;
  /** The IndexedDB factory; null forces the memory fallback. Defaults to the global one. */
  idb?: IDBFactory | null;
}

const CHANNEL = "osteria-sync";

export async function openOutbox(options: OpenOptions = {}): Promise<Outbox> {
  const name = options.name ?? "osteria-sync";
  const factory = options.idb === undefined ? (globalThis.indexedDB ?? null) : options.idb;
  let backend: Backend;
  let memoryOnly = false;
  try {
    if (!factory) throw new Error("no IndexedDB");
    backend = idbBackend(await openDatabase(factory, name));
  } catch {
    backend = memoryBackend();
    memoryOnly = true;
  }

  const listeners = new Set<() => void>();
  const channel =
    typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(`${CHANNEL}:${name}`);
  const wake = () => {
    for (const listener of [...listeners]) listener();
  };
  if (channel) channel.onmessage = wake;
  const changed = () => {
    wake();
    channel?.postMessage("changed");
  };

  const readMeta = async <T>(tx: Tx, key: string): Promise<T | undefined> =>
    (await tx.get<MetaRecord<T>>("meta", key))?.value;

  const outcomeOf = (op: OutboxOp, s: Settlement): OutcomeRecord => ({
    opId: op.opId,
    seq: op.seq,
    kind: op.kind,
    userId: op.userId,
    scope: op.scope,
    label: op.label,
    clientTs: op.clientTs,
    status: s.status,
    settledAt: s.settledAt,
    ...(s.receivedAt !== undefined ? { receivedAt: s.receivedAt } : {}),
    ...(s.conflict !== undefined ? { conflict: s.conflict } : {}),
    ...(s.error !== undefined ? { error: s.error } : {}),
    ...(s.droppedReason !== undefined ? { droppedReason: s.droppedReason } : {}),
    seen: false,
  });

  return {
    memoryOnly,

    async enqueue(draft) {
      const op = await backend.run(["outbox", "meta"], "readwrite", async (tx) => {
        const seq = (await readMeta<number>(tx, "nextSeq")) ?? 1;
        const made: OutboxOp = {
          ...draft,
          opId: draft.opId ?? newSessionId(),
          seq,
          attempts: 0,
          lastAttemptAt: null,
        };
        await tx.put("outbox", made);
        await tx.put("meta", { key: "nextSeq", value: seq + 1 });
        return made;
      });
      changed();
      return op;
    },

    pending: () => backend.run(["outbox"], "readonly", (tx) => tx.all<OutboxOp>("outbox")),
    outcomes: () =>
      backend.run(["outcomes"], "readonly", (tx) => tx.all<OutcomeRecord>("outcomes")),

    async markAttempt(opId, now) {
      await backend.run(["outbox"], "readwrite", async (tx) => {
        const op = await tx.get<OutboxOp>("outbox", opId);
        if (op) await tx.put("outbox", { ...op, attempts: op.attempts + 1, lastAttemptAt: now });
      });
      changed();
    },

    async markSent(opIds, now) {
      await backend.run(["outbox"], "readwrite", async (tx) => {
        for (const id of opIds) {
          const op = await tx.get<OutboxOp>("outbox", id);
          if (op && op.sentAt == null) await tx.put("outbox", { ...op, sentAt: now });
        }
      });
      changed();
    },

    async settle(settlements) {
      await backend.run(["outbox", "outcomes"], "readwrite", async (tx) => {
        for (const s of settlements) {
          const op = await tx.get<OutboxOp>("outbox", s.opId);
          if (!op) continue;
          await tx.delete("outbox", s.opId);
          await tx.put("outcomes", outcomeOf(op, s));
        }
      });
      changed();
    },

    async prune({ rewrites, drops, discards = [] }) {
      await backend.run(["outbox", "outcomes"], "readwrite", async (tx) => {
        for (const id of discards) await tx.delete("outbox", id);
        for (const drop of drops) {
          const op = await tx.get<OutboxOp>("outbox", drop.opId);
          if (!op) continue;
          await tx.delete("outbox", drop.opId);
          await tx.put(
            "outcomes",
            outcomeOf(op, {
              opId: drop.opId,
              status: "dropped",
              settledAt: drop.settledAt,
              droppedReason: drop.reason,
            }),
          );
        }
        for (const rewrite of rewrites) {
          const old = await tx.get<OutboxOp>("outbox", rewrite.replaces);
          if (!old) throw new Error("prune: the op to rewrite is not in the outbox");
          await tx.delete("outbox", rewrite.replaces);
          await tx.put("outbox", { ...rewrite.op, seq: old.seq });
        }
      });
      changed();
    },

    async discard(opIds) {
      await backend.run(["outbox"], "readwrite", async (tx) => {
        for (const id of opIds) await tx.delete("outbox", id);
      });
      changed();
    },

    async markSeen(opIds) {
      await backend.run(["outcomes"], "readwrite", async (tx) => {
        for (const id of opIds) {
          const outcome = await tx.get<OutcomeRecord>("outcomes", id);
          if (outcome) await tx.put("outcomes", { ...outcome, seen: true });
        }
      });
      changed();
    },

    async pruneOutcomes(now, keepMs = OUTCOME_KEEP_MS) {
      const removed = await backend.run(["outcomes"], "readwrite", async (tx) => {
        let count = 0;
        for (const outcome of await tx.all<OutcomeRecord>("outcomes")) {
          if (outcome.seen || now - outcome.settledAt > keepMs) {
            await tx.delete("outcomes", outcome.opId);
            count += 1;
          }
        }
        return count;
      });
      if (removed > 0) changed();
      return removed;
    },

    acquireLease: (holder, now, ms) =>
      backend.run(["meta"], "readwrite", async (tx) => {
        const lease = await readMeta<{ holder: string; until: number }>(tx, "replayLease");
        if (lease && lease.until > now && lease.holder !== holder) return false;
        await tx.put("meta", { key: "replayLease", value: { holder, until: now + ms } });
        return true;
      }),

    releaseLease: (holder) =>
      backend.run(["meta"], "readwrite", async (tx) => {
        const lease = await readMeta<{ holder: string; until: number }>(tx, "replayLease");
        if (lease && lease.holder === holder) await tx.delete("meta", "replayLease");
      }),

    getLastUser: async () =>
      (await backend.run(["meta"], "readonly", (tx) => readMeta<LastUser>(tx, "lastUser"))) ?? null,

    setLastUser: (user) =>
      backend.run(["meta"], "readwrite", (tx) => tx.put("meta", { key: "lastUser", value: user })),

    clearLastUser: () => backend.run(["meta"], "readwrite", (tx) => tx.delete("meta", "lastUser")),

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    close() {
      listeners.clear();
      channel?.close();
      backend.close();
    },
  };
}
