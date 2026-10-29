import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SendResult } from "@/lib/sync/replay";
import { EMPTY_VIEW } from "@/lib/sync/view";
import { openOutbox, type Outbox } from "@/pwa/outbox";
import { createSyncRuntime, type SyncRuntime } from "@/pwa/runtime";
import type { OpEnvelope } from "@/server/sync/schemas";
import { LINE_STEW } from "../helpers/orders-data";
import { DEMO, DUE, lineId, opId, resultFor, SYNC_IDS, syncOutputOf } from "../helpers/sync-data";

// The glue between the outbox, the engine, the queue and the screens (M20 plan §3.6.2): a cached snapshot that changes when the outbox or
// the engine does, the signed-in user, and the runner.
const boxes: Outbox[] = [];
const runtimes: SyncRuntime[] = [];
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  for (const rt of runtimes.splice(0)) rt.stop();
  for (const box of boxes.splice(0)) box.close();
  vi.useRealTimers();
});

class Target {
  private l = new Map<string, Set<() => void>>();
  visibilityState = "visible";
  addEventListener(type: string, fn: () => void) {
    if (!this.l.has(type)) this.l.set(type, new Set());
    this.l.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: () => void) {
    this.l.get(type)?.delete(fn);
  }
  emit(type: string) {
    this.l.get(type)?.forEach((fn) => fn());
  }
}

async function build(options: { startRunner?: boolean; name?: string } = {}) {
  const outbox = await openOutbox({ idb: null });
  boxes.push(outbox);
  const sent: OpEnvelope[][] = [];
  const script: SendResult[] = [];
  const win = new Target();
  const doc = new Target();
  const runtime = await createSyncRuntime({
    outbox,
    send: async (ops) => {
      sent.push(ops);
      return (
        script.shift() ?? {
          kind: "ok",
          output: syncOutputOf(ops.map((op) => resultFor(op, "applied"))),
        }
      );
    },
    now: () => Date.parse("2026-11-02T19:30:10.000Z") + (sent.length > 0 ? 0 : 0),
    random: () => 0.5,
    newOpId: (() => {
      let n = 700;
      return () => opId(n++);
    })(),
    holder: "tab-1",
    env: options.startRunner ? { win, doc } : undefined,
  });
  runtimes.push(runtime);
  return { runtime, outbox, sent, script, win, doc };
}
const add = (runtime: SyncRuntime, n: number) =>
  runtime.queue.queueAdd({
    sessionId: SYNC_IDS.s1,
    tableName: "Tavolo 1 (demo)",
    lineId: lineId(n),
    item: { id: SYNC_IDS.item, name: LINE_STEW.name },
  });

describe("the snapshot", () => {
  it("starts ready and empty, and is the same object until something changes", async () => {
    const { runtime } = await build();
    const first = runtime.getSnapshot();
    expect(first).toMatchObject({ ready: true, pending: 0, visible: false });
    expect(runtime.getSnapshot()).toBe(first);
    expect(EMPTY_VIEW.ready).toBe(false);
  });

  it("an op queued shows up: pending 1, mine 1 once the user is known, and the listeners hear it", async () => {
    const { runtime } = await build();
    await runtime.setMe({ id: DEMO.id, displayName: DEMO.displayName, role: "waiter" });
    const heard = vi.fn();
    runtime.subscribe(heard);
    await add(runtime, 1);
    await vi.waitFor(() => expect(runtime.getSnapshot().pending).toBe(1));
    expect(runtime.getSnapshot()).toMatchObject({ mine: 1, visible: true });
    expect(runtime.getSnapshot().ops[0]).toMatchObject({
      kind: "add_line",
      label: { dishName: LINE_STEW.name },
    });
    expect(heard).toHaveBeenCalled();
  });

  it("ops of another person on the phone are held for the person signed in", async () => {
    const { runtime } = await build();
    await runtime.setMe({ id: DEMO.id, displayName: DEMO.displayName, role: "waiter" });
    await add(runtime, 1);
    await runtime.setMe({ id: DUE.id, displayName: DUE.displayName, role: "waiter" });
    await runtime.replayer.run({ bypassBackoff: true });
    await vi.waitFor(() => expect(runtime.getSnapshot().held).toEqual([{ user: DEMO, count: 1 }]));
    expect(runtime.getSnapshot()).toMatchObject({ pending: 1, mine: 0, visible: true });
  });
});

