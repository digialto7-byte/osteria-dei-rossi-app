/*
 * Osteria Dei Rossi - service worker (M20, ADR-022).
 *
 * Hand-written, a classic script, no dependency. It does four things and nothing else:
 *   1. static files under /_next/static/        cache-first (their names carry a hash and never change);
 *   2. three shell pages (/, /tavoli, /tavoli/comanda)  network-first with a short timeout, then the cached page, so the
 *      comanda opens with no connection; any other page needs the network and shows a plain Italian page when it is missing;
 *   3. four cost-free waiter reads (API_PATHS)  network-first with a short timeout, then the cached copy. A read is stored only if
 *      its path is on that list AND the 200 response carries `x-offline-cache: 1`, which only those four routes set. Nothing
 *      else under /api is ever intercepted, so JSON with costs cannot reach this cache;
 *   4. the message `clear-user-data` (logout, PIN login, demo purge) deletes the read cache.
 *
 * It never touches a write, a cross-origin request or a React Server Components request. It does not take over a page on its own:
 * a new version waits until the old tabs are closed, so a page never runs against another version's caches in the middle of service.
 */
"use strict";

(function () {
  const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
  const STATIC = "static-" + VERSION;
  const SHELL = "shell-" + VERSION;
  const API = "api-user";
  const META = "sw-meta";
  // Bumped by every clear-user-data: a read that began before the clear must not put its answer in the cache afterwards.
  let generation = 0;
  const VERSIONS_KEY = self.location.origin + "/__sw/versions";

  // Mirrors SW_TIMEOUT_MS (src/server/sync/constants.ts) and OFFLINE_CACHE_PATHS (src/lib/api/offline-cache.ts); tests keep them equal.
  const SW_TIMEOUT_MS = 3000;
  const SHELL_PAGES = ["/", "/tavoli", "/tavoli/comanda"];
  const API_PATHS = ["/api/me", "/api/menu", "/api/tables", "/api/table-sessions/:id/lines"];

  const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
  const API_PATTERNS = API_PATHS.map(function (path) {
    return new RegExp("^" + path.replace(":id", UUID) + "$");
  });

  const OFFLINE_PAGE =
    '<!doctype html><html lang="it"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    "<title>Sei offline</title></head>" +
    '<body style="font-family:system-ui,sans-serif;margin:2rem;line-height:1.5">' +
    "<p>Sei offline. Questa pagina serve la connessione.</p>" +
    '<p><a href="/tavoli">Torna ai tavoli</a></p>' +
    "</body></html>";

  function normalize(pathname) {
    return pathname.replace(/\/+$/, "") || "/";
  }

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      const timer = setTimeout(function () {
        reject(new Error("timeout"));
      }, ms);
      promise.then(
        function (value) {
          clearTimeout(timer);
          resolve(value);
        },
        function (error) {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  /** A page worth keeping: 200, HTML, not a redirect and not the login or PIN page (a signed-out phone). */
  function isShellPage(response) {
    if (!response || response.status !== 200 || response.redirected) return false;
    const type = response.headers.get("content-type") || "";
    if (type.indexOf("text/html") === -1) return false;
    const path = response.url ? normalize(new URL(response.url).pathname) : "";
    return path !== "/login" && path !== "/pin";
  }

  /** The same-origin /_next/static/ URLs named in src and href attributes (and nowhere else). */
  function assetUrls(text) {
    const found = [];
    const pattern = /(?:src|href)=["']([^"']+)["']/g;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      let url;
      try {
        url = new URL(match[1], self.location.origin);
      } catch {
        continue;
      }
      if (url.origin === self.location.origin && url.pathname.indexOf("/_next/static/") === 0) {
        if (found.indexOf(url.href) === -1) found.push(url.href);
      }
    }
    return found;
  }

  async function precache() {
    const shell = await caches.open(SHELL);
    const files = await caches.open(STATIC);
    const wanted = [];
    await Promise.all(
      SHELL_PAGES.map(async function (path) {
        try {
          const response = await fetch(self.location.origin + path, { credentials: "include" });
          if (!isShellPage(response)) return;
          const text = await response.clone().text();
          await shell.put(self.location.origin + path, response);
          assetUrls(text).forEach(function (url) {
            if (wanted.indexOf(url) === -1) wanted.push(url);
          });
        } catch {
          // offline or blocked: the page is cached the next time it loads online
        }
      }),
    );
    await Promise.all(
      wanted.map(async function (url) {
        try {
          const response = await fetch(url);
          if (response.status === 200) await files.put(url, response);
        } catch {
          // the file is cached the first time it is used online
        }
      }),
    );
  }

  async function readVersions() {
    const meta = await caches.open(META);
    const stored = await meta.match(VERSIONS_KEY);
    if (!stored) return [];
    try {
      const list = await stored.json();
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  /** Keeps this version's caches and the previous version's (an old open tab still loads its own chunks); deletes the rest. */
  async function cleanup() {
    const meta = await caches.open(META);
    const history = (await readVersions()).filter(function (version) {
      return version !== VERSION;
    });
    history.push(VERSION);
    const keep = history.slice(-2);
    await meta.put(
      VERSIONS_KEY,
      new Response(JSON.stringify(keep), { headers: { "content-type": "application/json" } }),
    );
    const names = await caches.keys();
    await Promise.all(
      names.map(function (name) {
        const match = /^(static|shell)-(.+)$/.exec(name);
        if (match && keep.indexOf(match[2]) === -1) return caches.delete(name);
        return undefined;
      }),
    );
  }

  async function cacheFirst(request) {
    const hit = await caches.match(request);
    if (hit) return hit;
    const response = await fetch(request);
    if (response.status === 200) {
      const files = await caches.open(STATIC);
      await files.put(request.url, response.clone());
    }
    return response;
  }

  function offlinePage() {
    return new Response(OFFLINE_PAGE, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }

  async function shellNavigation(request, url) {
    const key = self.location.origin + normalize(url.pathname);
    const shell = await caches.open(SHELL);
    try {
      const response = await withTimeout(fetch(request), SW_TIMEOUT_MS);
      if (isShellPage(response)) await shell.put(key, response.clone());
      return response;
    } catch {
      const cached = await shell.match(key);
      return cached || offlinePage();
    }
  }

  async function otherNavigation(request) {
    try {
      return await fetch(request);
    } catch {
      return offlinePage();
    }
  }

  async function apiRead(request, url, keepAlive) {
    const key = self.location.origin + url.pathname;
    const started = generation;
    const network = fetch(request);

    /** Stores a cacheable 200 (allowlisted path AND `x-offline-cache: 1`), unless the cache was cleared since this read began. */
    async function store(response) {
      if (response.status !== 200 || response.headers.get("x-offline-cache") !== "1") return;
      const headers = new Headers(response.headers);
      headers.set("x-offline-cached-at", new Date().toISOString());
      const copy = new Response(await response.clone().arrayBuffer(), {
        status: 200,
        statusText: response.statusText,
        headers: headers,
      });
      if (started === generation) {
        const reads = await caches.open(API);
        if (started === generation) await reads.put(key, copy);
      }
    }

    try {
      const response = await withTimeout(network, SW_TIMEOUT_MS);
      await store(response);
      return response;
    } catch (error) {
      if (error && error.message === "timeout") {
        // Too slow for this read, but still the freshest answer there is: keep it for the next one.
        const late = network
          .then(function (response) {
            return store(response);
          })
          .catch(function () {});
        if (keepAlive) keepAlive(late);
      }
      const reads = await caches.open(API);
      const cached = await reads.match(key);
      if (cached) return cached;
      throw error;
    }
  }

  function isApiRead(pathname) {
    return API_PATTERNS.some(function (pattern) {
      return pattern.test(pathname);
    });
  }

  self.addEventListener("install", function (event) {
    event.waitUntil(precache());
  });

  self.addEventListener("activate", function (event) {
    event.waitUntil(
      cleanup().then(function () {
        return self.clients.claim();
      }),
    );
  });

  self.addEventListener("fetch", function (event) {
    const request = event.request;
    if (request.method !== "GET") return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;
    if (request.headers.get("RSC") === "1" || url.searchParams.has("_rsc")) return;

    if (url.pathname.indexOf("/_next/static/") === 0) {
      event.respondWith(cacheFirst(request));
    } else if (request.mode === "navigate") {
      if (SHELL_PAGES.indexOf(normalize(url.pathname)) !== -1) {
        event.respondWith(shellNavigation(request, url));
      } else {
        event.respondWith(otherNavigation(request));
      }
    } else if (isApiRead(url.pathname)) {
      event.respondWith(
        apiRead(request, url, function (promise) {
          event.waitUntil(promise);
        }),
      );
    }
  });

  const MAX_WARM_READS = 8;

  /**
   * The page asks the worker to store the allowlisted reads it made before the worker controlled it. The worker fetches them itself,
   * so the page makes no request of its own at that moment. Only same-origin paths on the allowlist, with no query, at most eight.
   */
  async function warmReads(urls) {
    if (!Array.isArray(urls)) return;
    await Promise.all(
      urls.slice(0, MAX_WARM_READS).map(async function (raw) {
        if (typeof raw !== "string") return;
        let url;
        try {
          url = new URL(raw, self.location.origin);
        } catch {
          return;
        }
        if (url.origin !== self.location.origin || url.search || !isApiRead(url.pathname)) return;
        try {
          const request = new Request(url.href, {
            credentials: "same-origin",
            headers: { accept: "application/json" },
          });
          const response = await apiRead(request, url);
          if (response.body) await response.body.cancel();
        } catch {
          // offline or refused: it is stored the next time it is read through the worker
        }
      }),
    );
  }

  self.addEventListener("message", function (event) {
    const data = event.data;
    if (!data) return;
    if (data.type === "clear-user-data") {
      generation += 1;
      event.waitUntil(caches.delete(API));
    } else if (data.type === "warm-reads") {
      event.waitUntil(warmReads(data.urls));
    }
  });
})();
