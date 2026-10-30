import { expect, test, type Page } from "@playwright/test";
import {
  COMANDA_URL,
  goOffline,
  goOnline,
  outboxOpIds,
  serviceWorkerReady,
  sessionIdOf,
} from "./helpers/offline";
import { main, newContext } from "./helpers/order-ui";
import { seedFiringCatalogue } from "./helpers/seed-firing";
import { createWaiter, seedTables, WAITER_A } from "./helpers/seed-menu-tables";
import { tenantIdOf } from "./helpers/seed-invoice";
import { createOwner, requireSupabaseStack, signInWithMagicLink } from "./helpers/session";

requireSupabaseStack();

// M20 service worker on a phone, Chromium (`phone`) only. Fake data only.
//   T4 probe  does Playwright's offline mode cut the service worker's OWN requests? It asks /api/me, which the worker handles, and
//             expects the worker's stored copy (x-offline-cached-at) offline. If the answer is no, the message says so.
//   T6        the comanda reloads offline (its reads come from the worker's copy although the menu answers `no-store`)
//   T2        with navigator.onLine forced true, a tap on a table still reaches the cached comanda
//   privacy   the cached shell page holds no staff name; "/fatture" offline shows the plain offline page; "Esci" empties the read cache

/** The pushed dish in the pinned strip (shown whatever course tab is open). */
const pushed = (page: Page, id: string) => page.locator(`[data-menu-item-id="${id}"][data-pinned]`);

