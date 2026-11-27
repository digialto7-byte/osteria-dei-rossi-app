// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useTenantSwitchListener } from "@/components/use-tenant-switch-listener";
import { TENANT_SWITCH_CHANNEL } from "@/lib/tenancy/switch";

// SP2 S8 (docs/plans/2026-11-26-sp02-memberships.md §3.5, "Other tabs"): a tab that hears `switched` from another tab does a full load of /.
function fakeChannel() {
  const channel = {
    name: "",
    onmessage: null as ((event: { data: unknown }) => void) | null,
    close: vi.fn(),
    hear(data: unknown) {
      channel.onmessage?.({ data });
    },
  };
  const open = vi.fn((name: string) => {
    channel.name = name;
    return channel;
  });
  return { channel, open };
}

describe("useTenantSwitchListener", () => {
  it("listens on the tenant-switch channel", () => {
    const { open } = fakeChannel();
    renderHook(() => useTenantSwitchListener({ open, load: vi.fn(), selfId: () => "tab-a" }));
    expect(open).toHaveBeenCalledExactlyOnceWith(TENANT_SWITCH_CHANNEL);
    expect(TENANT_SWITCH_CHANNEL).toBe("tenant-switch");
  });

  it("a switched message from another tab causes one full load of /", () => {
    const { channel, open } = fakeChannel();
    const load = vi.fn();
    renderHook(() => useTenantSwitchListener({ open, load, selfId: () => "tab-a" }));
    channel.hear({ type: "switched", from: "tab-b" });
    expect(load).toHaveBeenCalledExactlyOnceWith("/");
  });

  it("the tab that switched does not reload itself: its own message is ignored (it loads its own next path)", () => {
    const { channel, open } = fakeChannel();
    const load = vi.fn();
    renderHook(() => useTenantSwitchListener({ open, load, selfId: () => "tab-a" }));
    channel.hear({ type: "switched", from: "tab-a" });
    expect(load).not.toHaveBeenCalled();
  });

  it.each([{ type: "other", from: "tab-b" }, { type: "switched" }, "switched", null])(
    "a message that is not a switched message with a sender (%j) is ignored",
    (data) => {
      const { channel, open } = fakeChannel();
      const load = vi.fn();
      renderHook(() => useTenantSwitchListener({ open, load, selfId: () => "tab-a" }));
      channel.hear(data);
      expect(load).not.toHaveBeenCalled();
    },
  );

  it("unmount closes the channel and stops listening", () => {
    const { channel, open } = fakeChannel();
    const load = vi.fn();
    const view = renderHook(() => useTenantSwitchListener({ open, load, selfId: () => "tab-a" }));
    view.unmount();
    expect(channel.close).toHaveBeenCalledTimes(1);
    expect(channel.onmessage).toBeNull();
  });

  it("does nothing in a browser without BroadcastChannel (the residual risk R5)", () => {
    const load = vi.fn();
    expect(() =>
      renderHook(() => useTenantSwitchListener({ open: null, load, selfId: () => "tab-a" })),
    ).not.toThrow();
    expect(load).not.toHaveBeenCalled();
  });

  it("mounting with the real dependencies never asks for the tab id, so a page without crypto.randomUUID keeps its shell (review of PR 1)", () => {
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      const view = renderHook(() => useTenantSwitchListener());
      view.unmount();
    } finally {
      Object.defineProperty(crypto, "randomUUID", { value: original, configurable: true });
    }
  });

  it("asks for the tab id only when a message arrives", () => {
    const { channel, open } = fakeChannel();
    const selfId = vi.fn(() => "tab-a");
    renderHook(() => useTenantSwitchListener({ open, load: vi.fn(), selfId }));
    expect(selfId).not.toHaveBeenCalled();
    channel.onmessage?.({ data: { type: "switched", from: "tab-b" } });
    expect(selfId).toHaveBeenCalledTimes(1);
  });

  it("is mounted once, in the app shell (AppShell, not the view that tests render without it)", () => {
    const source = readFileSync(join(process.cwd(), "src/app/(owner)/app-shell.tsx"), "utf8");
    expect(source.match(/useTenantSwitchListener\(\)/g)).toHaveLength(1);
    const shell = /export function AppShell\(([\s\S]*?)\n}\n/.exec(source)?.[1] ?? "";
    expect(shell).toContain("useTenantSwitchListener()");
  });
});
