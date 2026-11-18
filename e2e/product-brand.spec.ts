import { expect, test, type Page } from "@playwright/test";
import { collectCspViolations } from "./helpers/csp";

// Costì product brand (docs/plans/2026-11-13-costi-product-brand.md CB7, §3.2, R1): stack-free, like smoke.spec.ts. The sign-in and device pages
// carry the product look (colours, Forest header band, theme colour, logo) and the venue's pages wear the same Costì look with the venue layer (P2j: one theme). Since the founder's 2026-11-14 decision the
// header band shows the Costì wordmark on these pages, not the venue's name. Colours are the computed values of the tokens in globals.css.
const PRODUCT_PAGES = ["/login", "/login/codice", "/dispositivo"] as const;
const OFF_WHITE = "rgb(247, 248, 246)";
const FOREST = "rgb(14, 77, 58)";
const CHARCOAL = "rgb(31, 41, 51)";
// The venue layer on the band of the venue's own pages (the 404 included): #1C4130.
const VENUE_FOREST = "rgb(28, 65, 48)";

// Retried (toHaveCSS), not a one-shot read of the computed style.
const expectBodyBackground = (page: Page, colour: string) =>
  expect(page.locator("body")).toHaveCSS("background-color", colour);

for (const path of PRODUCT_PAGES) {
  test.describe(`${path} is a product page`, () => {
    test("light: Off-white page, Forest band, one Forest theme-color, the Costì logo, title Costì, no CSP violation", async ({
      page,
    }) => {
      const csp = await collectCspViolations(page.context());
      const logo = page.waitForResponse((r) =>
        r.url().endsWith("/brand/costi/logo-horizontal.svg"),
      );
      await page.goto(path);

      await expect(page).toHaveTitle("Costì");
      await expectBodyBackground(page, OFF_WHITE);
      await expect(page.locator("header.band")).toHaveCSS("background-color", FOREST);
      await expect(page.locator('meta[name="theme-color"]')).toHaveCount(1);
      await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#0E4D3A");

      const image = page.locator('img[alt="Costì"]');
      await expect(image).toBeVisible();
      expect((await logo).status()).toBe(200);

      // Founder decision 2026-11-14: the band is Costì only, a link to /login named "Costì", with no venue name.
      const band = page.locator("header.band");
      await expect(band).not.toContainText("Osteria Dei Rossi");
      await expect(band.getByRole("link", { name: "Costì", exact: true })).toHaveAttribute(
        "href",
        "/login",
      );
      expect(csp.violations).toEqual([]);
    });

    test("dark: Charcoal page, and the logo for dark backgrounds", async ({ page }) => {
      await page.emulateMedia({ colorScheme: "dark" });
      await page.goto(path);
      await expectBodyBackground(page, CHARCOAL);
      await expect(page.locator("header.band")).toHaveCSS("background-color", FOREST);
      const image = page.locator('img[alt="Costì"]');
      await expect(image).toBeVisible();
      expect(await image.evaluate((el) => (el as HTMLImageElement).currentSrc)).toMatch(
        /\/brand\/costi\/logo-horizontal-reversed\.svg$/,
      );
    });
  });
}

test("the logo files and the icons are served by the app, with no policy violation", async ({
  page,
  request,
}) => {
  const csp = await collectCspViolations(page.context());
  await page.goto("/login");
  for (const file of [
    "app-icon.svg",
    "favicon.svg",
    "favicon-32.png",
    "icon-192.png",
    "icon-512.png",
    "icon-maskable-192.png",
    "icon-maskable-512.png",
    "apple-touch-icon.png",
  ]) {
    const response = await request.get(`/brand/costi/${file}`);
    expect(response.status(), file).toBe(200);
  }
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest.name).toBe("Costì");
  expect(manifest.theme_color).toBe("#0E4D3A");
  expect(manifest.background_color).toBe("#F7F8F6");
  expect(manifest.icons).toHaveLength(4);
  expect(csp.violations).toEqual([]);
});

test("the tab carries the favicon and the apple-touch icon", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator('link[rel="icon"][href="/brand/costi/favicon.svg"]')).toHaveCount(1);
  await expect(page.locator('link[rel="icon"][href="/brand/costi/favicon-32.png"]')).toHaveCount(1);
  await expect(
    page.locator('link[rel="apple-touch-icon"][href="/brand/costi/apple-touch-icon.png"]'),
  ).toHaveCount(1);
});

test.describe("the venue's pages wear Costì with the venue layer (ADR-045)", () => {
  test("a missing address (404 under the static policy) is Off-white in light and Charcoal in dark, with the venue band, and Montserrat and Inter are loaded, never Bodoni or Figtree", async ({
    page,
  }) => {
    const csp = await collectCspViolations(page.context());
    const fontRequests: string[] = [];
    page.on("request", (request) => {
      if (/\.woff2(\?|$)/.test(request.url())) fontRequests.push(request.url());
    });
    const response = await page.goto("/brand/costi/missing.png");
    expect(response?.status()).toBe(404);
    await expectBodyBackground(page, OFF_WHITE);
    await expect(page.locator("header.band")).toHaveCSS("background-color", VENUE_FOREST);
    await page.emulateMedia({ colorScheme: "dark" });
    await expectBodyBackground(page, CHARCOAL);
    await expect(page.locator("header.band")).toHaveCSS("background-color", VENUE_FOREST);
    await page.emulateMedia({ colorScheme: "light" });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.waitForLoadState("networkidle");
    const loaded = await page.evaluate(() =>
      [...document.fonts].filter((face) => face.status === "loaded").map((face) => face.family),
    );
    expect(loaded.some((name) => /montserrat/i.test(name))).toBe(true);
    expect(loaded.some((name) => /^"?_*inter/i.test(name))).toBe(true);
    expect(loaded.filter((name) => /bodoni|figtree/i.test(name))).toEqual([]);
    // Fonts the page asked for are all same-origin, served by the app.
    for (const url of fontRequests)
      expect(new URL(url).pathname).toMatch(/^\/_next\/static\/media\//);
    await expect(page.locator('img[alt="Costì"]')).toHaveCount(0);
    // The static policy of a missing file blocks Next's inline scripts by design (ADR-028, security-headers.spec.ts): those script-src
    // lines are expected. The brand adds no violation of any other kind (no font, image, style or manifest line).
    expect(csp.violations.filter((line) => !/script-src/.test(line))).toEqual([]);
  });

  // P2i (step 8): the guest booking page wears the Costì values (Off-white) with the venue's layer; the 404 above is Off-white too (P2j step 4).
  test("an unknown booking address wears Costì's Off-white with the venue's tab title and band", async ({
    page,
  }) => {
    await page.goto("/prenota/osteria-demo-nessuna");
    await expectBodyBackground(page, OFF_WHITE);
    await expect(page).toHaveTitle("Osteria Dei Rossi");
    await expect(page.locator('img[alt="Costì"]')).toHaveCount(0);
    // The guest band keeps the venue's name and is not a link.
    await expect(page.locator("header.band")).toContainText("Osteria Dei Rossi");
    await expect(page.locator("header.band").getByRole("link")).toHaveCount(0);
    await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute(
      "content",
      "#1C4130",
    );
  });
});
