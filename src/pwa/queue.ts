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
  /** "Rimuovi": a line whose add is still queued is discarded (see below); one the server has gets a queued removal. */
  removeLine(input: {
    sessionId: string;
    tableName: string;
    line: OrderLine;
  }): Promise<"discarded" | "removal_queued">;
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

    async removeLine({ sessionId, tableName, line }) {
      const result = await this.discardQueuedAdd({ sessionId, tableName, line });
      if (result !== "not_queued") return result;
      await put(removeLineDraft({ me: await who(), line, tableName, sessionId, now: deps.now() }));
      return "removal_queued";
    },

    async discardQueuedAdd({ sessionId, tableName, line }) {
      // The decision and the write are ONE transaction in the outbox: an op the replay put in a request meanwhile is never deleted.
      const result = await deps.outbox.discardIfUnsent(line.id, (rest) => {
        const plan = planPrune(rest, { lineId: line.id }, deps.newOpId, deps.now().getTime());
        return { rewrites: plan.rewrites, discards: plan.drops.map((drop) => drop.opId) };
      });
      if (result === "not_queued") return "not_queued";
      if (result === "discarded") return "discarded"; // never sent: no notice
      // Sent (or tried): the add may be on the server. It replays (idempotent), then the removal voids it with entry_removed.
      await put(removeLineDraft({ me: await who(), line, tableName, sessionId, now: deps.now() }));
      return "removal_queued";
    },
  };
}
