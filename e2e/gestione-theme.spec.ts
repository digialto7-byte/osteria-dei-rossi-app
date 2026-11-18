import { expect, test, type Locator, type Page } from "@playwright/test";
import { computedContrast } from "./helpers/design";
import { createOwner, requireSupabaseStack, signInWithMagicLink } from "./helpers/session";

requireSupabaseStack();

// P2h (ADR-045): Gestione, Anagrafica and Registro wear Costì. One page per root of step 7, light and dark, read from the computed styles: the body
// is Off-white / Charcoal, the band is the venue Forest, the h1 is Montserrat, and the primary is readable where the page really has one. Every
// computed read is polled, and only after the heading is visible. Fake data only; the pages are read empty, as the owner (createOwner).
//   /ricette                         primary: the link "Nuova ricetta".
//   /costi                           no primary: a read-only list.
//   /anagrafiche (-> /fornitori)     no primary checked: its add form is open on an empty list and collapsed behind a secondary on a full one, so
//   /personale, /dispositivi         the page's primary depends on data this spec does not seed; read empty, nothing is asserted about it.
//   /registro                        no primary: its only button is secondary.
//   /impostazioni/dati-di-prova      no primary: /impostazioni has no page of its own, so its one page is the "Dati di prova" screen.
//   /menu                            primary: "Nuovo piatto".
//   /doppia-verifica, /sicurezza     no primary: factor buttons are secondary; the safety page is read-only.
//   /password                        primary: "Salva password" (enabled once the form has hydrated).
// Left out: none of the eleven roots. This spec was written without a Supabase stack (it only passes `playwright test --list`); the first CI run
// is its first real read, so a locator or heading that needs adjusting shows up there.

const BODY = { light: "rgb(247, 248, 246)", dark: "rgb(31, 41, 51)" };
const PAGES: readonly { path: string; title: string; primary: ((page: Page) => Locator) | null }[] =
  [
    {
      path: "/ricette",
      title: "Ricette",
      primary: (page: Page) =>
        page.locator("main").getByRole("link", { name: "Nuova ricetta", exact: true }),
    },
    { path: "/costi", title: "Costi dei piatti", primary: null },
    { path: "/anagrafiche", title: "Fornitori", primary: null },
    { path: "/personale", title: "Personale", primary: null },
    { path: "/registro", title: "Registro attività", primary: null },
    { path: "/impostazioni/dati-di-prova", title: "Dati di prova", primary: null },
    {
      path: "/menu",
      title: "Menu",
      primary: (page: Page) =>
        page.locator("main").getByRole("button", { name: "Nuovo piatto", exact: true }),
    },
    { path: "/dispositivi", title: "Dispositivi", primary: null },
    { path: "/doppia-verifica", title: "Verifica in due passaggi", primary: null },
    {
      path: "/password",
      title: "Password",
      primary: (page: Page) =>
        page.locator("main").getByRole("button", { name: "Salva password", exact: true }),
    },
    { path: "/sicurezza", title: "Sicurezza", primary: null },
  ];

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

test.describe("Gestione, Anagrafica and Registro wear the Costì look", () => {
  test.setTimeout(240_000);

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
      if (primary === null) continue;
      await page.goto(path);
      const button = primary(page);
      await expect(button, path).toBeVisible();
      await expect(button, path).toBeEnabled();
      await expectPrimaryReadable(button, page.locator("body"), path);
    }
  });
});
