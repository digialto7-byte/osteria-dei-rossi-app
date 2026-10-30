import type { ReplayState, ReplayStateName } from "./replay";
import { sendable, type Held } from "./sendable";
import type { OutboxOp, OutcomeRecord } from "./types";

// What the screens read about the offline queue (M20 plan §3.6.2): one plain snapshot of the outbox and the engine. Components take it
// and render; they compute nothing.

export interface SyncView {
  /** False until the outbox has been read once (and on the server). */
  ready: boolean;
  /** Every waiting op on this phone, in seq order (the overlay reads them). */
  ops: OutboxOp[];
  outcomes: OutcomeRecord[];
  /** All waiting ops, and those of the signed-in user. */
  pending: number;
  mine: number;
  /** People whose ops wait for them to sign in again. */
  held: Held[];
  state: ReplayStateName;
  nextAttemptAt: number | null;
  /** IndexedDB was not available: closing the page loses the queue. */
  memoryOnly: boolean;
  stuck: boolean;
  skewMs: number | null;
  /** Unseen conflicts, refusals and dropped ops. */
  unseen: number;
  /** The badge shows when something is waiting, held or unseen. */
  visible: boolean;
}

export const EMPTY_VIEW: SyncView = {
  ready: false,
  ops: [],
  outcomes: [],
  pending: 0,
  mine: 0,
  held: [],
  state: "idle",
  nextAttemptAt: null,
  memoryOnly: false,
  stuck: false,
  skewMs: null,
  unseen: 0,
  visible: false,
};

const NOTICE_STATUSES = new Set(["conflict", "rejected", "dropped"]);

/**
 * Who has ops waiting for them, computed from the outbox for the person signed in now (another person's ops, plus the ops of anyone the
 * server refused with user_mismatch). The engine's own `held` list is not used: it is from its last run, for whoever was signed in then,
 * and the engine does not run while another page holds the lease or while it backs off. Only the refused user ids come from the engine.
 */
function heldFor(
  ops: readonly OutboxOp[],
  me: string | null,
  mismatched: readonly string[],
): Held[] {
  return sendable(ops, me, new Set(mismatched)).held;
}

export function deriveView(input: {
  ops: OutboxOp[];
  outcomes: OutcomeRecord[];
  replay: ReplayState;
  memoryOnly: boolean;
  me: string | null;
}): SyncView {
  const unseen = input.outcomes.filter(
    (o) =>
      !o.seen &&
      (NOTICE_STATUSES.has(o.status) || (o.status === "duplicate" && (o.conflict || o.error))),
  ).length;
  const held = heldFor(input.ops, input.me, input.replay.mismatched);
  return {
    ready: true,
    ops: input.ops,
    outcomes: input.outcomes,
    pending: input.ops.length,
    mine: input.me === null ? 0 : input.ops.filter((op) => op.userId === input.me).length,
    held,
    state: input.replay.state,
    nextAttemptAt: input.replay.nextAttemptAt,
    memoryOnly: input.memoryOnly,
    stuck: input.replay.stuck,
    skewMs: input.replay.skewMs,
    unseen,
    visible: input.ops.length > 0 || held.length > 0 || unseen > 0,
  };
}
