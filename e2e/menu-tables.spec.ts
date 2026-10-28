import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { tenantIdOf } from "./helpers/seed-invoice";
import {
  PLATE,
  WAITER_A,
  WAITER_B,
  WATER,
  createWaiter,
  seedPlateRecipe,
  seedTables,
} from "./helpers/seed-menu-tables";
import {
  createOwner,
  createStaff,
  expectPhoneFriendly,
  requireSupabaseStack,
  signInWithMagicLink,
} from "./helpers/session";

requireSupabaseStack();

// M17 acceptance tests on screen: the menu, the tables and the coperto on a phone (360 x 740) and the laptop layout
// (1280 x 800). The owner names the tables, sets the coperto and enters two menu items on the screens; two waiters
// (two browser contexts, so two real sessions) open and edit the same table. Fake data only ("(demo)" names).
//   AT5 UI: a dish without a recipe is flagged "Senza ricetta", the mapped one is not
//   AT3 UI: 4 covers at 1,50 EUR show "Coperto 6,00 €" on the table
//   AT2 UI: the second waiter's opening of the open table is a 409 that names the first waiter
//   AT1 UI: the second waiter asks for the bill and the first waiter sees "Conto richiesto" after a refresh
//   Roles on screen: the waiter reads sale prices only and has no Menu tab; the chef has neither tab, no euro sign

const nav = (page: Page) => page.getByRole("navigation", { name: "Menu principale" });
const group = (page: Page, name: string) => page.getByRole("group", { name, exact: true });
const tileOf = (page: Page, tableId: string) => page.locator(`[data-table-id="${tableId}"]`);

