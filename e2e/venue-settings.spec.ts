import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { closeContexts, main, newContext } from "./helpers/order-ui";
import { seedClosingMenu, seedSmallTable } from "./helpers/seed-closing";
import { createWaiter, seedTables, WAITER_A } from "./helpers/seed-menu-tables";
import { tenantIdOf } from "./helpers/seed-invoice";
import { createOwner, requireSupabaseStack, signInWithMagicLink } from "./helpers/session";

requireSupabaseStack();

// SP1 step 18 on a phone: the close sheet reads the tenant's receipt and payment lists from /api/me, and the page language follows the
// tenant's locale. Fake data only. Both tenants are made per run by createOwner(), so no run reads another's rows.
//   tenant #1 shape  the default lists (scontrino and fattura; contanti, carta and altro): the sheet shows what it showed before SP1
//   second tenant    `fattura` made inactive through PATCH /api/settings/venue: the sheet offers Scontrino only
//   both             document.documentElement.lang is "it"

/** As the owner: one open table with one sent dish, then the waiter's close sheet on it. */
async function openCloseSheet(
  owner: Page,
  waiterPage: Page,
  tableName: string,
  tenantId: string,
): Promise<void> {
  const menu = await seedClosingMenu(owner);
  const tables = await seedTables(owner, [tableName]);
  await signInWithMagicLink(waiterPage, await createWaiter(tenantId, WAITER_A), "/tavoli");
  const sessionId = await seedSmallTable(waiterPage, tables[tableName]!, menu);
  await waiterPage.goto(`/tavoli/comanda?s=${sessionId}&vista=conto`);
  await main(waiterPage).getByRole("button", { name: "Chiudi tavolo", exact: true }).click();
}

// The waiter's context is closed after each test, also when it fails (with the page's aria snapshot attached).
const opened: BrowserContext[] = [];
test.afterEach(({}, testInfo) => closeContexts(opened, testInfo));

test.describe("venue settings on the close sheet (360 px)", () => {
  test.setTimeout(300_000);

  test("a tenant with the default lists shows Scontrino, Fattura and the three payments, in Italian", async ({
    page,
    browser,
  }, testInfo) => {
    await signInWithMagicLink(page, createOwner());
    const tenantId = await tenantIdOf(page);
    const waiter = await newContext(browser, testInfo.project.use);
    opened.push(waiter.context);
    await openCloseSheet(page, waiter.page, "Tavolo 1 (demo)", tenantId);

    const sheet = waiter.page.locator("[data-close-sheet]");
    await expect(sheet.getByRole("radio", { name: "Scontrino" })).toBeVisible();
    await expect(sheet.getByRole("radio", { name: "Fattura" })).toBeVisible();
    await expect(sheet.getByRole("radio", { name: "Contanti" })).toBeVisible();
    await expect(sheet.getByRole("radio", { name: "Carta" })).toBeVisible();
    await expect(sheet.getByRole("radio", { name: "Altro" })).toBeVisible();
    await expect(waiter.page.locator("html")).toHaveAttribute("lang", "it");
  });

  test("a tenant with fattura inactive shows one receipt option, in Italian", async ({
    page,
    browser,
  }, testInfo) => {
    await signInWithMagicLink(page, createOwner());
    const tenantId = await tenantIdOf(page);
    const set = await page.request.patch("/api/settings/venue", {
      data: { receiptTypes: ["scontrino"] },
    });
    expect(set.status(), await set.text()).toBe(200);
    const waiter = await newContext(browser, testInfo.project.use);
    opened.push(waiter.context);
    await openCloseSheet(page, waiter.page, "Tavolo 2 (demo)", tenantId);

    const sheet = waiter.page.locator("[data-close-sheet]");
    await expect(sheet.getByRole("radio", { name: "Scontrino" })).toBeVisible();
    await expect(sheet.getByRole("radio", { name: "Fattura" })).toHaveCount(0);
    await expect(sheet.getByRole("radio", { name: "Contanti" })).toBeVisible();
    await expect(waiter.page.locator("html")).toHaveAttribute("lang", "it");
  });
});
