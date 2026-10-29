import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeCaches, html, loadWorker, ORIGIN, redirectedTo, type Worker } from "./sw-harness";

// public/sw.js run in node:vm (M20 plan step 16). What it caches, what it never touches, and how it cleans up.
const SESSION = "5e000000-0000-4000-8000-000000000001";
const get = (path: string, init: RequestInit = {}) => new Request(`${ORIGIN}${path}`, init);
const navigate = (path: string) => {
  const request = get(path);
  Object.defineProperty(request, "mode", { value: "navigate" });
  return request;
};
const PAGE = (extra = "") => `<!doctype html><html><head>
  <script src="/_next/static/chunks/a.js"></script>
  <link rel="stylesheet" href="/_next/static/css/b.css">
  <script src="https://cdn.example.test/_next/static/chunks/evil.js"></script>
  <a href="/fatture">Fatture</a>
  </head><body>${extra}<script>self.__next_f.push(["/_next/static/chunks/in-json.js"])</script></body></html>`;

function installNetwork(worker: Worker, overrides: Record<string, () => Response> = {}) {
  worker.network.handler = async (request) => {
    const path = new URL(request.url).pathname;
    const custom = overrides[path];
    if (custom) return custom();
    if (["/", "/tavoli", "/tavoli/comanda"].includes(path)) return html(PAGE());
    if (path.startsWith("/_next/static/")) return new Response(`// ${path}`, { status: 200 });
    return new Response("not found", { status: 404 });
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("install", () => {
  it("precaches the three shell pages and the /_next/static/ files named in their HTML (src and href only)", async () => {
    const worker = loadWorker("v1");
    installNetwork(worker);
    await worker.install();
    expect(worker.caches.urls("shell-v1")).toEqual([
      `${ORIGIN}/`,
      `${ORIGIN}/tavoli`,
      `${ORIGIN}/tavoli/comanda`,
    ]);
    expect(worker.caches.urls("static-v1")).toEqual([
      `${ORIGIN}/_next/static/chunks/a.js`,
      `${ORIGIN}/_next/static/css/b.css`,
    ]);
  });

  it("fetches the pages with credentials and never a cross-origin URL", async () => {
    const worker = loadWorker("v1");
    installNetwork(worker);
    await worker.install();
    expect(worker.fetches.every((request) => request.url.startsWith(ORIGIN))).toBe(true);
    const pages = worker.fetches.filter((r) => !r.url.includes("/_next/"));
    expect(pages.every((request) => request.credentials === "include")).toBe(true);
  });

  it("skips a redirected response and one that ended on /login or /pin (a signed-out phone)", async () => {
    const worker = loadWorker("v1");
    installNetwork(worker, {
      "/": () => redirectedTo(html(PAGE()), `${ORIGIN}/login`),
      "/tavoli": () => html(PAGE(), { status: 200 }),
      "/tavoli/comanda": () => redirectedTo(html(PAGE()), `${ORIGIN}/pin`),
    });
    await worker.install();
    expect(worker.caches.urls("shell-v1")).toEqual([`${ORIGIN}/tavoli`]);
  });

  it("skips a page that is not 200 text/html", async () => {
    const worker = loadWorker("v1");
    installNetwork(worker, {
      "/": () => new Response("x", { status: 500, headers: { "content-type": "text/html" } }),
      "/tavoli": () =>
        new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    });
    await worker.install();
    expect(worker.caches.urls("shell-v1")).toEqual([`${ORIGIN}/tavoli/comanda`]);
  });

  it("installs even when the network is down (nothing is cached)", async () => {
    const worker = loadWorker("v1");
    await expect(worker.install()).resolves.toBeUndefined();
    expect(worker.caches.urls("shell-v1")).toEqual([]);
  });

  it("does not take over by itself: no skipping the waiting state, no claim at install", async () => {
    const worker = loadWorker("v1");
    installNetwork(worker);
    await worker.install();
    expect(worker.clientsClaim).not.toHaveBeenCalled();
  });
});

describe("fetch: static files", () => {
  it("/_next/static/ is cache-first: a hit costs no network", async () => {
    const worker = loadWorker("v1");
    installNetwork(worker);
    await worker.install();
    const before = worker.fetches.length;
    const result = await worker.fetch(get("/_next/static/chunks/a.js"));
    expect(result.handled).toBe(true);
    expect(await result.response!.text()).toBe("// /_next/static/chunks/a.js");
    expect(worker.fetches).toHaveLength(before);
  });

  it("a miss goes to the network and the 200 is stored; a failure is a network error", async () => {
    const worker = loadWorker("v1");
    installNetwork(worker);
    const first = await worker.fetch(get("/_next/static/chunks/new.js"));
    expect(first.response!.status).toBe(200);
    expect(worker.caches.urls("static-v1")).toEqual([`${ORIGIN}/_next/static/chunks/new.js`]);
    worker.network.handler = async () => {
      throw new TypeError("down");
    };
    const missing = await worker.fetch(get("/_next/static/chunks/other.js"));
    expect(missing.error).toBeInstanceOf(TypeError);
  });

  it("does not store a failed static fetch", async () => {
    const worker = loadWorker("v1");
    worker.network.handler = async () => new Response("no", { status: 404 });
    await worker.fetch(get("/_next/static/chunks/gone.js"));
    expect(worker.caches.urls("static-v1")).toEqual([]);
  });
});

describe("fetch: pages", () => {
  it("the comanda is network-first: online it is the live page (search ignored)", async () => {
    const worker = loadWorker("v1");
    installNetwork(worker, { "/tavoli/comanda": () => html(PAGE("<p>live</p>")) });
    await worker.install();
    const result = await worker.fetch(navigate(`/tavoli/comanda?s=${SESSION}`));
    expect(await result.response!.text()).toContain("live");
  });

  it("offline, the comanda of any session is the cached /tavoli/comanda", async () => {
    const worker = loadWorker("v1");
    installNetwork(worker);
    await worker.install();
    worker.network.handler = async () => {
      throw new TypeError("down");
    };
    const result = await worker.fetch(navigate(`/tavoli/comanda?s=${SESSION}`));
    expect(result.response!.status).toBe(200);
    expect(await result.response!.text()).toContain("Fatture");
  });

  it("a network that hangs falls back to the cache after 3 s", async () => {
    const worker = loadWorker("v1");
    installNetwork(worker);
    await worker.install();
    worker.network.handler = () => new Promise<Response>(() => undefined);
    const pending = worker.fetch(navigate("/tavoli"));
    await vi.advanceTimersByTimeAsync(2_999);
    let settled = false;
    void pending.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(result.response!.status).toBe(200);
  });

  it("a live page refreshes the cached copy; a redirect to /login does not replace it", async () => {
    const worker = loadWorker("v1");
    installNetwork(worker);
    await worker.install();
    worker.network.handler = async () => html(PAGE("<p>second</p>"));
    await worker.fetch(navigate("/tavoli"));
    worker.network.handler = async () => redirectedTo(html("<p>login</p>"), `${ORIGIN}/login`);
    await worker.fetch(navigate("/tavoli"));
    worker.network.handler = async () => {
      throw new TypeError("down");
    };
    const offline = await worker.fetch(navigate("/tavoli"));
    const text = await offline.response!.text();
    expect(text).toContain("second");
    expect(text).not.toContain("login");
  });

  it("another page offline gets the Italian offline page and nothing is cached for it", async () => {
    const worker = loadWorker("v1");
    installNetwork(worker);
    await worker.install();
    const shellBefore = worker.caches.urls("shell-v1");
    worker.network.handler = async () => {
      throw new TypeError("down");
    };
    const result = await worker.fetch(navigate("/fatture"));
    expect(result.handled).toBe(true);
    const text = await result.response!.text();
    expect(text).toContain("Sei offline. Questa pagina serve la connessione.");
    expect(text).toContain('<a href="/tavoli">Torna ai tavoli</a>');
    expect(text).not.toContain("<script");
    expect(result.response!.headers.get("content-type")).toContain("text/html");
    expect(worker.caches.urls("shell-v1")).toEqual(shellBefore);
  });

  it("another page online is the network's answer, untouched and not cached", async () => {
    const worker = loadWorker("v1");
    worker.network.handler = async () => html("<p>fatture</p>");
    const result = await worker.fetch(navigate("/fatture"));
    expect(await result.response!.text()).toContain("fatture");
    expect(worker.caches.urls("shell-v1")).toEqual([]);
  });

  it("a shell page that was never cached, offline, is the offline page", async () => {
    const worker = loadWorker("v1");
    const result = await worker.fetch(navigate("/tavoli"));
    expect(await result.response!.text()).toContain("Sei offline");
  });
});

describe("fetch: the four cost-free reads", () => {
  const cacheable = (body: object) => () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
        "x-offline-cache": "1",
      },
    });

  it("GET /api/menu with the header is stored; offline it is served with x-offline-cached-at", async () => {
    const worker = loadWorker("v1");
    vi.setSystemTime(new Date("2026-11-02T19:31:00.000Z"));
    worker.network.handler = async () => cacheable({ pinned: [], categories: [] })();
    const live = await worker.fetch(get("/api/menu"));
    expect(live.response!.headers.has("x-offline-cached-at")).toBe(false);
    expect(worker.caches.urls("api-user")).toEqual([`${ORIGIN}/api/menu`]);
    worker.network.handler = async () => {
      throw new TypeError("down");
    };
    const offline = await worker.fetch(get("/api/menu"));
    expect(await offline.response!.json()).toEqual({ pinned: [], categories: [] });
    expect(offline.response!.headers.get("x-offline-cached-at")).toBe("2026-11-02T19:31:00.000Z");
  });

  it.each(["/api/me", "/api/tables", `/api/table-sessions/${SESSION}/lines`])(
    "%s is cached the same way",
    async (path) => {
      const worker = loadWorker("v1");
      worker.network.handler = async () => cacheable({ ok: path })();
      await worker.fetch(get(path));
      worker.network.handler = async () => {
        throw new TypeError("down");
      };
      const offline = await worker.fetch(get(path));
      expect(await offline.response!.json()).toEqual({ ok: path });
    },
  );

  it("a 200 without x-offline-cache is not stored", async () => {
    const worker = loadWorker("v1");
    worker.network.handler = async () =>
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    await worker.fetch(get("/api/menu"));
    expect(worker.caches.urls("api-user")).toEqual([]);
  });

  it("an error status is not stored even with the header, and is passed through", async () => {
    const worker = loadWorker("v1");
    worker.network.handler = async () =>
      new Response("{}", { status: 403, headers: { "x-offline-cache": "1" } });
    const result = await worker.fetch(get("/api/menu"));
    expect(result.response!.status).toBe(403);
    expect(worker.caches.urls("api-user")).toEqual([]);
  });

  it("a hanging network falls back to the cached copy after 3 s", async () => {
    const worker = loadWorker("v1");
    worker.network.handler = async () => cacheable({ cached: true })();
    await worker.fetch(get("/api/tables"));
    worker.network.handler = () => new Promise<Response>(() => undefined);
    const pending = worker.fetch(get("/api/tables"));
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await (await pending).response!.json()).toEqual({ cached: true });
  });

  it("offline with nothing cached is a network error, not an invented answer", async () => {
    const worker = loadWorker("v1");
    const result = await worker.fetch(get("/api/menu"));
    expect(result.handled).toBe(true);
    expect(result.error).toBeInstanceOf(TypeError);
    expect((result.error as Error).message).toBe("network down");
  });

  it("a malformed session id is not on the allowlist", async () => {
    const worker = loadWorker("v1");
    worker.network.handler = async () => cacheable({})();
    expect((await worker.fetch(get("/api/table-sessions/x/lines"))).handled).toBe(false);
    expect((await worker.fetch(get(`/api/table-sessions/${SESSION}/lines/extra`))).handled).toBe(
      false,
    );
  });
});

