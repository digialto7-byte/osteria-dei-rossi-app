import { expect, test, type Page } from "@playwright/test";
import { addDays, venueDate } from "../src/lib/time/venue-date";
import { RAGU, seedRaguRecipe } from "./helpers/seed-recipe";
import { admin, seedInvoice, seedLocation, seedSupplier, tenantIdOf } from "./helpers/seed-invoice";
import {
  createOwner,
  createStaff,
  expectPhoneFriendly,
  requireSupabaseStack,
  signInWithMagicLink,
} from "./helpers/session";

requireSupabaseStack();

// M15 acceptance tests on screen: batch actions, the staff meal and the waste report on a phone (360 x 740) and the
// laptop layout (1280 x 800). The owner approves a seeded fake invoice (beef lots, 6 kg at 10,00 EUR/kg, into "Cella
// (demo)") and creates the Ragù recipe (2 kg of beef make 10 portions, 2,00 EUR a portion) through the API; the chef
// then produces a batch through the M14 screens and everything after that goes through the M15 screens. Fake data only.
//   AT1 UI: split   AT2 UI: discard   AT3 UI: count   AT4/AT5 UI: a staff meal finishes the batch, once a day
//   AT6 UI: the owner's waste report in EUR   Q16 UI: the chef sees no euro sign anywhere
// A number in a page text may be joined to its unit by a no-break space (U+00A0): the patterns below use \s.

const BEEF = "Manzo muscolo (demo)";
const NO_ID = "00000000-0000-4000-8000-000000000000";
const status = (page: Page, text: string | RegExp) =>
  page.getByRole("status").filter({ hasText: text });
const beefBlock = (page: Page) => page.getByRole("listitem").filter({ hasText: BEEF });
const main = (page: Page) => page.locator("main");
const history = (page: Page) => page.locator("ul.ledger").getByRole("listitem");

/** Dark and light, as the other signed-in specs do. */
async function expectPhoneFriendlyBothThemes(page: Page) {
  await expectPhoneFriendly(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await expectPhoneFriendly(page);
  await page.emulateMedia({ colorScheme: "light" });
}

/** No euro sign anywhere in the main column (Q16 = project V6), also inside field values. */
async function expectNoEuro(page: Page) {
  expect(await main(page).innerText()).not.toContain("€");
  const values = await page
    .locator("main input, main select")
    .evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
  expect(values.join(" ")).not.toContain("€");
}

/** A signed-in owner whose tenant holds the beef lots (approved into Cella) and the Ragù recipe. */
async function setup(page: Page) {
  const ownerEmail = createOwner();
  await signInWithMagicLink(page, ownerEmail);
  const tenantId = await tenantIdOf(page);
  const today = venueDate(new Date());
  const db = admin();
  const supplierId = await seedSupplier(db, tenantId, { paymentTermsDays: 30 });
  const cellaId = await seedLocation(db, tenantId, "Cella (demo)");
  const made = await db
    .from("ingredient")
    .insert({ tenant_id: tenantId, name: BEEF, base_unit: "kg" })
    .select("id")
    .single();
  expect(made.error).toBeNull();
  const beefId = made.data!.id as string;
  const invoiceId = await seedInvoice(
    db,
    tenantId,
    {
      name: "fattura-ragu-demo.pdf",
      supplierId,
      invoiceDate: addDays(today, -1),
      lines: ["L-D2", "L-D5"].map((code, index) => ({
        description: `Manzo muscolo (demo) lotto ${code}`,
        qty: 3,
        unit: "kg" as const,
        unitPrice: 10,
        mappedTo: BEEF,
        lotCode: code,
        expiry: addDays(today, index === 0 ? 2 : 5),
      })),
    },
    { [BEEF]: beefId },
  );
  const approved = await page.request.post(`/api/invoices/${invoiceId}/approve`, {
    data: { locationId: cellaId },
  });
  expect(approved.status()).toBe(200);
  await seedRaguRecipe(page, beefId);
  return { tenantId, ownerEmail, today, db };
}

/** Signs the current browser out and in as someone else (or the owner) of the same tenant. */
async function signInAs(page: Page, email: string) {
  await page.context().clearCookies();
  await signInWithMagicLink(page, email);
}

/** The chef produces one Ragù of 2 kg (10 portions) through the M14 screens; returns its id and lot code. */
async function produceRagu(page: Page): Promise<{ id: string; lot: string }> {
  await page.goto("/produzione/nuova");
  await expect(page.getByRole("heading", { name: "Nuova produzione", exact: true })).toBeVisible();
  const recipe = page.getByRole("combobox", { name: "Ricetta" });
  await expect(recipe.locator("option", { hasText: RAGU })).toHaveCount(1);
  await recipe.selectOption({ label: RAGU });
  await page.getByRole("textbox", { name: "Quantità prodotta" }).fill("2");
  const [proposal] = await Promise.all([
    page.waitForResponse(
      (response) => response.url().includes("/api/batches/proposal") && response.ok(),
    ),
    page.getByRole("button", { name: "Calcola", exact: true }).click(),
  ]);
  expect(proposal.ok()).toBe(true);
  await expect(beefBlock(page)).toBeVisible();
  await expect(page.getByLabel("Porzioni")).toHaveValue("10");
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/batches") && r.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Registra produzione", exact: true }).click(),
  ]);
  expect(response.status()).toBe(201);
  await page.waitForURL(/\/produzione\/[0-9a-f-]+\/etichetta\?nuovo=1/);
  const id = /\/produzione\/([0-9a-f-]+)\/etichetta/.exec(page.url())![1]!;
  const text = await page.getByTestId("label-text").innerText();
  const lot = /Lotto: (\S+)/.exec(text)![1]!;
  return { id, lot };
}

