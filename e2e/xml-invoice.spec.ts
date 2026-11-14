import { expect, test, type Page } from "@playwright/test";
import { businessDateOf } from "./helpers/business-date";
import {
  createOwner,
  expectPhoneFriendly,
  requireSupabaseStack,
  signInWithMagicLink,
} from "./helpers/session";
import {
  SHOWN_DATE,
  SHOWN_DUE,
  SUPPLIER_NAME,
  listedInvoices,
  p7mFile,
  pickAndUpload,
  seedXmlTenant,
  uploadForm,
  xmlFile,
  xmlFileOfType,
} from "./helpers/xml-invoice";

requireSupabaseStack();

// P2-7 acceptance tests on screen, on a phone (360 x 740): the owner uploads the supplier's e-invoice file, checks what the file said,
// copies the lot the supplier wrote, creates the supplier, approves; a file Costì cannot take is refused with nothing saved; the same
// file twice is refused with a link to the first. Every action goes through the real API, parser and database. Fake data only; the
// invoice dates are in 1998. No invoice date here is read back by a business-date default (the receipts count by the invoice's own date),
// so nothing is seeded with `businessDateOf`; the first test still reads it at the start and the end, because an approval posts ledger
// instants and a run across the business-day cut-off would change what "today" means to the screens.

/** The original comes from the app route, as an opaque attachment: the headers that keep a stored XML file from ever being rendered. */
function expectAttachmentHeaders(headers: Record<string, string>, filename: string) {
  expect(headers["content-disposition"]).toBe(`attachment; filename="${filename}"`);
  expect(headers["content-type"]).toBe("application/octet-stream");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["content-security-policy"]).toBe("sandbox; default-src 'none'");
  expect(headers["cache-control"]).toBe("no-store");
}

const resultOf = (page: Page) => page.getByTestId("upload-result");
const rowOf = (page: Page, text: string) =>
  page.getByTestId("review-line").filter({ hasText: text });
const lotMissing = (row: ReturnType<typeof rowOf>) => row.locator('[data-badge="lot-missing"]');

