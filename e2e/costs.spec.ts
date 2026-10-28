import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { romeDate } from "../tests/helpers/rome-midnight";
import { admin, seedInvoice, seedLocation, seedSupplier, tenantIdOf } from "./helpers/seed-invoice";
import {
  createOwner,
  createStaff,
  expectPhoneFriendly,
  fakeEmail,
  requireSupabaseStack,
  signInWithMagicLink,
} from "./helpers/session";

requireSupabaseStack();

// M8 acceptance tests on screen: food cost on a phone (360 x 740) and the laptop layout (1280 x 800).
// The owner's own session imports the fake ingredients and recipes through the API, invoices are
// seeded in the state the review leaves behind (as in invoice-approval.spec.ts) and approved through
// the real approve route, and every figure is read back on screen. Nothing here reads or writes a
// cost table with the secret key. Fake data only ("(demo)" names, invented prices).

const fixturePath = (name: string) =>
  fileURLToPath(new URL(`../tests/fixtures/costing/${name}`, import.meta.url));
const fixtureText = (name: string) => readFileSync(fixturePath(name), "utf8");

const BEEF = "Manzo muscolo (demo)";
const STEW = "Spezzatino (demo)";
const SUB = "Manzo pulito (demo)";
const PLATE = "Spezzatino con polenta (demo)";
const WINE_PLATE = "Spezzatino al vino (demo)";
const SALT_PLATE = "Polenta e sale (demo)";

