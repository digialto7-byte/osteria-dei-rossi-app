import { expect, type BrowserContext, type Page, type Response } from "@playwright/test";

// Helpers for the offline queue (M20). Every write of the order screen is a queued operation that POST /api/sync carries, so a spec
// waits for that call (and for the "In coda" marks to go) where it used to wait for a direct write endpoint.

/** The comanda address after a table is opened: `/tavoli/comanda?s=<session id>`. */
export const COMANDA_URL = /\/tavoli\/comanda\?s=[0-9a-f-]{36}$/;

/** The session id in a comanda address. */
export function sessionIdOf(url: string): string {
  const id = new URL(url).searchParams.get("s");
  if (!id) throw new Error(`No session in ${url}`);
  return id;
}

export const isSyncPost = (r: Response) =>
  new URL(r.url()).pathname === "/api/sync" && r.request().method() === "POST";

/** One operation as it travels in the body of POST /api/sync (only what the specs look at). */
export type WireOp = { opId: string; kind: string; seq?: number; payload?: unknown };
export type SyncReply = {
  results: { opId: string; kind: string; status: string }[];
  stopped: { opId: string; reason: string } | null;
};

/** The operations in the body of one /api/sync request. */
export function opsOf(request: { postData(): string | null }): WireOp[] {
  const body = JSON.parse(request.postData() ?? "{}") as { ops?: WireOp[] };
  return body.ops ?? [];
}

/** Starts waiting for the next 200 from POST /api/sync; await it after the action that causes it. */
export function nextSync(page: Page): Promise<Response> {
  return page.waitForResponse((r) => isSyncPost(r) && r.status() === 200);
}

/** Runs `act`, waits for the /api/sync call it causes and returns its JSON. */
export async function syncedAfter(page: Page, act: () => Promise<unknown>): Promise<SyncReply> {
  const [response] = await Promise.all([nextSync(page), act()]);
  return (await response.json()) as SyncReply;
}

/** Waits until the phone has nothing left to send: no "In coda" mark anywhere on the page. */
export async function expectNothingQueued(page: Page): Promise<void> {
  try {
    await expect(page.getByText(/In coda/)).toHaveCount(0);
  } catch (error) {
    // Says why, so the next CI log decides (service-sim "4 primi" failed twice, the trace could not be fetched): who holds the replay
    // lease and until when, and which operations are still in the outbox.
    console.log(
      `expectNothingQueued failed: this page's holder ${await holderInfo(page)}; lease ${await replayLeaseInfo(page)}; web locks ${await locksInfo(page)}; outbox ${await outboxInfo(page)}`,
    );
    throw error;
  }
}

/** This page's name in the replay lease (src/pwa/use-outbox.ts puts it on the root element). Never throws. */
async function holderInfo(page: Page): Promise<string> {
  try {
    return JSON.stringify(
      await page.evaluate(() => document.documentElement.dataset.syncHolder ?? null),
    );
  } catch (error) {
    return `unreadable: ${(error as Error).message}`;
  }
}

/** Who holds or waits for the origin's Web Locks right now (the replay lock is one of them). Never throws. */
async function locksInfo(page: Page): Promise<string> {
  try {
    return JSON.stringify(await page.evaluate(async () => await navigator.locks.query()));
  } catch (error) {
    return `unreadable: ${(error as Error).message}`;
  }
}

/** Each op still in the outbox with its sentAt and attempts, read from the page. Never throws. */
async function outboxInfo(page: Page): Promise<string> {
  try {
    return await page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          const opening = indexedDB.open("osteria-sync");
          opening.onerror = () => resolve("unreadable");
          opening.onsuccess = () => {
            const db = opening.result;
            if (!db.objectStoreNames.contains("outbox")) {
              db.close();
              resolve("[]");
              return;
            }
            const all = db.transaction("outbox", "readonly").objectStore("outbox").getAll();
            all.onerror = () => {
              db.close();
              resolve("unreadable");
            };
            all.onsuccess = () => {
              db.close();
              resolve(
                JSON.stringify(
                  (
                    all.result as {
                      opId: string;
                      kind: string;
                      sentAt?: number | null;
                      attempts: number;
                    }[]
                  ).map((op) => ({
                    opId: op.opId,
                    kind: op.kind,
                    sentAt: op.sentAt ?? null,
                    attempts: op.attempts,
                  })),
                ),
              );
            };
          };
        }),
    );
  } catch (error) {
    return `unreadable: ${(error as Error).message}`;
  }
}

