import { expect, type Locator, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { payment, type BodySpec } from "../../tests/fixtures/fatturapa/build-xml";
import {
  SUPPLIER_VAT,
  asP7m,
  fatturaXml,
  invoiceBody,
} from "../../tests/fixtures/fatturapa/demo-invoice";
import { admin, tenantIdOf } from "./seed-invoice";

// Helpers of e2e/xml-invoice.spec.ts: fake FatturaPA files addressed to the signed-in owner's tenant (its VAT number is made up per
// run, so the buyer is read from the tenant row with the local stack's secret key, like the other seeds), the upload card, and the
// raw list. Fake data only ("Fornitore Demo 1", IT12345678903). The tests and the integration suite share the builders in
// tests/fixtures/fatturapa/demo-invoice.ts.

export { SUPPLIER_VAT };
export const SUPPLIER_NAME = "Fornitore Demo 1";
export const XML_MIME = "application/xml";
export const P7M_MIME = "application/pkcs7-mime";

/** The date of the invoices below, as the screens write it (formatCalendarDate), and the due date the payment block carries. */
export const SHOWN_DATE = "03/11/1998";
export const SHOWN_DUE = "03/12/1998";

export interface XmlTenant {
  tenantId: string;
  /** The VAT number of the tenant: the buyer of every file. */
  buyerVat: string;
  ingredientIds: Record<string, string>;
}

/** The tenant of the signed-in owner with what a first approval needs: the ingredients the demo lines are booked to and one location. */
export async function seedXmlTenant(page: Page, db: SupabaseClient = admin()): Promise<XmlTenant> {
  const tenantId = await tenantIdOf(page);
  const tenant = await db.from("tenant").select("vat_number").eq("id", tenantId).single();
  expect(tenant.error).toBeNull();
  const ingredientIds: Record<string, string> = {};
  for (const name of ["Farina Demo", "Olio Demo"]) {
    const made = await db
      .from("ingredient")
      .insert({ tenant_id: tenantId, name, base_unit: "kg" })
      .select("id")
      .single();
    expect(made.error).toBeNull();
    ingredientIds[name] = made.data!.id as string;
  }
  const place = await db.from("location").insert({ tenant_id: tenantId, name: "Cella" });
  expect(place.error).toBeNull();
  return { tenantId, buyerVat: tenant.data!.vat_number as string, ingredientIds };
}

export interface PickedFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

const asFile = (bytes: Uint8Array, name: string, mimeType: string): PickedFile => ({
  name,
  mimeType,
  buffer: Buffer.from(bytes),
});

/** A plain .xml of one TD01 invoice dated 3 Nov 1998 and due 3 Dec 1998 (the payment block), as the tax portal names it. */
export function xmlFile(
  buyerVat: string,
  numero = "FT 12",
  over: BodySpec = {},
  name = "IT00000000000_00001.xml",
): PickedFile {
  const body = invoiceBody(numero, "1998-11-03", {
    payments: payment({ scadenza: "1998-12-03" }),
    ...over,
  });
  return asFile(fatturaXml(buyerVat, [body]), name, XML_MIME);
}

/** A signed .xml.p7m holding the given invoices (one body each, dated 3 Nov 1998 and the days after). */
export function p7mFile(buyerVat: string, numbers: string[], name = "FT-DEMO.xml.p7m"): PickedFile {
  const bodies = numbers.map((numero, index) =>
    invoiceBody(numero, `1998-11-0${3 + index}`, { payments: payment({ scadenza: "1998-12-03" }) }),
  );
  return asFile(asP7m(fatturaXml(buyerVat, bodies)), name, P7M_MIME);
}

/** An .xml file of the given type (TD04 is a credit note) with the same demo body. */
export function xmlFileOfType(buyerVat: string, td: string, numero: string): PickedFile {
  return asFile(
    fatturaXml(buyerVat, [invoiceBody(numero, "1998-11-03", { td })]),
    "nota.xml",
    XML_MIME,
  );
}

/** The upload card. */
export const uploadForm = (page: Page): Locator =>
  page.getByRole("form", { name: "Carica una fattura" });

/** Picks the file in the card's file field and taps "Carica". */
export async function pickAndUpload(page: Page, file: PickedFile): Promise<void> {
  const form = uploadForm(page);
  await form.getByLabel("Carica PDF, foto o file XML").setInputFiles(file);
  await expect(form.getByText(`File scelto: ${file.name}`)).toBeVisible();
  await form.getByRole("button", { name: "Carica", exact: true }).click();
}

export interface ListedInvoice {
  id: string;
  number: string | null;
  status: string;
  fileMime: string;
}

/** Every invoice of the signed-in owner's tenant, from the API, newest first as the list answers. */
export async function listedInvoices(page: Page): Promise<ListedInvoice[]> {
  const reply = await page.request.get("/api/invoices");
  expect(reply.status()).toBe(200);
  return ((await reply.json()) as { invoices: ListedInvoice[] }).invoices;
}
