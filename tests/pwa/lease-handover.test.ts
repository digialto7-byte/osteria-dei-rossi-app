import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openOutbox, type Outbox } from "@/pwa/outbox";
import { createSyncRuntime, type SyncRuntime } from "@/pwa/runtime";
import { SYNC_LEASE_MS, SYNC_REQUEST_TIMEOUT_MS } from "@/server/sync/constants";
import type { SendResult } from "@/lib/sync/replay";
import type { OpEnvelope } from "@/server/sync/schemas";
import { DEMO, lineId, opId, resultFor, SYNC_IDS, syncOutputOf } from "../helpers/sync-data";

// The replay lease (M20 follow-up): a page that is left in the middle of a send must not make the next page wait for the lease to run out.
// Two pages = two runtimes on one IndexedDB (fake-indexeddb). setImmediate stays real so the fake database keeps running.
let dbCount = 0;
const boxes: Outbox[] = [];
const runtimes: SyncRuntime[] = [];
beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
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
  count(type: string) {
    return this.l.get(type)?.size ?? 0;
  }
}

const applyAll = (ops: OpEnvelope[]): SendResult => ({
  kind: "ok",
  output: syncOutputOf(ops.map((op) => resultFor(op, "applied"))),
});

/** One page: its own runtime on the shared database, its own window and document. */
async function page(name: string, send: (ops: OpEnvelope[]) => Promise<SendResult>) {
  const outbox = await openOutbox({ name });
  boxes.push(outbox);
  const win = new Target();
  const doc = new Target();
  let n = 700;
  const runtime = await createSyncRuntime({
    outbox,
    send,
    now: () => Date.now(),
    random: () => 0.5,
    newOpId: () => opId(n++),
    holder: `page-${runtimes.length + 1}`,
    env: { win, doc },
  });
  runtimes.push(runtime);
  await runtime.setMe({ ...DEMO, role: "waiter" });
  return { runtime, outbox, win, doc };
}
const addOp = (runtime: SyncRuntime) =>
  runtime.queue.queueAdd({
    sessionId: SYNC_IDS.s1,
    tableName: "Tavolo 1 (demo)",
    lineId: lineId(1),
    item: { id: SYNC_IDS.item, name: "Piatto (demo)" },
  });
/** Lets the fake database (real setImmediate) and the fake timers both run until things are quiet. */
async function flush() {
  for (let i = 0; i < 30; i += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(0);
  }
}
/** Moves fake time forward in small steps, letting the database run in between. */
async function advance(ms: number) {
  for (let spent = 0; spent < ms; spent += 250) {
    await vi.advanceTimersByTimeAsync(Math.min(250, ms - spent));
    await flush();
  }
}

describe("the lease is short, and above one send's worst case", () => {
  it("is longer than a send may take, and much shorter than the old 30 s", () => {
    expect(SYNC_LEASE_MS).toBeGreaterThan(SYNC_REQUEST_TIMEOUT_MS);
    expect(SYNC_LEASE_MS).toBeLessThanOrEqual(15_000);
  });
});

describe("a page left in the middle of a send", () => {
  it("pagehide releases the lease at once, so the next page sends without waiting", async () => {
    const name = `lease-${++dbCount}`;
    const first = await page(name, () => new Promise<SendResult>(() => undefined)); // the send never comes back
    await addOp(first.runtime);
    await flush();
    // The first page holds the lease: another holder is refused.
    expect(await first.outbox.acquireLease("someone-else", Date.now(), SYNC_LEASE_MS)).toBe(false);

    first.win.emit("pagehide");
    await flush();
    const sentByNext: OpEnvelope[][] = [];
    const next = await page(name, async (ops) => {
      sentByNext.push(ops);
      return applyAll(ops);
    });
    await flush();
    await advance(100);
    expect(sentByNext).toHaveLength(1); // within a fraction of a second, not after the lease
    expect(await next.outbox.pending()).toEqual([]);
  });

  it("the page going to the background releases it too (visibilitychange to hidden); to visible does not", async () => {
    const name = `lease-${++dbCount}`;
    const first = await page(name, () => new Promise<SendResult>(() => undefined));
    await addOp(first.runtime);
    await flush();
    first.doc.visibilityState = "visible";
    first.doc.emit("visibilitychange");
    await flush();
    expect(await first.outbox.acquireLease("someone-else", Date.now(), SYNC_LEASE_MS)).toBe(false);
    first.doc.visibilityState = "hidden";
    first.doc.emit("visibilitychange");
    await flush();
    expect(await first.outbox.acquireLease("someone-else", Date.now(), SYNC_LEASE_MS)).toBe(true);
  });

  it("a page that vanished without a word (no pagehide) holds the lease only for the short lease; the next page takes over on its next tick", async () => {
    const name = `lease-${++dbCount}`;
    const first = await page(name, () => new Promise<SendResult>(() => undefined));
    await addOp(first.runtime);
    await flush();
    const sentByNext: OpEnvelope[][] = [];
    await page(name, async (ops) => {
      sentByNext.push(ops);
      return applyAll(ops);
    });
    await flush();
    expect(sentByNext).toHaveLength(0); // the lease is still live
    await advance(SYNC_LEASE_MS + 3_000); // the lease plus one busy-retry tick, not 30 s
    expect(sentByNext).toHaveLength(1);
  });

  it("an online event on the next page takes over as soon as the lease is gone", async () => {
    const name = `lease-${++dbCount}`;
    const first = await page(name, () => new Promise<SendResult>(() => undefined));
    await addOp(first.runtime);
    await flush();
    const sentByNext: OpEnvelope[][] = [];
    const next = await page(name, async (ops) => {
      sentByNext.push(ops);
      return applyAll(ops);
    });
    await flush();
    first.win.emit("pagehide");
    await flush();
    next.win.emit("online");
    await flush();
    await advance(50);
    expect(sentByNext).toHaveLength(1);
  });

  it("stop() takes the listeners away", async () => {
    const first = await page(`lease-${++dbCount}`, async (ops) => applyAll(ops));
    expect(first.win.count("pagehide")).toBe(1);
    first.runtime.stop();
    expect(first.win.count("pagehide")).toBe(0);
    expect(first.doc.count("visibilitychange")).toBe(0);
  });
});

describe("two live pages never send at the same time", () => {
  it("while one send is running the other waits, and no overlap is ever seen", async () => {
    const name = `lease-${++dbCount}`;
    let running = 0;
    let overlapped = false;
    const slow = (ops: OpEnvelope[]) =>
      new Promise<SendResult>((resolve) => {
        running += 1;
        if (running > 1) overlapped = true;
        setTimeout(() => {
          running -= 1;
          resolve(applyAll(ops));
        }, 2_000);
      });
    const a = await page(name, slow);
    const b = await page(name, slow);
    await addOp(a.runtime);
    await flush();
    b.win.emit("online");
    b.win.emit("focus");
    await flush();
    await advance(1_000);
    b.win.emit("online");
    await advance(10_000);
    expect(overlapped).toBe(false);
    expect(await a.outbox.pending()).toEqual([]);
  });
});
