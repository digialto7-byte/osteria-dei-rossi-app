import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpDraft, Settlement } from "@/lib/sync/types";
import { openOutbox, type Outbox } from "@/pwa/outbox";

// M20 plan §3.6.1 and step 13: the IndexedDB outbox (fake-indexeddb stands in for the browser). A fresh database name per test.
const SESSION_A = "5e000000-0000-4000-8000-00000000000a";
const SESSION_B = "5e000000-0000-4000-8000-00000000000b";
const WAITER_1 = "a0000000-0000-4000-8000-000000000001";
const WAITER_2 = "a0000000-0000-4000-8000-000000000002";
const line = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const item = "3e000000-0000-4000-8000-000000000001";

let dbCount = 0;
const freshName = () => `osteria-sync-test-${++dbCount}`;
const open: Outbox[] = [];
const outbox = async (name = freshName()) => {
  const box = await openOutbox({ name });
  open.push(box);
  return box;
};
afterEach(() => {
  for (const box of open.splice(0)) box.close();
  vi.unstubAllGlobals();
});

const draft = (n: number, extra: Partial<OpDraft> = {}): OpDraft => ({
  kind: "add_line",
  clientTs: `2026-11-02T19:30:0${n % 10}.000Z`,
  userId: WAITER_1,
  payload: { sessionId: SESSION_A, lineId: line(n), menuItemId: item },
  scope: { sessionId: SESSION_A, lineId: line(n) },
  label: { tableName: "Tavolo 1 (demo)", dishName: "Spezzatino con polenta (demo)" },
  queuedBy: { id: WAITER_1, displayName: "Cameriere Demo" },
  ...extra,
});
const settlement = (opId: string, status: Settlement["status"] = "applied"): Settlement => ({
  opId,
  status,
  settledAt: 1_000,
});

