import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { COMANDA_URL, isSyncPost, nextSync, sessionIdOf } from "./helpers/offline";
import { tenantIdOf } from "./helpers/seed-invoice";
import { NAMES, seedOrderCatalogue } from "./helpers/seed-order";
import { WAITER_A, WAITER_B, createWaiter, seedTables } from "./helpers/seed-menu-tables";
import {
  createOwner,
  createStaff,
  expectPhoneFriendly,
  requireSupabaseStack,
  signInWithMagicLink,
} from "./helpers/session";

requireSupabaseStack();

// M18 acceptance tests on screen, on a phone (360 x 740), in Chromium (project `phone`) and in WebKit (project
// `phone-webkit`): a waiter takes the order of a table of 4 covers by script, tap by tap. The owner seeds the menu
// through the API (two plates that use a stew batch of 3 portions and a ragù batch that does not exist, four dishes
// with no recipe, one pushed dish); two waiters (two browser contexts, so two real sessions) edit one line; the chef
// is turned away. Fake data only ("(demo)" names).
//   AT6: 4 covers, 3 courses by script, all targets at least 44 px, light and dark
//   AT1 UI: the dish whose batch is empty is greyed "Esaurito" and a tap adds nothing
//   AT2 UI: "Ne restano 3" on the stew
//   AT3 UI: a half portion, a shared plate, a note, a move to another course
//   AT4 UI: the pushed dish is the first button of the menu, with its push price
//   AT5 UI: a held edit loses to a later one and the waiter sees who changed the line
//   Roles on screen: the waiter sees no cost word; the chef gets one notice with no euro sign

const main = (page: Page) => page.locator("main");
const tab = (page: Page, course: RegExp) => page.getByRole("tab", { name: course });
const bar = (page: Page) => page.getByRole("button", { name: /^Comanda/ });
// The menu button of a dish in the course panel (the pinned strip repeats a pushed dish, marked data-pinned).
const dish = (page: Page, id: string) =>
  page.locator(`[data-menu-item-id="${id}"]:not([data-pinned])`);
const lineRow = (page: Page, id: string) => page.locator(`[data-line-id="${id}"]`);

