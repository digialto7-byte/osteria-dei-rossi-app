import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
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

describe("markSent lands between the discard's decision and its write", () => {
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
});
