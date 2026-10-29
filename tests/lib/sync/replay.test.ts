import { afterEach, describe, expect, it } from "vitest";
import { createReplayer, type SendResult } from "@/lib/sync/replay";
import type { OpDraft } from "@/lib/sync/types";
import { openOutbox, type Outbox } from "@/pwa/outbox";
import { SYNC_STUCK_ATTEMPTS } from "@/server/sync/constants";
import type { OpEnvelope } from "@/server/sync/schemas";
import {
  addDraft,
  DEMO,
  DUE,
  editDraft,
  fireDraft,
  lineId,
  openDraft,
  opId,
  resultFor,
  SYNC_IDS,
  syncOutputOf,
} from "../../helpers/sync-data";

// The pure replay engine, with the real (memory) outbox, a scripted send, a fake clock and a seeded random (M20 plan step 14).
const boxes: Outbox[] = [];
afterEach(() => {
  for (const box of boxes.splice(0)) box.close();
});

/** Seeded random in [0, 1). */
function seeded(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function fixture(
  drafts: OpDraft[],
  options: {
    me?: { id: string } | null;
    random?: () => number;
    holder?: string;
    store?: Outbox;
  } = {},
) {
  const store = options.store ?? (await openOutbox({ idb: null }));
  if (!options.store) boxes.push(store);
  for (const [i, draft] of drafts.entries())
    await store.enqueue({ ...draft, opId: draft.opId ?? opId(i + 1) });
  const clock = { now: 1_000_000 };
  const requests: OpEnvelope[][] = [];
  let inFlight = 0;
  let overlapped = false;
  const script: (SendResult | ((ops: OpEnvelope[]) => SendResult | Promise<SendResult>))[] = [];
  let me: { id: string } | null = options.me === undefined ? { id: DEMO.id } : options.me;
  let nextId = 500;
  const replayer = createReplayer({
    store,
    send: async (ops) => {
      requests.push(ops);
      inFlight += 1;
      if (inFlight > 1) overlapped = true;
      try {
        const next = script.shift();
        if (!next) throw new Error("the script ran out");
        return typeof next === "function" ? await next(ops) : next;
      } finally {
        inFlight -= 1;
      }
    },
    me: async () => me,
    now: () => clock.now,
    random: options.random ?? (() => 0.5),
    newOpId: () => opId(nextId++),
    holder: options.holder ?? "tab-1",
  });
  return {
    store,
    clock,
    requests,
    script,
    replayer,
    overlapped: () => overlapped,
    setMe: (next: { id: string } | null) => {
      me = next;
    },
  };
}

/** A 200 that applies every op sent. */
const allApplied = (ops: OpEnvelope[]): SendResult => ({
  kind: "ok",
  output: syncOutputOf(ops.map((op) => resultFor(op, "applied"))),
});
const seqsOf = (requests: OpEnvelope[][]) => requests.map((ops) => ops.map((op) => op.seq));

describe("AT2: replay stops at a network or 5xx error and resumes in order; a conflict is kept and later ops go on", () => {
  it("a network error, a 503, then a 200 with a conflict in the middle", async () => {
    const f = await fixture([1, 2, 3, 4, 5].map((n) => addDraft(n)));
    f.script.push({ kind: "network" }, { kind: "server", status: 503 }, (ops) => ({
      kind: "ok",
      output: syncOutputOf(ops.map((op, i) => resultFor(op, i === 1 ? "conflict" : "applied"))),
    }));

    const first = await f.replayer.run();
    expect(first.state).toBe("offline");
    expect((await f.store.pending()).map((op) => op.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(await f.store.outcomes()).toEqual([]);
    expect((await f.store.pending())[0]).toMatchObject({ attempts: 1 });
    expect((await f.store.pending())[1]).toMatchObject({ attempts: 0 });

    const second = await f.replayer.run({ bypassBackoff: true });
    expect(second.state).toBe("backoff");
    expect(await f.store.outcomes()).toEqual([]);
    expect((await f.store.pending())[0]).toMatchObject({ attempts: 2 });

    const third = await f.replayer.run({ bypassBackoff: true });
    expect(third.state).toBe("idle");
    expect(await f.store.pending()).toEqual([]);
    const outcomes = await f.store.outcomes();
    expect(outcomes.map((o) => [o.seq, o.status, o.seen])).toEqual([
      [1, "applied", false],
      [2, "conflict", false],
      [3, "applied", false],
      [4, "applied", false],
      [5, "applied", false],
    ]);
    expect(outcomes[1]!.conflict).toMatchObject({ reason: "fired" });
    expect(seqsOf(f.requests)).toEqual([
      [1, 2, 3, 4, 5],
      [1, 2, 3, 4, 5],
      [1, 2, 3, 4, 5],
    ]);
    expect(f.overlapped()).toBe(false);
  });

  it("a 200 that stops at op 3 (unavailable) settles 1 and 2; the next request starts at 3", async () => {
    const f = await fixture([1, 2, 3, 4, 5].map((n) => addDraft(n)));
    f.script.push(
      (ops) => ({
        kind: "ok",
        output: syncOutputOf(
          ops.slice(0, 2).map((op) => resultFor(op, "applied")),
          { opId: ops[2]!.opId, reason: "unavailable" },
        ),
      }),
      allApplied,
    );
    const first = await f.replayer.run();
    expect(first.state).toBe("backoff");
    expect((await f.store.pending()).map((op) => op.seq)).toEqual([3, 4, 5]);
    expect((await f.store.pending())[0]).toMatchObject({ attempts: 1 });
    await f.replayer.run({ bypassBackoff: true });
    expect(seqsOf(f.requests)).toEqual([
      [1, 2, 3, 4, 5],
      [3, 4, 5],
    ]);
    expect(await f.store.pending()).toEqual([]);
  });

  it("a duplicate result settles the op as duplicate", async () => {
    const f = await fixture([addDraft(1)]);
    f.script.push((ops) => ({
      kind: "ok",
      output: syncOutputOf([resultFor(ops[0]!, "duplicate")]),
    }));
    await f.replayer.run();
    expect((await f.store.outcomes()).map((o) => o.status)).toEqual(["duplicate"]);
  });

  it("a result for an op that was not in the request is ignored", async () => {
    const f = await fixture([addDraft(1)]);
    f.script.push((ops) => ({
      kind: "ok",
      output: syncOutputOf([
        resultFor(ops[0]!, "applied"),
        resultFor({ opId: opId(77), kind: "add_line" }, "applied"),
      ]),
    }));
    await f.replayer.run();
    expect((await f.store.outcomes()).map((o) => o.opId)).toEqual([opId(1)]);
  });

  it("an empty outbox sends nothing", async () => {
    const f = await fixture([]);
    const report = await f.replayer.run();
    expect(report).toMatchObject({ busy: false, state: "idle" });
    expect(f.requests).toEqual([]);
  });
});

describe("backoff", () => {
  it("the delays are 1, 2, 4, 8, 15, 15 s (jitter 1), and a 200 resets them", async () => {
    const f = await fixture([addDraft(1)]);
    const delays: (number | null)[] = [];
    for (let i = 0; i < 6; i++) {
      f.script.push({ kind: "server", status: 503 });
      delays.push((await f.replayer.run({ bypassBackoff: true })).nextDelayMs);
    }
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 15_000, 15_000]);
    f.script.push((ops) => ({
      kind: "ok",
      output: syncOutputOf([resultFor(ops[0]!, "conflict")]),
    }));
    expect((await f.replayer.run({ bypassBackoff: true })).nextDelayMs).toBeNull();
    await f.store.enqueue({ ...addDraft(2), opId: opId(2) });
    f.script.push({ kind: "network" });
    expect((await f.replayer.run({ bypassBackoff: true })).nextDelayMs).toBe(1_000);
  });

  it("jitter moves each delay within 20 %", async () => {
    for (const [random, expected] of [
      [0, 800],
      [1, 1_200],
    ] as const) {
      const f = await fixture([addDraft(1)], { random: () => random });
      f.script.push({ kind: "network" });
      expect((await f.replayer.run()).nextDelayMs).toBe(expected);
    }
  });

  it("a run before the delay has passed sends nothing; online, focus and a new op bypass the wait", async () => {
    const f = await fixture([addDraft(1)]);
    f.script.push({ kind: "network" }, allApplied);
    await f.replayer.run();
    const early = await f.replayer.run();
    expect(early).toMatchObject({ waited: true, state: "offline" });
    expect(f.requests).toHaveLength(1);
    f.clock.now += 1_000; // the delay has passed
    expect((await f.replayer.run()).state).toBe("idle");
    expect(f.requests).toHaveLength(2);
  });

  it("bypassBackoff sends at once", async () => {
    const f = await fixture([addDraft(1)]);
    f.script.push({ kind: "network" }, allApplied);
    await f.replayer.run();
    await f.replayer.run({ bypassBackoff: true });
    expect(f.requests).toHaveLength(2);
    expect(await f.store.pending()).toEqual([]);
  });
});

describe("AT7: a 30-minute outage, then recovery", () => {
  it("about 120 attempts during the outage; on recovery every op is applied within 18 s, in seq order, in batches of at most 20", async () => {
    const f = await fixture(
      Array.from({ length: 45 }, (_v, i) => addDraft(i + 1)),
      { random: seeded(7) },
    );
    const OUTAGE = 30 * 60 * 1_000;
    const start = f.clock.now;
    let outage = true;
    let outageAttempts = 0;
    const answer = (ops: OpEnvelope[]): SendResult => {
      if (outage) {
        outageAttempts += 1;
        return { kind: "server", status: 503 };
      }
      return allApplied(ops);
    };
    f.script.push(...Array.from({ length: 400 }, () => answer));

    let recoveredAt: number | null = null;
    while ((await f.store.pending()).length > 0) {
      if (f.clock.now - start >= OUTAGE) outage = false;
      const report = await f.replayer.run();
      if (!outage && (await f.store.pending()).length === 0) recoveredAt = f.clock.now;
      f.clock.now += Math.max(1, report.nextDelayMs ?? 1);
      expect(f.clock.now - start).toBeLessThan(OUTAGE + 60_000);
    }
    expect(outageAttempts).toBeGreaterThanOrEqual(110);
    expect(outageAttempts).toBeLessThanOrEqual(140);
    expect(recoveredAt! - (start + OUTAGE)).toBeLessThanOrEqual(18_000);
    const sent = f.requests.slice(outageAttempts);
    expect(sent.map((ops) => ops.length)).toEqual([20, 20, 5]);
    expect(sent.flat().map((op) => op.seq)).toEqual(Array.from({ length: 45 }, (_v, i) => i + 1));
    expect(f.overlapped()).toBe(false);
  });
});

describe("AT8: ops of another user are not sent", () => {
  const drafts = [
    addDraft(1, "s1", DEMO), // Demo, S1
    addDraft(2, "s1", DUE), // Due, S1
    addDraft(3, "s2", DUE), // Due, S2
  ];

  it("me = Due: only Due's S2 op goes; Demo's op is held; Due's S1 op waits behind it", async () => {
    const f = await fixture(drafts, { me: { id: DUE.id } });
    f.script.push(allApplied);
    await f.replayer.run();
    expect(seqsOf(f.requests)).toEqual([[3]]);
    expect(f.replayer.getState().held).toEqual([{ user: DEMO, count: 1 }]);
    expect((await f.store.pending()).map((op) => op.seq)).toEqual([1, 2]);
  });

  it("when Demo logs in, Demo's op goes first and then Due's S1 op follows once Due is back", async () => {
    const f = await fixture(drafts, { me: { id: DUE.id } });
    f.script.push(allApplied, allApplied, allApplied);
    await f.replayer.run();
    f.setMe({ id: DEMO.id });
    await f.replayer.run();
    expect(seqsOf(f.requests)).toEqual([[3], [1]]);
    expect(f.replayer.getState().held).toEqual([{ user: DUE, count: 1 }]);
    f.setMe({ id: DUE.id });
    await f.replayer.run();
    expect(seqsOf(f.requests)).toEqual([[3], [1], [2]]);
    expect(await f.store.pending()).toEqual([]);
    expect(f.replayer.getState().held).toEqual([]);
  });

  it("nobody signed in: nothing is sent", async () => {
    const f = await fixture(drafts, { me: null });
    await f.replayer.run();
    expect(f.requests).toEqual([]);
  });

  it("the server's user_mismatch holds that user's ops until the session changes", async () => {
    const f = await fixture([addDraft(1, "s1", DEMO), addDraft(2, "s2", DEMO)], {
      me: { id: DEMO.id },
    });
    f.script.push((ops) => ({
      kind: "ok",
      output: syncOutputOf([], { opId: ops[0]!.opId, reason: "user_mismatch" }),
    }));
    await f.replayer.run();
    expect(f.replayer.getState().held).toEqual([{ user: DEMO, count: 2 }]);
    await f.replayer.run({ bypassBackoff: true });
    expect(f.requests).toHaveLength(1);
    expect((await f.store.pending()).map((op) => op.seq)).toEqual([1, 2]);
    f.replayer.resetUserHolds();
    f.script.push(allApplied);
    await f.replayer.run({ bypassBackoff: true });
    expect(f.requests).toHaveLength(2);
  });
});

describe("dead entities: stop, prune, carry on", () => {
  it("an add refused as sold out: its edit and void are dropped, the fire loses the id and goes under a new op id", async () => {
    const f = await fixture([
      addDraft(1), // L1, will be refused
      addDraft(2), // L2, fine
      editDraft(3, 1), // edit L1
      fireDraft(4, [1, 2]), // fire [L1, L2]
      { ...editDraft(5, 1), kind: "void_line", payload: { lineId: lineId(1), reason: "comp" } },
      fireDraft(6, [1]), // fire [L1]
    ]);
    f.script.push(
      (ops) => ({
        kind: "ok",
        output: syncOutputOf([resultFor(ops[0]!, "rejected")], {
          opId: ops[0]!.opId,
          reason: "dead_entity",
        }),
      }),
      allApplied,
    );
    const report = await f.replayer.run();
    expect(report.state).toBe("idle");
    // First request: everything pending. Second request: L2's add, and the rewritten fire [L2].
    expect(seqsOf(f.requests)).toEqual([
      [1, 2, 3, 4, 5, 6],
      [2, 4],
    ]);
    const second = f.requests[1]!;
    expect(second[1]!.opId).not.toBe(opId(4));
    expect(second[1]!.payload).toEqual({ sessionId: SYNC_IDS.s1, lineIds: [lineId(2)] });
    const outcomes = await f.store.outcomes();
    const byOp = new Map(outcomes.map((o) => [o.opId, o]));
    expect(byOp.get(opId(1))?.status).toBe("rejected");
    expect(byOp.get(opId(3))).toMatchObject({
      status: "dropped",
      droppedReason: "line_not_created",
    });
    expect(byOp.get(opId(5))).toMatchObject({
      status: "dropped",
      droppedReason: "line_not_created",
    });
    expect(byOp.get(opId(6))).toMatchObject({
      status: "dropped",
      droppedReason: "line_not_created",
    });
    expect(await f.store.pending()).toEqual([]);
  });

  it("an open_table that conflicts: every op on that session is dropped, the other session goes through", async () => {
    const f = await fixture([
      openDraft(1, "s1"),
      addDraft(2, "s1"),
      fireDraft(3, [2], "s1"),
      addDraft(4, "s2"),
    ]);
    f.script.push(
      (ops) => ({
        kind: "ok",
        output: syncOutputOf([resultFor(ops[0]!, "conflict")], {
          opId: ops[0]!.opId,
          reason: "dead_entity",
        }),
      }),
      allApplied,
    );
    await f.replayer.run();
    expect(seqsOf(f.requests)).toEqual([[1, 2, 3, 4], [4]]);
    const outcomes = await f.store.outcomes();
    expect(outcomes.map((o) => [o.seq, o.status, o.droppedReason ?? null])).toEqual([
      [1, "conflict", null],
      [2, "dropped", "session_not_created"],
      [3, "dropped", "session_not_created"],
      [4, "applied", null],
    ]);
  });
});

describe("other replies", () => {
  it("401: signed out, nothing settled, the ops stay", async () => {
    const f = await fixture([addDraft(1), addDraft(2)]);
    f.script.push({ kind: "unauthorized" });
    const report = await f.replayer.run();
    expect(report.state).toBe("signedOut");
    expect(f.replayer.getState().state).toBe("signedOut");
    expect((await f.store.pending()).map((op) => op.seq)).toEqual([1, 2]);
    expect(await f.store.outcomes()).toEqual([]);
  });

  it("403: forbidden, the ops stay", async () => {
    const f = await fixture([addDraft(1)]);
    f.script.push({ kind: "forbidden" });
    expect((await f.replayer.run()).state).toBe("forbidden");
    expect((await f.store.pending()).map((op) => op.seq)).toEqual([1]);
  });

  it("429 backs off like a 5xx", async () => {
    const f = await fixture([addDraft(1)]);
    f.script.push({ kind: "server", status: 429 });
    expect(await f.replayer.run()).toMatchObject({ state: "backoff", nextDelayMs: 1_000 });
  });

  it("the clock skew is the phone's time minus the server's, from every 200", async () => {
    const f = await fixture([addDraft(1)]);
    f.script.push((ops) => ({
      kind: "ok",
      output: syncOutputOf(
        [resultFor(ops[0]!, "applied")],
        null,
        new Date(f.clock.now - 240_000).toISOString(),
      ),
    }));
    await f.replayer.run();
    expect(f.replayer.getState().skewMs).toBe(240_000);
  });
});

describe("a stuck op is flagged, never dropped", () => {
  const stuckReply = (ops: OpEnvelope[]): SendResult => ({
    kind: "ok",
    output: syncOutputOf([], { opId: ops[0]!.opId, reason: "unavailable" }),
  });

  it("ten server replies that leave the first op unsettled raise stuck; nine do not", async () => {
    const f = await fixture([addDraft(1), addDraft(2)]);
    f.script.push(...Array.from({ length: SYNC_STUCK_ATTEMPTS }, () => stuckReply));
    for (let i = 1; i <= SYNC_STUCK_ATTEMPTS; i++) {
      await f.replayer.run({ bypassBackoff: true });
      expect(f.replayer.getState().stuck).toBe(i >= SYNC_STUCK_ATTEMPTS);
    }
    expect((await f.store.pending()).map((op) => op.seq)).toEqual([1, 2]);
    expect(await f.store.outcomes()).toEqual([]);
  });

  it("network failures and 503s do not count (an outage is not a stuck op)", async () => {
    const f = await fixture([addDraft(1)]);
    f.script.push(
      ...Array.from({ length: 30 }, (_v, i) =>
        i % 2 ? ({ kind: "network" } as const) : ({ kind: "server", status: 503 } as const),
      ),
    );
    for (let i = 0; i < 30; i++) await f.replayer.run({ bypassBackoff: true });
    expect(f.replayer.getState().stuck).toBe(false);
  });

  it("the flag clears when the op settles", async () => {
    const f = await fixture([addDraft(1)]);
    f.script.push(...Array.from({ length: SYNC_STUCK_ATTEMPTS }, () => stuckReply), allApplied);
    for (let i = 0; i <= SYNC_STUCK_ATTEMPTS; i++) await f.replayer.run({ bypassBackoff: true });
    expect(f.replayer.getState().stuck).toBe(false);
    expect(await f.store.pending()).toEqual([]);
  });

  it("a 200 with no result and no stop does not loop: one request, then backoff", async () => {
    const f = await fixture([addDraft(1)]);
    f.script.push({ kind: "ok", output: syncOutputOf([]) });
    const report = await f.replayer.run();
    expect(f.requests).toHaveLength(1);
    expect(report.state).toBe("backoff");
  });
});

describe("one replayer per device", () => {
  it("two engines on one store: only one sends; the other answers busy", async () => {
    const store = await openOutbox({ idb: null });
    boxes.push(store);
    const one = await fixture([addDraft(1)], { store, holder: "tab-1" });
    const two = await fixture([], { store, holder: "tab-2" });
    let release!: (value: SendResult) => void;
    one.script.push(() => new Promise<SendResult>((resolve) => (release = resolve)));
    const running = one.replayer.run();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(one.replayer.getState().state).toBe("sending");
    const other = await two.replayer.run();
    expect(other.busy).toBe(true);
    expect(two.requests).toEqual([]);
    release({
      kind: "ok",
      output: syncOutputOf([resultFor({ opId: opId(1), kind: "add_line" }, "applied")]),
    });
    await running;
    expect(await store.pending()).toEqual([]);
    // The lease is released at the end of the run: the other engine can work now.
    await store.enqueue({ ...addDraft(2), opId: opId(2) });
    two.script.push(allApplied);
    expect((await two.replayer.run()).busy).toBe(false);
    expect(two.requests).toHaveLength(1);
  });

  it("the same engine does not run twice at once", async () => {
    const f = await fixture([addDraft(1)]);
    let release!: (value: SendResult) => void;
    f.script.push(() => new Promise<SendResult>((resolve) => (release = resolve)));
    const first = f.replayer.run();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = await f.replayer.run();
    expect(second.busy).toBe(true);
    release(
      allApplied([
        { opId: opId(1), seq: 1, kind: "add_line", clientTs: "", userId: "", payload: {} },
      ]),
    );
    await first;
    expect(f.requests).toHaveLength(1);
  });
});
