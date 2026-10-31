import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { main, newContext, openTableAndOrder, tab, dish } from "./helpers/order-ui";
import { createWaiter, WAITER_A, WAITER_B } from "./helpers/seed-menu-tables";
import { tenantIdOf } from "./helpers/seed-invoice";
import { PUSH_E2E_NAMES, seedPush, type PushSeed } from "./helpers/seed-push";
import {
  createOwner,
  createStaff,
  expectPhoneFriendly,
  requireSupabaseStack,
  signInWithMagicLink,
} from "./helpers/session";

requireSupabaseStack();

// M23 on a phone (360 x 740), Chromium only (`phone`; the `phone-webkit` project's testMatch does not include this file): the "Da spingere oggi" tile on
// Oggi, the list at /spingere, pushing a plate at 4,50 and the waiter's order screen, "Togli", the chef's read-only list and the forecast panel on
// /produzione. The owner's tenant is seeded through the real API in a beforeAll (a batch of 2 portions sold out, a batch of 5 portions with a
// shelf life of 20 hours, the plate and its menu item). The server clock cannot be moved here, so the batches are made to fall due within a day of now.
// Rows are found by data attributes, never by position; amounts are matched with \s+ (U+00A0 before the euro sign); every locator is scoped to `main`;
// no assertion rests on an exact sub-pixel value. Fake data only.
//   AT1  the sold-out batch is not on the list   AT4  the waiter's pinned strip shows the plate with 4,50 €   AT6  no cost or risk word for the waiter

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

const TILE = (page: Page) => page.locator('main [data-tile="pushList"]');