/** The line ids on the sheet now (the sheet must be open). */
export async function lineIds(page: Page): Promise<string[]> {
  return page
    .locator("[data-line-id]")
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-line-id")!));
}

const SYNC_ROUTE = "**/api/sync";

/** Aborts POST /api/sync: the write path is dead whatever the browser says about its connection. */
export async function cutSync(context: BrowserContext): Promise<void> {
  await context.route(SYNC_ROUTE, (route) => route.abort("internetdisconnected"));
}

/** The app's own origin (localhost): what a dead network cuts; Supabase and Mailpit are on 127.0.0.1. */
const isApp = (url: URL) => url.hostname === "localhost";

/**
 * Cuts the connection the way a dead Wi-Fi does: the browser goes offline (`navigator.onLine` false), POST /api/sync is aborted, and
 * every request the service worker itself makes to the app is aborted (Chromium, with PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS
 * set in playwright.config.ts). The explicit abort is needed because Playwright drops the worker's offline emulation when the page
 * reloads (probed: after `reload()` the worker's fetch succeeded again), while routes survive.
 */
export async function goOffline(context: BrowserContext): Promise<void> {
  await context.setOffline(true);
  await cutSync(context);
  // Only the worker's own requests: the page's are cut by setOffline, and a navigation must reach the worker to be answered from its copy.
  await context.route(isApp, (route) =>
    route.request().serviceWorker() ? route.abort("internetdisconnected") : route.fallback(),
  );
}

export async function goOnline(context: BrowserContext): Promise<void> {
  await context.unroute(isApp);
  await context.unroute(SYNC_ROUTE);
  await context.setOffline(false);
}

const isWebKit = (page: Page) => page.context().browser()?.browserType().name() === "webkit";

/**
 * The waiter taps a free table, enters the covers and presses "Apri tavolo" with no connection, and lands on the comanda.
 * Chromium goes fully offline first (the worker serves the cached shell for the navigation). Playwright's WebKit offline mode stops a
 * navigation before the service worker can answer it, so there the write path is cut first and the browser goes offline once the
 * comanda is open: the queue and the comanda are what is under test, not WebKit's emulation. Returns the session id.
 */
export async function openTableOffline(
  page: Page,
  tableId: string,
  covers: number,
): Promise<string> {
  const context = page.context();
  if (isWebKit(page)) await cutSync(context);
  else await goOffline(context);
  await page.locator(`[data-table-id="${tableId}"]`).click();
  await page.getByLabel("Coperti", { exact: true }).fill(String(covers));
  await page.getByRole("button", { name: "Apri tavolo", exact: true }).click();
  await page.waitForURL(COMANDA_URL);
  if (isWebKit(page)) {
    // Playwright's WebKit would fail the menu read the page is about to make (no worker is there to answer from its copy): let the
    // comanda finish loading, then go offline. What the test then checks is the queue.
    await expect(page.getByRole("tab", { name: /^Primi/ })).toBeVisible();
    await context.setOffline(true);
  }
  return sessionIdOf(page.url());
}

/** Waits for `count` operations in the outbox (the failure message says how many there are), then for the badge that says so. */
export async function expectQueued(page: Page, count: number): Promise<void> {
  await expect
    .poll(async () => (await outboxOpIds(page)).length, { message: "operations in the outbox" })
    .toBe(count);
  await expect(page.getByText(new RegExp(`^In coda · ${count}$`))).toBeVisible();
}