test.describe("the service worker on a phone (360 px)", () => {
  test.setTimeout(300_000);

  test("T4 probe (the worker's own request is cut), then the comanda reloads offline and the shell keeps no names", async ({
    page,
    browser,
  }, testInfo) => {
    await signInWithMagicLink(page, createOwner());
    const tenantId = await tenantIdOf(page);
    const ids = await seedFiringCatalogue(page, tenantId);
    const tables = await seedTables(page, ["Tavolo 1 (demo)"]);
    const t1 = tables["Tavolo 1 (demo)"]!;

    const a = await newContext(browser, testInfo.project.use);
    await signInWithMagicLink(a.page, await createWaiter(tenantId, WAITER_A), "/tavoli");
    await a.page.goto("/tavoli");
    await a.page.waitForLoadState("networkidle");
    await serviceWorkerReady(a.page);

    // --- T4: is the worker's OWN request cut by setOffline? ---------------------------------------------------------------
    // /api/health is not handled by the worker, so a page fetch of it says nothing: the request goes from the page. /api/me is: the
    // worker answers it from the network, or, when ITS fetch fails, from its copy (header x-offline-cached-at). Warm the copy online,
    // go offline, ask again: a copy means the worker's fetch failed (PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS is on); a live
    // answer means Playwright left the worker online.
    const askMe = () =>
      a.page.evaluate(async () => {
        try {
          const reply = await fetch("/api/me", { cache: "no-store" });
          return { ok: reply.ok, cachedAt: reply.headers.get("x-offline-cached-at") };
        } catch {
          return { ok: false, cachedAt: null };
        }
      });
    expect(await askMe()).toEqual({ ok: true, cachedAt: null }); // online: live, and now stored
    await a.context.setOffline(true);
    const offlineReply = await askMe();
    await a.context.setOffline(false);
    expect(
      offlineReply,
      "T4: with the context offline the worker still reached the network: Playwright did not cut the worker's own requests",
    ).toMatchObject({ ok: true, cachedAt: expect.any(String) });

    // --- Open a table online so the comanda and its reads are cached ----------------------------------------------
    const tablesAnswers: string[] = [];
    a.page.on("response", (response) => {
      if (new URL(response.url()).pathname === "/api/tables") {
        const copy = response.headers()["x-offline-cached-at"] !== undefined;
        tablesAnswers.push(`${response.status()} ${copy ? "the worker's copy" : "live"}`);
      }
    });
    await a.page.locator(`[data-table-id="${t1}"]`).click();
    await a.page.getByLabel("Coperti", { exact: true }).fill("2");
    await a.page.getByRole("button", { name: "Apri tavolo", exact: true }).click();
    await a.page.waitForURL(COMANDA_URL);
    const sessionId = sessionIdOf(a.page.url());
    await expect(pushed(a.page, ids.tiramisu)).toBeVisible();
    await a.page.waitForLoadState("networkidle");

    // The worker's copy of the tables list was stored when the page first loaded, BEFORE this table was opened, so it called the table
    // free. The app refreshes it in the background once the open was applied (src/pwa/runtime.ts); wait until the copy has this session.
    try {
      await expect
        .poll(
          () =>
            a.page.evaluate(async (id) => {
              const copy = await (
                await caches.open("api-user")
              ).match(location.origin + "/api/tables");
              return copy ? (await copy.text()).includes(id) : false;
            }, sessionId),
          { message: "the worker's copy of /api/tables has the table that was just opened" },
        )
        .toBe(true);
    } catch (error) {
      // What the page saw, so a CI log says whether the refresh ran, whether the answer was live or the worker's copy, and what waited.
      throw new Error(
        `${(error as Error).message}\n/api/tables answers the page got since the table was opened: ${JSON.stringify(tablesAnswers)}\n` +
          `ops still in the outbox: ${JSON.stringify(await outboxOpIds(a.page))}`,
      );
    }

    // --- T6: reload the comanda offline ---------------------------------------------------------------------------
    await goOffline(a.context);
    await a.page.reload();
    await expect(
      a.page.getByRole("heading", { name: "Tavolo 1 (demo)", exact: true }),
    ).toBeVisible();
    await expect(pushed(a.page, ids.tiramisu)).toBeVisible();
    await expect(a.page.getByText(/Dati delle/)).toBeVisible();

    // --- T2: the browser says it is online but the network is dead: a table tap still reaches the cached comanda -----
    await a.page.addInitScript(() => {
      Object.defineProperty(navigator, "onLine", { get: () => true });
    });
    await a.page.goto("/tavoli");
    // The cached list has the table open: its tile says so, and the tap opens the session panel. Short timeouts: a regression fails
    // in seconds, not after the test's whole budget.
    const tile = a.page.locator(`[data-table-id="${t1}"]`);
    await expect(tile).toContainText("Aperto", { timeout: 10_000 });
    await tile.click();
    await main(a.page)
      .getByRole("group", { name: "Tavolo 1 (demo)", exact: true })
      .getByRole("link", { name: "Prendi la comanda" })
      .click({ timeout: 10_000 });
    await a.page.waitForURL(COMANDA_URL, { timeout: 15_000 });
    expect(sessionIdOf(a.page.url())).toBe(sessionId);
    await expect(pushed(a.page, ids.tiramisu)).toBeVisible();

    // --- The cached shell holds no name; a page that needs the network says so ---------------------------------------
    const shell = await a.page.evaluate(async () => {
      const cache = await caches.keys();
      const pages: string[] = [];
      for (const name of cache.filter((n) => n.startsWith("shell-"))) {
        const open = await caches.open(name);
        for (const request of await open.keys()) {
          pages.push(await (await open.match(request))!.text());
        }
      }
      return pages;
    });
    expect(shell.length).toBeGreaterThan(0);
    for (const html of shell) expect(html).not.toContain(WAITER_A);
    await a.page.goto("/fatture");
    await expect(a.page.getByText("Sei offline.")).toBeVisible();

    // --- Logout empties the read cache -------------------------------------------------------------------------------
    await goOnline(a.context);
    await a.page.goto("/tavoli");
    await expect(a.page.getByRole("button", { name: "Esci", exact: true })).toBeVisible();
    expect(await a.page.evaluate(() => caches.has("api-user"))).toBe(true);
    await a.page.getByRole("button", { name: "Esci", exact: true }).click();
    await a.page.waitForURL(/\/login/);
    await expect.poll(() => a.page.evaluate(() => caches.has("api-user"))).toBe(false);
    await a.context.close();
  });
});