test.describe("batch actions on a phone (360 px)", () => {
  test("the chef discards, counts, splits and confirms the staff meal; the owner reads the waste in EUR", async ({
    page,
  }) => {
    const { tenantId, ownerEmail, db } = await setup(page);
    await signInAs(page, await createStaff(tenantId, "chef"));
    const r1 = await produceRagu(page);
    // A second place to split into, added after the production so the production form stays as in M14.
    await seedLocation(db, tenantId, "Congelatore (demo)");

    // The list: the row has an "Apri" link; the batch is untouched, so it has no state badge.
    await page.goto("/produzione");
    const row = page.locator("ul.ledger").getByRole("listitem").filter({ hasText: r1.lot });
    await expect(row).toContainText(/10 porzioni · rimaste 10/);
    await expect(row.getByText("Aperto", { exact: true })).toHaveCount(0);
    await row.getByRole("link", { name: "Apri", exact: true }).click();
    await expect(page.getByRole("heading", { name: RAGU, exact: true })).toBeVisible();
    await expect(page.getByText("Rimaste 10 di 10 porzioni")).toBeVisible();
    await expect(page.getByRole("button", { name: "Conta", exact: true })).toBeVisible();
    await expectNoEuro(page);
    await expectPhoneFriendlyBothThemes(page);

    // AT2 UI: throw away 3 portions as spoiled.
    await page.getByRole("button", { name: "Scarta", exact: true }).click();
    await page.getByLabel("Porzioni da scartare").fill("3");
    // Selects sit inside their label, so their accessible name also carries the selected option.
    await page.getByRole("combobox", { name: /^Motivo\b/ }).selectOption({ label: "Deteriorato" });
    await expectPhoneFriendlyBothThemes(page);
    await page.getByRole("button", { name: "Registra scarto", exact: true }).click();
    await expect(status(page, "Scarto registrato: −3 porzioni.")).toBeVisible();
    await expect(page.getByText("Rimaste 7 di 10 porzioni")).toBeVisible();
    await expect(page.getByText("Aperto", { exact: true })).toBeVisible();
    await expect(history(page).first()).toContainText(
      /Scarto · Deteriorato · −3 porzioni · CD · \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/,
    );
    await expectNoEuro(page);

    // AT3 UI: 6 found where 7 were expected.
    await page.getByRole("button", { name: "Conta", exact: true }).click();
    await expect(page.getByText("Attese: 7")).toBeVisible();
    await page.getByLabel("Porzioni contate").fill("6");
    await page.getByRole("button", { name: "Registra conteggio", exact: true }).click();
    await expect(status(page, "Conteggio registrato: −1 porzione.")).toBeVisible();
    await expect(page.getByText("Rimaste 6 di 10 porzioni")).toBeVisible();
    await expect(history(page).first()).toContainText(/Conteggio · −1 porzione · CD/);

    // AT1 UI: move 4 portions into the freezer for 2160 hours.
    await page.getByRole("button", { name: "Dividi", exact: true }).click();
    await page.getByLabel("Porzioni da spostare").fill("4");
    await page
      .getByRole("combobox", { name: /^Ubicazione\b/ })
      .selectOption({ label: "Congelatore (demo)" });
    await page.getByLabel("Conservazione da adesso (ore)").fill("2160");
    await expect(page.getByText("Per il congelatore indica la nuova durata.")).toBeVisible();
    await expectPhoneFriendlyBothThemes(page);
    await page.getByRole("button", { name: "Dividi lotto", exact: true }).click();
    await page.waitForURL(/\/produzione\/[0-9a-f-]+\/etichetta\?diviso=1/);
    const label = page.getByTestId("label-text");
    await expect(label).toContainText(`Diviso da: ${r1.lot}`);
    await expect(label).toContainText("Porzioni: 4");
    await expect(label).toContainText("Operatore: CD");
    await expect(status(page, /Lotto diviso: nuovo lotto \S+\./)).toBeVisible();
    const child = /\/produzione\/([0-9a-f-]+)\/etichetta/.exec(page.url())![1]!;
    expect(child).not.toBe(r1.id);
    await expectNoEuro(page);
    await expectPhoneFriendlyBothThemes(page);

    // Back on the first batch: 2 left, the part is listed and the history has the three actions, newest first.
    await page.goto(`/produzione/${r1.id}`);
    await expect(page.getByText("Rimaste 2 di 10 porzioni")).toBeVisible();
    await expect(page.getByText("Parti divise")).toBeVisible();
    await expect(
      page.getByRole("link", { name: /· 4 porzioni · Congelatore \(demo\)/ }),
    ).toHaveAttribute("href", `/produzione/${child}`);
    await expect(history(page)).toHaveCount(4);
    await expect(history(page).nth(0)).toContainText("Divisione · −4 porzioni");
    await expect(history(page).nth(1)).toContainText("Conteggio · −1 porzione");
    await expect(history(page).nth(2)).toContainText("Scarto · Deteriorato · −3 porzioni");
    await expect(history(page).nth(3)).toContainText("Produzione · +10 porzioni");
    await expectNoEuro(page);

    // The part knows where it comes from.
    await page.goto(`/produzione/${child}`);
    await expect(page.getByText("Rimaste 4 di 4 porzioni")).toBeVisible();
    await expect(page.getByRole("link", { name: r1.lot, exact: true })).toBeVisible();

    // AT5 UI: the staff meal. A rule for the Ragù, 2 portions, then one tap.
    await page.goto("/produzione");
    await page.getByRole("link", { name: "Pasti del personale", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Pasti del personale", exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/Giornata del \d{2}\/\d{2}\/\d{4}/)).toBeVisible();
    await expect(page.getByText("Nessuna regola: aggiungine una qui sotto.")).toBeVisible();
    await page.getByRole("button", { name: "Aggiungi regola", exact: true }).click();
    await page.getByRole("combobox", { name: /^Preparazione\b/ }).selectOption({ label: RAGU });
    await page.getByLabel("Quantità", { exact: true }).fill("2");
    await expectPhoneFriendlyBothThemes(page);
    await page.getByRole("button", { name: "Salva regola", exact: true }).click();
    await expect(status(page, "Regola salvata.")).toBeVisible();
    const rule = page.locator("ul.ledger").getByRole("listitem").filter({ hasText: RAGU });
    await expect(rule).toContainText("Ragù (demo) · 2 porzioni");
    await expect(rule).toContainText("Disponibili: 6");
    await expectNoEuro(page);
    await expectPhoneFriendlyBothThemes(page);

    await rule.getByRole("button", { name: "Conferma pasto di oggi", exact: true }).click();
    await expect(status(page, "Pasto di oggi confermato.")).toBeVisible();
    await expect(rule).toContainText(/Confermato alle \d{2}:\d{2} · CD/);
    await expect(rule.getByRole("button", { name: "Conferma pasto di oggi" })).toHaveCount(0);
    await page.reload();
    await expect(rule).toContainText(/Confermato alle \d{2}:\d{2} · CD/);
    await expect(rule.getByRole("button", { name: "Conferma pasto di oggi" })).toHaveCount(0);
    await expectNoEuro(page);

    // AT4 UI: the 2 portions came from the oldest batch, which is now finished.
    await page.goto(`/produzione/${r1.id}`);
    await expect(page.getByText("Rimaste 0 di 10 porzioni")).toBeVisible();
    await expect(page.getByText("Finito", { exact: true })).toBeVisible();
    await expect(history(page).first()).toContainText("Pasto personale · −2 porzioni");
    await expect(page.getByRole("button", { name: "Scarta", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Dividi", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Conta", exact: true })).toBeVisible();
    await page.goto("/produzione");
    await expect(
      page.locator("ul.ledger").getByRole("listitem").filter({ hasText: r1.lot }),
    ).toContainText("Finito");
    await expectNoEuro(page);
    await expectPhoneFriendlyBothThemes(page);

    // The chef is refused the waste report in EUR (Q16 = project V6).
    expect((await page.request.get("/api/stock/waste-costs")).status()).toBe(403);

    // AT6 UI: the owner reads raw and batch waste together: the discard 3 x 2,00 and the staff meal 2 x 2,00.
    await signInAs(page, ownerEmail);
    await page.goto("/magazzino/sprechi");
    await expect(page.getByTestId("fact-waste-total")).toHaveText(/^10,00\s+€$/);
    const spoilage = page
      .locator("ul.ledger")
      .getByRole("listitem")
      .filter({ hasText: "Deteriorato" });
    await expect(spoilage).toContainText(/Deteriorato · 6,00\s+€/);
    await expect(spoilage).toContainText(/Preparazioni 6,00\s+€/);
    await expect(spoilage).toContainText(/Ragù \(demo\) · 3 porzioni · 6,00\s+€/);
    const meal = page
      .locator("ul.ledger")
      .getByRole("listitem")
      .filter({ hasText: "Pasto del personale" });
    await expect(meal).toContainText(/Preparazioni 4,00\s+€/);
    await expect(meal).toContainText(/Ragù \(demo\) · 2 porzioni · 4,00\s+€/);
    // Every discard here has a complete cost: nothing is "non valorizzato".
    await expect(page.getByText("non valorizzato")).toHaveCount(0);
    await expectPhoneFriendlyBothThemes(page);
  });

  test("the waiter is refused on the new screens and in the API", async ({ page }) => {
    const { tenantId } = await setup(page);
    await signInAs(page, await createStaff(tenantId, "waiter"));

    for (const path of ["/produzione/personale", `/produzione/${NO_ID}`]) {
      await page.goto(path);
      await expect(
        main(page)
          .getByRole("alert")
          .filter({ hasText: "La produzione non è disponibile per il tuo ruolo." }),
      ).toBeVisible();
      await expectPhoneFriendly(page);
    }
    expect((await page.request.get(`/api/batches/${NO_ID}`)).status()).toBe(403);
    expect((await page.request.get("/api/staff-meals")).status()).toBe(403);
    for (const [path, data] of [
      [`/api/batches/${NO_ID}/adjust`, { counted: 1 }],
      [`/api/batches/${NO_ID}/discard`, { portions: 1, reason: "spoilage" }],
      [`/api/batches/${NO_ID}/split`, { portions: 1, hoursFromNow: 24 }],
      [`/api/staff-meals/${NO_ID}/confirm`, {}],
      ["/api/staff-meals", { recipeKey: NO_ID, defaultCount: 1 }],
    ] as const) {
      expect((await page.request.post(path, { data })).status(), path).toBe(403);
    }
  });
});

test.describe("batch actions on a laptop (1280 px)", () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

  test("the new screens stay within the page column", async ({ page }) => {
    await setup(page);
    const r1 = await produceRagu(page);
    for (const path of [`/produzione/${r1.id}`, "/produzione/personale", "/magazzino/sprechi"]) {
      await page.goto(path);
      await expect(page.getByRole("heading").first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      const column = (await page.locator("main").boundingBox())!;
      const content = (await page.locator("main > *").last().boundingBox())!;
      expect(content.x).toBeGreaterThanOrEqual(column.x);
      expect(content.x + content.width).toBeLessThanOrEqual(column.x + column.width + 1);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    }
  });
});
