import type { Outbox } from "./outbox";

// The replay lease of one tab (M20 follow-up). One device replays its outbox from ONE page at a time, or two pages would send the same
// op twice. Where the browser has Web Locks the lease is a lock: the browser frees it the moment the document is destroyed, however the
// page died, so a page that is navigated away mid-run never makes the next page wait. (The IndexedDB record cannot do that: its release
// is a write, and an unloading page's writes are aborted; it only runs out after SYNC_LEASE_MS.) Without Web Locks the IndexedDB lease
// of the outbox is used as before.

const LOCK_NAME = "osteria-sync-replay";

/** The part of `navigator.locks` used here. */
export interface LockApi {
  request(
    name: string,
    options: { ifAvailable: true },
    callback: (lock: object | null) => Promise<void>,
  ): Promise<unknown>;
}

export interface Lease {
  /** Takes the lease, or renews it when this tab holds it. False: another page holds it. */
  acquire(holder: string, now: number, ms: number): Promise<boolean>;
  release(holder: string): Promise<void>;
}

export function createLease(
  outbox: Pick<Outbox, "acquireLease" | "releaseLease">,
  locks: LockApi | null | undefined,
): Lease {
  if (!locks) {
    return {
      acquire: (holder, now, ms) => outbox.acquireLease(holder, now, ms),
      release: (holder) => outbox.releaseLease(holder),
    };
  }
  let letGo: (() => void) | null = null;
  let taking: Promise<boolean> | null = null;
  return {
    async acquire() {
      if (letGo) return true; // this tab holds it: nothing to renew, the browser keeps it
      taking ??= new Promise<boolean>((resolve) => {
        locks
          .request(LOCK_NAME, { ifAvailable: true }, (lock) => {
            if (!lock) {
              resolve(false);
              return Promise.resolve();
            }
            return new Promise<void>((done) => {
              letGo = done;
              resolve(true);
            });
          })
          .catch(() => resolve(false));
      }).finally(() => {
        taking = null;
      });
      return taking;
    },
    async release() {
      const done = letGo;
      letGo = null;
      done?.();
    },
  };
}
