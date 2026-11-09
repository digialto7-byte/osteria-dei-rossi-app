import { describe, expect, it, vi } from "vitest";
import { OFFLINE_CACHE_PATHS } from "@/lib/api/offline-cache";
import { startWarmUp, warmUrls } from "@/pwa/warm-up";

// M20 follow-up: the reads a page makes before the worker takes control are never stored. Once the worker controls the page, the
// cost-free reads on the worker's allowlist are fetched again (through the worker) so they are in its copy before the Wi-Fi drops.
const SESSION = "5e000000-0000-4000-8000-000000000001";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const allowed = OFFLINE_CACHE_PATHS.map((path) => new RegExp(`^${path.replace(":id", UUID)}$`));

describe("warmUrls", () => {
  it("is /api/me, /api/menu and /api/tables anywhere but a comanda", () => {
    expect(warmUrls("/tavoli", "")).toEqual(["/api/me", "/api/menu", "/api/tables"]);
    expect(warmUrls("/", "?s=" + SESSION)).toEqual(["/api/me", "/api/menu", "/api/tables"]);
  });

  it("adds the lines of the session on a comanda page", () => {
    expect(warmUrls("/tavoli/comanda", `?s=${SESSION}`)).toEqual([
      "/api/me",
      "/api/menu",
      "/api/tables",
      `/api/table-sessions/${SESSION}/lines`,
    ]);
  });

  it("a comanda with a missing, repeated or malformed session adds nothing", () => {
    for (const search of ["", "?s=nope", `?s=${SESSION}&s=${SESSION}`, "?x=1"]) {
      expect(warmUrls("/tavoli/comanda", search)).toEqual(["/api/me", "/api/menu", "/api/tables"]);
    }
  });

  it("every URL is on the worker's allowlist and none is a cost endpoint", () => {
    for (const url of warmUrls("/tavoli/comanda", `?s=${SESSION}`)) {
      expect(
        allowed.some((pattern) => pattern.test(url)),
        url,
      ).toBe(true);
      expect(url).not.toMatch(/cost|margin|recipe|invoice|batch|report/i);
    }
  });
});

