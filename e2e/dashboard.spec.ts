import { expect, test, type Page } from "@playwright/test";
import { SEEDED, seedDashboardTenant } from "./helpers/seed-dashboard";
import { admin, tenantIdOf } from "./helpers/seed-invoice";
import {
  createOwner,
  createStaff,
  expectPhoneFriendly,
  requireSupabaseStack,
  signInWithMagicLink,
} from "./helpers/session";
import { MIN_MEASURED_TAP_PX } from "./helpers/tap";

requireSupabaseStack();

// Owner dashboard plan §5 step 14: Oggi as the dashboard, on a phone (360 x 740) and on a laptop (1280 x 800). The owner's
// tenant is seeded through the real API (helpers/seed-dashboard.ts) in the first test; the others sign in to the same tenant.
// Tiles are found by their data attributes, never by position; "absent" is asserted only after the dashboard has settled;
// amounts are matched with \s+ (a no-break space precedes the euro sign); no assertion rests on an exact sub-pixel value.
// Fake data only.

test.describe.configure({ mode: "serial" });

const tile = (page: Page, key: string) => page.locator(`main [data-tile="${key}"]`);
const tiles = (page: Page) => page.locator('main [data-testid="dashboard-tiles"]');
const nav = (page: Page) => page.getByRole("navigation", { name: "Menu principale" });

let owner: { email: string; tenantId: string } | null = null;

async function signInAsOwner(page: Page) {
  if (!owner) throw new Error("The seeding test must run first");
  await signInWithMagicLink(page, owner.email, "/");
}

/** Signs the current browser out and in as someone else of the same tenant. */
async function switchTo(page: Page, role: "admin" | "chef") {
  await page.context().clearCookies();
  await signInWithMagicLink(page, await createStaff(owner!.tenantId, role));
}

