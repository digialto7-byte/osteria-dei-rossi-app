import { describe, expect, it, vi } from "vitest";
import { createLease, type LockApi } from "@/pwa/lease";

// The replay lease on Web Locks (src/pwa/lease.ts): exclusive per origin, renewed for free by its holder, freed by release.
function fakeLocks() {
  let taken = false;
  const api: LockApi = {
    async request(_name, _options, callback) {
      if (taken) return callback(null);
      taken = true;
      try {
        await callback({});
      } finally {
        taken = false;
      }
    },
  };
  return api;
}
const outbox = () => ({
  acquireLease: vi.fn(async () => true),
  releaseLease: vi.fn(async () => undefined),
});

describe("lease on Web Locks", () => {
  it("is exclusive across holders of one lock manager, and release hands it over", async () => {
    const locks = fakeLocks();
    const a = createLease(outbox(), locks);
    const b = createLease(outbox(), locks);
    expect(await a.acquire("a", 0, 1)).toBe(true);
    expect(await a.acquire("a", 1, 1)).toBe(true); // renewing is free
    expect(await b.acquire("b", 0, 1)).toBe(false);
    await a.release("a");
    await Promise.resolve();
    expect(await b.acquire("b", 0, 1)).toBe(true);
  });

  it("a failing lock manager means refused, not thrown", async () => {
    const lease = createLease(outbox(), {
      request: () => Promise.reject(new Error("SecurityError")),
    });
    expect(await lease.acquire("a", 0, 1)).toBe(false);
  });

  it("without Web Locks it is the outbox's IndexedDB lease", async () => {
    const box = outbox();
    const lease = createLease(box, null);
    await lease.acquire("a", 5, 7);
    await lease.release("a");
    expect(box.acquireLease).toHaveBeenCalledWith("a", 5, 7);
    expect(box.releaseLease).toHaveBeenCalledWith("a");
  });
});
