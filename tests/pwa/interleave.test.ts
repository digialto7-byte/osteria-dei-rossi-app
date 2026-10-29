import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createReplayer, type SendResult } from "@/lib/sync/replay";
import { openOutbox, type Outbox } from "@/pwa/outbox";
import { createQueue } from "@/pwa/queue";
import type { OpEnvelope } from "@/server/sync/schemas";
import { LINE_STEW } from "../helpers/orders-data";
import { DEMO, lineId, opId, resultFor, SYNC_IDS, syncOutputOf } from "../helpers/sync-data";

// "Rimuovi" on a queued add and the replay's send race on the same outbox (M20 review round 2). Real IndexedDB (fake-indexeddb): both
// sides go through readwrite transactions of the one store, so whichever commits first decides, and the other side sees it.
const NOW = new Date("2026-11-02T19:30:10.000Z");
const TABLE = "Tavolo 1 (demo)";
let dbCount = 0;
const boxes: Outbox[] = [];
afterEach(() => {
  for (const box of boxes.splice(0)) box.close();
});

async function setup() {
  const outbox = await openOutbox({ name: `osteria-interleave-${++dbCount}` });
  boxes.push(outbox);
  let n = 900;
  const queue = createQueue({
    outbox,
    me: async () => DEMO,
    now: () => NOW,
    newOpId: () => opId(n++),
  });
  const add = (k: number) =>
    queue.queueAdd({
      sessionId: SYNC_IDS.s1,
      tableName: TABLE,
      lineId: lineId(k),
      item: { id: SYNC_IDS.item, name: `Piatto ${k} (demo)` },
    });
  const l = await add(1);
  const m = await add(2);
  const [fire] = await queue.queueFire({
    sessionId: SYNC_IDS.s1,
    tableName: TABLE,
    lineIds: [lineId(1), lineId(2)],
  });
  const line = { ...LINE_STEW, id: lineId(1), clientUpdatedAt: "2026-11-02T19:30:00.000Z" };
  const requests: OpEnvelope[][] = [];
  const applyAll = (ops: OpEnvelope[]): SendResult => ({
    kind: "ok",
    output: syncOutputOf(ops.map((op) => resultFor(op, "applied"))),
  });
  const discardL = () => queue.discardQueuedAdd({ sessionId: SYNC_IDS.s1, tableName: TABLE, line });
  function replayer(
    store: Parameters<typeof createReplayer>[0]["store"],
    send: (ops: OpEnvelope[]) => SendResult | Promise<SendResult>,
  ) {
    let k = 700;
    return createReplayer({
      store,
      send: async (ops) => {
        requests.push(ops);
        return send(ops);
      },
      me: async () => DEMO,
      now: () => 1_000_000,
      random: () => 0.5,
      newOpId: () => opId(k++),
      holder: "tab",
    });
  }
  return { outbox, queue, l, m, fire: fire!, requests, applyAll, discardL, replayer };
}

describe("discard first, then the replay's markSent and send", () => {
  it("the stale batch is not sent: neither L nor the original fire goes out; the rewritten fire goes later", async () => {
    const s = await setup();
    let raced = false;
    // The replay has read [add L, add M, fire F]; the waiter taps Rimuovi before the replay's next step.
    const store = {
      ...s.outbox,
      pending: async () => {
        const read = await s.outbox.pending();
        if (!raced) {
          raced = true;
          expect(await s.discardL()).toBe("discarded");
        }
        return read;
      },
      markSent: s.outbox.markSent.bind(s.outbox),
    };
    const replayer = s.replayer(store, s.applyAll);
    await replayer.run();
    const sent = s.requests.flat();
    const ids = sent.map((op) => op.opId);
    expect(ids).not.toContain(s.l.opId);
    expect(ids).not.toContain(s.fire.opId);
    for (const op of sent) expect(JSON.stringify(op.payload)).not.toContain(lineId(1));
    // M's add and the rewritten fire (same seq, a new op id, naming only M) are sent in a later round.
    expect(sent.map((op) => op.kind)).toEqual(["add_line", "fire"]);
    expect(sent[1]!.payload).toMatchObject({ lineIds: [lineId(2)] });
    expect(sent[1]!.seq).toBe(s.fire.seq);
  });
});

