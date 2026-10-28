import { expect, test, type Page } from "@playwright/test";
import { tenantIdOf } from "./helpers/seed-invoice";
import {
  OWNER_LOCAL_EMAIL,
  countsOf,
  removeDemo,
  runDemoScript,
  seedDemo,
  tenantState,
} from "./helpers/seed-demo";
import {
  createOwner,
  expectPhoneFriendly,
  requireSupabaseStack,
  signInWithMagicLink,
} from "./helpers/session";

requireSupabaseStack();

// Demo data on screen (docs/plans/2026-10-24-demo-data.md step 14 and §0, ADR-018 revision 1) on a phone (360 x 740) and the
// laptop layout (1280 x 800). The demo data goes into an EXISTING fake tenant (made by createOwner), put there by the script's
// own `main` with the local stack's keys. The tenant's OWN owner (the founder's stand-in) signs in with a magic link from the mail
// catcher and sees the banner, the fake week and the page that resets it. The reset keeps the tenant and the owner: after it the
// same owner signs in again and finds the tenant without banner. Another tenant keeps every row. Fake data only.

const BANNER = "Dati di prova — non sono dati reali.";
const PAGE = "/impostazioni/dati-di-prova";
const BUTTON = /^Elimina dati di prova$/;
const NAME_FIELD = /^Scrivi il nome del locale/;

const mainOf = (page: Page) => page.locator("main");
const banner = (page: Page) => page.getByText(BANNER);

