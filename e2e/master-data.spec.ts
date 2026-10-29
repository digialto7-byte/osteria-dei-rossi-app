import { expect, test } from "@playwright/test";
import {
  createOwner,
  expectPhoneFriendly,
  requireSupabaseStack,
  signInWithMagicLink,
} from "./helpers/session";

requireSupabaseStack();

test("owner manages locations and ingredients (Italian, phone-first)", async ({ page }) => {
  await signInWithMagicLink(page, createOwner());

  await page.goto("/anagrafiche/ubicazioni");
  const locationForm = page.getByRole("form", { name: "Nuova ubicazione" });
  await locationForm.getByLabel("Nome").fill("Cella");
  await locationForm.getByRole("button", { name: "Aggiungi" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Cella" })).toBeVisible();

  // C1: the list has a row now and the save closed the form; "Aggiungi ubicazione" opens it with the focus on Nome.
  await expect(locationForm).toHaveCount(0);
  await page.getByRole("button", { name: "Aggiungi ubicazione" }).click();
  await expect(locationForm.getByLabel("Nome")).toBeFocused();
  await locationForm.getByLabel("Nome").fill(" cella ");
  await locationForm.getByRole("button", { name: "Aggiungi" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Esiste già" })).toBeVisible();

  await page
    .getByRole("listitem")
    .filter({ hasText: "Cella" })
    .getByRole("button", { name: "Disattiva" })
    .click();
  // C2: the first tap only asks; "Conferma" sends the change.
  await expect(page.getByText("Disattivare Cella?")).toBeVisible();
  await page.getByRole("button", { name: "Conferma" }).click();
  await expect(page.getByText("Nessun elemento.")).toBeVisible();
  await expectPhoneFriendly(page);

  await page.goto("/anagrafiche/ingredienti");
  const ingredientForm = page.getByRole("form", { name: "Nuovo ingrediente" });
  await ingredientForm.getByLabel("Nome").fill("Farina 00");
  await ingredientForm.getByLabel("Unità di base").selectOption("kg");
  await ingredientForm.getByRole("button", { name: "Aggiungi" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Farina 00 · kg" })).toBeVisible();
  await expectPhoneFriendly(page);
});

test("owner adds suppliers with VAT checks and a supplier item with its pack (acceptance tests 2, 3)", async ({
  page,
}) => {
  await signInWithMagicLink(page, createOwner());

  await page.goto("/anagrafiche/ingredienti");
  const ingredientForm = page.getByRole("form", { name: "Nuovo ingrediente" });
  await ingredientForm.getByLabel("Nome").fill("Farina 00");
  await ingredientForm.getByRole("button", { name: "Aggiungi" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Farina 00" })).toBeVisible();

  await page.goto("/anagrafiche/fornitori");
  const supplierForm = page.getByRole("form", { name: "Nuovo fornitore" });
  await supplierForm.getByLabel("Nome").fill("Fornitore Demo Srl");
  await supplierForm.getByLabel("Partita IVA").fill("IT12345678901");
  await supplierForm.getByRole("button", { name: "Aggiungi" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Partita IVA non valida" })).toBeVisible();

  await supplierForm.getByLabel("Partita IVA").fill("IT12345678903");
  await supplierForm.getByRole("button", { name: "Aggiungi" }).click();
  await expect(page.getByRole("link", { name: /Fornitore Demo Srl/ })).toBeVisible();

  // The same VAT number again: the real database constraint must come back as an Italian 409. The save closed the form
  // (C1), so it is opened again from its button.
  await page.getByRole("button", { name: "Aggiungi fornitore" }).click();
  await supplierForm.getByLabel("Nome").fill("Doppione");
  await supplierForm.getByLabel("Partita IVA").fill("IT12345678903");
  await supplierForm.getByRole("button", { name: "Aggiungi" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Esiste già un fornitore con questa partita IVA" }),
  ).toBeVisible();
  await expectPhoneFriendly(page);

  await page.getByRole("link", { name: /Fornitore Demo Srl/ }).click();
  const itemForm = page.getByRole("form", { name: "Nuovo articolo" });
  // B11: the pack numbers are text fields with the decimal keypad, so the Italian comma works.
  for (const label of ["Pezzi per confezione", "Quantità per pezzo"]) {
    await expect(itemForm.getByLabel(label)).toHaveAttribute("inputmode", "decimal");
    await expect(itemForm.getByLabel(label)).toHaveAttribute("type", "text");
  }
  await itemForm.getByLabel("Ingrediente").selectOption({ label: "Farina 00 (kg)" });
  await itemForm.getByLabel("Codice articolo").fill("FAR-6");
  await itemForm.getByLabel("Confezione (es. cassa)").fill("cassa");
  await itemForm.getByLabel("Pezzi per confezione").fill("0");
  await itemForm.getByLabel("Quantità per pezzo").fill("1");
  await itemForm.getByRole("button", { name: "Aggiungi" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "maggiori di zero" })).toBeVisible();

  await itemForm.getByLabel("Pezzi per confezione").fill("6");
  await expect(page.getByTestId("pack-preview")).toHaveText(/1 cassa = 6 × 1\skg = 6\skg/);
  await itemForm.getByRole("button", { name: "Aggiungi" }).click();
  await expect(page.getByTestId("pack")).toHaveText(/1 cassa = 6 × 1\skg = 6\skg/);
  await expectPhoneFriendly(page);
});

// UX plan B4 (P1-2): an empty screen says what is missing and offers one next step. A fresh tenant is empty everywhere.
test("a fresh tenant's empty screens each offer one next step after the empty text", async ({
  page,
}) => {
  await signInWithMagicLink(page, createOwner());
  const cases: { path: string; text: RegExp; link: string; href: string }[] = [
    {
      path: "/anagrafiche/fornitori",
      text: /^Nessun elemento\./,
      link: "Importa da file",
      href: "/anagrafiche/importa",
    },
    {
      path: "/anagrafiche/ingredienti",
      text: /^Nessun elemento\./,
      link: "Importa da file",
      href: "/anagrafiche/importa",
    },
    {
      path: "/magazzino",
      text: /^Nessuna merce in magazzino/,
      link: "Vai alle fatture",
      href: "/fatture",
    },
    {
      path: "/costi",
      text: /^Nessun piatto attivo/,
      link: "Crea una ricetta",
      href: "/ricette/nuova",
    },
    {
      path: "/ricette",
      text: /^Nessuna ricetta\./,
      link: "Importa da file",
      href: "/anagrafiche/importa",
    },
    {
      path: "/tavoli",
      text: /^Non ci sono ancora tavoli/,
      link: "Aggiungi i tavoli",
      href: "/tavoli/impostazioni",
    },
    {
      path: "/dispositivi",
      text: /^Nessun dispositivo abilitato/,
      link: "Aggiungi il personale",
      href: "/personale",
    },
  ];
  for (const { path, text, link, href } of cases) {
    await page.goto(path);
    const empty = page.locator("main p").filter({ hasText: text });
    await expect(empty, path).toBeVisible();
    const block = empty.locator("..");
    // Exactly one link in the block, after the text.
    await expect(block.getByRole("link"), path).toHaveCount(1);
    await expect(block.getByRole("link"), path).toHaveText(link);
    await expect(block.getByRole("link"), path).toHaveAttribute("href", href);
    await expectPhoneFriendly(page);
  }
});

// UX plan C1 (P2-1): the list comes first. With three rows the first one is in the first viewport at 360 px, and the
// add form waits behind its button.
test("with three suppliers the first row is in the first viewport and the add form is closed", async ({
  page,
}) => {
  await signInWithMagicLink(page, createOwner());
  for (const name of ["Fornitore Uno", "Fornitore Due", "Fornitore Tre"]) {
    const created = await page.request.post("/api/suppliers", { data: { name } });
    expect(created.ok()).toBe(true);
  }
  await page.goto("/anagrafiche/fornitori");
  const main = page.locator("main");
  const first = main.getByRole("link", { name: /Fornitore Uno/ });
  await expect(first).toBeVisible();
  await expect(main.getByRole("link", { name: /^Fornitore/ })).toHaveCount(3);
  await expect(main.getByRole("form", { name: "Nuovo fornitore" })).toHaveCount(0);
  await expect(main.getByRole("button", { name: "Aggiungi fornitore" })).toBeVisible();
  await expect(first).toBeInViewport();
  await expectPhoneFriendly(page);

  await main.getByRole("button", { name: "Aggiungi fornitore" }).click();
  await expect(
    main.getByRole("form", { name: "Nuovo fornitore" }).getByLabel("Nome"),
  ).toBeFocused();
});
