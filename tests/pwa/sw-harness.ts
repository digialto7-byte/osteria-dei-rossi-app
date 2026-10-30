import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { vi } from "vitest";

// A harness that runs public/sw.js (a classic script) in a `node:vm` context with a fake `self`, `caches`, `fetch` and `clients`, and Node's own
// Request, Response and Headers (M20 plan §3.9, step 16). No test hook ships in the worker: it is driven through its events.

export const ORIGIN = "https://app.example.test";
export const SOURCE = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");

interface Stored {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: ArrayBuffer;
}

class FakeCache {
  entries = new Map<string, Stored>();
  private key = (request: Request | string) =>
    typeof request === "string" ? request : request.url;
  async put(request: Request | string, response: Response) {
    const copy = response.clone();
    this.entries.set(this.key(request), {
      status: copy.status,
      statusText: copy.statusText,
      headers: [...copy.headers.entries()],
      body: await copy.arrayBuffer(),
    });
  }
  async match(request: Request | string) {
    const stored = this.entries.get(this.key(request));
    if (!stored) return undefined;
    return new Response(stored.body.slice(0), {
      status: stored.status,
      statusText: stored.statusText,
      headers: stored.headers,
    });
  }
  async keys() {
    return [...this.entries.keys()].map((url) => new Request(url));
  }
  async delete(request: Request | string) {
    return this.entries.delete(this.key(request));
  }
}

export class FakeCaches {
  stores = new Map<string, FakeCache>();
  async open(name: string) {
    let cache = this.stores.get(name);
    if (!cache) this.stores.set(name, (cache = new FakeCache()));
    return cache;
  }
  async has(name: string) {
    return this.stores.has(name);
  }
  async keys() {
    return [...this.stores.keys()];
  }
  async delete(name: string) {
    return this.stores.delete(name);
  }
  async match(request: Request | string) {
    for (const cache of this.stores.values()) {
      const found = await cache.match(request);
      if (found) return found;
    }
    return undefined;
  }
  urls(name: string): string[] {
    return [...(this.stores.get(name)?.entries.keys() ?? [])].sort();
  }
}

export type FetchScript = (request: Request) => Response | Promise<Response>;

export interface Worker {
  caches: FakeCaches;
  fetches: Request[];
  clientsClaim: ReturnType<typeof vi.fn>;
  /** Replace the network. */
  network: { handler: FetchScript };
  install(): Promise<void>;
  activate(): Promise<void>;
  /** Dispatches a fetch event; `handled` is false when the worker did not call respondWith. */
  fetch(request: Request): Promise<{ handled: boolean; response?: Response; error?: unknown }>;
  message(data: unknown): Promise<void>;
}

/** The reply a fetch handler of the fake network gives for a page. */
export function html(body: string, extra: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    ...extra,
  });
}

/** A response that says it was redirected and ended on `url` (a real fetch sets these; a constructed Response cannot). */
export function redirectedTo(response: Response, url: string): Response {
  Object.defineProperty(response, "redirected", { value: true });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

export function loadWorker(version: string, caches: FakeCaches = new FakeCaches()): Worker {
  const listeners = new Map<string, (event: unknown) => void>();
  const fetches: Request[] = [];
  const network = {
    handler: (async () => {
      throw new TypeError("network down");
    }) as FetchScript,
  };
  const clientsClaim = vi.fn(async () => undefined);
  const sandbox: Record<string, unknown> = {
    caches,
    Request,
    Response,
    Headers,
    URL,
    URLSearchParams,
    Promise,
    Date,
    JSON,
    Map,
    Set,
    Array,
    Object,
    String,
    RegExp,
    TypeError,
    Error,
    console,
    setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
    clearTimeout: (...args: Parameters<typeof clearTimeout>) => clearTimeout(...args),
    fetch: async (input: Request | string, init?: RequestInit) => {
      const request = typeof input === "string" ? new Request(new URL(input, ORIGIN), init) : input;
      fetches.push(request);
      return network.handler(request);
    },
    clients: { claim: clientsClaim },
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners.set(type, listener);
    },
    location: { href: `${ORIGIN}/sw.js?v=${version}`, origin: ORIGIN, search: `?v=${version}` },
  };
  sandbox.self = sandbox;
  runInNewContext(SOURCE, sandbox, { filename: "sw.js" });

  const waitable = async (type: string, data?: unknown) => {
    const waits: Promise<unknown>[] = [];
    const listener = listeners.get(type);
    if (!listener) throw new Error(`the worker has no ${type} listener`);
    listener({ waitUntil: (p: Promise<unknown>) => waits.push(p), data });
    await Promise.all(waits);
  };

  return {
    caches,
    fetches,
    clientsClaim,
    network,
    install: () => waitable("install"),
    activate: () => waitable("activate"),
    message: (data) => waitable("message", data),
    async fetch(request) {
      const listener = listeners.get("fetch");
      if (!listener) throw new Error("the worker has no fetch listener");
      let responded: Promise<Response> | undefined;
      listener({
        request,
        respondWith: (p: Promise<Response> | Response) => {
          responded = Promise.resolve(p);
        },
        waitUntil: () => undefined,
      });
      if (!responded) return { handled: false };
      try {
        return { handled: true, response: await responded };
      } catch (error) {
        return { handled: true, error };
      }
    },
  };
}
