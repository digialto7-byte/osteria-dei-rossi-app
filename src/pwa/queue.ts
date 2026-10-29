import { planPrune } from "@/lib/sync/prune";
import {
  addLineDraft,
  editLineDraft,
  fireDrafts,
  openTableDraft,
  removeLineDraft,
  voidLineDraft,
} from "@/lib/sync/ops";
import type { OpDraft, OutboxOp, QueuedBy } from "@/lib/sync/types";
import type { OrderLine } from "@/server/orders/output";
import type { Outbox } from "./outbox";

// The one door every order write goes through (M20 plan §3.1.1, §3.6.2): each queue* builds its op with the pure builders in
// src/lib/sync/ops.ts, then puts it in the outbox and wakes the runner. The screens never call the online endpoints.

type Args<T extends (input: never) => unknown> = Omit<Parameters<T>[0], "me" | "now">;

export interface QueueDeps {
  outbox: Outbox;
  /** Who is signed in (online: /api/me; offline: the last user the phone saw). */
  me: () => Promise<QueuedBy | null>;
  now: () => Date;
  newOpId: () => string;
  /** Wakes the replay runner. */
  onQueued?: () => void;
}

export interface Queue {
  queueOpenTable(input: Args<typeof openTableDraft>): Promise<OutboxOp>;
  queueAdd(input: Args<typeof addLineDraft>): Promise<OutboxOp>;
  /** Null when nothing differs from what the phone shows. */
  queueEdit(input: Args<typeof editLineDraft>): Promise<OutboxOp | null>;
  queueRemove(input: Args<typeof removeLineDraft>): Promise<OutboxOp>;
  queueFire(input: Args<typeof fireDrafts>): Promise<OutboxOp[]>;
  queueVoid(input: Args<typeof voidLineDraft>): Promise<OutboxOp>;
  discardQueuedAdd(input: {
    sessionId: string;
    tableName: string;
    line: OrderLine;
  }): Promise<"discarded" | "removal_queued" | "not_queued">;
}

export function createQueue(deps: QueueDeps): Queue {
  async function who(): Promise<QueuedBy> {
    const me = await deps.me();
    if (!me) throw new Error("Not signed in: an operation cannot be queued");
    return me;
  }
  async function put(draft: OpDraft): Promise<OutboxOp> {
    const op = await deps.outbox.enqueue(draft);
    deps.onQueued?.();
    return op;
  }

  return {
    async queueOpenTable(input) {
      return put(openTableDraft({ ...input, me: await who(), now: deps.now() }));
    },
    async queueAdd(input) {
      return put(addLineDraft({ ...input, me: await who(), now: deps.now() }));
    },
    async queueEdit(input) {
      const draft = editLineDraft({ ...input, me: await who(), now: deps.now() });
      return draft ? put(draft) : null;
    },
    async queueRemove(input) {
      return put(removeLineDraft({ ...input, me: await who(), now: deps.now() }));
    },
    async queueFire(input) {
      const drafts = fireDrafts({ ...input, me: await who(), now: deps.now() });
      const ops: OutboxOp[] = [];
      for (const draft of drafts) ops.push(await put(draft));
      return ops;
    },
    async queueVoid(input) {
      return put(voidLineDraft({ ...input, me: await who(), now: deps.now() }));
    },

    async discardQueuedAdd({ sessionId, tableName, line }) {
      const pending = await deps.outbox.pending();
      const add = pending.find((op) => op.kind === "add_line" && op.scope.lineId === line.id);
      if (!add) return "not_queued";
      if (add.attempts === 0) {
        // Never sent: the add leaves the outbox with every queued op on that line, and a fire that named it loses the id. No notice.
        const rest = pending.filter((op) => op.opId !== add.opId);
        const plan = planPrune(rest, { lineId: line.id }, deps.newOpId, deps.now().getTime());
        await deps.outbox.prune({
          rewrites: plan.rewrites,
          drops: [],
          discards: [add.opId, ...plan.drops.map((drop) => drop.opId)],
        });
        return "discarded";
      }
      // Already tried: the add may have reached the server. It replays (idempotent), then the removal voids it with entry_removed.
      await put(removeLineDraft({ me: await who(), line, tableName, sessionId, now: deps.now() }));
      return "removal_queued";
    },
  };
}
