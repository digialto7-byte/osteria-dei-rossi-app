import { afterEach, describe, expect, it, vi } from "vitest";
import { clientStamp } from "@/lib/orders/line-form";
import { createQueue } from "@/pwa/queue";
import { openOutbox, type Outbox } from "@/pwa/outbox";
import { LINE_STEW } from "../helpers/orders-data";
import { DEMO, lineId, opId, SYNC_IDS } from "../helpers/sync-data";

// The only door writes go through (M20 plan §3.6.2, step 17): each queue* builds its op with the pure builders and enqueues it.
const NOW = new Date("2026-11-02T19:30:10.000Z");
const TABLE = "Tavolo 1 (demo)";
const boxes: Outbox[] = [];
afterEach(() => {
  for (const box of boxes.splice(0)) box.close();
});

async function setup(me: typeof DEMO | null = DEMO) {
  const outbox = await openOutbox({ idb: null });
  boxes.push(outbox);
  let n = 900;
  const onQueued = vi.fn();
  const queue = createQueue({
    outbox,
    me: async () => me,
    now: () => NOW,
    newOpId: () => opId(n++),
    onQueued,
  });
  return { outbox, queue, onQueued };
}
const line = (n: number, extra: object = {}) => ({
  ...LINE_STEW,
  id: lineId(n),
  clientUpdatedAt: "2026-11-02T19:30:00.000Z",
  ...extra,
});

describe("queueAdd", () => {
  it("enqueues add_line with clientTs = clientStamp(now) and the dish as label, and wakes the runner", async () => {
    const { outbox, queue, onQueued } = await setup();
    const op = await queue.queueAdd({
      sessionId: SYNC_IDS.s1,
      tableName: TABLE,
      lineId: lineId(5),
      item: { id: SYNC_IDS.item, name: "Spezzatino con polenta (demo)", unitPrice: 14 },
      course: "secondi",
    });
    expect(op).toMatchObject({
      kind: "add_line",
      seq: 1,
      clientTs: clientStamp(NOW),
      userId: DEMO.id,
      attempts: 0,
      scope: { sessionId: SYNC_IDS.s1, lineId: lineId(5) },
      label: { tableName: TABLE, dishName: "Spezzatino con polenta (demo)", unitPrice: 14 },
      queuedBy: DEMO,
    });
    expect(await outbox.pending()).toEqual([op]);
    expect(onQueued).toHaveBeenCalledTimes(1);
  });

  it("refuses when nobody is signed in, and queues nothing", async () => {
    const { outbox, queue, onQueued } = await setup(null);
    await expect(
      queue.queueAdd({
        sessionId: SYNC_IDS.s1,
        tableName: TABLE,
        lineId: lineId(5),
        item: { id: SYNC_IDS.item, name: "x" },
      }),
    ).rejects.toThrow(/signed in/);
    expect(await outbox.pending()).toEqual([]);
    expect(onQueued).not.toHaveBeenCalled();
  });
});

describe("queueEdit, queueRemove, queueVoid", () => {
  it("an edit is stamped against the line as shown: bumped past a queued earlier edit", async () => {
    const { queue } = await setup();
    const shown = line(1, { clientUpdatedAt: NOW.toISOString() }); // an earlier queued edit carries this stamp
    const op = await queue.queueEdit({
      sessionId: SYNC_IDS.s1,
      tableName: TABLE,
      line: shown,
      changes: { qty: 5 },
    });
    expect(Date.parse(op!.clientTs)).toBe(NOW.getTime() + 1);
    expect(op).toMatchObject({ kind: "edit_line", payload: { lineId: lineId(1), qty: 5 } });
  });

  it("an edit that changes nothing queues nothing and does not wake the runner", async () => {
    const { outbox, queue, onQueued } = await setup();
    expect(
      await queue.queueEdit({
        sessionId: SYNC_IDS.s1,
        tableName: TABLE,
        line: line(1),
        changes: { qty: LINE_STEW.qty },
      }),
    ).toBeNull();
    expect(await outbox.pending()).toEqual([]);
    expect(onQueued).not.toHaveBeenCalled();
  });

  it("remove and void queue their kinds with the dish", async () => {
    const { queue } = await setup();
    const removed = await queue.queueRemove({
      sessionId: SYNC_IDS.s1,
      tableName: TABLE,
      line: line(1),
    });
    const voided = await queue.queueVoid({
      sessionId: SYNC_IDS.s1,
      tableName: TABLE,
      line: line(2),
      reason: "kitchen_error",
    });
    expect(removed).toMatchObject({
      kind: "remove_line",
      payload: { lineId: lineId(1) },
      label: { dishName: LINE_STEW.name },
    });
    expect(voided).toMatchObject({
      kind: "void_line",
      payload: { lineId: lineId(2), reason: "kitchen_error" },
    });
    expect([removed.seq, voided.seq]).toEqual([1, 2]);
  });
});