async function expectPhoneFriendlyBothThemes(page: Page) {
  await expectPhoneFriendly(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await expectPhoneFriendly(page);
  await page.emulateMedia({ colorScheme: "light" });
}

test.describe("the owner's dashboard on a phone (360 px)", () => {
  test("seeded owner: the to-dos first, then the tiles with the seeded figures", async ({
    page,
  }) => {
    const email = createOwner();
    await signInWithMagicLink(page, email, "/");
    const tenantId = await tenantIdOf(page);
    await seedDashboardTenant(page, admin(), tenantId);
    owner = { email, tenantId };

    await page.goto("/");
    await expect(tiles(page)).toBeVisible();
    await page.waitForLoadState("networkidle");

    // The to-do block (first steps) comes before the tiles.
    const steps = page.getByRole("heading", { name: "Primi passi" });
    await expect(steps).toBeVisible();
    const stepsBox = await steps.boundingBox();
    const tilesBox = await tiles(page).boundingBox();
    expect(stepsBox!.y).toBeLessThan(tilesBox!.y);

    // Margini dei piatti: the seeded plates by recipe key, with the word that says below or on target.
    const plates = tile(page, "plates");
    await expect(plates.locator("tr[data-recipe-key]")).toHaveCount(2);
    await expect(
      plates.locator("tr[data-recipe-key]", { hasText: SEEDED.plates.below }),
    ).toContainText("Sotto obiettivo");
    await expect(
      plates.locator("tr[data-recipe-key]", { hasText: SEEDED.plates.ok }),
    ).toContainText("In linea");
    await expect(plates.getByText("Costo incompleto")).toBeVisible();
    await expect(plates.getByText(SEEDED.plates.incomplete)).toBeVisible();

    await expect(tile(page, "foodCost")).toContainText(SEEDED.texts.foodCost);
    await expect(tile(page, "foodCost")).toContainText("non pesata sulle vendite");
    await expect(tile(page, "payables")).toContainText(SEEDED.texts.overdue);
    await expect(tile(page, "payables")).toContainText(SEEDED.texts.dueSoon);
    await expect(tile(page, "stockAtRisk")).toContainText(SEEDED.belowMin);
    await expect(tile(page, "stockAtRisk")).toContainText(SEEDED.lotCode);
    await expect(tile(page, "waste")).toContainText(SEEDED.texts.waste);
    await expect(tile(page, "fixedCosts")).toContainText(SEEDED.texts.fixed);
    await expect(tile(page, "fixedCosts")).toContainText(
      "Non ripartiti finché non ci sono vendite.",
    );

    // The placeholders carry no number.
    const soon = tile(page, "comingSoon");
    await expect(soon).toContainText("Disponibile dopo l'avvio di comande e conti");
    expect(await soon.innerText()).not.toMatch(/\d/);
    await expect(soon.locator("a")).toHaveCount(0);
  });

  test("a phone-friendly page in light and dark, with tile links of at least 44 px", async ({
    page,
  }) => {
    await signInAsOwner(page);
    await expect(tiles(page)).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expectPhoneFriendlyBothThemes(page);

    // expectPhoneFriendly does not measure `main a`: the tile links are measured here, in one pass.
    const small = await page.evaluate((min) => {
      return [...document.querySelectorAll<HTMLElement>("main [data-tile] a")]
        .filter((a) => a.getBoundingClientRect().width > 0)
        .filter((a) => a.getBoundingClientRect().height < min)
        .map((a) => `${a.getBoundingClientRect().height} ${a.outerHTML.slice(0, 120)}`);
    }, MIN_MEASURED_TAP_PX);
    expect(small).toEqual([]);
  });

  test("Apri pagamenti leads to the payables", async ({ page }) => {
    await signInAsOwner(page);
    await expect(tile(page, "payables")).toBeVisible();
    await tile(page, "payables").getByRole("link", { name: "Apri pagamenti" }).click();
    await page.waitForURL((url) => url.pathname === "/pagamenti");
    await expect(page.getByRole("heading", { name: "Pagamenti", exact: true })).toBeVisible();
  });
});

test.describe("other roles", () => {
  test("the admin gets the dashboard without the Costi fissi tile", async ({ page }) => {
    await signInAsOwner(page);
    await switchTo(page, "admin");
    await expect(tiles(page)).toBeVisible();
    await expect(tile(page, "payables")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(tile(page, "fixedCosts")).toHaveCount(0);
    await expect(tile(page, "priceVariance")).toHaveCount(0);
    await expect(tile(page, "todayLists")).toHaveCount(0);
    expect(await page.locator("main").innerText()).not.toMatch(/Costi fissi/);
  });

  test("the chef keeps the action list: no tiles, no euro sign, and the endpoint says 403", async ({
    page,
  }) => {
    await signInAsOwner(page);
    await switchTo(page, "chef");
    await expect(page.getByRole("link", { name: /^Cosa preparare/ })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(tiles(page)).toHaveCount(0);
    expect(await page.locator("main").innerText()).not.toContain("€");
    const refused = await page.request.get("/api/dashboard");
    expect(refused.status()).toBe(403);
  });
});

test.describe("the laptop (1280 x 800)", () => {
  test("the tiles form a grid, main is wide and the sidebar is there", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signInAsOwner(page);
    await expect(tiles(page)).toBeVisible();
    await page.waitForLoadState("networkidle");

    const columns = await tiles(page).evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean).length,
    );
    expect(columns).toBeGreaterThanOrEqual(2);
    const main = await page.locator("main").boundingBox();
    expect(main!.width).toBeGreaterThan(448);
    await expect(nav(page)).toBeVisible();
  });
});

test.describe("an empty tenant", () => {
  test("every tile shows its empty text, and the placeholders show no digit", async ({ page }) => {
    await signInWithMagicLink(page, createOwner(), "/");
    await expect(tiles(page)).toBeVisible();
    await page.waitForLoadState("networkidle");

    const empty: Array<[string, string]> = [
      ["todayLists", "Niente da preparare o da ordinare oggi."],
      ["plates", "Nessun piatto attivo."],
      ["foodCost", "Nessun piatto con costo completo."],
      ["payables", "Nessun pagamento scaduto o in scadenza nei prossimi 7 giorni."],
      ["stockAtRisk", "Nessuna scorta a rischio."],
      ["waste", "Nessuno spreco registrato questa settimana."],
      ["priceVariance", "Nessun aumento di prezzo da vedere."],
      ["fixedCosts", "Costi fissi non inseriti."],
    ];
    for (const [key, text] of empty) await expect(tile(page, key)).toContainText(text);
    expect(await tile(page, "comingSoon").innerText()).not.toMatch(/\d/);
  });
});
