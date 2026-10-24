import { expect, test, type Page } from "@playwright/test";
import { addDays, venueDate } from "../src/lib/time/venue-date";
import { seedStewRecipe, STEW } from "./helpers/seed-recipe";
import { admin, seedInvoice, seedLocation, seedSupplier, tenantIdOf } from "./helpers/seed-invoice";
import {
  createOwner,
  createStaff,
  expectPhoneFriendly,
  requireSupabaseStack,
  signInWithMagicLink,
} from "./helpers/session";

requireSupabaseStack();

// M14 acceptance tests on screen: batch production on a phone (360 x 740) and the laptop layout (1280 x 800). The owner
// approves a seeded fake invoice (beef lots L-D2 and L-D5, 3 kg each, 10,00 EUR/kg, into "Cella (demo)") and creates the
// stew recipe through the API; everything after that goes through the screens. Fake data only ("(demo)" names).
//   AT1 UI: production reduces the stock by the confirmed quantity   AT2 UI: proposal 5,1667 kg and 31 portions
//   AT4 UI: the second lot of the day is -2   AT5 UI: a later price does not move the cost   AT7 UI: the waiter
//   Q16 UI: the chef sees no euro sign anywhere

const BEEF = "Manzo muscolo (demo)";
const nav = (page: Page) => page.getByRole("navigation", { name: "Menu principale" });
const status = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });
const beefBlock = (page: Page) => page.getByRole("listitem").filter({ hasText: BEEF });
const lotCode = (today: string, n: number) => `${today.slice(2).replace(/-/g, "")}-SPEZZA-${n}`;

/** Dark and light, as the other signed-in specs do. */
async function expectPhoneFriendlyBothThemes(page: Page) {
  await expectPhoneFriendly(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await expectPhoneFriendly(page);
  await page.emulateMedia({ colorScheme: "light" });
}

/** No euro sign anywhere in the main column (Q16 = project V6), also inside field values. */
async function expectNoEuro(page: Page) {
  expect(await page.locator("main").innerText()).not.toContain("€");
  const values = await page
    .locator("main input, main select")
    .evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
  expect(values.join(" ")).not.toContain("€");
}

/** A signed-in owner whose tenant holds the two beef lots (approved into Cella) and the stew recipe. */
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
      name: "fattura-produzione-demo.pdf",
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
  await seedStewRecipe(page, beefId);
  return { tenantId, ownerEmail, today, supplierId, cellaId, beefId, db };
}

/** Signs the current browser out and in as someone else (or the owner) of the same tenant. */
async function signInAs(page: Page, email: string) {
  await page.context().clearCookies();
  await signInWithMagicLink(page, email);
}

/** Opens the production form, picks the stew and calculates the proposal for `output` kg. */
async function calculate(page: Page, output: string) {
  await page.goto("/produzione/nuova");
  await expect(page.getByRole("heading", { name: "Nuova produzione", exact: true })).toBeVisible();
  const recipe = page.getByRole("combobox", { name: "Ricetta" });
  await expect(recipe.locator("option", { hasText: STEW })).toHaveCount(1);
  await recipe.selectOption({ label: STEW });
  await page.getByRole("textbox", { name: "Quantità prodotta" }).fill(output);
  // Wait for the proposal itself, not for what appears afterwards.
  const [proposal] = await Promise.all([
    page.waitForResponse(
      (response) => response.url().includes("/api/batches/proposal") && response.ok(),
    ),
    page.getByRole("button", { name: "Calcola", exact: true }).click(),
  ]);
  expect(proposal.ok()).toBe(true);
  await expect(beefBlock(page)).toBeVisible();
}

/** Taps "Registra produzione" and waits for the production itself to be answered. */
async function register(page: Page) {
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/batches") && r.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Registra produzione", exact: true }).click(),
  ]);
  expect(response.status()).toBe(201);
  await page.waitForURL(/\/produzione\/[0-9a-f-]+\/etichetta\?nuovo=1/);
}