describe("the replay's markSent first, then discard", () => {
  it("the discard takes the remove_line path and deletes nothing", async () => {
    const s = await setup();
    let result: string | undefined;
    const replayer = s.replayer(s.outbox, async (ops) => {
      // The request is out: the waiter taps Rimuovi on L now (once; later rounds are the removal itself).
      if (result === undefined) result = await s.discardL();
      return s.applyAll(ops);
    });
    await replayer.run();
    expect(result).toBe("removal_queued");
    // L's add and the original fire went out and settled; the removal is queued after them and goes in a later round.
    expect(s.requests[0]!.map((op) => op.opId)).toEqual([s.l.opId, s.m.opId, s.fire.opId]);
    expect(s.requests[1]!.map((op) => op.kind)).toEqual(["remove_line"]);
    expect(s.requests[1]![0]!.payload).toMatchObject({ lineId: lineId(1) });
  });
});

describe("markSent commits before the discard's write (hooked at the queue)", () => {
  it("nothing is deleted and the removal is queued instead", async () => {
    const s = await setup();
    let stamped = false;
    const stamp = async () => {
      if (stamped) return;
      stamped = true;
      await s.outbox.markSent([s.l.opId, s.m.opId, s.fire.opId], 5_000);
    };
    // Whatever the discard asks the outbox first, the replay's markSent commits before the discard's write.
    const raced = {
      ...s.outbox,
      pending: async () => {
        const read = await s.outbox.pending();
        await stamp();
        return read;
      },
      discardIfUnsent: async (...args: unknown[]) => {
        await stamp();
        return (s.outbox as unknown as Record<string, (...a: unknown[]) => unknown>)
          .discardIfUnsent!(...args);
      },
    } as unknown as Outbox;
    let n = 800;
    const queue = createQueue({
      outbox: raced,
      me: async () => DEMO,
      now: () => NOW,
      newOpId: () => opId(n++),
    });
    const line = { ...LINE_STEW, id: lineId(1), clientUpdatedAt: "2026-11-02T19:30:00.000Z" };
    const before = (await s.outbox.pending()).map((op) => op.opId);
    expect(await queue.discardQueuedAdd({ sessionId: SYNC_IDS.s1, tableName: TABLE, line })).toBe(
      "removal_queued",
    );
    const after = await s.outbox.pending();
    expect(after.slice(0, before.length).map((op) => op.opId)).toEqual(before);
    expect(after.at(-1)).toMatchObject({ kind: "remove_line" });
  });
});

describe("discardIfUnsent and markSent started together, without awaiting either", () => {
  const plan = (s: Awaited<ReturnType<typeof setup>>) => (rest: { opId: string }[]) => ({
    rewrites: [],
    discards: rest.filter((op) => op.opId === s.fire.opId).map((op) => op.opId),
  });
  const ids = (s: Awaited<ReturnType<typeof setup>>) => [s.l.opId, s.m.opId, s.fire.opId];

  it("discard commits first: L and the fire are gone and markSent finds nothing to send", async () => {
    const s = await setup();
    const discard = s.outbox.discardIfUnsent(lineId(1), plan(s));
    const sent = s.outbox.markSent(ids(s), 5_000);
    expect(await discard).toBe("discarded");
    expect(await sent).toEqual([]);
    expect((await s.outbox.pending()).map((op) => op.opId)).toEqual([s.m.opId]);
  });

  it("markSent commits first: the discard sees the stamp, answers sent and deletes nothing", async () => {
    const s = await setup();
    const sent = s.outbox.markSent(ids(s), 5_000);
    const discard = s.outbox.discardIfUnsent(lineId(1), plan(s));
    expect((await sent).map((op) => op.opId)).toEqual(ids(s));
    expect(await discard).toBe("sent");
    expect((await s.outbox.pending()).map((op) => op.opId)).toEqual(ids(s));
  });
});

