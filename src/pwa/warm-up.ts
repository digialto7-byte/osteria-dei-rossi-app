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

interface WarmController {
  postMessage(message: unknown): void;
}

interface WarmServiceWorker {
  controller?: WarmController | null;
  ready?: Promise<unknown>;
  addEventListener(type: "controllerchange", listener: () => void): void;
  removeEventListener(type: "controllerchange", listener: () => void): void;
}

export interface WarmDeps {
  nav: { serviceWorker?: WarmServiceWorker };
  /** Asked right before every warm-up: may the person signed in NOW have these reads stored? (Owner, admin and waiter; never the chef.) */
  canWarm: () => boolean;
  location: () => { pathname: string; search: string };
  /** The controller last asked, kept across stop and start so the same control is never warmed twice. */
  memory?: { last: object | null };
}

/**
 * Warms the worker's copy once per control change of a page that started without a controller, by MESSAGING the worker (`warm-reads`):
 * the worker fetches the reads itself, so the page makes no request of its own when control switches. Returns a function that stops
 * listening. A page that is controlled from the start has nothing to do: its own reads already went through the worker.
 */
export function startWarmUp(deps: WarmDeps): () => void {
  const sw = deps.nav.serviceWorker;
  if (!sw) return () => undefined;
  const memory = deps.memory ?? { last: sw.controller ?? null };
  if (deps.memory && sw.controller && !memory.last) memory.last = sw.controller;
  const startedUncontrolled = !sw.controller;
  let stopped = false;

  function warm() {
    if (!deps.canWarm()) return;
    const controller = sw?.controller;
    if (!controller) return;
    const { pathname, search } = deps.location();
    memory.last = controller;
    try {
      controller.postMessage({ type: "warm-reads", urls: warmUrls(pathname, search) });
    } catch {
      // the worker went away; the next control change asks again
    }
  }

  const onChange = () => {
    if (!stopped) warm();
  };
  sw.addEventListener("controllerchange", onChange);
  if (startedUncontrolled) {
    // Control may have arrived before this listener existed: when the worker is ready and controls the page, ask once.
    void sw.ready?.then(() => {
      if (!stopped && sw.controller && sw.controller !== memory.last) warm();
    });
  }
  return () => {
    stopped = true;
    sw.removeEventListener("controllerchange", onChange);
  };
}

let stopBrowserWarmUp: (() => void) | null = null;
const browserMemory: { last: object | null } = { last: null };

/**
 * Starts the warm-up for this page once. `canWarm` is asked at every warm-up, so a tab whose person changes (a PIN login as chef, a
 * sign-out) is never warmed for the new person's role.
 */
export function warmUpOnce(canWarm: () => boolean): void {
  if (stopBrowserWarmUp || typeof navigator === "undefined" || !("serviceWorker" in navigator))
    return;
  stopBrowserWarmUp = startWarmUp({
    nav: navigator as unknown as WarmDeps["nav"],
    canWarm,
    memory: browserMemory,
    location: () => ({ pathname: window.location.pathname, search: window.location.search }),
  });
}

/** Stops listening (sign-out, or the person is now one whose screens are not stored). `warmUpOnce` can start it again. */
export function stopWarmUp(): void {
  stopBrowserWarmUp?.();
  stopBrowserWarmUp = null;
}
