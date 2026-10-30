import type { OutboxOp, QueuedBy } from "./types";

// Which queued ops may be sent now (M20 plan §3.1.7 step 4, §3.1.9 user binding). An op queued by someone else is HELD: it stays on
// the phone until that person signs in again, and it blocks the LATER ops of its own session (they would otherwise reach the
// kitchen before the order they follow). My ops behind a held op of the same session WAIT. Everything else is sendable.

export interface Held {
  user: QueuedBy;
  count: number;
}

export interface Chosen {
  sendable: OutboxOp[];
  waiting: OutboxOp[];
  held: Held[];
}

/**
 * `me` is the signed-in user's id (null when nobody is signed in: nothing is sent, nothing is called held).
 * `alsoHeld` are users the server refused (`user_mismatch`): their ops are held like another person's.
 */
export function sendable(
  ops: readonly OutboxOp[],
  me: string | null,
  alsoHeld: ReadonlySet<string> = new Set(),
): Chosen {
  const chosen: Chosen = { sendable: [], waiting: [], held: [] };
  if (me === null) {
    chosen.waiting.push(...ops);
    return chosen;
  }
  const blocked = new Set<string>();
  const counts = new Map<string, Held>();
  for (const op of ops) {
    if (op.userId !== me || alsoHeld.has(op.userId)) {
      blocked.add(op.scope.sessionId);
      const entry = counts.get(op.userId);
      if (entry) entry.count += 1;
      else counts.set(op.userId, { user: op.queuedBy, count: 1 });
    } else if (blocked.has(op.scope.sessionId)) {
      chosen.waiting.push(op);
    } else {
      chosen.sendable.push(op);
    }
  }
  chosen.held = [...counts.values()];
  return chosen;
}
