import { expect, test, type Page } from "@playwright/test";
import { addDays, venueDate } from "../src/lib/time/venue-date";
import { admin, seedStockInvoice, tenantIdOf } from "./helpers/seed-invoice";
import {
  createOwner,
  createStaff,
  expectPhoneFriendly,
  requireSupabaseStack,
  signInWithMagicLink,
} from "./helpers/session";

requireSupabaseStack();

// M12 acceptance tests on screen: raw stock on a phone (360 x 740) and the laptop layout (1280 x 800). The owner
// approves a seeded fake invoice (beef lots L-D5, L-D2 and L-NONE, 2 kg each, 10,00 EUR/kg) through the real API;
// everything after that goes through the screens. Fake data only ("(demo)" names).
//   AT1 UI: the lots in FEFO order   AT3 UI: the waste in EUR   AT4 UI: a transfer   AT5 UI: "Annulla"
//   AT6 UI: negative stock and its alert   AT7 UI: the waiter   V6 UI: the chef sees no euro sign anywhere

const BEEF = "Manzo muscolo (demo)";
const nav = (page: Page) => page.getByRole("navigation", { name: "Menu principale" });
const saved = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });
const lotList = (page: Page) => page.locator("ul.ledger").first();
const historyItem = (page: Page, text: string) =>
  page.getByRole("listitem").filter({ hasText: text });
const wasteForm = (page: Page) => page.getByRole("form", { name: "Registra spreco" });
const transferForm = (page: Page) => page.getByRole("form", { name: "Sposta tra ubicazioni" });

