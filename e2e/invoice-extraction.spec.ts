import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import {
  createOwner,
  expectPhoneFriendly,
  requireSupabaseStack,
  signInWithMagicLink,
} from "./helpers/session";

requireSupabaseStack();

// The extraction worker is covered by the integration suite; here an invoice is put into the
// state the worker leaves behind (through the secret-key client, like magic-link.spec.ts), and
// the owner's screens must show it in Italian on a phone.
const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false },
  });

async function seedInvoice(
  page: Page,
  name: string,
  final: Record<string, unknown> & { status: "review" | "extraction_failed" },
): Promise<string> {
  const me = await page.request.get("/api/me");
  const tenantId = ((await me.json()) as { tenant: { id: string } }).tenant.id;
  const id = randomUUID();
  const db = admin();
  const inserted = await db.from("invoice").insert({
    id,
    tenant_id: tenantId,
    file_path: `${tenantId}/2026/${id}.pdf`,
    file_mime: "application/pdf",
    file_size_bytes: 80,
    original_filename: name,
  });
  expect(inserted.error).toBeNull();
  // The lifecycle guard only allows received -> extracting -> review / extraction_failed.
  for (const patch of [{ status: "extracting" }, final]) {
    const moved = await db.from("invoice").update(patch).eq("id", id);
    expect(moved.error).toBeNull();
  }
  return id;
}

test("a read invoice shows its totals, the mismatch flag and Rome time (AT2 display)", async ({
  page,
}) => {
  await signInWithMagicLink(page, createOwner());
  const id = await seedInvoice(page, "fattura-letta.pdf", {
    status: "review",
    supplier_vat: "IT12345678903",
    supplier_name: "Fornitore Demo Srl",
    number_raw: "FT 1/2026",
    invoice_date: "2026-10-15",
    due_date: "2026-11-15",
    net_total: 30,
    vat_total: 3,
    gross_total: 33.06,
    totals_diff: -0.06,
    gate_flags: ["total_mismatch"],
    attempts: 1,
    // 22:30 UTC on 15 October is 00:30 on the 16th in Rome (summer time).
    extracted_at: "2026-10-15T22:30:00Z",
  });

  await page.goto("/fatture");
  const row = page.getByRole("listitem").filter({ hasText: "fattura-letta.pdf" });
  await expect(row.getByTestId("invoice-status")).toHaveText("Da controllare");
  await expect(row.getByTestId("invoice-note")).toContainText("Il totale non corrisponde");
  await expect(row).toContainText("Fornitore Demo Srl");
  await expectPhoneFriendly(page);

  await page.goto(`/fatture/${id}`);
  await expect(page.getByTestId("supplier")).toHaveText("Fornitore Demo Srl");
  await expect(page.getByTestId("number")).toHaveText("FT 1/2026");
  await expect(page.getByTestId("invoice-date")).toHaveText("15/10/2026");
  await expect(page.getByTestId("due-date")).toHaveText("15/11/2026");
  await expect(page.getByTestId("net-total")).toHaveText("30,00 €");
  await expect(page.getByTestId("vat-total")).toHaveText("3,00 €");
  await expect(page.getByTestId("gross-total")).toHaveText("33,06 €");
  await expect(page.getByTestId("extracted-at")).toHaveText("16/10/2026, 00:30");
  await expect(page.getByTestId("invoice-note")).toContainText("Il totale non corrisponde");
  await expect(page.getByTestId("invoice-note")).toContainText("-0,06 €");
  await expectPhoneFriendly(page);

  // The API never hands out the raw model output, the lease id or the storage path.
  const api = await page.request.get(`/api/invoices/${id}`);
  const text = await api.text();
  expect(JSON.parse(text).invoice.grossTotal).toBe(33.06);
  expect(text).not.toMatch(/extraction_?json|claim_?token|file_?path/i);
});

test("a failed reading shows its reason in Italian (AT7 display)", async ({ page }) => {
  await signInWithMagicLink(page, createOwner());
  const id = await seedInvoice(page, "fattura-fallita.pdf", {
    status: "extraction_failed",
    extraction_error: "provider_unavailable",
    attempts: 3,
  });

  await page.goto("/fatture");
  const row = page.getByRole("listitem").filter({ hasText: "fattura-fallita.pdf" });
  await expect(row.getByTestId("invoice-status")).toHaveText("Lettura non riuscita");
  await expect(row.getByTestId("invoice-note")).toHaveText(
    "Lettura non riuscita: il servizio non risponde",
  );

  await page.goto(`/fatture/${id}`);
  await expect(page.getByTestId("invoice-note")).toHaveText(
    "Lettura non riuscita: il servizio non risponde",
  );
  await expect(page.getByTestId("attempts")).toHaveText("3");
  await expect(page.getByTestId("gross-total")).toHaveCount(0);
  await expectPhoneFriendly(page);
});
