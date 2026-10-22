import { expect, test } from "@playwright/test";
import { fakeHeic, fakePdf, textBytes } from "../tests/helpers/fake-files";
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
