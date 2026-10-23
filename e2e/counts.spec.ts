import { expect, test, type Page } from "@playwright/test";
import { venueDate } from "../src/lib/time/venue-date";
import { admin, seedCountStock, tenantIdOf } from "./helpers/seed-invoice";
import {
  createOwner,
  createStaff,
  expectPhoneFriendly,
  requireSupabaseStack,
  signInWithMagicLink,
} from "./helpers/session";

requireSupabaseStack();

// M13 acceptance tests on screen: the daily count of 20 critical ingredients on a phone (360 x 740, also with the
// keyboard open at 360 x 400) and the laptop layout (1280 x 800). The owner approves a seeded fake invoice (20
// ingredients, 5 kg each at 10,00 EUR/kg) through the real API; everything after that goes through the screens.
// Fake data only ("(demo)" names).
//   AT2 UI: only the five differences are recorded   AT4 UI: the activity log   AT6: one numeric input per item,
//   no horizontal scroll at 360 px   V6 UI: the chef sees no euro sign; the owner sees the variance in EUR
// A number in a page text is joined to its unit by a no-break space (U+00A0): the patterns below use \s.

/** The five lines counted differently: item number -> what the chef types (the rest is counted as expected, 5). */
const DIFFERENT = new Map([
  [3, "4,5"],
  [7, "5,25"],
  [11, "0"],
  [15, "6"],
  [19, "4,9"],
]);

const inputs = (page: Page) => page.getByRole("textbox");
const ledgerRows = (page: Page) => page.locator("ul.ledger > li");

/** Dark and light, as the other signed-in specs do. */
async function expectPhoneFriendlyBothThemes(page: Page) {
  await expectPhoneFriendly(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await expectPhoneFriendly(page);
  await page.emulateMedia({ colorScheme: "light" });
}

/** A signed-in owner whose tenant holds 20 ingredients of 5 kg each, approved into Cella. */
async function setup(page: Page) {
  const ownerEmail = createOwner();
  await signInWithMagicLink(page, ownerEmail);
  const tenantId = await tenantIdOf(page);
  const seeded = await seedCountStock(admin(), tenantId, venueDate(new Date()));
  const approved = await page.request.post(`/api/invoices/${seeded.invoiceId}/approve`, {
    data: {},
  });
  expect(approved.status()).toBe(200);
  return { ...seeded, tenantId, ownerEmail };
}

/** Signs the current browser out and in as someone else (or the owner) of the same tenant. */
async function signInAs(page: Page, email: string) {
  await page.context().clearCookies();
  await signInWithMagicLink(page, email);
}

/** The chef ticks the 20 ingredients; each tick is one PATCH, and the page's own count shows the server's answer. */
async function flagAll(page: Page) {
  await page.goto("/magazzino/conteggi/critici");
  await expect(page.getByRole("heading", { name: "Ingredienti critici" })).toBeVisible();
  const boxes = page.getByRole("checkbox");
  await expect(boxes).toHaveCount(20);
  for (let i = 0; i < 20; i += 1) {
    const [patch] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes("/api/counts/critical") &&
          response.request().method() === "PATCH",
      ),
      boxes.nth(i).click(),
    ]);
    expect(patch.status()).toBe(200);
    await expect(page.getByText(`Selezionati: ${i + 1}`, { exact: true })).toBeVisible();
  }
}

/** Types the 20 counts, Enter after each; the five different ones show their difference. */
async function enterCounts(page: Page) {
  await expect(inputs(page)).toHaveCount(20);
  for (let i = 0; i < 20; i += 1) {
    const field = inputs(page).nth(i);
    await field.fill(DIFFERENT.get(i + 1) ?? "5");
    if (i < 19) {
      await field.press("Enter");
      await expect(inputs(page).nth(i + 1)).toBeFocused();
    } else {
      await field.blur();
    }
  }
  await expect(page.getByText("20 di 20 contati", { exact: true })).toBeVisible();
}

