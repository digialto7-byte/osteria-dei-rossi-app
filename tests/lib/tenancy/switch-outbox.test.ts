// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiResult } from "@/lib/api/client";
import { switchTenant } from "@/lib/tenancy/switch";
import type { OpDraft } from "@/lib/sync/types";

// SP2 S8 (§3.5, "Outbox"): a switch never clears the outbox, so ops queued in the old venue stay held on the phone. Behavioural check: the real
// forgetUser and the real sync runtime run over fake-indexeddb, and every call on the outbox is recorded.
const DESTRUCTIVE = ["discard", "settle", "pruneDead", "discardIfUnsent", "pruneOutcomes"];
const calls = vi.hoisted(() => [] as string[]);

vi.mock("@/pwa/outbox", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/pwa/outbox")>();
  return {
    ...original,
    openOutbox: async (options?: Parameters<typeof original.openOutbox>[0]) => {
      const box = await original.openOutbox(options);
      return new Proxy(box, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver);
          if (typeof value !== "function") return value;
          return (...args: unknown[]) => {
            calls.push(String(prop));
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        },
      });
    },
  };
});

const TENANT = "22222222-2222-4222-8222-222222222222";
const WAITER = "a0000000-0000-4000-8000-000000000001";
const SESSION = "5e000000-0000-4000-8000-00000000000a";
const draft: OpDraft = {
  kind: "add_line",
  clientTs: "2026-11-02T19:30:00.000Z",
  userId: WAITER,
  payload: {
    sessionId: SESSION,
    lineId: "10000000-0000-4000-8000-000000000001",
    menuItemId: "3e000000-0000-4000-8000-000000000001",
  },
  scope: { sessionId: SESSION, lineId: "10000000-0000-4000-8000-000000000001" },
  label: { tableName: "Tavolo 1 (demo)", dishName: "Spezzatino con polenta (demo)" },
  queuedBy: { id: WAITER, displayName: "Cameriere Demo" },
};

afterEach(() => vi.unstubAllGlobals());

async function pendingAfterSwitch(result: ApiResult<unknown>) {
  const { getSyncRuntime } = await import("@/pwa/use-outbox");
  const { forgetUser } = await import("@/components/forget-user");
  const runtime = await getSyncRuntime();
  await runtime.outbox.enqueue(draft);
  const before = (await runtime.outbox.pending()).length;
  expect(before).toBeGreaterThanOrEqual(1);
  calls.length = 0;
  await switchTenant(
    TENANT,
    { next: "/" },
    {
      isOnline: () => true,
      forget: () => forgetUser(),
      post: async () => result,
      announce: () => undefined,
      load: () => undefined,
    },
  );
  // forgetUser clears the queue user asynchronously; give it time to finish before looking.
  await new Promise((resolve) => setTimeout(resolve, 100));
  return { before, after: (await runtime.outbox.pending()).length };
}

describe("a tenant switch leaves the outbox alone", () => {
  it("a successful switch: the queued op is still pending and no destructive outbox call was made", async () => {
    const pending = await pendingAfterSwitch({ ok: true, status: 200, data: {} });
    expect(calls.filter((c) => DESTRUCTIVE.includes(c))).toEqual([]);
    expect(pending.after).toBe(pending.before);
  });

  it("an uncertain switch (503): same", async () => {
    const pending = await pendingAfterSwitch({
      ok: false,
      status: 503,
      error: { code: "tenant_switch_failed", message: "x" },
    });
    expect(calls.filter((c) => DESTRUCTIVE.includes(c))).toEqual([]);
    expect(pending.after).toBe(pending.before);
  });
});
