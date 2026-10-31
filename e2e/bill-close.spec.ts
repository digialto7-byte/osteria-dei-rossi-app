import { expect, test, type Page } from "@playwright/test";
import { main, newContext } from "./helpers/order-ui";
import { seedAt2Table, seedClosingMenu, seedSmallTable } from "./helpers/seed-closing";
import { createWaiter, seedTables, WAITER_A } from "./helpers/seed-menu-tables";
import { tenantIdOf } from "./helpers/seed-invoice";
import {
  createOwner,
  expectPhoneFriendly,
  requireSupabaseStack,
  signInWithMagicLink,
} from "./helpers/session";

requireSupabaseStack();

// M21 on a phone (360 x 740), Chromium (`phone`) and WebKit (`phone-webkit`): the waiter's bill, the split and the close. Fake data only.
//   AT2  the AT2 table (28,00 + 7,00 + 18,75 + 40,25 + coperto 6,00) is 100,00 €; by 3 covers it is 33,34 + 33,33 + 33,33
//   AT1  closing with an empty number says "Chiudi senza numero" and the table is closed and flagged
//   the close is off while the phone has no connection, and on again when it is back
// The amounts are matched with \s+ (U+00A0 before the euro sign) and every part is found by its data-part-index, never by position.

/** Dark and light, as the other signed-in specs do. */
async function expectPhoneFriendlyBothThemes(page: Page) {
  await expectPhoneFriendly(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await expectPhoneFriendly(page);
  await page.emulateMedia({ colorScheme: "light" });
}

const part = (page: Page, index: number) => page.locator(`[data-part-index="${index}"]`);
const billUrl = (sessionId: string) => `/tavoli/comanda?s=${sessionId}&vista=conto`;

test.describe("the bill and the close on a phone (360 px)", () => {
  test.setTimeout(300_000);

  test("the AT2 bill, its split by covers, and a close without a number (AT1, AT2)", async ({
    page,
    browser,
  }, testInfo) => {
    await signInWithMagicLink(page, createOwner());
    const tenantId = await tenantIdOf(page);
    const menu = await seedClosingMenu(page);
    const tables = await seedTables(page, ["Tavolo 1 (demo)"]);

    const waiter = await newContext(browser, testInfo.project.use);
    await signInWithMagicLink(waiter.page, await createWaiter(tenantId, WAITER_A), "/tavoli");
    const { sessionId } = await seedAt2Table(waiter.page, tables["Tavolo 1 (demo)"]!, menu);

    await waiter.page.goto(billUrl(sessionId));
    await expect(waiter.page.getByText("Totale (IVA inclusa)")).toBeVisible();
    await expect(main(waiter.page)).toContainText(/100,00\s+€/);
    await expect(main(waiter.page)).toContainText(/Coperto · 3 × 2,00\s+€/);
    await expect(main(waiter.page)).toContainText("½ × Spezzatino con polenta (demo)");
    await expect(main(waiter.page)).not.toContainText(/Costo|Margine|Food cost/);

    // AT2: 100,00 € by 3 covers.
    await waiter.page.getByRole("button", { name: "Dividi il conto" }).click();
    await expect(part(waiter.page, 1)).toContainText(/Quota 1 · 33,34\s+€/);
    await expect(part(waiter.page, 2)).toContainText(/Quota 2 · 33,33\s+€/);
    await expect(part(waiter.page, 3)).toContainText(/Quota 3 · 33,33\s+€/);

    // AT1: no number, "Chiudi senza numero", Carta.
    await waiter.page.getByRole("button", { name: "Chiudi tavolo" }).click();
    const sheet = main(waiter.page);
    await expect(waiter.page.getByRole("button", { name: "Chiudi senza numero" })).toBeDisabled();
    await waiter.page.getByRole("radio", { name: "Scontrino" }).check();
    await waiter.page.getByRole("radio", { name: "Carta" }).check();
    await expect(sheet).toContainText("Il tavolo sarà segnalato nella chiusura di cassa.");
    await expectPhoneFriendlyBothThemes(waiter.page);
    await waiter.page.getByRole("button", { name: "Chiudi senza numero" }).click();
    await expect(waiter.page.getByText("Tavolo chiuso · senza numero di scontrino")).toBeVisible();
    await expect(waiter.page.getByRole("link", { name: "Torna ai tavoli" })).toBeVisible();
    await expect(main(waiter.page)).not.toContainText(/Costo|Margine|Food cost/);
    await waiter.context.close();
  });

  test("a close is off without a connection and on again with it", async ({
    page,
    browser,
  }, testInfo) => {
    await signInWithMagicLink(page, createOwner());
    const tenantId = await tenantIdOf(page);
    const menu = await seedClosingMenu(page);
    const tables = await seedTables(page, ["Tavolo 2 (demo)"]);

    const waiter = await newContext(browser, testInfo.project.use);
    await signInWithMagicLink(waiter.page, await createWaiter(tenantId, WAITER_A), "/tavoli");
    const sessionId = await seedSmallTable(waiter.page, tables["Tavolo 2 (demo)"]!, menu);

    await waiter.page.goto(billUrl(sessionId));
    await expect(main(waiter.page)).toContainText(/7,00\s+€/);
    await waiter.page.getByRole("button", { name: "Chiudi tavolo" }).click();
    await waiter.page.getByRole("radio", { name: "Scontrino" }).check();
    await waiter.page.getByRole("radio", { name: "Contanti" }).check();
    await waiter.page.getByLabel(/^Numero/).fill("0012-0034");
    const close = waiter.page
      .locator("[data-close-sheet]")
      .getByRole("button", { name: "Chiudi tavolo" });
    await expect(close).toBeEnabled();

    await waiter.context.setOffline(true);
    await expect(waiter.page.getByText("Serve la connessione per chiudere il tavolo.")).toBeVisible(
      {
        timeout: 15_000,
      },
    );
    await expect(close).toBeDisabled();

    await waiter.context.setOffline(false);
    await expect(close).toBeEnabled({ timeout: 30_000 });
    await close.click();
    await expect(
      waiter.page.getByText("Tavolo chiuso · Scontrino 0012-0034 · Contanti"),
    ).toBeVisible();
    await waiter.context.close();
  });
});