/** Dark and light, as the other signed-in specs do. */
async function expectPhoneFriendlyBothThemes(page: Page) {
  await expectPhoneFriendly(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await expectPhoneFriendly(page);
  await page.emulateMedia({ colorScheme: "light" });
}

let fixture: { email: string; tenantId: string; seed: PushSeed } | null = null;

// Serial mode re-runs this in a fresh worker after a failure, which seeds a new tenant: no test depends on another's leftovers except the push
// of "pushes the plate" (the next two tests read it, and the one after removes it).
test.beforeAll(async ({ browser }, testInfo) => {
  const { context, page } = await newContext(browser, testInfo.project.use);
  const waiterContext = await newContext(browser, testInfo.project.use);
  try {
    const email = createOwner();
    await signInWithMagicLink(page, email, "/");
    const tenantId = await tenantIdOf(page);
    await signInWithMagicLink(
      waiterContext.page,
      await createWaiter(tenantId, WAITER_A),
      "/tavoli",
    );
    fixture = { email, tenantId, seed: await seedPush(page, waiterContext.page, tenantId) };
  } finally {
    await waiterContext.context.close();
    await context.close();
  }
});

function seeded(): { email: string; tenantId: string; seed: PushSeed } {
  if (!fixture) throw new Error("The beforeAll seeding did not run");
  return fixture;
}

/** The owner (an independent session) pushes the plate at 4,50 through the API, so a test never depends on another test's leftovers. */
async function ownerPushes(browser: Browser, use: TestInfo["project"]["use"]): Promise<void> {
  const owner = await newContext(browser, use);
  try {
    await signInWithMagicLink(owner.page, seeded().email);
    const pushed = await owner.page.request.post(`/api/menu/${seeded().seed.pastaItemId}/push`, {
      data: { pushed: true, pushPrice: 4.5 },
    });
    expect(pushed.status(), await pushed.text()).toBe(200);
  } finally {
    await owner.context.close();
  }
}

const pushRow = (page: Page) =>
  main(page).locator(`[data-push-row-id="${seeded().seed.liveBatchId}"]`);

test.describe("the owner", () => {
  test("Oggi lists the due-soon batch and not the sold-out one; the link opens the list (AT1)", async ({
    page,
  }) => {
    await signInWithMagicLink(page, seeded().email);
    const { liveBatchId, soldBatchId } = seeded().seed;
    const tile = TILE(page);
    await expect(tile).toBeVisible();
    const live = tile.locator(`[data-push-row-id="${liveBatchId}"]`);
    await expect(live).toBeVisible();
    await expect(live).toContainText(PUSH_E2E_NAMES.sugo);
    await expect(live).toContainText("5 porzioni");
    await expect(live).toContainText("a rischio");
    // The tile has settled (its live row is there): the sold-out batch, at 0 portions, is absent.
    await expect(tile.locator(`[data-push-row-id="${soldBatchId}"]`)).toHaveCount(0);
    // The placeholder tile is gone.
    await expect(main(page).locator('[data-tile="comingSoon"]')).toHaveCount(0);

    await tile.getByRole("link", { name: "Apri la lista" }).click();
    await page.waitForURL((url) => url.pathname === "/spingere");
    await expect(page.getByRole("heading", { name: "Da spingere", exact: true })).toBeVisible();
    await expect(pushRow(page)).toBeVisible();
    await expect(main(page).locator(`[data-push-row-id="${soldBatchId}"]`)).toHaveCount(0);
  });

  test("pushes the plate at 4,50 from the sheet (AT4)", async ({ page }) => {
    await signInWithMagicLink(page, seeded().email);
    await page.goto("/spingere");
    const row = pushRow(page);
    await expect(row).toBeVisible();
    // A test that runs alone starts from a plate that is not pushed; after a retry it may already be.
    const remove = row.getByRole("button", { name: /^Togli/ });
    if ((await remove.count()) > 0) await remove.click();
    await row.getByRole("button", { name: /^Spingi oggi/ }).click();
    const sheet = main(page).getByRole("group", { name: PUSH_E2E_NAMES.pasta });
    await expect(sheet).toContainText(/Prezzo del menu: 9,00\s+€/);
    await sheet.getByRole("textbox", { name: /^Prezzo del giorno/ }).fill("4,50");
    await sheet.getByRole("button", { name: "Conferma", exact: true }).click();
    await expect(row).toContainText(/In evidenza fino alle\s+\d{2}:\d{2}\s+·\s+4,50\s+€/);
    await expect(row.getByRole("button", { name: /^Togli/ })).toBeVisible();
    await expect(sheet).toHaveCount(0);
  });

  test("a price above the menu price is refused in words", async ({ page }) => {
    await signInWithMagicLink(page, seeded().email);
    await page.goto("/spingere");
    const row = pushRow(page);
    await expect(row).toBeVisible();
    // Remove the push if there is one, then try 9,50 on a plate whose menu price is 9,00.
    const remove = row.getByRole("button", { name: /^Togli/ });
    if ((await remove.count()) > 0) await remove.click();
    await row.getByRole("button", { name: /^Spingi oggi/ }).click();
    const sheet = main(page).getByRole("group", { name: PUSH_E2E_NAMES.pasta });
    await sheet.getByRole("textbox", { name: /^Prezzo del giorno/ }).fill("9,50");
    await sheet.getByRole("button", { name: "Conferma", exact: true }).click();
    await expect(sheet).toContainText(/non può superare il prezzo del menu \(9,00\s+€\)/);
    // Then a price within the menu price is accepted.
    await sheet.getByRole("textbox", { name: /^Prezzo del giorno/ }).fill("4,50");
    await sheet.getByRole("button", { name: "Conferma", exact: true }).click();
    await expect(row).toContainText(/In evidenza fino alle\s+\d{2}:\d{2}\s+·\s+4,50\s+€/);
  });
});

test.describe("the waiter", () => {
  test("sees the pushed plate in the pinned strip with 4,50 and no cost or risk word (AT4, AT6)", async ({
    page,
    browser,
  }, testInfo) => {
    const { tenantId, seed } = seeded();
    await ownerPushes(browser, testInfo.project.use);
    await signInWithMagicLink(page, await createWaiter(tenantId, WAITER_B), "/tavoli");
    await openTableAndOrder(page, seed.freeTableIds[0]!);
    const strip = main(page).getByRole("region", { name: "Da proporre" });
    await expect(strip).toBeVisible();
    const pinned = strip.locator(`[data-pinned][data-menu-item-id="${seed.pastaItemId}"]`);
    await expect(pinned).toBeVisible();
    await expect(pinned).toContainText(/4,50\s+€/);
    await expect(main(page).locator("[data-pinned]")).toHaveCount(1);
    await expect(main(page)).not.toContainText(/rischio|costo/i);
  });

  test("gets 403 from the three reports of the list", async ({ page }) => {
    await signInWithMagicLink(
      page,
      await createWaiter(seeded().tenantId, "Cameriere Tre Demo"),
      "/tavoli",
    );
    for (const path of [
      "/api/reports/push-list",
      "/api/reports/forecast",
      "/api/reports/discards-vs-push",
    ]) {
      const refused = await page.request.get(path);
      expect(refused.status(), path).toBe(403);
    }
  });
});

test.describe("the owner removes the push", () => {
  test("'Togli' stops it: the plate is back to its place for the waiter", async ({
    page,
    browser,
  }, testInfo) => {
    await ownerPushes(browser, testInfo.project.use);
    await signInWithMagicLink(page, seeded().email);
    await page.goto("/spingere");
    const row = pushRow(page);
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: /^Togli/ }).click();
    await expect(row.getByRole("button", { name: /^Spingi oggi/ })).toBeVisible();
    await expect(row).not.toContainText("In evidenza fino alle");

    const { seed, tenantId } = seeded();
    const waiter = await newContext(browser, testInfo.project.use);
    try {
      await signInWithMagicLink(
        waiter.page,
        await createWaiter(tenantId, "Cameriere Quattro Demo"),
        "/tavoli",
      );
      await openTableAndOrder(waiter.page, seed.freeTableIds[1]!);
      // The menu has loaded (the dish is in its course panel); only then is "no pinned dish" worth asserting.
      await tab(waiter.page, /^Primi/).click();
      await expect(dish(waiter.page, seed.pastaItemId)).toBeVisible();
      await expect(main(waiter.page).locator("[data-pinned]")).toHaveCount(0);
      await waiter.page.reload();
      await tab(waiter.page, /^Primi/).click();
      await expect(dish(waiter.page, seed.pastaItemId)).toBeVisible();
      await expect(main(waiter.page).locator("[data-pinned]")).toHaveCount(0);
    } finally {
      await waiter.context.close();
    }
  });
});

