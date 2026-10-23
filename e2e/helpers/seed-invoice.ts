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
  /** The remembered supplier article (needed to receive a `conf` line, which carries the pack). */
  supplierItemId?: string;
  /** Fields the reviewer is recorded as having corrected (for the quality report). */
  corrected?: string[];
  /** The supplier's lot code and printed expiry (YYYY-MM-DD); the approval copies them onto the lot (M12). */
  lotCode?: string;
  expiry?: string;
}

export interface SeedOptions {
  name: string;
  status?: "review" | "extraction_failed" | "duplicate";
  /** The supplier row to link; omitted: the invoice is read but not linked. */
  supplierId?: string;
  /** The invoice this one copies: it takes that invoice's number and date, so the two are look-alikes. */
  duplicateOf?: string;
  lines?: SeedLine[];
  /** Upload a real (fake) PDF at the invoice's storage path. */
  withFile?: boolean;
  /**
   * A gross total that does not match the lines (and VAT), as a reading error would leave it:
   * the invoice is flagged `total_mismatch` and cannot be approved.
   */
  grossTotal?: number;
  /** YYYY-MM-DD; defaults to 2026-10-15. */
  invoiceDate?: string;
}

export const INGREDIENTS = [
  ["Farina 00", "kg"],
  ["Olio extravergine", "l"],
  ["Uova", "pz"],
] as const;

export async function seedSupplier(
  db: SupabaseClient,
  tenantId: string,
  options: { paymentTermsDays?: number } = {},
): Promise<string> {
  const made = await db
    .from("supplier")
    .insert({
      tenant_id: tenantId,
      name: "Fornitore Demo Srl",
      vat_number: "IT12345678903",
      payment_terms_days: options.paymentTermsDays ?? null,
    })
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

  // A copy has the number and date of its original (the database finds look-alikes by that key); every
  // other invoice gets a number of its own, as one live invoice per supplier, number and date is unique.
  let key = {
    number_raw: `FT ${randomInt(1e6)}/2026`,
    invoice_date: options.invoiceDate ?? "2026-10-15",
  };
  if (options.duplicateOf) {
    const original = await db
      .from("invoice")
      .select("number_raw, invoice_date")
      .eq("id", options.duplicateOf)
      .single();
    expect(original.error).toBeNull();
    key = original.data as typeof key;
  }

  const lines = options.lines ?? [];
  const net = lines.reduce(
    (sum, l) => sum + Math.round((l.amount ?? l.qty * l.unitPrice) * 100),
    0,
  );
  const vat = Math.round(net * 0.1);
  const gross = options.grossTotal === undefined ? net + vat : Math.round(options.grossTotal * 100);
  const mismatch = gross !== net + vat;
  const final: Record<string, unknown> =
    status === "extraction_failed"
      ? { status, extraction_error: "provider_unavailable", attempts: 3 }
      : {
          status,
          supplier_vat: "IT12345678903",
          supplier_name: "Fornitore Demo Srl",
          number_raw: key.number_raw,
          invoice_date: key.invoice_date,
          net_total: net / 100,
          vat_total: vat / 100,
          gross_total: gross / 100,
          totals_diff: mismatch ? Math.round(gross - (net + vat)) / 100 : 0,
          gate_flags: mismatch ? ["total_mismatch"] : [],
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
        supplier_item_id: line.supplierItemId ?? null,
        lot_code: line.lotCode ?? null,
        expiry: line.expiry ?? null,
        mapping_source: line.mappedTo ? "manual" : null,
        corrected_fields: line.corrected ?? [],
      })),
    );
    expect(inserted.error).toBeNull();
  }
  return id;
}

// --- An invoice that can be approved (M5) --------------------------------------------------------

/**
 * Four mapped stock lines of "Fornitore Demo Srl": net 1.122,27 €, VAT 10% 112,23 €, gross
 * 1.234,50 €. The first is two cartons of 6 x 1 kg (12 kg to receive).
 */
export const APPROVABLE_LINES: SeedLine[] = [
  {
    description: "Passata di pomodoro",
    qty: 2,
    unit: "conf",
    unitPrice: 30,
    code: "PAS-3",
    mappedTo: "Passata di pomodoro",
  },
  { description: "Farina 00", qty: 4, unit: "kg", unitPrice: 1.2, mappedTo: "Farina 00" },
  {
    description: "Olio extravergine di oliva",
    qty: 6,
    unit: "l",
    unitPrice: 8.5,
    mappedTo: "Olio extravergine",
  },
  {
    description: "Fesa di manzo",
    qty: 53,
    unit: "kg",
    unitPrice: 18.99,
    mappedTo: "Fesa di manzo",
  },
];
const APPROVABLE_INGREDIENTS = [
  ["Passata di pomodoro", "kg"],
  ["Farina 00", "kg"],
  ["Olio extravergine", "l"],
  ["Fesa di manzo", "kg"],
] as const;
/** The invoice is dated 29/09/2026 and the supplier pays in 30 days: due 29/10/2026. */
export const APPROVABLE_DATE = "2026-09-29";

export async function seedLocation(
  db: SupabaseClient,
  tenantId: string,
  name = "Cella",
): Promise<string> {
  const made = await db
    .from("location")
    .insert({ tenant_id: tenantId, name })
    .select("id")
    .single();
  expect(made.error).toBeNull();
  return made.data!.id as string;
}

/**
 * Everything an approval needs, so the happy path is one tap: a supplier with 30 payment days,
 * the location "Cella", the ingredients, the remembered pack of the passata (6 x 1 kg) and an
 * invoice in review with the four mapped lines. Pass `grossTotal` for a total that does not match.
 * Use it instead of `seedIngredients` in the same tenant (the ingredient names overlap).
 */
