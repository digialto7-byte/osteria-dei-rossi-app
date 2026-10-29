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

// The app shell (docs/plans/2026-10-28-ux-flows.md, PR A, ADR-020) on a phone (360 x 740) and the laptop
// (1280 x 800). Fake data only. Roles are made with the helpers the other specs use.

test.describe("one main per page (A3)", () => {
  test("the public screens and the signed-in pages each have exactly one main and a wordmark link to Oggi", async ({
    page,
  }) => {
    for (const path of ["/login", "/pin"]) {
      await page.goto(path);
      await expect(page.locator("main")).toHaveCount(1);
      await expect(page.getByRole("link", { name: "Osteria Dei Rossi, Oggi" })).toHaveAttribute(
        "href",
        "/",
      );
    }

    await signInWithMagicLink(page, createOwner());
    for (const path of ["/", "/fatture"]) {
      await page.goto(path);
      await expect(page.locator("main")).toHaveCount(1);
      await expect(page.getByRole("link", { name: "Osteria Dei Rossi, Oggi" })).toHaveAttribute(
        "href",
        "/",
      );
    }
  });

  test("the wordmark leads back to Oggi from any page", async ({ page }) => {
    await signInWithMagicLink(page, createOwner());
    await page.goto("/fatture");
    await page.getByRole("link", { name: "Osteria Dei Rossi, Oggi" }).click();
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
const TABS: Record<"owner" | "admin" | "chef", string[]> = {
  owner: ["Oggi", "Acquisti", "Cucina", "Sala", "Gestione"],
  admin: ["Oggi", "Acquisti", "Cucina", "Sala", "Gestione"],
  chef: ["Oggi", "Cucina", "Gestione"],
};

test.describe("the shell on a phone (360 px)", () => {
  test.setTimeout(120_000);

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
        // The bar is already visible, so the role is known: the row is there unless the group has one section
        // (the admin's Oggi), and the sidebar adds no second "Menu principale" landmark.
        await expect(sectionRow(page)).toHaveCount(role === "admin" && path === "/" ? 0 : 1);
        await expectPhoneFriendly(page);
      }
    });
  }

  test("the last element of main is not covered by the bar after scrolling to the end (A4)", async ({
    page,
  }) => {
    await signInAs(page, "owner");
    // The staff list and the Oggi page are short; a long page is the supplier import template.
    for (const path of ["/", "/fatture", "/magazzino", "/anagrafiche/importa"]) {
      await page.goto(path);
      await expect(main(page).locator(":scope > *").last()).toBeVisible();
      // Oggi and the lists fill in after their /api reads (counts, the first-steps list): measure the page as it ends up,
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
    await bottomBar(page).getByRole("link", { name: "Acquisti" }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/fatture");
    await expect(sectionRow(page).getByRole("link")).toHaveText([
      "Fatture",
      "Pagamenti",
      "Fornitori",
    ]);
    await expect(sectionRow(page).locator('[aria-current="page"]')).toHaveText("Fatture");
    await sectionRow(page).getByRole("link", { name: "Pagamenti" }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/pagamenti");
    await expect(bottomBar(page).locator('[aria-current="page"]')).toHaveText("Acquisti");
  });

  test("the owner's Oggi leads with Carica una fattura and the first steps (A5)", async ({
    page,
  }) => {
    await signInAs(page, "owner");
    await expect(main(page).getByRole("link", { name: "Carica una fattura" })).toHaveAttribute(
      "href",
      "/fatture",
    );
    await expect(main(page).getByTestId("role")).toHaveText("Ruolo: Titolare");
    await expect(main(page).getByRole("heading", { name: "Primi passi" })).toBeVisible();
    await expect(bottomBar(page)).toBeVisible();
    await expectPhoneFriendly(page);
    await main(page).getByRole("link", { name: "Carica una fattura" }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/fatture");
  });

  test("a fresh owner sees Ubicazioni Da fare, adds one location and then sees Fatto (B3)", async ({
    page,
  }) => {
    await signInAs(page, "owner");
    const steps = main(page).getByRole("heading", { name: "Primi passi" }).locator("..");
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

    await bottomBar(page).getByRole("link", { name: "Oggi" }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/");
    await expect(
      main(page)
        .getByRole("heading", { name: "Primi passi" })
        .locator("..")
        .getByRole("link", { name: /^Ubicazioni/ }),
    ).toContainText("Fatto");
  });

  test("the chef's Oggi leads with Nuova produzione and has no first steps (A5)", async ({
    page,
  }) => {
    await signInAs(page, "chef");
    await expect(main(page).getByRole("link", { name: "Nuova produzione" })).toHaveAttribute(
      "href",
      "/produzione/nuova",
    );
    await expect(main(page).getByRole("heading", { name: "Primi passi" })).toHaveCount(0);
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

  test("the waiter has no tab bar and no section row (A4)", async ({ page }) => {
    await signInAs(page, "waiter");
    await page.goto("/tavoli");
    await expect(page.getByRole("heading", { name: "Tavoli", exact: true })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(bottomBar(page)).toHaveCount(0);
    await expect(sectionRow(page)).toHaveCount(0);
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
        "Oggi",
        "Acquisti",
        "Cucina",
        "Sala",
        "Gestione",
      ]);
      await expect(sidebar.getByRole("link")).toHaveText([
        "Oggi",
        "Avvisi",
        "Fatture",
        "Pagamenti",
        "Fornitori",
        "Comande",
        "Produzione",
        "Magazzino",
        "Riordino",
        "Ricette",
        "Tavoli",
        "Menu",
        "Costi",
        "Registro",
        "Personale",
        "Ingredienti",
        "Ubicazioni",
        "Importa",
      ]);
      await expect(bottomBar(page)).toBeHidden();
    }
    await page.goto("/pagamenti");
    await expect(
      page.getByRole("navigation", { name: "Menu principale" }).locator('[aria-current="page"]'),
    ).toHaveText("Pagamenti");
  });

  test("the owner's Oggi shows Carica una fattura once, with one Esci for the page (A5)", async ({
    page,
  }) => {
    await signInAs(page, "owner");
    await expect(main(page).getByRole("link", { name: "Carica una fattura" })).toBeVisible();
    // The Esci of Oggi gives way to the sidebar's: one on screen.
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
      "Oggi",
      "Avvisi",
      "Comande",
      "Produzione",
      "Magazzino",
      "Riordino",
      "Ricette",
      "Margini",
      "Ingredienti",
    ]);
  });
});

// UX plan C7 (P2-7): on a laptop a list page is wider than the phone column, up to max-w-3xl (768 px); a form stays
// one phone column (448 px); a wide page (the owner's Oggi) keeps its own wider column. Widths are compared with a
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
const OWNER_HREFS = [
  "/",
  "/avvisi",
  "/fatture",
  "/pagamenti",
  "/anagrafiche/fornitori",
  "/cucina",
  "/produzione",
  "/magazzino",
  "/riordino",
  "/ricette",
  "/tavoli",
  "/menu",
  "/costi",
  "/registro",
  "/personale",
  "/anagrafiche/ingredienti",
  "/anagrafiche/ubicazioni",
  "/anagrafiche/importa",
];
const SIDEBAR_HREFS: Record<Role, string[]> = {
  owner: OWNER_HREFS,
  // The admin has no Avvisi (the API gives alerts to owner and chef).
  admin: OWNER_HREFS.filter((href) => href !== "/avvisi"),
  chef: [
    "/",
    "/avvisi",
    "/cucina",
    "/produzione",
    "/magazzino",
    "/riordino",
    "/ricette",
    "/margini",
    "/anagrafiche/ingredienti",
  ],
  waiter: ["/tavoli"],
};
// Per tab of the bottom bar (same order as TABS): the pills of its section row; [] when the group has one section.
const ROW_HREFS: Record<"owner" | "chef", string[][]> = {
  owner: [
    ["/", "/avvisi"],
    ["/fatture", "/pagamenti", "/anagrafiche/fornitori"],
    ["/cucina", "/produzione", "/magazzino", "/riordino", "/ricette"],
    ["/tavoli", "/menu"],
    [
      "/costi",
      "/registro",
      "/personale",
      "/anagrafiche/ingredienti",
      "/anagrafiche/ubicazioni",
      "/anagrafiche/importa",
    ],
  ],
  chef: [
    ["/", "/avvisi"],
    ["/cucina", "/produzione", "/magazzino", "/riordino", "/ricette", "/margini"],
    [],
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
      ["/magazzino/conteggi", "/magazzino"],
      ["/magazzino/conteggi/critici", "/magazzino/conteggi"],
      ["/magazzino/sprechi", "/magazzino"],
      ["/magazzino/riconciliazione", "/magazzino"],
      ["/tavoli/impostazioni", "/tavoli"],
      ["/dispositivi", "/personale"],
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
