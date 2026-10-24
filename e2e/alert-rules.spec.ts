import { expect, test, type Locator, type Page } from "@playwright/test";
import { venueDate } from "../src/lib/time/venue-date";
import { tenantIdOf } from "./helpers/seed-invoice";
import {
  BEEF,
  MACELLERIA,
  STEW,
  afternoonOf,
  nextMondayAfter,
  runRules,
  seedRulesTenant,
} from "./helpers/seed-rules";
import {
  createOwner,
  createStaff,
  expectPhoneFriendly,
  requireSupabaseStack,
  signInWithMagicLink,
} from "./helpers/session";

requireSupabaseStack();

// M16 acceptance tests on screen: the reorder, prep and purchase rules on a phone (360 x 740) and the laptop layout
// (1280 x 800). The owner sets the rules on the screens; the hourly job runs through the local stack's secret key
// (`alert_rules_run`, an explicit clock); the alerts are read back on /avvisi. Nothing here reads or writes the alert
// table. Fake data only ("(demo)" names).
//   AT1 UI: stew 4 < 5 and beef 12,3 kg: the chef reads the prep alert and acknowledges it
//   AT3 UI: Macelleria X (demo), Monday afternoon, no history: the owner is told to order 10 kg, the chef is not
//   Roles on screen: the chef reads the rules and never types them, nobody but the owner sees a euro, the waiter nothing

const nav = (page: Page) => page.getByRole("navigation", { name: "Menu principale" });
const group = (page: Page, name: string) => page.getByRole("group", { name, exact: true });
const rowOf = (page: Page, title: string) =>
  page.getByRole("listitem").filter({ has: page.getByText(title, { exact: true }) });

/** Dark and light, as the other signed-in specs do. */
async function expectPhoneFriendlyBothThemes(page: Page) {
  await expectPhoneFriendly(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await expectPhoneFriendly(page);
  await page.emulateMedia({ colorScheme: "light" });
}

/** No euro sign anywhere in the main column, also inside field values. */
async function expectNoEuro(page: Page) {
  expect(await page.locator("main").innerText()).not.toContain("€");
  const values = await page
    .locator("main input, main select")
    .evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
  expect(values.join(" ")).not.toContain("€");
}

/** Taps "Salva" in a card and waits for the PATCH itself to be answered. */
async function save(page: Page, card: Locator, apiPath: string) {
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => new URL(r.url()).pathname === apiPath && r.request().method() === "PATCH",
    ),
    card.getByRole("button", { name: "Salva", exact: true }).click(),
  ]);
  expect(response.status()).toBe(200);
}

/** Signs the current browser out and in as someone else of the same tenant. */
async function signInAs(page: Page, email: string) {
  await page.context().clearCookies();
  await signInWithMagicLink(page, email);
}

