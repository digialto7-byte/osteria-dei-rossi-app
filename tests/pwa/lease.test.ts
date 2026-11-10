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

// Like the real API: with `ifAvailable` a taken lock answers null at once; without it the request WAITS until the lock is free.
function realisticLocks() {
  let held: Promise<void> | null = null;
  const api: LockApi = {
    async request(_name, options, callback) {
      const ifAvailable = (options as { ifAvailable?: boolean }).ifAvailable === true;
      if (held && ifAvailable) return callback(null);
      while (held) await held;
      let free!: () => void;
      held = new Promise<void>((resolve) => {
        free = resolve;
      });
      try {
        await callback({});
      } finally {
        held = null;
        free();
      }
    },
  };
  return api;
}
const PENDING = Symbol("pending");
async function settledSoon<T>(p: Promise<T>): Promise<T | typeof PENDING> {
  return Promise.race([p, new Promise<typeof PENDING>((r) => setTimeout(() => r(PENDING), 20))]);
}

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

  // Lead's condition (no deadlock): the request is ifAvailable, so a page asking while another holds the lock is told "busy" at once
  // and the runner retries; it never waits for the other page's whole run.
  it("a second page asking while the lock is held is refused at once, never left waiting", async () => {
    const locks = realisticLocks();
    const a = createLease(outbox(), locks);
    const b = createLease(outbox(), locks);
    expect(await a.acquire("a", 0, 1)).toBe(true);
    expect(await settledSoon(b.acquire("b", 0, 1))).toBe(false);
    await a.release("a");
  });

  // Review of fix/service-sim-replay-race: release must forget that this page holds the lock, or a run still in flight would "renew"
  // a lock another page has since taken and the two pages would send at the same time.
  it("after a release, a renewal by the old holder is refused while another page holds the lock", async () => {
    const locks = realisticLocks();
    const a = createLease(outbox(), locks);
    const b = createLease(outbox(), locks);
    expect(await a.acquire("a", 0, 1)).toBe(true);
    await a.release("a");
    await new Promise((r) => setTimeout(r, 0));
    expect(await b.acquire("b", 0, 1)).toBe(true);
    expect(await settledSoon(a.acquire("a", 1, 1))).toBe(false);
    await b.release("b");
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
