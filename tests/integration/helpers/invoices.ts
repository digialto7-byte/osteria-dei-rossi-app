import { randomInt, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { expect } from "vitest";

// Puts an invoice into the state the extraction worker leaves behind (review, supplier linked, lines
// mapped to ingredients), through the LOCAL stack's secret key: test code only, like the Playwright
// helper e2e/helpers/seed-invoice.ts. The invoice is then approved through the real approve route.
// Fake data only ("Fornitore Demo Srl").

export interface ReviewLineSeed {
  description: string;
  ingredientId: string;
  qty: number;
  unit: "kg" | "l" | "pz";
  /** EUR per unit, net of VAT. */
  unitPrice: number;
  /** The supplier's lot code and printed expiry (YYYY-MM-DD), which the approval copies onto the lot (M12). */
  lotCode?: string;
  expiry?: string | null;
}

export async function seedSupplier(db: SupabaseClient, tenantId: string): Promise<string> {
  const made = await db
    .from("supplier")
    .insert({
      tenant_id: tenantId,
      name: "Fornitore Demo Srl",
      vat_number: "IT12345678903",
      payment_terms_days: 30,
    })
    .select("id")
    .single();
  expect(made.error).toBeNull();
  return made.data!.id as string;
}

export async function seedLocation(db: SupabaseClient, tenantId: string): Promise<string> {
  const made = await db
    .from("location")
    .insert({ tenant_id: tenantId, name: "Cella" })
    .select("id")
    .single();
  expect(made.error).toBeNull();
  return made.data!.id as string;
}

/**
 * An invoice in `review` with its supplier linked and every line mapped, whose totals match its
 * lines (VAT 10 %), so the only thing left is the owner's approval. `date` is the invoice date
 * (YYYY-MM-DD): it is the effective date of the prices the approval records.
 */
export async function seedReviewInvoice(
  db: SupabaseClient,
  tenantId: string,
  options: { supplierId: string; date: string; lines: ReviewLineSeed[] },
): Promise<string> {
  const id = randomUUID();
  const inserted = await db.from("invoice").insert({
    id,
    tenant_id: tenantId,
    file_path: `${tenantId}/2026/${id}.pdf`,
    file_mime: "application/pdf",
    file_size_bytes: 80,
    original_filename: "fattura-costi-demo.pdf",
  });
  expect(inserted.error).toBeNull();

  const amounts = options.lines.map((line) => Math.round(line.qty * line.unitPrice * 100));
  const net = amounts.reduce((sum, amount) => sum + amount, 0);
  const vat = Math.round(net * 0.1);
  const final = {
    status: "review",
    supplier_vat: "IT12345678903",
    supplier_name: "Fornitore Demo Srl",
    number_raw: `CT ${randomInt(1e9)}/2026`,
    invoice_date: options.date,
    net_total: net / 100,
    vat_total: vat / 100,
    gross_total: (net + vat) / 100,
    totals_diff: 0,
    gate_flags: [],
    attempts: 1,
    extracted_at: new Date().toISOString(),
    supplier_id: options.supplierId,
  };
  // The lifecycle guard only allows received -> extracting -> review.
  for (const patch of [{ status: "extracting" }, final]) {
    const moved = await db.from("invoice").update(patch).eq("id", id);
    expect(moved.error).toBeNull();
  }

  const lines = await db.from("invoice_line").insert(
    options.lines.map((line, index) => ({
      tenant_id: tenantId,
      invoice_id: id,
      position: index + 1,
      raw_description: line.description,
      qty: line.qty,
      unit_raw: line.unit,
      unit: line.unit,
      unit_price: line.unitPrice,
      line_amount: amounts[index]! / 100,
      vat_rate: 10,
      field_confidence: {},
      extracted: {},
      ingredient_id: line.ingredientId,
      lot_code: line.lotCode ?? null,
      expiry: line.expiry ?? null,
      mapping_source: "manual",
      corrected_fields: [],
    })),
  );
  expect(lines.error).toBeNull();
  return id;
}

/**
 * Seeds a reviewed invoice whose lines carry a lot code and an expiry, then approves it with the given function
 * (the real approve route, called as the owner) into the given location. Returns the invoice id and the HTTP
 * status of the approval. Existing callers of seedReviewInvoice are unchanged: the lot fields are optional.
 */
export async function approveWithLots(
  db: SupabaseClient,
  tenantId: string,
  options: { supplierId: string; date: string; lines: ReviewLineSeed[] },
  approve: (invoiceId: string) => Promise<number>,
): Promise<{ invoiceId: string; status: number }> {
  const invoiceId = await seedReviewInvoice(db, tenantId, options);
  return { invoiceId, status: await approve(invoiceId) };
}
