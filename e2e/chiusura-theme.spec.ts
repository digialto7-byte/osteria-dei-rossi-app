import { expect, test, type Locator, type Page } from "@playwright/test";
import { computedContrast } from "./helpers/design";
import { createOwner, requireSupabaseStack, signInWithMagicLink } from "./helpers/session";

requireSupabaseStack();

// P2g-1 (ADR-045): Chiusura, Prenotazioni and Report wear Costì. One page per root (/chiusura, /prenotazioni, /report), light and dark, read from the
// computed styles: the body is Off-white / Charcoal, the band is the venue Forest, the h1 is Montserrat, and the primary is readable where the page
// really has one. Every computed read is polled, and only after the heading is visible. Fake data only; the pages are read empty.
//   /chiusura      the register total's submit "Salva" (an enabled Button once the day is loaded).
//   /prenotazioni  "Nuova prenotazione" (primary; enabled once the day is loaded).
//   /report        the selected period, "Periodo" group: the pressed button is the primary one; the other period buttons are secondary.

const BODY = { light: "rgb(247, 248, 246)", dark: "rgb(31, 41, 51)" };
const PAGES = [
  {
    path: "/chiusura",
    title: "Chiusura di cassa",
    primary: (page: Page) =>
      page.locator("main").getByRole("button", { name: "Salva", exact: true }),
  },
  {
    path: "/prenotazioni",
    title: "Prenotazioni",
    primary: (page: Page) =>
      page.locator("main").getByRole("button", { name: "Nuova prenotazione", exact: true }),
  },
  {
    path: "/report",
    title: "Report",
    primary: (page: Page) =>
      page
        .locator("main")
        .getByRole("group", { name: "Periodo", exact: true })
        .getByRole("button", { pressed: true })
        .first(),
  },
] as const;

const SCHEMES = ["light", "dark"] as const;
const firstFamily = (stack: string) => stack.split(",")[0]!.trim();

async function expectPrimaryReadable(primary: Locator, body: Locator, path: string) {
  for (const scheme of SCHEMES) {
    await primary.page().emulateMedia({ colorScheme: scheme });
    // Settle first: the scheme switch transitions colour, so a mid-transition read could pass the check for the other scheme.
    await expect(body, `primary ${path} ${scheme}`).toHaveCSS("background-color", BODY[scheme]);
    await expect
      .poll(
        async () =>
          computedContrast(
            await primary.evaluate((el) => getComputedStyle(el).color),
            await primary.evaluate((el) => getComputedStyle(el).backgroundColor),
          ),
        { message: `primary ${path} ${scheme}` },
      )
      .toBeGreaterThanOrEqual(4.5);
  }
}

test.describe("Chiusura, Prenotazioni and Report wear the Costì look", () => {
  test.setTimeout(120_000);

  test("body, band, heading face and primary, in light and dark, on each root", async ({
    page,
  }) => {
    await signInWithMagicLink(page, createOwner());

    for (const { path, title } of PAGES) {
      await page.goto(path);
      const heading = page.locator("main").getByRole("heading", { level: 1, name: title });
      await expect(heading, path).toBeVisible();
      for (const scheme of SCHEMES) {
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

    for (const { path, primary } of PAGES) {
      await page.goto(path);
      const button = primary(page);
      await expect(button, path).toBeVisible();
      await expect(button, path).toBeEnabled();
      await expectPrimaryReadable(button, page.locator("body"), path);
    }
  });
});