describe("fetch: what it never touches", () => {
  it("GET /api/costs/plates WITH the header is not intercepted (the allowlist is the first lock)", async () => {
    const worker = loadWorker("v1");
    worker.network.handler = async () =>
      new Response("{}", { status: 200, headers: { "x-offline-cache": "1" } });
    expect((await worker.fetch(get("/api/costs/plates"))).handled).toBe(false);
    expect((await worker.fetch(get("/api/reports/margins"))).handled).toBe(false);
    expect(worker.caches.urls("api-user")).toEqual([]);
  });

  it("POST /api/sync and every other write is not intercepted", async () => {
    const worker = loadWorker("v1");
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      const request = new Request(`${ORIGIN}/api/sync`, {
        method,
        body: method === "DELETE" ? undefined : "{}",
      });
      expect((await worker.fetch(request)).handled).toBe(false);
    }
    expect(
      (await worker.fetch(new Request(`${ORIGIN}/api/menu`, { method: "POST", body: "{}" })))
        .handled,
    ).toBe(false);
  });

  it("a React Server Components request (RSC: 1, or _rsc) is not intercepted, even for a shell page", async () => {
    const worker = loadWorker("v1");
    expect((await worker.fetch(get("/tavoli", { headers: { RSC: "1" } }))).handled).toBe(false);
    expect((await worker.fetch(get("/tavoli/comanda?_rsc=abc"))).handled).toBe(false);
  });

  it("a cross-origin GET is not intercepted", async () => {
    const worker = loadWorker("v1");
    expect(
      (await worker.fetch(new Request("https://cdn.example.test/_next/static/a.js"))).handled,
    ).toBe(false);
    expect((await worker.fetch(new Request("https://cdn.example.test/api/menu"))).handled).toBe(
      false,
    );
  });

  it("other same-origin GETs (images, fonts, /api/health) are not intercepted", async () => {
    const worker = loadWorker("v1");
    for (const path of ["/api/health", "/favicon.ico", "/logo.png", "/manifest.webmanifest"]) {
      expect((await worker.fetch(get(path))).handled, path).toBe(false);
    }
  });
});

