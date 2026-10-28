import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { tenantIdOf } from "./helpers/seed-invoice";
import {
  createOwner,
  createStaff,
  expectPhoneFriendly,
  requireSupabaseStack,
  signInWithMagicLink,
} from "./helpers/session";

requireSupabaseStack();

// M7 acceptance tests on screen: recipes on a phone (360 x 740) and the laptop layout (1280 x 800).
// The first test walks the owner through the import screens; the others seed the same fake data
// through the real API (the owner's own session) and read it back on screen. Nothing here reads or
// writes a recipe table with the secret key: the only fixtures outside the API are staff members,
// created by the existing helper. Fake data only ("(demo)" names). Dates are matched by shape: they
// are Europe/Rome dates of "now".

const fixturePath = (name: string) =>
  fileURLToPath(new URL(`../tests/fixtures/import/${name}`, import.meta.url));
const fixtureText = (name: string) => readFileSync(fixturePath(name), "utf8");

const STEW = "Spezzatino (demo)";
const SUB = "Polenta (demo)";
const PLATE = "Spezzatino con polenta (demo)";
const FLOUR = "Farina di mais (demo)";
const TODO_BADGE = "Allergeni da confermare";

const rowOf = (page: Page, name: string) =>
  page.getByRole("listitem").filter({ has: page.getByRole("link", { name, exact: true }) });
const nav = (page: Page) => page.getByRole("navigation", { name: "Menu principale" });