test.describe("the daily count on a phone (360 px)", () => {
  test("the chef counts 20 items in one pass: one numeric input each, five differences, no euro sign; the owner then sees the variance in EUR, the reconciliation and the log", async ({
    page,
  }) => {
    const { tenantId, ownerEmail } = await setup(page);
    const chefEmail = await createStaff(tenantId, "chef");
    await signInAs(page, chefEmail);

    // The chef marks the 20 critical ingredients.
    await flagAll(page);
    await expectPhoneFriendlyBothThemes(page);

    // Starts the daily count: 20 rows, exactly one numeric input in each (AT6).
    await page.goto("/magazzino/conteggi");
    await expect(page.getByRole("link", { name: "Ingredienti critici (20)" })).toBeVisible();
    await page.getByRole("button", { name: "Conteggio giornaliero", exact: true }).click();
    await page.waitForURL(/\/magazzino\/conteggi\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "Conteggio giornaliero" })).toBeVisible();
    await expect(ledgerRows(page)).toHaveCount(20);
    await expect(inputs(page)).toHaveCount(20);
    for (const field of await inputs(page).all()) {
      await expect(field).toHaveAttribute("inputmode", "decimal");
    }
    await expect(page.getByLabel("Contato (kg)")).toHaveCount(20);
    await expect(ledgerRows(page).first()).toContainText(/Atteso\s5\skg/);
    expect(await page.locator("main").innerText()).not.toContain("€");
    await expectPhoneFriendlyBothThemes(page);

    // Enter moves to the next input; 15 are counted as expected and 5 differently, each showing its difference.
    await enterCounts(page);
    await expect(ledgerRows(page).nth(2)).toContainText(/Differenza\s−0,5\skg/);
    await expect(ledgerRows(page).nth(6)).toContainText(/Differenza\s\+0,25\skg/);
    await expect(ledgerRows(page).nth(10)).toContainText(/Differenza\s−5\skg/);
    await expect(ledgerRows(page).nth(0)).toContainText("Nessuna differenza");
    expect(await page.locator("main").innerText()).not.toContain("€");
    await expectPhoneFriendlyBothThemes(page);

    // Also with the keyboard open (a short window): still no sideways scroll.
    await page.setViewportSize({ width: 360, height: 400 });
    await expectPhoneFriendly(page);
    await page.setViewportSize({ width: 360, height: 740 });

    // Closing takes two taps; the second says what will be recorded (AT2 UI).
    await page.getByRole("button", { name: "Chiudi conteggio", exact: true }).click();
    await expect(page.getByText("Verranno registrate 5 differenze.")).toBeVisible();
    await expect(page.getByText("Il conteggio non si può annullare.")).toBeVisible();
    await page.getByRole("button", { name: "Conferma chiusura", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Conteggio chiuso: 5 differenze registrate." }),
    ).toBeVisible();
    await expectPhoneFriendly(page);

    // The variance for the chef: units only, five lines with a difference, twenty with "Tutti"; no euro sign.
    await page.getByRole("link", { name: "Scostamenti", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Scostamenti" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Solo differenze" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(ledgerRows(page)).toHaveCount(5);
    await page.getByRole("button", { name: "Tutti", exact: true }).click();
    await expect(ledgerRows(page)).toHaveCount(20);
    expect(await page.locator("main").innerText()).not.toContain("€");
    await expectPhoneFriendlyBothThemes(page);
    const sessionUrl = page.url();

    // The chef cannot read the activity log.
    await page.goto("/registro");
    await expect(page.getByRole("alert")).toHaveText(
      "Il registro non è disponibile per il tuo ruolo.",
    );

    // The owner sees the value in EUR on the same variance (V6 UI).
    await signInAs(page, ownerEmail);
    await page.goto(sessionUrl);
    await expect(page.getByRole("heading", { name: "Scostamenti" })).toBeVisible();
    await expect(page.getByText(/Perdite/)).toBeVisible();
    const main = page.locator("main");
    // dt and dd are adjacent in the markup: no whitespace between a label and its amount, a no-break space before the euro sign.
    // Losses: 0,5 + 5 + 0,1 kg at 10,00 EUR; surpluses: 0,25 + 1 kg.
    await expect(main).toContainText(/Perdite\s*−56,00\s€/);
    await expect(main).toContainText(/Eccedenze\s*12,50\s€/);
    await expect(main).toContainText(/Netto\s*−43,50\s€/);
    await expectPhoneFriendlyBothThemes(page);

    // The reconciliation of the month: every ingredient adds up and matches its count.
    await page.goto("/magazzino/riconciliazione");
    await expect(page.getByRole("heading", { name: "Riconciliazione" })).toBeVisible();
    await expect(ledgerRows(page)).toHaveCount(20);
    await expect(ledgerRows(page).filter({ hasText: "Quadra" })).toHaveCount(20);
    expect(await main.innerText()).not.toContain("€");
    await expectPhoneFriendlyBothThemes(page);

    // The activity log lists the closing with the chef's name and the time (AT4 UI).
    await page.goto("/registro");
    await expect(page.getByRole("heading", { name: "Registro attività" })).toBeVisible();
    const closing = ledgerRows(page).filter({ hasText: "Conteggio chiuso" });
    await expect(closing).toHaveCount(1);
    await expect(closing).toContainText(/\d{2}\/\d{2}\/\d{4}, \d{2}:\d{2} · chef Demo/);
    await expect(ledgerRows(page).filter({ hasText: "Ingrediente critico" })).toHaveCount(20);
    await expectPhoneFriendlyBothThemes(page);
  });

  test("the waiter sees one error on the counts and on the log", async ({ page }) => {
    const { tenantId } = await setup(page);
    await signInAs(page, await createStaff(tenantId, "waiter"));
    await page.goto("/magazzino/conteggi");
    await expect(page.getByRole("alert")).toHaveText(
      "I conteggi non sono disponibili per il tuo ruolo.",
    );
    await page.goto("/registro");
    await expect(page.getByRole("alert")).toHaveText(
      "Il registro non è disponibile per il tuo ruolo.",
    );
  });
});

test.describe("the counts on a laptop (1280 px)", () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

  test("the count screens stay within the page column", async ({ page }) => {
    const { tenantId } = await setup(page);
    await signInAs(page, await createStaff(tenantId, "chef"));
    await flagAll(page);
    await page.goto("/magazzino/conteggi");
    await page.getByRole("button", { name: "Conteggio giornaliero", exact: true }).click();
    await page.waitForURL(/\/magazzino\/conteggi\/[0-9a-f-]{36}$/);
    await expect(inputs(page)).toHaveCount(20);
    for (const path of [
      page.url(),
      "/magazzino/conteggi",
      "/magazzino/conteggi/critici",
      "/magazzino/riconciliazione",
    ]) {
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
