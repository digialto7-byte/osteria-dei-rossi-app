import { expect, test, type Page } from "@playwright/test";
import { keysOf, seedPortionDish, WEIGHTED_NAME } from "./helpers/menu";
import { nextSync } from "./helpers/offline";
import { dish, lineRow, main, newContext, openTableAndOrder, send, tab } from "./helpers/order-ui";
import { tenantIdOf } from "./helpers/seed-invoice";
import { createWaiter, seedTables, WAITER_A } from "./helpers/seed-menu-tables";
import {
  createOwner,
  createStaff,
  expectPhoneFriendly,
  requireSupabaseStack,
  signInWithMagicLink,
} from "./helpers/session";

requireSupabaseStack();

// P2-0b (sell by weight) on a phone (project `phone`, 360 x 740). Fake data only: "Bistecca a peso (demo)" at 4,25 € per 100 g with a
// 400 g reference portion. Amounts are matched with \s+ (U+00A0 before the euro sign).
//   the owner switches a demo dish to "a peso" on the menu screen
//   the waiter opens Tavolo 2 (demo) with 2 covers, taps the dish, types 1230 ("= 1,23 kg"), confirms ("Confermi 1.230 g?": 1 230 g is
//     more than 3 x 400 g) and sees "1,23 kg · 4,25 € / 100 g" and, once the server has priced it, "Importo 52,28 €"
//   sent to the kitchen, the chef's screen reads "Bistecca a peso (demo) 1,23 kg" and shows no euro sign
//   the bill is split by 2 covers: two parts that add up to the total; the table is closed with a receipt number
//   as the waiter, GET /api/menu holds no cost key

test.describe("sell by weight on a phone (360 px)", () => {
  test.setTimeout(300_000);

  test("from the owner's switch to the closed table", async ({ page, browser }, testInfo) => {
    // --- The owner switches a dish to "a peso" ------------------------------------------------------------------------------
    await signInWithMagicLink(page, createOwner());
    const tenantId = await tenantIdOf(page);
    const dishId = await seedPortionDish(page);
    const tables = await seedTables(page, ["Tavolo 2 (demo)"]);
    const waiterEmail = await createWaiter(tenantId, WAITER_A);
    const chefEmail = await createStaff(tenantId, "chef");

    await page.goto("/menu");
    const card = page.getByRole("group", { name: WEIGHTED_NAME });
    await card.getByRole("button", { name: "Modifica" }).click();
    await page.getByLabel("Venduto a peso").check();
    await page.getByLabel("Prezzo per etto (100 g)").fill("4,25");
    await page.getByLabel(/^Porzione di riferimento \(g\)/).fill("400");
    await page.getByRole("button", { name: "Salva", exact: true }).click();
    await expect(page.getByText("Salvato.")).toBeVisible();
    await expect(
      page
        .getByRole("group", { name: WEIGHTED_NAME })
        .getByText(/4,25\s+€ \/ 100 g · porzione 400\s+g/),
    ).toBeVisible();

    // --- The waiter: the weight sheet -------------------------------------------------------------------------------------
    const waiter = await newContext(browser, testInfo.project.use);
    await signInWithMagicLink(waiter.page, waiterEmail, "/tavoli");
    const sessionId = await openTableAndOrder(waiter.page, tables["Tavolo 2 (demo)"]!, 2);
    await tab(waiter.page, /^Secondi/).click();
    const tile = dish(waiter.page, dishId);
    await expect(tile).toContainText(/4,25\s+€ \/ 100 g/);

    await tile.click();
    const sheet = waiter.page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByLabel(/^Peso \(g\)/)).toBeFocused();
    await expect(sheet.getByRole("button", { name: "Aggiungi", exact: true })).toBeDisabled();
    await sheet.getByLabel(/^Peso \(g\)/).fill("1230");
    await expect(sheet.getByTestId("weight-readout")).toHaveText(/= 1,23\s+kg/);
    await expectPhoneFriendly(waiter.page);

    await sheet.getByRole("button", { name: "Aggiungi", exact: true }).click();
    await expect(sheet).toContainText(/Confermi 1\.230\s+g\?/);
    const [added] = await Promise.all([
      nextSync(waiter.page),
      sheet.getByRole("button", { name: "Conferma", exact: true }).click(),
    ]);
    const reply = (await added.json()) as {
      results: {
        kind: string;
        status: string;
        reply?: { line?: { id: string; unitPrice: number } };
      }[];
    };
    const made = reply.results.find((result) => result.kind === "add_line");
    expect(made?.status).toBe("applied");
    const lineId = made!.reply!.line!.id;
    expect(made!.reply!.line!.unitPrice).toBe(52.28);

    await waiter.page.getByRole("button", { name: /^Comanda/ }).click();
    const row = lineRow(waiter.page, lineId);
    await expect(row).toContainText(/1,23\s+kg · 4,25\s+€ \/ 100 g/);
    await expect(row).toContainText(/Importo 52,28\s+€/);
    await expect(row).not.toContainText(/1 × /);

    // --- Sent to the kitchen: the chef reads the weight, no euro sign ------------------------------------------------------
    await send(waiter.page, sessionId, "Invia in cucina: Secondi, 1 piatto");
    const chef = await newContext(browser, testInfo.project.use);
    await signInWithMagicLink(chef.page, chefEmail);
    await chef.page.goto("/cucina");
    await expect(chef.page.locator(`[data-line-id="${lineId}"]`)).toContainText(
      /Bistecca a peso \(demo\) 1,23\s+kg/,
      { timeout: 30_000 },
    );
    expect(await chef.page.locator("main").innerText()).not.toContain("€");
    await chef.context.close();

    // --- The bill, split by the 2 covers, and the close --------------------------------------------------------------------
    await waiter.page.goto(`/tavoli/comanda?s=${sessionId}&vista=conto`);
    await expect(main(waiter.page)).toContainText(
      /Bistecca a peso \(demo\) 1,23\s+kg × 4,25\s+€ \/ 100 g/,
    );
    await expect(main(waiter.page)).toContainText(/52,28\s+€/);
    await waiter.page.getByRole("button", { name: "Dividi il conto" }).click();
    const part = (index: number) => waiter.page.locator(`[data-part-index="${index}"]`);
    await expect(part(1)).toContainText(/Quota 1 · 26,14\s+€/);
    await expect(part(2)).toContainText(/Quota 2 · 26,14\s+€/);

    await main(waiter.page).getByRole("button", { name: "Chiudi tavolo", exact: true }).click();
    await waiter.page.getByRole("radio", { name: "Scontrino" }).check();
    await waiter.page.getByRole("radio", { name: "Carta" }).check();
    await waiter.page.getByLabel(/^Numero/).fill("0012-0034");
    await waiter.page
      .locator("[data-close-sheet]")
      .getByRole("button", { name: "Chiudi tavolo", exact: true })
      .click();
    await expect(
      waiter.page.getByText("Tavolo chiuso · Scontrino 0012-0034 · Carta"),
    ).toBeVisible();

    // --- As the waiter, the menu reply holds no cost key ---------------------------------------------------------------------
    await assertNoCostKey(waiter.page);
    await waiter.context.close();
  });
});

async function assertNoCostKey(page: Page) {
  const reply = await page.request.get("/api/menu");
  expect(reply.status()).toBe(200);
  const json = (await reply.json()) as { weightMaxG: number };
  expect(json.weightMaxG).toBe(3000);
  expect(keysOf(json).filter((key) => /cost|margin|food|gp|vat|recipe/i.test(key))).toEqual([]);
}
