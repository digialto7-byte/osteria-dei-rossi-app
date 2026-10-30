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

async function build() {
  const outbox = await openOutbox({ idb: null });
  boxes.push(outbox);
  const refreshTables = vi.fn();
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