describe("enqueue and reload (AT1)", () => {
  it("five ops over two sessions and two kinds survive a reload in seq order 1 to 5, field for field", async () => {
    const name = freshName();
    const first = await openOutbox({ name });
    const queued = [];
    queued.push(await first.enqueue(draft(1)));
    queued.push(
      await first.enqueue(
        draft(2, {
          kind: "edit_line",
          payload: { lineId: line(1), qty: 2 },
          scope: { sessionId: SESSION_A, lineId: line(1) },
        }),
      ),
    );
    queued.push(
      await first.enqueue(
        draft(3, {
          payload: { sessionId: SESSION_B, lineId: line(3), menuItemId: item },
          scope: { sessionId: SESSION_B, lineId: line(3) },
        }),
      ),
    );
    queued.push(
      await first.enqueue(
        draft(4, {
          kind: "fire",
          payload: { sessionId: SESSION_A, lineIds: [line(1)] },
          scope: { sessionId: SESSION_A },
        }),
      ),
    );
    queued.push(
      await first.enqueue(
        draft(5, {
          userId: WAITER_2,
          queuedBy: { id: WAITER_2, displayName: "Cameriere Due Demo" },
        }),
      ),
    );
    expect(queued.map((op) => op.seq)).toEqual([1, 2, 3, 4, 5]);
    first.close();

    const reloaded = await outbox(name);
    const pending = await reloaded.pending();
    expect(pending.map((op) => op.seq)).toEqual([1, 2, 3, 4, 5]);
    for (const op of queued) expect(pending.find((p) => p.opId === op.opId)).toEqual(op);
    expect(pending.map((op) => op.kind)).toEqual([
      "add_line",
      "edit_line",
      "add_line",
      "fire",
      "add_line",
    ]);
    expect((await reloaded.enqueue(draft(6))).seq).toBe(6);
  });

  it("a new op has attempts 0 and a fresh uuid, and keeps an op id it was given", async () => {
    const box = await outbox();
    const made = await box.enqueue(draft(1));
    expect(made).toMatchObject({ attempts: 0, lastAttemptAt: null });
    expect(made.opId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const given = await box.enqueue(draft(2, { opId: line(99) }));
    expect(given.opId).toBe(line(99));
  });

  it("two connections enqueueing at once get distinct, gap-free seqs", async () => {
    const name = freshName();
    const one = await outbox(name);
    const two = await outbox(name);
    const made = await Promise.all(
      Array.from({ length: 10 }, (_v, i) => (i % 2 === 0 ? one : two).enqueue(draft(i + 1))),
    );
    expect(made.map((op) => op.seq).sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect((await one.pending()).map((op) => op.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe("settle", () => {
  it("moves exactly the named ops to outcomes, in one transaction, with the op's facts", async () => {
    const box = await outbox();
    const ops = [
      await box.enqueue(draft(1)),
      await box.enqueue(draft(2)),
      await box.enqueue(draft(3)),
    ];
    await box.settle([
      { ...settlement(ops[0]!.opId), receivedAt: "2026-11-02T19:31:00+00:00" },
      { ...settlement(ops[2]!.opId, "conflict"), conflict: { reason: "fired" } },
    ]);
    expect((await box.pending()).map((op) => op.opId)).toEqual([ops[1]!.opId]);
    const outcomes = await box.outcomes();
    expect(outcomes.map((o) => [o.opId, o.status, o.seq, o.seen])).toEqual([
      [ops[0]!.opId, "applied", 1, false],
      [ops[2]!.opId, "conflict", 3, false],
    ]);
    expect(outcomes[1]).toMatchObject({
      kind: "add_line",
      userId: WAITER_1,
      scope: { sessionId: SESSION_A, lineId: line(3) },
      label: { dishName: "Spezzatino con polenta (demo)" },
      clientTs: ops[2]!.clientTs,
      settledAt: 1_000,
      conflict: { reason: "fired" },
    });
  });

  it("an abort mid-transaction leaves both stores unchanged", async () => {
    const box = await outbox();
    const ops = [
      await box.enqueue(draft(1)),
      await box.enqueue(draft(2)),
      await box.enqueue(draft(3)),
    ];
    // A function cannot be stored (structured clone fails on the third put): the whole settlement must roll back.
    const poisoned = {
      ...settlement(ops[2]!.opId, "conflict"),
      conflict: { run: () => 1 },
    } as unknown as Settlement;
    await expect(
      box.settle([settlement(ops[0]!.opId), settlement(ops[1]!.opId), poisoned]),
    ).rejects.toThrow();
    expect((await box.pending()).map((op) => op.opId)).toEqual(ops.map((op) => op.opId));
    expect(await box.outcomes()).toEqual([]);
  });

  it("ignores a result for an op that is no longer in the outbox (discarded meanwhile) and settles the rest", async () => {
    const box = await outbox();
    const ops = [await box.enqueue(draft(1)), await box.enqueue(draft(2))];
    await box.discard([ops[0]!.opId]);
    await box.settle([settlement(ops[0]!.opId), settlement(ops[1]!.opId)]);
    expect((await box.outcomes()).map((o) => o.opId)).toEqual([ops[1]!.opId]);
  });
});

describe("pruneDead (planned inside the transaction)", () => {
  async function threeOps() {
    const box = await outbox();
    const add = await box.enqueue(draft(1));
    const edit = await box.enqueue(
      draft(2, { kind: "edit_line", payload: { lineId: line(1), qty: 2 } }),
    );
    const fire = await box.enqueue(
      draft(3, {
        kind: "fire",
        payload: { sessionId: SESSION_A, lineIds: [line(1), line(7)] },
        scope: { sessionId: SESSION_A },
      }),
    );
    return { box, add, edit, fire };
  }

  it("rewrites a fire to a new op id with the same seq, and drops ops with a reason; it returns how many it changed", async () => {
    const { box, add, edit, fire } = await threeOps();
    const rewritten = {
      ...fire,
      opId: line(50),
      payload: { sessionId: SESSION_A, lineIds: [line(7)] },
    };
    const seen: string[][] = [];
    const count = await box.pruneDead((pending) => {
      seen.push(pending.map((op) => op.opId));
      return {
        rewrites: [{ replaces: fire.opId, op: rewritten }],
        drops: [{ opId: edit.opId, reason: "line_not_created", settledAt: 2_000 }],
      };
    });
    expect(count).toBe(2);
    expect(seen).toEqual([[add.opId, edit.opId, fire.opId]]); // the plan saw the outbox as it was inside the transaction
    const pending = await box.pending();
    expect(pending.map((op) => [op.opId, op.seq])).toEqual([
      [add.opId, 1],
      [line(50), 3],
    ]);
    expect(pending[1]!.payload).toEqual({ sessionId: SESSION_A, lineIds: [line(7)] });
    const outcomes = await box.outcomes();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({
      opId: edit.opId,
      status: "dropped",
      droppedReason: "line_not_created",
      seq: 2,
      settledAt: 2_000,
      seen: false,
    });
  });

  it("skips what is already gone (a 'Scarta' got there first) and applies the rest", async () => {
    const { box, add, edit, fire } = await threeOps();
    await box.discard([fire.opId]);
    const count = await box.pruneDead(() => ({
      rewrites: [{ replaces: fire.opId, op: { ...fire, opId: line(51) } }],
      drops: [
        { opId: edit.opId, reason: "line_not_created", settledAt: 1 },
        { opId: line(404), reason: "line_not_created", settledAt: 1 },
      ],
    }));
    expect(count).toBe(1);
    expect((await box.pending()).map((op) => op.opId)).toEqual([add.opId]);
    expect((await box.outcomes()).map((o) => o.opId)).toEqual([edit.opId]);
  });

  it("a plan that throws changes nothing", async () => {
    const { box, add, edit, fire } = await threeOps();
    await expect(
      box.pruneDead(() => {
        throw new Error("plan failed");
      }),
    ).rejects.toThrow("plan failed");
    expect((await box.pending()).map((op) => op.opId)).toEqual([add.opId, edit.opId, fire.opId]);
    expect(await box.outcomes()).toEqual([]);
  });

  it("notifies subscribers only when it changed something", async () => {
    const { box, edit } = await threeOps();
    const heard = vi.fn();
    box.subscribe(heard);
    const none = await box.pruneDead(() => ({ rewrites: [], drops: [] }));
    const gone = await box.pruneDead(() => ({
      rewrites: [],
      drops: [{ opId: line(404), reason: "session_not_created", settledAt: 1 }],
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect([none, gone]).toEqual([0, 0]);
    expect(heard).not.toHaveBeenCalled();
    expect(
      await box.pruneDead(() => ({
        rewrites: [],
        drops: [{ opId: edit.opId, reason: "session_not_created", settledAt: 1 }],
      })),
    ).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(heard).toHaveBeenCalledTimes(1);
  });
});

describe("discardIfUnsent (the discards and rewrites in one transaction)", () => {
  it("deletes the add and rewrites the fire in one go, and leaves no outcome", async () => {
    const box = await outbox();
    const add = await box.enqueue(draft(1));
    const fire = await box.enqueue(
      draft(2, {
        kind: "fire",
        payload: { sessionId: SESSION_A, lineIds: [line(1), line(7)] },
        scope: { sessionId: SESSION_A },
      }),
    );
    const result = await box.discardIfUnsent(line(1), () => ({
      discards: [],
      rewrites: [
        {
          replaces: fire.opId,
          op: { ...fire, opId: line(60), payload: { sessionId: SESSION_A, lineIds: [line(7)] } },
        },
      ],
    }));
    expect(result).toBe("discarded");
    expect(add.opId).not.toBe(line(60));
    expect((await box.pending()).map((op) => [op.opId, op.seq])).toEqual([[line(60), 2]]);
    expect(await box.outcomes()).toEqual([]);
  });

  it("a plan that throws undoes everything", async () => {
    const box = await outbox();
    const a = await box.enqueue(draft(1));
    const b = await box.enqueue(draft(2));
    await expect(
      box.discardIfUnsent(line(1), () => {
        throw new Error("plan failed");
      }),
    ).rejects.toThrow();
    expect((await box.pending()).map((op) => op.opId)).toEqual([a.opId, b.opId]);
  });

  it("an op that was put in a request, or tried, stops the whole discard", async () => {
    const box = await outbox();
    const add = await box.enqueue(draft(1));
    const fire = await box.enqueue(
      draft(2, {
        kind: "fire",
        payload: { sessionId: SESSION_A, lineIds: [line(1), line(7)] },
        scope: { sessionId: SESSION_A },
      }),
    );
    await box.markAttempt(fire.opId, 1_000);
    const result = await box.discardIfUnsent(line(1), () => ({
      discards: [],
      rewrites: [{ replaces: fire.opId, op: { ...fire, opId: line(61) } }],
    }));
    expect(result).toBe("sent");
    expect((await box.pending()).map((op) => op.opId)).toEqual([add.opId, fire.opId]);
    expect(await box.discardIfUnsent(line(99), () => ({ discards: [], rewrites: [] }))).toBe(
      "not_queued",
    );
  });
});

describe("attempts, discard, seen", () => {
  it("markAttempt counts on the named op only", async () => {
    const box = await outbox();
    const [a, b] = [await box.enqueue(draft(1)), await box.enqueue(draft(2))];
    await box.markAttempt(a.opId, 5_000);
    await box.markAttempt(a.opId, 6_000);
    const pending = await box.pending();
    expect(pending.find((op) => op.opId === a.opId)).toMatchObject({
      attempts: 2,
      lastAttemptAt: 6_000,
    });
    expect(pending.find((op) => op.opId === b.opId)).toMatchObject({
      attempts: 0,
      lastAttemptAt: null,
    });
  });

  it("markSent stamps every named op (and only those), and keeps the stamp of an earlier send", async () => {
    const box = await outbox();
    const [a, b, c] = [
      await box.enqueue(draft(1)),
      await box.enqueue(draft(2)),
      await box.enqueue(draft(3)),
    ];
    expect(a.sentAt ?? null).toBeNull();
    await box.markSent([a.opId, b.opId], 5_000);
    await box.markSent([b.opId], 9_000);
    const byId = new Map((await box.pending()).map((op) => [op.opId, op]));
    expect(byId.get(a.opId)).toMatchObject({ sentAt: 5_000, attempts: 0 });
    expect(byId.get(b.opId)).toMatchObject({ sentAt: 5_000, attempts: 0 });
    expect(byId.get(c.opId)!.sentAt ?? null).toBeNull();
  });

  it("discard deletes ops without an outcome", async () => {
    const box = await outbox();
    const [a, b] = [await box.enqueue(draft(1)), await box.enqueue(draft(2))];
    await box.discard([a.opId]);
    expect((await box.pending()).map((op) => op.opId)).toEqual([b.opId]);
    expect(await box.outcomes()).toEqual([]);
  });

  it("markSeen flags the named outcomes only", async () => {
    const box = await outbox();
    const ops = [await box.enqueue(draft(1)), await box.enqueue(draft(2))];
    await box.settle(ops.map((op) => settlement(op.opId, "rejected")));
    await box.markSeen([ops[0]!.opId]);
    expect((await box.outcomes()).map((o) => [o.opId, o.seen])).toEqual([
      [ops[0]!.opId, true],
      [ops[1]!.opId, false],
    ]);
  });
});

describe("pruneOutcomes", () => {
  const DAY = 24 * 60 * 60 * 1_000;

  it("removes the seen ones and those older than 24 hours, and keeps the rest", async () => {
    const box = await outbox();
    const ops = [];
    for (let n = 1; n <= 4; n++) ops.push(await box.enqueue(draft(n)));
    const now = 10 * DAY;
    await box.settle([
      { ...settlement(ops[0]!.opId), settledAt: now - 1_000 }, // fresh, unseen: kept
      { ...settlement(ops[1]!.opId), settledAt: now - 2_000 }, // fresh, seen: removed
      { ...settlement(ops[2]!.opId), settledAt: now - DAY - 1 }, // older than 24 h, unseen: removed
      { ...settlement(ops[3]!.opId), settledAt: now - DAY + 1_000 }, // just under 24 h: kept
    ]);
    await box.markSeen([ops[1]!.opId]);
    expect(await box.pruneOutcomes(now)).toBe(2);
    expect((await box.outcomes()).map((o) => o.opId)).toEqual([ops[0]!.opId, ops[3]!.opId]);
  });
});

describe("meta: the lease and the last user", () => {
  it("one holder at a time, until the lease runs out", async () => {
    const box = await outbox();
    expect(await box.acquireLease("tab-1", 1_000, 30_000)).toBe(true);
    expect(await box.acquireLease("tab-2", 2_000, 30_000)).toBe(false);
    expect(await box.acquireLease("tab-1", 3_000, 30_000)).toBe(true); // the holder renews
    expect(await box.acquireLease("tab-2", 32_999, 30_000)).toBe(false);
    expect(await box.acquireLease("tab-2", 33_001, 30_000)).toBe(true); // expired
  });

  it("two connections cannot both take a free lease", async () => {
    const name = freshName();
    const one = await outbox(name);
    const two = await outbox(name);
    const got = await Promise.all([
      one.acquireLease("a", 1_000, 30_000),
      two.acquireLease("b", 1_000, 30_000),
    ]);
    expect(got.filter(Boolean)).toHaveLength(1);
  });

  it("releaseLease frees it for the holder only", async () => {
    const box = await outbox();
    await box.acquireLease("tab-1", 1_000, 30_000);
    await box.releaseLease("tab-2");
    expect(await box.acquireLease("tab-2", 2_000, 30_000)).toBe(false);
    await box.releaseLease("tab-1");
    expect(await box.acquireLease("tab-2", 2_000, 30_000)).toBe(true);
  });

  it("remembers the last signed-in user across a reload", async () => {
    const name = freshName();
    const first = await openOutbox({ name });
    expect(await first.getLastUser()).toBeNull();
    await first.setLastUser({ id: WAITER_1, displayName: "Cameriere Demo", role: "waiter" });
    first.close();
    const second = await outbox(name);
    expect(await second.getLastUser()).toEqual({
      id: WAITER_1,
      displayName: "Cameriere Demo",
      role: "waiter",
    });
  });
});

describe("clearLastUser", () => {
  it("forgets the last user (signed out for sure) and leaves the queue", async () => {
    const box = await outbox();
    await box.enqueue(draft(1));
    await box.setLastUser({ id: WAITER_1, displayName: "Cameriere Demo", role: "waiter" });
    await box.clearLastUser();
    expect(await box.getLastUser()).toBeNull();
    expect(await box.pending()).toHaveLength(1);
  });
});

describe("change events", () => {
  it("every write wakes the subscribers of this and of another connection", async () => {
    const name = freshName();
    const one = await outbox(name);
    const two = await outbox(name);
    const seenByOne = vi.fn();
    const seenByTwo = vi.fn();
    one.subscribe(seenByOne);
    two.subscribe(seenByTwo);
    await one.enqueue(draft(1));
    await vi.waitFor(() => expect(seenByTwo).toHaveBeenCalled());
    expect(seenByOne).toHaveBeenCalled();
  });

  it("unsubscribing stops the calls", async () => {
    const box = await outbox();
    const seen = vi.fn();
    const stop = box.subscribe(seen);
    stop();
    await box.enqueue(draft(1));
    expect(seen).not.toHaveBeenCalled();
  });
});

describe("no IndexedDB", () => {
  it("falls back to memory with the same API, and says so", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const box = await openOutbox({ name: freshName() });
    expect(box.memoryOnly).toBe(true);
    const a = await box.enqueue(draft(1));
    const b = await box.enqueue(draft(2));
    expect([a.seq, b.seq]).toEqual([1, 2]);
    await box.markAttempt(a.opId, 7);
    await box.settle([settlement(a.opId, "conflict")]);
    expect((await box.pending()).map((op) => op.opId)).toEqual([b.opId]);
    expect((await box.outcomes()).map((o) => [o.opId, o.status])).toEqual([[a.opId, "conflict"]]);
    expect(await box.acquireLease("x", 1, 10)).toBe(true);
    expect(await box.acquireLease("y", 2, 10)).toBe(false);
  });

  it("a memory outbox rolls a failed settlement back too", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const box = await openOutbox({ name: freshName() });
    const [a, b] = [await box.enqueue(draft(1)), await box.enqueue(draft(2))];
    const poisoned = {
      ...settlement(b.opId, "conflict"),
      conflict: { run: () => 1 },
    } as unknown as Settlement;
    await expect(box.settle([settlement(a.opId), poisoned])).rejects.toThrow();
    expect((await box.pending()).map((op) => op.opId)).toEqual([a.opId, b.opId]);
    expect(await box.outcomes()).toEqual([]);
  });

  it("falls back when opening the database fails", async () => {
    const broken = {
      open: () => {
        throw new Error("blocked");
      },
    } as unknown as IDBFactory;
    const box = await openOutbox({ name: freshName(), idb: broken });
    expect(box.memoryOnly).toBe(true);
  });

  it("IndexedDB present: memoryOnly is false", async () => {
    expect((await outbox()).memoryOnly).toBe(false);
  });
});
