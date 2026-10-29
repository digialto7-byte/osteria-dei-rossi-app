import { afterEach, describe, expect, it, vi } from "vitest";
import { openOutbox } from "@/pwa/outbox";
import { createSyncRuntime } from "@/pwa/runtime";
import { DEMO, SYNC_IDS } from "../helpers/sync-data";

// The runner starts only once the current user is known, and logging out clears that user (M20 review finding 8).
const runner = vi.hoisted(() => ({
  start: vi.fn(() => ({ trigger: vi.fn(), stop: vi.fn() })),
}));
vi.mock("@/pwa/sync-runner", async (original) => ({
  ...(await original<typeof import("@/pwa/sync-runner")>()),
  startSyncRunner: runner.start,
}));

const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  runner.start.mockClear();
});

async function open(remember: boolean) {
  const outbox = await openOutbox({ idb: null });
  if (remember) await outbox.setLastUser({ ...DEMO, role: "waiter" });
  const runtime = await createSyncRuntime({
    outbox,
    send: () => new Promise(() => undefined),
    now: () => 1_000,
    random: () => 0.5,
    newOpId: () => SYNC_IDS.item,
    holder: "t",
    env: { win: {} as never, doc: {} as never },
  });
  stops.push(() => {
    runtime.stop();
    outbox.close();
  });
  return { runtime, outbox };
}

describe("the runner and the current user", () => {
  it("does not start from the user remembered on the phone: it waits for setMe", async () => {
    const { runtime } = await open(true);
    expect(runner.start).not.toHaveBeenCalled();
    await runtime.setMe({ ...DEMO, role: "waiter" });
    expect(runner.start).toHaveBeenCalledTimes(1);
    await runtime.setMe({ ...DEMO, role: "waiter" });
    expect(runner.start).toHaveBeenCalledTimes(1);
  });

  it("a null setMe (a 401) does not start it either", async () => {
    const { runtime } = await open(true);
    await runtime.setMe(null);
    expect(runner.start).not.toHaveBeenCalled();
  });

  it("clearUser forgets the current and the remembered user, in memory and on the phone", async () => {
    const { runtime, outbox } = await open(true);
    await runtime.setMe({ ...DEMO, role: "waiter" });
    await runtime.clearUser();
    expect(await outbox.getLastUser()).toBeNull();
    await expect(
      runtime.queue.queueAdd({
        sessionId: SYNC_IDS.s1,
        tableName: "T",
        lineId: SYNC_IDS.item,
        item: { id: SYNC_IDS.item, name: "x" },
      }),
    ).rejects.toThrow(/Not signed in/);
  });
});
