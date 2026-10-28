import { expect, test, type Page } from "@playwright/test";
import {
  admin,
  seedIngredients,
  seedLocation,
  seedInvoice,
  seedSupplier,
  tenantIdOf,
  type SeedLine,
} from "./helpers/seed-invoice";
import {
  createOwner,
  expectPhoneFriendly,
  requireSupabaseStack,
  signInWithMagicLink,
} from "./helpers/session";

requireSupabaseStack();

// M4 acceptance tests 1, 3 and 6 on screen: the review page on a phone (360 x 740) and on a
// laptop (1280 x 800). Invoices are seeded in the state the worker leaves behind; every action
// goes through the real API and database. Fake data only.

const LONG_UNBROKEN = `UOVA_FRESCHE_${"X".repeat(110)}`;
const LINES: SeedLine[] = [
  {
    description: "Farina 00",
    qty: 4,
    unit: "kg",
    unitPrice: 1.2,
    code: "FAR-4",
    mappedTo: "Farina 00",
  },
  { description: "Olio extravergine di oliva", qty: 2, unit: "l", unitPrice: 8.5 },
  { description: LONG_UNBROKEN, qty: 3, unit: "pz", unitPrice: 5.2 },
  { description: "Parmigiano Reggiano 24 mesi", qty: 3, unit: "kg", unitPrice: 10, amount: 30 },
];

/** A signed-in owner with a supplier, three ingredients and one invoice to review. */
async function setup(page: Page, extra: { linkSupplier?: boolean; withFile?: boolean } = {}) {
  await signInWithMagicLink(page, createOwner());
  const db = admin();
  const tenantId = await tenantIdOf(page);
  const ingredients = await seedIngredients(db, tenantId);
  // Only when it will be linked: a supplier row with the invoice's VAT would make "Crea fornitore"
  // (prefilled with that VAT) fail on the one-supplier-per-VAT rule.
  const supplierId = extra.linkSupplier === false ? undefined : await seedSupplier(db, tenantId);
  const invoiceId = await seedInvoice(
    db,
    tenantId,
    {
      name: "fattura-da-rivedere.pdf",
      lines: LINES,
      supplierId,
      withFile: extra.withFile ?? true,
    },
    ingredients,
  );
  return {
    db,
    tenantId,
    ingredients,
    supplierId,
    invoiceId,
    path: `/fatture/${invoiceId}/revisione`,
  };
}

const rowOf = (page: Page, text: string) =>
  page.getByTestId("review-line").filter({ hasText: text });

