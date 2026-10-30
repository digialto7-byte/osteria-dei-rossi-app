// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MeState } from "@/components/use-me";

// The shell starts the warm-up for owner, admin and waiter, and never for the chef (Q117).
const calls = vi.hoisted(() => ({
  warm: vi.fn(),
  stop: vi.fn(),
  register: vi.fn(async () => "skipped"),
}));
vi.mock("@/pwa/warm-up", () => ({ warmUpOnce: calls.warm, stopWarmUp: calls.stop }));
vi.mock("@/pwa/register", () => ({ registerServiceWorker: calls.register }));

import { useSyncBoot } from "@/pwa/use-outbox";

const ok = (role: string): MeState =>
  ({
    status: "ok",
    me: {
      user: { id: "a0000000-0000-4000-8000-000000000001", displayName: "Cameriere Demo", role },
      tenant: { id: "b0000000-0000-4000-8000-000000000001", name: "Osteria Demo" },
    },
  }) as unknown as MeState;

describe("useSyncBoot and the warm-up", () => {
  it.each(["owner", "admin", "waiter"])("starts it for the %s", async (role) => {
    calls.warm.mockClear();
    renderHook(() => useSyncBoot(ok(role)));
    await waitFor(() => expect(calls.warm).toHaveBeenCalledTimes(1));
  });

  it("stops it when the same tab turns into a chef or is signed out, and the check it passes follows the current person", async () => {
    calls.warm.mockClear();
    calls.stop.mockClear();
    const hook = renderHook(({ state }) => useSyncBoot(state), {
      initialProps: { state: ok("waiter") },
    });
    await waitFor(() => expect(calls.warm).toHaveBeenCalledTimes(1));
    const canWarm = calls.warm.mock.calls[0]![0] as () => boolean;
    expect(canWarm()).toBe(true);
    hook.rerender({ state: ok("chef") });
    await waitFor(() => expect(calls.stop).toHaveBeenCalledTimes(1));
    expect(canWarm()).toBe(false);
    hook.rerender({ state: ok("waiter") });
    await waitFor(() => expect(calls.warm).toHaveBeenCalledTimes(2));
    expect(canWarm()).toBe(true);
    hook.rerender({ state: { status: "signedOut", me: null } });
    await waitFor(() => expect(calls.stop).toHaveBeenCalledTimes(2));
    expect(canWarm()).toBe(false);
  });

  it("never starts it for the chef, and not before anyone is signed in", async () => {
    calls.warm.mockClear();
    renderHook(() => useSyncBoot(ok("chef")));
    renderHook(() => useSyncBoot({ status: "loading", me: null }));
    renderHook(() => useSyncBoot({ status: "signedOut", me: null }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls.warm).not.toHaveBeenCalled();
  });
});