const today = romeDate();
function day(offset: number): string {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
/** "Ottobre 2026" for the current Europe/Rome month, as the screen writes it. */
function thisMonthLabel(): string {
  const text = new Intl.DateTimeFormat("it-IT", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${today.slice(0, 7)}-01T00:00:00Z`));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const rowOf = (page: Page, name: string) =>
  page.getByRole("listitem").filter({ has: page.getByRole("link", { name, exact: true }) });
const nav = (page: Page) => page.getByRole("navigation", { name: "Menu principale" });

async function expectPhoneFriendlyBothThemes(page: Page) {
  await expectPhoneFriendly(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await expectPhoneFriendly(page);
  await page.emulateMedia({ colorScheme: "light" });
}

type Purchase = [name: string, qty: number, unitPrice: number];

/**
 * A signed-in owner with the demo ingredients and recipes and three beef purchases at 10,00 EUR/kg
 * (plus the other prices on the first invoice). `buy` seeds and approves one more invoice.
 */
async function seedCosts(page: Page) {
  await signInWithMagicLink(page, createOwner());
  const tenantId = await tenantIdOf(page);
  const ingredients = await page.request.post("/api/admin/import/ingredients", {
    data: { format: "csv", csv: fixtureText("ingredienti-costi-demo.csv") },
  });
  expect(ingredients.status()).toBe(200);
  const recipes = await page.request.post("/api/admin/import/recipes", {
    data: { format: "csv", csv: fixtureText("ricette-costi-demo.csv") },
  });
  expect(recipes.status()).toBe(200);

  const listed = (await (await page.request.get("/api/ingredients")).json()).ingredients as {
    id: string;
    name: string;
  }[];
  const ingredientIds = Object.fromEntries(listed.map((item) => [item.name, item.id]));
  const keyList = (await (await page.request.get("/api/recipes")).json()).recipes as {
    key: string;
    name: string;
  }[];
  const keys = Object.fromEntries(keyList.map((recipe) => [recipe.name, recipe.key]));

  const db = admin();
  const supplierId = await seedSupplier(db, tenantId, { paymentTermsDays: 30 });
  await seedLocation(db, tenantId);

  async function buy(date: string, purchases: Purchase[]) {
    const id = await seedInvoice(
      db,
      tenantId,
      {
        name: "fattura-costi-demo.pdf",
        supplierId,
        invoiceDate: date,
        lines: purchases.map(([name, qty, unitPrice]) => ({
          description: name,
          qty,
          unit: name === "Pane (demo)" ? "pz" : "kg",
          unitPrice,
          mappedTo: name,
        })),
      },
      ingredientIds,
    );
    const approved = await page.request.post(`/api/invoices/${id}/approve`, { data: {} });
    expect(approved.status()).toBe(200);
  }

  await buy(day(-30), [
    [BEEF, 20, 10],
    ["Farina di mais (demo)", 10, 1.5],
    ["Pane (demo)", 100, 0.3],
    ["Prova (demo)", 5, 10],
  ]);
  await buy(day(-20), [[BEEF, 20, 10]]);
  await buy(day(-10), [[BEEF, 20, 10]]);
  return { tenantId, keys, buy };
}

/** Signs the current browser out and in as someone else of the same tenant. */
async function switchTo(page: Page, role: "chef" | "waiter" | "admin", tenantId: string) {
  await page.context().clearCookies();
  const email =
    role === "admin" ? await createAdminUser(tenantId) : await createStaff(tenantId, role);
  await signInWithMagicLink(page, email, role === "waiter" ? "/tavoli" : "/");
}

/** createStaff knows the chef and the waiter; the admin (DigiAlto support) is made the same way. */
async function createAdminUser(tenantId: string): Promise<string> {
  const db = admin();
  const email = fakeEmail("admin");
  const created = await db.auth.admin.createUser({ email, email_confirm: true });
  const authId = created.data.user?.id;
  if (created.error || !authId) throw new Error("Fixture failed: admin user");
  const member = await db
    .from("app_user")
    .insert({ tenant_id: tenantId, auth_id: authId, role: "admin", display_name: "admin Demo" });
  if (member.error) throw new Error(`Fixture failed: admin membership: ${member.error.message}`);
  return email;
}

test.describe("costs on a phone (360 px)", () => {
  test.setTimeout(180_000);

  test("the owner reads the plates: fixed costs not allocated, below target, incomplete (AT6, AT8 on screen)", async ({
    page,
  }) => {
    await seedCosts(page);
    await page.goto("/costi");
    await expect(page.getByRole("heading", { name: "Costi dei piatti" })).toBeVisible();
    await expect(nav(page).getByRole("link", { name: "Costi", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );

    // No fixed costs yet: the card says so and links to the form; food cost % is shown anyway.
    await expect(page.getByText("Non ripartiti", { exact: true })).toBeVisible();
    const stew = rowOf(page, PLATE);
    await expect(stew).toContainText("Costi fissi non ripartiti");
    await expect(stew).toContainText("Food cost 18,9 %");
    await expect(stew).toContainText("GP 81,1 %");
    await expect(stew).toContainText(/Costo cibo 2,06\s€/);
    await expect(rowOf(page, WINE_PLATE)).toContainText("Sotto obiettivo");
    await expect(rowOf(page, SALT_PLATE)).toContainText("Costo incompleto");
    await expect(rowOf(page, SALT_PLATE)).toContainText("Manca il prezzo di: Sale grosso (demo)");
    await expectPhoneFriendlyBothThemes(page);

    // The owner enters the month's fixed costs; with no sales they stay unallocated, in words.
    await page.getByRole("link", { name: "Inserisci i costi fissi del mese." }).click();
    await expect(page.getByRole("heading", { name: "Impostazioni dei costi" })).toBeVisible();
    await expect(
      page.getByText("Inserisci solo totali mensili, mai importi per persona."),
    ).toBeVisible();
    await page.getByLabel("Mese", { exact: true }).fill(today.slice(0, 7));
    await page.getByLabel("Affitto", { exact: true }).fill("3000");
    await page.getByLabel("Personale (totale del mese)", { exact: true }).fill("9000");
    await page.getByLabel("Utenze", { exact: true }).fill("1500");
    await expectPhoneFriendlyBothThemes(page);
    await page.getByRole("button", { name: "Salva costi fissi", exact: true }).click();
    await expect(page.getByText("Costi fissi salvati.")).toBeVisible();
    await expect(page.getByText(new RegExp(`${thisMonthLabel()} · 13\\.500,00\\s€`))).toBeVisible();

    await page.getByRole("link", { name: "Torna ai costi" }).click();
    await expect(
      page.getByText(
        "Nessun piatto venduto negli ultimi 30 giorni: il costo fisso non è ripartito. Food cost % e GP % restano validi.",
      ),
    ).toBeVisible();
    await expect(rowOf(page, PLATE)).toContainText("Food cost 18,9 %");
    await expectPhoneFriendly(page);
  });

  test("the cost of a batch per portion and of a sub-recipe with a yield (AT1, AT2 on screen)", async ({
    page,
  }) => {
    const { keys } = await seedCosts(page);

    await page.goto(`/costi/ricette/${keys[STEW]}`);
    await expect(page.getByRole("heading", { name: STEW })).toBeVisible();
    await expect(page.getByTestId("cost-unit")).toHaveText(/1,67\s€/);
    await expect(page.getByTestId("cost-total")).toHaveText(/50,00\s€/);
    await expect(page.getByText(/5\skg\s×\s10,00\s€\/kg\s÷\sresa\s1\s=\s50,00\s€/)).toBeVisible();
    await expectPhoneFriendlyBothThemes(page);

    await page.goto(`/costi/ricette/${keys[SUB]}`);
    await expect(page.getByText(/÷\sresa\s0,82/)).toBeVisible();
    await expect(page.getByTestId("cost-unit")).toHaveText(/12,20\s€/);

    await page.goto(`/costi/ricette/${keys[PLATE]}`);
    await expect(page.getByTestId("cost-total")).toHaveText(/2,06\s€/);
    await expect(page.getByText(/1\sporz\s×\s1,67\s€\s=\s1,67\s€/)).toBeVisible();
    await expectPhoneFriendly(page);
  });

  test("a new price shows at once, raises one alert and the basis can be switched (AT3, AT4, AT5, AT7 on screen)", async ({
    page,
  }) => {
    const { keys, buy } = await seedCosts(page);

    // AT4: the next screen after the approval already shows the new average (10, 10, 13 -> 11).
    await buy(day(0), [[BEEF, 20, 13]]);
    await page.goto("/costi");
    await expect(rowOf(page, PLATE)).toContainText("Food cost 20,4 %");
    await expect(rowOf(page, PLATE)).toContainText(/Costo cibo 2,22\s€/);

    // AT5: one alert for the owner, naming the ingredient and the change.
    await page.goto("/avvisi");
    await expect(
      page.getByText(/^Prezzo cambiato: Manzo muscolo \(demo\) \+30,0\s%$/),
    ).toBeVisible();
    await expect(page.getByText(/^Prezzo cambiato:/)).toHaveCount(1);
    await expectPhoneFriendly(page);

    // AT3: the average is in use; "Usa ultimo prezzo" switches to the last purchase.
    await page.goto("/costi/ingredienti");
    const beef = page.getByRole("listitem").filter({ hasText: BEEF });
    await expect(beef).toContainText("Media ultimi 3 acquisti");
    await expect(beef).toContainText(/In uso 11,00\s€\/kg/);
    await expect(beef).toContainText(/massimo 13,00\s€/);
    await expect(
      page.getByRole("listitem").filter({ hasText: "Sale grosso (demo)" }),
    ).toContainText("Nessun acquisto");
    await expectPhoneFriendlyBothThemes(page);
    await beef.getByRole("button", { name: "Usa ultimo prezzo", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Base di costo aggiornata.");
    await expect(beef).toContainText(/In uso 13,00\s€\/kg/);
    await expect(beef).toContainText("Ultimo prezzo");
    await expect(beef.getByRole("button", { name: "Usa la media", exact: true })).toBeVisible();

    // AT7: for a day before the purchase the older average applies (read through the API) ...
    const before = await page.request.get(`/api/costs/ingredients?at=${day(-1)}`);
    expect(before.status()).toBe(200);
    const older = (await before.json()).ingredients.find(
      (item: { name: string }) => item.name === BEEF,
    );
    expect(older.unitCostEur).toBe(10);
    // ... and a recipe that did not exist yet on that day says so in words.
    await page.goto(`/costi/ricette/${keys[STEW]}`);
    await page.getByLabel("Al giorno").fill(day(-1));
    await expect(
      page.getByRole("alert").filter({ hasText: "In quella data la ricetta non esisteva ancora." }),
    ).toBeVisible();
    await page.getByLabel("Al giorno").fill(today);
    await expect(page.getByRole("heading", { name: STEW })).toBeVisible();
  });

  test("the owner compares the chef's sheet with the app (AT9 on screen)", async ({ page }) => {
    await seedCosts(page);
    await page.goto("/costi/verifica");
    await expect(page.getByText("Colonne: piatto;costo_cibo")).toBeVisible();
    await page
      .getByLabel("Foglio dello chef (CSV)")
      .setInputFiles(fixturePath("foglio-chef-demo.csv"));
    await expectPhoneFriendlyBothThemes(page);
    await page.getByRole("button", { name: "Confronta", exact: true }).click();
    await expect(
      page.getByText("Piatti confrontati: 4 · fuori tolleranza (oltre 5 %): 2"),
    ).toBeVisible();
    await expect(page.getByText(/App\s10,60\s€\s·\sfoglio\s10,00\s€\s·\s\+6,0\s%/)).toBeVisible();
    await expect(page.getByText(/App\s9,40\s€\s·\sfoglio\s10,00\s€\s·\s−6,0\s%/)).toBeVisible();
    await expect(
      page.getByRole("listitem").filter({ hasText: "Piatto fantasma (demo)" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Doppi" })).toBeVisible();
    await expectPhoneFriendly(page);
  });

  test("the admin sees costs but no fixed cost, and cannot reach the fixed-cost form (founder 2026-10-23)", async ({
    page,
  }) => {
    const { tenantId } = await seedCosts(page);
    await switchTo(page, "admin", tenantId);

    await page.goto("/costi");
    await expect(rowOf(page, PLATE)).toContainText("Food cost 18,9 %");
    await expect(rowOf(page, PLATE)).toContainText("In linea");
    await expect(rowOf(page, PLATE)).not.toContainText("Costo pieno");
    await expect(rowOf(page, PLATE)).not.toContainText("non ripartiti");
    await expect(page.getByRole("heading", { name: "Costi fissi", exact: true })).toHaveCount(0);
    await expect(page.getByText("Non ripartiti", { exact: true })).toHaveCount(0);

    await page.goto("/costi/impostazioni");
    await expect(page.getByRole("heading", { name: "Regole di calcolo" })).toBeVisible();
    await expect(page.getByText("Costi fissi mensili (IVA esclusa)")).toHaveCount(0);
    await expect(page.getByLabel("Affitto", { exact: true })).toHaveCount(0);
    await expectPhoneFriendly(page);

    expect((await page.request.get("/api/fixed-costs")).status()).toBe(403);
    const write = await page.request.post("/api/fixed-costs", {
      data: { month: today.slice(0, 7), rentEur: 1, labourEur: 1, utilitiesEur: 1 },
    });
    expect(write.status()).toBe(403);
  });

  test("the chef reads percentages only: a Margini tab, no euro, no Costi tab (V6 on screen)", async ({
    page,
  }) => {
    const { tenantId, buy } = await seedCosts(page);
    await buy(day(0), [[BEEF, 20, 13]]);
    await switchTo(page, "chef", tenantId);

    await page.goto("/margini");
    await expect(page.getByRole("heading", { name: "Margini dei piatti" })).toBeVisible();
    await expect(nav(page).getByRole("link", { name: "Margini", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(nav(page).getByRole("link", { name: "Costi", exact: true })).toHaveCount(0);
    const stew = page.getByRole("listitem").filter({ hasText: PLATE });
    await expect(stew).toContainText("Food cost 20,4 %");
    await expect(stew).toContainText("obiettivo 70 %");
    await expect(stew).toContainText("In linea");
    await expect(page.getByRole("listitem").filter({ hasText: WINE_PLATE })).toContainText(
      "Sotto obiettivo",
    );
    await expect(page.getByRole("listitem").filter({ hasText: SALT_PLATE })).toContainText(
      "Dati incompleti",
    );
    await expect(page.locator("main")).not.toContainText("€");
    await expectPhoneFriendlyBothThemes(page);

    await page.goto("/costi");
    await expect(
      page.getByRole("alert").filter({ hasText: "I costi non sono disponibili per il tuo ruolo." }),
    ).toBeVisible();

    // The price alert is the owner's: the chef's list is empty.
    await page.goto("/avvisi");
    await expect(page.getByText("Nessun avviso da vedere.")).toBeVisible();
    await expect(page.getByText(/Prezzo cambiato/)).toHaveCount(0);
  });

  // UX plan P1-10 (B14): one plate's cost by line.
  const breakdownOf = (page: Page) => page.getByRole("region", { name: "Ripartizione del costo" });
  /** The percentages written on the lines, in the order shown ("81,0 %" is 81.0). */
  async function shownShares(page: Page): Promise<number[]> {
    const rows = await breakdownOf(page).getByRole("listitem").allInnerTexts();
    return rows.map((row) => Number(/(\d+,\d)\s%/.exec(row)![1]!.replace(",", ".")));
  }

  test("the owner reads a plate's cost by line: largest first, euro and percent, a bar each, incomplete flagged (P1-10)", async ({
    page,
  }) => {
    const { keys } = await seedCosts(page);
    await page.goto(`/costi/ricette/${keys[PLATE]}`);
    await expect(breakdownOf(page)).toBeVisible();
    const rows = breakdownOf(page).getByRole("listitem");
    await expect(rows).not.toHaveCount(0);
    for (const row of await rows.all()) await expect(row).toContainText("€");
    const shares = await shownShares(page);
    expect([...shares].sort((a, b) => b - a)).toEqual(shares);
    expect(Math.abs(shares.reduce((a, b) => a + b, 0) - 100)).toBeLessThanOrEqual(0.5);
    // One decorative bar per line: hidden from assistive technology, the numbers are text.
    const bars = breakdownOf(page).locator("[data-bar]");
    await expect(bars).toHaveCount(await rows.count());
    for (const bar of await bars.all()) await expect(bar).toHaveAttribute("aria-hidden", "true");
    await expect(breakdownOf(page)).toContainText(/Food cost \d+,\d\s%/);
    await expect(breakdownOf(page)).toContainText(/Prezzo IVA esclusa/);
    await expectPhoneFriendlyBothThemes(page);

    await page.goto(`/costi/ricette/${keys[SALT_PLATE]}`);
    await expect(breakdownOf(page)).toContainText("Dati incompleti");
    await expect(breakdownOf(page)).toContainText("Costo non calcolabile");
    await expect(breakdownOf(page)).toContainText("Manca il prezzo");
    await expectPhoneFriendly(page);
  });

  test("the chef opens a plate from the margins and reads percentages only, no euro on the page (P1-10, V6)", async ({
    page,
  }) => {
    const { tenantId, keys } = await seedCosts(page);
    await switchTo(page, "chef", tenantId);
    await page.goto("/margini");
    await page.getByRole("link", { name: PLATE, exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === `/margini/${keys[PLATE]}`);
    await expect(breakdownOf(page)).toBeVisible();
    await expect(breakdownOf(page).locator("[data-bar]")).not.toHaveCount(0);
    await expect(breakdownOf(page)).toContainText(/\d+,\d\s%/);
    // The whole page, shell included, not only the breakdown.
    await expect(page.locator("body")).not.toContainText("€");
    const shares = await shownShares(page);
    expect([...shares].sort((a, b) => b - a)).toEqual(shares);
    await expectPhoneFriendlyBothThemes(page);
  });

  test("the waiter has no link to either plate view, and the direct addresses say the role cannot read them (P1-10)", async ({
    page,
  }) => {
    const { tenantId, keys } = await seedCosts(page);
    await switchTo(page, "waiter", tenantId);
    await page.goto(`/margini/${keys[PLATE]}`);
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "I margini non sono disponibili per il tuo ruolo." }),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(breakdownOf(page)).toHaveCount(0);
    await expect(page.locator('a[href^="/margini"], a[href^="/costi"]')).toHaveCount(0);

    await page.goto(`/costi/ricette/${keys[PLATE]}`);
    await expect(
      page.getByRole("alert").filter({ hasText: "I costi non sono disponibili per il tuo ruolo." }),
    ).toBeVisible();
    await expect(breakdownOf(page)).toHaveCount(0);
  });

  test("the waiter has no cost tab and is told the role cannot read them (waiter on screen)", async ({
    page,
  }) => {
    const { tenantId } = await seedCosts(page);
    await switchTo(page, "waiter", tenantId);

    const role = page.waitForResponse((response) => response.url().endsWith("/api/me"));
    await page.goto("/margini");
    await role;
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "I margini non sono disponibili per il tuo ruolo." }),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");
    // The waiter's navigation has no invoices (the API refuses them), no costs and no margins: no link anywhere.
    await expect(page.locator('a[href="/fatture"]')).toHaveCount(0);
    await expect(page.locator('a[href="/costi"]')).toHaveCount(0);
    await expect(page.locator('a[href="/margini"]')).toHaveCount(0);
    await expect(nav(page).getByRole("link", { name: "Costi", exact: true })).toHaveCount(0);
    await expect(nav(page).getByRole("link", { name: "Margini", exact: true })).toHaveCount(0);
    await expect(page.getByRole("listitem").filter({ hasText: PLATE })).toHaveCount(0);

    await page.goto("/costi");
    await expect(
      page.getByRole("alert").filter({ hasText: "I costi non sono disponibili per il tuo ruolo." }),
    ).toBeVisible();
  });
});

test.describe("costs on a laptop (1280 px)", () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });
  test.setTimeout(180_000);

  test("the owner's plate breakdown has euro and bars and stays within the page column (P1-10)", async ({
    page,
  }) => {
    const { keys } = await seedCosts(page);
    await page.goto(`/costi/ricette/${keys[PLATE]}`);
    const region = page.getByRole("region", { name: "Ripartizione del costo" });
    await expect(region).toBeVisible();
    await expect(region).toContainText("€");
    await expect(region.locator("[data-bar]")).not.toHaveCount(0);
    const main = (await page.locator("main").boundingBox())!;
    const box = (await region.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(main.x);
    expect(box.x + box.width).toBeLessThanOrEqual(main.x + main.width + 1);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("the cost list stays within the page column", async ({ page }) => {
    await seedCosts(page);
    await page.goto("/costi");
    await expect(rowOf(page, PLATE)).toBeVisible();
    const main = (await page.locator("main").boundingBox())!;
    const list = (await page.locator("ul.ledger").boundingBox())!;
    expect(list.x).toBeGreaterThanOrEqual(main.x);
    expect(list.x + list.width).toBeLessThanOrEqual(main.x + main.width + 1);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
