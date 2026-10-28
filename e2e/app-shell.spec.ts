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

// The app shell (docs/plans/2026-10-28-ux-flows.md, PR A, ADR-020) on a phone (360 x 740) and the laptop
// (1280 x 800). Fake data only. Roles are made with the helpers the other specs use.

test.describe("one main per page (A3)", () => {
  test("the public screens and the signed-in pages each have exactly one main and a wordmark link to Oggi", async ({
    page,
  }) => {
    for (const path of ["/login", "/pin"]) {
      await page.goto(path);
      await expect(page.locator("main")).toHaveCount(1);
      await expect(page.getByRole("link", { name: "Osteria Dei Rossi, Oggi" })).toHaveAttribute(
        "href",
        "/",
      );
    }

    await signInWithMagicLink(page, createOwner());
    for (const path of ["/", "/fatture"]) {
      await page.goto(path);
      await expect(page.locator("main")).toHaveCount(1);
      await expect(page.getByRole("link", { name: "Osteria Dei Rossi, Oggi" })).toHaveAttribute(
        "href",
        "/",
      );
    }
  });

  test("the wordmark leads back to Oggi from any page", async ({ page }) => {
    await signInWithMagicLink(page, createOwner());
    await page.goto("/fatture");
    await page.getByRole("link", { name: "Osteria Dei Rossi, Oggi" }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/");
    await expect(page.getByTestId("role")).toHaveText("Ruolo: Titolare");
  });
});

type Role = "owner" | "admin" | "chef" | "waiter";

/** Signs in as a fresh owner, or as a staff member of that owner's new tenant. */
async function signInAs(page: Page, role: Role): Promise<void> {
  await signInWithMagicLink(page, createOwner());
  if (role === "owner") return;
  const tenantId = await tenantIdOf(page);
  await page.context().clearCookies();
  await signInWithMagicLink(page, await createStaff(tenantId, role));
}

const bottomBar = (page: Page) => page.getByRole("navigation", { name: "Sezioni" });
const sectionRow = (page: Page) => page.getByRole("navigation", { name: "Menu principale" });
const main = (page: Page) => page.locator("main");

// What each role may open, per the nav model (src/lib/nav/nav-model.ts).
const PAGES: Record<"owner" | "admin" | "chef", string[]> = {
  owner: ["/", "/fatture", "/magazzino"],
  admin: ["/", "/fatture", "/magazzino"],
  chef: ["/", "/produzione", "/magazzino"],
};
const TABS: Record<"owner" | "admin" | "chef", string[]> = {
  owner: ["Oggi", "Acquisti", "Cucina", "Sala", "Gestione"],
  admin: ["Oggi", "Acquisti", "Cucina", "Sala", "Gestione"],
  chef: ["Oggi", "Cucina", "Gestione"],
};

test.describe("the shell on a phone (360 px)", () => {
  test.setTimeout(120_000);

  for (const role of ["owner", "admin", "chef"] as const) {
    test(`the ${role} has the bottom tab bar, 44 px targets and no sideways scroll (A4)`, async ({
      page,
    }) => {
      await signInAs(page, role);
      for (const path of PAGES[role]) {
        await page.goto(path);
        await expect(bottomBar(page)).toBeVisible();
        const tabs = bottomBar(page).getByRole("link");
        await expect(tabs).toHaveText(TABS[role]);
        // Exactly one tab is current; the tab bar sits at the bottom edge of the viewport.
        await expect(bottomBar(page).locator('[aria-current="page"]')).toHaveCount(1);
        const bar = (await bottomBar(page).boundingBox())!;
        expect(bar.y + bar.height).toBeGreaterThan(page.viewportSize()!.height - 1);
        // The sidebar belongs to the laptop: display none here, so at most one "Menu principale" landmark (the row).
        expect(await sectionRow(page).count()).toBeLessThanOrEqual(1);
        await expectPhoneFriendly(page);
      }
    });
  }

  test("the last element of main is not covered by the bar after scrolling to the end (A4)", async ({
    page,
  }) => {
    await signInAs(page, "owner");
    // The staff list and the Oggi page are short; a long page is the supplier import template.
    for (const path of ["/", "/fatture", "/magazzino", "/anagrafiche/importa"]) {
      await page.goto(path);
      await expect(main(page).locator(":scope > *").last()).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      const last = (await main(page).locator(":scope > *").last().boundingBox())!;
      const bar = (await bottomBar(page).boundingBox())!;
      expect(last.y + last.height, path).toBeLessThanOrEqual(bar.y);
    }
  });

  test("focusing a text field hides the bar, leaving it brings it back (A4)", async ({ page }) => {
    await signInAs(page, "owner");
    await page.goto("/anagrafiche/fornitori");
    await expect(bottomBar(page)).toBeVisible();
    await page.locator('main input[name="name"]').first().focus();
    await expect(bottomBar(page)).toBeHidden();
    await page.locator("main input").first().blur();
    await expect(bottomBar(page)).toBeVisible();
  });

  test("a tab opens the group's first section and the row shows the group's sections (A4)", async ({
    page,
  }) => {
    await signInAs(page, "owner");
    await page.goto("/");
    await bottomBar(page).getByRole("link", { name: "Acquisti" }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/fatture");
    await expect(sectionRow(page).getByRole("link")).toHaveText([
      "Fatture",
      "Pagamenti",
      "Fornitori",
    ]);
    await expect(sectionRow(page).locator('[aria-current="page"]')).toHaveText("Fatture");
    await sectionRow(page).getByRole("link", { name: "Pagamenti" }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/pagamenti");
    await expect(bottomBar(page).locator('[aria-current="page"]')).toHaveText("Acquisti");
  });

  test("the waiter has no tab bar and no section row (A4)", async ({ page }) => {
    await signInAs(page, "waiter");
    await page.goto("/tavoli");
    await expect(page.getByRole("heading", { name: "Tavoli", exact: true })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(bottomBar(page)).toHaveCount(0);
    await expect(sectionRow(page)).toHaveCount(0);
  });

  test("the chef's whole page, shell included, has no euro sign (A4)", async ({ page }) => {
    await signInAs(page, "chef");
    for (const path of ["/", "/produzione", "/magazzino"]) {
      await page.goto(path);
      await expect(bottomBar(page)).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expect(page.locator("body")).not.toContainText("€");
    }
  });
});

test.describe("the shell on a laptop (1280 px)", () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });
  test.setTimeout(120_000);

  test("the owner has the sidebar with every group and section, and no bottom bar (A4)", async ({
    page,
  }) => {
    await signInAs(page, "owner");
    for (const path of ["/", "/fatture"]) {
      await page.goto(path);
      const sidebar = page.getByRole("navigation", { name: "Menu principale" });
      await expect(sidebar).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Menu principale" })).toHaveCount(1);
      await expect(sidebar.getByRole("heading")).toHaveText([
        "Oggi",
        "Acquisti",
        "Cucina",
        "Sala",
        "Gestione",
      ]);
      await expect(sidebar.getByRole("link")).toHaveText([
        "Oggi",
        "Avvisi",
        "Fatture",
        "Pagamenti",
        "Fornitori",
        "Produzione",
        "Magazzino",
        "Riordino",
        "Ricette",
        "Tavoli",
        "Menu",
        "Costi",
        "Registro",
        "Personale",
        "Ingredienti",
        "Ubicazioni",
        "Importa",
      ]);
      await expect(bottomBar(page)).toBeHidden();
    }
    await page.goto("/pagamenti");
    await expect(
      page.getByRole("navigation", { name: "Menu principale" }).locator('[aria-current="page"]'),
    ).toHaveText("Pagamenti");
  });

  test("the chef's sidebar has only the chef's sections (A4)", async ({ page }) => {
    await signInAs(page, "chef");
    await page.goto("/");
    const sidebar = page.getByRole("navigation", { name: "Menu principale" });
    await expect(sidebar.getByRole("link")).toHaveText([
      "Oggi",
      "Avvisi",
      "Produzione",
      "Magazzino",
      "Riordino",
      "Ricette",
      "Margini",
      "Ingredienti",
    ]);
  });
});
