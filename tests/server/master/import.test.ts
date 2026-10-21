import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_IMPORT_ROWS,
  ingredientRowsFromCsv,
  supplierRowsFromCsv,
} from "@/server/master/import";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  type FakeSupabase,
} from "../../helpers/fake-supabase";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const suppliersRoute = await import("@/app/api/admin/import/suppliers/route");
const ingredientsRoute = await import("@/app/api/admin/import/ingredients/route");

const fixture = (name: string) =>
  readFileSync(new URL(`../../fixtures/import/${name}`, import.meta.url), "utf8");
const SUPPLIERS_URL = "http://localhost:3000/api/admin/import/suppliers";
const INGREDIENTS_URL = "http://localhost:3000/api/admin/import/ingredients";
const COUNTS = { created: 3, updated: 0, unchanged: 0 };

function as(
  role: string,
  rpcError: { code: string; message: string; details?: string } | null = null,
) {
  client = fakeSupabase({
    claims: claimsFor(role),
    rpc: {
      import_suppliers: [{ data: rpcError ? null : COUNTS, error: rpcError }],
      import_ingredients: [{ data: rpcError ? null : COUNTS, error: rpcError }],
    },
  });
}

beforeEach(() => as("owner"));

describe("CSV mapping", () => {
  it("maps the Italian supplier template to RPC rows, numbering file lines", () => {
    expect(supplierRowsFromCsv(fixture("fornitori-demo.csv"))).toEqual({
      rows: [
        { row: 2, name: "Fornitore Demo Srl", vat_number: "IT12345678903", payment_terms_days: 30 },
        { row: 3, name: "Caseificio Demo", vat_number: "IT01234567897", payment_terms_days: null },
        { row: 4, name: "Mercato Rionale; banco 4", vat_number: null, payment_terms_days: null },
      ],
      errors: [],
    });
  });

  it("maps the ingredient template, with si/no and | separated allergens", () => {
    const { rows, errors } = ingredientRowsFromCsv(fixture("ingredienti-demo.csv"));
    expect(errors).toEqual([]);
    expect(rows[0]).toEqual({
      row: 2,
      name: "Farina 00",
      base_unit: "kg",
      category: "Secco",
      is_stock: true,
      allergens: ["glutine"],
      default_shelf_life_days: 180,
    });
    expect(rows[1]).toMatchObject({ name: "Uova", base_unit: "pz", category: null });
  });

  it("reports each bad cell with its line and column, and duplicates within the file", () => {
    const csv = [
      "nome;partita_iva;giorni_pagamento",
      "A;IT12345678903;30",
      "B;IT12345678901;x",
      ";IT11111111115;",
      "C;it 1234567890 3;",
    ].join("\n");
    expect(supplierRowsFromCsv(csv).errors).toEqual([
      { row: 3, field: "partita_iva", code: "invalid_vat_number" },
      { row: 3, field: "giorni_pagamento", code: "invalid_number" },
      { row: 4, field: "nome", code: "required" },
      { row: 5, field: "partita_iva", code: "duplicate_in_file" },
    ]);
  });

  it("reports a header problem on the header's real line", () => {
    expect(supplierRowsFromCsv("\n\nnome;colore\nA;rosso").errors).toEqual([
      { row: 3, field: "colore", code: "unknown_column" },
    ]);
  });

  it("rejects unknown columns and a missing nome column", () => {
    expect(supplierRowsFromCsv("nome;colore\nA;rosso").errors).toEqual([
      { row: 1, field: "colore", code: "unknown_column" },
    ]);
    expect(supplierRowsFromCsv("partita_iva\nIT12345678903").errors).toEqual([
      { row: 1, field: "nome", code: "missing_column" },
    ]);
  });

  it("checks ingredient units, booleans and allergens", () => {
    const csv = "nome;unita_base;a_magazzino;allergeni\nX;g;forse;glutine|glutammato\nX;kg;no;";
    expect(ingredientRowsFromCsv(csv).errors).toEqual([
      { row: 2, field: "unita_base", code: "invalid_unit" },
      { row: 2, field: "a_magazzino", code: "invalid_boolean" },
      { row: 2, field: "allergeni", code: "invalid_allergen" },
      { row: 3, field: "nome", code: "duplicate_in_file" },
    ]);
  });
});

describe("POST /api/admin/import/* (M1 acceptance test 5)", () => {
  it("imports the supplier CSV and returns the counts", async () => {
    const response = await suppliersRoute.POST(
      jsonRequest(SUPPLIERS_URL, { format: "csv", csv: fixture("fornitori-demo.csv") }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(COUNTS);
    expect(client.rpc).toHaveBeenCalledWith("import_suppliers", {
      rows: expect.arrayContaining([expect.objectContaining({ vat_number: "IT12345678903" })]),
    });
  });

  it("a bad row is 422 import_invalid with details, and nothing is sent to the database", async () => {
    const csv = "nome;partita_iva\nA;IT12345678903\nB;IT12345678901";
    const response = await suppliersRoute.POST(jsonRequest(SUPPLIERS_URL, { format: "csv", csv }));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: {
        code: "import_invalid",
        message: expect.any(String),
        details: [{ row: 3, field: "partita_iva", code: "invalid_vat_number" }],
      },
    });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("an ambiguous match reported by the database is 422 import_invalid for that row", async () => {
    as("owner", { code: "P0001", message: "ambiguous_match", details: "4" });
    const response = await suppliersRoute.POST(
      jsonRequest(SUPPLIERS_URL, { format: "csv", csv: fixture("fornitori-demo.csv") }),
    );
    expect(response.status).toBe(422);
    expect((await response.json()).error.details).toEqual([
      { row: 4, field: "nome", code: "ambiguous_match" },
    ]);
  });

  it("imports JSON rows too", async () => {
    const response = await ingredientsRoute.POST(
      jsonRequest(INGREDIENTS_URL, {
        format: "json",
        rows: [{ name: "Farina 00", baseUnit: "kg", allergens: ["glutine"] }],
      }),
    );
    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith("import_ingredients", {
      rows: [
        {
          row: 1,
          name: "Farina 00",
          base_unit: "kg",
          category: null,
          is_stock: true,
          allergens: ["glutine"],
          default_shelf_life_days: null,
        },
      ],
    });
  });

  it(`more than ${MAX_IMPORT_ROWS} rows is 400`, async () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => ({ name: `F${i}` }));
    const response = await suppliersRoute.POST(
      jsonRequest(SUPPLIERS_URL, { format: "json", rows }),
    );
    expect(response.status).toBe(400);
  });

  it("a body larger than the limit is 413 before it is read", async () => {
    const response = await suppliersRoute.POST(
      new Request(SUPPLIERS_URL, {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": "99999999" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(413);
    expect((await response.json()).error.code).toBe("payload_too_large");
  });

  it.each(["chef", "waiter"])("%s may not import", async (role) => {
    as(role);
    const response = await suppliersRoute.POST(
      jsonRequest(SUPPLIERS_URL, { format: "json", rows: [] }),
    );
    expect(response.status).toBe(403);
  });

  it("rejects unknown body fields", async () => {
    const response = await suppliersRoute.POST(
      jsonRequest(SUPPLIERS_URL, { format: "json", rows: [], dryRun: true }),
    );
    expect(response.status).toBe(400);
  });
});
