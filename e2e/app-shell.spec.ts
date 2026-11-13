import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { admin, seedApprovedPayable, tenantIdOf } from "./helpers/seed-invoice";
import {
  createOwner,
  createStaff,
  expectPhoneFriendly,
  requireSupabaseStack,
  signInWithMagicLink,
} from "./helpers/session";

requireSupabaseStack();

// The app shell (docs/plans/2026-10-28-ux-flows.md, PR A, ADR-020; regrouped by M25b, ADR-030) on a phone (360 x 740) and the laptop
// (1280 x 800). Fake data only. Roles are made with the helpers the other specs use.
//
// M25b: this file spells out the navigation in several lists (TABS, PAGES, OWNER_HREFS, SIDEBAR_HREFS, ROW_HREFS, ALTRO_HREFS, the sidebar
// headings and links, the wordmark name). Each was rewritten on purpose for the six groups; the B5 `routes` list below is unchanged on
// purpose (no URL moved).

test.describe("one main per page (A3)", () => {
  test("the public screens and the signed-in pages each have exactly one main and a wordmark link to Home", async ({
    page,
  }) => {
    for (const path of ["/login", "/pin"]) {
      await page.goto(path);
      await expect(page.locator("main")).toHaveCount(1);
      await expect(page.locator("header.band")).toHaveCount(1);
      await expect(page.getByRole("link", { name: "Osteria Dei Rossi, Home" })).toHaveAttribute(
        "href",
        "/",
      );
    }

    await signInWithMagicLink(page, createOwner());
    for (const path of ["/", "/fatture"]) {
      await page.goto(path);
      await expect(page.locator("main")).toHaveCount(1);
      await expect(page.locator("header.band")).toHaveCount(1);
      await expect(page.getByRole("link", { name: "Osteria Dei Rossi, Home" })).toHaveAttribute(
        "href",
        "/",
      );
    }
  });

  test("a signed-in unknown address still shows the band, with the link to Home", async ({
    page,
  }) => {
    await signInWithMagicLink(page, createOwner());
    await page.goto("/non-esiste-questa-pagina");
    await expect(page.locator("header.band")).toHaveCount(1);
    await expect(page.locator("main")).toHaveCount(1);
    await expect(
      page.locator("header.band").getByRole("link", { name: "Osteria Dei Rossi, Home" }),
    ).toHaveAttribute("href", "/");
  });

  test("the wordmark leads back to Home from any page", async ({ page }) => {
    await signInWithMagicLink(page, createOwner());
    await page.goto("/fatture");
    await page.getByRole("link", { name: "Osteria Dei Rossi, Home" }).click();
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
  await signInWithMagicLink(
    page,
    await createStaff(tenantId, role),
    role === "waiter" ? "/tavoli" : "/",
  );
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
// M25b: five tabs for the owner and the admin (the last one, Altro, holds Anagrafica and Registro), three for the chef.
const TABS: Record<"owner" | "admin" | "chef", string[]> = {
  owner: ["Home", "Gestione", "Cucina", "Sala", "Altro"],
  admin: ["Home", "Gestione", "Cucina", "Sala", "Altro"],
  chef: ["Home", "Cucina", "Anagrafica"],
};

test.describe("the shell on a phone (360 px)", () => {
  test.setTimeout(120_000);

  // QW6: "Esci" and the signed-in name sit in the header band on every signed-in screen, one tap from anywhere (also /cucina).
  for (const [role, path] of [
    ["chef", "/cucina"],
    ["waiter", "/tavoli"],
  ] as const) {
    test(`the ${role} on ${path} signs out with one tap on Esci in the header band (QW6)`, async ({
      page,
    }) => {
      await signInAs(page, role);
      await page.goto(path);
      const band = page.getByRole("banner");
      const esci = band.getByRole("button", { name: "Esci", exact: true });
      await expect(esci).toBeVisible();
      // In the first viewport, with no scrolling, inside 360 x 740, and the page does not scroll sideways.
      const box = (await esci.boundingBox())!;
      const viewport = page.viewportSize()!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      await expectPhoneFriendly(page);
      await esci.click();
      await page.waitForURL((url) => url.pathname === "/login");
      expect((await page.request.get("/api/me")).status()).toBe(401);
    });
  }

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
        // The bar is already visible, so the role is known: the row is there unless the group has one section.
        // Since M23 the admin's Home has two (Home, Da spingere), so every page of these roles has the row, and the
        // sidebar adds no second "Menu principale" landmark.
        await expect(sectionRow(page)).toHaveCount(1);
        await expectPhoneFriendly(page);
      }
    });
  }

  test("the last element of main is not covered by the bar after scrolling to the end (A4)", async ({
    page,
  }) => {
    await signInAs(page, "owner");
    // The staff list and the Home page are short; a long page is the supplier import template.
    for (const path of ["/", "/fatture", "/magazzino", "/anagrafiche/importa"]) {
      await page.goto(path);
      await expect(main(page).locator(":scope > *").last()).toBeVisible();
      // Home and the lists fill in after their /api reads (counts, the first-steps list): measure the page as it ends up,
      // or the content grows after the scroll and "the end" moves away.
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      // The premise of the check: the page really is scrolled to its end (a failure here is a scroll problem, not a covered element).
      await expect
        .poll(
          () =>
            page.evaluate(
              () =>
                window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1,
            ),
          { message: path },
        )
        .toBe(true);
      const last = (await main(page).locator(":scope > *").last().boundingBox())!;
      const bar = (await bottomBar(page).boundingBox())!;
      expect(last.y + last.height, path).toBeLessThanOrEqual(bar.y);
    }
  });

  test("focusing a text field hides the bar, leaving it brings it back (A4)", async ({ page }) => {
    await signInAs(page, "owner");
    await page.goto("/anagrafiche/fornitori");
    await expect(bottomBar(page)).toBeVisible();
    // The suppliers form's first field (a text input; it has no name attribute).
    await page.locator("main form input").first().focus();
    await expect(bottomBar(page)).toBeHidden();
    await page.locator("main input").first().blur();
    await expect(bottomBar(page)).toBeVisible();
  });

  test("a tab opens the group's first section and the row shows the group's sections (A4)", async ({
    page,
  }) => {
    await signInAs(page, "owner");
    await page.goto("/");
    await bottomBar(page).getByRole("link", { name: "Gestione", exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/fatture");
    await expect(sectionRow(page).getByRole("link")).toHaveText(["Fatture", "Pagamenti"]);
    await expect(sectionRow(page).locator('[aria-current="page"]')).toHaveText("Fatture");
    await sectionRow(page).getByRole("link", { name: "Pagamenti" }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/pagamenti");
    await expect(bottomBar(page).locator('[aria-current="page"]')).toHaveText("Gestione");
  });

  // QW7: the day close is one tap from Home (it was two, behind Altro).
  test("the owner's Home leads to Chiusura del giorno in one tap (QW7)", async ({ page }) => {
    await signInAs(page, "owner");
    await page.goto("/");
    await main(page)
      .getByRole("link", { name: /^Chiusura del giorno/ })
      .click();
    await expect(page).toHaveURL((url) => url.pathname === "/chiusura");
    await expect(page.getByRole("heading", { name: "Chiusura di cassa" })).toBeVisible();
  });

  test("Altro leads to Chiusura, and the row, the back link and the title keep their order (M25b)", async ({
    page,
  }) => {
    await signInAs(page, "owner");
    await page.goto("/");
    await bottomBar(page).getByRole("link", { name: "Altro", exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/altro");
    await expect(main(page).getByRole("heading", { name: "Registro", exact: true })).toBeVisible();
    await expectPhoneFriendly(page);

    await main(page).getByRole("link", { name: "Chiusura", exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/chiusura");
    await expect(bottomBar(page).locator('[aria-current="page"]')).toHaveText("Altro");
    await expect(sectionRow(page).locator('[aria-current="page"]')).toHaveText("Chiusura");

    // On a sub-page the row's pill and the back link both lead to /costi: the pill is the current one, the back link
    // ("‹ Torna ai costi") is not.
    await page.goto("/costi/impostazioni");
    await expect(main(page).locator("h1")).toBeVisible();
    await expect(
      main(page)
        .locator('a[href="/costi"][aria-current="page"]')
        .filter({ hasText: /^Costi$/ }),
    ).toHaveCount(1);
    await expect(main(page).locator('a[href="/costi"]:not([aria-current])')).toHaveCount(1);
    await expect(main(page).getByRole("link", { name: "Torna ai costi", exact: true })).toHaveCount(
      1,
    );
    // Three positions measured in one evaluate: the row, then the back link, then the title.
    const tops = await page.evaluate(() => {
      const row = document.querySelector("main nav[aria-label='Menu principale']");
      const back = [
        ...document.querySelectorAll<HTMLAnchorElement>(
          'main a[href="/costi"]:not([aria-current])',
        ),
      ].find((a) => !a.closest("nav"));
      const title = document.querySelector("main h1");
      return {
        row: row?.getBoundingClientRect().top ?? null,
        back: back?.getBoundingClientRect().top ?? null,
        title: title?.getBoundingClientRect().top ?? null,
      };
    });
    expect(tops.row).not.toBeNull();
    expect(tops.back).not.toBeNull();
    expect(tops.title).not.toBeNull();
    expect(tops.row!).toBeLessThan(tops.back!);
    expect(tops.back!).toBeLessThan(tops.title!);
  });

  test("Sicurezza opens for the owner as an empty coming-soon page (M25b)", async ({ page }) => {
    await signInAs(page, "owner");
    await page.goto("/sicurezza");
    await expect(main(page).getByRole("heading", { name: "Sicurezza", exact: true })).toBeVisible();
    await expect(main(page)).toContainText("In arrivo");
    await expectPhoneFriendly(page);
  });

  test("the owner's Home leads with Carica una fattura and the first steps (A5)", async ({
    page,
  }) => {
    await signInAs(page, "owner");
    await expect(main(page).getByRole("link", { name: "Carica una fattura" })).toHaveAttribute(
      "href",
      "/fatture",
    );
    await expect(main(page).getByTestId("role")).toHaveText("Ruolo: Titolare");
    await expect(
      main(page).getByRole("heading", { name: "Primi passi", exact: true }),
    ).toBeVisible();
    await expect(bottomBar(page)).toBeVisible();
    await expectPhoneFriendly(page);
    // QW4 (ADR-041): the action sits above the dashboard figures, so it is in the first 740 px with no scrolling.
    const upload = main(page).getByRole("link", { name: "Carica una fattura" });
    const box = (await upload.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    await expect(page.locator("[data-dashboard]")).toBeVisible();
    const precedesDashboard = await upload.evaluate(
      (link) =>
        (link.compareDocumentPosition(document.querySelector("[data-dashboard]")!) &
          Node.DOCUMENT_POSITION_FOLLOWING) !==
        0,
    );
    expect(precedesDashboard).toBe(true);
    await main(page).getByRole("link", { name: "Carica una fattura" }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/fatture");
  });

  test("a fresh owner sees Ubicazioni Da fare, adds one location and then sees Fatto (B3)", async ({
    page,
  }) => {
    await signInAs(page, "owner");
    const steps = main(page)
      .getByRole("heading", { name: "Primi passi", exact: true })
      .locator("..");
    const step = steps.getByRole("link", { name: /^Ubicazioni/ });
    await expect(step).toContainText("Da fare");
    // Nothing to review on a fresh tenant: the primary action says so in a word.
    await expect(main(page)).toContainText("Niente da fare");

    await step.click();
    await expect(page).toHaveURL((url) => url.pathname === "/anagrafiche/ubicazioni");
    const form = page.getByRole("form", { name: "Nuova ubicazione" });
    await form.getByLabel("Nome").fill("Cella");
    await form.getByRole("button", { name: "Aggiungi" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "Cella" })).toBeVisible();

    await bottomBar(page).getByRole("link", { name: "Home", exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/");
    await expect(
      main(page)
        .getByRole("heading", { name: "Primi passi", exact: true })
        .locator("..")
        .getByRole("link", { name: /^Ubicazioni/ }),
    ).toContainText("Fatto");
  });

  test("the chef's Home leads with Nuova produzione and has no first steps (A5)", async ({
    page,
  }) => {
    await signInAs(page, "chef");
    await expect(main(page).getByRole("link", { name: "Nuova produzione" })).toHaveAttribute(
      "href",
      "/produzione/nuova",
    );
    await expect(main(page).getByRole("heading", { name: "Primi passi", exact: true })).toHaveCount(
      0,
    );
    await expect(main(page).getByRole("link", { name: /^(Pagamenti|Costi|Fatture)/ })).toHaveCount(
      0,
    );
  });

  test("the chef reads the ingredients and has no add form and no Aggiungi button (A8)", async ({
    page,
  }) => {
    await signInAs(page, "chef");
    await page.goto("/anagrafiche/ingredienti");
    await expect(page.getByRole("heading", { name: "Ingredienti", exact: true })).toBeVisible();
    // The role arrives with /api/me; wait for the page to settle so the absence below is real.
    await page.waitForLoadState("networkidle");
    await expect(main(page).getByRole("button", { name: "Aggiungi", exact: true })).toHaveCount(0);
    await expect(main(page).getByRole("form")).toHaveCount(0);
    await expect(main(page).getByRole("button", { name: "Disattiva", exact: true })).toHaveCount(0);
  });

  test("the owner still has the add form on the ingredients (A8)", async ({ page }) => {
    await signInAs(page, "owner");
    await page.goto("/anagrafiche/ingredienti");
    await expect(main(page).getByRole("button", { name: "Aggiungi", exact: true })).toBeVisible();
  });

  test("the waiter has no tab bar; the section row has Tavoli and Prenotazioni (A4, reservations A13)", async ({
    page,
  }) => {
    await signInAs(page, "waiter");
    await page.goto("/tavoli");
    await expect(page.getByRole("heading", { name: "Tavoli", exact: true })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(bottomBar(page)).toHaveCount(0);
    // Sala has two sections for the waiter since the reservations, so the row of pills appears.
    await expect(sectionRow(page)).toHaveCount(1);
    await expect(sectionRow(page).getByRole("link")).toHaveText(["Tavoli", "Prenotazioni"]);
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
        "Home",
        "Gestione",
        "Cucina",
        "Sala",
        "Anagrafica",
        "Registro",
      ]);
      await expect(sidebar.getByRole("link")).toHaveText([
        "Home",
        "Avvisi",
        "Da spingere",
        "Fatture",
        "Pagamenti",
        "Comande",
        "Produzione",
        "Magazzino",
        "Riordino",
        "Tavoli",
        "Prenotazioni",
        "Menu",
        "Ubicazioni",
        "Ricette",
        "Fornitori",
        "Ingredienti",
        "Personale",
        "Importa dati",
        "Sicurezza",
        "Verifica in due passaggi",
        "Costi",
        "Chiusura",
        "Report",
        "Attività",
      ]);
      await expect(bottomBar(page)).toBeHidden();
    }
    await page.goto("/pagamenti");
    await expect(
      page.getByRole("navigation", { name: "Menu principale" }).locator('[aria-current="page"]'),
    ).toHaveText("Pagamenti");
  });

  test("the owner's Home shows Carica una fattura once, with one Esci for the page (A5)", async ({
    page,
  }) => {
    await signInAs(page, "owner");
    await expect(main(page).getByRole("link", { name: "Carica una fattura" })).toBeVisible();
    // The band's Esci (phone only) gives way to the sidebar's: one on screen on a laptop.
    await expect(page.getByRole("button", { name: "Esci" })).toHaveCount(1);
    await expect(
      page
        .getByRole("navigation", { name: "Menu principale" })
        .getByRole("button", { name: "Esci" }),
    ).toBeVisible();
  });

  test("the chef's sidebar has only the chef's sections (A4)", async ({ page }) => {
    await signInAs(page, "chef");
    await page.goto("/");
    const sidebar = page.getByRole("navigation", { name: "Menu principale" });
    await expect(sidebar.getByRole("link")).toHaveText([
      "Home",
      "Avvisi",
      "Da spingere",
      "Comande",
      "Produzione",
      "Magazzino",
      "Riordino",
      "Margini",
      "Ricette",
      "Ingredienti",
    ]);
  });
});

// UX plan C7 (P2-7): on a laptop a list page is wider than the phone column, up to max-w-3xl (768 px); a form stays
// one phone column (448 px); a wide page (the owner's Home) keeps its own wider column. Widths are compared with a
// tolerance under 1 px, as layout can land on a fraction.
test.describe("the laptop column (1280 px, C7)", () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });
  test.setTimeout(120_000);

  test("lists use a column up to 768 px, the upload form stays 448 px, a wide page stays wider", async ({
    page,
  }) => {
    await signInAs(page, "owner");
    for (const path of ["/magazzino", "/fatture"]) {
      await page.goto(path);
      await expect(main(page).locator("h1").first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      const column = (await main(page).boundingBox())!;
      expect(column.width, path).toBeGreaterThan(448);
      expect(Math.abs(column.width - 768), path).toBeLessThan(1);
    }

    // The card around the upload form keeps the phone column, and the form is inside it.
    const card = (await main(page).locator("div:has(> form)").first().boundingBox())!;
    const form = (await main(page).locator("form").first().boundingBox())!;
    expect(Math.abs(card.width - 448)).toBeLessThan(1);
    expect(form.width).toBeLessThanOrEqual(card.width);

    await page.goto("/");
    await expect(main(page).getByTestId("dashboard-tiles")).toBeVisible();
    await page.waitForLoadState("networkidle");
    const wide = (await main(page).boundingBox())!;
    expect(wide.width).toBeGreaterThan(768 + 1);
  });
});

// "Every visible link opens" (A9): nothing in a role's navigation leads to a page that refuses the role.
const ROLE_REFUSAL = /per il tuo ruolo|con il tuo ruolo|Solo il titolare/;

async function expectNoRoleRefusal(page: Page, where: string) {
  await expect(main(page).locator("h1").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(
    main(page).getByRole("alert").filter({ hasText: ROLE_REFUSAL }),
    `${where} refuses the role`,
  ).toHaveCount(0);
}

// The links each role's navigation holds, spelled out so a loop never runs over an empty or half-loaded list.
// M25b: the owner's links in the sidebar's order (six groups); M25b added /sicurezza, P2-1 B5 adds /doppia-verifica (23 in all).
const OWNER_HREFS = [
  "/",
  "/avvisi",
  "/spingere",
  "/fatture",
  "/pagamenti",
  "/cucina",
  "/produzione",
  "/magazzino",
  "/riordino",
  "/tavoli",
  "/prenotazioni",
  "/menu",
  "/anagrafiche/ubicazioni",
  "/ricette",
  "/anagrafiche/fornitori",
  "/anagrafiche/ingredienti",
  "/personale",
  "/anagrafiche/importa",
  "/sicurezza",
  "/doppia-verifica",
  "/costi",
  "/chiusura",
  "/report",
  "/registro",
];
// The 12 links of the owner's Altro page (Anagrafica, then Registro), in page order. They start after the 12 of Home, Gestione, Cucina and Sala
// (Sala has Tavoli, Prenotazioni and Menu since the reservations).
const ALTRO_HREFS = OWNER_HREFS.slice(12);
const SIDEBAR_HREFS: Record<Role, string[]> = {
  owner: OWNER_HREFS,
  // The admin has no Avvisi (the API gives alerts to owner and chef).
  admin: OWNER_HREFS.filter((href) => href !== "/avvisi"),
  chef: [
    "/",
    "/avvisi",
    "/spingere",
    "/cucina",
    "/produzione",
    "/magazzino",
    "/riordino",
    "/margini",
    "/ricette",
    "/anagrafiche/ingredienti",
  ],
  waiter: ["/tavoli", "/prenotazioni"],
};
// Per tab of the bottom bar (same order as TABS): the pills of its section row; [] when the group has one section.
// M25b: the owner's last tab (Altro) has no row; its links are the ALTRO_HREFS on the page itself.
const ROW_HREFS: Record<"owner" | "chef", string[][]> = {
  owner: [
    ["/", "/avvisi", "/spingere"],
    ["/fatture", "/pagamenti"],
    ["/cucina", "/produzione", "/magazzino", "/riordino"],
    ["/tavoli", "/prenotazioni", "/menu"],
    [],
  ],
  chef: [
    ["/", "/avvisi", "/spingere"],
    ["/cucina", "/produzione", "/magazzino", "/riordino", "/margini"],
    ["/ricette", "/anagrafiche/ingredienti"],
  ],
};

test.describe("every visible link opens (A9)", () => {
  test.setTimeout(240_000);

  test.describe("on a laptop (1280 px): the whole sidebar", () => {
    test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

    for (const role of ["owner", "admin", "chef", "waiter"] as const) {
      test(`the ${role}'s sidebar links all open without a role error`, async ({ page }) => {
        await signInAs(page, role);
        const sidebar = page.getByRole("navigation", { name: "Menu principale" });
        // Wait for the whole list (it appears once /api/me answers), so the loop below cannot run on nothing.
        await expect(sidebar.getByRole("link")).toHaveCount(SIDEBAR_HREFS[role].length);
        const hrefs = await sidebar
          .getByRole("link")
          .evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""));
        expect(hrefs).toEqual(SIDEBAR_HREFS[role]);
        for (const href of hrefs) {
          await page.goto(href);
          await expectNoRoleRefusal(page, `${role} ${href}`);
        }
      });
    }
  });

  test.describe("on a phone (360 px): every tab, then its section row", () => {
    for (const role of ["owner", "chef"] as const) {
      test(`the ${role}'s tabs and pills all open without a role error`, async ({ page }) => {
        await signInAs(page, role);
        await page.goto("/");
        // Wait for the bar (it appears once /api/me answers) and fix the number of tabs before looping.
        await expect(bottomBar(page).getByRole("link")).toHaveText(TABS[role]);
        const tabCount = TABS[role].length;
        expect(ROW_HREFS[role]).toHaveLength(tabCount);
        for (let index = 0; index < tabCount; index++) {
          await page.goto("/");
          await expect(bottomBar(page).getByRole("link")).toHaveCount(tabCount);
          await bottomBar(page).getByRole("link").nth(index).click();
          await expectNoRoleRefusal(page, `${role} tab ${index}`);
          const expected = ROW_HREFS[role][index]!;
          if (expected.length === 0) {
            await expect(sectionRow(page)).toHaveCount(0);
            if (role === "owner") {
              // The Altro tab: no row, but the page holds the 12 links of Anagrafica and Registro, in order.
              await expect(main(page).locator("section a")).toHaveCount(ALTRO_HREFS.length);
              const links = await main(page)
                .locator("section a")
                .evaluateAll((anchors) => anchors.map((a) => a.getAttribute("href") ?? ""));
              expect(links).toEqual(ALTRO_HREFS);
              for (const href of links) {
                await page.goto(href);
                await expectNoRoleRefusal(page, `${role} ${href}`);
              }
            }
            continue;
          }
          await expect(sectionRow(page).getByRole("link")).toHaveCount(expected.length);
          const pills = await sectionRow(page)
            .getByRole("link")
            .evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""));
          expect(pills).toEqual(expected);
          for (const href of pills) {
            await page.goto(href);
            await expectNoRoleRefusal(page, `${role} ${href}`);
          }
        }
      });
    }
  });
});

// UX plan B5: the way back to the parent is the first link of the page content, before the heading. The section row of
// the shell is a nav landmark, not page content, so it is left out.
// M25b: this `routes` list is unchanged on purpose. No URL moved, and /altro and /sicurezza are top-level pages with no back link.
test.describe("back link first (B5)", () => {
  test.setTimeout(180_000);

  const firstContentLink = (page: Page) =>
    page.evaluate(() => {
      const link = [...document.querySelectorAll<HTMLAnchorElement>("main a")].find(
        (a) => !a.closest("nav"),
      );
      const heading = document.querySelector("main h1");
      return {
        href: link?.getAttribute("href") ?? null,
        text: link?.textContent?.trim() ?? null,
        beforeHeading:
          !!link &&
          !!heading &&
          !!(link.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING),
      };
    });

  test("every detail and sub-page starts with its back link, on a phone", async ({ page }) => {
    await signInAs(page, "owner");
    const tenantId = await tenantIdOf(page);
    const { payableId, supplierId, invoiceId } = await seedApprovedPayable(page, admin(), tenantId);
    const unknown = randomUUID();
    const routes: [string, string][] = [
      [`/pagamenti/${payableId}`, "/pagamenti"],
      [`/fatture/${invoiceId}`, "/fatture"],
      [`/fatture/${invoiceId}/revisione`, `/fatture/${invoiceId}`],
      [`/anagrafiche/fornitori/${supplierId}`, "/anagrafiche/fornitori"],
      [
        `/anagrafiche/fornitori/${supplierId}/estratto-conto`,
        `/anagrafiche/fornitori/${supplierId}`,
      ],
      // Ids that do not exist: the error branch of each detail page has the back link first as well.
      [`/pagamenti/${unknown}`, "/pagamenti"],
      [`/fatture/${unknown}`, "/fatture"],
      [`/magazzino/${unknown}`, "/magazzino"],
      [`/produzione/${unknown}`, "/produzione"],
      [`/ricette/${unknown}`, "/ricette"],
      [`/costi/ricette/${unknown}`, "/costi"],
      ["/produzione/nuova", "/produzione"],
      ["/produzione/personale", "/produzione"],
      ["/riordino/ingredienti", "/riordino"],
      ["/riordino/fornitori", "/riordino"],
      ["/riordino/ricette", "/riordino"],
      ["/costi/impostazioni", "/costi"],
      ["/costi/ingredienti", "/costi"],
      ["/costi/verifica", "/costi"],
      ["/report/mese", "/report"],
      ["/magazzino/conteggi", "/magazzino"],
      ["/magazzino/conteggi/critici", "/magazzino/conteggi"],
      ["/magazzino/sprechi", "/magazzino"],
      ["/magazzino/riconciliazione", "/magazzino"],
      ["/tavoli/impostazioni", "/tavoli"],
      ["/dispositivi", "/personale"],
      // M25a: the password page, reached from the account card on Oggi.
      ["/password", "/"],
    ];
    for (const [path, parent] of routes) {
      await page.goto(path);
      await expect(main(page).locator("h1, [role=alert], p").first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      const first = await firstContentLink(page);
      expect(first.href, path).toBe(parent);
      expect(first.beforeHeading || path.includes(unknown), path).toBe(true);
      expect(first.text, path).toMatch(/\S/);
    }
  });
});
