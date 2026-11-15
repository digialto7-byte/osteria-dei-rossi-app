import { expect, test } from "@playwright/test";
import { computedContrast } from "./helpers/design";
import { createOwner, requireSupabaseStack, signInWithMagicLink } from "./helpers/session";

requireSupabaseStack();

// P2d-1 (ADR-045): Home wears Costì, and so do Spingere, Altro and Avvisi. One page per root (/, /spingere, /altro, /avvisi), light and dark,
// read from the computed styles: the body is Off-white / Charcoal, the band is the venue Forest, the h1 is Montserrat, and the primary
// (Home's "Carica una fattura") is readable. Every computed read is polled, and only after the heading is visible. Fake data only; the pages are
// read empty.

const BODY = { light: "rgb(247, 248, 246)", dark: "rgb(31, 41, 51)" };
const PAGES = [
  { path: "/", title: /^Ciao, / },
  { path: "/spingere", title: "Da spingere" },
  { path: "/altro", title: "Altro" },
  { path: "/avvisi", title: "Avvisi" },
] as const;

test.describe("Home wears the Costì look", () => {
  test.setTimeout(120_000);

  test("body, band, heading face and primary, in light and dark, on each root", async ({
    page,
  }) => {
    await signInWithMagicLink(page, createOwner());
    const firstFamily = (stack: string) => stack.split(",")[0]!.trim();

    for (const { path, title } of PAGES) {
      await page.goto(path);
      const heading = page.locator("main").getByRole("heading", { level: 1, name: title });
      await expect(heading, path).toBeVisible();
      for (const scheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await expect(page.locator("body"), `${path} ${scheme}`).toHaveCSS(
          "background-color",
          BODY[scheme],
        );
        await expect(page.locator("header.band"), `${path} ${scheme}`).toHaveCSS(
          "background-color",
          "rgb(28, 65, 48)",
        );
        // Polled: a one-shot read of an h1 replaced while the page renders returns an empty computed style (main CI, 455df83).
        await expect
          .poll(
            async () =>
              firstFamily(await heading.evaluate((el) => getComputedStyle(el).fontFamily)),
            { message: `${path} ${scheme}` },
          )
          .toMatch(/Montserrat/i);
      }
      await page.emulateMedia({ colorScheme: "light" });
    }

    // The primary on Home: label on fill is at least 4.5:1 in both schemes, read once the colours have settled.
    await page.goto("/");
    const primary = page.getByRole("link", { name: "Carica una fattura", exact: true });
    await expect(primary).toBeVisible();
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expect
        .poll(
          async () =>
            computedContrast(
              await primary.evaluate((el) => getComputedStyle(el).color),
              await primary.evaluate((el) => getComputedStyle(el).backgroundColor),
            ),
          { message: `primary ${scheme}` },
        )
        .toBeGreaterThanOrEqual(4.5);
    }
  });
});