export async function seedApprovableInvoice(
  db: SupabaseClient,
  tenantId: string,
  options: {
    name?: string;
    grossTotal?: number;
    withFile?: boolean;
    /** A lot code and an expiry per line, by line description (M12); lines not named keep none. */
    lots?: Record<string, { lotCode?: string; expiry?: string }>;
  } = {},
): Promise<{ invoiceId: string; supplierId: string; locationId: string }> {
  const supplierId = await seedSupplier(db, tenantId, { paymentTermsDays: 30 });
  const locationId = await seedLocation(db, tenantId);
  const ingredients: Record<string, string> = {};
  for (const [name, baseUnit] of APPROVABLE_INGREDIENTS) {
    const made = await db
      .from("ingredient")
      .insert({ tenant_id: tenantId, name, base_unit: baseUnit })
      .select("id")
      .single();
    expect(made.error).toBeNull();
    ingredients[name] = made.data!.id as string;
  }
  const item = await db
    .from("supplier_item")
    .insert({
      tenant_id: tenantId,
      supplier_id: supplierId,
      ingredient_id: ingredients["Passata di pomodoro"],
      supplier_code: "PAS-3",
      pack_count: 6,
      pack_qty: 1,
      pack_unit: "kg",
      invoice_unit: "conf",
    })
    .select("id")
    .single();
  expect(item.error).toBeNull();
  const lines = APPROVABLE_LINES.map((line) => ({
    ...line,
    ...(line.code === "PAS-3" ? { supplierItemId: item.data!.id as string } : {}),
    ...(options.lots?.[line.description] ?? {}),
  }));
  const invoiceId = await seedInvoice(
    db,
    tenantId,
    {
      name: options.name ?? "fattura-da-approvare.pdf",
      supplierId,
      lines,
      grossTotal: options.grossTotal,
      invoiceDate: APPROVABLE_DATE,
      withFile: options.withFile,
    },
    ingredients,
  );
  return { invoiceId, supplierId, locationId };
}

// --- An approved invoice, i.e. a payable (M9) ----------------------------------------------------

/**
 * Seeds the approvable invoice and approves it through the real API as the signed-in owner, so a
 * payable of 1.234,50 EUR (due 29/10/2026 from the supplier's 30 days) exists. Returns the payable's
 * id (read back through the API) and the supplier's, for the screens that start from either.
 */
export async function seedApprovedPayable(
  page: Page,
  db: SupabaseClient,
  tenantId: string,
): Promise<{ payableId: string; supplierId: string; invoiceId: string }> {
  const { invoiceId, supplierId } = await seedApprovableInvoice(db, tenantId);
  const approved = await page.request.post(`/api/invoices/${invoiceId}/approve`, { data: {} });
  expect(approved.status()).toBe(200);
  const listed = await page.request.get("/api/payables");
  expect(listed.status()).toBe(200);
  const { payables } = (await listed.json()) as { payables: { id: string; invoiceId: string }[] };
  const payable = payables.find((item) => item.invoiceId === invoiceId);
  expect(payable).toBeDefined();
  return { payableId: payable!.id, supplierId, invoiceId };
}

// --- Raw stock (M12) ------------------------------------------------------------------------------

/**
 * A supplier with 30 payment days, the locations "Cella (demo)" and "Freezer (demo)", the ingredient
 * "Manzo muscolo (demo)" and a reviewed invoice of three beef lines of 2 kg at 10,00 EUR/kg: lot L-D5 expiring
 * in 5 days, lot L-D2 expiring in 2 days, and lot L-NONE with no expiry (AT1). The invoice is dated yesterday
 * (Europe/Rome). Approve it with `{ locationId: cellaId }`: the venue has two locations, so the body names one.
 */
export async function seedStockInvoice(
  db: SupabaseClient,
  tenantId: string,
  today: string,
  addDays: (isoDate: string, days: number) => string,
): Promise<{ invoiceId: string; cellaId: string; freezerId: string; ingredientId: string }> {
  const supplierId = await seedSupplier(db, tenantId, { paymentTermsDays: 30 });
  const cellaId = await seedLocation(db, tenantId, "Cella (demo)");
  const freezerId = await seedLocation(db, tenantId, "Freezer (demo)");
  const made = await db
    .from("ingredient")
    .insert({ tenant_id: tenantId, name: "Manzo muscolo (demo)", base_unit: "kg" })
    .select("id")
    .single();
  expect(made.error).toBeNull();
  const ingredientId = made.data!.id as string;
  const invoiceId = await seedInvoice(
    db,
    tenantId,
    {
      name: "fattura-magazzino-demo.pdf",
      supplierId,
      invoiceDate: addDays(today, -1),
      lines: [
        {
          description: "Manzo muscolo (demo) lotto D5",
          qty: 2,
          unit: "kg",
          unitPrice: 10,
          mappedTo: "Manzo muscolo (demo)",
          lotCode: "L-D5",
          expiry: addDays(today, 5),
        },
        {
          description: "Manzo muscolo (demo) lotto D2",
          qty: 2,
          unit: "kg",
          unitPrice: 10,
          mappedTo: "Manzo muscolo (demo)",
          lotCode: "L-D2",
          expiry: addDays(today, 2),
        },
        {
          description: "Manzo muscolo (demo) senza scadenza",
          qty: 2,
          unit: "kg",
          unitPrice: 10,
          mappedTo: "Manzo muscolo (demo)",
          lotCode: "L-NONE",
        },
      ],
    },
    { "Manzo muscolo (demo)": ingredientId },
  );
  return { invoiceId, cellaId, freezerId, ingredientId };
}
