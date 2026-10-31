import { expect, test, type Page } from "@playwright/test";
import { main, newContext } from "./helpers/order-ui";
import { seedReports, type ReportsSeed } from "./helpers/seed-reports";
import { createWaiter, WAITER_A } from "./helpers/seed-menu-tables";
import { tenantIdOf } from "./helpers/seed-invoice";
import {
  createOwner,
  createStaff,
  expectPhoneFriendly,
  requireSupabaseStack,
  signInWithMagicLink,
} from "./helpers/session";

requireSupabaseStack();

// M22 on a phone (360 x 740), Chromium (`phone`) and WebKit (`phone-webkit`): the "Ieri" tile on Oggi, its opens count, and the four views of /report.
// A waiter sells and closes two tables (the AT2 table of 100,00 € and a small one of 7,00 €), the owner counts the stock twice (monthly, the second
// time 0,5 kg short of the first ingredient). The server clock cannot be moved here, so the sales are on today's business date and are not final.
// Rows are found by data attributes, never by position; the alert is scoped to `main` (the Next.js route announcer is a role=alert too); amounts
// are matched with \s+ (U+00A0 before the euro sign); every network wait has a timeout; the numbers are read from the API and compared with the page.
// Fake data only.
//   AT1/AT2 live  covers and food cost % on screen are the API's    AT5  the unmapped view lists the drink    AT4  the variance row
//   AT8  the admin sees no "Costi fissi", the chef and the waiter get the reserved message and a 403    AT9  Oggi posts one open

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

