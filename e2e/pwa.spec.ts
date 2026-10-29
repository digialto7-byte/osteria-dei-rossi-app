import { expect, test } from "@playwright/test";
import {
  COMANDA_URL,
  goOffline,
  goOnline,
  serviceWorkerReady,
  sessionIdOf,
} from "./helpers/offline";
import { newContext } from "./helpers/order-ui";
import { seedFiringCatalogue } from "./helpers/seed-firing";
import { createWaiter, seedTables, WAITER_A } from "./helpers/seed-menu-tables";
import { tenantIdOf } from "./helpers/seed-invoice";
import { createOwner, requireSupabaseStack, signInWithMagicLink } from "./helpers/session";

requireSupabaseStack();

// M20 service worker on a phone, Chromium (`phone`) only. Fake data only.
//   T4 probe  does Playwright's offline mode cut the service worker's own requests? Read the result in CI before trusting any
//             other offline claim: the first test fails with the answer in its message if it does not.
//   T6        the comanda reloads offline (its reads come from the worker's copy although the menu answers `no-store`)
//   T2        with navigator.onLine forced true, a tap on a table still reaches the cached comanda
//   privacy   the cached shell page holds no staff name; "/fatture" offline shows the plain offline page; "Esci" empties the read cache

test.describe("the service worker on a phone (360 px)", () => {
  test.setTimeout(300_000);

  test("T4 probe, then the comanda reloads offline and the shell keeps no names", async ({
    page,
    browser,
  }, testInfo) => {
    await signInWithMagicLink(page, createOwner());
    const tenantId = await tenantIdOf(page);
    await seedFiringCatalogue(page, tenantId);
    const tables = await seedTables(page, ["Tavolo 1 (demo)"]);
    const t1 = tables["Tavolo 1 (demo)"]!;

    const a = await newContext(browser, testInfo.project.use);
    await signInWithMagicLink(a.page, await createWaiter(tenantId, WAITER_A), "/tavoli");
    await a.page.goto("/tavoli");
    await a.page.waitForLoadState("networkidle");
    await serviceWorkerReady(a.page);

    // --- T4: the page asks the worker for /api/health while the context is offline ---------------------------------
    await a.context.setOffline(true);
    const reachedNetwork = await a.page.evaluate(async () => {
      try {
        return (await fetch("/api/health", { cache: "no-store" })).ok;
      } catch {
        return false;
      }
    });
    await a.context.setOffline(false);
    expect(
      reachedNetwork,
      "T4: Playwright's offline mode did NOT cut the service worker's own request; offline specs must cut the write path themselves",
    ).toBe(false);

    // --- Open a table online so the comanda and its reads are cached ----------------------------------------------
    await a.page.locator(`[data-table-id="${t1}"]`).click();
    await a.page.getByLabel("Coperti", { exact: true }).fill("2");
    await a.page.getByRole("button", { name: "Apri tavolo", exact: true }).click();
    await a.page.waitForURL(COMANDA_URL);
    const sessionId = sessionIdOf(a.page.url());
    await expect(a.page.locator("[data-menu-item-id]").first()).toBeVisible();
    await a.page.waitForLoadState("networkidle");

    // --- T6: reload the comanda offline ---------------------------------------------------------------------------
    await goOffline(a.context);
    await a.page.reload();
    await expect(
      a.page.getByRole("heading", { name: "Tavolo 1 (demo)", exact: true }),
    ).toBeVisible();
    await expect(a.page.locator("[data-menu-item-id]").first()).toBeVisible();
    await expect(a.page.getByText(/Dati delle/)).toBeVisible();

    // --- T2: the browser says it is online but the network is dead: a table tap still reaches the cached comanda -----
    await a.page.addInitScript(() => {
      Object.defineProperty(navigator, "onLine", { get: () => true });
    });
    await a.page.goto("/tavoli");
    await expect(a.page.locator(`[data-table-id="${t1}"]`)).toBeVisible();
    await a.page.locator(`[data-table-id="${t1}"]`).click();
    await a.page.getByRole("link", { name: "Prendi la comanda" }).first().click();
    await a.page.waitForURL(COMANDA_URL);
    expect(sessionIdOf(a.page.url())).toBe(sessionId);
    await expect(a.page.locator("[data-menu-item-id]").first()).toBeVisible();

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
    await expect(a.page.getByRole("button", { name: "Esci", exact: true }).first()).toBeVisible();
    expect(await a.page.evaluate(() => caches.has("api-user"))).toBe(true);
    await a.page.getByRole("button", { name: "Esci", exact: true }).first().click();
    await a.page.waitForURL(/\/login/);
    await expect.poll(() => a.page.evaluate(() => caches.has("api-user"))).toBe(false);
    await a.context.close();
  });
});
