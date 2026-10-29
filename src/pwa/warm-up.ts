import { COMANDA_PATH, comandaSessionId } from "@/lib/tables/comanda-url";

// Storing the reads (M20 follow-up). The worker stores a read only if it passes through the worker, and a page that loads before the worker
// controls it (the first visit after login, a hard reload) makes its reads straight to the network. So once the worker takes control of such
// a page, the cost-free reads on the worker's allowlist are fetched again, through the worker: /api/me, the menu, the tables and the
// lines of the comanda on screen. Without it, a phone whose Wi-Fi drops before its next navigation cannot open the comanda.
// Pure and injectable: the navigator, fetch and the location are passed in. Only the allowlist's paths are ever built.

const LINES = "/api/table-sessions/:id/lines";
// A subset of the worker's allowlist (OFFLINE_CACHE_PATHS), written out here on purpose: only the four route files may import
// src/lib/api/offline-cache.ts (tests/lint/offline-cache-allowlist.test.ts). tests/pwa/warm-up.test.ts checks every URL against it.
const FIXED_READS = ["/api/me", "/api/menu", "/api/tables"];

/** The reads to store for the page at `pathname` + `search`, always from the worker's allowlist. */
export function warmUrls(pathname: string, search: string): string[] {
  const urls: string[] = [...FIXED_READS];
  if (pathname === COMANDA_PATH) {
    const id = comandaSessionId(new URLSearchParams(search));
    if (id) urls.push(LINES.replace(":id", id));
  }
  return urls;
}

interface WarmServiceWorker {
  controller?: object | null;
  ready?: Promise<unknown>;
  addEventListener(type: "controllerchange", listener: () => void): void;
  removeEventListener(type: "controllerchange", listener: () => void): void;
}

export interface WarmDeps {
  nav: { serviceWorker?: WarmServiceWorker };
  fetchImpl: (url: string, init: RequestInit) => Promise<unknown>;
  location: () => { pathname: string; search: string };
}

/**
 * Warms the worker's copy once per control change of a page that started without a controller. Returns a function that stops listening.
 * A page that is controlled from the start has nothing to do: its own reads already went through the worker.
 */
export function startWarmUp(deps: WarmDeps): () => void {
  const sw = deps.nav.serviceWorker;
  if (!sw) return () => undefined;
  const startedUncontrolled = !sw.controller;
  let lastWarmed: object | null = sw.controller ?? null;
  let stopped = false;

  async function warm() {
    const { pathname, search } = deps.location();
    lastWarmed = sw?.controller ?? null;
    await Promise.all(
      warmUrls(pathname, search).map(async (url) => {
        try {
          await deps.fetchImpl(url, {
            method: "GET",
            credentials: "same-origin",
            headers: { accept: "application/json" },
          });
        } catch {
          // offline right now: it is stored the next time it is read through the worker
        }
      }),
    );
  }

  const onChange = () => {
    if (!stopped) void warm();
  };
  sw.addEventListener("controllerchange", onChange);
  if (startedUncontrolled) {
    // Control may have arrived before this listener existed: when the worker is ready and controls the page, warm once.
    void sw.ready?.then(() => {
      if (!stopped && sw.controller && sw.controller !== lastWarmed) void warm();
    });
  }
  return () => {
    stopped = true;
    sw.removeEventListener("controllerchange", onChange);
  };
}

let stopBrowserWarmUp: (() => void) | null = null;

/** Starts the warm-up for this page once (the app shell calls it for owner, admin and waiter, never the chef). */
export function warmUpOnce(): void {
  if (stopBrowserWarmUp || typeof navigator === "undefined" || !("serviceWorker" in navigator))
    return;
  stopBrowserWarmUp = startWarmUp({
    nav: navigator as unknown as WarmDeps["nav"],
    fetchImpl: (url, init) => fetch(url, init),
    location: () => ({ pathname: window.location.pathname, search: window.location.search }),
  });
}
