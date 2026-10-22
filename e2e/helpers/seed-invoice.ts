import { randomInt, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, type Page } from "@playwright/test";
import { fakePdf } from "../../tests/helpers/fake-files";

// Puts an invoice into the state the extraction worker leaves behind, through the LOCAL stack's
// secret key (test code only, like magic-link.spec.ts): the worker itself is covered by the
// integration suite. Fake data only ("Fornitore Demo Srl", IT12345678903).

export const admin = (): SupabaseClient =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false },
  });

export async function tenantIdOf(page: Page): Promise<string> {
  const me = await page.request.get("/api/me");
  return ((await me.json()) as { tenant: { id: string } }).tenant.id;
}

export interface SeedLine {
  description: string;
  qty: number;
  unit?: "kg" | "g" | "l" | "ml" | "pz" | "conf";
  unitPrice: number;
  /** Defaults to qty x unitPrice. */
  amount?: number;
  code?: string;
  /** Name of a seeded ingredient: the line starts mapped to it. */
  mappedTo?: string;
  /** Fields the reviewer is recorded as having corrected (for the quality report). */
  corrected?: string[];
}

export interface SeedOptions {
  name: string;
  status?: "review" | "extraction_failed" | "duplicate";
  /** The supplier row to link; omitted: the invoice is read but not linked. */
  supplierId?: string;
  duplicateOf?: string;
  lines?: SeedLine[];
  /** Upload a real (fake) PDF at the invoice's storage path. */
  withFile?: boolean;
}

export const INGREDIENTS = [
  ["Farina 00", "kg"],
  ["Olio extravergine", "l"],
  ["Uova", "pz"],
] as const;

export async function seedSupplier(db: SupabaseClient, tenantId: string): Promise<string> {
  const made = await db
    .from("supplier")
    .insert({ tenant_id: tenantId, name: "Fornitore Demo Srl", vat_number: "IT12345678903" })
    .select("id")
    .single();
  expect(made.error).toBeNull();
  return made.data!.id as string;
}

export async function seedIngredients(
  db: SupabaseClient,
  tenantId: string,
): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const [name, baseUnit] of INGREDIENTS) {
    const made = await db
      .from("ingredient")
      .insert({ tenant_id: tenantId, name, base_unit: baseUnit })
      .select("id")
      .single();
    expect(made.error).toBeNull();
    ids[name] = made.data!.id as string;
  }
  return ids;
}

/** Inserts the invoice row, walks it through the lifecycle guard, then adds its lines. */
export async function seedInvoice(
  db: SupabaseClient,
  tenantId: string,
  options: SeedOptions,
  ingredientIds: Record<string, string> = {},
): Promise<string> {
  const id = randomUUID();
  const status = options.status ?? "review";
  const path = `${tenantId}/2026/${id}.pdf`;
  if (options.withFile) {
    const stored = await db.storage
      .from("invoices")
      .upload(path, Buffer.from(fakePdf()), { contentType: "application/pdf" });
    expect(stored.error).toBeNull();
  }
  const inserted = await db.from("invoice").insert({
    id,
    tenant_id: tenantId,
    file_path: path,
    file_mime: "application/pdf",
    file_size_bytes: 80,
    original_filename: options.name,
  });
  expect(inserted.error).toBeNull();

  const lines = options.lines ?? [];
  const net = lines.reduce(
    (sum, l) => sum + Math.round((l.amount ?? l.qty * l.unitPrice) * 100),
    0,
  );
  const vat = Math.round(net * 0.1);
  const final: Record<string, unknown> =
    status === "extraction_failed"
      ? { status, extraction_error: "provider_unavailable", attempts: 3 }
      : {
          status,
          supplier_vat: "IT12345678903",
          supplier_name: "Fornitore Demo Srl",
          // Unique per invoice: one live invoice per supplier, number and date.
          number_raw: `FT ${randomInt(1e6)}/2026`,
          invoice_date: "2026-10-15",
          net_total: net / 100,
          vat_total: vat / 100,
          gross_total: (net + vat) / 100,
          totals_diff: 0,
          gate_flags: [],
          attempts: 1,
          extracted_at: new Date().toISOString(),
          supplier_id: options.supplierId ?? null,
          duplicate_of: options.duplicateOf ?? null,
        };
  // The lifecycle guard only allows received -> extracting -> review / duplicate / extraction_failed.
  for (const patch of [{ status: "extracting" }, final]) {
    const moved = await db.from("invoice").update(patch).eq("id", id);
    expect(moved.error).toBeNull();
  }

  if (lines.length > 0) {
    const inserted = await db.from("invoice_line").insert(
      lines.map((line, index) => ({
        tenant_id: tenantId,
        invoice_id: id,
        position: index + 1,
        raw_description: line.description,
        supplier_code: line.code ?? null,
        qty: line.qty,
        unit_raw: line.unit ?? null,
        unit: line.unit ?? null,
        unit_price: line.unitPrice,
        line_amount: line.amount ?? line.qty * line.unitPrice,
        vat_rate: 10,
        field_confidence: {},
        extracted: {},
        ingredient_id: line.mappedTo ? ingredientIds[line.mappedTo] : null,
        mapping_source: line.mappedTo ? "manual" : null,
        corrected_fields: line.corrected ?? [],
      })),
    );
    expect(inserted.error).toBeNull();
  }
  return id;
}
