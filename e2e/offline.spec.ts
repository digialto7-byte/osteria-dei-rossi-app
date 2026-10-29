import { expect, test, type Page } from "@playwright/test";
import {
  expectQueued,
  COMANDA_URL,
  goOnline,
  isSyncPost,
  nextSync,
  openTableOffline,
  opsOf,
  outboxOpIds,
  serviceWorkerReady,
  sessionIdOf,
  type SyncReply,
} from "./helpers/offline";
import { bar, dish, lineRow, main, newContext, tab } from "./helpers/order-ui";
import { seedFiringCatalogue } from "./helpers/seed-firing";
import { createWaiter, seedTables, WAITER_A, WAITER_B } from "./helpers/seed-menu-tables";
import { tenantIdOf } from "./helpers/seed-invoice";
import {
  createOwner,
  expectPhoneFriendly,
  requireSupabaseStack,
  signInWithMagicLink,
} from "./helpers/session";

requireSupabaseStack();

// M20 on a phone (360 x 740), Chromium (`phone`) and WebKit (`phone-webkit`): the offline order queue. Fake data only.
//   AT6  a table opened offline, two tagliatelle, one water and "Invia primi" queue up ("In coda · 5") and go out on reconnect
//   AT7  the server answers 503 for 30 minutes: the badge stays "In coda · 2" (an outage is not a stuck operation), then every
//        operation replays when the server is back (phone only)
//   AT8  a waiter logs out with operations waiting; a second waiter signs in on the same phone; the first one's operations are
//        held (a banner names them) and never sent under the second login; they go out when the first signs in again
//   AT4/AT5  a colleague opened the table first; a colleague's later edit wins (both arrival orders)
// What runs where. Chromium (`phone`) runs these with the service worker. The `phone-webkit` project runs with service workers BLOCKED
// (playwright.config.ts): Playwright's WebKit does not apply route() or setOffline() to a page a worker controls. So on WebKit AT6-AT8
// test the queue, IndexedDB and the replay WITHOUT the worker; the worker is covered by pwa.spec.ts on Chromium and by real iPhones at
// Gate 3. On WebKit AT6 also opens the table ONLINE with only /api/sync cut (`openTableOffline`), waits for the menu, and only then goes
// offline, so it does not cover the offline tap branch (`tavoli/page.tsx`, `location.assign`); Chromium covers that.
// The write path is cut with `goOffline` (the browser offline, POST /api/sync aborted, and on Chromium the worker's own requests
// aborted too; PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS is set in playwright.config.ts).

