import type { Outbox } from "@/pwa/outbox";
import { SYNC_LEASE_MS, SYNC_STUCK_ATTEMPTS } from "@/server/sync/constants";
import type { OpResult, SyncOutput } from "@/server/sync/output";
import type { OpEnvelope } from "@/server/sync/schemas";
import { backoffDelay } from "./backoff";
import { takeBatch, toWire } from "./batch";
import { planPrune, type DeadEntity } from "./prune";
import { sendable, type Held } from "./sendable";
import type { OutboxOp, Settlement } from "./types";

// The replay engine (M20 plan §3.1.7, ADR-005, ADR-022). Pure: the outbox, the network, the clock and the randomness are injected.
// One run takes the sendable ops in `seq` order, up to 20 at a time, and sends each batch only after the previous reply:
//   network error, 5xx, 503, 429  nothing is settled; the first op's `attempts` goes up; the next try waits (1, 2, 4, 8, 15 s);
//   401 / 403                     the ops stay; the state says why;
//   200                           every result moves its op to the outcomes in one transaction, then
//     dead_entity   -> prune the ops that name the dead session or line, and carry on
//     user_mismatch -> hold that user's ops (they cannot go under this session)
//     unavailable   -> back off
// Triggers (online, focus, a new op, a timer) live in src/pwa/sync-runner.ts; this module only answers `run`.

export type SendResult =
  | { kind: "ok"; output: SyncOutput }
  | { kind: "network" }
  | { kind: "server"; status: number }
  | { kind: "unauthorized" }
  | { kind: "forbidden" };

export type ReplayStateName =
  "idle" | "sending" | "offline" | "backoff" | "signedOut" | "forbidden";

export interface ReplayDeps {
  store: Pick<
    Outbox,
    "pending" | "markAttempt" | "markSent" | "settle" | "prune" | "acquireLease" | "releaseLease"
  >;
  send: (ops: OpEnvelope[]) => Promise<SendResult>;
  /** The signed-in user (offline: the last one the phone saw), or null. */
  me: () => Promise<{ id: string } | null>;
  now: () => number;
  random: () => number;
  newOpId: () => string;
  /** This engine's name in the lease. */
  holder: string;
}

export interface ReplayState {
  state: ReplayStateName;
  failures: number;
  nextAttemptAt: number | null;
  /** The same first op stayed unsettled after ten server replies: the person is told, the op is never dropped. */
  stuck: boolean;
  /** The phone's clock minus the server's, from the last 200 (positive: the phone is ahead). */
  skewMs: number | null;
  held: Held[];
}

export interface RunReport {
  /** Another engine (or this one) is already running. */
  busy: boolean;
  /** The backoff delay had not passed, so nothing was sent. */
  waited: boolean;
  state: ReplayStateName;
  /** How long until the next try, or null when none is scheduled. */
  nextDelayMs: number | null;
}

export interface Replayer {
  run(options?: { bypassBackoff?: boolean }): Promise<RunReport>;
  getState(): ReplayState;
  /** Forget the users the server refused (call when the signed-in user changes). */
  resetUserHolds(): void;
  subscribe(listener: () => void): () => void;
}

function settlementOf(result: OpResult, now: number): Settlement {
  const base = { opId: result.opId, settledAt: now };
  switch (result.status) {
    case "applied":
      return { ...base, status: "applied", receivedAt: result.receivedAt };
    case "conflict":
      return {
        ...base,
        status: "conflict",
        receivedAt: result.receivedAt,
        conflict: result.conflict,
      };
    case "rejected":
      return {
        ...base,
        status: "rejected",
        error: result.error,
        ...(result.receivedAt !== null ? { receivedAt: result.receivedAt } : {}),
      };
    case "duplicate": {
      // The first reply was lost; the stored one says what happened, and the person still has to be told.
      const stored = result.stored;
      return {
        ...base,
        status: "duplicate",
        receivedAt: stored.receivedAt ?? undefined,
        ...(stored.status === "conflict" ? { conflict: stored.conflict } : {}),
        ...(stored.status === "rejected" ? { error: stored.error } : {}),
      };
    }
  }
}

function deadEntityOf(op: OutboxOp | undefined): DeadEntity | null {
  if (!op) return null;
  if (op.kind === "open_table") return { sessionId: op.scope.sessionId };
  if (op.kind === "add_line" && op.scope.lineId) return { lineId: op.scope.lineId };
  return null;
}