test.describe("review screen on a phone (360 px)", () => {
  test("unmapped lines come first; the page stays phone-friendly with editors open, in light and dark (AT1, AT6)", async ({
    page,
  }) => {
    const { path } = await setup(page);
    await page.goto(path);
    const rows = page.getByTestId("review-line");
    await expect(rows).toHaveCount(4);
    // Unmapped stock lines first, by position; the mapped one last.
    await expect(rows.nth(0)).toContainText("Olio extravergine di oliva");
    await expect(rows.nth(0)).toContainText("Da abbinare");
    await expect(rows.nth(1)).toContainText("UOVA_FRESCHE");
    await expect(rows.nth(2)).toContainText("Parmigiano");
    await expect(rows.nth(3)).toContainText("Farina 00");
    await expect(rows.nth(3)).not.toContainText("Da abbinare");
    await expect(page.getByTestId("review-summary")).toContainText("3 righe da abbinare");

    // Closed, then a line editor open, then the split form open: each phone-friendly.
    await expectPhoneFriendly(page);
    await rowOf(page, "Parmigiano")
      .getByRole("button", { name: /^Modifica/ })
      .click();
    await expect(page.getByRole("form", { name: "Modifica" })).toBeVisible();
    await expectPhoneFriendly(page);
    await page.getByRole("button", { name: "Dividi riga" }).click();
    await expect(page.getByRole("form", { name: "Dividi in parti" })).toBeVisible();
    await expectPhoneFriendly(page);

    // The same again in the dark theme (the device setting).
    await page.emulateMedia({ colorScheme: "dark" });
    await expectPhoneFriendly(page);
    await page.getByRole("button", { name: "Annulla" }).first().click();
    await expectPhoneFriendly(page);
  });

  test("'Apri il documento' opens a signed link that serves the PDF (AT6)", async ({ page }) => {
    const { path } = await setup(page);
    await page.goto(path);
    await page.getByRole("button", { name: "Apri il documento" }).click();
    const link = page.getByRole("link", { name: /Apri il documento/ });
    const href = (await link.getAttribute("href"))!;
    expect(href).toMatch(/\/storage\/v1\/object\/sign\/invoices\//);
    const response = await page.request.get(href);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/pdf");
    expect((await response.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  test("mapping a line through the editor removes its badge and lowers the count", async ({
    page,
  }) => {
    const { path } = await setup(page);
    await page.goto(path);
    const summary = page.getByTestId("review-summary");
    await expect(summary).toContainText("3 righe da abbinare");

    const row = rowOf(page, "Olio extravergine di oliva");
    await row.getByRole("button", { name: /^Modifica/ }).click();
    // By role, not by label text: the label wraps the select, so its text includes every option.
    await row
      .getByRole("combobox", { name: "Ingrediente", exact: true })
      .selectOption({ label: "Olio extravergine · l" });
    await row.getByRole("button", { name: "Salva riga" }).click();

    await expect(summary).toContainText("2 righe da abbinare");
    await expect(rowOf(page, "Olio extravergine di oliva")).not.toContainText("Da abbinare");
    await expect(rowOf(page, "Olio extravergine di oliva")).toContainText(
      "Ingrediente: Olio extravergine",
    );
  });

  test("a split that does not add up shows the Italian 422 message (AT3)", async ({ page }) => {
    const { path } = await setup(page);
    await page.goto(path);
    const row = rowOf(page, "Parmigiano");
    await row.getByRole("button", { name: /^Modifica/ }).click();
    await row.getByRole("button", { name: "Dividi riga" }).click();
    const form = page.getByRole("form", { name: "Dividi in parti" });
    await form.getByLabel("Quantità parte 1").fill("1");
    await form.getByLabel("Importo parte 1").fill("10");
    await form.getByLabel("Quantità parte 2").fill("1,5");
    await form.getByLabel("Importo parte 2").fill("20");
    await expect(form.getByTestId("split-remaining")).toContainText("0,5");
    await form.getByRole("button", { name: "Dividi", exact: true }).click();
    await expect(form.getByRole("alert")).toContainText("Le parti devono sommare esattamente");
  });

  test("an exact split nests its parts under the line, and can be undone", async ({ page }) => {
    const { path } = await setup(page);
    await page.goto(path);
    const row = rowOf(page, "Parmigiano").first();
    await row.getByRole("button", { name: /^Modifica/ }).click();
    await row.getByRole("button", { name: "Dividi riga" }).click();
    const form = page.getByRole("form", { name: "Dividi in parti" });
    await form.getByLabel("Quantità parte 1").fill("1");
    await form.getByLabel("Importo parte 1").fill("10");
    await form.getByLabel("Quantità parte 2").fill("2");
    await form.getByLabel("Importo parte 2").fill("20");
    await form.getByRole("button", { name: "Dividi", exact: true }).click();
    await expect(page.getByText("Divisa in 2 parti")).toBeVisible();
    await expect(page.getByText("Parte 2")).toBeVisible();

    await page
      .getByTestId("review-line")
      .filter({ hasText: "Divisa in 2 parti" })
      .getByRole("button", { name: /^Modifica riga/ })
      .first()
      .click();
    await page.getByRole("button", { name: "Annulla divisione" }).click();
    await expect(page.getByText("Divisa in 2 parti")).toHaveCount(0);
  });

  test("non-stock without a cost centre shows the Italian 422 message", async ({ page }) => {
    const { path } = await setup(page);
    await page.goto(path);
    const row = rowOf(page, "Olio extravergine di oliva");
    await row.getByRole("button", { name: /^Modifica/ }).click();
    await row.getByLabel("Non a magazzino").check();
    await row.getByRole("button", { name: "Salva riga" }).click();
    await expect(row.getByRole("alert")).toContainText("richiede un centro di costo");
  });

  test("a cost centre created on the spot books the line as non-stock", async ({ page }) => {
    const { path } = await setup(page);
    await page.goto(path);
    const row = rowOf(page, "Olio extravergine di oliva");
    await row.getByRole("button", { name: /^Modifica/ }).click();
    await row.getByLabel("Non a magazzino").check();
    await row.getByLabel("Nuovo centro di costo").fill("Pulizie");
    await row.getByRole("button", { name: "Salva riga" }).click();
    await expect(rowOf(page, "Olio extravergine di oliva")).toContainText(
      "Non a magazzino: Pulizie",
    );
    await expect(page.getByTestId("review-summary")).toContainText("2 righe da abbinare");
  });

  test("a credit above the quantity shows the Italian 422 message", async ({ page }) => {
    const { path } = await setup(page);
    await page.goto(path);
    const row = rowOf(page, "Farina 00");
    await row.getByRole("button", { name: /^Modifica/ }).click();
    await row.getByLabel("Quantità resa").fill("9");
    await row.getByRole("button", { name: "Salva riga" }).click();
    await expect(row.getByRole("alert")).toContainText("non può superare la quantità");
  });

  test("an invoice with no linked supplier offers 'Crea fornitore' prefilled, and links it", async ({
    page,
  }) => {
    const { path } = await setup(page, { linkSupplier: false });
    await page.goto(path);
    const form = page.getByRole("form", { name: "Crea fornitore" });
    await expect(form.getByLabel("Nome")).toHaveValue("Fornitore Demo Srl");
    await expect(form.getByLabel("Partita IVA")).toHaveValue("IT12345678903");
    await expectPhoneFriendly(page);
    await form.getByRole("button", { name: "Crea fornitore" }).click();
    await expect(page.getByRole("button", { name: "Cambia fornitore" })).toBeVisible();
  });

  test("a duplicate is read-only until 'Non è un doppione'; then it is editable", async ({
    page,
  }) => {
    const { db, tenantId, ingredients, supplierId } = await setup(page);
    const original = await seedInvoice(db, tenantId, {
      name: "originale.pdf",
      supplierId,
      lines: [],
    });
    const dup = await seedInvoice(
      db,
      tenantId,
      {
        name: "doppione.pdf",
        status: "duplicate",
        supplierId,
        duplicateOf: original,
        lines: LINES,
      },
      ingredients,
    );
    // The button names the original the database holds the copy against: its number and date.
    const printed = await db.from("invoice").select("number_raw").eq("id", original).single();
    expect(printed.error).toBeNull();
    const partner = `${(printed.data as { number_raw: string }).number_raw} del 15/10/2026`;
    await page.goto(`/fatture/${dup}/revisione`);
    await expect(page.getByTestId("invoice-status")).toHaveText("Duplicata");
    await expect(page.getByRole("button", { name: /^Modifica/ })).toHaveCount(0);
    const notDuplicate = page.getByRole("button", { name: `Non è un doppione di ${partner}` });
    await expect(notDuplicate).toBeVisible();
    // The request sends the partner the screen named, and the button is off while it is on its way.
    const request = page.waitForRequest((r) => r.url().endsWith("/not-duplicate"));
    await notDuplicate.click();
    expect((await request).postDataJSON()).toEqual({ partnerId: original });
    await expect(page.getByTestId("invoice-status")).toHaveText("Da controllare");
    await expect(page.getByRole("button", { name: /^Non è un doppione/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Modifica riga/ }).first()).toBeVisible();
  });

  test("a failed reading can be retried: the detail page shows 'Riprova lettura'", async ({
    page,
  }) => {
    await signInWithMagicLink(page, createOwner());
    const db = admin();
    const tenantId = await tenantIdOf(page);
    const id = await seedInvoice(db, tenantId, {
      name: "fattura-fallita.pdf",
      status: "extraction_failed",
    });
    await page.goto(`/fatture/${id}`);
    await expect(page.getByTestId("invoice-status")).toHaveText("Lettura non riuscita");
    await page.getByRole("button", { name: "Riprova lettura" }).click();
    await expect(page.getByTestId("invoice-status")).toHaveText("Ricevuta");
    await expectPhoneFriendly(page);
  });

  test("/fatture links to the quality page, which shows the rate and is phone-friendly", async ({
    page,
  }) => {
    await signInWithMagicLink(page, createOwner());
    const db = admin();
    const tenantId = await tenantIdOf(page);
    await seedInvoice(db, tenantId, {
      name: "qualita.pdf",
      lines: [
        { description: "A", qty: 1, unit: "kg", unitPrice: 1, corrected: ["qty"] },
        { description: "B", qty: 1, unit: "kg", unitPrice: 1 },
        { description: "C", qty: 1, unit: "kg", unitPrice: 1 },
        { description: "D", qty: 1, unit: "kg", unitPrice: 1 },
      ],
    });
    await page.goto("/fatture");
    await page.getByRole("link", { name: "Qualità della lettura" }).click();
    await expect(page).toHaveURL(/\/fatture\/qualita$/);
    await expect(page.getByTestId("q-lines")).toHaveText("4");
    await expect(page.getByTestId("q-corrected")).toHaveText("1");
    await expect(page.getByTestId("q-rate")).toHaveText("25%");
    await expectPhoneFriendly(page);
  });
});

test.describe("review screen on a laptop (1280 px)", () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

  test("the document is framed from a signed URL that allows framing (VT1 check)", async ({
    page,
  }) => {
    const { path } = await setup(page);
    await page.goto(path);
    const frame = page.locator('iframe[title="Documento della fattura"]');
    await expect(frame).toBeVisible();
    const src = (await frame.getAttribute("src"))!;
    expect(src).toMatch(/\/storage\/v1\/object\/sign\/invoices\//);
    await expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");

    const response = await page.request.get(src);
    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(headers["content-type"]).toContain("application/pdf");
    // If Storage ever sends these, framing breaks and VT1 (open in a new tab) takes over.
    expect(headers["x-frame-options"]).toBeUndefined();
    expect(headers["content-security-policy"] ?? "").not.toMatch(/frame-ancestors|sandbox/);
  });

  test("the document sits left of the lines and both start in the first viewport (the lines list by its heading)", async ({
    page,
  }) => {
    const { path } = await setup(page);
    await page.goto(path);
    const frame = page.locator('iframe[title="Documento della fattura"]');
    await expect(frame).toBeVisible();
    const first = page.getByTestId("review-line").first();
    const frameBox = (await frame.boundingBox())!;
    const lineBox = (await first.boundingBox())!;
    // The lines section (its heading) starts in the first viewport; the first row is next to it.
    const headingBox = (await page.getByRole("heading", { name: "Righe" }).boundingBox())!;
    expect(headingBox.y).toBeLessThan(800);
    expect(frameBox.x + frameBox.width).toBeLessThanOrEqual(lineBox.x);
    expect(frameBox.y).toBeLessThan(800);
    // Only this page widens.
    expect((await page.locator("main").boundingBox())!.width).toBeGreaterThan(900);
    await page.goto("/fatture");
    await expect(page.getByRole("heading", { name: "Fatture" })).toBeVisible();
    expect((await page.locator("main").boundingBox())!.width).toBeLessThanOrEqual(448);
  });
});

// UX plan B7: an unknown ingredient is created inside the review, and the invoice is approved without leaving the page.
test("a line is mapped to a new ingredient and the invoice approved without leaving the review (B7)", async ({
  page,
}) => {
  await signInWithMagicLink(page, createOwner());
  const db = admin();
  const tenantId = await tenantIdOf(page);
  const supplierId = await seedSupplier(db, tenantId, { paymentTermsDays: 30 });
  await seedLocation(db, tenantId);
  const invoiceId = await seedInvoice(db, tenantId, {
    name: "fattura-nuovo-ingrediente.pdf",
    supplierId,
    invoiceDate: "2026-09-29",
    lines: [{ description: "Farina speciale", qty: 4, unit: "kg", unitPrice: 1.2 }],
  });
  const path = `/fatture/${invoiceId}/revisione`;
  await page.goto(path);

  await rowOf(page, "Farina speciale")
    .getByRole("button", { name: /^Modifica/ })
    .click();
  const editor = page.getByRole("form", { name: "Modifica" });
  await editor.getByRole("button", { name: "Nuovo ingrediente" }).click();
  const group = editor.getByRole("group", { name: "Nuovo ingrediente" });
  await group.getByLabel("Nome").fill("Farina speciale (demo)");
  await group.getByRole("combobox", { name: /^Unità/ }).selectOption("kg");
  await expectPhoneFriendly(page);
  await group.getByRole("button", { name: "Crea ingrediente" }).click();
  // The new ingredient is selected in the line's own list, and we are still on the review.
  await expect(editor.getByRole("combobox", { name: /^Ingrediente/ })).toContainText(
    "Farina speciale (demo) · kg",
  );
  await expect(page).toHaveURL((url) => url.pathname === `/fatture/${invoiceId}/revisione`);
  await editor.getByRole("button", { name: "Salva riga" }).click();
  await expect(rowOf(page, "Farina speciale")).not.toContainText("Da abbinare");

  const panel = page.getByTestId("approval-panel");
  await panel.getByRole("button", { name: "Approva fattura" }).click();
  await panel.getByRole("button", { name: "Conferma approvazione" }).click();
  await expect(panel.getByTestId("decision-badge")).toHaveText("Approvata");
  await expect(page).toHaveURL((url) => url.pathname === `/fatture/${invoiceId}/revisione`);
  // B6: the next steps after an approval.
  await expect(panel.getByRole("link", { name: "Vai al magazzino" })).toHaveAttribute(
    "href",
    "/magazzino",
  );
  await expect(panel.getByRole("link", { name: "Vedi il pagamento" })).toHaveAttribute(
    "href",
    "/pagamenti",
  );
  await expect(panel.getByRole("link", { name: "Prossima fattura" })).toHaveAttribute(
    "href",
    "/fatture",
  );
});