test("owner uploads an .xml, reads what the file said, copies the lot, creates the supplier and approves (AT-X1, X2, X5, X9, X11)", async ({
  page,
}) => {
  // Sign-in, an upload, a supplier, an approval and many reloads in one test: longer than the default 30 s on a busy runner.
  test.setTimeout(90_000);
  await signInWithMagicLink(page, createOwner());
  const { buyerVat, ingredientIds } = await seedXmlTenant(page);
  const dayBefore = await businessDateOf(page);

  await page.goto("/fatture");
  await expect(page.getByText("Nessuna fattura caricata.")).toBeVisible();
  const form = uploadForm(page);
  const field = form.getByLabel("Carica PDF, foto o file XML");
  await expect(field).toHaveAttribute("accept", /\.xml/);
  await expect(field).toHaveAttribute("accept", /\.p7m/);
  await expect(form.getByText(/fattura elettronica \(\.xml o \.xml\.p7m\)/)).toBeVisible();

  // Picking the file shows its name and the chip (by extension, a hint only); nothing is sent before "Carica".
  const file = xmlFile(buyerVat);
  await field.setInputFiles(file);
  await expect(form.getByText(`File scelto: ${file.name}`)).toBeVisible();
  await expect(form.getByTestId("e-invoice-chip")).toHaveText("Fattura elettronica");
  expect(await listedInvoices(page)).toHaveLength(0);
  await form.getByRole("button", { name: "Carica", exact: true }).click();

  // One request reads the file: the success sentence comes with the amount and the date as the file wrote them.
  await expect(resultOf(page).getByRole("status")).toContainText(
    `Fattura FT 12 del ${SHOWN_DATE} · ${SUPPLIER_NAME} · 44,00 € letta dal file XML. Controllala e approvala.`,
  );
  const [created, ...others] = await listedInvoices(page);
  expect(others).toHaveLength(0);
  expect(created).toMatchObject({ status: "review", fileMime: "application/xml" });
  const id = created!.id;
  const row = page.getByRole("listitem").filter({ hasText: `${SUPPLIER_NAME} · FT 12` });
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId("invoice-status")).toHaveText("Da controllare");
  await expect(row.getByTestId("invoice-source")).toHaveText("XML");
  await expectPhoneFriendly(page);

  // "Controlla ora" opens the review of this very invoice.
  await resultOf(page)
    .getByRole("link", { name: /Controlla ora/ })
    .click();
  await expect(page).toHaveURL((url) => url.pathname === `/fatture/${id}/revisione`);
  await expect(page.getByRole("heading", { name: SUPPLIER_NAME, exact: true })).toBeVisible();
  await expect(page.getByTestId("xml-chip")).toHaveText("Fattura elettronica · Fattura (TD01)");

  // "Dati dal file XML": open by default on a phone, with the file's own figures. The due date is "Scadenza pagamento", never "Scadenza".
  const card = page.getByRole("button", { name: /Dati dal file XML/ });
  await expect(card).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("xml-number")).toHaveText("FT 12");
  await expect(page.getByTestId("xml-date")).toHaveText(SHOWN_DATE);
  await expect(page.getByTestId("xml-due-date")).toHaveText(SHOWN_DUE);
  const facts = page.getByTestId("xml-facts");
  await expect(facts.getByText("Scadenza pagamento", { exact: true })).toBeVisible();
  await expect(facts.getByText("Scadenza", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("xml-vat-row")).toHaveText([
    "10% · imponibile 40,00 € · IVA 4,00 €",
  ]);
  await expect(page.getByTestId("xml-total")).toHaveText("44,00 €");
  // Nothing renders the XML: no frame, no image; and the file had nothing Costì left out, so no notes card.
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(page.locator("main img")).toHaveCount(0);
  await expect(page.getByText("Nel file c'è anche")).toHaveCount(0);

  // The original is offered as a download, from the stored copy, never inline.
  const download = page.getByRole("link", { name: "Scarica il file originale (XML)" });
  await expect(download).toHaveAttribute("download", "");
  const href = await download.getAttribute("href");
  expect(href).toMatch(/^\/api\/invoices\/[0-9a-f-]{36}\/original$/);
  const stored = await page.request.get(new URL(href!, page.url()).toString());
  expect(stored.status()).toBe(200);
  expectAttachmentHeaders(stored.headers(), "IT00000000000_00001.xml");
  expect(await stored.body()).toEqual(file.buffer);

  // The lines carry what the file said: the first code (the one Costì uses to recognise the item), and the supplier's LOTTO value.
  await expect(page.getByText("Righe dal file XML")).toBeVisible();
  const farina = rowOf(page, "Farina Demo");
  const olio = rowOf(page, "Olio Demo");
  await expect(farina).toContainText("Cod. EAN 8000000000001");
  await expect(farina).toContainText("usato per riconoscere l'articolo");
  await expect(farina).toContainText("Dal fornitore");
  await expect(farina).toContainText("LOTTO");
  await expect(farina).toContainText("L-DEMO-0001");
  await expect(olio).not.toContainText("Dal fornitore");
  await expect(lotMissing(farina)).toHaveText("Lotto mancante");
  await expect(lotMissing(olio)).toHaveText("Lotto mancante");

  // An unknown supplier: the file's name and VAT number, and nothing is created until the owner taps.
  await expect(page.getByText(`Fornitore nuovo: ${SUPPLIER_NAME}`)).toBeVisible();
  await expect(page.getByText("P.IVA IT12345678903 · dal file XML")).toBeVisible();
  await expectPhoneFriendly(page);

  // One tap copies the lot: the line shows it and its "Lotto mancante" goes, the other line keeps its own.
  await farina.getByRole("button", { name: "Usa come lotto" }).click();
  await expect(farina.getByRole("status")).toHaveText("Lotto copiato.");
  await expect(lotMissing(farina)).toHaveCount(0);
  await expect(lotMissing(olio)).toHaveText("Lotto mancante");
  await expect(farina.getByRole("button", { name: "Usa come lotto" })).toHaveCount(0);
  const reviewed = (await (await page.request.get(`/api/invoices/${id}/review`)).json()) as {
    review: { lines: { rawDescription: string; lotCode: string | null }[] };
  };
  expect(reviewed.review.lines.map((line) => [line.rawDescription, line.lotCode]).sort()).toEqual([
    ["Farina Demo", "L-DEMO-0001"],
    ["Olio Demo", null],
  ]);

  // "Crea fornitore" opens prefilled from the file; the supplier is linked on confirm.
  await page.getByRole("button", { name: "Crea fornitore", exact: true }).click();
  const create = page.getByRole("form", { name: "Crea fornitore" });
  await expect(
    create.getByText("Dati letti dal file XML: controllali prima di creare."),
  ).toBeVisible();
  await expect(create.getByLabel("Nome")).toHaveValue(SUPPLIER_NAME);
  await expect(create.getByLabel("Partita IVA")).toHaveValue("IT12345678903");
  await create.getByRole("button", { name: "Crea fornitore" }).click();
  await expect(page.getByText("Fornitore nuovo", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cambia fornitore" })).toBeVisible();

  // Mapping the two lines to ingredients is the review's job on every invoice (covered by invoice-review.spec.ts); here it goes through the API.
  for (const [description, ingredientId] of [
    ["Farina Demo", ingredientIds["Farina Demo"]],
    ["Olio Demo", ingredientIds["Olio Demo"]],
  ] as const) {
    const lineId = await rowOf(page, description).getAttribute("data-line-id");
    const mapped = await page.request.patch(`/api/invoices/${id}/lines/${lineId}`, {
      data: { ingredientId },
    });
    expect(mapped.status(), description).toBe(200);
  }
  await page.reload();

  // The approval is the unchanged one: the payable comes from the file's total and the due date the file carried.
  const panel = page.getByTestId("approval-panel");
  await expect(panel.getByTestId("approval-payable")).toContainText(
    `Da pagare 44,00 € entro il ${SHOWN_DUE} · dalla fattura`,
  );
  await expect(panel.getByTestId("approval-receipts")).toContainText(
    `Carico del ${SHOWN_DATE} · 2 carichi in Cella`,
  );
  await panel.getByRole("button", { name: "Approva fattura" }).click();
  await panel.getByRole("button", { name: "Conferma approvazione" }).click();
  await expect(page.getByTestId("invoice-status")).toHaveText("Approvata");
  await expect(panel.getByTestId("posted-payable")).toContainText("Da pagare 44,00 €");
  await expect(rowOf(page, "Farina Demo")).toContainText("Caricato: 3 kg");
  await expect(rowOf(page, "Olio Demo")).toContainText("Caricato: 2 kg");
  // Closed: no "Usa come lotto" any more, and the original is still there to download.
  await expect(page.getByRole("button", { name: /Usa come (lotto|scadenza)/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Scarica il file originale (XML)" })).toBeVisible();
  await expectPhoneFriendly(page);

  expect(await businessDateOf(page)).toBe(dayBefore);
});

test("a signed file of 2 invoices becomes 2 invoices: the card lists them, the review says the signature is not verified (AT-X3, X8)", async ({
  page,
}) => {
  await signInWithMagicLink(page, createOwner());
  const { buyerVat } = await seedXmlTenant(page);
  await page.goto("/fatture");
  await expect(page.getByText("Nessuna fattura caricata.")).toBeVisible();

  const file = p7mFile(buyerVat, ["FT 21", "FT 22"]);
  await pickAndUpload(page, file);
  const result = resultOf(page);
  await expect(result.getByRole("status")).toHaveText("Il file conteneva 2 fatture, tutte lette:");
  const rows = result.getByRole("link");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText(`FT 21 del ${SHOWN_DATE} · 44,00 €`);
  await expect(rows.nth(1)).toContainText(`FT 22 del 04/11/1998 · 44,00 €`);
  await expect(rows.nth(0)).toContainText("Da controllare");
  await expect(rows.nth(1)).toContainText("Da controllare");

  // The list marks both as signed files; the API holds two invoices of the same file.
  await expect(page.getByTestId("invoice-source")).toHaveText(["XML firmato", "XML firmato"]);
  const listed = await listedInvoices(page);
  expect(listed).toHaveLength(2);
  expect(listed.map((invoice) => invoice.fileMime)).toEqual([
    "application/pkcs7-mime",
    "application/pkcs7-mime",
  ]);
  await expectPhoneFriendly(page);

  // The second invoice's review says which one of the file it is, and that the signature was opened, not verified.
  await rows.nth(1).click();
  await expect(page).toHaveURL(/\/fatture\/[0-9a-f-]+\/revisione$/);
  await expect(page.getByTestId("xml-number")).toHaveText("FT 22");
  await expect(page.getByText("Fattura 2 di 2 nello stesso file")).toBeVisible();
  await expect(page.getByText("File firmato (firma non verificata da Costì)")).toBeVisible();
  const download = page.getByRole("link", { name: "Scarica il file originale (P7M firmato)" });
  const href = await download.getAttribute("href");
  expect(href).toMatch(/^\/api\/invoices\/[0-9a-f-]{36}\/original$/);
  const stored = await page.request.get(new URL(href!, page.url()).toString());
  expect(stored.status()).toBe(200);
  expectAttachmentHeaders(stored.headers(), "FT-DEMO.xml.p7m");
  expect(await stored.body()).toEqual(file.buffer);
  await expectPhoneFriendly(page);
});

test("a credit note (TD04) is refused in Italian and nothing is saved (AT-X4)", async ({
  page,
}) => {
  await signInWithMagicLink(page, createOwner());
  const { buyerVat } = await seedXmlTenant(page);
  await page.goto("/fatture");
  await expect(page.getByText("Nessuna fattura caricata.")).toBeVisible();

  await pickAndUpload(page, xmlFileOfType(buyerVat, "TD04", "NC 1"));
  await expect(page.getByRole("alert").filter({ hasText: "nota di credito" })).toHaveText(
    "È una nota di credito (TD04): Costì non la registra ancora. Passala al commercialista.",
  );
  // The refused file stays named in the card, no success is shown, and the list and the database hold nothing new.
  await expect(uploadForm(page).getByText("File scelto: nota.xml")).toBeVisible();
  await expect(resultOf(page).getByRole("status")).toHaveCount(0);
  await expect(page.getByText("Nessuna fattura caricata.")).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveCount(0);
  expect(await listedInvoices(page)).toHaveLength(0);
  await expectPhoneFriendly(page);
});

test("the same file twice: the second is refused with a link to the first invoice (AT-X6)", async ({
  page,
}) => {
  await signInWithMagicLink(page, createOwner());
  const { buyerVat } = await seedXmlTenant(page);
  await page.goto("/fatture");
  await expect(page.getByText("Nessuna fattura caricata.")).toBeVisible();

  const file = xmlFile(buyerVat);
  await pickAndUpload(page, file);
  await expect(resultOf(page).getByRole("status")).toContainText("letta dal file XML");
  const [first] = await listedInvoices(page);
  expect(first).toBeDefined();

  await pickAndUpload(page, file);
  const alert = resultOf(page).getByRole("alert");
  await expect(alert).toHaveText("Questo file è già stato caricato.");
  await expect(resultOf(page).getByRole("status")).toHaveCount(0);
  const open = resultOf(page).getByRole("link", { name: /Apri la fattura/ });
  await expect(open).toHaveAttribute("href", `/fatture/${first!.id}`);
  // Still one invoice: nothing was stored by the second upload.
  expect(await listedInvoices(page)).toHaveLength(1);
  await expectPhoneFriendly(page);

  await open.click();
  await expect(page).toHaveURL((url) => url.pathname === `/fatture/${first!.id}`);
  await expect(
    page.getByRole("heading", { name: `${SUPPLIER_NAME} · FT 12`, exact: true }),
  ).toBeVisible();
});