class FakeServiceWorker {
  controller: { postMessage: (message: unknown) => void } | null;
  ready: Promise<unknown>;
  posted = vi.fn<(message: unknown) => void>();
  private handlers = new Set<() => void>();
  constructor(controlled: boolean, ready: Promise<unknown> = new Promise(() => undefined)) {
    this.controller = controlled ? { postMessage: this.posted } : null;
    this.ready = ready;
  }
  addEventListener(type: string, fn: () => void) {
    if (type === "controllerchange") this.handlers.add(fn);
  }
  removeEventListener(type: string, fn: () => void) {
    if (type === "controllerchange") this.handlers.delete(fn);
  }
  takeControl() {
    this.controller = { postMessage: this.posted };
    for (const handler of [...this.handlers]) handler();
  }
  listeners = () => this.handlers.size;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const BASE = ["/api/me", "/api/menu", "/api/tables"];
const setup = (
  sw: FakeServiceWorker | undefined,
  options: {
    search?: string;
    pathname?: string;
    canWarm?: () => boolean;
    memory?: { last: object | null };
    controlledAtLoad?: () => boolean;
    settled?: () => Promise<unknown>;
  } = {},
) => {
  const pageFetch = vi.fn();
  const stop = startWarmUp({
    nav: { serviceWorker: sw },
    canWarm: options.canWarm ?? (() => true),
    location: () => ({ pathname: options.pathname ?? "/tavoli", search: options.search ?? "" }),
    memory: options.memory,
    controlledAtLoad: options.controlledAtLoad,
    settled: options.settled,
  });
  return { pageFetch, stop };
};
/** The URL lists posted to the worker, one entry per message. */
const messages = (sw: FakeServiceWorker) =>
  sw.posted.mock.calls.map((call) => call[0] as { type: string; urls: string[] });

describe("startWarmUp", () => {
  it("asks the worker, once, when it takes control of a page that started uncontrolled - and makes no request itself", async () => {
    const sw = new FakeServiceWorker(false);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    setup(sw);
    await flush();
    expect(sw.posted).not.toHaveBeenCalled();
    sw.takeControl();
    await flush();
    expect(messages(sw)).toEqual([{ type: "warm-reads", urls: BASE }]);
    expect(fetchSpy).not.toHaveBeenCalled(); // the worker does the fetching: the page makes no request of its own
    fetchSpy.mockRestore();
  });

  it("asks again on a later control change (a new worker version), once per change", async () => {
    const sw = new FakeServiceWorker(false);
    setup(sw);
    sw.takeControl();
    await flush();
    sw.takeControl();
    await flush();
    expect(messages(sw)).toHaveLength(2);
  });

  it("stays quiet: no event, no message - not on load, not on a ready that adds nothing", async () => {
    const sw = new FakeServiceWorker(false, Promise.resolve({}));
    setup(sw);
    await flush();
    await flush();
    expect(sw.posted).not.toHaveBeenCalled();
  });

  it("a page that is already controlled when it starts needs nothing: its own reads already went through the worker", async () => {
    const sw = new FakeServiceWorker(true, Promise.resolve({}));
    setup(sw);
    await flush();
    expect(sw.posted).not.toHaveBeenCalled();
  });

  it("when control arrived before the listener heard it, ready triggers it once", async () => {
    let resolveReady!: () => void;
    const sw = new FakeServiceWorker(
      false,
      new Promise<void>((resolve) => {
        resolveReady = resolve;
      }),
    );
    setup(sw);
    sw.controller = { postMessage: sw.posted }; // control arrived with no event for this listener
    resolveReady();
    await flush();
    expect(messages(sw)).toHaveLength(1);
    sw.takeControl(); // a second control change is a second warm-up
    await flush();
    expect(messages(sw)).toHaveLength(2);
  });

  it("ready and the event for the same control do not double up", async () => {
    let resolveReady!: () => void;
    const sw = new FakeServiceWorker(
      false,
      new Promise<void>((resolve) => {
        resolveReady = resolve;
      }),
    );
    setup(sw);
    sw.takeControl();
    resolveReady();
    await flush();
    expect(messages(sw)).toHaveLength(1);
  });

  it("stopping and starting again (the shell does it when the person changes) does not warm the same control twice", async () => {
    let resolveReady!: () => void;
    const sw = new FakeServiceWorker(
      false,
      new Promise<void>((resolve) => {
        resolveReady = resolve;
      }),
    );
    const memory = { last: null as object | null };
    const first = setup(sw, { memory });
    sw.takeControl();
    await flush();
    first.stop();
    setup(sw, { memory }); // a new listener for a page that was uncontrolled when the shell first looked
    resolveReady();
    await flush();
    expect(messages(sw)).toHaveLength(1);
    expect(sw.listeners()).toBe(1);
  });

  it("many starts never leave more than the listeners that were not stopped", async () => {
    const sw = new FakeServiceWorker(false);
    const memory = { last: null as object | null };
    for (let i = 0; i < 5; i += 1) setup(sw, { memory }).stop();
    expect(sw.listeners()).toBe(0);
    sw.takeControl();
    await flush();
    expect(sw.posted).not.toHaveBeenCalled();
  });

  it("on a comanda it asks for that session's lines too", async () => {
    const sw = new FakeServiceWorker(false);
    setup(sw, { pathname: "/tavoli/comanda", search: `?s=${SESSION}` });
    sw.takeControl();
    await flush();
    expect(messages(sw)[0]!.urls).toEqual([...BASE, `/api/table-sessions/${SESSION}/lines`]);
  });

  it("asks at every control change whether the person now signed in may be warmed for (a chef never is)", async () => {
    const sw = new FakeServiceWorker(false);
    let allowed = true; // a waiter's tab
    setup(sw, { canWarm: () => allowed });
    sw.takeControl();
    await flush();
    expect(messages(sw)).toHaveLength(1);
    allowed = false; // PIN login as chef in the same tab, then a new worker claims it
    sw.takeControl();
    await flush();
    expect(messages(sw)).toHaveLength(1);
  });

  it("the ready path asks too", async () => {
    let resolveReady!: () => void;
    const sw = new FakeServiceWorker(
      false,
      new Promise<void>((resolve) => {
        resolveReady = resolve;
      }),
    );
    setup(sw, { canWarm: () => false });
    sw.controller = { postMessage: sw.posted };
    resolveReady();
    await flush();
    expect(sw.posted).not.toHaveBeenCalled();
  });

  it("does nothing without service worker support, and stop() removes the listener", async () => {
    expect(() => setup(undefined).stop()).not.toThrow();
    const sw = new FakeServiceWorker(false);
    const { stop } = setup(sw);
    stop();
    expect(sw.listeners()).toBe(0);
    sw.takeControl();
    await flush();
    expect(sw.posted).not.toHaveBeenCalled();
  });

  it("a worker that cannot be messaged (no controller at that instant) is not an error", async () => {
    const sw = new FakeServiceWorker(false);
    setup(sw);
    sw.controller = null;
    const handlers = (sw as unknown as { handlers: Set<() => void> }).handlers;
    expect(() => handlers.forEach((handler) => handler())).not.toThrow();
    await flush();
  });

  // Interleavings found chasing the intermittent CI failure (stored: [] with the page controlled and /api/* cacheable).
  describe("races", () => {
    it("the worker took control BEFORE the listener existed and ready has long resolved: a document that was not served by the worker is still warmed", async () => {
      // Page B loads while the worker is still installing; /api/me answers; the worker claims B; only then does the shell's effect run.
      const sw = new FakeServiceWorker(true, Promise.resolve({}));
      setup(sw, { controlledAtLoad: () => false });
      await flush();
      expect(messages(sw)).toEqual([{ type: "warm-reads", urls: BASE }]);
    });

    it("a document that WAS served by the worker is not warmed (its reads were stored as they went)", async () => {
      const sw = new FakeServiceWorker(true, Promise.resolve({}));
      setup(sw, { controlledAtLoad: () => true });
      await flush();
      expect(sw.posted).not.toHaveBeenCalled();
    });

    it("control arrives while the role is not known yet (canWarm false): retry() warms once the role is known, and only once", async () => {
      const sw = new FakeServiceWorker(false, Promise.resolve({}));
      let known = false;
      const { stop } = setup(sw, { canWarm: () => known });
      sw.takeControl(); // controllerchange with no role: skipped
      await flush();
      expect(sw.posted).not.toHaveBeenCalled();
      known = true;
      (stop as unknown as { retry: () => void }).retry();
      (stop as unknown as { retry: () => void }).retry();
      await flush();
      expect(messages(sw)).toHaveLength(1);
    });

    it("retry() before any control, or after stop(), does nothing", async () => {
      const sw = new FakeServiceWorker(false);
      const { stop } = setup(sw);
      (stop as unknown as { retry: () => void }).retry();
      sw.takeControl();
      await flush();
      expect(messages(sw)).toHaveLength(1);
      stop();
      sw.takeControl();
      (stop as unknown as { retry: () => void }).retry();
      await flush();
      expect(messages(sw)).toHaveLength(1);
    });

    it("waits for a clear the page started itself (no controller then) before asking the worker", async () => {
      const sw = new FakeServiceWorker(false);
      let finish!: () => void;
      const settled = new Promise<void>((resolve) => {
        finish = resolve;
      });
      setup(sw, { settled: () => settled });
      sw.takeControl();
      await flush();
      expect(sw.posted).not.toHaveBeenCalled();
      finish();
      await flush();
      expect(messages(sw)).toHaveLength(1);
    });
  });
});

describe("warmUpOnce: the shell calls it every time the role is known", () => {
  it("a control change that came while the role was unknown is warmed on the next call, not lost", async () => {
    vi.resetModules();
    const sw = new FakeServiceWorker(false, Promise.resolve({}));
    vi.stubGlobal("navigator", { serviceWorker: sw });
    vi.stubGlobal("window", { location: { pathname: "/tavoli", search: "" } });
    vi.stubGlobal("performance", { getEntriesByType: () => [{ workerStart: 0 }] });
    try {
      const { warmUpOnce, stopWarmUp } = await import("@/pwa/warm-up");
      let role: string | null = null;
      warmUpOnce(() => role !== null);
      sw.takeControl(); // controllerchange while the role is null (the shell re-ran with status loading)
      await flush();
      expect(sw.posted).not.toHaveBeenCalled();
      role = "waiter";
      warmUpOnce(() => role !== null); // the shell's effect, role known again
      await flush();
      expect(messages(sw)).toHaveLength(1);
      stopWarmUp();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