describe("queueOpenTable and queueFire", () => {
  it("opening a table queues open_table with the table name", async () => {
    const { queue } = await setup();
    const op = await queue.queueOpenTable({
      tableId: SYNC_IDS.table1,
      tableName: TABLE,
      sessionId: SYNC_IDS.s1,
      covers: 2,
    });
    expect(op).toMatchObject({
      kind: "open_table",
      scope: { sessionId: SYNC_IDS.s1 },
      label: { tableName: TABLE },
    });
  });

  it("a fire of 120 lines is three ops of at most 50, in order", async () => {
    const { queue, outbox, onQueued } = await setup();
    const ids = Array.from({ length: 120 }, (_v, i) => lineId(i + 1));
    const ops = await queue.queueFire({ sessionId: SYNC_IDS.s1, tableName: TABLE, lineIds: ids });
    expect(ops.map((op) => (op.payload.lineIds as string[]).length)).toEqual([50, 50, 20]);
    expect((await outbox.pending()).map((op) => op.seq)).toEqual([1, 2, 3]);
    expect(onQueued).toHaveBeenCalled();
  });

  it("a fire of nothing queues nothing", async () => {
    const { queue, outbox, onQueued } = await setup();
    expect(
      await queue.queueFire({ sessionId: SYNC_IDS.s1, tableName: TABLE, lineIds: [] }),
    ).toEqual([]);
    expect(await outbox.pending()).toEqual([]);
    expect(onQueued).not.toHaveBeenCalled();
  });
});

describe("discardQueuedAdd (ADR-017 'Scarta', outbox form)", () => {
  async function queued() {
    const s = await setup();
    const add = (n: number) =>
      s.queue.queueAdd({
        sessionId: SYNC_IDS.s1,
        tableName: TABLE,
        lineId: lineId(n),
        item: { id: SYNC_IDS.item, name: `Piatto ${n} (demo)` },
      });
    const l1 = await add(1);
    await s.queue.queueEdit({
      sessionId: SYNC_IDS.s1,
      tableName: TABLE,
      line: line(1),
      changes: { qty: 4 },
    });
    const l2 = await add(2);
    await s.queue.queueFire({
      sessionId: SYNC_IDS.s1,
      tableName: TABLE,
      lineIds: [lineId(1), lineId(2)],
    });
    await s.queue.queueFire({ sessionId: SYNC_IDS.s1, tableName: TABLE, lineIds: [lineId(1)] });
    return { ...s, l1, l2 };
  }

  it("never sent (attempts 0): the add, its edit and a fire that names only it are deleted; a fire of two loses the id", async () => {
    const { queue, outbox, l2 } = await queued();
    expect(
      await queue.discardQueuedAdd({ sessionId: SYNC_IDS.s1, tableName: TABLE, line: line(1) }),
    ).toBe("discarded");
    const pending = await outbox.pending();
    expect(pending.map((op) => [op.kind, op.seq])).toEqual([
      ["add_line", 3],
      ["fire", 4],
    ]);
    expect(pending[0]!.opId).toBe(l2.opId);
    expect(pending[1]!.payload).toEqual({ sessionId: SYNC_IDS.s1, lineIds: [lineId(2)] });
    expect(pending[1]!.opId).toBe(opId(900)); // rewritten under a new op id, same seq
    expect(await outbox.outcomes()).toEqual([]); // the person's own choice leaves no notice
  });

  it("already attempted: the add stays and a removal is queued after it (the add replays, then voids with entry_removed)", async () => {
    const { queue, outbox, l1 } = await queued();
    await outbox.markAttempt(l1.opId, 5_000);
    expect(
      await queue.discardQueuedAdd({ sessionId: SYNC_IDS.s1, tableName: TABLE, line: line(1) }),
    ).toBe("removal_queued");
    const pending = await outbox.pending();
    expect(pending.map((op) => op.kind)).toEqual([
      "add_line",
      "edit_line",
      "add_line",
      "fire",
      "fire",
      "remove_line",
    ]);
    expect(pending.at(-1)).toMatchObject({ payload: { lineId: lineId(1) }, seq: 6 });
  });

  it("a line with no queued add (it is already on the server) is left alone", async () => {
    const { queue, outbox } = await queued();
    const before = await outbox.pending();
    expect(
      await queue.discardQueuedAdd({ sessionId: SYNC_IDS.s1, tableName: TABLE, line: line(77) }),
    ).toBe("not_queued");
    expect(await outbox.pending()).toEqual(before);
  });
});