describe("the runner", () => {
  it("a new op is sent at once, and the snapshot empties when the server applied it", async () => {
    const { runtime, sent } = await build({ startRunner: true });
    await runtime.setMe({ id: DEMO.id, displayName: DEMO.displayName, role: "waiter" });
    await vi.advanceTimersByTimeAsync(0);
    sent.length = 0;
    await add(runtime, 1);
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(runtime.getSnapshot().pending).toBe(0));
    expect(sent).toHaveLength(1);
    expect(sent[0]![0]).toMatchObject({ kind: "add_line", userId: DEMO.id });
    expect(runtime.getSnapshot().outcomes.map((o) => o.status)).toEqual(["applied"]);
  });

  it("a failing network leaves the op in the snapshot as offline, and online brings it back", async () => {
    const { runtime, script, win } = await build({ startRunner: true });
    await runtime.setMe({ id: DEMO.id, displayName: DEMO.displayName, role: "waiter" });
    await vi.advanceTimersByTimeAsync(0);
    script.push({ kind: "network" });
    await add(runtime, 1);
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(runtime.getSnapshot().state).toBe("offline"));
    expect(runtime.getSnapshot().pending).toBe(1);
    win.emit("online");
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(runtime.getSnapshot().pending).toBe(0));
  });

  it("stop() leaves the window alone", async () => {
    const { runtime, win, sent } = await build({ startRunner: true });
    await runtime.setMe({ id: DEMO.id, displayName: DEMO.displayName, role: "waiter" });
    await vi.advanceTimersByTimeAsync(0);
    runtime.stop();
    sent.length = 0;
    await add(runtime, 1);
    win.emit("online");
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([]);
  });
});

describe("the signed-in user", () => {
  it("is remembered, so a phone with no connection still knows who it is", async () => {
    const { runtime, outbox } = await build();
    await runtime.setMe({ id: DEMO.id, displayName: DEMO.displayName, role: "waiter" });
    expect(await outbox.getLastUser()).toEqual({
      id: DEMO.id,
      displayName: DEMO.displayName,
      role: "waiter",
    });
  });

  it("a fresh runtime on the same outbox falls back to the last user until /api/me answers", async () => {
    const { outbox } = await build();
    await outbox.setLastUser({ id: DEMO.id, displayName: DEMO.displayName, role: "waiter" });
    const sent: OpEnvelope[][] = [];
    const rt = await createSyncRuntime({
      outbox,
      send: async (ops) => {
        sent.push(ops);
        return { kind: "ok", output: syncOutputOf(ops.map((op) => resultFor(op, "applied"))) };
      },
      now: () => 1_000,
      random: () => 0.5,
      newOpId: () => opId(800),
      holder: "tab-2",
    });
    runtimes.push(rt);
    await outbox.enqueue({
      kind: "add_line",
      clientTs: "2026-11-02T19:30:00.000Z",
      userId: DEMO.id,
      payload: { sessionId: SYNC_IDS.s1, lineId: lineId(1), menuItemId: SYNC_IDS.item },
      scope: { sessionId: SYNC_IDS.s1, lineId: lineId(1) },
      label: {},
      queuedBy: DEMO,
    });
    await rt.replayer.run({ bypassBackoff: true });
    expect(sent).toHaveLength(1);
  });

  it("setMe(null) forgets the current user for this tab but keeps the queue", async () => {
    const { runtime } = await build();
    await runtime.setMe({ id: DEMO.id, displayName: DEMO.displayName, role: "waiter" });
    await add(runtime, 1);
    await runtime.setMe(null);
    await vi.waitFor(() => expect(runtime.getSnapshot().pending).toBe(1));
    expect(runtime.getSnapshot().mine).toBe(0);
  });
});