/** Waits until the service worker controls the page (the shell and the reads are cached by then). */
export async function serviceWorkerReady(page: Page): Promise<void> {
  if (isWebKit(page)) return; // the WebKit project blocks service workers (playwright.config.ts)
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), {
      message: "the service worker controls the page",
    })
    .toBe(true);
  // The reads this page made before the worker took control were not stored; the app's warm-up (src/pwa/warm-up.ts) fetches them
  // again once it controls the page. Wait for that, not for a reload: the specs go offline only when the worker's copy has them.
  try {
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const reads = await caches.open("api-user");
            const keys = ["/api/me", "/api/menu", "/api/tables"];
            return (await Promise.all(keys.map((k) => reads.match(location.origin + k)))).every(
              Boolean,
            );
          }),
        { message: "the worker stored /api/me, /api/menu and /api/tables" },
      )
      .toBe(true);
  } catch (error) {
    // Says why, so the next CI log decides: was the page controlled from its first byte (then the warm-up never runs and only a
    // read the page itself makes is stored), which reads are stored, and how does the worker's answer for each look.
    console.log(`serviceWorkerReady failed: ${await storedReadsInfo(page)}`);
    throw error;
  }
}

/** What the page and the worker's read cache look like now, for failure messages. Read from the page; never throws. */
export async function storedReadsInfo(page: Page): Promise<string> {
  try {
    return await page.evaluate(async () => {
      const navigation = performance.getEntriesByType("navigation")[0] as
        PerformanceNavigationTiming | undefined;
      const reads = await caches.open("api-user");
      const stored = (await reads.keys()).map((request) => new URL(request.url).pathname);
      const answers: Record<string, unknown> = {};
      for (const path of ["/api/me", "/api/menu", "/api/tables"]) {
        try {
          const reply = await fetch(path, { cache: "no-store" });
          answers[path] = {
            status: reply.status,
            offlineCache: reply.headers.get("x-offline-cache"),
            cachedAt: reply.headers.get("x-offline-cached-at"),
            vary: reply.headers.get("vary"),
            cacheControl: reply.headers.get("cache-control"),
            csp: reply.headers.has("content-security-policy"),
          };
        } catch (error) {
          answers[path] = String(error);
        }
      }
      return JSON.stringify({
        path: location.pathname,
        // workerStart > 0: the document itself came through the worker, so the page was controlled from the start.
        navigationHandledByWorker: (navigation?.workerStart ?? 0) > 0,
        controller: navigator.serviceWorker.controller?.state ?? null,
        caches: await caches.keys(),
        stored,
        answers,
      });
    });
  } catch (error) {
    return `unreadable: ${String(error)}`;
  }
}

/** The replay lease record (`meta` key `replayLease`) and the page's clock, for failure messages. Read from the page; never throws. */
export async function replayLeaseInfo(page: Page): Promise<string> {
  try {
    return await page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          const done = (lease: unknown) =>
            resolve(JSON.stringify({ replayLease: lease ?? null, now: Date.now() }));
          const opening = indexedDB.open("osteria-sync");
          opening.onerror = () => done("unreadable");
          opening.onsuccess = () => {
            const db = opening.result;
            if (!db.objectStoreNames.contains("meta")) {
              db.close();
              done(null);
              return;
            }
            const get = db.transaction("meta", "readonly").objectStore("meta").get("replayLease");
            get.onerror = () => {
              db.close();
              done("unreadable");
            };
            get.onsuccess = () => {
              db.close();
              done(get.result?.value);
            };
          };
        }),
    );
  } catch (error) {
    return `unreadable: ${(error as Error).message}`;
  }
}

/** The op ids waiting in this tab's outbox (IndexedDB `osteria-sync`, store `outbox`), read from the page. Empty in a memory-only browser. */
export async function outboxOpIds(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const opening = indexedDB.open("osteria-sync");
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const db = opening.result;
          if (!db.objectStoreNames.contains("outbox")) {
            db.close();
            resolve([]);
            return;
          }
          const all = db.transaction("outbox", "readonly").objectStore("outbox").getAll();
          all.onerror = () => reject(all.error);
          all.onsuccess = () => {
            db.close();
            resolve((all.result as { opId: string }[]).map((op) => op.opId));
          };
        };
      }),
  );
}
