import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { expect } from "vitest";
import { INVOICE_BUCKET } from "@/server/invoices/constants";
import { DECLARATION, bytesOf } from "../../fixtures/fatturapa/build-xml";

export {
  SUPPLIER_NAME,
  SUPPLIER_VAT,
  asP7m,
  fatturaXml,
  invoiceBody,
} from "../../fixtures/fatturapa/demo-invoice";

// Helpers of the XML e-invoice suite (tests/integration/xml-invoice.int.ts). The fixture builders are shared with the
// Playwright spec and live in tests/fixtures/fatturapa/demo-invoice.ts.

export const P7M_MIME = "application/pkcs7-mime";
export const XML_MIME = "application/xml";

/** The VAT number the stack gave the tenant: the buyer the import checks a file against. */
export async function tenantVatOf(admin: SupabaseClient, tenantId: string): Promise<string> {
  const read = await admin.from("tenant").select("vat_number").eq("id", tenantId).single();
  expect(read.error).toBeNull();
  return read.data!.vat_number as string;
}

/** A short upper-case tag, fresh per run: the invoice numbers carry it, so a re-run on the same stack never collides. */
export const runTag = (): string => randomUUID().slice(0, 6).toUpperCase();

/** The same file with a DTD declaration right after the XML declaration (a file that must be refused unread). */
export function withDoctype(xml: Uint8Array): Uint8Array {
  const text = new TextDecoder().decode(xml);
  const dtd = '<!DOCTYPE p:FatturaElettronica [ <!ENTITY demo "x"> ]>';
  const bombed = text.replace(`${DECLARATION}\n`, `${DECLARATION}\n${dtd}\n`);
  expect(bombed).not.toBe(text);
  return bytesOf(bombed);
}

export const sha256Hex = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

export interface UploadPart {
  bytes: Uint8Array;
  name: string;
  type: string;
}

/** The multipart request the route wants: one part `file`, the same Origin, a declared length within the limit. */
export function uploadRequest(part: UploadPart): Request {
  const form = new FormData();
  form.append("file", new File([part.bytes as BlobPart], part.name, { type: part.type }));
  return new Request("http://localhost:3000/api/invoices", {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "content-length": String(part.bytes.byteLength + 1024),
    },
    body: form,
  });
}

/** What Storage lists for an object of the bucket (the keys the import's check reads), or null when it is not there. */
export async function storageEntry(
  admin: SupabaseClient,
  path: string,
): Promise<{ name: string; metadata: Record<string, unknown> } | null> {
  const slash = path.lastIndexOf("/");
  const name = path.slice(slash + 1);
  const listed = await admin.storage
    .from(INVOICE_BUCKET)
    .list(path.slice(0, slash), { search: name, limit: 1000 });
  expect(listed.error).toBeNull();
  const found = (listed.data ?? []).find((entry) => entry.name === name);
  return found ? { name: found.name, metadata: found.metadata as Record<string, unknown> } : null;
}

/** How many objects the tenant's folder of the year holds: what "nothing was stored" compares. */
export async function objectCount(
  admin: SupabaseClient,
  tenantId: string,
  year: number,
): Promise<number> {
  const listed = await admin.storage
    .from(INVOICE_BUCKET)
    .list(`${tenantId}/${year}`, { limit: 1000 });
  expect(listed.error).toBeNull();
  return (listed.data ?? []).length;
}

export async function invoiceCountOf(admin: SupabaseClient, tenantId: string): Promise<number> {
  const counted = await admin
    .from("invoice")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  expect(counted.error).toBeNull();
  return counted.count ?? 0;
}
