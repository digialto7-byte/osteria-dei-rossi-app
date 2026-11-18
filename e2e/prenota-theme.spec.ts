import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { computedContrast } from "./helpers/design";
import { closeContexts, newContext } from "./helpers/order-ui";
import { createOwner, requireSupabaseStack, signInWithMagicLink } from "./helpers/session";

requireSupabaseStack();

// P2i (ADR-045): the guest booking page wears Costì with the venue's layer. Read signed out, light and dark, from the computed styles: the body is
// Off-white / Charcoal, the band is the venue Forest, the tab title is the venue's name, a guest sees no Costì name or logo, and on the real page
// the h1 is Montserrat and the primary «Invia richiesta» is readable. The slug is a seeded one: the owner switches the page on through the settings
// API (as reservations-public.spec.ts does) and the guest then opens it in a second context. The unknown-address page is read too; it has no h1
// (it is a plain "not available" text), so the heading and the primary are checked on the real page only. Every computed read is polled. Fake data
// only. Written without a Supabase stack (it only passes `playwright test --list`): the first CI run is its first real read.

const BODY = { light: "rgb(247, 248, 246)", dark: "rgb(31, 41, 51)" };
const VENUE = "Osteria Dei Rossi";
const SCHEMES = ["light", "dark"] as const;
const firstFamily = (stack: string) => stack.split(",")[0]!.trim();

const opened: BrowserContext[] = [];
test.afterEach(({}, testInfo) => closeContexts(opened, testInfo));

async function expectCosti(page: Page, label: string) {
  await expect(page, label).toHaveTitle(VENUE);
  for (const scheme of SCHEMES) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect(page.locator("body"), `${label} ${scheme}`).toHaveCSS(
      "background-color",
      BODY[scheme],
    );
    await expect(page.locator("header.band"), `${label} ${scheme}`).toHaveCSS(
      "background-color",
      "rgb(28, 65, 48)",
    );
  }
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("header.band"), label).toContainText(VENUE);
  await expect(page.locator("header.band").getByRole("link"), label).toHaveCount(0);
  await expect(page.locator('img[alt="Costì"]'), label).toHaveCount(0);
  // innerText, not textContent: Next's flight data can hold the word in a script, and only what a guest can read counts.
  await expect(page.locator("body"), label).not.toContainText(/costì/i, { useInnerText: true });
}

async function expectPrimaryReadable(primary: Locator, body: Locator) {
  for (const scheme of SCHEMES) {
    await primary.page().emulateMedia({ colorScheme: scheme });
    // Settle first: the scheme switch transitions colour, so a mid-transition read could pass the check for the other scheme.
    await expect(body, `primary ${scheme}`).toHaveCSS("background-color", BODY[scheme]);
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
}

test.describe("the guest booking page wears the Costì look", () => {
  test.setTimeout(120_000);

  test("a seeded booking page: body, band, tab title, no Costì, Montserrat h1 and a readable primary", async ({
    page,
    browser,
  }, testInfo) => {
    const slug = `osteria-demo-${randomUUID().slice(0, 8)}`;
    await signInWithMagicLink(page, createOwner());
    const saved = await page.request.patch("/api/settings/reservations", {
      data: {
        publicSlug: slug,
        privacyControllerName: "Osteria Demo S.r.l. (demo)",
        privacyContactEmail: "privacy@example.com",
        services: [
          {
            key: "cena",
            online: true,
            firstSeating: "19:00",
            lastSeating: "21:30",
            coversPerSlot: null,
            reservationsPerSlot: null,
            coversPerService: null,
          },
        ],
      },
    });
    expect(saved.status(), await saved.text()).toBe(200);
    const on = await page.request.patch("/api/settings/reservations", {
      data: { enabled: true },
    });
    expect(on.status(), await on.text()).toBe(200);

    const guest = await newContext(browser, testInfo.project.use);
    opened.push(guest.context);
    await guest.page.goto(`/prenota/${slug}`);
    const heading = guest.page.locator("main").getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible();
    await expectCosti(guest.page, "booking page");
    for (const scheme of SCHEMES) {
      await guest.page.emulateMedia({ colorScheme: scheme });
      // Polled: a one-shot read of an h1 replaced while the page renders returns an empty computed style (main CI, 455df83).
      await expect
        .poll(
          async () => firstFamily(await heading.evaluate((el) => getComputedStyle(el).fontFamily)),
          {
            message: `h1 ${scheme}`,
          },
        )
        .toMatch(/Montserrat/i);
    }
    const primary = guest.page
      .locator("main")
      .getByRole("button", { name: "Invia richiesta", exact: true });
    await expect(primary).toBeVisible();
    await expect(primary).toBeEnabled();
    await expectPrimaryReadable(primary, guest.page.locator("body"));
  });

  test("an unknown booking address: body, band, tab title and no Costì", async ({ page }) => {
    await page.goto("/prenota/osteria-demo-nessuna");
    await expect(
      page.getByText("Questa pagina di prenotazione non è disponibile.", { exact: true }),
    ).toBeVisible();
    await expectCosti(page, "unknown address");
  });

  test("the cancel page, signed out: body, band, tab title and no Costì", async ({ page }) => {
    await page.goto("/prenota/osteria-demo-nessuna/annulla?t=x");
    await expect(
      page.locator("main").getByRole("heading", { level: 1, name: "Annulla la prenotazione" }),
    ).toBeVisible();
    // Not the bare "alert" role: Next's route announcer is one too.
    await expect(
      page.getByRole("alert").filter({ hasText: "Il link non è valido o è scaduto." }),
    ).toBeVisible();
    await expectCosti(page, "cancel page");
  });
});
