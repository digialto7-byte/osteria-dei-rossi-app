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

// M6 acceptance tests on screen: alerts on a phone (360 x 740) and the laptop layout (1280 x 800).
// Alerts are raised through the real API (the owner's test alert) and read back on /avvisi; nothing
// here reads or writes the alert table with the secret key. Fake data only.

const TEST_TITLE = "Avviso di prova";
const KITCHEN_TITLE = "Avviso di prova per la cucina";

const rowOf = (page: Page, title: string) =>
  page.getByRole("listitem").filter({ has: page.getByText(title, { exact: true }) });
const noEmail = (page: Page) => expect(page.locator("main")).not.toContainText(/e-?mail/i);

/** The owner raises the test alerts through the API, as the button does. */
async function raiseAlerts(page: Page, { kitchen }: { kitchen: boolean }) {
  for (const includeKitchen of kitchen ? [false, true] : [false]) {
    const response = await page.request.post("/api/alerts/test", { data: { includeKitchen } });
    expect(response.status()).toBe(201);
  }
}

/** Signs the current browser out and in as someone else of the same tenant. */
async function switchTo(page: Page, role: "chef" | "waiter", tenantId: string) {
  await page.context().clearCookies();
  await signInWithMagicLink(page, await createStaff(tenantId, role));
}

test.describe("alerts on a phone (360 px)", () => {
  test("the owner raises, sees, acknowledges and finds an alert again (AT1, AT3, AT4 on screen)", async ({
    page,
  }) => {
    await signInWithMagicLink(page, createOwner());
    await page.goto("/avvisi");
    await expect(page.getByRole("heading", { name: "Avvisi" })).toBeVisible();
    await expect(page.getByText("Nessun avviso da vedere.")).toBeVisible();
    await expect(page.getByText("Prova degli avvisi")).toBeVisible();

    await page.getByRole("button", { name: "Invia avviso di prova" }).click();
    await expect(page.getByRole("status")).toContainText("Avviso di prova creato.");
    await expect(rowOf(page, TEST_TITLE)).toBeVisible();
    await expect(rowOf(page, TEST_TITLE).getByText("Informazione")).toBeVisible();

    // It stays under "Da vedere" until somebody acknowledges it.
    await page.reload();
    await expect(rowOf(page, TEST_TITLE)).toBeVisible();

    // The same day again: still one row.
    await page.getByRole("button", { name: "Invia avviso di prova" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Oggi hai già inviato questo avviso di prova.",
    );
    await expect(rowOf(page, TEST_TITLE)).toHaveCount(1);
    await expectPhoneFriendly(page);

    await rowOf(page, TEST_TITLE).getByRole("button", { name: "Ho visto" }).click();
    await expect(page.getByText("Nessun avviso da vedere.")).toBeVisible();

    await page.getByRole("button", { name: "Tutti" }).click();
    await expect(rowOf(page, TEST_TITLE)).toContainText(
      /Visto il \d{2}\/\d{2}\/\d{4}, \d{2}:\d{2} da Titolare Demo/,
    );
    await expect(rowOf(page, TEST_TITLE).getByRole("button")).toHaveCount(0);

    // The kitchen test alert.
    await page.getByLabel("Anche alla cucina").check();
    await page.getByRole("button", { name: "Invia avviso di prova" }).click();
    await expect(rowOf(page, KITCHEN_TITLE)).toBeVisible();
    await noEmail(page);
    await expectPhoneFriendly(page);
    await page.emulateMedia({ colorScheme: "dark" });
    await expectPhoneFriendly(page);
    await page.emulateMedia({ colorScheme: "light" });
  });

  test("the chef sees only the kitchen alert, without the test card, and can acknowledge it (AT6 on screen)", async ({
    page,
  }) => {
    await signInWithMagicLink(page, createOwner());
    const tenantId = await tenantIdOf(page);
    await raiseAlerts(page, { kitchen: true });
    await switchTo(page, "chef", tenantId);

    await page.goto("/avvisi");
    await expect(rowOf(page, KITCHEN_TITLE)).toBeVisible();
    await expect(rowOf(page, TEST_TITLE)).toHaveCount(0);
    await expect(page.getByText("Prova degli avvisi")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Invia avviso di prova" })).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText("€");
    await noEmail(page);
    await expectPhoneFriendly(page);
    await page.emulateMedia({ colorScheme: "dark" });
    await expectPhoneFriendly(page);
    await page.emulateMedia({ colorScheme: "light" });

    await rowOf(page, KITCHEN_TITLE).getByRole("button", { name: "Ho visto" }).click();
    await expect(page.getByText("Nessun avviso da vedere.")).toBeVisible();
    await page.getByRole("button", { name: "Tutti" }).click();
    await expect(rowOf(page, KITCHEN_TITLE)).toContainText("Visto il");
    await expect(rowOf(page, KITCHEN_TITLE)).not.toContainText(" da ");
  });

  test("the waiter is told alerts are not available for the role", async ({ page }) => {
    await signInWithMagicLink(page, createOwner());
    const tenantId = await tenantIdOf(page);
    await raiseAlerts(page, { kitchen: true });
    await switchTo(page, "waiter", tenantId);

    await page.goto("/avvisi");
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Gli avvisi non sono disponibili per il tuo ruolo." }),
    ).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: TEST_TITLE })).toHaveCount(0);
  });

  test("Avvisi is a tab of the main menu and a link on the home card", async ({ page }) => {
    await signInWithMagicLink(page, createOwner());
    await page.getByRole("main").getByRole("link", { name: "Avvisi" }).click();
    await expect(page).toHaveURL(/\/avvisi$/);
    await expect(
      page
        .getByRole("navigation", { name: "Menu principale" })
        .getByRole("link", { name: "Avvisi" }),
    ).toHaveAttribute("aria-current", "page");
  });
});

test.describe("alerts on a laptop (1280 px)", () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

  test("the list stays within the page column", async ({ page }) => {
    await signInWithMagicLink(page, createOwner());
    await raiseAlerts(page, { kitchen: true });
    await page.goto("/avvisi");
    await expect(rowOf(page, KITCHEN_TITLE)).toBeVisible();

    const main = await page.locator("main").boundingBox();
    const list = await page
      .getByRole("list")
      .filter({ has: rowOf(page, TEST_TITLE) })
      .boundingBox();
    expect(main && list).toBeTruthy();
    expect(list!.x).toBeGreaterThanOrEqual(main!.x);
    expect(list!.x + list!.width).toBeLessThanOrEqual(main!.x + main!.width + 1);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
