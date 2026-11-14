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

/**
 * Awaits a message or an activation whose shell fetches may fail: each failed page is tried again after 500 ms and 1.5 s (fake timers),
 * so the retries are run through before the wait. Less than the 3 s a read waits, so a read held by a test is not timed out.
 */
async function settled<T>(pending: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(2_000);
  return pending;
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

// M25 step 4a (ADR-028): every page now carries a nonce policy. A cached shell page is one render's HTML (inline scripts with nonce N)
// together with the headers it came with (a policy with nonce N), and the worker must keep that pair intact.
describe("fetch: shell pages under the nonce policy (M25 step 4a)", () => {
  const nonceA = "AAAAAAAAAAAAAAAAAAAAAA==";
  const nonceB = "BBBBBBBBBBBBBBBBBBBBBB==";
  const policy = (nonce: string) => `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`;
  const nonced = (nonce: string) =>
    html(`<!doctype html><html><body><script nonce="${nonce}">1</script></body></html>`, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": policy(nonce),
      },
    });
  const goDown = (worker: Worker) => {
    worker.network.handler = async () => {
      throw new TypeError("down");
    };
  };

  it("offline, a cached shell page keeps its policy header byte for byte, and its body", async () => {
    const worker = loadWorker("v1");
    worker.network.handler = async (request) =>
      new URL(request.url).pathname === "/tavoli"
        ? nonced(nonceA)
        : new Response("x", { status: 404 });
    await worker.install();
    goDown(worker);
    const result = await worker.fetch(navigate("/tavoli"));
    expect(result.response!.headers.get("content-security-policy")).toBe(policy(nonceA));
    const text = await result.response!.text();
    expect(text).toContain(`nonce="${nonceA}"`);
    expect(text).not.toContain(nonceB);
  });

  it("a later online answer replaces header and body together: offline gives B and B, never A with B", async () => {
    const worker = loadWorker("v1");
    worker.network.handler = async () => nonced(nonceA);
    await worker.install();
    worker.network.handler = async () => nonced(nonceB);
    await worker.fetch(navigate("/tavoli"));
    goDown(worker);
    const result = await worker.fetch(navigate("/tavoli"));
    expect(result.response!.headers.get("content-security-policy")).toBe(policy(nonceB));
    const text = await result.response!.text();
    expect(text).toContain(`nonce="${nonceB}"`);
    expect(text).not.toContain(nonceA);
  });

  it("the offline page has a fixed no-script policy and stays no-store", async () => {
    const worker = loadWorker("v1");
    const result = await worker.fetch(navigate("/fatture"));
    expect(result.response!.headers.get("content-security-policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    expect(result.response!.headers.get("cache-control")).toBe("no-store");
    expect(await result.response!.text()).not.toContain("<script");
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

  it("a slow answer that arrives after the 3 s is still stored, so the next read is fresh", async () => {
    const worker = loadWorker("v1");
    worker.network.handler = async () => cacheable({ version: 1 })();
    await worker.fetch(get("/api/tables"));
    let late!: (response: Response) => void;
    worker.network.handler = () =>
      new Promise<Response>((resolve) => {
        late = resolve;
      });
    const pending = worker.fetch(get("/api/tables"));
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await (await pending).response!.json()).toEqual({ version: 1 }); // the page gets the copy at 3 s
    late(await cacheable({ version: 2 })()); // the server answers at 5 s
    await vi.advanceTimersByTimeAsync(10);
    worker.network.handler = async () => {
      throw new TypeError("offline");
    };
    expect(await (await worker.fetch(get("/api/tables"))).response!.json()).toEqual({ version: 2 });
  });

  it("an older late answer does not overwrite a newer stored copy", async () => {
    const worker = loadWorker("v1");
    let older!: (response: Response) => void;
    worker.network.handler = () =>
      new Promise<Response>((resolve) => {
        older = resolve;
      });
    const slow = worker.fetch(get("/api/tables")); // t0: starts, times out at 3 s and keeps running
    await vi.advanceTimersByTimeAsync(3_000);
    await slow;
    worker.network.handler = async () => cacheable({ list: "new", open: "T4" })(); // t4: a fast read
    await worker.fetch(get("/api/tables"));
    older(await cacheable({ list: "stale" })()); // t6: the t0 answer lands
    await vi.advanceTimersByTimeAsync(10);
    worker.network.handler = async () => {
      throw new TypeError("offline");
    };
    expect(await (await worker.fetch(get("/api/tables"))).response!.json()).toEqual({
      list: "new",
      open: "T4",
    });
  });

  it("an older answer still stores when no newer read has stored yet", async () => {
    const worker = loadWorker("v1");
    let older!: (response: Response) => void;
    worker.network.handler = () =>
      new Promise<Response>((resolve) => {
        older = resolve;
      });
    const slow = worker.fetch(get("/api/tables"));
    await vi.advanceTimersByTimeAsync(3_000);
    await slow;
    worker.network.handler = async () => {
      throw new TypeError("offline"); // the newer read failed, so it stored nothing
    };
    await worker.fetch(get("/api/tables")).catch(() => undefined);
    older(await cacheable({ list: "only" })());
    await vi.advanceTimersByTimeAsync(10);
    expect(await (await worker.fetch(get("/api/tables"))).response!.json()).toEqual({
      list: "only",
    });
  });

  it("a late fetch is aborted after 15 s so the worker is not kept alive", async () => {
    const worker = loadWorker("v1");
    let signal!: AbortSignal;
    worker.network.handler = (request) => {
      signal = request.signal;
      return new Promise<Response>((_resolve, reject) => {
        request.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    };
    const pending = worker.fetch(get("/api/tables"));
    await vi.advanceTimersByTimeAsync(3_000);
    const reply = await pending;
    expect(reply.error).toBeInstanceOf(Error); // nothing cached: the page gets the network error at 3 s
    await vi.advanceTimersByTimeAsync(11_999);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal.aborted).toBe(true);
    expect(worker.caches.urls("api-user")).toEqual([]);
  });

  it("a late answer after clear-user-data is not stored, and an offline read finds nothing", async () => {
    const worker = loadWorker("v1");
    let late!: (response: Response) => void;
    worker.network.handler = (request) => {
      // Only the read is held; the shell fetches the clear starts afterwards find the network down.
      if (!new URL(request.url).pathname.startsWith("/api/")) throw new TypeError("offline");
      return new Promise<Response>((resolve) => {
        late = resolve;
      });
    };
    const slow = worker.fetch(get("/api/tables"));
    await vi.advanceTimersByTimeAsync(3_000);
    await slow;
    await settled(worker.message({ type: "clear-user-data" }));
    late(await cacheable({ list: "previous user" })());
    await vi.advanceTimersByTimeAsync(10);
    expect(await worker.caches.has("api-user")).toBe(false);
    worker.network.handler = async () => {
      throw new TypeError("offline");
    };
    expect((await worker.fetch(get("/api/tables"))).error).toBeInstanceOf(TypeError);
  });

  it("a slow answer that is not a cacheable 200 is not stored", async () => {
    const worker = loadWorker("v1");
    worker.network.handler = async () => cacheable({ version: 1 })();
    await worker.fetch(get("/api/tables"));
    let late!: (response: Response) => void;
    worker.network.handler = () =>
      new Promise<Response>((resolve) => {
        late = resolve;
      });
    const pending = worker.fetch(get("/api/tables"));
    await vi.advanceTimersByTimeAsync(3_000);
    await pending;
    late(new Response("{}", { status: 500, headers: { "x-offline-cache": "1" } }));
    await vi.advanceTimersByTimeAsync(10);
    worker.network.handler = async () => {
      throw new TypeError("offline");
    };
    expect(await (await worker.fetch(get("/api/tables"))).response!.json()).toEqual({ version: 1 });
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
  it("clear-user-data deletes the read cache and leaves the files (the shell is re-filled, see below)", async () => {
    const worker = loadWorker("v1");
    installNetwork(worker);
    await worker.install();
    worker.network.handler = async () =>
      new Response("{}", { status: 200, headers: { "x-offline-cache": "1" } });
    await worker.fetch(get("/api/menu"));
    expect(await worker.caches.has("api-user")).toBe(true);
    await worker.message({ type: "clear-user-data" });
    expect(await worker.caches.has("api-user")).toBe(false);
    expect(await worker.caches.has("static-v1")).toBe(true);
  });

  it("clear-user-data keeps the worker alive until the read cache is deleted, even when the shell refill ends at once", async () => {
    const caches = new FakeCaches();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const realDelete = caches.delete.bind(caches);
    caches.delete = async (name: string) => {
      if (name === "api-user") await held;
      return realDelete(name);
    };
    const worker = loadWorker("v1", caches);
    installNetwork(worker);
    await worker.install();
    worker.network.handler = async () => html(PAGE());
    let settledEarly = false;
    const clearing = worker.message({ type: "clear-user-data" }).then(() => {
      settledEarly = true;
    });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(settledEarly).toBe(false);
    release();
    await clearing;
    expect(settledEarly).toBe(true);
  });

  it("a read already in flight when clear-user-data arrives does not bring the cache back (review finding 9)", async () => {
    const worker = loadWorker("v1");
    installNetwork(worker);
    await worker.install();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    worker.network.handler = async (request) => {
      // Only the read is held; the shell fetches the clear starts afterwards are not.
      if (!new URL(request.url).pathname.startsWith("/api/")) throw new TypeError("offline");
      await gate;
      return new Response("{}", { status: 200, headers: { "x-offline-cache": "1" } });
    };
    const inFlight = worker.fetch(get("/api/menu"));
    await settled(worker.message({ type: "clear-user-data" }));
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

  // The shell HTML is user-neutral, but it is replaced on every user change so it never holds markup rendered for the previous user. The
  // replacement is a fetch-then-swap, page by page: nothing is deleted first, and a page that cannot be fetched keeps its old copy.
  describe("clear-user-data and the shell (a shared phone changes user: replaced, never left holding user-specific markup)", () => {
    const body = async (worker: Worker, path: string) =>
      (await worker.caches.stores.get("shell-v1")?.match(`${ORIGIN}${path}`))?.text();
    const pages = (text: string) => () => html(text);
    const PATHS = ["/", "/tavoli", "/tavoli/comanda"];
    const installedFor = async (text: string) => {
      const worker = loadWorker("v1");
      installNetwork(worker, {
        "/": pages(text),
        "/tavoli": pages(text),
        "/tavoli/comanda": pages(text),
      });
      await worker.install();
      return worker;
    };

    it("replaces every page with the new user's copy", async () => {
      const worker = await installedFor("OWNER");
      installNetwork(worker, {
        "/": pages("WAITER"),
        "/tavoli": pages("WAITER"),
        "/tavoli/comanda": pages("WAITER"),
      });
      await worker.message({ type: "clear-user-data" });
      expect(worker.caches.urls("shell-v1")).toEqual(
        PATHS.map((path) => `${ORIGIN}${path}`).sort(),
      );
      for (const path of PATHS) expect(await body(worker, path), path).toBe("WAITER");
    });

    it("never deletes the shell cache: the old copies are there while the new ones are being fetched", async () => {
      const worker = await installedFor("OWNER");
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      worker.network.handler = async () => {
        await gate;
        return html("WAITER");
      };
      const clearing = worker.message({ type: "clear-user-data" });
      await vi.advanceTimersByTimeAsync(10);
      for (const path of PATHS) expect(await body(worker, path), path).toBe("OWNER");
      release();
      await clearing;
      for (const path of PATHS) expect(await body(worker, path), path).toBe("WAITER");
    });

    it("keeps the old copy of a page whose refill fails, after the retries", async () => {
      const worker = await installedFor("OWNER");
      worker.network.handler = async () => {
        throw new TypeError("network down");
      };
      await settled(worker.message({ type: "clear-user-data" }));
      for (const path of PATHS) expect(await body(worker, path), path).toBe("OWNER");
      expect(worker.fetches.filter((r) => new URL(r.url).pathname === "/tavoli")).toHaveLength(4); // install + 3 tries
    });

    it("keeps the old copy when the answer is a 5xx or the fetch hangs past the timeout", async () => {
      const worker = await installedFor("OWNER");
      worker.network.handler = async (request) => {
        const path = new URL(request.url).pathname;
        if (path === "/") return new Response("down", { status: 503 });
        return new Promise<Response>(() => undefined); // never answers
      };
      const clearing = worker.message({ type: "clear-user-data" });
      await vi.advanceTimersByTimeAsync(30_000);
      await clearing;
      for (const path of PATHS) expect(await body(worker, path), path).toBe("OWNER");
    });

    it("a fetch that fails once is tried again and the second attempt is swapped in", async () => {
      const worker = await installedFor("OWNER");
      const tries: Record<string, number> = {};
      worker.network.handler = async (request) => {
        const path = new URL(request.url).pathname;
        tries[path] = (tries[path] ?? 0) + 1;
        if (tries[path] === 1) throw new TypeError("network down");
        return html("WAITER");
      };
      await settled(worker.message({ type: "clear-user-data" }));
      for (const path of PATHS) {
        expect(await body(worker, path), path).toBe("WAITER");
        expect(tries[path], path).toBe(2);
      }
    });

    it("a 5xx is tried again too", async () => {
      const worker = await installedFor("OWNER");
      let calls = 0;
      worker.network.handler = async (request) => {
        if (new URL(request.url).pathname !== "/tavoli") throw new TypeError("network down");
        calls += 1;
        return calls === 1 ? new Response("down", { status: 503 }) : html("WAITER");
      };
      await settled(worker.message({ type: "clear-user-data" }));
      expect(await body(worker, "/tavoli")).toBe("WAITER");
    });

    it("swaps in only the pages that are valid: the others keep their old copy", async () => {
      const worker = await installedFor("OWNER");
      installNetwork(worker, {
        "/": pages("WAITER"),
        "/tavoli": () => redirectedTo(html("LOGIN"), `${ORIGIN}/login`),
        "/tavoli/comanda": () => new Response("gone", { status: 404 }),
      });
      await worker.message({ type: "clear-user-data" });
      expect(await body(worker, "/")).toBe("WAITER");
      expect(await body(worker, "/tavoli")).toBe("OWNER");
      expect(await body(worker, "/tavoli/comanda")).toBe("OWNER");
    });

    it("a refill that began before a newer clear never swaps in after it", async () => {
      const worker = await installedFor("OWNER");
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let calls = 0;
      worker.network.handler = async (request) => {
        if (new URL(request.url).pathname !== "/tavoli") throw new TypeError("network down");
        calls += 1;
        if (calls === 1) {
          await gate;
          return html("FIRST-USER");
        }
        return html("SECOND-USER");
      };
      const first = worker.message({ type: "clear-user-data" });
      await vi.advanceTimersByTimeAsync(10);
      const second = worker.message({ type: "clear-user-data" });
      await vi.advanceTimersByTimeAsync(10);
      release();
      await settled(Promise.all([first, second]));
      expect(await body(worker, "/tavoli")).toBe("SECOND-USER");
    });

    it("a refill overtaken by a newer clear during its retry wait makes no further fetch", async () => {
      const worker = await installedFor("OWNER");
      let failing = true;
      let tavoli = 0;
      worker.network.handler = async (request) => {
        if (new URL(request.url).pathname !== "/tavoli") return html("WAITER");
        tavoli += 1;
        if (failing) throw new TypeError("network down");
        return html("WAITER");
      };
      const first = worker.message({ type: "clear-user-data" });
      await vi.advanceTimersByTimeAsync(100); // refill 1 has failed once and is waiting to retry
      expect(tavoli).toBe(1);
      failing = false;
      tavoli = 0;
      const second = worker.message({ type: "clear-user-data" });
      await settled(Promise.all([first, second]));
      expect(tavoli).toBe(1); // only refill 2's own fetch: refill 1 does not retry after its wait
      expect(await body(worker, "/tavoli")).toBe("WAITER");
    });

    it("a precache fetch in flight across a clear is not stored", async () => {
      const worker = loadWorker("v1");
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      worker.network.handler = async (request) => {
        const path = new URL(request.url).pathname;
        if (path === "/tavoli") await gate;
        return html("OWNER-LATE");
      };
      const installing = worker.install();
      await vi.advanceTimersByTimeAsync(10);
      worker.network.handler = async () => html("WAITER");
      await worker.message({ type: "clear-user-data" });
      release();
      await installing;
      for (const path of PATHS) expect(await body(worker, path), path).toBe("WAITER");
    });

    it("a navigation in flight across a clear is not stored, and the tab still gets its page", async () => {
      const worker = await installedFor("OWNER");
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let calls = 0;
      worker.network.handler = async () => {
        calls += 1;
        if (calls === 1) {
          await gate;
          return html("OWNER-LATE");
        }
        return html("WAITER");
      };
      const inFlight = worker.fetch(navigate("/tavoli"));
      await worker.message({ type: "clear-user-data" });
      release();
      const reply = await inFlight;
      expect(reply.response?.status).toBe(200);
      expect(await body(worker, "/tavoli")).toBe("WAITER");
    });

    it("a put whose cache open straddles a clear is skipped (the answer is older than the clear)", async () => {
      const caches = new FakeCaches();
      const worker = loadWorker("v1", caches);
      installNetwork(worker, { "/tavoli": pages("INSTALLED") });
      await worker.install();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let holding = true;
      const realOpen = caches.open.bind(caches);
      caches.open = async (name: string) => {
        if (holding && name === "shell-v1") {
          holding = false;
          await gate; // the navigation's put is between its generation check and its put
        }
        return realOpen(name);
      };
      let calls = 0;
      worker.network.handler = async () => {
        calls += 1;
        if (calls === 1) return html("NAVIGATION-OLD");
        throw new TypeError("network down"); // the refill fails, so only the old copies could be stored
      };
      const navigation = worker.fetch(navigate("/tavoli"));
      await vi.advanceTimersByTimeAsync(10);
      await settled(worker.message({ type: "clear-user-data" }));
      release();
      await navigation;
      expect(await body(worker, "/tavoli")).toBe("INSTALLED");
    });

    it.each([
      ["a redirect to /login", () => redirectedTo(html("LOGIN"), `${ORIGIN}/login`)],
      ["a redirect to /pin", () => redirectedTo(html("PIN"), `${ORIGIN}/pin`)],
      [
        "the /login page itself",
        () => Object.defineProperty(html("LOGIN"), "url", { value: `${ORIGIN}/login` }),
      ],
      [
        "the /pin page itself",
        () => Object.defineProperty(html("PIN"), "url", { value: `${ORIGIN}/pin` }),
      ],
    ])("logout: %s keeps the old copies and stores nothing new", async (_name, answer) => {
      const worker = await installedFor("OWNER");
      worker.network.handler = async () => answer();
      await worker.message({ type: "clear-user-data" });
      expect(worker.caches.urls("shell-v1")).toHaveLength(3);
      for (const path of PATHS) expect(await body(worker, path), path).toBe("OWNER");
    });

    it("an activation fetches the pages again and swaps them in; a failed fetch keeps what install stored", async () => {
      const worker = await installedFor("INSTALLED");
      const before = worker.fetches.length;
      worker.network.handler = async (request) => {
        const path = new URL(request.url).pathname;
        if (path === "/tavoli/comanda") throw new TypeError("network down");
        if (path.startsWith("/_next/")) return new Response("//", { status: 200 });
        return html("ACTIVATED");
      };
      await settled(worker.activate());
      const pagesFetched = worker.fetches
        .slice(before)
        .map((r) => new URL(r.url).pathname)
        .filter((path) => PATHS.includes(path));
      expect(pagesFetched).toEqual(expect.arrayContaining(PATHS));
      expect(await body(worker, "/")).toBe("ACTIVATED");
      expect(await body(worker, "/tavoli")).toBe("ACTIVATED");
      expect(await body(worker, "/tavoli/comanda")).toBe("INSTALLED");
    });

    it("a clear fetches no static file that is already stored", async () => {
      const worker = await installedFor("OWNER"); // PAGE() is not used here: name the assets in the HTML
      const withAssets = () => html(PAGE());
      installNetwork(worker, {
        "/": withAssets,
        "/tavoli": withAssets,
        "/tavoli/comanda": withAssets,
      });
      await worker.message({ type: "clear-user-data" });
      const staticFetches = () =>
        worker.fetches.filter((r) => new URL(r.url).pathname.startsWith("/_next/static/"));
      expect(staticFetches().length).toBeGreaterThan(0); // the first time they are downloaded
      const first = staticFetches().length;
      await worker.message({ type: "clear-user-data" });
      expect(staticFetches()).toHaveLength(first);
    });
  });

  describe("warm-reads (the page asks the worker to store the cost-free reads)", () => {
    const live = () => new Response("{}", { status: 200, headers: { "x-offline-cache": "1" } });
    const SESSION = "5e000000-0000-4000-8000-000000000001";

    it("fetches the allowlisted reads itself and stores them, so they are served offline", async () => {
      const worker = loadWorker("v1");
      installNetwork(worker);
      await worker.install();
      const asked: string[] = [];
      worker.network.handler = async (request) => {
        asked.push(new URL(request.url).pathname);
        return live();
      };
      await worker.message({
        type: "warm-reads",
        urls: ["/api/me", "/api/menu", "/api/tables", `/api/table-sessions/${SESSION}/lines`],
      });
      expect(asked.sort()).toEqual(
        ["/api/me", "/api/menu", "/api/tables", `/api/table-sessions/${SESSION}/lines`].sort(),
      );
      worker.network.handler = async () => {
        throw new TypeError("offline");
      };
      for (const path of [
        "/api/me",
        "/api/menu",
        "/api/tables",
        `/api/table-sessions/${SESSION}/lines`,
      ]) {
        const reply = await worker.fetch(get(path));
        expect(reply.response!.headers.has("x-offline-cached-at"), path).toBe(true);
      }
    });

    it("fetches nothing that is not on the allowlist, not cross-origin, not with a query, and at most eight", async () => {
      const worker = loadWorker("v1");
      installNetwork(worker);
      await worker.install();
      const asked: string[] = [];
      worker.network.handler = async (request) => {
        asked.push(request.url);
        return live();
      };
      await worker.message({
        type: "warm-reads",
        urls: [
          "/api/costs/plates",
          "/api/recipes",
          "https://example.test/api/menu",
          "/api/menu?x=1",
          "/api/table-sessions/not-a-uuid/lines",
          "/api/me/../costs",
          42,
          null,
        ],
      });
      expect(asked).toEqual([]);
      await worker.message({ type: "warm-reads", urls: Array(20).fill("/api/menu") });
      expect(asked.length).toBeLessThanOrEqual(8);
      await worker.message({ type: "warm-reads", urls: "/api/menu" });
      await worker.message({ type: "warm-reads" });
    });

    it("a failing network does not throw out of the message", async () => {
      const worker = loadWorker("v1");
      installNetwork(worker);
      await worker.install();
      worker.network.handler = async () => {
        throw new TypeError("offline");
      };
      await expect(
        worker.message({ type: "warm-reads", urls: ["/api/menu"] }),
      ).resolves.toBeUndefined();
    });

    it("a warm-up in flight when clear-user-data arrives does not bring the cache back", async () => {
      const worker = loadWorker("v1");
      installNetwork(worker);
      await worker.install();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      worker.network.handler = async (request) => {
        // Only the read is held; the shell fetches the clear starts afterwards are not.
        if (!new URL(request.url).pathname.startsWith("/api/")) throw new TypeError("offline");
        await gate;
        return live();
      };
      const warming = worker.message({ type: "warm-reads", urls: ["/api/menu"] });
      await settled(worker.message({ type: "clear-user-data" }));
      release();
      await warming;
      expect(await worker.caches.has("api-user")).toBe(false);
    });
  });

  it("a warm-up that starts after clear-user-data is not undone by that clear's slow cache delete", async () => {
    // The delete is asynchronous in a real browser. A read that began after the clear has the new generation, so it stores; the
    // earlier delete must not complete after that put and take the fresh copy with it.
    const caches = new FakeCaches();
    let finishDelete!: () => void;
    const deleting = new Promise<void>((resolve) => {
      finishDelete = resolve;
    });
    const realDelete = caches.delete.bind(caches);
    caches.delete = async (name: string) => {
      await deleting;
      return realDelete(name);
    };
    const worker = loadWorker("v1", caches);
    installNetwork(worker);
    await worker.install();
    worker.network.handler = async () =>
      new Response("{}", { status: 200, headers: { "x-offline-cache": "1" } });
    const clearing = worker.message({ type: "clear-user-data" });
    const warming = worker.message({ type: "warm-reads", urls: ["/api/menu"] });
    await vi.advanceTimersByTimeAsync(10);
    finishDelete();
    await Promise.all([clearing, warming]);
    expect(caches.urls("api-user")).toEqual([`${ORIGIN}/api/menu`]);
  });

  // Review of #67: store() now waits (up to CLEAR_WAIT_MS) for the previous clear's delete before its put. During that wait only the
  // generation check right before the put keeps a read that began before a NEWER clear (a PIN login as someone else) out of the cache.
  it("a read waiting for an earlier clear's slow delete is not stored when a newer clear arrives meanwhile", async () => {
    const caches = new FakeCaches();
    let finishFirstDelete!: () => void;
    const firstDelete = new Promise<void>((resolve) => {
      finishFirstDelete = resolve;
    });
    const realDelete = caches.delete.bind(caches);
    let deletes = 0;
    caches.delete = async (name: string) => {
      deletes += 1;
      if (deletes === 1) await firstDelete; // clear #1's delete is slow; clear #2's is immediate
      return realDelete(name);
    };
    const worker = loadWorker("v1", caches);
    installNetwork(worker);
    await worker.install();
    worker.network.handler = async () =>
      new Response('{"user":"A"}', { status: 200, headers: { "x-offline-cache": "1" } });
    const clear1 = worker.message({ type: "clear-user-data" });
    const reading = worker.fetch(get("/api/menu")); // starts after clear #1: same generation, so it waits in store()
    await vi.advanceTimersByTimeAsync(10);
    const clear2 = worker.message({ type: "clear-user-data" }); // a newer clear while the read waits
    await vi.advanceTimersByTimeAsync(10);
    finishFirstDelete();
    await vi.advanceTimersByTimeAsync(10);
    const reply = await reading;
    await Promise.all([clear1, clear2]);
    expect(reply.response?.status).toBe(200); // the page still gets its answer
    expect(caches.urls("api-user")).toEqual([]); // but A's read is not stored after clear #2
  });

  it("a clear whose delete never settles does not hang the reads, and nothing is stored meanwhile", async () => {
    const caches = new FakeCaches();
    caches.delete = () => new Promise<boolean>(() => undefined); // never settles
    const worker = loadWorker("v1", caches);
    installNetwork(worker);
    await worker.install();
    worker.network.handler = async () =>
      new Response('{"a":1}', { status: 200, headers: { "x-offline-cache": "1" } });
    void worker.message({ type: "clear-user-data" });
    const reading = worker.fetch(get("/api/menu"));
    await vi.advanceTimersByTimeAsync(10_000);
    const reply = await reading;
    expect(reply.response?.status).toBe(200); // the page still gets its answer
    expect(await reply.response!.text()).toBe('{"a":1}');
    expect(caches.urls("api-user")).toEqual([]); // and the copy is skipped, not put on top of a delete that may still land
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
    await settled(last.activate());
    expect(last.clientsClaim).toHaveBeenCalledTimes(1);
  });

  it("activation keeps the user read cache", async () => {
    const caches = new FakeCaches();
    const old = loadWorker("v1", caches);
    old.network.handler = async () =>
      new Response("{}", { status: 200, headers: { "x-offline-cache": "1" } });
    await old.fetch(get("/api/menu"));
    const next = loadWorker("v2", caches);
    await settled(next.activate());
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
