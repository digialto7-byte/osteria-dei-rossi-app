import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openOutbox, type Outbox } from "@/pwa/outbox";
import { createSyncRuntime, type SyncRuntime } from "@/pwa/runtime";
import { DEMO, lineId, opId, resultFor, SYNC_IDS, syncOutputOf } from "../helpers/sync-data";

// An applied open_table makes the worker's copy of /api/tables stale; the runtime refreshes it once in the background (M20 follow-up).
// Edits, adds and fires never do, and several opens in a row cost one read.
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

async function build(refresh: () => unknown = () => true) {
  const outbox = await openOutbox({ idb: null });
  boxes.push(outbox);
  const refreshTables = vi.fn(refresh);
  let n = 700;
  const runtime = await createSyncRuntime({
    outbox,
    send: async (ops) => ({
      kind: "ok",
      output: syncOutputOf(ops.map((op) => resultFor(op, "applied"))),
    }),
    now: () => Date.parse("2026-11-02T19:30:10.000Z"),
    random: () => 0.5,
    newOpId: () => opId(n++),
    holder: "tab-1",
    refreshTables,
  });
  runtimes.push(runtime);
  await runtime.setMe({ ...DEMO, role: "waiter" });
  return { runtime, refreshTables };
}
const open = (runtime: SyncRuntime, session: string, table: string) =>
  runtime.queue.queueOpenTable({
    tableId: table,
    tableName: "Tavolo 1 (demo)",
    sessionId: session,
    covers: 2,
  });

describe("refreshing the tables list when a table was opened", () => {
  it("an applied open_table causes exactly one read of the list, after the debounce", async () => {
    const { runtime, refreshTables } = await build();
    await open(runtime, SYNC_IDS.s1, SYNC_IDS.table1);
    await runtime.replayer.run();
    expect(refreshTables).not.toHaveBeenCalled(); // debounced
    await vi.advanceTimersByTimeAsync(1_000);
    expect(refreshTables).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refreshTables).toHaveBeenCalledTimes(1);
  });

  it("an add_line, an edit and a fire cause none", async () => {
    const { runtime, refreshTables } = await build();
    await runtime.queue.queueAdd({
      sessionId: SYNC_IDS.s1,
      tableName: "Tavolo 1 (demo)",
      lineId: lineId(1),
      item: { id: SYNC_IDS.item, name: "Piatto (demo)" },
    });
    await runtime.queue.queueFire({
      sessionId: SYNC_IDS.s1,
      tableName: "Tavolo 1 (demo)",
      lineIds: [lineId(1)],
    });
    await runtime.replayer.run();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refreshTables).not.toHaveBeenCalled();
  });

  it("several opens in one go, or in two replies close together, cost one read", async () => {
    const { runtime, refreshTables } = await build();
    await open(runtime, SYNC_IDS.s1, SYNC_IDS.table1);
    await open(runtime, SYNC_IDS.s2, SYNC_IDS.table2);
    await runtime.replayer.run();
    await vi.advanceTimersByTimeAsync(100);
    await open(runtime, "5e000000-0000-4000-8000-0000000000c3", SYNC_IDS.table1);
    await runtime.replayer.run();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(refreshTables).toHaveBeenCalledTimes(1);
  });

  it("a stopped runtime reads nothing", async () => {
    const { runtime, refreshTables } = await build();
    await open(runtime, SYNC_IDS.s1, SYNC_IDS.table1);
    await runtime.replayer.run();
    runtime.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refreshTables).not.toHaveBeenCalled();
  });
});

describe("a refresh queued for one person is not read under the next", () => {
  it("clearUser cancels a pending refresh", async () => {
    const { runtime, refreshTables } = await build();
    await open(runtime, SYNC_IDS.s1, SYNC_IDS.table1);
    await runtime.replayer.run();
    await runtime.clearUser();
    await vi.advanceTimersByTimeAsync(60_000);
    await runtime.replayer.run(); // later connectivity does not bring it back either
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refreshTables).not.toHaveBeenCalled();
  });

  it("a different person in setMe cancels it; the same person does not", async () => {
    const same = await build();
    await open(same.runtime, SYNC_IDS.s1, SYNC_IDS.table1);
    await same.runtime.replayer.run();
    await same.runtime.setMe({ ...DEMO, role: "waiter" });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(same.refreshTables).toHaveBeenCalledTimes(1);

    const other = await build();
    await open(other.runtime, SYNC_IDS.s1, SYNC_IDS.table1);
    await other.runtime.replayer.run();
    await other.runtime.setMe({
      id: "a0000000-0000-4000-8000-0000000000dd",
      displayName: "Cameriere Due Demo",
      role: "waiter",
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(other.refreshTables).not.toHaveBeenCalled();
  });
});

describe("a refresh whose read failed stays pending until the next successful run", () => {
  it("retries once the replay next sees connectivity, and stops once the read works", async () => {
    let works = false;
    const { runtime, refreshTables } = await build(() => works);
    await open(runtime, SYNC_IDS.s1, SYNC_IDS.table1);
    await runtime.replayer.run();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(refreshTables).toHaveBeenCalledTimes(1); // failed: still pending
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refreshTables).toHaveBeenCalledTimes(1); // no timer loop of its own

    works = true;
    await runtime.replayer.run(); // the next run (connectivity is back; nothing to send)
    await vi.advanceTimersByTimeAsync(1_000);
    expect(refreshTables).toHaveBeenCalledTimes(2);

    await runtime.replayer.run();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refreshTables).toHaveBeenCalledTimes(2); // done: nothing pending any more
  });

  it("a read that throws or rejects counts as failed, and only one refresh is ever pending", async () => {
    let mode: "throw" | "reject" | "ok" = "throw";
    const { runtime, refreshTables } = await build(() => {
      if (mode === "throw") throw new Error("offline");
      if (mode === "reject") return Promise.reject(new Error("offline"));
      return Promise.resolve(true);
    });
    await open(runtime, SYNC_IDS.s1, SYNC_IDS.table1);
    await runtime.replayer.run();
    await vi.advanceTimersByTimeAsync(1_000);
    await open(runtime, SYNC_IDS.s2, SYNC_IDS.table2); // a second open while one is pending
    await runtime.replayer.run();
    await vi.advanceTimersByTimeAsync(1_000);
    mode = "reject";
    await runtime.replayer.run();
    await vi.advanceTimersByTimeAsync(1_000);
    mode = "ok";
    const before = refreshTables.mock.calls.length;
    await runtime.replayer.run();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(refreshTables.mock.calls.length).toBe(before + 1); // one attempt per run, never a pile
    await runtime.replayer.run();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refreshTables.mock.calls.length).toBe(before + 1);
  });
});