test.describe("the chef", () => {
  test("reads the list with no euro and no button, and the forecast panel on Produzione", async ({
    page,
  }) => {
    const { tenantId, seed } = seeded();
    await signInWithMagicLink(page, await createStaff(tenantId, "chef"));
    await page.goto("/spingere");
    const row = pushRow(page);
    await expect(row).toBeVisible();
    await expect(row).toContainText("Chiedi al titolare di metterlo in evidenza");
    await expect(main(page).locator("[data-push-row-id] button")).toHaveCount(0);
    expect(await main(page).innerText()).not.toContain("€");
    await expect(main(page).locator(`[data-push-row-id="${seed.soldBatchId}"]`)).toHaveCount(0);

    await page.goto("/produzione");
    await expect(main(page).getByRole("heading", { name: /^Previsione per/ })).toBeVisible();
    await expect(main(page)).toContainText("Non ci sono ancora vendite di questo giorno.");
    await expect(main(page)).not.toContainText("Coperti attesi");
    expect(await main(page).innerText()).not.toContain("€");
  });
});

test.describe("on a phone", () => {
  test("the list, the sheet and the forecast panel fit 360 px, in light and dark", async ({
    page,
  }) => {
    await signInWithMagicLink(page, seeded().email);
    await page.goto("/spingere");
    const row = pushRow(page);
    await expect(row).toBeVisible();
    await expectPhoneFriendlyBothThemes(page);
    await row.getByRole("button", { name: /^Spingi oggi/ }).click();
    await expect(main(page).getByRole("group", { name: PUSH_E2E_NAMES.pasta })).toBeVisible();
    await expectPhoneFriendlyBothThemes(page);

    await page.goto("/produzione");
    await expect(main(page).getByRole("heading", { name: /^Previsione per/ })).toBeVisible();
    await expectPhoneFriendlyBothThemes(page);
  });
});