describe("messages and activation", () => {
  it("clear-user-data deletes the read cache and leaves the pages and files", async () => {
    const worker = loadWorker("v1");
    installNetwork(worker);
    await worker.install();
    worker.network.handler = async () =>
      new Response("{}", { status: 200, headers: { "x-offline-cache": "1" } });
    await worker.fetch(get("/api/menu"));
    expect(await worker.caches.has("api-user")).toBe(true);
    await worker.message({ type: "clear-user-data" });
    expect(await worker.caches.has("api-user")).toBe(false);
    expect(await worker.caches.has("shell-v1")).toBe(true);
    expect(await worker.caches.has("static-v1")).toBe(true);
  });

  it("a read already in flight when clear-user-data arrives does not bring the cache back (review finding 9)", async () => {
    const worker = loadWorker("v1");
    installNetwork(worker);
    await worker.install();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    worker.network.handler = async () => {
      await gate;
      return new Response("{}", { status: 200, headers: { "x-offline-cache": "1" } });
    };
    const inFlight = worker.fetch(get("/api/menu"));
    await worker.message({ type: "clear-user-data" });
    release();
    const reply = await inFlight;
    expect(reply).toMatchObject({ handled: true, response: { status: 200 } }); // the page that asked still gets its answer
    expect(await worker.caches.has("api-user")).toBe(false);
    // A read that starts after the clear is cached again.
    worker.network.handler = async () =>
      new Response("{}", { status: 200, headers: { "x-offline-cache": "1" } });
    await worker.fetch(get("/api/menu"));
    expect(await worker.caches.has("api-user")).toBe(true);
  });

  it("any other message is ignored", async () => {
    const worker = loadWorker("v1");
    worker.network.handler = async () =>
      new Response("{}", { status: 200, headers: { "x-offline-cache": "1" } });
    await worker.fetch(get("/api/menu"));
    await worker.message({ type: "something-else" });
    await worker.message(null);
    expect(await worker.caches.has("api-user")).toBe(true);
  });

  it("activate with versions v1, v2 and v3 present and v3 current deletes only the v1 caches, then claims the clients", async () => {
    const caches = new FakeCaches();
    for (const version of ["v1", "v2", "v3"]) {
      const worker = loadWorker(version, caches);
      installNetwork(worker);
      await worker.install();
      await worker.activate();
    }
    expect([...caches.stores.keys()].filter((name) => /-v\d$/.test(name)).sort()).toEqual([
      "shell-v2",
      "shell-v3",
      "static-v2",
      "static-v3",
    ]);
    const last = loadWorker("v3", caches);
    await last.activate();
    expect(last.clientsClaim).toHaveBeenCalledTimes(1);
  });

  it("activation keeps the user read cache", async () => {
    const caches = new FakeCaches();
    const old = loadWorker("v1", caches);
    old.network.handler = async () =>
      new Response("{}", { status: 200, headers: { "x-offline-cache": "1" } });
    await old.fetch(get("/api/menu"));
    const next = loadWorker("v2", caches);
    await next.activate();
    expect(await caches.has("api-user")).toBe(true);
  });

  it("reactivating the same version, or going back to an older one, keeps the current and the one before", async () => {
    const caches = new FakeCaches();
    for (const version of ["v1", "v2", "v2", "v1"]) {
      const worker = loadWorker(version, caches);
      installNetwork(worker);
      await worker.install();
      await worker.activate();
    }
    const kept = [...caches.stores.keys()].filter((name) => name.startsWith("shell-")).sort();
    expect(kept).toEqual(["shell-v1", "shell-v2"]);
  });
});