/** Dark and light, as the other signed-in specs do. */
async function expectPhoneFriendlyBothThemes(page: Page) {
  await expectPhoneFriendly(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await expectPhoneFriendly(page);
  await page.emulateMedia({ colorScheme: "light" });
}

let owner: { email: string; tenantId: string; seed: ReportsSeed } | null = null;

// Serial mode re-runs this in a fresh worker after a failure, which seeds a new tenant: no test depends on another.
test.beforeAll(async ({ browser }, testInfo) => {
  const { context, page } = await newContext(browser, testInfo.project.use);
  const waiterContext = await newContext(browser, testInfo.project.use);
  try {
    const email = createOwner();
    await signInWithMagicLink(page, email, "/");
    const tenantId = await tenantIdOf(page);
    await signInWithMagicLink(
      waiterContext.page,
      await createWaiter(tenantId, WAITER_A),
      "/tavoli",
    );
    owner = { email, tenantId, seed: await seedReports(page, waiterContext.page, tenantId) };
  } finally {
    await waiterContext.context.close();
    await context.close();
  }
});

test.describe("Oggi and /report for the owner", () => {
  test("Oggi shows the Ieri tile with its link, and posts exactly one open", async ({ page }) => {
    await signInWithMagicLink(page, owner!.email);
    const posts: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/dashboard/opens"
      ) {
        posts.push(request.url());
      }
    });
    await page.reload();
    const tile = main(page).locator('[data-tile="yesterday"]');
    await expect(tile).toBeVisible();
    await expect(tile.getByRole("link", { name: "Apri report" })).toHaveAttribute(
      "href",
      "/report",
    );
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
    expect(posts).toHaveLength(1);
    await expectPhoneFriendlyBothThemes(page);
  });

  test("Andamento: the covers and the food cost % on screen are the API's", async ({ page }) => {
    await signInWithMagicLink(page, owner!.email);
    const { day } = owner!.seed;
    const api = await page.request.get(`/api/reports/kpis?period=day&date=${day}`);
    expect(api.status()).toBe(200);
    const current = (
      (await api.json()) as {
        current: { covers: number; tables: number; foodCostPct: number | null };
      }
    ).current;
    expect(current.covers).toBe(5);
    expect(current.tables).toBe(2);

    await page.goto(`/report?vista=andamento&periodo=giorno&data=${day}`);
    await expect(main(page).getByRole("heading", { name: "Report", exact: true })).toBeVisible();
    const covers = main(page).locator('[data-kpi="covers"]');
    await expect(covers).toContainText(String(current.covers));
    const foodCost = main(page).locator('[data-kpi="foodCost"]');
    if (current.foodCostPct === null) await expect(foodCost).toContainText("—");
    else await expect(foodCost).toContainText(current.foodCostPct.toFixed(2).replace(".", ","));
    await expect(main(page).getByRole("table", { name: "Coperti per ora" })).toBeVisible();
    await expect(
      main(page).getByRole("table", { name: "Coperti per giorno della settimana" }),
    ).toBeVisible();
    await expectPhoneFriendlyBothThemes(page);
  });

  test("Piatti: the seeded items by data-menu-item-id, the drink without a recipe", async ({
    page,
  }) => {
    await signInWithMagicLink(page, owner!.email);
    const { day, menu } = owner!.seed;
    await page.goto(`/report?vista=piatti&periodo=giorno&data=${day}`);
    for (const id of [menu.stew, menu.tagliatelle, menu.vino, menu.acqua]) {
      await expect(main(page).locator(`[data-menu-item-id="${id}"]`)).toBeVisible();
    }
    await expect(main(page).locator(`[data-menu-item-id="${menu.vino}"]`)).toContainText(
      "Senza ricetta",
    );
    await expectPhoneFriendlyBothThemes(page);
  });

  test("Non mappati: the drink is listed for the week", async ({ page }) => {
    await signInWithMagicLink(page, owner!.email);
    const { day, menu } = owner!.seed;
    await page.goto(`/report?vista=non-mappati&data=${day}`);
    await expect(main(page).locator(`[data-menu-item-id="${menu.vino}"]`)).toContainText(
      /40,25\s+€/,
    );
    await expect(
      main(page)
        .locator(`[data-menu-item-id="${menu.vino}"]`)
        .getByRole("link", { name: "Collega una ricetta" }),
    ).toHaveAttribute("href", "/menu");
    await expectPhoneFriendlyBothThemes(page);
  });

  test("Scostamenti: the seeded variance row (0,5 kg short = 5,00 €)", async ({ page }) => {
    await signInWithMagicLink(page, owner!.email);
    const { shortIngredientId } = owner!.seed;
    await page.goto("/report?vista=scostamenti");
    const row = main(page).locator(`[data-ingredient-id="${shortIngredientId}"]`);
    await expect(row).toBeVisible();
    await expect(row).toContainText(/differenza \+0,5\s+kg/);
    await expect(row).toContainText(/5,00\s+€/);
    await expect(main(page).getByTestId("avt-totals")).toContainText(/Perdita 5,00\s+€/);
    await expectPhoneFriendlyBothThemes(page);
  });
});

test.describe("who may read the reports", () => {
  test("the admin sees the Piatti view without the Costi fissi column", async ({ page }) => {
    await signInWithMagicLink(page, await createStaff(owner!.tenantId, "admin"));
    const { day, menu } = owner!.seed;
    await page.goto(`/report?vista=piatti&periodo=giorno&data=${day}`);
    await expect(main(page).locator(`[data-menu-item-id="${menu.vino}"]`)).toBeVisible();
    await expect(main(page)).not.toContainText(/Costi fissi|Margine lordo|Contributo/);
    const api = await page.request.get(`/api/reports/items?period=day&date=${day}`);
    expect(api.status()).toBe(200);
    expect(await api.text()).not.toMatch(/fixedCost|grossMargin|contribution/);
    const opens = await page.request.post("/api/dashboard/opens", { data: {} });
    expect(opens.status()).toBe(403);
  });

  for (const role of ["chef", "waiter"] as const) {
    test(`the ${role} gets the reserved message on /report and a 403 from the API`, async ({
      page,
    }) => {
      await signInWithMagicLink(
        page,
        await createStaff(owner!.tenantId, role),
        role === "waiter" ? "/tavoli" : "/",
      );
      await page.goto("/report");
      await expect(main(page).getByRole("alert")).toContainText(
        "I report sono riservati al titolare e all'amministratore.",
      );
      const api = await page.request.get("/api/reports/kpis");
      expect(api.status()).toBe(403);
    });
  }
});
