import { expect, test, type Page } from "@playwright/test";
import { tenantIdOf } from "./helpers/seed-invoice";
import {
  OWNER_LOCAL_EMAIL,
  TENANT_NAME,
  countsOf,
  demoTenantCount,
  runDemoScript,
  seedDemo,
  tenantExists,
} from "./helpers/seed-demo";
import {
  createOwner,
  expectPhoneFriendly,
  requireSupabaseStack,
  signInWithMagicLink,
} from "./helpers/session";

requireSupabaseStack();

// Demo data on screen (docs/plans/2026-10-24-demo-data.md step 14, ADR-018) on a phone (360 x 740) and the laptop layout
// (1280 x 800). The demo is seeded by the script's own `main` with the local stack's keys; the demo owner signs in with a
// magic link from the mail catcher (the callback accepts only PKCE codes, so a link made with the admin API cannot start a
// browser session); the owner deletes the demo data from the page. A real tenant's owner sees no banner, and the real tenant
// keeps every row. Fake data only.

const BANNER = "Dati di prova — non sono dati reali.";
const PAGE = "/impostazioni/dati-di-prova";
const BUTTON = /^Elimina dati di prova$/;
const NAME_FIELD = /^Scrivi il nome del locale/;

const main = (page: Page) => page.locator("main");
const banner = (page: Page) => page.getByText(BANNER);

async function expectPhoneFriendlyBothThemes(page: Page) {
  await expectPhoneFriendly(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await expectPhoneFriendly(page);
  await page.emulateMedia({ colorScheme: "light" });
}

test.describe.configure({ mode: "serial" });

test.describe("demo data on a phone (360 px)", () => {
  test.setTimeout(300_000);
  let demoId = "";
  let realId = "";
  let realBefore: Record<string, number> = {};

  test.beforeAll(async () => {
    demoId = await seedDemo();
  });
  test.afterAll(async () => {
    // Whatever happened, no demo tenant stays behind for the other specs.
    await runDemoScript(["--purge"]);
  });

  test("an owner of a real tenant sees no banner and no demo data", async ({ page }) => {
    await signInWithMagicLink(page, createOwner());
    realId = await tenantIdOf(page);
    realBefore = await countsOf(realId);
    for (const path of ["/", "/fatture"]) {
      await page.goto(path);
      await expect(banner(page)).toHaveCount(0);
    }
    await page.goto(PAGE);
    await expect(page.getByText("Questo locale non contiene dati di prova.")).toBeVisible();
    await expect(page.getByRole("button", { name: BUTTON })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: NAME_FIELD })).toHaveCount(0);
    await expectPhoneFriendlyBothThemes(page);
  });

  test("the demo owner sees the banner, the fake week, and deletes it from the page", async ({
    page,
  }) => {
    await signInWithMagicLink(page, OWNER_LOCAL_EMAIL);

    // The banner on three owner screens, with the link to the page.
    for (const path of ["/", "/fatture", "/magazzino"]) {
      await page.goto(path);
      await expect(banner(page)).toBeVisible();
      await expect(page.getByRole("link", { name: "Elimina dati di prova" })).toHaveAttribute(
        "href",
        PAGE,
      );
    }

    // The fake week is on the screens.
    await page.goto("/avvisi");
    await expect(page.getByText("Da preparare oggi: Ragù di manzo (demo)")).toBeVisible();
    await page.goto("/pagamenti");
    await expect(main(page).getByText(/Scaduta da \d+ giorn/)).toHaveCount(1);

    // The page: a wrong name keeps the button disabled; the exact name unlocks it.
    await page.getByRole("link", { name: "Elimina dati di prova" }).click();
    await expect(page).toHaveURL(new RegExp(`${PAGE}$`));
    await expect(main(page).getByRole("heading", { name: "Dati di prova" })).toBeVisible();
    await expectPhoneFriendlyBothThemes(page);
    const field = page.getByRole("textbox", { name: NAME_FIELD });
    const button = page.getByRole("button", { name: BUTTON });
    await expect(button).toBeDisabled();
    await field.fill("osteria demo");
    await expect(button).toBeDisabled();
    await field.fill(`${TENANT_NAME} `);
    await expect(button).toBeDisabled();
    await field.fill(TENANT_NAME);
    await expect(button).toBeEnabled();
    expect(await tenantExists(demoId)).toBe(true);

    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/demo/purge")),
      button.click(),
    ]);
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ purged: true });
    await expect(page.getByText("Dati di prova eliminati.")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);

    // The tenant is gone; the real one is untouched.
    expect(await tenantExists(demoId)).toBe(false);
    expect(await demoTenantCount()).toBe(0);
    expect(await tenantExists(realId)).toBe(true);
    expect(await countsOf(realId)).toEqual(realBefore);

    // DigiAlto's clean-up removes the logins and the fake PDFs; a second run has nothing left to do.
    expect((await runDemoScript(["--cleanup"])).code).toBe(0);
    expect((await runDemoScript(["--cleanup"])).code).toBe(0);
  });

  test("a purge the owner types wrongly is refused by the server too", async ({ page }) => {
    // A demo tenant for this test alone (the previous one is gone).
    await seedDemo();
    await signInWithMagicLink(page, OWNER_LOCAL_EMAIL);
    const result = await page.request.post("/api/demo/purge", {
      data: { confirmName: "osteria demo" },
    });
    expect(result.status()).toBe(422);
    expect(((await result.json()) as { error: { message: string } }).error.message).toBe(
      "Il nome non corrisponde.",
    );
    expect(await demoTenantCount()).toBe(1);
  });
});

test.describe("demo data on a laptop (1280 px)", () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });
  test.setTimeout(300_000);

  test.beforeAll(async () => {
    await seedDemo();
  });
  test.afterAll(async () => {
    await runDemoScript(["--purge"]);
  });

  test("the banner and the page stay within the page column", async ({ page }) => {
    await signInWithMagicLink(page, OWNER_LOCAL_EMAIL);
    await page.goto(PAGE);
    await expect(banner(page)).toBeVisible();
    const field = page.getByRole("textbox", { name: NAME_FIELD });
    await expect(field).toBeVisible();

    const column = await main(page).boundingBox();
    expect(column).toBeTruthy();
    for (const target of [banner(page), field, page.getByRole("button", { name: BUTTON })]) {
      const box = await target.boundingBox();
      expect(box).toBeTruthy();
      expect(box!.x).toBeGreaterThanOrEqual(column!.x);
      expect(box!.x + box!.width).toBeLessThanOrEqual(column!.x + column!.width + 1);
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