/** Dark and light, as the other signed-in specs do. */
async function expectPhoneFriendlyBothThemes(page: Page) {
  await expectPhoneFriendly(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await expectPhoneFriendly(page);
  await page.emulateMedia({ colorScheme: "light" });
}

/** The owner's own session seeds the demo data through the API, exactly as the screens would. */
async function seedDemoRecipes(page: Page) {
  const ingredients = await page.request.post("/api/admin/import/ingredients", {
    data: { format: "csv", csv: fixtureText("ingredienti-ricette-demo.csv") },
  });
  expect(ingredients.status()).toBe(200);
  await confirmAllergens(page, ["Manzo muscolo (demo)", "Pane (demo)"]);
  const recipes = await page.request.post("/api/admin/import/recipes", {
    data: { format: "csv", csv: fixtureText("ricette-demo.csv") },
  });
  expect(recipes.status()).toBe(200);
  expect((await recipes.json()).created).toBe(3);
}

/** The owner confirms the lists as they were declared, through the API. */
async function confirmAllergens(page: Page, names: string[]) {
  const listed = await page.request.get("/api/ingredients");
  const items = (await listed.json()).ingredients as {
    id: string;
    name: string;
    allergens: string[] | null;
  }[];
  for (const name of names) {
    const item = items.find((i) => i.name === name)!;
    const response = await page.request.post(`/api/ingredients/${item.id}/allergens/confirm`, {
      data: { allergens: item.allergens ?? [] },
    });
    expect(response.status()).toBe(200);
  }
}

async function recipeKeys(page: Page): Promise<Record<string, string>> {
  const response = await page.request.get("/api/recipes");
  const { recipes } = (await response.json()) as { recipes: { key: string; name: string }[] };
  return Object.fromEntries(recipes.map((r) => [r.name, r.key]));
}

/** Two subs where B uses A, ready for the loop A -> B -> A. */
async function seedSubPair(page: Page) {
  const ingredients = (await (await page.request.get("/api/ingredients")).json()).ingredients as {
    id: string;
    name: string;
  }[];
  const flour = ingredients.find((i) => i.name === FLOUR)!.id;
  const a = await page.request.post("/api/recipes", {
    data: {
      type: "sub",
      name: "Sugo A (demo)",
      outputQty: 1,
      outputUnit: "kg",
      lines: [{ ingredientId: flour, qty: 1, unit: "kg" }],
    },
  });
  expect(a.status()).toBe(201);
  const aKey = (await a.json()).recipe.key as string;
  const b = await page.request.post("/api/recipes", {
    data: {
      type: "sub",
      name: "Sugo B (demo)",
      outputQty: 1,
      outputUnit: "kg",
      lines: [{ recipeKey: aKey, qty: 1, unit: "kg" }],
    },
  });
  expect(b.status()).toBe(201);
  return aKey;
}

/** Signs the current browser out and in as someone else of the same tenant. */
async function switchTo(page: Page, role: "chef" | "waiter", tenantId: string) {
  await page.context().clearCookies();
  await signInWithMagicLink(
    page,
    await createStaff(tenantId, role),
    role === "waiter" ? "/tavoli" : "/",
  );
}

test.describe("recipes on a phone (360 px)", () => {
  test("the owner imports with a preview, sees the allergen state and confirms it (AT4, AT6 on screen)", async ({
    page,
  }) => {
    await signInWithMagicLink(page, createOwner());

    // Ingredients first (the recipes name them).
    await page.goto("/anagrafiche/importa");
    await page.getByLabel("Cosa importi").selectOption({ label: "Ingredienti" });
    await expect(page.getByText(/«nessuno»/)).toBeVisible();
    await page.getByLabel("File CSV").setInputFiles(fixturePath("ingredienti-ricette-demo.csv"));
    await page.getByRole("button", { name: "Importa", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("3 creati, 0 aggiornati, 0 invariati");
    await confirmAllergens(page, ["Manzo muscolo (demo)", "Pane (demo)"]);

    // Recipes: the preview is on by default and writes nothing.
    await page.getByLabel("Cosa importi").selectOption({ label: "Ricette" });
    await page.getByLabel("File CSV").setInputFiles(fixturePath("ricette-demo.csv"));
    await expect(page.getByLabel("Solo anteprima")).toBeChecked();
    await page.getByRole("button", { name: "Anteprima", exact: true }).click();
    await expect(page.getByText("Nuova", { exact: true })).toHaveCount(3);
    await expect(page.getByText("Non è stato salvato nulla.")).toBeVisible();
    expect((await (await page.request.get("/api/recipes?active=all")).json()).recipes).toEqual([]);
    await expectPhoneFriendly(page);

    await page.getByRole("button", { name: "Importa", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("3 nuove, 0 nuove versioni, 0 invariate");

    // The same file again changes nothing.
    await page.getByRole("button", { name: "Anteprima", exact: true }).click();
    await expect(page.getByText("Invariata", { exact: true })).toHaveCount(3);

    // The list: the plate and the sub wait for the flour; the stew does not.
    await page.goto("/ricette");
    await expect(page.getByRole("listitem")).toHaveCount(3);
    await expect(rowOf(page, PLATE).getByText(TODO_BADGE)).toBeVisible();
    await expect(rowOf(page, SUB).getByText(TODO_BADGE)).toBeVisible();
    await expect(rowOf(page, STEW).getByText(TODO_BADGE)).toHaveCount(0);
    await expect(rowOf(page, STEW)).toContainText(/v1 · dal \d{2}\/\d{2}\/\d{4}/);
    await expectPhoneFriendlyBothThemes(page);

    // The plate: the menu price and the target GP%, and the flour named as still to confirm.
    await page.getByRole("link", { name: PLATE, exact: true }).click();
    await expect(page.getByRole("heading", { name: PLATE })).toBeVisible();
    await expect(page.getByText(/12,00\s€/)).toBeVisible();
    await expect(page.getByText("70%")).toBeVisible();
    await expect(page.getByText(`Da confermare: ${FLOUR}`)).toBeVisible();
    await expectPhoneFriendlyBothThemes(page);

    // The owner confirms the flour; the badges go.
    await page.goto("/anagrafiche/ingredienti");
    const flourRow = page.getByRole("listitem").filter({ hasText: FLOUR });
    await expect(flourRow).toContainText("Non indicati");
    await expect(flourRow).toContainText("da confermare");
    await flourRow.getByRole("button", { name: "Conferma allergeni", exact: true }).click();
    await expect(flourRow.getByRole("checkbox")).toHaveCount(14);
    await expect(
      flourRow.getByText("Controlla le etichette dei fornitori prima di confermare."),
    ).toBeVisible();
    await expectPhoneFriendly(page);
    await flourRow.getByRole("button", { name: "Conferma", exact: true }).click();
    await expect(flourRow).toContainText(/Confermati il \d{2}\/\d{2}\/\d{4}/);
    await expect(
      flourRow.getByRole("button", { name: "Conferma allergeni", exact: true }),
    ).toHaveCount(0);

    await page.goto("/ricette");
    await expect(rowOf(page, PLATE)).toBeVisible();
    await expect(page.getByText(TODO_BADGE)).toHaveCount(0);
  });

  test("the chef saves version 2 and reads version 1 unchanged (AT1, AT5 on screen)", async ({
    page,
  }) => {
    await signInWithMagicLink(page, createOwner());
    const tenantId = await tenantIdOf(page);
    await seedDemoRecipes(page);
    await switchTo(page, "chef", tenantId);

    await page.goto("/ricette");
    await expect(nav(page).getByRole("link", { name: "Ricette", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await page.getByRole("link", { name: STEW, exact: true }).click();
    await expect(page.getByText("72 ore")).toBeVisible();
    await expectPhoneFriendlyBothThemes(page);

    await page.getByRole("button", { name: "Nuova versione", exact: true }).click();
    await expect(page.getByLabel("Conservazione (ore)")).toHaveValue("72");
    await page.getByLabel("Conservazione (ore)").fill("48");
    await expectPhoneFriendlyBothThemes(page);
    await page.getByRole("button", { name: "Salva versione", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Versione 2 salvata.");
    await expect(page.getByText("48 ore")).toBeVisible();

    // Version 1 opens read-only with the old shelf life.
    await page.getByRole("link", { name: /^Versione 1 del/ }).click();
    await expect(page.getByText("Versione 1 di 2 — non modificabile")).toBeVisible();
    await expect(page.getByText("72 ore")).toBeVisible();
    await expect(page.getByText("Allergeni secondo i dati attuali")).toBeVisible();
    await expect(page.getByRole("button", { name: "Nuova versione", exact: true })).toHaveCount(0);
    await expectPhoneFriendly(page);
  });

  test("the chef reads the plate's menu price but can neither set it nor see a cost (AT5 on screen)", async ({
    page,
  }) => {
    await signInWithMagicLink(page, createOwner());
    const tenantId = await tenantIdOf(page);
    await seedDemoRecipes(page);
    await switchTo(page, "chef", tenantId);

    await page.goto("/ricette");
    await page.getByRole("link", { name: PLATE, exact: true }).click();
    await expect(page.getByText(/12,00\s€/)).toBeVisible();
    await expect(page.getByText("70%")).toBeVisible();
    await expect(page.locator("main")).not.toContainText(/costo|margine/i);
    await expect(page.getByRole("button", { name: "Disattiva", exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Nuova versione", exact: true }).click();
    await expect(page.getByLabel("Nome", { exact: true })).toHaveValue(PLATE);
    await expect(page.getByLabel(/Prezzo di vendita/)).toHaveCount(0);
    await expect(page.getByLabel(/GP obiettivo/)).toHaveCount(0);
    await expectPhoneFriendlyBothThemes(page);

    // The API refuses a price from the chef even when the form is bypassed.
    const key = (await recipeKeys(page))[PLATE]!;
    const detail = (await (await page.request.get(`/api/recipes/${key}`)).json()).recipe as {
      lines: { target: { kind: string; id: string }; qty: number; unit: string }[];
    };
    const lines = detail.lines.map((line) => ({
      ...(line.target.kind === "ingredient"
        ? { ingredientId: line.target.id }
        : { recipeKey: line.target.id }),
      qty: line.qty,
      unit: line.unit,
    }));
    const refused = await page.request.post(`/api/recipes/${key}/versions`, {
      data: { baseVersion: 1, name: PLATE, salePrice: 15, lines },
    });
    expect(refused.status()).toBe(403);
    expect((await refused.json()).error.code).toBe("recipe_price_forbidden");
  });

  test("a loop of sub-recipes and a zero yield are refused in Italian (AT2, AT3 on screen)", async ({
    page,
  }) => {
    await signInWithMagicLink(page, createOwner());
    const tenantId = await tenantIdOf(page);
    await seedDemoRecipes(page);
    await seedSubPair(page);
    await switchTo(page, "chef", tenantId);

    // A would use B, and B already uses A.
    await page.goto("/ricette");
    await page.getByRole("link", { name: "Sugo A (demo)", exact: true }).click();
    await page.getByRole("button", { name: "Nuova versione", exact: true }).click();
    await page.getByRole("button", { name: "Aggiungi riga", exact: true }).click();
    const second = page.getByRole("group", { name: "Riga 2", exact: true });
    await second.getByLabel("Ingrediente o ricetta").selectOption({ label: "Sugo B (demo)" });
    await second.getByLabel("Quantità").fill("1");
    await page.getByRole("button", { name: "Salva versione", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({
        hasText:
          "Questa sottoricetta usa già, direttamente o indirettamente, la ricetta che stai modificando.",
      }),
    ).toBeVisible();

    // A yield of zero on the stew.
    await page.goto("/ricette");
    await page.getByRole("link", { name: STEW, exact: true }).click();
    await page.getByRole("button", { name: "Nuova versione", exact: true }).click();
    await page.getByRole("group", { name: "Riga 1", exact: true }).getByLabel("Resa").fill("0");
    await page.getByRole("button", { name: "Salva versione", exact: true }).click();
    await expect(page.getByText("La resa deve essere maggiore di 0.")).toBeVisible();
    await expectPhoneFriendly(page);
  });

  test("the waiter is told recipes are not available for the role and sees no tab (waiter on screen)", async ({
    page,
  }) => {
    await signInWithMagicLink(page, createOwner());
    const tenantId = await tenantIdOf(page);
    await seedDemoRecipes(page);
    await switchTo(page, "waiter", tenantId);

    const role = page.waitForResponse((response) => response.url().endsWith("/api/me"));
    await page.goto("/ricette");
    await role;
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Le ricette non sono disponibili per il tuo ruolo." }),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");
    // The waiter's navigation has no invoices (the API refuses them) and no recipes: no link to either anywhere.
    await expect(page.locator('a[href="/fatture"]')).toHaveCount(0);
    await expect(page.locator('a[href="/ricette"]')).toHaveCount(0);
    await expect(nav(page).getByRole("link", { name: "Ricette", exact: true })).toHaveCount(0);
    await expect(page.getByRole("listitem").filter({ hasText: STEW })).toHaveCount(0);
  });
});

test.describe("recipes on a laptop (1280 px)", () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

  test("the recipe page stays within the page column", async ({ page }) => {
    await signInWithMagicLink(page, createOwner());
    await seedDemoRecipes(page);
    const keys = await recipeKeys(page);
    await page.goto(`/ricette/${keys[PLATE]}`);
    await expect(page.getByRole("heading", { name: PLATE })).toBeVisible();

    const main = (await page.locator("main").boundingBox())!;
    const facts = (await page.locator("dl").boundingBox())!;
    expect(facts.x).toBeGreaterThanOrEqual(main.x);
    expect(facts.x + facts.width).toBeLessThanOrEqual(main.x + main.width + 1);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
