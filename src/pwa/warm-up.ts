import { clearSettled } from "./register";
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
  /**
   * Was this document served by the worker (so its own reads were stored as they went)? Asked once, at start. Without it the answer is
   * "a controller exists now", which is wrong when control arrived between the document's first reads and this call.
   */
  controlledAtLoad?: () => boolean;
  /** Resolves when a cache clear the page started itself (no controller then) is done: a warm-up must not be undone by it. */
  settled?: () => Promise<unknown>;
}

/** What `startWarmUp` returns: call it to stop; `retry()` asks again if a control change was skipped (the role was not known yet). */
export type WarmHandle = (() => void) & { retry: () => void };

/**
 * Warms the worker's copy once per control change of a page that started without a controller, by MESSAGING the worker (`warm-reads`):
 * the worker fetches the reads itself, so the page makes no request of its own when control switches. Returns a function that stops
 * listening. A page that is controlled from the start has nothing to do: its own reads already went through the worker.
 */
export function startWarmUp(deps: WarmDeps): WarmHandle {
  const sw = deps.nav.serviceWorker;
  if (!sw) return Object.assign(() => undefined, { retry: () => undefined });
  const startedControlled = deps.controlledAtLoad ? deps.controlledAtLoad() : !!sw.controller;
  const memory = deps.memory ?? { last: startedControlled ? (sw.controller ?? null) : null };
  if (deps.memory && startedControlled && sw.controller && !memory.last)
    memory.last = sw.controller;
  const startedUncontrolled = !startedControlled;
  let stopped = false;

  // The control whose send is waiting for a clear to finish: the event and `ready` for it must not both send.
  let deferred: object | null = null;

  /** Posts the ask and only then marks this control as asked: a skipped send leaves it open for a later retry(). */
  function send(controller: WarmController) {
    const { pathname, search } = deps.location();
    try {
      controller.postMessage({ type: "warm-reads", urls: warmUrls(pathname, search) });
      memory.last = controller;
    } catch {
      // the worker went away; the next control change asks again
    }
  }

  function warm() {
    if (!deps.canWarm()) return;
    const controller = sw?.controller;
    if (!controller || controller === deferred) return;
    if (!deps.settled) return send(controller);
    deferred = controller;
    void deps.settled().then(() => {
      if (deferred === controller) deferred = null;
      const current = sw.controller;
      if (!stopped && current && deps.canWarm()) send(current);
    });
  }

  /** Control (or the role) may have come while nobody could act on it: ask once for a control that was never asked about. */
  function retry() {
    if (
      !stopped &&
      startedUncontrolled &&
      sw?.controller &&
      sw.controller !== memory.last &&
      sw.controller !== deferred
    )
      warm();
  }

  const onChange = () => {
    if (!stopped) warm();
  };
  sw.addEventListener("controllerchange", onChange);
  if (startedUncontrolled) {
    // Control may have arrived before this listener existed: when the worker is ready and controls the page, ask once.
    void sw.ready?.then(retry);
  }
  const stop = () => {
    stopped = true;
    sw.removeEventListener("controllerchange", onChange);
  };
  return Object.assign(stop, { retry });
}

/** True when the document itself came through the worker (navigation timing's workerStart); without the entry, a controller now. */
function documentWasControlled(): boolean {
  const entry = performance.getEntriesByType("navigation")[0] as
    PerformanceNavigationTiming | undefined;
  if (entry) return entry.workerStart > 0;
  // No navigation entry (an old browser, or a test): the old heuristic, a controller at this moment. It is wrong when control arrived
  // between the document's first reads and now, but it is all there is to go on without the entry.
  return !!navigator.serviceWorker.controller;
}

let stopBrowserWarmUp: WarmHandle | null = null;
const browserMemory: { last: object | null } = { last: null };

/**
 * Starts the warm-up for this page once. `canWarm` is asked at every warm-up, so a tab whose person changes (a PIN login as chef, a
 * sign-out) is never warmed for the new person's role.
 */
export function warmUpOnce(canWarm: () => boolean): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  if (stopBrowserWarmUp) {
    // Already listening: the shell calls this every time the role is (re)known, so a control change that came first is not lost.
    stopBrowserWarmUp.retry();
    return;
  }
  stopBrowserWarmUp = startWarmUp({
    nav: navigator as unknown as WarmDeps["nav"],
    canWarm,
    memory: browserMemory,
    controlledAtLoad: documentWasControlled,
    settled: clearSettled,
    location: () => ({ pathname: window.location.pathname, search: window.location.search }),
  });
}

/** Stops listening (sign-out, or the person is now one whose screens are not stored). `warmUpOnce` can start it again. */
export function stopWarmUp(): void {
  stopBrowserWarmUp?.();
  stopBrowserWarmUp = null;
}