export function createReplayer(deps: ReplayDeps): Replayer {
  let state: ReplayStateName = "idle";
  let failures = 0;
  let nextAttemptAt: number | null = null;
  let stuck = false;
  let skewMs: number | null = null;
  let held: Held[] = [];
  let running = false;
  let stuckOp: string | null = null;
  let stuckCount = 0;
  const mismatched = new Set<string>();
  const listeners = new Set<() => void>();

  const emit = () => {
    for (const listener of [...listeners]) listener();
  };
  const set = (next: ReplayStateName) => {
    state = next;
    emit();
  };
  const report = (extra: Partial<RunReport> = {}): RunReport => ({
    busy: false,
    waited: false,
    state,
    nextDelayMs: nextAttemptAt === null ? null : Math.max(0, nextAttemptAt - deps.now()),
    ...extra,
  });
  /** One more failed attempt: the next try waits longer. */
  const backOff = (name: "offline" | "backoff") => {
    failures += 1;
    nextAttemptAt = deps.now() + backoffDelay(failures, deps.random);
    set(name);
  };
  const noteFirst = (firstId: string, settled: boolean) => {
    if (settled) {
      stuckOp = null;
      stuckCount = 0;
    } else if (stuckOp === firstId) {
      stuckCount += 1;
    } else {
      stuckOp = firstId;
      stuckCount = 1;
    }
    stuck = stuckCount >= SYNC_STUCK_ATTEMPTS;
  };

  async function loop(): Promise<void> {
    for (;;) {
      const pending = await deps.store.pending();
      const me = await deps.me();
      const chosen = sendable(pending, me?.id ?? null, mismatched);
      held = chosen.held;
      if (chosen.sendable.length === 0) {
        set("idle");
        return;
      }
      const batch = takeBatch(chosen.sendable);
      const first = batch[0]!;
      // Renew the lease; if another tab holds it now, this engine stops before it sends anything.
      if (!(await deps.store.acquireLease(deps.holder, deps.now(), SYNC_LEASE_MS))) {
        set("idle");
        return;
      }
      // From here the server may get every op of the batch, whatever comes back. Mark them in ONE transaction that re-reads the outbox:
      // an op the waiter deleted or rewrote since `pending()` is not in the answer and is not sent. If the batch no longer starts
      // with its first op, read the outbox again.
      const live = await deps.store.markSent(
        batch.map((op) => op.opId),
        deps.now(),
      );
      if (live.length === 0 || live[0]!.opId !== first.opId) continue;
      batch.splice(0, batch.length, ...live);
      set("sending");
      const reply = await deps.send(batch.map(toWire));

      if (reply.kind === "network" || reply.kind === "server") {
        await deps.store.markAttempt(first.opId, deps.now());
        // An outage (5xx, 429, a dropped line) is not a stuck op; a refusal of the request itself (400, 413...) is.
        if (
          reply.kind === "server" &&
          reply.status >= 400 &&
          reply.status < 500 &&
          reply.status !== 429
        ) {
          noteFirst(first.opId, false);
        }
        backOff(reply.kind === "network" ? "offline" : "backoff");
        return;
      }
      if (reply.kind === "unauthorized") return set("signedOut");
      if (reply.kind === "forbidden") return set("forbidden");

      const { output } = reply;
      const now = deps.now();
      const serverNow = Date.parse(output.serverTime);
      if (Number.isFinite(serverNow)) skewMs = now - serverNow;
      const inBatch = new Map(batch.map((op) => [op.opId, op]));
      const settlements = output.results
        .filter((result) => inBatch.has(result.opId))
        .map((result) => settlementOf(result, now));
      await deps.store.settle(settlements);
      const progress = settlements.length > 0;
      if (progress) {
        failures = 0;
        nextAttemptAt = null;
      }
      const stop = output.stopped;

      if (!stop) {
        noteFirst(
          first.opId,
          settlements.some((s) => s.opId === first.opId),
        );
        if (!progress) {
          // A 200 that settled nothing and stopped nowhere: do not loop on it.
          await deps.store.markAttempt(first.opId, now);
          backOff("backoff");
          return;
        }
        continue;
      }

      if (stop.reason === "dead_entity") {
        noteFirst(
          first.opId,
          settlements.some((s) => s.opId === first.opId),
        );
        const dead = deadEntityOf(inBatch.get(stop.opId));
        if (!dead || !settlements.some((s) => s.opId === stop.opId)) {
          await deps.store.markAttempt(first.opId, now);
          backOff("backoff");
          return;
        }
        const plan = planPrune(await deps.store.pending(), dead, deps.newOpId, deps.now());
        if (plan.rewrites.length > 0 || plan.drops.length > 0) await deps.store.prune(plan);
        continue;
      }

      if (stop.reason === "user_mismatch") {
        const refused = inBatch.get(stop.opId) ?? first;
        mismatched.add(refused.userId);
        continue;
      }

      // unavailable: the server could not try the op; it stays, and so does everything after it.
      noteFirst(
        first.opId,
        settlements.some((s) => s.opId === first.opId),
      );
      await deps.store.markAttempt((inBatch.get(stop.opId) ?? first).opId, now);
      backOff("backoff");
      return;
    }
  }

  return {
    async run(options = {}) {
      if (running) return report({ busy: true });
      const now = deps.now();
      if (!options.bypassBackoff && nextAttemptAt !== null && now < nextAttemptAt) {
        return report({ waited: true });
      }
      running = true;
      try {
        if (!(await deps.store.acquireLease(deps.holder, now, SYNC_LEASE_MS))) {
          return report({ busy: true });
        }
        try {
          await loop();
        } finally {
          await deps.store.releaseLease(deps.holder);
        }
        return report();
      } finally {
        running = false;
        emit();
      }
    },

    getState: () => ({ state, failures, nextAttemptAt, stuck, skewMs, held }),

    resetUserHolds() {
      mismatched.clear();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