test.describe("batch production on a phone (360 px)", () => {
  test("the chef: proposal, production, label, stock, a second lot and a shortfall, never a euro sign; the owner sees the frozen cost", async ({
    page,
  }) => {
    const { tenantId, ownerEmail, today, supplierId, cellaId, beefId, db } = await setup(page);
    await signInAs(page, await createStaff(tenantId, "chef"));

    // The tab and the empty list (Q16 UI: no euro sign).
    await page.goto("/produzione");
    await expect(page.getByRole("heading", { name: "Produzione", exact: true })).toBeVisible();
    await expect(nav(page).getByRole("link", { name: "Produzione", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByText("Nessuna produzione registrata.")).toBeVisible();
    await expectNoEuro(page);
    await expectPhoneFriendlyBothThemes(page);

    // AT2 UI: the proposal for 6,2 kg is 5,1667 kg of beef and 31 portions.
    await page.getByRole("button", { name: "Nuova produzione", exact: true }).click();
    await calculate(page, "6,2");
    await expect(beefBlock(page)).toContainText(/Proposto\s+5,1667\s+kg/);
    await expect(beefBlock(page)).toContainText(/Cella \(demo\)\s+6\s+kg/);
    await expect(beefBlock(page).getByLabel("Usato")).toHaveValue("5,1667");
    await expect(beefBlock(page).getByLabel("Lotto")).toContainText(
      "Primo in scadenza (consigliato)",
    );
    await expect(page.getByLabel("Porzioni")).toHaveValue("31");
    await expect(page.getByText(/Calcolate: 31 \(0,2\s+kg a porzione/)).toBeVisible();
    await expect(
      page.getByText(/Da consumare entro il \d{2}\/\d{2}\/\d{4}, \d{2}:\d{2} \(indicativo\)/),
    ).toBeVisible();
    await expectNoEuro(page);
    await expectPhoneFriendlyBothThemes(page);

    // A changed output makes the proposal stale: no submit until the chef presses Calcola again.
    const output = page.getByRole("textbox", { name: "Quantità prodotta" });
    const submit = page.getByRole("button", { name: "Registra produzione", exact: true });
    await output.fill("6,3");
    await expect(submit).toBeDisabled();
    await expect(page.getByText(/premi Calcola per aggiornare la proposta/)).toBeVisible();
    await output.fill("6,2");
    await expect(submit).toBeEnabled();
    await expect(page.getByText(/premi Calcola per aggiornare la proposta/)).toHaveCount(0);

    // AT1 UI: the chef confirms 5,3 kg (not the proposed 5,1667) and records the production.
    await beefBlock(page).getByLabel("Usato").fill("5,3");
    await register(page);
    await expect(status(page, `Produzione registrata: lotto ${lotCode(today, 1)}.`)).toBeVisible();
    const label = page.getByTestId("label-text");
    await expect(label).toContainText("Spezzatino (demo)");
    await expect(label).toContainText(`Lotto: ${lotCode(today, 1)}`);
    await expect(label).toContainText("Porzioni: 31");
    await expect(label).toContainText("Operatore: CD");
    await expect(label).toContainText(/Da consumare entro: \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
    await expectNoEuro(page);
    await expectPhoneFriendlyBothThemes(page);

    // The stock: 0,7 kg left in L-D5, L-D2 is gone, and the history says Produzione.
    await page.goto(`/magazzino/${beefId}`);
    await expect(page.getByTestId("fact-on-hand")).toHaveText(/^0,7\s+kg$/);
    const lots = page.locator("ul.ledger").first().getByRole("listitem");
    await expect(lots).toHaveText([/L-D5/]);
    await expect(lots.first()).not.toContainText("L-D2");
    await expect(page.getByRole("listitem").filter({ hasText: "Produzione" })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Annulla", exact: true })).toHaveCount(0);
    await expectNoEuro(page);

    // AT4 UI and the shortfall: output 1,2 with 1 kg of beef is the second lot of the day, and 0,3 kg are missing.
    await calculate(page, "1,2");
    await expect(beefBlock(page)).toContainText(/Proposto\s+1\s+kg/);
    await register(page);
    await expect(status(page, `Produzione registrata: lotto ${lotCode(today, 2)}.`)).toBeVisible();
    await expect(status(page, "Manzo muscolo (demo) in Cella (demo) è ora negativo")).toContainText(
      /−0,3\s+kg\. Fai un conteggio/,
    );
    await expectNoEuro(page);

    // The list: both batches, newest first, no cost for the chef.
    await page.goto("/produzione");
    const batches = page.locator("ul.ledger").getByRole("listitem");
    await expect(batches).toHaveCount(2);
    await expect(batches.nth(0)).toContainText(lotCode(today, 2));
    await expect(batches.nth(1)).toContainText(lotCode(today, 1));
    await expect(batches.nth(1)).toContainText(/31 porzioni · rimaste 31/);
    await expect(batches.nth(1)).toContainText("· tu");
    await expectNoEuro(page);
    await expectPhoneFriendlyBothThemes(page);

    // The owner sees the frozen cost (AT5 UI): 53,00 EUR for the first batch; a dearer purchase does not move it.
    await signInAs(page, ownerEmail);
    await page.goto("/produzione");
    const first = page
      .locator("ul.ledger")
      .getByRole("listitem")
      .filter({ hasText: lotCode(today, 1) });
    await expect(first).toContainText(/Costo\s+53,00\s+€ · 1,71\s+€ a porzione/);
    await expectPhoneFriendlyBothThemes(page);
    const dear = await seedInvoice(
      db,
      tenantId,
      {
        name: "fattura-manzo-caro-demo.pdf",
        supplierId,
        invoiceDate: today,
        lines: [
          {
            description: "Manzo muscolo (demo) caro",
            qty: 3,
            unit: "kg",
            unitPrice: 20,
            mappedTo: BEEF,
            lotCode: "L-D20",
            expiry: addDays(today, 6),
          },
        ],
      },
      { [BEEF]: beefId },
    );
    const approved = await page.request.post(`/api/invoices/${dear}/approve`, {
      data: { locationId: cellaId },
    });
    expect(approved.status()).toBe(200);
    await page.goto("/produzione");
    await expect(
      page
        .locator("ul.ledger")
        .getByRole("listitem")
        .filter({ hasText: lotCode(today, 1) }),
    ).toContainText(/Costo\s+53,00\s+€ · 1,71\s+€ a porzione/);
  });

  test("the waiter has no Produzione tab and is refused on the screen and in the API (AT7 on screen)", async ({
    page,
  }) => {
    const { tenantId } = await setup(page);
    await signInAs(page, await createStaff(tenantId, "waiter"));

    await page.goto("/produzione");
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "La produzione non è disponibile per il tuo ruolo." }),
    ).toBeVisible();
    await expect(nav(page).getByRole("link", { name: "Produzione", exact: true })).toHaveCount(0);
    await expect(page.getByRole("listitem")).toHaveCount(0);

    expect((await page.request.get("/api/batches")).status()).toBe(403);
    expect(
      (
        await page.request.get(
          "/api/batches/proposal?recipeKey=00000000-0000-4000-8000-000000000000",
        )
      ).status(),
    ).toBe(403);
    expect(
      (await page.request.get("/api/batches/00000000-0000-4000-8000-000000000000/label")).status(),
    ).toBe(403);
    const posted = await page.request.post("/api/batches", {
      data: {
        recipeId: "00000000-0000-4000-8000-000000000000",
        outputQty: 6,
        inputs: [{ ingredientId: "00000000-0000-4000-8000-000000000000", qty: 1, unit: "kg" }],
      },
    });
    expect(posted.status()).toBe(403);
    await expectPhoneFriendly(page);
  });
});

test.describe("batch production on a laptop (1280 px)", () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

  test("the production screens stay within the page column", async ({ page }) => {
    await setup(page);
    await calculate(page, "6,2");
    await beefBlock(page).getByLabel("Usato").fill("5,3");
    await register(page);
    const batchPath = new URL(page.url()).pathname;
    for (const path of ["/produzione", "/produzione/nuova", batchPath]) {
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
