import { forgetUser } from "@/components/forget-user";
import { apiJson, type ApiResult } from "@/lib/api/client";
import { safeNextPath } from "@/lib/api/safe-next";

/**
 * Changing venue (SP2, docs/plans/2026-11-14-sp2-memberships.md §3.5). The UI never re-implements this; it calls `switchTenant`.
 *
 * 1. Offline: refuse, nothing else happens.
 * 2. `forgetUser()`: the worker deletes the read cache, the cached user and the queue user are forgotten. The outbox is NOT touched: operations
 *    queued in the old venue carry that venue's user id, so the runner holds them in the new one and the server would refuse them
 *    (`user_mismatch`); they leave when the person is back in the old venue.
 * 3. `POST /api/me/tenant`.
 * 4. 200, or an answer where the server may have switched (no answer, 5xx, a success that is not JSON): `forgetUser()` again (a read begun between
 *    steps 2 and 3 still carried the old cookie), tell the other tabs, then a full load. After a 200 it goes to the safe `next` path, otherwise to `/`.
 * 5. 400, 401, 403, 404, 429 and any other answer: nothing changed on the server; the server's code is returned unchanged and the cleared cache refills on the next read.
 */
export const TENANT_SWITCH_CHANNEL = "tenant-switch";

/** What the other tabs hear on the channel; `from` is the sender's tab id, so a tab never reloads itself. */
export interface SwitchedMessage {
  type: "switched";
  from: string;
}

export type SwitchResult = { ok: true } | { ok: false; code: string };

export interface SwitchDeps {
  isOnline(): boolean;
  forget(): void;
  post(tenantId: string): Promise<ApiResult<unknown>>;
  /** Tells the other tabs of this browser that the venue changed. */
  announce(): void;
  /** A full document load of `path`. */
  load(path: string): void;
}

let cachedTabId: string | null = null;
/** An id for this tab, made once. */
export function tabId(): string {
  cachedTabId ??= crypto.randomUUID();
  return cachedTabId;
}

const defaultDeps: SwitchDeps = {
  isOnline: () => navigator.onLine !== false,
  forget: () => forgetUser(),
  post: (tenantId) => apiJson("/api/me/tenant", { method: "POST", body: { tenantId } }),
  announce: () => {
    // A browser without BroadcastChannel cannot tell its other tabs (the plan's residual risk R5).
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(TENANT_SWITCH_CHANNEL);
    const message: SwitchedMessage = { type: "switched", from: tabId() };
    channel.postMessage(message);
    channel.close();
  },
  load: (path) => window.location.assign(path),
};

/** True when the server may have switched although the person got no clean answer. */
function mayHaveSwitched(result: ApiResult<unknown>): boolean {
  if (result.ok) return false;
  return result.status === 0 || result.status >= 500 || result.status < 300;
}

export async function switchTenant(
  tenantId: string,
  { next }: { next?: string | null },
  deps: SwitchDeps = defaultDeps,
): Promise<SwitchResult> {
  if (!deps.isOnline()) return { ok: false, code: "offline" };

  deps.forget();
  const result = await deps.post(tenantId);

  if (result.ok) {
    deps.forget();
    deps.announce();
    deps.load(safeNextPath(next));
    return { ok: true };
  }
  if (mayHaveSwitched(result)) {
    deps.forget();
    deps.announce();
    deps.load("/");
    return { ok: false, code: "tenant_switch_failed" };
  }
  // The server's own code, unchanged: invalid_request, forbidden, tenant_not_found, tenant_switch_too_soon, unauthenticated, invalid_origin, ...
  return { ok: false, code: result.error.code };
}