/** Dark and light, as the other signed-in specs do. */
async function expectPhoneFriendlyBothThemes(page: Page) {
  await expectPhoneFriendly(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await expectPhoneFriendly(page);
  await page.emulateMedia({ colorScheme: "light" });
}

/** No euro sign anywhere in the main column (Q16 = V6), also inside field values. */
async function expectNoEuro(page: Page) {
  expect(await page.locator("main").innerText()).not.toContain("€");
  const values = await page
    .locator("main input, main select")
    .evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
  expect(values.join(" ")).not.toContain("€");
}

/** A signed-in owner whose tenant holds the three beef lots, approved into Cella. */
async function setup(page: Page) {
  const ownerEmail = createOwner();
  await signInWithMagicLink(page, ownerEmail);
  const tenantId = await tenantIdOf(page);
  const today = venueDate(new Date());
  const seeded = await seedStockInvoice(admin(), tenantId, today, addDays);
  const approved = await page.request.post(`/api/invoices/${seeded.invoiceId}/approve`, {
    data: { locationId: seeded.cellaId },
  });
  expect(approved.status()).toBe(200);
  return { ...seeded, tenantId, ownerEmail, today };
}

/** Signs the current browser out and in as someone else (or the owner) of the same tenant. */
async function signInAs(page: Page, email: string, landing: "/" | "/tavoli" = "/") {
  await page.context().clearCookies();
  await signInWithMagicLink(page, email, landing);
}

test.describe("raw stock on a phone (360 px)", () => {
  test("the chef: FEFO order, waste, reversal, transfer and negative stock, never a euro sign; the owner then sees the waste in EUR", async ({
    page,
  }) => {
    const { tenantId, ownerEmail, today, ingredientId } = await setup(page);
    await signInAs(page, await createStaff(tenantId, "chef"));

    // The list: the tab, the ingredient and its total (6 kg), and no euro sign (V6 UI).
    await page.goto("/magazzino");
    await expect(page.getByRole("heading", { name: "Magazzino", exact: true })).toBeVisible();
    await expect(nav(page).getByRole("link", { name: "Magazzino", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    const row = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("link", { name: BEEF, exact: true }) });
    await expect(row).toContainText("6 kg");
    await expect(page.getByRole("link", { name: "Sprechi in €" })).toHaveCount(0);
    await expectNoEuro(page);
    await expectPhoneFriendlyBothThemes(page);

    // The detail: lots first-expiring first (AT1 UI).
    await row.getByRole("link", { name: BEEF, exact: true }).click();
    await expect(page.getByRole("heading", { name: BEEF })).toBeVisible();
    await expect(lotList(page).getByRole("listitem")).toHaveText([/L-D2/, /L-D5/, /L-NONE/]);
    await expect(lotList(page).getByRole("listitem").nth(0)).toContainText(
      new RegExp(`Scade il ${addDays(today, 2).split("-").reverse().join("/")}`),
    );
    await expect(lotList(page).getByRole("listitem").nth(2)).toContainText("Senza scadenza");
    await expect(page.getByTestId("fact-on-hand")).toHaveText("6 kg");
    await expectNoEuro(page);
    await expectPhoneFriendlyBothThemes(page);

    // Waste of 1 kg, "Deteriorato": the first-expiring lot loses it.
    const waste = wasteForm(page);
    await expect(waste.getByLabel("Ubicazione")).toBeVisible();
    await expect(waste.getByLabel("Lotto")).toContainText("Primo in scadenza (consigliato)");
    await waste.getByLabel("Quantità").fill("1");
    await waste.getByLabel("Motivo").selectOption("spoilage");
    await waste.getByRole("button", { name: "Registra spreco", exact: true }).click();
    await expect(saved(page, "Spreco registrato.")).toBeVisible();
    await expect(lotList(page).getByRole("listitem").nth(0)).toContainText("1 kg di 2 kg ricevuti");
    await expect(page.getByTestId("fact-on-hand")).toHaveText("5 kg");
    await expectNoEuro(page);

    // "Annulla" in two taps (AT5 UI): the lot is back to 2 kg and both operations stay in the history.
    const spoiled = historyItem(page, "Deteriorato");
    await spoiled.getByRole("button", { name: "Annulla", exact: true }).click();
    await expect(page.getByText("Il movimento resta nello storico")).toBeVisible();
    await expectPhoneFriendlyBothThemes(page);
    await spoiled.getByRole("button", { name: "Conferma annullamento", exact: true }).click();
    await expect(saved(page, "Movimento annullato.")).toBeVisible();
    await expect(lotList(page).getByRole("listitem").nth(0)).toContainText("2 kg di 2 kg ricevuti");
    await expect(page.getByTestId("fact-on-hand")).toHaveText("6 kg");
    // Both operations carry the reason; the original says "Annullato", the mirror is an "Annullamento".
    await expect(historyItem(page, "Deteriorato").filter({ hasText: "Annullato" })).toHaveCount(1);
    await expect(historyItem(page, "Deteriorato").filter({ hasText: "Annullamento" })).toHaveCount(
      1,
    );
    await expect(page.getByRole("button", { name: "Annulla", exact: true })).toHaveCount(0);

    // A transfer of 2 kg Cella -> Freezer (AT4 UI): the locations change, the total stays.
    const transfer = transferForm(page);
    await transfer.getByLabel("Quantità").fill("2");
    await transfer.getByRole("button", { name: "Sposta", exact: true }).click();
    await expect(saved(page, "Spostamento registrato.")).toBeVisible();
    await expect(page.getByTestId("fact-on-hand")).toHaveText("6 kg");
    await expect(page.locator("dl").first()).toContainText(/Cella \(demo\)\s*4\s+kg/);
    await expect(page.locator("dl").first()).toContainText(/Freezer \(demo\)\s*2\s+kg/);
    await expect(historyItem(page, "Spostamento")).toHaveCount(1);

    // Waste beyond the stock (AT6 UI): recorded, negative, with the note, the badge and the alert.
    await waste.getByLabel("Quantità").fill("10");
    await waste.getByLabel("Motivo").selectOption("expired");
    await waste.getByRole("button", { name: "Registra spreco", exact: true }).click();
    await expect(saved(page, "Spreco registrato.")).toBeVisible();
    await expect(
      saved(page, "La giacenza in Cella (demo) è negativa: −6 kg. Fai un conteggio"),
    ).toBeVisible();
    await expect(page.getByTestId("fact-on-hand")).toHaveText("−4 kg");
    await expectNoEuro(page);
    await expectPhoneFriendlyBothThemes(page);
    await page.goto("/magazzino");
    await expect(row).toContainText("Scorta negativa");
    await expect(row).toContainText("senza lotto: fai un conteggio");
    await page.goto("/avvisi");
    await expect(
      page.getByRole("listitem").filter({ hasText: `Scorta negativa: ${BEEF}` }),
    ).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "Cella (demo)" })).toBeVisible();

    // The chef is refused the waste in EUR, on screen and in the API.
    await page.goto("/magazzino/sprechi");
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "I valori degli sprechi non sono disponibili per il tuo ruolo." }),
    ).toBeVisible();
    expect((await page.request.get("/api/stock/waste-costs")).status()).toBe(403);

    // The owner sees the waste in EUR (AT3 UI): the reversed 1 kg nets to nothing, 10 kg at 10,00 EUR/kg.
    await signInAs(page, ownerEmail);
    await page.goto("/magazzino");
    await page.getByRole("link", { name: "Sprechi in €" }).click();
    await expect(page.getByRole("heading", { name: "Sprechi in €", exact: true })).toBeVisible();
    await expect(page.getByTestId("fact-waste-total")).toHaveText("100,00 €");
    await expect(page.getByText("Scaduto · 100,00 €")).toBeVisible();
    await expect(page.getByText(`${BEEF} 10 kg · 100,00 €`)).toBeVisible();
    await expect(page.getByLabel("Dal", { exact: true })).toHaveValue(/^\d{4}-\d{2}-01$/);
    await expectPhoneFriendlyBothThemes(page);
    // The owner's ingredient page carries no euro sign either: the value lives on that one screen.
    await page.goto(`/magazzino/${ingredientId}`);
    await expect(page.getByRole("heading", { name: BEEF })).toBeVisible();
    await expectNoEuro(page);
  });

  test("the waiter has no Magazzino tab and is refused on the screen and in the API (AT7 on screen)", async ({
    page,
  }) => {
    const { tenantId, ingredientId } = await setup(page);
    await signInAs(page, await createStaff(tenantId, "waiter"), "/tavoli");

    await page.goto("/magazzino");
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Il magazzino non è disponibile per il tuo ruolo." }),
    ).toBeVisible();
    // The waiter has no navigation at all, so a check on the nav alone could never fail: count every anchor.
    await page.waitForLoadState("networkidle");
    await expect(page.locator('a[href="/magazzino"]')).toHaveCount(0);
    await expect(page.getByRole("listitem")).toHaveCount(0);

    expect((await page.request.get("/api/stock")).status()).toBe(403);
    expect((await page.request.get(`/api/stock/lots?ingredient=${ingredientId}`)).status()).toBe(
      403,
    );
    expect(
      (await page.request.get(`/api/stock/movements?ingredient=${ingredientId}`)).status(),
    ).toBe(403);
    expect((await page.request.get("/api/stock/waste-costs")).status()).toBe(403);
    const posted = await page.request.post("/api/stock/waste", {
      data: { ingredientId, qty: 1, unit: "kg", reason: "spoilage" },
    });
    expect(posted.status()).toBe(403);
    await expectPhoneFriendly(page);
  });
});

test.describe("raw stock on a laptop (1280 px)", () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

  test("the stock screens stay within the page column", async ({ page }) => {
    const { ingredientId } = await setup(page);
    for (const path of ["/magazzino", `/magazzino/${ingredientId}`, "/magazzino/sprechi"]) {
      await page.goto(path);
      await expect(page.getByRole("heading").first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      const main = (await page.locator("main").boundingBox())!;
      const content = (await page.locator("main > *").last().boundingBox())!;
      expect(content.x).toBeGreaterThanOrEqual(main.x);
      expect(content.x + content.width).toBeLessThanOrEqual(main.x + main.width + 1);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    }
  });
});