describe("a dead-entity prune that meets a discard of another line (review round 3)", () => {
  it("plans inside its own transaction: no throw, and the fire the waiter rewrote is the one pruned", async () => {
    const s = await setup();
    // Twenty ops on L fill the first batch; M's add and the fire [L, M] have not left the phone.
    await s.outbox.discard([s.m.opId, s.fire.opId]);
    const lineL = { ...LINE_STEW, id: lineId(1), clientUpdatedAt: "2026-11-02T19:30:00.000Z" };
    for (let k = 0; k < 19; k += 1) {
      await s.queue.queueEdit({
        sessionId: SYNC_IDS.s1,
        tableName: TABLE,
        line: { ...lineL, qty: 20 + k },
        changes: { qty: 40 + k },
      });
    }
    await s.queue.queueAdd({
      sessionId: SYNC_IDS.s1,
      tableName: TABLE,
      lineId: lineId(2),
      item: { id: SYNC_IDS.item, name: "Piatto 2 (demo)" },
    });
    const [fire] = await s.queue.queueFire({
      sessionId: SYNC_IDS.s1,
      tableName: TABLE,
      lineIds: [lineId(1), lineId(2)],
    });
    let pendingReads = 0;
    // Round 1 sends L and its 19 edits; the server refuses L (dead entity). Before the prune reads the outbox the waiter throws M
    // away: the fire is rewritten to name only L. The prune must plan from THAT fire, not from the one it read before.
    const store = {
      ...s.outbox,
      pending: async () => {
        const read = await s.outbox.pending();
        pendingReads += 1;
        if (pendingReads === 2) {
          const lineM = { ...lineL, id: lineId(2) };
          expect(
            await s.queue.discardQueuedAdd({
              sessionId: SYNC_IDS.s1,
              tableName: TABLE,
              line: lineM,
            }),
          ).toBe("discarded");
        }
        return read;
      },
      markSent: s.outbox.markSent.bind(s.outbox),
      pruneDead: (s.outbox as unknown as Record<string, (...a: unknown[]) => unknown>).pruneDead,
    } as unknown as Outbox;
    const replayer = s.replayer(store, (ops) => ({
      kind: "ok",
      output: syncOutputOf([resultFor(ops[0]!, "rejected")], {
        opId: ops[0]!.opId,
        reason: "dead_entity",
      }),
    }));
    await expect(replayer.run()).resolves.toBeDefined();
    const left = await s.outbox.pending();
    expect(left.map((op) => op.opId)).not.toContain(fire!.opId);
    expect(left.map((op) => op.kind)).not.toContain("fire"); // [L] after the discard: nothing remains to fire
  });
});

describe("markSent", () => {
  it("returns the ops it found, in order, as the longest prefix of the ids still in the outbox", async () => {
    const s = await setup();
    await s.outbox.discard([s.m.opId]);
    const first = await s.outbox.markSent([s.l.opId, s.m.opId, s.fire.opId], 5_000);
    expect(first.map((op) => op.opId)).toEqual([s.l.opId]);
    const pending = await s.outbox.pending();
    expect(pending.find((op) => op.opId === s.fire.opId)!.sentAt ?? null).toBeNull();
    expect(await s.outbox.markSent([s.m.opId, s.fire.opId], 6_000)).toEqual([]);
  });

  it("tells the subscribers only when it stamped something", async () => {
    const s = await setup();
    const heard = vi.fn();
    s.outbox.subscribe(heard);
    await s.outbox.markSent([], 5_000);
    await s.outbox.markSent([opId(12345)], 5_000);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(heard).not.toHaveBeenCalled();
    await s.outbox.markSent([s.l.opId], 5_000);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(heard).toHaveBeenCalledTimes(1);
    heard.mockClear();
    await s.outbox.markSent([s.l.opId], 6_000); // already stamped
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(heard).not.toHaveBeenCalled();
  });
});
