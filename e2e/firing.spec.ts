import { expect, test, type Page } from "@playwright/test";
import { tenantIdOf } from "./helpers/seed-invoice";
import { seedFiringCatalogue } from "./helpers/seed-firing";
import { createWaiter, seedTables, WAITER_A } from "./helpers/seed-menu-tables";
import { nextSync } from "./helpers/offline";
import {
  bar,
  dish,
  lineRow,
  main,
  newContext,
  openTableAndOrder,
  send,
  tab,
  tapDish,
} from "./helpers/order-ui";
import {
  createOwner,
  expectPhoneFriendly,
  requireSupabaseStack,
  signInWithMagicLink,
} from "./helpers/session";

requireSupabaseStack();

// M19 on a phone (360 x 740), in Chromium (project `phone`) and in WebKit (project `phone-webkit`): the waiter sends a course
// to the kitchen and voids a sent dish. The owner seeds the menu through the API (a ragù batch of 4 portions behind
// "Tagliatelle al ragù (demo)"); one waiter takes the order of Tavolo 1 (demo): two tagliatelle and one "Zuppa del giorno
// (demo)" marked "Segue". Fake data only ("(demo)" names).
//   "Invia primi · 2" sends both tagliatelle (the soup, a segue dish, stays a draft and editable); the menu then says
//   "Ne restano 2"; "Invia a seguire · 1" sends the soup; "Storna" with a reason strikes a tagliatelle line through.
//   The waiter reads sale prices and no cost word; the targets stay at least 44 px with the void dialog open, in both themes.

/** Dark and light, as the other signed-in specs do. */
async function expectPhoneFriendlyBothThemes(page: Page) {
  await expectPhoneFriendly(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await expectPhoneFriendly(page);
  await page.emulateMedia({ colorScheme: "light" });
}

test.describe("sending and voiding on a phone (360 px)", () => {
  test.setTimeout(300_000);

  test("a waiter sends a course, then the segue dish, then voids a sent dish (AT6 UI)", async ({
    page,
    browser,
  }, testInfo) => {
    await signInWithMagicLink(page, createOwner());
    const tenantId = await tenantIdOf(page);
    const ids = await seedFiringCatalogue(page, tenantId);
    const tables = await seedTables(page, ["Tavolo 1 (demo)"]);

    const a = await newContext(browser, testInfo.project.use);
    await signInWithMagicLink(a.page, await createWaiter(tenantId, WAITER_A), "/tavoli");
    const sessionId = await openTableAndOrder(a.page, tables["Tavolo 1 (demo)"]!);
    // The comanda is a focus route: no tab bar and no section row. The waiter has one group anyway, so wait for /api/me
    // and the network to settle before counting, or the absence could never fail.
    await a.page.waitForLoadState("networkidle");
    await expect(a.page.getByRole("navigation", { name: "Sezioni" })).toHaveCount(0);
    await expect(a.page.getByRole("navigation", { name: "Menu principale" })).toHaveCount(0);

    // Two tagliatelle and one soup, marked "Segue", all primi.
    await tab(a.page, /^Primi/).click();
    const pasta = [
      await tapDish(a.page, sessionId, dish(a.page, ids.tagliatelle)),
      await tapDish(a.page, sessionId, dish(a.page, ids.tagliatelle)),
    ];
    const soup = await tapDish(a.page, sessionId, dish(a.page, ids.zuppa));
    await bar(a.page).click();
    await lineRow(a.page, soup)
      .getByRole("button", { name: /^Modifica/ })
      .click();
    const [patched] = await Promise.all([
      nextSync(a.page),
      lineRow(a.page, soup).getByRole("button", { name: "Segue", exact: true }).click(),
    ]);
    expect(patched.status()).toBe(200);
    await lineRow(a.page, soup).getByRole("button", { name: "Fatto", exact: true }).click();

    // "Invia primi · 2" sends the two tagliatelle.
    await expect(
      a.page.getByRole("button", { name: "Invia in cucina: Primi, 2 piatti" }),
    ).toContainText("Invia primi · 2");
    const first = await send(a.page, sessionId, "Invia in cucina: Primi, 2 piatti");
    expect([...first.fired].sort()).toEqual([...pasta].sort());
    expect(first.skipped).toEqual([]);
    for (const id of pasta) {
      await expect(lineRow(a.page, id)).toContainText("In cucina");
      await expect(lineRow(a.page, id).getByRole("button", { name: /^Modifica/ })).toHaveCount(0);
    }
    // The soup is a segue dish: still a draft, still editable.
    await expect(lineRow(a.page, soup).getByRole("button", { name: /^Modifica/ })).toBeVisible();
    await expect(lineRow(a.page, soup)).not.toContainText("In cucina");

    // After the next menu read the tagliatelle say how many are left (4 made, 2 sent).
    await a.page.reload();
    await tab(a.page, /^Primi/).click();
    await expect(dish(a.page, ids.tagliatelle)).toContainText(/Ne restano\s+2/);
    await bar(a.page).click();

    // "Invia a seguire · 1" sends the soup.
    const second = await send(a.page, sessionId, "Invia in cucina: Primi a seguire, 1 piatto");
    expect(second.fired).toEqual([soup]);
    await expect(lineRow(a.page, soup)).toContainText("In cucina");

    // "Storna" on one tagliatelle: a reason is needed; the dialog is measured in both themes first.
    const voided = pasta[0]!;
    await lineRow(a.page, voided)
      .getByRole("button", { name: /^Storna/ })
      .click();
    const reason = lineRow(a.page, voided).getByRole("combobox", { name: /^Motivo\b/ });
    await expect(reason).toHaveValue("");
    const confirm = lineRow(a.page, voided).getByRole("button", {
      name: "Storna piatto",
      exact: true,
    });
    await expect(confirm).toBeDisabled();
    await expectPhoneFriendlyBothThemes(a.page);
    await reason.selectOption({ label: "Errore in cucina" });
    await expect(confirm).toBeEnabled();
    // The void is a queued operation (M20): the line says "Storno in coda" until POST /api/sync has carried it.
    const [reply] = await Promise.all([nextSync(a.page), confirm.click()]);
    expect(reply.status()).toBe(200);
    expect(
      ((await reply.json()) as { results: { kind: string; status: string }[] }).results.find(
        (result) => result.kind === "void_line",
      )?.status,
    ).toBe("applied");
    await expect(lineRow(a.page, voided)).toContainText("Stornato");
    await expect(lineRow(a.page, pasta[1]!)).not.toContainText("Stornato");

    // The waiter reads sale prices and nothing of cost.
    expect(await main(a.page).innerText()).not.toMatch(/Costo|Margine|Food cost/);
    await a.context.close();
  });
});