async function expectPhoneFriendlyBothThemes(page: Page) {
  await expectPhoneFriendly(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await expectPhoneFriendly(page);
  await page.emulateMedia({ colorScheme: "light" });
}

/** The tenant's name as the app shows it, from the page's own /api/me. */
async function tenantNameOf(page: Page): Promise<string> {
  const me = await page.request.get("/api/me");
  return ((await me.json()) as { tenant: { name: string } }).tenant.name;
}

test.describe.configure({ mode: "serial" });

test.describe("demo data on a phone (360 px)", () => {
  test.setTimeout(300_000);
  let otherId = "";
  let otherBefore: Record<string, number> = {};
  let targetId = "";

  test.afterAll(async () => {
    // Whatever happened, no demo data and no demo account stays behind for the other specs.
    if (targetId) await removeDemo(targetId);
  });

  test("an owner of a tenant without demo data sees no banner and no demo data", async ({
    page,
  }) => {
    await signInWithMagicLink(page, createOwner());
    otherId = await tenantIdOf(page);
    otherBefore = await countsOf(otherId);
    for (const path of ["/", "/fatture"]) {
      await page.goto(path);
      await expect(page.getByRole("heading").first()).toBeVisible();
      await expect(banner(page)).toHaveCount(0);
    }
    await page.goto(PAGE);
    await expect(page.getByText("Questo locale non contiene dati di prova.")).toBeVisible();
    await expect(page.getByRole("button", { name: BUTTON })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: NAME_FIELD })).toHaveCount(0);
    await expectPhoneFriendlyBothThemes(page);
  });

  test("the tenant's owner sees the banner and the fake week, and resets it from the page", async ({
    page,
  }) => {
    const ownerEmail = createOwner();
    await signInWithMagicLink(page, ownerEmail);
    targetId = await tenantIdOf(page);
    const name = await tenantNameOf(page);
    const ownerRows = (await countsOf(targetId)).app_user;
    expect(ownerRows).toBe(1);

    // The script fills the tenant the owner is signed in to; the owner's own session is not touched.
    await seedDemo(targetId);
    expect((await countsOf(targetId)).app_user).toBe(1 + 6);
    expect(await tenantState(targetId)).toEqual({ exists: true, marked: true });

    // The banner on three screens, with the link to the page.
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
    await expect(mainOf(page).getByText(/Scaduta da \d+ giorn/)).toHaveCount(1);
    await page.goto("/menu");
    await expect(mainOf(page).getByText("Tagliatelle al ragù (demo)").first()).toBeVisible();
    await page.goto("/tavoli/impostazioni");
    await expect(mainOf(page).getByText("Tavolo 1 (demo)").first()).toBeVisible();

    // The page: a wrong name keeps the button disabled; the exact name unlocks it.
    await page.goto("/");
    await page.getByRole("link", { name: "Elimina dati di prova" }).click();
    await expect(page).toHaveURL(new RegExp(`${PAGE}$`));
    await expect(mainOf(page).getByRole("heading", { name: "Dati di prova" })).toBeVisible();
    // The warning says plainly that everything entered since the demo was loaded goes, real or not.
    await expect(mainOf(page).getByText(/tutti i dati operativi/i)).toBeVisible();
    await expectPhoneFriendlyBothThemes(page);
    const field = page.getByRole("textbox", { name: NAME_FIELD });
    const button = page.getByRole("button", { name: BUTTON });
    await expect(button).toBeDisabled();
    await field.fill(name.toLowerCase());
    await expect(button).toBeDisabled();
    await field.fill(`${name} `);
    await expect(button).toBeDisabled();
    await field.fill(name);
    await expect(button).toBeEnabled();
    expect(await tenantState(targetId)).toEqual({ exists: true, marked: true });

    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/demo/purge")),
      button.click(),
    ]);
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ purged: true });
    await expect(page.getByText("Dati di prova eliminati.")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);

    // The tenant and its owner are still there; the demo data and the demo users are gone; the other tenant is untouched.
    expect(await tenantState(targetId)).toEqual({ exists: true, marked: false });
    const after = await countsOf(targetId);
    expect({ users: after.app_user, locations: after.location, invoices: after.invoice }).toEqual({
      users: 1,
      locations: 0,
      invoices: 0,
    });
    expect(await countsOf(otherId)).toEqual(otherBefore);

    // DigiAlto's clean-up removes the demo logins and the fake PDFs; a second run has nothing left to do.
    expect((await runDemoScript(["--cleanup"])).code).toBe(0);
    expect((await runDemoScript(["--cleanup"])).code).toBe(0);

    // The same owner signs in again: the tenant is theirs, without banner, and the page offers no reset.
    await signInWithMagicLink(page, ownerEmail);
    await expect(banner(page)).toHaveCount(0);
    await page.goto(PAGE);
    await expect(page.getByText("Questo locale non contiene dati di prova.")).toBeVisible();
    await expect(page.getByRole("button", { name: BUTTON })).toHaveCount(0);
  });

  test("a wrong name is refused by the server too", async ({ page }) => {
    await signInWithMagicLink(page, createOwner());
    targetId = await tenantIdOf(page);
    await seedDemo(targetId);
    const result = await page.request.post("/api/demo/purge", {
      data: { confirmName: "osteria demo" },
    });
    expect(result.status()).toBe(422);
    expect(((await result.json()) as { error: { message: string } }).error.message).toBe(
      "Il nome non corrisponde.",
    );
    expect(await tenantState(targetId)).toEqual({ exists: true, marked: true });
  });
});

test.describe("demo data on a laptop (1280 px)", () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });
  test.setTimeout(300_000);
  let tenantId = "";

  test.afterAll(async () => {
    if (tenantId) await removeDemo(tenantId);
  });

  test("the banner and the page stay within the page column", async ({ page }) => {
    await signInWithMagicLink(page, createOwner());
    tenantId = await tenantIdOf(page);
    await seedDemo(tenantId);
    await page.goto(PAGE);
    await expect(banner(page)).toBeVisible();
    const field = page.getByRole("textbox", { name: NAME_FIELD });
    await expect(field).toBeVisible();

    const column = await mainOf(page).boundingBox();
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

// The fixed address of the demo owner is on the reserved domain: nothing in this file signs in with it.
test("the demo owner's address can receive no mail", () => {
  expect(OWNER_LOCAL_EMAIL).toMatch(/\.demo@example\.test$/);
});