/** Dark and light, as the other signed-in specs do. */
async function expectPhoneFriendlyBothThemes(page: Page) {
  await expectPhoneFriendly(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await expectPhoneFriendly(page);
  await page.emulateMedia({ colorScheme: "light" });
}

/** Records, for the report, whether this browser kept the queue in IndexedDB or only in memory. */
async function noteOutboxMode(page: Page, annotate: (value: string) => void) {
  const memoryOnly = await page.locator('[data-notice="memory-only"]').count();
  annotate(memoryOnly > 0 ? "memory-only" : "indexeddb");
}

test.describe("the offline queue on a phone (360 px)", () => {
  test.setTimeout(300_000);

  test("a table opened offline, three dishes and a course, then reconnect (AT6)", async ({
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
    await expect(a.page.locator(`[data-table-id="${t1}"]`)).toBeVisible();
    await a.page.waitForLoadState("networkidle");
    await serviceWorkerReady(a.page);
    await noteOutboxMode(a.page, (value) =>
      testInfo.annotations.push({ type: "outbox", description: value }),
    );

    const sessionId = await openTableOffline(a.page, t1, 4);
    await expect(
      a.page.getByRole("heading", { name: "Tavolo 1 (demo)", exact: true }),
    ).toBeVisible();

    await tab(a.page, /^Primi/).click();
    await dish(a.page, ids.tagliatelle).click();
    await dish(a.page, ids.tagliatelle).click();
    await tab(a.page, /^Bevande/).click();
    await dish(a.page, ids.acqua).click();
    await bar(a.page).click();
    await tab(a.page, /^Primi/).click();
    await a.page.getByRole("button", { name: "Invia in cucina: Primi, 2 piatti" }).click();

    // open + three lines + one fire = five operations waiting; the fire line says it is queued, not "In cucina".
    await expectQueued(a.page, 5);
    await expect(main(a.page).getByText("In coda per la cucina")).toHaveCount(2); // the two tagliatelle
    await expect(main(a.page).getByText("In cucina", { exact: true })).toHaveCount(0);
    await expect(a.page.getByText(/Sei offline/)).toBeVisible();
    await expectPhoneFriendlyBothThemes(a.page);

    const replies: SyncReply[] = [];
    a.page.on("response", async (r) => {
      if (isSyncPost(r) && r.status() === 200) replies.push((await r.json()) as SyncReply);
    });
    const synced = nextSync(a.page);
    await goOnline(a.context);
    await synced;
    await expect(a.page.getByText(/In coda/)).toHaveCount(0);

    // The server has it, by id: the table is open with 4 covers, two tagliatelle are fired, the water is a draft.
    const view = await a.page.request.get(`/api/table-sessions/${sessionId}/lines`);
    expect(view.status()).toBe(200);
    const order = (await view.json()) as {
      session: { covers: number };
      lines: { name: string; state: string }[];
    };
    expect(order.session.covers).toBe(4);
    expect(
      order.lines.filter((l) => l.name.startsWith("Tagliatelle") && l.state === "fired"),
    ).toHaveLength(2);
    expect(
      order.lines.filter((l) => l.name.startsWith("Acqua") && l.state === "draft"),
    ).toHaveLength(1);
    expect(replies.flatMap((r) => r.results).every((r) => r.status === "applied")).toBe(true);
    await a.context.close();
  });

  test("the server is down for 30 minutes: the phone says so, then sends (AT7)", async ({
    browser,
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "phone", "the clock is driven in Chromium only");
    await signInWithMagicLink(page, createOwner());
    const tenantId = await tenantIdOf(page);
    const ids = await seedFiringCatalogue(page, tenantId);
    const tables = await seedTables(page, ["Tavolo 1 (demo)"]);

    const a = await newContext(browser, testInfo.project.use);
    await signInWithMagicLink(a.page, await createWaiter(tenantId, WAITER_A), "/tavoli");
    await a.page.clock.install();
    await a.page.goto("/tavoli");
    await a.page.waitForLoadState("networkidle");
    await a.context.route("**/api/sync", (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
    );
    await a.page.locator(`[data-table-id="${tables["Tavolo 1 (demo)"]!}"]`).click();
    await a.page.getByLabel("Coperti", { exact: true }).fill("2");
    await a.page.getByRole("button", { name: "Apri tavolo", exact: true }).click();
    await a.page.waitForURL(COMANDA_URL);
    await tab(a.page, /^Bevande/).click();
    await dish(a.page, ids.acqua).click();
    await expectQueued(a.page, 2);

    // 30 minutes of 503: nothing is lost and nothing is called stuck (an outage is not a refusal of the operation).
    for (let minute = 0; minute < 31; minute += 1) await a.page.clock.fastForward("01:00");
    await expectQueued(a.page, 2);
    await expect(a.page.locator('[data-notice="stuck"]')).toHaveCount(0);

    await a.context.unroute("**/api/sync");
    const synced = nextSync(a.page);
    await a.page.clock.fastForward("00:20");
    const reply = (await (await synced).json()) as SyncReply;
    expect(reply.results.map((r) => r.status)).toEqual(["applied", "applied"]);
    await expect(a.page.getByText(/In coda/)).toHaveCount(0);
    await a.context.close();
  });

  test("logout with operations waiting, a second waiter, then the first again (AT8)", async ({
    page,
    browser,
  }, testInfo) => {
    await signInWithMagicLink(page, createOwner());
    const tenantId = await tenantIdOf(page);
    const ids = await seedFiringCatalogue(page, tenantId);
    const tables = await seedTables(page, ["Tavolo 1 (demo)"]);
    const emailA = await createWaiter(tenantId, WAITER_A);
    const emailB = await createWaiter(tenantId, WAITER_B);

    const phone = await newContext(browser, testInfo.project.use);
    const seen: { opId: string; user: string }[] = [];
    let currentUser = WAITER_A;
    phone.page.on("request", (request) => {
      if (new URL(request.url()).pathname !== "/api/sync" || request.method() !== "POST") return;
      for (const op of opsOf(request)) seen.push({ opId: op.opId, user: currentUser });
    });
    await signInWithMagicLink(phone.page, emailA, "/tavoli");
    await phone.page.goto("/tavoli");
    await phone.page.waitForLoadState("networkidle");
    // The connection is up but the server does not take operations (as in AT7): A's two operations stay in the outbox.
    await phone.context.route("**/api/sync", (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
    );
    await phone.page.locator(`[data-table-id="${tables["Tavolo 1 (demo)"]!}"]`).click();
    await phone.page.getByLabel("Coperti", { exact: true }).fill("2");
    await phone.page.getByRole("button", { name: "Apri tavolo", exact: true }).click();
    await phone.page.waitForURL(COMANDA_URL);
    await tab(phone.page, /^Bevande/).click();
    await dish(phone.page, ids.acqua).click();
    await expectQueued(phone.page, 2);
    // A's op ids, read from the outbox itself: the check below cannot pass on an empty set.
    const aOps = new Set(await outboxOpIds(phone.page));
    expect(aOps.size).toBe(2);

    // A logs out ONLINE the way a waiter does: the comanda is a focus route with no "Esci", so back to the tables first ("Esci" warns
    // about the waiting operations while it logs out). Then the second waiter signs in.
    await main(phone.page).getByRole("link", { name: "← Tavoli" }).click();
    await phone.page.waitForURL((url) => url.pathname === "/tavoli");
    await phone.page.getByRole("button", { name: "Esci", exact: true }).click();
    await phone.page.waitForURL(/\/login/);
    currentUser = WAITER_B;
    await signInWithMagicLink(phone.page, emailB, "/tavoli");
    const banner = phone.page.locator('[data-slot="held-ops-banner"]');
    await expect(banner).toContainText(WAITER_A);
    await expect(banner).toContainText("non ancora inviat");
    await phone.page.waitForLoadState("networkidle");
    // Nothing of the first waiter was put in a request under the second login.
    expect(seen.filter((s) => s.user === WAITER_B && aOps.has(s.opId))).toEqual([]);

    await phone.page.getByRole("button", { name: "Esci", exact: true }).click();
    await phone.page.waitForURL(/\/login/);
    await phone.context.unroute("**/api/sync");
    currentUser = WAITER_A;
    const synced = nextSync(phone.page);
    await signInWithMagicLink(phone.page, emailA, "/tavoli");
    const reply = (await (await synced).json()) as SyncReply;
    expect(reply.results.map((r) => r.opId).sort()).toEqual([...aOps].sort());
    expect(reply.results.map((r) => r.status)).toEqual(["applied", "applied"]);
    await expect(phone.page.locator('[data-slot="held-ops-banner"]')).toHaveCount(0);
    await phone.context.close();
  });

  test("a colleague opened the table first, and a colleague's later edit wins (AT4, AT5)", async ({
    page,
    browser,
  }, testInfo) => {
    await signInWithMagicLink(page, createOwner());
    const tenantId = await tenantIdOf(page);
    const ids = await seedFiringCatalogue(page, tenantId);
    const tables = await seedTables(page, ["Tavolo 1 (demo)"]);
    const t1 = tables["Tavolo 1 (demo)"]!;

    const a = await newContext(browser, testInfo.project.use);
    const b = await newContext(browser, testInfo.project.use);
    await signInWithMagicLink(a.page, await createWaiter(tenantId, WAITER_A), "/tavoli");
    await signInWithMagicLink(b.page, await createWaiter(tenantId, WAITER_B), "/tavoli");
    await a.page.goto("/tavoli");
    await a.page.waitForLoadState("networkidle");
    await expect(a.page.locator(`[data-table-id="${t1}"]`)).toContainText("Libero");

    // --- AT4: B opens Tavolo 1 while A, offline, opens it too and orders water --------------------------------------
    await serviceWorkerReady(a.page);
    await openTableOffline(a.page, t1, 2);
    await tab(a.page, /^Bevande/).click();
    await dish(a.page, ids.acqua).click();

    await b.page.goto("/tavoli");
    await b.page.locator(`[data-table-id="${t1}"]`).click();
    await b.page.getByLabel("Coperti", { exact: true }).fill("4");
    const opened = nextSync(b.page);
    await b.page.getByRole("button", { name: "Apri tavolo", exact: true }).click();
    await opened;
    await b.page.waitForURL(COMANDA_URL);
    const sessionB = sessionIdOf(b.page.url());

    const reconnected = nextSync(a.page);
    await goOnline(a.context);
    await reconnected;
    const refused = main(a.page)
      .getByRole("alert")
      .filter({ hasText: "era già aperto da un collega" });
    await expect(refused).toBeVisible();
    await expect(refused).toContainText("Tavolo 1 (demo)");
    await expectPhoneFriendlyBothThemes(a.page);
    await refused.getByRole("button", { name: "Ho capito" }).click();
    await expect(refused).toHaveCount(0);

    // --- AT5, second arrival order: A's edit is applied first, then B's later edit wins and A is told ----------------
    await b.page.goto(`/tavoli/comanda?s=${sessionB}`);
    await tab(b.page, /^Bevande/).click();
    const added = nextSync(b.page);
    await dish(b.page, ids.acqua).click();
    const line = (
      (await (await added).json()) as { results: { reply: { line: { id: string } } }[] }
    ).results[0]!.reply.line.id;
    await a.page.goto(`/tavoli/comanda?s=${sessionB}`);
    await bar(a.page).click();
    await expect(lineRow(a.page, line)).toBeVisible();
    await lineRow(a.page, line)
      .getByRole("button", { name: /^Modifica/ })
      .click();
    const aEdit = nextSync(a.page);
    await lineRow(a.page, line)
      .getByRole("button", { name: "Più una porzione", exact: true })
      .click();
    await aEdit;
    await bar(b.page).click();
    await b.page.reload();
    await bar(b.page).click();
    await lineRow(b.page, line)
      .getByRole("button", { name: /^Modifica/ })
      .click();
    const bEdit = nextSync(b.page);
    await lineRow(b.page, line)
      .getByRole("button", { name: "Più una porzione", exact: true })
      .click();
    await bEdit;

    await a.page.reload();
    const told = main(a.page).getByRole("alert").filter({ hasText: "dopo di te" });
    await expect(told).toContainText(WAITER_B);
    await expectPhoneFriendlyBothThemes(a.page);
    await Promise.all([a.context.close(), b.context.close()]);
  });
});
