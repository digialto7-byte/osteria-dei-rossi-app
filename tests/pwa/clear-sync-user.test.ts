// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Outbox } from "@/pwa/outbox";
import { DEMO } from "../helpers/sync-data";

// Logout while the runtime is still opening must still clear the user the phone remembers (M20 review round 2).
const gate = vi.hoisted(() => ({ release: () => {}, box: null as unknown as Outbox }));
vi.mock("@/pwa/outbox", async (original) => {
  const real = await original<typeof import("@/pwa/outbox")>();
  return {
    ...real,
    openOutbox: async () => {
      await new Promise<void>((resolve) => {
        gate.release = resolve;
      });
      return gate.box;
    },
  };
});

afterEach(() => {
  gate.box.close();
  vi.resetModules();
});

describe("clearSyncUser", () => {
  it("clears the remembered user even when the runtime is still starting", async () => {
    const real = await vi.importActual<typeof import("@/pwa/outbox")>("@/pwa/outbox");
    gate.box = await real.openOutbox({ idb: null });
    await gate.box.setLastUser({ ...DEMO, role: "waiter" });
    const { clearSyncUser, getSyncRuntime } = await import("@/pwa/use-outbox");
    const starting = getSyncRuntime(); // the outbox is still opening
    const clearing = clearSyncUser(); // logout happens now
    await vi.waitFor(() => expect(gate.release).not.toBeUndefined());
    gate.release();
    await starting;
    await clearing;
    expect(await gate.box.getLastUser()).toBeNull();
  });

  it("opens the runtime and clears the user when nothing had started it", async () => {
    const real = await vi.importActual<typeof import("@/pwa/outbox")>("@/pwa/outbox");
    gate.box = await real.openOutbox({ idb: null });
    await gate.box.setLastUser({ ...DEMO, role: "waiter" });
    const { clearSyncUser } = await import("@/pwa/use-outbox");
    const clearing = clearSyncUser();
    await vi.waitFor(() => gate.release());
    await clearing;
    expect(await gate.box.getLastUser()).toBeNull();
  });
});
