import type { PruneDrop, PruneRewrite } from "@/pwa/outbox";
import type { OutboxOp } from "./types";

// Pruning after a dead entity (M20 plan §3.1.8). The server stopped at an `open_table` or `add_line` that did not apply, so the session
// or line it should have created does not exist. Every queued op that names it is checked before the rest is sent, so a fire of
// [deadLine, okLine] is not refused whole by the server (`line_not_found`) and the good dish still reaches the kitchen.

export interface DeadEntity {
  /** An open_table that did not apply. */
  sessionId?: string;
  /** An add_line that did not apply. */
  lineId?: string;
}

export interface PrunePlan {
  rewrites: PruneRewrite[];
  drops: PruneDrop[];
}

const LINE_KINDS = new Set(["edit_line", "remove_line", "void_line"]);

/**
 * What to change in the outbox. A dead session drops every op on it, of any user. A dead line drops its edit, remove and void; a
 * fire loses the id and, if ids remain, is rewritten under a NEW op id with the same seq (the old op id was never processed:
 * the server stopped before it). `dropped` exists only on the phone; the server never sees those ops.
 */
export function planPrune(
  pending: readonly OutboxOp[],
  dead: DeadEntity,
  newOpId: () => string,
  now: number,
): PrunePlan {
  const plan: PrunePlan = { rewrites: [], drops: [] };
  for (const op of pending) {
    if (dead.sessionId !== undefined && op.scope.sessionId === dead.sessionId) {
      plan.drops.push({ opId: op.opId, reason: "session_not_created", settledAt: now });
      continue;
    }
    if (dead.lineId === undefined) continue;
    if (LINE_KINDS.has(op.kind) && op.scope.lineId === dead.lineId) {
      plan.drops.push({ opId: op.opId, reason: "line_not_created", settledAt: now });
    } else if (op.kind === "fire") {
      const ids = op.payload.lineIds;
      if (!Array.isArray(ids) || !ids.includes(dead.lineId)) continue;
      const remaining = ids.filter((id) => id !== dead.lineId);
      if (remaining.length === 0) {
        plan.drops.push({ opId: op.opId, reason: "line_not_created", settledAt: now });
      } else {
        plan.rewrites.push({
          replaces: op.opId,
          op: {
            ...op,
            opId: newOpId(),
            payload: { ...op.payload, lineIds: remaining },
            attempts: 0,
            lastAttemptAt: null,
          },
        });
      }
    }
  }
  return plan;
}
