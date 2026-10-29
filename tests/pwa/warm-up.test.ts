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
  controller: object | null;
  ready: Promise<unknown>;
  private handlers = new Set<() => void>();
  constructor(controlled: boolean, ready: Promise<unknown> = new Promise(() => undefined)) {
    this.controller = controlled ? {} : null;
    this.ready = ready;
  }
  addEventListener(type: string, fn: () => void) {
    if (type === "controllerchange") this.handlers.add(fn);
  }
  removeEventListener(type: string, fn: () => void) {
    if (type === "controllerchange") this.handlers.delete(fn);
  }
  takeControl() {
    this.controller = {};
    for (const handler of [...this.handlers]) handler();
  }
  listeners = () => this.handlers.size;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const setup = (
  sw: FakeServiceWorker | undefined,
  search = "",
  canWarm: () => boolean = () => true,
) => {
  const fetchImpl = vi.fn(async () => new Response("{}"));
  const stop = startWarmUp({
    nav: { serviceWorker: sw },
    canWarm,
    fetchImpl,
    location: () => ({ pathname: "/tavoli", search }),
  });
  return { fetchImpl, stop };
};
const paths = (fetchImpl: ReturnType<typeof vi.fn>) =>
  fetchImpl.mock.calls.map((call) => String(call[0]));

describe("startWarmUp", () => {
  it("fetches the reads once when the worker takes control of a page that started uncontrolled", async () => {
    const sw = new FakeServiceWorker(false);
    const { fetchImpl } = setup(sw);
    await flush();
    expect(fetchImpl).not.toHaveBeenCalled();
    sw.takeControl();
    await flush();
    expect(paths(fetchImpl)).toEqual(["/api/me", "/api/menu", "/api/tables"]);
  });

  it("fetches again on a later control change (a new worker version), once per change", async () => {
    const sw = new FakeServiceWorker(false);
    const { fetchImpl } = setup(sw);
    sw.takeControl();
    await flush();
    sw.takeControl();
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it("a page that is already controlled when it starts needs nothing: its own reads already went through the worker", async () => {
    const sw = new FakeServiceWorker(true, Promise.resolve({}));
    const { fetchImpl } = setup(sw);
    await flush();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("when the worker became ready and took control before the listener heard it, ready triggers it once", async () => {
    let resolveReady!: () => void;
    const sw = new FakeServiceWorker(
      false,
      new Promise<void>((resolve) => {
        resolveReady = resolve;
      }),
    );
    const { fetchImpl } = setup(sw);
    sw.controller = {}; // control arrived with no event for this listener
    resolveReady();
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    sw.takeControl(); // the event after the ready path: that is a second control change
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it("ready and the event for the same control do not double up", async () => {
    let resolveReady!: () => void;
    const sw = new FakeServiceWorker(
      false,
      new Promise<void>((resolve) => {
        resolveReady = resolve;
      }),
    );
    const { fetchImpl } = setup(sw);
    sw.takeControl();
    resolveReady();
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("on a comanda it reads that session's lines too", async () => {
    const sw = new FakeServiceWorker(false);
    const fetchImpl = vi.fn(async () => new Response("{}"));
    startWarmUp({
      nav: { serviceWorker: sw },
      canWarm: () => true,
      fetchImpl,
      location: () => ({ pathname: "/tavoli/comanda", search: `?s=${SESSION}` }),
    });
    sw.takeControl();
    await flush();
    expect(paths(fetchImpl)).toContain(`/api/table-sessions/${SESSION}/lines`);
  });

  it("a failing read does not stop the others, and nothing is thrown", async () => {
    const sw = new FakeServiceWorker(false);
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === "/api/menu") throw new TypeError("offline");
      return new Response("{}");
    });
    startWarmUp({
      nav: { serviceWorker: sw },
      canWarm: () => true,
      fetchImpl,
      location: () => ({ pathname: "/tavoli", search: "" }),
    });
    sw.takeControl();
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("asks again at every control change whether the person now signed in may be warmed for (a chef never is)", async () => {
    const sw = new FakeServiceWorker(false);
    let allowed = true; // a waiter's tab
    const { fetchImpl } = setup(sw, "", () => allowed);
    sw.takeControl();
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    allowed = false; // PIN login as chef in the same tab, then a new worker claims it
    sw.takeControl();
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("the ready path asks too", async () => {
    let resolveReady!: () => void;
    const sw = new FakeServiceWorker(
      false,
      new Promise<void>((resolve) => {
        resolveReady = resolve;
      }),
    );
    const { fetchImpl } = setup(sw, "", () => false);
    sw.controller = {};
    resolveReady();
    await flush();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does nothing without service worker support, and stop() removes the listener", async () => {
    expect(() => setup(undefined).stop()).not.toThrow();
    const sw = new FakeServiceWorker(false);
    const { fetchImpl, stop } = setup(sw);
    stop();
    expect(sw.listeners()).toBe(0);
    sw.takeControl();
    await flush();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reads with the cookie and as JSON, never with a body or a write method", async () => {
    const sw = new FakeServiceWorker(false);
    const { fetchImpl } = setup(sw);
    sw.takeControl();
    await flush();
    for (const call of fetchImpl.mock.calls) {
      const init = (call as unknown[])[1] as RequestInit;
      expect(init.method ?? "GET").toBe("GET");
      expect(init.body).toBeUndefined();
      expect(init.credentials).toBe("same-origin");
    }
  });
});