test.describe("reorder, prep and purchase rules on a phone (360 px)", () => {
  test("the owner sets the rules on screen; the chef reads the prep alert and acknowledges it (AT1 UI)", async ({
    page,
  }) => {
    await signInWithMagicLink(page, createOwner());
    const tenantId = await tenantIdOf(page);
    const seed = await seedRulesTenant(page, tenantId, { beefKg: 12.9, stew: true });

    // The entry: the tab and the three cards with their counts.
    await page.goto("/riordino");
    await expect(
      page.getByRole("heading", { name: "Riordino e preparazione", exact: true }),
    ).toBeVisible();
    await expect(nav(page).getByRole("link", { name: "Riordino", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(
      page.getByRole("link", { name: "Ingredienti (0 da completare)", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Fornitori (2)", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Ricette (1)", exact: true })).toBeVisible();
    await expectNoEuro(page);
    await expectPhoneFriendlyBothThemes(page);

    // Suppliers: Monday and Thursday, 11:00, two days ahead; the next window appears.
    await page.goto("/riordino/fornitori");
    const supplier = group(page, MACELLERIA);
    await expect(supplier).toBeVisible();
    await supplier.getByLabel("Giorni di anticipo", { exact: true }).fill("2");
    await supplier.getByLabel("Lun", { exact: true }).check();
    await supplier.getByLabel("Gio", { exact: true }).check();
    await supplier.getByLabel("Ordine entro le", { exact: true }).fill("11:00");
    await save(page, supplier, "/api/rules/suppliers");
    await expect(supplier).toContainText(
      /Prossimo ordine entro\s+\S+\s+\d{2}\/\d{2},\s+11:00\s+·\s+consegna\s+\S+\s+\d{2}\/\d{2}/,
    );
    await expect(page.locator("main").getByRole("status")).toHaveText("Salvato.");
    await expectNoEuro(page);
    await expectPhoneFriendlyBothThemes(page);

    // Ingredients: minimum and target first (incomplete, in words), then the preferred pack (complete).
    await page.goto("/riordino/ingredienti");
    const beef = group(page, BEEF);
    await expect(beef.getByText("Non attivo", { exact: true })).toBeVisible();
    await expect(beef).toContainText(/In giacenza\s+12,9\s+kg/);
    await beef.getByLabel("Minimo", { exact: true }).fill("5");
    await beef.getByLabel("Obiettivo", { exact: true }).fill("12");
    await save(page, beef, "/api/rules/ingredients");
    await expect(beef.getByText("Da completare", { exact: true })).toBeVisible();
    await expect(beef.getByText("Nessun fornitore preferito", { exact: true })).toBeVisible();
    // The select sits inside its label, so its accessible name also carries the selected option's text.
    await beef
      .getByRole("combobox", { name: /^Fornitore preferito\b/ })
      .selectOption({ label: `${MACELLERIA} · confezione 5 kg` });
    await save(page, beef, "/api/rules/ingredients");
    await expect(beef.getByText("Da completare", { exact: true })).toHaveCount(0);
    await expect(beef).toContainText(/Prossimo ordine entro/);
    await expectNoEuro(page);
    await expectPhoneFriendlyBothThemes(page);

    // Recipes: the three values come from the version at first; after saving they are the owner's own rules.
    await page.goto("/riordino/ricette");
    const stew = group(page, STEW);
    await expect(stew.getByText("dalla ricetta v1", { exact: true })).toHaveCount(3);
    await stew.getByLabel("Porzioni minime", { exact: true }).fill("5");
    await stew.getByLabel("Porzioni obiettivo", { exact: true }).fill("30");
    await stew.getByLabel("Tempo di preparazione (min)", { exact: true }).fill("180");
    await save(page, stew, "/api/rules/recipes");
    await expect(stew.getByText("dalla ricetta v1", { exact: true })).toHaveCount(0);
    await expect(stew).toContainText(/Restano\s+0\s+porzioni/);
    await expectNoEuro(page);
    await expectPhoneFriendlyBothThemes(page);

    // The chef produces 4 portions: 0,6 kg of the 12,9 kg are used, 12,3 kg stay.
    await signInAs(page, await createStaff(tenantId, "chef"));
    const proposal = await page.request.get(`/api/batches/proposal?recipeKey=${seed.stewKey}`);
    expect(proposal.status()).toBe(200);
    const recipeId = ((await proposal.json()) as { recipe: { id: string } }).recipe.id;
    const produced = await page.request.post("/api/batches", {
      data: {
        recipeId,
        outputQty: 0.8,
        portions: 4,
        inputs: [{ ingredientId: seed.beefId, qty: 0.6, unit: "kg" }],
      },
    });
    expect(produced.status()).toBe(201);

    // The chef reads the same rules as text, with nothing to type and no euro sign.
    await page.goto("/riordino/ingredienti");
    const chefBeef = group(page, BEEF);
    await expect(chefBeef).toBeVisible();
    await expect(nav(page).getByRole("link", { name: "Riordino", exact: true })).toBeVisible();
    await expect(chefBeef).toContainText(/Minimo\s*5\s+kg/);
    await expect(chefBeef).toContainText(/Obiettivo\s*12\s+kg/);
    await expect(chefBeef).toContainText(
      /Fornitore preferito\s*Macelleria X \(demo\) · confezione 5\s+kg/,
    );
    await expect(chefBeef).toContainText(/In giacenza\s+12,3\s+kg/);
    await expect(chefBeef.getByLabel("Minimo", { exact: true })).toHaveCount(0);
    await expect(page.locator("main input:not([type=checkbox]), main select")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Salva", exact: true })).toHaveCount(0);
    await expect(chefBeef.getByLabel("Conteggio giornaliero", { exact: true })).toBeVisible();
    await expectNoEuro(page);
    await expectPhoneFriendlyBothThemes(page);
    for (const path of ["/riordino/fornitori", "/riordino/ricette"]) {
      await page.goto(path);
      await expect(page.getByRole("group").first()).toBeVisible();
      await expect(page.locator("main input:not([type=checkbox]), main select")).toHaveCount(0);
      await expectNoEuro(page);
      await expectPhoneFriendlyBothThemes(page);
    }

    // AT1 UI: the hourly run, then the chef's alert list.
    const run = await runRules(new Date().toISOString());
    expect(run.ok).toBe(true);
    await page.goto("/avvisi");
    const title = "Da preparare oggi: Spezzatino (demo)";
    await expect(rowOf(page, title)).toBeVisible();
    await expect(rowOf(page, title)).toContainText(
      /Prepara Spezzatino \(demo\) oggi, 5,0\s+kg di Manzo muscolo \(demo\) disponibili \(12,3\s+kg in giacenza\)\. Restano 4 porzioni, minimo 5\./,
    );
    await expect(page.locator("main")).not.toContainText("€");
    await expectPhoneFriendlyBothThemes(page);

    // One tap on the existing acknowledge button marks it done.
    const acked = page.waitForResponse(
      (response) => /\/api\/alerts\/[^/]+\/ack$/.test(response.url()) && response.ok(),
    );
    await rowOf(page, title).getByRole("button", { name: "Ho visto" }).click();
    await acked;
    await page.getByRole("button", { name: "Tutti" }).click();
    await expect(rowOf(page, title)).toContainText(/Visto il .* da chef Demo/);
  });

  test("the owner is told to order 10 kg for Thursday on Monday afternoon, the chef is not (AT3 UI, no history)", async ({
    page,
  }) => {
    await signInWithMagicLink(page, createOwner());
    const tenantId = await tenantIdOf(page);
    const seed = await seedRulesTenant(page, tenantId, { beefKg: 12, stew: false });
    const set = async (path: string, data: object) =>
      expect((await page.request.patch(path, { data })).status()).toBe(200);
    await set("/api/rules/suppliers", {
      supplierId: seed.macelleriaId,
      deliveryWeekdays: [1, 4],
      leadTimeDays: 2,
      orderCutoffTime: "11:00",
    });
    await set("/api/rules/ingredients", {
      ingredientId: seed.beefId,
      minLevel: 5,
      targetLevel: 12,
      preferredSupplierItemId: seed.packId,
    });

    // The stock drops to 2 kg by a waste (waste is not consumption, so the forecast stays 0).
    const wasted = await page.request.post("/api/stock/waste", {
      data: {
        ingredientId: seed.beefId,
        qty: 10,
        unit: "kg",
        reason: "spoilage",
        locationId: seed.cellaId,
      },
    });
    expect(wasted.status()).toBe(201);
    await page.goto("/riordino/ingredienti");
    await expect(group(page, BEEF)).toContainText(/In giacenza\s+2\s+kg/);
    await expect(group(page, BEEF).getByText("Da completare", { exact: true })).toHaveCount(0);

    const monday = nextMondayAfter(venueDate(new Date()));
    const run = await runRules(afternoonOf(monday));
    expect(run.ok).toBe(true);

    const purchase =
      /Ordina 10\s+kg di Manzo muscolo \(demo\) da Macelleria X \(demo\) entro mar 11:00 per la consegna di gio/;
    await page.goto("/avvisi");
    const purchaseItem = page.getByRole("listitem").filter({ hasText: purchase });
    await expect(purchaseItem).toHaveCount(1);
    // The purchase alert carries no money; the owner's weekly payables alert on the same page rightly does.
    await expect(purchaseItem).not.toContainText("€");
    await expectPhoneFriendlyBothThemes(page);

    await signInAs(page, await createStaff(tenantId, "chef"));
    await page.goto("/avvisi");
    await expect(page.getByRole("heading", { name: "Avvisi", exact: true })).toBeVisible();
    await expect(page.getByText("Nessun avviso da vedere.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Tutti" }).click();
    await expect(page.getByText("Nessun avviso.", { exact: true })).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: purchase })).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText("Macelleria");
    await expect(page.locator("main")).not.toContainText("€");
  });

  test("the waiter has no Riordino tab and is refused on the screen and in the API", async ({
    page,
  }) => {
    await signInWithMagicLink(page, createOwner());
    const tenantId = await tenantIdOf(page);
    const seed = await seedRulesTenant(page, tenantId, { beefKg: 12, stew: true });
    await signInAs(page, await createStaff(tenantId, "waiter"));

    await page.goto("/riordino");
    await expect(
      page
        .locator("main")
        .getByRole("alert")
        .filter({ hasText: "Il riordino non è disponibile per il tuo ruolo." }),
    ).toBeVisible();
    await expect(nav(page).getByRole("link", { name: "Riordino", exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: /^(Ingredienti|Fornitori|Ricette) \(/ }),
    ).toHaveCount(0);

    for (const path of ["ingredients", "suppliers", "recipes"]) {
      expect((await page.request.get(`/api/rules/${path}`)).status()).toBe(403);
    }
    expect(
      (
        await page.request.patch("/api/rules/ingredients", {
          data: { ingredientId: seed.beefId, minLevel: 1 },
        })
      ).status(),
    ).toBe(403);
    await expectPhoneFriendly(page);
  });
});

test.describe("reorder, prep and purchase rules on a laptop (1280 px)", () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

  test("the rules screens stay within the page column", async ({ page }) => {
    await signInWithMagicLink(page, createOwner());
    const tenantId = await tenantIdOf(page);
    await seedRulesTenant(page, tenantId, { beefKg: 12, stew: true });
    for (const path of [
      "/riordino",
      "/riordino/ingredienti",
      "/riordino/fornitori",
      "/riordino/ricette",
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
