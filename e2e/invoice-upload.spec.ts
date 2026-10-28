import { expect, test } from "@playwright/test";
import { fakeHeic, fakePdf, textBytes } from "../tests/helpers/fake-files";
import { admin } from "./helpers/seed-invoice";
import {
  createOwner,
  expectPhoneFriendly,
  requireSupabaseStack,
  signInWithMagicLink,
} from "./helpers/session";

requireSupabaseStack();

const pdfFile = (name: string) => ({
  name,
  mimeType: "application/pdf",
  buffer: Buffer.from(fakePdf()),
});

test("owner uploads an invoice PDF, sees it as Ricevuta and opens the document (AT1)", async ({
  page,
}) => {
  await signInWithMagicLink(page, createOwner());
  await page.goto("/fatture");
  await expect(page.getByText("Nessuna fattura caricata.")).toBeVisible();

  // The phone camera input asks for the rear camera and only offers images.
  const form = page.getByRole("form", { name: "Carica una fattura" });
  const camera = form.getByLabel("Scatta foto");
  await expect(camera).toHaveAttribute("capture", "environment");
  await expect(camera).toHaveAttribute("accept", /image\/jpeg/);
  await expect(camera).not.toHaveAttribute("accept", /pdf/);
  // No HEIC on the camera input, so iOS converts camera shots to JPEG itself.
  await expect(camera).not.toHaveAttribute("accept", /hei[cf]/);
  await expect(form.getByLabel("Carica PDF o foto")).toHaveAttribute("accept", /heic/);

  await form.getByLabel("Carica PDF o foto").setInputFiles(pdfFile("fattura-demo.pdf"));
  await expect(form.getByText("File scelto: fattura-demo.pdf")).toBeVisible();
  await form.getByRole("button", { name: "Carica", exact: true }).click();

  await expect(page.getByRole("status").filter({ hasText: "Fattura caricata." })).toBeVisible();
  const row = page.getByRole("listitem").filter({ hasText: "fattura-demo.pdf" });
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId("invoice-status")).toHaveText("Ricevuta");
  await expectPhoneFriendly(page);

  await row.getByRole("link").click();
  await expect(page.getByRole("heading", { name: "fattura-demo.pdf" })).toBeVisible();
  await expect(page.getByTestId("invoice-status")).toHaveText("Ricevuta");
  await expect(page.getByTestId("file-mime")).toHaveText("application/pdf");

  // The signed link is only fetched after the tap, and it serves the stored PDF.
  await expect(page.getByRole("link", { name: /Apri il documento/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Apri il documento" }).click();
  const link = page.getByRole("link", { name: "Apri il documento (valido 5 minuti)" });
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);
  const href = await link.getAttribute("href");
  expect(href).toBeTruthy();
  const document = await page.request.get(href!);
  expect(document.status()).toBe(200);
  expect((await document.body()).subarray(0, 5).toString("utf8")).toBe("%PDF-");
  await expectPhoneFriendly(page);
});

test("a text file named .pdf is refused in Italian and no invoice appears (AT2)", async ({
  page,
}) => {
  await signInWithMagicLink(page, createOwner());
  await page.goto("/fatture");
  await expect(page.getByText("Nessuna fattura caricata.")).toBeVisible();

  const form = page.getByRole("form", { name: "Carica una fattura" });
  await form.getByLabel("Carica PDF o foto").setInputFiles({
    name: "fattura.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(textBytes()),
  });
  await form.getByRole("button", { name: "Carica", exact: true }).click();

  await expect(page.getByRole("alert").filter({ hasText: "Formato non supportato" })).toBeVisible();
  await expect(page.getByText("Nessuna fattura caricata.")).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveCount(0);

  const list = await page.request.get("/api/invoices");
  expect(list.status()).toBe(200);
  expect(((await list.json()) as { invoices: unknown[] }).invoices).toHaveLength(0);
  await expectPhoneFriendly(page);
});

test("a HEIC photo the browser cannot decode is refused in Italian and no invoice appears", async ({
  page,
}) => {
  await signInWithMagicLink(page, createOwner());
  await page.goto("/fatture");
  await expect(page.getByText("Nessuna fattura caricata.")).toBeVisible();

  // Pinned to Playwright Chromium, which cannot decode HEIC: the re-encode step reports it before
  // anything is sent. If a future Chromium decodes HEIC, this fake 16-byte file fails differently.
  const form = page.getByRole("form", { name: "Carica una fattura" });
  await form.getByLabel("Carica PDF o foto").setInputFiles({
    name: "IMG_0001.heic",
    mimeType: "image/heic",
    buffer: Buffer.from(fakeHeic()),
  });
  await form.getByRole("button", { name: "Carica", exact: true }).click();

  await expect(
    page.getByRole("alert").filter({ hasText: "non è supportato da questo browser" }),
  ).toBeVisible();
  await expect(page.getByText("Nessuna fattura caricata.")).toBeVisible();
  const list = await page.request.get("/api/invoices");
  expect(((await list.json()) as { invoices: unknown[] }).invoices).toHaveLength(0);
});

// UX plan B6: extraction runs in the background, so the list looks again by itself. The worker is stubbed the way
// invoice-extraction.spec.ts does it: the row is moved through the lifecycle guard with the secret-key client.
test("the row goes from In lettura to Da controllare without a reload, and is titled by supplier and number (B6)", async ({
  page,
}) => {
  await signInWithMagicLink(page, createOwner());
  await page.goto("/fatture");
  const form = page.getByRole("form", { name: "Carica una fattura" });
  await form.getByLabel("Carica PDF o foto").setInputFiles(pdfFile("fattura-in-lettura.pdf"));
  await form.getByRole("button", { name: "Carica", exact: true }).click();
  const row = page.getByRole("listitem").filter({ hasText: "fattura-in-lettura.pdf" });
  await expect(row.getByTestId("invoice-status")).toHaveText("Ricevuta");

  const db = admin();
  const found = await db
    .from("invoice")
    .select("id")
    .eq("original_filename", "fattura-in-lettura.pdf")
    .single();
  expect(found.error).toBeNull();
  const id = found.data!.id as string;
  const extracting = await db.from("invoice").update({ status: "extracting" }).eq("id", id);
  expect(extracting.error).toBeNull();
  await expect(row.getByTestId("invoice-status")).toHaveText("In lettura", { timeout: 15_000 });

  const read = await db
    .from("invoice")
    .update({
      status: "review",
      supplier_vat: "IT12345678903",
      supplier_name: "Fornitore Demo Srl",
      number_raw: "123/A",
      invoice_date: "2026-10-15",
      attempts: 1,
      extracted_at: "2026-10-15T10:00:00Z",
    })
    .eq("id", id);
  expect(read.error).toBeNull();
  await expect(row.getByTestId("invoice-status")).toHaveText("Da controllare", { timeout: 15_000 });
  await expect(row).toContainText("Fornitore Demo Srl · 123/A");
  // The file name stays visible under the title.
  await expect(row).toContainText("fattura-in-lettura.pdf");
  await expectPhoneFriendly(page);

  await row.getByRole("link").first().click();
  await expect(page.getByRole("heading", { name: "Fornitore Demo Srl · 123/A" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Rivedi le righe" })).toBeVisible();
});