/** Dark and light, as the other signed-in specs do. */
async function expectPhoneFriendlyBothThemes(page: Page) {
  await expectPhoneFriendly(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await expectPhoneFriendly(page);
  await page.emulateMedia({ colorScheme: "light" });
}

/** A new browser context at phone size: a second, independent session. */
async function phoneContext(
  browser: import("@playwright/test").Browser,
  baseURL: string | undefined,
) {
  const context = await browser.newContext({ baseURL, viewport: { width: 360, height: 740 } });
  return { context, page: await context.newPage() };
}

test.describe("menu and tables on a phone (360 px)", () => {
  test.setTimeout(240_000);

  test("the owner sets up tables, coperto and menu; two waiters share a table (AT1 to AT5 UI)", async ({
    page,
    browser,
    baseURL,
  }) => {
    // --- The owner: tables and coperto on "Tavoli · impostazioni" -------------------------------------------------
    await signInWithMagicLink(page, createOwner());
    const tenantId = await tenantIdOf(page);
    const plateKey = await seedPlateRecipe(page, tenantId);

    await page.goto("/tavoli/impostazioni");
    await expect(
      page.getByRole("heading", { name: "Tavoli · impostazioni", exact: true }),
    ).toBeVisible();
    await expect(nav(page).getByRole("link", { name: "Tavoli", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    for (const [index, name] of ["Tavolo 1 (demo)", "Tavolo 2 (demo)"].entries()) {
      const form = group(page, "Nuovo tavolo");
      await form.getByLabel("Nome", { exact: true }).fill(name);
      await form.getByLabel("Ordine", { exact: true }).fill(String(index + 1));
      const [response] = await Promise.all([
        page.waitForResponse(
          (r) =>
            new URL(r.url()).pathname === "/api/dining-tables" && r.request().method() === "POST",
        ),
        form.getByRole("button", { name: "Aggiungi tavolo", exact: true }).click(),
      ]);
      expect(response.status()).toBe(201);
      await expect(group(page, name)).toBeVisible();
    }

    const coperto = group(page, "Coperto");
    await coperto.getByLabel(/^Coperto a persona/).fill("1,50");
    // The select sits inside its label, so its accessible name also carries the selected option's text.
    const vat = coperto.getByRole("combobox", { name: /^Aliquota IVA/ });
    await expect(vat).toHaveValue("10");
    await vat.selectOption("10");
    const [saved] = await Promise.all([
      page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === "/api/settings/coperto" && r.request().method() === "PATCH",
      ),
      coperto.getByRole("button", { name: "Salva", exact: true }).click(),
    ]);
    expect(saved.status()).toBe(200);
    await expect(page.locator("main").getByRole("status")).toHaveText("Salvato.");
    await expect(coperto).toContainText("Si applica ai tavoli aperti da ora in poi.");
    await expectPhoneFriendlyBothThemes(page);

    const tables = (await (await page.request.get("/api/dining-tables")).json()) as {
      tables: { id: string; name: string }[];
    };
    const t1 = tables.tables.find((t) => t.name === "Tavolo 1 (demo)")!.id;
    const t2 = tables.tables.find((t) => t.name === "Tavolo 2 (demo)")!.id;

    // --- The owner: the menu (AT5 UI) ------------------------------------------------------------------------------
    await page.goto("/menu");
    await expect(page.getByRole("heading", { name: "Menu", exact: true })).toBeVisible();
    await expect(nav(page).getByRole("link", { name: "Menu", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );

    async function addItem(fill: () => Promise<void>): Promise<string> {
      await page.getByRole("button", { name: "Nuovo piatto", exact: true }).click();
      await fill();
      const [response] = await Promise.all([
        page.waitForResponse(
          (r) => new URL(r.url()).pathname === "/api/menu/items" && r.request().method() === "POST",
        ),
        page.getByRole("button", { name: "Salva", exact: true }).click(),
      ]);
      expect(response.status()).toBe(201);
      return ((await response.json()) as { item: { id: string } }).item.id;
    }

    const waterId = await addItem(async () => {
      await page.getByLabel("Nome", { exact: true }).fill(WATER);
      await page.getByLabel("Categoria", { exact: true }).fill("Bevande");
      await page.getByRole("combobox", { name: /^Portata/ }).selectOption({ label: "Bevande" });
      await expect(page.getByRole("combobox", { name: /^Ricetta/ })).toHaveValue("");
      await page.getByLabel("Prezzo (IVA inclusa)", { exact: true }).fill("2,00");
      await expect(page.getByRole("combobox", { name: /^Aliquota IVA/ })).toHaveValue("10");
      await expectPhoneFriendly(page);
    });
    const water = page.locator(`[data-menu-item-id="${waterId}"]`);
    await expect(water).toContainText(WATER);
    await expect(water).toContainText(/2,00\s€ · IVA 10 %/);
    await expect(water.getByText("Senza ricetta", { exact: true })).toBeVisible();

    const plateId = await addItem(async () => {
      await page.getByLabel("Nome", { exact: true }).fill(PLATE);
      await page.getByLabel("Categoria", { exact: true }).fill("Secondi");
      await page.getByRole("combobox", { name: /^Ricetta/ }).selectOption(plateKey);
      await page.getByLabel("Prezzo (IVA inclusa)", { exact: true }).fill("14,00");
    });
    const plate = page.locator(`[data-menu-item-id="${plateId}"]`);
    await expect(plate).toContainText(/14,00\s€ · IVA 10 %/);
    await expect(plate).toContainText("Secondi");
    await expect(plate.getByText("Senza ricetta", { exact: true })).toHaveCount(0);
    await expect(plate).toContainText(`Ricetta: ${PLATE}`);
    await expectPhoneFriendlyBothThemes(page);

    // --- Waiter A opens Tavolo 1 with 4 covers (AT3 UI) -------------------------------------------------------------
    const a = await phoneContext(browser, baseURL);
    await signInWithMagicLink(a.page, await createWaiter(tenantId, WAITER_A), "/tavoli");
    await a.page.goto("/tavoli");
    await expect(a.page.getByRole("heading", { name: "Tavoli", exact: true })).toBeVisible();
    await expect(tileOf(a.page, t1)).toContainText("Libero");
    await expect(tileOf(a.page, t2)).toContainText("Libero");
    await tileOf(a.page, t1).click();
    await expect(
      a.page.getByRole("heading", { name: "Apri Tavolo 1 (demo)", exact: true }),
    ).toBeVisible();
    await a.page.getByLabel("Coperti", { exact: true }).fill("4");
    await expectPhoneFriendly(a.page);
    const [opened] = await Promise.all([
      a.page.waitForResponse(
        (r) => /\/api\/tables\/[^/]+\/open$/.test(r.url()) && r.request().method() === "POST",
      ),
      a.page.getByRole("button", { name: "Apri tavolo", exact: true }).click(),
    ]);
    expect(opened.status()).toBe(201);
    await expect(tileOf(a.page, t1)).toContainText("Aperto");
    await expect(tileOf(a.page, t1)).toContainText("4 coperti");
    await expect(tileOf(a.page, t1)).toContainText(WAITER_A);
    await tileOf(a.page, t1).click();
    await expect(group(a.page, "Tavolo 1 (demo)")).toContainText(/Coperto\s+6,00\s€/);
    await expectPhoneFriendlyBothThemes(a.page);

    // The waiter reads sale prices and the coperto, nothing of cost, and has no Menu tab.
    const waiterText = await a.page.locator("main").innerText();
    expect(waiterText).not.toMatch(/Costo|Margine|Food cost/);
    // The waiter has one group (Sala > Tavoli): no tab bar and no section row. Wait for the waiter's own "Esci",
    // which shows once /api/me has answered, so the absences below are real and not "the role is not known yet".
    await expect(a.page.getByRole("heading", { name: "Tavoli", exact: true })).toBeVisible();
    await expect(a.page.getByRole("button", { name: "Esci", exact: true })).toBeVisible();
    await expect(a.page.getByRole("navigation", { name: "Sezioni" })).toHaveCount(0);
    await expect(a.page.getByRole("navigation", { name: "Menu principale" })).toHaveCount(0);
    await expect(nav(a.page).getByRole("link", { name: "Menu", exact: true })).toHaveCount(0);
    await expect(a.page.locator('a[href="/menu"]')).toHaveCount(0);

    // --- Waiter B: the table is open; a second opening is refused; B asks for the bill (AT2, AT1 UI) ----------------
    const b = await phoneContext(browser, baseURL);
    await signInWithMagicLink(b.page, await createWaiter(tenantId, WAITER_B), "/tavoli");
    await b.page.goto("/tavoli");
    await expect(tileOf(b.page, t1)).toContainText("Aperto");
    await expect(tileOf(b.page, t1)).toContainText(WAITER_A);
    await expect(tileOf(b.page, t2)).toContainText("Libero");

    const second = await b.page.request.post(`/api/tables/${t1}/open`, {
      data: { sessionId: randomUUID(), covers: 2 },
    });
    expect(second.status()).toBe(409);
    const refusal = (await second.json()) as {
      error: {
        code: string;
        message: string;
        details: { session: { waiter: { displayName: string } } };
      };
    };
    expect(refusal.error.code).toBe("table_already_open");
    expect(refusal.error.details.session.waiter.displayName).toBe(WAITER_A);
    expect(refusal.error.message).toBe(`Il tavolo è già aperto da ${WAITER_A}.`);

    await tileOf(b.page, t1).click();
    const panel = group(b.page, "Tavolo 1 (demo)");
    await expect(panel).toContainText("4 coperti");
    const bill = panel.getByRole("button", { name: "Conto richiesto", exact: true });
    await expect(bill).toHaveAttribute("aria-pressed", "false");
    const [asked] = await Promise.all([
      b.page.waitForResponse(
        (r) => /\/api\/table-sessions\/[^/]+$/.test(r.url()) && r.request().method() === "PATCH",
      ),
      bill.click(),
    ]);
    expect(asked.status()).toBe(200);
    await expect(bill).toHaveAttribute("aria-pressed", "true");
    await expect(tileOf(b.page, t1)).toContainText("Conto richiesto");
    await expectPhoneFriendly(b.page);

    // Waiter A sees it after a refresh, and the opener is still A.
    await a.page.reload();
    await expect(tileOf(a.page, t1)).toContainText("Conto richiesto");
    await expect(tileOf(a.page, t1)).toContainText(WAITER_A);
    await expect(tileOf(a.page, t1)).not.toContainText(WAITER_B);
    await expect(tileOf(a.page, t2)).toContainText("Libero");

    // --- Waiter on the management screens: refused on screen ------------------------------------------------------
    await b.page.goto("/menu");
    await expect(
      b.page
        .locator("main")
        .getByRole("alert")
        .filter({ hasText: "Il menu non è modificabile con il tuo ruolo." }),
    ).toBeVisible();
    await b.page.goto("/tavoli/impostazioni");
    await expect(
      b.page
        .locator("main")
        .getByRole("alert")
        .filter({ hasText: "Le impostazioni dei tavoli non sono disponibili per il tuo ruolo." }),
    ).toBeVisible();
    expect((await b.page.request.get("/api/menu/items")).status()).toBe(403);
    expect((await b.page.request.get("/api/dining-tables")).status()).toBe(403);
    expect((await b.page.request.get("/api/settings/coperto")).status()).toBe(403);

    // The waiter's service menu carries the sale prices, no cost key.
    const serviceMenu = await b.page.request.get("/api/menu");
    expect(serviceMenu.status()).toBe(200);
    expect(JSON.stringify(await serviceMenu.json())).not.toMatch(/cost|margin|recipe/i);

    // --- The chef: neither tab, one notice, no euro sign on the page -------------------------------------------------
    const chef = await phoneContext(browser, baseURL);
    await signInWithMagicLink(chef.page, await createStaff(tenantId, "chef"));
    // Sign-in lands on the home page, which has no section nav: open a section the chef does have.
    await chef.page.goto("/produzione");
    // Wait for a tab the chef does have, so "no tab" below is not just "the role is not known yet".
    await expect(nav(chef.page).getByRole("link", { name: "Riordino", exact: true })).toBeVisible();
    await expect(nav(chef.page).getByRole("link", { name: "Tavoli", exact: true })).toHaveCount(0);
    await expect(nav(chef.page).getByRole("link", { name: "Menu", exact: true })).toHaveCount(0);
    await chef.page.goto("/tavoli");
    await expect(
      chef.page
        .locator("main")
        .getByRole("alert")
        .filter({ hasText: "I tavoli non sono disponibili per il tuo ruolo." }),
    ).toBeVisible();
    await expect(chef.page.locator("main")).not.toContainText("€");
    await expect(chef.page.locator("[data-table-id]")).toHaveCount(0);
    expect((await chef.page.request.get("/api/tables")).status()).toBe(403);
    expect((await chef.page.request.get("/api/menu")).status()).toBe(403);
    await chef.page.goto("/menu");
    await expect(
      chef.page
        .locator("main")
        .getByRole("alert")
        .filter({ hasText: "Il menu non è modificabile con il tuo ruolo." }),
    ).toBeVisible();
    await expect(chef.page.locator("main")).not.toContainText("€");
    await expectPhoneFriendly(chef.page);

    await Promise.all([a.context.close(), b.context.close(), chef.context.close()]);
  });
});

test.describe("menu and tables on a laptop (1280 px)", () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });
  test.setTimeout(120_000);

  test("the table grid has three columns and stays within the page column", async ({ page }) => {
    await signInWithMagicLink(page, createOwner());
    await seedTables(page, ["Tavolo 1 (demo)", "Tavolo 2 (demo)", "Tavolo 3 (demo)"]);
    for (const path of ["/tavoli", "/tavoli/impostazioni", "/menu"]) {
      await page.goto(path);
      await expect(page.getByRole("heading").first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    }
    await page.goto("/tavoli");
    const tiles = page.locator("[data-table-id]");
    await expect(tiles).toHaveCount(3);
    const boxes = await tiles.evaluateAll((els) =>
      els.map((el) => {
        const box = el.getBoundingClientRect();
        return { x: Math.round(box.x), right: Math.round(box.right), y: Math.round(box.y) };
      }),
    );
    expect(new Set(boxes.map((box) => box.x)).size).toBe(3);
    expect(new Set(boxes.map((box) => box.y)).size).toBe(1);
    const main = (await page.locator("main").boundingBox())!;
    for (const box of boxes) {
      expect(box.x).toBeGreaterThanOrEqual(Math.round(main.x));
      expect(box.right).toBeLessThanOrEqual(Math.round(main.x + main.width) + 1);
    }
  });
});
