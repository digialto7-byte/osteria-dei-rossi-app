// The service worker may cache exactly four waiter reads (M20 plan §3.5, §3.6.3; ADR-022). A read is cached only if its path is on the
// worker's allowlist AND its 200 response carries this header, which only those four route files may set (the lint test
// tests/lint/offline-cache-allowlist.test.ts scans for importers). All four outputs are strict, cost-free schemas.

export const OFFLINE_CACHE_HEADER = "x-offline-cache";

/** The worker's allowlist, as route patterns (`:id` is a uuid). public/sw.js repeats it; tests/pwa/sw-source.test.ts keeps them equal. */
export const OFFLINE_CACHE_PATHS = [
  "/api/me",
  "/api/menu",
  "/api/tables",
  "/api/table-sessions/:id/lines",
] as const;

/**
 * The roles the offline design covers (M20 plan §3.5, ADR-022): owner, admin and waiter. The chef writes nothing offline, so the
 * worker must never store his reads. The server enforces it (offlineCacheable); src/pwa canSync keeps its own copy, pinned equal by tests/lint/offline-cache-allowlist.test.ts.
 */
export const OFFLINE_CACHE_ROLES = ["owner", "admin", "waiter"] as const;

/**
 * Marks a successful response as cacheable by the service worker, only when the caller's role is one the offline design covers.
 * Any other role (the chef, an unknown or missing one) gets the response unchanged, so the worker stores nothing. Call it on a 200 only.
 */
export function offlineCacheable(response: Response, role: string | undefined): Response {
  if ((OFFLINE_CACHE_ROLES as readonly string[]).includes(role ?? "")) {
    response.headers.set(OFFLINE_CACHE_HEADER, "1");
  }
  return response;
}
