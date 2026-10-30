import { expect, test } from "@playwright/test";
import { newContext } from "./helpers/order-ui";
import { closeAs, seedAt2Table, seedClosingMenu, seedSmallTable } from "./helpers/seed-closing";
import { createWaiter, seedTables, WAITER_A } from "./helpers/seed-menu-tables";
import { tenantIdOf } from "./helpers/seed-invoice";
import {
  createOwner,
  expectPhoneFriendly,
  requireSupabaseStack,
  signInWithMagicLink,
} from "./helpers/session";

requireSupabaseStack();

// M21 on a phone (360 x 740), Chromium: the owner's end of the day. Fake data only.
//   AT1  the table closed without a number is in the list of the day
//   AT3  the register total saved on /chiusura shows the difference from the SAVE reply (no read of the report after the POST)
//   AT5  a waiter on /chiusura gets the refusal and no form
// Rows are found by data-session-id, amounts are matched with \s+ (U+00A0), minus signs are U+2212.

const REPORT = "/api/reports/app-vs-register";
const main = (page: import("@playwright/test").Page) => page.locator("main");

test.describe("the end of the day on a phone (360 px)", () => {
  test.setTimeout(300_000);

  test("the table without a number is listed, the register total shows the difference at once, a waiter is refused (AT1, AT3, AT5)", async ({
    page,
    browser,
  }, testInfo) => {
    await signInWithMagicLink(page, createOwner());
    const tenantId = await tenantIdOf(page);
    const menu = await seedClosingMenu(page);
    const tables = await seedTables(page, ["Tavolo 1 (demo)", "Tavolo 2 (demo)"]);

    const waiterEmail = await createWaiter(tenantId, WAITER_A);
    const waiter = await newContext(browser, testInfo.project.use);
    await signInWithMagicLink(waiter.page, waiterEmail, "/tavoli");
    const at2 = await seedAt2Table(waiter.page, tables["Tavolo 1 (demo)"]!, menu);
    const small = await seedSmallTable(waiter.page, tables["Tavolo 2 (demo)"]!, menu);
    await closeAs(waiter.page, at2.sessionId, {
      receiptType: "scontrino",
      receiptNumber: null,
      paymentType: "card",
    });
    await closeAs(waiter.page, small, {
      receiptType: "scontrino",
      receiptNumber: "0012-0034",
      paymentType: "cash",
    });

    await page.goto("/chiusura");
    await expect(page.getByRole("heading", { name: "Chiusura di cassa" })).toBeVisible();
    await expect(main(page)).toContainText(/Totale app 107,00\s+€ · 2 tavoli · 5 coperti/);
    // AT1: the AT2 table has no number, the other one has.
    await expect(page.locator(`[data-session-id="${at2.sessionId}"]`)).toContainText(
      /Tavolo 1 \(demo\) · \d\d:\d\d · .* · 100,00\s+€ · Carta/,
    );
    await expect(page.locator(`[data-session-id="${small}"]`)).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Tavoli chiusi senza numero di scontrino (1)" }),
    ).toBeVisible();
    await expect(
      page.getByText("Inserisci il totale della cassa per vedere la differenza"),
    ).toBeVisible();
    await expect(main(page)).not.toContainText(/Costo|Margine|Food cost/);
    await expectPhoneFriendly(page);

    // AT3: 107,00 in the app against 1.234,50 at the register; the difference comes from the reply of the save.
    const reads: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "GET" && new URL(request.url()).pathname === REPORT)
        reads.push(request.url());
    });
    await page.getByLabel("Totale del registratore di cassa").fill("1.234,50");
    const [saved] = await Promise.all([
      page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/api/day-close" && r.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Salva" }).click(),
    ]);
    expect(saved.status()).toBe(200);
    await expect(main(page)).toContainText(/L'app registra 1\.127,50\s+€ in meno della cassa/);
    await expect(main(page)).toContainText("\u22121.127,50");
    await expect(main(page)).toContainText(/Inserito da .* alle \d\d:\d\d/);
    expect(reads, "the report is not read again after the save").toEqual([]);

    // AT5: a waiter is refused and gets no form.
    await waiter.page.goto("/chiusura");
    await expect(waiter.page.getByRole("alert")).toContainText(
      "La chiusura di cassa è riservata al titolare.",
    );
    await expect(waiter.page.getByLabel("Totale del registratore di cassa")).toHaveCount(0);
    await waiter.context.close();
  });
});