/** Dark and light, as the other signed-in specs do. */
async function expectPhoneFriendlyBothThemes(page: Page) {
  await expectPhoneFriendly(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await expectPhoneFriendly(page);
  await page.emulateMedia({ colorScheme: "light" });
}

/**
 * A new browser context at phone size: an independent session in the project's own browser. The project's device
 * options (isMobile, hasTouch, userAgent, deviceScaleFactor) are passed on, so WebKit and Chromium are really emulated
 * as phones, not just narrow windows.
 */
async function phoneContext(browser: Browser, use: TestInfo["project"]["use"]) {
  const context = await browser.newContext({
    ...use,
    baseURL: use.baseURL,
    viewport: { width: 360, height: 740 },
  });
  return { context, page: await context.newPage() };
}

/**
 * Taps a dish and returns the id of the line it made. Since M20 the line is made on the phone and a queued operation carries it to
 * the server; the call waits for that operation to be applied (POST /api/sync answers 200 with `add_line` applied).
 */
async function tapDish(page: Page, _sessionId: string, button: Locator): Promise<string> {
  const [response] = await Promise.all([nextSync(page), button.click()]);
  const body = (await response.json()) as {
    results: { kind: string; status: string; reply?: { line: { id: string } } }[];
  };
  const made = body.results.find((result) => result.kind === "add_line");
  expect(made?.status).toBe("applied");
  return made!.reply!.line.id;
}

/** Opens the editor of a line in the open sheet. */
async function openEditor(page: Page, lineId: string) {
  await lineRow(page, lineId)
    .getByRole("button", { name: /^Modifica/ })
    .click();
  await expect(
    lineRow(page, lineId).getByRole("button", { name: "Fatto", exact: true }),
  ).toBeVisible();
}

/** One edit in an open editor: runs `act` and waits for the queued edit of the line to be applied by POST /api/sync. */
async function edit(page: Page, lineId: string, act: () => Promise<void>) {
  const [response] = await Promise.all([nextSync(page), act()]);
  const body = (await response.json()) as {
    results: { kind: string; status: string }[];
  };
  expect(body.results.find((result) => result.kind === "edit_line")?.status).toBe("applied");
  // The replay is done once the line no longer says "In coda" (the server's copy is back on the sheet).
  await expect(lineRow(page, lineId)).not.toContainText("In coda");
}

test.describe("order entry on a phone (360 px)", () => {
  test.setTimeout(300_000);

  test("a waiter takes a 4-cover, 3-course order by script; two waiters and the chef (AT1 to AT6 UI)", async ({
    page,
    browser,
  }, testInfo) => {
    // --- The owner seeds the menu and one table ------------------------------------------------------------------
    await signInWithMagicLink(page, createOwner());
    const tenantId = await tenantIdOf(page);
    const ids = await seedOrderCatalogue(page, tenantId);
    const tables = await seedTables(page, ["Tavolo 1 (demo)"]);
    const t1 = tables["Tavolo 1 (demo)"]!;

    // --- Waiter A opens Tavolo 1 with 4 covers and takes the order ------------------------------------------------
    const a = await phoneContext(browser, testInfo.project.use);
    await signInWithMagicLink(a.page, await createWaiter(tenantId, WAITER_A), "/tavoli");
    await a.page.goto("/tavoli");
    const tile = a.page.locator(`[data-table-id="${t1}"]`);
    await tile.click();
    await a.page.getByLabel("Coperti", { exact: true }).fill("4");
    const [opened] = await Promise.all([
      nextSync(a.page),
      a.page.getByRole("button", { name: "Apri tavolo", exact: true }).click(),
    ]);
    const openedBody = (await opened.json()) as { results: { kind: string; status: string }[] };
    expect(openedBody.results.find((result) => result.kind === "open_table")?.status).toBe(
      "applied",
    );
    // B8: opening the table leads straight to its comanda (the tile check moved to menu-tables.spec.ts).
    await a.page.waitForURL(COMANDA_URL);
    const sessionId = sessionIdOf(a.page.url());
    const started = Date.now();

    await expect(
      a.page.getByRole("heading", { name: "Tavolo 1 (demo)", exact: true }),
    ).toBeVisible();
    await expect(main(a.page)).toContainText("4 coperti");
    // The comanda is a focus route: no tab bar and no section row, and the way out is the first link in main.
    await expect(a.page.getByRole("navigation", { name: "Sezioni" })).toHaveCount(0);
    await expect(a.page.getByRole("navigation", { name: "Menu principale" })).toHaveCount(0);
    await expect(main(a.page).getByRole("link").first()).toHaveText("← Tavoli");
    await expect(main(a.page).getByRole("link").first()).toHaveAttribute("href", "/tavoli");

    // AT4 UI: the pushed dish is the first menu button, with its push price (the menu price is 6,00 EUR).
    const first = main(a.page).locator("[data-menu-item-id]").first();
    await expect(first).toHaveAttribute("data-menu-item-id", ids.tiramisu);
    await expect(first).toHaveAttribute("data-pinned", "true");
    await expect(first).toContainText(/4,50\s€/);
    await expect(main(a.page).getByRole("region", { name: "Da proporre" })).toBeVisible();

    // AT1 UI: the ragù plate has no portion left; it is greyed and a tap adds nothing.
    await tab(a.page, /^Primi/).click();
    const pasta = dish(a.page, ids.tagliatelle);
    await expect(pasta).toHaveAttribute("aria-disabled", "true");
    await expect(pasta).toContainText("Esaurito");
    // Playwright's click() waits for an aria-disabled control to become enabled and never returns: dispatch the tap.
    // A tap would queue an add_line and the replay would POST it to /api/sync: nothing must be sent.
    const syncPosts: string[] = [];
    const onRequest = (request: import("@playwright/test").Request) => {
      if (new URL(request.url()).pathname === "/api/sync") syncPosts.push(request.url());
    };
    a.page.on("request", onRequest);
    await pasta.dispatchEvent("click");
    await a.page.waitForTimeout(500);
    a.page.off("request", onRequest);
    expect(syncPosts).toEqual([]);
    await expect(bar(a.page)).toHaveText("Comanda");

    // AT2 UI: 3 portions of stew are left.
    await tab(a.page, /^Secondi/).click();
    await expect(dish(a.page, ids.stew)).toContainText("Ne restano 3");

    // AT6: antipasti, primi, secondi by script (the targets are measured with the sheet and an editor open below).
    await tab(a.page, /^Antipasti/).click();
    const bruschetta = [
      await tapDish(a.page, sessionId, dish(a.page, ids.bruschetta)),
      await tapDish(a.page, sessionId, dish(a.page, ids.bruschetta)),
    ];
    await tab(a.page, /^Primi/).click();
    const zuppa = [
      await tapDish(a.page, sessionId, dish(a.page, ids.zuppa)),
      await tapDish(a.page, sessionId, dish(a.page, ids.zuppa)),
    ];
    await tab(a.page, /^Secondi/).click();
    const stew: string[] = [];
    for (let count = 0; count < 4; count += 1) {
      stew.push(await tapDish(a.page, sessionId, dish(a.page, ids.stew)));
    }
    await expect(bar(a.page)).toHaveText("Comanda · 8 righe");
    await expect(tab(a.page, /^Secondi/)).toHaveText("Secondi · 4");
    // The hint does not change: lines not yet sent reserve nothing.
    await expect(dish(a.page, ids.stew)).toContainText("Ne restano 3");

    // AT3 UI: a half portion, a shared plate, a note and a move to another course.
    await bar(a.page).click();
    for (const id of [...bruschetta, ...zuppa, ...stew])
      await expect(lineRow(a.page, id)).toBeVisible();
    const [half, shared, noted, moved] = stew as [string, string, string, string];

    await openEditor(a.page, half);
    await edit(a.page, half, () =>
      lineRow(a.page, half).getByRole("button", { name: "Mezza porzione", exact: true }).click(),
    );
    await expect(lineRow(a.page, half)).toContainText(`½ ${NAMES.stew}`);

    await openEditor(a.page, shared);
    await edit(a.page, shared, () =>
      lineRow(a.page, shared)
        .getByRole("button", { name: "Piatto condiviso", exact: true })
        .click(),
    );
    await expect(lineRow(a.page, shared)).toContainText("Da dividere");

    await openEditor(a.page, noted);
    const note = lineRow(a.page, noted).getByRole("textbox", { name: /^Nota/ });
    await note.fill("senza cipolla");
    await edit(a.page, noted, () => note.blur());
    await expect(lineRow(a.page, noted)).toContainText("senza cipolla");

    await openEditor(a.page, moved);
    await edit(a.page, moved, async () => {
      await lineRow(a.page, moved)
        .getByRole("combobox", { name: /^Portata/ })
        .selectOption("dolci");
    });
    await expect(tab(a.page, /^Dolci/)).toHaveText("Dolci · 1");
    await expect(tab(a.page, /^Secondi/)).toHaveText("Secondi · 3");
    await expect(
      a.page.getByRole("heading", { level: 3, name: "Dolci", exact: true }),
    ).toBeVisible();
    // The 90 s check is human (Gate 3); the run only logs its own time.
    console.log(`M18 AT6: the scripted order took ${Date.now() - started} ms in this run`);

    // The editor is open on the moved line: measure the targets with the sheet and the editor open, both themes.
    await expectPhoneFriendlyBothThemes(a.page);
    await lineRow(a.page, moved).getByRole("button", { name: "Fatto", exact: true }).click();

    // The waiter reads sale prices and nothing of cost.
    expect(await main(a.page).innerText()).not.toMatch(/Costo|Margine|Food cost/);

    // --- AT5 UI: waiter B holds an edit while waiter A changes the same line ---------------------------------------
    const b = await phoneContext(browser, testInfo.project.use);
    await signInWithMagicLink(b.page, await createWaiter(tenantId, WAITER_B), "/tavoli");
    await b.page.goto(`/tavoli/comanda?s=${sessionId}`);
    await expect(bar(b.page)).toHaveText("Comanda · 8 righe");
    await bar(b.page).click();
    await openEditor(b.page, half);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // B's queued edit is held on its way to the server: only POST /api/sync waits for the gate.
    await b.page.route("**/api/sync", async (route) => {
      await gate;
      return route.continue();
    });
    const heldReply = b.page.waitForResponse(isSyncPost);
    // B's edit is stamped now and held on its way.
    await lineRow(b.page, half)
      .getByRole("button", { name: "Più una porzione", exact: true })
      .click();

    // A edits the same line after B's click (a later stamp) and is answered at once.
    await openEditor(a.page, half);
    await edit(a.page, half, () =>
      lineRow(a.page, half).getByRole("button", { name: "Più una porzione", exact: true }).click(),
    );

    release();
    const lost = await heldReply;
    expect(lost.status()).toBe(200);
    // B's older stamp loses at the server (last write wins per line): B is told who changed the line.
    const alert = main(b.page).getByRole("alert").filter({ hasText: WAITER_A });
    await expect(alert).toBeVisible();
    // The stale notice in full: the dish, who changed the line and when, and that B's copy is now the current one. (The queue's
    // notice no longer prints "Ora: 1 × ..."; the current quantity is on the line itself, asserted below.)
    await expect(alert).toContainText(NAMES.stew);
    await expect(alert).toContainText(
      /Questa riga è stata cambiata da Cameriere Demo alle \d{2}:\d{2}: ecco la versione attuale\./,
    );
    // B's copy of the line is A's now.
    await expect(lineRow(b.page, half)).toContainText(`1 × ${NAMES.stew}`);
    await expectPhoneFriendly(b.page);

    // --- The chef is turned away: one notice, no euro sign, nothing written -----------------------------------------
    const chef = await phoneContext(browser, testInfo.project.use);
    await signInWithMagicLink(chef.page, await createStaff(tenantId, "chef"));
    await chef.page.goto(`/tavoli/comanda?s=${sessionId}`);
    const notice = main(chef.page)
      .getByRole("alert")
      .filter({ hasText: "La comanda non è disponibile per il tuo ruolo." });
    await expect(notice).toBeVisible();
    await expect(notice).not.toContainText("€");
    await expect(main(chef.page)).not.toContainText("€");
    await expect(chef.page.locator("[data-menu-item-id]")).toHaveCount(0);
    expect((await chef.page.request.get(`/api/table-sessions/${sessionId}/lines`)).status()).toBe(
      403,
    );
    expect((await chef.page.request.get("/api/menu")).status()).toBe(403);
    await expectPhoneFriendly(chef.page);

    await Promise.all([a.context.close(), b.context.close(), chef.context.close()]);
  });
});
